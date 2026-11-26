"""The latency governor: grows after a dropout, shrinks back after a quiet stretch, per mode."""
import unittest

from decksynth.backend import LatencyGovernor, FILL_LIMIT


class LatencyGovernorTests(unittest.TestCase):
    def test_one_top_up_pass_can_fill_the_deepest_buffer_several_times(self):
        # 25 Nov: a 20 ms limit ended the pass after a dropout before the deeper buffer was full, and a heavy song went
        # from 3 dropouts in 20 s to 160+. A pass must be able to fill the biggest buffer (Custom 50 ms) a few times over.
        deepest = max(LatencyGovernor.MODES[m][1] for m in LatencyGovernor.MODES) / 48000
        self.assertGreaterEqual(FILL_LIMIT, 4 * max(deepest, .05))
        self.assertLessEqual(FILL_LIMIT, .5)   # and Panic and Stop are still read within half a second

    def test_custom_is_a_fixed_buffer_in_ms(self):
        g = LatencyGovernor('auto', 0.); g.set_mode('custom', 1., 10, 48000)
        self.assertEqual((g.mode, g.ms, g.target), ('custom', 10., 480))
        g.underrun(2.); g.tick(1e6); self.assertEqual(g.target, 480)      # neither grows nor shrinks
        g.set_mode('custom', 3., 3, 48000); self.assertEqual(g.target, 144)
        g.set_mode('custom', 3., 50, 48000); self.assertEqual(g.target, 2400)
        for bad in (2, 51, None, True): g.set_mode('custom', 4., bad); self.assertEqual((g.mode, g.ms), ('auto', None))

    def test_auto_starts_low_grows_and_comes_back(self):
        g = LatencyGovernor('auto', 0.)
        self.assertEqual(g.target, 768)
        g.underrun(1.); g.underrun(2.)
        self.assertEqual(g.target, 1280)
        g.tick(100.)                     # not quiet for long enough yet
        self.assertEqual(g.target, 1280)
        g.tick(123.)                     # 2 minutes after the last dropout
        self.assertEqual(g.target, 1024)
        g.tick(200.); self.assertEqual(g.target, 1024)
        g.tick(244.); self.assertEqual(g.target, 768)
        g.tick(5000.); self.assertEqual(g.target, 768)   # never below the floor

    def test_never_above_the_cap(self):
        g = LatencyGovernor('auto', 0.)
        for i in range(20): g.underrun(float(i))
        self.assertEqual(g.target, 2048)
        low = LatencyGovernor('low', 0.)
        for i in range(20): low.underrun(float(i))
        self.assertEqual(low.target, 1024)

    def test_each_mode_has_its_own_floor(self):
        self.assertEqual([LatencyGovernor(m).target for m in ('low', 'auto', 'safe')], [256, 768, 1024])

    def test_changing_mode_applies_at_once_and_unknown_means_auto(self):
        g = LatencyGovernor('safe', 0.); g.underrun(1.)
        g.set_mode('low', 2.)
        self.assertEqual((g.mode, g.target), ('low', 256))
        g.set_mode('nonsense', 3.)
        self.assertEqual((g.mode, g.target), ('auto', 768))


if __name__ == '__main__':
    unittest.main()
