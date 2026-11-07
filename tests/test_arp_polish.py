import copy, unittest
from decksynth.core import Engine
from decksynth.keystep import (defaults, validate_state, schedule_notes, chord_notes, arp_view,
                               HeldNotes, SCALES, scale_snap)


def arp_state(**arp):
    s = defaults(); s['arp'].update(enabled=True, **arp); return s


def ons(events): return [(e[0], e[2], e[3]) for e in events if e[1] == 1]


class ArpPolishTests(unittest.TestCase):
    def test_old_projects_without_new_keys_still_load(self):
        s = defaults()
        for k in ('velocity', 'spice_seed'): del s['arp'][k]
        for k in ('strum_sync', 'bass'): del s['chord'][k]
        v = validate_state(s)
        self.assertEqual(v['arp']['velocity'], 'As played'); self.assertEqual(v['arp']['spice_seed'], 1)
        self.assertEqual(v['chord']['strum_sync'], 'Off'); self.assertEqual(v['chord']['bass'], 0)
        bad = defaults(); bad['arp']['velocity'] = 'Loud'
        with self.assertRaises(ValueError): validate_state(bad)
        bad = defaults(); bad['chord']['bass'] = 4
        with self.assertRaises(ValueError): validate_state(bad)

    def test_velocity_modes(self):
        held = [60, 64]
        played = ons(schedule_notes(arp_state(), held, 0, 4000, 1000, velocities={60: 40, 64: 90}))
        self.assertEqual({n: v for _, n, v in played}, {60: 40, 64: 90})
        fixed = ons(schedule_notes(arp_state(velocity='Fixed 100'), held, 0, 4000, 1000, velocities={60: 40}))
        self.assertEqual({v for *_, v in fixed}, {100})
        accent = ons(schedule_notes(arp_state(velocity='Accent first'), held, 0, 4000, 1000))
        self.assertEqual(accent[0][2], 118); self.assertIn(84, [v for *_, v in accent])

    def test_dice_changes_spice_but_default_is_unchanged(self):
        held = [60, 64, 67]
        base = schedule_notes(arp_state(spice=.8), held, 0, 16000, 1000)
        same = schedule_notes(arp_state(spice=.8, spice_seed=1), held, 0, 16000, 1000)
        rolled = schedule_notes(arp_state(spice=.8, spice_seed=2), held, 0, 16000, 1000)
        self.assertEqual(base, same); self.assertNotEqual(base, rolled)
        # Dice never changes which notes are in the pattern, only gates/rests/ratchets.
        self.assertLessEqual({n for _, n, _ in ons(rolled)}, set(held))

    def test_bass_note_and_new_scales(self):
        s = defaults(); s['chord'].update(enabled=True, preset='Major Triad', bass=1)
        self.assertEqual(chord_notes(s, 60), [48, 60, 64, 67])
        for name in ('Phrygian', 'Lydian', 'Locrian', 'Japanese', 'Gypsy', 'Arabic', 'Freygish'):
            self.assertIn(name, SCALES)
        self.assertEqual(scale_snap(61, 0, 'Phrygian'), 61)

    def test_arp_view_matches_the_scheduled_note(self):
        s = arp_state(mode='Up')
        view = arp_view(s, [60, 64, 67], 0.5)   # 1/16 steps: beat .5 is step 2
        self.assertEqual(view['groups'], [[60], [64], [67]]); self.assertEqual(view['step'], 2)
        self.assertEqual(arp_view(s, [], 0)['step'], -1)

    def test_strum_sync_uses_tempo_divisions(self):
        e = Engine(48000)
        e.perform_set('chord', 'enabled', True); e.perform_set('chord', 'preset', 'Major Triad')
        e.perform_set('chord', 'strum_sync', '1/16')
        e.midi(0x90, 60, 100)
        delays = sorted(f - e.absolute_frame for f, *_ in e.scheduled_live)
        quarter = round(.25 * e.fpb)
        self.assertEqual(delays, [quarter, 2 * quarter])
        self.assertTrue(HeldNotes().velocities() == {})


if __name__ == '__main__':
    unittest.main()
