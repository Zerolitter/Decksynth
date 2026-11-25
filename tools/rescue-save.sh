#!/bin/sh
# Rescue save: write Sir's running session to disk now, from outside the app (for when the window is blank or
# frozen). Sends SIGUSR1 to the engine worker; the worker only sets a flag, and its own loop writes
# "Saved now <date>.decksynth" into ~/Music/Decksynth/Autosave (or $DECKSYNTH_DATA_DIR/autosave). Safe while it
# plays; nothing is written into the engine's command pipe.
#
#   tools/rescue-save.sh          save, then show the file that was written (a window when started from the desktop)
#   tools/rescue-save.sh --pid N  signal this bridge or worker process instead of looking for Sir's running app
set -u
PID=
[ "${1:-}" = "--pid" ] && PID=${2:-}
DIR="${DECKSYNTH_DATA_DIR:+$DECKSYNTH_DATA_DIR/autosave}"
DIR="${DIR:-$HOME/Music/Decksynth/Autosave}"

say() {
  echo "$1"
  if [ ! -t 1 ]; then
    if command -v kdialog >/dev/null 2>&1; then kdialog --title "Decksynth rescue save" --msgbox "$1" >/dev/null 2>&1
    elif command -v notify-send >/dev/null 2>&1; then notify-send "Decksynth rescue save" "$1"; fi
  fi
}

bridge=$PID
[ -n "$bridge" ] || bridge=$(pgrep -f '^[^ ]*python[0-9.]* (-u )?[^ ]*electron/bridge\.py' | head -n1)
if [ -z "$bridge" ]; then say "Decksynth is not running, so there is nothing to save."; exit 1; fi
# The engine worker is the bridge's child; the bridge also passes the signal on, so either pid works.
worker=$(pgrep -P "$bridge" -f 'multiprocessing.spawn import spawn_main' | head -n1)
target=${worker:-$bridge}

before=$(ls -t "$DIR"/'Saved now '*.decksynth 2>/dev/null | head -n1)
kill -USR1 "$target" || { say "Could not signal Decksynth (process $target)."; exit 1; }
i=0
while [ "$i" -lt 20 ]; do
  sleep 0.5; i=$((i + 1))
  after=$(ls -t "$DIR"/'Saved now '*.decksynth 2>/dev/null | head -n1)
  if [ -n "$after" ] && [ "$after" != "$before" ]; then say "Session saved:
$after"; exit 0; fi
done
say "Asked Decksynth to save, but no new file appeared in $DIR within 10 s. The engine may be stuck; try once more."
exit 1
