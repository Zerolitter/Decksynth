#!/usr/bin/env bash
# Builds the JUCE VST3 helper (decksynth/native/vst3_host) into decksynth/native/prebuilt/decksynth_vst3_host.
# It is a normal Linux program: Windows plugins reach it through yabridge, so no Windows compiler is needed.
# Needs g++, cmake, make and the JUCE Linux dev packages (ALSA, X11, Xext, Xrandr, Xinerama, Xcursor, Xcomposite,
# freetype, fontconfig, GL), plus a JUCE checkout: JUCE_DIR=/path/to/JUCE tools/build-vst3-host.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
: "${JUCE_DIR:?set JUCE_DIR to a JUCE source checkout}"
build="${BUILD_DIR:-${TMPDIR:-/tmp}/decksynth-vst3-host-build}"
cmake -S "$root/decksynth/native/vst3_host" -B "$build" -DJUCE_DIR="$JUCE_DIR" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_EXE_LINKER_FLAGS="-static-libstdc++ -static-libgcc"
cmake --build "$build" -j"${JOBS:-4}"
mkdir -p "$root/decksynth/native/prebuilt"
install -m 755 "$build/decksynth_vst3_host_artefacts/Release/decksynth_vst3_host" "$root/decksynth/native/prebuilt/decksynth_vst3_host" 2>/dev/null \
  || install -m 755 "$build/decksynth_vst3_host_artefacts/decksynth_vst3_host" "$root/decksynth/native/prebuilt/decksynth_vst3_host"
echo "built decksynth/native/prebuilt/decksynth_vst3_host"
