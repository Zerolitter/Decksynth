"""Per-track FX chain (16 modules) backed by the small native library in native/libdsfx.so.

The chain model mirrors ui/src/fx.ts. If the library cannot load, FX are bypassed
and the synth keeps working exactly as before.
"""
import ctypes
from array import array
import math
from pathlib import Path

ORDER = ['stutter', 'filter', 'overdrive', 'bitcrusher', 'volume', 'phaser',
         'flanger', 'ringmod', 'delay', 'reverb', 'time',
         'chorus', 'compressor', 'eq', 'autowah', 'resonator', 'gate', 'cloud',
         'pitch', 'autotune', 'duck', 'vocoder', 'tape', 'smear', 'shimmer', 'space']
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
PARAMS['chorus'] += [('width',0,1,0.),('haas',0,.03,0.)]
PARAMS['delay'] += [('width',0,1,0.)]
PARAMS['reverb'] += [('width',0,1,0.)]
# Round 2 (16 Nov): Pitch shift, Auto-tune (to the project scale), Ducking and Vocoder.
# 'source' is the track whose audio drives Ducking or speaks through the Vocoder (the engine routes it).
PARAMS['pitch'] = [('semis', -12, 12, 0), ('cents', -100, 100, 0), ('mix', 0, 1, 1)]
PARAMS['autotune'] = [('speed', 0, 1, .15), ('amount', 0, 1, 1), ('mix', 0, 1, 1)]
PARAMS['duck'] = [('source', 0, 15, 0), ('amount', 0, 1, .7), ('sens', 0, 1, .3), ('attack', 0, 1, .05), ('release', 0, 1, .3)]
PARAMS['vocoder'] = [('source', 0, 15, 0), ('response', 0, 1, .3), ('shift', -1, 1, 0), ('air', 0, 1, .3), ('mix', 0, 1, 1)]
KEYED = ('duck', 'vocoder')  # effects fed by another track, in dsfx_key slot order
NATIVE_R2 = ('pitch', 'autotune', 'duck', 'vocoder')
PARAMS['cloud']=[('time',0,1,.35),('density',0,1,.7),('scatter',0,1,.5),('feedback',0,.88,.4),('tone',0,1,.6),('mix',0,1,.4)]
# Ambient FX (25 Nov): Tape, Smear, Shimmer and Space, true stereo (dsfx.c keeps their state in the left channel).
# Character (Fresh / Worn / Broken), Interval (+12 / +7 / +19 / +24) and Freeze (off / on) are whole-number choices.
PARAMS['tape'] = [('wow', 0, 1, .3), ('flutter', 0, 1, .2), ('drive', 0, 1, .3), ('age', 0, 1, .3), ('hiss', 0, 1, .2),
                  ('mix', 0, 1, 1), ('character', 0, 2, 0)]
PARAMS['smear'] = [('size', 0, 1, .5), ('blur', 0, 1, .6), ('motion', 0, 1, .3), ('tone', 0, 1, .7), ('mix', 0, 1, .5)]
PARAMS['shimmer'] = [('decay', 1, 20, 6), ('shimmer', 0, 1, .5), ('tone', 0, 1, .6), ('width', 0, 1, .8), ('mix', 0, 1, .4),
                     ('interval', 0, 3, 0)]
PARAMS['space'] = [('size', 0, 1, .7), ('decay', 1, 20, 6), ('predelay', 0, 200, 20), ('damp', 0, 1, .4), ('mod', 0, 1, .3),
                   ('mix', 0, 1, .4), ('freeze', 0, 1, 0)]
