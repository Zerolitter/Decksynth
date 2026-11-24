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


    QUARTERS = [[0., .25], [.25, .5], [.5, .75], [.75, 1.]]

    def stepped(self, **edits):
        spec = dict(g_rhythm='skip', g_div='1/8', slices=self.QUARTERS, g_spray=0., g_size=.03, g_density=60.)
        spec.update(edits); return self.grain(**spec)

    def walk(self, s, steps):
        """The slice each 1/8 step reads at 120 BPM (0.25 s a step), sampled mid-step; None while gated."""
        seen = []; length = int(R*.25)
        self.render(length//2 - 256)
        for _ in range(steps):
            st = s.state()['steps']; seen.append(st[0] if st else None); self.render(length)
        return seen

    def test_rhythm_skip_steps_through_the_slices_and_skips_the_ones_that_are_off(self):
        self.stepped(g_off=[[2], [], [], []])
        s, _ = self.play(1, 60, 256)
        self.assertEqual(self.walk(s, 6), [0, 1, 3, 3, 0, 1])

    def test_rhythm_hold_stays_and_gate_goes_quiet(self):
        self.stepped(g_rhythm='hold', g_off=[[1, 2], [], [], []])
        s, _ = self.play(1, 60, 256)
        self.assertEqual(self.walk(s, 5), [0, 0, 0, 3, 0])
        s.panic(); self.stepped(g_rhythm='gate', g_off=[[1], [], [], []])
        s, _ = self.play(1, 60, 256)
        self.assertEqual(self.walk(s, 4), [0, None, 2, 3])

    def test_gated_steps_are_silent(self):
        self.stepped(g_rhythm='gate', g_off=[[1], [], [], []], release=.01)
        s, _ = self.play(1, 60, 256)
        length = int(R*.25); self.render(length - 256)          # step 0 sounds
        quiet = self.render(length)                              # step 1 is gated: only the grain tails at its start
        self.assertLess(max(map(abs, quiet[R//20:])), 1e-9)
        loud = self.render(length)
        self.assertGreater(max(map(abs, loud)), .01)

    def test_pingpong_and_variations(self):
        self.stepped(g_rhythm='pingpong')
        s, _ = self.play(1, 60, 256)
        self.assertEqual(self.walk(s, 8), [0, 1, 2, 3, 2, 1, 0, 1])
        s.panic(); self.stepped(g_var='B', g_off=[[], [0, 1], [], []])
        s, _ = self.play(1, 60, 256)
        self.assertEqual(self.walk(s, 4), [2, 2, 2, 3])

    def test_flipped_slices_play_their_grains_backwards(self):
        self.stepped(g_flip=[[0], [], [], []])
        s, _ = self.play(1, 60, R//8)
        steps = [g.step for g in s.grains if g.active]
        self.assertTrue(steps and all(x < 0 for x in steps))
        self.render(R//4)
        newest = min((g for g in s.grains if g.active), key=lambda g: g.wpos)
        self.assertGreater(newest.step, 0, 'slice 2 plays forwards')

    def test_swing_and_prob(self):
        self.stepped(g_swing=.75)
        s, _ = self.play(1, 60, 256)
        length = int(R*.25)
        self.render(length + length//4)       # a quarter into step 1: with swing it has not started yet
        self.assertEqual(s.state()['steps'], [0])
        self.render(length//2)
        self.assertEqual(s.state()['steps'], [1])
        s.panic(); self.stepped(g_prob=0.)
        s, _ = self.play(1, 60, 256)
        self.assertEqual(self.walk(s, 4), [0, 0, 0, 0])

    def test_rhythm_needs_slices(self):
        self.grain(g_rhythm='skip', g_pos=.4)
        s, _ = self.play(1, 60, 256)
        self.assertEqual(s.state()['steps'], [])
        self.assertAlmostEqual(s.state()['playing'][0], .4, delta=.01)

    def test_native_and_python_match_with_rhythm(self):
        self.stepped(g_rhythm='flow', g_flip=[[1], [], [], []], g_off=[[2], [], [], []], g_reverse=.3, g_spread=5.)
        s = self.e.samplers[1]
        if s._grain_kernel is None: self.skipTest('no native grain kernel here')
        s.on(60, 100, 'a')
        import copy
        twin = copy.deepcopy(s.steppers)
        voices = (type(s.voices[0]) * len(s.voices))(); ctypes.memmove(voices, s.voices, ctypes.sizeof(s.voices))
        clouds = (grain.Cloud * len(s.clouds))(); ctypes.memmove(clouds, s.clouds, ctypes.sizeof(s.clouds))
        grains = (grain.Grain * len(s.grains))(); ctypes.memmove(grains, s.grains, ctypes.sizeof(s.grains))
        n = R*3//4
        native = [0.]*n; s.render_into(native, n)
        python = [0.]*n; at = 0; v = voices[0]; zone = float(v.end - v.start); total = float(s.params.frames)
        while at < n:
            part = [0.]*256
            if v.active:
                pos, flags = twin[0].step(s.spec, s._e, s.rate, s.bpm, float(v.age), 256, total)
                pos = min(float(v.end) - 1., max(float(v.start), pos))
                clouds[0].offset = pos - float(v.start) - s._e('g_pos')*zone; clouds[0].flags = flags
            grain.mix_grains_python(voices, clouds, s.params, s.gparams, grains, s.sample.data, part, 256)
            python[at:at+256] = part; at += 256
        self.assertGreater(max(map(abs, native)), .01)
        self.assertLess(max(abs(a-b) for a, b in zip(native, python)), 1e-9)

    def test_rhythm_patterns_are_checked(self):
        clean = validate_sampler(new_sampler())
        self.assertEqual(clean['g_off'], [[], [], [], []])
        self.assertEqual(validate_sampler(dict(clean, g_off=[[3, 1, 3], [], [], []]))['g_off'][0], [1, 3])
        for bad in ([[]], [[64], [], [], []], [['1'], [], [], []], 'A'):
            with self.assertRaises(ValueError): validate_sampler(dict(clean, g_off=bad))
        for key, bad in (('g_rhythm', 'shuffle'), ('g_div', '1/64'), ('g_var', 'E'), ('g_swing', .9)):
            with self.assertRaises(ValueError, msg=key): validate_sampler(dict(clean, **{key: bad}))


    def test_rhythm_sits_on_the_song_grid_while_it_plays(self):
        self.stepped()
        self.e.play_from(1.)                      # one beat in: the third eighth (slice 3) is already playing
        s, _ = self.play(1, 60, 256)
        self.assertEqual(s.state()['steps'], [2])
        self.render(int(R*.25))                   # an eighth later
        self.assertEqual(s.state()['steps'], [3])
        self.e.stop(); s.panic()
        s, _ = self.play(1, 60, 256)              # stopped: it counts from the key again
        self.assertEqual(s.state()['steps'], [0])

    def test_bar_synced_roam_sits_on_the_bar_while_the_song_plays(self):
        self.grain(g_roam='forward', g_sync='1', g_range=1., g_pos=0., g_spray=0.)
        self.e.play_from(2.)                      # half a bar in
        s, _ = self.play(1, 60, 256)
        v = s.voices[0]
        self.assertAlmostEqual((s.head(0) - v.start)/float(v.end - v.start), .5, delta=.01)
        self.render(R//2)                         # a quarter note later: a quarter of a bar more
        self.assertAlmostEqual((s.head(0) - v.start)/float(v.end - v.start), .75, delta=.01)


    def sine(self, seconds, hz=440., level=.5):
        from array import array
        n = int(R*seconds)
        return array('f', (level*math.sin(2*math.pi*hz*i/R) for i in range(n)))

    def feed(self, block, size=1024):
        for i in range(0, len(block), size): self.e.record_feed(block[i:i + size])

    def test_live_input_needs_grain_mode_and_plays_what_comes_in(self):
        made = self.make()
        with self.assertRaises(ValueError): self.e.sampler_live(1, made['id'], 'on')
        self.e.edit_sampler(1, made['id'], 'patch', dict(mode='grain', g_pos=.9, g_size=.08, g_density=30., g_spray=0.))
        self.e.sampler_live(1, made['id'], 'on')
        s = self.e.samplers[1]
        self.assertEqual(s.state()['status'], 'LIVE'); self.assertEqual(len(s.state()['peaks']), 256)
        self.feed(self.sine(1.5, 440.))
        s, out = self.play(1, 60, R//2)
        tail = out[-R//4:]
        self.assertGreater(max(map(abs, tail)), .05)
        self.assertAlmostEqual(crossings(tail)/(len(tail)/R), 440., delta=25)     # the input's pitch at the root key
        st = s.state(); self.assertTrue(st['grains'] and all(.7 < g <= 1. for g in st['grains']), st['grains'])

    def test_live_buffer_moves_on_without_clicks_or_lost_grains(self):
        made = self.grain(g_pos=.95, g_size=.05, g_density=40., g_spray=0.)
        self.e.sampler_live(1, made['id'], 'on'); s = self.e.samplers[1]
        self.feed(self.sine(2., 330.))
        s, _ = self.play(1, 60, 256)
        out = []
        for _ in range(int(20*R/2048)):                 # 20 s of input: the buffer moves its newest half to the front
            self.feed(self.sine(2048/R, 330.)); out += self.render(2048)
        self.assertTrue(all(math.isfinite(x) for x in out))
        self.assertGreater(min(max(map(abs, out[i:i + R//10])) for i in range(R, len(out) - R//10, R//10)), .05, 'never drops out')
        self.assertTrue(all(0. <= g <= 1. for g in s.state()['grains']))

    def test_live_freeze_keeps_the_last_seconds(self):
        made = self.grain(g_pos=.5, g_size=.08, g_density=30., g_spray=0.)
        self.e.sampler_live(1, made['id'], 'on')
        self.feed(self.sine(9., 440.))
        self.e.sampler_live(1, made['id'], 'freeze')
        self.feed(self.sine(9., 440., level=0.))        # silence comes in, but it is not kept
        _, out = self.play(1, 60, R//2)
        self.assertGreater(max(map(abs, out[-R//4:])), .05)
        self.e.sampler_live(1, made['id'], 'thaw')
        self.assertFalse(self.e.samplers[1].live.frozen)

    def test_leaving_grain_mode_turns_live_off(self):
        made = self.grain()
        self.e.sampler_live(1, made['id'], 'on')
        self.e.edit_sampler(1, made['id'], 'mode', 'hold')
        self.assertIsNone(self.e.samplers[1].live); self.assertIsNone(self.e.live_track)
        self.assertNotEqual(self.e.samplers[1].state()['status'], 'LIVE')


if __name__ == '__main__':
    unittest.main()
