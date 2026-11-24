import unittest

from decksynth.core import Engine


class PlayFrom(unittest.TestCase):
    def test_starts_the_loop_at_that_bar(self):
        e = Engine(); e.project.bars = 4
        e.play_from(8)
        self.assertTrue(e.playing)
        self.assertEqual(e.frame, round(8*e.fpb))

    def test_jumps_while_playing_and_refuses_past_the_end(self):
        e = Engine(); e.project.bars = 2; e.playing = True; e.frame = 100
        e.play_from(4)
        self.assertEqual(e.frame, round(4*e.fpb))
        with self.assertRaises(ValueError): e.play_from(8)

    def test_refused_while_recording(self):
        e = Engine(); e.recording = True
        with self.assertRaises(ValueError): e.play_from(0)


if __name__ == '__main__':
    unittest.main()