AMBIENT = ('tape', 'smear', 'shimmer', 'space')
STEPPED = {('tape', 'character'), ('shimmer', 'interval'), ('space', 'freeze')}  # whole numbers, never glide
GATE_PERFORMANCE={'retrig':(0,2,2),'phase':(0,1,0.),'notelen':(0,1,1.),'hold':(0,1,0)}
GATE_LENGTHS = (4, 6, 8, 9, 12, 16)
NPAR = 8  # parameters per module in the native array (dsfx.c NPAR; dsfx_npar() must agree)
# Sound knobs a macro or mod pad can move too: (min, max) in the knob's own units.
SOUND_PARAMS = {
    'pan':(-1,1),'filter': (.02, 1), 'curve': (-1, 1), 'balance': (0, 1), 'focus': (0, 1), 'focus_center': (1, 16),
    'attack': (.001, 3), 'decay': (.001, 3), 'sustain': (0, 1), 'release': (.01, 3),
    'modulation': (0, 1), 'volume': (0, 1),
    # Filter, Unison and Character cards (patch 24)
    'vcf_cutoff': (0, 1), 'vcf_reso': (0, 1), 'vcf_env': (-1, 1), 'uni_detune': (0, 1),
    'formant': (0, 1), 'vowel': (0, 4), 'inharm': (0, 1), 'sub': (0, 1),
    'character': (-1, 1), 'vcf_morph': (0, 1),
    'pitch':(-12,12),'glide':(0,2),'velocity_brightness':(-1,1),'velocity_cutoff':(-1,1),'vcf_keytrack':(0,1),
    'fenv_a': (.001, 3), 'fenv_d': (.001, 3), 'fenv_s': (0, 1), 'fenv_r': (.01, 3),
    # Full sound (17 Nov): Curve, Air, Drift, Dynamics
    'env_curve': (0, 1), 'air': (0, 1), 'drift': (0, 1), 'vel_curve': (0, 1),
    # Strike card (24 Nov): damping, attack noise, pitch envelope
    'damp': (0, 1), 'noise': (0, 1), 'noise_decay': (.002, 1), 'noise_tone': (0, 1), 'pitch_env': (-24, 24), 'pitch_decay': (.005, 1),
    # Sample layer (25 Nov)
    'layer_level': (0, 2), 'layer_tune': (-24, 24), 'layer_start': (0, 1),
}
# The first ten are the original shapes; the 32 after them were added 15 Nov (Sir: shapes for sound
# modulation), shown in the editor as pages of 2 x 5: Curves, Envelopes, Gates & rhythm, Random.
SHAPES = ['sine', 'triangle', 'saw', 'ramp', 'square', 'pulse', 'random', 'smooth', 'steps', 'curve',
          'cosine', 'half_sine', 'exp_up', 'log_up', 'exp_down', 'log_down', 's_curve', 'shark', 'double_sine', 'warm',
          'pluck', 'swell', 'ad', 'trapezoid', 'ramp_hold', 'pump', 'pump2', 'bounce', 'heartbeat', 'wobble',
          'pulse_narrow', 'pulse_wide', 'gate2', 'gate3', 'gate4', 'trance', 'euclid5', 'offbeat', 'stairs4', 'stairs8',
          'sh16', 'drift']
# Mod-pad rates in beats per cycle: 4 bars, 2 bars, 1 bar, 1/2, 1/4, 1/8, 1/16, then 8 bars and 16 bars
# (added 15 Nov at the end so saved rate numbers keep their meaning; the editor shows them slowest first).
RATES = [16, 8, 4, 2, 1, .5, .25, 32, 64, 128]  # index 9: 32 bars (Morph pad paths, Sir 16 Nov)
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

# Macros and mod pads can also move Sampler knobs and Drum Rack pads (stage 9, 15 Nov evening).
# Sampler 'cutoff' is in octaves around the knob; Drum Rack params are '<pad>:<key>' and apply on the next hit.
# Later (17 Nov): every other Sampler knob (glide, velocity, the amp ADSR, the filter and pitch envelope times) and, on the Drum Rack,
# velocity plus the baked Shape / Tone / Comp knobs (the pad's shaped copy is re-rendered off the audio path, a few times a second at most).
from .sampler_grain import RANGES as _GRAIN_RANGES
SAMPLER_TARGETS = dict(gain=(0., 2.), tune=(-24., 24.), fine=(-100., 100.), cutoff=(0., 10.), resonance=(0., 1.),
                       f_env=(-1., 1.), p_env=(-24., 24.), glide=(0., 2.), velocity=(0., 2.), attack=(0., 3.), decay=(0., 3.),
                       sustain=(0., 1.), release=(0., 3.), f_attack=(0., 3.), f_decay=(0., 3.), f_velocity=(0., 1.), p_decay=(0., 3.),
                       f_hold=(0., 3.), f_sustain=(0., 1.), f_release=(0., 3.), f_env_vel=(0., 1.), vel_attack=(0., 1.), pan=(-1., 1.),
                       **_GRAIN_RANGES)
from .drum_shape import RANGES as _SHAPE_RANGES
DRUM_BAKED = ('attack', 'hold', 'decay', 'fade_in', 'fade_out', 'eq_low', 'eq_mid', 'eq_freq', 'eq_high', 'low_cut', 'high_cut',
              'drive', 'comp_threshold', 'comp_ratio', 'comp_attack', 'comp_release', 'comp_makeup')
DRUM_TARGETS = dict(gain=(0., 2.), tune=(-24., 24.), pan=(-1., 1.), velocity=(0., 2.), **{k: _SHAPE_RANGES[k] for k in DRUM_BAKED})

def _drum_key(key):
    pad, sep, k = key.partition(':')
    if not sep or not pad.isdigit() or not 0 <= int(pad) < 16 or k not in DRUM_TARGETS: raise KeyError(key)
    return k

