"""The sample library (Sir, 15 Nov evening): save a sample, its trim or a slice to a library folder, and browse the
library like the sound presets. Sir picks the folder samples are saved to and the folders they load from; both are
remembered across launches in <data>/sample-library.json.

Categories are the first-level folders inside each load folder ('Kick', 'Keys', ...); files right inside a load folder
are in a category named after that folder ('Recordings'). The browser shows one category page at a time with a small level outline per sample."""
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .drum_memory import read_settings, write_settings
from .samples import SampleCache

MAX_LOAD_FOLDERS = 8
MAX_FILES = 4000           # per scan, across all load folders
MAX_DEPTH = 4
PAGE_SIZE = 48
BARS = 24
PEAK_FILE_LIMIT = 64 * 1024 * 1024
UNSORTED = 'Unsorted'
_UNSAFE = re.compile(r'[^\w .()+\-#&,\'!]+', re.UNICODE)


def safe_name(text, fallback='Sample'):
    """A file or folder name that stays inside its folder on any file system."""
    name = _UNSAFE.sub(' ', str(text or '')).strip(' .')[:80]
    return re.sub(r'\s+', ' ', name) or fallback


def outline(sample, bars=BARS):
    """Peak level per bar (0..1) across the sample, for the library cards."""
    data, n = sample.data, sample.frames
    if n <= 0: return [0.] * bars
    out = []
    for i in range(bars):
        a, b = i * n // bars, max(i * n // bars + 1, (i + 1) * n // bars)
        part = data[a:b]
        out.append(round(min(1., max(max(part), -min(part))), 3) if len(part) else 0.)
    top = max(out) or 1.
    return [round(v / top, 3) for v in out]


