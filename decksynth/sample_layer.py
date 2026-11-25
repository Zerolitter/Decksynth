"""Sample layer (25 Nov): a real recording under the synth's partials.

  Attack    the sample plays once on top of every note (a rim, a hat tick, a kick click): a synth key gets a real start.
  Body      the sample plays at the note's pitch and follows the amp envelope; Loop keeps it going while the key is held.
  Partials  not a mode but a one-off action: measure_partials() reads a sample's spectrum into the 16 partials.

Knobs: Level, Tune (semitones), Start (how far into the sample it begins), and "Through filter" (the sample goes through
the synth's own low-pass: its cutoff, resonance, key tracking and velocity, set when the note starts).
Off by default (layer_on 0): a voice then renders exactly as before, sample for sample.

The file goes into the preset / project as a path (layer_file). 'factory:NAME' means a WAV shipped in decksynth/assets.
A missing, unreadable or still loading file is silent: the layer is simply off for that note. Loading never happens on
the audio thread: set_file() / request() decode in a background thread, render only looks the result up.

The layer is played in Python (a few voices at most, mostly one short one-shot per note), after the synth's voices have
rendered, so it needs no change to the C kernels and works on every render path."""
import math
import threading
from pathlib import Path

LAYER_DEFAULTS = dict(layer_on=0, layer_mode=1, layer_level=1., layer_tune=0., layer_start=0., layer_follow=0, layer_loop=0)
LAYER_RANGES = dict(layer_level=(0, 2), layer_tune=(-24, 24), layer_start=(0, 1))
LAYER_CHOICES = dict(layer_on=(0, 1), layer_mode=(1, 2), layer_follow=(0, 1), layer_loop=(0, 1))
ATTACK, BODY = 1, 2
UNITY = .35                      # layer_level 1 plays the sample at this fraction of its own level (the voices run at .23)
ASSETS = Path(__file__).with_name('assets')
FACTORY = 'factory:'
MAX_SECONDS = 20                 # a layer sample longer than this is cut (it is a layer, not a backing track)


def valid_file(value):
    """layer_file: '' (none), 'factory:NAME.wav' or an absolute path."""
    if not isinstance(value, str) or len(value) > 4096 or '\0' in value: return False
    if value == '': return True
    if value.startswith(FACTORY): return '/' not in value[len(FACTORY):] and '..' not in value and len(value) > len(FACTORY)
    return value.startswith('/') and '..' not in Path(value).parts


def resolve(path):
    """The real file behind a layer_file value, or None."""
    if not path or not valid_file(path): return None
    return ASSETS / path[len(FACTORY):] if path.startswith(FACTORY) else Path(path)


def active(p):
    return bool(p.get('layer_on', 0)) and bool(p.get('layer_file'))


# ------------------------------------------------------------------ loading (never on the audio thread)
class Loaded:
    """One decoded layer sample: float32 mono at the engine rate, its trimmed length and (lazily) its pitch."""
    __slots__ = ('data', 'frames', 'rate', 'root', 'path', 'peaks')
    def __init__(self, sample, path):
        self.data = sample.data; self.frames = min(sample.frames, int(MAX_SECONDS*sample.rate)); self.rate = sample.rate
        self.path = path; self.root = None; self.peaks = None


_lock = threading.Lock()
_loaded = {}      # (path, rate) -> Loaded, or False when the file could not be read
_loading = set()
_caches = {}


def _cache(rate):
    from .samples import SampleCache
    c = _caches.get(rate)
    if c is None: c = _caches[rate] = SampleCache(rate=rate)
    return c


def _decode(path, rate):
    real = resolve(path)
    try:
        if real is None or not real.is_file(): return False
        sample = _cache(rate).load(real)
        out = Loaded(sample, path)
        try:
            from .sampler import detect_root
            out.root = detect_root(sample, rate)
        except Exception: out.root = None
        return out
    except Exception:
        return False


