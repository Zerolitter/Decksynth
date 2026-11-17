"""Sound goldens: render a few fixed scenes and compare their loudness curve with the stored one.

Why: a speed-up of the engine must not quietly change how Decksynth sounds. Each scene (an effect, a
synth preset, a drum kit, a sampler pad, a whole project) is rendered from fixed settings. For every
1024 frames we keep the RMS and the peak, rounded, in tests/fixtures/goldens.json. Floats differ a
little between builds, so the check has a small tolerance.

A change of sound on purpose is an explicit step:
    DECKSYNTH_UPDATE_GOLDENS=1 python3 -m unittest tests.test_goldens
and then the new goldens.json is committed together with the change.
"""
import json
import math
import os
import shutil
import tempfile
import unittest
import wave
from pathlib import Path

from decksynth.core import Engine, Project, PRESETS, instrument
from decksynth.fx import ORDER, TrackFx, available, default_chain, validate_chain

R = 48000
CHUNK = 1024
FIXTURES = Path(__file__).parent / 'fixtures'
GOLDEN_FILE = FIXTURES / 'goldens.json'
ABS_TOL = 2e-3     # in sample units (full scale = 1.0)
REL_TOL = 0.02     # or 2 % of the stored value, whichever is larger


def summarize(samples):
    """RMS and peak for every CHUNK samples, rounded to 4 decimals."""
    rows = []
    for i in range(0, len(samples), CHUNK):
        part = samples[i:i + CHUNK]
        rms = math.sqrt(sum(v * v for v in part) / len(part))
        rows.append([round(rms, 4), round(max(abs(v) for v in part), 4)])
    return rows


def test_signal(n):
    """A fixed, repeatable input: two decaying tones plus a short burst of pseudo noise (no random module)."""
    out = []; seed = 12345
    for i in range(n):
        t = i / R
        v = .35 * math.sin(2 * math.pi * 220 * t) * math.exp(-t * 2) + .25 * math.sin(2 * math.pi * 330 * t)
        if 4000 <= i < 4600:
            seed = (seed * 1103515245 + 12345) & 0x7fffffff
            v += .3 * (seed / 0x7fffffff * 2 - 1)
        out.append(v)
    return out


FX_EXTRA = {'eq': {'low': 1, 'high': -1}, 'gate': {'depth': 1}, 'volume': {'level': .5}}


