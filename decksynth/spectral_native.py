"""Optional spectral-table accelerator. Loaded at synth startup, never built in rendering."""
import ctypes as C
import hashlib
import os
from pathlib import Path
import platform

_attempted=False
_kernel=None
_library=None
_error=None


def library_path():
    source=Path(__file__).with_name('native')/'spectral_tables.c'
    digest=hashlib.sha256(source.read_bytes()).hexdigest()[:24]
    cache=Path(os.environ.get('XDG_CACHE_HOME') or Path.home()/'.cache')/'decksynth/native'
    return cache/('spectral-'+platform.machine()+'-'+digest+'.so')


def prepare_kernel():
    global _attempted,_kernel,_library,_error
    if not _attempted:
        _attempted=True
        try:
            lib=C.CDLL(str(library_path()))
            kernel=lib.spectral_bound_table
            kernel.argtypes=[C.POINTER(C.c_double),C.c_int];kernel.restype=C.c_double
            _library=lib;_kernel=kernel
        except (OSError,AttributeError) as exc:_error=str(exc)
    return _kernel


def bound_table(table):
    """Already-prepared C table only. None asks the caller to use its Python fallback."""
    if _kernel is None or not isinstance(table,C.Array) or table._type_ is not C.c_double:return None
    return _kernel(table,len(table))


def native_error():return _error