def _range(module, key):
    if module == 'sound': return SOUND_PARAMS[key]
    if module == 'sampler': return SAMPLER_TARGETS[key]
    if module == 'drum': return DRUM_TARGETS[_drum_key(key)]
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
            if 'source' in params: params['source'] = float(round(params['source']))
            for module, key in STEPPED:
                if m['id'] == module: params[key] = float(round(params[key]))
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
            # PyDLL, not CDLL: the call keeps Python's lock. These kernels run many short calls a block on the
            # audio thread; with CDLL every call let go of the lock, and a busy background thread (WAV load, chop,
            # library scan) could then hold the audio up for up to the switch interval each time (blocks went from
            # about 1 ms to over 100 ms). Long calls made from background threads use CDLL instead (drum_native).
            lib = ctypes.PyDLL(str(source))
            # The params array is NPAR values per module: a library built with another layout would read the
            # wrong knobs, so it counts as missing (FX bypassed) until tools/build-native.sh rebuilds it.
            if not legacy and (not hasattr(lib, 'dsfx_npar') or lib.dsfx_npar() != NPAR): raise OSError('stale FX library')
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
            if hasattr(lib, 'dsfx_voice_curve'):  # curved decay and release
                D = ctypes.POINTER(ctypes.c_double)
                lib.dsfx_voice_curve.argtypes = [D, ctypes.c_int, D, D, D, ctypes.c_int] + [ctypes.c_double] * 7
                lib.dsfx_voice_curve.restype = ctypes.c_int
            if hasattr(lib, 'dsfx_voice_pitch'):  # the pitch envelope in one call (strike.DsPitch)
                from .strike import DsPitch
                P = ctypes.POINTER(DsPitch)
                lib.dsfx_voice_pitch.argtypes = lib.dsfx_voice.argtypes + [P]; lib.dsfx_voice_pitch.restype = ctypes.c_int
                lib.dsfx_voice_curve_pitch.argtypes = lib.dsfx_voice_curve.argtypes + [P]; lib.dsfx_voice_curve_pitch.restype = ctypes.c_int
                lib.dsfx_voice2_pitch.argtypes = lib.dsfx_voice2.argtypes + [P]; lib.dsfx_voice2_pitch.restype = ctypes.c_int
            if hasattr(lib, 'dsfx_master'):  # the master stage on the stereo mix
                lib.dsfx_master_create.restype = ctypes.c_void_p; lib.dsfx_master_create.argtypes = [ctypes.c_double]
                lib.dsfx_master_destroy.argtypes = [ctypes.c_void_p]
                lib.dsfx_master_set.argtypes = [ctypes.c_void_p, ctypes.c_double, ctypes.c_double, ctypes.c_double]
                lib.dsfx_master_gr.argtypes = [ctypes.c_void_p]; lib.dsfx_master_gr.restype = ctypes.c_double
                lib.dsfx_master.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_double), ctypes.c_int]
                lib.dsfx_master_i.argtypes = [ctypes.c_void_p] + [ctypes.POINTER(ctypes.c_double)] * 3 + [ctypes.c_int]
            if hasattr(lib,'dsfx_gate_controls'):
                lib.dsfx_gate_controls.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_double,ctypes.c_double,ctypes.c_int]
                lib.dsfx_gate_beat.argtypes=[ctypes.c_void_p];lib.dsfx_gate_beat.restype=ctypes.c_double
                lib.dsfx_gate_reset.argtypes=[ctypes.c_void_p]
                lib.dsfx_gate_events.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_int),ctypes.c_int]
            if hasattr(lib,'dsfx_key'):
                lib.dsfx_key.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.POINTER(ctypes.c_double),ctypes.c_int]
                lib.dsfx_scale.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int]
                lib.dsfx_readout.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_double)]
            if hasattr(lib,'dsfx_bus_mode'):lib.dsfx_bus_mode.argtypes=[ctypes.c_void_p,ctypes.c_int]
            if hasattr(lib,'dsfx_process_stereo'):
                lib.dsfx_process_stereo.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.POINTER(ctypes.c_double),ctypes.POINTER(ctypes.c_double),ctypes.c_int,ctypes.POINTER(ctypes.c_int),ctypes.POINTER(ctypes.c_int),ctypes.POINTER(ctypes.c_double),ctypes.c_double]
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
                ('npart', ctypes.c_int), ('stretch', ctypes.c_double), ('sub', ctypes.c_double), ('suboct', ctypes.c_int),
                ('curve', ctypes.c_double)]  # last, so older libraries just never read it

def native_voice2():
    """The C voice renderer with the Filter, Unison and Character cards, or None."""
    lib = _load(legacy=True)
    return lib.dsfx_voice2 if lib and hasattr(lib, 'dsfx_voice2') else None

def native_voice():
    """The C voice renderer, or None when the native library is missing or older."""
    lib = _load(legacy=True)
    return lib.dsfx_voice if lib and hasattr(lib, 'dsfx_voice') else None

