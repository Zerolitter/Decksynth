"""Optional S2 voice kernel. Explicitly built and loaded once at Synth startup."""
import ctypes as C
import hashlib
import os
from pathlib import Path
import platform
from .fx import DsVoice

class DsFilter(C.Structure):
    _fields_=[('a',C.c_double),('d',C.c_double),('sus',C.c_double),('rel',C.c_double),
              ('morph',C.c_double),('independent',C.c_int)]

_attempted=False
_kernel=None
_library=None
_error=None

def library_path():
    source=Path(__file__).with_name('native')/'dsfx.c'
    digest=hashlib.sha256(source.read_bytes()).hexdigest()[:24]
    cache=Path(os.environ.get('XDG_CACHE_HOME') or Path.home()/'.cache')/'decksynth/native'
    return cache/('filter-'+platform.machine()+'-'+digest+'.so')

def prepare_kernel():
    global _attempted,_kernel,_library,_error
    if not _attempted:
        _attempted=True
        try:
            lib=C.PyDLL(str(library_path()))  # audio thread: keeps Python's lock (see fx._load)
            kernel=lib.dsfx_voice3;D=C.POINTER(C.c_double)
            kernel.argtypes=[D,C.c_int,D,D,D,C.POINTER(DsVoice),C.POINTER(DsFilter)];kernel.restype=C.c_int
            _library=lib;_kernel=kernel
        except (OSError,AttributeError) as exc:_error=str(exc)
    return _kernel

def native_voice():return _kernel

def native_error():return _error
