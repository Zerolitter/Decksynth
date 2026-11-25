"""Device-independent synthesis, MIDI and song model. Timing is in quarter-note beats."""
import copy
from collections import deque
import json
import ctypes
import math
import os
from pathlib import Path
import struct
from functools import lru_cache
from itertools import chain
from operator import add
from . import song as songs
from . import sends as send_buses
from . import cbus
from .devices import device_kind
# Clip loop lengths in bars (15 Nov: up to 32). Any whole number of bars works (17 Nov:
# a Structure that ends on bar 17 makes a 17-bar clip); BAR_CHOICES are the quick picks.
BAR_CHOICES=(1,2,4,8,16,32)
MAX_BARS=32
def valid_bars(bars):return type(bars) is int and 1<=bars<=MAX_BARS
from .drum_rack import validate_kit
from .drum_engine import DrumEngine
from .freeze_engine import FreezeEngine
from .freeze import validate_freeze
from .sampler_engine import SamplerEngine
from .sampler import validate_sampler
from .spectral import seed_shape, next_seed, validate_metadata, energy_norm
from .spectral_native import prepare_kernel as prepare_spectral_kernel, bound_table
from .fx import TrackFx, SOUND_PARAMS, ORDER as FX_ORDER, build_table, native_voice, native_voice2, native_voice_curve, MasterStage, DsVoice, default_chain as default_fx, validate_chain as validate_fx
from .filter_native import prepare_kernel as prepare_filter_kernel, native_voice as native_filter_voice, DsFilter
from .controllers import ControllerEngine,validate_mappings
from .expression import ExpressionVoice
from . import strike, sample_layer
from .keystep import (defaults as performance_defaults, validate_state as validate_performance,
                      current_pattern, empty_pattern, slot_key, step_change, change_pattern_length,
                      mutate_pattern, song_from_pattern, pattern_from_song, chord_notes, clip_to_pattern, MAX_STEPS,
                      velocity_transform, HeldNotes, schedule_notes, arp_groups, DIVISIONS,
                      reconcile_pattern_timing, STRUM_SYNC, arp_view,
                      chord_upper, follow_chord, CHORD_ADVANCE, CHORD_LOOP_RATES)
CHORD_ADDED_16NOV=dict(inversion=0,ext='triad',follow=False,advance='Key',loop=False,loop_rate='1/4',tension=0)

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
VOICE_RANGES.update(vcf_morph=(0,1),fenv_a=(.001,3),fenv_d=(.001,3),fenv_s=(0,1),fenv_r=(.01,3))
FILTER_ENV=dict(fenv_a='attack',fenv_d='decay',fenv_s='sustain',fenv_r='release')
VOICE_CHOICES=dict(vcf_type=(0,1,2,3),uni_voices=(1,2,3,4,5,7),sub_oct=(1,2))
EXPRESSION_DEFAULTS=dict(pan=0.,play_mode=0,glide=0.,pitch=0.,velocity_brightness=0.,velocity_cutoff=0.,vcf_keytrack=.5)
VOICE_RANGES.update(pan=(-1,1),glide=(0,2),pitch=(-12,12),velocity_brightness=(-1,1),velocity_cutoff=(-1,1),vcf_keytrack=(0,1))
VOICE_CHOICES['play_mode']=(0,1,2)
# Full-sound keys (17 Nov): Shape (env_curve) bends the decay and release (an even fade to the ear, like a
# struck string, instead of a straight line that holds loud and drops at the end), Air extends the spectrum past partial 16 (low notes keep their top), Drift gives each note its own
# start phase and a few cents of tuning, Dynamics widens how much softer a soft note is. 0 = the old sound.
TONE_DEFAULTS=dict(env_curve=0.,air=0.,drift=0.,vel_curve=0.,gain=1.)
# gain: the preset's own level (factory presets are level-matched with tools/measure_sound.py).
VOICE_RANGES.update(env_curve=(0,1),air=(0,1),drift=(0,1),vel_curve=(0,1),gain=(.25,8))
EXPRESSION_DEFAULTS.update(TONE_DEFAULTS)
# Strike card (24 Nov): damping, attack noise and a pitch envelope (strike.py). 0 = the old sound.
EXPRESSION_DEFAULTS.update(strike.STRIKE_DEFAULTS); VOICE_RANGES.update(strike.STRIKE_RANGES); VOICE_CHOICES.update(strike.STRIKE_CHOICES)
# Sample layer (25 Nov): a recording under the partials (sample_layer.py). layer_on 0 = the old sound; the file itself is the text key layer_file.
EXPRESSION_DEFAULTS.update(sample_layer.LAYER_DEFAULTS); VOICE_RANGES.update(sample_layer.LAYER_RANGES); VOICE_CHOICES.update(sample_layer.LAYER_CHOICES)
PARAM_DEFAULTS={**SPECTRAL_DEFAULTS,**VOICE_DEFAULTS,**EXPRESSION_DEFAULTS}
def sound_default(p,key):
    if key in FILTER_ENV:return p[FILTER_ENV[key]]
    if key=='vcf_morph':return max(0,p.get('vcf_type',1)-1)/2
    return PARAM_DEFAULTS.get(key,0.)

def filter_extended(p):return 'vcf_morph' in p or any(k in p for k in FILTER_ENV)

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

def cutoff_hz(p,note,velocity=None):
    """Filter card cutoff 0-1 as Hz (20 Hz-18 kHz), following the keyboard at half strength."""
    return 20*900**p.get('vcf_cutoff',.65)*2**((note-60)/12*p.get('vcf_keytrack',.5)+(0 if velocity is None else (velocity-.5)*2*p.get('velocity_cutoff',0.)*6))

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

def validate_instrument(ins):
    assert isinstance(ins,dict) and len(ins['harmonics'])==16
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
    if 'layer_file' in ins:assert sample_layer.valid_file(ins['layer_file'])

CLIP_NAME_MAX=24
def clean_clip_name(name):
    """A clip name: plain text on one line, at most 24 characters; '' means the clip's letter."""
    if name is None:return ''
    if not isinstance(name,str):raise ValueError('A clip name is text')
    return ' '.join(name.split())[:CLIP_NAME_MAX]

class Project:
    def __init__(self):
        self.bpm=120; self.bars=4; self.metronome=False
        self.tracks=[dict(name=f'Track {i+1}',preset=n,instrument=instrument(n),volume=.7,mute=False,notes=[])
                     for i,n in enumerate(['Warm Keys','Bass','Atmospheric Pad','Bell'])]
        self.performance=performance_defaults()
        self.song=songs.defaults(); self.clips=songs.empty_clips()
        self.sends=send_buses.defaults()
    @property
    def beats(self): return self.bars*4
    def clip_notes(self,track,clip):
        """A track's loop by slot. The open loop lives in the track's own 'notes', as it always has."""
        return self.tracks[track]['notes'] if clip==self.clips['open'][track] else self.clips['slots'][track][clip]
    def clips_data(self):
        return dict(open=self.clips['open'],slots=[[self.clip_notes(tr,k) for k in range(songs.CLIPS)] for tr in range(len(self.tracks))])
    def data(self):
        d=dict(version=1,bpm=self.bpm,bars=self.bars,metronome=self.metronome,
               tracks=self.tracks,performance=self.performance,song=self.song,clips=self.clips_data())
        # Shared send settings are saved once changed, so older projects stay byte-for-byte the same.
        if self.sends!=send_buses.defaults():d['sends']=self.sends
        return d
    def saved_data(self):
        """The file form: chord settings added on 16 Nov are written once they differ from their
        defaults, so older projects stay byte-for-byte the same (loading fills them in again)."""
        d=self.data();chord=self.performance['chord']
        fresh={k:v for k,v in CHORD_ADDED_16NOV.items() if chord.get(k)==v}
        if fresh:d['performance']=dict(d['performance'],chord={k:v for k,v in chord.items() if k not in fresh})
        return d
    def save(self,path):
        path=Path(path); temp=path.with_suffix(path.suffix+'.tmp')
        with temp.open('w') as f:
            json.dump(self.saved_data(),f,indent=2,allow_nan=False); f.flush(); os.fsync(f.fileno())
        os.replace(temp,path)
    @classmethod
    def load(cls,path):
        try:
            d=json.loads(Path(path).read_text()); p=cls()
            assert d['version']==1 and 30<=d['bpm']<=240 and valid_bars(d['bars'])
            from .devices import MIN_TRACKS,MAX_TRACKS
            assert isinstance(d['metronome'],bool) and MIN_TRACKS<=len(d['tracks'])<=MAX_TRACKS
            for t in d['tracks']:
                assert isinstance(t['name'],str) and len(t['name'])<=100
                assert isinstance(t['preset'],str) and 0<=t['volume']<=1 and isinstance(t['mute'],bool)
                if 'midi_cc' in t:t['midi_cc']=validate_mappings(t['midi_cc'])
                kind=device_kind(t)
                if 'drum_rack' in t:t['drum_rack']=validate_kit(t['drum_rack'])
                if kind=='drum_rack' and 'drum_rack' not in t:raise ValueError('Drum Rack kit is missing')
                if 'sampler' in t:t['sampler']=validate_sampler(t['sampler'])
                if kind=='sampler' and 'sampler' not in t:raise ValueError('Sampler is missing')
                validate_instrument(t['instrument'])
                from .workflow import validate_ab,validate_automation
                if 'sound_ab' in t:t['sound_ab']=validate_ab(t['sound_ab'])
                if 'automation' in t:t['automation']=validate_automation(t['automation'])
                if 'fx' in t:t['fx']=validate_fx(t['fx'])
                if 'freeze' in t:t['freeze']=validate_freeze(t['freeze'])
                if 'sends' in t:t['sends']=send_buses.validate_track(t['sends'])
                if 'clip_names' in t:
                    assert isinstance(t['clip_names'],list) and len(t['clip_names'])==songs.CLIPS
                    t['clip_names']=[clean_clip_name(x) for x in t['clip_names']]
                if 'freeze_loop' in t:
                    t['freeze_loop']=validate_freeze(t['freeze_loop'])
                    if 'freeze' not in t or t['freeze_loop']['mode']!='loop' or t['freeze']['mode']!='song':raise ValueError('Invalid frozen track pair')
                assert len(t['notes'])<=100000
                for n in t['notes']:
                    assert 0<=n['start']<d['bars']*4 and 0<n['duration']<=d['bars']*4
                    assert math.isfinite(n['start']) and math.isfinite(n['duration'])
                    assert isinstance(n['note'],int) and 0<=n['note']<=127
                    assert isinstance(n['velocity'],int) and 1<=n['velocity']<=127
            p.bpm=d['bpm']; p.bars=d['bars']; p.metronome=d['metronome']; p.tracks=d['tracks']
            n=len(d['tracks'])
            p.song=songs.validate(d['song'],d['bars'],n) if 'song' in d else songs.defaults(d['bars'],n)
            p.clips=songs.validate_clips(d['clips'],d['bars']*4,n) if 'clips' in d else songs.empty_clips(n)
            p.performance=validate_performance(d['performance']) if 'performance' in d else performance_defaults()
            p.sends=send_buses.validate(d['sends']) if 'sends' in d else send_buses.defaults()
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
TABLE_KEYS=('filter',)+SPECTRAL_KEYS+('formant','vowel','spectral_energy','velocity_brightness','pitch','air')

def air_weights(p,h,weights,brightness,count):
    """Partials 17 and up for Air: the top of the drawn spectrum carries on falling (1/k, the odd/even
    pattern kept), rolled off by Brightness from where partial 16 was, with Air moving the corner up."""
    air=p.get('air',0.)
    if not air or count<=16:return weights
    c0=1+brightness*15; ca=c0+air*48; r16=1/(1+(16/c0)**4); a16=1/(1+(16/ca)**4)
    out=list(weights)
    for k in range(16,count):
        r=14 if (k-14)%2==0 else 15
        ref=h[r]*spectral_gain(p,r+1)
        out.append(air*ref*(r+1)/(k+1)*r16*(1/(1+(k/ca)**4))/a16)
    return out
TABLE_STEPS=48

