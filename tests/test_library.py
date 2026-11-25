import math, os, tempfile, unittest
from pathlib import Path
from decksynth.core import Engine, Project
from decksynth.fx import available, validate_chain
from decksynth.keystep import validate_pattern, slot_key
from decksynth.library import (PRESET_LIBRARY, CATEGORIES, FACTORY_PATTERNS, BANKS, UI_JSON, ui_json,
                               factory_bank)


class LibraryTests(unittest.TestCase):
    def test_unique_presets_in_ten_categories_fifteen_each_and_the_808_family(self):
        self.assertEqual(len(PRESET_LIBRARY), 156)
        self.assertEqual(len({p['name'] for p in PRESET_LIBRARY}), 156)
        for c in CATEGORIES:   # fifteen each; Bass also holds the six 808 / kick presets of 25 Nov (Sample layer)
            self.assertEqual(sum(p['category'] == c for p in PRESET_LIBRARY), 21 if c == 'Bass' else 15, c)
        for legacy in ['Warm Keys', 'Bass', 'Atmospheric Pad', 'Bell', 'Evolving Texture']:
            self.assertIn(legacy, {p['name'] for p in PRESET_LIBRARY})

    def test_every_preset_passes_the_project_validator_and_fx_validator(self):
        for p in PRESET_LIBRARY:
            with self.subTest(p=p['name']):
                self.assertEqual(validate_chain(p['fx']), p['fx'])
                proj = Project(); proj.tracks[0]['instrument'] = p['instrument']; proj.tracks[0]['preset'] = p['name']
                proj.tracks[0]['fx'] = p['fx']
                with tempfile.TemporaryDirectory() as d:
                    path = os.path.join(d, 'p.json'); proj.save(path); Project.load(path)

    def test_ui_copy_is_up_to_date(self):
        self.assertEqual(Path(UI_JSON).read_text(), ui_json(),
                         'run: python -m decksynth.library to refresh ui/src/library.json')

    @unittest.skipUnless(available(), 'native FX library not built')
    def test_every_preset_renders_finite_and_audible(self):
        e = Engine(48000)
        for p in PRESET_LIBRARY:
            with self.subTest(p=p['name']):
                e.apply_preset(p['name']); e.synths[0].panic()
                e.voice_on(0, 60, 100, ('t', p['name']))
                out = e.render(12000)
                self.assertTrue(all(math.isfinite(x) and abs(x) <= 1 for x in out))
                self.assertGreater(max(abs(x) for x in out), .002)
                e.close_note(('t', p['name'])) if hasattr(e, 'close_note') else None

    def test_apply_preset_sets_sound_and_fx_and_undoes(self):
        e = Engine(48000); before = e.project.tracks[0]['instrument']
        e.apply_preset('Wobble Bass')
        t = e.project.tracks[0]
        self.assertEqual(t['preset'], 'Wobble Bass')
        self.assertTrue(any(m['on'] for m in t['fx']['modules']))
        self.assertTrue(t['fx']['mods'][0]['targets'])
        e.undo()
        self.assertEqual(e.project.tracks[0]['instrument'], before)
        self.assertNotIn('fx', e.project.tracks[0])

    def test_factory_patterns_fill_a_bank_and_undo(self):
        self.assertEqual(len(BANKS), 4)
        for bank in FACTORY_PATTERNS:
            self.assertEqual(len(bank), 16)
            for p in bank: validate_pattern(p['pattern'])
        e = Engine(48000)
        e.perform_action('load_factory', 2)
        pats = e.project.performance['patterns']
        self.assertEqual(sorted(pats), sorted(slot_key(2, s) for s in range(1, 17)))
        self.assertEqual(pats['2:1'], factory_bank(2)['2:1'])
        e.undo()
        self.assertEqual(e.project.performance['patterns'], {})
        with self.assertRaises(ValueError): e.perform_action('load_factory', 5)

    def test_factory_bank_plays_through_the_sequencer(self):
        e = Engine(48000)
        e.perform_action('load_factory', 1)
        e.perform_set('seq', 'bank', 1); e.perform_set('seq', 'slot', 1); e.perform_set('seq', 'enabled', True)
        e.playing = True
        out = e.render(48000)
        self.assertGreater(max(abs(x) for x in out), .01)


if __name__ == '__main__':
    unittest.main()
