"""Sampler filter batch (25 Nov): filter envelope Hold / Sustain / Release, a 24 dB low-pass, velocity to the amp
attack and to the filter envelope's amount, Glide Always, and a Sampler Pan that macros and mod pads can move."""
import ctypes
import math
import unittest

from decksynth.sampler import mix_python, validate_sampler, new_sampler
from tests import test_sampler as base
from tests.test_sampler import R


def cutoff_of(s, v):
    """The cutoff (Hz) the voice's filter coefficients hold: g = a2 / a1 = tan(pi fc / rate)."""
    return math.atan(v.a2/v.a1)*s.rate/math.pi


def at_age(s, seconds):
    for v in s.voices:
        if v.active: v.age = round(seconds*s.rate)
    s._modulate()
    return next(v for v in s.voices if v.active)


def rms(x):
    return math.sqrt(sum(a*a for a in x)/max(1, len(x)))


class SpecTest(unittest.TestCase):
    def test_new_keys_have_defaults_and_ranges(self):
        s = new_sampler()
        self.assertEqual((s['f_hold'], s['f_sustain'], s['f_release'], s['f_env_vel'], s['vel_attack'], s['glide_mode'], s['pan']),
                         (0., 0., .3, 0., 0., 'legato', 0.))
        for key, bad in (('glide_mode', 'sometimes'), ('filter', 'lp48'), ('pan', 1.5), ('f_sustain', 2.), ('f_hold', -1.)):
            with self.assertRaises(ValueError, msg=key): validate_sampler(dict(s, **{key: bad}))
        self.assertEqual(validate_sampler(dict(s, filter='lp24'))['filter'], 'lp24')

    def test_older_projects_release_the_filter_as_they_decayed(self):
        old = {k: v for k, v in new_sampler().items() if k not in ('f_hold', 'f_sustain', 'f_release', 'f_env_vel', 'vel_attack', 'glide_mode', 'pan')}
        old['f_decay'] = 1.7
        s = validate_sampler(old)
        self.assertEqual(s['f_release'], 1.7); self.assertEqual(s['f_sustain'], 0.); self.assertEqual(s['f_hold'], 0.)


