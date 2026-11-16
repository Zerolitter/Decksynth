#!/bin/sh
# Point the Flatpak recipe at a release tag: sets its tag and the exact commit it names.
#   packaging/flatpak/pin-release.sh v0.2.2
set -eu
TAG=${1:?usage: pin-release.sh <tag>}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
COMMIT=$(git -C "$ROOT" rev-parse "$TAG^{commit}")
YML="$ROOT/packaging/flatpak/io.github.zerolitter.Decksynth.yml"
sed -i -e "s|^        tag: v.*|        tag: $TAG|" \
       -e "s|^        commit: [0-9a-f]*|        commit: $COMMIT|" "$YML"
grep -n -A1 "tag: $TAG" "$YML"
