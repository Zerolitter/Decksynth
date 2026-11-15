"""Chop a Sampler's sample into slices, and send slices to Drum Rack pads (sampler expansion, 15 Nov).

Modes, like an MPC's Chop:
  threshold   a slice starts where the level jumps above the threshold (a hit, a played note);
              it ends at the next one, or earlier when the sound dies away into silence
  regions     N equal slices of the trimmed part
  bpm         one slice per beat length (1/16 note .. 1 bar) at a tempo
  split/join  manual: cut the chosen slice in two at a point, or merge it with the next one

Every boundary snaps to a nearby zero crossing so a slice starts without a click. Heavy work
(decoding, envelopes, writing WAVs) runs on a worker thread; only poll() changes the project.
"""
from array import array
from concurrent.futures import ThreadPoolExecutor
import math
import os
from pathlib import Path
import re
import struct
import time

from .sampler import MAX_SLICES, MIN_SLICE

HOP = 128                      # envelope resolution: 2.7 ms at 48 kHz
BEATS = (.25, .5, 1., 2., 4.)  # 1/16 .. 1 bar
CHOP_MODES = ('threshold', 'regions', 'bpm', 'split', 'join', 'clear')


def envelope(data, hop=HOP):
    """Peak level per hop, with C-level min/max on slices."""
    n = len(data); out = array('f')
    for at in range(0, n, hop):
        part = data[at:at+hop]
        out.append(max(max(part), -min(part)))
    return out


def peaks_of_view(data, lo, hi):
    from .samples import peaks_of
    return peaks_of(data, lo, hi, 256)


def snap_zero(data, frame, rate, back_only=False):
    """The nearest zero crossing within 1.5 ms (only earlier ones for a hit, so the attack stays)."""
    n = len(data)
    if frame <= 0 or frame >= n - 1: return max(0, min(n, frame))
    reach = max(1, int(rate * .0015))
    for d in range(reach + 1):
        for f in ((frame - d,) if back_only else (frame - d, frame + d)):
            if 0 < f < n and (data[f-1] <= 0. < data[f] or data[f-1] >= 0. > data[f] or data[f] == 0.):
                return f
    return frame


