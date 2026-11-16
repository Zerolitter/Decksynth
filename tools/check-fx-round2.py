"""Checks the four round 2 effects in the native FX library, pure Python (no numpy on the Deck)."""
import ctypes as C, math, random, sys, time
lib = C.CDLL(sys.argv[1] if len(sys.argv) > 1 else str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'decksynth/native/libdsfx.so'))
lib.dsfx_create.restype = C.c_void_p; lib.dsfx_create.argtypes = [C.c_double]
D = C.POINTER(C.c_double)
lib.dsfx_process.argtypes = [C.c_void_p, D, C.c_int, C.POINTER(C.c_int), C.POINTER(C.c_int), D, C.c_double]
lib.dsfx_key.argtypes = [C.c_void_p, C.c_int, D, C.c_int]
lib.dsfx_scale.argtypes = [C.c_void_p, C.c_int, C.c_int]
lib.dsfx_readout.argtypes = [C.c_void_p, D]
R = 48000; NMOD = 22; NPAR = 6; BLOCK = 512
IDS = {'pitch': 18, 'autotune': 19, 'duck': 20, 'vocoder': 21}

def run(mod, params, x, key=None, scale=None):
    t = lib.dsfx_create(R)
    order = (C.c_int * NMOD)(*range(NMOD)); on = (C.c_int * NMOD)(); on[IDS[mod]] = 1
    p = (C.c_double * (NMOD * NPAR))()
    for j, v in enumerate(params): p[IDS[mod] * NPAR + j] = v
    if scale: lib.dsfx_scale(t, *scale)
    out = []; ro = (C.c_double * 3)()
    for s in range(0, len(x), BLOCK):
        seg = x[s:s + BLOCK]; buf = (C.c_double * len(seg))(*seg)
        if key is not None:
            kb = (C.c_double * len(seg))(*key[s:s + BLOCK]); lib.dsfx_key(t, 0 if mod == 'duck' else 1, kb, len(seg))
        lib.dsfx_process(t, buf, len(seg), order, on, p, 120.)
        out += buf[:len(seg)]
    lib.dsfx_readout(t, ro)
    return out, list(ro)

def power(y, f):
    w = 2 * math.cos(2 * math.pi * f / R); a = b = 0.
    for v in y: a, b = v + w * a - b, a
    return a * a + b * b - w * a * b

def peak_hz(y, lo, hi):
    y = y[R:R + R // 4]
    n = len(y); y = [v * (.5 - .5 * math.cos(2 * math.pi * i / n)) for i, v in enumerate(y)]
    best = max((power(y, f), f) for f in [lo + k * 4 for k in range(int((hi - lo) / 4) + 1)])[1]
    return max((power(y, f), f) for f in [best - 4 + k * .25 for k in range(33)])[1]

def rms(y): return math.sqrt(sum(v * v for v in y) / max(1, len(y)))
cents = lambda a, b: 1200 * math.log2(a / b)
T = [i / R for i in range(R * 2)]
ok = True
def check(name, cond, info=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + name, info, flush=True)

for semis, ct, f0 in ((12, 0, 220), (-12, 0, 440), (7, 0, 220), (0, 50, 440)):
    y, _ = run('pitch', [semis, ct, 1], [math.sin(2 * math.pi * f0 * t) for t in T])
    want = f0 * 2 ** ((semis + ct / 100) / 12); got = peak_hz(y, want * .8, want * 1.2)
    check(f'pitch {semis:+} st {ct:+} ct', abs(cents(got, want)) < 15, f'{got:.1f} Hz want {want:.1f}, rms {rms(y[R:]):.3f}')
y, _ = run('pitch', [0, 0, 1], [math.sin(2 * math.pi * 300 * t) for t in T])
check('pitch 0 keeps the level', abs(rms(y[R:]) - .707) < .05, f'rms {rms(y[R:]):.3f}')

for f0, scale, wants, label in ((452, None, [440], 'chromatic 452 Hz'), (466.16, (0b101010110101, 0), [440, 493.88], 'C major, A# goes to A or B'),
                                (180, None, [185], 'low voice 180 Hz'), (262 * 1.02, None, [261.63], 'C4 a bit sharp')):
    x = [.4 * sum(math.sin(2 * math.pi * f0 * h * t) / h for h in (1, 2, 3)) for t in T]
    y, ro = run('autotune', [0, 1, 1], x, scale=scale)
    got = peak_hz(y, min(wants) * .85, max(wants) * 1.15)
    check(f'autotune {label}', min(abs(cents(got, w)) for w in wants) < 20, f'-> {got:.1f} Hz (heard {ro[0]:.2f}, correction {ro[1]:.0f} ct)')

pad = [.5 * math.sin(2 * math.pi * 110 * t) for t in T]
kick = [0.] * len(T)
for b in range(4):
    s = int(b * .5 * R)
    for i in range(int(.12 * R)): kick[s + i] = math.sin(2 * math.pi * 60 * i / R) * math.exp(-i / (.04 * R))
y, ro = run('duck', [0, .8, .3, .05, .2], pad, key=kick)
hit = rms(y[int(.5 * R) + 600:int(.5 * R) + 3000]); gap = rms(y[int(.9 * R):int(.98 * R)])
check('ducking pushes down on the kick', hit < gap * .45, f'during kick {hit:.3f}, between {gap:.3f}')
y, _ = run('duck', [0, .8, .3, .05, .2], pad)
check('ducking without a source leaves the sound', abs(rms(y) - rms(pad)) < 1e-3)

saw = [.4 * (2 * ((110 * t) % 1) - 1) for t in T]
mod = [.3 * math.sin(2 * math.pi * 1000 * t) * (1 if t % .5 < .25 else 0) for t in T]
y, _ = run('vocoder', [0, .3, 0, 0, 1], saw, key=mod)
on_ = y[int(1.1 * R):int(1.2 * R)]; off = y[int(1.35 * R):int(1.45 * R)]
check('vocoder follows the voice', rms(off) < rms(on_) * .2, f'voice on {rms(on_):.3f}, off {rms(off):.3f}, carrier rms {rms(saw):.3f}')
w = [v * (.5 - .5 * math.cos(2 * math.pi * i / len(on_))) for i, v in enumerate(on_)]
near = sum(power(w, 110 * h) for h in range(7, 12)); total = sum(power(w, 110 * h) for h in range(1, 60))
check('vocoder band shape near 1 kHz', near / total > .5, f'{near / total:.2f} of the harmonic energy in 770-1210 Hz')
y, _ = run('vocoder', [0, .3, 0, 0, 1], saw)
check('vocoder without a source passes the carrier', max(abs(a - b) for a, b in zip(y, saw)) < 1e-9)

random.seed(1); x = [random.gauss(0, .2) for _ in range(R * 2)]; k = [random.gauss(0, .2) for _ in range(R * 2)]
for m, prm in (('pitch', [7, 0, 1]), ('autotune', [.2, 1, 1]), ('duck', [0, .8, .5, .1, .3]), ('vocoder', [0, .3, 0, .3, 1])):
    t0 = time.perf_counter(); run(m, prm, x, key=k if m in ('duck', 'vocoder') else None); dt = time.perf_counter() - t0
    print(f'CPU {m}: {dt / 2 * 100:.1f}% of one core per track (with the Python copies)', flush=True)
print('ALL OK' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
