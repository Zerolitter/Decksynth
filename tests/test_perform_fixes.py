"""Step record cursor and recording what the arp plays."""
import unittest
from decksynth.core import Engine
from decksynth.keystep import current_pattern


def steps(e):
    return [sorted(n['note'] for n in step) for step in current_pattern(e.project.performance)['steps']]


class StepRecordTests(unittest.TestCase):
    def setUp(self):
        self.e = Engine(1000)
        self.e.perform_set('seq', 'recording', True)

    def tap(self, note, gap=200):
        self.e.midi(0x90, note, 100); self.e.render(20); self.e.midi(0x80, note, 0); self.e.render(gap)

    def test_each_key_goes_to_the_next_step_while_stopped(self):
        for n in (60, 62, 64): self.tap(n)
        s = steps(self.e)
        self.assertEqual(s[:4], [[60], [62], [64], []])
        self.assertEqual(self.e.rec_step, 3)

    def test_keys_pressed_together_make_one_chord_step(self):
        e = self.e
        e.midi(0x90, 60, 100); e.render(10); e.midi(0x90, 64, 100); e.render(10); e.midi(0x90, 67, 100)
        e.render(20)
        for n in (60, 64, 67): e.midi(0x80, n, 0)
        e.render(200); self.tap(62)
        s = steps(e)
        self.assertEqual(s[0], [60, 64, 67]); self.assertEqual(s[1], [62])

    def test_rest_back_and_cursor(self):
        e = self.e
        self.tap(60); e.perform_action('rec_rest'); self.tap(62)
        self.assertEqual(steps(e)[:3], [[60], [], [62]])
        e.perform_action('rec_back')            # back onto step 3 and clear it
        self.assertEqual(steps(e)[2], []); self.assertEqual(e.rec_step, 2)
        e.perform_action('rec_cursor', 7); self.tap(65)
        self.assertEqual(steps(e)[7], [65])

    def test_cursor_wraps_at_pattern_length(self):
        self.e.perform_set('seq', 'length', 4); self.e.perform_set('seq', 'recording', True)
        for n in (60, 61, 62, 63, 64): self.tap(n)
        self.assertEqual(steps(self.e)[0], [60, 64] if self.e.project.performance['seq']['overdub'] else [64])

    def test_records_while_playing_at_the_cursor_not_the_playhead(self):
        e = self.e; e.playing = True; e.render(1300)  # playhead somewhere past step 10
        self.tap(60); self.tap(62)
        self.assertEqual(steps(e)[:2], [[60], [62]])


class ArpRecordTests(unittest.TestCase):
    def test_rec_captures_the_arp_notes(self):
        e = Engine(1000)
        e.perform_set('arp', 'enabled', True); e.perform_set('arp', 'mode', 'Up')
        e.perform_set('arp', 'division', '1/8')
        e.record(0)
        for n in (60, 64, 67): e.midi(0x90, n, 100)
        e.render(2000)                            # one 4/4 bar at 120 bpm = 2000 frames here
        for n in (60, 64, 67): e.midi(0x80, n, 0)
        e.finish_record()
        notes = sorted(e.project.tracks[0]['notes'], key=lambda n: n['start'])
        self.assertEqual([n['note'] for n in notes][:8], [60, 64, 67] * 2 + [60, 64])
        starts = [round(n['start'], 3) for n in notes[:8]]
        self.assertEqual(starts, [i * .5 for i in range(8)])
        self.assertTrue(all(n['duration'] < .5 for n in notes[:8]), 'gate shorter than the step')

    def test_held_keys_are_not_recorded_twice(self):
        e = Engine(1000); e.perform_set('arp', 'enabled', True); e.perform_set('arp', 'division', '1/4')
        e.record(0); e.midi(0x90, 60, 100); e.render(2000); e.midi(0x80, 60, 0); e.finish_record()
        self.assertEqual(len(e.project.tracks[0]['notes']), 4)


    def test_arp_notes_cut_by_key_release_are_not_left_long(self):
        # Letting go before the take ends cuts the arp; the open note must close there, not at the clip end.
        e = Engine(1000); e.perform_set('arp', 'enabled', True); e.perform_set('arp', 'division', '1/8')
        e.record(0)
        for n in (60, 64, 67): e.midi(0x90, n, 100)
        e.render(e.record_end - 700)
        for n in (60, 64, 67): e.midi(0x80, n, 0)
        e.render(1000)
        self.assertFalse(e.recording)
        self.assertTrue(all(n['duration'] < .5 for n in e.project.tracks[0]['notes']), 'ghost long note')


if __name__ == '__main__':
    unittest.main()
