#!/usr/bin/env python3
"""A/B speed check: alternate an older commit with the working tree in one run.

Two sessions of the same code differ by about 10 %, so a before/after taken minutes apart proves
nothing. This script renders the same project with the old commit and the current code in turns,
pinned to one core, and compares medians.

    tools/bench/ab.py PROJECT.decksynth --against=<commit> [--rounds=4] [--seconds=5] [--notes] [--core=3]

PROJECT is any .decksynth file (tools/bench/stress4.decksynth is a fair 4-track load).
Without --against it compares the working tree with HEAD (useful before a commit).
"""
import argparse
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BENCH = ROOT / 'tools' / 'bench' / 'dsp_bench.py'
LINE = re.compile(r'mean ([\d.]+) ms \((\d+)%\)\s+p95 ([\d.]+) \((\d+)%\)\s+p99 ([\d.]+)\s+max ([\d.]+) \((\d+)%\)\s+>budget: (\d+)')


def checkout(commit, dest):
    """Export the commit's tree to dest, with the local native library next to the engine."""
    archive = subprocess.run(['git', '-C', str(ROOT), 'archive', commit], check=True, capture_output=True).stdout
    subprocess.run(['tar', '-x', '-C', str(dest)], input=archive, check=True)
    lib = ROOT / 'decksynth' / 'native' / 'libdsfx.so'
    old_c = dest / 'decksynth' / 'native' / 'dsfx.c'
    if lib.exists() and old_c.exists():
        if old_c.read_bytes() == (ROOT / 'decksynth' / 'native' / 'dsfx.c').read_bytes():
            shutil.copy(lib, dest / 'decksynth' / 'native' / 'libdsfx.so')
        else:
            cc = shutil.which('cc') or shutil.which('gcc') or shutil.which('clang')
            if cc:
                subprocess.run([cc, '-O2', '-shared', '-fPIC', '-o', str(dest / 'decksynth' / 'native' / 'libdsfx.so'),
                                str(old_c), '-lm'], check=True)
            else:
                print('warning: the old commit has a different dsfx.c and no C compiler is here; '
                      'the old side runs without it', file=sys.stderr)


def run_once(repo, project, seconds, notes, core):
    cmd = [sys.executable, str(BENCH), str(project), str(seconds)] + (['--notes'] if notes else [])
    if shutil.which('taskset') and core is not None:
        cmd = ['taskset', '-c', str(core)] + cmd
    out = subprocess.run(cmd, capture_output=True, text=True, env={**__import__('os').environ, 'DS_REPO': str(repo)})
    m = LINE.search(out.stdout)
    if not m:
        raise SystemExit('bench failed:\n' + out.stdout + out.stderr)
    mean, mean_pct, _p95, _p95_pct, p99, _mx, mx_pct, over = m.groups()
    return float(mean), float(p99), int(over)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('project'); ap.add_argument('--against', default='HEAD')
    ap.add_argument('--rounds', type=int, default=4); ap.add_argument('--seconds', type=float, default=5)
    ap.add_argument('--notes', action='store_true'); ap.add_argument('--core', type=int, default=3)
    a = ap.parse_args()
    project = Path(a.project).resolve()
    with tempfile.TemporaryDirectory(prefix='ds-ab-') as tmp:
        old = Path(tmp)
        checkout(a.against, old)
        olds, news = [], []
        for i in range(a.rounds):
            olds.append(run_once(old, project, a.seconds, a.notes, a.core))
            news.append(run_once(ROOT, project, a.seconds, a.notes, a.core))
            print('round %d  old mean %.2f ms p99 %.2f   new mean %.2f ms p99 %.2f' % (i + 1, olds[-1][0], olds[-1][1], news[-1][0], news[-1][1]))
    om, nm = statistics.median(x[0] for x in olds), statistics.median(x[0] for x in news)
    op, np_ = statistics.median(x[1] for x in olds), statistics.median(x[1] for x in news)
    budget = 256 / 48000 * 1000
    print('median mean: old %.2f ms (%.0f%% of block)  new %.2f ms (%.0f%%)  change %+.1f%%' % (om, om / budget * 100, nm, nm / budget * 100, (nm - om) / om * 100))
    print('median p99:  old %.2f ms  new %.2f ms  change %+.1f%%' % (op, np_, (np_ - op) / op * 100))
    print('blocks over budget (sum): old %d  new %d' % (sum(x[2] for x in olds), sum(x[2] for x in news)))


if __name__ == '__main__':
    main()