def native_pitch(name):
    """One of the pitch-envelope voice kernels ('dsfx_voice_pitch', 'dsfx_voice_curve_pitch', 'dsfx_voice2_pitch'), or None."""
    lib = _load(legacy=True)
    return getattr(lib, name) if lib and hasattr(lib, 'dsfx_voice_pitch') else None

def native_voice_curve():
    """The C voice renderer with the curved decay and release, or None."""
    lib = _load(legacy=True)
    return lib.dsfx_voice_curve if lib and hasattr(lib, 'dsfx_voice_curve') else None

class MasterStage:
    """The master stage on the stereo mix (dsfx_master in dsfx.c): makeup gain, a gentle glue, the tone
    polish (20 Hz high-pass, -1.2 dB at 3.2 kHz, 18.5 kHz low-pass) and a look-ahead true-peak limiter at
    -1 dBTP. available is False with an older library; the engine then keeps its old Python limiter."""
    TRIM = 2.8       # +9 dB: the centre pan law put every track at half level and the mix sat far below full scale
    DRIVE = .3       # glue: the loudest peaks bend a little before the limiter
    CEILING = -1.    # dBTP
    def __init__(self, rate):
        lib = _load()
        self.lib = lib if lib and hasattr(lib, 'dsfx_master') else None
        self.handle = self.lib.dsfx_master_create(float(rate)) if self.lib else None
        self.available = bool(self.handle)
        if self.available: self.lib.dsfx_master_set(self.handle, self.TRIM, self.DRIVE, self.CEILING)
    def process(self, left, right):
        """Run the stage over the two channel lists; returns them interleaved (L R L R ...), as the audio
        queue takes them. The lists go to C through array buffers, which is several times faster than
        filling a ctypes array item by item."""
        n = len(left)
        a = array('d', left); b = array('d', right); out = array('d', bytes(16 * n))
        D = ctypes.c_double * n
        self.lib.dsfx_master_i(self.handle, D.from_buffer(a), D.from_buffer(b), (ctypes.c_double * (2 * n)).from_buffer(out), n)
        return out.tolist()
    def reduction(self):
        return self.lib.dsfx_master_gr(self.handle) if self.available else 0.
    def __del__(self):
        if getattr(self, 'handle', None) and self.lib: self.lib.dsfx_master_destroy(self.handle)

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
    extra = _EXTRA.get(shape)
    if extra is not None: return max(-1., min(1., extra(phase, seed)))
    # random: a new held value 8 times per cycle, repeatable per cycle index
    k = int(phase * 8) + seed * 8
    return ((k * 2654435761) % 1000) / 500. - 1

_E4 = math.exp(4) - 1
_TRANCE = (1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0)
_EUCLID5 = (1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0)
def _uni(v): return 2 * v - 1
def _frac(x): return x - math.floor(x)
def _shark(p): return 1 - (1 - p / .5) ** 3 if p < .5 else 1 - (p - .5) / .5
def _ad(p): return p / .15 if p < .15 else math.exp(-5 * (p - .15) / .85)
def _trap(p): return p / .2 if p < .2 else 1. if p < .6 else 1 - (p - .6) / .2 if p < .8 else 0.
def _pump(p): return 1 - math.exp(-6 * p)
def _beat(p): return min(1., math.exp(-((p - .1) / .04) ** 2) + .7 * math.exp(-((p - .28) / .04) ** 2))
# Same maths as ui/src/fx.ts EXTRA_SHAPES (the editor draws what the engine plays).
_EXTRA = {
    'cosine': lambda p, s: math.cos(2 * math.pi * p),
    'half_sine': lambda p, s: _uni(math.sin(math.pi * p)),
    'exp_up': lambda p, s: _uni((math.exp(4 * p) - 1) / _E4),
    'log_up': lambda p, s: _uni(1 - (1 - p) ** 3),
    'exp_down': lambda p, s: _uni((1 - p) ** 3),
    'log_down': lambda p, s: _uni(1 - (math.exp(4 * p) - 1) / _E4),
    's_curve': lambda p, s: _uni(p * p * (3 - 2 * p)),
    'shark': lambda p, s: _uni(_shark(p)),
    'double_sine': lambda p, s: math.sin(4 * math.pi * p),
    'warm': lambda p, s: (math.sin(2 * math.pi * p) + 1 - 4 * abs(p - .5)) / 2,
    'pluck': lambda p, s: _uni(math.exp(-6 * p)),
    'swell': lambda p, s: _uni(p * p),
    'ad': lambda p, s: _uni(_ad(p)),
    'trapezoid': lambda p, s: _uni(_trap(p)),
    'ramp_hold': lambda p, s: _uni(min(1., 2 * p)),
    'pump': lambda p, s: _uni(_pump(p)),
    'pump2': lambda p, s: _uni(_pump(_frac(2 * p))),
    'bounce': lambda p, s: _uni(abs(math.cos(3 * math.pi * p)) * (1 - p)),
    'heartbeat': lambda p, s: _uni(_beat(p)),
    'wobble': lambda p, s: math.sin(8 * math.pi * p) * (1 - p),
    'pulse_narrow': lambda p, s: 1. if p < .125 else -1.,
    'pulse_wide': lambda p, s: 1. if p < .75 else -1.,
    'gate2': lambda p, s: 1. if _frac(2 * p) < .5 else -1.,
    'gate3': lambda p, s: 1. if _frac(3 * p) < .5 else -1.,
    'gate4': lambda p, s: 1. if _frac(4 * p) < .6 else -1.,
    'trance': lambda p, s: 1. if _TRANCE[int(16 * p) % 16] and _frac(16 * p) < .8 else -1.,
    'euclid5': lambda p, s: 1. if _EUCLID5[int(16 * p) % 16] and _frac(16 * p) < .5 else -1.,
    'offbeat': lambda p, s: 1. if .5 <= _frac(4 * p) < .9 else -1.,
    'stairs4': lambda p, s: _uni(min(3, int(4 * p)) / 3),
    'stairs8': lambda p, s: _uni(min(7, int(8 * p)) / 7),
    'sh16': lambda p, s: (((int(16 * p) + s * 16) * 2654435761 + 12345) % 1000) / 500. - 1,
    'drift': lambda p, s: _noise(p * 2 + s * 2, 9),
}

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

