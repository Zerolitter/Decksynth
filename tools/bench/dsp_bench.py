"""DSP load bench: renders 256-frame blocks like the audio worker and reports ms/block as % of block time.
usage: python3 dsp_bench.py project.decksynth [seconds] [--prof] [--notes]"""
import sys, time, cProfile, pstats, os
sys.path.insert(0, os.environ.get('DS_REPO') or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from decksynth.core import Engine, Project
if os.environ.get('DS_PRIO'):
    from decksynth.backend import raise_audio_priority; print('priority:', raise_audio_priority())
path = sys.argv[1]; secs = float(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 8
prof = '--prof' in sys.argv; notes = '--notes' in sys.argv
e = Engine(48000); e.replace_project(Project.load(path)); e.playing = True
if notes:
    for n in (48, 55, 60, 64, 67, 72): e.midi(0x90, n, 100)
BLOCK = 256; blocks = int(secs * 48000 / BLOCK); budget = BLOCK / 48000 * 1000
for _ in range(40): e.render_stereo(BLOCK)  # warm up
if '--tail' in sys.argv:  # stop the transport, release the keys, time the decaying FX tails (denormal territory)
    for _ in range(100): e.render_stereo(BLOCK)
    e.playing = False
    for n in (48, 55, 60, 64, 67, 72): e.midi(0x80, n, 0)
    for _ in range(20): e.render_stereo(BLOCK)
times = []
def run():
    for _ in range(blocks):
        t = time.perf_counter(); e.render_stereo(BLOCK); times.append((time.perf_counter() - t) * 1000)
if prof:
    p = cProfile.Profile(); p.runcall(run); pstats.Stats(p).sort_stats('tottime').print_stats(18)
else: run()
times.sort(); n = len(times)
print('p25 %.2f ms (%.0f%%)  ' % (times[n//4], times[n//4]/budget*100), end='')
print('blocks %d  budget %.2f ms  mean %.2f ms (%.0f%%)  p95 %.2f (%.0f%%)  p99 %.2f  max %.2f (%.0f%%)  >budget: %d' % (
    n, budget, sum(times) / n, sum(times) / n / budget * 100, times[int(n * .95)], times[int(n * .95)] / budget * 100,
    times[int(n * .99)], times[-1], times[-1] / budget * 100, sum(t > budget for t in times)))
