"""Strict, bounded PCM WAV ingestion. Never load or decode on the render thread.

A cache has one fixed output rate, so its SHA keys imply (SHA, output rate).
The budget counts resident float32 PCM bytes; file reads are capped separately.
Samples and their arrays are shared and must be treated as immutable by callers.
"""
from array import array
from dataclasses import dataclass, replace
import hashlib
import io
import os
from pathlib import Path
import re
import stat
import struct
import threading


MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_DURATION_SECONDS = 30
MIN_RATE = 8000
MAX_RATE = 192000
_SOURCE_KEYS = frozenset(('path', 'sha256', 'source_rate', 'channels', 'frames', 'bits'))
_SHA = re.compile(r'[0-9a-f]{64}\Z')


def _integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def _valid_sha(value):
    return isinstance(value, str) and _SHA.fullmatch(value) is not None


def validate_source(source):
    """Validate a reference without touching its file, returning a detached dict.

    Only source metadata is accepted, never decoded buffers or UI state. Paths
    are absolute because load normalizes them; missing files remain valid refs.
    """
    if type(source) is not dict or set(source) != _SOURCE_KEYS:
        raise ValueError('sample source must contain exactly the source metadata fields')
    path = source['path']
    if (not isinstance(path, str) or not path or len(path) > 4096 or '\0' in path
            or not os.path.isabs(path) or '..' in Path(path).parts):
        raise ValueError('sample source path must be an absolute path')
    if not _valid_sha(source['sha256']):
        raise ValueError('sample source SHA256 must be lowercase hexadecimal')
    rate = source['source_rate']
    if not _integer(rate, MIN_RATE, MAX_RATE):
        raise ValueError('sample source rate must be between 8000 and 192000 Hz')
    if not _integer(source['channels'], 1, 2):
        raise ValueError('sample source must be mono or stereo')
    if type(source['bits']) is not int or source['bits'] not in (16, 24, 32):
        raise ValueError('sample source must be PCM16, PCM24 or PCM32')
    if not _integer(source['frames'], 1, rate * MAX_DURATION_SECONDS):
        raise ValueError('sample source duration must be positive and at most 30 seconds')
    if source['frames'] * source['channels'] * (source['bits'] // 8) + 44 > MAX_FILE_BYTES:
        raise ValueError('sample source exceeds the WAV size limit')
    return dict(source)


@dataclass(frozen=True)
class DecodedSample:
    sha256: str
    path: str
    rate: int
    source_rate: int
    channels: int
    frames: int
    data: array
    peaks: tuple
    source_frames: int
    bits: int

    @property
    def source(self):
        return dict(path=self.path, sha256=self.sha256, source_rate=self.source_rate,
                    channels=self.channels, frames=self.source_frames, bits=self.bits)


def _read_exact(handle, size):
    value = handle.read(size)
    if len(value) != size:
        raise ValueError('truncated WAV file')
    return value


def _inspect_wav(handle, file_size):
    """Read bounded headers and seek across payloads before any whole-file read."""
    handle.seek(0)
    header = _read_exact(handle, 12)
    if header[:4] != b'RIFF' or header[8:] != b'WAVE':
        raise ValueError('sample must be a little-endian RIFF WAV')
    if struct.unpack_from('<I', header, 4)[0] + 8 != file_size:
        raise ValueError('WAV RIFF length does not match its file size')
    fmt = None
    data = None
    position = 12
    while position < file_size:
        if file_size - position < 8:
            raise ValueError('truncated WAV chunk header')
        handle.seek(position)
        chunk_id, size = struct.unpack('<4sI', _read_exact(handle, 8))
        start = position + 8
        end = start + size
        padded_end = end + (size & 1)
        if padded_end > file_size:
            raise ValueError('truncated WAV chunk')
        if chunk_id == b'fmt ':
            if fmt is not None or size not in (16, 18):
                raise ValueError('invalid or duplicate PCM format chunk')
            raw = _read_exact(handle, size)
            tag, channels, rate, byte_rate, align, bits = struct.unpack_from('<HHIIHH', raw)
            if tag != 1 or (size == 18 and raw[16:] != b'\0\0'):
                raise ValueError('only uncompressed signed PCM WAV is supported')
            if channels not in (1, 2) or bits not in (16, 24, 32):
                raise ValueError('sample must be mono/stereo PCM16, PCM24 or PCM32')
            if not MIN_RATE <= rate <= MAX_RATE:
                raise ValueError('sample rate must be between 8000 and 192000 Hz')
            if align != channels * (bits // 8) or byte_rate != rate * align:
                raise ValueError('inconsistent PCM frame alignment or byte rate')
            fmt = (channels, rate, bits, align)
        elif chunk_id == b'data':
            if data is not None:
                raise ValueError('duplicate WAV data chunk')
            data = (start, size)
        position = padded_end
    if fmt is None or data is None:
        raise ValueError('WAV requires one format chunk and one data chunk')
    channels, rate, bits, align = fmt
    start, size = data
    if not size or size % align:
        raise ValueError('WAV data must contain complete nonempty PCM frames')
    frames = size // align
    if frames > rate * MAX_DURATION_SECONDS:
        raise ValueError('sample duration exceeds 30 seconds')
    return channels, rate, bits, frames, start, size


def _decode(payload, channels, bits):
    width = bits // 8
    scale = 1.0 / (1 << (bits - 1))
    frame_bytes = channels * width
    mono = array('f')
    for offset in range(0, len(payload), frame_bytes):
        left = int.from_bytes(payload[offset:offset + width], 'little', signed=True)
        if channels == 2:
            right = int.from_bytes(payload[offset + width:offset + frame_bytes], 'little', signed=True)
            mono.append((left + right) * (.5 * scale))
        else:
            mono.append(left * scale)
    return mono


def _resample(mono, source_rate, output_rate, frames):
    if source_rate == output_rate:
        return mono
    result = array('f')
    last = len(mono) - 1
    for index in range(frames):
        # Integer quotient/remainder avoids accumulated timing error.
        left, fraction = divmod(index * source_rate, output_rate)
        if left >= last:
            result.append(mono[last])
        else:
            a = mono[left]
            result.append(a + (mono[left + 1] - a) * (fraction / output_rate))
    return result


def _peaks(data):
    count = min(256, len(data))
    peaks = []
    for index in range(count):
        start = index * len(data) // count
        end = (index + 1) * len(data) // count
        lo = hi = data[start]
        for frame in range(start + 1, end):
            value = data[frame]
            lo = min(lo, value)
            hi = max(hi, value)
        peaks.append((lo, hi))
    return tuple(peaks)


class SampleCache:
    """Hash-keyed, no-eviction cache, bounded by resident float32 PCM bytes.

    Loads serialize to avoid concurrent decode allocations and budget races.
    Lookup uses a separate short lock and never waits for file IO or decoding.
    Capacity exhaustion rejects the new asset; existing voices keep references.
    """
    def __init__(self, rate=48000, max_bytes=64 * 1024 * 1024):
        if not _integer(rate, MIN_RATE, MAX_RATE):
            raise ValueError('cache rate must be between 8000 and 192000 Hz')
        if type(max_bytes) is not int or max_bytes <= 0:
            raise ValueError('cache max_bytes must be a positive integer')
        self.rate = rate
        self.max_bytes = max_bytes
        self._samples = {}
        self._bytes = 0
        self._lock = threading.Lock()
        self._load_lock = threading.Lock()

    def get(self, sha):
        """Return a resident sample or None; never inspect a path or decode."""
        if not _valid_sha(sha):
            return None
        with self._lock:
            return self._samples.get(sha)

    def load(self, path, expected_sha=None):
        if expected_sha is not None and not _valid_sha(expected_sha):
            raise ValueError('expected SHA256 must be lowercase hexadecimal')
        path = str(Path(path).expanduser().resolve())
        if len(path) > 4096 or '\0' in path:
            raise ValueError('invalid sample path')
        with self._load_lock:
            # A blocking open on a FIFO would hang before fstat could reject it.
            descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            try:
                info = os.fstat(descriptor)
                if not stat.S_ISREG(info.st_mode):
                    raise ValueError('sample must be a regular file')
                if info.st_size > MAX_FILE_BYTES:
                    raise ValueError('sample file exceeds 32 MiB')
                handle = os.fdopen(descriptor, 'rb')
                descriptor = None  # The buffered handle now owns the descriptor.
                with handle:
                    metadata = _inspect_wav(handle, info.st_size)
                    channels, source_rate, bits, source_frames, start, size = metadata
                    frames = max(1, (source_frames * self.rate + source_rate // 2) // source_rate)
                    # Bounds precede whole-file reads and PCM allocation.
                    handle.seek(0)
                    raw = handle.read(MAX_FILE_BYTES + 1)
                    if len(raw) != info.st_size or len(raw) > MAX_FILE_BYTES:
                        raise ValueError('sample changed during loading')
            finally:
                if descriptor is not None:
                    os.close(descriptor)
            # Revalidate the actual bytes used for hashing and decode, avoiding
            # a mismatch if another process changed the file after inspection.
            if _inspect_wav(io.BytesIO(raw), len(raw)) != metadata:
                raise ValueError('sample changed during loading')
            sha = hashlib.sha256(raw).hexdigest()
            if expected_sha is not None and expected_sha != sha:
                raise ValueError('sample SHA256 does not match its source reference')
            with self._lock:
                cached = self._samples.get(sha)
                if cached is not None:
                    # A relink changes source provenance, not the shared PCM.
                    # Keep one resident buffer and return the requested path.
                    return cached if cached.path == path else replace(cached, path=path)
                needed = frames * array('f').itemsize
                if self._bytes + needed > self.max_bytes:
                    raise ValueError('sample cache capacity exhausted')
            mono = _decode(memoryview(raw)[start:start + size], channels, bits)
            data = _resample(mono, source_rate, self.rate, frames)
            sample = DecodedSample(sha, path, self.rate, source_rate, channels,
                                   len(data), data, _peaks(data), source_frames, bits)
            with self._lock:
                self._samples[sha] = sample
                self._bytes += needed
            return sample
