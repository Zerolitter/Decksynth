"""Per-pad sound shaping for the Drum Rack (review 2026-11-15, round 2).

Non-destructive: the source WAV and its cached PCM are never changed. A shaped copy of the
pad's PCM is rendered off the audio path (one background thread, C routine with the GIL
released when available) whenever the pad's shape, tune or sample changes, and swapped in
when ready; notes already sounding keep their old copy.

Shape fields (all optional on load; missing means "as recorded"):
  start, end      trim, as a fraction of the sample (0..1, end > start)
  reverse         play the trimmed region backwards
  fade_in         linear fade at the start of the trimmed region, seconds
  fade_out        linear fade at the end of what plays, seconds
  attack          envelope rise time, seconds
  hold            full-level time after the attack, seconds
  decay           time from full level to -60 dB after the hold, seconds; 0 = no decay. With no decay
                  and a hold, the pad stops after attack + hold (short release, no click).
  low_cut         12 dB/oct high-pass, Hz (20 = off)
  high_cut        12 dB/oct low-pass, Hz (20000 = off)
  eq_low          low shelf at 200 Hz, dB
  eq_mid          peak at eq_freq (Q 1), dB
  eq_freq         Hz
  eq_high         high shelf at 5 kHz, dB
  comp_threshold  dB; comp_ratio 1 = compressor off
  comp_attack     ms; comp_release ms; comp_makeup dB
  drive           soft saturation amount 0..1
  pan             -1 (left) .. 1 (right); applied by the stereo drum mixer, not rendered here

All times and frequencies are real ones: the copy is rendered for the pad's Tune, so tuning the
pad changes its pitch without stretching the envelope or moving the EQ.
"""
import ctypes
import math
import threading
from array import array
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

DEFAULT_SHAPE = dict(start=0., end=1., reverse=False, fade_in=0., fade_out=0., attack=0., hold=0., decay=0.,
                     low_cut=20., high_cut=20000., eq_low=0., eq_mid=0., eq_freq=1000., eq_high=0.,
                     comp_threshold=-18., comp_ratio=1., comp_attack=5., comp_release=120., comp_makeup=0.,
                     drive=0., pan=0.)
RANGES = dict(start=(0., 1.), end=(0., 1.), fade_in=(0., 2.), fade_out=(0., 2.), attack=(0., 1.), hold=(0., 4.),
              decay=(0., 8.), low_cut=(20., 2000.), high_cut=(500., 20000.), eq_low=(-18., 18.), eq_mid=(-18., 18.),
              eq_freq=(100., 8000.), eq_high=(-18., 18.), comp_threshold=(-48., 0.), comp_ratio=(1., 20.),
              comp_attack=(.1, 100.), comp_release=(10., 1000.), comp_makeup=(0., 24.), drive=(0., 1.), pan=(-1., 1.))
NOT_RENDERED = ('pan',)
RELEASE = .005  # seconds: the end of a held (no decay) pad


def validate_shape(value):
    if not isinstance(value, dict) or not set(value) <= set(DEFAULT_SHAPE):
        raise ValueError('Invalid drum pad shape')
    out = dict(DEFAULT_SHAPE)
    for key, v in value.items():
        if key == 'reverse':
            if type(v) is not bool: raise ValueError('Reverse must be on or off')
        else:
            low, high = RANGES[key]
            if type(v) not in (int, float) or not math.isfinite(v) or not low <= v <= high:
                raise ValueError('Invalid drum pad ' + key.replace('_', ' '))
            v = float(v)
        out[key] = v
    if out['end'] - out['start'] < .001:
        raise ValueError('Trim end must come after trim start')
    return out


def render_key(shape):
    """The part of a shape that changes the PCM (None: play the source as is)."""
    if shape is None: return None
    s = validate_shape(shape)
    if all(s[k] == DEFAULT_SHAPE[k] for k in s if k not in NOT_RENDERED): return None
    return tuple(sorted((k, v) for k, v in s.items() if k not in NOT_RENDERED))


def is_identity(shape):
    return render_key(shape) is None


def pan_gains(shape):
    """Equal-power pan, normalised so the centre is unity on both sides (as before: mono = L = R)."""
    pan = shape.get('pan', 0.) if shape else 0.
    if pan == 0: return 1., 1.  # exact: an unpanned pad is bit-identical to the old mono mixer
    angle = (pan + 1) * math.pi / 4
    return math.cos(angle) * math.sqrt(2), math.sin(angle) * math.sqrt(2)


