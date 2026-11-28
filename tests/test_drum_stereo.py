"""Drum Rack batch (28 Nov): a stereo pad sample stays stereo through the pad mix, with Fade in / Fade out."""
import math
import struct
import tempfile
import unittest
import wave
from array import array
from pathlib import Path

from decksynth.core import Engine, Project
from decksynth.drum_shape import PadShaper

R = 48000


def write(path, left, right=None, seconds=.4):
    """A WAV: left and right are (freq, amp) sines; right None makes it mono."""
    n = int(seconds*R); chans = [left] if right is None else [left, right]
    frames = [round(32000*a*math.sin(2*math.pi*f*i/R)) for i in range(n) for f, a in chans]
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(len(chans)); w.setsampwidth(2); w.setframerate(R)
        w.writeframes(struct.pack('<%dh' % len(frames), *frames))
    return path


def rms(x):
    return math.sqrt(sum(a*a for a in x)/max(1, len(x)))


class StereoPadTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.e = Engine(); self.e.set_device(0, 'drum_rack')
        self.kit = self.e.project.tracks[0]['drum_rack']['id']

    def assign(self, path, pad=0):
        self.e.import_drum_sample(0, self.kit, pad, str(path)); PadShaper.wait()

    def hit(self, frames=9600, native=True):
        rack = self.e.drums[0]
        if not native: rack._native = None
        rack.panic(); self.e.drum_note(0, self.kit, 0, 127)
        out = [0.]*frames; right = [0.]*frames
        rack.render_into(out, frames, right)
        return out, right

    def test_left_only_pad_stays_left(self):
        self.assign(write(self.dir/'l.wav', (480, .5), (0, 0)))
        left, right = self.hit()
        self.assertGreater(rms(left), .05); self.assertLess(rms(right), 1e-4)

    def test_two_different_channels_play_apart(self):
        self.assign(write(self.dir/'w.wav', (480, .5), (960, .25)))
        left, right = self.hit()
        self.assertAlmostEqual(rms(left)/rms(right), 2., delta=.1)

    def test_python_mixer_matches_native(self):
        self.assign(write(self.dir/'w.wav', (480, .5), (960, .25)))
        a = self.hit(); b = self.hit(native=False)
        for x, y in zip(a, b):
            self.assertLess(max(abs(p-q) for p, q in zip(x, y)), 1e-6)

    def test_mono_pad_plays_the_same_in_both_channels(self):
        self.assign(write(self.dir/'m.wav', (480, .5)))
        left, right = self.hit()
        self.assertEqual(left, right); self.assertGreater(rms(left), .05)
        self.assertIsNone(self.e.drums[0].samples[0].side)

    def test_the_rack_says_which_pads_are_stereo(self):
        self.assign(write(self.dir/'w.wav', (480, .5), (960, .25)), 0)
        self.assign(write(self.dir/'m.wav', (480, .5)), 1)
        pads = self.e.drums[0].state()['pads'] if hasattr(self.e.drums[0], 'state') else None
        self.assertEqual((pads[0]['stereo'], pads[1]['stereo'], pads[2]['stereo']), (True, False, False))

    def test_pan_still_works_on_a_stereo_pad(self):
        self.assign(write(self.dir/'w.wav', (480, .5), (480, .25)))
        self.e.edit_drum_pad(0, self.kit, 0, 'shape', dict(pan=-1.)); PadShaper.wait()
        left, right = self.hit()
        self.assertLess(rms(right), 1e-3); self.assertGreater(rms(left), .05)

    def test_fades_apply_to_both_channels(self):
        self.assign(write(self.dir/'w.wav', (480, .5), (960, .5)))
        self.e.edit_drum_pad(0, self.kit, 0, 'shape', dict(fade_in=.1, fade_out=.1)); PadShaper.wait()
        s = self.e.drums[0].samples[0]
        self.assertTrue(s.stereo)
        n = s.frames; edge = int(.02*R)
        for channel in ([m+d for m, d in zip(s.data, s.side)], [m-d for m, d in zip(s.data, s.side)]):
            self.assertLess(max(map(abs, channel[:int(.005*R)])), .05, 'starts quiet')
            self.assertLess(max(map(abs, channel[n-int(.005*R):])), .05, 'ends quiet')
            self.assertGreater(max(map(abs, channel[n//2-edge:n//2+edge])), .4, 'middle untouched')

    def test_native_and_python_shape_agree_for_a_stereo_pad(self):
        from decksynth.drum_shape import render_shape
        self.assign(write(self.dir/'w.wav', (480, .5), (960, .25)))
        raw = self.e.drums[0].raw[0]
        shape = dict(fade_in=.05, fade_out=.05, eq_low=3.)
        a = render_shape(raw, shape, R); b = render_shape(raw, shape, R, native=False)
        self.assertLess(max(abs(x-y) for x, y in zip(a.data, b.data)), 1e-4)
        self.assertLess(max(abs(x-y) for x, y in zip(a.side, b.side)), 1e-4)

    def test_fades_round_trip_through_save_and_load(self):
        self.assign(write(self.dir/'w.wav', (480, .5), (960, .25)))
        self.e.edit_drum_pad(0, self.kit, 0, 'shape', dict(fade_in=.25, fade_out=1.5))
        before = self.e.project.data()
        path = self.dir/'song.decksynth'; self.e.project.save(path)
        e2 = Engine(); e2.project = Project.load(path); e2.configure(); e2.load_drum_sources(); PadShaper.wait()
        shape = e2.project.tracks[0]['drum_rack']['pads'][0]['shape']
        self.assertEqual((shape['fade_in'], shape['fade_out']), (.25, 1.5))
        self.assertEqual(e2.project.data(), before)
        self.assertTrue(e2.drums[0].samples[0].stereo, 'the reloaded pad is still stereo')


if __name__ == '__main__':
    unittest.main()
