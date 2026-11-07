"""Per-track FX chain (16 modules) backed by the small native library in native/libdsfx.so.

The chain model mirrors ui-next/src/fx.ts. If the library cannot load, FX are bypassed
and the synth keeps working exactly as before.
"""
import ctypes
import math
from pathlib import Path

ORDER = ['stutter', 'filter', 'overdrive', 'bitcrusher', 'volume', 'phaser',
         'flanger', 'ringmod', 'delay', 'reverb', 'time',
         'chorus', 'compressor', 'eq', 'autowah', 'resonator', 'gate']
# (key, min, max, init) per module, in the same order the native code reads them.
PARAMS = {
    'stutter': [('length', 1, 6, 3), ('speed', 0, 1, .6), ('repeats', 1, 8, 4), ('mix', 0, 1, .5)],
    'filter': [('mode', 0, 2, 0), ('cutoff', 0, 1, .7), ('reso', 0, 1, .3), ('mix', 0, 1, 1)],
    'overdrive': [('drive', 0, 1, .4), ('mix', 0, 1, .5)],
    'bitcrusher': [('rate', 0, 1, .3), ('bits', 2, 16, 9), ('mix', 0, 1, .5)],
    'volume': [('level', 0, 1.5, 1), ('mix', 0, 1, 1)],
    'phaser': [('rate', 0, 1, .3), ('depth', 0, 1, .6), ('feedback', -1, 1, .2), ('mix', 0, 1, .5)],
    'flanger': [('rate', 0, 1, .3), ('depth', 0, 1, .5), ('feedback', -1, 1, .4), ('mix', 0, 1, .5)],
    'ringmod': [('freq', 0, 1, .4), ('drive', 0, 1, .3), ('mix', 0, 1, .5)],
    'delay': [('time', 0, 5, 2), ('feedback', 0, .95, .4), ('mix', 0, 1, .5)],
    'reverb': [('predelay', 0, 1, .1), ('decay', 0, 1, .6), ('locut', 0, 1, .1), ('hicut', 0, 1, .8), ('mix', 0, 1, .5)],
    'time': [('speed', .25, 2, 1), ('mix', 0, 1, 1)],
    'chorus': [('rate', 0, 1, .3), ('depth', 0, 1, .5), ('voices', 1, 3, 2), ('mix', 0, 1, .5)],
    'compressor': [('amount', 0, 1, .4), ('ratio', 0, 3, 1), ('attack', 0, 1, .2), ('release', 0, 1, .3),
                   ('makeup', 0, 1, .2), ('mix', 0, 1, 1)],
    'eq': [('low', -1, 1, 0), ('mid', -1, 1, 0), ('freq', 0, 1, .5), ('high', -1, 1, 0)],
    'autowah': [('sens', 0, 1, .5), ('base', 0, 1, .3), ('range', 0, 1, .6), ('reso', 0, 1, .6), ('mix', 0, 1, .8)],
    'resonator': [('decay', 0, 1, .5), ('tone', 0, 1, .5), ('mix', 0, 1, .4), ('strings', 0, 2, 1)],
    # Audio gate: cells 4/6/8/9/12/16, cell size 1/4 1/8 1/16 1/8T 1/16T, steps as bits (cell k open = bit k).
    'gate': [('length', 0, 5, 2), ('division', 0, 4, 2), ('steps', 0, 65535, 44461), ('smooth', 0, 1, .3),
             ('depth', 0, 1, 1), ('pump', 0, 1, 0)],
}
GATE_PERFORMANCE={'retrig':(0,2,2),'phase':(0,1,0.),'notelen':(0,1,1.),'hold':(0,1,0)}
GATE_LENGTHS = (4, 6, 8, 9, 12, 16)
NPAR = 6
# Sound knobs a macro or mod pad can move too: (min, max) in the knob's own units.
SOUND_PARAMS = {
    'filter': (.02, 1), 'curve': (-1, 1), 'balance': (0, 1), 'focus': (0, 1), 'focus_center': (1, 16),
    'attack': (.001, 3), 'decay': (.001, 3), 'sustain': (0, 1), 'release': (.01, 3),
    'modulation': (0, 1), 'volume': (0, 1),
    # Filter, Unison and Character cards (patch 24)
    'vcf_cutoff': (0, 1), 'vcf_reso': (0, 1), 'vcf_env': (-1, 1), 'uni_detune': (0, 1),
    'formant': (0, 1), 'vowel': (0, 4), 'inharm': (0, 1), 'sub': (0, 1),
    'character': (-1, 1), 'vcf_morph': (0, 1),
    'fenv_a': (.001, 3), 'fenv_d': (.001, 3), 'fenv_s': (0, 1), 'fenv_r': (.01, 3),
}
SHAPES = ['sine', 'triangle', 'saw', 'ramp', 'square', 'pulse', 'random', 'smooth', 'steps', 'curve']
# Mod-pad rates in beats per cycle: 4 bars, 2 bars, 1 bar, 1/2, 1/4, 1/8, 1/16
RATES = [16, 8, 4, 2, 1, .5, .25]
# Feel: straight, triplet (2/3 of the time) or dotted (1.5 times)
FEELS = {'': 1., 'T': 2 / 3, 'D': 1.5}
STEP_COUNTS = (4, 8, 16)
NMACRO = 8
NMOD_SRC = 8
_PRESET_SHAPES = ['sine', 'triangle', 'saw', 'square', 'random', 'steps', 'sine', 'steps']
# Morph pad path symbols the puck travels along ('hand' = it only moves where your finger puts it)
PATHS = ['hand', 'circle', 'eight', 'flower', 'triangle', 'square', 'spiral', 'star', 'wave', 'drift']
MORPH_MODES = ['follow', 'retrigger', 'freeze']
_TRI = [(0., 1.), (.866, -.5), (-.866, -.5)]
_SQUARE = [(-.85, .85), (.85, .85), (.85, -.85), (-.85, -.85)]
_STAR = [((1. if i % 2 == 0 else .42) * math.cos(math.pi / 2 + i * math.pi / 5),
          (1. if i % 2 == 0 else .42) * math.sin(math.pi / 2 + i * math.pi / 5)) for i in range(10)]