# (module, key) -> (position, min, max, init): where a parameter sits in the native array.
PARAM_INDEX = {(m, key): (j, lo, hi, init) for m, specs in PARAMS.items() for j, (key, lo, hi, init) in enumerate(specs)}


# Effects sleep after this many seconds of silence in and out: the longest echo or grain buffer is 3 s.
# Long reverb tails (Space and Shimmer decay up to 20 s; Space was 60 s until 25 Nov, capped: too long and heavy) keep the output above REST_FLOOR, so they are never
# cut: the count only starts once the tail itself is below the floor. A frozen Space never sleeps (see configure).
REST_SECONDS = 4.
REST_FLOOR = 1e-6


class TrackFx:
    def __init__(self, rate):
        self.lib = _load(); self.handle = self.lib.dsfx_create(rate) if self.lib else None
        self.right=self.lib.dsfx_create(rate) if self.handle and hasattr(self.lib,'dsfx_process_stereo') else None
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
        self.rest_enabled = True; self._quiet = 0; self.cleared = 0  # frames of silence in and out so far (see process)
        self.watched = False  # the engine sets this for the track the screen shows
        self._mods_live = False; self._written = set(); self._gate_module = None; self._by_id = {}
        self._tail = 0  # blocks left to fade out after the last effect is switched off
        self._hold = False  # Space is frozen: its tail must keep sounding, so the track never sleeps
        self._scale = None; self._readout = (ctypes.c_double * 3)()
    def retrigger(self,frame=None,empty=True):
        """A note started on this track: in Retrigger mode the puck goes back to the start of its path."""
        self._retrig = True
        mode=self.gate_values['retrig']
        if mode==0 or (mode==1 and empty):
            self._gate_events.append(self._gate_frame if frame is None else int(frame))
            self._gate_events=self._gate_events[-256:]
    def clear_gate_events(self,reset_origin=True):
        self._gate_events=[]
        if reset_origin:self._gate_origin=None
    def gate_runtime(self):
        if not self.handle or not hasattr(self.lib,'dsfx_gate_beat'):return None
        gate=next((m for m in (self.chain or {}).get('modules',[]) if m['id']=='gate'),None)
        if not gate:return None
        beat=self.lib.dsfx_gate_beat(self.handle);p=gate['params']
        idx=ORDER.index('gate')*NPAR
        length=GATE_LENGTHS[round(self.params[idx])];division=(1.,.5,.25,1/3,1/6)[round(self.params[idx+1])]
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
        if self.right:self.lib.dsfx_tune(self.right,freqs,len(strings))
    def key_sources(self):
        """Source track of Ducking and of the Vocoder while each is heard (None when off)."""
        out = []
        for m in KEYED:
            idx = ORDER.index(m)
            out.append(int(round(self.params[idx * NPAR])) if self.active and self.on[idx] else None)
        return out
    def set_scale(self, steps, root):
        """Auto-tune pulls notes to these scale steps (semitones above root)."""
        mask = sum(1 << (int(s) % 12) for s in steps) or 4095
        if (mask, root) == self._scale or not self.handle or not hasattr(self.lib, 'dsfx_scale'): return
        self._scale = (mask, root)
        self.lib.dsfx_scale(self.handle, mask, int(root))
        if self.right: self.lib.dsfx_scale(self.right, mask, int(root))
    def readout(self):
        """Auto-tune: the note it hears and its correction in cents; Ducking: how far it pushes down (dB)."""
        if not self.handle or not hasattr(self.lib, 'dsfx_readout'): return None
        self.lib.dsfx_readout(self.handle, self._readout); r = self._readout
        return dict(note=round(r[0], 2), cents=round(r[1], 1), duck=round(r[2], 2))
    def configure(self, chain):
        for m in (chain or {}).get('modules', []):
            if m['id'] in NATIVE_R2 and m['on'] and not m.get('bypass') and self.handle and not hasattr(self.lib, 'dsfx_key'):
                raise ValueError('Pitch shift, Auto-tune, Ducking and Vocoder require the cached native kernel; run tools/build-native-filter.py and restart')
        if not self.right:
            for m in (chain or {}).get('modules',[]):
                stereo=m['id']=='cloud' or (m['id'] in ('chorus','delay','reverb') and (m['params'].get('width',0.)>0 or m['params'].get('haas',0.)>0))
                if m['on'] and not m.get('bypass') and stereo:
                    raise ValueError('Stereo controls require the cached native kernel; run tools/build-native-filter.py and restart')
        self.chain = chain
        gate=next((m for m in (chain or {}).get('modules',[]) if m['id']=='gate'),None)
        self._hold = any(m['id'] == 'space' and m['on'] and not m.get('bypass') and m['params'].get('freeze', 0) >= .5
                         for m in (chain or {}).get('modules', []))
        self._quiet=0; self._gate_module=gate; self._written=set(); self._by_id={m['id']:m for m in (chain or {}).get('modules',[])}
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
        if self.active and not was and self.handle and not self._tail: self.lib.dsfx_reset(self.handle); self.right and self.lib.dsfx_reset(self.right); self.tuned = []
        # The last effect switched off: keep running a few blocks so it fades out instead of cutting.
        if was and not self.active: self._tail = 8
    def modulate(self, beat, automation=None):
        """Write base params plus macro and mod-pad offsets for this block.

        Quiet when nothing is linked: no offsets to work out, and the parameters are only rewritten
        for the knobs that moved (or just stopped moving), not all 22 effects every block."""
        c = self.chain
        if not c:self.sound={};self.sampler={};self.drum={};return
        automation=automation or {}
        macros = c.get('macros') or []; mods = c.get('mods') or []
        linked = bool(automation) or any(m['targets'] for m in macros) or any(m['targets'] for m in mods)
        offsets = {}
        if linked:
            self._mods_live = True
            values = [automation.get(('macro',str(i)),m['value']) for i,m in enumerate(macros)]  # the Morph Pad writes its two macros' values directly
            self.move_puck(beat, values)  # ...and while its puck travels a path, the engine moves them in audio time
            for m, v in zip(macros, values):
                for t in m['targets']:
                    key = (t['module'], t['param']); offsets[key] = offsets.get(key, 0) + v * t['depth']
            for i, m in enumerate(mods):
                if not m['targets']: self.mod_values[i] = 0.; continue
                v, ph = mod_value(m, beat); self.mod_values[i] = v; self.mod_phases[i] = ph
                for t in m['targets']:
                    key = (t['module'], t['param']); offsets[key] = offsets.get(key, 0) + v * t['depth'] * .5
            self.sound = {k[1]: v * (SOUND_PARAMS[k[1]][1] - SOUND_PARAMS[k[1]][0]) for k, v in offsets.items() if k[0] == 'sound'}
            self.sampler = {k[1]: v * (SAMPLER_TARGETS[k[1]][1] - SAMPLER_TARGETS[k[1]][0]) for k, v in offsets.items() if k[0] == 'sampler'}
            self.drum = {}
            for k, v in offsets.items():
                if k[0] == 'drum': lo, hi = DRUM_TARGETS[_drum_key(k[1])]; self.drum[k[1]] = v * (hi - lo)
        else:
            # Nothing is linked: the Morph puck only matters to the screen, so it moves only while this track is shown.
            if self.watched: self.move_puck(beat, [0.] * NMACRO)
            if self._mods_live: self.mod_values = [0.] * NMOD_SRC; self._mods_live = False
            self.sound = {}; self.sampler = {}; self.drum = {}
        gate=self._gate_module
        if gate:
            for k,(lo,hi,init) in GATE_PERFORMANCE.items():
                self.gate_values[k]=min(hi,max(lo,automation.get(('gate',k),gate['params'].get(k,init))+offsets.get(('gate',k),0.)*(hi-lo)))
            if any(('gate',k) in offsets or ('gate',k) in automation for k in ('phase','notelen')):
                self._gate_extended=True
                if self.handle and not hasattr(self.lib,'dsfx_gate_controls'):raise ValueError('Gate automation requires the cached native kernel')
        touched = {k for k in offsets if k in PARAM_INDEX} | {k for k in automation if k in PARAM_INDEX}
        if not touched and not self._written: return
        # Knobs that were moved last block but are not now go back to their saved value.
        for module, key in touched | self._written:
            idx = ORDER.index(module); j, lo, hi, init = PARAM_INDEX[(module, key)]
            base = automation.get((module, key), self._base_value(module, key, init))
            v = base + offsets.get((module, key), 0.) * (hi - lo)
            self.params[idx * NPAR + j] = min(hi, max(lo, v))
        self._written = touched
    def _base_value(self, module, key, init):
        m = self._by_id.get(module)
        return m['params'].get(key, init) if m else init
    def process(self, samples, bpm, beat=0., modulated=False, clock=None, frame=None, _stereo=False, right=None, key=None):
        """Run the effects over one block (see _process). When the input has been silent and the output
        has stayed silent for longer than the longest echo any effect can hold (REST_SECONDS), the effects
        are asleep: the block is answered with zeros at once, and the first sound wakes them again."""
        silent_in = not any(samples) and (right is None or not any(right)) and (key is None or all(k is None for k in key))
        if silent_in and self.rest_enabled and self.active and not self._tail and not self._hold and self._quiet >= self.rate * REST_SECONDS:
            n = len(samples)
            self._gate_frame = (self._gate_frame if frame is None else int(frame)) + n
            return ([0.] * n, [0.] * n) if _stereo else [0.] * n
        out = self._process(samples, bpm, beat, modulated, clock, frame, _stereo, right, key)
        if self.active and self.handle:
            # A NaN or infinite result (a runaway feedback loop) would ring until restart: clear the effects instead.
            pair = out if _stereo else (out,)
            if not all(math.isfinite(sum(c)) for c in pair):
                self.lib.dsfx_reset(self.handle)
                if self.right: self.lib.dsfx_reset(self.right)
                self.tuned = []; self.cleared += 1; self._quiet = 0
                n = len(samples)
                return ([0.] * n, [0.] * n) if _stereo else [0.] * n
        if silent_in and self.active and not self._tail:
            pair = out if _stereo else (out,)
            if max(max(map(abs, c), default=0.) for c in pair) < REST_FLOOR: self._quiet += len(samples)
            else: self._quiet = 0
        else: self._quiet = 0
        return out
    def _process(self, samples, bpm, beat=0., modulated=False, clock=None, frame=None, _stereo=False, right=None, key=None):
        """samples: list of floats; returns a list (same object when bypassed).
        modulated: the engine already called modulate() for this block.
        clock: song position in beats while the transport plays (the audio gate locks to it).
        right: a separate right input (stereo sources such as a panned Drum Rack); samples is then the left.
        key: [ducking source audio, vocoder source audio] for this block, each a list or None."""
        if right is not None and _stereo and not self.right and (self.active or self._tail):
            samples = [(l + r) * .5 for l, r in zip(samples, right)]; right = None  # no stereo FX: fold to mono
        if not modulated and self.chain:
            if self.active: self.modulate(beat)
            else: self.move_puck(beat, [0.] * NMACRO)  # keep the puck moving for the screen
        if not self.active:
            if not self._tail: return (samples,list(samples) if right is None else right) if _stereo else samples
            self._tail -= 1
        n = len(samples); buf = (ctypes.c_double * n)(*samples)
        self._gate_block(n,frame,clock,_stereo)
        keep=[]
        if hasattr(self.lib,'dsfx_key'):
            for slot in (0,1):
                audio=key[slot] if key else None
                arr=(ctypes.c_double*n)(*audio[:n]) if audio is not None and len(audio)>=n else None;keep.append(arr)
                for h in (self.handle,self.right if _stereo else None):
                    if h:self.lib.dsfx_key(h,slot,arr,n if arr is not None else 0)
        if _stereo and self.right:
            right=(ctypes.c_double*n)(*(samples if right is None else right))
            self.lib.dsfx_process_stereo(self.handle,self.right,buf,right,n,self.order,self.on,self.params,float(bpm))
            return list(buf),list(right)
        self.lib.dsfx_process(self.handle,buf,n,self.order,self.on,self.params,float(bpm))
        return (list(buf),list(buf)) if _stereo else list(buf)
    def _gate_block(self,n,frame,clock,_stereo):
        """The audio gate's note events and song clock for the next n frames (both process paths)."""
        start=self._gate_frame if frame is None else int(frame);end=start+n;self._gate_frame=end
        gate_on=bool(self.on[ORDER.index('gate')])
        events=sorted(set(max(start,x)-start for x in self._gate_events if x<end)) if self._gate_extended and gate_on and not self.gate_values['hold'] else []
        self._gate_events=[x for x in self._gate_events if x>=end]
        if hasattr(self.lib,'dsfx_gate_controls'):
            self.lib.dsfx_gate_controls(self.handle,int(self._gate_extended),self.gate_values['phase'],self.gate_values['notelen'],int(self.gate_values['hold']))
            array=(ctypes.c_int*len(events))(*events)
            self.lib.dsfx_gate_events(self.handle,array,len(events))
            if _stereo and self.right:
                self.lib.dsfx_gate_controls(self.right,int(self._gate_extended),self.gate_values['phase'],self.gate_values['notelen'],int(self.gate_values['hold']))
                self.lib.dsfx_gate_events(self.right,array,len(events))
        # Once retriggered, the native gate integrates each block's current BPM.
        # Do not reinterpret all elapsed frames at the latest tempo or split other FX.
        local=self._gate_extended and self.gate_values['retrig']<2 and self._gate_origin is not None
        if clock is not None and not local and hasattr(self.lib,'dsfx_set_clock'):self.lib.dsfx_set_clock(self.handle,float(clock))
        if _stereo and self.right and clock is not None and not local and hasattr(self.lib,'dsfx_set_clock'):self.lib.dsfx_set_clock(self.right,float(clock))
        if events:self._gate_origin=start+events[-1]
    def process_stereo(self,samples,bpm,beat=0.,**kwargs):
        return self.process(samples,bpm,beat,_stereo=True,**kwargs)
    def process_buffers(self,bufs,left,right,n,has_right,bpm,beat=0.,modulated=False,clock=None,frame=None,key=None):
        """process_stereo in place on C buffers (cbus.py): left and right are ctypes arrays holding the
        block's first n frames. has_right: right holds the track's own right channel (a panned Drum Rack);
        otherwise its contents are ignored. On return left and right hold the stereo result.
        key: [ducking source, vocoder source], each a ctypes array or None. bufs: the cbus.TrackBuffers.
        Same decisions as process() and _process(), in the same order, so the sound is identical."""
        from . import cbus
        c=cbus.lib();scan=bufs.scan
        heard_l=scan(left,n)[0];heard_r=has_right and scan(right,n)[0]
        silent_in=not heard_l and not heard_r and (key is None or all(k is None for k in key))
        if silent_in and self.rest_enabled and self.active and not self._tail and not self._hold and self._quiet>=self.rate*REST_SECONDS:
            self._gate_frame=(self._gate_frame if frame is None else int(frame))+n
            cbus.zero(left,0,n);cbus.zero(right,0,n);return
        # --- _process
        if has_right and not self.right and (self.active or self._tail):
            c.dsfx_buf_avg(cbus.addr(left),cbus.addr(left),cbus.addr(right),n);has_right=False  # no stereo FX: fold to mono
        if not modulated and self.chain:
            if self.active:self.modulate(beat)
            else:self.move_puck(beat,[0.]*NMACRO)
        if not self.active:
            if not self._tail:
                if not has_right:cbus.copy(right,left,n)
                self._quiet=0;return
            self._tail-=1
        self._gate_block(n,frame,clock,True)
        if hasattr(self.lib,'dsfx_key'):
            for slot in (0,1):
                arr=key[slot] if key else None
                for h in (self.handle,self.right):
                    if h:self.lib.dsfx_key(h,slot,arr,n if arr is not None else 0)
        L=cbus.view(left,0,n)
        if self.right:
            if not has_right:cbus.copy(right,left,n)
            self.lib.dsfx_process_stereo(self.handle,self.right,L,cbus.view(right,0,n),n,self.order,self.on,self.params,float(bpm))
        else:
            self.lib.dsfx_process(self.handle,L,n,self.order,self.on,self.params,float(bpm))
            cbus.copy(right,left,n)
        # --- back in process(): NaN guard and the sleep counter
        if self.active and self.handle:
            _,fin_l,peak_l=scan(left,n);_,fin_r,peak_r=scan(right,n)
            if not (fin_l and fin_r):
                self.lib.dsfx_reset(self.handle)
                if self.right:self.lib.dsfx_reset(self.right)
                self.tuned=[];self.cleared+=1;self._quiet=0
                cbus.zero(left,0,n);cbus.zero(right,0,n);return
            if silent_in and not self._tail:
                if max(peak_l,peak_r)<REST_FLOOR:self._quiet+=n
                else:self._quiet=0
            else:self._quiet=0
        else:self._quiet=0
    def levels(self):
        if not self.handle: return [0.] * len(ORDER)
        self.lib.dsfx_levels(self.handle, self._levels)
        return [round(v, 4) for v in self._levels]
    def comp_reduction(self):
        """Compressor gain reduction in dB (0 when the library is older)."""
        if not self.handle or not hasattr(self.lib, 'dsfx_comp_gr'): return 0.
        return round(max(self.lib.dsfx_comp_gr(self.handle),self.lib.dsfx_comp_gr(self.right) if self.right else 0.), 2)
    def __del__(self):
        try:
            if getattr(self,'right',None):self.lib.dsfx_destroy(self.right)
            if self.handle: self.lib.dsfx_destroy(self.handle)
        except Exception:
            pass
