"""Per-section DSP time: synth voices, drums, sampler, FX, and the rest (Python mix/pan/limiter/events)."""
import sys, time, os
sys.path.insert(0, os.environ.get('DS_REPO') or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from decksynth.core import Engine, Project
path = sys.argv[1]; notes = '--notes' in sys.argv
e = Engine(48000); e.replace_project(Project.load(path)); e.playing = True
if notes:
    for n in (48, 55, 60, 64, 67, 72): e.midi(0x90, n, 100)
acc = {'synth': 0., 'drums': 0., 'sampler': 0., 'fx': 0.}
depth = {'synth': 0, 'drums': 0, 'sampler': 0, 'fx': 0}
def wrap(obj, name, key):
    f = getattr(obj, name)
    def g(*a, **k):
        if depth[key]: return f(*a, **k)
        depth[key] = 1; t = time.perf_counter()
        try: return f(*a, **k)
        finally: acc[key] += time.perf_counter() - t; depth[key] = 0
    setattr(obj, name, g)
for s in e.synths: wrap(s, 'render', 'synth')
for d in e.drums: wrap(d, 'render_into', 'drums')
for s in e.samplers: wrap(s, 'render_into', 'sampler')
for f in e.fx: wrap(f, 'process_stereo', 'fx'); wrap(f, 'process', 'fx')
for _ in range(40): e.render_stereo(256)
for k in acc: acc[k] = 0.
N = 750; t = time.perf_counter()
for _ in range(N): e.render_stereo(256)
total = time.perf_counter() - t; budget = 256 / 48000
per = lambda x: '%.2f ms (%.0f%% of block)' % (x / N * 1000, x / N / budget * 100)
print('total', per(total))
rest = total - sum(acc.values())
for k, v in acc.items(): print(k, per(v))
print('python mix/pan/limiter/events', per(rest))
