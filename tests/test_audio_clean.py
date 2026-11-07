"""The engine's output stays free of clicks and hard clipping in the cases that used to pop."""
import unittest
import decksynth.core as core
from decksynth.core import Engine
from decksynth.diagnose import clicks, four_tracks
from decksynth.fx import default_chain, default_module, validate_chain


def render(e, blocks, during=None):
    out = []
    for i in range(blocks):
        if during: during(e, i)
        out += e.render(256)
    return out


class CleanAudio(unittest.TestCase):
    def test_retriggered_note_fades(self):
        def f(e, i):
            if i % 20 == 0: e.midi(0x90, 60, 100)
            if i % 20 == 10: e.midi(0x80, 60, 0)
        self.assertEqual(clicks(render(Engine(48000), 300, f)), 0)

    def test_voice_stealing_fades(self):
        def f(e, i):
            if i % 3 == 0: e.midi(0x90, 40 + (i // 3) % 40, 100)
        self.assertEqual(clicks(render(Engine(48000), 300, f)), 0)

    def test_brightness_mod_crossfades_tables(self):
        e = Engine(48000); c = validate_chain(default_chain())
        c['mods'][0].update(rate=6, targets=[{'module': 'sound', 'param': 'curve', 'depth': .8}])
        e.set_fx(0, c); [e.midi(0x90, n, 100) for n in (48, 52, 55)]
        self.assertEqual(clicks(render(e, 300)), 0)

    def test_effect_switching_and_stepped_mods_glide(self):
        e = Engine(48000); c = validate_chain(default_chain())
        c['modules'] = [dict(default_module('volume'), on=True)] + [m for m in c['modules'] if m['id'] != 'volume']
        c['mods'][0].update(shape='steps', steps=[1, -1] * 8, rate=5, targets=[{'module': 'volume', 'param': 'level', 'depth': 1}])
        e.set_fx(0, validate_chain(c)); [e.midi(0x90, n, 100) for n in (48, 52)]
        on = validate_chain(c); off = validate_chain({**c, 'modules': [dict(m, on=False) for m in c['modules']]})
        out = render(e, 300, lambda e, i: e.set_fx(0, on if (i // 40) % 2 == 0 else off) if i % 40 == 0 else None)
        self.assertLess(clicks(out), 10)

    def test_loud_mix_is_limited_not_clipped(self):
        e = Engine(48000)
        for t in range(4):
            e.selected = t
            for n in (36, 43, 48, 52, 55, 60, 64, 67): e.midi(0x90, n, 127)
        out = render(e, 200)
        self.assertLessEqual(max(abs(x) for x in out), .96)
        flat = sum(1 for a, b in zip(out, out[1:]) if abs(a) > .94 and a == b)
        self.assertEqual(flat, 0, 'no flattened (hard-clipped) runs')

    def test_native_voice_matches_python(self):
        def run(native):
            orig = core.native_voice
            if not native: core.native_voice = lambda: None
            try:
                e = Engine(48000); four_tracks(e)
                return render(e, 120, lambda e, i: e.midi(0x90, 60, 100) if i == 20 else e.midi(0x80, 60, 0) if i == 70 else None)
            finally: core.native_voice = orig
        a, b = run(True), run(False)
        self.assertLess(max(abs(x - y) for x, y in zip(a, b)), 1e-9)


if __name__ == '__main__':
    unittest.main()
