"""Bounded off-render PCM loading and persistence-safe sample references."""
from array import array
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

from decksynth.samples import SampleCache, validate_source


def wav_bytes(values, bits=24, channels=1, rate=44100, **fmt_overrides):
    width = bits // 8
    payload = b''.join(int(value).to_bytes(width, 'little', signed=True) for value in values)
    fmt = dict(tag=1, channels=channels, rate=rate, byte_rate=rate * channels * width,
               align=channels * width, bits=bits)
    fmt.update(fmt_overrides)
    fmt_data = struct.pack('<HHIIHH', *(fmt[k] for k in
                                      ('tag', 'channels', 'rate', 'byte_rate', 'align', 'bits')))
    chunks = b'fmt ' + struct.pack('<I', len(fmt_data)) + fmt_data
    chunks += b'data' + struct.pack('<I', len(payload)) + payload
    chunks += b'\0' * (len(payload) % 2)
    return b'RIFF' + struct.pack('<I', len(chunks) + 4) + b'WAVE' + chunks


class Samples(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write(self, content, name='sound.wav'):
        path = self.root / name
        path.write_bytes(content)
        return path

    def test_pcm24_signed_extrema_and_float32(self):
        sample = SampleCache(rate=44100).load(self.write(wav_bytes(
            [-8388608, -4194304, -1, 0, 4194304, 8388607])))
        self.assertIsInstance(sample.data, array)
        self.assertEqual(sample.data.typecode, 'f')
        self.assertEqual(sample.frames, 6)
        self.assertEqual(list(sample.data[:5]), [-1.0, -.5, -1 / 8388608, 0., .5])
        self.assertAlmostEqual(sample.data[5], 1.0 - 1 / 8388608)
        self.assertEqual((sample.source_rate, sample.rate, sample.channels), (44100, 44100, 1))

    def test_pcm24_stereo_uses_equal_weight_downmix(self):
        sample = SampleCache(rate=44100).load(self.write(wav_bytes(
            [-8388608, 8388607, -4194304, 0, 4194304, 4194304], channels=2)))
        self.assertEqual(sample.frames, 3)
        self.assertEqual(list(sample.data), [-1 / 16777216, -.25, .5])
        self.assertEqual(sample.channels, 2)
        self.assertTrue(all(-1 <= v <= 1 for v in sample.data))

    def test_pcm16_and_pcm32_signs_and_clipping(self):
        for bits, values in ((16, [-32768, -16384, 0, 16384, 32767]),
                             (32, [-2147483648, -1073741824, 0, 1073741824, 2147483647])):
            with self.subTest(bits=bits):
                sample = SampleCache(rate=48000).load(self.write(
                    wav_bytes(values, bits=bits, rate=48000)))
                self.assertEqual(list(sample.data[:4]), [-1., -.5, 0., .5])
                self.assertGreater(sample.data[4], .999)
                self.assertLessEqual(sample.data[4], 1.)

    def test_44100_to_48000_linear_interpolation_once(self):
        # 441 input frames become 480 frames; output at frame 1 samples x=.91875.
        values = [0, 4194304] + [0] * 439
        cache = SampleCache()
        path = self.write(wav_bytes(values))
        sample = cache.load(path)
        self.assertEqual((sample.rate, sample.frames, len(sample.data)), (48000, 480, 480))
        self.assertAlmostEqual(sample.data[1], .459375, places=6)
        self.assertEqual(sample.data[-1], 0.)
        self.assertEqual(sample.source['frames'], 441)
        self.assertIs(cache.load(path), sample)

    def test_resample_single_frame_and_downsample(self):
        single = SampleCache().load(self.write(wav_bytes([4194304])))
        self.assertEqual(list(single.data), [.5])
        down = SampleCache(rate=24000).load(self.write(wav_bytes(
            [0, 4194304, -4194304, 0], rate=48000)))
        self.assertEqual(list(down.data), [0., -.5])

    def test_peaks_cover_every_frame_and_extrema(self):
        values = [0] * 1001
        values[0], values[501], values[-1] = -8388608, 8388607, -4194304
        sample = SampleCache(rate=44100).load(self.write(wav_bytes(values)))
        self.assertLessEqual(len(sample.peaks), 256)
        self.assertGreater(len(sample.peaks), 0)
        self.assertEqual(min(lo for lo, hi in sample.peaks), -1.)
        self.assertAlmostEqual(max(hi for lo, hi in sample.peaks), 1 - 1 / 8388608)
        self.assertEqual(sample.peaks[-1][0], -.5)
        self.assertTrue(all(lo <= hi for lo, hi in sample.peaks))

    def test_source_metadata_is_json_safe_and_detached(self):
        content = wav_bytes([1, 2, 3, 4], channels=2)
        path = self.write(content)
        sample = SampleCache().load(path)
        source = sample.source
        self.assertEqual(source, dict(path=str(path), sha256=hashlib.sha256(content).hexdigest(),
                                     source_rate=44100, channels=2, frames=2, bits=24))
        self.assertEqual(validate_source(json.loads(json.dumps(source))), source)
        source['frames'] = 999
        self.assertEqual(sample.source['frames'], 2)

    def test_source_validation_rejects_non_metadata_and_wrong_types(self):
        source = SampleCache().load(self.write(wav_bytes([0]))).source
        bad_sources = [None, [], {}, {**source, 'data': []}, {**source, 'peaks': []},
                       {**source, 'output_rate': 48000}]
        for key, bads in dict(path=['', 'relative.wav', None, '\0bad', '/tmp/a\0.wav',
                                  '/tmp/samples/../sound.wav', '/tmp/../sound.wav'],
                              sha256=['xyz', 'F' * 64, None],
                              source_rate=[True, 0, 7999, 192001, 44100.0],
                              channels=[True, 0, 3], frames=[True, 0, 44100 * 31, 1.0],
                              bits=[True, 8, 64]).items():
            bad_sources.extend({**source, key: bad} for bad in bads)
        for bad in bad_sources:
            with self.subTest(source=bad), self.assertRaises(ValueError):
                validate_source(bad)

    def test_cached_identity_is_content_keyed_and_get_needs_no_file(self):
        content = wav_bytes([0, 1000])
        cache = SampleCache()
        path = self.write(content)
        sample = cache.load(path)
        self.assertIs(cache.load(path), sample)
        self.assertIs(cache.load(self.write(content, 'copy.wav')).data, sample.data)
        path.unlink()
        self.assertIs(cache.get(sample.sha256), sample)
        self.assertIsNone(cache.get('0' * 64))

    def test_relink_same_hash_returns_requested_source_without_extra_pcm_capacity(self):
        content = wav_bytes([0, 1, 2, 3])
        cache = SampleCache(rate=44100, max_bytes=16)
        original = self.write(content)
        sample = cache.load(original)
        self.assertIs(cache.load(original), sample)
        original.unlink()
        replacement = self.write(content, 'relinked.wav')
        relinked = cache.load(replacement, expected_sha=sample.sha256)
        self.assertEqual(relinked.path, str(replacement))
        self.assertEqual(relinked.source['path'], str(replacement))
        self.assertIs(relinked.data, sample.data)
        self.assertIs(relinked.peaks, sample.peaks)
        self.assertEqual(relinked.sha256, sample.sha256)
        # Original source records remain accurate for any existing consumers.
        self.assertEqual(sample.path, str(original))
        with self.assertRaises(ValueError):
            cache.load(self.write(wav_bytes([4]), 'overflow.wav'))
        self.assertIs(cache.get(sample.sha256).data, sample.data)

    def test_expected_sha_checked_for_requested_path_even_when_cached(self):
        cache = SampleCache()
        path = self.write(wav_bytes([0, 1]))
        sample = cache.load(path)
        replacement = self.write(wav_bytes([2, 3]), 'replacement.wav')
        with self.assertRaises(ValueError):
            cache.load(replacement, expected_sha=sample.sha256)
        with self.assertRaises(ValueError):
            cache.load(path, expected_sha='0' * 64)
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            cache.load(path, expected_sha=sample.sha256)
        self.assertIs(cache.get(sample.sha256), sample)

    def test_fifo_rejected_without_blocking_or_descriptor_leak(self):
        fifo = self.root / 'blocked.wav'
        os.mkfifo(fifo)
        script = """
import os
import sys
from decksynth.samples import SampleCache
cache = SampleCache()
before = len(os.listdir('/proc/self/fd'))
for _ in range(32):
    try:
        cache.load(sys.argv[1])
    except ValueError:
        pass
    else:
        raise AssertionError('FIFO sample was accepted')
after = len(os.listdir('/proc/self/fd'))
assert after == before, (before, after)
"""
        try:
            result = subprocess.run([sys.executable, '-c', script, str(fifo)],
                                    cwd=Path(__file__).resolve().parents[1],
                                    capture_output=True, text=True, timeout=2)
        except subprocess.TimeoutExpired:
            self.fail('FIFO load blocked instead of rejecting the non-regular file')
        self.assertEqual(result.returncode, 0, result.stderr)
        # A rejected special file must also release the serialized loader lock.
        valid = self.write(wav_bytes([0]))
        self.assertEqual(SampleCache().load(valid).source['frames'], 1)

    def test_error_loading_does_not_leak_file_descriptors(self):
        cache = SampleCache()
        corrupt = self.write(b'corrupt', 'corrupt.wav')
        valid = self.write(wav_bytes([0]))
        before = len(os.listdir('/proc/self/fd'))
        for _ in range(32):
            with self.assertRaises(ValueError):
                cache.load(corrupt)
            with self.assertRaises((ValueError, OSError)):
                cache.load(self.root)
            with self.assertRaises(ValueError):
                cache.load(valid, expected_sha='0' * 64)
        self.assertEqual(len(os.listdir('/proc/self/fd')), before)

    def test_sample_symlink_resolves_to_normal_source_path(self):
        path = self.write(wav_bytes([0, 1]))
        alias = self.root / 'alias.wav'
        alias.symlink_to(path)
        cache = SampleCache()
        sample = cache.load(alias)
        self.assertEqual(sample.path, str(path))
        self.assertEqual(sample.source['path'], str(path))
        self.assertIs(cache.load(path), sample)

    def test_missing_corrupt_truncated_and_empty_rejected(self):
        with self.assertRaises(FileNotFoundError):
            SampleCache().load(self.root / 'missing.wav')
        valid = wav_bytes([1, 2])
        for content in (b'', b'not a wave', valid[:20], valid[:-1], valid + b'x',
                        wav_bytes([]), b'RIFX' + valid[4:]):
            with self.subTest(content=content[:20]), self.assertRaises(ValueError):
                SampleCache().load(self.write(content))

    def test_invalid_formats_and_inconsistent_pcm_header_rejected(self):
        for opts in (dict(tag=3), dict(bits=8), dict(channels=3), dict(rate=7999),
                     dict(rate=192001), dict(byte_rate=1), dict(align=1)):
            with self.subTest(opts=opts), self.assertRaises(ValueError):
                SampleCache().load(self.write(wav_bytes([1, 2, 3], **opts)))
        # One byte removed from a stereo frame, while RIFF size stays correct.
        content = bytearray(wav_bytes([1, 2], channels=2))
        struct.pack_into('<I', content, 40, 5)
        with self.assertRaises(ValueError):
            SampleCache().load(self.write(content))

    def test_unknown_padded_chunks_are_supported(self):
        content = wav_bytes([1, -1])
        chunk = b'JUNK' + struct.pack('<I', 3) + b'abc\0'
        content = content[:12] + chunk + content[12:]
        content = content[:4] + struct.pack('<I', len(content) - 8) + content[8:]
        sample = SampleCache(rate=44100).load(self.write(content))
        self.assertEqual(list(sample.data), [1 / 8388608, -1 / 8388608])

    def test_duplicate_or_missing_required_chunks_are_rejected(self):
        valid = wav_bytes([1, 2])
        for chunks in (valid[12:36], valid[36:], valid[12:] + valid[12:36],
                       valid[12:] + valid[36:]):
            content = b'RIFF' + struct.pack('<I', len(chunks) + 4) + b'WAVE' + chunks
            with self.subTest(size=len(chunks)), self.assertRaises(ValueError):
                SampleCache().load(self.write(content))

    def test_odd_pcm24_padding_and_oversized_declared_chunks_rejected(self):
        valid = wav_bytes([1])
        self.assertEqual(len(valid), 48)  # Three payload bytes plus required RIFF pad.
        for content in (valid[:-1], valid[:44], valid[:36] + b'data' + struct.pack('<I', 0xffffffff)):
            content = content[:4] + struct.pack('<I', len(content) - 8) + content[8:]
            with self.subTest(size=len(content)), self.assertRaises(ValueError):
                SampleCache().load(self.write(content))

    def test_file_size_cap_rejects_sparse_file(self):
        path = self.write(wav_bytes([0]))
        with path.open('r+b') as handle:
            handle.truncate(32 * 1024 * 1024 + 1)
        with self.assertRaises(ValueError):
            SampleCache().load(path)

    def test_duration_cap_rejects_before_decode(self):
        # Sparse valid PCM16 WAV describing over 30 s; no sample payload is built.
        rate, frames = 8000, 8000 * 30 + 1
        content = bytearray(wav_bytes([0], bits=16, rate=rate))
        struct.pack_into('<I', content, 4, 36 + frames * 2)
        struct.pack_into('<I', content, 40, frames * 2)
        path = self.write(content)
        with path.open('r+b') as handle:
            handle.truncate(44 + frames * 2)
        with self.assertRaises(ValueError):
            SampleCache().load(path)

    def test_capacity_is_rejected_without_evicting_live_samples(self):
        cache = SampleCache(rate=44100, max_bytes=16)
        first = cache.load(self.write(wav_bytes([0, 1, 2, 3])))
        with self.assertRaises(ValueError):
            cache.load(self.write(wav_bytes([4]), 'new.wav'))
        self.assertIs(cache.get(first.sha256), first)
        self.assertIs(cache.load(self.write(wav_bytes([0, 1, 2, 3]), 'same.wav')).data, first.data)
        oversized = SampleCache(rate=48000, max_bytes=4)
        with self.assertRaises(ValueError):
            oversized.load(self.write(wav_bytes([0, 1])))

    def test_concurrent_load_deduplicates_and_respects_capacity(self):
        cache = SampleCache(rate=44100, max_bytes=16)
        same = self.write(wav_bytes([0, 1, 2, 3]))
        with ThreadPoolExecutor(max_workers=8) as pool:
            samples = list(pool.map(lambda _: cache.load(same), range(20)))
        self.assertTrue(all(sample is samples[0] for sample in samples))
        paths = [self.write(wav_bytes([value]), f'{value}.wav') for value in range(20, 28)]
        def attempt(path):
            try:
                cache.load(path)
                return True
            except ValueError:
                return False
        with ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(list(pool.map(attempt, paths)), [False] * 8)
        self.assertIs(cache.get(samples[0].sha256), samples[0])

    def test_cache_configuration_and_expected_sha_strict_validation(self):
        for kwargs in (dict(rate=True), dict(rate=7999), dict(rate=192001),
                       dict(max_bytes=-1), dict(max_bytes=0), dict(max_bytes=True)):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                SampleCache(**kwargs)
        path = self.write(wav_bytes([0]))
        for sha in ('', 'bad', 123, 'F' * 64):
            with self.subTest(sha=sha), self.assertRaises(ValueError):
                SampleCache().load(path, expected_sha=sha)


if __name__ == '__main__':
    unittest.main()
