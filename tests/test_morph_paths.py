import math
import unittest

from decksynth.core import Engine
from decksynth.fx import NPAR, PATHS, RATES, default_chain, morph_point, pad_mix, path_point, validate_chain


def chain_with(**morph):
    c = default_chain(); c['modules'][8]['on'] = True  # delay on, so the FX run
    c['macros'][0]['targets'] = [dict(module='delay', param='feedback', depth=1)]
    c['morph'].update(morph)
    return c


class MorphPathTests(unittest.TestCase):
    def test_every_path_is_a_closed_loop_inside_the_pad(self):
        for path in PATHS:
            if path in ('hand', 'drift'): continue
            a, b = path_point(path, 0.), path_point(path, .9999)
            self.assertLess(math.dist(a, b), .02, path)
            for i in range(200):
                x, y = path_point(path, i / 200)
                self.assertLessEqual(abs(x), 1.0001, path); self.assertLessEqual(abs(y), 1.0001, path)

    def test_size_spin_and_wander_shape_the_puck_around_the_touched_centre(self):
        mo = validate_chain(chain_with(path='circle', size=.5, wander=0., x=.3, y=.6))['morph']
        x, y = morph_point(mo, 0., 0.)
        self.assertAlmostEqual(x, .3 + .25); self.assertAlmostEqual(y, .6)
        mo['spin'] = .25; x, y = morph_point(mo, 0., 0.)
        self.assertAlmostEqual(x, .3, places=6); self.assertAlmostEqual(y, .6 + .25)
        mo['size'] = 1.; mo['x'] = 1.; x, _ = morph_point(mo, .0, 0.)
        self.assertLessEqual(x, 1.)
        mo.update(spin=0., wander=1.); moved = {round(morph_point(mo, 0., s)[1], 3) for s in (0, .3, .7, 1.1)}
        self.assertGreater(len(moved), 2, 'wander adds drift on top of the path')

    def test_engine_moves_the_puck_in_audio_time_and_writes_its_macros(self):
        e = Engine(48000); e.set_fx(0, chain_with(path='circle', size=1., wander=0., rate=6, xMacro=0, yMacro=1))
        seen = set()
        for _ in range(12):
            e.render(512); seen.add(round(e.fx[0].puck[0], 2))
            # Macro 1 is Puck X and drives Delay feedback, so the effective feedback follows the puck
            self.assertAlmostEqual(e.fx[0].params[8 * NPAR + 1], min(.95, .4 + e.fx[0].puck[0] * .95), places=2)
        self.assertGreater(len(seen), 4, 'the puck travels along the circle')
        self.assertIn('puck', e.fx_live(0))

    def test_freeze_holds_and_retrigger_restarts_on_a_note(self):
        e = Engine(48000); e.set_fx(0, chain_with(path='circle', size=1., wander=0., rate=3))
        e.render(4800); first = list(e.fx[0].puck)
        c = e.project.tracks[0]['fx']; c['morph']['mode'] = 'freeze'; e.set_fx(0, c)
        e.render(4800); held = list(e.fx[0].puck[:2]); e.render(4800)
        self.assertEqual(held, e.fx[0].puck[:2])
        self.assertNotEqual(first[:2], [.5, .5])
        c['morph']['mode'] = 'retrigger'; e.set_fx(0, c)
        e.render(9600); e.voice_on(0, 60, 100, ('t', 1)); e.render(128)
        start = morph_point(e.project.tracks[0]['fx']['morph'], 0., 0.)
        self.assertAlmostEqual(e.fx[0].puck[0], start[0], places=1)

    def test_pad_mix_blends_the_four_corner_pads(self):
        self.assertEqual(pad_mix(0, 1, [1, 0, 0, 0]), 1)
        self.assertEqual(pad_mix(1, 0, [0, 0, 0, -1]), -1)
        self.assertAlmostEqual(pad_mix(.5, .5, [1, 1, -1, -1]), 0)
        e = Engine(48000); c = chain_with(mixMacro=0, x=0., y=1.)
        c['mods'][0].update(shape='square', rate=0)  # pad 1 sits in the top-left corner: +1 for the first half
        e.set_fx(0, c); e.render(512)
        self.assertAlmostEqual(e.fx[0].puck[2], 1.)
        self.assertAlmostEqual(e.fx[0].params[8 * NPAR + 1], .95)

    def test_old_saved_chains_and_bad_values(self):
        c = default_chain(); c['morph'] = dict(x=.2, y=.4, xMacro=2, yMacro=3)
        mo = validate_chain(c)['morph']
        self.assertEqual((mo['path'], mo['mode'], mo['mixMacro'], mo['x']), ('hand', 'follow', -1, .2))
        for bad in (dict(path='blob'), dict(mode='loop'), dict(rate=len(RATES)), dict(size=float('nan'))):
            c = default_chain(); c['morph'].update(bad)
            with self.assertRaises(ValueError): validate_chain(c)


if __name__ == '__main__':
    unittest.main()
