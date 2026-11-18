#!/bin/sh
# Build the ready-to-run download: packaging/release/dist/Decksynth-<version>-linux-<arch>.tar.gz
# Needs Node.js 22.12+, npm, Python 3 with pip and a C compiler. People who
# download it need neither build tools nor pip; optional telemetry wheels are bundled.
#
#   packaging/release/build-release.sh [version]     (default: git describe, e.g. v0.2.1)
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"
VERSION=${1:-$(git describe --tags --always 2>/dev/null || echo dev)}
case "$(uname -m)" in x86_64) ARCH=x86_64 ;; aarch64) ARCH=arm64 ;; *) ARCH=$(uname -m) ;; esac
NAME="Decksynth-$VERSION-linux-$ARCH"
OUT="$ROOT/packaging/release/dist"
STAGE="$OUT/$NAME"

echo "== Building UI"
(cd ui && npm ci --no-audit --no-fund && npm run build)

echo "== Building native kernels"
rm -rf decksynth/native/prebuilt
tools/build-native.sh decksynth/native/prebuilt

echo "== Assembling $NAME"
rm -rf "$STAGE" "$OUT/$NAME.tar.gz"
mkdir -p "$STAGE/ui/node_modules/electron" "$STAGE/ui/src" "$STAGE/packaging/flatpak" "$STAGE/tools" "$STAGE/observability" "$STAGE/docs"
cp -a launch.sh install.sh diagnose-audio.sh LICENSE "$STAGE/"
cp requirements-observability.lock "$STAGE/"
cp docs/OBSERVABILITY.md "$STAGE/docs/"
cp -a decksynth "$STAGE/"
cp -a ui/dist ui/electron ui/demo-kits ui/package.json ui/package-lock.json "$STAGE/ui/"
cp -a ui/src/preview-state.json "$STAGE/ui/src/"
cp -a ui/node_modules/electron/dist "$STAGE/ui/node_modules/electron/"
cp -a packaging/flatpak/io.github.zerolitter.Decksynth.svg "$STAGE/packaging/flatpak/"
cp -a tools/build-native.sh tools/build-native-*.py "$STAGE/tools/"
python3 -m pip install --disable-pip-version-check --no-deps --require-hashes \
  --target "$STAGE/observability" -r requirements-observability.lock
find "$STAGE" -name '__pycache__' -type d -prune -exec rm -rf {} +
cat > "$STAGE/README.txt" <<TXT
Decksynth $VERSION (ready to run)

1. Keep this folder somewhere permanent, for example ~/Applications/Decksynth.
2. Double-click launch.sh (or run ./launch.sh in Konsole) to play.
3. Optional: run ./install.sh once to add Decksynth to the app menu.
   Then right-click it in the menu and choose "Add to Steam" to play it in Game Mode.

Needs Python 3 and SDL2, which SteamOS already has.

Optional Dash0/OpenTelemetry telemetry is disabled by default. See
docs/OBSERVABILITY.md for opt-in setup and privacy safeguards.
https://github.com/Zerolitter/Decksynth
TXT
(cd "$OUT" && tar -czf "$NAME.tar.gz" "$NAME" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
rm -rf decksynth/native/prebuilt
echo "Built $OUT/$NAME.tar.gz"
