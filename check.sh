#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
export DECKSYNTH_NO_AUTOSAVE=1  # tests never read or write the real autosave folder
python3 -m compileall -q decksynth tools tests
python3 -m unittest discover -s tests -v
python3 tools/render_check.py
