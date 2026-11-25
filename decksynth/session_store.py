"""Autosave, recovery files and the On launch choice (25 Nov, after a session was lost to a blank window).

Everything lives on the engine side, so it keeps working when the window is dead:
  - every `autosave` seconds (Settings: Off, 30 s, 1, 2, 5, 10 min) the project is written to
    <folder>/Autosave.decksynth when it changed since the last write;
  - at launch the previous session's autosave is kept as a recovery file (Recovered <date>.decksynth,
    the newest 10 stay), and with On launch = Last project it opens again;
  - SIGUSR1 to the worker (or the bridge, which passes it on; tools/save-now.sh) saves a recovery file now;
  - if the worker stops on an error, it writes one last recovery file on its way out.
The folder is ~/Music/Decksynth/Autosave (with DECKSYNTH_DATA_DIR set, <that dir>/autosave; off in diagnostic runs).
"""
import hashlib
import json
import os
from pathlib import Path
import time

INTERVALS = (0, 30, 60, 120, 300, 600)       # the usual presets in Settings (seconds; 0 is off)
MIN_SECONDS, MAX_SECONDS = 10, 3600          # Custom: any whole number of seconds from 10 s to 60 min


def valid_interval(v):
    return v == 0 or (type(v) is int and MIN_SECONDS <= v <= MAX_SECONDS)
LAUNCH = ('last', 'new')
DEFAULTS = dict(autosave=60, on_launch='last')
KEEP = 10
AUTOSAVE = 'Autosave.decksynth'
MARKER = '.running'


def folder():
    explicit = os.environ.get('DECKSYNTH_DATA_DIR')
    if explicit: return Path(explicit).expanduser().resolve() / 'autosave'
    if os.environ.get('DECKSYNTH_DIAGNOSTIC') == '1' or os.environ.get('DECKSYNTH_NO_AUTOSAVE') == '1': return None
    return Path.home() / 'Music' / 'Decksynth' / 'Autosave'


def valid(settings):
    out = dict(DEFAULTS)
    if isinstance(settings, dict):
        if valid_interval(settings.get('autosave')): out['autosave'] = settings['autosave']
        if settings.get('on_launch') in LAUNCH: out['on_launch'] = settings['on_launch']
    return out


class Session:
    def __init__(self, where=None, clock=time.monotonic):
        self.dir = Path(where) if where is not None else folder()
        self.clock = clock; self.settings = dict(DEFAULTS); self.last = clock(); self.digest = None
        self.saved_at = None; self.error = None; self.rescue = False; self.crashed = False; self.recovered = None
        if self.dir is None: return
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            self.settings = valid(json.loads((self.dir / 'settings.json').read_text()))
        except (OSError, ValueError): pass

    @property
    def on(self):
        return self.dir is not None

    def set(self, changes):
        """Settings › Session: {'autosave': seconds, 'on_launch': 'last' | 'new'}."""
        if not isinstance(changes, dict) or not changes or not set(changes) <= set(DEFAULTS): raise ValueError('Unknown session setting')
        merged = dict(self.settings, **changes)
        if valid(merged) != merged: raise ValueError('Invalid session setting')
        self.settings = merged; self.last = self.clock()
        if self.on: self._write_json('settings.json', self.settings)

    def _write_json(self, name, data):
        tmp = self.dir / (name + '.tmp')
        tmp.write_text(json.dumps(data)); os.replace(tmp, self.dir / name)

    def start(self):
        """At launch: keep the last session as a recovery file, mark this one running.
        Returns the project file to open (On launch = Last project), or None for a new one."""
        if not self.on: return None
        auto = self.dir / AUTOSAVE
        self.crashed = (self.dir / MARKER).exists()
        if auto.is_file():
            stamp = time.strftime('%Y-%m-%d %H%M%S', time.localtime(auto.stat().st_mtime))
            self.recovered = self.dir / ('Recovered %s.decksynth' % stamp)
            try: self.recovered.write_bytes(auto.read_bytes())
            except OSError as exc: self.recovered = None; self.error = str(exc)
            self._prune()
        try: (self.dir / MARKER).write_text(str(os.getpid()))
        except OSError: pass
        return auto if auto.is_file() and self.settings['on_launch'] == 'last' else None

    def _prune(self):
        old = sorted(self.dir.glob('Recovered *.decksynth'), key=lambda p: p.stat().st_mtime, reverse=True)
        for p in old[KEEP:]:
            try: p.unlink()
            except OSError: pass

    def tick(self, project, force=False):
        """Called from the worker loop. Writes the autosave when it is due and the project changed.
        Returns the path written, or None."""
        if not self.on: return None
        now = self.clock()
        if self.rescue:
            self.rescue = False
            return self.save_recovery(project, 'Saved now')
        every = self.settings['autosave']
        if not force and (not every or now - self.last < every): return None
        self.last = now
        try:
            data = json.dumps(project.saved_data(), indent=2, allow_nan=False)
            digest = hashlib.sha1(data.encode()).hexdigest()
            if digest == self.digest and not force: return None
            path = self.dir / AUTOSAVE; tmp = self.dir / (AUTOSAVE + '.tmp')
            with tmp.open('w') as f: f.write(data); f.flush(); os.fsync(f.fileno())
            os.replace(tmp, path)
            self.digest = digest; self.saved_at = time.time(); self.error = None
            return path
        except (OSError, ValueError, TypeError) as exc:
            self.error = str(exc); return None

    def save_recovery(self, project, why='Recovered'):
        if not self.on: return None
        path = self.dir / ('%s %s.decksynth' % (why, time.strftime('%Y-%m-%d %H%M%S')))
        try: project.save(path); self._prune(); return path
        except (OSError, ValueError, TypeError) as exc: self.error = str(exc); return None

    def stop(self, project=None):
        """A clean quit: the autosave gets the final state and the running mark goes."""
        if not self.on: return
        if project is not None: self.tick(project, force=True)
        try: (self.dir / MARKER).unlink()
        except OSError: pass

    def status(self):
        return dict(self.settings, folder=str(self.dir) if self.dir else None, saved_at=self.saved_at, error=self.error)
