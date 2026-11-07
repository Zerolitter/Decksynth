"""Audio diagnostics: how hard this machine has to work for DeckSynth's engine, and whether the output clicks.

Run with:  python3 -m decksynth.diagnose
Each test renders a few seconds of audio in 256-sample blocks. "load" is render time as a share of the
block's real length (5.3 ms at 48 kHz): under ~50 % is comfortable, over 100 % is a dropout.
"""
import gc
import statistics
import time

from .core import Engine
from .fx import ORDER, default_chain, default_module, validate_chain

RATE = 48000
BLOCK = 256


def clicks(samples):
    d2 = [abs(samples[i + 1] - 2 * samples[i] + samples[i - 1]) for i in range(1, len(samples) - 1)]
    base = sorted(d2)[len(d2) // 2] + 1e-6
    return sum(1 for v in d2 if v > max(.02, base * 40))


def run(label, setup, blocks=375, during=None):
    e = Engine(RATE); setup(e)
    for _ in range(10): e.render(BLOCK)
    times, out = [], []
    for i in range(blocks):
        if during: during(e, i)
        t = time.perf_counter(); b = e.render(BLOCK); times.append(time.perf_counter() - t); out += b
    budget = BLOCK / RATE
    times.sort()
    mean, p99, worst = statistics.mean(times) / budget, times[int(len(times) * .99)] / budget, times[-1] / budget
    peak = max(abs(x) for x in out)
    verdict = 'OK' if p99 < .5 and worst < 1 else 'TIGHT' if p99 < .9 else 'TOO SLOW'
    print(f'{label:38s} load mean {mean*100:5.1f} %  p99 {p99*100:5.1f} %  worst {worst*100:6.1f} %  '
          f'peak {peak:.2f}  clicks {clicks(out):4d}  {verdict}')
    return max(p99, worst / 2)


def chord(n):
    def f(e):
        for k in range(n): e.midi(0x90, 48 + k * 3, 100)
    return f


def with_fx(names, n):
    def f(e):
        c = validate_chain(default_chain())
        c['modules'] = [dict(default_module(m), on=True) for m in names] + [m for m in c['modules'] if m['id'] not in names]
        for t in range(4): e.set_fx(t, validate_chain(c))
        chord(n)(e)
    return f


def four_tracks(e):
    for t, tr in enumerate(e.project.tracks):
        tr['notes'] = [dict(note=48 + t * 5 + (i % 4) * 3, start=i * .5, duration=.45, velocity=100) for i in range(16)]
    c = validate_chain(default_chain())
    c['modules'] = [dict(default_module(m), on=True) for m in ('reverb', 'delay', 'chorus', 'compressor')] + \
                   [m for m in c['modules'] if m['id'] not in ('reverb', 'delay', 'chorus', 'compressor')]
    c['mods'][0]['targets'] = [{'module': 'sound', 'param': 'filter', 'depth': .6}]
    for t in range(4): e.set_fx(t, validate_chain(c))
    e.playing = True


def main():
    gc.collect(); gc.freeze(); gc.set_threshold(50000, 50, 1000)  # the same settings as the audio worker
    print('DeckSynth audio diagnostics. Budget per block: %.2f ms (256 samples at 48 kHz)\n' % (BLOCK / RATE * 1000))
    worst = max(
        run('idle', lambda e: None),
        run('4-note chord', chord(4)),
        run('8-note chord', chord(8)),
        run('16-note chord', chord(16)),
        run('8 notes, all 16 effects on 4 tracks', with_fx(ORDER, 8)),
        run('4 tracks playing, 4 effects + mod pad', four_tracks),
    )
    print()
    if worst < .5: print('Verdict: the engine keeps up easily on this machine. Clicks come from elsewhere (see the report).')
    elif worst < .9: print('Verdict: the engine is close to the limit here. Other programs or the screen can push it over.')
    else: print('Verdict: the engine is too slow on this machine for these tests. That causes dropouts (crackle).')


if __name__ == '__main__':
    main()
