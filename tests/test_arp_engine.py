"""Arpeggiator timing: a new phrase starts on its first note, wherever the clock is."""
import unittest
from decksynth.core import Engine
from decksynth.keystep import arp_groups, arp_view, defaults, schedule_notes


def capture(engine):
    played = []
    original = engine.voice_on
    def spy(track, pitch, velocity, token):
        if isinstance(token, tuple) and token[0] == 'perf_arp': played.append(pitch)
        return original(track, pitch, velocity, token)
    engine.voice_on = spy
    return played


class ArpEngineTests(unittest.TestCase):
    def test_updown_turns_round_without_repeats(self):
        self.assertEqual(arp_groups([60, 64, 67, 71], 'UpDown'), [[60], [64], [67], [71], [67], [64]])
        self.assertEqual(arp_groups([60, 64], 'UpDown'), [[60], [64]])
        self.assertEqual(arp_groups([60, 64, 67], 'UpDown', octaves=2),
                         [[n] for n in (60, 64, 67, 72, 76, 79, 76, 72, 67, 64)])

    def test_phrase_starts_on_first_note_mid_clock(self):
        e = Engine(1000); e.perform_set('arp', 'enabled', True); e.perform_set('arp', 'mode', 'Up')
        e.playing = True; e.render(1130)            # 9 steps and a bit into the bar
        played = capture(e)
        for n in (67, 60, 64): e.midi(0x90, n, 100)
        e.render(125 * 4)
        self.assertEqual(played[:3], [60, 64, 67])

    def test_adding_keys_without_retrigger_keeps_running(self):
        e = Engine(1000); e.perform_set('arp', 'enabled', True); e.perform_set('arp', 'retrigger', False)
        e.playing = True; e.render(300)
        played = capture(e)
        e.midi(0x90, 60, 100); e.render(250); e.midi(0x90, 64, 100); e.render(500)
        self.assertEqual(played[0], 60); self.assertIn(64, played)

    def test_view_and_schedule_agree_after_late_start(self):
        s = defaults(); s['arp'].update(enabled=True, mode='Up')
        anchor_beat = 2.1                    # key pressed just after step 8
        fpb = 1000
        events = schedule_notes(s, [60, 64, 67], 0, 4000, fpb, arp_anchor=anchor_beat * fpb)
        first = min(e for e in events if e[1] == 1)
        self.assertEqual(first[0], 2250); self.assertEqual(first[2], 60)
        self.assertEqual(arp_view(s, [60, 64, 67], 2.25, anchor_beat)['step'], 0)
        self.assertEqual(arp_view(s, [60, 64, 67], 2.0, anchor_beat)['step'], -1)

    def test_clock_rewind_while_latched_keeps_playing(self):
        e = Engine(1000); e.perform_set('arp', 'enabled', True); e.perform_set('arp', 'hold', True)
        e.playing = True; e.render(2000); e.midi(0x90, 60, 100); e.midi(0x80, 60, 0)
        e.frame = 0                          # song loop restart / MIDI song position
        played = capture(e); e.render(600)
        self.assertTrue(played, 'Latched arp must keep playing after the clock jumps back')


if __name__ == '__main__':
    unittest.main()