def _params(shape, rate, step, length, cut_head, cut_tail, gate):
    t = rate * step  # seconds of playback -> frames of the copy
    edge = min(length // 4, int(t * .0015))
    return [shape['attack'] * t, shape['hold'] * t, shape['decay'] * t, shape['fade_in'] * t, shape['fade_out'] * t,
            float(cut_head), float(cut_tail), float(edge if edge > 1 else 0), float(gate),
            min(shape['low_cut'] / step, rate * .45) if shape['low_cut'] > 20.5 else 20., shape['high_cut'] / step if shape['high_cut'] < 19999.5 else 20000.,
            shape['eq_low'], shape['eq_mid'], min(shape['eq_freq'] / step, rate * .45), shape['eq_high'],
            shape['comp_threshold'], shape['comp_ratio'], shape['comp_attack'] * t / 1000, shape['comp_release'] * t / 1000,
            shape['comp_makeup'], shape['drive'], float(rate), min(200. / step, rate * .45), min(5000. / step, rate * .45)]


def _biquad(kind, freq, rate, q, db):
    f = min(freq, rate * .45); w = 2 * math.pi * f / rate; cw = math.cos(w); sw = math.sin(w); A = 10 ** (db / 40)
    alpha = sw / (2 * q)
    if kind == 0: b0 = b2 = (1 - cw) / 2; b1 = 1 - cw; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    elif kind == 1: b0 = b2 = (1 + cw) / 2; b1 = -(1 + cw); a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    elif kind == 2: b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
    else:
        s = 2 * math.sqrt(A) * (sw / (2 * .7071)); sign = -1 if kind == 3 else 1
        b0 = A * ((A + 1) + sign * (A - 1) * cw + s); b1 = -2 * sign * A * ((A - 1) + sign * (A + 1) * cw)
        b2 = A * ((A + 1) + sign * (A - 1) * cw - s); a0 = (A + 1) - sign * (A - 1) * cw + s
        a1 = 2 * sign * ((A - 1) - sign * (A + 1) * cw); a2 = (A + 1) - sign * (A - 1) * cw - s
    return b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0


def _run(d, q):
    b0, b1, b2, a1, a2 = q; x1 = x2 = y1 = y2 = 0.
    for i, x in enumerate(d):
        y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y


def _shape_python(d, p):
    """Reference implementation of drum_shape() in native/drum_mix.c (used when no compiler)."""
    n = len(d); attack, hold, decay, fi, fo = p[:5]; rate = p[21]
    k = -6.907755 / decay if decay > 0 else 0.
    if attack >= 1 or decay > 0 or p[8] > 0:
        for i in range(n):
            if i < attack: d[i] *= i / attack
            elif decay > 0 and i >= attack + hold: d[i] *= math.exp(k * (i - attack - hold))
    for i in range(min(n, int(fi))): d[i] *= i / fi
    for i in range(min(n, int(fo))): d[n - 1 - i] *= i / fo
    edge = int(p[7])
    for i in range(min(edge, n)):
        g = i / edge
        if p[5] > 0: d[i] *= g
        if p[6] > 0: d[n - 1 - i] *= g
    if p[9] > 20.5: _run(d, _biquad(1, p[9], rate, .7071, 0))
    if p[10] < 19999.5: _run(d, _biquad(0, p[10], rate, .7071, 0))
    if p[11]: _run(d, _biquad(3, p[22], rate, .7071, p[11]))
    if p[12]: _run(d, _biquad(2, p[13], rate, 1., p[12]))
    if p[14]: _run(d, _biquad(4, p[23], rate, .7071, p[14]))
    if p[16] > 1:
        thr, ratio, makeup = p[15], p[16], 10 ** (p[19] / 20)
        ca = math.exp(-1 / max(1, p[17])); cr = math.exp(-1 / max(1, p[18])); gr = 0.
        for i, x in enumerate(d):
            db = 20 * math.log10(abs(x)) if abs(x) > 1e-9 else -180
            target = (db - thr) * (1 - 1 / ratio) if db > thr else 0.
            gr = ca * gr + (1 - ca) * target if target > gr else cr * gr + (1 - cr) * target
            d[i] = x * 10 ** (-gr / 20) * makeup
    if p[20] > 0:
        g = 1 + p[20] * 9; norm = 1 / math.tanh(g)
        for i, x in enumerate(d): d[i] = math.tanh(x * g) * norm
    return d


def render_shape(sample, shape, rate, step=1., native=True):
    """A new DecodedSample holding the shaped PCM. step: the pad's playback rate (2 ** (tune / 12))."""
    shape = validate_shape(shape)
    n = sample.frames
    a = min(n - 1, int(shape['start'] * n)); b = max(a + 1, min(n, int(round(shape['end'] * n))))
    segment = array('f', sample.data[a:b])
    if shape['reverse']: segment.reverse()
    t = rate * step
    attack = shape['attack'] * t; hold = shape['hold'] * t; decay = shape['decay'] * t
    gate = decay <= 0 and hold > 0
    length = len(segment)
    if decay > 0: length = min(length, int(attack + hold + decay) + 1)
    elif gate: length = min(length, int(attack + hold + RELEASE * t) + 1)
    if length < len(segment): segment = segment[:length]
    cut_head = (shape['end'] < 1 if shape['reverse'] else shape['start'] > 0) and attack < 1.5e-3 * t and shape['fade_in'] <= 0
    # A cut in the middle of the waveform clicks: ramp the ends that were cut (and any shortened tail).
    cut_tail = (shape['start'] > 0 if shape['reverse'] else shape['end'] < 1) or decay > 0 or gate
    p = _params(shape, rate, step, len(segment), cut_head, cut_tail, gate)
    if gate:  # the release after the hold is the ramp at the tail
        p[7] = float(max(p[7], min(len(segment) // 2, int(RELEASE * t))))
    from .drum_native import native_shape, native_ms
    kernel = native_shape() if native else None

    def run(channel):
        if kernel is not None and len(channel):
            kernel(channel.buffer_info()[0], len(channel), (ctypes.c_double * len(p))(*p))
            return channel
        return array('f', _shape_python(list(channel), p))

    side = getattr(sample, 'side', None)
    if side is None or len(side) != n:
        return replace(sample, data=run(segment), frames=len(segment), **({} if side is None else dict(side=None, lr_peak=None)))
    # A stereo pad (27 Nov): the left and the right copy are shaped alike (same fades, envelope and EQ), then go
    # back to mid and side. The pad's compressor and drive see each side on its own.
    wide = array('f', side[a:b])
    if shape['reverse']: wide.reverse()
    wide = wide[:len(segment)]
    ms = native_ms() if native else None
    if ms is not None and len(segment):
        ms(segment.buffer_info()[0], wide.buffer_info()[0], len(segment), 0)
    else:
        for i in range(len(segment)): segment[i], wide[i] = segment[i] + wide[i], segment[i] - wide[i]
    mid, rest = run(segment), run(wide)   # now the left and right copies
    if ms is not None and len(mid):
        ms(mid.buffer_info()[0], rest.buffer_info()[0], len(mid), 1)
    else:
        for i in range(len(mid)): mid[i], rest[i] = (mid[i] + rest[i]) * .5, (mid[i] - rest[i]) * .5
    if not any(rest):   # shaping left both channels the same: a mono copy
        return replace(sample, data=mid, frames=len(mid), side=None, lr_peak=None)
    return replace(sample, data=mid, frames=len(mid), side=rest)


class PadShaper:
    """Shapes pads on one background thread and hands the result back with a callback."""
    _cache = OrderedDict(); _lock = threading.Lock(); _pool = None

    @classmethod
    def submit(cls, sample, shape, rate, done, step=1., wanted=None, keep=True):
        key = (sample.sha256, sample.frames, render_key(shape), round(step, 9))
        with cls._lock:
            hit = cls._cache.get(key)
            if hit is not None: cls._cache.move_to_end(key)
        if hit is not None:
            done(hit); return None
        if cls._pool is None: cls._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='pad-shape')

        def work():
            # A knob being turned queues many renders: skip the ones a newer edit has replaced.
            if wanted is not None and not wanted(): return
            shaped = render_shape(sample, shape, rate, step)
            if not keep: done(shaped); return  # a knob draft: heard now, not kept
            with cls._lock:
                cls._cache[key] = shaped
                while len(cls._cache) > 24: cls._cache.popitem(last=False)
            done(shaped)
        return cls._pool.submit(work)

    @classmethod
    def wait(cls):
        """Tests: block until queued shaping is done."""
        if cls._pool is not None: cls._pool.submit(lambda: None).result()
