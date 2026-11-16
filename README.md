# Decksynth

Touch-friendly synthesizer, sampler, sequencer, and drum machine for Steam
Deck and Linux desktops.

## Features

- Native Python/SDL2 synth and four-track MIDI looper.
- Touch-first SOUND and SONG views.
- Drum Rack with sixteen pads and MIDI notes 36–51.
- Electron/React performance interface in `ui-next/`.
- Five bundled Luna demo kits with sixteen pads each.
- USB MIDI input and SDL audio output.

## Quick start

From a desktop-mode terminal:

```sh
cd ~/Projects/deck-app
./launch.sh
```

Run the local checks with:

```sh
./check.sh
```

The native interface uses the installed Python 3, Tk, and SDL2 runtime.

## Luna demo kits

The bundled kits are synthetic, original recreations made for Decksynth. Source
sample files and private recipe material are not included. See
[docs/LUNA-DEMO-KITS.md](docs/LUNA-DEMO-KITS.md).

## Distribution

Local Flatpak packaging instructions are in
[docs/FLATPAK-DISTRIBUTION.md](docs/FLATPAK-DISTRIBUTION.md).

## Project layout

- `decksynth/` — native engine and desktop interface.
- `ui-next/` — Electron/React interface and bundled demo kits.
- `tests/` — automated checks.
- `tools/` — development and diagnostic utilities.
- `packaging/` — desktop and Flatpak integration.

## Support

Development donations:

https://www.paypal.com/donate/?hosted_button_id=EWZ2SZB92EYJE

Discord: `zerolitter`

## License

Decksynth is released under the MIT License. See [LICENSE](LICENSE).
