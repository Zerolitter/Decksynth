"""Device-independent synthesis, MIDI and song model. Timing is in quarter-note beats."""
import copy
from collections import deque
import json
import math
import os
from pathlib import Path
import struct
from .keystep import (defaults as performance_defaults, validate_state as validate_performance,
                      current_pattern, empty_pattern, slot_key, step_change, change_pattern_length,
                      mutate_pattern, song_from_pattern, pattern_from_song, chord_notes,
                      velocity_transform, HeldNotes, schedule_notes, arp_groups, DIVISIONS,
                      reconcile_pattern_timing)

PRESETS = {
    'Atmospheric Pad': ([1,.4,.25,.14,.12,.08,.06,.05,.04,.03,.02,.02,.01,.01,0,0], .7,.8,.75,1.8,.65,.25),
    'Warm Keys': ([1,.5,.22,.12,.08,.04,.02,.01,0,0,0,0,0,0,0,0], .008,.6,.35,.5,.85,.08),
    'Bell': ([1,0,.55,0,.3,0,.12,.08,0,.04,0,0,.02,0,0,0], .002,1.6,.05,1.3,1.,.12),
    'Bass': ([1,.45,.22,.1,.06,.02,0,0,0,0,0,0,0,0,0,0], .004,.2,.65,.15,.35,0),
    'Evolving Texture': ([1,.2,.5,.1,.3,.08,.18,.06,.1,.04,.06,.02,.04,.02,.01,0], 1.2,.8,.7,2.,.7,.7),
}

def instrument(name):
    h,a,d,s,r,f,m=PRESETS[name]
    return dict(harmonics=h[:],attack=a,decay=d,sustain=s,release=r,filter=f,modulation=m)

class Project:
    def __init__(self):
        self.bpm=120; self.bars=4; self.metronome=False
        self.tracks=[dict(name=f'Track {i+1}',preset=n,instrument=instrument(n),volume=.7,mute=False,notes=[])
                     for i,n in enumerate(['Warm Keys','Bass','Atmospheric Pad','Bell'])]
        self.performance=performance_defaults()
    @property
    def beats(self): return self.bars*4
    def data(self): return dict(version=1,bpm=self.bpm,bars=self.bars,metronome=self.metronome,
                                 tracks=self.tracks,performance=self.performance)
    def save(self,path):
        path=Path(path); temp=path.with_suffix(path.suffix+'.tmp')
        with temp.open('w') as f:
            json.dump(self.data(),f,indent=2,allow_nan=False); f.flush(); os.fsync(f.fileno())
        os.replace(temp,path)
    @classmethod
    def load(cls,path):
        try:
            d=json.loads(Path(path).read_text()); p=cls()
            assert d['version']==1 and 30<=d['bpm']<=240 and d['bars'] in (1,2,4,8)
            assert isinstance(d['metronome'],bool) and len(d['tracks'])==4
            for t in d['tracks']:
                assert isinstance(t['name'],str) and len(t['name'])<=100
                assert isinstance(t['preset'],str) and 0<=t['volume']<=1 and isinstance(t['mute'],bool)
                ins=t['instrument']; assert len(ins['harmonics'])==16
                assert all(isinstance(x,(int,float)) and math.isfinite(x) and 0<=x<=1 for x in ins['harmonics'])
                for k,lo,hi in [('attack',.001,3),('decay',.001,3),('sustain',0,1),('release',.01,3),('filter',.02,1),('modulation',0,1)]:
                    assert math.isfinite(ins[k]) and lo<=ins[k]<=hi
                assert len(t['notes'])<=100000
                for n in t['notes']:
                    assert 0<=n['start']<d['bars']*4 and 0<n['duration']<=d['bars']*4
                    assert math.isfinite(n['start']) and math.isfinite(n['duration'])
                    assert isinstance(n['note'],int) and 0<=n['note']<=127
                    assert isinstance(n['velocity'],int) and 1<=n['velocity']<=127
            p.bpm=d['bpm']; p.bars=d['bars']; p.metronome=d['metronome']; p.tracks=d['tracks']
            p.performance=validate_performance(d['performance']) if 'performance' in d else performance_defaults()
            reconcile_pattern_timing(p.performance,preserve_chain=True)
            p.performance=validate_performance(p.performance)
            # Recording-arm is a live safety state; never resume armed after reopening a file.
            p.performance['seq']['recording']=False
            return p
        except (KeyError,TypeError,AssertionError,ValueError,OverflowError) as exc:
            raise ValueError('Invalid or unsupported DeckSynth project') from exc
    def quantize(self,track):
        for n in self.tracks[track]['notes']:
            n['start']=(round(n['start']*4)/4)%self.beats
            n['duration']=min(self.beats,max(.25,round(n['duration']*4)/4))
    def export_midi(self,path):
        def vlq(n):
            out=[n&127]; n>>=7
            while n: out.insert(0,(n&127)|128); n>>=7
            return bytes(out)
        def chunk(events):
            out=b''; prev=0
            for tick,priority,msg in sorted(events):
                out+=vlq(tick-prev)+msg; prev=tick
            out+=b'\0\xff\x2f\0'; return b'MTrk'+struct.pack('>I',len(out))+out
        tempo=round(60000000/self.bpm)
        out=b'MThd'+struct.pack('>IHHH',6,1,5,480)
        out+=chunk([(0,0,b'\xff\x51\x03'+tempo.to_bytes(3,'big')),(0,1,b'\xff\x58\x04\x04\x02\x18\x08')])
        for ch,t in enumerate(self.tracks):
            name=t['name'].encode()[:100]; events=[(0,-1,b'\xff\x03'+vlq(len(name))+name)]
            for n in t['notes']:
                start=round(n['start']*480); end=start+max(1,round(n['duration']*480))
                events.extend([(start,1,bytes([0x90|ch,n['note'],n['velocity']])),(end,0,bytes([0x80|ch,n['note'],0]))])
            out+=chunk(events)
        Path(path).write_bytes(out)

