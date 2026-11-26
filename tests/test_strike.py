import ctypes
import math
import unittest

from decksynth import strike
from decksynth.core import Synth, instrument, validate_instrument

R = 48000


def play(p, note=48, secs=1.2, block=256, velocity=110):
    s = Synth(R); s.configure(p); s.on(note, velocity); out = []
    for _ in range(int(secs * R / block)): out += s.render(block)
    return out


def centroid(x, f0, K=12):
    """Amplitude-weighted mean partial number of x at the note's harmonics."""
    amps = []
    for k in range(1, K + 1):
        w = 2 * math.pi * k * f0 / R
        amps.append(math.hypot(sum(v * math.cos(w * i) for i, v in enumerate(x)), sum(v * math.sin(w * i) for i, v in enumerate(x))))
    return sum(k * a for k, a in enumerate(amps, 1)) / max(1e-12, sum(amps))


def crossings(x):return sum(1 for a, b in zip(x, x[1:]) if (a < 0) != (b < 0))


def rms(x):return math.sqrt(sum(v * v for v in x) / max(1, len(x)))


def saw():
    p = dict(instrument('Warm Keys')); p.update(harmonics=[1 / (k + 1) for k in range(16)], filter=1.); return p


class StrikeTest(unittest.TestCase):
    def test_zero_is_the_old_sound(self):
        p = saw()
        self.assertEqual(play(p, secs=.3), play(dict(p, damp=0., noise=0., pitch_env=0., noise_decay=.2, pitch_decay=.3), secs=.3))

    def test_damping_lets_the_top_die_first(self):
        p = saw(); f0 = 440 * 2 ** ((48 - 69) / 12)
        plain, damped = play(p), play(dict(p, damp=.7))
        early, late = centroid(damped[2400:7200], f0), centroid(damped[48000:52800], f0)
        self.assertLess(late, early * .7)
        self.assertAlmostEqual(centroid(plain[48000:52800], f0), centroid(plain[2400:7200], f0), delta=.1)
        # the fundamental stays: the level after a second is not far below the plain voice
        self.assertGreater(rms(damped[48000:52800]), rms(plain[48000:52800]) * .5)

    def test_damping_also_on_the_filter_card_path(self):
        p = dict(saw(), vcf_type=1, vcf_cutoff=1., vcf_env=0., fenv_a=.001, fenv_d=.5, fenv_s=1., fenv_r=.3)
        f0 = 440 * 2 ** ((48 - 69) / 12); x = play(dict(p, damp=.7))
        self.assertLess(centroid(x[48000:52800], f0), centroid(x[2400:7200], f0) * .7)

    def test_noise_is_a_short_burst(self):
        p = saw(); plain, hit = play(p, secs=.6), play(dict(p, noise=.8, noise_decay=.02), secs=.6)
        self.assertGreater(crossings(hit[:960]), crossings(plain[:960]) * 3)
        self.assertEqual(hit[24000:], plain[24000:])

    def test_pitch_envelope_starts_high_and_settles(self):
        p = dict(saw(), harmonics=[1.] + [0.] * 15)
        plain, drop = play(p, secs=.8), play(dict(p, pitch_env=12., pitch_decay=.04), secs=.8)
        self.assertGreater(crossings(drop[:1440]), crossings(plain[:1440]) * 1.5)
        self.assertAlmostEqual(crossings(drop[28800:38400]), crossings(plain[28800:38400]), delta=2)
        self.assertTrue(all(math.isfinite(v) for v in drop))

    def test_native_matches_the_python_twin(self):
        k = strike.kernel()
        if k is None:self.skipTest('native library not built')
        src = [math.sin(i * .05) * .3 for i in range(700)]
        e = strike.settings(dict(saw(), damp=.8, noise=.7), 60, .2, R)
        a = (ctypes.c_double * 700)(); b = [0.] * 700
        sa = strike.initial_state(0); sb = strike.initial_state(0)
        st = (ctypes.c_double * strike.STATE)(*sa); k(a, (ctypes.c_double * 700)(*src), 700, st, ctypes.byref(e))
        strike.strike_py(b, src, 700, sb, e)
        self.assertLess(max(abs(x - y) for x, y in zip(a, b)), 1e-12)
        self.assertLess(max(abs(x - y) for x, y in zip(st, sb)), 1e-9)

    def test_one_call_pitch_kernels_match_the_slices(self):
        """The pitch envelope in one C call per voice (dsfx_voice*_pitch) sounds exactly like a call per 32-sample slice."""
        from decksynth import core, fx
        if fx.native_pitch('dsfx_voice_pitch') is None:self.skipTest('native library not built')
        base = dict(saw(), pitch_env=1.7, pitch_decay=.1, damp=.715)
        cases = {'plain': {}, 'curve': dict(env_curve=.75), 'unison': dict(uni_voices=3),
                 'filter': dict(vcf_type=1, sub=.6, env_curve=.75), 'falling': dict(pitch_env=-8.1, pitch_decay=1.)}
        def chord(p):
            s = Synth(R); s.configure(p); out = []
            for i in range(60):
                if i % 6 == 0:s.on(48 + (i // 6) % 5 * 3, 100)
                if i % 6 == 4:s.off(48 + (i // 6) % 5 * 3)
                out += s.render(256 if i % 7 else 100)
            return out
        for name, extra in cases.items():
            p = dict(base, **extra)
            one = chord(p)
            saved = core.native_pitch, core.native_filter_voice_pitch
            core.native_pitch = lambda name: None; core.native_filter_voice_pitch = lambda: None
            try:sliced = chord(p)
            finally:core.native_pitch, core.native_filter_voice_pitch = saved
            self.assertEqual(one, sliced, name)

    def test_ranges(self):
        validate_instrument(dict(saw(), damp=1., noise=1., noise_decay=.002, noise_tone=0., pitch_env=-24., pitch_decay=1.))
        for bad in (dict(damp=1.5), dict(pitch_env=30.), dict(noise_decay=0.)):
            with self.assertRaises(AssertionError):validate_instrument(dict(saw(), **bad))


if __name__ == '__main__':
    unittest.main()
