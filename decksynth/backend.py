"""SDL audio and Linux raw MIDI adapter, isolated from the desktop UI."""
import array
from collections import deque
import math
import ctypes as C
import glob
import os
import gc
import queue
import time
from .drum_loader import DrumLoader
from .core import Engine, MidiParser, Project, instrument, SPECTRAL_RANGES, VOICE_RANGES, VOICE_CHOICES, arp_view
from .keystep import StepCapacityError

class AudioSpec(C.Structure):
    _fields_=[('freq',C.c_int),('format',C.c_ushort),('channels',C.c_ubyte),('silence',C.c_ubyte),('samples',C.c_ushort),('padding',C.c_ushort),('size',C.c_uint),('callback',C.c_void_p),('userdata',C.c_void_p)]

class Audio:
    def __init__(self, preferred='Deck speakers'):
        self.lib=C.CDLL('libSDL2-2.0.so.0'); s=self.lib
        s.SDL_Init.argtypes=[C.c_uint]; s.SDL_Init.restype=C.c_int
        s.SDL_GetError.restype=C.c_char_p
        s.SDL_OpenAudioDevice.argtypes=[C.c_char_p,C.c_int,C.POINTER(AudioSpec),C.POINTER(AudioSpec),C.c_int]; s.SDL_OpenAudioDevice.restype=C.c_uint
        s.SDL_GetQueuedAudioSize.argtypes=[C.c_uint]; s.SDL_GetQueuedAudioSize.restype=C.c_uint
        s.SDL_QueueAudio.argtypes=[C.c_uint,C.c_void_p,C.c_uint]; s.SDL_QueueAudio.restype=C.c_int
        s.SDL_PauseAudioDevice.argtypes=[C.c_uint,C.c_int]; s.SDL_CloseAudioDevice.argtypes=[C.c_uint]
        s.SDL_ClearQueuedAudio.argtypes=[C.c_uint]
        s.SDL_GetCurrentAudioDriver.restype=C.c_char_p
        s.SDL_GetNumAudioDevices.argtypes=[C.c_int]; s.SDL_GetNumAudioDevices.restype=C.c_int
        s.SDL_GetAudioDeviceName.argtypes=[C.c_int,C.c_int]; s.SDL_GetAudioDeviceName.restype=C.c_char_p
        s.SDL_QuitSubSystem.argtypes=[C.c_uint]
        self.device=0
        if s.SDL_Init(0x10)!=0:raise RuntimeError(self.error())
        self.outputs=[s.SDL_GetAudioDeviceName(i,0).decode(errors='replace') for i in range(max(0,s.SDL_GetNumAudioDevices(0)))]
        if preferred=='Deck speakers':
            selected=next((name for name in self.outputs if 'Coprocessor Speaker' in name),None)
        elif preferred=='System default':selected=None
        elif preferred in self.outputs:selected=preferred
        else:
            s.SDL_QuitSubSystem(0x10)
            raise ValueError('Audio output not available: '+preferred)
        self.output=selected or 'System default'
        desired=AudioSpec(freq=48000,format=0x8120,channels=1,samples=256)
        actual=AudioSpec(); self.device=s.SDL_OpenAudioDevice(selected.encode() if selected else None,0,C.byref(desired),C.byref(actual),0)
        if not self.device:
            error=self.error(); s.SDL_QuitSubSystem(0x10); raise RuntimeError(error)
        self.rate=actual.freq; self.driver=s.SDL_GetCurrentAudioDriver().decode()
    def error(self):return self.lib.SDL_GetError().decode(errors='replace')
    def queued(self):return self.lib.SDL_GetQueuedAudioSize(self.device)//4
    def write(self,samples):
        data=array.array('f',samples).tobytes()
        if self.lib.SDL_QueueAudio(self.device,data,len(data))!=0:raise RuntimeError(self.error())
    def start(self):self.lib.SDL_PauseAudioDevice(self.device,0)
    def clear(self):self.lib.SDL_ClearQueuedAudio(self.device)
    def close(self):
        if self.device:self.lib.SDL_CloseAudioDevice(self.device); self.device=0
        self.lib.SDL_QuitSubSystem(0x10)