class Synth(ExpressionVoice):
    def __init__(self,rate=48000):
        prepare_spectral_kernel()
        prepare_filter_kernel()
        self.rate=rate; self.params=instrument('Warm Keys'); self.voices={}; self.gated={}; self.sustain=False; self.bend=1.; self.mod_wheel=0.; self.tables={}; self.wave_cache={}; self.clock=0
        self.mono_held={};self.mono_lead=None;self._mono_internal=False
        self.live=None; self.shape=None; self.shape_key=None; self.shape_clock=-10**9
        self.weights={}; self.weight_cache={}; self.st=(ctypes.c_double*85)(); self.vargs=DsVoice(); self.fargs=DsFilter()
    def configure(self,p):
        if self.params.get('play_mode',0)!=p.get('play_mode',0):self.panic()
        changed=any(self.params.get(k)!=p.get(k) for k in ('harmonics',)+TABLE_KEYS)
        self.params=copy.deepcopy(p)
        if sample_layer.active(p):sample_layer.request(p['layer_file'],self.rate)   # decode in the background, never while rendering
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
            lo,hi=SOUND_PARAMS[k]; live[k]=min(hi,max(lo,self.params.get(k,sound_default(self.params,k))+v))
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
            new=self.table(v.get('table_note',v['note']),v['velocity'])
            if new is not v['table']:v['prev']=v['table']; v['xf']=0.; v['table']=new
    def table_key(self,note,velocity=None):
        p={**self.params,**self.shape} if self.shape else self.params
        return (note,velocity) if velocity is not None and 'velocity_brightness' in p else note
    def table(self,note,velocity=None):
        address=self.table_key(note,velocity)
        if address not in self.tables:
            p={**self.params,**self.shape} if self.shape else self.params
            h=p['harmonics']; frequency=440*2**((note-69)/12)
            # Leave pitch-bend headroom so the upper partials cannot alias at +2 semitones.
            guard=frequency*(2 if 'pitch' in p else 1)
            count=min(64 if p.get('air',0.) else 16,int(self.rate*.45/(guard*1.123)))
            vowel=formant_gains(p,frequency*2**(p.get('pitch',0)/12),count)
            brightness=p['filter']
            if velocity is not None and p.get('velocity_brightness',0):brightness=min(1.,max(.02,brightness+(velocity-.5)*2*p['velocity_brightness']))
            key=(count,self.shape_key) if vowel is None else (count,self.shape_key,note)
            # Vel bright also tilts the spectrum (17 Nov): a hard note lifts the upper partials, a soft one
            # leans on the fundamental, as a struck string does. Moving the brightness corner alone hardly
            # changed sounds whose partials already fall off early.
            tilt=round((velocity-.5)*2*p['velocity_brightness']*1.2,3) if velocity is not None and p.get('velocity_brightness',0) else 0.
            if 'velocity_brightness' in p:key=key+(brightness,tilt)
            if key not in self.wave_cache:
                weights=[h[k]*spectral_gain(p,k+1)/(1+(k/(1+brightness*15))**4) for k in range(min(16,count))]
                weights=air_weights(p,h,weights,brightness,count)
                if tilt:weights=[w*(k+1)**tilt for k,w in enumerate(weights)]
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
                self.weight_cache[key]=(ctypes.c_double*16)(*[w/norm for w in weights[:16]])
                if len(self.wave_cache)>=160:
                    old=next(iter(self.wave_cache)); self.wave_cache.pop(old); self.weight_cache.pop(old,None)
                self.wave_cache[key]=table
            self.tables[address]=self.wave_cache[key]; self.weights[address]=self.weight_cache[key]
        return self.tables[address]
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
        self.gated[token]=True
        if self.params.get('play_mode',0) and not self._mono_internal:return self.mono_on(note,velocity,token)
        if token in self.voices:self.fade(token)
        playing=[k for k in self.voices if not (isinstance(k,tuple) and k[0]=='fade')]
        if len(playing)>=24:self.fade(playing[0])
        self.voices[token]=dict(note=note,velocity=velocity/127,phase=0.,age=0,level=0.,release=None,held=True,table=self.table(note,velocity/127))
        drift=self.params.get('drift',0.)
        if drift:
            # Like an analog voice: its own start phase and a few cents of its own tuning (up to +-6 cents).
            rng=getattr(self,'rng',None) or self._seed_rng()
            self.voices[token].update(phase=rng.random()*2048,drift=2**(drift*(rng.random()*2-1)*6/1200))
    def _seed_rng(self):
        import random
        self.rng=random.Random(0x5eed); return self.rng
    @staticmethod
    def amp(v,p):
        """Note level from velocity: Dynamics 0 is the old straight line, 1 makes a soft note much softer."""
        vc=p.get('vel_curve',0.)
        return (v['velocity']**(1+vc*1.5) if vc else v['velocity'])*p.get('gain',1.)
    def off(self,note,token=None):
        key=note if token is None else token
        immediate=isinstance(token,tuple) and token[0] in ('loop','perf_seq','perf_arp')
        if key in self.gated:
            if self.sustain and not immediate:self.gated[key]=False
            else:self.gated.pop(key,None)
        if self.params.get('play_mode',0) and self.mono_off(key):return
        v=self.voices.get(key)
        if v:
            v['held']=False
            if not self.sustain or (isinstance(token,tuple) and token[0] in ('loop','perf_seq','perf_arp')): v['release']=(0,v['level'])
    def pedal(self,on):
        self.sustain=on
        if not on:
            self.gated={k:v for k,v in self.gated.items() if v}
            for v in self.voices.values():
                if not v['held'] and v['release'] is None: v['release']=(0,v['level'])
    def panic(self): self.layer=[]; self.voices.clear(); self.gated.clear(); self.mono_held.clear();self.mono_lead=None; self.sustain=False; self.bend=1.; self.mod_wheel=0.
    def heard_partials(self):
        voices=[v for v in self.voices.values() if not v.get('fast')]
        if not voices:return None
        v=voices[-1];weights=self.weights.get(self.table_key(v.get('table_note',v['note']),v['velocity']))
        if weights is None:return None
        norm=max(1e-9,max(abs(w) for w in weights))
        return [round(abs(w)/norm,6) for w in weights]
    @staticmethod
    def voice_mode(p):
        sub=p.get('sub',0.)>0
        return (int(p.get('uni_voices',1)),int(p.get('vcf_type',0)),p.get('inharm',0.)>0,int(p.get('sub_oct',1)) if sub else 0,filter_extended(p),strike.strikes(p))
    def _scratch(self,frames):
        buf=getattr(self,'scratch',None)
        if buf is None or len(buf)<frames:buf=self.scratch=(ctypes.c_double*max(frames,1024))()
        ctypes.memset(buf,0,8*frames); return buf
    def _strike(self,out,src,frames,v,p,gain):
        """Damping and attack noise on one voice (strike.py): src is the voice alone, added into out."""
        if 'sk' not in v:
            self.strike_seed=(getattr(self,'strike_seed',0)*1103515245+12345)&0x7fffffff
            v['sk']=strike.initial_state(v['age']); v['sk'][1]=float(self.strike_seed|1)
        e=strike.settings(p,v['note'],gain,self.rate,getattr(self,'sargs',None)); self.sargs=e
        k=strike.kernel()
        if k is not None and isinstance(out,ctypes.Array) and isinstance(src,ctypes.Array):
            st=getattr(self,'sst',None)
            if st is None:st=self.sst=(ctypes.c_double*strike.STATE)()
            st[0:strike.STATE]=v['sk']; k(out,src,frames,st,ctypes.byref(e)); v['sk']=list(st)
        else:strike.strike_py(out,src,frames,v['sk'],e)
    def render(self,frames):
        if not getattr(self,'_in_glide',False) and any(v.get('glide_samples',0)>v.get('glide_age',0) for v in self.voices.values()):return self.render_glide(frames)
        # Switching a card's buttons (voices, filter type, sub octave, stretched partials) mid-note would jump,
        # so that block is rendered both ways and crossfaded.
        p=self.live or self.params; mode=self.voice_mode(p); last=getattr(self,'last_p',None)
        if self.voices and last is not None and self.voice_mode(last)!=mode:
            keep=self.voices; clock=self.clock
            self.voices=copy.deepcopy(keep); self._skip_layer=True
            try:old=self._render(frames,last)
            finally:self._skip_layer=False
            self.voices=keep; self.clock=clock
            new=self._render(frames,p)
            out=[o+(n-o)*(i+1)/frames for i,(o,n) in enumerate(zip(old,new))]
        else:out=self._render(frames,p)
        self.last_p=p
        return out
    def render_into(self,buf,offset,frames):
        """Render frames samples into the C buffer buf from offset on (cbus.py), with no Python list
        when the voices run in C. Same sound as render(): the rare paths (glide, a card switch's
        crossfade, the Python fallback) render a list and copy it in."""
        from . import cbus
        if not self.voices:
            cbus.zero(buf,offset,frames);self.clock+=frames;self.last_p=self.live or self.params;return
        glide=not getattr(self,'_in_glide',False) and any(v.get('glide_samples',0)>v.get('glide_age',0) for v in self.voices.values())
        p=self.live or self.params;last=getattr(self,'last_p',None)
        if glide or (last is not None and self.voice_mode(last)!=self.voice_mode(p)):
            cbus.put(buf,offset,self.render(frames));return
        target=cbus.view(buf,offset,frames);ctypes.memset(target,0,8*frames)
        out=self._render(frames,p,target)
        if out is not None:cbus.put(buf,offset,out)
        self.last_p=p
    def _render(self,frames,p,target=None):
        """The voices, then the Sample layer on top (sample_layer.py). Returns a list, or None when it rendered into target."""
        layered=sample_layer.active(p) and not getattr(self,'_skip_layer',False)
        if layered:sample_layer.spawn(self,p)
        out=self._render_voices(frames,p,target)
        if layered or getattr(self,'layer',None):
            if not getattr(self,'layer',None):return out
            sample_layer.mix(self,target if out is None else out,frames,p)
        return out
    def _render_voices(self,frames,p,target=None):
        """Returns a list, or None when it rendered into target (a zeroed ctypes array)."""
        out=[0.]*frames; sr=self.rate
        a=max(1,p['attack']*sr); d=max(1,p['decay']*sr); slow=max(1,p['release']*sr); quick=min(slow,.006*sr)
        mod=min(1.,p['modulation']+self.mod_wheel); trem=1-mod*.12+mod*.12*math.sin(self.clock/sr*2*math.pi*.27)
        uni=int(p.get('uni_voices',1)); ft=int(p.get('vcf_type',0)); sub=p.get('sub',0.); inh=p.get('inharm',0.)
        if uni>1 or ft or sub>0 or inh>0 or filter_extended(p):return self.render_ext(frames,p,a,d,slow,quick,mod,trem,uni,ft,sub,inh,target)
        fast=native_voice(); curve=p.get('env_curve',0.)*8; curved=native_voice_curve() if curve else None
        if curve and curved is None:fast=None  # an older library without the curve: the Python loop has it
        if fast is not None:
            buf=target if target is not None else (ctypes.c_double*frames)(); st=(ctypes.c_double*6)()
            for key,v in list(self.voices.items()):
                table=v['table']; prev=v.get('prev')
                if not isinstance(table,ctypes.Array) or (prev is not None and not isinstance(prev,ctypes.Array)):
                    fast=None; break
            if fast is not None:
                pitched=bool(p.get('pitch_env',0.)); hit=strike.strikes(p)
                for key,v in list(self.voices.items()):
                    rel=v['release']; prev=v.get('prev')
                    st[0]=v['phase']; st[1]=v['age']; st[2]=rel[0] if rel else 0; st[3]=rel[1] if rel else 0
                    st[4]=v['level']; st[5]=v.get('xf',1.)
                    step=440*2**((v['note']-69)/12)*2048/sr*self.bend*2**(p.get('pitch',0)/12)*v.get('pitch_factor',1.)*v.get('drift',1.)*(1+mod*.002*math.sin(self.clock/sr*2*math.pi*.4))
                    dst=self._scratch(frames) if hit else buf; res=0
                    for off,n,fac in (strike.slices(p,v['age'],frames,sr) if pitched else ((0,frames,1.),)):
                        if curve and not v.get('fast') and curved is not None:
                            res=curved(strike.at(dst,off),n,v['table'],prev,st,rel is not None,step*fac,self.amp(v,p)*.23*trem,
                                       a,d,p['sustain'],slow,curve)
                        else:
                            res=fast(strike.at(dst,off),n,v['table'],prev,st,rel is not None,step*fac,self.amp(v,p)*.23*trem,
                                     a,d,p['sustain'],quick if v.get('fast') else slow)
                        if res&2:prev=None
                        if res&1:break
                    if hit:self._strike(buf,dst,frames,v,p,self.amp(v,p)*.23*trem)
                    if res&1:self.voices.pop(key,None); continue
                    v.update(phase=st[0],age=int(st[1]),release=(int(st[2]),st[3]) if rel else None,level=st[4],
                             prev=prev,xf=st[5])
                self.clock+=frames; return None if target is not None else list(buf)
        for key,v in list(self.voices.items()):
            phase=v['phase']; age=v['age']; rel=v['release']; table=v['table']; level=v['level']
            step=440*2**((v['note']-69)/12)*2048/sr*self.bend*2**(p.get('pitch',0)/12)*v.get('pitch_factor',1.)*v.get('drift',1.)*(1+mod*.002*math.sin(self.clock/sr*2*math.pi*.4))
            step*=strike.block_factor(p,age,frames,sr); hit=strike.strikes(p); dst=[0.]*frames if hit else out
            gain=self.amp(v,p)*.23*trem
            release=quick if v.get('fast') else slow
            k=0. if v.get('fast') else curve
            prev=v.get('prev'); xf=v.get('xf',1.)
            for i in range(frames):
                if k:
                    if rel is not None:
                        r,base=rel; level=0. if r>=release else base*(math.exp(-k*r/release)-math.exp(-k))/(1-math.exp(-k)); rel=(r+1,base)
                        if level<=0: self.voices.pop(key,None); break
                    elif age<a: level=age/a
                    elif age<a+d: level=1-(1-p['sustain'])*(1-math.exp(-k*(age-a)/d))/(1-math.exp(-k))
                    else: level=p['sustain']
                elif rel is not None:
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
                dst[i]+=smp*level*gain
                phase=(phase+step)%2048; age+=1
            if hit:self._strike(out,dst,frames,v,p,gain)
            v.update(phase=phase,age=age,release=rel,level=level,prev=prev,xf=xf)
        self.clock+=frames; return out

    def ext_state(self,v):
        """Extra state for a voice the first time a Filter, Unison or Character card is on (st[6:80] in dsfx.c)."""
        address=self.table_key(v.get('table_note',v['note']),v['velocity'])
        self.table(v.get('table_note',v['note']),v['velocity'])
        x=[0.]*74
        for u in range(7):x[u]=(v['phase']+u*1265.6)%2048
        x[10:26]=list(self.weights[address])
        for u in range(3):
            for k in range(16):x[26+u*16+k]=(u*731.)%2048
        return x
    def render_ext(self,frames,p,a,d,slow,quick,mod,trem,uni,ft,sub,inh,target=None):
        """Voices with the Filter, Unison or Character cards on: dsfx_voice2 in C, or the same loop in Python."""
        sr=self.rate; extended=filter_extended(p); fast=native_filter_voice() if extended else native_voice2()
        if fast is not None and not all(isinstance(v['table'],ctypes.Array) and (v.get('prev') is None or isinstance(v['prev'],ctypes.Array))
                                        for v in self.voices.values()):fast=None
        out=(target if target is not None else (ctypes.c_double*frames)()) if fast is not None else [0.]*frames
        va=self.vargs; st=self.st; pitched=bool(p.get('pitch_env',0.)); hit=strike.strikes(p)
        cfg=dict(a=a,d=d,sus=p['sustain'],uni=uni,detune=p.get('uni_detune',.3)*.5,ftype=ft,reso=p.get('vcf_reso',.2),
                 envamt=p.get('vcf_env',.3)*6,rate=float(sr),npart=16,stretch=.008*inh*inh,sub=sub,suboct=int(p.get('sub_oct',1)))
        fc=dict(a=max(1,p.get('fenv_a',p['attack'])*sr),d=max(1,p.get('fenv_d',p['decay'])*sr),
                sus=p.get('fenv_s',p['sustain']),rel=max(1,p.get('fenv_r',p['release'])*sr),
                morph=p.get('vcf_morph',sound_default(p,'vcf_morph')),independent=int(any(k in p for k in FILTER_ENV))) if extended else None
        for key,v in list(self.voices.items()):
            if 'x' not in v:v['x']=self.ext_state(v)
            rel=v['release']; prev=v.get('prev')
            address=self.table_key(v.get('table_note',v['note']),v['velocity'])
            if inh>0 and address not in self.weights:self.table(v.get('table_note',v['note']),v['velocity'])
            cfg.update(step=440*2**((v['note']-69)/12)*2048/sr*self.bend*2**(p.get('pitch',0)/12)*v.get('pitch_factor',1.)*v.get('drift',1.)*(1+mod*.002*math.sin(self.clock/sr*2*math.pi*.4)),
                       gain=self.amp(v,p)*.23*trem,rel=quick if v.get('fast') else slow,released=int(rel is not None),curve=0. if v.get('fast') else p.get('env_curve',0.)*8,
                       cutoff=cutoff_hz(p,v.get('current_note',v['note']),v['velocity']),weights=self.weights[address] if inh>0 else None)
            st[0:6]=[v['phase'],v['age'],rel[0] if rel else 0,rel[1] if rel else 0,v['level'],v.get('xf',1.)]
            st[6:80]=v['x']
            if extended:
                if 'fstate' not in v:
                    # Newly enabled filter envelope starts at the note's actual age.
                    age=max(0,v['age']-(rel[0] if rel else 0)-1)
                    level=age/fc['a'] if age<fc['a'] else 1-(1-fc['sus'])*(age-fc['a'])/fc['d'] if age<fc['a']+fc['d'] else fc['sus']
                    initial=fc['morph'] if v['age']==0 else sound_default(getattr(self,'last_p',p) or p,'vcf_morph')
                    v['fstate']=[level,level,initial,math.log2(cfg['cutoff']),cfg['reso']]
                st[80:85]=v['fstate']
            dst=(self._scratch(frames) if fast is not None else [0.]*frames) if hit else out
            if fast is not None:
                for k,val in cfg.items():
                    if k!='weights':setattr(va,k,val)
                va.weights=ctypes.cast(cfg['weights'],ctypes.POINTER(ctypes.c_double)) if cfg['weights'] is not None else None
                if extended:
                    for k,val in fc.items():setattr(self.fargs,k,val)
                res=0
                for off,n,fac in (strike.slices(p,v['age'],frames,sr) if pitched else ((0,frames,1.),)):
                    va.step=cfg['step']*fac
                    res=fast(strike.at(dst,off),n,v['table'],prev,st,ctypes.byref(va),ctypes.byref(self.fargs)) if extended else fast(strike.at(dst,off),n,v['table'],prev,st,ctypes.byref(va))
                    if res&2:prev=None
                    if res&1:break
            else:
                if pitched:cfg['step']*=strike.block_factor(p,v['age'],frames,sr)
                res=voice2_py(dst,frames,v['table'],prev,st,cfg,fc)
                if res&2:prev=None
            if hit:self._strike(out,dst,frames,v,p,cfg['gain'])
            if res&1:self.voices.pop(key,None); continue
            v.update(phase=st[0],age=int(st[1]),release=(int(st[2]),st[3]) if rel else None,level=st[4],
                     prev=prev,xf=st[5],x=st[6:80])
            if extended:v['fstate']=list(st[80:85])
            else:v.pop('fstate',None)
        self.clock+=frames; return None if out is target else list(out)

