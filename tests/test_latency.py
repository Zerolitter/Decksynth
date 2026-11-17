"""The latency governor: grows after a dropout, shrinks back after a quiet stretch, per mode."""
import unittest

from decksynth.backend import LatencyGovernor


class LatencyGovernorTests(unittest.TestCase):
    def test_auto_starts_low_grows_and_comes_back(self):
        g = LatencyGovernor('auto', 0.)
        self.assertEqual(g.target, 512)
        g.underrun(1.); g.underrun(2.)
        self.assertEqual(g.target, 1024)
        g.tick(20.)                      # not quiet for long enough yet
        self.assertEqual(g.target, 1024)
        g.tick(33.)                      # 30 s after the last dropout
        self.assertEqual(g.target, 768)
        g.tick(40.); self.assertEqual(g.target, 768)
        g.tick(64.); self.assertEqual(g.target, 512)
        g.tick(500.); self.assertEqual(g.target, 512)   # never below the floor

    def test_never_above_the_cap(self):
        g = LatencyGovernor('auto', 0.)
        for i in range(20): g.underrun(float(i))
        self.assertEqual(g.target, 2048)
        low = LatencyGovernor('low', 0.)
        for i in range(20): low.underrun(float(i))
        self.assertEqual(low.target, 1024)

    def test_each_mode_has_its_own_floor(self):
        self.assertEqual([LatencyGovernor(m).target for m in ('low', 'auto', 'safe')], [256, 512, 1024])

    def test_changing_mode_applies_at_once_and_unknown_means_auto(self):
        g = LatencyGovernor('safe', 0.); g.underrun(1.)
        g.set_mode('low', 2.)
        self.assertEqual((g.mode, g.target), ('low', 256))
        g.set_mode('nonsense', 3.)
        self.assertEqual((g.mode, g.target), ('auto', 512))


if __name__ == '__main__':
    unittest.main()
