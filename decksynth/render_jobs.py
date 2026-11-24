"""Offline renders (freeze, WAV export) in their own low-priority process.

The audio worker must never share Python's lock with a long render, or playback crackles.
A job is a JSON file (the project plus what to render); the child prints one JSON line per
progress step and a final {"done": ...} or {"error": ...}. Run as:
    python3 -m decksynth.render_jobs <job.json>
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _emit(obj):
    sys.stdout.write(json.dumps(obj, allow_nan=False)+'\n'); sys.stdout.flush()


def run_job(job):
    from .core import Project
    with tempfile.TemporaryDirectory() as d:
        f = Path(d)/'project.json'; f.write_text(json.dumps(job['project']))
        project = Project.load(f)
    last = [0.]

    def progress(value):
        now = time.monotonic()
        if now-last[0] > .2: last[0] = now; _emit(dict(progress=round(value, 3)))
    if job['kind'] == 'freeze':
        from .freeze import render_freeze
        if job.get('modes'):
            # Song and Loop in one go, one file each, one progress bar for both.
            metas = []; count = len(job['modes'])
            for i, (mode, path) in enumerate(zip(job['modes'], job['path'])):
                temp = path+'.part'
                meta = render_freeze(project, job['track'], job['rate'], temp,
                                     lambda v, i=i: progress((i+v)/count), mode=mode)
                os.replace(temp, path); meta['file'] = path; metas.append(meta)
            return metas
        temp = job['path']+'.part'
        meta = render_freeze(project, job['track'], job['rate'], temp, progress)
        os.replace(temp, job['path']); meta['file'] = job['path']
        return meta
    if job['kind'] == 'export_wav':
        from .render_export import export_project_wav
        export_project_wav(project, job['rate'], job['path'], progress=progress)
        return dict(path=job['path'])
    if job['kind'] == 'export_loop':
        from .loop_export import export_loop_wav
        opts = job.get('opts') or {}
        return export_loop_wav(project, job['rate'], job['path'], track=job.get('track'),
                               kind=opts.get('kind', 'loop'), headroom=bool(opts.get('headroom')), progress=progress)
    raise ValueError('Unknown render job')


def main(argv):
    try: os.nice(10)
    except (OSError, AttributeError): pass
    try:
        job = json.loads(Path(argv[1]).read_text())
        _emit(dict(done=run_job(job)))
    except Exception as exc:
        _emit(dict(error=str(exc) or type(exc).__name__))
        return 1
    return 0


class RenderJob:
    """One running child render. poll() returns new progress / result messages without blocking."""
    def __init__(self, kind, project_data, rate, path, track=None, meta=None):
        self.kind = kind; self.track = track; self.meta = meta or {}; self.path = path
        self.progress = 0.; self.result = None; self.error = None; self.finished = False
        self.lines = []; self.lock = threading.Lock()
        fd, self.job_file = tempfile.mkstemp(prefix='decksynth-job-', suffix='.json')
        with os.fdopen(fd, 'w') as f:
            json.dump(dict(kind=kind, project=project_data, rate=rate, path=[str(x) for x in path] if isinstance(path, list) else str(path),
                           track=track, modes=self.meta.get('modes'), opts=self.meta.get('opts')), f, allow_nan=False)
        env = dict(os.environ); env['PYTHONPATH'] = str(ROOT)+os.pathsep+env.get('PYTHONPATH', '')
        self.proc = subprocess.Popen([sys.executable, '-u', '-m', 'decksynth.render_jobs', self.job_file],
                                     stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                     text=True, env=env, cwd=str(ROOT))
        self.reader = threading.Thread(target=self._read, daemon=True); self.reader.start()

    def _read(self):
        for line in self.proc.stdout:
            try: item = json.loads(line)
            except ValueError: continue
            with self.lock: self.lines.append(item)
        self.proc.wait()
        with self.lock: self.lines.append(dict(_exit=self.proc.returncode))

    def poll(self):
        with self.lock: items, self.lines = self.lines, []
        for item in items:
            if 'progress' in item: self.progress = float(item['progress'])
            elif 'done' in item: self.result = item['done']; self.progress = 1.
            elif 'error' in item: self.error = item['error']
            elif '_exit' in item:
                self.finished = True
                if self.result is None and self.error is None: self.error = 'Render stopped'
                self._cleanup()
        return self.finished

    def cancel(self):
        if not self.finished:
            try: self.proc.terminate()
            except OSError: pass
        self.error = self.error or 'cancelled'

    def wait(self, timeout=None):
        end = None if timeout is None else time.monotonic()+timeout
        while not self.poll():
            if end is not None and time.monotonic() > end: raise TimeoutError('Render took too long')
            time.sleep(.02)
        return self

    def _cleanup(self):
        try: os.unlink(self.job_file)
        except OSError: pass
        if self.result is None:
            for p in [str(x)+'.part' for x in (self.path if isinstance(self.path, list) else [self.path])]:
                try: os.unlink(p)
                except OSError: pass


if __name__ == '__main__':
    sys.exit(main(sys.argv))