class MidiParser:
    def __init__(self): self.status=0; self.buf=[]; self.sysex=False
    def feed(self,data):
        events=[]
        for b in data:
            if b>=0xf8: continue
            if b==0xf0: self.sysex=True; self.status=0; self.buf=[]; continue
            if b==0xf7: self.sysex=False; continue
            if self.sysex: continue
            if b&128:
                self.status=b if b<0xf0 else 0; self.buf=[]; continue
            if not self.status: continue
            self.buf.append(b); size=1 if self.status&0xf0 in (0xc0,0xd0) else 2
            if len(self.buf)==size:
                events.append((self.status,self.buf[0],self.buf[1] if size==2 else 0)); self.buf=[]
        return events

class Synth:
    def __init__(self,rate=48000):
        self.rate=rate; self.params=instrument('Warm Keys'); self.voices={}; self.sustain=False; self.bend=1.; self.mod_wheel=0.; self.tables={}; self.wave_cache={}; self.clock=0
    def configure(self,p):
        changed=any(self.params[k]!=p[k] for k in ('harmonics','filter'))
        self.params=copy.deepcopy(p)
        if changed:
            self.tables={}; self.wave_cache={}
            for v in self.voices.values():v['table']=self.table(v['note'])
    def table(self,note):
        if note not in self.tables:
            h=self.params['harmonics']; frequency=440*2**((note-69)/12)
            # Leave pitch-bend headroom so the upper partials cannot alias at +2 semitones.
            count=min(16,int(self.rate*.45/(frequency*1.123)))
            weights=[h[k]/(1+(k/(1+self.params['filter']*15))**4) for k in range(count)]
            norm=max(1,sum(weights)); size=2048
            if count not in self.wave_cache:
                self.wave_cache[count]=[sum(w*math.sin(2*math.pi*(k+1)*i/size) for k,w in enumerate(weights))/norm for i in range(size)]
            self.tables[note]=self.wave_cache[count]
        return self.tables[note]
    def on(self,note,velocity,token=None):
        token=note if token is None else token
        if len(self.voices)>=24: self.voices.pop(next(iter(self.voices)))
        self.voices[token]=dict(note=note,velocity=velocity/127,phase=0.,age=0,level=0.,release=None,held=True,table=self.table(note))
    def off(self,note,token=None):
        v=self.voices.get(note if token is None else token)
        if v:
            v['held']=False
            if not self.sustain or (isinstance(token,tuple) and token[0] in ('loop','perf_seq','perf_arp')): v['release']=(0,v['level'])
    def pedal(self,on):
        self.sustain=on
        if not on:
            for v in self.voices.values():
                if not v['held'] and v['release'] is None: v['release']=(0,v['level'])
    def panic(self): self.voices.clear(); self.sustain=False; self.bend=1.; self.mod_wheel=0.
    def render(self,frames):
        out=[0.]*frames; p=self.params; sr=self.rate
        a=max(1,p['attack']*sr); d=max(1,p['decay']*sr); release=max(1,p['release']*sr)
        mod=min(1.,p['modulation']+self.mod_wheel); trem=1-mod*.12+mod*.12*math.sin(self.clock/sr*2*math.pi*.27)
        for key,v in list(self.voices.items()):
            phase=v['phase']; age=v['age']; rel=v['release']; table=v['table']; level=v['level']
            step=440*2**((v['note']-69)/12)*2048/sr*self.bend*(1+mod*.002*math.sin(self.clock/sr*2*math.pi*.4))
            gain=v['velocity']*.23*trem
            for i in range(frames):
                if rel is not None:
                    r,base=rel; level=base*max(0,1-r/release); rel=(r+1,base)
                    if level<=0: self.voices.pop(key,None); break
                elif age<a: level=age/a
                elif age<a+d: level=1-(1-p['sustain'])*(age-a)/d
                else: level=p['sustain']
                j=int(phase); frac=phase-j
                out[i]+=(table[j]+(table[(j+1)&2047]-table[j])*frac)*level*gain
                phase=(phase+step)%2048; age+=1
            v.update(phase=phase,age=age,release=rel,level=level)
        self.clock+=frames; return out

