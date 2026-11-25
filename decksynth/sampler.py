"""Sampler track: one sample played across the keys (15 Nov, phase 2 of pad sampling).

A track with device 'sampler' keeps track['sampler']:
  version, id      1, and an identity like a Drum Rack kit's
  name             what it was made from ("Snare - Saucer")
  family           the drum family colour it came from ('snare', 'other', ...)
  source           the sample reference pads use (path, sha256, ...), or None
  shape            optional: the pad's shaping, rendered into the copy that plays
  root             the key where the sample plays at its own pitch (MIDI 0-127)
  tune, fine       semitones (-24..24) and cents (-100..100)
  mode             'oneshot' plays to the end, 'hold' plays while the key is held,
                   'loop' repeats loop_start..loop_end while held
  start, end, loop_start, loop_end   0..1 of the sample
  attack, decay, release (seconds), sustain (0..1): the amp envelope
  poly, glide      Poly or Mono; Mono glides between held notes for `glide` seconds
  gain, velocity   level and velocity response, as on a pad
  slices           optional: up to 64 [start, end] or [start, end, root] (0..1, in order, not overlapping) from Chop
  keymap           'whole' plays the trimmed sample on every key; 'slices' puts slice 1 on the root key,
                   slice 2 a semitone up and so on, each at its own pitch; 'pitched' plays the slice whose
                   detected root is nearest the key, tuned to it (a multisampled instrument)
  reverse, normalize   play backwards; bring the loudest peak to full level
  filter, cutoff, resonance   'off' / 'lp' / 'bp' / 'hp' state-variable filter per voice
  f_env, f_attack, f_decay, f_velocity   the filter's own envelope (±5 octaves) and velocity to cutoff
  p_env, p_decay   pitch envelope: starts p_env semitones away and settles over p_decay seconds
  mode 'grain'     every key plays a cloud of short grains from its region; the g_* keys shape it (sampler_grain.py)
"""
import copy
import ctypes as C
import math
import re
import uuid

from .samples import validate_source
from .drum_shape import PadShaper, render_key, validate_shape
from . import sampler_native
from . import sampler_grain as grain

POLY = 16          # notes that can sound at once
SLOTS = 24         # plus room for the short fades of stolen notes
MODES = ('oneshot', 'hold', 'loop', 'grain')
FAMILY = re.compile(r'[a-z]{1,16}')
RANGES = dict(tune=(-24., 24.), fine=(-100., 100.), start=(0., 1.), end=(0., 1.), loop_start=(0., 1.),
              loop_end=(0., 1.), attack=(0., 3.), decay=(0., 3.), sustain=(0., 1.), release=(0., 3.),
              glide=(0., 2.), gain=(0., 2.), velocity=(0., 2.))
KEYMAPS = ('whole', 'slices', 'pitched')
FILTERS = ('off', 'lp', 'bp', 'hp')
# Added with the sampler expansion; older projects get these defaults.
OPTIONAL = dict(keymap='whole', reverse=False, normalize=False, filter='off', cutoff=2000., resonance=.2,
                f_env=0., f_attack=0., f_decay=.3, f_velocity=0., p_env=0., p_decay=.15, **grain.DEFAULTS)
OPTIONAL_RANGES = dict(cutoff=(20., 20000.), resonance=(0., 1.), f_env=(-1., 1.), f_attack=(0., 3.), f_decay=(0., 3.),
                       f_velocity=(0., 1.), p_env=(-24., 24.), p_decay=(0., 3.), **grain.RANGES)
EDITABLE = set(RANGES) | set(OPTIONAL) | {'root', 'mode', 'poly', 'name', 'slices'}
MAX_SLICES = 64
MIN_SLICE = 1e-5    # a few frames of a ten-minute sample


def new_sampler(source=None, name='Sampler', family='other', shape=None, root=60, tune=0.):
    s = dict(version=1, id=uuid.uuid4().hex, name=name, family=family, source=source, root=root,
             tune=float(tune), fine=0., mode='hold', start=0., end=1., loop_start=0., loop_end=1.,
             attack=0., decay=0., sustain=1., release=.25, poly=True, glide=0., gain=1., velocity=1., slices=[], **OPTIONAL)
    if shape is not None: s['shape'] = shape
    return validate_sampler(s)


