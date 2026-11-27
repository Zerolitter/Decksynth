"""Fixed C buffers for a block's audio, and the C mix bus (dsfx_mix_track and friends in dsfx.c).

Each track owns a left and a right buffer of BLOCK doubles, made once. Its synth voices, drum pads,
sampler voices and FX chain read and write those buffers in place, and one C call per track adds it
to the mix and the FX buses (sends.py). Python never builds a list of samples for a block; the only copy
left is the interleaved master output that goes to the audio queue.

When the library is older (no dsfx_mix_track_n) or the render is mono, the engine keeps its Python mix.
"""
import ctypes
from array import array

from .fx import _load

BLOCK = 128          # the engine renders at most 128 frames between automation steps
D = ctypes.c_double
P = ctypes.POINTER(D)
V = ctypes.c_void_p

_ready = None


def lib():
    """The FX library with the buffer routines set up, or None when it is missing or too old."""
    global _ready
    if _ready is None:
        l = _load()
        if l is None or not hasattr(l, 'dsfx_mix_track_n') or not hasattr(l, 'dsfx_master_i'):
            _ready = False
        else:
            l.dsfx_buf_add.argtypes = [V, V, ctypes.c_int, D]
            l.dsfx_buf_avg.argtypes = [V, V, V, ctypes.c_int]
            l.dsfx_buf_scan.argtypes = [V, ctypes.c_int, V]; l.dsfx_buf_scan.restype = ctypes.c_int
            l.dsfx_mix_track_n.argtypes = [V, V, ctypes.c_int, D, D, V, D, V, V, ctypes.c_int, ctypes.c_int, V, V, V]
            l.dsfx_add_return.argtypes = [V, V, V, V, V, V, ctypes.c_int, D, D]
            _ready = l
    return _ready or None


def available():
    return lib() is not None


def addr(buf, offset=0):
    """Address of buf[offset] (buf is a ctypes double array)."""
    return ctypes.addressof(buf) + 8 * offset


def view(buf, offset, n):
    """A ctypes array of n doubles that shares memory with buf from offset on (no copy)."""
    return (D * n).from_buffer(buf, 8 * offset)


def zero(buf, offset, n):
    ctypes.memset(addr(buf, offset), 0, 8 * n)


def copy(dst, src, n):
    ctypes.memmove(addr(dst), addr(src), 8 * n)


def put(buf, offset, values):
    """Write a Python list (a fallback render) into buf from offset on."""
    n = len(values)
    if n:
        a = array('d', values)
        ctypes.memmove(addr(buf, offset), a.buffer_info()[0], 8 * n)


def add_list(buf, values, n):
    """buf[i] += values[i] for a Python list (frozen audio), in C."""
    n = min(n, len(values))
    if n:
        a = array('d', values[:n])
        lib().dsfx_buf_add(addr(buf), a.buffer_info()[0], n, 1.)



def add_external(left, right, external, offset, n):
    """Add a live VST block (a left/right pair, `offset` frames in) to the mix buffers, in C."""
    for dst, src in zip((left, right), external):
        if isinstance(src, array) and src.typecode == 'd':
            lib().dsfx_buf_add(addr(dst), src.buffer_info()[0] + 8 * offset, n, 1.)
        else:
            add_list(dst, src[offset:offset + n], n)

class Scan:
    """dsfx_buf_scan: is the buffer silent, are all samples finite, and its peak."""
    def __init__(self):
        self.out = (D * 2)()

    def __call__(self, buf, n):
        """Returns (any_sound, finite, peak)."""
        anything = lib().dsfx_buf_scan(addr(buf), n, addr(self.out))
        return bool(anything), bool(self.out[0]), self.out[1]


class TrackBuffers:
    """The block's buffers: left/right per track, key snapshots, the mix, and a scratch pair."""
    def __init__(self):
        self.left = []; self.right = []; self.keys = []
        self.mix = (D * BLOCK)(); self.mix_r = (D * BLOCK)()
        self.out = array('d', bytes(16 * BLOCK))
        self.pan = (D * 1)()
        self.scan = Scan()

    def ensure(self, tracks):
        while len(self.left) < tracks:
            self.left.append((D * BLOCK)()); self.right.append((D * BLOCK)())
            self.keys.append(((D * BLOCK)(), (D * BLOCK)()))

    def master(self, stage, n):
        """Run the master stage on the mix and return the interleaved block as a list (L R L R ...)."""
        stage.lib.dsfx_master_i(stage.handle, view(self.mix, 0, n), view(self.mix_r, 0, n),
                                (D * (2 * n)).from_buffer(self.out), n)
        return self.out[:2 * n].tolist() if n < BLOCK else self.out.tolist()
