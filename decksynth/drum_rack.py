"""Sixteen sample pads on the native mono bus. No I/O or decoding in render.

Each track owns 32 preallocated voices and at most 32 short replacement tails.
Overload replaces the oldest onset deterministically, crossfading its cursor for
8 ms. Repeated steals fade the last combined slot value without adding cursors.
Retriggered one-shots may overlap. Sources are shared float32 cache arrays.
"""
import copy
import math
import re
import uuid
from .samples import validate_source
from .drum_native import NativeDrumMixer, native_kernel, native_error
from .drum_shape import PadShaper, is_identity, pan_gains, render_key, validate_shape

PAD_COUNT = 16
VOICE_LIMIT = 32
NAMES = ('Kick', 'Kick 2', 'Snare', 'Clap', 'Rim', 'Percussion', 'Closed Hat', 'Open Hat',
         'Shaker', 'Low Tom', 'Mid Tom', 'High Tom', 'Cowbell', 'Tambourine', 'Ride', 'Crash')
RANGES = {'gain': (0., 2.), 'velocity': (0., 2.), 'tune': (-24., 24.)}


def new_kit():
    return dict(version=1, id=uuid.uuid4().hex, pads=[dict(note=36+i, name=name, source=None,
        gain=1., velocity=1., mute=False, solo=False, tune=0., choke=1 if i in (6, 7) else 0)
        for i, name in enumerate(NAMES)])


