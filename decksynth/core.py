"""Device-independent synthesis, MIDI and song model. Timing is in quarter-note beats."""
import copy
from collections import deque
import json
import ctypes
import math
import os
from pathlib import Path
import struct
from . import song as songs
from .devices import device_kind
from .drum_rack import validate_kit
from .drum_engine import DrumEngine
from .spectral import seed_shape, next_seed, validate_metadata, energy_norm
from .spectral_native import prepare_kernel as prepare_spectral_kernel, bound_table
from .fx import TrackFx, SOUND_PARAMS, ORDER as FX_ORDER, build_table, native_voice, native_voice2, DsVoice, default_chain as default_fx, validate_chain as validate_fx
from .keystep import (defaults as performance_defaults, validate_state as validate_performance,
                      current_pattern, empty_pattern, slot_key, step_change, change_pattern_length,
                      mutate_pattern, song_from_pattern, pattern_from_song, chord_notes,
                      velocity_transform, HeldNotes, schedule_notes, arp_groups, DIVISIONS,
                      reconcile_pattern_timing, STRUM_SYNC, arp_view)

PRESETS = {
    'Atmospheric Pad': ([1,.4,.25,.14,.12,.08,.06,.05,.04,.03,.02,.02,.01,.01,0,0], .7,.8,.75,1.8,.65,.25),
    'Warm Keys': ([1,.5,.22,.12,.08,.04,.02,.01,0,0,0,0,0,0,0,0], .008,.6,.35,.5,.85,.08),
    'Bell': ([1,0,.55,0,.3,0,.12,.08,0,.04,0,0,.02,0,0,0], .002,1.6,.05,1.3,1.,.12),
    'Bass': ([1,.45,.22,.1,.06,.02,0,0,0,0,0,0,0,0,0,0], .004,.2,.65,.15,.35,0),
    'Evolving Texture': ([1,.2,.5,.1,.3,.08,.18,.06,.1,.04,.06,.02,.04,.02,.01,0], 1.2,.8,.7,2.,.7,.7),
}

# Non-destructive spectral macros (research guide slice S1). The saved 16 partials stay as
# edited; these reshape the evaluated spectrum. At the neutral values every gain is exactly 1.
SPECTRAL_KEYS=('curve','balance','focus','focus_center','character')
SPECTRAL_DEFAULTS=dict(curve=0.,balance=.5,focus=0.,focus_center=4.,character=0.)
SPECTRAL_RANGES=dict(curve=(-1,1),balance=(0,1),focus=(0,1),focus_center=(1,16),character=(-1,1))

# Filter, Unison and Character cards (patch 24). Missing keys mean the neutral sound, so old projects play as before.
VOICE_DEFAULTS=dict(vcf_type=0,vcf_cutoff=.65,vcf_reso=.2,vcf_env=.3,uni_voices=1,uni_detune=.3,
                    formant=0.,vowel=0.,inharm=0.,sub=0.,sub_oct=1)
VOICE_RANGES=dict(vcf_cutoff=(0,1),vcf_reso=(0,1),vcf_env=(-1,1),uni_detune=(0,1),formant=(0,1),vowel=(0,4),inharm=(0,1),sub=(0,1))
VOICE_CHOICES=dict(vcf_type=(0,1,2,3),uni_voices=(1,2,3,4,5,7),sub_oct=(1,2))
PARAM_DEFAULTS={**SPECTRAL_DEFAULTS,**VOICE_DEFAULTS}
# Vowel formants F1-F3 in Hz (adult voice): A E I O U
VOWELS=((730,1090,2440),(530,1840,2480),(270,2290,3010),(570,840,2410),(300,870,2240))
VSINE=[math.sin(2*math.pi*i/2048) for i in range(2049)]

def formant_gains(p,freq,count):
    """Gain per harmonic for the vowel filter, or None when Formant is off. Vowel 0-4 morphs A-E-I-O-U."""
    amt=p.get('formant',0.)
    if not amt:return None
    v=min(4.,max(0.,p.get('vowel',0.))); i=int(min(3,v)); t=v-i
    F=[a+(b-a)*t for a,b in zip(VOWELS[i],VOWELS[i+1])]
    g=[sum(A*math.exp(-(((k+1)*freq-f)/(.2*f+80))**2) for f,A in zip(F,(1.,.63,.35))) for k in range(count)]
    top=max(g) if g and max(g)>0 else 1.
    return [(1-amt)+amt*x/top for x in g]

def cutoff_hz(p,note):
    """Filter card cutoff 0-1 as Hz (20 Hz-18 kHz), following the keyboard at half strength."""
    return 20*900**p.get('vcf_cutoff',.65)*2**((note-60)/24)

def spectral_gain(p,k):
    """Gain for harmonic number k (1-16). Curve tilts by harmonic number, Balance
    crossfades low against high partials, Focus narrows energy around Focus centre."""
    c=p.get('curve',0.);b=p.get('balance',.5);f=p.get('focus',0.);m=p.get('focus_center',4.)
    g=k**(c*1.5) if c else 1.
    if b!=.5:g*=max(0.,1+(b-.5)*2*(2*(k-1)/15-1))
    if f:g*=(1-f)+f*math.exp(-((k-m)/2.2)**2)
    character=p.get('character',0.)
    if character:g*=1-abs(character) if (character>0 and k%2==0) or (character<0 and k%2==1) else 1.
    return g

def instrument(name):
    if name not in PRESETS:
        from .library import preset
        p=preset(name)
        if p is None:raise ValueError('Unknown preset: '+str(name))
        return p['instrument']
    h,a,d,s,r,f,m=PRESETS[name]
    return dict(harmonics=h[:],attack=a,decay=d,sustain=s,release=r,filter=f,modulation=m)

