#!/bin/sh
# One-time Decksynth setup on SteamOS or another Linux desktop. No root, no developer tools needed.
#
#   ./install.sh            set up (or refresh) Decksynth in this folder and add it to the app menu
#   ./install.sh --launch   same, then start Decksynth
#   ./install.sh --rebuild  rebuild the UI even if it is already built
#
# In a git clone this downloads Node.js into .tools/ (only if a recent one isn't installed),
# installs the UI's packages and builds it. In the release download that is already done,
# so it only adds the menu entry.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LAUNCH=0; REBUILD=0
for arg in "$@"; do
  case "$arg" in
    --launch) LAUNCH=1 ;;
    --rebuild) REBUILD=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
fail() {
  printf '\nSetup stopped: %s\n' "$*" >&2
  if [ -t 0 ] && [ "$LAUNCH" = 1 ]; then printf 'Press Enter to close. '; read -r _ || true; fi
  exit 1
}

# 1) What the engine needs from the system (both are part of SteamOS)
say "Checking Python 3 and SDL2"
command -v python3 >/dev/null 2>&1 || fail "python3 is missing. Install Python 3 with your package manager."
python3 -c 'import ctypes; ctypes.CDLL("libSDL2-2.0.so.0")' 2>/dev/null \
  || fail "libSDL2-2.0.so.0 is missing. Install SDL2 (package sdl2 or libsdl2-2.0-0)."
echo "ok"

# 2) The UI (skipped in the release download, which ships it built)
ELECTRON="$ROOT/ui/node_modules/electron/dist/electron"
if [ "$REBUILD" = 1 ] || [ ! -x "$ELECTRON" ] || [ ! -e "$ROOT/ui/dist/index.html" ]; then
  [ -e "$ROOT/ui/package-lock.json" ] || fail "ui/package-lock.json is missing; re-download Decksynth."

  node_ok() {
    command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || return 1
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'
  }
  PATH="$ROOT/.tools/node/bin:$PATH"; export PATH
  if ! node_ok; then
    say "Downloading Node.js (only used to build the UI, kept in $ROOT/.tools)"
    case "$(uname -m)" in
      x86_64) ARCH=x64 ;;
      aarch64) ARCH=arm64 ;;
      *) fail "no Node.js download for $(uname -m)" ;;
    esac
    BASE=https://nodejs.org/dist/latest-v22.x
    TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
    fetch() {
      if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"; else wget -qO "$2" "$1"; fi
    }
    fetch "$BASE/SHASUMS256.txt" "$TMP/SHASUMS256.txt" || fail "could not reach nodejs.org"
    LINE=$(grep "linux-$ARCH\.tar\.xz\$" "$TMP/SHASUMS256.txt" | head -n1)
    FILE=${LINE##* }
    [ -n "$FILE" ] || fail "could not find a Node.js download for linux-$ARCH"
    fetch "$BASE/$FILE" "$TMP/$FILE" || fail "Node.js download failed"
    (cd "$TMP" && echo "$LINE" | sha256sum -c - >/dev/null) || fail "Node.js download is damaged (checksum mismatch)"
    rm -rf "$ROOT/.tools/node"; mkdir -p "$ROOT/.tools/node"
    tar -xJf "$TMP/$FILE" -C "$ROOT/.tools/node" --strip-components=1
    node_ok || fail "Node.js didn't start after download"
  fi
  echo "Using Node.js $(node -v)"

  say "Installing UI packages (about 300 MB, a few minutes)"
  (cd "$ROOT/ui" && npm ci --no-audit --no-fund) || fail "npm ci failed (see above)"
  say "Building the UI"
  (cd "$ROOT/ui" && npm run build) || fail "UI build failed (see above)"
fi

# 3) Optional C kernels (fast synth voices and the FX rack). Release downloads ship them prebuilt.
if [ ! -d "$ROOT/decksynth/native/prebuilt" ]; then
  say "Building native audio kernels"
  if "$ROOT/tools/build-native.sh"; then :; else
    echo "Without a C compiler (SteamOS has none) the FX rack and fast synth voices stay off."
    echo "For those, use the release download: https://github.com/Zerolitter/Decksynth/releases/latest"
  fi
fi

# 4) App menu entry (Desktop Mode), which also lets you "Add to Steam"
say "Adding Decksynth to the app menu"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS"
cat > "$APPS/io.github.zerolitter.Decksynth.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Decksynth
GenericName=Steam Deck music workstation
Comment=Touch-friendly synth, sampler, sequencer and drum machine
Exec="$ROOT/launch.sh"
Path=$ROOT/ui
Icon=$ROOT/packaging/flatpak/io.github.zerolitter.Decksynth.svg
Terminal=false
Categories=AudioVideo;Audio;Music;
Keywords=DAW;Synthesizer;Drum Machine;Sampler;MIDI;
StartupNotify=true
DESKTOP
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
echo "Added. To play it in Game Mode: open the app menu in Desktop Mode,"
echo "right-click Decksynth and choose \"Add to Steam\"."

say "Decksynth is ready"
if [ "$LAUNCH" = 1 ]; then
  # Start detached so closing this terminal window doesn't close Decksynth.
  if command -v setsid >/dev/null 2>&1; then
    setsid "$ROOT/launch.sh" >/dev/null 2>&1 </dev/null &
    sleep 2; exit 0
  fi
  exec "$ROOT/launch.sh"
fi
echo "Start it from the app menu, or run: $ROOT/launch.sh"
