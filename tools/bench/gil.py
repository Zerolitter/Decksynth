"""Background-job bench: renders 256-frame blocks like the audio worker, alone and while a busy Python thread runs
(the worst case of a WAV load, chop or library scan in the worker's job threads).
usage: python3 gil.py [project.decksynth] [blocks]"""
import os, sys, threading, time
sys.path.insert(0, os.environ.get('DS_REPO') or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from decksynth.backend import AUDIO_SWITCH_INTERVAL
from decksynth.core import Engine, Project

BLOCK, RATE = 256, 48000


def engine(path):
    e = Engine(RATE); e.replace_project(Project.load(path)); e.playing = True
    for n in range(36, 84, 4): e.midi(0x90, n, 100)
    for _ in range(40): e.render_stereo(BLOCK)  # warm up
    return e


def times(e, blocks):
    out = []
    for _ in range(blocks):
        t = time.perf_counter(); e.render_stereo(BLOCK); out.append((time.perf_counter() - t) * 1000)
    return sorted(out)


def with_busy_thread(e, blocks):
    stop = []
    def busy():
        x = 0
        while not stop:
            for i in range(10000): x += i * i
    thread = threading.Thread(target=busy, daemon=True); thread.start()
    try: return times(e, blocks)
    finally: stop.append(1); thread.join()


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'stress4.decksynth')
    blocks = int(sys.argv[2]) if len(sys.argv) > 2 else 600
    budget = BLOCK / RATE * 1000; e = engine(path)
    old = sys.getswitchinterval(); sys.setswitchinterval(AUDIO_SWITCH_INTERVAL)
    try:
        for label, t in (('alone', times(e, blocks)), ('busy job thread', with_busy_thread(e, blocks))):
            n = len(t)
            print('%-16s median %.2f ms  p99 %.2f  max %.2f  over the %.2f ms budget: %d / %d' % (
                label, t[n // 2], t[int(n * .99)], t[-1], budget, sum(x > budget for x in t), n))
    finally: sys.setswitchinterval(old)