class Engine:
    def __init__(self,rate=48000):
        self.rate=rate; self.project=Project(); self.synths=[Synth(rate) for _ in range(4)]
        self.selected=0; self.playing=False; self.recording=False; self.frame=0
        self.pending={}; self.down=set(); self.capture_sustain=set(); self.history=[]; self.record_start=0; self.record_end=0; self.click_age=99999
        self.perform_held=HeldNotes(); self.live_note_map={}; self.mutation_original=None
        self.scheduled_live=[]; self.absolute_frame=0
        self.clock_times=deque(maxlen=24);self.clock_following=False;self.clock_last_ts=0.
        self.configure()
    def configure(self):
        for t,s in zip(self.project.tracks,self.synths): s.configure(t['instrument'])
    @property
    def fpb(self): return self.rate*60/self.project.bpm
    @property
    def beat(self): return self.frame/self.fpb
    def snapshot(self): self.history.append(copy.deepcopy(self.project.data())); self.history=self.history[-20:]
    def undo(self):
        if not self.history:return
        self.stop(); d=self.history.pop(); self.project.tracks=d['tracks']; self.project.bpm=d['bpm']; self.project.bars=d['bars']
        self.project.metronome=d['metronome']
        self.project.performance=copy.deepcopy(d.get('performance',performance_defaults()))
        self.project.performance['seq']['recording']=False
        self.configure()
    def record(self,track):
        if self.recording:self.finish_record()
        self.snapshot(); self.select(track)
        if not self.playing: self.frame=0
        self.playing=True; self.recording=True; self.record_start=self.frame
        self.record_end=self.frame+round(self.project.beats*self.fpb)
    def quantize(self,track):
        self.snapshot(); self.stop(); self.project.quantize(track)
    def set_bars(self,bars):
        if bars not in (1,2,4,8):raise ValueError('Loop length must be 1, 2, 4 or 8 bars')
        self.snapshot(); self.stop(); self.project.bars=bars
        for t in self.project.tracks:
            for n in t['notes']:
                n['start']%=self.project.beats; n['duration']=min(n['duration'],self.project.beats)
    def voice_on(self,track,note,velocity,token):
        if sum(len(s.voices) for s in self.synths)>=24:
            candidates=[(s,k,v) for s in self.synths for k,v in s.voices.items()]
            s,k,_=min(candidates,key=lambda item:(item[2]['release'] is None,-item[2]['age']))
            s.voices.pop(k)
        self.synths[track].on(note,velocity,token)
    def select(self,track):
        if track!=self.selected:
            if self.recording: self.finish_record()
            s=self.synths[self.selected]
            for key in list(s.voices):
                if isinstance(key,tuple) and key[0]=='live':s.voices.pop(key)
                elif isinstance(key,tuple) and key[0] in ('perf_seq','perf_arp'):s.off(0,key)
            s.pedal(False); s.bend=1.; self.down.clear(); self.capture_sustain.clear()
            self.perform_held.reset(); self.live_note_map.clear(); self.scheduled_live.clear(); self.selected=track
    def close_note(self,key):
        if key in self.pending:
            start,vel,track=self.pending.pop(key)
            duration=min(self.project.beats,max(1/self.fpb,(self.frame-start)/self.fpb))
            out_note=key[2] if len(key)>=3 else key[1]
            self.project.tracks[track]['notes'].append(dict(start=(start/self.fpb)%self.project.beats,duration=duration,note=out_note,velocity=vel))
    def finish_record(self):
        for key in list(self.pending): self.close_note(key)
        self.recording=False
    def stop(self):
        self.finish_record(); self.down.clear(); self.capture_sustain.clear(); self.playing=False; self.frame=0
        self.project.performance['seq']['recording']=False
        for s in self.synths:s.panic()
        self.perform_held.reset(); self.live_note_map.clear(); self.scheduled_live.clear()
    def release_performance(self,prefix):
        for synth in self.synths:
            for token in list(synth.voices):
                if isinstance(token,tuple) and token and token[0]==prefix:
                    synth.off(0,token)

    def perform_set(self,section,key,value):
        """Validated UI parameter changes; does not erase recorded song notes."""
        if section not in ('seq','arp','chord','scale','sync'):
            raise ValueError('Unknown performance section')
        state=copy.deepcopy(self.project.performance)
        if key not in state[section]:raise ValueError('Unknown performance parameter')
        state[section][key]=value
        if section=='seq' and key in ('bank','slot'):
            addr=slot_key(state['seq']['bank'],state['seq']['slot'])
            chosen=state['patterns'].get(addr) or empty_pattern(16,'1/16')
            reconcile_pattern_timing(state,chosen)
        if section=='seq' and key in ('length','division','gate','swing'):
            key_at=slot_key(state['seq']['bank'],state['seq']['slot'])
            pattern=copy.deepcopy(current_pattern(state))
            if key=='length':pattern=change_pattern_length(pattern,int(value))
            else:pattern[key]=value
            state['patterns'][key_at]=pattern
        if section=='seq' and key=='enabled' and value:
            state['arp']['enabled']=False
            self.perform_held.reset()
        if section=='arp' and key=='enabled' and value:
            state['seq']['enabled']=False
            state['seq']['recording']=False
        state=validate_performance(state)
        if section=='arp' and key=='hold':self.perform_held.set_hold(value)
        if section=='sync' and key=='source':
            self.clock_times.clear();self.clock_following=False;self.clock_last_ts=0.
        if section=='seq' and key=='recording' and value:self.snapshot()
        self.project.performance=state
        if section=='seq':self.release_performance('perf_seq')
        if section=='arp':self.release_performance('perf_arp')
        if section in ('seq','arp') and key=='enabled':
            for synth in self.synths:
                for token in list(synth.voices):
                    if isinstance(token,tuple) and str(token[0]).startswith('perf_'):
                        synth.off(0,token)
        return state[section][key]

    def perform_step(self,index,notes,replace=True):
        state=self.project.performance
        addr=slot_key(state['seq']['bank'],state['seq']['slot'])
        updated=step_change(current_pattern(state),index,notes,replace)
        self.release_performance('perf_seq')
        self.snapshot()
        state['patterns'][addr]=updated
        return len(state['patterns'][addr]['steps'][index])

    def perform_action(self,action,value=None):
        converting=action in ('capture_song','arp_to_seq')
        if not converting:self.release_performance('perf_seq')
        state=copy.deepcopy(self.project.performance) if converting else self.project.performance
        seq=state['seq']; addr=slot_key(seq['bank'],seq['slot'])
        pattern=current_pattern(state)
        if action=='capture_song':
            state['patterns'][addr]=pattern_from_song(self.project.tracks[self.selected]['notes'],
                         self.project.bars,seq['division'],seq['length'])
        elif action=='commit_song':
            if value not in ('add','replace'):raise ValueError('Choose add or replace')
            notes=song_from_pattern(pattern,self.project.bars,seq['transpose'])
            if len(notes)>100000:raise ValueError('Too many MIDI notes')
            self.snapshot(); self.stop()
            if value=='replace':self.project.tracks[self.selected]['notes']=notes
            else:self.project.tracks[self.selected]['notes'].extend(notes)
        elif action=='clear':
            self.snapshot(); state['patterns'][addr]=step_change(pattern,0,[],True)
            for step in state['patterns'][addr]['steps']:step.clear()
            self.mutation_original=None
        elif action=='double':
            self.snapshot()
            if pattern['length']*2>64:raise ValueError('Maximum 64 sequence steps')
            doubled=change_pattern_length(pattern,pattern['length']*2)
            doubled['steps'][pattern['length']:]=copy.deepcopy(pattern['steps'])
            state['patterns'][addr]=doubled; seq['length']=doubled['length']
        elif action=='nudge':
            direction=int(value)
            if direction not in (-1,1):raise ValueError('Nudge direction must be -1 or +1')
            self.snapshot(); out=copy.deepcopy(pattern)
            out['steps']=[copy.deepcopy(pattern['steps'][(i-direction)%pattern['length']])
                          for i in range(pattern['length'])]
            state['patterns'][addr]=out
        elif action=='octave':
            direction=int(value)
            if direction not in (-1,1):raise ValueError('Octave direction must be -1 or +1')
            self.snapshot(); out=copy.deepcopy(pattern)
            for step in out['steps']:
                for note in step:note['note']=max(0,min(127,note['note']+12*direction))
            state['patterns'][addr]=out
        elif action=='mutate':
            intensity=float(value)
            if not 0<=intensity<=1:raise ValueError('Mutation strength 0-1')
            self.snapshot()
            if self.mutation_original is None:self.mutation_original=(addr,copy.deepcopy(pattern))
            seq['mutate_seed']=(seq['mutate_seed']+1)%1000000
            state['patterns'][addr]=mutate_pattern(pattern,intensity,seq['mutate_seed'])
        elif action=='reset_mutate':
            if self.mutation_original is not None and self.mutation_original[0]==addr:
                self.snapshot()
                state['patterns'][addr]=copy.deepcopy(self.mutation_original[1])
            self.mutation_original=None
        elif action=='arp_to_seq':
            notes=self.perform_held.held()
            if not notes:raise ValueError('Play or HOLD notes before Arp to Sequence')
            arp=state['arp']
            groups=arp_groups(notes,arp['mode'],arp['octaves'],arp['seed'])
            out=change_pattern_length(pattern,max(1,min(64,len(groups))))
            out['division']=arp['division'];out['gate']=arp['gate'];out['swing']=arp['swing']
            out['steps']=[[dict(note=n,velocity=100,tie=1) for n in group[:8]] for group in groups[:out['length']]]
            state['patterns'][addr]=out; seq['division']=out['division'];seq['length']=out['length']
            seq['enabled']=True;arp['enabled']=False
        elif action=='quantize':
            self.snapshot()
            strength=seq['quantize_strength']
            # Step data is already on-grid. This action quantizes the selected song track.
            snap=DIVISIONS[seq['division']]
            for note in self.project.tracks[self.selected]['notes']:
                original=note['start']; target=round(original/snap)*snap
                note['start']=(original+(target-original)*strength)%self.project.beats
        elif action=='learn_chord':
            notes=self.perform_held.held()
            if not notes:raise ValueError('Hold MIDI notes before learning a chord')
            return self.perform_action('save_chord',notes)
        elif action=='save_chord':
            if not isinstance(value,list) or not 1<=len(value)<=16:
                raise ValueError('Chord memory needs 1-16 notes')
            root=int(value[0]); offsets=[max(-48,min(48,int(x)-root)) for x in value]
            self.snapshot(); state['chord']['user']=offsets; state['chord']['preset']='User'
        else:raise ValueError('Unknown performance action')
        if converting:reconcile_pattern_timing(state)
        validated=validate_performance(state)
        if converting:
            self.release_performance('perf_seq')
            self.snapshot()
            self.project.performance=validated
        return action

    def receive_midi_clock(self,status,timestamp=None):
        """Optional MIDI realtime clock receive and start/stop.

        Uses incoming 24 PPQN ticks to *follow tempo*. External phase correction
        and MIDI-clock transmission are not part of this prototype.
        """
        import time
        source=self.project.performance['sync']['source']
        if source=='Internal':return
        if status not in (0xf8,0xfa,0xfb,0xfc):return
        if timestamp is None:timestamp=time.monotonic()
        if status==0xf8:
            if self.clock_last_ts and timestamp-self.clock_last_ts>1.0:
                self.clock_times.clear()
            if self.clock_last_ts and timestamp<=self.clock_last_ts:return
            self.clock_last_ts=timestamp
            self.clock_times.append(timestamp)
            if len(self.clock_times)>=12:
                dt=self.clock_times[-1]-self.clock_times[0]
                bpm=60*(len(self.clock_times)-1)/(24*dt) if dt>0 else 0
                if 30<=bpm<=240:
                    self.clock_following=True
                    if abs(bpm-self.project.bpm)>=1.:
                        old_fpb=self.fpb
                        old_frame=self.frame
                        new_bpm=int(max(30,min(240,round(bpm))))
                        self.project.bpm=new_bpm
                        new_fpb=self.fpb
                        # Retain song/playhead and recording positions in beats.
                        self.frame=round(old_frame/old_fpb*new_fpb)
                        if self.recording:
                            self.record_end=round(self.record_end/old_fpb*new_fpb)
                            self.record_start=round(self.record_start/old_fpb*new_fpb)
                            for k,(start,velocity,track) in list(self.pending.items()):
                                self.pending[k]=(round(start/old_fpb*new_fpb),velocity,track)
            return
        if not self.project.performance['sync']['receive_transport']:return
        if status==0xfa:
            self.stop()
            self.frame=0
            self.playing=True
        elif status==0xfb:self.playing=True
        elif status==0xfc:self.stop()

    def midi(self,status,note,value):
        kind=status&0xf0; ch=status&15; s=self.synths[self.selected]; key=(ch,note)
        state=self.project.performance; channel=state['scale']['input_channel']
        if channel and ch!=channel-1:return
        if kind==0x90 and value:
            for k in list(self.pending):
                if k[:2]==key:self.close_note(k)
            for old in self.live_note_map.pop(key,[]):
                s.off(old,('live',ch,note,old))
            self.scheduled_live=[item for item in self.scheduled_live if item[4]!=key]
            notes=chord_notes(state,note,value)
            velocity=velocity_transform(value,state['scale']['velocity_curve'])
            self.down.add(key)
            if state['arp']['enabled']:self.release_performance('perf_arp')
            self.perform_held.on(key,notes)
            if state['arp']['enabled']:
                # The Arpeggiator starts with the first held key, even without a song clip.
                self.live_note_map[key]=[]
                if not self.playing:self.frame=0
                self.playing=True
            else:
                order=notes[:]
                strum=state['chord']['strum_ms'] if state['chord']['enabled'] else 0
                direction=state['chord']['strum_type']
                if direction in ('Down','Alt Down'):order.reverse()
                if direction in ('Alt Up','Alt Down') and len(order)>2:
                    order=order[::2]+order[1::2]
                self.live_note_map[key]=order[:]
                for i,pitch in enumerate(order):
                    token=('live',ch,note,pitch)
                    delay=max(0,round(strum*i*self.rate/1000))
                    if delay:
                        self.scheduled_live.append((self.absolute_frame+delay,self.selected,pitch,velocity,key,token))
                    else:
                        self.voice_on(self.selected,pitch,velocity,token)
                        if self.recording:self.pending[(ch,note,pitch)]=(self.frame,velocity,self.selected)
            if state['seq']['enabled'] and state['seq']['recording']:
                pattern=current_pattern(state)
                beat_size=DIVISIONS[pattern['division']]
                step=int(round(self.beat/beat_size))%pattern['length']
                emitted=[dict(note=n,velocity=velocity,tie=1) for n in notes[:8]]
                self.perform_step(step,emitted,not state['seq']['overdub'])
        elif kind==0x80 or (kind==0x90 and value==0):
            self.down.discard(key)
            if state['arp']['enabled'] and not self.perform_held.hold:self.release_performance('perf_arp')
            self.perform_held.off(key)
            self.scheduled_live=[item for item in self.scheduled_live if item[4]!=key]
            for pitch in self.live_note_map.pop(key,[]):
                s.off(pitch,('live',ch,note,pitch))
            if ch not in self.capture_sustain:
                for k in list(self.pending):
                    if k[:2]==key:self.close_note(k)
        elif kind==0xb0 and note==64:
            s.pedal(value>=64)
            if value>=64:self.capture_sustain.add(ch)
            else:
                self.capture_sustain.discard(ch)
                for k in list(self.pending):
                    if k[0]==ch and (ch,k[1]) not in self.down:self.close_note(k)
        elif kind==0xe0:s.bend=2**((((value<<7|note)-8192)/8192*2)/12)
        elif kind==0xb0 and note==1:s.mod_wheel=max(0.,min(1.,value/127))
        elif kind in (0xa0,0xd0):
            # Channel/poly-aftertouch mapped to expressive synth modulation.
            s.mod_wheel=max(0.,min(1.,(note if kind==0xd0 else value)/127))
        elif kind==0xb0 and note in (120,123):self.panic()
    def panic(self):
        self.finish_record(); self.down.clear(); self.capture_sustain.clear()
        self.perform_held.reset(); self.live_note_map.clear(); self.scheduled_live.clear()
        for s in self.synths:s.panic()
    def render(self,frames):
        result=[]; remaining=frames
        while remaining:
            n=min(remaining,128)
            if self.recording:n=min(n,max(1,self.record_end-self.frame))
            events={0:[]}; start=self.frame; end=start+n
            abs_start=self.absolute_frame; abs_end=abs_start+n
            # Delayed strums are scheduled on an always-running audio clock, even
            # if song transport is stopped. Note offs cancel pending strums.
            waiting=[]
            for due,tr,pitch,velocity,source,token in self.scheduled_live:
                if due<abs_end:
                    if source in self.down:
                        events.setdefault(max(0,due-abs_start),[]).append((4,tr,pitch,velocity,source,token))
                else:waiting.append((due,tr,pitch,velocity,source,token))
            self.scheduled_live=waiting
            if self.playing:
                loop=self.project.beats*self.fpb
                for tr,t in enumerate(self.project.tracks):
                    if t['mute']:continue
                    for idx,note in enumerate(t['notes']):
                        for cycle in range(max(0,int(start/loop)-1),int(end/loop)+1):
                            on=round(cycle*loop+note['start']*self.fpb); off=round(cycle*loop+(note['start']+note['duration'])*self.fpb)
                            for when,action in ((off,0),(on,1)):
                                if start<=when<end:events.setdefault(when-start,[]).append((action,tr,idx,cycle,note))
                if not self.project.tracks[self.selected]['mute']:
                    generated=schedule_notes(self.project.performance,self.perform_held.held(),
                                             start,end,self.fpb)
                    for offset,action,pitch,velocity,token in generated:
                        events.setdefault(offset,[]).append((3,action,self.selected,pitch,velocity,token))
                if self.project.metronome:
                    b=math.ceil(start/self.fpb); tick=round(b*self.fpb)
                    if start<=tick<end:events.setdefault(tick-start,[]).append((2,b))
            offsets=sorted(set(events)|{n})
            for pos,nextpos in zip(offsets,offsets[1:]):
                for event in sorted(events[pos],key=lambda x:x[0]):
                    if event[0]==2:self.click_age=0; self.click_freq=1500 if event[1]%4==0 else 1000; continue
                    if event[0]==3:
                        _,action,tr,pitch,velocity,token=event
                        if action:self.voice_on(tr,pitch,velocity,token)
                        else:self.synths[tr].off(pitch,token)
                        continue
                    if event[0]==4:
                        _,tr,pitch,velocity,source,token=event
                        self.voice_on(tr,pitch,velocity,token)
                        if self.recording:self.pending[(source[0],source[1],pitch)]=(self.frame+pos,velocity,tr)
                        continue
                    action,tr,idx,cycle,note=event; token=('loop',idx,cycle)
                    if action:self.voice_on(tr,note['note'],note['velocity'],token)
                    else:self.synths[tr].off(note['note'],token)
                count=nextpos-pos; mix=[0.]*count
                for t,s in zip(self.project.tracks,self.synths):
                    audio=s.render(count)
                    if not t['mute']:
                        vol=t['volume']
                        for j,v in enumerate(audio):mix[j]+=v*vol
                for j in range(count):
                    if self.click_age<self.rate*.025:
                        mix[j]+=.15*math.sin(self.click_age/self.rate*2*math.pi*self.click_freq)*(1-self.click_age/(self.rate*.025))
                        self.click_age+=1
                    mix[j]=max(-.95,min(.95,mix[j]))
                result.extend(mix)
            if self.playing:self.frame+=n
            self.absolute_frame+=n
            if self.recording and self.frame>=self.record_end:self.finish_record()
            remaining-=n
        return result
