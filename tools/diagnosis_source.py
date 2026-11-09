#!/usr/bin/env python3
"""Collect tracked source for diagnosis; never import the archived collector.

Its broad ``core.*`` crash rule omitted decksynth/core.py. Only numeric core
dump names are excluded here. Completeness is checked independently of the
copy filter, alongside hashes. No device/profile/music/temp-tree collection.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

SKIP_TREES = {'node_modules', '__pycache__', '.runtime', '.git', '.venv', 'reference'}
AUDIO = {'.wav', '.mp3', '.flac', '.aif', '.aiff', '.ogg', '.m4a'}
SECRET = {'.pem', '.key', '.p12', '.pfx'}
SOURCE = {'.py', '.tsx', '.ts', '.js', '.cjs', '.mjs', '.sh', '.css', '.html', '.json', '.md', '.toml'}


def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def private_path(path):
    return (bool(set(path.parts) & SKIP_TREES) or path.name.startswith('.env')
            or path.suffix.lower() in AUDIO | SECRET | {'.decksynth'})


def verify_source_inventory(root, destination, tracked, report):
    # Deliberately independent of the binary/crash filter used for copying.
    expected = {name for name in tracked if Path(name).suffix.lower() in SOURCE
                and not private_path(Path(name)) and not (root / name).is_symlink()}
    included = {row['path'] for row in report['files']}
    missing = expected - included
    if missing:
        raise ValueError('Missing tracked source: ' + ', '.join(sorted(missing)))
    for row in report['files']:
        if sha(destination / 'workspace' / row['path']) != row['sha256']:
            raise ValueError('Collected member hash mismatch: ' + row['path'])
        if sha(root / row['path']) != row['sha256']:
            raise ValueError('Source changed during collection: ' + row['path'])


def collect_source(root, destination, tracked):
    root, destination = Path(root), Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    report = {'files': [], 'excluded': []}
    for name in sorted(tracked):
        rel = Path(name)
        if rel.is_absolute() or '..' in rel.parts:
            raise ValueError('Unsafe source path: ' + name)
        p = root / rel
        crash = p.name == 'core' or re.fullmatch(r'core(?:\.\d+)+', p.name)
        if private_path(rel) or p.suffix.lower() in {'.pyc', '.so', '.core', '.dmp'} or crash or p.is_symlink():
            report['excluded'].append(name)
            continue
        target = destination / 'workspace' / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = sha(p)
        shutil.copy2(p, target)
        report['files'].append({'path': name, 'sha256': digest, 'bytes': p.stat().st_size})
    verify_source_inventory(root, destination, tracked, report)
    (destination / 'source-manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--out', type=Path, required=True, help='A new directory outside the live checkout')
    args = parser.parse_args()
    if args.out.resolve().is_relative_to(args.root.resolve()):
        parser.error('--out must be outside the live checkout')
    tracked = subprocess.check_output([str(args.root / 'tools/source-git'), 'ls-files', '-z'], cwd=args.root)
    paths = [p for p in tracked.decode().split('\0') if p]
    result = collect_source(args.root, args.out, paths)
    print(json.dumps({'included': len(result['files']), 'excluded': len(result['excluded']), 'complete': True}))