def validate_kit(value):
    required={'version','id','pads'}
    if not isinstance(value, dict) or not required<=set(value) or set(value)-required-{'name'}:
        raise ValueError('Invalid Drum Rack kit')
    if type(value['version']) is not int or value['version'] != 1:
        raise ValueError('Unsupported Drum Rack kit version')
    if not isinstance(value['id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value['id']):
        raise ValueError('Invalid Drum Rack identity')
    if not isinstance(value['pads'], list) or len(value['pads']) != PAD_COUNT:
        raise ValueError('Drum Rack requires exactly sixteen pads')
    if 'name' in value and (not isinstance(value['name'],str) or not 1<=len(value['name'])<=80):
        raise ValueError('Invalid Drum Rack kit name')
    out = copy.deepcopy(value)
    for i, p in enumerate(out['pads']):
        base = {'note', 'name', 'source', 'gain', 'velocity', 'mute', 'solo', 'tune', 'choke'}
        if not isinstance(p, dict) or set(p) not in (base, base | {'shape'}):
            raise ValueError('Invalid drum pad fields')
        if 'shape' in p: p['shape'] = validate_shape(p['shape'])
        if type(p['note']) is not int or p['note'] != 36+i:
            raise ValueError('M1 pads use MIDI notes 36–51')
        if not isinstance(p['name'], str) or not 1 <= len(p['name']) <= 80:
            raise ValueError('Invalid drum pad name')
        for key, (low, high) in RANGES.items():
            v = p[key]
            if type(v) not in (int, float) or not math.isfinite(v) or not low <= v <= high:
                raise ValueError('Invalid drum pad '+key)
        if type(p['mute']) is not bool or type(p['solo']) is not bool:
            raise ValueError('Mute and Solo must be boolean')
        if type(p['choke']) is not int or not 0 <= p['choke'] <= 16:
            raise ValueError('Choke group must be 0–16')
        if p['source'] is not None: p['source'] = validate_source(p['source'])
    return out


class Voice:
    __slots__ = ('token','sample', 'pad', 'pos', 'step', 'gain', 'age', 'stamp', 'remaining',
                 'old_sample', 'old_pos', 'old_step', 'old_gain', 'old_age', 'old_remaining',
                 'old_scalar', 'last', 'gl', 'gr', 'old_gl', 'old_gr')

    def __init__(self):
        self.token=None;self.sample = None; self.old_sample = None
        self.pad = -1; self.pos = 0.; self.step = 1.; self.gain = 0.; self.age = 0
        self.stamp = 0; self.remaining = -1
        self.old_pos = 0.; self.old_step = 1.; self.old_gain = 0.; self.old_age = 0; self.old_remaining = 0
        self.old_scalar = 0.; self.last = 0.
        self.gl = self.gr = self.old_gl = self.old_gr = 1.


class DrumRack:
    def __init__(self, rate, cache):
        self.rate = rate; self.cache = cache; self.kit = None
        self.mod = {}   # macro / mod pad offsets by '<pad>:<key>', read on each hit
        self.voices = [Voice() for _ in range(VOICE_LIMIT)]
        self.samples = [None]*PAD_COUNT  # what the pads play: the source PCM, or its shaped copy
        self.raw = [None]*PAD_COUNT      # the source PCM from the sample cache
        self.shaping = [0]*PAD_COUNT; self.shaped_key = [None]*PAD_COUNT
        self.loading = [False]*PAD_COUNT; self.errors = [None]*PAD_COUNT
        self.events = [0]*PAD_COUNT; self.serial = 0; self.stamp = 0
        self.fade_frames = max(1, round(rate*.008)); self.attack_frames = max(1, round(rate*.001))
        kernel = native_kernel()  # Startup only; render never loads/builds libraries.
        self._native = NativeDrumMixer(kernel, VOICE_LIMIT) if kernel is not None else None

    @property
    def active_count(self):
        return sum(v.sample is not None or v.old_remaining > 0 for v in self.voices)

    def configure(self, kit):
        previous = self.kit
        if previous is None or kit is None or previous['id'] != kit['id']:
            self.panic()
        self.kit = kit
        for i in range(PAD_COUNT):
            source = kit['pads'][i]['source'] if kit else None
            prior = previous['pads'][i]['source'] if previous else None
            if source != prior:
                self.fade_pad(i); self.errors[i] = None; self.loading[i] = False
            if source != prior or previous is None or kit is None:
                self.raw[i] = self.cache.get(source['sha256']) if source and self.cache else None
            self.reshape(i)
        if kit:
            solo = any(p['solo'] for p in kit['pads'])
            for i, p in enumerate(kit['pads']):
                if p['mute'] or (solo and not p['solo']): self.fade_pad(i)

    def bind(self, index, sample):
        self.raw[index] = sample; self.loading[index] = False; self.errors[index] = None
        self.shaped_key[index] = None; self.reshape(index)

    def missing(self, index, error):
        self.raw[index] = None; self.samples[index] = None; self.shaped_key[index] = None
        self.loading[index] = False; self.errors[index] = str(error)

    def reshape(self, index):
        """Play the pad's shaped copy. Rendering happens off the audio path; until it is ready the
        previous copy (or the plain sample) keeps playing."""
        raw = self.raw[index]; shape = self.kit['pads'][index].get('shape') if self.kit else None
        if raw is None:
            self.samples[index] = None; self.shaped_key[index] = None; return
        step = 2**(self.kit['pads'][index]['tune']/12.)
        rk = render_key(shape)
        # Tune is part of the key: the copy is rendered so envelope times and EQ stay in real seconds/Hz.
        key = (id(raw), None if rk is None else (rk, round(step, 9)))
        prior = self.shaped_key[index]
        if key == prior: return
        self.shaped_key[index] = key; self.shaping[index] += 1; serial = self.shaping[index]
        if key[1] is None or prior is None or prior[0] != key[0]:
            self.samples[index] = raw  # a new sample never plays the previous sample's shaped copy
        if key[1] is None: return

        def ready(shaped):
            if self.shaping[index] == serial and self.raw[index] is raw: self.samples[index] = shaped
        PadShaper.submit(raw, shape, self.rate, ready, step)

    def fade_pad(self, pad):
        for v in self.voices:
            if v.sample is not None and v.pad == pad:
                v.remaining = min(v.remaining, self.fade_frames) if v.remaining >= 0 else self.fade_frames

    def on(self, note, velocity, token=None):
        if not self.kit or not 36 <= note <= 51 or not 1 <= velocity <= 127: return False
        pad = note-36; p = self.kit['pads'][pad]; sample = self.samples[pad]
        if sample is None or p['mute'] or any(x['solo'] for x in self.kit['pads']) and not p['solo']: return False
        if p['choke']:
            for v in self.voices:
                if v.sample is not None and self.kit['pads'][v.pad]['choke'] == p['choke']:
                    v.remaining = min(v.remaining, self.fade_frames) if v.remaining >= 0 else self.fade_frames
        v = next((v for v in self.voices if v.sample is None and v.old_sample is None and v.old_remaining <= 0), None)
        if v is None: v = min(self.voices, key=lambda slot: slot.stamp)
        if v.old_remaining > 0:
            # A second steal must not replace an audible tail with age-zero PCM.
            # Fade the actual last combined slot output using one bounded scalar.
            v.old_sample = None; v.old_scalar = v.last; v.old_gl = v.gl; v.old_gr = v.gr  # last is the slot's unpanned output
            v.old_remaining = self.fade_frames
        elif v.sample is not None:
            v.old_sample = v.sample; v.old_pos = v.pos; v.old_step = v.step
            v.old_gain = v.gain; v.old_age = v.age; v.old_scalar = 0.; v.old_gl = v.gl; v.old_gr = v.gr
            v.old_remaining = min(self.fade_frames, v.remaining) if v.remaining >= 0 else self.fade_frames
        else:
            v.old_sample = None; v.old_scalar = 0.; v.old_remaining = 0; v.last = 0.
        self.stamp += 1
        m = self.mod; shape = p.get('shape')
        tune = p['tune'] + m.get(f'{pad}:tune', 0.); level = max(0., p['gain'] + m.get(f'{pad}:gain', 0.))
        if f'{pad}:pan' in m: shape = dict(shape or {}, pan=min(1., max(-1., (shape or {}).get('pan', 0.) + m[f'{pad}:pan'])))
        v.token=token;v.sample = sample; v.pad = pad; v.pos = 0.; v.step = 2**(tune/12.)
        v.gain = level*(velocity/127.)**p['velocity']; v.age = 0
        v.stamp = self.stamp; v.remaining = -1; v.gl, v.gr = pan_gains(shape)
        self.serial += 1; self.events[pad] = self.serial
        return True

    @staticmethod
    def off(note, token=None):
        pass  # Ordinary one-shots always finish; gated playback is outside M1.

    def cancel_source(self,prefix):
        for v in self.voices:
            if isinstance(v.token,tuple) and v.token[0]==prefix and v.sample is not None:
                v.remaining=min(v.remaining,self.fade_frames) if v.remaining>=0 else self.fade_frames

    def panic(self):
        for v in self.voices:
            v.sample = None; v.old_sample = None; v.old_remaining = 0
            v.old_scalar = 0.; v.last = 0.

    def _value(self, sample, pos, age, gain):
        i = int(pos)
        if i >= sample.frames: return 0.
        data = sample.data; frac = pos-i
        value = data[i] + ((data[i+1] if i+1 < sample.frames else 0.)-data[i])*frac
        env = min(1., age/self.attack_frames, (sample.frames-pos)/self.attack_frames)
        return value*gain*max(0., env)

    def render_into(self, out, frames, right=None):
        """Mix the pads into out (mono), or into out/right with each pad's pan when right is given."""
        if frames <= 0: return
        if self._native is not None:
            self._native.render_into(self.voices, out, frames, self.attack_frames, self.fade_frames, right)
            return
        for v in self.voices:
            if v.sample is None and v.old_remaining <= 0:
                v.last = 0.
                continue
            for i in range(frames):
                value = left = rgt = 0.
                if v.sample is not None:
                    value = self._value(v.sample, v.pos, v.age, v.gain)
                    if v.remaining >= 0:
                        value *= v.remaining/self.fade_frames; v.remaining -= 1
                    v.pos += v.step; v.age += 1
                    if v.pos >= v.sample.frames or v.remaining == 0: v.sample = None
                    left = value*v.gl; rgt = value*v.gr
                if v.old_remaining > 0:
                    old = (self._value(v.old_sample, v.old_pos, v.old_age, v.old_gain)
                           if v.old_sample is not None else v.old_scalar)
                    old *= v.old_remaining/self.fade_frames
                    value += old; left += old*v.old_gl; rgt += old*v.old_gr
                    if v.old_sample is not None:
                        v.old_pos += v.old_step; v.old_age += 1
                        if v.old_pos >= v.old_sample.frames: v.old_remaining = 1
                    v.old_remaining -= 1
                    if v.old_remaining <= 0: v.old_sample = None
                if right is None: out[i] += (left+rgt)*.5
                else: out[i] += left; right[i] += rgt
                v.last = value
                if v.sample is None and v.old_remaining <= 0:
                    if i+1 < frames: v.last = 0.
                    break

    def state(self):
        pads = []
        for i in range(PAD_COUNT):
            p = self.kit['pads'][i] if self.kit else None; sample = self.samples[i]
            playing = any((v.sample is not None or v.old_remaining > 0) and v.pad == i for v in self.voices)
            muted = bool(p and (p['mute'] or any(x['solo'] for x in self.kit['pads']) and not p['solo']))
            status = ('LOADING' if self.loading[i] else 'EMPTY' if not p or not p['source'] else
                      'MISSING' if sample is None else 'MUTED' if muted else 'PLAYING' if playing else 'READY')
            at = [round(v.pos/sample.frames, 4) for v in self.voices
                  if sample is not None and v.sample is sample and v.pad == i and sample.frames][:4]
            pads.append(dict(status=status, peaks=sample.peaks if sample else [],
                             event=self.events[i], playing=playing, error=self.errors[i], at=at))
        return dict(pads=pads, voices=self.active_count, voice_limit=VOICE_LIMIT, output='stereo',
                    accelerated=self._native is not None,
                    native_warning=native_error() if self._native is None else None)
