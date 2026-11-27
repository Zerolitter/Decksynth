"""Set up plugin hosting (27 Nov): fetches the plugin libraries (pedalboard, which hosts VST3 plugins, and numpy) for
this Python from PyPI and unpacks them into Decksynth's own data folder. Nothing is installed system-wide, nothing
in the app changes, and removing the folder undoes it.

Run as its own process by plugin_host.py: `python -I plugin_setup.py <folder>`. It prints one JSON line per step
({step, progress}) and a last line ({done: true} or {error}). Every file is checked against PyPI's sha256."""
import hashlib
import io
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

PACKAGES = ('numpy', 'pedalboard')
INDEX = 'https://pypi.org/pypi/%s/json'
MAX_BYTES = 80 * 1024 * 1024


def say(**obj):
    print(json.dumps(obj), flush=True)


def tag():
    return 'cp%d%d' % sys.version_info[:2]


def pick(meta, py):
    """The manylinux x86_64 wheel built for this Python (cp314 for 3.14)."""
    for u in meta['urls']:
        name = u['filename']
        if name.endswith('.whl') and '-%s-%s-' % (py, py) in name and 'manylinux' in name and name.endswith('x86_64.whl'):
            return u
    return None


def fetch(url, size, done, total):
    with urllib.request.urlopen(url, timeout=60) as r:
        out = io.BytesIO(); got = 0
        while True:
            chunk = r.read(256 * 1024)
            if not chunk: break
            got += len(chunk); out.write(chunk)
            if got > MAX_BYTES: raise ValueError('Download larger than expected')
            say(step='download', progress=round(min(.95, (done + got) / max(1, total)), 3))
    return out.getvalue()


def main(folder):
    folder = Path(folder); py = tag()
    if sys.platform != 'linux': raise ValueError('Plugin hosting is set up for Linux only')
    wheels = []
    for name in PACKAGES:
        with urllib.request.urlopen(INDEX % name, timeout=30) as r: meta = json.load(r)
        w = pick(meta, py)
        if w is None: raise ValueError('%s has no build for Python %d.%d yet' % (name, *sys.version_info[:2]))
        wheels.append(w)
    total = sum(w['size'] for w in wheels); done = 0
    target = folder / py; part = folder / (py + '.part')
    shutil.rmtree(part, ignore_errors=True); part.mkdir(parents=True)
    for w in wheels:
        data = fetch(w['url'], w['size'], done, total); done += len(data)
        if hashlib.sha256(data).hexdigest() != w['digests']['sha256']: raise ValueError(w['filename'] + ' failed its checksum')
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for item in z.namelist():
                dest = (part / item).resolve()
                if part.resolve() not in dest.parents: raise ValueError('Unsafe path in ' + w['filename'])
            z.extractall(part)
    say(step='unpack', progress=.98)
    shutil.rmtree(target, ignore_errors=True); part.rename(target)
    say(done=True, path=str(target))


if __name__ == '__main__':
    try: main(sys.argv[1])
    except Exception as exc:
        say(error=str(exc) or exc.__class__.__name__); sys.exit(1)
