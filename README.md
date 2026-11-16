# Decksynth

A touch-first synthesizer, sampler, sequencer and drum machine for the Steam Deck
and Linux desktops. Built to be played with fingers on the Deck's screen.
<img width="1410" height="930" alt="Preview1" src="https://github.com/user-attachments/assets/e9a29140-31b3-46db-bc74-5fbfdbca9b38" />
<img width="1410" height="930" alt="Preview2" src="https://github.com/user-attachments/assets/975f0d8d-6c74-4004-b02d-425a6e877bd9" />
<img width="1410" height="930" alt="Preview3" src="https://github.com/user-attachments/assets/a9681098-7b80-45a7-88f1-ae274cc70c35" />
<img width="1410" height="930" alt="Preview4" src="https://github.com/user-attachments/assets/3aea7580-1c7c-403f-8ef1-ae632e8adf6d" />

## Features

- Spectral synth with 16 editable partials, filter morph and envelopes you drag.
- Sixteen-pad Drum Rack and a sampler with chop, trim and envelope.
- Pattern sequencer, arpeggiator and chord builder with a playable keyboard.
- Song view with tracks, blocks and freeze-to-audio.
- FX rack and a Link panel for modulation, shown live on every knob.
- USB MIDI input, SDL/PipeWire audio output, WAV export.
- Five bundled demo kits, plus your own WAV libraries and kits.

## Install

### Steam Deck / Linux (ready to run)

1. Switch to Desktop Mode.
2. Download `Decksynth-<version>-linux-x86_64.tar.gz` from the
   [latest release](https://github.com/Zerolitter/Decksynth/releases/latest)
   (under **Assets**, not the green "Code" button).
3. Extract it somewhere permanent, for example `~/Applications/Decksynth`
   (right-click the file in Dolphin › Extract › Extract archive here).
4. Double-click `launch.sh` to play. If Dolphin asks, choose **Execute**.
5. Optional: run `./install.sh` in that folder once. It adds Decksynth to the app menu,
   where you can right-click it and choose **Add to Steam** to play it in Game Mode.

Nothing else to install: SteamOS already has Python 3 and SDL2, which is all Decksynth needs.

### From a git clone

A clone holds the source only. `install.sh` sets it up in one go: it downloads Node.js
into `.tools/` if a recent one isn't installed, builds the UI and adds the menu entry.
No root and no developer tools needed.

```sh
git clone https://github.com/Zerolitter/Decksynth.git ~/Applications/Decksynth
cd ~/Applications/Decksynth
./install.sh
./launch.sh
```

The FX rack and the fast synth voices use small C kernels. The release download ships
them prebuilt; in a clone `install.sh` builds them only if a C compiler is installed
(SteamOS has none), so use the release download on a Deck.

Run the checks with `./check.sh` (engine) and `cd ui && npm test` (UI).

### Flatpak

A Flatpak (`io.github.zerolitter.Decksynth`) is in progress. The recipe is in
[`packaging/flatpak/`](packaging/flatpak/) and
[docs/FLATPAK-DISTRIBUTION.md](docs/FLATPAK-DISTRIBUTION.md) explains it.

### Troubleshooting

- **"Decksynth isn't set up yet"**: you're running a git clone. Run `./install.sh`, or use the release download.
- **No sound**: run `./diagnose-audio.sh` and include its output when you report it.

## Project layout

- `decksynth/` the audio engine (Python, with optional C kernels in `native/`).
- `ui/` the touch interface (Electron + React).
- `tests/` engine tests. `ui/tests/` UI tests.
- `tools/` development and diagnostic scripts.
- `packaging/flatpak/` Flatpak recipe, launcher, desktop entry and icon.
- `packaging/release/` builds the ready-to-run download (`.github/workflows/release.yml` runs it for each version tag).
- `docs/` packaging and demo-kit notes.

## Support

Development donations: https://www.paypal.com/donate/?hosted_button_id=EWZ2SZB92EYJE

Discord: `zerolitter`

## License

Decksynth is released under the MIT License. See [LICENSE](LICENSE).
