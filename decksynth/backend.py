"""SDL audio and Linux raw MIDI adapter, isolated from the desktop UI."""
import pickle
import array
import copy
import json as jsonlib
from collections import deque
import math
import ctypes as C
import glob
import os
import gc
import sys
import queue
import threading
import signal
import time
from .drum_loader import DrumLoader
from .drum_memory import data_directory
from .sampler_record import downmix
from .drum_library_service import DrumLibraryService
from .core import Engine, MidiParser, Project, instrument, SPECTRAL_RANGES, VOICE_RANGES, VOICE_CHOICES, FILTER_ENV, EXPRESSION_DEFAULTS, arp_view
from .keystep import StepCapacityError
from .render_jobs import RenderJob
from .session_store import Session
from .freeze import freeze_mode,freeze_modes,describe_holds,fingerprint,freeze_directory,freeze_file_name,validate_freeze,FrozenAudio

class AudioSpec(C.Structure):
    _fields_=[('freq',C.c_int),('format',C.c_ushort),('channels',C.c_ubyte),('silence',C.c_ubyte),('samples',C.c_ushort),('padding',C.c_ushort),('size',C.c_uint),('callback',C.c_void_p),('userdata',C.c_void_p)]

class Audio:
    def __init__(self, preferred='System default'):   # 25 Nov, Sir: follow the system's output by default
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
        desired=AudioSpec(freq=48000,format=0x8120,channels=2,samples=256)
        actual=AudioSpec(); self.device=s.SDL_OpenAudioDevice(selected.encode() if selected else None,0,C.byref(desired),C.byref(actual),0)
        if not self.device:
            error=self.error(); s.SDL_QuitSubSystem(0x10); raise RuntimeError(error)
        self.channels=actual.channels; self.rate=actual.freq; self.driver=s.SDL_GetCurrentAudioDriver().decode()
    def error(self):return self.lib.SDL_GetError().decode(errors='replace')
    def queued(self):return self.lib.SDL_GetQueuedAudioSize(self.device)//(4*self.channels)
    def write(self,samples):
        data=array.array('f',samples).tobytes()
        if self.lib.SDL_QueueAudio(self.device,data,len(data))!=0:raise RuntimeError(self.error())
    def start(self):self.lib.SDL_PauseAudioDevice(self.device,0)
    def clear(self):self.lib.SDL_ClearQueuedAudio(self.device)
    def close(self):
        if self.device:self.lib.SDL_CloseAudioDevice(self.device); self.device=0
        self.lib.SDL_QuitSubSystem(0x10)

def capture_inputs(audio):
    """Names of the inputs SDL can record from (the piano's USB audio, a mic, 'Monitor of ...' for resampling)."""
    s=audio.lib
    return [s.SDL_GetAudioDeviceName(i,1).decode(errors='replace') for i in range(max(0,s.SDL_GetNumAudioDevices(1)))]

def default_input(names):
    """A plugged-in instrument first (the piano's USB audio), then any real input. 'Monitor of' sources
    record the computer's own output, and the Deck's own microphone is the last choice."""
    real=[n for n in names if not n.startswith('Monitor of') and n!='Test input']
    plugged=[n for n in real if not any(w in n for w in ('Internal','Coprocessor','Built-in'))]
    if 'Test input' in names:return 'Test input'
    return next(iter(plugged+real+list(names)),None)

class Capture:
    """An SDL capture device, stereo float at the engine rate (SDL converts), mixed to mono by us
    (downmix keeps a one-sided input at full level). read() never blocks."""
    def __init__(self,audio,name,rate):
        s=self.lib=audio.lib
        s.SDL_DequeueAudio.argtypes=[C.c_uint,C.c_void_p,C.c_uint]; s.SDL_DequeueAudio.restype=C.c_uint
        s.SDL_GetAudioDeviceStatus.argtypes=[C.c_uint]; s.SDL_GetAudioDeviceStatus.restype=C.c_int
        desired=AudioSpec(freq=rate,format=0x8120,channels=2,samples=512); actual=AudioSpec()
        self.device=s.SDL_OpenAudioDevice(name.encode(),1,C.byref(desired),C.byref(actual),0)
        if not self.device:raise RuntimeError('Input not available: '+name+' ('+s.SDL_GetError().decode(errors='replace')+')')
        self.name=name; self.channels=max(1,actual.channels or 2); self.buffer=C.create_string_buffer(1<<16); s.SDL_PauseAudioDevice(self.device,0)
    def read(self):
        out=array.array('f')
        while self.device:
            n=self.lib.SDL_DequeueAudio(self.device,self.buffer,len(self.buffer))
            if n:out.frombytes(self.buffer.raw[:n-n%4])
            if n<len(self.buffer):break
        if self.channels==2:
            out=out[:len(out)-len(out)%2]; out=downmix(out[0::2],out[1::2])
        return out
    def alive(self):return bool(self.device) and self.lib.SDL_GetAudioDeviceStatus(self.device)!=0
    def close(self):
        if self.device:self.lib.SDL_CloseAudioDevice(self.device); self.device=0

class TestInput:
    """DECKSYNTH_TEST_INPUT=<wav>: plays a WAV as if it came from an input, in real time, then silence."""
    name='Test input'
    def __init__(self,engine,path):
        self.data=engine.sample_cache.load(path).data; self.rate=engine.rate; self.at=0; self.since=time.monotonic()
    def read(self):
        now=time.monotonic(); n=int((now-self.since)*self.rate); self.since+=n/self.rate
        part=array.array('f',self.data[self.at:self.at+n]); self.at+=n
        if len(part)<n:part.extend([0.]*(n-len(part)))
        return part
    def alive(self):return True
    def close(self):pass

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


