"""Arp Stop and Pause: Stop silences the arp and drops the latched chord; Pause keeps the chord and the step,
and Resume carries on from the next step on the grid. A key press also ends a pause."""
import unittest
from decksynth.core import Engine

C, E, G = 60, 64, 67


def arp_notes(e, frames):
    """Pitches of arp notes started while rendering, in order."""
    seen = set(); out = []
    for _ in range(frames // 128):
        e.render(128)
        for k, v in e.synths[e.selected].voices.items():
            if isinstance(k, tuple) and k[0] == 'perf_arp' and k not in seen and v['release'] is None:
                seen.add(k); out.append(v['note'])
    return out


def latched():
    e = Engine(48000)
    e.perform_set('arp', 'enabled', True); e.perform_set('arp', 'hold', True)
    e.perform_set('arp', 'mode', 'Up'); e.perform_set('arp', 'octaves', 1); e.perform_set('arp', 'retrigger', False)
    for n in (C, E, G): e.midi(0x90, n, 100)
    for n in (C, E, G): e.midi(0x80, n, 0)
    return e


class ArpInterrupt(unittest.TestCase):
    def test_hold_keeps_playing_until_stop(self):
        e = latched()
        self.assertTrue(arp_notes(e, 48000))
        e.perform_action('arp_stop', None)
        self.assertEqual(e.perform_held.held(), [])
        self.assertEqual(arp_notes(e, 48000), [])
        self.assertFalse(any(isinstance(k, tuple) and k[0] == 'perf_arp' and v['release'] is None for k, v in e.synths[0].voices.items()))

    def test_pause_keeps_chord_and_step(self):
        e = latched()
        played = arp_notes(e, 24000 + 64)        # 1/16 steps at 120 bpm: 6000 frames each
        self.assertEqual(played[:4], [C, E, G, C])
        self.assertTrue(e.perform_action('arp_pause', None))
        self.assertEqual(arp_notes(e, 30000), [], 'nothing plays while paused')
        self.assertEqual(e.perform_held.held(), [C, E, G], 'chord kept')
        self.assertFalse(e.perform_action('arp_pause', None))
        after = arp_notes(e, 18000)
        nxt = [C, E, G][len(played) % 3]
        self.assertEqual(after[0], nxt, 'resumes on the step after the last one played')
        # And it stays on the 1/16 grid.
        self.assertEqual(round(e.arp_anchor_beat / .25, 6) % 1, 0)

    def test_key_press_ends_a_pause(self):
        e = latched(); arp_notes(e, 12000)
        e.perform_action('arp_pause', None)
        e.midi(0x90, 62, 100); e.midi(0x80, 62, 0)
        self.assertFalse(e.arp_paused)
        self.assertIn(62, arp_notes(e, 24000))


if __name__ == '__main__':
    unittest.main()
