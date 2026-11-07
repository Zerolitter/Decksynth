#!/usr/bin/env python3
"""Explicit optional build into the user cache. CC may name a compiler plus arguments."""
import argparse
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from decksynth.spectral_native import library_path


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--force',action='store_true');args=parser.parse_args()
    target=library_path()
    if target.exists() and not args.force:print(target);return
    cc=shlex.split(os.environ['CC']) if os.environ.get('CC') else [next((shutil.which(x) for x in ('cc','gcc','clang') if shutil.which(x)),'')]
    if not cc or not cc[0]:parser.exit(1,'No compiler; set CC (for example /path/to/zig cc). Python fallback remains available.\n')
    target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.spectral-build-',dir=target.parent) as work:
        temporary=Path(work)/'spectral.so'
        result=subprocess.run(cc+['-std=c99','-O3','-ffp-contract=off','-fPIC','-shared',str(ROOT/'decksynth/native/spectral_tables.c'),'-o',str(temporary)],capture_output=True,text=True,timeout=60)
        if result.returncode:parser.exit(1,result.stderr)
        os.replace(temporary,target)
    print(target)


if __name__=='__main__':main()