class Project:
    def __init__(self):
        self.bpm=120; self.bars=4; self.metronome=False
        self.tracks=[dict(name=f'Track {i+1}',preset=n,instrument=instrument(n),volume=.7,mute=False,notes=[])
                     for i,n in enumerate(['Warm Keys','Bass','Atmospheric Pad','Bell'])]
        self.performance=performance_defaults()
        self.song=songs.defaults(); self.clips=songs.empty_clips()
    @property
    def beats(self): return self.bars*4
    def clip_notes(self,track,clip):
        """A track's loop by slot. The open loop lives in the track's own 'notes', as it always has."""
        return self.tracks[track]['notes'] if clip==self.clips['open'][track] else self.clips['slots'][track][clip]
    def clips_data(self):
        return dict(open=self.clips['open'],slots=[[self.clip_notes(tr,k) for k in range(songs.CLIPS)] for tr in range(4)])
    def data(self):
        return dict(version=1,bpm=self.bpm,bars=self.bars,metronome=self.metronome,
                    tracks=self.tracks,performance=self.performance,song=self.song,clips=self.clips_data())
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
                kind=device_kind(t)
                if 'drum_rack' in t:t['drum_rack']=validate_kit(t['drum_rack'])
                if kind=='drum_rack' and 'drum_rack' not in t:raise ValueError('Drum Rack kit is missing')
                ins=t['instrument']; assert len(ins['harmonics'])==16
                validate_metadata(ins)
                assert all(isinstance(x,(int,float)) and math.isfinite(x) and 0<=x<=1 for x in ins['harmonics'])
                for k,lo,hi in [('attack',.001,3),('decay',.001,3),('sustain',0,1),('release',.01,3),('filter',.02,1),('modulation',0,1)]:
                    assert math.isfinite(ins[k]) and lo<=ins[k]<=hi
                for k,(lo,hi) in SPECTRAL_RANGES.items():
                    if k in ins:assert isinstance(ins[k],(int,float)) and math.isfinite(ins[k]) and lo<=ins[k]<=hi
                for k,(lo,hi) in VOICE_RANGES.items():
                    if k in ins:assert type(ins[k]) in (int,float) and math.isfinite(ins[k]) and lo<=ins[k]<=hi
                for k,choices in VOICE_CHOICES.items():
                    if k in ins:assert type(ins[k]) is int and ins[k] in choices
                if 'fx' in t:t['fx']=validate_fx(t['fx'])
                assert len(t['notes'])<=100000
                for n in t['notes']:
                    assert 0<=n['start']<d['bars']*4 and 0<n['duration']<=d['bars']*4
                    assert math.isfinite(n['start']) and math.isfinite(n['duration'])
                    assert isinstance(n['note'],int) and 0<=n['note']<=127
                    assert isinstance(n['velocity'],int) and 1<=n['velocity']<=127
            p.bpm=d['bpm']; p.bars=d['bars']; p.metronome=d['metronome']; p.tracks=d['tracks']
            p.song=songs.validate(d['song'],d['bars']) if 'song' in d else songs.defaults(d['bars'])
            p.clips=songs.validate_clips(d['clips'],d['bars']*4) if 'clips' in d else songs.empty_clips()
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
        # With the song on, the file holds the whole arrangement (played once); otherwise the open loops.
        song=self.song if self.song['on'] else None
        for ch,t in enumerate(self.tracks):
            name=t['name'].encode()[:100]; events=[(0,-1,b'\xff\x03'+vlq(len(name))+name)]
            parts=[(n['start'],n) for n in t['notes']] if not song else [
                (beat,n) for beat,on,_,_,n in songs.song_events(dict(song,loop=False),lambda k:self.clip_notes(ch,k),ch,
                                                                0,song['length']*4,self.bars) if on]
            for beat,n in parts:
                start=round(beat*480); end=start+max(1,round(n['duration']*480))
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

# Knobs that shape the wavetable. When a pad moves one, the table is rebuilt in 1/48 steps of its range.
TABLE_KEYS=('filter',)+SPECTRAL_KEYS+('formant','vowel','spectral_energy')
TABLE_STEPS=48