class MidiDevice:
    def __init__(self):self.path='Auto'; self.fd=None; self.connected=None; self.parser=MidiParser(); self.next_scan=0
    @staticmethod
    def devices():return sorted(glob.glob('/dev/snd/midiC*D*'))
    def close(self):
        if self.fd is not None:os.close(self.fd)
        self.fd=None; self.connected=None; self.parser=MidiParser()
    def poll(self,engine):
        rejections=[]
        now=time.monotonic()
        if now>=self.next_scan:
            self.next_scan=now+1; devices=self.devices()
            wanted=(devices[0] if devices else None) if self.path=='Auto' else self.path if self.path in devices else None
            if self.connected!=wanted:
                engine.panic(); self.close()
                if wanted:
                    try:self.fd=os.open(wanted,os.O_RDONLY|os.O_NONBLOCK); self.connected=wanted
                    except OSError:pass
        if self.fd is not None:
            try:
                data=os.read(self.fd,4096)
                if not data:raise OSError('MIDI disconnected')
                # MIDI realtime bytes can be interleaved with note data, even
                # inside running-status streams or SysEx.
                for status in data:
                    if status in (0xf8,0xfa,0xfb,0xfc):engine.receive_midi_clock(status,now)
                for event in self.parser.feed(data):
                    try:engine.midi(*event)
                    except StepCapacityError as exc:
                        # Reject this step edit only; subsequent note-offs must run.
                        rejections.append(str(exc))
            except BlockingIOError:pass
            except OSError:engine.panic(); self.close()
        return rejections

