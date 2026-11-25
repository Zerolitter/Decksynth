"""Ambient FX (25 Nov): Tape, Smear, Shimmer and Space. Pure Python checks of the native kernels (no numpy on the Deck)."""
import math
import re
import unittest
from pathlib import Path

from decksynth.fx import AMBIENT, ORDER, PARAMS, TrackFx, available, default_chain, validate_chain

R = 48000
BLOCK = 512
ROOT = Path(__file__).resolve().parents[1]


def tone(n, f=220., amp=.4, start=0):
    return [amp * math.sin(2 * math.pi * f * (i + start) / R) for i in range(n)]


def pad(n, amp=.25):
    """A soft three-note chord, the kind of input these effects are for."""
    return [amp * (math.sin(2 * math.pi * 220 * i / R) + .7 * math.sin(2 * math.pi * 277.18 * i / R)
                   + .5 * math.sin(2 * math.pi * 329.63 * i / R)) / 2.2 for i in range(n)]


def rms(x): return math.sqrt(sum(v * v for v in x) / max(1, len(x)))


def chain(mid, **params):
    c = default_chain()
    for m in c['modules']:
        if m['id'] == mid: m['on'] = True; m['params'].update(params)
    return validate_chain(c)


def render(fx, left, right=None):
    """Stereo render in engine-sized blocks; returns (left, right)."""
    out_l, out_r = [], []
    for i in range(0, len(left), BLOCK):
        a, b = fx.process_stereo(left[i:i + BLOCK], 120, 0, right=None if right is None else right[i:i + BLOCK])
        out_l += a; out_r += b
    return out_l, out_r


def make(mid, **params):
    fx = TrackFx(R); fx.configure(chain(mid, **params)); return fx


def goertzel(x, f):
    """Power of x at frequency f."""
    w = 2 * math.pi * f / R; c = 2 * math.cos(w); s1 = s2 = 0.
    for v in x: s1, s2 = v + c * s1 - s2, s1
    return (s1 * s1 + s2 * s2 - c * s1 * s2) / len(x) ** 2


def crossings(x):
    """Times (in samples) of the rising zero crossings, interpolated between samples."""
    out = []
    for i in range(1, len(x)):
        if x[i - 1] < 0 <= x[i]: out.append(i - 1 + -x[i - 1] / (x[i] - x[i - 1]))
    return out


class Model(unittest.TestCase):
    def test_four_new_effects_at_the_end_of_the_chain(self):
        self.assertEqual(ORDER[-4:], list(AMBIENT))
        self.assertEqual([k for k, *_ in PARAMS['tape']], ['wow', 'flutter', 'drive', 'age', 'hiss', 'mix', 'character'])
        self.assertEqual([k for k, *_ in PARAMS['space']][-1], 'freeze')

    def test_choices_are_whole_numbers(self):
        c = chain('shimmer', interval=1.6)
        self.assertEqual(next(m for m in c['modules'] if m['id'] == 'shimmer')['params']['interval'], 2.)
        c = chain('space', freeze=.7)
        self.assertEqual(next(m for m in c['modules'] if m['id'] == 'space')['params']['freeze'], 1.)

    def test_old_projects_get_them_switched_off(self):
        c = default_chain(); c['modules'] = [m for m in c['modules'] if m['id'] not in AMBIENT]
        out = validate_chain(c)
        self.assertEqual(sorted(m['id'] for m in out['modules']), sorted(ORDER))
        self.assertFalse(any(m['on'] for m in out['modules'] if m['id'] in AMBIENT))

    def test_ui_model_matches(self):
        """ui/src/fx.ts lists the same knobs in the same order as decksynth/fx.py."""
        ts = (ROOT / 'ui/src/fx.ts').read_text()
        for mid in AMBIENT:
            block = re.search(r'\n  ' + mid + r':\{name:(.*?)\]\},\n', ts, re.S).group(1)
            keys = [a or b or c for a, b, c in re.findall(r"key:'(\w+)'|\.\.\.(mix|width)\b|(?<=[,\[])(mix|width)(?=[,\]]|$)", block)]
            self.assertEqual(keys, [k for k, *_ in PARAMS[mid]], mid)


