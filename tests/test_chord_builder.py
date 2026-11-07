"""Chord pads: exact notes through the engine, and the My chords slots."""
import copy
import unittest
from decksynth.core import Engine
from decksynth.keystep import current_pattern, defaults, validate_state


class ChordPadTests(unittest.TestCase):
    def setUp(self):
        self.e = Engine(1000)

    def test_pad_plays_its_exact_notes_and_releases_them(self):
        e = self.e
        e.midi(0x90, 57, 100, [57, 60, 64]); e.render(10)
        self.assertEqual(sorted(e.live_note_map[(0, 57)]), [57, 60, 64])
        e.midi(0x80, 57, 0); e.render(10)
        self.assertNotIn((0, 57), e.live_note_map)

    def test_pad_ignores_chord_mode_expansion_and_scale(self):
        e = self.e
        e.perform_set('chord', 'enabled', True); e.perform_set('chord', 'preset', 'Major 7')
        e.perform_set('scale', 'name', 'Minor Pentatonic')
        e.midi(0x90, 57, 100, [57, 60, 64]); e.render(10)
        self.assertEqual(sorted(e.live_note_map[(0, 57)]), [57, 60, 64])

    def test_pad_strums(self):
        e = self.e
        e.perform_set('chord', 'strum_ms', 100)
        e.midi(0x90, 57, 100, [57, 60, 64])
        self.assertEqual(len(e.scheduled_live), 2, 'two later notes of the strum are scheduled')

    def test_pad_records_one_step(self):
        e = self.e
        e.perform_set('seq', 'recording', True)
        e.midi(0x90, 57, 100, [57, 60, 64]); e.render(20); e.midi(0x80, 57, 0); e.render(200)
        step = current_pattern(e.project.performance)['steps'][0]
        self.assertEqual(sorted(n['note'] for n in step), [57, 60, 64])
        self.assertEqual(e.rec_step, 1)

    def test_pad_feeds_the_arp(self):
        e = self.e
        e.perform_set('arp', 'enabled', True)
        e.midi(0x90, 57, 100, [57, 60, 64])
        self.assertEqual(sorted(e.perform_held.held()), [57, 60, 64])

    def test_bad_pad_notes_are_rejected(self):
        for bad in ([], [200], ['x'], list(range(9))):
            with self.assertRaises(ValueError): self.e.midi(0x90, 60, 100, bad)

    def test_slots_save_clear_and_undo(self):
        e = self.e
        e.perform_action('save_slot', [2, [64, 60, 67]])
        self.assertEqual(e.project.performance['chord']['slots'][2], [60, 64, 67])
        e.perform_action('clear_slot', 2)
        self.assertEqual(e.project.performance['chord']['slots'][2], [])
        for bad in ([8, [60]], [0, []], 'x'):
            with self.assertRaises(ValueError): e.perform_action('save_slot', bad)

    def test_old_projects_get_empty_slots(self):
        old = defaults(); del old['chord']['slots']
        a = validate_state(copy.deepcopy(old)); b = validate_state(copy.deepcopy(old))
        self.assertEqual(a['chord']['slots'], [[]] * 8)
        a['chord']['slots'][0].append(60)
        self.assertEqual(b['chord']['slots'][0], [], 'defaults are not shared between projects')


if __name__ == '__main__':
    unittest.main()
