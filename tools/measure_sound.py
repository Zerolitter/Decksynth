#!/usr/bin/env python3
"""Measure how full the synth presets sound: level, width, velocity response and movement.

    python3 tools/measure_sound.py [--category=Pads] [--preset=NAME] [--csv=out.csv]
    python3 tools/measure_sound.py --calibrate     print LEVELS for decksynth/library.py

--calibrate plays the chord with each preset's own level set to 1 and the master stage off, and prints the
level (instrument 'gain') that puts the loudest 50 ms of the chord at TARGET dBFS RMS before the master stage.

For every factory preset (or the ones picked) it plays a chord (C3 C4 E4 G4) at velocity 100 for
1.5 s and lets it ring 1 s, then one note (C4) soft (40) and hard (120). Reported per preset:

  peak     loudest sample of the chord, dBFS
  rms      average level while the chord is held, dBFS
  width    side / mid level (0 = mono, 0.3+ = clearly wide)
  bright   spectral centre estimate in Hz (from the slope of the wave; a rough guide, not an FFT)
  vel dB   how much louder the hard note is than the soft one
  vel tone how much brighter the hard note is (ratio of the brightness estimates)
  motion   how much the tone and level move while the chord is held (0 = static)

No numpy needed: everything is plain Python so it runs on the Deck as is.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from decksynth.core import Engine  # noqa: E402
from decksynth.library import PRESET_LIBRARY  # noqa: E402

R = 48000
BLOCK = 256


def db(x):
    return 20 * math.log10(max(x, 1e-9))


def render(e, seconds):
    out = []
    for _ in range(int(seconds * R / BLOCK)):
        out.extend(e.render_stereo(BLOCK))
    return out[0::2], out[1::2]


def rms(xs):
    return math.sqrt(sum(x * x for x in xs) / max(1, len(xs)))


def bright(xs):
    """Spectral centre estimate: rms of the first difference against the rms of the signal."""
    a = rms(xs)
    if a < 1e-7:
        return 0.
    d = rms([b - c for b, c in zip(xs[1:], xs)])
    return R / (2 * math.pi) * 2 * math.asin(min(1., d / (2 * a)))


def fresh(name):
    e = Engine(R)
    e.select(0)
    e.apply_preset(name)
    e.render_stereo(BLOCK)
    return e


TARGET = -23.
# Small per-category nudges on top of the target, by ear: a bass and a lead sit a little forward, pads behind.
NUDGE = {'Bass': 1.5, 'Leads': 1., 'Pads': -1., 'Textures & drones': -1.5, 'FX & risers': -1.}


def calibrate(p):
    e = Engine(R)
    e.master_enabled = False
    e.select(0)
    e.apply_preset(p['name'])
    e.project.tracks[0]['instrument']['gain'] = 1.
    e.configure()
    notes = (48, 60, 64, 67)
    for n in notes:
        e.voice_on(0, n, 100, ('measure', n))
    left, right = render(e, 1.5)
    mid = [(a + b) * .5 for a, b in zip(left, right)]
    # momentary loudness: the loudest 50 ms, so a pluck counts by its strike and a pad by its body
    level = max(db(rms(mid[i:i + 2400])) for i in range(0, len(mid) - 2400, 1200))
    want = TARGET + NUDGE.get(p['category'], 0.)
    return round(min(8., max(.25, 10 ** ((want - level) / 20))), 2), level


def chord_scene(name):
    e = fresh(name)
    notes = (48, 60, 64, 67)
    for n in notes:
        e.voice_on(0, n, 100, ('measure', n))
    hold_l, hold_r = render(e, 1.5)
    for n in notes:
        e.voice_off(0, n, ('measure', n))
    tail_l, tail_r = render(e, 1.0)
    left, right = hold_l + tail_l, hold_r + tail_r
    peak = max(max(map(abs, left)), max(map(abs, right)))
    body_l, body_r = hold_l[R // 4:], hold_r[R // 4:]
    mid = [(a + b) * .5 for a, b in zip(body_l, body_r)]
    side = [(a - b) * .5 for a, b in zip(body_l, body_r)]
    win = R // 20
    levels, tones = [], []
    for i in range(0, len(mid) - win, win):
        part = mid[i:i + win]
        levels.append(db(rms(part)))
        tones.append(bright(part))
    def spread(xs):
        if not xs:
            return 0.
        m = sum(xs) / len(xs)
        return math.sqrt(sum((x - m) ** 2 for x in xs) / len(xs))
    t_mean = sum(tones) / max(1, len(tones))
    motion = spread(levels) / 6 + (spread(tones) / t_mean if t_mean else 0)
    return dict(peak=db(peak), rms=db(rms(mid)), width=rms(side) / max(1e-9, rms(mid)), bright=bright(mid), motion=motion)


def velocity_scene(name):
    res = {}
    for vel in (40, 120):
        e = fresh(name)
        e.voice_on(0, 60, vel, ('measure', 60))
        left, right = render(e, .6)
        mid = [(a + b) * .5 for a, b in zip(left, right)][R // 50:]
        res[vel] = (rms(mid), bright(mid))
    lo, hi = res[40], res[120]
    return dict(vel_db=db(hi[0]) - db(lo[0]), vel_tone=(hi[1] / lo[1]) if lo[1] else 0.)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--category')
    ap.add_argument('--preset', action='append')
    ap.add_argument('--csv')
    ap.add_argument('--calibrate', action='store_true')
    args = ap.parse_args()
    if args.calibrate:
        print('LEVELS = {')
        for p in PRESET_LIBRARY:
            gain, level = calibrate(p)
            print('    %r: %s,  # %.1f dB' % (p['name'], gain, level), flush=True)
        print('}')
        return
    rows = []
    for p in PRESET_LIBRARY:
        if args.category and p['category'] != args.category:
            continue
        if args.preset and p['name'] not in args.preset:
            continue
        m = dict(name=p['name'], category=p['category'], **chord_scene(p['name']), **velocity_scene(p['name']))
        rows.append(m)
        print('%-22s %-18s peak %6.1f  rms %6.1f  width %4.2f  bright %5.0f  vel %5.1f dB x%4.2f  motion %4.2f' % (
            m['name'][:22], m['category'][:18], m['peak'], m['rms'], m['width'], m['bright'], m['vel_db'], m['vel_tone'], m['motion']),
            flush=True)
    if rows:
        n = len(rows)
        avg = {k: sum(r[k] for r in rows) / n for k in ('peak', 'rms', 'width', 'bright', 'vel_db', 'vel_tone', 'motion')}
        print('%-41s peak %6.1f  rms %6.1f  width %4.2f  bright %5.0f  vel %5.1f dB x%4.2f  motion %4.2f' % (
            'AVERAGE (%d presets)' % n, avg['peak'], avg['rms'], avg['width'], avg['bright'], avg['vel_db'], avg['vel_tone'], avg['motion']))
    if args.csv:
        keys = ['name', 'category', 'peak', 'rms', 'width', 'bright', 'vel_db', 'vel_tone', 'motion']
        with open(args.csv, 'w') as f:
            f.write(','.join(keys) + '\n')
            for r in rows:
                f.write(','.join(str(round(r[k], 3)) if isinstance(r[k], float) else str(r[k]) for k in keys) + '\n')


if __name__ == '__main__':
    main()
