"""Bounded, read-only folder catalog and off-render sixteen-pad preparation.

Folder entries describe direct WAV files, not factory presets. Scanning reads
names and metadata only. Preparing a selection decodes at most sixteen sources;
the caller commits the returned kit atomically after its own stale-job checks.
"""
import json
import os
from pathlib import Path
import re

from .drum_rack import PAD_COUNT, new_kit, validate_kit
from .samples import SampleCache


MAX_WAV_FILES = 20000
# A kit saved from Decksynth (Save kit): which file goes on which pad, with names and sound settings.
KIT_FILE = 'decksynth-kit.json'
MAX_FOLDERS = 2048
MAX_DEPTH = 12


def _natural(value):
    return tuple((1, int(part)) if part.isdigit() else (0, part.casefold())
                 for part in re.split(r'(\d+)', str(value)))


def _sample_order(path):
    words = re.findall(r'[a-z]+', path.stem.casefold())
    return ('accent' in words or 'acc' in words, _natural(path.stem),
            path.suffix.casefold(), path.name)


def _roles(path):
    """Recognise instrument words around model numbers and sample variants."""
    words = set(re.findall(r'[a-z]+', path.stem.casefold()))
    compact = ''.join(re.findall(r'[a-z]+', path.stem.casefold()))
    if words & {'cowbell', 'cb'}:
        return (12,)
    if words & {'tambourine', 'tamb', 'tam'}:
        return (13,)
    if words & {'kick', 'bd', 'bassdrum'} or 'bassdrum' in compact:
        return (0, 1)
    if words & {'snare', 'sd'}:
        return (2,)
    if words & {'clap', 'cp', 'cl'}:
        return (3,)
    if words & {'rim', 'rimshot', 'rs'}:
        return (4,)
    if words & {'closedhat', 'ch', 'hhc'} or (
            words & {'hat', 'hihat', 'hh'} and words & {'closed', 'close'}):
        return (6,)
    if words & {'openhat', 'oh', 'hho'} or (
            words & {'hat', 'hihat', 'hh'} and 'open' in words):
        return (7,)
    if words & {'shaker', 'sh'}:
        return (8,)
    if words & {'lowtom', 'lt', 'ltom'} or 'tom' in words and 'low' in words:
        return (9,)
    if words & {'midtom', 'mt', 'mtom'} or 'tom' in words and words & {'mid', 'middle'}:
        return (10,)
    if words & {'hitom', 'hightom', 'ht', 'htom'} or (
            'tom' in words and words & {'hi', 'high'}):
        return (11,)
    if 'ride' in words:
        return (14,)
    if words & {'crash', 'cymbal'}:
        return (15,)
    if words & {'perc', 'percussion'}:
        return (5,)
    return ()


def _select(paths):
    ordered = sorted((path for path in paths if _automatic_hit(path)), key=_sample_order)
    roles = {path: _roles(path) for path in ordered}
    selected = [None] * PAD_COUNT
    used = set()
    for role in range(PAD_COUNT):
        path = next((path for path in ordered if path not in used and role in roles[path]), None)
        if path is not None:
            selected[role] = path
            used.add(path)
    remaining = iter(path for path in ordered if path not in used)
    for number, path in enumerate(selected):
        if path is None:
            selected[number] = next(remaining, None)
    return selected


def _automatic_hit(path):
    """Known demonstration/reference names stay browsable, but do not fill pads."""
    words=re.findall(r'[a-z]+',path.stem.casefold())
    if any(words[i:i+2]==['demo','loop'] for i in range(len(words)-1)):
        return False
    context=re.findall(r'[a-z]+',(path.parent.name+' '+path.stem).casefold())
    ab='ab' in context or any(context[i:i+2]==['a','b'] for i in range(len(context)-1))
    return not (ab and bool(set(context)&{'reference','comparison','example','examples','demo'}))


def _contained(path, root):
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, RuntimeError, ValueError) as exc:
        raise ValueError('Sample path is missing or outside the registered library') from exc
    return resolved


def _checked_file(path, root):
    resolved = _contained(path, root)
    if path.is_symlink() or resolved != path or not resolved.is_file():
        raise ValueError('Sample library files must remain regular local files')
    return resolved


