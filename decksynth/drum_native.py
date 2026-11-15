"""Optional native Drum Rack loop; build/load only during rack construction.

The checked-in C source compiles atomically to a content-addressed user cache,
never into the repository. A cached binary works without a compiler. Set CC to
an executable plus arguments (for example '/path/to/zig cc') for an initial
build. Missing compilers and build/load errors retain the Python implementation;
`native_error()` exposes the reason. There are no build attempts in rendering.
"""
import ctypes as C
import hashlib
import os
from pathlib import Path
import platform
import shlex
import shutil
import subprocess
import tempfile
import threading


_FIELDS = [
    ('data', C.c_void_p), ('frames', C.c_int64),
    ('pos', C.c_double), ('step', C.c_double), ('gain', C.c_double),
    ('age', C.c_int64), ('remaining', C.c_int64),
    ('old_data', C.c_void_p), ('old_frames', C.c_int64),
    ('old_pos', C.c_double), ('old_step', C.c_double), ('old_gain', C.c_double),
    ('old_age', C.c_int64), ('old_remaining', C.c_int64),
    ('old_scalar', C.c_double), ('last', C.c_double),
    ('gl', C.c_double), ('gr', C.c_double), ('old_gl', C.c_double), ('old_gr', C.c_double),
]
_SYNC_FIELDS = ('pos', 'step', 'gain', 'age', 'remaining', 'old_pos', 'old_step',
                'old_gain', 'old_age', 'old_remaining', 'old_scalar', 'last',
                'gl', 'gr', 'old_gl', 'old_gr')


class NativeVoice(C.Structure):
    _fields_ = _FIELDS


def library_path():
    source = Path(__file__).with_name('native') / 'drum_mix.c'
    digest = hashlib.sha256(source.read_bytes()).hexdigest()[:24]
    cache = Path(os.environ.get('XDG_CACHE_HOME') or Path.home() / '.cache') / 'decksynth' / 'native'
    return cache / ('drums-' + platform.machine() + '-' + digest + '.so')


def build_library(output=None, force=False):
    """Explicit startup/tool build; CC is parsed into args without a shell."""
    target = Path(output) if output is not None else library_path()
    if target.is_file() and not force:
        return target
    configured = os.environ.get('CC')
    if configured:
        compiler = shlex.split(configured)
    else:
        executable = next((shutil.which(name) for name in ('cc', 'gcc', 'clang') if shutil.which(name)), None)
        compiler = [executable] if executable else []
    if not compiler:
        raise RuntimeError('No C compiler available; install cc/gcc/clang or set CC for the first native build')
    source = Path(__file__).with_name('native') / 'drum_mix.c'
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.drums-build-', dir=target.parent) as work:
        temporary = Path(work) / 'drums.so'
        args = compiler + ['-std=c99', '-O3', '-ffp-contract=off', '-fPIC', '-shared',
                           str(source), '-o', str(temporary), '-lm']
        result = subprocess.run(args, capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError('Native Drum Rack build failed: ' + result.stderr[-2000:])
        os.replace(temporary, target)
    return target


_lock = threading.Lock()
_attempted = False
_kernel = None
_library = None
_shape = None
_error = None


def native_kernel():
    """Prepare the optional library once, before any rack starts rendering."""
    global _attempted, _kernel, _library, _shape, _error
    with _lock:
        if not _attempted:
            _attempted = True
            try:
                library = C.CDLL(str(build_library()))
                library.drum_voice_size.argtypes = []
                library.drum_voice_size.restype = C.c_size_t
                if library.drum_voice_size() != C.sizeof(NativeVoice):
                    raise RuntimeError('Native Drum Rack state ABI mismatch')
                kernel = library.drum_mix
                kernel.argtypes = [C.POINTER(NativeVoice), C.c_int, C.POINTER(C.c_double),
                                   C.c_int, C.c_int, C.c_int]
                kernel.restype = None
                shape = library.drum_shape
                shape.argtypes = [C.c_void_p, C.c_int64, C.POINTER(C.c_double)]
                shape.restype = None
                _library, _kernel, _shape = library, kernel, shape
            except (OSError, RuntimeError, ValueError, AttributeError, subprocess.SubprocessError) as error:
                _error = str(error)
        return _kernel


def native_shape():
    """The C pad-shaping routine (drum_shape.py), or None when only Python is available."""
    native_kernel()
    return _shape


def native_error():
    return _error


class NativeDrumMixer:
    """Fixed state/scratch storage; holds no independent sample buffers."""
    def __init__(self, kernel, voice_limit=32):
        if not 1 <= voice_limit <= 32:
            raise ValueError('native drum pool must contain 1–32 slots')
        self.kernel = kernel
        self.states = (NativeVoice * voice_limit)()
        self.scratch = (C.c_double * 256)()
        self._views = tuple(self.states[i] for i in range(voice_limit))

    def render_into(self, voices, out, frames, attack, fade, right=None):
        for voice, state in zip(voices, self._views):
            state.data = voice.sample.data.buffer_info()[0] if voice.sample is not None else None
            state.frames = voice.sample.frames if voice.sample is not None else 0
            state.old_data = voice.old_sample.data.buffer_info()[0] if voice.old_sample is not None else None
            state.old_frames = voice.old_sample.frames if voice.old_sample is not None else 0
            for field in _SYNC_FIELDS:
                setattr(state, field, getattr(voice, field))
        offset = 0
        while offset < frames:
            count = min(128, frames - offset)
            self.kernel(self.states, len(self.states), self.scratch, count, attack, fade)
            scratch = self.scratch
            if right is None:
                for i in range(count):
                    out[offset + i] += (scratch[i] + scratch[count + i]) * .5
            else:
                for i in range(count):
                    out[offset + i] += scratch[i]; right[offset + i] += scratch[count + i]
            offset += count
        for voice, state in zip(voices, self._views):
            for field in _SYNC_FIELDS:
                setattr(voice, field, getattr(state, field))
            if not state.data:
                voice.sample = None
            if not state.old_data:
                voice.old_sample = None
