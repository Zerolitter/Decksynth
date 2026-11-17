"""More Drum Rack and Sampler knobs can be linked to macros and mod pads (17 Nov)."""
import time
import unittest
from decksynth import fx
from decksynth.drum_shape import PadShaper
from decksynth.sampler import Sampler, new_sampler
from tests.test_sampler_expansion import SamplerTrack, tone, feed


class MoreTargets(unittest.TestCase):
    def test_new_targets_are_known_to_the_engine(self):
        for key in ('glide', 'velocity', 'attack', 'decay', 'sustain', 'release', 'f_attack', 'f_decay', 'f_velocity', 'p_decay'):
            self.assertIn(key, fx.SAMPLER_TARGETS); fx._range('sampler', key)
        for key in ('velocity', 'attack', 'hold', 'decay', 'fade_in', 'fade_out', 'eq_low', 'eq_mid', 'eq_freq', 'eq_high', 'low_cut',
                    'high_cut', 'drive', 'comp_threshold', 'comp_ratio', 'comp_attack', 'comp_release', 'comp_makeup'):
            self.assertIn(key, fx.DRUM_TARGETS); fx._range('drum', '3:' + key)

    def test_sampler_values_move_inside_their_range(self):
        s = Sampler(48000, None); s.spec = new_sampler()
        self.assertEqual(s._e('release'), s.spec['release'])
        s.mod = {'release': .5, 'velocity': 5., 'sustain': -3., 'f_velocity': .4}
        self.assertAlmostEqual(s._e('release'), s.spec['release'] + .5)
        self.assertEqual(s._e('velocity'), 2.)
        self.assertEqual(s._e('sustain'), 0.)
        self.assertAlmostEqual(s._e('f_velocity'), .4)


class DrumMoved(SamplerTrack, unittest.TestCase):
    def setUp(self):
        super().setUp()
        e = self.e
        e.set_device(2, 'drum_rack'); self.kit = e.project.tracks[2]['drum_rack']['id']
        e.record_input = 'Test input'
        e.sampler_record('now', 2, self.kit, -30, 20, 0); feed(e.record_feed, tone(.5))
        e.sampler_record('stop'); self.settle(); PadShaper.wait()
        self.rack = e.drums[2]

    def test_a_moved_decay_shortens_the_pad_and_letting_go_restores_it(self):
        rack = self.rack; before = rack.samples[0]
        rack.mod = {'0:decay': .35}; PadShaper.wait()
        self.assertLess(rack.samples[0].frames, before.frames, 'the linked Decay shortens the pad')
        self.assertIn(0, rack.drafts)
        time.sleep(.15); rack.mod = {}; PadShaper.wait()
        self.assertNotIn(0, rack.drafts, 'nothing linked: the saved shape plays again')
        self.assertEqual(rack.samples[0].frames, before.frames)

    def test_velocity_is_moved_on_the_hit(self):
        rack = self.rack
        rack.on(36, 64); soft = rack.voices[0].gain if rack.voices[0].sample is not None else None
        rack.panic(); rack.mod = {'0:velocity': 2.}
        rack.on(36, 64)
        self.assertLess(next(v.gain for v in rack.voices if v.sample is not None), soft, 'a higher velocity curve makes a medium hit quieter')


if __name__ == '__main__':
    unittest.main()