def validate_sampler(value):
    keys = {'version', 'id', 'name', 'family', 'source', 'root', 'mode', 'poly'} | set(RANGES)
    if not isinstance(value, dict) or not keys <= set(value) or set(value) - keys - {'shape', 'slices'} - set(OPTIONAL):
        raise ValueError('Invalid Sampler')
    if type(value['version']) is not int or value['version'] != 1: raise ValueError('Unsupported Sampler version')
    if not isinstance(value['id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value['id']):
        raise ValueError('Invalid Sampler identity')
    out = copy.deepcopy(value)
    for key, default in OPTIONAL.items(): out.setdefault(key, default)
    if out['keymap'] not in KEYMAPS: raise ValueError('Keys must be Whole, Slices or Pitched')
    if out['filter'] not in FILTERS: raise ValueError('Filter must be Off, LP, BP or HP')
    for key in ('reverse', 'normalize'):
        if type(out[key]) is not bool: raise ValueError(key.title() + ' must be on or off')
    for key in grain.MASKS: out[key] = grain.valid_masks(out[key])
    out['g_notes'] = grain.valid_notes(out['g_notes'])
    for key, options in grain.CHOICES.items():
        if out[key] not in options: raise ValueError('Invalid Sampler ' + key.replace('g_', 'grain ').replace('_', ' '))
    for key, (low, high) in OPTIONAL_RANGES.items():
        v = out[key]
        if type(v) not in (int, float) or not math.isfinite(v) or not low <= v <= high:
            raise ValueError('Invalid Sampler ' + key.replace('_', ' '))
        out[key] = float(v)
    if not isinstance(out['name'], str) or not 1 <= len(out['name']) <= 80: raise ValueError('Invalid Sampler name')
    if not isinstance(out['family'], str) or not FAMILY.fullmatch(out['family']): raise ValueError('Invalid Sampler colour')
    if out['source'] is not None: out['source'] = validate_source(out['source'])
    if 'shape' in out: out['shape'] = validate_shape(out['shape'])
    if type(out['root']) is not int or not 0 <= out['root'] <= 127: raise ValueError('Root note must be MIDI 0-127')
    if out['mode'] not in MODES: raise ValueError('Play mode must be One shot, Hold, Loop or Grain')
    if type(out['poly']) is not bool: raise ValueError('Poly must be on or off')
    for key, (low, high) in RANGES.items():
        v = out[key]
        if type(v) not in (int, float) or not math.isfinite(v) or not low <= v <= high:
            raise ValueError('Invalid Sampler ' + key.replace('_', ' '))
        out[key] = float(v)
    out['slices'] = validate_slices(out.get('slices', []))
    if not out['slices']: out['keymap'] = 'whole'   # Slices / Pitched need slices to play
    if out['end'] - out['start'] < .001: raise ValueError('Sampler end must come after its start')
    if out['loop_end'] - out['loop_start'] < .001: raise ValueError('Loop end must come after the loop start')
    return out


def validate_slices(value):
    if not isinstance(value, list) or len(value) > MAX_SLICES: raise ValueError('A Sampler holds at most %d slices' % MAX_SLICES)
    out = []; last = 0.
    for pair in value:
        if not isinstance(pair, (list, tuple)) or len(pair) not in (2, 3): raise ValueError('Invalid Sampler slice')
        a, b = pair[0], pair[1]
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in (a, b)): raise ValueError('Invalid Sampler slice')
        a = float(a); b = float(b)
        if a < last - 1e-12 or b - a < MIN_SLICE or b > 1.: raise ValueError('Slices must be in order, inside the sample and not overlap')
        if len(pair) == 3:
            if type(pair[2]) is not int or not 0 <= pair[2] <= 127: raise ValueError('A slice root must be MIDI 0-127')
            out.append([a, b, pair[2]])
        else: out.append([a, b])
        last = b
    return out


class Voice(C.Structure):
    _fields_ = [('pos', C.c_double), ('step', C.c_double), ('target', C.c_double), ('glide', C.c_double),
                ('env', C.c_double), ('rel', C.c_double), ('gain', C.c_double), ('pmul', C.c_double),
                ('a1', C.c_double), ('a2', C.c_double), ('a3', C.c_double), ('k', C.c_double), ('ic1', C.c_double), ('ic2', C.c_double),
                ('fade_left', C.c_int64), ('fade_len', C.c_int64), ('age', C.c_int64), ('stamp', C.c_int64),
                ('start', C.c_int64), ('end', C.c_int64), ('loop_start', C.c_int64), ('loop_end', C.c_int64), ('xfade', C.c_int64),
                ('active', C.c_int32), ('stage', C.c_int32), ('dir', C.c_int32), ('pad', C.c_int32)]


class Params(C.Structure):
    _fields_ = [('data', C.c_void_p), ('frames', C.c_int64), ('start', C.c_int64), ('end', C.c_int64),
                ('loop_start', C.c_int64), ('loop_end', C.c_int64), ('xfade', C.c_int64), ('edge', C.c_int64),
                ('mode', C.c_int32), ('filter', C.c_int32),
                ('attack', C.c_double), ('decay', C.c_double), ('sustain', C.c_double)]


class Sampler:
    """The voices of one Sampler track. Python objects only change between render calls."""
    def __init__(self, rate, cache):
        self.rate = rate; self.cache = cache; self.spec = None
        self.mod = {}; self._shifted = False; self._amp_live = False   # macro / mod pad offsets (fx.SAMPLER_TARGETS units)
        self.raw = None; self.sample = None; self.loading = False; self.error = None
        self.view = None   # (sha, a, b, peaks) while the waveform is zoomed
        self.shaping = 0; self.shaped_key = None; self._pending = None
        self.sustain = False; self.sustained = set()
        self.hold = False; self.latched = set()   # Hold (25 Nov): keys let go keep sounding until the next phrase or Hold off
        self.voices = (Voice * SLOTS)()
        self.notes = [None]*SLOTS      # (note, token) per slot, for note-off
        self.vels = [1.]*SLOTS         # velocity 0..1 per slot, for velocity to cutoff
        self.norm = 1.                 # Normalize: the gain that brings the loudest peak to full level
        self.params = Params(); self.stamp = 0; self.events = 0
        self.fade_frames = max(1, round(rate*.008))
        self.scratch = (C.c_double * 256)()
        self._kernel = sampler_native.kernel()
        if self._kernel is not None:
            self._kernel.argtypes = [C.POINTER(Voice), C.c_int, C.POINTER(Params), C.POINTER(C.c_double), C.c_int]
        # Grain mode: one cloud per voice slot, a shared pool of grains
        self.clouds = (grain.Cloud * SLOTS)(); self.grains = (grain.Grain * grain.GRAIN_POOL)(); self.gparams = grain.GrainParams()
        self.steppers = [None]*SLOTS
        self.roamers = [None]*SLOTS; self.bpm = 120.
        self.live = None   # Grain mode's live input (sampler_grain.LiveBuffer), while it is on
        self.clock = None; self._beat = None   # the song's beat at the next render while it plays (core sets it)   # Roam / Motion per slot; the engine keeps bpm up to date
        self._grain_kernel = sampler_native.grain_kernel()
        if self._grain_kernel is not None:
            self._grain_kernel.argtypes = [C.POINTER(Voice), C.POINTER(grain.Cloud), C.c_int, C.POINTER(Params),
                                           C.POINTER(grain.GrainParams), C.POINTER(grain.Grain), C.POINTER(C.c_double), C.c_int]

    @property
    def active_count(self):
        return sum(1 for v in self.voices if v.active)

    @property
    def accelerated(self):
        return self._kernel is not None

    # -- configuration ---------------------------------------------------------------------------
    def configure(self, spec):
        prior = self.spec
        if prior is None or spec is None or prior['id'] != spec['id'] or prior['source'] != spec['source']:
            self.panic(); self.error = None; self.loading = False
            source = spec['source'] if spec else None
            self.raw = self.cache.get(source['sha256']) if source and self.cache else None
            self.shaped_key = None; self.view = None
        self.spec = spec
        self.reshape()
        self._params()
        if prior is not None and spec is not None and prior['id'] == spec['id'] and prior['source'] == spec['source']:
            self._retune(prior, spec)

    def _retune(self, prior, spec):
        """Notes that are sounding follow Tune, Fine and Gain at once (a knob can be heard while it turns)."""
        shift = (spec['tune']-prior['tune']) + (spec['fine']-prior['fine'])/100.
        level = spec['gain']/prior['gain'] if prior['gain'] > 1e-6 and spec['gain'] != prior['gain'] else 1.
        if not shift and level == 1.: return
        ratio = 2.**(shift/12.)
        for v in self.voices:
            if not v.active: continue
            if shift: v.step *= ratio; v.target *= ratio; v.glide *= ratio
            if level != 1.: v.gain *= level

    def bind(self, sample):
        self.raw = sample; self.loading = False; self.error = None; self.shaped_key = None
        self.reshape(); self._params()

    def missing(self, error):
        self.raw = None; self.sample = None; self.shaped_key = None; self.loading = False; self.error = str(error)
        self.panic(); self._params()

    def reshape(self):
        """Play the pad's shaped copy when the Sampler was made from a shaped pad (shaped off the audio path)."""
        raw = self.raw; shape = self.spec.get('shape') if self.spec else None
        if raw is None:
            self.sample = None; self.shaped_key = None; return
        rk = render_key(shape)
        key = (id(raw), rk)
        if key == self.shaped_key: return
        self.shaped_key = key; self.shaping += 1; serial = self.shaping
        if rk is None:
            self.sample = raw; return
        if self.sample is None or self.sample.sha256 != raw.sha256: self.sample = raw

        def ready(shaped):  # runs on the shaping thread: the swap happens before the next render
            if self.shaping == serial and self.raw is raw: self._pending = (serial, shaped)
        PadShaper.submit(raw, shape, self.rate, ready, 1.)

    def take_pending(self):
        pending = self._pending
        if pending is None: return
        self._pending = None
        if pending[0] == self.shaping:
            self.sample = pending[1]; self._params()

    def _params(self):
        p = self.params; s = self.spec; sample = self.sample
        if s is not None and self.live is not None: return self._live_params()
        if s is None or sample is None or sample.frames < 4:
            p.data = None; p.frames = 0; return
        n = sample.frames
        start = min(n-2, int(s['start']*n)); end = max(start+2, min(n, int(round(s['end']*n))))
        ls = min(max(start, int(s['loop_start']*n)), end-2); le = max(ls+2, min(end, int(round(s['loop_end']*n))))
        p.data = sample.data.buffer_info()[0]; p.frames = n
        p.start, p.end, p.loop_start, p.loop_end = start, end, ls, le
        # A short crossfade over the loop point, so a held note doesn't click; it needs audio before the loop.
        p.xfade = max(0, min(round(self.rate*.01), (le-ls)//2, ls-start))
        p.edge = max(1, round(self.rate*.001))
        p.mode = MODES.index(s['mode']); p.filter = FILTERS.index(s['filter'])
        peak = max((max(hi, -lo) for lo, hi in sample.peaks), default=0.)
        self.norm = min(16., 1./peak) if s['normalize'] and peak > 1e-4 else 1.
        p.attack = 1./max(1., s['attack']*self.rate) if s['attack'] > 0 else 1./max(1., .001*self.rate)
        p.decay = (1.-s['sustain'])/max(1., s['decay']*self.rate) if s['decay'] > 0 else 1.
        p.sustain = s['sustain']
        self._sample_ref = sample  # keeps the PCM alive while the kernel reads it

    def _live_params(self):
        p = self.params; s = self.spec; live = self.live; n = len(live.data)
        p.data = live.data.buffer_info()[0]; p.frames = n
        p.start, p.end, p.loop_start, p.loop_end, p.xfade = 0, n, 0, n, 0
        p.edge = max(1, round(self.rate*.001)); p.mode = MODES.index(s['mode']); p.filter = FILTERS.index(s['filter'])
        self.norm = 1.
        p.attack = 1./max(1., s['attack']*self.rate) if s['attack'] > 0 else 1./max(1., .001*self.rate)
        p.decay = (1.-s['sustain'])/max(1., s['decay']*self.rate) if s['decay'] > 0 else 1.
        p.sustain = s['sustain']
        self._sample_ref = live

    def live_on(self):
        """Grains from the input as it comes in (the last 8 s), instead of the sample."""
        if self.live is None:
            self.panic(); self.live = grain.LiveBuffer(self.rate); self._params()

    def live_off(self):
        if self.live is not None:
            self.panic(); self.live = None; self._params()

    def live_feed(self, block):
        live = self.live
        if live is None: return
        moved = live.feed(block)
        if moved:
            for gr in self.grains:
                if gr.active: gr.pos -= moved

    # -- notes ----------------------------------------------------------------------------------
    def step_for(self, note):
        s = self.spec; ratio = sample_rate_ratio(self.sample, self.rate)
        return ratio*2**((note-s['root']+s['tune']+s['fine']/100.)/12.)

    def region(self, note):
        """(start, end, loop_start, loop_end, xfade, semitones from the root) for a key, or None when no slice is on it."""
        s = self.spec; p = self.params; n = p.frames
        slices = s['slices'] if s['keymap'] != 'whole' and self.live is None else []
        if not slices: return p.start, p.end, p.loop_start, p.loop_end, p.xfade, note - s['root']
        if s['keymap'] == 'slices':
            index = note - s['root']
            if not 0 <= index < len(slices): return None
            pair, shift = slices[index], 0
        else:
            rooted = [pair for pair in slices if len(pair) == 3]
            if not rooted: return None
            pair = min(rooted, key=lambda q: (abs(q[2] - note), q[2]))
            shift = note - pair[2]
        a = max(0, min(n - 2, int(pair[0]*n))); b = max(a + 2, min(n, int(round(pair[1]*n))))
        return a, b, a, b, 0, shift

    def on(self, note, velocity, token=None):
        if self._pending is not None: self.take_pending()
        s = self.spec
        if s is None or self.params.data is None or not 0 <= note <= 127 or not 1 <= velocity <= 127: return False
        zone = self.region(note)
        if zone is None: return False
        if self.hold and self.latched:
            down = [i for i, v in enumerate(self.voices) if v.active and v.stage != 3 and i not in self.latched and i not in self.sustained]
            if not down:   # a new phrase on Hold: the notes it kept go, like the arp's Hold
                for i in self.latched:
                    if self.voices[i].active and self.voices[i].stage != 3: self._release(i)
                self.latched = set()
        start, end, loop_start, loop_end, xfade, shift = zone
        step = (1. if self.live is not None else sample_rate_ratio(self.sample, self.rate))*2**((shift+s['tune']+s['fine']/100.)/12.)
        gain = s['gain']*self.norm*(velocity/127.)**self._e('velocity')
        if not s['poly'] and s['keymap'] != 'whole':
            for i, v in enumerate(self.voices):
                if v.active and v.stage != 3 and v.fade_left < 0: self._fade(i)
        elif not s['poly']:
            held = [i for i, v in enumerate(self.voices) if v.active and v.stage != 3 and v.fade_left < 0]
            glide = self._e('glide')
            if held and glide > 0:
                i = held[-1]; v = self.voices[i]
                v.target = step; v.glide = (step-v.step)/max(1., glide*self.rate)
                if v.glide == 0.: v.target = v.step
                v.gain = gain; self.notes[i] = (note, token); self.vels[i] = velocity/127.; self.events += 1
                return True
            for i in held: self._fade(i)
        else:
            sounding = sorted((v.stamp, i) for i, v in enumerate(self.voices) if v.active and v.fade_left < 0)
            while len(sounding) >= POLY: self._fade(sounding.pop(0)[1])
        free = [i for i, v in enumerate(self.voices) if not v.active]
        i = free[0] if free else min(range(SLOTS), key=lambda k: (self.voices[k].fade_left < 0, self.voices[k].env))
        self.stamp += 1; v = self.voices[i]
        v.start, v.end, v.loop_start, v.loop_end, v.xfade = start, end, loop_start, loop_end, xfade
        v.dir = -1 if s['reverse'] else 1
        v.pos = float(start if v.dir > 0 else end - 1); v.step = v.target = step; v.glide = 0.; v.env = 0.; v.rel = 0.; v.gain = gain
        v.pmul = 1.; v.a1 = v.a2 = v.a3 = v.ic1 = v.ic2 = 0.; v.k = 2.
        v.fade_left = -1; v.fade_len = self.fade_frames; v.age = 0; v.stamp = self.stamp; v.active = 1; v.stage = 0
        if s['mode'] == 'grain':
            v.dir = 1; grain.reset_cloud(self.clouds[i], self.stamp)
            self.roamers[i] = grain.Roamer(self.stamp*7919 + i, s.get('g_roam', 'off'))
            self.steppers[i] = grain.Stepper(self.stamp*104729 + i)
            for gr in self.grains:
                if gr.voice == i: gr.active = 0
        self.notes[i] = (note, token); self.vels[i] = velocity/127.; self.sustained.discard(i); self.latched.discard(i); self.events += 1
        self._modulate()
        return True

    def off(self, note, token=None):
        if self.spec is None or self.spec['mode'] == 'oneshot': return
        for i, v in enumerate(self.voices):
            if v.active and v.stage != 3 and self.notes[i] is not None and self.notes[i][0] == note and (token is None or self.notes[i][1] == token):
                if self.hold and _live(self.notes[i][1]): self.latched.add(i)   # played keys and MIDI only, not the sequencer
                elif self.sustain: self.sustained.add(i)
                else: self._release(i)

    def set_hold(self, on):
        """Hold: keys and MIDI notes keep sounding after they are let go; the next phrase replaces them.
        Off lets the kept notes go (into the pedal when it is down)."""
        self.hold = bool(on)
        if self.hold: return
        for i in self.latched:
            if self.voices[i].active and self.voices[i].stage != 3:
                if self.sustain: self.sustained.add(i)
                else: self._release(i)
        self.latched = set()

    def pedal(self, down):
        """Sustain pedal: keys let go while it is down keep sounding until it comes up."""
        self.sustain = bool(down)
        if not down:
            for i in self.sustained:
                if self.voices[i].active and self.voices[i].stage != 3: self._release(i)
            self.sustained = set()

    def _release(self, i):
        v = self.voices[i]; release = max(.005, self._e('release') if self.spec else .005)
        v.rel = max(v.env, 1e-6)/(release*self.rate); v.stage = 3

    def _fade(self, i):
        v = self.voices[i]
        if v.active and v.fade_left < 0: v.fade_left = self.fade_frames; v.fade_len = self.fade_frames

    def cancel_tokens(self, tokens):
        for i, v in enumerate(self.voices):
            if v.active and self.notes[i] is not None and self.notes[i][1] in tokens: self._fade(i)

    def cancel_sources(self, prefixes):
        self.cancel_sources_where(lambda token: isinstance(token, tuple) and bool(token) and token[0] in prefixes)

    def cancel_sources_where(self, match):
        for i, v in enumerate(self.voices):
            token = self.notes[i][1] if self.notes[i] is not None else None
            if v.active and match(token): self._fade(i)

    def panic(self):
        for v in self.voices: v.active = 0
        for gr in self.grains: gr.active = 0
        self.notes = [None]*SLOTS; self.sustained = set(); self.latched = set()

    # -- audio ----------------------------------------------------------------------------------
    def render_into_buffer(self, buf, offset, frames):
        """render_into for the engine's C buffer (cbus.py): the kernel's output is added in C."""
        if self._pending is not None: self.take_pending()
        if frames <= 0 or self.params.data is None or not any(v.active for v in self.voices): return
        from . import cbus
        if self._kernel is None or (self.grain_mode and self._grain_kernel is None):
            part = buf[offset:offset + frames]; self.render_into(part, frames); cbus.put(buf, offset, part); return
        s = self.spec or {}; base = s.get('gain', 1.); lift = self.mod.get('gain', 0.)
        g = max(0., base+lift)/base if lift and base > 1e-6 else 1.
        c = cbus.lib(); at = 0
        while at < frames:
            count = min(256, frames-at)
            self._modulate()
            if self.grain_mode: self._beat = self._clock_at(at); self._roam(count)
            C.memset(self.scratch, 0, 8*count)
            self._mix_native(count)
            c.dsfx_buf_add(cbus.addr(buf, offset+at), C.addressof(self.scratch), count, g)
            at += count

    def _live_place(self):
        """Live: Position 0 is 8 s ago, 1 is just now (kept a grain's length behind the input, so grains never run into it)."""
        a, n = self.live.window(); zone_pos = self._e('g_pos')
        margin = min(n*.5, self._e('g_size')*self.rate*2. + 256.)
        target = a + zone_pos*(n - margin)
        for i, v in enumerate(self.voices):
            if not v.active: continue
            self.clouds[i].flags = 0
            self.clouds[i].offset = target - float(v.start) - zone_pos*float(v.end - v.start)

    def _clock_at(self, frames):
        """The song's beat `frames` into this render, or None while the song is stopped."""
        return None if self.clock is None else self.clock + frames*max(1., self.bpm)/(60.*self.rate)

    def _roam(self, frames):
        """Roam and Motion: move each held cloud's read point for the coming block."""
        s = self.spec
        if self.live is not None: return self._live_place()
        if grain.stepping(s): return self._step(frames)
        for i, v in enumerate(self.voices):
            if v.active: self.clouds[i].flags = 0
        if not grain.roaming(s): return
        for i, v in enumerate(self.voices):
            if not v.active: continue
            zone = float(v.end - v.start); r = self.roamers[i]
            if zone < 2.: continue
            if r is None: r = self.roamers[i] = grain.Roamer(i, s['g_roam'])
            self.clouds[i].offset = r.step(s, self._e, self.rate, self.bpm, frames, zone, self._beat)

    def _step(self, frames):
        """Rhythm: each held cloud reads from the slice its step chose."""
        s = self.spec; total = float(self.params.frames)
        for i, v in enumerate(self.voices):
            if not v.active: continue
            zone = float(v.end - v.start)
            if zone < 2.: continue
            st = self.steppers[i]
            if st is None: st = self.steppers[i] = grain.Stepper(i)
            at, flags = st.step(s, self._e, self.rate, self.bpm, float(v.age), frames, total, self._beat)
            at = min(float(v.end) - 1., max(float(v.start), at))
            self.clouds[i].offset = at - float(v.start) - self._e('g_pos')*zone; self.clouds[i].flags = flags

    @property
    def grain_mode(self):
        return self.spec is not None and self.spec['mode'] == 'grain'

    def _mix_native(self, count):
        if self.grain_mode:
            self._grain_kernel(self.voices, self.clouds, SLOTS, C.byref(self.params), C.byref(self.gparams), self.grains, self.scratch, count)
        else:
            self._kernel(self.voices, SLOTS, C.byref(self.params), self.scratch, count)

    def render_into(self, out, frames):
        """Add `frames` samples into the mono list `out`."""
        if self._pending is not None: self.take_pending()
        if frames <= 0 or self.params.data is None or not any(v.active for v in self.voices): return
        offset = 0; s = self.spec or {}; base = s.get('gain', 1.); lift = self.mod.get('gain', 0.)
        g = max(0., base+lift)/base if lift and base > 1e-6 else 1.
        while offset < frames:
            count = min(256, frames-offset)
            self._modulate()
            if self.grain_mode: self._beat = self._clock_at(offset); self._roam(count)
            if self._kernel is not None and (self._grain_kernel is not None or not self.grain_mode):
                scratch = self.scratch
                C.memset(scratch, 0, 8*count)
                self._mix_native(count)
                if g == 1.:
                    for i in range(count): out[offset+i] += scratch[i]
                else:
                    for i in range(count): out[offset+i] += scratch[i]*g
            else:
                part = [0.]*count
                if self.grain_mode:
                    grain.mix_grains_python(self.voices, self.clouds, self.params, self.gparams, self.grains, self.sample.data, part, count)
                else:
                    mix_python(self.voices, self.params, self.sample.data, part, count)
                for i in range(count): out[offset+i] += part[i]*g
            offset += count

    def _e(self, key):
        """A knob's value plus its macro / mod pad offset, kept inside the knob's range."""
        v = self.spec[key]; d = self.mod.get(key)
        if not d: return v
        lo, hi = RANGES[key] if key in RANGES else OPTIONAL_RANGES[key]
        return min(hi, max(lo, v+d))

    def _amp(self):
        """The amp envelope the kernel reads, with Attack, Decay and Sustain moved by links."""
        p = self.params; a = self._e('attack'); d = self._e('decay'); su = self._e('sustain')
        p.attack = 1./max(1., a*self.rate) if a > 0 else 1./max(1., .001*self.rate)
        p.decay = (1.-su)/max(1., d*self.rate) if d > 0 else 1.
        p.sustain = su

    def _modulate(self):
        """Block-rate pitch envelope and filter coefficients per voice (the kernel needs no libm)."""
        s = self.spec
        if s is None: return
        m = self.mod
        if s['mode'] == 'grain':
            grain.fill(self.gparams, s, self._e, self.rate, self.voices)
            if grain.roaming(s) or grain.stepping(s) or self.live is not None: self.gparams.scan = 0.   # Roam / Motion / Rhythm move the read point
        moved = 'attack' in m or 'decay' in m or 'sustain' in m
        if moved or self._amp_live: self._amp(); self._amp_live = moved
        rate = self.rate; p_env = s['p_env'] + m.get('p_env', 0.); filtered = s['filter'] != 'off'
        shift = m.get('tune', 0.) + m.get('fine', 0.)/100.
        if not p_env and not filtered and not shift and not self._shifted: return
        self._shifted = bool(shift)
        p_fall = 4.6/max(.001, self._e('p_decay')); f_attack = self._e('f_attack'); f_fall = 4.6/max(.001, self._e('f_decay'))
        k = 2. - 1.96*min(1., max(0., s['resonance'] + m.get('resonance', 0.))); top = .45*rate
        f_env = s['f_env'] + m.get('f_env', 0.); cut = m.get('cutoff', 0.); f_vel = self._e('f_velocity')
        for i, v in enumerate(self.voices):
            if not v.active: continue
            t = v.age/rate
            v.pmul = 2.**(((p_env*math.exp(-t*p_fall)) if p_env else 0.)/12. + shift/12.) if (p_env or shift) else 1.
            if filtered:
                fe = t/f_attack if t < f_attack else math.exp(-(t-f_attack)*f_fall)
                octaves = f_env*5.*fe + f_vel*4.*(self.vels[i]-1.) + cut
                fc = min(top, max(20., s['cutoff']*2.**octaves))
                g = math.tan(math.pi*fc/rate)
                v.k = k; v.a1 = 1./(1.+g*(g+k)); v.a2 = g*v.a1; v.a3 = g*v.a2

    def head(self, i):
        """Where cloud i reads now (frames): Position plus how far Scan has moved it, inside its region."""
        v = self.voices[i]; zone = float(v.end - v.start)
        if zone < 2.: return float(v.start)
        o = (self._e('g_pos')*zone + self.clouds[i].offset) % zone
        return v.start + o

    def state(self):
        if self._pending is not None: self.take_pending()
        s = self.spec
        status = ('LOADING' if self.loading else 'EMPTY' if not s or not s['source'] else
                  'MISSING' if self.sample is None else 'PLAYING' if self.active_count else 'READY')
        n = max(1, self.params.frames)
        if self.grain_mode:
            playing = [round(self.head(i)/n, 4) for i, v in enumerate(self.voices) if v.active][:POLY]
            grains = [round(min(n, max(0., gr.pos))/n, 4) for gr in self.grains if gr.active][:64]
            steps = [self.steppers[i].index for i, v in enumerate(self.voices) if v.active and self.steppers[i] is not None and self.steppers[i].k >= 0
                     and not self.steppers[i].gated][:POLY] if grain.stepping(s) else []
        else:
            playing = [round(v.pos/n, 4) for v in self.voices if v.active][:POLY]; grains = []; steps = []
        view = self.view if self.view is not None and self.sample is not None and self.view[0] == self.sample.sha256 else None
        if self.live is not None and s is not None:
            lo, span = self.live.window()
            at = lambda f: round(min(1., max(0., (f - lo)/span)), 4)
            playing = [at(self.head(i)) for i, v in enumerate(self.voices) if v.active][:POLY] if self.grain_mode else []
            grains = [at(gr.pos) for gr in self.grains if gr.active][:64]
            return dict(status='PLAYING' if self.active_count else 'LIVE', peaks=self.live.peaks(), view=[0., 1.], seconds=span/self.rate,
                        playing=playing, grains=grains, steps=[], event=self.events, voices=self.active_count, hold=self.hold, error=self.error,
                        accelerated=self._kernel is not None, live=dict(frozen=self.live.frozen, level=round(self.live.level, 3)),
                        native_warning=None if self._kernel is not None else sampler_native.error())
        return dict(status=status, peaks=list(view[3] if view else self.sample.peaks) if self.sample is not None else [],
                    view=[round(view[1], 7), round(view[2], 7)] if view else [0., 1.],
                    seconds=(self.sample.frames/self.rate) if self.sample is not None else 0.,
                    playing=playing, grains=grains, steps=steps, event=self.events, voices=self.active_count, hold=self.hold, error=self.error,
                    accelerated=self._kernel is not None,
                    native_warning=None if self._kernel is not None else sampler_native.error())


def _live(token):
    return isinstance(token, tuple) and bool(token) and token[0] == 'live'


def detect_root(sample, rate):
    """The MIDI note the sample sounds at, or None when it has no clear pitch (most drums).
    Autocorrelation on a 4x decimated window from the loudest part; about 0.1 s in Python."""
    if sample is None or sample.frames < rate//10: return None
    data = sample.data; n = sample.frames; hop = 4
    size = min(n//hop, 2048)
    best_at, best = 0, -1.
    for at in range(0, max(1, n-size*hop), max(1, (n-size*hop)//8 or 1)):
        energy = sum(abs(data[at+i*hop]) for i in range(0, size, 16))
        if energy > best: best, best_at = energy, at
    x = [sum(data[best_at+i*hop+k] for k in range(hop))/hop for i in range(size)]
    mean = sum(x)/size; x = [v-mean for v in x]
    r0 = sum(v*v for v in x)
    if r0 < 1e-6: return None
    lo, hi = max(2, int(rate/hop/2000)), min(size//2, int(rate/hop/40))
    corr = [0.]*(hi+2)
    for lag in range(lo, hi+2):
        corr[lag] = sum(x[i]*x[i+lag] for i in range(size-lag))/(size-lag)*size/r0
    # The first strong peak, not the biggest (that is often an octave down).
    peak = max(corr[lo:hi+1]); lag = None
    for k in range(lo+1, hi+1):
        if corr[k] >= .9*peak and corr[k] >= corr[k-1] and corr[k] >= corr[k+1]: lag = k; break
    if lag is None or peak < .5: return None
    a, b, c = corr[lag-1], corr[lag], corr[lag+1]
    shift = .5*(a-c)/(a-2*b+c) if a-2*b+c != 0 else 0.
    freq = rate/hop/(lag+shift)
    note = round(69+12*math.log2(freq/440.))
    return note if 0 <= note <= 127 else None


def sample_rate_ratio(sample, rate):
    """The cache already resamples to the output rate, so a step of 1 is the original pitch."""
    return 1. if sample is None or sample.rate == rate else sample.rate/rate


def _at(data, p, v, i):
    return data[i] if v.start <= i < v.end and i < p.frames else 0.


def _interp(data, p, v, pos):
    i = int(pos)
    if pos < 0.: i = -1
    t = pos-i
    xm = _at(data, p, v, i-1); x0 = _at(data, p, v, i); x1 = _at(data, p, v, i+1); x2 = _at(data, p, v, i+2)
    c1 = .5*(x1-xm); c2 = xm-2.5*x0+2.*x1-.5*x2; c3 = .5*(x2-xm)+1.5*(x0-x1)
    return ((c3*t+c2)*t+c1)*t+x0


def mix_python(voices, p, data, out, frames):
    """The C kernel, line for line (used when the native library is unavailable)."""
    for v in voices:
        if not v.active: continue
        span = v.loop_end-v.loop_start; looping = p.mode == 2 and span > 1
        pos, step, env, stage = v.pos, v.step, v.env, v.stage
        for f in range(frames):
            value = _interp(data, p, v, pos)
            if looping and v.dir > 0 and v.xfade > 0 and pos >= v.loop_end-v.xfade:
                t = (pos-(v.loop_end-v.xfade))/v.xfade
                value = value*(1.-t)+_interp(data, p, v, pos-span)*t
            if not looping:
                edge = ((v.end-pos) if v.dir > 0 else (pos-v.start+1.))/p.edge
                if edge < 1.: value *= edge if edge > 0. else 0.
            if p.filter > 0:
                v3 = value-v.ic2
                v1 = v.a1*v.ic1+v.a2*v3
                v2 = v.ic2+v.a2*v.ic1+v.a3*v3
                v.ic1 = 2.*v1-v.ic1
                v.ic2 = 2.*v2-v.ic2
                value = v2 if p.filter == 1 else v1 if p.filter == 2 else value-v.k*v1-v2
            if stage == 0:
                env += p.attack
                if env >= 1.: env = 1.; stage = 1
            elif stage == 1:
                env -= p.decay
                if env <= p.sustain: env = p.sustain; stage = 2
            elif stage == 3:
                env -= v.rel
                if env <= 0.: env = 0.; v.active = 0
            value *= env*v.gain
            if v.fade_left >= 0:
                value *= v.fade_left/v.fade_len
                v.fade_left -= 1
                if v.fade_left < 0: v.active = 0
            out[f] += value
            if v.glide != 0.:
                step += v.glide
                if (v.glide > 0. and step >= v.target) or (v.glide < 0. and step <= v.target):
                    step = v.target; v.glide = 0.
            pos += step*v.pmul if v.dir > 0 else -(step*v.pmul); v.age += 1
            if looping:
                if v.dir > 0:
                    if pos >= v.loop_end: pos -= span
                elif pos < v.loop_start: pos += span
            elif (pos >= v.end) if v.dir > 0 else (pos < v.start): v.active = 0
            if not v.active: break
        v.pos, v.step, v.env, v.stage = pos, step, env, stage
