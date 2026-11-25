"""Full sound (17 Nov): curved envelopes, Air, Drift, Dynamics, the velocity tilt, the master stage and the
150 factory presets."""
import math
import unittest
from unittest.mock import patch

from decksynth import core, fx
from decksynth.core import Engine, Synth, instrument, validate_instrument
from decksynth.library import CATEGORIES, PRESET_LIBRARY, LEVELS

R = 48000


def play(params, frames=R // 2, note=60, velocity=100, release_at=None):
    s = Synth(R); s.configure(params); s.on(note, velocity)
    out = []
    while len(out) < frames:
        if release_at is not None and len(out) >= release_at and s.voices.get(note, {}).get('release') is None:
            s.off(note)
        out.extend(s.render(256))
    return out[:frames]


def rms(xs):
    return math.sqrt(sum(x * x for x in xs) / max(1, len(xs)))


class VoiceTests(unittest.TestCase):
    def test_neutral_keys_change_nothing(self):
        base = instrument('Warm Keys')
        same = dict(base, env_curve=0., air=0., drift=0., vel_curve=0., gain=1.)
        self.assertEqual(play(base), play(same))

    def test_curve_fades_evenly_to_the_ear(self):
        p = dict(instrument('Warm Keys'), sustain=0., decay=1.)
        straight, curved = play(p, R), play(dict(p, env_curve=.8), R)
        db = lambda xs, a, b: 20 * math.log10(rms(xs[int(R * a):int(R * b)]))
        # straight: it holds loud and then drops at the end (the last tenth falls far more than the first)
        self.assertGreater((db(straight, .6, .7) - db(straight, .85, .95)), 2 * (db(straight, .05, .15) - db(straight, .3, .4)) / 2.5)
        # curved: about the same number of dB per tenth all the way, like a struck string
        first, last = db(curved, .05, .15) - db(curved, .3, .4), db(curved, .6, .7) - db(curved, .85, .95)
        self.assertLess(abs(first - last), .35 * max(first, last))
        self.assertLess(rms(curved[R // 10:R // 5]), rms(straight[R // 10:R // 5]))

    def test_curve_matches_python_fallback(self):
        p = dict(instrument('Warm Keys'), env_curve=.7, sustain=.2, decay=.3, release=.2)
        if fx.native_voice_curve() is None:
            self.skipTest('native voice not built')
        native = play(p, R // 2, release_at=R // 4)
        with patch.object(core, 'native_voice', return_value=None):
            python = play(p, R // 2, release_at=R // 4)
        self.assertLess(max(abs(a - b) for a, b in zip(native, python)), 1e-6)

    def test_release_with_curve_ends(self):
        s = Synth(R); s.configure(dict(instrument('Warm Keys'), env_curve=1., release=.1)); s.on(60, 100); s.render(2048)
        s.off(60)
        for _ in range(30): s.render(256)
        self.assertEqual(s.voices, {})

    def test_air_adds_partials_past_16_on_low_notes(self):
        s = Synth(R); s.configure(dict(instrument('Bass'), harmonics=[1 / (k + 1) for k in range(16)], air=.8))
        plain = Synth(R); plain.configure(dict(instrument('Bass'), harmonics=[1 / (k + 1) for k in range(16)]))
        def top(table):  # energy above partial 16 by a quick DFT of three bins
            return sum(abs(sum(table[i] * math.sin(2 * math.pi * k * i / 2048) for i in range(0, 2048, 2))) for k in (20, 24, 30))
        self.assertGreater(top(s.table(36)), 10 * top(plain.table(36)) + 1e-6)

    def test_drift_is_small_and_repeatable(self):
        p = dict(instrument('Warm Keys'), drift=1.)
        a, b = Synth(R), Synth(R)
        for s in (a, b):
            s.configure(p)
            for n in (60, 64, 67): s.on(n, 100)
        self.assertEqual([v['phase'] for v in a.voices.values()], [v['phase'] for v in b.voices.values()])
        for v in a.voices.values():
            self.assertLess(abs(1200 * math.log2(v['drift'])), 6.01)

    def test_dynamics_widens_the_range(self):
        p = instrument('Warm Keys')
        lin = rms(play(p, velocity=120)) / rms(play(p, velocity=40))
        curved = rms(play(dict(p, vel_curve=1.), velocity=120)) / rms(play(dict(p, vel_curve=1.), velocity=40))
        self.assertGreater(20 * math.log10(curved), 20 * math.log10(lin) + 6)

    def test_vel_bright_tilts_hard_notes_brighter(self):
        p = dict(instrument('Warm Keys'), velocity_brightness=.6)
        s = Synth(R); s.configure(p)
        soft, hard = s.table(60, 40 / 127), s.table(60, 120 / 127)
        def ratio(t):  # 4th harmonic against the fundamental
            f = lambda k: abs(sum(t[i] * math.sin(2 * math.pi * k * i / 2048) for i in range(0, 2048, 2)))
            return f(4) / f(1)
        self.assertGreater(ratio(hard), 1.5 * ratio(soft))


class MasterTests(unittest.TestCase):
    def setUp(self):
        self.m = fx.MasterStage(R)
        if not self.m.available:
            self.skipTest('native master stage not built')

    def test_ceiling_and_silence(self):
        loud = [1.5 * math.sin(i * .03) for i in range(256)]
        peak = 0.
        for _ in range(20):
            peak = max(peak, max(map(abs, self.m.process(loud, loud))))
        self.assertLessEqual(peak, 10 ** (-1 / 20) + 1e-12)
        self.assertGreater(peak, .85)
        for _ in range(200):
            out = self.m.process([0.] * 256, [0.] * 256)
        self.assertEqual(max(map(abs, out)), 0.)

    def test_quiet_sound_passes_with_the_makeup_gain(self):
        x = [.01 * math.sin(i * .05) for i in range(256)]
        out = []
        for _ in range(8):
            out = self.m.process(x, x)
        self.assertAlmostEqual(rms(out[0::2]) / rms(x), fx.MasterStage.TRIM, delta=.15)

    def test_engine_output_stays_under_the_ceiling(self):
        e = Engine(R)
        for t in range(4):
            for n in range(40, 70, 2): e.voice_on(t, n, 127, ('load', t, n))
        a = e.render_stereo(R // 2)
        self.assertLessEqual(max(map(abs, a)), 10 ** (-1 / 20) + 1e-12)


class LibraryTests(unittest.TestCase):
    def test_fifteen_per_category_all_valid(self):
        self.assertEqual(len(PRESET_LIBRARY), 15 * len(CATEGORIES) + 6)   # + the six 808 / kick presets in Bass
        self.assertEqual(len({p['name'] for p in PRESET_LIBRARY}), len(PRESET_LIBRARY))
        for c in CATEGORIES:
            self.assertEqual(sum(p['category'] == c for p in PRESET_LIBRARY), 21 if c == 'Bass' else 15, c)
        for p in PRESET_LIBRARY:
            validate_instrument(p['instrument'])
            fx.validate_chain(p['fx'])
            self.assertNotIn('voice', p)

    def test_every_preset_is_level_matched_and_finished(self):
        for p in PRESET_LIBRARY:
            self.assertIn(p['name'], LEVELS)
            ins = p['instrument']
            self.assertTrue(.25 <= ins['gain'] <= 8, p['name'])
            self.assertGreater(ins['env_curve'], 0, p['name'])
            on = [m['id'] for m in p['fx']['modules'] if m['on']]
            if p['category'] != 'Bass':
                self.assertIn('chorus', on, p['name'])  # every non-bass preset is stereo
            # the finish comes before the time effects
            for late in ('delay', 'reverb'):
                if late in on and 'chorus' in on:
                    self.assertLess(on.index('chorus'), on.index(late), p['name'])


if __name__ == '__main__':
    unittest.main()
