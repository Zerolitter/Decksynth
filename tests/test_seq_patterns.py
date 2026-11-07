"""Pattern pads: paste one pattern into another (one undo step)."""
import unittest
from decksynth.core import Engine


class PastePatternTests(unittest.TestCase):
    def test_paste_copies_notes_and_timing(self):
        e = Engine(1000)
        e.perform_set('seq', 'division', '1/8'); e.perform_set('seq', 'length', 8)
        e.perform_step(0, [dict(note=60, velocity=100, tie=1)], True)
        e.perform_set('seq', 'slot', 5)
        e.perform_action('paste_pattern', '1:1')
        s = e.project.performance
        self.assertEqual(s['patterns']['1:5']['steps'][0][0]['note'], 60)
        self.assertEqual((s['seq']['length'], s['seq']['division']), (8, '1/8'))
        s['patterns']['1:5']['steps'][1].append(dict(note=62, velocity=100, tie=1))
        self.assertEqual(s['patterns']['1:1']['steps'][1], [], 'the copy is independent')

    def test_paste_rejects_empty_or_bad_source(self):
        e = Engine(1000)
        with self.assertRaises(ValueError): e.perform_action('paste_pattern', '2:3')
        with self.assertRaises(ValueError): e.perform_action('paste_pattern', 'nope')


if __name__ == '__main__':
    unittest.main()
