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


    def heads(self, s, blocks, frames=256):
        out = []
        for _ in range(blocks):
            self.render(frames); v = s.voices[0]; out.append((s.head(0) - v.start)/float(v.end - v.start))
        return out

    def test_roam_forward_travels_inside_the_bracket_and_wraps(self):
        self.grain(g_roam='forward', g_pos=.2, g_range=.5, g_speed=1., g_spray=0.)
        s, _ = self.play(1, 60, 256)
        path = self.heads(s, 120)          # 0.64 s at playing speed: more than one pass of a 0.25 s bracket
        self.assertTrue(all(.2 - 1e-9 <= u <= .7 + 1e-9 for u in path), path)
        self.assertGreater(max(path) - min(path), .4)
        self.assertTrue(any(b < a - .3 for a, b in zip(path, path[1:])), 'it wraps back to the start of the bracket')

    def test_roam_bounce_turns_round_at_the_ends(self):
        self.grain(g_roam='bounce', g_pos=0., g_range=.6, g_speed=1., g_spray=0.)
        s, _ = self.play(1, 60, 256)
        path = self.heads(s, 120)
        self.assertTrue(all(-1e-9 <= u <= .6 + 1e-9 for u in path))
        steps = [b - a for a, b in zip(path, path[1:])]
        self.assertTrue(any(d > 0 for d in steps) and any(d < 0 for d in steps))
        self.assertFalse(any(abs(d) > .1 for d in steps), 'no jumps in bounce')

    def test_roam_synced_to_the_tempo_takes_the_bars_it_says(self):
        self.grain(g_roam='forward', g_pos=0., g_range=1., g_sync='1', g_spray=0.)
        s, _ = self.play(1, 60, 256)
        s.bpm = 120.                      # one bar = 2 s
        path = self.heads(s, int(R*.5/256))   # half a second: an eighth... a quarter of the bar
        self.assertAlmostEqual(path[-1], .25, delta=.02)

    def test_motion_jumps_and_holds_happen_and_stay_in_the_bracket(self):
        self.grain(g_roam='forward', g_pos=.1, g_range=.8, g_speed=.05, g_jump=1., g_hold=1., g_chaos=.5, g_spray=0.)
        s, _ = self.play(1, 60, 256)
        path = self.heads(s, 1200)        # about 6 s
        steps = [abs(b - a) for a, b in zip(path, path[1:])]
        self.assertTrue(any(d > .1 for d in steps), 'a jump')
        self.assertTrue(any(d == 0. for d in steps), 'a hold')
        self.assertTrue(all(.1 - 1e-9 <= u <= .9 + 1e-9 for u in path))

    def test_roam_off_leaves_the_read_point_alone_unless_motion_moves_it(self):
        self.grain(g_pos=.4, g_hold=1., g_rev=1.)      # hold and reverse need travel: nothing moves
        s, _ = self.play(1, 60, 256)
        self.assertTrue(all(abs(u - .4) < 1e-9 for u in self.heads(s, 50)))
        s.panic(); self.grain(g_pos=.4, g_range=.5, g_jump=1., g_chaos=1.)
        s, _ = self.play(1, 60, 256)
        path = self.heads(s, 1200)
        self.assertTrue(any(abs(u - .4) > .05 for u in path), 'Jump moves it inside the bracket')
        self.assertTrue(all(.4 - 1e-9 <= u <= .9 + 1e-9 for u in path))

    def test_native_and_python_match_with_roam_and_motion(self):
        self.grain(g_roam='bounce', g_range=.7, g_speed=.8, g_wander=.6, g_jump=.5, g_rev=.5, g_pulse=.7, g_spray=.2)
        s = self.e.samplers[1]
        if s._grain_kernel is None: self.skipTest('no native grain kernel here')
        s.on(60, 100, 'a')
        import copy
        twin_roamers = copy.deepcopy(s.roamers)
        voices = (type(s.voices[0]) * len(s.voices))(); ctypes.memmove(voices, s.voices, ctypes.sizeof(s.voices))
        clouds = (grain.Cloud * len(s.clouds))(); ctypes.memmove(clouds, s.clouds, ctypes.sizeof(s.clouds))
        grains = (grain.Grain * len(s.grains))(); ctypes.memmove(grains, s.grains, ctypes.sizeof(s.grains))
        native = [0.]*(R//4); s.render_into(native, R//4)
        python = [0.]*(R//4); at = 0; zone = float(voices[0].end - voices[0].start)
        while at < R//4:
            part = [0.]*256
            if voices[0].active: clouds[0].offset = twin_roamers[0].step(s.spec, s._e, s.rate, s.bpm, 256, zone)
            grain.mix_grains_python(voices, clouds, s.params, s.gparams, grains, s.sample.data, part, 256)
            python[at:at+256] = part; at += 256
        self.assertGreater(max(map(abs, native)), .01)
        self.assertLess(max(abs(a-b) for a, b in zip(native, python)), 1e-9)

    def test_old_grain_projects_get_roam_off(self):
        s = new_sampler(); s['mode'] = 'grain'
        for key in ('g_roam', 'g_range', 'g_jump', 'g_sync'): s.pop(key)
        clean = validate_sampler(s)
        self.assertEqual(clean['g_roam'], 'off'); self.assertEqual(clean['g_sync'], 'free')
        for key, bad in (('g_roam', 'sideways'), ('g_sync', '3'), ('g_range', 0.)):
            with self.assertRaises(ValueError, msg=key): validate_sampler(dict(clean, **{key: bad}))


if __name__ == '__main__':
    unittest.main()
