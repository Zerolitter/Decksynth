# Decksynth Next

Electron/React interface for Decksynth's Python/SDL2 audio and MIDI engine.

## Launch

From the repository root:

```sh
cd ui-next
./launch-next.sh
```

The desktop shortcut is `DeckSynth-Next-Experimental.desktop`.

## Interface

- SONG: four-track MIDI timeline and loop transport.
- SOUND: sixteen-partial synth, envelopes, modulation, and performance controls.
- PERFORM: pattern, arpeggiator, chord, and keyboard pages.
- Drum Rack: sixteen touch-playable pads mapped to MIDI notes 36–51.
- OSCilloscope and level meters driven by rendered audio.
- Touch, mouse, keyboard, and USB MIDI input.

## Demo kits

Five Luna demo kits are bundled under `demo-kits/`. Each kit contains sixteen
synthetic WAV samples for the Drum Rack.

## Development

```sh
npm install
npm run build
npm test
```

The interface communicates with the local Decksynth engine. It does not expose
a network service.

## License

See the repository [MIT License](../LICENSE).