def default_morph():
    return dict(x=.5, y=.5, xMacro=0, yMacro=1, mixMacro=-1, path='hand', rate=0,
                size=.8, wander=.2, spin=0., mode='follow')

def _range(module, key):
    if module == 'sound': return SOUND_PARAMS[key]
    if module=='gate' and key in ('phase','notelen'):return (0,1)
    for k, lo, hi, _ in PARAMS[module]:
        if k == key: return lo, hi
    raise KeyError(key)

def default_chain():
    return dict(
        modules=[dict(id=m, on=False, params={k: init for k, _, _, init in PARAMS[m]}) for m in ORDER],
        macros=[dict(name=f'Macro {i+1}', value=0., targets=[]) for i in range(NMACRO)],
        mods=[default_mod(i) for i in range(NMOD_SRC)],
        morph=default_morph())

def default_mod(i):
    return dict(shape=_PRESET_SHAPES[i], rate=2 + i % 4, steps=[0.] * 16, targets=[], feel='', count=16,
                points=[[0., 0.], [.5, 1.], [1., 0.]])

def default_module(m):
    return dict(id=m, on=False, params={k: init for k, _, _, init in PARAMS[m]})

def _targets(raw):
    out = []
    assert isinstance(raw, list) and len(raw) <= 16
    for t in raw:
        lo, hi = _range(t['module'], t['param'])
        d = float(t['depth']); assert math.isfinite(d)
        out.append(dict(module=t['module'], param=t['param'], depth=min(1., max(-1., d))))
    return out

