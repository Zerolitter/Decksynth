import math
import time
import unittest

from decksynth.core import Engine
from decksynth.fx import default_chain, validate_chain


def linked(param, depth=1., shape='square', rate=6, kind='mod'):
    c = default_chain()
    src = c['mods'][0] if kind == 'mod' else c['macros'][0]
    if kind == 'mod': src.update(shape=shape, rate=rate)
    src['targets'] = [dict(module='sound', param=param, depth=depth)]
    return c


def rms(xs): return math.sqrt(sum(x * x for x in xs) / len(xs))


class SoundModTests(unittest.TestCase):
    def test_sound_targets_validate(self):
        self.assertEqual(validate_chain(linked('sustain'))['mods'][0]['targets'][0]['module'], 'sound')
        with self.assertRaises(ValueError): validate_chain(linked('wobble'))

    def test_mod_pad_moves_sustain_without_touching_the_saved_sound(self):
        e = Engine(48000); e.set_fx(0, linked('sustain', depth=.6)); saved = e.project.tracks[0]['instrument']['sustain']
        seen = set()
        for _ in range(40):
            e.render(256); seen.add(round(e.synths[0].live['sustain'], 3))
        self.assertGreater(len(seen), 1, 'sustain follows the square pad')
        self.assertEqual(e.project.tracks[0]['instrument']['sustain'], saved)
        self.assertIn('sustain', e.fx_live(0)['sound'])
        e.set_fx(0, default_chain()); e.render(256)
        self.assertIsNone(e.synths[0].live, 'unlinking hands the knob back to the saved sound')

    def test_macro_on_brightness_rebuilds_the_wavetable(self):
        e = Engine(48000); c = linked('filter', depth=-1., kind='macro'); e.set_fx(0, c)
        e.voice_on(0, 60, 100, ('t', 0)); e.render(512); bright = e.synths[0].voices[('t', 0)]['table']
        c['macros'][0]['value'] = 1.; e.set_fx(0, c); e.render(512)
        dark = e.synths[0].voices[('t', 0)]['table']
        self.assertIsNot(bright, dark)
        part = lambda t, k: abs(sum(v * math.sin(2 * math.pi * k * i / len(t)) for i, v in enumerate(t)))
        hf = lambda t: part(t, 4) / part(t, 1)  # 4th partial against the fundamental
        self.assertLess(hf(dark), hf(bright) * .5, 'turning Brightness down takes the upper partials out')
        self.assertAlmostEqual(e.fx_live(0)['sound']['filter'], .02)

    def test_volume_link_changes_the_track_level(self):
        def level(depth):
            e = Engine(48000); c = linked('volume', depth=depth, kind='macro'); c['macros'][0]['value'] = 1.
            e.set_fx(0, c); e.voice_on(0, 60, 100, ('t', 0)); return rms(e.render(4800)[2400:])
        self.assertLess(level(-1.), level(0.) * .05)

    def test_clean_up_effects_keeps_sound_links(self):
        e = Engine(48000); c = linked('sustain'); c['mods'][1]['targets'] = [dict(module='filter', param='cutoff', depth=.5)]
        e.set_fx(0, c); e.cleanup('effects')
        fx = e.project.tracks[0]['fx']
        self.assertEqual(fx['mods'][0]['targets'][0]['param'], 'sustain'); self.assertEqual(fx['mods'][1]['targets'], [])

    def test_a_fast_brightness_pad_stays_cheap(self):
        def cost(chain):
            e = Engine(48000); e.set_fx(0, chain)
            for n in (48, 55, 60, 64, 67): e.voice_on(0, n, 100, ('t', n))
            t = time.perf_counter(); e.render(48000); return time.perf_counter() - t
        plain = cost(default_chain())
        moving = cost(linked('filter', depth=1., shape='sine', rate=6))  # 1/16 sine on Brightness
        self.assertLess(moving, plain * 1.6 + .15, f'{moving:.3f}s against {plain:.3f}s')


if __name__ == '__main__':
    unittest.main()
