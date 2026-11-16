# Decksynth

A touch-first synthesizer, sampler, sequencer and drum machine for the Steam Deck
and Linux desktops. Built to be played with fingers on the Deck's screen.

## Features

- Spectral synth with 16 editable partials, filter morph and envelopes you drag.
- Sixteen-pad Drum Rack and a sampler with chop, trim and envelope.
- Pattern sequencer, arpeggiator and chord builder with a playable keyboard.
- Song view with tracks, blocks and freeze-to-audio.
- FX rack and a Link panel for modulation, shown live on every knob.
- USB MIDI input, SDL/PipeWire audio output, WAV export.
- Five bundled demo kits, plus your own WAV libraries and kits.

## Install

On SteamOS, Decksynth is packaged as a Flatpak (`io.github.zerolitter.Decksynth`).
The recipe is in [`packaging/flatpak/`](packaging/flatpak/) and
[docs/FLATPAK-DISTRIBUTION.md](docs/FLATPAK-DISTRIBUTION.md) explains it.

### Run from source

From a Desktop Mode terminal:

```sh
git clone https://github.com/Zerolitter/Decksynth.git ~/Projects/Decksynth
cd ~/Projects/Decksynth/ui
npm ci && npm run build
cd .. && ./launch.sh
```

You need Python 3, `libSDL2-2.0.so.0` and Node.js 22.12 or newer.
`Decksynth.desktop` adds a desktop shortcut (edit its paths if you cloned elsewhere).

Run the checks with `./check.sh` (engine) and `cd ui && npm test` (UI).

## Project layout

- `decksynth/` the audio engine (Python, with optional C kernels in `native/`).
- `ui/` the touch interface (Electron + React).
- `tests/` engine tests. `ui/tests/` UI tests.
- `tools/` development and diagnostic scripts.
- `packaging/flatpak/` Flatpak recipe, launcher, desktop entry and icon.
- `docs/` packaging and demo-kit notes.

## Support

Development donations: https://www.paypal.com/donate/?hosted_button_id=EWZ2SZB92EYJE

Discord: `zerolitter`

## License

Decksynth is released under the MIT License. See [LICENSE](LICENSE).