def info(path, rate):
    """What the Sound page shows about the layer file: dict(status 'ready' | 'loading' | 'missing', name, seconds, peaks 0..1)."""
    if not path: return None
    name = Path(path[len(FACTORY):] if path.startswith(FACTORY) else path).stem
    with _lock: got = _loaded.get((path, rate))
    if got is None: request(path, rate); got = lookup_raw(path, rate)
    if not got: return dict(status='loading' if got is None else 'missing', name=name, seconds=0., peaks=[])
    if got.peaks is None:
        n = got.frames; bins = 96; out = []
        for i in range(bins):
            part = got.data[i*n//bins:max(i*n//bins + 1, (i + 1)*n//bins)]
            out.append(max(max(part), -min(part)) if len(part) else 0.)
        top = max(out) or 1.
        got.peaks = [round(v/top, 3) for v in out]
    return dict(status='ready', name=name, seconds=round(got.frames/got.rate, 3), peaks=got.peaks)


def lookup_raw(path, rate):
    with _lock: return _loaded.get((path, rate))


def lookup(path, rate):
    """The decoded sample if it is ready, else None (never reads a file)."""
    with _lock:
        got = _loaded.get((path, rate))
    return got or None


def request(path, rate, wait=False):
    """Start decoding a file in the background (once). With wait, decode here and return the result (tests, offline renders)."""
    if not path or not valid_file(path): return None
    key = (path, rate)
    wait = wait or path.startswith(FACTORY)   # the shipped files are tiny: ready before the first note
    with _lock:
        if key in _loaded: return _loaded[key] or None
        if key in _loading and not wait: return None
        if not wait: _loading.add(key)
    if wait:
        got = _decode(path, rate)
        with _lock: _loaded[key] = got
        return got or None
    def work():
        got = _decode(path, rate)
        with _lock: _loaded[key] = got; _loading.discard(key)
    threading.Thread(target=work, name='sample-layer-load', daemon=True).start()
    return None


def settle(timeout=5.):
    """Wait until the background decodes have finished (an offline render or export starts here, so no first note misses its layer)."""
    import time
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        with _lock:
            if not _loading: return True
        time.sleep(.01)
    return False


def forget(path=None):
    """Drop decoded samples (tests; a changed file on disk)."""
    with _lock:
        for k in [k for k in _loaded if path is None or k[0] == path]: _loaded.pop(k, None)


# ------------------------------------------------------------------ the voices
def spawn(synth, p):
    """Give every new synth voice its layer voice. Runs before the block renders (a note that ends inside its first block still starts)."""
    sample = lookup(p['layer_file'], synth.rate)
    if sample is None or sample.frames < 4: return
    mode = int(p.get('layer_mode', ATTACK)); sr = synth.rate
    start = int(min(.98, max(0., p.get('layer_start', 0.))) * sample.frames)
    lay = synth.__dict__.setdefault('layer', [])
    for key, v in synth.voices.items():
        if v.get('sl') is not None: continue
        v['sl'] = True
        note = v['note']
        if mode == BODY:
            root = sample.root if sample.root is not None else 60
            step = 2.**((note - root + p.get('layer_tune', 0.))/12.)
        else:
            step = 2.**(p.get('layer_tune', 0.)/12.)
        entry = dict(vref=v, mode=mode, pos=float(start), step=step*(sample.rate/sr), sample=sample, start=start,
                     g=synth.amp(v, p)*p.get('layer_level', 1.)*UNITY, level=v.get('level', 0.) if mode == BODY else 1.,
                     dying=0, loop=bool(p.get('layer_loop', 0)) and mode == BODY, s1=0., s2=0., coef=None)
        if p.get('layer_follow', 0) and p.get('vcf_type', 0):
            from .core import cutoff_hz
            fc = min(.45*sr, max(20., cutoff_hz(p, note, v['velocity'])))
            g = math.tan(math.pi*fc/sr); k = 2.-1.9*min(.95, max(0., p.get('vcf_reso', .2)))
            a1 = 1./(1.+g*(g+k)); entry['coef'] = (a1, g*a1, g*g*a1, k)
        lay.append(entry)


def mix(synth, out, frames, p):
    """Add the layer voices of this block into out (a list or a ctypes array)."""
    lay = getattr(synth, 'layer', None)
    if not lay: return
    keep = []
    fade = max(1, int(.006*synth.rate))
    for e in lay:
        data = e['sample'].data; n = e['sample'].frames; pos = e['pos']; step = e['step']; g = e['g']
        body = e['mode'] == BODY; loop = e['loop']; coef = e['coef']; s1 = e['s1']; s2 = e['s2']
        v = e['vref']; alive = body and (v.get('level') is not None) and v.get('sl') is True and e['dying'] == 0 and _voice_alive(synth, v)
        if body:
            if alive: target = v['level']
            else: target = 0.; e['dying'] = e['dying'] or 1
            level = e['level']; dl = (target - level)/frames
        else:
            level = 1.; dl = 0.
        last = n - 1; done = False
        for i in range(frames):
            j = int(pos)
            if j >= last:
                if loop:
                    pos -= (last - e['start']); j = int(pos)
                else: done = True; break
            frac = pos - j; s = data[j] + (data[j+1] - data[j])*frac
            if coef is not None:
                a1, a2, a3, k = coef
                v3 = s - s2; v1 = a1*s1 + a2*v3; v2 = s2 + a2*s1 + a3*v3
                s1 = 2*v1 - s1; s2 = 2*v2 - s2; s = v2
            if body: level += dl
            out[i] += s*g*level
            pos += step
        e['pos'] = pos; e['s1'] = s1; e['s2'] = s2
        if body:
            e['level'] = level
            if not alive and level <= 1e-4: done = True
        if not done and not body and pos >= n - 1: done = True
        if not done: keep.append(e)
    synth.layer = keep


def _voice_alive(synth, v):
    return any(x is v for x in synth.voices.values())


def clear(synth):
    synth.layer = []


# ------------------------------------------------------------------ Partials: read a sample's spectrum into the 16 partials
def measure_partials(sample, rate, start=0.):
    """16 partial levels (0..1, the loudest = 1) of the sample's pitch. Reads about 0.17 s after the attack (or from Start).
    Returns (partials, f0_hz). A sample with no pitch (hats, snares) gives its energy in 16 equal bands from f0 = 100 Hz."""
    data = sample.data; n = min(sample.frames, len(data)); size = 8192
    at = int(start*n)
    if start <= 0:   # skip the click: begin where the level has settled after its loudest point
        peak = max(range(0, min(n, rate//2), 32), key=lambda i: abs(data[i]))
        at = min(max(0, n - size), peak + int(.02*rate))
    at = max(0, min(at, n - 64)); seg = list(data[at:at + size]); m = len(seg)
    if m < 256: return [0.]*16, 100.
    mean = sum(seg)/m
    seg = [(x - mean)*(.5 - .5*math.cos(2*math.pi*i/(m - 1))) for i, x in enumerate(seg)]
    f0 = _pitch(seg, rate)
    pitched = f0 is not None
    if not pitched: f0 = 100.
    def level(freq):
        if freq >= .45*rate: return 0.
        w = 2*math.pi*freq/rate; c = 2*math.cos(w); a = b = 0.
        for x in seg: a, b = x + c*a - b, a
        return math.sqrt(max(0., a*a + b*b - c*a*b))
    amps = [level(f0*(k + 1)) for k in range(16)]
    top = max(amps) or 1.
    return [round(a/top, 4) for a in amps], f0


def _pitch(seg, rate):
    """Fundamental in Hz by autocorrelation on a 4x decimated copy, refined at full rate. None if there is no clear pitch."""
    hop = 4; size = len(seg)//hop
    x = [sum(seg[i*hop:(i + 1)*hop])/hop for i in range(size)]
    r0 = sum(v*v for v in x)
    if r0 < 1e-9: return None
    lo, hi = max(2, int(rate/hop/1500)), min(size//2, int(rate/hop/30))
    corr = {}
    def r(lag):
        if lag not in corr: corr[lag] = sum(x[i]*x[i + lag] for i in range(0, size - lag))/(size - lag)*size/r0
        return corr[lag]
    for lag in range(lo, hi + 2): r(lag)
    peak = max(corr[l] for l in range(lo, hi + 1))
    lag = None
    for k in range(lo + 1, hi + 1):
        if corr[k] >= .9*peak and corr[k] >= corr[k - 1] and corr[k] >= corr[k + 1]: lag = k; break
    if lag is None or peak < .5: return None
    a, b, c = corr[lag - 1], corr[lag], corr[lag + 1]
    shift = .5*(a - c)/(a - 2*b + c) if a - 2*b + c else 0.
    return rate/hop/(lag + shift)
