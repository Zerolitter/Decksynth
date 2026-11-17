"""Save / load round trip, and the lists that must only ever grow.

Old projects (like the reference song "noice") have to open after every update. Two rules protect them:
1. A saved project loads back to exactly what was saved, at edge values too (0, False, empty, maximum).
2. Lists that projects refer to by position or name only get new entries at the end.
"""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from decksynth import fx as fxmod
from decksynth import song as songs
from decksynth.core import BAR_CHOICES, Project

FIXTURES = Path(__file__).parent / 'fixtures'
BENCH = Path(__file__).parent.parent / 'tools' / 'bench'
OLD_PROJECTS = [FIXTURES / 'm1a-chain-23.decksynth', FIXTURES / 'spectral_s1_legacy.decksynth', BENCH / 'stress4.decksynth']

# Positions saved in projects. New entries go at the END only; this test fails if one is moved or removed.
APPEND_ONLY = {
    'effect order': (fxmod.ORDER, ['stutter', 'filter', 'overdrive', 'bitcrusher', 'volume', 'phaser', 'flanger', 'ringmod',
                                   'delay', 'reverb', 'time', 'chorus', 'compressor', 'eq', 'autowah', 'resonator', 'gate',
                                   'cloud', 'pitch', 'autotune', 'duck', 'vocoder']),
    'LFO shapes': (fxmod.SHAPES[:10], ['sine', 'triangle', 'saw', 'ramp', 'square', 'pulse', 'random', 'smooth', 'steps', 'curve']),
    'LFO rates': (fxmod.RATES, [16, 8, 4, 2, 1, .5, .25, 32, 64, 128]),
    'morph paths': (fxmod.PATHS, ['hand', 'circle', 'eight', 'flower', 'triangle', 'square', 'spiral', 'star', 'wave', 'drift']),
    'morph modes': (fxmod.MORPH_MODES, ['follow', 'retrigger', 'freeze']),
    'step counts': (fxmod.STEP_COUNTS, (4, 8, 16)),
    'gate lengths': (fxmod.GATE_LENGTHS, (4, 6, 8, 9, 12, 16)),
    'bar choices': (BAR_CHOICES, (1, 2, 4, 8, 16, 32)),
}


PARAM_ORDER = {
    'stutter': ['length', 'speed', 'repeats', 'mix'],
    'filter': ['mode', 'cutoff', 'reso', 'mix'],
    'overdrive': ['drive', 'mix'],
    'bitcrusher': ['rate', 'bits', 'mix'],
    'volume': ['level', 'mix'],
    'phaser': ['rate', 'depth', 'feedback', 'mix'],
    'flanger': ['rate', 'depth', 'feedback', 'mix'],
    'ringmod': ['freq', 'drive', 'mix'],
    'delay': ['time', 'feedback', 'mix', 'width'],
    'reverb': ['predelay', 'decay', 'locut', 'hicut', 'mix', 'width'],
    'time': ['speed', 'mix'],
    'chorus': ['rate', 'depth', 'voices', 'mix', 'width', 'haas'],
    'compressor': ['amount', 'ratio', 'attack', 'release', 'makeup', 'mix'],
    'eq': ['low', 'mid', 'freq', 'high'],
    'autowah': ['sens', 'base', 'range', 'reso', 'mix'],
    'resonator': ['decay', 'tone', 'mix', 'strings'],
    'gate': ['length', 'division', 'steps', 'smooth', 'depth', 'pump'],
    'cloud': ['time', 'density', 'scatter', 'feedback', 'tone', 'mix'],
    'pitch': ['semis', 'cents', 'mix'],
    'autotune': ['speed', 'amount', 'mix'],
    'duck': ['source', 'amount', 'sens', 'attack', 'release'],
    'vocoder': ['source', 'response', 'shift', 'air', 'mix'],
}


def save_load(project):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'p.decksynth'
        project.save(path)
        text = path.read_text()
        return Project.load(path), text


class AppendOnlyTests(unittest.TestCase):
    def test_lists_only_grow_at_the_end(self):
        for name, (now, original) in APPEND_ONLY.items():
            with self.subTest(list=name):
                self.assertEqual(list(now)[:len(original)], list(original), name + ' changed or was reordered')

    def test_every_effect_keeps_its_parameters_in_order(self):
        """The native code reads parameters by position: a new parameter goes last, never in the middle."""
        for m, keys in PARAM_ORDER.items():
            with self.subTest(effect=m):
                self.assertEqual([k for k, *_ in fxmod.PARAMS[m]][:len(keys)], keys)


