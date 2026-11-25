import math, unittest
from decksynth.core import Engine, Project
from decksynth.fx import NPAR, ORDER, default_chain, validate_chain, available

def render_with(module, frames=24000):
    e = Engine(48000)
    if module:
        c = default_chain()
        for m in c['modules']:
            m['on'] = m['id'] == module
        e.set_fx(0, c)
    e.voice_on(0, 60, 100, ('t', 0))
    return e.render(frames)

@unittest.skipUnless(available(), 'native FX library not built')
class FxTests(unittest.TestCase):
    def test_bypass_is_bit_identical(self):
        e = Engine(48000); e.set_fx(0, default_chain())
        self.assertEqual(render_with(None), (e.voice_on(0, 60, 100, ('t', 0)), e.render(24000))[1])

    def test_each_module_is_finite_audible_and_changes_sound(self):
        dry = render_with(None)
        for module in ORDER:
            with self.subTest(module=module):
                wet = render_with(module)
                self.assertTrue(all(math.isfinite(x) and abs(x) <= .95 for x in wet))
                self.assertGreater(max(abs(x) for x in wet), .01)
                if module != 'volume':  # volume at level 1.0 is unity gain by design
                    self.assertNotEqual(wet, dry)

    def test_validate_rejects_bad_chains_and_clamps(self):
        with self.assertRaises(ValueError): validate_chain({'modules': []})
        c = default_chain(); c['modules'][1]['params']['cutoff'] = 9
        self.assertEqual(validate_chain(c)['modules'][1]['params']['cutoff'], 1)

    def test_chain_saves_and_reopens(self):
        import tempfile, os
        p = Project(); c = default_chain(); c['modules'][9]['on'] = True; p.tracks[2]['fx'] = c
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'x.json'); p.save(path)
            self.assertTrue(Project.load(path).tracks[2]['fx']['modules'][9]['on'])
            self.assertNotIn('fx', Project.load(path).tracks[0])

    def test_macro_and_mod_pad_move_parameters(self):
        c = default_chain(); c['modules'][1]['on'] = True; c['modules'][1]['params']['cutoff'] = .2
        c['macros'][0]['targets'] = [dict(module='filter', param='cutoff', depth=.6)]
        c['macros'][0]['value'] = 1
        e = Engine(48000); e.set_fx(0, c); e.voice_on(0, 48, 100, ('t', 0)); e.render(2400)
        self.assertAlmostEqual(e.fx[0].params[1 * NPAR + 1], .8, places=6)
        c['mods'][3]['targets'] = [dict(module='filter', param='reso', depth=1)]; c['mods'][3]['shape'] = 'square'
        e.set_fx(0, c); e.render(2400)
        self.assertNotEqual(e.fx[0].params[1 * NPAR + 2], .3)

    def test_morph_pad_drives_its_macros(self):
        c = default_chain(); c['modules'][8]['on'] = True
        c['macros'][1]['targets'] = [dict(module='delay', param='feedback', depth=1)]
        c['morph'] = dict(x=0, y=.5, xMacro=0, yMacro=1); c['macros'][1]['value'] = .5
        e = Engine(48000); e.set_fx(0, c); e.voice_on(0, 48, 100, ('t', 0)); e.render(1200)
        self.assertAlmostEqual(e.fx[0].params[8 * NPAR + 1], .875)
        self.assertEqual(validate_chain(c)['morph']['yMacro'], 1)

if __name__ == '__main__':
    unittest.main()