def transfer_message(r):
    """Song -> Pattern in words: how long the pattern became and what snapping changed."""
    if not r:return 'Song notes captured into pattern'
    parts=['Song → Pattern: %d notes in %d steps at %s'%(r['notes'],r['length'],r['division'])]
    if r['moved']:parts.append('%d snapped to the grid'%r['moved'])
    if r['merged']:parts.append('%d doubles merged'%r['merged'])
    if r['rounded']:parts.append('%d lengths rounded'%r['rounded'])
    if r['dropped']:parts.append('%d over 8 per step left out'%r['dropped'])
    if r.get('better'):parts.append('this take fits %s: pick it and send again'%r['better'])
    return ' · '.join(parts)

def now_freeze_check(last):
    return time.monotonic()-last>.4

def reuse_freeze(path,engine,tr,mode,fp):
    """A file already rendered from exactly this track state is used again at once."""
    import json as _json
    side=path+'.json'
    try:
        with open(side) as f:meta=validate_freeze(_json.load(f))
        if meta['fingerprint']!=fp or meta['rate']!=engine.rate or meta['file']!=path:return None
        FrozenAudio(meta).close();return meta
    except (OSError,ValueError,TypeError):return None

def raise_audio_priority():
    """Ask the system to schedule the audio thread ahead of the screen, the browser and everything else.
    Returns a short sentence saying what took effect (shown in the status as 'priority').
    1. rtkit (the desktop's realtime service, running on the Deck): nice -15 for this thread. Only the high-priority
       call is used, never the realtime one: a realtime thread that keeps the CPU for 200 ms (loading a project) is killed.
    2. Without rtkit (no busctl, for instance inside a sandbox): raise the soft nice limit up to the hard one and nice by -5.
       A plain os.nice(-5) fails on the Deck because the soft limit starts at 0."""
    import shutil,subprocess,threading
    pid=os.getpid()
    try:
        before=os.getpriority(os.PRIO_PROCESS,0)
        busctl=shutil.which('busctl')
        if busctl:
            subprocess.run([busctl,'--system','call','org.freedesktop.RealtimeKit1','/org/freedesktop/RealtimeKit1','org.freedesktop.RealtimeKit1',
                            'MakeThreadHighPriorityWithPID','tti',str(pid),str(threading.get_native_id()),'--','-15'],
                           capture_output=True,timeout=2)
            now=os.getpriority(os.PRIO_PROCESS,threading.get_native_id())
            if now<before:return 'rtkit: audio thread at nice %d'%now
    except (OSError,AttributeError,subprocess.SubprocessError):pass
    try:
        import resource
        soft,hard=resource.getrlimit(resource.RLIMIT_NICE)
        if soft<hard:resource.setrlimit(resource.RLIMIT_NICE,(hard,hard))
        os.nice(-5)
        return 'nice -5 (no rtkit)'
    except (OSError,AttributeError,ImportError,ValueError):return 'normal priority (the system did not allow a higher one)'

def status_delta(status, blobs, everything=False):
    """The part of a status message that changed since the last one. blobs remembers each value as bytes.

    The project (with every note), the libraries and the kit state make up almost all of a status message
    and change only on an edit; sending them ten times a second kept the bridge and the screen busy for nothing."""
    out = {}
    for key, value in status.items():
        blob = pickle.dumps(value, 5)
        if everything or blobs.get(key) != blob:
            out[key] = value; blobs[key] = blob
    return out


class LatencyGovernor:
    """How much audio is kept queued ahead of the speakers (the latency you hear).

    It starts at the mode's floor, grows by 256 frames after each dropout and shrinks again after a quiet
    stretch, so a short spike costs a few seconds of extra delay, not the rest of the session.
    low: 256 frames (5 ms) to 1024; auto: 768 (16 ms) to 2048; safe: 1024 (21 ms) to 2048.
    Auto started at 512 and shrank back after 30 s until 24 Nov: on a busy Deck a slow block (9-12 ms measured) then
    emptied the queue about twice a minute, which can be heard as a click. It now starts one step up and waits 2 minutes."""
    MODES = {'low': (256, 1024, 20.), 'auto': (768, 2048, 120.), 'safe': (1024, 2048, 60.)}
    STEP = 256

    def __init__(self, mode='auto', now=0.):
        self.set_mode(mode, now)

    def set_mode(self, mode, now=0., ms=None, rate=48000):
        """mode 'low' | 'auto' | 'safe', or 'custom' with a fixed buffer of `ms` milliseconds (3 to 50, Settings › Audio › Latency › Custom):
        a custom buffer neither grows nor shrinks, so the number you chose is the number you get."""
        if mode == 'custom' and isinstance(ms, (int, float)) and not isinstance(ms, bool) and 3 <= ms <= 50:
            self.mode = 'custom'; self.ms = float(ms)
            frames = max(64, round(self.ms * rate / 1000))
            self.floor = self.cap = frames; self.patience = 1e9
            self.target = frames; self.last_event = now; return
        self.mode = mode if mode in self.MODES else 'auto'; self.ms = None
        self.floor, self.cap, self.patience = self.MODES[self.mode]
        self.target = self.floor; self.last_event = now

    def underrun(self, now):
        self.target = min(self.cap, self.target + self.STEP); self.last_event = now

    def tick(self, now):
        if self.target > self.floor and now - self.last_event >= self.patience:
            self.target = max(self.floor, self.target - self.STEP); self.last_event = now


AUDIO_SWITCH_INTERVAL=.0005

def parent_watchdog(parent,grace=5.,poll=.5,exit=os._exit):
    """Start a daemon thread that ends this process `grace` seconds after its parent has gone. Returns the thread."""
    def watch():
        while os.getppid()==parent:time.sleep(poll)
        time.sleep(grace);exit(0)
    thread=threading.Thread(target=watch,name='parent-watchdog',daemon=True);thread.start();return thread
