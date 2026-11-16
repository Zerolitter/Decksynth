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


class ChordRefinementTests(unittest.TestCase):
    """Chords rework (16 Nov): one voicing order, live changes, Play in order."""
    def setUp(self):
        self.e = Engine(1000)
        self.e.perform_set('chord', 'enabled', True)

    def sounding(self, key=(0, 60)):
        return sorted(self.e.live_note_map[key])

    def test_option_changes_reach_the_held_chord(self):
        e = self.e
        e.perform_action('save_chord', [60, 64, 67, 71])
        e.midi(0x90, 60, 100); e.render(10)
        self.assertEqual(self.sounding(), [60, 64, 67, 71])
        e.perform_set('chord', 'spread', 3)
        self.assertEqual(self.sounding(), [60, 64, 67], 'Voices applies without pressing the key again')
        e.perform_set('chord', 'inversion', 1)
        self.assertEqual(self.sounding(), [64, 67, 72])
        e.perform_set('chord', 'bass', 1)
        self.assertEqual(self.sounding(), [48, 64, 67, 72])
        e.perform_set('scale', 'octave', 1)
        self.assertEqual(self.sounding(), [60, 76, 79, 84])
        e.perform_action('save_chord', [57, 60, 64])
        self.assertEqual(self.sounding(), [60, 75, 79, 84], 'a new chord shape replaces the sounding one')

    def test_bass_is_added_once_below_the_chord_root(self):
        e = self.e
        e.perform_set('chord', 'bass', 2)
        e.perform_action('save_chord', [57, 60, 64])
        e.midi(0x90, 57, 100)
        self.assertEqual(self.sounding((0, 57)), [33, 57, 60, 64])

    def test_voice_lead_picks_the_nearest_inversion(self):
        e = self.e
        e.perform_set('chord', 'voicing', True)
        e.perform_action('save_chord', [60, 64, 67])
        e.midi(0x90, 60, 100); e.midi(0x80, 60, 0)
        e.midi(0x90, 65, 100)
        self.assertEqual(self.sounding((0, 65)), [60, 65, 69], 'F after C keeps its voices close: C F A')

    def test_play_in_order_steps_through_my_chords(self):
        e = self.e
        e.perform_action('save_slot', [0, [60, 64, 67]])
        e.perform_action('save_slot', [2, [57, 60, 64]])
        e.perform_set('chord', 'follow', True)
        played = []
        for _ in range(3):
            e.midi(0x90, 72, 100); played.append(self.sounding((0, 72))); e.midi(0x80, 72, 0)
        self.assertEqual(played, [[60, 64, 67], [57, 60, 64], [60, 64, 67]])
        e.perform_action('chord_goto', 1)
        e.midi(0x90, 40, 100)
        self.assertEqual(self.sounding((0, 40)), [57, 60, 64])

    def test_play_in_order_by_bar_changes_the_held_chord(self):
        e = self.e
        e.perform_action('save_slot', [0, [60, 64, 67]])
        e.perform_action('save_slot', [1, [65, 69, 72]])
        e.perform_set('chord', 'follow', True); e.perform_set('chord', 'advance', '1 bar')
        e.playing = True
        e.midi(0x90, 60, 100)
        self.assertEqual(self.sounding(), [60, 64, 67])
        e.render(int(e.fpb * 4) + 300)
        self.assertEqual(self.sounding(), [65, 69, 72])

    def test_arp_follows_a_changed_chord(self):
        e = self.e
        e.perform_set('arp', 'enabled', True)
        e.perform_action('save_chord', [60, 64, 67])
        e.midi(0x90, 60, 100)
        self.assertEqual(sorted(e.perform_held.held()), [60, 64, 67])
        e.perform_set('chord', 'bass', 1)
        self.assertEqual(sorted(e.perform_held.held()), [48, 60, 64, 67])

    def test_chord_pad_key_skips_scale_snap_and_play_in_order(self):
        e = self.e
        e.perform_set('scale', 'name', 'Major')
        e.perform_action('save_slot', [0, [60, 64, 67]])
        e.perform_set('chord', 'follow', True)
        e.perform_action('save_chord', [61, 65, 68])
        e.midi(0x90, 61, 100, 'chord')
        self.assertEqual(self.sounding((0, 61)), [61, 65, 68], 'a C# pad is not snapped into C major or replaced by My chords')
        e.perform_set('chord', 'bass', 1)
        self.assertEqual(self.sounding((0, 61)), [49, 61, 65, 68])

    def test_new_chord_settings_load_on_old_projects(self):
        old = defaults()
        for k in ('inversion', 'ext', 'follow', 'advance'): del old['chord'][k]
        state = validate_state(old)
        self.assertEqual((state['chord']['inversion'], state['chord']['follow'], state['chord']['advance']), (0, False, 'Key'))
        for key, bad in (('inversion', 4), ('ext', 'x'), ('advance', '3 bars'), ('follow', 1)):
            with self.assertRaises(ValueError): self.e.perform_set('chord', key, bad)


if __name__ == '__main__':
    unittest.main()