class SampleLibrary:
    def __init__(self, directory, rate, default_root=None):
        self.directory = Path(directory) if directory else None
        self.rate = rate
        self.path = self.directory / 'sample-library.json' if self.directory else None
        root = Path(default_root) if default_root else (self.directory / 'Samples' if self.directory else None)
        self.save_folder = str(root / 'Library') if root else None
        self.load_folders = [str(root / 'Library'), str(root / 'Recordings')] if root else []
        self.error = None
        self._lock = threading.Lock()
        self._io = ThreadPoolExecutor(max_workers=1, thread_name_prefix='sample-library')
        self._index = []            # [dict(name, category, path, bytes)]
        self._scanning = False
        self._revision = 0
        self._page = None           # dict(category, page, items)
        self._peaks = {}            # (path, mtime, size) -> outline
        self._audition = ThreadPoolExecutor(max_workers=1, thread_name_prefix='sample-audition')
        self._preview = None; self._preview_token = 0; self.playing = None
        try:
            value = read_settings(self.path) if self.path else None
            if value is not None: self._apply(self.validate(value))
        except (OSError, ValueError) as exc:
            self.error = 'Could not read the sample library folders: ' + str(exc)

    # -- folders --------------------------------------------------------------------------------
    @staticmethod
    def validate(value):
        if not isinstance(value, dict) or value.get('version') != 1: raise ValueError('Unsupported sample library settings')
        save, load = value.get('save'), value.get('load')
        if save is not None and not isinstance(save, str): raise ValueError('Invalid save folder')
        if not isinstance(load, list) or len(load) > MAX_LOAD_FOLDERS or not all(isinstance(p, str) for p in load):
            raise ValueError('Invalid load folders')
        return dict(version=1, save=save, load=list(dict.fromkeys(load)))

    def _apply(self, value):
        if value['save']: self.save_folder = value['save']
        self.load_folders = value['load']

    def settings(self):
        return dict(version=1, save=self.save_folder, load=list(self.load_folders))

    def _remember(self):
        if self.path is None: return
        write_settings(self.path, self.validate(self.settings()))

    @staticmethod
    def _folder(path, create=False):
        p = Path(str(path)).expanduser()
        if create: p.mkdir(parents=True, exist_ok=True)
        if not p.is_dir(): raise ValueError('Choose a folder that exists')
        return str(p.resolve())

    def set_save_folder(self, path):
        """Where Save to library writes. It is also browsed (added to the load folders)."""
        folder = self._folder(path, create=True)
        self.save_folder = folder
        if not any(Path(folder).is_relative_to(Path(f)) for f in self.load_folders if Path(f).exists()):
            self.load_folders = (self.load_folders + [folder])[-MAX_LOAD_FOLDERS:]
        self._remember(); self.scan()

    def add_load_folder(self, path):
        folder = self._folder(path)
        if folder not in self.load_folders:
            if len(self.load_folders) >= MAX_LOAD_FOLDERS: raise ValueError('The library browses up to %d folders' % MAX_LOAD_FOLDERS)
            self.load_folders.append(folder)
        self._remember(); self.scan()

    def remove_load_folder(self, path):
        if path not in self.load_folders: raise ValueError('That folder is not in the library')
        self.load_folders = [f for f in self.load_folders if f != path]
        self._remember(); self.scan()

    # -- scanning and browsing ------------------------------------------------------------------
    def scan(self):
        """Rescan the load folders in the background."""
        with self._lock: self._scanning = True
        folders = list(self.load_folders)
        self._io.submit(self._scan, folders)

    def _scan(self, folders):
        found, seen = [], set()
        try:
            for root in folders:
                base = Path(root)
                if not base.is_dir(): continue
                for here, dirs, files in os.walk(base):
                    depth = len(Path(here).relative_to(base).parts)
                    dirs[:] = sorted(d for d in dirs if not d.startswith('.')) if depth < MAX_DEPTH else []
                    for f in sorted(files, key=str.lower):
                        if not f.lower().endswith('.wav') or f.startswith('.'): continue
                        path = str(Path(here) / f)
                        if path in seen: continue
                        seen.add(path)
                        rel = Path(here).relative_to(base).parts
                        try: size = os.path.getsize(path)
                        except OSError: continue
                        found.append(dict(name=Path(f).stem, category=rel[0] if rel else (base.name or UNSORTED), path=path, bytes=size))
                        if len(found) >= MAX_FILES: break
                    if len(found) >= MAX_FILES: break
        finally:
            with self._lock:
                self._index = found; self._scanning = False; self._revision += 1
                page = self._page
            if page is not None: self.browse(page['category'], page['page'])

    def categories(self):
        counts = {}
        for item in self._index: counts[item['category']] = counts.get(item['category'], 0) + 1
        return [dict(name=k, count=counts[k]) for k in sorted(counts, key=lambda k: (k == UNSORTED, k.lower()))]

    def browse(self, category, page=0):
        """Show one category ('' for all), PAGE_SIZE samples a page; outlines are worked out in the background."""
        if not isinstance(category, str) or type(page) is not int or page < 0: raise ValueError('Choose a category')
        with self._lock:
            items = [i for i in self._index if not category or i['category'] == category]
            pages = max(1, (len(items) + PAGE_SIZE - 1) // PAGE_SIZE); page = min(page, pages - 1)
            shown = [dict(i, peaks=self._peaks.get(self._key(i))) for i in items[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]]
            self._page = dict(category=category, page=page, pages=pages, total=len(items), items=shown)
        todo = [i for i in shown if i['peaks'] is None and i['bytes'] <= PEAK_FILE_LIMIT]
        if todo: self._io.submit(self._outline, todo)

    @staticmethod
    def _key(item):
        try: return (item['path'], os.path.getmtime(item['path']), item['bytes'])
        except OSError: return (item['path'], 0, item['bytes'])

    def _outline(self, items):
        cache = SampleCache(self.rate, 32 * 1024 * 1024)
        for item in items:
            try: peaks = outline(cache.load(item['path']))
            except Exception: peaks = []      # unreadable: a card without an outline
            with self._lock:
                self._peaks[self._key(item)] = peaks
                if self._page:
                    for shown in self._page['items']:
                        if shown['path'] == item['path']: shown['peaks'] = peaks

    def contains(self, path):
        """True when a path is a WAV the library listed (only those can be loaded or auditioned from it)."""
        return any(i['path'] == path for i in self._index)

    # -- saving ---------------------------------------------------------------------------------
    def target(self, category, name):
        """A new file path in the save folder: <save>/<category>/<name>.wav, never overwriting."""
        if not self.save_folder: raise ValueError('Choose a folder to save samples to')
        folder = Path(self.save_folder) / safe_name(category, 'Unsorted')
        folder.mkdir(parents=True, exist_ok=True)
        stem = safe_name(name); path = folder / (stem + '.wav'); k = 2
        while path.exists(): path = folder / ('%s %d.wav' % (stem, k)); k += 1
        return path

    # -- audition -------------------------------------------------------------------------------
    def preview(self, path):
        if not self.contains(path): raise ValueError('Open the library to audition its samples')
        self._preview_token += 1
        self._preview = (self._audition.submit(SampleCache(self.rate, 16 * 1024 * 1024).load, path), self._preview_token, path)

    def stop_preview(self):
        self._preview_token += 1; self._preview = None; self.playing = None

    def poll(self):
        """On the audio worker: a finished audition load to play now, or None."""
        p = self._preview
        if p is None or not p[0].done(): return None
        self._preview = None
        if p[1] != self._preview_token: return None
        try: sample = p[0].result()
        except Exception as exc:
            self.error = 'Could not play ' + Path(p[2]).name + ': ' + str(exc); return None
        self.playing = p[2]; return sample

    def snapshot(self):
        with self._lock:
            page = dict(self._page, items=[dict(i) for i in self._page['items']]) if self._page else None
            return dict(save=self.save_folder, load=list(self.load_folders), scanning=self._scanning, revision=self._revision,
                        categories=self.categories(), page=page, error=self.error)

    def close(self):
        self._io.shutdown(wait=False, cancel_futures=True); self._audition.shutdown(wait=False, cancel_futures=True)