def presets():
    """Name and values of each ambient preset in ui/src/fx-presets.ts."""
    ts = (ROOT / 'ui/src/fx-presets.ts').read_text(); out = {}
    for mid in AMBIENT:
        block = re.search(r'\n  ' + mid + r': \[\n(.*?)\n  \],', ts, re.S).group(1)
        out[mid] = [(name, {k: float(v) for k, v in re.findall(r'(\w+): ([\d.]+)', body)})
                    for name, body in re.findall(r"P\('([^']+)', \{([^}]*)\}\)", block)]
    return out


@unittest.skipUnless(available(), 'native FX library not built')
class Sound(unittest.TestCase):
    def test_every_effect_is_finite_stereo_and_bounded(self):
        x = pad(R // 2) + [0.] * (R // 2)
        for mid in AMBIENT:
            with self.subTest(effect=mid):
                left, right = render(make(mid, mix=1), x)
                self.assertTrue(all(math.isfinite(v) for v in left + right))
                self.assertLess(max(map(abs, left + right)), 2.)
                self.assertGreater(max(abs(a - b) for a, b in zip(x, left)), 1e-3, 'it changes the sound')
                if mid != 'tape':
                    self.assertGreater(max(abs(a - b) for a, b in zip(left, right)), 1e-3, 'left and right differ')

    def test_mono_chain_works_too(self):
        for mid in AMBIENT:
            fx = make(mid, mix=1); out = []
            for i in range(0, R // 2, BLOCK): out += fx.process(pad(BLOCK), 120, 0)
            self.assertTrue(all(math.isfinite(v) for v in out), mid)
            self.assertGreater(rms(out), 1e-3, mid)

    def test_extreme_settings_stay_bounded(self):
        """Every knob at its top for 8 s of loud noise: no runaway, no NaN."""
        seed = 1; noise = []
        for _ in range(R * 8):
            seed = (seed * 1103515245 + 12345) & 0x7fffffff; noise.append(.9 * (seed / 0x7fffffff * 2 - 1))
        for mid in AMBIENT:
            with self.subTest(effect=mid):
                top = {k: hi for k, lo, hi, _ in PARAMS[mid] if k != 'freeze'}
                left, right = render(make(mid, **top), noise)
                self.assertTrue(all(math.isfinite(v) for v in left + right))
                self.assertLess(max(map(abs, left + right)), 3.5)

    def test_reverb_tails_ring_and_decay(self):
        for mid, params in (('space', dict(decay=3, mix=1)), ('shimmer', dict(decay=3, mix=1, shimmer=.3))):
            with self.subTest(effect=mid):
                fx = make(mid, **params)
                left, _ = render(fx, pad(R // 2) + [0.] * (R * 6))
                early, late = rms(left[R:R + R // 2]), rms(left[R * 6:R * 6 + R // 2])
                self.assertGreater(early, 1e-3, 'the tail rings after the sound stops')
                self.assertLess(late, early * .2, 'and dies away')
                self.assertEqual(fx.cleared, 0, 'a ringing tail is never cut off as silence')

    def test_space_freeze_holds_the_tail_for_30_seconds(self):
        fx = make('space', decay=4, size=.8, mix=1, mod=.5)
        render(fx, pad(R * 2))
        fx.configure(chain('space', decay=4, size=.8, mix=1, mod=.5, freeze=1))
        self.assertTrue(fx._hold)
        left, right = render(fx, [0.] * (R * 31))
        start, end = rms(left[R:R * 2]), rms(left[R * 30:R * 31])
        self.assertGreater(start, 1e-3)
        self.assertLess(abs(20 * math.log10(end / start)), 3, 'level after 30 s within 3 dB: %.4f -> %.4f' % (start, end))
        self.assertLess(max(map(abs, left + right)), 2.)
        self.assertEqual(fx._quiet, 0)
        # New notes still pass dry while frozen (mix below 1), and Freeze off lets the tail go.
        fx.configure(chain('space', decay=2, size=.8, mix=.5, mod=.5, freeze=1))
        dry, _ = render(fx, tone(R // 4, 1000, .3))
        self.assertGreater(goertzel(dry, 1000), 1e-4, 'the dry note is heard')
        fx.configure(chain('space', decay=2, size=.8, mix=1, mod=.5, freeze=0))
        self.assertFalse(fx._hold)
        gone, _ = render(fx, [0.] * (R * 8))
        self.assertLess(rms(gone[-R // 2:]), start * .05, 'unfrozen, the tail decays')

    def test_frozen_space_never_sleeps(self):
        fx = make('space', freeze=1, mix=1)
        self.assertTrue(fx._hold)
        render(fx, [0.] * (R * 6))
        self.assertTrue(fx.process([0.] * BLOCK, 120, 0) is not None)
        left, _ = render(fx, [0.] * BLOCK)
        self.assertTrue(fx._hold and fx.active)

    def test_shimmer_climbs_an_octave(self):
        sine = tone(R, 440, .3)

        def octave(amount):
            left, _ = render(make('shimmer', decay=6, shimmer=amount, tone=1, mix=1, interval=0), sine + [0.] * R)
            tail = left[R + R // 4:R + R // 4 + 8192]
            return goertzel(tail, 880) / max(1e-20, goertzel(tail, 440))

        with_shimmer, without = octave(1.), octave(0.)
        self.assertGreater(with_shimmer, .2, 'energy an octave up: %.3f' % with_shimmer)
        self.assertGreater(with_shimmer, 20 * without, 'and it comes from the shimmer: %.4f vs %.4f' % (with_shimmer, without))

    def test_tape_wow_moves_the_pitch(self):
        sine = tone(R * 4, 1000, .3)

        def spread(wow):
            left, _ = render(make('tape', wow=wow, flutter=0, drive=0, age=0, hiss=0, mix=1, character=2), sine)
            t = crossings(left[R // 2:])
            freqs = []
            for i in range(0, len(t) - 21, 20):
                freqs.append(20 * R / (t[i + 20] - t[i]))
            return (max(freqs) - min(freqs)) / 1000

        moving, still = spread(1.), spread(0.)
        self.assertGreater(moving, .004, 'wow bends the pitch: %.4f' % moving)
        self.assertLess(moving, .04, 'but stays tape-like: %.4f' % moving)
        self.assertLess(still, .0005, 'no wow, steady pitch: %.5f' % still)

    def test_tape_hiss_only_while_there_is_sound(self):
        fx = make('tape', hiss=1, mix=1)
        left, _ = render(fx, [0.] * (R // 2) + tone(R // 2, 300, .3) + [0.] * (R * 10))
        self.assertEqual(max(map(abs, left[:R // 2])), 0., 'silent before the sound')
        self.assertLess(max(map(abs, left[-R:])), 1e-6, 'and silent again once the sound has gone')

    def test_smear_spreads_a_click(self):
        at = R // 4  # after the 10 ms the effect takes to fade in
        click = [0.] * at + [.8] + [0.] * (R - at - 1)
        left, right = render(make('smear', size=.6, blur=.8, mix=1), click)
        energy = [v * v for v in left]
        total = sum(energy)
        first = sum(energy[:at + int(.002 * R)])
        self.assertGreater(total, .01)
        self.assertLess(first / total, .5, 'most of the click arrives later: %.2f' % (first / total))
        spread = sum(energy[at + int(.02 * R):]) / total
        self.assertGreater(spread, .2, 'and keeps arriving after 20 ms: %.2f' % spread)

    def test_every_preset_loads_and_renders(self):
        found = presets()
        for mid in AMBIENT:
            self.assertEqual(len(found[mid]), 6, mid + ' has six presets')
            for name, values in found[mid]:
                with self.subTest(effect=mid, preset=name):
                    self.assertTrue(set(values) <= {k for k, *_ in PARAMS[mid]}, values)
                    left, right = render(make(mid, **values), pad(R // 4) + [0.] * (R // 4))
                    self.assertTrue(all(math.isfinite(v) for v in left + right))
                    self.assertLess(max(map(abs, left + right)), 2.)
                    self.assertGreater(rms(left), 1e-3)


if __name__ == '__main__':
    unittest.main()