class Synth:
    def __init__(self,rate=48000):
        prepare_spectral_kernel()
        self.rate=rate; self.params=instrument('Warm Keys'); self.voices={}; self.sustain=False; self.bend=1.; self.mod_wheel=0.; self.tables={}; self.wave_cache={}; self.clock=0
        self.live=None; self.shape=None; self.shape_key=None; self.shape_clock=-10**9
        self.weights={}; self.weight_cache={}; self.st=(ctypes.c_double*80)(); self.vargs=DsVoice()
    def configure(self,p):
        changed=any(self.params.get(k)!=p.get(k) for k in ('harmonics',)+TABLE_KEYS)
        self.params=copy.deepcopy(p)
        if changed:
            self.tables={}; self.wave_cache={}; self.weights={}; self.weight_cache={}
            self.swap_tables()
    def modulate(self,offsets):
        """Macro and mod-pad movement on the Sound knobs, once per audio block. The saved sound is untouched."""
        offsets={k:v for k,v in offsets.items() if k!='volume'}
        if not offsets:
            if self.live is not None:self.live=None; self.reshape(None,None)
            return
        live=dict(self.params)
        for k,v in offsets.items():
            lo,hi=SOUND_PARAMS[k]; live[k]=min(hi,max(lo,self.params.get(k,PARAM_DEFAULTS.get(k,0.))+v))
        self.live=live
        moved=[k for k in TABLE_KEYS if k in offsets]
        if not moved:return self.reshape(None,None)
        steps={k:round((live[k]-SOUND_PARAMS[k][0])/(SOUND_PARAMS[k][1]-SOUND_PARAMS[k][0])*TABLE_STEPS) for k in moved}
        self.reshape(tuple(sorted(steps.items())),{k:SOUND_PARAMS[k][0]+n*(SOUND_PARAMS[k][1]-SOUND_PARAMS[k][0])/TABLE_STEPS for k,n in steps.items()})
    def reshape(self,key,values):
        if key==self.shape_key:return
        # At most one new table set every 12 ms, so a fast pad cannot flood the audio thread.
        if key is not None and self.shape_key is not None and self.clock-self.shape_clock<self.rate*.012:return
        self.shape_key=key; self.shape=values; self.shape_clock=self.clock; self.tables={}; self.weights={}
        self.swap_tables()
    def swap_tables(self):
        # A new wavetable mid-note crossfades from the old one over ~5 ms; swapping it at once clicks.
        for v in self.voices.values():
            new=self.table(v['note'])
            if new is not v['table']:v['prev']=v['table']; v['xf']=0.; v['table']=new
    def table(self,note):
        if note not in self.tables:
            p={**self.params,**self.shape} if self.shape else self.params
            h=p['harmonics']; frequency=440*2**((note-69)/12)
            # Leave pitch-bend headroom so the upper partials cannot alias at +2 semitones.
            count=min(16,int(self.rate*.45/(frequency*1.123)))
            vowel=formant_gains(p,frequency,count)
            key=(count,self.shape_key) if vowel is None else (count,self.shape_key,note)
            if key not in self.wave_cache:
                weights=[h[k]*spectral_gain(p,k+1)/(1+(k/(1+p['filter']*15))**4) for k in range(count)]
                if vowel is not None:weights=[w*g for w,g in zip(weights,vowel)]
                normalized=p.get('spectral_energy',0)==1
                norm=energy_norm(weights) if normalized else max(1,sum(weights)); size=2048
                table=build_table(weights,norm,size)
                if table is None:
                    table=[sum(w*math.sin(2*math.pi*(k+1)*i/size) for k,w in enumerate(weights))/norm for i in range(size)]
                if normalized:
                    peak=bound_table(table)
                    if peak is None:
                        peak=max(1.,max(abs(x) for x in table))
                        if peak>1:
                            for i in range(size):table[i]/=peak
                    norm*=peak
                self.weight_cache[key]=(ctypes.c_double*16)(*[w/norm for w in weights])
                if len(self.wave_cache)>=160:
                    old=next(iter(self.wave_cache)); self.wave_cache.pop(old); self.weight_cache.pop(old,None)
                self.wave_cache[key]=table
            self.tables[note]=self.wave_cache[key]; self.weights[note]=self.weight_cache[key]
        return self.tables[note]
    def fade(self,key):
        # Retriggered or stolen notes fade out over 6 ms under a key of their own, instead of stopping dead.
        v=self.voices.pop(key,None)
        if not v or v['level']<=1e-4:return
        self.fade_id=getattr(self,'fade_id',0)+1
        v.update(release=(0,v['level']),fast=True,held=False); self.voices[('fade',self.fade_id)]=v
        fading=[k for k in self.voices if isinstance(k,tuple) and k[0]=='fade']
        while len(fading)>8:self.voices.pop(fading.pop(0),None)
    def on(self,note,velocity,token=None):
        token=note if token is None else token
        if token in self.voices:self.fade(token)
        playing=[k for k in self.voices if not (isinstance(k,tuple) and k[0]=='fade')]
        if len(playing)>=24:self.fade(playing[0])
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
    @staticmethod
    def voice_mode(p):
        sub=p.get('sub',0.)>0
        return (int(p.get('uni_voices',1)),int(p.get('vcf_type',0)),p.get('inharm',0.)>0,int(p.get('sub_oct',1)) if sub else 0)
    def render(self,frames):
        # Switching a card's buttons (voices, filter type, sub octave, stretched partials) mid-note would jump,
        # so that block is rendered both ways and crossfaded.
        p=self.live or self.params; mode=self.voice_mode(p); last=getattr(self,'last_p',None)
        if self.voices and last is not None and self.voice_mode(last)!=mode:
            keep=self.voices; clock=self.clock
            self.voices=copy.deepcopy(keep); old=self._render(frames,last)
            self.voices=keep; self.clock=clock
            new=self._render(frames,p)
            out=[o+(n-o)*(i+1)/frames for i,(o,n) in enumerate(zip(old,new))]
        else:out=self._render(frames,p)
        self.last_p=p
        return out
    def _render(self,frames,p):
        out=[0.]*frames; sr=self.rate
        a=max(1,p['attack']*sr); d=max(1,p['decay']*sr); slow=max(1,p['release']*sr); quick=min(slow,.006*sr)
        mod=min(1.,p['modulation']+self.mod_wheel); trem=1-mod*.12+mod*.12*math.sin(self.clock/sr*2*math.pi*.27)
        uni=int(p.get('uni_voices',1)); ft=int(p.get('vcf_type',0)); sub=p.get('sub',0.); inh=p.get('inharm',0.)
        if uni>1 or ft or sub>0 or inh>0:return self.render_ext(frames,p,a,d,slow,quick,mod,trem,uni,ft,sub,inh)
        fast=native_voice()
        if fast is not None:
            buf=(ctypes.c_double*frames)(); st=(ctypes.c_double*6)()
            for key,v in list(self.voices.items()):
                table=v['table']; prev=v.get('prev')
                if not isinstance(table,ctypes.Array) or (prev is not None and not isinstance(prev,ctypes.Array)):
                    fast=None; break
            if fast is not None:
                for key,v in list(self.voices.items()):
                    rel=v['release']; prev=v.get('prev')
                    st[0]=v['phase']; st[1]=v['age']; st[2]=rel[0] if rel else 0; st[3]=rel[1] if rel else 0
                    st[4]=v['level']; st[5]=v.get('xf',1.)
                    step=440*2**((v['note']-69)/12)*2048/sr*self.bend*(1+mod*.002*math.sin(self.clock/sr*2*math.pi*.4))
                    res=fast(buf,frames,v['table'],prev,st,rel is not None,step,v['velocity']*.23*trem,
                             a,d,p['sustain'],quick if v.get('fast') else slow)
                    if res&1:self.voices.pop(key,None); continue
                    v.update(phase=st[0],age=int(st[1]),release=(int(st[2]),st[3]) if rel else None,level=st[4],
                             prev=None if res&2 else prev,xf=st[5])
                self.clock+=frames; return list(buf)
        for key,v in list(self.voices.items()):
            phase=v['phase']; age=v['age']; rel=v['release']; table=v['table']; level=v['level']
            step=440*2**((v['note']-69)/12)*2048/sr*self.bend*(1+mod*.002*math.sin(self.clock/sr*2*math.pi*.4))
            gain=v['velocity']*.23*trem
            release=quick if v.get('fast') else slow
            prev=v.get('prev'); xf=v.get('xf',1.)
            for i in range(frames):
                if rel is not None:
                    r,base=rel; level=base*max(0,1-r/release); rel=(r+1,base)
                    if level<=0: self.voices.pop(key,None); break
                elif age<a: level=age/a
                elif age<a+d: level=1-(1-p['sustain'])*(age-a)/d
                else: level=p['sustain']
                j=int(phase); frac=phase-j; j2=(j+1)&2047
                smp=table[j]+(table[j2]-table[j])*frac
                if prev is not None:
                    smp=smp*xf+(prev[j]+(prev[j2]-prev[j])*frac)*(1-xf); xf+=1/256
                    if xf>=1:prev=None; xf=1.
                out[i]+=smp*level*gain
                phase=(phase+step)%2048; age+=1
            v.update(phase=phase,age=age,release=rel,level=level,prev=prev,xf=xf)
        self.clock+=frames; return out

    def ext_state(self,v):
        """Extra state for a voice the first time a Filter, Unison or Character card is on (st[6:80] in dsfx.c)."""
        self.table(v['note'])
        x=[0.]*74
        for u in range(7):x[u]=(v['phase']+u*1265.6)%2048
        x[10:26]=list(self.weights[v['note']])
        for u in range(3):
            for k in range(16):x[26+u*16+k]=(u*731.)%2048
        return x
    def render_ext(self,frames,p,a,d,slow,quick,mod,trem,uni,ft,sub,inh):
        """Voices with the Filter, Unison or Character cards on: dsfx_voice2 in C, or the same loop in Python."""
        sr=self.rate; fast=native_voice2()
        if fast is not None and not all(isinstance(v['table'],ctypes.Array) and (v.get('prev') is None or isinstance(v['prev'],ctypes.Array))
                                        for v in self.voices.values()):fast=None
        out=(ctypes.c_double*frames)() if fast is not None else [0.]*frames
        va=self.vargs; st=self.st
        cfg=dict(a=a,d=d,sus=p['sustain'],uni=uni,detune=p.get('uni_detune',.3)*.5,ftype=ft,reso=p.get('vcf_reso',.2),
                 envamt=p.get('vcf_env',.3)*6,rate=float(sr),npart=16,stretch=.008*inh*inh,sub=sub,suboct=int(p.get('sub_oct',1)))
        for key,v in list(self.voices.items()):
            if 'x' not in v:v['x']=self.ext_state(v)
            rel=v['release']; prev=v.get('prev')
            if inh>0 and v['note'] not in self.weights:self.table(v['note'])
            cfg.update(step=440*2**((v['note']-69)/12)*2048/sr*self.bend*(1+mod*.002*math.sin(self.clock/sr*2*math.pi*.4)),
                       gain=v['velocity']*.23*trem,rel=quick if v.get('fast') else slow,released=int(rel is not None),
                       cutoff=cutoff_hz(p,v['note']),weights=self.weights[v['note']] if inh>0 else None)
            st[0:6]=[v['phase'],v['age'],rel[0] if rel else 0,rel[1] if rel else 0,v['level'],v.get('xf',1.)]
            st[6:80]=v['x']
            if fast is not None:
                for k,val in cfg.items():
                    if k!='weights':setattr(va,k,val)
                va.weights=ctypes.cast(cfg['weights'],ctypes.POINTER(ctypes.c_double)) if cfg['weights'] is not None else None
                res=fast(out,frames,v['table'],prev,st,ctypes.byref(va))
            else:res=voice2_py(out,frames,v['table'],prev,st,cfg)
            if res&1:self.voices.pop(key,None); continue
            v.update(phase=st[0],age=int(st[1]),release=(int(st[2]),st[3]) if rel else None,level=st[4],
                     prev=None if res&2 else prev,xf=st[5],x=st[6:80])
        self.clock+=frames; return list(out)