class FilterBatchTest(unittest.TestCase):
    setUp = base.SamplerTest.setUp; tearDown = base.SamplerTest.tearDown   # the Sampler test's track, not its tests
    make = base.SamplerTest.make; play = base.SamplerTest.play; render = base.SamplerTest.render
    def test_filter_envelope_holds_sustains_and_releases(self):
        self.make(filter='lp', cutoff=100., f_env=1., f_attack=0., f_hold=.5, f_decay=.2, f_sustain=.5, f_release=.4, release=2.)
        s, _ = self.play(1, 60, 256)
        self.assertAlmostEqual(cutoff_of(s, at_age(s, .3)), 100*2**5, delta=40, msg='Hold keeps the envelope at the top')
        self.assertAlmostEqual(cutoff_of(s, at_age(s, 3.)), 100*2**2.5, delta=10, msg='it settles at Sustain while the key is held')
        self.e.voice_off(1, 60, ('live', 0, 0, 0))
        at_age(s, 3.)
        self.assertAlmostEqual(cutoff_of(s, at_age(s, 3.)), 100*2**2.5, delta=10, msg='Release starts where the envelope was')
        self.assertAlmostEqual(cutoff_of(s, at_age(s, 3.4)), 100*2**(2.5*.01), delta=5, msg='and falls over the Release time')

    def test_old_filter_envelope_is_unchanged(self):
        """Hold 0, Sustain 0, Release = Decay: the same curve as before Hold / Sustain / Release."""
        self.make(filter='lp', cutoff=200., f_env=.8, f_attack=.1, f_decay=.5, f_release=.5, f_hold=0., f_sustain=0.)
        s, _ = self.play(1, 60, 256)
        for t in (.05, .1, .3, .9):
            fe = t/.1 if t < .1 else math.exp(-(t-.1)*4.6/.5)
            want = min(.45*R, max(20., 200*2**(.8*5*fe)))
            self.assertAlmostEqual(cutoff_of(s, at_age(s, t)), want, delta=want*1e-6, msg=t)
        self.e.voice_off(1, 60, ('live', 0, 0, 0)); at_age(s, .3)
        fe = math.exp(-(.6-.1)*4.6/.5)
        self.assertAlmostEqual(cutoff_of(s, at_age(s, .6)), 200*2**(.8*5*fe), delta=1., msg='after the key, it keeps falling at the same rate')

    def test_24_db_rolls_off_two_octaves_up(self):
        """Magnitude at 4x the cutoff: about -24 dB for 12 dB/oct, about -48 dB for the 24 dB low-pass."""
        self.make(filter='lp24', cutoff=480./4, resonance=0.)   # the test tone is 480 Hz
        _, x24 = self.play(1, 60, R//2); self.e.samplers[1].panic()
        self.make(filter='lp', cutoff=480./4, resonance=0.)
        _, x12 = self.play(1, 60, R//2); self.e.samplers[1].panic()
        self.make(filter='off')
        _, dry = self.play(1, 60, R//2)
        db = lambda x: 20*math.log10(rms(x[R//8:R*3//8])/rms(dry[R//8:R*3//8]))
        self.assertAlmostEqual(db(x12), -24., delta=3.)
        self.assertAlmostEqual(db(x24), -48., delta=4.)

    def test_native_and_python_24_db_and_velocity_attack_match(self):
        self.make(mode='loop', loop_start=.3, loop_end=.6, attack=.05, vel_attack=1., filter='lp24', cutoff=900., resonance=.7)
        s = self.e.samplers[1]
        if s._kernel is None: self.skipTest('no native Sampler library here')
        s.on(60, 40, 'a'); s.on(67, 120, 'b'); s._modulate()
        twin = (type(s.voices[0]) * len(s.voices))()
        ctypes.memmove(twin, s.voices, ctypes.sizeof(s.voices))
        native = [0.]*256; s.scratch[:256] = [0.]*256; s._kernel(s.voices, len(s.voices), ctypes.byref(s.params), s.scratch, None, 256)
        native = list(s.scratch[:256])
        python = [0.]*256; mix_python(twin, s.params, s.sample.data, python, 256)
        self.assertGreater(max(map(abs, python)), 1e-4)
        self.assertLess(max(abs(a-b) for a, b in zip(native, python)), 1e-9)

    def test_velocity_shortens_or_lengthens_the_attack(self):
        self.make(attack=.1, vel_attack=1.)
        s = self.e.samplers[1]
        def env_after(velocity, frames):
            s.panic(); s.on(60, velocity, 'x'); out = [0.]*frames; s.render_into(out, frames)
            return next(v for v in s.voices if v.active).env
        hard, mid, soft = env_after(127, 1200), env_after(64, 1200), env_after(1, 1200)
        self.assertAlmostEqual(hard, 1., places=6, msg='full velocity: 4x faster, at the top in 25 ms')
        self.assertAlmostEqual(mid, 1200/(.1*R), delta=.01, msg='the middle keeps the knob time')
        self.assertLess(soft, mid*.3)
        self.make(attack=.1, vel_attack=0.)
        self.assertAlmostEqual(env_after(127, 1200), env_after(1, 1200), places=9, msg='off: every velocity the same')

    def test_velocity_scales_the_filter_envelope(self):
        self.make(filter='lp', cutoff=100., f_env=1., f_decay=3., f_env_vel=1.)
        s = self.e.samplers[1]
        s.on(60, 127, 'a'); loud = cutoff_of(s, at_age(s, 0.)); s.panic()
        s.on(60, 32, 'b'); soft = cutoff_of(s, at_age(s, 0.)); s.panic()
        self.assertAlmostEqual(loud, 100*2**5, delta=30)
        self.assertAlmostEqual(math.log2(soft/100), 5*32/127, delta=.05)

    def test_glide_always_slides_from_the_last_note(self):
        made = self.make(poly=False, glide=.1, release=.01)
        s = self.e.samplers[1]
        self.play(1, 60, 256); self.e.voice_off(1, 60, ('live', 0, 0, 0)); self.render(R//10)
        self.assertEqual(s.active_count, 0)
        self.e.voice_on(1, 72, 127, ('live', 0, 1, 1)); self.render(256)
        v = next(v for v in s.voices if v.active)
        self.assertAlmostEqual(v.step, 2., places=9, msg='Legato: a new phrase starts on its own pitch')
        self.e.edit_sampler(1, made['id'], 'glide_mode', 'always')
        self.e.voice_off(1, 72, ('live', 0, 1, 1)); self.render(R//10)
        self.e.voice_on(1, 60, 127, ('live', 0, 2, 2)); self.render(R//20)
        v = next(v for v in s.voices if v.active)
        self.assertTrue(1.2 < v.step < 1.8, v.step)
        self.render(R//10); self.assertAlmostEqual(v.step, 1., places=6)

    def test_pan_knob_and_link_move_the_sampler(self):
        from decksynth.fx import default_chain
        made = self.make(release=.01)
        def sides():
            self.e.samplers[1].panic(); self.e.render_stereo(4096)
            self.e.voice_on(1, 60, 127, ('live', 0, 0, 0)); x = self.e.render_stereo(R//8)
            self.e.voice_off(1, 60, ('live', 0, 0, 0)); self.e.render_stereo(R//8)
            return rms(x[0::2][R//40:]), rms(x[1::2][R//40:])
        left, right = sides(); self.assertAlmostEqual(left/right, 1., delta=.05)
        self.e.edit_sampler(1, made['id'], 'pan', -1.)
        left, right = sides(); self.assertLess(right, left*.01)
        self.e.edit_sampler(1, made['id'], 'pan', 0.)
        c = default_chain(); c['macros'][0]['value'] = 1.; c['macros'][0]['targets'] = [dict(module='sampler', param='pan', depth=.5)]
        self.e.set_fx(1, c)
        left, right = sides(); self.assertLess(left, right*.01, 'a macro moves the Sampler pan')


if __name__ == '__main__': unittest.main()
