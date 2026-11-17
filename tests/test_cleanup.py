import copy, unittest
from decksynth.core import Engine
from decksynth.fx import default_chain


def chain_with_links():
    c = default_chain()
    for m in c['modules']:
        if m['id'] in ('filter', 'reverb'): m['on'] = True
    c['mods'][0]['targets'] = [dict(module='filter', param='cutoff', depth=.4)]
    c['mods'][2]['shape'] = 'steps'; c['mods'][2]['steps'] = [.5] * 16
    c['macros'][1]['targets'] = [dict(module='reverb', param='mix', depth=.5)]
    c['macros'][1]['value'] = .7
    return c


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.e = Engine(48000)
        for i in range(4): self.e.set_fx(i, chain_with_links())

    def test_effects_removes_modules_and_their_links_on_selected_track_only(self):
        self.e.cleanup('effects')
        fx = self.e.project.tracks[0]['fx']
        self.assertFalse(any(m['on'] for m in fx['modules']))
        self.assertFalse(any(s['targets'] for s in fx['macros'] + fx['mods']))
        self.assertTrue(any(m['on'] for m in self.e.project.tracks[1]['fx']['modules']))

    def test_sound_returns_to_preset_start_sound(self):
        from decksynth.library import preset
        t = self.e.project.tracks[0]; start = preset(t['preset'])['instrument']  # the finished library sound
        t['instrument']['harmonics'][3] = 1.; t['instrument']['attack'] = 2.; t['instrument']['curve'] = .8
        self.e.cleanup('sound')
        self.assertEqual(t['instrument'], start)

    def test_mods_flattens_pads_and_clears_links_but_keeps_effects(self):
        self.e.cleanup('mods')
        fx = self.e.project.tracks[0]['fx']
        self.assertEqual(fx['mods'], default_chain()['mods'])
        self.assertEqual(fx['macros'][1]['targets'], [])
        self.assertEqual(fx['macros'][1]['value'], .7)
        self.assertTrue(any(m['on'] for m in fx['modules']))

    def test_links_clears_every_track_and_keeps_shapes(self):
        self.e.cleanup('links')
        for t in self.e.project.tracks:
            self.assertFalse(any(s['targets'] for s in t['fx']['macros'] + t['fx']['mods']))
            self.assertEqual(t['fx']['mods'][2]['shape'], 'steps')

    def test_start_over_is_one_undo_step(self):
        self.e.project.bpm = 97; self.e.project.tracks[0]['notes'] = [dict(note=60, velocity=100, start=0, duration=1)]
        self.e.cleanup('all')
        self.assertEqual(self.e.project.bpm, 120)
        self.assertEqual(len(self.e.project.tracks), 1)  # a new session starts with one track
        self.assertEqual((len(self.e.synths), len(self.e.fx), len(self.e.project.song['lanes'])), (1, 1, 1))
        self.e.render_stereo(256)
        self.assertEqual(self.e.project.tracks[0]['notes'], [])
        from decksynth.library import preset
        start = self.e.project.tracks[0]
        self.assertEqual(start['instrument'], preset(start['preset'])['instrument'])
        self.assertEqual(start['fx']['macros'][1]['value'], 0)
        self.e.undo()
        self.assertEqual(self.e.project.bpm, 97)
        self.assertEqual(len(self.e.project.tracks[0]['notes']), 1)
        self.assertTrue(any(m['on'] for m in self.e.project.tracks[0]['fx']['modules']))

    def test_unknown_action_is_rejected_without_an_undo_step(self):
        with self.assertRaises(ValueError): self.e.cleanup('everything')
        self.assertEqual(self.e.history, [])


class BypassTests(unittest.TestCase):
    def test_bypass_keeps_the_card_but_silences_it(self):
        from decksynth.fx import validate_chain, TrackFx
        c = default_chain()
        for m in c['modules']:
            if m['id'] == 'reverb': m['on'] = True; m['bypass'] = True
        clean = validate_chain(c)
        rev = next(m for m in clean['modules'] if m['id'] == 'reverb')
        self.assertTrue(rev['on']); self.assertTrue(rev['bypass'])
        self.assertNotIn('bypass', next(m for m in clean['modules'] if m['id'] == 'filter'))
        fx = TrackFx(48000); fx.configure(clean)
        self.assertFalse(fx.active)
        data = [0.1, -0.2, 0.3]
        self.assertIs(fx.process(data, 120), data)
        bad = default_chain(); bad['modules'][0]['bypass'] = 'yes'
        with self.assertRaises(ValueError): validate_chain(bad)


if __name__ == '__main__':
    unittest.main()
