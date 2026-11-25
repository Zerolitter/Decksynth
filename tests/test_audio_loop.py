"""The audio loop never waits for a background job (WAV load, chop, pitch finding, library scan)."""
import ctypes
import math
import os
import shutil
import struct
import sys
import tempfile
import time
import unittest
import wave
from pathlib import Path

from decksynth import fx
from decksynth.backend import AUDIO_SWITCH_INTERVAL
from decksynth.core import Engine

R = 48000
BENCH = Path(__file__).resolve().parents[1] / 'tools' / 'bench'
sys.path.insert(0, str(BENCH))
import gil  # noqa: E402  (tools/bench/gil.py)


def write_wav(path, seconds, freq):
    frames = int(R * seconds)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(R)
        w.writeframes(struct.pack('<%dh' % frames, *[round(.5 * 32767 * math.sin(2 * math.pi * freq * i / R)) for i in range(frames)]))
    return path


class KernelsKeepTheLock(unittest.TestCase):
    def test_audio_kernels_are_loaded_with_pydll(self):
        lib = fx._load()
        if lib is None: self.skipTest('no native FX library')
        self.assertIsInstance(lib, ctypes.PyDLL)

    def test_a_busy_job_thread_does_not_hold_the_audio_up(self):
        # With CDLL and the default 5 ms switch interval a busy thread made each block about 100x slower.
        e = gil.engine(str(BENCH / 'stress4.decksynth'))
        old = sys.getswitchinterval(); sys.setswitchinterval(AUDIO_SWITCH_INTERVAL)
        try:
            alone = gil.times(e, 150); busy = gil.with_busy_thread(e, 150)
        finally: sys.setswitchinterval(old)
        median = lambda t: t[len(t) // 2]
        self.assertLess(median(busy), 8 * median(alone) + 1.0, 'alone %.2f ms, busy %.2f ms' % (median(alone), median(busy)))


class PitchIsFoundInTheBackground(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp()); os.environ['DECKSYNTH_DATA_DIR'] = str(self.dir); self.e = Engine(R)
        while len(self.e.project.tracks) < 3: self.e.add_track()
        self.e.set_device(0, 'drum_rack')
        self.kit = self.e.project.tracks[0]['drum_rack']['id']
        self.e.import_drum_sample(0, self.kit, 5, str(write_wav(self.dir / 'a3.wav', 1., 220.)))

    def tearDown(self):
        self.e.sampler_tasks.close(); os.environ.pop('DECKSYNTH_DATA_DIR', None); shutil.rmtree(self.dir, ignore_errors=True)

    def settle(self):
        notes = []
        for _ in range(500):
            notes += self.e.poll_sampler_tasks()
            if not self.e.sampler_tasks.jobs: return notes
            time.sleep(.01)
        self.fail('background job did not finish')

    def test_play_pad_on_keys_returns_at_once_and_finds_the_root(self):
        t = time.perf_counter(); note = self.e.make_sampler_later(0, self.kit, 5, 2)
        self.assertLess(time.perf_counter() - t, .02); self.assertIsNone(note)
        self.assertNotEqual(self.e.project.tracks[2].get('device'), 'sampler')  # not made until the pitch is known
        notes = self.settle()
        self.assertEqual(self.e.project.tracks[2]['sampler']['root'], 57)
        self.assertEqual(self.e.selected, 2)
        self.assertEqual(notes, [dict(message='Track 3 plays %s on the keys' % self.e.project.tracks[2]['sampler']['name'])])
        self.e.undo(); self.assertNotEqual(self.e.project.tracks[2].get('device'), 'sampler')  # still one undo step

    def test_a_given_root_needs_no_wait(self):
        note = self.e.make_sampler_later(0, self.kit, 5, 1, 62)
        self.assertEqual(self.e.project.tracks[1]['sampler']['root'], 62)
        self.assertIn('Track 2 plays', note)

    def test_detect_root_in_the_background(self):
        self.e.make_sampler_later(0, self.kit, 5, 2, 60)
        sid = self.e.project.tracks[2]['sampler']['id']
        t = time.perf_counter(); self.e.detect_sampler_root_later(2, sid)
        self.assertLess(time.perf_counter() - t, .02)
        self.assertEqual(self.e.project.tracks[2]['sampler']['root'], 60)
        self.assertEqual(self.settle(), [dict(message='Root set to A3')])
        self.assertEqual(self.e.project.tracks[2]['sampler']['root'], 57)

    def test_a_pad_without_sample_is_refused_at_once(self):
        with self.assertRaises(ValueError): self.e.make_sampler_later(0, self.kit, 9, 2)


if __name__ == '__main__':
    unittest.main()
