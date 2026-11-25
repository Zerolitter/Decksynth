#!/bin/sh
# Decksynth: touch UI (Electron) on the Python synth engine.
# Works from the release download (ready to run) and from a git clone after ./install.sh.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=${DECKSYNTH_ROOT:-$SCRIPT_DIR}
ELECTRON="$ROOT/ui/node_modules/electron/dist/electron"
RELEASES=https://github.com/Zerolitter/Decksynth/releases/latest

ready() { [ -x "$ELECTRON" ] && [ -e "$ROOT/ui/dist/index.html" ]; }

if ! ready; then
  MSG="Decksynth isn't set up yet.

Easiest: download the ready-to-run Decksynth-*-linux-x86_64.tar.gz from
$RELEASES
and run launch.sh from that folder.

From this git clone: run ./install.sh once (one-time setup, about 300 MB)."
  if [ -t 0 ] && [ -t 1 ]; then
    printf '%s\n\nRun ./install.sh now? [Y/n] ' "$MSG"
    read -r answer || answer=n
    case "$answer" in
      ""|y|Y|yes|Yes) "$ROOT/install.sh" || exit 1 ;;
      *) exit 1 ;;
    esac
  else
    # Started from the desktop or Steam: ask in a window, run the setup in Konsole.
    ask="$MSG

Run the one-time setup now?"
    if command -v kdialog >/dev/null 2>&1; then
      kdialog --title Decksynth --yesno "$ask" || exit 1
    elif command -v zenity >/dev/null 2>&1; then
      zenity --question --title=Decksynth --text="$ask" || exit 1
    else
      echo "$MSG" >&2; exit 1
    fi
    if command -v konsole >/dev/null 2>&1; then
      exec konsole -e "$ROOT/install.sh" --launch
    fi
    exec x-terminal-emulator -e "$ROOT/install.sh" --launch
  fi
  ready || exit 1
fi

# Release downloads carry prebuilt native kernels; put any missing ones where the engine looks.
if [ -d "$ROOT/decksynth/native/prebuilt" ]; then
  CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/decksynth/native"
  mkdir -p "$CACHE"
  for lib in "$ROOT"/decksynth/native/prebuilt/*.so; do
    [ -e "$lib" ] || continue
    [ -e "$CACHE/$(basename "$lib")" ] || cp "$lib" "$CACHE/"
  done
fi

cd "$ROOT/ui"
# Startup from desktop launcher inherits user audio/MIDI session; don't force dummy audio.
unset SDL_AUDIODRIVER
unset DECKSYNTH_UI_PREVIEW
# Mark this as the real app, so test runs and builds can tell it from their own Electron (tools/deck_busy.sh).
export DECKSYNTH_USER_APP=1
exec "$ELECTRON" . "$@"