def detect_hits(env, first, last, threshold_db, min_frames, rate, hop=HOP, limit=MAX_SLICES):
    """Slice bounds (frames) for threshold mode over env hops [first, last).

    A hit is where the level is over the threshold and either comes up out of quiet (a played note
    after silence) or jumps 6 dB over the last 30 ms (a drum hit inside a mix). Hits closer than
    `min_frames` keep the stronger one; with more than `limit`, the strongest are kept.
    """
    thr = 10 ** (threshold_db / 20.); floor = thr / 8.    # silence: 18 dB under the threshold
    gap = max(1, min_frames // hop); window = max(2, int(.03 * rate) // hop)
    runs = []; armed = True; total = 0.; history = []; run = None
    for k in range(first, last):
        e = env[k]
        mean = total / len(history) if history else 0.
        ratio = e / mean if mean > 1e-9 else (1000. if e > 0 else 0.)
        hit = e >= thr and (armed or (len(history) == window and ratio >= 2.))
        if hit:
            strength = 1000. if armed else ratio
            if run is None: run = [k, strength]
            else: run[1] = max(run[1], strength)
            armed = False
        elif run is not None:
            runs.append(run); run = None
        if e < thr * .5: armed = True
        history.append(e); total += e
        if len(history) > window: total -= history.pop(0)
    if run is not None: runs.append(run)
    import bisect
    taken = []
    for k, _ in sorted(runs, key=lambda r: -r[1]):
        at = bisect.bisect_left(taken, k)
        if (at > 0 and k - taken[at-1] < gap) or (at < len(taken) and taken[at] - k < gap): continue
        taken.insert(at, k)
        if len(taken) >= limit: break
    bounds = []
    for i, k in enumerate(taken):
        stop = taken[i+1] if i + 1 < len(taken) else last
        loud = k
        for j in range(k, stop):
            if env[j] >= floor: loud = j
        quiet_tail = stop - loud > max(1, int(.05 * rate) // hop)
        end = min(stop, loud + 1 + max(1, int(.03 * rate) // hop)) if quiet_tail else stop
        bounds.append((max(0, k * hop - int(.002 * rate)), end * hop))
    return bounds


def chop(data, rate, env, start, end, mode, options, slices):
    """New slices ([a, b] fractions). `start`/`end` are the trim, `slices` the current ones."""
    n = len(data)
    if n < 4: raise ValueError('The sample is too short to chop')
    lo, hi = int(start * n), max(int(start * n) + 2, min(n, int(round(end * n))))
    opts = options if isinstance(options, dict) else {}
    if mode == 'clear': return []
    if mode == 'regions':
        count = opts.get('count')
        if type(count) is not int or not 2 <= count <= MAX_SLICES: raise ValueError('Regions: choose 2 to %d slices' % MAX_SLICES)
        bounds = [(lo + (hi - lo) * i // count, lo + (hi - lo) * (i + 1) // count) for i in range(count)]
    elif mode == 'bpm':
        bpm, beats = opts.get('bpm'), opts.get('beats')
        if type(bpm) not in (int, float) or not 40 <= bpm <= 300: raise ValueError('BPM must be 40 to 300')
        if beats not in BEATS: raise ValueError('Choose a slice length')
        size = max(2, int(round(60. / bpm * beats * rate)))
        bounds = [(a, min(hi, a + size)) for a in range(lo, hi, size)][:MAX_SLICES]
    elif mode == 'threshold':
        db, gap = opts.get('threshold'), opts.get('min_ms')
        if type(db) not in (int, float) or not -60 <= db <= -3: raise ValueError('Threshold must be -60 to -3 dB')
        if type(gap) not in (int, float) or not 10 <= gap <= 2000: raise ValueError('Minimum slice must be 10 to 2000 ms')
        bounds = detect_hits(env, lo // HOP, (hi + HOP - 1) // HOP, db, int(gap / 1000. * rate), rate)
        bounds = [(max(lo, a), min(hi, b)) for a, b in bounds][:MAX_SLICES]
        if not bounds: raise ValueError('Nothing rises above %d dB: lower the threshold' % db)
    elif mode == 'split':
        index, at = opts.get('index'), opts.get('at')
        if type(index) is not int or not 0 <= index < len(slices): raise ValueError('Choose a slice to split')
        if len(slices) >= MAX_SLICES: raise ValueError('A Sampler holds at most %d slices' % MAX_SLICES)
        a, b = slices[index][0], slices[index][1]
        if type(at) not in (int, float) or not a < at < b: raise ValueError('Tap inside the slice where it should split')
        cut = snap_zero(data, int(at * n), rate)
        if not int(a * n) < cut < int(b * n): cut = int(at * n)
        out = [list(s) for s in slices]; out[index:index+1] = [[a, cut / n], [cut / n, b]]
        return _clean(out)
    elif mode == 'join':
        index = opts.get('index')
        if type(index) is not int or not 0 <= index < len(slices) - 1: raise ValueError('Choose a slice that has one after it')
        out = [list(s) for s in slices]; out[index:index+2] = [[slices[index][0], slices[index+1][1]] + list(slices[index][2:3])]
        return out
    else:
        raise ValueError('Unknown chop mode')
    out = []
    for a, b in bounds:
        a = snap_zero(data, a, rate, back_only=mode == 'threshold')
        if out and a < out[-1][1] * n: a = int(round(out[-1][1] * n))
        if b - a >= 2: out.append([a / n, b / n])
    return _clean(out)


def _clean(slices):
    out = []
    for pair in slices:
        a = round(max(0., pair[0]), 7); b = round(min(1., pair[1]), 7)
        if out and a < out[-1][1]: a = out[-1][1]
        if b - a >= MIN_SLICE: out.append([a, b] + list(pair[2:3]))
    return out[:MAX_SLICES]


def slice_frames(data, pair):
    n = len(data)
    a = max(0, min(n - 2, int(pair[0] * n))); b = max(a + 2, min(n, int(round(pair[1] * n))))
    return a, b


def write_wav(path, data, rate):
    """Mono 24-bit PCM, with a 2 ms fade at both ends so pads never click."""
    n = len(data); fade = min(n // 2, max(1, int(rate * .002)))
    values = array('i', [max(-8388608, min(8388607, int(v * 8388607.))) << 8 for v in data])
    for i in range(fade):
        g = i / fade; values[i] = int(values[i] * g) & ~0xff; values[n-1-i] = int(values[n-1-i] * g) & ~0xff
    if values.itemsize != 4: raise ValueError('unsupported platform integer size')
    import sys
    if sys.byteorder != 'little': values.byteswap()
    wide = values.tobytes(); pcm = bytearray(n * 3)
    pcm[0::3] = wide[1::4]; pcm[1::3] = wide[2::4]; pcm[2::3] = wide[3::4]
    pad = b'\0' if len(pcm) & 1 else b''   # RIFF chunks are word aligned
    header = b'RIFF' + struct.pack('<I', 36 + len(pcm) + len(pad)) + b'WAVE' + b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 3, 3, 24)
    tmp = Path(str(path) + '.part')
    with open(tmp, 'wb') as handle:
        handle.write(header + b'data' + struct.pack('<I', len(pcm)) + bytes(pcm) + pad)
    os.replace(tmp, path)


def safe_name(name):
    clean = re.sub(r'[^A-Za-z0-9 _.-]+', '', name).strip(' .')[:40]
    return clean or 'Sampler'


def export_slices(directory, name, data, rate, slices, cache):
    """Write each slice as a WAV in its own new folder and load it. Returns (folder, [DecodedSample])."""
    if directory is None: raise ValueError('No data folder for chopped samples')
    stamp = time.strftime('%Y%m%d-%H%M%S')
    folder = Path(directory) / 'Samples' / 'Chops' / (safe_name(name) + ' ' + stamp)
    suffix = 2
    while folder.exists():
        folder = folder.with_name(safe_name(name) + ' ' + stamp + '-' + str(suffix)); suffix += 1
    folder.mkdir(parents=True)
    out = []
    for number, pair in slices:
        a, b = slice_frames(data, pair)
        path = folder / ('%02d %s.wav' % (number, safe_name(name)))
        write_wav(path, data[a:b], rate)
        out.append(cache.load(path))
    return folder, out


class SliceAudition:
    """Duck-types a DecodedSample for the engine's audition player (it plays up to 5 s)."""
    def __init__(self, data, rate):
        self.data = data; self.rate = rate; self.frames = len(data)


class Tasks:
    """One worker thread; results are applied by poll() on the audio worker, in order."""
    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='sampler-chop')
        self.jobs = []

    def submit(self, key, work, commit, fail=None, label=''):
        self.jobs.append((key, self.executor.submit(work), commit, fail, label))

    def busy(self, key):
        return any(job[0] == key and not job[1].done() for job in self.jobs)

    def poll(self):
        """Apply finished jobs. Returns what to tell the user: dict(message=...) or dict(error=...)."""
        out = []; keep = []
        for job in self.jobs:
            key, future, commit, fail, label = job
            if not future.done(): keep.append(job); continue
            try:
                note = commit(future.result())
                if note: out.append(dict(message=note))
            except Exception as exc:  # a failed job must never stop the audio worker
                if fail is not None: fail(exc)
                out.append(dict(error=label + str(exc)))
        self.jobs = keep
        return out

    def close(self):
        self.jobs = []
        self.executor.shutdown(wait=False, cancel_futures=True)
