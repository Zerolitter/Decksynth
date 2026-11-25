#!/usr/bin/env python3
"""Generate the factory attack sounds in decksynth/assets/: short kick transients (click + knock), made from maths only,
so they ship with Decksynth with no licence question. They sit on top of a sine body (the Sample layer's Attack).

    python3 tools/make_808_kick.py

  808-kick-attack.wav   round knock with a soft tick (808)
  909-kick-attack.wav   harder, higher knock and a sharper click (909)
  soft-thud.wav         a muted low thump with almost no click (sub kicks)
"""
import math, os, random, struct, wave
R = 48000
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'decksynth', 'assets')


def make(name, seconds, f_hi, f_lo, f_tau, k_tau, click, c_tau, seed):
    rng = random.Random(seed); N = int(seconds*R); out = []; ph = 0.; lp = 0.
    for i in range(N):
        t = i/R
        ph += 2*math.pi*(f_lo + (f_hi - f_lo)*math.exp(-t/f_tau))/R
        knock = math.sin(ph)*math.exp(-t/k_tau)
        noise = rng.uniform(-1, 1); lp += .35*(noise - lp)
        tick = (noise - lp)*math.exp(-t/c_tau)
        out.append((.85*knock + click*tick)*min(1., (N - i)/(.02*R)))
    peak = max(abs(x) for x in out) or 1.
    data = b''.join(struct.pack('<h', int(max(-1, min(1, x/peak*.9))*32767)) for x in out)
    path = os.path.normpath(os.path.join(OUT, name))
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(R); w.writeframes(data)
    print(path, os.path.getsize(path), 'bytes')


os.makedirs(OUT, exist_ok=True)
make('808-kick-attack.wav', .22, 220, 70, .012, .045, .55, .0016, 808)
make('909-kick-attack.wav', .16, 320, 90, .008, .03, .9, .0022, 909)
make('soft-thud.wav', .18, 130, 55, .02, .05, .08, .0015, 55)
