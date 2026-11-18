# SteamOS / Linux distribution

Decksynth's current `ui` build is a local Electron + Python/SDL2 development launch. `launch.sh` resolves its own checkout, and the Electron bridge accepts `DECKSYNTH_PYTHON` for a packaged interpreter. It is not yet a portable Flatpak: the default still starts host `python3`, and the audio bridge dynamically loads host `libSDL2-2.0.so.0`.

DeckSynth is distributed as ready-to-run Linux archives through [GitHub Releases](https://github.com/Zerolitter/Decksynth/releases). This repository also retains a local Flatpak recipe for users who want to build and install a sandboxed package themselves; it is not a Flathub submission target.
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

## Local Flatpak recipe

`packaging/flatpak/io.github.zerolitter.Decksynth.yml` builds from a tagged release, fully offline:

- `node-generated-sources.json` holds the npm cache for `ui/package-lock.json`. Regenerate it whenever the lockfile changes:
  `flatpak run --command=flatpak-node-generator org.flatpak.Builder npm ui/package-lock.json -o packaging/flatpak/node-generated-sources.json`
- `tools/build-native.sh decksynth/native/prebuilt` builds the FX library and the cached kernels (filter, spectral, drums, sampler) like the release download; the Flatpak launcher copies them into the app's cache on start.
- Permissions: `--socket=pulseaudio` (audio; Flatpak also exposes `/dev/snd` with it, which is what raw ALSA MIDI input needs), `--device=dri` (GPU) and `--device=input` (game controllers). No `--device=all`, no network, no home folder.
- After tagging a release, point the recipe at it: `packaging/flatpak/pin-release.sh vX.Y.Z` sets the tag and its commit.

Test the recipe locally with the repository's `packaging/flatpak/build-local.sh` script.

Support development: https://www.paypal.com/donate/?hosted_button_id=EWZ2SZB92EYJE

Discord contact: `zerolitter`