def validate_chain(chain):
    """Return a clean copy of a chain dict, or raise ValueError."""
    try:
        mods = chain['modules']
        assert isinstance(mods, list)
        ids = [m['id'] for m in mods]
        assert ids and len(set(ids)) == len(ids) and all(i in ORDER for i in ids)
        # Chains saved before new effects were added get them, switched off, at the end.
        mods = list(mods) + [default_module(m) for m in ORDER if m not in ids]
        out = []
        for m in mods:
            assert isinstance(m['on'], bool)
            params = {}
            for key, lo, hi, init in PARAMS[m['id']]:
                v = m['params'].get(key, init)
                assert isinstance(v, (int, float)) and math.isfinite(v)
                params[key] = min(hi, max(lo, float(v)))
            if m['id']=='gate':
                for key,(lo,hi,init) in GATE_PERFORMANCE.items():
                    if key not in m['params']:continue
                    value=m['params'][key]
                    assert type(value) in (int,float) and math.isfinite(value) and lo<=value<=hi
                    if key in ('retrig','hold'):assert type(value) is int
                    params[key]=value
            entry = dict(id=m['id'], on=m['on'], params=params)
            bypass = m.get('bypass', False); assert isinstance(bypass, bool)
            if bypass: entry['bypass'] = True  # in the rack but not heard
            out.append(entry)
        base = default_chain()
        macros = []
        for i, m in enumerate(chain.get('macros', base['macros'])[:NMACRO]):
            v = float(m['value']); assert math.isfinite(v)
            name = str(m.get('name', f'Macro {i+1}'))[:24]
            macros.append(dict(name=name, value=min(1., max(0., v)), targets=_targets(m.get('targets', []))))
        macros += base['macros'][len(macros):]
        mods = []
        for m in chain.get('mods', base['mods'])[:NMOD_SRC]:
            assert m['shape'] in SHAPES
            rate = int(m['rate']); assert 0 <= rate < len(RATES)
            steps = [min(1., max(-1., float(x))) for x in m.get('steps', [0.] * 16)]
            assert len(steps) == 16 and all(math.isfinite(x) for x in steps)
            feel = m.get('feel', ''); assert feel in FEELS
            count = int(m.get('count', 16)); assert count in STEP_COUNTS
            raw_pts = m.get('points', [[0., 0.], [.5, 1.], [1., 0.]])
            assert isinstance(raw_pts, list) and 2 <= len(raw_pts) <= 32
            points = sorted([min(1., max(0., float(x))), min(1., max(-1., float(y)))] for x, y in raw_pts)
            assert all(math.isfinite(v) for pt in points for v in pt)
            mods.append(dict(shape=m['shape'], rate=rate, steps=steps, targets=_targets(m.get('targets', [])),
                             feel=feel, count=count, points=points))
        mods += base['mods'][len(mods):]
        mo = {**base['morph'], **chain.get('morph', {})}
        def unit(k):
            v = float(mo[k]); assert math.isfinite(v); return min(1., max(0., v))
        morph = dict(x=unit('x'), y=unit('y'), xMacro=int(mo['xMacro']) % NMACRO, yMacro=int(mo['yMacro']) % NMACRO,
                     mixMacro=max(-1, min(NMACRO - 1, int(mo['mixMacro']))),
                     path=str(mo['path']), rate=int(mo['rate']), size=unit('size'), wander=unit('wander'),
                     spin=unit('spin'), mode=str(mo['mode']))
        assert morph['path'] in PATHS and morph['mode'] in MORPH_MODES and 0 <= morph['rate'] < len(RATES)
        return dict(modules=out, macros=macros, mods=mods, morph=morph)
    except (KeyError, TypeError, AssertionError, AttributeError, ValueError) as exc:
        raise ValueError('Invalid FX chain') from exc