class RoundTripTests(unittest.TestCase):
    def assert_same(self, project):
        loaded, text = save_load(project)
        self.assertEqual(loaded.saved_data(), project.saved_data())
        # The first load may put keys in a different order; after that, saving must be stable.
        again, text2 = save_load(loaded)
        self.assertEqual(json.loads(text), json.loads(text2), 'saving twice changes the file')
        self.assertEqual(save_load(again)[1], text2, 'the file keeps changing on every save')
        return loaded

    def test_default_project(self):
        self.assert_same(Project())

    def test_edge_values_come_back(self):
        p = Project()
        p.bpm = 30; p.bars = BAR_CHOICES[-1]; p.metronome = True
        t0, t1 = p.tracks[0], p.tracks[1]
        t0['volume'] = 0; t0['mute'] = True; t0['notes'] = []
        t1['volume'] = 1; t1['mute'] = False
        beats = p.bars * 4
        t1['notes'] = [dict(start=0, duration=beats, note=0, velocity=1),
                       dict(start=beats - .25, duration=.25, note=127, velocity=127)]
        loaded = self.assert_same(p)
        self.assertEqual(loaded.bpm, 30); self.assertIs(loaded.metronome, True)
        self.assertEqual(loaded.tracks[0]['volume'], 0); self.assertIs(loaded.tracks[0]['mute'], True)
        self.assertEqual(loaded.tracks[0]['notes'], [])
        p.bpm = 240; p.bars = 1; p.metronome = False
        for t in p.tracks:
            t['notes'] = []
        self.assert_same(p)

    def test_every_bar_length(self):
        for bars in BAR_CHOICES:
            with self.subTest(bars=bars):
                p = Project(); p.bars = bars
                p.song = songs.defaults(bars, len(p.tracks)); p.clips = songs.empty_clips(len(p.tracks))
                self.assertEqual(save_load(p)[0].bars, bars)

    def test_every_effect_at_its_lowest_and_highest_setting(self):
        for edge in (1, 2):  # 1 = minimum, 2 = maximum
            p = Project(); chain = fxmod.default_chain()
            for m in chain['modules']:
                m['on'] = True
                for k, lo, hi, _init in fxmod.PARAMS[m['id']]:
                    m['params'][k] = (lo, hi)[edge - 1]
            p.tracks[0]['fx'] = fxmod.validate_chain(chain)
            with self.subTest(edge=edge):
                loaded = self.assert_same(p)
                for m in loaded.tracks[0]['fx']['modules']:
                    self.assertIs(m['on'], True)
                    for k, lo, hi, _init in fxmod.PARAMS[m['id']]:
                        self.assertEqual(m['params'][k], (lo, hi)[edge - 1], m['id'] + '.' + k)

    def test_missing_optional_parts_mean_defaults(self):
        """A file from before a feature existed has no key for it: loading fills in the default."""
        p = Project()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'old.decksynth'; p.save(path)
            data = json.loads(path.read_text())
            for key in ('song', 'clips', 'performance', 'sends'):
                data.pop(key, None)
            for t in data['tracks']:
                for key in ('fx', 'freeze', 'sends', 'automation', 'sound_ab', 'midi_cc'):
                    t.pop(key, None)
            path.write_text(json.dumps(data))
            loaded = Project.load(path)
        self.assertEqual(loaded.song['on'], songs.defaults(loaded.bars, len(loaded.tracks))['on'])
        self.assertEqual(loaded.sends, Project().sends)
        self.assertFalse(loaded.performance['seq']['recording'])

    def test_recording_arm_is_never_resumed(self):
        p = Project(); p.performance['seq']['recording'] = True
        self.assertFalse(save_load(p)[0].performance['seq']['recording'])

    def test_bad_files_are_refused_not_half_loaded(self):
        for edit in (lambda d: d.update(version=2), lambda d: d.update(bpm=0), lambda d: d.update(bars=33),
                     lambda d: d['tracks'][0].update(volume=2), lambda d: d['tracks'][0].update(name=5)):
            with self.subTest(edit=edit), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / 'bad.decksynth'; Project().save(path)
                data = json.loads(path.read_text()); edit(data); path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    Project.load(path)


class OldProjectTests(unittest.TestCase):
    def test_old_projects_open_and_round_trip(self):
        for path in OLD_PROJECTS:
            with self.subTest(project=path.name):
                project = Project.load(path)
                loaded, text = save_load(project)
                self.assertEqual(loaded.saved_data(), project.saved_data())
                self.assertEqual(json.loads(save_load(loaded)[1]), json.loads(text))

    def test_old_projects_keep_their_notes(self):
        for path in OLD_PROJECTS:
            with self.subTest(project=path.name):
                raw = json.loads(path.read_text())
                loaded = Project.load(path)
                self.assertEqual([t['notes'] for t in loaded.tracks], [t['notes'] for t in raw['tracks']])
                self.assertEqual((loaded.bpm, loaded.bars), (raw['bpm'], raw['bars']))


if __name__ == '__main__':
    unittest.main()