def worker(commands,updates):
    # The process that started this worker (the bridge), taken first: the engine can take seconds to load.
    import multiprocessing
    parent=getattr(multiprocessing.parent_process(),'pid',None) or os.getppid()
    # If the bridge dies and this worker is handed to another parent, the main loop below stops it. A stuck shutdown would leave the
    # audio stream playing on its own (25 Nov: a worker kept crackling for 20 minutes after the window closed), so a watchdog thread
    # ends the process for good a few seconds after the parent has gone.
    parent_watchdog(parent)
    # Offline renders (WAV export, freeze) run in their own low-priority process (render_jobs.py),
    # so they never hold Python's lock while the audio is being made.
    renders={}  # 'export' or ('freeze', track) -> RenderJob
    freeze_checked=0.
    engine=Engine(); midi=MidiDevice(); audio=None; loader=None; library=None; last_status=0; underruns=0; started=False
    capture=None  # the input a Sampler records from, open while the Record sheet is
    session=None
    # Capture decimated samples from the actual synthesizer mix for the UI meter.
    # Never perform display rendering or FFT work on the audio process.
    monitor_samples=deque(maxlen=6144)
    monitor_left=deque(maxlen=6144);monitor_right=deque(maxlen=6144)
    # Full-rate tail of the mix for the UI spectrum; the FFT itself runs in the renderer.
    spectrum_samples=deque(maxlen=512)
    # What the screen is showing (sent as 'meters_watched'): levels = the LED meters, wave = the 96-point waves,
    # spectrum = the FFT tail. Nothing is built for a meter that is not on screen.
    watched={'levels','wave','spectrum'}
    def send(obj):
        try:updates.put_nowait(obj)
        except queue.Full:pass
    # Audio safety: a deeper buffer that grows after a dropout, no long garbage-collector pauses,
    # and a higher priority when the system allows it. dsp_load is the worst render time per block
    # over the last second, as a share of the block's own length (over 100 % means a dropout).
    status_blobs={}; last_full=0.
    latency=LatencyGovernor('auto',time.monotonic()); load_peak=0.; load_shown=0.; load_since=time.monotonic()
    priority=raise_audio_priority()
    try:
        try:audio=Audio(); engine=Engine(audio.rate); engine.keep_tracks(1); engine.factory_sounds()  # a new session: 1 track
        except Exception as exc:send(dict(error='Audio unavailable: '+str(exc)))
        library=DrumLibraryService(engine,data_directory(),grow=False)  # the remembered kit fills track 1 only
        if not library.snapshot()['root']:
            demo_root=os.environ.get('DECKSYNTH_DEMO_KITS_DIR')
            if demo_root and os.path.isdir(demo_root):
                library.set_root(demo_root)
        engine.chop_directory=data_directory()
        from .sample_library import SampleLibrary
        sample_lib=engine.sample_library=SampleLibrary(data_directory(),engine.rate);sample_lib.scan()
        loader=DrumLoader(engine)
        # Autosave and recovery (25 Nov): engine-side, so they work with the window dead (session_store.py).
        session=Session()
        opened=session.start()
        if opened is not None:
            try:
                engine.replace_project(Project.load(opened))
                send(dict(message='Opened your last session'+(' (Decksynth did not close properly last time)' if session.crashed else '')))
            except Exception as exc:
                send(dict(error='Could not open the last session (%s); it is kept as %s'%(exc,session.recovered.name if session.recovered else 'the autosave')))
        elif session.crashed and session.recovered is not None:
            send(dict(message='Decksynth did not close properly last time; that session is kept as '+session.recovered.name))
        try:signal.signal(signal.SIGUSR1,lambda *_:setattr(session,'rescue',True))   # tools/save-now.sh
        except (ValueError,OSError,AttributeError):pass
        gc.collect(); gc.freeze(); gc.set_threshold(50000,50,1000)
        # The audio loop and the background jobs (WAV load, chop, library scan) share Python's lock. A busy job
        # thread keeps it for up to the switch interval (5 ms by default) each time the audio wants it back: 0.5 ms
        # keeps a block inside its time even while a job runs (tools/bench/gil.py).
        sys.setswitchinterval(AUDIO_SWITCH_INTERVAL)
        running=True
        # The worker belongs to the process that started it (the bridge). If that one dies without saying
        # quit (the app was killed), the worker is handed to another parent: stop then, so nothing keeps playing.
        parent_checked=time.monotonic()
        while running:
            now_check=time.monotonic()
            if now_check-parent_checked>.25:
                parent_checked=now_check
                if os.getppid()!=parent:running=False;break
            handled=False
            for _ in range(128):
                try:cmd,args=commands.get_nowait()
                except queue.Empty:break
                handled=True
                try:
                    if cmd=='quit':running=False; break
                    elif cmd=='midi':engine.midi(*args)
                    elif cmd=='sound_gesture':engine.sound_gesture(*args)
                    elif cmd=='sound_undo':engine.sound_undo(args)
                    elif cmd=='sound_ab':engine.ab_action(*args)
                    elif cmd=='meters_watched':
                        if not isinstance(args,list) or any(a not in ('levels','wave','spectrum') for a in args):raise ValueError('Invalid meters list')
                        watched.clear();watched.update(args)
                        if 'spectrum' not in watched:spectrum_samples.clear()
                        if not watched&{'levels','wave'}:monitor_samples.clear();monitor_left.clear();monitor_right.clear()
                    elif cmd=='automation_arm':
                        if type(args) is not bool:raise ValueError('Invalid automation arm')
                        engine.automation_arm=args
                    elif cmd=='automation':engine.set_automation(*args)
                    elif cmd=='learn_cc':engine.learn_cc(*args)
                    elif cmd=='unlearn_cc':engine.unlearn_cc(*args)
                    elif cmd=='cancel_cc_learn':engine.midi_learn=None
                    elif cmd=='set_device':engine.set_device(*args)
                    elif cmd=='drum_note':engine.drum_note(*args)
                    elif cmd=='drum_edit':engine.edit_drum_pad(*args)
                    elif cmd=='drum_draft':engine.drum_draft(*args)
                    elif cmd=='drum_crop':engine.crop_drum_pad(*args)
                    elif cmd=='drum_export':engine.export_drum_kit(*args,root=library.snapshot()['root'],done=library.refresh)
                    elif cmd=='drum_clear':
                        if engine.clear_drum_pad(*args):send(dict(message='Pad %d cleared. Undo brings it back.'%(int(args[2])+1)))
                    elif cmd=='sampler_make':
                        # A pad without a root has its pitch found in the background; the message comes from the poll.
                        note=engine.make_sampler_later(*args)
                        if note:send(dict(message=note))
                    elif cmd=='sampler_edit':engine.edit_sampler(*args)
                    elif cmd=='sampler_recipe':
                        try:engine.apply_recipe(*args)
                        except (ValueError,TypeError) as exc:send(dict(error=str(exc)))
                    elif cmd=='sampler_live':engine.preview_sampler(*args)
                    elif cmd=='sampler_detect':
                        engine.detect_sampler_root_later(*args)  # in the background; the message comes from the poll
                    elif cmd=='drum_import':loader.request(*args)
                    elif cmd=='sampler_load_wav':engine.load_sampler_wav(*args)
                    elif cmd=='sampler_clear':engine.clear_sampler(*args)
                    elif cmd=='add_track':engine.add_track()
                    elif cmd=='sample_save':
                        engine.save_sample_to_library(*args)
                    elif cmd=='sample_library_folder':
                        role,folder=args
                        if role=='save':sample_lib.set_save_folder(folder)
                        elif role=='add':sample_lib.add_load_folder(folder)
                        elif role=='remove':sample_lib.remove_load_folder(folder)
                        else:raise ValueError('Unknown library folder action')
                    elif cmd=='sample_library_scan':sample_lib.scan()
                    elif cmd=='sample_library_browse':sample_lib.browse(*args)
                    elif cmd=='sample_library_preview':sample_lib.preview(args)
                    elif cmd=='sample_library_stop':sample_lib.stop_preview();engine.stop_sample_preview()
                    elif cmd=='sample_library_load':
                        track,sampler_id,path=args
                        if not sample_lib.contains(path):raise ValueError('That sample is not in the library')
                        engine.load_sampler_wav(track,sampler_id,path)
                    elif cmd=='remove_track':
                        if any(k[0]=='freeze' for k in renders if isinstance(k,tuple)):raise ValueError('Wait until the freeze finishes')
                        engine.remove_track(args)
                    elif cmd=='sampler_chop':engine.chop_sampler(*args)
                    elif cmd=='sampler_view':engine.sampler_view(*args)
                    elif cmd=='sampler_audition':engine.audition_slice(*args)
                    elif cmd=='sampler_audition_stop':engine.stop_sample_preview()
                    elif cmd=='sampler_send':engine.slices_to_pads(*args)
                    elif cmd=='sampler_inputs':
                        engine.record_inputs=(['Test input'] if os.environ.get('DECKSYNTH_TEST_INPUT') else [])+(capture_inputs(audio) if audio else [])
                    elif cmd=='sampler_record':
                        action,*rest=args if isinstance(args,list) and args else [None]
                        if action=='open':
                            # Open the chosen input (or the first real one) so its level shows before arming.
                            engine.record_inputs=(['Test input'] if os.environ.get('DECKSYNTH_TEST_INPUT') else [])+(capture_inputs(audio) if audio else [])
                            name=rest[0] if rest and rest[0] else engine.record_input or default_input(engine.record_inputs)
                            if name not in engine.record_inputs:raise ValueError('No input found: plug in the piano or a USB audio interface' if not engine.record_inputs else 'Input not available: '+str(name))
                            if capture is None or capture.name!=name:
                                engine.sampler_record('cancel')
                                if capture:capture.close(); capture=None; engine.record_input=None
                                capture=TestInput(engine,os.environ['DECKSYNTH_TEST_INPUT']) if name=='Test input' else Capture(audio,name,engine.rate)
                            engine.record_input=name; engine.record_error=None
                        elif action=='close':
                            if engine.recorder is not None and engine.recorder.state=='recording':engine.sampler_record('stop')
                            else:engine.sampler_record('cancel')
                            if engine.live_track is None:   # Live input keeps listening
                                if capture:capture.close()
                                capture=None; engine.record_input=None
                        else:engine.sampler_record(action,*rest)
                    elif cmd=='sampler_hold':
                        track=args[0]
                        if type(track) is not int or not 0<=track<len(engine.samplers):raise ValueError('Invalid track')
                        engine.samplers[track].set_hold(bool(args[1]))
                    elif cmd=='sampler_live_input':
                        track,sid,action=args[0],args[1],args[2]
                        if action=='on':
                            engine.record_inputs=(['Test input'] if os.environ.get('DECKSYNTH_TEST_INPUT') else [])+(capture_inputs(audio) if audio else [])
                            name=engine.record_input or default_input(engine.record_inputs)
                            if name not in engine.record_inputs:raise ValueError('No input found: plug in the piano or a USB audio interface')
                            if capture is None or capture.name!=name:
                                if capture:capture.close(); capture=None
                                capture=TestInput(engine,os.environ['DECKSYNTH_TEST_INPUT']) if name=='Test input' else Capture(audio,name,engine.rate)
                            engine.record_input=name; engine.record_error=None
                        engine.sampler_live(track,sid,action)
                        if action=='off' and capture and (engine.recorder is None or engine.recorder.state=='idle'):
                            capture.close(); capture=None; engine.record_input=None
                    elif cmd=='sampler_slice_roots':engine.detect_slice_roots(*args)
                    elif cmd=='drum_library_root':library.set_root(args)
                    elif cmd=='drum_library_refresh':library.refresh()
                    elif cmd=='drum_load_folder':library.load_folder(*args)
                    elif cmd=='drum_list_samples':library.browse_folder(*args)
                    elif cmd=='drum_preview_sample':library.preview_sample(*args)
                    elif cmd=='drum_preview_stop':library.stop_preview()
                    elif cmd=='drum_replace_sample':
                        tr,kit_id,pad,folder_id,index=args
                        source=library.sample_path(folder_id,index)
                        library.stop_preview()  # do not overlap the audition with the replacement
                        loader.request(tr,kit_id,pad,str(source),name=source.stem[:80])
                    elif cmd=='select':engine.select(args)
                    elif cmd=='play':
                        if engine.playing:engine.stop()
                        else:engine.playing=True
                    elif cmd=='play_from':engine.play_from(args)
                    elif cmd=='stop':engine.stop(); audio and audio.clear()
                    elif cmd=='panic':engine.panic(); audio and audio.clear()
                    elif cmd=='record':engine.record_button()
                    elif cmd=='record_options':engine.set_record_options(*args)
                    elif cmd=='preset_options':engine.set_preset_options(*args)
                    elif cmd=='audio_latency':
                        a=list(args) if isinstance(args,(list,tuple)) else [args]
                        latency.set_mode(a[0] if a else 'auto',time.monotonic(),a[1] if len(a)>1 else None,audio.rate if audio else 48000)
                    elif cmd=='undo':engine.undo_any()
                    elif cmd=='redo':engine.redo()
                    elif cmd=='quantize':engine.quantize(engine.selected)
                    elif cmd=='clear':engine.snapshot(); engine.stop(); engine.project.tracks[engine.selected]['notes']=[]
                    elif cmd=='device':engine.panic(); midi.close(); midi.path=args; midi.next_scan=0
                    elif cmd=='audio_device':
                        # Open the replacement first; preserve the existing working stream on failure.
                        try:replacement=Audio(args)
                        except RuntimeError as error:
                            # Some SDL drivers (the dummy driver, single-device backends) allow one open
                            # device only: close the current stream, then open the new one, and fall back
                            # to the old output if that fails.
                            if not audio or 'already open' not in str(error):raise
                            previous=audio.output; audio.close(); audio=None; started=False
                            try:replacement=Audio(args)
                            except Exception:
                                audio=Audio(previous); raise
                        if replacement.rate!=engine.rate:
                            replacement.close()
                            if not audio:audio=Audio(previous)
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
                        if not isinstance(args,list) or len(args) not in (2,3):raise ValueError('Invalid performance action')
                        engine.perform_action(*args)
                        action=args[0]
                        message={'clear':'Pattern cleared','double':'Pattern doubled','nudge':'Pattern nudged',
                            'octave':'Pattern moved an octave','mutate':'Pattern mutated','reset_mutate':'Pattern back to before mutate',
                            'arp_to_seq':'Arp copied to the sequencer','paste_pattern':'Pattern pasted',
                            'load_factory':'Pattern bank loaded','learn_chord':'Chord learned'}.get(action)
                        if action=='capture_song':message=transfer_message(engine.transfer_report)
                        elif action=='commit_song':
                            message={'add':'Pattern added to open Song clip','replace':'Open Song clip replaced with pattern',
                                'fill':'Open Song clip filled with pattern'}.get(args[1],'Pattern sent to open Song clip')
                        if message:send(dict(message=message))
                    elif cmd=='cleanup':
                        engine.cleanup(str(args)); audio and args=='all' and audio.clear()
                        send(dict(message={'effects':'Effects removed','sound':'Sound reset','mods':'Mod pads cleared',
                            'links':'All mod links removed','all':'New session. Undo brings the old one back.'}[args]))
                    elif cmd=='preset':
                        engine.apply_preset(str(args))
                    elif cmd=='parameter':
                        key,index,value=args[:3]
                        if len(args)>3 and (type(args[3]) is not int or args[3]!=engine.selected):
                            raise ValueError('Track changed; parameter edit cancelled')
                        t=engine.project.tracks[engine.selected]
                        if key=='harmonics':t['instrument'][key][index]=max(0.,min(1.,float(value)))
                        elif key in SPECTRAL_RANGES:
                            if key=='character' and (type(value) not in (int,float) or not math.isfinite(value)):
                                raise ValueError('Character must be a finite number')
                            lo,hi=SPECTRAL_RANGES[key];t['instrument'][key]=max(lo,min(hi,float(value)))
                        elif key in ('attack','decay','sustain','release','filter','modulation'):t['instrument'][key]=value
                        elif key in VOICE_RANGES:
                            if key in FILTER_ENV or key=='vcf_morph' or key in EXPRESSION_DEFAULTS:
                                if type(value) not in (int,float) or not math.isfinite(value):
                                    raise ValueError('Filter parameter must be a finite number')
                            lo,hi=VOICE_RANGES[key];value=max(lo,min(hi,float(value)))
                            if key in FILTER_ENV:
                                for field,amp in FILTER_ENV.items():t['instrument'].setdefault(field,t['instrument'][amp])
                            t['instrument'][key]=value
                        elif key in VOICE_CHOICES:
                            if key=='play_mode' and type(value) is not int:raise ValueError('Unknown voice mode')
                            if int(value) not in VOICE_CHOICES[key]:raise ValueError('Unknown choice for '+key)
                            t['instrument'][key]=int(value)
                        else:raise ValueError('Unknown sound parameter: '+str(key))
                        engine.synths[engine.selected].configure(t['instrument'])
                        engine.record_control(engine.selected,'sound',key,t['instrument'][key])
                    elif cmd=='layer_file':
                        try:engine.set_layer_file(*args)
                        except (ValueError,TypeError) as exc:send(dict(error=str(exc)))
                    elif cmd=='layer_partials':
                        try:send(dict(message=engine.layer_to_partials(args)))
                        except (ValueError,TypeError) as exc:send(dict(error=str(exc)))
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
                    elif cmd=='fx_reorder':
                        tr,order=args
                        try:engine.reorder_fx(tr,order)
                        except (ValueError,TypeError) as exc:send(dict(error=str(exc)))
                    elif cmd=='spectral_seed':
                        tr,name=args
                        try:engine.seed_spectral(tr,name)
                        except (ValueError,TypeError) as exc:send(dict(error=str(exc)))
                    elif cmd=='editor_note':engine.editor_note(*args)
                    elif cmd=='note_edit':engine.note_edit(*args)
                    elif cmd=='catalog_action':engine.catalog_action(*args)
                    elif cmd=='structure_add':
                        key=engine.structure_add(*args)
                        send(dict(message='Added to the structure as pattern '+key.replace(':','·')+'. Undo takes it out.'))
                    elif cmd=='structure_load':
                        keys=engine.structure_load(*args)
                        send(dict(message='Structure loaded into patterns '+keys[0].replace(':','·')+' to '+keys[-1].replace(':','·')+'. Undo takes it out.'))
                    elif cmd=='structure_set':engine.structure_set(*args)
                    elif cmd=='structure_part_length':
                        key,steps=engine.structure_part_length(*args)
                        send(dict(message='Part %s to pattern %s: %d steps. Undo takes it back.'%('halved' if args[2]==.5 else 'doubled',key.replace(':','·'),steps)))
                    elif cmd=='structure_merge':
                        key,length=engine.structure_merge()
                        send(dict(message='Structure merged into pattern %s: %d steps. Undo takes it out.'%(key.replace(':','·'),length)))
                    elif cmd=='structure_extend':
                        first,last,bars=engine.structure_extend()
                        send(dict(message='Structure added to the open clip on bars %d to %d (clip is now %d bars). Undo takes it out.'%(first,last,bars)))
                    elif cmd=='edit_note':
                        tr,idx,note=args; engine.snapshot(); engine.stop()
                        notes=engine.project.tracks[tr]['notes']
                        if idx is None:notes.append(note)
                        elif note is None:notes.pop(idx)
                        else:notes[idx]=note
                    elif cmd=='track':
                        tr,key,value=args; engine.project.tracks[tr][key]=value
                        if key=='volume':engine.record_control(tr,'sound','volume',value)
                        if key=='mute':engine.synths[tr].panic();engine.drums[tr].panic();engine.samplers[tr].panic()
                    elif cmd=='send':
                        try:engine.set_send(*args)
                        except (ValueError,TypeError) as exc:send(dict(error=str(exc)))
                    elif cmd=='send_setting':
                        try:engine.set_send_setting(*args)
                        except (ValueError,TypeError) as exc:send(dict(error=str(exc)))
                    elif cmd=='tempo':
                        # Stop before changing the beat-to-sample conversion.
                        engine.stop(); engine.project.bpm=max(30,min(240,float(args)))
                    elif cmd=='bars':engine.set_bars(int(args))
                    elif cmd=='metronome':engine.project.metronome=args
                    elif cmd=='save':engine.finish_record(); engine.project.save(args); send(dict(message='Saved '+args))
                    elif cmd=='load':
                        p=Project.load(args);engine.replace_project(p)
                        send(dict(message='Opened '+args))
                    elif cmd=='export_wav':
                        if 'export' in renders:raise ValueError('A WAV export is already running')
                        renders['export']=RenderJob('export_wav',engine.project.data(),engine.rate,str(args))
                    elif cmd=='export_loop':
                        # [path, track or None (whole mix), 'pass'|'tail'|'loop', headroom]
                        if 'export' in renders:raise ValueError('A WAV export is already running')
                        path,tr,kind,headroom=args
                        if tr is not None and not 0<=int(tr)<len(engine.project.tracks):raise ValueError('Choose track 1–%d'%len(engine.project.tracks))
                        if kind not in ('pass','tail','loop'):raise ValueError('Choose one pass, with tail or seamless loop')
                        engine.finish_record()
                        renders['export']=RenderJob('export_loop',engine.project.data(),engine.rate,str(path),track=None if tr is None else int(tr),
                                                    meta=dict(opts=dict(kind=kind,headroom=bool(headroom))))
                    elif cmd=='session':session.set(args)
                    elif cmd=='to_grain':
                        # Synth pattern -> Grain (25 Nov): bounce this track's loop (seamless, -6 dB headroom) and play it as Grain on a new track.
                        tr=args[0] if isinstance(args,list) else args
                        if type(tr) is not int or not 0<=tr<len(engine.project.tracks):raise ValueError('Choose track 1–%d'%len(engine.project.tracks))
                        if ('grain',tr) in renders:raise ValueError('Track %d is already on its way to Grain'%(tr+1))
                        from .devices import MAX_TRACKS
                        if len(engine.project.tracks)>=MAX_TRACKS:raise ValueError('%d tracks is the most: remove one to make room for the Grain track'%MAX_TRACKS)
                        engine.finish_record()
                        import re as _re,time as _time
                        folder=data_directory()/'bounces';folder.mkdir(parents=True,exist_ok=True)
                        label=engine.project.tracks[tr].get('name') or 'Track %d'%(tr+1)
                        path=folder/('%s %s.wav'%(_re.sub(r'[^A-Za-z0-9 _-]+','',label).strip()[:40] or 'Track',_time.strftime('%Y-%m-%d %H%M%S')))
                        renders[('grain',tr)]=RenderJob('export_loop',engine.project.data(),engine.rate,str(path),track=tr,
                                                         meta=dict(opts=dict(kind='loop',headroom=True),name=label))
                        send(dict(message='Bouncing %s for Grain…'%label))
                    elif cmd=='freeze':
                        tr=int(args)
                        if not 0<=tr<len(engine.project.tracks):raise ValueError('Choose track 1–%d'%len(engine.project.tracks))
                        if ('freeze',tr) in renders:raise ValueError('Track %d is already freezing'%(tr+1))
                        engine.finish_record()
                        # Freeze holds the whole Song timeline and the Loop, whichever page or mode you are on.
                        folder=freeze_directory();folder.mkdir(parents=True,exist_ok=True)
                        ready=[];todo=[]
                        for mode in freeze_modes(engine.project,tr):
                            fp=fingerprint(engine.project,tr,mode);path=str((folder/freeze_file_name(tr,fp)).resolve())
                            meta=reuse_freeze(path,engine,tr,mode,fp)
                            if meta:ready.append(meta)
                            else:todo.append((mode,fp,path))
                        if not todo:engine.set_freeze(tr,ready);send(dict(message='Track %d frozen: %s'%(tr+1,describe_holds(ready))))
                        else:renders[('freeze',tr)]=RenderJob('freeze',engine.project.data(),engine.rate,[p for _,_,p in todo],track=tr,
                                                             meta=dict(modes=[m for m,_,_ in todo],fingerprints=[f for _,f,_ in todo],ready=ready))
                    elif cmd=='unfreeze':
                        tr=int(args)
                        job=renders.get(('freeze',tr))
                        if job:job.cancel();send(dict(message='Freeze cancelled'))  # dropped once the process has ended
                        elif engine.project.tracks[tr].get('freeze') or engine.project.tracks[tr].get('freeze_loop'):engine.set_freeze(tr,None);send(dict(message='Track %d plays live again'%(tr+1)))
                    elif cmd=='export':engine.project.export_midi(args); send(dict(message='Exported '+args))
                    elif cmd=='midi_channels':
                        from .midi_import import midi_channels
                        send(dict(midi_file=dict(path=str(args),channels=midi_channels(args))))
                    elif cmd=='import_midi':
                        path,chans=(args[0],args[1]) if isinstance(args,list) else (args,None)
                        count,bars,dropped=engine.import_midi(path,chans)
                        send(dict(message='Imported %d notes into %s (%d bars)%s'%(count,engine.project.tracks[engine.selected]['name'],bars,', %d past bar 32 left out'%dropped if dropped else '')))
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
            library.poll()
            heard=sample_lib.poll()
            if heard is not None:library.stop_preview();engine.play_sample_preview(heard)
            for key,job in list(renders.items()):
                if not job.poll():continue
                renders.pop(key)
                if key=='export':
                    if job.kind=='export_loop' and job.result:
                        r=job.result;send(dict(message='Loop exported: %s beats, %s'%(('%g'%r['beats']),r['path'].rsplit('/',1)[-1])))
                    else:send(dict(message='Stereo WAV exported') if job.result else dict(error='WAV export failed: '+job.error))
                elif key[0]=='grain':
                    if job.result:
                        try:
                            made=engine.grain_from_bounce(key[1],job.result['path'],job.meta.get('name'))
                            send(dict(message='%s plays as Grain on track %d'%(job.meta.get('name'),made+1)))
                        except (ValueError,TypeError) as exc:send(dict(error='Grain: '+str(exc)))
                    else:
                        err=job.error or ''
                        send(dict(error='Nothing to bounce: the loop of %s is silent. Put the pattern in its clip first (Pattern → Song)'%job.meta.get('name') if 'silent' in err else 'Grain bounce failed: '+err))
                elif job.error=='cancelled':pass
                elif job.result is None:send(dict(error='Freeze failed: '+job.error))
                else:
                    tr=key[1]
                    try:
                        made=[dict(m,fingerprint=f) for m,f in zip(job.result,job.meta['fingerprints'])]
                        metas=job.meta['ready']+made
                        engine.set_freeze(tr,metas);send(dict(message='Track %d frozen: %s'%(tr+1,describe_holds(metas))))
                        for meta in made:
                            with open(meta["file"]+".json","w") as side:jsonlib.dump(meta,side)
                    except (ValueError,TypeError) as exc:send(dict(error='Freeze failed: '+str(exc)))
            wrote=session.tick(engine.project)
            if wrote is not None and wrote.name.startswith('Saved now'):send(dict(message='Saved '+str(wrote)))
            if handled or now_freeze_check(freeze_checked):
                freeze_checked=time.monotonic();engine.freeze_refresh()
            for rejection in loader.poll():send(dict(error=rejection))
            for note in engine.poll_sampler_tasks():send(note)
            if capture is not None:
                try:
                    block=capture.read()
                    if not capture.alive():raise RuntimeError('The input went away')
                    for i in range(0,len(block),1024):engine.record_feed(block[i:i+1024])
                except Exception as exc:
                    capture.close(); capture=None; engine.record_input=None
                    try:engine.record_lost(str(exc))
                    except Exception as inner:send(dict(error='Recording not saved: '+str(inner)))
            for rejection in midi.poll(engine):send(dict(error=rejection))
            if audio:
                if started and audio.queued()==0:
                    underruns+=1; latency.underrun(time.monotonic())
                else:latency.tick(time.monotonic())
                # Rendering stops topping up after 20 ms, so an engine that can't keep up (a block slower than real time) still
                # gets back to its commands: Panic and Stop are read between blocks, never stuck behind a queue that never fills.
                fill_until=time.perf_counter()+.02
                while audio.queued()<latency.target and time.perf_counter()<fill_until:
                    # Keys are read before every block, so a key never waits for the whole queue to be topped up.
                    for rejection in midi.poll(engine):send(dict(error=rejection))
                    t0=time.perf_counter(); block=engine.render_stereo(256)
                    load_peak=max(load_peak,(time.perf_counter()-t0)*audio.rate/256)
                    audio.write(block)
                    if watched:
                        left=block[::2];right=block[1::2];mono=[l+r for l,r in zip(left,right)]
                        if 'levels' in watched or 'wave' in watched:monitor_left.extend(left);monitor_right.extend(right);monitor_samples.extend(mono)
                        if 'spectrum' in watched:spectrum_samples.extend(mono)
                if not started:audio.start(); started=True
            now=time.monotonic()
            if now-load_since>1:load_shown=load_peak; load_peak=0.; load_since=now
            if now-last_status>.1:
                last_status=now
                library.observe()
                samples=list(monitor_samples)
                want_wave='wave' in watched
                if samples:
                    n=len(samples)
                    display=[round(samples[min(n-1,i*n//96)],4) for i in range(96)] if want_wave else []
                    rms=math.sqrt(sum(v*v for v in samples)/n)
                    peak=max(abs(v) for v in samples)
                else:
                    display=[]; rms=0.; peak=0.
                def channel(values):
                    a=list(values);n=len(a)
                    return dict(rms=round(math.sqrt(sum(x*x for x in a)/n),5) if n else 0.,peak=round(max(map(abs,a),default=0.),5),wave=[round(a[min(n-1,i*n//96)],4) for i in range(96)] if n and want_wave else [])
                stereo=[channel(monitor_left),channel(monitor_right)]
                meter=dict(channels=stereo,rms=round(rms,5),peak=round(peak,5),wave=display,
                           spectrum=[round(v,4) for v in spectrum_samples],fx=engine.fx_levels(),
                           fx_live=engine.fx_live(engine.selected))
                freezes=engine.freeze_status()
                for key,job in renders.items():
                    if key!='export' and key[0]=='freeze':freezes[key[1]].update(state='rendering',progress=round(job.progress,3))
                status=dict(session=session.status(),to_grain={key[1]:round(job.progress,3) for key,job in renders.items() if key!='export' and key[0]=='grain'},freeze=freezes,exporting=round(renders['export'].progress,3) if 'export' in renders else None,
                          pattern_library=engine.pattern_library_status(),state=engine.project.data(),selected=engine.selected,midi_learn=engine.midi_learn,sound_undo=engine.sound_undo_counts(),can_redo=bool(engine.redo_history),automation_arm=engine.automation_arm,beat=engine.beat%engine.project.beats,
                          playing=engine.playing,recording=engine.recording,count_in=engine.count_state(),layer=engine.layer_state(),devices=midi.devices(),connected=midi.connected,
                          voices=sum(len(s.voices) for s in engine.synths)+sum(r.active_count for r in engine.drums)+sum(s.active_count for s in engine.samplers),
                          drum_racks=engine.drum_state(),samplers=engine.sampler_state(),sample_library=dict(sample_lib.snapshot(),preview=sample_lib.playing if engine.sample_preview_active() else None),sampler_record=engine.record_state(),drum_library=library.snapshot(),audio=audio.driver if audio else 'UNAVAILABLE',
                          audio_output=audio.output if audio else 'Unavailable',audio_channels=audio.channels if audio else 0,
                          audio_outputs=audio.outputs if audio else [],underruns=underruns,
                          dsp_load=round(load_shown,3),priority=priority,song_pos=engine.song_position(),buffer_ms=round(latency.target/(audio.rate if audio else 48000)*1000,1),latency_mode=latency.mode,latency_ms=latency.ms,
                          meter=meter, held_notes=engine.perform_held.held(),rec_step=engine.rec_step,chord_step=engine.chord_step,chord_now=engine.chord_now,
                          arp_view=dict(arp_view(engine.project.performance,engine.perform_held.held(),engine.beat,engine.arp_anchor_beat),
                                        **(dict(step=-1,phase=-1) if engine.arp_paused else {}),paused=engine.arp_paused)
                          if engine.project.performance['arp']['enabled'] else None,song_beat=round(engine.beat,4))
                # Only what changed is sent (the project, libraries and kits rarely do); the screen merges it into
                # what it has. A full copy goes out every 2 s and on the first tick, so nothing can drift.
                full_due=now-last_full>2. or not status_blobs
                if full_due:last_full=now
                delta=status_delta(status,status_blobs,full_due)
                if delta:send(delta)
            time.sleep(.002)
    except Exception as exc:
        rescued=session.save_recovery(engine.project) if session is not None and engine is not None else None
        session=None   # a crash keeps the running mark, so the next launch says so
        send(dict(error='Audio worker stopped: '+str(exc)+('; your session is saved as '+str(rescued) if rescued else '')))
    finally:
        if session is not None and engine is not None:session.stop(engine.project)
        for job in renders.values():job.cancel()
        if library:library.close()
        if engine is not None and getattr(engine,'sample_library',None):engine.sample_library.close()
        if loader:loader.close()
        if capture:capture.close()
        if engine is not None and hasattr(engine,'sampler_tasks'):engine.sampler_tasks.close()
        midi.close()
        if audio:audio.close()
