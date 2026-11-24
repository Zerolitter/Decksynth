import json
import tempfile
import unittest
from pathlib import Path

from decksynth.core import Engine, Project


class ClipNames(unittest.TestCase):
    def test_rename_is_one_undo_step_and_tidied(self):
        e = Engine()
        e.clip_action(0, 'rename', 2, '  Verse   one  ')
        self.assertEqual(e.project.tracks[0]['clip_names'][2], 'Verse one')
        e.undo_any()
        self.assertFalse((e.project.tracks[0].get('clip_names') or [''] * 8)[2])

    def test_long_names_are_cut_and_empty_goes_back_to_the_letter(self):
        e = Engine()
        e.clip_action(0, 'rename', 0, 'x' * 60)
        self.assertEqual(len(e.project.tracks[0]['clip_names'][0]), 24)
        e.clip_action(0, 'rename', 0, '')
        self.assertEqual(e.project.tracks[0]['clip_names'][0], '')
        with self.assertRaises(ValueError): e.clip_action(0, 'rename', 0, 5)

    def test_copy_takes_the_name_and_clear_drops_it(self):
        e = Engine()
        e.project.tracks[0]['notes'] = [dict(start=0., duration=1., note=60, velocity=100)]
        e.clip_action(0, 'rename', 0, 'Hook')
        e.clip_action(0, 'copy', 3, 0)
        self.assertEqual(e.project.tracks[0]['clip_names'][3], 'Hook')
        e.clip_action(0, 'clear', 3)
        self.assertEqual(e.project.tracks[0]['clip_names'][3], '')

    def test_names_survive_save_and_load(self):
        e = Engine()
        e.clip_action(0, 'rename', 1, 'Fill')
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'p.decksynth'
            e.project.save(path)
            p = Project.load(path)
            self.assertEqual(p.tracks[0]['clip_names'][1], 'Fill')
            data = json.loads(path.read_text()); data['tracks'][0]['clip_names'] = ['a'] * 3
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError): Project.load(path)


if __name__ == '__main__':
    unittest.main()
