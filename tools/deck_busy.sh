#!/bin/sh
# Is the maintainer's own Decksynth open? Screen tests, Electron windows and heavy builds must not run beside it:
# background load can blank his window and lose the session (25 Nov).
#
#   tools/deck_busy.sh              guard: exit 0 if the Deck is free; if his Decksynth is open, say so and exit 75
#   tools/deck_busy.sh --wait 120   guard that waits up to 120 s for the app to close before giving up
#   tools/deck_busy.sh --list       print the process ids of his running Decksynth (exit 0 if any, 1 if none)
#   DECKSYNTH_ALLOW_BUSY=1 ...      override: the guard passes (the maintainer's own decision)
#
# "His Decksynth" = a process started by launch.sh, which marks its environment with DECKSYNTH_USER_APP=1
# (Electron, its renderers and the engine worker inherit it). Test runs start their own Electron directly
# from the tests, so they never carry the mark and are never mistaken for his app.
mode=guard; wait=0
while [ $# -gt 0 ]; do
  case "$1" in
    --list) mode=list ;;
    --wait) wait=${2:-0}; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
  esac
  shift
done

running_pids() {
  for dir in /proc/[0-9]*; do
    pid=${dir#/proc/}
    [ "$pid" = "$$" ] && continue
    [ -r "$dir/environ" ] || continue
    comm=$(cat "$dir/comm" 2>/dev/null)
    case "$comm" in
      electron*|python*|bridge*|exe) ;;
      *) continue ;;
    esac
    tr '\0' '\n' < "$dir/environ" 2>/dev/null | grep -qx 'DECKSYNTH_USER_APP=1' && echo "$pid"
  done
}

if [ "$mode" = list ]; then
  pids=$(running_pids)
  [ -n "$pids" ] && { echo "$pids"; exit 0; }
  exit 1
fi

[ "${DECKSYNTH_ALLOW_BUSY:-}" = 1 ] && exit 0
waited=0
while :; do
  pids=$(running_pids)
  [ -z "$pids" ] && exit 0
  [ "$waited" -ge "$wait" ] && break
  [ "$waited" = 0 ] && echo "Decksynth is open on this Deck; waiting up to $wait s for it to close..." >&2
  sleep 5; waited=$((waited + 5))
done
echo "Decksynth is open (process $(echo $pids | tr '\n' ' ')): not starting screen tests, Electron or a heavy build beside it," >&2
echo "because the load can blank the window and lose the session. Close Decksynth, or set DECKSYNTH_ALLOW_BUSY=1 to go ahead." >&2
exit 75
