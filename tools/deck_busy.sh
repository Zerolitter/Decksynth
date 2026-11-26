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

# An engine worker left behind when its window closed (25 Nov: it kept playing, and crackling). Its /proc environment and cwd can be
# unreadable, so it is found by its command line (multiprocessing.spawn_main), a parent that is init / the user's systemd (an orphan) and a
# cwd inside this checkout (or one that cannot be read).
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
orphan_workers() {
  for dir in /proc/[0-9]*; do
    pid=${dir#/proc/}
    [ "$pid" = "$$" ] && continue
    tr '\0' ' ' 2>/dev/null < "$dir/cmdline" | grep -q 'multiprocessing.spawn import spawn_main' || continue
    ppid=$(awk '/^PPid:/{print $2}' "$dir/status" 2>/dev/null)
    pcomm=$(cat "/proc/$ppid/comm" 2>/dev/null)
    { [ "$ppid" = 1 ] || [ "$pcomm" = systemd ]; } || continue      # still has its window or tool: not an orphan
    cwd=$(readlink "$dir/cwd" 2>/dev/null)
    case "$cwd" in ""|"$ROOT"|"$ROOT"/*) echo "$pid" ;; esac
  done
}

running_pids() {
  orphan_workers
  for dir in /proc/[0-9]*; do
    pid=${dir#/proc/}
    [ "$pid" = "$$" ] && continue
    comm=$(cat "$dir/comm" 2>/dev/null)
    case "$comm" in
      electron*|python*|bridge*|exe) ;;
      *) continue ;;
    esac
    if env=$(tr '\0' '\n' 2>/dev/null < "$dir/environ"); then
      printf '%s\n' "$env" | grep -qx 'DECKSYNTH_USER_APP=1' && echo "$pid"
    else
      # The environment can't be read from inside a container (25 Nov: the guard said "free" while the app was open).
      # Then the app's main process is told by its command line: this checkout's Electron started on "." (launch.sh);
      # test runs start Electron on a test script instead.
      [ "$(tr '\0' ' ' < "$dir/cmdline" 2>/dev/null)" = "$ROOT/ui/node_modules/electron/dist/electron . " ] && echo "$pid"
    fi
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
