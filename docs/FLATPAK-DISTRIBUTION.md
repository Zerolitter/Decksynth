# SteamOS / Linux distribution

Decksynth is distributed locally as a Flatpak with application ID
`io.github.zerolitter.Decksynth`.

The package includes the Electron interface, the Python audio backend, SDL2,
and the five bundled Luna demo kits. The kits are synthetic, original
recreations; source samples and private recipe material are not included.

## Build locally

From the repository root:

```sh
./packaging/flatpak/build-local.sh
flatpak install --user packaging/flatpak/dist/Decksynth.flatpak
flatpak run io.github.zerolitter.Decksynth
```

The current Linux MIDI implementation requires direct device access. The
Flatpak therefore requests audio, display, and MIDI/device permissions.

## Project

https://github.com/Zerolitter/Decksynth

Development donations:

https://www.paypal.com/donate/?hosted_button_id=EWZ2SZB92EYJE

Discord: `zerolitter`