def voice2_py(out,n,tab,prev,st,c):
    """Python twin of dsfx_voice2 (used when the native library is missing). Keep the two in step."""
    age,r,base,level,xf=st[1],st[2],st[3],st[4],st[5]
    result=0; W=c['weights']; partial=W is not None
    uni=max(1,min(7,c['uni']))
    if partial and uni>3:uni=3
    ph=[st[0] if uni==1 else st[6+u] for u in range(uni)]
    inc=[c['step']*(1 if uni==1 else 2**((2.0*u/(uni-1)-1)*c['detune']/12)) for u in range(uni)]
    ug=1/math.sqrt(uni); npart=min(16,c['npart']) if partial else 0
    pr=[(k+1)*math.sqrt(1+c['stretch']*(k+1)*(k+1)) for k in range(npart)]
    na=[next((k for k in range(npart) if inc[u]*pr[k]>=.45*2048),npart) for u in range(uni)] if partial else []
    ic1,ic2=st[13],st[14]; a1=a2=a3=0.; kk=2.
    subph=st[15]; substep=c['step']/(4 if c['suboct']==2 else 2)
    ftype=c['ftype']; sub=c['sub']; gain=c['gain']; rate=c['rate']; A=c['a']; D=c['d']; sus=c['sus']
    for i in range(n):
        if c['released']:
            level=base*max(0,1-r/c['rel']); r+=1
            if level<=0:result|=1; break
        elif age<A:level=age/A
        elif age<A+D:level=1-(1-sus)*(age-A)/D
        else:level=sus
        if ftype and (i&15)==0:
            fc=c['cutoff']*2**(c['envamt']*level)
            fc=20 if fc<20 else .45*rate if fc>.45*rate else fc
            g=math.tan(math.pi*fc/rate); kk=2-1.96*c['reso']
            a1=1/(1+g*(g+kk)); a2=g*a1; a3=g*a2
        s=0.
        if partial:
            for k in range(na[0]):st[16+k]+=(W[k]-st[16+k])*.002
            for u in range(uni):
                su=0.
                for k in range(na[u]):
                    dk=inc[u]*pr[k]
                    idx=32+u*16+k; pp=st[idx]; j=int(pp); fr=pp-j
                    su+=st[16+k]*(VSINE[j]+(VSINE[j+1]-VSINE[j])*fr)
                    pp+=dk
                    if pp>=2048:pp=math.fmod(pp,2048)
                    st[idx]=pp
                s+=su; ph[u]+=inc[u]
                if ph[u]>=2048:ph[u]=math.fmod(ph[u],2048)
        else:
            for u in range(uni):
                j=int(ph[u]); fr=ph[u]-j; j2=(j+1)&2047
                su=tab[j]+(tab[j2]-tab[j])*fr
                if prev is not None:su=su*xf+(prev[j]+(prev[j2]-prev[j])*fr)*(1-xf)
                s+=su; ph[u]+=inc[u]
                if ph[u]>=2048:ph[u]=math.fmod(ph[u],2048)
            if prev is not None:
                xf+=1/256
                if xf>=1:xf=1.; prev=None; result|=2
        s*=ug
        if sub>0:
            j=int(subph); fr=subph-j; s+=sub*.7*(VSINE[j]+(VSINE[j+1]-VSINE[j])*fr)
        subph+=substep
        if subph>=2048:subph=math.fmod(subph,2048)
        if ftype:
            v3=s-ic2; v1=a1*ic1+a2*v3; v2=ic2+a2*ic1+a3*v3
            ic1=2*v1-ic1; ic2=2*v2-ic2
            s=v2 if ftype==1 else v1 if ftype==2 else s-kk*v1-v2
        out[i]+=s*level*gain
        age+=1
    if uni==1:st[0]=ph[0]
    else:
        for u in range(uni):st[6+u]=ph[u]
        st[0]=ph[0]
    st[1]=age; st[2]=r; st[3]=base; st[4]=level; st[5]=xf; st[13]=ic1; st[14]=ic2; st[15]=subph
    return result

RESONATOR=FX_ORDER.index('resonator')