class LibraryIndex:
    """A snapshot of source paths; requests must name an indexed folder ID."""
    BROWSE_PAGE = 48  # bounded UI snapshot even for very large WAV directories

    def __init__(self, root, paths):
        self.root = str(root)
        self._paths = {folder: tuple(files) for folder, files in paths.items()}
        self.folders = [dict(id=folder, name=root.name if folder == '.' else folder,
                             count=len(self._paths[folder]))
                        for folder in sorted(paths, key=lambda value: (_natural(value), value))]

    def sample_path(self, folder_id, index):
        """Resolve only an indexed WAV from the previously scanned folder.

        Never accept an untrusted filesystem path from the UI; recheck symlinks
        after scanning, before playing or replacing a sample.
        """
        paths = self._paths.get(folder_id) if type(folder_id) is str else None
        if paths is None or type(index) is not int or not 0 <= index < len(paths):
            raise ValueError('Unknown sample in this folder')
        return _checked_file(paths[index], Path(self.root))

    def browse(self, folder_id, page=0):
        paths = self._paths.get(folder_id) if type(folder_id) is str else None
        if paths is None or type(page) is not int or not 0 <= page <= (len(paths)-1)//self.BROWSE_PAGE:
            raise ValueError('Unknown sample folder page')
        first = page*self.BROWSE_PAGE
        return dict(folder=folder_id, page=page, total=len(paths),
                    items=[dict(index=i, name=path.stem[:120], filename=path.name[:140])
                           for i,path in enumerate(paths[first:first+self.BROWSE_PAGE],start=first)])

    def prepare(self, folder_id: str, cache: SampleCache):
        """Return a complete detached kit, or raise without changing caller state.

        Successful earlier loads may remain in the bounded sample cache if a
        later source fails. No partially prepared kit escapes this method.
        """
        if not isinstance(folder_id, str) or folder_id not in self._paths:
            raise ValueError('Unknown sample library folder')
        root = Path(self.root)
        selected = _select(self._paths[folder_id])
        saved = self._saved_kit(root, folder_id)
        if saved is not None:
            by_name = {path.name: path for path in self._paths[folder_id]}
            selected = [by_name.get(entry['file']) if isinstance(entry, dict) and isinstance(entry.get('file'), str) else None
                        for entry in saved['pads']]
        if not any(path is not None for path in selected):
            raise ValueError('Folder contains reference audio only; choose a one-shot kit or import a sample explicitly')
        # Resolve every chosen path before any decode; this also rejects a
        # directory replaced with an outside-root symlink after the scan.
        for path in selected:
            if path is not None:
                _checked_file(path, root)
        samples = []
        for path in selected:
            if path is None:
                samples.append(None)
                continue
            # A previous decode can take long enough for later files to change.
            _checked_file(path, root)
            sample = cache.load(path)
            resolved = _checked_file(path, root)
            if sample.path != str(resolved):
                raise ValueError('Decoded sample path does not match its library source')
            samples.append(sample)
        # Earlier files can also change during a later decode. Check the whole
        # selection again before making any kit available to the caller.
        for path in selected:
            if path is not None:
                _checked_file(path, root)
        kit = new_kit()
        kit['name'] = (root.name if folder_id == '.' else folder_id)[:80] or 'Sample library'
        for pad, path, sample in zip(kit['pads'], selected, samples):
            pad['choke'] = 1 if path is not None and set(_roles(path)) & {6, 7} else 0
            if sample is not None:
                pad['name'] = path.stem[:80] or path.name[:80]
                pad['source'] = sample.source
        if saved is not None:
            if isinstance(saved.get('name'), str) and saved['name'].strip(): kit['name'] = saved['name'].strip()[:80]
            for pad, entry, sample in zip(kit['pads'], saved['pads'], samples):
                if sample is None or not isinstance(entry, dict): continue
                for key in ('name', 'gain', 'velocity', 'tune', 'choke', 'shape'):
                    if key in entry: pad[key] = entry[key]
            try: kit = validate_kit(kit)
            except (ValueError, TypeError, KeyError) as exc:
                raise ValueError('The saved kit settings in this folder are damaged') from exc
        return kit, samples

    @staticmethod
    def _saved_kit(root, folder_id):
        side = (root if folder_id == '.' else root / folder_id) / KIT_FILE
        try:
            if not side.is_file() or side.is_symlink() or side.stat().st_size > 262144: return None
            data = json.loads(side.read_text())
        except (OSError, ValueError): return None
        if not isinstance(data, dict) or data.get('version') != 1 or not isinstance(data.get('pads'), list) or len(data['pads']) != PAD_COUNT:
            return None
        return data


def scan_library(root: str | Path) -> LibraryIndex:
    """Catalog direct WAV membership, rejecting scans that exceed fixed caps.

    Hidden entries and symlinks are skipped. Limits count all traversed folders
    (including the root); depth is relative to the root, whose depth is zero.
    """
    try:
        root = Path(root).expanduser().resolve(strict=True)
        if not root.is_dir():
            raise ValueError('Sample library root must be a directory')
    except (OSError, RuntimeError, TypeError) as exc:
        raise ValueError('Sample library root must be an existing directory') from exc
    paths = {}
    pending = [(root, 0)]
    folder_count = 1
    wav_count = 0
    while pending:
        directory, depth = pending.pop()
        _contained(directory, root)
        try:
            with os.scandir(directory) as entries:
                files = []
                for entry in entries:
                    if entry.name.startswith('.') or entry.is_symlink():
                        continue
                    path = directory / entry.name
                    if entry.is_dir(follow_symlinks=False):
                        folder_count += 1
                        if folder_count > MAX_FOLDERS:
                            raise ValueError('Sample library exceeds the folder limit')
                        if depth >= MAX_DEPTH:
                            raise ValueError('Sample library exceeds the nesting depth limit')
                        pending.append((path, depth + 1))
                    elif entry.name.casefold().endswith('.wav') and entry.is_file(follow_symlinks=False):
                        wav_count += 1
                        if wav_count > MAX_WAV_FILES:
                            raise ValueError('Sample library exceeds the WAV file limit')
                        files.append(path)
                if files:
                    folder = directory.relative_to(root).as_posix()
                    paths[folder] = tuple(sorted(files, key=lambda path: (_natural(path.name), path.name)))
        except OSError as exc:
            raise ValueError('Cannot read a sample library folder') from exc
    return LibraryIndex(root, paths)
