"""The C buffers and mix bus (cbus.py) must sound exactly like the Python mix they replace.

Each scene is rendered twice, once with the Python mix (engine.python_bus = True) and once with the
track audio kept in C buffers, and the two renders must match sample for sample.
"""
import unittest
from pathlib import Path

from decksynth import cbus
from decksynth.core import Engine, Project
from decksynth.fx import default_chain
from tests.test_goldens import R, data_dir, render_engine, write_tone

STRESS = Path(__file__).resolve().parents[1] / 'tools' / 'bench' / 'stress4.decksynth'


def mixed_scene(python_bus):
    """Drum Rack, Sampler and two synths, with pan glides, both sends, Ducking keyed from the drums,
    a muted track's key, the metronome and a note-heavy stretch."""
    with data_dir() as tmp:
        e = Engine(R); e.python_bus = python_bus
        e.set_device(0, 'drum_rack'); kit = e.project.tracks[0]['drum_rack']
        for pad, freq in ((0, 80), (2, 330), (6, 2500)):
            write_tone(tmp / ('p%d.wav' % pad), freq); e.import_drum_sample(0, kit['id'], pad, str(tmp / ('p%d.wav' % pad)))
        write_tone(tmp / 'tone.wav', 440)
        e.import_drum_sample(0, kit['id'], 3, str(tmp / 'tone.wav'))
        e.make_sampler(0, kit['id'], 3, 1, 60)
        e.project.tracks[2]['instrument']['pan'] = .5
        e.set_send(2, 'reverb', .4); e.set_send(2, 'delay', .3); e.set_send(0, 'reverb', .2)
        chain = default_chain()
        duck = next(m for m in chain['modules'] if m['id'] == 'duck')
        duck['on'] = True; duck['params']['source'] = 0
        e.set_fx(3, chain)
        e.project.metronome = True; e.playing = True
        out = []
        for note in (36, 38, 42):
            e.voice_on(0, note, 110, ('live', 0, note, 0))
        e.voice_on(1, 60, 110, ('live', 1, 60, 0))
        for note in (48, 55, 60, 64):
            e.voice_on(2, note, 100, ('live', 2, note, 0)); e.voice_on(3, note + 12, 90, ('live', 3, note, 0))
        out += render_engine(e, R // 2 + 77)
        e.project.tracks[2]['instrument']['pan'] = -.6  # a pan glide inside a block
        e.project.tracks[0]['mute'] = True              # its key still feeds the Ducking
        for note in (48, 55, 60, 64):
            e.voice_off(2, note, ('live', 2, note, 0))
        out += render_engine(e, R // 2)
        e.master_enabled = False                        # the Python limiter after the C mix
        out += render_engine(e, R // 4)
        return out


def stress_scene(python_bus):
    e = Engine(R); e.python_bus = python_bus
    e.replace_project(Project.load(str(STRESS))); e.playing = True
    for n in (48, 55, 60, 64, 67, 72): e.midi(0x90, n, 100)
    out = render_engine(e, R)
    for n in (48, 55, 60, 64, 67, 72): e.midi(0x80, n, 0)
    return out + render_engine(e, R // 2)


@unittest.skipUnless(cbus.available(), 'needs the native FX library with the buffer routines')
class CBusMatchesPythonMix(unittest.TestCase):
    def check(self, scene):
        a = scene(True); b = scene(False)
        self.assertEqual(len(a), len(b))
        self.assertGreater(max(map(abs, a)), 1e-3)  # the scene makes sound
        diff = [i for i, (x, y) in enumerate(zip(a, b)) if x != y]
        self.assertEqual(diff[:5], [], 'first differing samples')

    def test_mixed_scene(self):
        self.check(mixed_scene)

    def test_stress_project(self):
        self.check(stress_scene)


if __name__ == '__main__':
    unittest.main()
