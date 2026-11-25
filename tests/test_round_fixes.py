"""Fixes from Sir's test round of 25 Nov (Strike noise switch, preset noise setting, ...)."""
import math
import os
import shutil
import struct
import tempfile
import unittest
import wave
from pathlib import Path

from decksynth.core import Engine, Synth, instrument, validate_instrument
from decksynth import library

R = 48000


def play(p, note=60, secs=.3, block=256):
    s = Synth(R); s.configure(p); s.on(note, 100); out = []
    for _ in range(int(secs * R / block)): out += s.render(block)
    return out


class StrikeNoiseSwitchTest(unittest.TestCase):
    def test_noise_off_sounds_like_no_noise_and_a_missing_switch_is_on(self):
        p = dict(instrument('Warm Keys'), noise=.6, damp=0., pitch_env=0.)
        p.pop('noise_on', None)
        quiet = play(dict(p, noise=0.)); off = play(dict(p, noise_on=0)); on = play(p)
        self.assertEqual(quiet, off)
        self.assertNotEqual(on, off)                  # an old song without the key keeps its noise
        self.assertEqual(on, play(dict(p, noise_on=1)))
        validate_instrument(dict(p, noise_on=0))
        with self.assertRaises(Exception): validate_instrument(dict(p, noise_on=2))

    def test_presets_load_without_noise_unless_settings_ask(self):
        name = next(p['name'] for p in library.PRESET_LIBRARY if p['instrument'].get('noise', 0) > 0)
        e = Engine(R); e.apply_preset(name)
        ins = e.project.tracks[e.selected]['instrument']
        self.assertEqual(ins['noise_on'], 0); self.assertGreater(ins['noise'], 0)   # the knobs stay, the switch brings it back
        e.set_preset_options(True); e.apply_preset(name)
        self.assertNotEqual(e.project.tracks[e.selected]['instrument'].get('noise_on', 1), 0)
        with self.assertRaises(ValueError): e.set_preset_options('yes')


class NewTrackTargetTest(unittest.TestCase):
    """Make Sampler (and Slices to pads) can go to a new track at the end, in one undo step (Sir, 25 Nov)."""
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp()); os.environ['DECKSYNTH_DATA_DIR'] = str(self.dir)
        wav = self.dir / 'tone.wav'; n = R // 2
        with wave.open(str(wav), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(R)
            w.writeframes(struct.pack('<%dh' % n, *[round(16000 * math.sin(2 * math.pi * 440 * i / R)) for i in range(n)]))
        self.e = e = Engine(R); e.keep_tracks(1)
        e.set_device(0, 'drum_rack'); kit = e.project.tracks[0]['drum_rack']
        e.import_drum_sample(0, kit['id'], 2, str(wav)); self.kit = kit['id']

    def tearDown(self):
        os.environ.pop('DECKSYNTH_DATA_DIR', None); shutil.rmtree(self.dir, ignore_errors=True)

    def test_make_sampler_on_a_new_track_keeps_the_kit_and_undoes_in_one_step(self):
        e = self.e; steps = len(e.history)
        made = e.make_sampler(0, self.kit, 2, 1, 60)
        self.assertEqual(made['track'], 1); self.assertEqual(len(e.project.tracks), 2)
        self.assertEqual(e.project.tracks[0]['device'], 'drum_rack'); self.assertEqual(e.project.tracks[1]['device'], 'sampler')
        out = []
        e.voice_on(1, 60, 110, ('live', 0, 0, 0))
        for _ in range(20): out += e.render(256)
        self.assertGreater(max(abs(v) for v in out), .01)
        self.assertEqual(len(e.history), steps + 1)
        e.undo_any(); self.assertEqual(len(e.project.tracks), 1)
        with self.assertRaises(ValueError): e.make_sampler(0, self.kit, 2, 3, 60)    # not past the new one


if __name__ == '__main__':
    unittest.main()
