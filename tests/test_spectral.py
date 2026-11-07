import math, os, tempfile, unittest
from decksynth.core import Engine, Project, Synth, spectral_gain, SPECTRAL_DEFAULTS

def render(params, note=60, frames=4800):
    s = Synth(48000); p = dict(s.params); p.update(params); s.configure(p); s.on(note, 100); return s.render(frames)

def spectrum(out, k, f0):
    n = len(out); re = sum(x * math.cos(2 * math.pi * f0 * k * i / 48000) for i, x in enumerate(out))
    im = sum(x * math.sin(2 * math.pi * f0 * k * i / 48000) for i, x in enumerate(out)); return math.hypot(re, im) / n

class SpectralTests(unittest.TestCase):
    def test_neutral_values_are_bit_identical(self):
        self.assertEqual(render({}), render(dict(SPECTRAL_DEFAULTS)))
        for k in range(1, 17): self.assertEqual(spectral_gain(SPECTRAL_DEFAULTS, k), 1)

    def test_each_macro_measurably_changes_the_spectrum(self):
        f0 = 440 * 2 ** ((60 - 69) / 12); flat = {'harmonics': [1.] * 16, 'filter': 1.}
        base = render(flat)
        ratio = lambda o: spectrum(o, 6, f0) / spectrum(o, 1, f0)
        self.assertGreater(ratio(render({**flat, 'curve': 1.})), ratio(base) * 2)
        self.assertLess(ratio(render({**flat, 'curve': -1.})), ratio(base) / 2)
        self.assertGreater(ratio(render({**flat, 'balance': 1.})), ratio(base) * 1.5)
        focused = render({**flat, 'focus': 1., 'focus_center': 6})
        self.assertGreater(ratio(focused), ratio(base) * 5)

    def test_saved_partials_are_not_rewritten(self):
        e = Engine(48000); h = list(e.project.tracks[0]['instrument']['harmonics'])
        e.project.tracks[0]['instrument']['curve'] = .8; e.configure()
        self.assertEqual(e.project.tracks[0]['instrument']['harmonics'], h)

    def test_project_saves_and_rejects_bad_values(self):
        p = Project(); p.tracks[0]['instrument'].update(curve=.4, balance=.7, focus=.5, focus_center=8)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'p.json'); p.save(path)
            self.assertEqual(Project.load(path).tracks[0]['instrument']['focus_center'], 8)
            p.tracks[0]['instrument']['curve'] = 5; p.save(path)
            with self.assertRaises(Exception): Project.load(path)

if __name__ == '__main__': unittest.main()