def fx_scene(module_id):
    """One effect on, default settings, half a second of input and a quarter second of silence for the tail."""
    fx = TrackFx(R); chain = default_chain()
    for m in chain['modules']:
        m['on'] = m['id'] == module_id
        if m['on']:
            # Defaults often leave an effect nearly dry; make it clearly audible so the golden means something.
            if 'mix' in m['params']: m['params']['mix'] = 1
            m['params'].update(FX_EXTRA.get(module_id, {}))
    fx.configure(validate_chain(chain))
    signal = test_signal(R // 2) + [0.] * (R // 4)
    out = []
    for i in range(0, len(signal), 512):
        if module_id == 'resonator':
            fx.tune([57])
        out += fx.process(signal[i:i + 512], 120, i / (R * .5))
    return out


def render_engine(e, frames):
    out = []
    while frames > 0:
        n = min(256, frames); out += e.render_stereo(n); frames -= n
    return out


def synth_scene(name):
    e = Engine(R)
    e.project.tracks[0]['instrument'] = instrument(name)
    e.configure()
    for i in range(1, 4):
        e.project.tracks[i]['mute'] = True
    for note in (48, 55, 60):
        e.voice_on(0, note, 100, ('live', 0, note, 0))
    out = render_engine(e, R // 2)
    for note in (48, 55, 60):
        e.voice_off(0, note, ('live', 0, note, 0))
    return out + render_engine(e, R // 4)


def write_tone(path, freq=330):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(R)
        w.writeframes(b''.join(int(9000 * math.sin(2 * math.pi * freq * i / R) * math.exp(-i / R)).to_bytes(2, 'little', signed=True)
                               for i in range(R // 2)))


class data_dir:
    """A temporary DECKSYNTH_DATA_DIR, so imported samples never touch the real library."""
    def __enter__(self):
        self.tmp = Path(tempfile.mkdtemp()); self.old = os.environ.get('DECKSYNTH_DATA_DIR')
        os.environ['DECKSYNTH_DATA_DIR'] = str(self.tmp)
        return self.tmp

    def __exit__(self, *exc):
        if self.old is None:
            os.environ.pop('DECKSYNTH_DATA_DIR', None)
        else:
            os.environ['DECKSYNTH_DATA_DIR'] = self.old
        shutil.rmtree(self.tmp, ignore_errors=True)


def drum_scene():
    with data_dir() as tmp:
        e = Engine(R); e.set_device(0, 'drum_rack'); kit = e.project.tracks[0]['drum_rack']
        for pad, freq in ((0, 80), (2, 330), (6, 2500)):
            write_tone(tmp / ('p%d.wav' % pad), freq); e.import_drum_sample(0, kit['id'], pad, str(tmp / ('p%d.wav' % pad)))
        for i in range(1, 4):
            e.project.tracks[i]['mute'] = True
        out = []
        for note in (36, 38, 42):
            e.voice_on(0, note, 110, ('live', 0, note, 0))
            out += render_engine(e, R // 4)
        return out


def sampler_scene():
    with data_dir() as tmp:
        write_tone(tmp / 'tone.wav')
        e = Engine(R)
        e.set_device(0, 'drum_rack'); kit = e.project.tracks[0]['drum_rack']
        e.import_drum_sample(0, kit['id'], 2, str(tmp / 'tone.wav'))
        e.make_sampler(0, kit['id'], 2, 1, 60)
        for i in (0, 2, 3):
            e.project.tracks[i]['mute'] = True
        e.voice_on(1, 60, 110, ('live', 0, 60, 0)); out = render_engine(e, R // 2)
        e.voice_on(1, 67, 110, ('live', 0, 67, 0)); out += render_engine(e, R // 2)
        return out


def project_scene(path, seconds=2):
    e = Engine(R); e.replace_project(Project.load(path)); e.playing = True
    return render_engine(e, R * seconds)


SYNTH_PRESETS = list(PRESETS)[:6]


def scenes():
    out = {}
    if available():
        for m in ORDER:
            out['fx:' + m] = lambda m=m: fx_scene(m)
    for name in SYNTH_PRESETS:
        out['synth:' + name] = lambda name=name: synth_scene(name)
    out['drum_rack'] = drum_scene
    out['sampler'] = sampler_scene
    out['project:m1a-chain-23'] = lambda: project_scene(FIXTURES / 'm1a-chain-23.decksynth')
    return out


def close(a, b):
    return abs(a - b) <= max(ABS_TOL, REL_TOL * abs(b))


class GoldenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stored = json.loads(GOLDEN_FILE.read_text()) if GOLDEN_FILE.exists() else {}
        cls.update = bool(os.environ.get('DECKSYNTH_UPDATE_GOLDENS'))
        cls.fresh = {}

    @classmethod
    def tearDownClass(cls):
        if cls.update and cls.fresh:
            GOLDEN_FILE.write_text(json.dumps(dict(sorted({**cls.stored, **cls.fresh}.items())), separators=(',', ':')) + '\n')

    def test_scenes_match_their_goldens(self):
        for name, make in scenes().items():
            with self.subTest(scene=name):
                samples = make()
                self.assertTrue(all(math.isfinite(v) for v in samples), name + ' is finite')
                rows = summarize(samples)
                if self.update:
                    self.fresh[name] = rows; continue
                self.assertIn(name, self.stored, name + ' has no golden: run with DECKSYNTH_UPDATE_GOLDENS=1')
                want = self.stored[name]
                self.assertEqual(len(rows), len(want), name + ' length changed')
                for i, ((rms, peak), (wrms, wpeak)) in enumerate(zip(rows, want)):
                    self.assertTrue(close(rms, wrms) and close(peak, wpeak),
                                    '%s sounds different at chunk %d: rms %.4f (was %.4f), peak %.4f (was %.4f). '
                                    'If on purpose: DECKSYNTH_UPDATE_GOLDENS=1' % (name, i, rms, wrms, peak, wpeak))

    def test_scenes_are_repeatable(self):
        """Two renders of the same scene must agree, otherwise a golden proves nothing."""
        for name in ('fx:reverb', 'synth:' + SYNTH_PRESETS[0], 'drum_rack'):
            with self.subTest(scene=name):
                make = scenes().get(name)
                if make is None:
                    self.skipTest('not available')
                self.assertEqual(summarize(make()), summarize(make()))


if __name__ == '__main__':
    unittest.main()