def voice2_py(out,n,tab,prev,st,c,f=None):
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
    if f:
        fl,fb,morph,logcut,reso=st[80:85];smooth=1-math.exp(-1/(.004*rate));target=math.log2(c['cutoff'])
    kc=c.get('curve',0.); kn=1-math.exp(-kc) if kc else 1.
    for i in range(n):
        if kc:
            if c['released']:
                level=0. if r>=c['rel'] else base*(math.exp(-kc*r/c['rel'])-(1-kn))/kn; r+=1
                if level<=0:result|=1; break
            elif age<A:level=age/A
            elif age<A+D:level=1-(1-sus)*(1-math.exp(-kc*(age-A)/D))/kn
            else:level=sus
        elif c['released']:
            level=base*max(0,1-r/c['rel']); r+=1
            if level<=0:result|=1; break
        elif age<A:level=age/A
        elif age<A+D:level=1-(1-sus)*(age-A)/D
        else:level=sus
        if f:
            if not f['independent']:
                fl=level;fb=base if c['released'] else level
            elif c['released']:
                if r==1:fb=fl
                fl=fb*max(0,1-(r-1)/f['rel'])
            elif age<f['a']:fl=age/f['a']
            elif age<f['a']+f['d']:fl=1-(1-f['sus'])*(age-f['a'])/f['d']
            else:fl=f['sus']
            morph+=(f['morph']-morph)*smooth;logcut+=(target-logcut)*smooth;reso+=(c['reso']-reso)*smooth
        if ftype and (i&15)==0:
            fc=(2**logcut if f else c['cutoff'])*2**(c['envamt']*(fl if f else level))
            fc=20 if fc<20 else .45*rate if fc>.45*rate else fc
            g=math.tan(math.pi*fc/rate); kk=2-1.96*(reso if f else c['reso'])
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
            if f:
                hp=s-kk*v1-v2
                s=v2+(v1-v2)*(morph*2) if morph<=.5 else v1+(hp-v1)*(morph*2-1)
            else:s=v2 if ftype==1 else v1 if ftype==2 else s-kk*v1-v2
        out[i]+=s*level*gain
        age+=1
    if uni==1:st[0]=ph[0]
    else:
        for u in range(uni):st[6+u]=ph[u]
        st[0]=ph[0]
    st[1]=age; st[2]=r; st[3]=base; st[4]=level; st[5]=xf; st[13]=ic1; st[14]=ic2; st[15]=subph
    if f:st[80:85]=[fl,fb,morph,logcut,reso]
    return result

RESONATOR=FX_ORDER.index('resonator')
from .keystep import SCALES as KEY_SCALES

@lru_cache(maxsize=8)
def _limit_curve(n):
    """How far the master limiter's gain has recovered after 1..n samples: (1-g) shrinks by .9995 each sample."""
    return tuple(.9995**(j+1) for j in range(n))

from .workflow import WorkflowEngine
from .note_edit import NoteEditEngine
from .pattern_catalog import PatternCatalogEngine
from .track_engine import TrackEngine

