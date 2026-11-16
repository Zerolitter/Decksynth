# SteamOS / Linux distribution

Decksynth's current `ui` build is a local Electron + Python/SDL2 development launch. `launch.sh` resolves its own checkout, and the Electron bridge accepts `DECKSYNTH_PYTHON` for a packaged interpreter. It is not yet a portable Flatpak: the default still starts host `python3`, and the audio bridge dynamically loads host `libSDL2-2.0.so.0`.

Discover distribution normally goes through [Flathub](https://flathub.org/). A publishable build needs a stable reverse-DNS application ID, AppStream metadata, desktop entry, icon, a bundled Electron/Python/SDL2 runtime, portal-based file access, and tested PulseAudio/PipeWire, Wayland/X11, and MIDI permissions. The manifest must be human-reviewed before submission; Flathub's current policy does not allow AI-generated or AI-assisted manifests.
Public repository: https://github.com/Zerolitter/Decksynth

The five generated Luna demo kits are included in the workspace package under `ui/demo-kits`. Original source samples, recipes, and demo-loop files remain excluded. See [Luna demo kits](LUNA-DEMO-KITS.md).
## Local bundle

Build from the repository root:

```sh
./packaging/flatpak/build-local.sh
flatpak install --user packaging/flatpak/dist/Decksynth.flatpak
flatpak run io.github.zerolitter.Decksynth
```

The local manifest bundles the Electron app, Python 3.13, SDL2, and the five generated Luna demo kits. `--device=all` is required by the current raw Linux MIDI implementation; replace it with a narrower MIDI portal/device design before public distribution.

Support development: https://www.paypal.com/donate/?hosted_button_id=EWZ2SZB92EYJE

Discord contact: `zerolitter`
