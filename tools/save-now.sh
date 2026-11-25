#!/bin/sh
# Save the running Decksynth session now, from outside the app (for when its window has gone blank).
# The engine writes "Saved now <date>.decksynth" into ~/Music/Decksynth/Autosave. Safe while it plays.
if pkill -USR1 -f 'electron/bridge.py'; then
  sleep 1
  echo "Asked Decksynth to save. Newest files in ~/Music/Decksynth/Autosave:"
  ls -t "$HOME/Music/Decksynth/Autosave" 2>/dev/null | head -3
else
  echo "Decksynth is not running." >&2; exit 1
fi
