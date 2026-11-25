"""Sampler recipes (25 Nov): one tap sets a whole playing style on the loaded sample. Every key exists and is in range, the sample
and its points stay, the FX chain and sends are replaced as one undo step, and the Recipes page lists the same recipes."""
import re
import shutil
import tempfile
import unittest
from pathlib import Path

from decksynth.core import Engine
from decksynth import fx, sends
from decksynth.sampler import EDITABLE, FILTERS, GLIDES, MODES, OPTIONAL_RANGES, RANGES, validate_sampler
from decksynth import sampler_recipes as recipes
from tests.test_sampler import R

ROOT = Path(__file__).resolve().parents[1]


class RecipeDataTest(unittest.TestCase):
    def test_every_recipe_key_exists_and_is_in_range(self):
        self.assertGreaterEqual(len(recipes.RECIPES), 10)
        ranges = {**RANGES, **OPTIONAL_RANGES}
        for rid, (name, kind, hint, settings, chain, send) in recipes.RECIPES.items():
            self.assertTrue(name and hint and kind in ('bass', 'lead', 'chords', 'pad', 'arp'), rid)
            merged = recipes.recipe_settings(rid)
            self.assertLessEqual(set(merged), EDITABLE, rid)
            self.assertTrue(set(settings) <= set(recipes.BASE), rid + ': a setting the base does not reset')
            for key, value in merged.items():
                if key in ranges:
                    self.assertTrue(ranges[key][0] <= value <= ranges[key][1], '%s %s=%r' % (rid, key, value))
            self.assertIn(merged['mode'], ('oneshot', 'hold', 'loop'), rid)
            self.assertIn(merged['filter'], FILTERS); self.assertIn(merged['glide_mode'], GLIDES); self.assertIn(merged['mode'], MODES)
            validate_sampler(dict(validate_sampler(__import__('decksynth.sampler', fromlist=['x']).new_sampler()), **merged))
            for fx_id, params in chain:
                known = {k: (lo, hi) for k, lo, hi, _ in fx.PARAMS[fx_id]}
                self.assertLessEqual(set(params), set(known), rid + ' ' + fx_id)
                for k, v in params.items(): self.assertTrue(known[k][0] <= v <= known[k][1], '%s %s.%s=%r' % (rid, fx_id, k, v))
            for bus, v in send.items(): self.assertTrue(bus in sends.BUSES and 0 <= v <= 1, rid)
            self.assertEqual(set(recipes.recipe_sends(rid)), set(sends.BUSES))

    def test_the_recipes_page_lists_the_same_recipes(self):
        tsx = (ROOT / 'ui/src/components/Sampler.tsx').read_text()
        rows = re.findall(r"\['([a-z_]+)', '([^']+)', '(bass|lead|chords|pad|arp)', '", tsx[tsx.index('const RECIPES:'):])
        self.assertEqual({r[0] for r in rows}, set(recipes.RECIPES))
        for rid, name, kind in rows:
            self.assertEqual((name, kind), recipes.RECIPES[rid][:2], rid)


class RecipeEngineTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.e = e = Engine(R); e.chop_directory = str(self.dir / 'data')
        e.set_device(1, 'sampler'); self.id = e.project.tracks[1]['sampler']['id']

    def tearDown(self):
        self.e.sampler_tasks.close(); shutil.rmtree(self.dir, ignore_errors=True)

    def spec(self): return self.e.project.tracks[1]['sampler']

    def test_a_recipe_keeps_the_sample_and_sets_the_style_in_one_undo_step(self):
        e = self.e
        e.edit_sampler(1, self.id, 'patch', dict(start=.1, end=.8, tune=3., gain=1.2))
        before = {k: self.spec()[k] for k in ('start', 'end', 'tune', 'gain', 'root', 'source', 'slices')}
        steps = len(e.history)
        e.apply_recipe(1, self.id, 'acid')
        s = self.spec()
        self.assertEqual({k: s[k] for k in before}, before)
        self.assertEqual((s['poly'], s['glide_mode'], s['filter']), (False, 'always', 'lp24'))
        on = [m['id'] for m in e.project.tracks[1]['fx']['modules'] if m['on']]
        self.assertEqual(on, ['overdrive']); self.assertEqual(e.project.tracks[1]['sends'], dict(reverb=0., delay=.15))
        self.assertEqual(len(e.history), steps + 1)
        e.undo()
        self.assertEqual(self.spec()['filter'], 'off'); self.assertTrue(self.spec()['poly'])
        self.assertFalse([m for m in (e.project.tracks[1].get('fx') or {'modules': []})['modules'] if m['on']])
        self.assertNotIn('delay', e.project.tracks[1].get('sends') or {})

    def test_a_second_recipe_replaces_the_first_chain(self):
        e = self.e
        e.apply_recipe(1, self.id, 'acid'); e.apply_recipe(1, self.id, 'space_pad')
        self.assertEqual([m['id'] for m in e.project.tracks[1]['fx']['modules'] if m['on']], ['chorus', 'cloud'])
        self.assertEqual(self.spec()['mode'], 'loop'); self.assertTrue(self.spec()['poly'])
        for rid in recipes.RECIPES: e.apply_recipe(1, self.id, rid)
        with self.assertRaises(ValueError): e.apply_recipe(1, self.id, 'nope')


if __name__ == '__main__':
    unittest.main()
