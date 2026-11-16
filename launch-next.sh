#!/bin/sh
# DeckSynth Next: experimental Chordz-inspired UI, existing Python synth engine.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=${DECKSYNTH_ROOT:-$SCRIPT_DIR}
cd "$ROOT/ui-next"
if [ ! -x "./node_modules/electron/dist/electron" ]; then
  echo "DeckSynth Next is not installed. Preserve original: $ROOT/launch.sh" >&2
  exit 1
fi
if [ ! -e "./dist/index.html" ]; then
  echo "DeckSynth Next has not been built. From $ROOT/ui-next run npm run build." >&2
  exit 1
fi
# Startup from desktop launcher inherits user audio/MIDI session; don't force dummy audio.
unset SDL_AUDIODRIVER
unset DECKSYNTH_UI_PREVIEW
exec "./node_modules/electron/dist/electron" .
