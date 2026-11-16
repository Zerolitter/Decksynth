#!/bin/sh
# Decksynth: touch UI (Electron) on the Python synth engine.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=${DECKSYNTH_ROOT:-$SCRIPT_DIR}
cd "$ROOT/ui"
if [ ! -x "./node_modules/electron/dist/electron" ]; then
  echo "Decksynth UI is not installed. Run npm ci in $ROOT/ui." >&2
  exit 1
fi
if [ ! -e "./dist/index.html" ]; then
  echo "Decksynth UI has not been built. From $ROOT/ui run npm run build." >&2
  exit 1
fi
# Startup from desktop launcher inherits user audio/MIDI session; don't force dummy audio.
unset SDL_AUDIODRIVER
unset DECKSYNTH_UI_PREVIEW
exec "./node_modules/electron/dist/electron" .