_lib = None
_legacy_lib = None
def _load(legacy=False):
    global _lib,_legacy_lib
    loaded=_legacy_lib if legacy else _lib
    if loaded is None:
        try:
            source=Path(__file__).with_name('native')/'libdsfx.so'
            if not legacy:
                from .filter_native import library_path
                cached=library_path()
                if cached.exists():source=cached
            lib = ctypes.CDLL(str(source))
            lib.dsfx_create.restype = ctypes.c_void_p; lib.dsfx_create.argtypes = [ctypes.c_double]
            lib.dsfx_destroy.argtypes = [ctypes.c_void_p]
            lib.dsfx_reset.argtypes = [ctypes.c_void_p]
            lib.dsfx_levels.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_double)]
            lib.dsfx_process.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_double), ctypes.c_int,
                                         ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
                                         ctypes.POINTER(ctypes.c_double), ctypes.c_double]
            if hasattr(lib, 'dsfx_set_clock'):
                lib.dsfx_set_clock.argtypes = [ctypes.c_void_p, ctypes.c_double]
            if hasattr(lib, 'dsfx_tune'):
                lib.dsfx_tune.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_double), ctypes.c_int]
            if hasattr(lib, 'dsfx_comp_gr'):
                lib.dsfx_comp_gr.argtypes = [ctypes.c_void_p]; lib.dsfx_comp_gr.restype = ctypes.c_double
            if hasattr(lib, 'dsfx_table'):  # newer library: fast wavetables for the synth
                lib.dsfx_table.argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.c_int, ctypes.c_double,
                                           ctypes.POINTER(ctypes.c_double), ctypes.c_int]
            if hasattr(lib, 'dsfx_voice2'):  # filter, unison, sub and stretched partials in C
                D = ctypes.POINTER(ctypes.c_double)
                lib.dsfx_voice2.argtypes = [D, ctypes.c_int, D, D, D, ctypes.POINTER(DsVoice)]
                lib.dsfx_voice2.restype = ctypes.c_int
            if hasattr(lib, 'dsfx_voice'):  # newer library: the synth's voice loop in C
                D = ctypes.POINTER(ctypes.c_double)
                lib.dsfx_voice.argtypes = [D, ctypes.c_int, D, D, D, ctypes.c_int] + [ctypes.c_double] * 6
                lib.dsfx_voice.restype = ctypes.c_int
            if hasattr(lib,'dsfx_gate_controls'):
                lib.dsfx_gate_controls.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_double,ctypes.c_double,ctypes.c_int]
                lib.dsfx_gate_beat.argtypes=[ctypes.c_void_p];lib.dsfx_gate_beat.restype=ctypes.c_double
                lib.dsfx_gate_reset.argtypes=[ctypes.c_void_p]
            loaded=lib
        except OSError:loaded=False
        if legacy:_legacy_lib=loaded
        else:_lib=loaded
    return loaded or None

class _Table:
    """Mixin for wavetables kept as C arrays: they're never changed after building, so a copy is the
    same table, and two tables are equal when their samples are."""
    def __deepcopy__(self, memo): return self
    def __copy__(self): return self
    def __eq__(self, other):
        return self is other or (hasattr(other, '__len__') and len(other) == len(self) and all(a == b for a, b in zip(self, other)))
    __hash__ = object.__hash__

_TABLE_TYPES = {}
def _table_type(size):
    if size not in _TABLE_TYPES: _TABLE_TYPES[size] = type('Table%d' % size, (_Table, ctypes.c_double * size), {})
    return _TABLE_TYPES[size]

class DsVoice(ctypes.Structure):
    """Arguments for dsfx_voice2 (see dsfx.c)."""
    _fields_ = [('step', ctypes.c_double), ('gain', ctypes.c_double), ('a', ctypes.c_double), ('d', ctypes.c_double),
                ('sus', ctypes.c_double), ('rel', ctypes.c_double), ('released', ctypes.c_int), ('uni', ctypes.c_int),
                ('detune', ctypes.c_double), ('ftype', ctypes.c_int), ('cutoff', ctypes.c_double), ('reso', ctypes.c_double),
                ('envamt', ctypes.c_double), ('rate', ctypes.c_double), ('weights', ctypes.POINTER(ctypes.c_double)),
                ('npart', ctypes.c_int), ('stretch', ctypes.c_double), ('sub', ctypes.c_double), ('suboct', ctypes.c_int)]

