"""Arp octave walking (Up / Down / Up-Down) and Restart on bar."""
import copy
import unittest
from decksynth.core import Engine
from decksynth.keystep import arp_groups, arp_phase, defaults, validate_state

C, E, G = 60, 64, 67


def flat(groups):
    return [g[0] for g in groups]


class ArpOctaveTests(unittest.TestCase):
    def test_up_down_walks_three_octaves_and_back(self):
        walk = flat(arp_groups([C, E, G], 'Up', 3, octave_mode='UpDown'))
        self.assertEqual(walk, [C, E, G, C+12, E+12, G+12, C+24, E+24, G+24, C+12, E+12, G+12])

    def test_down_starts_on_the_top_octave(self):
        self.assertEqual(flat(arp_groups([C, E, G], 'Up', 2, octave_mode='Down')), [C+12, E+12, G+12, C, E, G])

    def test_up_keeps_the_original_order(self):
        for mode in ('Up', 'Down', 'UpDown', 'Order'):
            self.assertEqual(arp_groups([C, E, G], mode, 2, octave_mode='Up'), arp_groups([C, E, G], mode, 2))

    def test_note_mode_plays_inside_each_octave_pass(self):
        self.assertEqual(flat(arp_groups([C, E, G], 'Down', 2, octave_mode='UpDown')), [G, E, C, G+12, E+12, C+12])

    def test_restart_on_bar(self):
        arp = dict(defaults()['arp'], restart_bar=True, retrigger=False, length=16)
        # 1/16 steps, key pressed on step 2: the bar line at step 16 starts the pattern again.
        self.assertEqual(arp_phase(arp, 5, 2, .25), 3)
        self.assertEqual(arp_phase(arp, 16, 2, .25), 0)
        self.assertEqual(arp_phase(arp, 19, 2, .25), 3)
        arp['restart_bar'] = False
        self.assertEqual(arp_phase(arp, 19, 2, .25), 17)

    def test_settings_validate_and_old_projects_load(self):
        e = Engine(1000)
        e.perform_set('arp', 'octave_mode', 'UpDown'); e.perform_set('arp', 'restart_bar', True)
        with self.assertRaises(ValueError): e.perform_set('arp', 'octave_mode', 'Sideways')
        old = defaults(); del old['arp']['octave_mode']; del old['arp']['restart_bar']
        loaded = validate_state(copy.deepcopy(old))
        self.assertEqual((loaded['arp']['octave_mode'], loaded['arp']['restart_bar']), ('Up', False))

    def test_arp_to_seq_copies_the_octave_walk(self):
        e = Engine(1000)
        e.perform_set('arp', 'octaves', 2); e.perform_set('arp', 'octave_mode', 'UpDown')
        e.perform_set('arp', 'enabled', True)
        for n in (C, E, G): e.midi(0x90, n, 100)
        e.perform_action('arp_to_seq')
        seq = e.project.performance
        pat = seq['patterns'][f"{seq['seq']['bank']}:{seq['seq']['slot']}"]
        self.assertEqual([s[0]['note'] for s in pat['steps']], [C, E, G, C+12, E+12, G+12])
        self.assertTrue(seq['seq']['enabled']); self.assertEqual(e.rec_step, 0)


if __name__ == '__main__':
    unittest.main()