class Engine(DrumEngine):
    def __init__(self,rate=48000):
        self.rate=rate; self.project=Project(); self.synths=[Synth(rate) for _ in range(4)]
        self.fx=[TrackFx(rate) for _ in range(4)]
        self.selected=0; self.playing=False; self.recording=False; self.frame=0
        self.pending={}; self.down=set(); self.capture_sustain=set(); self.history=[]; self.record_start=0; self.record_end=0; self.click_age=99999; self.limit=1.
        self.perform_held=HeldNotes(); self.live_note_map={}; self.mutation_sessions={}; self.arp_anchor_beat=0.
        self.arp_paused=False; self.arp_resume_phase=0
        self.scheduled_live=[]; self.absolute_frame=0
        # Step record cursor (not saved): the step the next recorded key goes to.
        self.rec_step=0; self.rec_last=None
        self.clock_times=deque(maxlen=24);self.clock_following=False;self.clock_last_ts=0.
        self.init_drums()
        self.configure()
    def configure(self):
        for t,s in zip(self.project.tracks,self.synths): s.configure(t['instrument'])
        for t,fx in zip(self.project.tracks,self.fx): fx.configure(t.get('fx'))
        self.configure_drums()
    def set_fx(self,track,chain):
        """Replace one track's FX chain (validated); applies on the next audio block."""
        clean=validate_fx(chain); self.project.tracks[track]['fx']=clean; self.fx[track].configure(clean)
    def seed_spectral(self,track,name):
        """One owned/validated shape gesture; base partials and seed metadata commit together."""
        from .devices import track_index
        track_index(track)
        if track!=self.selected:raise ValueError('Track changed; choose the shape again')
        t=self.project.tracks[track]
        if device_kind(t)!='synth':raise ValueError('Choose a synth track for spectral shapes')
        previous=t['instrument'].get('random_seed',0)
        seed=next_seed(previous) if name=='RANDOM' else previous
        harmonics=seed_shape(name,seed)
        params={**t['instrument'],'harmonics':harmonics,'spectral_energy':1}
        if name=='RANDOM':params['random_seed']=seed
        self.snapshot();t['instrument']=params;self.synths[track].configure(params)
    def reorder_fx(self,track,order):
        """Commit one validated drag/keyboard reorder with one existing project Undo entry."""
        if type(track) is not int or not 0<=track<len(self.project.tracks):
            raise ValueError('Invalid FX track')
        if not isinstance(order,list) or any(not isinstance(x,str) for x in order):
            raise ValueError('Invalid FX order')
        chain=validate_fx(self.project.tracks[track].get('fx',default_fx()))
        active=[m['id'] for m in chain['modules'] if m['on']]
        if len(order)!=len(active) or len(set(order))!=len(order) or set(order)!=set(active):
            raise ValueError('FX chain changed; reorder rejected')
        if order==active:return
        modules={m['id']:m for m in chain['modules']}
        chain['modules']=[modules[x] for x in order]+[m for m in chain['modules'] if not m['on']]
        self.snapshot();self.set_fx(track,chain)
    def apply_preset(self,name):
        """Load a library preset (sound and its FX chain) on the selected track, with undo."""
        from .library import preset
        p=preset(name); ins=p['instrument'] if p else instrument(name)
        self.snapshot(); t=self.project.tracks[self.selected]; t['preset']=name; t['instrument']=ins
        if p:t['fx']=validate_fx(p['fx'])
        self.synths[self.selected].panic(); self.synths[self.selected].configure(ins)
        if p:self.fx[self.selected].configure(t['fx'])
    CLEANUPS=('effects','sound','mods','links','all')
    def cleanup(self,action):
        """Clean-up from Settings. Each action is one undo step.
        effects: remove every effect on the selected track (and the links that pointed at them; Sound links stay)
        sound:   put the selected track's sound back to its preset's start sound
        mods:    flatten the selected track's 8 mod pads and remove every macro and pad link
        links:   remove every macro and pad link on all four tracks, keeping sounds and effects
        all:     start over with an empty session"""
        if action not in self.CLEANUPS:raise ValueError('Unknown clean-up: '+str(action))
        self.snapshot()
        def unlinked(chain):
            for src in chain['macros']+chain['mods']:src['targets']=[]
            return chain
        if action=='all':
            self.stop(); self.project=Project(); self.mutation_sessions.clear(); self.configure(); return
        if action=='links':
            for i,t in enumerate(self.project.tracks):
                if 'fx' in t:t['fx']=validate_fx(unlinked(copy.deepcopy(t['fx']))); self.fx[i].configure(t['fx'])
            return
        t=self.project.tracks[self.selected]
        if action=='sound':
            from .library import preset
            p=preset(t['preset'])
            try:ins=p['instrument'] if p else instrument(t['preset'])
            except ValueError:ins=instrument('Warm Keys')
            t['instrument']=copy.deepcopy(ins); self.synths[self.selected].panic(); self.synths[self.selected].configure(t['instrument'])
            return
        chain=copy.deepcopy(t.get('fx') or default_fx())
        if action=='effects':
            for m in chain['modules']:m['on']=False
            for src in chain['macros']+chain['mods']:src['targets']=[x for x in src['targets'] if x['module']=='sound']
        else:
            base=default_fx(); chain['mods']=base['mods']; chain=unlinked(chain)
        t['fx']=validate_fx(chain); self.fx[self.selected].configure(t['fx'])
    def fx_levels(self): return [fx.levels() for fx in self.fx]
    def fx_live(self,track):
        """Effective (modulated) FX params and mod-pad values of one track, for the UI."""
        fx=self.fx[track]; return dict(params=[round(v,4) for v in fx.params],mods=[round(v,3) for v in fx.mod_values],
                    phases=[round(v,3) for v in fx.mod_phases],puck=[round(v,3) for v in fx.puck],
                    sound=self.sound_live(track),comp=fx.comp_reduction(),strings=list(fx.tuned))
    def sound_live(self,track):
        """Where each linked Sound knob is right now, for the rings on the Sound cards."""
        fx=self.fx[track]; s=self.synths[track]; t=self.project.tracks[track]; out={}
        for k,v in fx.sound.items():
            lo,hi=SOUND_PARAMS[k]
            base=t['volume'] if k=='volume' else t['instrument'].get(k,SPECTRAL_DEFAULTS.get(k,0.))
            out[k]=round(min(hi,max(lo,base+v)),4)
        return out
    @property
    def fpb(self): return self.rate*60/self.project.bpm
    @property
    def beat(self): return self.frame/self.fpb
    def snapshot(self,pattern_address=None,after_pattern=None,seed_after=None,mode_after=None):
        data=copy.deepcopy(self.project.data())
        data['_mutation_sessions']=copy.deepcopy(self.mutation_sessions)
        if pattern_address is not None:
            data['_pattern_edit']=dict(address=pattern_address,after=copy.deepcopy(after_pattern),
                                       seed_after=seed_after,mode_after=mode_after)
        self.history.append(data);self.history=self.history[-20:]
    def undo(self):
        if not self.history:return
        data=self.history[-1]
        if '_pattern_edit' in data:
            edit=data['_pattern_edit'];addr=edit['address']
            state=copy.deepcopy(self.project.performance)
            if state['patterns'].get(addr)!=edit['after']:
                raise ValueError('Pattern changed since this edit; undo rejected')
            previous=data['performance']
            if addr in previous['patterns']:state['patterns'][addr]=copy.deepcopy(previous['patterns'][addr])
            else:state['patterns'].pop(addr,None)
            if state['seq']['mutate_seed']==edit['seed_after']:
                state['seq']['mutate_seed']=previous['seq']['mutate_seed']
            if edit.get('mode_after')==(state['seq']['enabled'],state['arp']['enabled']):
                for section in ('seq','arp'):state[section]['enabled']=previous[section]['enabled']
            if slot_key(state['seq']['bank'],state['seq']['slot'])==addr:
                if addr not in state['patterns']:
                    for key in ('length','division','gate','swing'):state['seq'][key]=previous['seq'][key]
                reconcile_pattern_timing(state)
            state['seq']['recording']=False
            state=validate_performance(state)
            self.stop();self.project.performance=state;self.history.pop()
            session=data.get('_mutation_sessions',{}).get(addr)
            if session is None:self.mutation_sessions.pop(addr,None)
            else:self.mutation_sessions[addr]=copy.deepcopy(session)
            return
        self.stop(); d=self.history.pop(); self.project.tracks=d['tracks']; self.project.bpm=d['bpm']; self.project.bars=d['bars']
        self.project.song=d.get('song',self.project.song)
        if 'clips' in d:self.project.clips=d['clips']
        self.project.metronome=d['metronome']
        self.project.performance=copy.deepcopy(d.get('performance',performance_defaults()))
        self.project.performance['seq']['recording']=False
        self.mutation_sessions=copy.deepcopy(d.get('_mutation_sessions',{}))
        self.configure()
    def record(self,track):
        if self.recording:self.finish_record()
        self.snapshot(); self.select(track)
        if not self.playing: self.frame=0
        self.playing=True; self.recording=True; self.record_start=self.frame
        self.record_end=self.frame+round(self.project.beats*self.fpb)
    def quantize(self,track):
        self.snapshot(); self.stop(); self.project.quantize(track)
    def set_song(self,song):
        """Replace the song arrangement (validated), with undo."""
        clean=songs.validate(song,self.project.bars); self.snapshot()
        if clean['on']!=self.project.song['on']:self.release_loops()
        self.project.song=clean
    def release_loops(self):
        """Let go of the loop and song notes still sounding (their note-offs won't come any more)."""
        for s in self.synths:
            for k,v in s.voices.items():
                if isinstance(k,tuple) and k[0]=='loop' and v['release'] is None:v['release']=(0,v['level'])
    def clip_action(self,track,action,clip=None,source=None):
        """Loops per track: open one for editing, copy one into another slot, or clear one."""
        if type(track) is not int or not 0<=track<4:raise ValueError('Choose track 1-4')
        if type(clip) is not int or not 0<=clip<songs.CLIPS:raise ValueError('Choose loop A-H')
        p=self.project; t=p.tracks[track]; slots=p.clips['slots'][track]; opened=p.clips['open'][track]
        def put(k,notes):
            if k==p.clips['open'][track]:t['notes']=notes
            else:slots[k]=notes
        if action=='open':
            if self.recording:self.finish_record()
            if clip!=opened and not (self.playing and p.song['on']):
                # Loop mode: the old loop's notes won't get their note-offs any more, so release them now.
                # (A playing song picks clips from the timeline, so opening one changes nothing you hear.)
                for k,v in self.synths[track].voices.items():
                    if isinstance(k,tuple) and k[0]=='loop' and v['release'] is None:v['release']=(0,v['level'])
            if clip!=opened:
                slots[opened]=t['notes']; t['notes']=slots[clip]; slots[clip]=[]; p.clips['open'][track]=clip
        elif action=='copy':
            if type(source) is not int or not 0<=source<songs.CLIPS:raise ValueError('Choose the loop to copy')
            self.snapshot(); put(clip,copy.deepcopy(p.clip_notes(track,source)))
        elif action=='clear':
            self.snapshot(); put(clip,[])
        else:raise ValueError('Unknown loop action')
    def song_position(self):
        """Where the song is: timeline bar, song length and the marker it falls under (None in loop mode)."""
        song=self.project.song
        if not song['on']:return None
        bar=songs.song_bar(song,int(self.frame/(4*self.fpb)))
        if bar is None:return None
        m=songs.marker_at(song,bar)
        return dict(bar=bar,length=song['length'],marker=m,name=None if m is None else song['markers'][m]['name'])
    def set_bars(self,bars):
        if bars not in (1,2,4,8):raise ValueError('Loop length must be 1, 2, 4 or 8 bars')
        self.snapshot(); self.stop(); self.project.bars=bars
        for t in self.project.tracks:
            for n in t['notes']:
                n['start']%=self.project.beats; n['duration']=min(n['duration'],self.project.beats)
        for track in self.project.clips['slots']:
            for clip in track:
                for n in clip:
                    n['start']%=self.project.beats; n['duration']=min(n['duration'],self.project.beats)
    def voice_on(self,track,note,velocity,token):
        if device_kind(self.project.tracks[track])=='drum_rack':
            hit=False if self.project.tracks[track]['mute'] else self.drums[track].on(note,velocity,token)
            if hit:self.drum_frames[track][note-36]=self.absolute_frame if self._event_frame is None else self._event_frame
            return hit
        fading=lambda k:isinstance(k,tuple) and k[0]=='fade'
        candidates=[(s,k,v) for s in self.synths for k,v in s.voices.items() if not fading(k)]
        if len(candidates)>=24:
            # Steal the quietest-to-lose voice (released first, then oldest) with a short fade, not a cut.
            s,k,_=min(candidates,key=lambda item:(item[2]['release'] is None,-item[2]['age']))
            s.fade(k)
        self.synths[track].on(note,velocity,token); self.fx[track].retrigger()
    def select(self,track):
        from .devices import track_index
        track_index(track)
        if track!=self.selected:
            if self.recording: self.finish_record()
            self.drum_keys={key:owner for key,owner in self.drum_keys.items() if owner!=self.selected}
            s=self.synths[self.selected]
            for key in list(s.voices):
                if isinstance(key,tuple) and key[0]=='live':s.voices.pop(key)
                elif isinstance(key,tuple) and key[0] in ('perf_seq','perf_arp'):s.off(0,key)
            s.pedal(False); s.bend=1.; self.down.clear(); self.capture_sustain.clear()
            self.perform_held.reset(); self.live_note_map.clear(); self.scheduled_live.clear(); self.selected=track
    def close_note(self,key,at=None):
        if key in self.pending:
            start,vel,track=self.pending.pop(key)
            end=self.frame if at is None else at
            duration=min(self.project.beats,max(1/self.fpb,(end-start)/self.fpb))
            out_note=key[2] if len(key)>=3 else key[1]
            self.project.tracks[track]['notes'].append(dict(start=(start/self.fpb)%self.project.beats,duration=duration,note=out_note,velocity=vel))
    def finish_record(self):
        for key in list(self.pending): self.close_note(key)
        self.recording=False
    def stop(self):
        self.finish_record(); self.down.clear(); self.capture_sustain.clear(); self.playing=False; self.frame=0
        self.project.performance['seq']['recording']=False
        for s in self.synths:s.panic()
        for rack in self.drums:rack.panic()
        self.drum_keys.clear()
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
        if section=='arp' and key=='enabled' and value:
            state['seq']['enabled']=False
            state['seq']['recording']=False
        state=validate_performance(state)
        if section=='seq' and key=='enabled' and value:self.perform_held.reset()
        if section=='arp' and key=='hold':self.perform_held.set_hold(value)
        if section=='sync' and key=='source':
            self.clock_times.clear();self.clock_following=False;self.clock_last_ts=0.
        if section=='seq' and key=='recording' and value:self.snapshot();self.rec_step=0;self.rec_last=None
        if section=='seq' and key in ('bank','slot'):self.rec_step=0;self.rec_last=None
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
        candidate=copy.deepcopy(state);candidate['patterns'][addr]=updated
        self._commit_pattern_edit(candidate,addr)
        return len(updated['steps'][index])

    def _commit_pattern_edit(self,state,addr,update_session=False,session=None):
        state=validate_performance(state)
        modes=(state['seq']['enabled'],state['arp']['enabled'])
        before=self.project.performance
        mode_after=modes if modes!=(before['seq']['enabled'],before['arp']['enabled']) else None
        self.release_performance('perf_seq')
        self.snapshot(addr,state['patterns'].get(addr),state['seq']['mutate_seed'],mode_after)
        self.project.performance=state
        if update_session:
            if session is None:self.mutation_sessions.pop(addr,None)
            else:self.mutation_sessions[addr]=session

    def arp_interrupt(self,action):
        """Arp Stop: silence it and forget the latched chord. Pause: silence it but keep the chord and the step;
        Resume picks up on the next grid step, on the step after the one it stopped at."""
        arp=self.project.performance['arp']; size=DIVISIONS[arp['division']]
        next_tick=int(math.ceil(self.beat/size-1e-9))
        if action=='arp_stop':
            self.release_performance('perf_arp'); self.perform_held.reset(); self.arp_paused=False
        elif action=='arp_pause':
            if self.arp_paused:
                self.arp_anchor_beat=max(0.,(next_tick-self.arp_resume_phase)*size); self.arp_paused=False
            else:
                first=int(math.ceil(self.arp_anchor_beat/size-1e-9))
                self.arp_resume_phase=max(0,next_tick-first); self.arp_paused=True
                self.release_performance('perf_arp')
        return self.arp_paused
    def perform_action(self,action,value=None):
        if action in ('arp_stop','arp_pause'):return self.arp_interrupt(action)
        if action in ('rec_cursor','rec_rest','rec_back'):
            length=current_pattern(self.project.performance)['length']
            if action=='rec_cursor':
                if type(value) is not int or not 0<=value<length:raise ValueError('Step must be inside the pattern')
                self.rec_step=value
            elif action=='rec_rest':self.rec_step=(self.rec_step+1)%length
            else:
                self.rec_step=(self.rec_step-1)%length
                # Back clears the step it lands on, so it can be recorded again.
                state=self.project.performance
                if current_pattern(state)['steps'][self.rec_step]:self.perform_step(self.rec_step,[],True)
            self.rec_last=None
            return self.rec_step
        pattern_edit=action in ('capture_song','clear','double','nudge','octave','mutate','reset_mutate','arp_to_seq','paste_pattern')
        state=copy.deepcopy(self.project.performance)
        session=None;song_notes=None
        seq=state['seq']; addr=slot_key(seq['bank'],seq['slot'])
        pattern=current_pattern(state)
        if action=='capture_song':
            state['patterns'][addr]=pattern_from_song(self.project.tracks[self.selected]['notes'],
                         self.project.bars,seq['division'],seq['length'])
        elif action=='commit_song':
            if value not in ('add','replace'):raise ValueError('Choose add or replace')
            notes=song_from_pattern(pattern,self.project.bars,seq['transpose'],fill=True)
            if len(notes)>100000:raise ValueError('Too many MIDI notes')
            song_notes=notes;seq['recording']=False
        elif action=='paste_pattern':
            if type(value) is not str or value.count(':')!=1:raise ValueError('Paste needs a bank:pattern address')
            source_addr=slot_key(*value.split(':'))
            source=state['patterns'].get(source_addr)
            if source is None:raise ValueError('That pattern is empty')
            state['patterns'][addr]=copy.deepcopy(source)
            reconcile_pattern_timing(state,state['patterns'][addr])
        elif action=='clear':
            state['patterns'][addr]=step_change(pattern,0,[],True)
            for step in state['patterns'][addr]['steps']:step.clear()
        elif action=='double':
            if pattern['length']*2>64:raise ValueError('Maximum 64 sequence steps')
            doubled=change_pattern_length(pattern,pattern['length']*2)
            doubled['steps'][pattern['length']:]=copy.deepcopy(pattern['steps'])
            state['patterns'][addr]=doubled; seq['length']=doubled['length']
        elif action=='nudge':
            if type(value) not in (int,float) or value not in (-1,1):raise ValueError('Nudge direction must be -1 or +1')
            direction=int(value);out=copy.deepcopy(pattern)
            out['steps']=[copy.deepcopy(pattern['steps'][(i-direction)%pattern['length']])
                          for i in range(pattern['length'])]
            state['patterns'][addr]=out
        elif action=='octave':
            if type(value) not in (int,float) or value not in (-1,1):raise ValueError('Octave direction must be -1 or +1')
            direction=int(value);out=copy.deepcopy(pattern)
            for step in out['steps']:
                for note in step:note['note']=max(0,min(127,note['note']+12*direction))
            state['patterns'][addr]=out
        elif action=='mutate':
            if (type(value) not in (int,float) or not math.isfinite(value)
                    or not 0<=value<=1):raise ValueError('Mutation strength 0-1')
            previous=self.mutation_sessions.get(addr)
            if previous is not None and pattern==previous['last']:session=copy.deepcopy(previous)
            else:session=dict(original=copy.deepcopy(pattern),present=addr in state['patterns'])
            seq['mutate_seed']=(seq['mutate_seed']+1)%1000000
            state['patterns'][addr]=mutate_pattern(pattern,value,seq['mutate_seed'])
            session['last']=copy.deepcopy(state['patterns'][addr])
        elif action=='reset_mutate':
            previous=self.mutation_sessions.get(addr)
            if previous is None:raise ValueError('No mutation to reset for this pattern')
            if pattern!=previous['last']:raise ValueError('Pattern changed after mutation; reset rejected')
            if previous['present']:state['patterns'][addr]=copy.deepcopy(previous['original'])
            else:state['patterns'].pop(addr,None)
        elif action=='arp_to_seq':
            notes=self.perform_held.held()
            if not notes:raise ValueError('Play or HOLD notes before Arp to Sequence')
            arp=state['arp']
            groups=arp_groups(notes,arp['mode'],arp['octaves'],arp['seed'],octave_mode=arp['octave_mode'])
            self.rec_step=0;self.rec_last=None
            out=change_pattern_length(pattern,max(1,min(64,len(groups))))
            out['division']=arp['division'];out['gate']=arp['gate'];out['swing']=arp['swing']
            out['steps']=[[dict(note=n,velocity=100,tie=1) for n in group[:8]] for group in groups[:out['length']]]
            state['patterns'][addr]=out; seq['division']=out['division'];seq['length']=out['length']
            seq['enabled']=True;arp['enabled']=False
        elif action=='quantize':
            strength=seq['quantize_strength']
            # Step data is already on-grid. This action quantizes the selected song track.
            snap=DIVISIONS[seq['division']]
            song_notes=copy.deepcopy(self.project.tracks[self.selected]['notes'])
            for note in song_notes:
                original=note['start']; target=round(original/snap)*snap
                note['start']=(original+(target-original)*strength)%self.project.beats
        elif action=='load_factory':
            from .library import factory_bank
            if type(value) is not int:raise ValueError('Choose a pattern bank 1-4')
            for key,pat in factory_bank(value).items():
                state['patterns'][key]=pat;self.mutation_sessions.pop(key,None)
            reconcile_pattern_timing(state)
        elif action=='learn_chord':
            notes=self.perform_held.held()
            if not notes:raise ValueError('Hold MIDI notes before learning a chord')
            return self.perform_action('save_chord',notes)
        elif action=='save_slot':
            if (not isinstance(value,list) or len(value)!=2 or type(value[0]) is not int
                    or not 0<=value[0]<8 or not isinstance(value[1],list) or not 1<=len(value[1])<=8):
                raise ValueError('Save a chord of 1-8 notes to slot 1-8')
            state['chord']['slots'][value[0]]=sorted(set(int(n) for n in value[1]))
        elif action=='clear_slot':
            if type(value) is not int or not 0<=value<8:raise ValueError('Choose chord slot 1-8')
            state['chord']['slots'][value]=[]
        elif action=='save_chord':
            if not isinstance(value,list) or not 1<=len(value)<=16:
                raise ValueError('Chord memory needs 1-16 notes')
            root=int(value[0]); offsets=[max(-48,min(48,int(x)-root)) for x in value]
            state['chord']['user']=offsets; state['chord']['preset']='User'
        else:raise ValueError('Unknown performance action')
        if pattern_edit:
            reconcile_pattern_timing(state)
            self._commit_pattern_edit(state,addr,action in ('mutate','reset_mutate'),session)
            return action
        validated=validate_performance(state)
        self.release_performance('perf_seq');self.snapshot()
        if action=='commit_song':
            self.stop()
            if value=='replace':self.project.tracks[self.selected]['notes']=song_notes
            else:self.project.tracks[self.selected]['notes'].extend(song_notes)
        elif action=='quantize':self.project.tracks[self.selected]['notes']=song_notes
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

    def midi(self,status,note,value,notes=None):
        """A MIDI message. `notes` (chord pads) gives the exact pitches to sound for this key,
        instead of expanding the key through chord mode and the scale."""
        if self.drum_midi(status,note,value):return
        kind=status&0xf0; ch=status&15; s=self.synths[self.selected]; key=(ch,note)
        explicit=notes is not None
        if explicit:
            if (not isinstance(notes,list) or not 1<=len(notes)<=8 or
                    not all(type(n) is int and 0<=n<=127 for n in notes)):raise ValueError('Chord pad needs 1-8 notes 0-127')
            notes=sorted(set(notes))
        state=self.project.performance; channel=state['scale']['input_channel']
        if channel and ch!=channel-1:return
        if kind==0x90 and value:
            for k in list(self.pending):
                if k[:2]==key:self.close_note(k)
            for old in self.live_note_map.pop(key,[]):
                s.off(old,('live',ch,note,old))
            self.scheduled_live=[item for item in self.scheduled_live if item[4]!=key]
            if notes is None:notes=chord_notes(state,note,value)
            velocity=velocity_transform(value,state['scale']['velocity_curve'])
            self.down.add(key)
            fresh=not self.perform_held.keys
            if state['arp']['enabled']:self.release_performance('perf_arp')
            self.perform_held.on(key,notes,velocity)
            if state['arp']['enabled']:
                # The Arpeggiator starts with the first held key, even without a song clip. A key also ends a pause.
                if self.arp_paused:self.arp_paused=False; fresh=True
                self.live_note_map[key]=[]
                if not self.playing:self.frame=0
                self.playing=True
                # A new phrase (or every key with Retrigger) starts on the pattern's first step.
                if fresh or state['arp']['retrigger']:self.arp_anchor_beat=self.beat
            else:
                order=notes[:]
                strum=state['chord']['strum_ms'] if state['chord']['enabled'] or explicit else 0
                direction=state['chord']['strum_type']
                if direction in ('Down','Alt Down'):order.reverse()
                if direction in ('Alt Up','Alt Down') and len(order)>2:
                    order=order[::2]+order[1::2]
                self.live_note_map[key]=order[:]
                for i,pitch in enumerate(order):
                    token=('live',ch,note,pitch)
                    sync=STRUM_SYNC.get(state['chord'].get('strum_sync','Off'),0.) if state['chord']['enabled'] or explicit else 0.
                    delay=max(0,round(sync*i*self.fpb)) if sync else max(0,round(strum*i*self.rate/1000))
                    if delay:
                        self.scheduled_live.append((self.absolute_frame+delay,self.selected,pitch,velocity,key,token))
                    else:
                        self.voice_on(self.selected,pitch,velocity,token)
                        if self.recording:self.pending[(ch,note,pitch)]=(self.frame,velocity,self.selected)
            if state['seq']['recording']:
                pattern=current_pattern(state)
                emitted=[dict(note=n,velocity=velocity,tie=1) for n in notes[:8]]
                # Keys pressed together (within 80 ms, earlier ones still held) form one chord on one step.
                last=self.rec_last
                chord=(last is not None and len(self.down)>1 and
                       self.absolute_frame-last[0]<=.08*self.rate and last[1]<pattern['length'])
                if chord:
                    self.perform_step(last[1],emitted,False)
                    self.rec_last=(self.absolute_frame,last[1])
                else:
                    step=self.rec_step%pattern['length']
                    self.perform_step(step,emitted,not state['seq']['overdub'])
                    self.rec_last=(self.absolute_frame,step)
                    self.rec_step=(step+1)%pattern['length']
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
        for rack in self.drums:rack.panic()
        self.drum_keys.clear()
    def render(self,frames):
        result=[]; remaining=frames
        while remaining:
            n=min(remaining,128)
            if self.recording:n=min(n,max(1,self.record_end-self.frame))
            events={0:[]}; start=self.frame; end=start+n
            abs_start=self.absolute_frame; abs_end=abs_start+n
            # Macros and mod pads move FX and Sound knobs once per block, before the voices render.
            for fx,synth in zip(self.fx,self.synths):
                fx.modulate(abs_start/self.fpb); synth.modulate(fx.sound)
                # The resonator's strings follow the notes this track is playing.
                if fx.active and fx.on[RESONATOR]:
                    fx.tune([v['note'] for v in synth.voices.values() if v.get('release') is None],
                            self.project.performance['scale']['root'])
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
                song=self.project.song if self.project.song['on'] and not self.recording else None
                # A song that doesn't loop stops after its last bar: the transport rewinds and the
                # notes still sounding are released (not cut), so the ending rings out.
                if song and not song['loop'] and start>=round(song['length']*4*self.fpb):
                    self.playing=False; self.frame=0; start=0; end=n; self.release_loops()
                for tr,t in enumerate(self.project.tracks if self.playing else []):
                    if t['mute']:continue
                    if song:
                        # Timeline: each bar plays the bar of its block's clip that lines up with the grid.
                        for beat,action,key,bar,note in songs.song_events(song,lambda k:self.project.clip_notes(tr,k),tr,
                                                                          start/self.fpb-1,end/self.fpb+1,self.project.bars):
                            when=round(beat*self.fpb)
                            if start<=when<end:events.setdefault(when-start,[]).append((action,tr,key,bar,note))
                        continue
                    for cycle in range(max(0,int(start/loop)-1),int(end/loop)+1):
                        notes=t['notes']
                        for idx,note in enumerate(notes):
                            on=round(cycle*loop+note['start']*self.fpb); off=round(cycle*loop+(note['start']+note['duration'])*self.fpb)
                            for when,action in ((off,0),(on,1)):
                                if start<=when<end:events.setdefault(when-start,[]).append((action,tr,idx,cycle,note))
                # Stop/rewind moves the clock behind the phrase start: restart the phrase from there.
                if self.arp_anchor_beat*self.fpb>end:self.arp_anchor_beat=start/self.fpb
                if self.playing and not self.project.tracks[self.selected]['mute']:
                    generated=schedule_notes(self.project.performance,[] if self.arp_paused else self.perform_held.held(),
                                             start,end,self.fpb,velocities=self.perform_held.velocities(),
                                             arp_anchor=self.arp_anchor_beat*self.fpb)
                    for offset,action,pitch,velocity,token in generated:
                        events.setdefault(offset,[]).append((3,action,self.selected,pitch,velocity,token))
                if self.playing and self.project.metronome:
                    b=math.ceil(start/self.fpb); tick=round(b*self.fpb)
                    if start<=tick<end:events.setdefault(tick-start,[]).append((2,b))
            offsets=sorted(set(events)|{n})
            track_audio=[[] for _ in self.synths]; click=[]
            for pos,nextpos in zip(offsets,offsets[1:]):
                self._event_frame=abs_start+pos
                for event in sorted(events[pos],key=lambda x:x[0]):
                    if event[0]==2:self.click_age=0; self.click_freq=1500 if event[1]%4==0 else 1000; continue
                    if event[0]==3:
                        _,action,tr,pitch,velocity,token=event
                        rec_key=('gen',str(token),pitch)
                        if action:
                            self.voice_on(tr,pitch,velocity,token)
                            # REC captures what the arp and the sequencer play, like a played key.
                            if self.recording:
                                if rec_key in self.pending:self.close_note(rec_key)
                                self.pending[rec_key]=(self.frame+pos,velocity,tr)
                        else:
                            self.voice_off(tr,pitch,token)
                            if rec_key in self.pending:self.close_note(rec_key,self.frame+pos)
                        continue
                    if event[0]==4:
                        _,tr,pitch,velocity,source,token=event
                        self.voice_on(tr,pitch,velocity,token)
                        if self.recording:self.pending[(source[0],source[1],pitch)]=(self.frame+pos,velocity,tr)
                        continue
                    action,tr,idx,cycle,note=event; token=('loop',idx,cycle)
                    if action:self.voice_on(tr,note['note'],note['velocity'],token)
                    else:self.voice_off(tr,note['note'],token)
                count=nextpos-pos
                for tr,(buf,s) in enumerate(zip(track_audio,self.synths)):
                    part=s.render(count)
                    if device_kind(self.project.tracks[tr])=='drum_rack':self.drums[tr].render_into(part,count)
                    buf.extend(part)
                for j in range(count):
                    if self.click_age<self.rate*.025:
                        click.append(.15*math.sin(self.click_age/self.rate*2*math.pi*self.click_freq)*(1-self.click_age/(self.rate*.025)))
                        self.click_age+=1
                    else:click.append(None)
            # Per-track FX run once per block, then the mix is summed in the original order.
            mix=[0.]*n
            for t,fx,audio in zip(self.project.tracks,self.fx,track_audio):
                if not t['mute']:
                    audio=fx.process(audio,self.project.bpm,abs_start/self.fpb,modulated=True,
                                     clock=start/self.fpb if self.playing else None)
                    vol=min(1.,max(0.,t['volume']+fx.sound.get('volume',0.)))
                    for j,v in enumerate(audio):mix[j]+=v*vol
            # Master limiter: turns the mix down when it would go over 0.9 and lets go over ~40 ms,
            # instead of flattening the peaks (hard clipping sounds like crackle).
            g=self.limit
            for j,c in enumerate(click):
                x=mix[j]+(c if c is not None else 0.)
                ax=abs(x)*g
                if ax>.9:g=.9/abs(x)
                else:g+=(1.-g)*.0005
                x*=g
                mix[j]=x if -.95<x<.95 else math.tanh(x)
            self.limit=g
            result.extend(mix)
            if self.playing:self.frame+=n
            self.absolute_frame+=n
            self._event_frame=None
            if self.recording and self.frame>=self.record_end:self.finish_record()
            remaining-=n
        return result