def native_voice2():
    """The C voice renderer with the Filter, Unison and Character cards, or None."""
    lib = _load(legacy=True)
    return lib.dsfx_voice2 if lib and hasattr(lib, 'dsfx_voice2') else None

def native_voice():
    """The C voice renderer, or None when the native library is missing or older."""
    lib = _load(legacy=True)
    return lib.dsfx_voice if lib and hasattr(lib, 'dsfx_voice') else None

def build_table(weights, norm, size):
    """An additive wavetable in C, or None when the native library is missing or older."""
    lib = _load(legacy=True)
    if not lib or not hasattr(lib, 'dsfx_table'): return None
    w = (ctypes.c_double * max(1, len(weights)))(*weights); out = _table_type(size)()
    lib.dsfx_table(w, len(weights), float(norm), out, size)
    return out  # a C array: the native voice loop reads it directly, Python can still index it

def curve_value(points, phase):
    """Straight lines between the drawn points; before the first and after the last it wraps around."""
    pts = points or [[0., 0.], [1., 0.]]
    if phase <= pts[0][0] or phase >= pts[-1][0]:
        (ax, ay), (bx, by) = [pts[-1][0] - 1, pts[-1][1]], pts[0]
        if phase >= pts[-1][0]: (ax, ay), (bx, by) = pts[-1], [pts[0][0] + 1, pts[0][1]]
    else:
        k = next(i for i in range(1, len(pts)) if pts[i][0] >= phase)
        (ax, ay), (bx, by) = pts[k - 1], pts[k]
    return ay if bx - ax < 1e-9 else ay + (by - ay) * (phase - ax) / (bx - ax)