def worker(commands,updates):
    engine=Engine(); midi=MidiDevice(); audio=None; loader=None; last_status=0; underruns=0; started=False
    # Capture decimated samples from the actual synthesizer mix for the UI meter.
    # Never perform display rendering or FFT work on the audio process.
    monitor_samples=deque(maxlen=768)
    # Full-rate tail of the mix for the UI spectrum; the FFT itself runs in the renderer.
    spectrum_samples=deque(maxlen=512)
    def send(obj):
        try:updates.put_nowait(obj)
        except queue.Full:pass
    # Audio safety: a deeper buffer that grows after a dropout, no long garbage-collector pauses,
    # and a higher priority when the system allows it. dsp_load is the worst render time per block
    # over the last second, as a share of the block's own length (over 100 % means a dropout).
    target=1024; load_peak=0.; load_shown=0.; load_since=time.monotonic()
    try:os.nice(-5)
    except (OSError,AttributeError):pass
    try:
        try:audio=Audio(); engine=Engine(audio.rate)
        except Exception as exc:send(dict(error='Audio unavailable: '+str(exc)))
        loader=DrumLoader(engine)
        gc.collect(); gc.freeze(); gc.set_threshold(50000,50,1000)
        running=True
        while running:
            for _ in range(128):
                try:cmd,args=commands.get_nowait()
                except queue.Empty:break
                try:
                    if cmd=='quit':running=False; break
                    elif cmd=='midi':engine.midi(*args)
                    elif cmd=='set_device':engine.set_device(*args)
                    elif cmd=='drum_note':engine.drum_note(*args)
                    elif cmd=='drum_edit':engine.edit_drum_pad(*args)
                    elif cmd=='drum_import':loader.request(*args)
                    elif cmd=='select':engine.select(args)
                    elif cmd=='play':
                        if engine.playing:engine.stop()
                        else:engine.playing=True
                    elif cmd=='stop':engine.stop(); audio and audio.clear()
                    elif cmd=='panic':engine.panic(); audio and audio.clear()
                    elif cmd=='record':engine.finish_record() if engine.recording else engine.record(engine.selected)
                    elif cmd=='undo':engine.undo()
                    elif cmd=='quantize':engine.quantize(engine.selected)
                    elif cmd=='clear':engine.snapshot(); engine.stop(); engine.project.tracks[engine.selected]['notes']=[]
                    elif cmd=='device':engine.panic(); midi.close(); midi.path=args; midi.next_scan=0
                    elif cmd=='audio_device':
                        # Open the replacement first; preserve the existing working stream on failure.
                        replacement=Audio(args)
                        if replacement.rate!=engine.rate:
                            replacement.close()
                            raise RuntimeError('Unsupported audio sample rate: '+str(replacement.rate))
                        if audio:audio.close()
                        audio=replacement; started=False; underruns=0
                        send(dict(message='Audio output: '+audio.output))
                    elif cmd=='perform_set':
                        section,key,value=args
                        engine.perform_set(section,key,value)
                    elif cmd=='perform_step':
                        index,notes,replace=args
                        engine.perform_step(index,notes,replace)
                    elif cmd=='perform_action':
                        action,value=args
                        engine.perform_action(action,value)
                        send(dict(message='Performance: '+action))
                    elif cmd=='cleanup':
                        engine.cleanup(str(args)); audio and args=='all' and audio.clear()
                        send(dict(message={'effects':'Effects removed','sound':'Sound reset','mods':'Mod pads cleared',
                            'links':'All mod links removed','all':'New session. Undo brings the old one back.'}[args]))
                    elif cmd=='preset':
                        engine.apply_preset(str(args))
                    elif cmd=='parameter':
                        key,index,value=args; t=engine.project.tracks[engine.selected]
                        if key=='harmonics':t['instrument'][key][index]=max(0.,min(1.,float(value)))
                        elif key in SPECTRAL_RANGES:
                            lo,hi=SPECTRAL_RANGES[key];t['instrument'][key]=max(lo,min(hi,float(value)))
                        elif key in ('attack','decay','sustain','release','filter','modulation'):t['instrument'][key]=value
                        elif key in VOICE_RANGES:
                            lo,hi=VOICE_RANGES[key];t['instrument'][key]=max(lo,min(hi,float(value)))
                        elif key in VOICE_CHOICES:
                            if int(value) not in VOICE_CHOICES[key]:raise ValueError('Unknown choice for '+key)
                            t['instrument'][key]=int(value)
                        else:raise ValueError('Unknown sound parameter: '+str(key))
                        engine.synths[engine.selected].configure(t['instrument'])
                    elif cmd=='song':
                        try:engine.set_song(args)
                        except ValueError as exc:send(dict(error=str(exc)))
                    elif cmd=='clip':
                        try:engine.clip_action(*args)
                        except (ValueError,TypeError) as exc:send(dict(error=str(exc)))
                    elif cmd=='fx':
                        tr,chain=args
                        try:engine.set_fx(int(tr),chain)
                        except (ValueError,IndexError) as exc:send(dict(error=str(exc)))
                    elif cmd=='edit_note':
                        tr,idx,note=args; engine.snapshot(); engine.stop()
                        notes=engine.project.tracks[tr]['notes']
                        if idx is None:notes.append(note)
                        elif note is None:notes.pop(idx)
                        else:notes[idx]=note
                    elif cmd=='track':
                        tr,key,value=args; engine.project.tracks[tr][key]=value
                        if key=='mute':engine.synths[tr].panic();engine.drums[tr].panic()
                    elif cmd=='tempo':
                        # Stop before changing the beat-to-sample conversion.
                        engine.stop(); engine.project.bpm=max(30,min(240,float(args)))
                    elif cmd=='bars':engine.set_bars(int(args))
                    elif cmd=='metronome':engine.project.metronome=args
                    elif cmd=='save':engine.finish_record(); engine.project.save(args); send(dict(message='Saved '+args))
                    elif cmd=='load':
                        p=Project.load(args); engine.stop(); engine.project=p; engine.configure()
                        engine.history=[];engine.mutation_sessions.clear();send(dict(message='Opened '+args))
                    elif cmd=='export':engine.project.export_midi(args); send(dict(message='Exported '+args))
                    elif cmd=='save_preset':
                        from pathlib import Path
                        import json
                        Path(args).write_text(json.dumps(engine.project.tracks[engine.selected]['instrument'],indent=2))
                        send(dict(message='Instrument saved'))
                    elif cmd=='load_preset':
                        import json
                        # Reuse the project schema validator before installing untrusted preset data.
                        from pathlib import Path
                        import tempfile
                        p=Project(); p.tracks[0]['instrument']=json.loads(Path(args).read_text())
                        with tempfile.TemporaryDirectory() as d:
                            f=Path(d)/'validate.json'; p.save(f); p=Project.load(f)
                        engine.snapshot(); t=engine.project.tracks[engine.selected]; t['instrument']=p.tracks[0]['instrument']; t['preset']='Custom'; engine.configure()
                except Exception as exc:send(dict(error=str(exc)))
            if not running:break
            for rejection in loader.poll():send(dict(error=rejection))
            for rejection in midi.poll(engine):send(dict(error=rejection))
            if audio:
                if started and audio.queued()==0:
                    underruns+=1; target=min(2048,target+256)
                while audio.queued()<target:
                    t0=time.perf_counter(); block=engine.render(256)
                    load_peak=max(load_peak,(time.perf_counter()-t0)*audio.rate/256)
                    audio.write(block)
                    monitor_samples.extend(block[::8]); spectrum_samples.extend(block)
                if not started:audio.start(); started=True
            now=time.monotonic()
            if now-load_since>1:load_shown=load_peak; load_peak=0.; load_since=now
            if now-last_status>.1:
                last_status=now
                samples=list(monitor_samples)
                if samples:
                    n=len(samples)
                    display=[round(samples[min(n-1,i*n//96)],4) for i in range(96)]
                    rms=math.sqrt(sum(v*v for v in samples)/n)
                    peak=max(abs(v) for v in samples)
                else:
                    display=[]; rms=0.; peak=0.
                meter=dict(rms=round(rms,5),peak=round(peak,5),wave=display,
                           spectrum=[round(v,4) for v in spectrum_samples],fx=engine.fx_levels(),
                           fx_live=engine.fx_live(engine.selected))
                send(dict(state=engine.project.data(),selected=engine.selected,beat=engine.beat%engine.project.beats,
                          playing=engine.playing,recording=engine.recording,devices=midi.devices(),connected=midi.connected,
                          voices=sum(len(s.voices) for s in engine.synths)+sum(r.active_count for r in engine.drums),
                          drum_racks=engine.drum_state(),audio=audio.driver if audio else 'UNAVAILABLE',
                          audio_output=audio.output if audio else 'Unavailable',
                          audio_outputs=audio.outputs if audio else [],underruns=underruns,
                          dsp_load=round(load_shown,3),song_pos=engine.song_position(),buffer_ms=round(target/(audio.rate if audio else 48000)*1000,1),
                          meter=meter, held_notes=engine.perform_held.held(),rec_step=engine.rec_step,
                          arp_view=dict(arp_view(engine.project.performance,engine.perform_held.held(),engine.beat,engine.arp_anchor_beat),
                                        **(dict(step=-1,phase=-1) if engine.arp_paused else {}),paused=engine.arp_paused)
                          if engine.project.performance['arp']['enabled'] else None,song_beat=round(engine.beat,4)))
            time.sleep(.002)
    except Exception as exc:send(dict(error='Audio worker stopped: '+str(exc)))
    finally:
        if loader:loader.close()
        midi.close()
        if audio:audio.close()
