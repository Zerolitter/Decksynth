# Decksynth

A touch-first synthesizer, sampler, sequencer and drum machine for the Steam Deck
and Linux desktops. Built to be played with fingers on the Deck's screen.

## Features
<img width="640" height="400"  alt="Preview1" src="https://github.com/user-attachments/assets/108177d5-9099-4c04-a2f0-cb94bcaabacd" />

**Play**
- **Synth:** 16 drawable partials, a filter and envelopes you drag. 150 presets.
- **Drum Rack:** 16 pads with a waveform editor, per-pad shaping, EQ and compressor. Hold a pad to record onto it.
- **Sampler:** load, record or chop a sample and play it across the keys.
- **Perform:** a playable keyboard with chords, an arpeggiator and a step sequencer.
  
<img width="640" height="400"  alt="Preview2" src="https://github.com/user-attachments/assets/b8b82e48-7b71-47d9-af67-7e7c6619e0eb" />
<img width="640" height="400"  alt="Preview6" src="https://github.com/user-attachments/assets/d58b0b9f-c060-4bd8-9eb4-05bcf1b263be" />

**Write**
- **Pattern library:** 500+ ready patterns (bass, chords, arps, melodies, drums) across many genres.
- **Structure:** put patterns in order with repeats, or load one of 26 ready song structures.
- **Song:** tracks and clips on a timeline, with clips from 1 to 32 bars. Freeze a track to audio.

<img width="640" height="400"  alt="Preview3" src="https://github.com/user-attachments/assets/03439fef-2fd7-4667-8293-6e0085f7a1a2" />
<img width="640" height="400"  alt="Preview4" src="https://github.com/user-attachments/assets/03b7464c-318b-4b3b-8924-1c5cfab91cd9" />

**Shape**
- **FX rack:** 22 effects per track, each with 6 presets, plus shared reverb and delay sends.
- **Link:** macros, mod pads and a Morph pad move any knob on any page. The knob shows the movement live.
  
<img width="640" height="400" alt="Preview5" src="https://github.com/user-attachments/assets/1c27284f-ff5b-42a6-b97c-ab729939691a" />

**Everything else**
- Touch first and built for the Steam Deck. Also runs on Linux desktops.
- USB MIDI in, WAV export, adjustable audio latency.
- Five demo kits, or load your own WAV libraries.

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

Optional Dash0/OpenTelemetry health telemetry is disabled by default; see
[Observability](docs/OBSERVABILITY.md) for the GitHub Release and local
Flatpak opt-in configuration.

### Flatpak

A local Flatpak (`io.github.zerolitter.Decksynth`) recipe is available for users who build it themselves; DeckSynth is distributed through GitHub Releases. The recipe is in
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