def shape_value(shape, phase, steps, seed=0, count=16, points=None):
    """Bipolar mod value in [-1, 1] for a phase in [0, 1)."""
    if shape == 'sine': return math.sin(2 * math.pi * phase)
    if shape == 'triangle': return 1 - 4 * abs(phase - .5)
    if shape == 'saw': return 1 - 2 * phase
    if shape == 'ramp': return 2 * phase - 1
    if shape == 'square': return 1. if phase < .5 else -1.
    if shape == 'pulse': return 1. if phase < .25 else -1.
    if shape == 'steps':
        # Merged steps: with 4 steps, cells 1, 5, 9 and 13 each hold for four cells.
        return steps[(int(phase * count) % count) * (16 // count)]
    if shape == 'curve': return curve_value(points, phase)
    if shape == 'smooth': return _noise(phase * 8 + seed * 8, 5)
    # random: a new held value 8 times per cycle, repeatable per cycle index
    k = int(phase * 8) + seed * 8
    return ((k * 2654435761) % 1000) / 500. - 1

def _noise(s, seed):
    """Smooth repeatable value noise in [-1, 1]."""
    k = math.floor(s); f = s - k; f = f * f * (3 - 2 * f)
    h = lambda i: (((i + seed * 7919) * 2654435761) % 1000) / 500. - 1
    return h(k) + (h(k + 1) - h(k)) * f

def _poly(pts, t):
    n = len(pts); u = (t % 1.) * n; i = int(u); f = u - i
    (ax, ay), (bx, by) = pts[i % n], pts[(i + 1) % n]
    return ax + (bx - ax) * f, ay + (by - ay) * f

def path_point(path, t, s=0.):
    """A point in [-1, 1]^2 on a path symbol at phase t; s is free-running time for drift."""
    a = 2 * math.pi * t
    if path == 'circle': return math.cos(a), math.sin(a)
    if path == 'eight': return math.sin(a), .7 * math.sin(2 * a)
    if path == 'flower': r = math.cos(2 * a); return r * math.cos(a), r * math.sin(a)
    if path == 'triangle': return _poly(_TRI, t)
    if path == 'square': return _poly(_SQUARE, t)
    if path == 'star': return _poly(_STAR, t)
    if path == 'spiral':
        r = .12 + .88 * (1 - abs(2 * (t % 1.) - 1)); b = 3 * a
        return r * math.cos(b), r * math.sin(b)
    if path == 'wave': return 1 - 4 * abs((t % 1.) - .5), .6 * math.sin(2 * a)
    if path == 'drift': return _noise(s * 2, 1), _noise(s * 2, 2)
    return 0., 0.

def morph_point(mo, t, s):
    """Where the puck is: the path, turned by Spin and scaled by Size around the touched centre, plus Wander."""
    px, py = path_point(mo['path'], t, s)
    rot = mo['spin'] * 2 * math.pi; c, n = math.cos(rot), math.sin(rot)
    r = mo['size'] * .5; w = mo['wander'] * .3
    x = mo['x'] + (px * c - py * n) * r + _noise(s * 1.7, 3) * w
    y = mo['y'] + (px * n + py * c) * r + _noise(s * 1.7, 4) * w
    return min(1., max(0., x)), min(1., max(0., y))

def pad_mix(x, y, pads):
    """Blend of mod pads 1-4 sitting in the corners (1 top left, 2 top right, 3 bottom left, 4 bottom right)."""
    v = list(pads) + [0.] * (4 - len(pads))
    return (1 - x) * y * v[0] + x * y * v[1] + (1 - x) * (1 - y) * v[2] + x * (1 - y) * v[3]

def mod_value(m, beat):
    """A mod pad's value and phase at a beat: rate and feel set the cycle length."""
    pos = beat / (RATES[m['rate']] * FEELS[m.get('feel', '')])
    return shape_value(m['shape'], pos % 1., m['steps'], int(pos), m.get('count', 16), m.get('points')), pos % 1.

def available():
    return _load() is not None

class TrackFx:
    def __init__(self, rate):
        self.lib = _load(); self.handle = self.lib.dsfx_create(rate) if self.lib else None
        self.active = False
        self.order = (ctypes.c_int * len(ORDER))(*range(len(ORDER)))
        self.on = (ctypes.c_int * len(ORDER))()
        self.params = (ctypes.c_double * (len(ORDER) * NPAR))()
        self._levels = (ctypes.c_double * len(ORDER))()
        self.chain = None; self.mod_values = [0.] * NMOD_SRC; self.mod_phases = [0.] * NMOD_SRC
        self.puck = [.5, .5, 0.]; self._origin = 0.; self._retrig = False; self._held = 0.
        self.sound = {}  # Sound knob offsets (knob units) from macros and mod pads, for the synth
        self.tuned = []  # resonator string pitches (MIDI notes)
        self.rate=rate;self.gate_values={k:v[2] for k,v in GATE_PERFORMANCE.items()};self._gate_events=[];self._gate_origin=None;self._gate_frame=0
        self._tail = 0  # blocks left to fade out after the last effect is switched off
    def retrigger(self,frame=None,empty=True):
        """A note started on this track: in Retrigger mode the puck goes back to the start of its path."""
        self._retrig = True
        mode=self.gate_values['retrig']
        if mode==0 or (mode==1 and empty):
            self._gate_events.append(self._gate_frame if frame is None else int(frame))
            self._gate_events=self._gate_events[-256:]
    def clear_gate_events(self):
        self._gate_events=[];self._gate_origin=None
    def gate_runtime(self):
        if not self.handle or not hasattr(self.lib,'dsfx_gate_beat'):return None
        gate=next((m for m in (self.chain or {}).get('modules',[]) if m['id']=='gate'),None)
        if not gate:return None
        beat=self.lib.dsfx_gate_beat(self.handle);p=gate['params']
        length=GATE_LENGTHS[round(p['length'])];division=(1.,.5,.25,1/3,1/6)[round(p['division'])]
        position=(beat/division+self.gate_values['phase']*length)%length
        return dict(beat=beat,position=position,cell=int(position),active=bool(gate['on'] and not gate.get('bypass')),
                    values=dict(self.gate_values))
    def move_puck(self, beat, values):
        """Advance the Morph pad puck and write Puck X, Puck Y and Pad mix into their macros."""
        c = self.chain; mo = c.get('morph')
        if not mo: return
        mods = c.get('mods') or []
        if self._retrig: self._origin = beat; self._retrig = False
        if mo.get('path', 'hand') == 'hand':
            x, y = mo['x'], mo['y']
        else:
            if mo['mode'] != 'freeze':
                self._held = beat - (self._origin if mo['mode'] == 'retrigger' else 0.)
            pos = self._held / RATES[mo['rate']]
            x, y = morph_point(mo, pos % 1., pos)
            values[mo['xMacro']] = x; values[mo['yMacro']] = y
        pads = []
        for m in mods[:4]:
            pads.append(mod_value(m, beat)[0])
        mix = pad_mix(x, y, pads)
        if mo.get('mixMacro', -1) >= 0: values[mo['mixMacro']] = (mix + 1) / 2
        self.puck = [x, y, mix]
    def tune(self, notes, root=0):
        """Tune the resonator to the notes the track plays now. With nothing playing the strings keep
        their last notes; before the first note they ring on the key's root chord."""
        if not self.handle or not hasattr(self.lib, 'dsfx_tune'): return
        notes = sorted(set(int(n) for n in notes))[:4]
        if not notes and self.tuned: return
        if not notes: notes = [36 + root, 40 + root, 43 + root]
        mode = 1
        for m in (self.chain or {}).get('modules', []):
            if m['id'] == 'resonator': mode = int(round(m['params'].get('strings', 1)))
        strings = list(notes)
        if mode == 1: strings += [n + 12 for n in notes]
        if mode == 2: strings += [n + 7 for n in notes]
        strings = strings[:6]
        if strings == self.tuned: return
        self.tuned = strings
        freqs = (ctypes.c_double * len(strings))(*[440 * 2 ** ((n - 69) / 12) for n in strings])
        self.lib.dsfx_tune(self.handle, freqs, len(strings))
    def configure(self, chain):
        self.chain = chain
        gate=next((m for m in (chain or {}).get('modules',[]) if m['id']=='gate'),None)
        values={k:(gate['params'].get(k,v[2]) if gate else v[2]) for k,v in GATE_PERFORMANCE.items()}
        if values['retrig']!=self.gate_values['retrig']:self.clear_gate_events()
        self.gate_values=values
        self._gate_extended=bool(gate and any(k in gate['params'] for k in GATE_PERFORMANCE))
        if self._gate_extended and self.handle and not hasattr(self.lib,'dsfx_gate_controls'):
            raise ValueError('Audio Gate controls require the cached native kernel; run tools/build-native-filter.py and restart')
        if chain is None:
            self.active = False; self.sound = {}; return
        for i, m in enumerate(chain['modules']):
            idx = ORDER.index(m['id']); self.order[i] = idx; self.on[idx] = 1 if m['on'] and not m.get('bypass') else 0
            for j, (key, _, _, init) in enumerate(PARAMS[m['id']]):
                self.params[idx * NPAR + j] = m['params'].get(key, init)
        was = self.active
        self.active = bool(self.handle) and any(m['on'] and not m.get('bypass') for m in chain['modules'])
        if self.active and not was and self.handle and not self._tail: self.lib.dsfx_reset(self.handle); self.tuned = []
        # The last effect switched off: keep running a few blocks so it fades out instead of cutting.
        if was and not self.active: self._tail = 8
    def modulate(self, beat):
        """Write base params plus macro and mod-pad offsets for this block."""
        c = self.chain
        if not c: return
        offsets = {}
        macros = c.get('macros') or []
        values = [m['value'] for m in macros]  # the Morph Pad writes its two macros' values directly
        self.move_puck(beat, values)  # ...and while its puck travels a path, the engine moves them in audio time
        for m, v in zip(macros, values):
            for t in m['targets']:
                key = (t['module'], t['param']); offsets[key] = offsets.get(key, 0) + v * t['depth']
        for i, m in enumerate(c.get('mods') or []):
            if not m['targets']: self.mod_values[i] = 0.; continue
            v, ph = mod_value(m, beat); self.mod_values[i] = v; self.mod_phases[i] = ph
            for t in m['targets']:
                key = (t['module'], t['param']); offsets[key] = offsets.get(key, 0) + v * t['depth'] * .5
        self.sound = {k[1]: v * (SOUND_PARAMS[k[1]][1] - SOUND_PARAMS[k[1]][0]) for k, v in offsets.items() if k[0] == 'sound'}
        gate=next((m for m in c['modules'] if m['id']=='gate'),None)
        if gate:
            for k,(lo,hi,init) in GATE_PERFORMANCE.items():
                self.gate_values[k]=min(hi,max(lo,gate['params'].get(k,init)+offsets.get(('gate',k),0.)*(hi-lo)))
            if any(('gate',k) in offsets for k in ('phase','notelen')):self._gate_extended=True
        if not offsets and not getattr(self, '_dirty', False): return
        self._dirty = bool(offsets)
        for m in c['modules']:
            idx = ORDER.index(m['id'])
            for j, (key, lo, hi, init) in enumerate(PARAMS[m['id']]):
                v = m['params'].get(key, init) + offsets.get((m['id'], key), 0.) * (hi - lo)
                self.params[idx * NPAR + j] = min(hi, max(lo, v))
    def process(self, samples, bpm, beat=0., modulated=False, clock=None, frame=None):
        """samples: list of floats; returns a list (same object when bypassed).
        modulated: the engine already called modulate() for this block.
        clock: song position in beats while the transport plays (the audio gate locks to it)."""
        if not modulated and self.chain:
            if self.active: self.modulate(beat)
            else: self.move_puck(beat, [0.] * NMACRO)  # keep the puck moving for the screen
        if not self.active:
            if not self._tail: return samples
            self._tail -= 1
        n = len(samples); buf = (ctypes.c_double * n)(*samples)
        start=self._gate_frame if frame is None else int(frame);end=start+n;self._gate_frame=end
        events=sorted(set(max(start,x) for x in self._gate_events if x<end)) if self._gate_extended else []
        self._gate_events=[x for x in self._gate_events if x>=end]
        if hasattr(self.lib,'dsfx_gate_controls'):
            self.lib.dsfx_gate_controls(self.handle,int(self._gate_extended),self.gate_values['phase'],self.gate_values['notelen'],int(self.gate_values['hold']))
        boundaries=sorted(set([start,end]+events))
        for pos,stop in zip(boundaries,boundaries[1:]):
            if pos in events and not self.gate_values['hold']:
                self._gate_origin=pos;self.lib.dsfx_gate_reset(self.handle)
            current=(pos-self._gate_origin)*bpm/60/self.rate if self._gate_extended and self.gate_values['retrig']<2 and self._gate_origin is not None else (None if clock is None else clock+(pos-start)*bpm/60/self.rate)
            if current is not None and hasattr(self.lib,'dsfx_set_clock'):self.lib.dsfx_set_clock(self.handle,float(current))
            pointer=ctypes.cast(ctypes.byref(buf,(pos-start)*ctypes.sizeof(ctypes.c_double)),ctypes.POINTER(ctypes.c_double))
            self.lib.dsfx_process(self.handle,pointer,stop-pos,self.order,self.on,self.params,float(bpm))
        return list(buf)
    def levels(self):
        if not self.handle: return [0.] * len(ORDER)
        self.lib.dsfx_levels(self.handle, self._levels)
        return [round(v, 4) for v in self._levels]
    def comp_reduction(self):
        """Compressor gain reduction in dB (0 when the library is older)."""
        if not self.handle or not hasattr(self.lib, 'dsfx_comp_gr'): return 0.
        return round(self.lib.dsfx_comp_gr(self.handle), 2)
    def __del__(self):
        try:
            if self.handle: self.lib.dsfx_destroy(self.handle)
        except Exception:
            pass
