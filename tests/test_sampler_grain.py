"""Grain mode of the Sampler (24 Nov): every held key plays a cloud of short grains."""
import ctypes
import math
import unittest

from decksynth.sampler import validate_sampler, new_sampler
from decksynth import sampler_grain as grain
from tests import test_sampler as base
from tests.test_sampler import R, crossings


class GrainTest(unittest.TestCase):
    # the Sampler tests' helpers, without running those tests twice
    setUp = base.SamplerTest.setUp; tearDown = base.SamplerTest.tearDown
    make = base.SamplerTest.make; play = base.SamplerTest.play; render = base.SamplerTest.render

    def grain(self, **edits):
        return self.make(mode='grain', **edits)

    def test_old_projects_get_the_grain_defaults_and_bad_values_are_refused(self):
        s = new_sampler(); s.pop('g_size'); s.pop('g_window')
        clean = validate_sampler(s)
        self.assertEqual(clean['g_size'], grain.DEFAULTS['g_size']); self.assertEqual(clean['g_window'], 'hann')
        for key, bad in (('g_density', 0.), ('g_size', 5.), ('g_window', 'square'), ('g_scale', 'dorian'), ('mode', 'granular')):
            with self.assertRaises(ValueError, msg=key): validate_sampler(dict(clean, **{key: bad}))
        self.assertEqual(validate_sampler(dict(clean, mode='grain'))['mode'], 'grain')

    def test_a_held_key_keeps_a_cloud_going_at_its_pitch(self):
        self.grain(g_size=.08, g_density=30., g_spray=0., g_pos=.5)
        s, out = self.play(1, 60, R)          # the sample is only 0.5 s long; the cloud keeps going
        tail = out[-R//4:]
        self.assertGreater(max(map(abs, tail)), .05)
        self.assertGreater(len(s.state()['grains']), 0)
        self.assertAlmostEqual(crossings(tail)/(len(tail)/R), 480., delta=25)
        s.panic(); _, up = self.play(1, 72, R//2)
        tail = up[-R//4:]
        self.assertAlmostEqual(crossings(tail)/(len(tail)/R), 960., delta=50)

    def test_release_ends_the_cloud_and_its_grains(self):
        self.grain(release=.02)
        s, _ = self.play(1, 60, R//10)
        self.e.voice_off(1, 60, ('live', 0, 0, 0)); out = self.render(R//5)
        self.assertLess(max(map(abs, out[-2400:])), 1e-9)
        self.assertEqual(s.active_count, 0)
        self.assertFalse(any(g.active for g in s.grains))

    def test_short_sparse_grains_do_not_pile_up(self):
        self.grain(g_size=.02, g_density=20.)
        s, _ = self.play(1, 60, 256)
        self.render(R - 256)
        started = s.events  # notes, not grains; count grains through the clouds' random state instead
        seen = sum(1 for g in s.grains if g.active)
        self.assertLessEqual(seen, 3)   # 20 a second, 20 ms each: rarely more than one at a time
        self.assertTrue(started)

    def test_level_stays_near_one_voice_when_grains_pile_up(self):
        self.grain(g_size=.5, g_density=80., g_spray=.5)
        _, out = self.play(1, 60, R)
        self.assertLess(max(map(abs, out)), 1.5)

    def test_scan_moves_the_read_point(self):
        made = self.grain(g_scan=1., g_pos=0.)
        s, _ = self.play(1, 60, R//10)
        first = s.state()['playing'][0]; self.render(R//10)
        self.assertGreater(s.state()['playing'][0], first)

    def test_native_and_python_grains_match(self):
        self.grain(g_spread=7., g_scale='minor', g_reverse=.5, g_jitter=.6, g_size_rnd=.8, g_amp_rnd=.5, g_window='perc',
                   g_spray=.3, g_scan=.5, filter='lp', cutoff=3000., attack=.01, release=.02)
        s = self.e.samplers[1]
        if s._grain_kernel is None: self.skipTest('no native grain kernel here')
        s.on(60, 100, 'a'); s.on(67, 90, 'b')
        voices = (type(s.voices[0]) * len(s.voices))(); ctypes.memmove(voices, s.voices, ctypes.sizeof(s.voices))
        clouds = (grain.Cloud * len(s.clouds))(); ctypes.memmove(clouds, s.clouds, ctypes.sizeof(s.clouds))
        grains = (grain.Grain * len(s.grains))(); ctypes.memmove(grains, s.grains, ctypes.sizeof(s.grains))
        native = [0.]*(R//4); s.render_into(native, R//4)
        python = [0.]*(R//4); at = 0
        while at < R//4:
            part = [0.]*256
            grain.mix_grains_python(voices, clouds, s.params, s.gparams, grains, s.sample.data, part, 256)
            python[at:at+256] = part; at += 256
        self.assertGreater(max(map(abs, native)), .01)
        self.assertLess(max(abs(a-b) for a, b in zip(native, python)), 1e-9)

    def test_spread_lands_on_the_scale(self):
        for k in range(-12, 13):
            self.assertIn(grain.snap(k, 'minor') % 12, grain.SCALE_STEPS['minor'])
        self.assertEqual(grain.snap(5, 'octaves'), 0); self.assertEqual(grain.snap(7, 'octaves'), 12)

    def test_grain_knobs_can_be_linked_and_previewed(self):
        from decksynth.fx import SAMPLER_TARGETS
        from decksynth.sampler_engine import LIVE
        for key in grain.RANGES:
            self.assertIn(key, SAMPLER_TARGETS); self.assertIn(key, LIVE)


if __name__ == '__main__':
    unittest.main()
