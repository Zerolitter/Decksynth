"""Sampler batch (27 Nov): stereo samples play in stereo, and Fade in / Fade out on what each key plays."""
import ctypes
import math
import os
import shutil
import struct
import tempfile
import unittest
import wave
from array import array
from pathlib import Path

from decksynth import samples
from decksynth.core import Engine, Project
from decksynth.sampler import mix_python, new_sampler, validate_sampler
from decksynth.samples import SampleCache

R = 48000


def write_stereo(path, seconds=.5, left=(480., .5), right=(480., .5), rate=R, bits=16):
    """A stereo WAV: each channel a sine (freq, amp); amp 0 is silence."""
    n = int(seconds*rate); full = (1 << (bits-1)) - 1
    frames = []
    for i in range(n):
        for freq, amp in (left, right):
            frames.append(round(amp*full*math.sin(2*math.pi*freq*i/rate)))
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(bits//8); w.setframerate(rate)
        if bits == 16: w.writeframes(struct.pack('<%dh' % len(frames), *frames))
        else: w.writeframes(b''.join(struct.pack('<i', v << 8)[1:] for v in frames))
    return path


def channels(block):
    return block[0::2], block[1::2]


def rms(x):
    return math.sqrt(sum(a*a for a in x)/max(1, len(x)))


class LoadTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_stereo_file_keeps_mid_as_before_and_its_side(self):
        path = write_stereo(self.dir/'wide.wav', left=(480., .6), right=(0., 0.))
        s = SampleCache(R).load(path)
        raw = path.read_bytes(); start = raw.index(b'data') + 8
        mid = samples._decode(memoryview(raw)[start:], 2, 16)
        self.assertEqual(list(s.data), list(mid), 'the mono mix every other part uses is unchanged')
        self.assertTrue(s.stereo)
        left = [m + d for m, d in zip(s.data, s.side)]; right = [m - d for m, d in zip(s.data, s.side)]
        self.assertGreater(max(map(abs, left)), .55); self.assertLess(max(map(abs, right)), 1e-6)
        self.assertAlmostEqual(s.lr_peak, .6, delta=.01)

    def test_identical_channels_play_as_mono(self):
        s = SampleCache(R).load(write_stereo(self.dir/'same.wav'))
        self.assertFalse(s.stereo); self.assertIsNone(s.side)

    def test_side_counts_against_the_cache_budget(self):
        cache = SampleCache(R)
        cache.load(write_stereo(self.dir/'wide.wav', right=(960., .3)))
        self.assertEqual(cache._bytes, 2*4*int(.5*R))

    def test_native_and_python_side_match(self):
        codec = samples._native_codec()
        if codec is None or len(codec) < 3: self.skipTest('no native decoder here')
        for bits in (16, 24):
            path = write_stereo(self.dir/('w%d.wav' % bits), seconds=.1, left=(300., .7), right=(700., .4), rate=44100, bits=bits)
            raw = path.read_bytes(); start = raw.index(b'data') + 8; size = len(raw) - start
            frames = max(1, (len(raw[start:])//(bits//4)*R + 44100//2)//44100)
            native, npeak, nwide = samples._decode_side_native(codec, raw, start, size, bits, 44100, R, frames)
            side, peak, wide = samples._decode_side(memoryview(raw)[start:], bits)
            python = samples._resample(side, 44100, R, frames)
            self.assertEqual(list(native), list(python), 'bits %d' % bits)
            self.assertAlmostEqual(npeak, peak, places=12); self.assertAlmostEqual(nwide, wide, places=12)


class StereoSamplerTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp()); os.environ['DECKSYNTH_DATA_DIR'] = str(self.dir)
        self.e = e = Engine(R)
        for i in range(len(e.project.tracks)): e.project.tracks[i]['mute'] = i != 1
        e.set_device(1, 'sampler')

    def tearDown(self):
        os.environ.pop('DECKSYNTH_DATA_DIR', None); shutil.rmtree(self.dir, ignore_errors=True)

    def load(self, path, **edits):
        spec = self.e.project.tracks[1]['sampler']
        self.e.install_sampler_sample(1, spec['id'], self.e.sample_cache.load(path), 60)
        spec = self.e.project.tracks[1]['sampler']
        if edits: self.e.edit_sampler(1, spec['id'], 'patch', edits)
        self.e.project.tracks[1].pop('fx', None); self.e.fx[1].configure(None)
        return self.e.samplers[1]

    def play_stereo(self, frames, note=60):
        self.e.voice_on(1, note, 127, ('live', 0, 0, 0))
        out = []
        while frames > 0:
            n = min(256, frames); out += self.e.render_stereo(n); frames -= n
        return channels(out)

    def test_hard_left_sample_stays_left(self):
        s = self.load(write_stereo(self.dir/'left.wav', left=(480., .5), right=(0., 0.)), mode='oneshot')
        self.assertTrue(s.stereo)
        left, right = self.play_stereo(R//4)
        self.assertGreater(rms(left), .1)
        self.assertLess(rms(right), rms(left)*.01, 'the right channel stays silent')

    def test_python_mix_path_matches(self):
        self.load(write_stereo(self.dir/'left.wav', left=(480., .5), right=(0., 0.)), mode='oneshot')
        self.e.python_bus = True
        left, right = self.play_stereo(R//8)
        self.assertGreater(rms(left), .1); self.assertLess(rms(right), rms(left)*.01)

    def test_mono_sample_still_mono_path(self):
        s = self.load(write_stereo(self.dir/'same.wav'), mode='oneshot')
        self.assertFalse(s.stereo)
        left, right = self.play_stereo(R//8)
        self.assertGreater(rms(left), .1); self.assertAlmostEqual(rms(left), rms(right), places=6)

    def test_pan_moves_a_stereo_sample(self):
        self.load(write_stereo(self.dir/'wide.wav', left=(480., .5), right=(960., .5)), mode='oneshot', pan=-1.)
        left, right = self.play_stereo(R//8)
        self.assertLess(rms(right[R//50:]), 1e-6, 'pan hard left: the right is gone')

    def native_vs_python(self, notes, **edits):
        s = self.load(write_stereo(self.dir/'wide.wav', seconds=.3, left=(480., .5), right=(733., .4)), **edits)
        if s._kernel is None: self.skipTest('no native Sampler library here')
        for note, vel in notes: s.on(note, vel, ('k', note))
        s._modulate()
        twin = (type(s.voices[0])*len(s.voices))(); ctypes.memmove(twin, s.voices, ctypes.sizeof(s.voices))
        n = 256
        ctypes.memset(s.scratch, 0, 8*n); ctypes.memset(s.scratch_r, 0, 8*n)
        s._kernel(s.voices, len(s.voices), ctypes.byref(s.params), s.scratch, s.scratch_r, n)
        nl, nr = list(s.scratch[:n]), list(s.scratch_r[:n])
        pl, pr = [0.]*n, [0.]*n
        mix_python(twin, s.params, s.sample.data, pl, n, s.sample.side, pr)
        self.assertGreater(max(map(abs, pl)), 1e-4)
        self.assertLess(max(abs(a-b) for a, b in zip(nl + nr, pl + pr)), 1e-9)
        self.assertGreater(max(abs(a-b) for a, b in zip(nl, nr)), 1e-3, 'left and right differ')

    def test_native_and_python_stereo_match(self):
        self.native_vs_python(((60, 100), (67, 50)), mode='loop', loop_start=.3, loop_end=.6, filter='lp24', cutoff=900., resonance=.7)

    def test_native_and_python_stereo_reverse_with_fades_match(self):
        self.native_vs_python(((60, 127),), mode='hold', reverse=True, filter='hp', cutoff=300., fade_in=.004, fade_out=.3)

    def test_stereo_and_fades_survive_save_and_load(self):
        self.load(write_stereo(self.dir/'left.wav', left=(480., .5), right=(0., 0.)), mode='oneshot', fade_in=.02, fade_out=.3)
        f = self.dir/'p.decksynth'; self.e.project.save(f)
        loaded = Project.load(f)
        self.assertEqual(loaded.tracks[1]['sampler'], self.e.project.tracks[1]['sampler'])
        self.assertEqual((loaded.tracks[1]['sampler']['fade_in'], loaded.tracks[1]['sampler']['fade_out']), (.02, .3))
        e = Engine(R); e.project = loaded; e.configure(); e.load_sampler_sources()
        smp = e.samplers[1]
        self.assertEqual(smp.state()['status'], 'READY'); self.assertTrue(smp.stereo); self.assertTrue(smp.state()['stereo'])
        self.assertEqual(smp.params.fade_out, .3*R)

    def test_grains_play_in_stereo(self):
        s = self.load(write_stereo(self.dir/'left.wav', seconds=1., left=(480., .5), right=(0., 0.)), mode='grain')
        left, right = self.play_stereo(R//2)
        self.assertGreater(rms(left), .02); self.assertLess(rms(right), rms(left)*.01)


class FadeTest(unittest.TestCase):
    setUp = StereoSamplerTest.setUp; tearDown = StereoSamplerTest.tearDown
    load = StereoSamplerTest.load; play_stereo = StereoSamplerTest.play_stereo

    def test_fades_follow_a_turning_knob(self):
        s = self.load(write_stereo(self.dir/'tone.wav'), mode='oneshot')
        self.e.preview_sampler(1, self.e.project.tracks[1]['sampler']['id'], {'fade_in': .25})
        self.assertEqual(s.params.fade_in, .25*R)
        self.assertEqual(self.e.project.tracks[1]['sampler']['fade_in'], 0., 'the project waits for the release')

    def test_defaults_ranges_and_older_projects(self):
        s = new_sampler()
        self.assertEqual((s['fade_in'], s['fade_out']), (0., 0.))
        for bad in (-.1, 2.5, float('nan')):
            with self.assertRaises(ValueError): validate_sampler(dict(s, fade_in=bad))
        old = {k: v for k, v in s.items() if k not in ('fade_in', 'fade_out')}
        self.assertEqual(validate_sampler(old)['fade_out'], 0.)

    def envelope(self, frames, **edits):
        """|left| peak per 10 ms of a constant-level tone played one shot."""
        self.load(write_stereo(self.dir/'tone.wav', seconds=.5, left=(1000., .5), right=(1000., .5)), mode='oneshot', **edits)
        for _ in range(20): self.e.render_stereo(256)   # the master's look-ahead lets out the last note first
        left, _ = self.play_stereo(frames)
        w = R//100
        return [max(map(abs, left[i:i+w])) for i in range(0, len(left) - w + 1, w)]

    def test_fade_in_and_out_shape_the_whole_sample(self):
        plain = self.envelope(R//2)
        faded = self.envelope(R//2, fade_in=.1, fade_out=.1)
        self.assertLess(faded[0], plain[0]*.15, 'starts near silence')
        self.assertAlmostEqual(faded[5]/plain[5], .55, delta=.08, msg='halfway up after 50 ms (straight fade)')
        self.assertAlmostEqual(faded[25]/plain[25], 1., delta=.02, msg='full level in the middle')
        self.assertLess(faded[47]/plain[47], .35, 'fading out near the end'); self.assertLess(faded[49]/plain[49], .15, 'faded out at the end')

    def test_fades_apply_to_each_slice(self):
        self.load(write_stereo(self.dir/'tone.wav', seconds=.5, left=(1000., .5), right=(1000., .5)), mode='oneshot',
                  slices=[[0., .5], [.5, 1.]], keymap='slices', fade_in=.05)
        left, _ = self.play_stereo(R//8, note=61)   # slice 2: starts in the middle of the sample
        self.assertLess(max(map(abs, left[:R//200])), .05, 'the slice fades in from its own start')
        self.assertGreater(max(map(abs, left[R//10:R//8])), .2)

    def test_loop_fades_in_once(self):
        self.load(write_stereo(self.dir/'tone.wav', seconds=.5, left=(1000., .5), right=(1000., .5)),
                  mode='loop', loop_start=0., loop_end=.4, fade_in=.1, fade_out=.2)
        left, _ = self.play_stereo(R)
        w = R//100; env = [max(map(abs, left[i:i+w])) for i in range(0, R - w, w)]
        self.assertLess(env[0], .1)
        self.assertGreater(min(env[30:]), .3, 'after the first pass the loop plays at full level, no fade out')


if __name__ == '__main__':
    unittest.main()
