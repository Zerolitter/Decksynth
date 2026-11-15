"""Optional native Sampler voices (native/sampler_voice.c), built once into the user cache.

The same rules as the Drum Rack kernel: a cached binary works without a compiler, a missing
compiler or a failed build keeps the Python voices, and nothing is built while rendering.
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

SOURCE = Path(__file__).with_name('native') / 'sampler_voice.c'
_lock = threading.Lock(); _attempted = False; _kernel = None; _library = None; _error = None


def library_path():
    digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()[:24]
    cache = Path(os.environ.get('XDG_CACHE_HOME') or Path.home() / '.cache') / 'decksynth' / 'native'
    return cache / ('sampler-' + platform.machine() + '-' + digest + '.so')


def build_library(output=None, force=False):
    target = Path(output) if output is not None else library_path()
    if target.is_file() and not force: return target
    configured = os.environ.get('CC')
    if configured: compiler = shlex.split(configured)
    else:
        found = next((shutil.which(n) for n in ('cc', 'gcc', 'clang') if shutil.which(n)), None)
        compiler = [found] if found else []
    if not compiler: raise RuntimeError('No C compiler available for the Sampler voices')
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.sampler-build-', dir=target.parent) as work:
        temporary = Path(work) / 'sampler.so'
        result = subprocess.run(compiler + ['-std=c99', '-O2', '-ffp-contract=off', '-fPIC', '-shared',
                                            str(SOURCE), '-o', str(temporary)], capture_output=True, text=True, timeout=60)
        if result.returncode: raise RuntimeError('Native Sampler build failed: ' + result.stderr[-2000:])
        os.replace(temporary, target)
    return target


def kernel():
    """The C mixer, or None (then the Python voices play). Prepared once, before rendering."""
    global _attempted, _kernel, _library, _error
    with _lock:
        if not _attempted and not os.environ.get('DECKSYNTH_NO_NATIVE_SAMPLER'):
            _attempted = True
            try:
                from .sampler import Voice, Params
                library = C.CDLL(str(build_library()))
                library.sampler_voice_size.restype = C.c_size_t; library.sampler_params_size.restype = C.c_size_t
                if library.sampler_voice_size() != C.sizeof(Voice) or library.sampler_params_size() != C.sizeof(Params):
                    raise RuntimeError('Native Sampler state ABI mismatch')
                _library = library; _kernel = library.sampler_mix; _kernel.restype = None
            except (OSError, RuntimeError, ValueError, AttributeError, subprocess.SubprocessError) as error:
                _error = str(error)
        return _kernel


def error():
    return _error if _error else ('Native Sampler disabled' if os.environ.get('DECKSYNTH_NO_NATIVE_SAMPLER') else None)
