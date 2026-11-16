# Decksynth

Native touch-friendly synthesizer, sampler, sequencer, and drum machine for
Steam Deck and Linux desktops.

## Features

- Python/SDL2 synth and four-track MIDI looper.
- Touch-first SOUND and SONG views.
- Sixteen-pad Drum Rack with MIDI notes 36–51.
- USB MIDI input and SDL audio output.
- User-imported WAV libraries and kits.

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

The native interface uses Python 3, Tk, and SDL2.

## Project layout

- `decksynth/` — application engine and desktop interface.
- `tests/` — automated checks.
- `tools/` — development and diagnostic utilities.

## Support

Development donations:

https://www.paypal.com/donate/?hosted_button_id=EWZ2SZB92EYJE

Discord: `zerolitter`

## License

Decksynth is released under the MIT License. See [LICENSE](LICENSE).
