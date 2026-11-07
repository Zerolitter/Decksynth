"""The five new effects, old chains loading, and the richer mod pads."""
import math
import unittest
from decksynth.fx import (ORDER, PARAMS, TrackFx, default_chain, validate_chain, shape_value, mod_value,
                          curve_value, available)
from decksynth.core import Engine

NEW = ['chorus', 'compressor', 'eq', 'autowah', 'resonator']


def tone(n, f=220., rate=48000, amp=.5):
    return [amp * math.sin(2 * math.pi * f * i / rate) for i in range(n)]


def rms(x): return math.sqrt(sum(v * v for v in x) / len(x))


@unittest.skipUnless(available(), 'native FX library not built')
class NewEffectTests(unittest.TestCase):
    def run_fx(self, mid, params=None, samples=None, n=9600):
        fx = TrackFx(48000); c = default_chain()
        for m in c['modules']:
            if m['id'] == mid: m['on'] = True; m['params'].update(params or {})
        fx.configure(validate_chain(c))
        x = samples or tone(n)
        out = []
        for i in range(0, len(x), 512):
            if mid == 'resonator': fx.tune([57])
            out += fx.process(x[i:i + 512], 120, 0)
        return x, out, fx

    def test_every_new_effect_changes_the_sound_and_stays_finite(self):
        for mid in NEW:
            x, y, _ = self.run_fx(mid, {'mix': 1} if 'mix' in dict((k, 0) for k, *_ in PARAMS[mid]) else {'low': 1, 'high': -1})
            self.assertTrue(all(math.isfinite(v) for v in y), mid)
            self.assertGreater(max(abs(a - b) for a, b in zip(x, y)), 1e-3, mid + ' does something')
            self.assertLess(max(abs(v) for v in y), 4, mid + ' stays in range')

    def test_compressor_turns_loud_signals_down(self):
        x, y, fx = self.run_fx('compressor', {'amount': 1, 'ratio': 3, 'makeup': 0, 'mix': 1}, tone(9600, amp=.9))
        self.assertLess(rms(y[4800:]), rms(x[4800:]) * .5)
        self.assertGreater(fx.comp_reduction(), 6)

    def test_eq_low_boost_raises_bass_only(self):
        _, low, _ = self.run_fx('eq', {'low': 1}, tone(9600, 80))
        _, high, _ = self.run_fx('eq', {'low': 1}, tone(9600, 6000))
        self.assertGreater(rms(low[4800:]), rms(tone(9600, 80)[4800:]) * 2.5)
        self.assertLess(abs(rms(high[4800:]) - rms(tone(9600, 6000)[4800:])), .05)

    def test_resonator_rings_on_after_the_input_stops(self):
        burst = [((i * 7919) % 200) / 100 - 1 for i in range(2400)] + [0.] * 9600
        _, y, fx = self.run_fx('resonator', {'decay': .8, 'mix': 1}, burst)
        self.assertGreater(rms(y[6000:9000]), 1e-3, 'strings keep ringing')
        self.assertEqual(fx.tuned, [57, 69])

    def test_resonator_follows_the_played_notes(self):
        e = Engine(48000)
        c = default_chain()
        for m in c['modules']:
            if m['id'] == 'resonator': m['on'] = True
        e.set_fx(e.selected, c)
        e.midi(0x90, 60, 100); e.midi(0x90, 64, 100); e.render(512)
        self.assertEqual(e.fx[e.selected].tuned, [60, 64, 72, 76])


class ChainMigrationTests(unittest.TestCase):
    def test_old_chain_with_eleven_effects_loads_with_the_new_ones_off(self):
        c = default_chain(); c['modules'] = [m for m in c['modules'] if m['id'] not in NEW]
        for m in c['mods']:
            for k in ('feel', 'count', 'points'): m.pop(k)
        out = validate_chain(c)
        self.assertEqual(sorted(m['id'] for m in out['modules']), sorted(ORDER))
        self.assertFalse(any(m['on'] for m in out['modules'] if m['id'] in NEW))
        self.assertEqual((out['mods'][0]['feel'], out['mods'][0]['count']), ('', 16))

    def test_bad_mod_settings_are_rejected(self):
        for key, bad in (('feel', 'X'), ('count', 5), ('points', [[0, 0]]), ('shape', 'zigzag')):
            c = default_chain(); c['mods'][0][key] = bad
            with self.assertRaises(ValueError, msg=key): validate_chain(c)


class ModPadTests(unittest.TestCase):
    def test_new_shapes(self):
        self.assertEqual(shape_value('ramp', 0, []), -1); self.assertAlmostEqual(shape_value('ramp', .75, []), .5)
        self.assertEqual(shape_value('pulse', .2, []), 1); self.assertEqual(shape_value('pulse', .3, []), -1)
        self.assertTrue(-1 <= shape_value('smooth', .37, [], 3) <= 1)

    def test_curve_points_with_wrap(self):
        pts = [[.25, 1.], [.75, -1.]]
        self.assertAlmostEqual(curve_value(pts, .5), 0)
        self.assertAlmostEqual(curve_value(pts, .25), 1)
        self.assertAlmostEqual(curve_value(pts, 0), 0, msg='wraps from the last point to the first')

    def test_merged_steps(self):
        steps = [float(i) / 16 for i in range(16)]
        self.assertEqual([shape_value('steps', i / 16, steps, count=4) for i in range(16)][:8], [0] * 4 + [.25] * 4)

    def test_triplet_and_dotted_rates(self):
        m = dict(shape='ramp', rate=4, steps=[0.] * 16, feel='T')   # 1/4 beat cycle, triplet: 2/3 beat
        self.assertAlmostEqual(mod_value(m, 1 / 3)[1], .5)
        m['feel'] = 'D'                                                # dotted: 1.5 beats
        self.assertAlmostEqual(mod_value(m, .75)[1], .5)


if __name__ == '__main__':
    unittest.main()
