#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
DIR="$ROOT/packaging/flatpak"
REPO="$DIR/repo"
BUNDLE="$DIR/dist/Decksynth.flatpak"
MANIFEST="$DIR/local-build.yml"

mkdir -p "$DIR/dist"
rm -rf "$DIR/builddir" "$REPO"
(
  cd "$DIR"
  flatpak run --command=flathub-build org.flatpak.Builder "$MANIFEST"
)

flatpak build-bundle "$REPO" "$BUNDLE" io.github.zerolitter.Decksynth
printf 'Built %s\n' "$BUNDLE"
