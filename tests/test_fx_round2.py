"""Round 2 effects (16 Nov): Pitch shift, Auto-tune, Ducking and Vocoder."""
import math
import subprocess
import sys
import unittest
from pathlib import Path
from decksynth.fx import ORDER, TrackFx, default_chain, validate_chain, available
from decksynth.filter_native import library_path
from decksynth.core import Engine

ROOT = Path(__file__).resolve().parents[1]
R2 = ['pitch', 'autotune', 'duck', 'vocoder']


def rms(x): return math.sqrt(sum(v * v for v in x) / max(1, len(x)))


def chain(**on):
    c = default_chain()
    for m in c['modules']:
        if m['id'] in on: m['on'] = True; m['params'].update(on[m['id']])
    return validate_chain(c)


@unittest.skipUnless(library_path().exists(), 'cached native FX kernel not built')
class NativeDsp(unittest.TestCase):
    def test_signal_checks(self):
        """Pitch lands within 15 cents, auto-tune within 20, ducking and vocoder follow their source."""
        out = subprocess.run([sys.executable, str(ROOT / 'tools/check-fx-round2.py'), str(library_path())],
                             capture_output=True, text=True, timeout=300)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        self.assertIn('ALL OK', out.stdout)


@unittest.skipUnless(available(), 'native FX library not built')
class Chain(unittest.TestCase):
    def test_new_effects_are_in_the_chain_and_off_in_old_projects(self):
        self.assertEqual(ORDER[-4:], R2)
        c = default_chain(); c['modules'] = [m for m in c['modules'] if m['id'] not in R2]
        out = validate_chain(c)
        self.assertEqual(sorted(m['id'] for m in out['modules']), sorted(ORDER))
        self.assertFalse(any(m['on'] for m in out['modules'] if m['id'] in R2))

    def test_source_is_a_whole_track_number(self):
        c = chain(duck={'source': 2.4})
        self.assertEqual(next(m for m in c['modules'] if m['id'] == 'duck')['params']['source'], 2.0)

    def test_key_sources_only_while_heard(self):
        fx = TrackFx(48000); fx.configure(chain(duck={'source': 1}))
        self.assertEqual(fx.key_sources(), [1, None])
        fx.configure(chain(vocoder={'source': 3}))
        self.assertEqual(fx.key_sources(), [None, 3])
        fx.configure(chain())
        self.assertEqual(fx.key_sources(), [None, None])


@unittest.skipUnless(library_path().exists(), 'cached native FX kernel not built')
class EngineRouting(unittest.TestCase):
    def test_one_track_ducks_another(self):
        e = Engine(48000)
        e.selected = 1; e.set_fx(1, chain(duck={'source': 0, 'amount': 1, 'sens': .6, 'release': .2}))
        e.selected = 1; e.midi(0x90, 60, 100)  # a held note on track 2
        quiet = []
        for _ in range(20): quiet += e.render(512)
        level = rms(quiet[-4096:])
        self.assertGreater(level, 1e-3)
        e.selected = 0; e.midi(0x90, 48, 127)  # track 1 plays: track 2 goes down
        loud = []
        for _ in range(6): loud += e.render(512)
        readout = e.fx_live(1)['readout']
        self.assertGreater(readout['duck'], 3, readout)

    def test_auto_tune_follows_the_project_scale(self):
        e = Engine(48000)
        e.project.performance['scale'].update(name='Minor', root=2)
        e.set_fx(e.selected, chain(autotune={'speed': 0}))
        e.render(512)
        self.assertEqual(e.fx[e.selected]._scale, (sum(1 << s for s in (0, 2, 3, 5, 7, 8, 10)), 2))


if __name__ == '__main__':
    unittest.main()
