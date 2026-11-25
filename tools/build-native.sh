#!/bin/sh
# Build Decksynth's optional C kernels (FX, synth voice, spectral tables, drums, sampler).
# Needs a C compiler (cc, gcc or clang, or CC="zig cc"). SteamOS has none by default;
# the release download ships these prebuilt, so most people never run this.
#
#   tools/build-native.sh            build into ~/.cache/decksynth/native (what the app loads)
#   tools/build-native.sh DIR        build the cached kernels into DIR instead (used for releases)
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PY=${DECKSYNTH_PYTHON:-python3}
cd "$ROOT"

CC_CMD=${CC:-}
if [ -z "$CC_CMD" ]; then
  for c in cc gcc clang; do
    if command -v "$c" >/dev/null 2>&1; then CC_CMD=$c; break; fi
  done
fi
if [ -z "$CC_CMD" ]; then
  echo "No C compiler found; skipping native kernels (Decksynth uses its slower Python fallback)." >&2
  exit 2
fi
export CC="$CC_CMD"

# 1) FX library next to the engine (decksynth/native/libdsfx.so)
# -ffp-contract=off like the cached kernels: no fused multiply-add, so the sound is the same on every CPU (zig cc builds for this CPU)
# shellcheck disable=SC2086
$CC_CMD -O2 -ffp-contract=off -shared -fPIC -o decksynth/native/libdsfx.so decksynth/native/dsfx.c -lm

# 2) Content-addressed kernels the engine looks for in $XDG_CACHE_HOME/decksynth/native
if [ "$#" -gt 0 ]; then
  STAGE=$(mktemp -d)
  trap 'rm -rf "$STAGE"' EXIT
  export XDG_CACHE_HOME="$STAGE"
fi
"$PY" tools/build-native-filter.py --force >/dev/null
"$PY" tools/build-native-spectral.py --force >/dev/null
"$PY" tools/build-native-drums.py --force >/dev/null
"$PY" -c 'import sys; sys.path.insert(0, "."); from decksynth.sampler_native import build_library; build_library(force=True)'
if [ "$#" -gt 0 ]; then
  mkdir -p "$1"
  cp "$STAGE"/decksynth/native/*.so "$1"/
  echo "Native kernels built into $1"
else
  echo "Native kernels built into ${XDG_CACHE_HOME:-$HOME/.cache}/decksynth/native"
fi
