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

The local manifest bundles the Electron app, Python 3.13, SDL2, and the five generated Luna demo kits.

## Flathub recipe

`packaging/flatpak/io.github.zerolitter.Decksynth.yml` builds from a tagged release, fully offline:

- `node-generated-sources.json` holds the npm cache for `ui/package-lock.json`. Regenerate it whenever the lockfile changes:
  `flatpak run --command=flatpak-node-generator org.flatpak.Builder npm ui/package-lock.json -o packaging/flatpak/node-generated-sources.json`
- `tools/build-native.sh decksynth/native/prebuilt` builds the FX library and the cached kernels (filter, spectral, drums, sampler) like the release download; the Flatpak launcher copies them into the app's cache on start.
- Permissions: `--socket=pulseaudio` (audio; Flatpak also exposes `/dev/snd` with it, which is what raw ALSA MIDI input needs), `--device=dri` (GPU) and `--device=input` (game controllers). No `--device=all`, no network, no home folder.
- After tagging a release, point the recipe at it: `packaging/flatpak/pin-release.sh vX.Y.Z` sets the tag and its commit.

Test the recipe locally with `flatpak run --command=flathub-build org.flatpak.Builder <manifest>` and `flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest <manifest>`.

Support development: https://www.paypal.com/donate/?hosted_button_id=EWZ2SZB92EYJE

Discord contact: `zerolitter`
