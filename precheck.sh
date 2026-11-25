#!/bin/sh
# One command that runs exactly what CI runs, so a change ends with a single check.
#
#   ./precheck.sh           Python tests, sound goldens, UI type check and build, UI unit tests
#   ./precheck.sh --touch   the same, plus the touch-target test (needs the display, runs on the Deck)
#
# Node: on the Deck, export PATH=/home/deck/.nvm/versions/node/v26.13.0/bin:$PATH first.
set -eu
cd -- "$(dirname -- "$0")"

# Not beside the maintainer's own Decksynth: the build and the tests can blank his window (DECKSYNTH_ALLOW_BUSY=1 overrides).
sh tools/deck_busy.sh

echo "== Python: compile, tests (sound goldens and save/load round trip included), render check"
./check.sh

echo "== UI: type check and build"
cd ui
[ -d node_modules ] || npm ci
npm run build

echo "== UI: unit tests"
npm test

if [ "${1:-}" = "--touch" ]; then
  echo "== UI: touch targets at 1280x718"
  node tests/touch_target_acceptance.cjs
fi
echo "precheck passed"