from .midi_import import MidiImportEngine
class Engine(MidiImportEngine,PatternCatalogEngine,NoteEditEngine,WorkflowEngine,ControllerEngine,DrumEngine,FreezeEngine,SamplerEngine,TrackEngine):
    def __init__(self,rate=48000):
        self.rate=rate; self.project=Project(); self.synths=[Synth(rate) for _ in range(4)]
        self.fx=[TrackFx(rate) for _ in range(4)];self._pan_state=[None]*4
        self.send_buses=send_buses.SendBuses(rate)  # the shared Reverb and Delay (sends.py)
        self.selected=0; self.playing=False; self.recording=False; self.frame=0; self._bucket_cache={}
        self.pending={}; self.down=set(); self.capture_sustain=set(); self.history=[]; self.redo_history=[]; self.record_start=0; self.record_end=0; self.click_age=99999; self.limit=1.
        self.transfer_report=None
        self.master_enabled=True  # the C master stage on the stereo mix (tests of the raw mix switch it off)
        # Count-in (Settings): beats of click before a take, and whether REC waits for the first note.
        self.count_in_beats=0; self.rec_wait=False
        self.rec_armed=None; self.count_end=None; self.count_start=0; self.count_track=0; self.count_early=[]
        self.perform_held=HeldNotes(); self.live_note_map={}; self.mutation_sessions={}; self.arp_anchor_beat=0.
        self.arp_paused=False; self.arp_resume_phase=0
        # Chords (runtime only): the chord before the last key (Voice lead), the last chord, the
        # My chords position for Play in order (next to play, now sounding), keys that carry exact pad notes.
        self.lead_from=None; self.last_chord=None; self.chord_step=0; self.chord_now=-1
        self.explicit_keys=set(); self.pad_keys=set(); self.live_velocity={}
        self.chord_loops={}; self.chord_phrase_frame=0; self.chord_key_frame=-10**9
        self.scheduled_live=[]; self.absolute_frame=0
        # Step record cursor (not saved): the step the next recorded key goes to.
        self.rec_step=0; self.rec_last=None
        self.clock_times=deque(maxlen=24);self.clock_following=False;self.clock_last_ts=0.
        self.midi_learn=None
        self.init_workflow()
        self.init_drums()
        self.init_samplers()
        self.init_freeze()
        self.configure()
    def configure(self):
        self.sync_tracks()
        self.stop_pattern_preview()
        self.midi_learn=None
        for t,s in zip(self.project.tracks,self.synths): s.configure(t['instrument'])
        for t,fx in zip(self.project.tracks,self.fx): fx.configure(t.get('fx'))
        self.send_buses.configure(getattr(self.project,'sends',None))
        self.configure_drums()
        self.configure_samplers()
    def set_fx(self,track,chain):
        """Replace one track's FX chain (validated); applies on the next audio block."""
        clean=validate_fx(chain);self.record_fx_changes(track,self.project.tracks[track].get('fx') or default_fx(),clean); self.project.tracks[track]['fx']=clean; self.fx[track].configure(clean)
    def set_send(self,track,bus,amount):
        """How much of one track goes to the shared Reverb or Delay (0..1, after its volume and pan)."""
        from .devices import track_index
        if track_index(track)>=len(self.project.tracks):raise ValueError('Choose track 1–%d'%len(self.project.tracks))
        if bus not in send_buses.BUSES:raise ValueError('Unknown send')
        t=self.project.tracks[track];sends=dict(t.get('sends') or {});sends[bus]=float(amount)
        t['sends']=send_buses.validate_track(sends)
    def set_send_setting(self,bus,key,value):
        """Change a shared Reverb or Delay setting, or its Return level (key 'level')."""
        if bus not in send_buses.BUSES:raise ValueError('Unknown send')
        current=copy.deepcopy(self.project.sends)
        if key=='level':current[bus]['level']=value
        elif any(k==key for k,*_ in send_buses.SETTINGS[bus]):current[bus]['params'][key]=value
        else:raise ValueError('Unknown send setting')
        self.project.sends=send_buses.validate(current);self.send_buses.configure(self.project.sends)
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
    def layer_state(self):
        """The selected synth track's Sample layer file for the Sound page (name, length, outline), or None."""
        t=self.project.tracks[self.selected]
        if device_kind(t)!='synth':return None
        path=t['instrument'].get('layer_file','')
        return sample_layer.info(path,self.rate) if path else None
    def _layer_target(self,track):
        from .devices import track_index
        track_index(track)
        if track!=self.selected:raise ValueError('Track changed; choose the sample again')
        t=self.project.tracks[track]
        if device_kind(t)!='synth':raise ValueError('The Sample layer is on synth tracks')
        return t
    def set_layer_file(self,track,path):
        """Choose (or, with '', clear) the Sample layer's WAV on a synth track. One undo step; choosing turns the layer on."""
        t=self._layer_target(track)
        if not isinstance(path,str) or not sample_layer.valid_file(path):raise ValueError('Choose a WAV file')
        if path and not path.startswith(sample_layer.FACTORY):
            lib=getattr(self,'sample_library',None)
            if lib is not None and not lib.contains(path):raise ValueError('That sample is not in the library')
        ins=copy.deepcopy(t['instrument'])
        if path:ins['layer_file']=path; ins['layer_on']=1
        else:ins.pop('layer_file',None); ins['layer_on']=0
        self.snapshot();t['instrument']=ins;self.synths[track].configure(ins)
        if path:sample_layer.request(path,self.rate)
        else:sample_layer.clear(self.synths[track])
    def layer_to_partials(self,track):
        """Partials (the one-off button): measure the layer sample's spectrum and write it into the 16 partials. One undo step.
        Returns a short message."""
        t=self._layer_target(track); path=t['instrument'].get('layer_file','')
        if not path:raise ValueError('Choose a sample first')
        sample=sample_layer.request(path,self.rate,wait=True)
        if sample is None:raise ValueError('That sample could not be read')
        h,f0=sample_layer.measure_partials(sample,self.rate,t['instrument'].get('layer_start',0.))
        if max(h)<=0:raise ValueError('That sample has no sound to measure')
        params={**t['instrument'],'harmonics':h,'spectral_energy':1}
        self.snapshot();t['instrument']=params;self.synths[track].configure(params)
        return 'Partials written from the sample (%d Hz)'%round(f0)
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
        p=preset(name); ins=self.preset_sound(p['instrument'] if p else instrument(name))
        self.snapshot(); t=self.project.tracks[self.selected]; t['preset']=name; t['instrument']=ins
        if p:t['fx']=validate_fx(p['fx'])
        self.synths[self.selected].panic(); self.synths[self.selected].configure(ins)
        if p:self.fx[self.selected].configure(t['fx'])
    preset_noise=False   # Settings › "Load presets with Strike noise" (25 Nov: the burst was too present; off by default)
    def set_preset_options(self,noise):
        if type(noise) is not bool:raise ValueError('Preset noise is on or off')
        self.preset_noise=noise
    def preset_sound(self,ins):
        """A preset's sound as it loads: with the Strike noise switched off unless Settings asks for it (the knobs stay, so
        the Noise switch on the Strike view brings it back as the preset made it)."""
        if not self.preset_noise and ins.get('noise',0.)>0:ins=dict(ins,noise_on=0)
        return ins
    def factory_sounds(self):
        """Give the four starting tracks their finished library presets (sound and FX rack). A new session
        then starts with the full sound; Project() itself stays plain, so saved files and tests are stable."""
        from .library import preset
        for i,t in enumerate(self.project.tracks):
            p=preset(t['preset'])
            if p:t['instrument']=self.preset_sound(p['instrument']); t['fx']=p['fx']
        self.configure()
        for i,t in enumerate(self.project.tracks):
            if 'fx' in t:self.fx[i].configure(t['fx'])
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
            self.stop(); self.project=Project();self.init_workflow(); self.mutation_sessions.clear(); self.keep_tracks(1); self.factory_sounds(); return
        if action=='links':
            for i,t in enumerate(self.project.tracks):
                if 'fx' in t:t['fx']=validate_fx(unlinked(copy.deepcopy(t['fx']))); self.fx[i].configure(t['fx'])
            return
        t=self.project.tracks[self.selected]
        if action=='sound':
            from .library import preset
            p=preset(t['preset'])
            try:ins=self.preset_sound(p['instrument'] if p else instrument(t['preset']))
            except ValueError:ins=instrument('Warm Keys')
            t['instrument']=copy.deepcopy(ins); self.synths[self.selected].panic(); self.synths[self.selected].configure(t['instrument'])
            return
        chain=copy.deepcopy(t.get('fx') or default_fx())
        if action=='effects':
            for m in chain['modules']:m['on']=False
            for src in chain['macros']+chain['mods']:src['targets']=[x for x in src['targets'] if x['module'] in ('sound','sampler','drum')]
        else:
            base=default_fx(); chain['mods']=base['mods']; chain=unlinked(chain)
        t['fx']=validate_fx(chain); self.fx[self.selected].configure(t['fx'])
    def fx_levels(self): return [fx.levels() for fx in self.fx]
    def fx_live(self,track):
        """Effective (modulated) FX params and mod-pad values of one track, for the UI."""
        fx=self.fx[track]; return dict(params=[round(v,4) for v in fx.params],mods=[round(v,3) for v in fx.mod_values],
                    phases=[round(v,3) for v in fx.mod_phases],puck=[round(v,3) for v in fx.puck],
                    sound=self.sound_live(track),partials=self.synths[track].heard_partials(),comp=fx.comp_reduction(),strings=list(fx.tuned),gate=fx.gate_runtime(),readout=fx.readout())
    def sound_live(self,track):
        """Where each linked Sound knob is right now, for the rings on the Sound cards."""
        fx=self.fx[track]; s=self.synths[track]; t=self.project.tracks[track]; out={}
        for k,v in fx.sound.items():
            lo,hi=SOUND_PARAMS[k]
            base=t['volume'] if k=='volume' else t['instrument'].get(k,sound_default(t['instrument'],k))
            out[k]=round(min(hi,max(lo,base+v)),4)
        return out
    @property
    def fpb(self): return self.rate*60/self.project.bpm
    @property
    def beat(self): return self.frame/self.fpb
    def snapshot(self,pattern_address=None,after_pattern=None,seed_after=None,mode_after=None):
        # A new committed edit starts a new branch.  Preview paths deliberately do not
        # call snapshot(), so an abandoned gesture cannot throw away Redo.
        self.redo_history.clear()
        data=copy.deepcopy(self.project.data())
        data['_mutation_sessions']=copy.deepcopy(self.mutation_sessions)
        if pattern_address is not None:
            data['_pattern_edit']=dict(address=pattern_address,after=copy.deepcopy(after_pattern),
                                       seed_after=seed_after,mode_after=mode_after)
        data['_seq']=self.next_edit_seq()
        self.history.append(data);self.history=self.history[-20:]
    def _redo_checkpoint(self):
        """Capture the complete undo domain before an undo changes it.

        Project edits and sound gestures have separate histories, but Redo must put
        both back exactly as they were.  Keeping this runtime-only snapshot avoids
        changing project persistence or the MIDI/audio boundary.
        """
        self.redo_history.append(dict(project=copy.deepcopy(self.project),history=copy.deepcopy(self.history),
                                      sound_history=copy.deepcopy(self.sound_history),mutation_sessions=copy.deepcopy(self.mutation_sessions),
                                      selected=self.selected,control_revisions=copy.deepcopy(self.control_revisions)))
        self.redo_history=self.redo_history[-20:]
    def _redo_mark(self):
        """A fingerprint of everything Redo would overwrite, taken right after an undo."""
        import hashlib
        return hashlib.sha1(json.dumps(self.project.data(),sort_keys=True,default=str).encode()).hexdigest()
    def _guarded_undo(self,fn,*args):
        """Run one undo and keep a redo entry only if it really changed something.

        A refused undo (stale clip, changed sound) leaves no entry, and the entry remembers
        the state just after the undo, so Redo can refuse once anything changed since then.
        """
        self._redo_checkpoint();start=self.redo_history[-1]
        mark0=self._redo_mark()
        try:result=fn(*args)
        except Exception:
            self.redo_history=[e for e in self.redo_history if e is not start];raise
        mark=self._redo_mark()
        if mark==mark0:self.redo_history=[e for e in self.redo_history if e is not start]
        else:start['mark']=mark
        return result
    def redo(self):
        if not self.redo_history:return
        if self.redo_history[-1].get('mark')!=self._redo_mark():
            # Something changed after the undo (a knob, tempo, a Perform setting): putting the
            # old project back would silently throw that change away.
            self.redo_history.clear();raise ValueError('Changed since the undo; redo cleared')
        state=self.redo_history.pop()
        self.stop()
        self.project=state['project'];self.history=state['history'];self.sound_history=state['sound_history']
        self.mutation_sessions=state['mutation_sessions'];self.selected=state['selected'];self.control_revisions=state['control_revisions']
        self._sound_gesture=None
        self.configure()
    def next_edit_seq(self):
        self._edit_seq=getattr(self,'_edit_seq',0)+1;return self._edit_seq
    def undo_any(self):
        """The top-bar Undo: undo the newest edit, whether a project edit or a Sound knob gesture."""
        best=None
        for tr in range(len(self.project.tracks)):
            h=self.patch_history(tr) if hasattr(self,'patch_history') else []
            if h and (best is None or h[-1].get('seq',0)>best[1]):best=(tr,h[-1].get('seq',0))
        project_seq=self.history[-1].get('_seq',0) if self.history else -1
        if best is not None and best[1]>project_seq:return self.sound_undo(best[0])
        return self.undo()
    def undo(self):
        if not self.history:return
        return self._guarded_undo(self._undo_project)
    def _undo_project(self):
        data=self.history[-1]
        if '_note_edit' in data:return self.undo_note_edit(data['_note_edit'])
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
        self.project.sends=copy.deepcopy(d.get('sends',send_buses.defaults()))
        self.project.metronome=d['metronome']
        self.project.performance=copy.deepcopy(d.get('performance',performance_defaults()))
        self.project.performance['seq']['recording']=False
        self.mutation_sessions=copy.deepcopy(d.get('_mutation_sessions',{}))
        self.configure()
    def record(self,track):
        self.automation_touched.clear()
        if self.recording:self.finish_record()
        self.snapshot(); self.select(track)
        if not self.playing: self.frame=0
        self.playing=True; self.recording=True; self.record_start=self.frame
        self.record_end=self.frame+round(self.project.beats*self.fpb)
    def set_record_options(self,count_in,wait):
        """Settings: count_in 0 or 1 to 16 beats of click before a take; wait=True arms REC until the first note."""
        if type(count_in) is not int or not 0<=count_in<=16 or type(wait) is not bool:raise ValueError('Count-in is off or 1 to 16 beats; wait is on or off')
        self.count_in_beats=count_in; self.rec_wait=wait
    def record_button(self):
        """REC: finish a take; cancel an armed or counting REC; or start one. From a stopped transport,
        REC counts in (4 clicks) and/or waits for the first note, as set in Settings. While the loop
        is already playing the take starts at once, as before."""
        if self.recording:return self.finish_record()
        if self.rec_armed is not None or self.count_end is not None:return self.cancel_count()
        track=self.selected
        if self.playing or not (self.count_in_beats or self.rec_wait):return self.record(track)
        if self.rec_wait:self.rec_armed=track
        else:self.start_count(track)
    def start_count(self,track):
        self.rec_armed=None; self.count_track=track; self.count_early=[]
        self.count_start=self.absolute_frame; self.count_end=self.absolute_frame+round(self.count_in_beats*self.fpb)
    def cancel_count(self):
        self.rec_armed=None; self.count_end=None; self.count_early=[]
    def first_note(self):
        """A note from the UI keys, a chord pad, a drum pad or external MIDI while REC waits for it:
        with a count-in it starts the count (that note is not recorded); without, the take starts now
        and the note is its first event."""
        if self.rec_armed is None:return
        track=self.rec_armed
        if self.count_in_beats:self.start_count(track)
        else:self.rec_armed=None; self.record(track)
    def count_state(self):
        if self.count_end is not None:
            left=max(1,math.ceil((self.count_end-self.absolute_frame)/self.fpb-1e-9))
            return dict(state='count',beat=self.count_in_beats-left+1,of=self.count_in_beats)
        if self.rec_armed is not None:return dict(state='armed',count=self.count_in_beats)
        return None
    def _count_done(self):
        track=self.count_track; early=self.count_early
        self.count_end=None; self.count_early=[]
        self.record(track)
        # A key hit just before the downbeat (the last 1/8 beat of the count) and still held counts as on beat 1.
        for key,velocity,tr in early:
            if key[:2] in self.down:self.pending[key]=(0,velocity,tr)
    def quantize(self,track):
        self.snapshot(); self.stop(); self.project.quantize(track)
    def set_song(self,song):
        """Replace the song arrangement (validated), with undo."""
        clean=songs.validate(song,self.project.bars,len(self.project.tracks)); self.snapshot()
        if clean['on']!=self.project.song['on']:self.release_loops()
        self.project.song=clean
    def release_loops(self):
        """Let go of the loop and song notes still sounding (their note-offs won't come any more)."""
        for i,s in enumerate(self.synths):
            s.cancel_sources(('loop',)); self.samplers[i].cancel_sources(('loop',))
            self.drum_gate_keys[i]={k for k in self.drum_gate_keys[i] if not (isinstance(k,tuple) and k[0]=='loop')}
    def clip_action(self,track,action,clip=None,source=None):
        """Loops per track: open one for editing, copy one into another slot, or clear one."""
        if type(track) is not int or not 0<=track<len(self.project.tracks):raise ValueError('Choose track 1-%d'%len(self.project.tracks))
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
                self.synths[track].cancel_sources(('loop',)); self.samplers[track].cancel_sources(('loop',))
                self.drum_gate_keys[track]={k for k in self.drum_gate_keys[track] if not (isinstance(k,tuple) and k[0]=='loop')}
            if clip!=opened:
                slots[opened]=t['notes']; t['notes']=slots[clip]; slots[clip]=[]; p.clips['open'][track]=clip
        elif action=='copy':
            if type(source) is not int or not 0<=source<songs.CLIPS:raise ValueError('Choose the loop to copy')
            self.snapshot(); put(clip,copy.deepcopy(p.clip_notes(track,source)))
            names=t.get('clip_names') or ['']*songs.CLIPS
            if names[source]:names=list(names);names[clip]=names[source];t['clip_names']=names
        elif action=='clear':
            self.snapshot(); put(clip,[])
            if t.get('clip_names') and t['clip_names'][clip]:t['clip_names']=list(t['clip_names']);t['clip_names'][clip]=''
        elif action=='rename':
            # A clip's name, typed in place; empty goes back to its letter. One undo step.
            name=clean_clip_name(source)
            names=list(t.get('clip_names') or ['']*songs.CLIPS)
            if names[clip]!=name:self.snapshot();names[clip]=name;t['clip_names']=names
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
        if not valid_bars(bars):raise ValueError('Loop length must be 1 to %d bars'%MAX_BARS)
        self.snapshot(); self.stop(); self.project.bars=bars
        for t in self.project.tracks:
            for n in t['notes']:
                n['start']%=self.project.beats; n['duration']=min(n['duration'],self.project.beats)
        for track in self.project.clips['slots']:
            for clip in track:
                for n in clip:
                    n['start']%=self.project.beats; n['duration']=min(n['duration'],self.project.beats)
    def voice_on(self,track,note,velocity,token):
        if device_kind(self.project.tracks[track])=='sampler':
            empty=not any(v.active for v in self.samplers[track].voices)
            hit=False if self.project.tracks[track]['mute'] else self.samplers[track].on(note,velocity,token)
            if hit:self.fx[track].retrigger(self.absolute_frame if self._event_frame is None else self._event_frame,empty)
            return hit
        if device_kind(self.project.tracks[track])=='drum_rack':
            empty=not self.drum_gate_keys[track]
            hit=False if self.project.tracks[track]['mute'] else self.drums[track].on(note,velocity,token)
            if hit:
                frame=self.absolute_frame if self._event_frame is None else self._event_frame
                self.drum_frames[track][note-36]=frame;self.fx[track].retrigger(frame,empty)
                if not (isinstance(token,tuple) and token[0]=='touch'):self.drum_gate_keys[track].add(token)
            return hit
        empty=not self.synths[track].gated
        fading=lambda k:isinstance(k,tuple) and k[0]=='fade'
        candidates=[(s,k,v) for s in self.synths for k,v in s.voices.items() if not fading(k)]
        if len(candidates)>=24:
            # Steal the quietest-to-lose voice (released first, then oldest) with a short fade, not a cut.
            s,k,_=min(candidates,key=lambda item:(item[2]['release'] is None,-item[2]['age']))
            s.fade(k)
        self.synths[track].on(note,velocity,token)
        self.fx[track].retrigger(self.absolute_frame if self._event_frame is None else self._event_frame,empty)
    def select(self,track):
        from .devices import track_index
        track_index(track)
        if track!=self.selected:
            self.stop_pattern_preview()
            self.cancel_sound_gesture();self.automation_arm=False
            self.midi_learn=None
            if self.recording: self.finish_record()
            self.drum_keys={key:owner for key,owner in self.drum_keys.items() if owner!=self.selected}
            s=self.synths[self.selected]
            self.drum_gate_keys[self.selected]={k for k in self.drum_gate_keys[self.selected] if not (isinstance(k,tuple) and k[0] in ('live','editor'))}
            s.cancel_sources(('live','perf_seq','perf_arp','editor'),cut=('live',))
            self.samplers[self.selected].cancel_sources(('live','perf_seq','perf_arp','editor')); self.samplers[self.selected].pedal(False)
            s.pedal(False); s.bend=1.; self.down.clear(); self.capture_sustain.clear()
            self.perform_held.reset(); self.explicit_keys.clear(); self.live_note_map.clear(); self.scheduled_live.clear(); self.selected=track
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
    def play_from(self,beat):
        """Start (or jump) the loop at `beat`, like tapping the note grid's ruler. The notes sounding are let go."""
        if self.recording:raise ValueError('Finish the take first')
        beat=float(beat); span=self.project.song['length']*4 if self.project.song['on'] else self.project.beats
        if not 0<=beat<span:raise ValueError('That bar is past the end')
        self.release_loops(); self.frame=round(beat*self.fpb); self.playing=True
    def stop(self):
        self.stop_sample_preview()
        self.stop_pattern_preview()
        self.cancel_sound_gesture();self.automation_arm=False
        self.cancel_count()
        self.finish_record(); self.down.clear(); self.capture_sustain.clear(); self.playing=False; self.frame=0
        self.project.performance['seq']['recording']=False
        for s in self.synths:s.panic()
        for rack in self.drums:rack.panic()
        for sampler in self.samplers:sampler.panic()
        for fx in self.fx:fx.clear_gate_events()
        for keys in self.drum_gate_keys:keys.clear()
        self.drum_keys.clear(); self.freeze_ring.clear()
        self.perform_held.reset(); self.explicit_keys.clear(); self.live_note_map.clear(); self.scheduled_live.clear()
    def close_generated(self,prefix):
        """End the REC notes the arp/sequencer was playing when it is cut short (keys let go, arp or step
        changed): their note-off never comes, so they would stay open and be closed far too long."""
        mark="('%s'"%prefix
        for k in list(self.pending):
            if k[0]=='gen' and str(k[1]).startswith(mark):self.close_note(k)
    def release_performance(self,prefix):
        self.close_generated(prefix)
        for synth in self.synths:synth.cancel_sources((prefix,))
        for sampler in self.samplers:sampler.cancel_sources((prefix,))

    def perform_set(self,section,key,value):
        """Validated UI parameter changes; does not erase recorded song notes."""
        if section not in ('seq','arp','chord','scale','sync'):
            raise ValueError('Unknown performance section')
        current=self.project.performance
        if key not in current[section]:raise ValueError('Unknown performance parameter')
        if section!='seq':
            # Arp, chord, scale and sync never touch the 64 patterns: check them without copying and
            # re-checking every pattern (about 7 ms a change with full banks, on the audio loop).
            probe=dict(current,patterns={}); probe[section]=dict(copy.deepcopy(current[section]),**{key:value})
            if section=='arp' and key=='enabled' and value:probe['seq']=dict(copy.deepcopy(current['seq']),enabled=False,recording=False)
            state=validate_performance(probe); state['patterns']=current['patterns']
            if section=='arp' and key=='hold':self.perform_held.set_hold(value)
            if section=='sync' and key=='source':
                self.clock_times.clear();self.clock_following=False;self.clock_last_ts=0.
            self.project.performance=state
            if section=='chord' and key in ('follow','advance'):self.chord_step=0;self.chord_now=-1
            if section in ('chord','scale'):self.rechord()
            if section=='arp':self.release_performance('perf_arp')
            if section=='arp' and key=='enabled':
                for synth in self.synths:
                    for token in list(synth.voices):
                        if isinstance(token,tuple) and str(token[0]).startswith('perf_'):
                            synth.off(0,token)
                for sampler in self.samplers:sampler.cancel_sources(('perf_seq','perf_arp'))
            return state[section][key]
        state=copy.deepcopy(current)
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
            for sampler in self.samplers:sampler.cancel_sources(('perf_seq','perf_arp'))
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
    def _validate_transfer(self,action,expected):
        """Validate a direct UI transfer before any snapshot, release or model mutation."""
        fields={'track','device','clip','bars','bank','slot','transpose','pattern','notes'}
        if type(expected) is not dict or set(expected)!=fields:
            raise ValueError('Transfer target is incomplete; choose the current track, clip and pattern')
        seq=self.project.performance['seq'];track=self.selected
        actual=dict(track=track,device=device_kind(self.project.tracks[track]),
                    clip=self.project.clips['open'][track],bars=self.project.bars,
                    bank=seq['bank'],slot=seq['slot'],transpose=seq['transpose'],
                    pattern=current_pattern(self.project.performance),notes=self.project.tracks[track]['notes'])
        if any(type(expected[k]) is not int for k in ('track','clip','bars','bank','slot','transpose')) or expected!=actual:
            raise ValueError('Transfer target changed; check the displayed track, clip and pattern and try again')
        if self.recording or seq['recording']:
            raise ValueError('Finish recording before transferring notes')
        pattern=actual['pattern'];unit=DIVISIONS[pattern['division']]
        if action=='capture_song':
            notes=actual['notes']
            if not notes:raise ValueError('The source clip is empty')
            if seq['transpose']:raise ValueError('Set pattern Transpose to 0 before an exact Song to Pattern copy')
            # A live take is snapped to the pattern's grid and the pattern takes the clip's length
            # (15 Nov: the strict copy refused every arp/chord take and every clip longer than the pattern).
            captured,self.transfer_report=clip_to_pattern(notes,self.project.beats,pattern['division'],1/self.fpb)
            return captured
        else:
            if not any(pattern['steps']):raise ValueError('The source pattern is empty')
            for step,notes in enumerate(pattern['steps']):
                if notes and step*unit>=self.project.beats-1e-9:
                    raise ValueError('Pattern notes exceed the destination clip length')
                for n in notes:
                    if not 0<=n['note']+seq['transpose']<=127:
                        raise ValueError('Pattern Transpose would clip MIDI pitch; no notes were changed')
                    if unit*pattern['gate']*n['tie']>self.project.beats+1e-7:
                        raise ValueError('A note tie is longer than the destination clip')

    def perform_action(self,action,value=None,expected=None):
        transfer_pattern=None
        if expected is not None:
            if action not in ('capture_song','commit_song'):raise ValueError('Only note transfers accept a transfer target')
            transfer_pattern=self._validate_transfer(action,expected)
        if action in ('arp_stop','arp_pause'):return self.arp_interrupt(action)
        if action=='save_chord':
            # Chord memory changes on every chord tap: no undo step, no full-project copy, no note release.
            if not isinstance(value,list) or not 1<=len(value)<=16:
                raise ValueError('Chord memory needs 1-16 notes')
            root=int(value[0]); chord=self.project.performance['chord']
            chord['user']=[max(-48,min(48,int(x)-root)) for x in value]; chord['preset']='User'
            self.rechord()
            return action
        if action=='chord_goto':
            # Play in order: the next key plays this My chords chord (counted over the saved ones).
            filled=[c for c in self.project.performance['chord']['slots'] if c]
            if type(value) is not int or not 0<=value<max(1,len(filled)):raise ValueError('Choose a saved chord')
            self.chord_step=value
            return action
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
            state['patterns'][addr]=transfer_pattern or pattern_from_song(self.project.tracks[self.selected]['notes'],
                         self.project.bars,seq['division'],seq['length'])
        elif action=='commit_song':
            if value not in ('add','replace'):raise ValueError('Choose add or replace')
            # The clip gets what the sequencer plays: swing, gate and spice included, not the bare grid.
            notes=song_from_pattern(pattern,self.project.bars,seq['transpose'],fill=True,
                                    feel=dict(spice=seq['spice'],spice_seed=seq['spice_seed']))
            if len(notes)>100000:raise ValueError('Too many MIDI notes')
            song_notes=notes;seq['recording']=False
            # The clip now holds the pattern. Leaving SEQ running would play it a second time on top of
            # the clip, so sending hands playback over to the Song (Undo turns SEQ back on).
            seq['enabled']=False
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
            if pattern['length']*2>MAX_STEPS:raise ValueError('Maximum %d sequence steps'%MAX_STEPS)
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
        if action in ('save_slot','clear_slot'):
            filled=sum(1 for c in validated['chord']['slots'] if c)
            self.chord_step=self.chord_step%filled if filled else 0
            if validated['chord']['follow']:self.rechord()
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
        channel=self.project.performance['scale']['input_channel']
        if (status&0xf0)==0xb0 and (not channel or (status&15)==channel-1) and self.controller_cc(status&15,note,value):return
        if (status&0xf0)==0x90 and value and (not channel or (status&15)==channel-1):self.first_note()
        if self.drum_midi(status,note,value):return
        kind=status&0xf0; ch=status&15; s=self.synths[self.selected]; key=(ch,note)
        # notes='chord': a chord pad or My chords slot in chord mode. Its key is the chord root, played
        # through chord mode (no scale snap, not Play in order), so option changes re-voice it live.
        pad=notes=='chord'
        if pad:notes=None
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
                self.voice_off(self.selected,old,('live',ch,note,old))
            self.scheduled_live=[item for item in self.scheduled_live if item[4]!=key]
            if notes is None:
                self.explicit_keys.discard(key)
                if pad:self.pad_keys.add(key)
                else:self.pad_keys.discard(key)
                notes=self.key_chord(note,press=True,pad=pad)
            else:self.explicit_keys.add(key)
            velocity=velocity_transform(value,state['scale']['velocity_curve'])
            self.down.add(key);self.live_velocity[key]=velocity;self.chord_key_frame=self.absolute_frame
            fresh=not self.perform_held.keys
            if state['arp']['enabled']:self.release_performance('perf_arp')
            self.perform_held.on(key,notes,velocity)
            if state['arp']['enabled']:
                # The Arpeggiator starts with the first held key, even without a song clip. A key also ends a pause.
                if self.arp_paused:self.arp_paused=False; fresh=True
                self.live_note_map[key]=[]
                # During a count-in the arp waits for beat 1 of the take.
                if self.count_end is None:
                    if not self.playing:self.frame=0
                    self.playing=True
                # A new phrase (or every key with Retrigger) starts on the pattern's first step.
                if fresh or state['arp']['retrigger']:self.arp_anchor_beat=self.beat
            else:
                if fresh:self.chord_phrase_frame=self.absolute_frame
                self.strike(key,notes,velocity,state['chord']['enabled'] or explicit or pad,chorded=not explicit)
            if state['seq']['recording']:self.step_record(notes,velocity)
        elif kind==0x80 or (kind==0x90 and value==0):
            self.down.discard(key);self.live_velocity.pop(key,None);self.chord_loops.pop(key,None)
            if key not in self.perform_held.latched_keys or not self.perform_held.hold:self.explicit_keys.discard(key)
            if state['arp']['enabled'] and not self.perform_held.hold:self.release_performance('perf_arp')
            self.perform_held.off(key)
            self.scheduled_live=[item for item in self.scheduled_live if item[4]!=key]
            for pitch in self.live_note_map.pop(key,[]):
                self.voice_off(self.selected,pitch,('live',ch,note,pitch))
            if ch not in self.capture_sustain:
                for k in list(self.pending):
                    if k[:2]==key:self.close_note(k)
        elif kind==0xb0 and note==64:
            s.pedal(value>=64); self.samplers[self.selected].pedal(value>=64)
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
    def strike(self,key,notes,velocity,strummed,chorded=True,count=0):
        """Sound one key's chord: the Bass note first and a little softer, the rest strummed in the
        chosen order. With Loop on the chord strums again every Loop rate while the key is down."""
        ch,note=key;chord=self.project.performance['chord']
        order=sorted(notes)
        bass=order.pop(0) if chorded and chord['enabled'] and chord.get('bass') and len(order)>1 else None
        direction=chord['strum_type']
        if direction=='Up-Down':direction='Down' if count%2 else 'Up'
        if direction in ('Down','Alt Down'):order.reverse()
        if direction in ('Alt Up','Alt Down') and len(order)>2:order=order[::2]+order[1::2]
        self.live_note_map[key]=([bass] if bass is not None else [])+order
        strum=chord['strum_ms'] if strummed else 0
        sync=STRUM_SYNC.get(chord.get('strum_sync','Off'),0.) if strummed else 0.
        hits=([(bass,round(velocity*.85),0)] if bass is not None else [])+[(p,velocity,i) for i,p in enumerate(order)]
        for pitch,vel,i in hits:
            token=('live',ch,note,pitch)
            delay=max(0,round(sync*i*self.fpb)) if sync else max(0,round(strum*i*self.rate/1000))
            if delay:
                self.scheduled_live.append((self.absolute_frame+delay,self.selected,pitch,max(1,vel),key,token))
            else:
                self.voice_on(self.selected,pitch,max(1,vel),token)
                if self.capturing_song():self.pending[(ch,note,pitch)]=(self.frame,max(1,vel),self.selected)
                elif self.count_end is not None and self.count_end-self.absolute_frame<=self.fpb/8:
                    self.count_early.append(((ch,note,pitch),max(1,vel),self.selected))
        if strummed and chorded and chord['enabled'] and chord.get('loop'):
            self.chord_loops[key]=(self.absolute_frame+max(1,round(CHORD_LOOP_RATES[chord['loop_rate']]*self.fpb)),count+1)
        else:self.chord_loops.pop(key,None)
    def chord_loop_tick(self,abs_end):
        """Loop on: strum the held chords again when their time comes (block accurate)."""
        state=self.project.performance
        if not self.chord_loops:return
        if state['arp']['enabled'] or not state['chord']['loop'] or not state['chord']['enabled']:
            self.chord_loops.clear();return
        for key,(due,count) in list(self.chord_loops.items()):
            if due>=abs_end:continue
            if key not in self.down or key not in self.live_note_map:self.chord_loops.pop(key,None);continue
            ch,note=key
            self.scheduled_live=[item for item in self.scheduled_live if item[4]!=key]
            notes=self.live_note_map[key]
            for pitch in notes:
                self.voice_off(self.selected,pitch,('live',ch,note,pitch))
                if (ch,note,pitch) in self.pending:self.close_note((ch,note,pitch))
            self.strike(key,notes,self.live_velocity.get(key,100),True,chorded=key not in self.explicit_keys,count=count)
    def key_chord(self,note,press=False,pad=False):
        """The notes one key plays: chord mode (with Voice lead from the chord before), or with
        Play in order the next My chords chord. `press` is a new key: it moves Voice lead and the order on."""
        state=self.project.performance;chord=state['chord']
        if press:self.lead_from=self.last_chord
        notes=None
        if chord['enabled'] and chord['follow'] and not pad:
            filled=sum(1 for c in chord['slots'] if c)
            if filled:
                if press or self.chord_now<0:self.chord_now=self.chord_step%filled
                notes,_=follow_chord(state,self.chord_now,self.lead_from)
                if press and CHORD_ADVANCE[chord['advance']]==0:self.chord_step=(self.chord_now+1)%filled
        if notes is None:notes=chord_notes(state,note,previous=self.lead_from,snap=not pad)
        if chord['enabled']:self.last_chord=chord_upper(notes,chord)
        return notes
    def rechord(self):
        """A chord option changed (type, voices, inversion, bass, voice lead, octave, key, order):
        the keys still down sound the new chord straight away, without pressing them again."""
        state=self.project.performance
        if not self.perform_held.keys and not self.perform_held.latched_keys:return
        fresh={}
        def notes_for(key,old):
            if key in self.explicit_keys:return old
            if key not in fresh:fresh[key]=self.key_chord(key[1],pad=key in self.pad_keys)
            return fresh[key]
        if not state['arp']['enabled']:
            for key in list(self.live_note_map):
                if key not in self.down or key in self.explicit_keys:continue
                ch,note=key;old=self.live_note_map[key];new=notes_for(key,old)
                if sorted(old)==sorted(new):continue
                velocity=self.live_velocity.get(key,100)
                self.scheduled_live=[item for item in self.scheduled_live if item[4]!=key or item[2] in new]
                for pitch in old:
                    if pitch not in new:
                        self.voice_off(self.selected,pitch,('live',ch,note,pitch))
                        if (ch,note,pitch) in self.pending:self.close_note((ch,note,pitch))
                for pitch in new:
                    if pitch not in old:
                        self.voice_on(self.selected,pitch,velocity,('live',ch,note,pitch))
                        if self.capturing_song():self.pending[(ch,note,pitch)]=(self.frame,velocity,self.selected)
                self.live_note_map[key]=[p for p in old if p in new]+[p for p in new if p not in old]
        self.perform_held.remap(notes_for)
    def chord_bar_advance(self,start,end,abs_start,abs_end):
        """Play in order by bars: move to the next saved chord every 1 or 2 bars while keys are down.
        Transport running: on the bar lines. Stopped: counted from the first key of the phrase.
        A key pressed just before the line (half a beat) already chose this bar's chord."""
        chord=self.project.performance['chord'];bars=CHORD_ADVANCE[chord['advance']]
        if not (chord['enabled'] and chord['follow'] and bars):return
        if not self.perform_held.keys and not (self.perform_held.hold and self.perform_held.latched_keys):return
        span=round(bars*4*self.fpb)
        if self.playing:
            line=math.ceil(start/span)*span
            if not start<=line<end or line==0:return
        else:
            k=math.ceil((abs_start-self.chord_phrase_frame)/span)
            line=self.chord_phrase_frame+k*span
            if k<1 or not abs_start<=line<abs_end:return
        if self.absolute_frame-self.chord_key_frame<self.fpb/2:return
        filled=sum(1 for c in chord['slots'] if c)
        if not filled:return
        self.chord_now=(max(0,self.chord_now)+1)%filled;self.chord_step=self.chord_now
        self.lead_from=self.last_chord
        self.rechord()
    def step_record(self,notes,velocity):
        """Step rec: a key (synth) or pad (Drum Rack) writes the step under the rec cursor of the open
        SEQ pattern, then the cursor moves on. Keys pressed together (within 80 ms, earlier ones still
        held) form one chord on one step. The song clip is never written by step rec."""
        state=self.project.performance;pattern=current_pattern(state)
        emitted=[dict(note=n,velocity=velocity,tie=1) for n in notes[:8]]
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
    def capturing_song(self):
        """Song REC captures live keys, except while step rec owns the keys for the pattern."""
        return self.recording and not self.project.performance['seq']['recording']
    def panic(self):
        self.stop_sample_preview()
        self.stop_pattern_preview()
        self.midi_learn=None
        self.cancel_count()
        self.finish_record(); self.down.clear(); self.capture_sustain.clear()
        self.perform_held.reset(); self.explicit_keys.clear(); self.live_note_map.clear(); self.scheduled_live.clear()
        for s in self.synths:s.panic()
        for rack in self.drums:rack.panic()
        for sampler in self.samplers:sampler.panic()
        self.drum_keys.clear()
        for fx in self.fx:fx.clear_gate_events(reset_origin=False)
        for keys in self.drum_gate_keys:keys.clear()
    def render(self,frames):return self._render_bus(frames,False)
    def render_stereo(self,frames):return self._render_bus(frames,True)
    def export_wav(self,path,seconds=None):
        from .render_export import export_wav
        return export_wav(self,path,seconds)
    def _sampler_pan(self,tr,t,fx):
        """A Sampler track's own Pan knob (as it plays, so a turning knob is heard) plus its macro / mod pad offset."""
        if device_kind(t)!='sampler' or tr>=len(self.samplers):return 0.
        spec=self.samplers[tr].spec
        return (spec.get('pan',0.) if spec else 0.)+getattr(fx,'sampler',{}).get('pan',0.)
    def _render_tracks_c(self,bufs,pos,count,frozen,live_frozen,drum_right):
        """One slice of the block (between two note events) for every track, straight into its C buffers."""
        for tr,s in enumerate(self.synths):
            left=bufs.left[tr];right=bufs.right[tr]
            if frozen[tr]:
                if not self._freeze_live(tr,s):
                    cbus.zero(left,pos,count)
                    if drum_right[tr] is not None:cbus.zero(right,pos,count)
                    continue
                live_frozen[tr]=True
            s.render_into(left,pos,count)
            kind=device_kind(self.project.tracks[tr])
            if kind=='drum_rack':
                # Drum Rack tracks carry their own right channel (per-pad pan).
                ctypes.memmove(cbus.addr(right,pos),cbus.addr(left,pos),8*count)
                self.drums[tr].render_into_buffers(left,right,pos,count)
            elif kind=='sampler':
                smp=self.samplers[tr];smp.bpm=self.project.bpm;smp.clock=(getattr(self,'_block_start',0)+pos)/self.fpb if self.playing else None
                smp.render_into_buffer(left,pos,count)
    def _mix_c(self,bufs,n,start,abs_start,abs_end,frozen,live_frozen,drum_right,freeze_mode,click,click_on):
        """FX, sends, mix and master for a block whose audio is in C buffers (the C twin of the Python mix in
        _render_bus, same order and arithmetic). Returns the interleaved block, or None when the master stage
        is not there (bufs.mix then holds the mix for the Python limiter)."""
        c=cbus.lib();tracks=len(self.synths);addr=cbus.addr
        mix,mix_r=bufs.mix,bufs.mix_r;cbus.zero(mix,0,n);cbus.zero(mix_r,0,n)
        bus_in=self.send_buses.start_block_c(n)
        has_right=[r is not None for r in drum_right]
        # Ducking and Vocoder hear another track's own sound (before its FX and volume), even when muted:
        # copy it now, before the FX below change the buffers in place.
        keys=[None]*tracks
        for tr,fx in enumerate(self.fx[:tracks]):
            sources=fx.key_sources()
            if not any(s is not None for s in sources):continue
            pair=[]
            for slot,src in enumerate(sources):
                if src is None or src==tr or not 0<=src<tracks:pair.append(None);continue
                dst=bufs.keys[tr][slot]
                if has_right[src]:c.dsfx_buf_avg(addr(dst),addr(bufs.left[src]),addr(bufs.right[src]),n)
                else:cbus.copy(dst,bufs.left[src],n)
                pair.append(dst)
            keys[tr]=pair
        step=2/max(1,.005*self.rate);bpm=self.project.bpm;beat=abs_start/self.fpb
        for tr,(t,fx) in enumerate(zip(self.project.tracks[:tracks],self.fx)):
            if t['mute']:continue
            left=bufs.left[tr];right=bufs.right[tr]
            if frozen[tr] and not live_frozen[tr] and self.fx_live_until[tr]<=abs_start:
                cbus.zero(left,0,n);cbus.zero(right,0,n)  # no live notes: the FX rest too
            else:
                if frozen[tr]:self.fx_live_until[tr]=abs_end+round(3*self.rate)
                fx.process_buffers(bufs,left,right,n,has_right[tr],bpm,beat,modulated=True,key=keys[tr],
                                   clock=start/self.fpb if self.playing else None,frame=abs_start)
            if frozen[tr] or tr in self.freeze_ring:
                looping=freeze_mode=='loop' or self.project.song['loop']
                block=self._freeze_block(tr,start,n,looping,freeze_mode)
                if block is not None:
                    fl,fr=block;cbus.add_list(left,fl,n);cbus.add_list(right,fr,n)
            if self.capture_track==tr:self.captured.append((left[:n],right[:n]))
            vol=min(1.,max(0.,t['volume']+fx.sound.get('volume',0.)))
            amounts=send_buses.track_amounts(t);sends=[]
            for bus,a in zip(send_buses.BUSES,amounts):
                if a>0:
                    self.send_buses.mark_fed(bus);bl,br=bus_in[bus];sends+=[addr(bl),addr(br),a]
                else:sends+=[None,None,0.]
            pan=min(1.,max(-1.,t['instrument'].get('pan',0.)+fx.sound.get('pan',0.)+self._sampler_pan(tr,t,fx)))
            bufs.pan[0]=pan if self._pan_state[tr] is None else self._pan_state[tr]
            c.dsfx_mix_track(addr(left),addr(right),n,vol,pan,addr(bufs.pan),step,addr(mix),addr(mix_r),*sends)
            self._pan_state[tr]=bufs.pan[0]
        self.send_buses.mix_into_c(bufs,bpm,beat)
        # Standalone dry sample audition uses the real native audio clock.
        self._render_sample_preview_into(mix,mix_r,n)
        master=getattr(self,'master',None)
        if master is None:master=self.master=MasterStage(self.rate)
        if not (master.available and self.master_enabled):return None
        if click_on:
            for j,v in enumerate(click):
                k=v*.25 if v is not None else 0.;mix[j]=mix[j]+k;mix_r[j]=mix_r[j]+k
        return bufs.master(master,n)
    def _render_bus(self,frames,stereo):
        result=[]; remaining=frames
        while remaining:
            n=self.automation_block(min(remaining,128))
            if self.recording:n=min(n,max(1,self.record_end-self.frame))
            if self.count_end is not None:n=min(n,max(1,self.count_end-self.absolute_frame))
            events={0:[]}; start=self.frame; end=start+n; self._block_start=start
            abs_start=self.absolute_frame; abs_end=abs_start+n
            # Macros and mod pads move FX and Sound knobs once per block, before the voices render.
            for tr,(fx,synth) in enumerate(zip(self.fx,self.synths)):
                auto=self.automation_values[tr];fx.watched=tr==self.selected;fx.modulate(abs_start/self.fpb,auto)
                for (module,param),value in auto.items():
                    if module=='sound':
                        base=self.project.tracks[tr]['volume'] if param=='volume' else synth.params.get(param,sound_default(synth.params,param))
                        fx.sound[param]=fx.sound.get(param,0.)+value-base
                synth.modulate(fx.sound)
                if tr<len(self.samplers):self.samplers[tr].mod=getattr(fx,'sampler',{})
                if tr<len(self.drums):self.drums[tr].mod=getattr(fx,'drum',{})
                # The resonator's strings follow the notes this track is playing.
                if fx.active:
                    sc=self.project.performance['scale'];fx.set_scale(KEY_SCALES.get(sc['name'],range(12)),sc['root'])
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
            for offset,action,tr,pitch,velocity,token in self.preview_events(abs_start,abs_end):
                events.setdefault(offset,[]).append((5,action,tr,pitch,velocity,token))
            # Frozen tracks play their audio file instead of their notes, synth and FX (freeze_engine.py).
            freeze_mode='song' if self.project.song['on'] and not self.recording else 'loop'
            frozen=[self.frozen_active(tr,freeze_mode) for tr in range(len(self.synths))]
            for tr,on in enumerate(frozen):
                if on and not self._frozen_on[tr]:
                    # Song and loop notes started live would never get their note-off now: let them go.
                    # Keys, arp and chords played live on the track keep sounding.
                    self.synths[tr].cancel_sources(('loop',));self.drums[tr].cancel_source('loop');self.samplers[tr].cancel_sources(('loop',))
                self._frozen_on[tr]=on
            self.chord_bar_advance(start,end,abs_start,abs_end);self.chord_loop_tick(abs_end)
            if self.playing:self.freeze_ring.clear()
            if self.playing:
                loop=self.project.beats*self.fpb
                song=self.project.song if self.project.song['on'] and not self.recording else None
                # A song that doesn't loop stops after its last bar: the transport rewinds and the
                # notes still sounding are released (not cut), so the ending rings out.
                if song and not song['loop'] and start>=round(song['length']*4*self.fpb):
                    # Frozen tracks ring out from where the transport stopped (their file holds the tail).
                    self.freeze_ring={tr:start for tr in range(len(frozen)) if frozen[tr]}
                    self.playing=False; self.frame=0; start=0; end=n; self.release_loops()
                for tr,t in enumerate(self.project.tracks if self.playing else []):
                    if t['mute'] or frozen[tr]:continue
                    if song:
                        # Timeline: each bar plays the bar of its block's clip that lines up with the grid.
                        for beat,action,key,bar,note in songs.song_events(song,lambda k:self.project.clip_notes(tr,k),tr,
                                                                          start/self.fpb-1,end/self.fpb+1,self.project.bars,self._bucket_cache):
                            when=round(beat*self.fpb)
                            if start<=when<end:events.setdefault(when-start,[]).append((action,tr,key,bar,note))
                        continue
                    for when,action,idx,cycle,note in songs.loop_events(self._bucket_cache,tr,t['notes'],start,end,loop,self.fpb):
                        events.setdefault(when-start,[]).append((action,tr,idx,cycle,note))
                # Stop/rewind moves the clock behind the phrase start: restart the phrase from there.
                if self.arp_anchor_beat*self.fpb>end:self.arp_anchor_beat=start/self.fpb
                if self.playing and not self.freeze_render and not self.project.tracks[self.selected]['mute']:
                    generated=schedule_notes(self.project.performance,[] if self.arp_paused else self.perform_held.held(),
                                             start,end,self.fpb,velocities=self.perform_held.velocities(),
                                             arp_anchor=self.arp_anchor_beat*self.fpb)
                    for offset,action,pitch,velocity,token in generated:
                        if getattr(self,'_pattern_preview',None) and token[0]=='perf_seq':continue
                        events.setdefault(offset,[]).append((3,action,self.selected,pitch,velocity,token))
                if self.playing and self.project.metronome:
                    b=math.ceil(start/self.fpb); tick=round(b*self.fpb)
                    if start<=tick<end:events.setdefault(tick-start,[]).append((2,b))
            if self.count_end is not None:
                # Count-in clicks on the audio clock (the transport is still stopped); beat 1 is accented.
                k=max(0,math.ceil((abs_start-self.count_start)/self.fpb-1e-9))
                while True:
                    tick=self.count_start+round(k*self.fpb)
                    if tick>=abs_end or tick>=self.count_end:break
                    if tick>=abs_start:events.setdefault(tick-abs_start,[]).append((2,0 if k==0 else k))
                    k+=1
            offsets=sorted(set(events)|{n})
            # The C path (cbus.py): each track's audio stays in its fixed C buffers for the whole block.
            use_c=stereo and n<=cbus.BLOCK and cbus.available() and not getattr(self,'python_bus',False)
            if use_c:
                bufs=self._cbufs=getattr(self,'_cbufs',None) or cbus.TrackBuffers();bufs.ensure(len(self.synths))
            track_audio=[[] for _ in self.synths]; click=[]; click_on=False; live_frozen=[False]*len(self.synths)
            # Drum Rack tracks carry their own right channel (per-pad pan); synth tracks stay mono into the FX.
            drum_right=[[] if stereo and device_kind(t)=='drum_rack' else None for t in self.project.tracks]
            for pos,nextpos in zip(offsets,offsets[1:]):
                self._event_frame=abs_start+pos
                for event in sorted(events[pos],key=lambda x:x[0]):
                    if event[0]==2:self.click_age=0; self.click_freq=1500 if event[1]%4==0 else 1000; continue
                    if event[0]==5:
                        _,action,tr,pitch,velocity,token=event
                        if action:self.voice_on(tr,pitch,velocity,token)
                        else:self.voice_off(tr,pitch,token)
                        continue
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
                if use_c:self._render_tracks_c(bufs,pos,count,frozen,live_frozen,drum_right)
                for tr,(buf,s) in enumerate(zip(track_audio,self.synths) if not use_c else ()):
                    if frozen[tr]:
                        if not self._freeze_live(tr,s):
                            buf.extend([0.]*count)
                            if drum_right[tr] is not None:drum_right[tr].extend([0.]*count)
                            continue
                        live_frozen[tr]=True
                    part=s.render(count)
                    if device_kind(self.project.tracks[tr])=='drum_rack':
                        if drum_right[tr] is not None:
                            rpart=list(part);self.drums[tr].render_into(part,count,rpart);drum_right[tr].extend(rpart)
                        else:self.drums[tr].render_into(part,count)
                    elif device_kind(self.project.tracks[tr])=='sampler':
                        smp=self.samplers[tr];smp.bpm=self.project.bpm;smp.clock=(start+pos)/self.fpb if self.playing else None;smp.render_into(part,count)
                    buf.extend(part)
                if self.click_age>=self.rate*.025:click.extend([None]*count)  # metronome silent: no per-sample work
                else:
                    click_on=True
                    for j in range(count):
                        if self.click_age<self.rate*.025:
                            click.append(.15*math.sin(self.click_age/self.rate*2*math.pi*self.click_freq)*(1-self.click_age/(self.rate*.025)))
                            self.click_age+=1
                        else:click.append(None)
            mastered=None
            if use_c:
                mastered=self._mix_c(bufs,n,start,abs_start,abs_end,frozen,live_frozen,drum_right,freeze_mode,click,click_on)
                if mastered is None:mix=bufs.mix[:n];right=bufs.mix_r[:n]  # no C master stage: the Python limiter below
                else:click=()
            # Per-track FX run once per block, then the mix is summed in the original order.
            if not use_c:mix=[0.]*n;right=[0.]*n if stereo else None
            # Sends: each track feeds the shared Reverb and Delay after its volume and pan.
            bus_in=self.send_buses.start_block(n,stereo) if not use_c else {}
            # Ducking and Vocoder hear another track's own sound (before its FX and volume), even when muted.
            keys=[None]*len(track_audio)
            for tr,fx in enumerate(self.fx if not use_c else ()):
                if tr>=len(track_audio):break
                sources=fx.key_sources()
                if not any(s is not None for s in sources):continue
                pair=[]
                for src in sources:
                    if src is None or src==tr or not 0<=src<len(track_audio):pair.append(None);continue
                    a=track_audio[src];r=drum_right[src]
                    pair.append([(x+y)*.5 for x,y in zip(a,r)] if r else a)
                keys[tr]=pair
            for tr,(t,fx,audio) in enumerate(zip(self.project.tracks,self.fx,track_audio) if not use_c else ()):
                if not t['mute']:
                    process=fx.process_stereo if stereo else fx.process
                    extra={'right':drum_right[tr]} if stereo and drum_right[tr] is not None else {}
                    if frozen[tr] and not live_frozen[tr] and self.fx_live_until[tr]<=abs_start:
                        audio=([0.]*n,[0.]*n) if stereo else [0.]*n  # no live notes: the FX rest too
                    else:
                        if frozen[tr]:self.fx_live_until[tr]=abs_end+round(3*self.rate)
                        audio=process(audio,self.project.bpm,abs_start/self.fpb,modulated=True,key=keys[tr],
                                      clock=start/self.fpb if self.playing else None,frame=abs_start,**extra)
                    if frozen[tr] or tr in self.freeze_ring:
                        looping=freeze_mode=='loop' or self.project.song['loop']
                        block=self._freeze_block(tr,start,n,looping,freeze_mode)
                        if block is not None:
                            fl,fr=block
                            if stereo:audio=([a+b for a,b in zip(audio[0],fl)],[a+b for a,b in zip(audio[1],fr)])
                            else:audio=[a+(b+c)*.5 for a,b,c in zip(audio,fl,fr)]
                    if self.capture_track==tr and stereo:self.captured.append((list(audio[0]),list(audio[1])))
                    vol=min(1.,max(0.,t['volume']+fx.sound.get('volume',0.)))
                    feeds=[(bus,a) for bus,a in zip(send_buses.BUSES,send_buses.track_amounts(t)) if a>0]
                    for bus,_ in feeds:self.send_buses.mark_fed(bus)
                    if stereo:
                        pan=min(1.,max(-1.,t['instrument'].get('pan',0.)+fx.sound.get('pan',0.)+self._sampler_pan(tr,t,fx)))
                        left_audio,right_audio=audio;current=pan if self._pan_state[tr] is None else self._pan_state[tr]
                        step=2/max(1,.005*self.rate)
                        if not any(left_audio) and not any(right_audio):
                            current=pan  # a silent block adds nothing: the pan glide has nothing to smooth
                        elif current==pan:
                            # Pan has settled: the gains are constant over the block, so mix whole lists at once
                            # (same arithmetic, same order, as the per-sample loop below).
                            gl=vol*(1-current)*.5;gr=vol*(1+current)*.5
                            mix[:]=[m+l*gl for m,l in zip(mix,left_audio)];right[:]=[m+r*gr for m,r in zip(right,right_audio)]
                            for bus,a in feeds:
                                bl,br=bus_in[bus]
                                bl[:]=[b+l*gl*a for b,l in zip(bl,left_audio)];br[:]=[b+r*gr*a for b,r in zip(br,right_audio)]
                        else:
                            for j,(l,r) in enumerate(zip(left_audio,right_audio)):
                                current+=min(step,max(-step,pan-current))
                                gl=vol*(1-current)*.5;gr=vol*(1+current)*.5
                                mix[j]+=l*gl;right[j]+=r*gr
                                for bus,a in feeds:
                                    bl,br=bus_in[bus];bl[j]+=l*gl*a;br[j]+=r*gr*a
                        self._pan_state[tr]=current
                    else:
                        for j,v in enumerate(audio):mix[j]+=v*vol
                        for bus,a in feeds:
                            bl=bus_in[bus][0]
                            for j,v in enumerate(audio):bl[j]+=v*vol*a
            # Standalone dry sample audition uses the real native audio clock.
            # It never alters a pad, SONG notes, the FX chain, or playback state.
            if not use_c:
                self.send_buses.mix_into(mix,right,self.project.bpm,abs_start/self.fpb)
                self._render_sample_preview_into(mix,right,n)
            # Master: the C stage below; without it (an older library, or the mono render) the old limiter turns
            # the mix down when it would go over 0.9 and lets go over ~40 ms (hard clipping sounds like crackle).
            g=self.limit
            master=getattr(self,'master',None)
            if master is None:master=self.master=MasterStage(self.rate)
            if mastered is not None:pass
            elif stereo and master.available and self.master_enabled:
                # The master stage in C (fx.MasterStage): makeup, glue, tone polish, true-peak limiter.
                if click_on:
                    mix[:]=[m+(c*.25 if c is not None else 0.) for m,c in zip(mix,click)]
                    right[:]=[m+(c*.25 if c is not None else 0.) for m,c in zip(right,click)]
                mastered=master.process(mix,right); click=()
            else:mastered=None
            if mastered is None and stereo and not click_on:
                # No metronome click in this block. The limiter gain only recovers upward, so if the loudest
                # sample still fits under 0.9 at the block's final gain, nothing is limited and the gain is
                # a fixed curve: apply it to whole lists instead of sample by sample.
                peak=max(max(map(abs,mix),default=0.),max(map(abs,right),default=0.),max(map(abs,map(add,mix,right)),default=0.))
                gone=1.-g;curve=[1.-gone*p for p in _limit_curve(n)]
                if peak*curve[-1]<=.9:
                    mix[:]=[m*k for m,k in zip(mix,curve)];right[:]=[m*k for m,k in zip(right,curve)];g=curve[-1];click=()
            for j,c in enumerate(click):
                x=mix[j]+(c if c is not None else 0.)
                if stereo:
                    l=mix[j]+(c*.5 if c is not None else 0.);r=right[j]+(c*.5 if c is not None else 0.)
                    peak=max(abs(l),abs(r),abs(l+r))
                    if peak*g>.9:g=.9/peak
                    else:g+=(1.-g)*.0005
                    mix[j]=l*g;right[j]=r*g
                    continue
                ax=abs(x)*g
                if ax>.9:g=.9/abs(x)
                else:g+=(1.-g)*.0005
                x*=g
                mix[j]=x if -.95<x<.95 else math.tanh(x)
            self.limit=g
            result.extend(mastered if mastered is not None else chain.from_iterable(zip(mix,right)) if stereo else mix)
            if self.playing:self.frame+=n
            self.absolute_frame+=n
            self._event_frame=None
            if self.recording and self.frame>=self.record_end:self.finish_record()
            if self.count_end is not None and self.absolute_frame>=self.count_end:self._count_done()
            remaining-=n
        return result
