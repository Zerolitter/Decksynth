# CLAUDE.md

Guidance for AI coding assistants (and people) working in this repository. The README describes the app; this file holds the rules, constraints and tooling quirks that are easy to break. Contributions are welcome: open an issue or a pull request, and run `./precheck.sh` first.

## Project overview

- **What it is:** Decksynth is a touch-first synthesizer, sampler, sequencer and drum machine for the Steam Deck and Linux desktops. It is played with fingers on a 1280-wide touchscreen.
- **Stack:** a Python engine (`decksynth/`) with C audio kernels (`decksynth/native/`, loaded through `ctypes`), and an Electron + React + TypeScript touch UI (`ui/`). The UI talks to the engine through a bridge; the engine runs in a worker process.
- **Platform:** SteamOS and Linux only. There is no official Windows or macOS build, and the maintainer does not test or support one. Anyone who wants to build a Windows-compatible version is welcome to, as a fork or a pull request. Keep such changes separate from the Linux code paths so SteamOS behaviour does not change, and do not add Windows or macOS code or CI jobs to the main line unless the maintainer asks. Python 3.14 on the Deck, 3.12 in CI. Node 22+ (the Deck uses a node under `~/.nvm`; put it on `PATH` before `npm`).
- **Layout:**
  - `decksynth/` is the engine: voices, FX, drum rack, sampler, sequencer, song, session save and load.
  - `decksynth/native/` holds the C kernels (`dsfx.c`, `drum_mix.c`, `sampler_voice.c`, `spectral_tables.c`). `libdsfx.so` is a local build output and is not in git.
  - `ui/src/` is the React UI. `ui/electron/` is the Electron shell. `ui/tests/` holds unit tests (`*.mjs`) and screen tests (`*_acceptance.cjs`).
  - `tests/` holds the Python tests. `tools/` holds benches, build scripts and checks.
  - `packaging/flatpak/` is the Flatpak recipe (the Flathub build). The CI workflows are in `.github/workflows/`.

## Essential commands

- `./precheck.sh` runs what CI runs: Python tests, sound goldens, render check, UI type check and build, UI unit tests. Run it once per batch, right before committing. `./precheck.sh --touch` adds the touch-target test (needs a display).
- `./check.sh` is the Python half: compile, `python3 -m unittest discover -s tests`, `tools/render_check.py`.
- `python3 -m unittest tests.test_<name>` runs one Python test file while you work. Run only what failed again, not the whole suite.
- `cd ui && npm run build` runs `tsc --noEmit` and the Vite build. This is also the deploy on the Deck.
- `cd ui && npm test` runs the UI unit tests (`node --test tests/*.mjs`), including the colour-token guard.
- `cd ui && npm run test:ui` and `npm run test:bridge` run screen tests in real Electron windows. See the Deck safety rule below before running them.
- `tools/build-native.sh` builds the C kernels (CI does this). `launch.sh` starts the app.
- Audio changes are judged with `tools/bench/ab.py` against a multi-track project (A/B old and new code). `tools/bench/gil.py` and `stress4.decksynth` measure block time under load.

## Rules that are easy to break

### Deck safety

- **Never run screen tests, Electron windows or heavy builds while the maintainer's own Decksynth is open.** Background load can blank their window and lose the session. Check first with `tools/deck_busy.sh` (exit 0 means free, 75 means busy; `--wait 120` waits). `precheck.sh` and `npm run build` already call it and refuse when busy. `DECKSYNTH_ALLOW_BUSY=1` is the maintainer's override only; never set it yourself.
- Screen tests start their own Electron windows on the real display and overwrite screenshots. Do not run them as a habit; run them once per batch.
- Use `DECKSYNTH_NO_AUTOSAVE=1` for anything that starts the engine outside the test scripts, so tests never touch the real autosave folder.

### Audio engine and DSP

- **The audio loop must stay fast and quiet.** A block has about 5 ms of budget at 256 frames, and the queue behind it is only ~10 ms. One slow block is an audible click.
- **No allocation, locks, file access or logging in the C kernels' process paths** (`dsfx_process`, `sampler_mix`, `drum_mix`, the voice kernels). Keep the flush-to-zero setup and the NaN guards. Lazy tables are not thread-safe: only the audio thread may call into them.
- **No CPU-heavy Python on the audio loop.** WAV loads, chopping, pitch detection, library scans and similar jobs go through the task and job helpers (`sampler_tasks`, `render_jobs`) and commit their result between blocks. The audio worker shares one Python process with helper threads, so a busy helper thread holds up audio through the GIL. Keep it to file I/O in threads and use a child process for CPU-heavy work.
- **Edits and status run between blocks.** Keep per-edit work small. Undo snapshots deep-copy the project, so do not add more per-edit full-project work.
- **Every engine change needs an A/B check.** Run `tools/bench/ab.py` on a project with several tracks (a synth-and-drums demo, not an old project that renders silence in the headless bench). The sound goldens in the tests must still pass; if a golden changes on purpose, say why in the commit.
- Effects that depend on a note-on or transport clock (gate, stutter) need a clocked test scene; a plain pass-through test proves nothing.
- Sessions must keep round-tripping through save and load. Add to the existing round-trip tests when you add saved state.
- The audio priority uses rtkit over D-Bus; inside the Flatpak sandbox that is not available and the code falls back to a plain nice value. Do not assume it works in the sandbox.

### UI

The UI is a touch instrument, and the maintainer has fixed design rules. The short version:

- **Every element does something or tells something true.** No decoration. No duplicate control for one parameter. Graphs draw real engine values, and a graph sits in the same card as the knobs that shape it. Graphs are editors where that makes sense.
- **Touch targets are at least 44 x 44 px** (the hit area, even if the visual is a 10 px dot). Nothing important may hide under anything else at 1280 x 720.
- **Pick the control by option count.** Continuous value: knob or fader. 2 to 8 options: segmented buttons, never a knob. 9 or more: a button grid or a sheet, never a knob or a native `<select>`. On/off: a toggle that shows its state.
- **No scroll box under about 300 px tall.** Every mode (link mode, sheets, pickers) can be left with a Done button, a tap on blank space, the opening button again, and Esc / the Deck's B button.
- **Never `preserveAspectRatio="none"` on a graph with dots, handles or text.**
- **Colours come from the shared tokens** (`ui/src/colour.css`), not raw hex or rgb. `ui/tests/colour-tokens.mjs` guards this. Surfaces are neutral charcoal; each section keeps one accent colour everywhere it appears.
- **Things that show notes also play them**, and recording records what is heard.
- **Test at both 1280 x 718 and 1280 x 800.** The usable window height is usually about 720, not the full 800. Look at both screenshots yourself.
- Anything a pad or knob can be linked to must show the dashed link ring in link mode. Hotkeys come from the one shared hotkey map (`ui/src/hotkeys.ts`); do not hard-code a second set.
- Pages subscribe to their own slice of the store (`useDeck(select)` in `ui/src/deck-store.ts`). Do not make a component re-render the whole page on every change, and draw things that move many times a second (mod dots, meters) from the frame clock, not from React state.

### Git and public repo

- **GitHub is the public, Flathub-facing copy.** Never commit build notes, plans, checkpoints, handoffs, screenshots, audio files, patches, private paths, or personal details. `.gitignore` blocks most of these; still read `git status` before every commit.
- The maintainer's commits carry no AI attribution lines or `Co-Authored-By` trailers; an AI assistant working in this repo must not add them.
- One branch per batch (`batch/<short-name>`), merged into `main` locally. **Never push to GitHub or tag a release without the maintainer's go** (once per batch).
- Do not skip, disable or loosen a test to get green. Do not add a dependency or bump Electron without asking: the Flatpak recipe pins the same Electron version as `ui/package.json`.

## Testing

- **Python:** `unittest`, about 700 tests. `test_app` and `test_visuals` cover the old Tk window and error on a Python without `tkinter` (the Deck's 3.14); that is known and not yours to fix. Tests set `DECKSYNTH_NO_AUTOSAVE=1` and never touch the real autosave folder.
- **UI unit tests** (`npm test`, no display needed) run in CI. **Screen tests** (`*_acceptance.cjs`) need a display and are not in CI. Many exist that no npm script runs; when you add one, wire it into an npm script.
- **Touch-target test:** `cd ui && node tests/touch_target_acceptance.cjs` is required and checks each control's centre with `elementFromPoint` at 1280 x 718.
- After a failure, re-run only the failing tests while you fix it. Run the whole suite and the screen tests once per batch, right before committing.
- Sound goldens and `tools/render_check.py` catch clipping and unintended sound changes. A change to the sound of a preset or effect is a decision for the maintainer, not a side effect.

## Architecture and key patterns

- **Engine / UI split:** the engine runs in a worker process and owns all state. The UI sends commands over the bridge and receives a small live packet often (meters, playhead) and a full state packet on change. Do not make the UI the source of truth.
- **Mutations are transactions** with undo. Go through the existing command paths instead of changing engine state directly.
- **Native kernels** are built from `decksynth/native/*.c` (`tools/build-native.sh`, the Flatpak recipe). The Python side loads them through `*_native.py` wrappers. Add a Python fallback only if the existing kernels have one.
- **Presets and patterns** live in `ui/src/library.json`, `genre-library.json` and the Python pattern modules. The pattern library JSON is inlined in the UI bundle, which is why the JS chunk is large.
- **Electron security setup is deliberate:** local files only, `sandbox`, `contextIsolation`, no `nodeIntegration`, popups denied, navigation blocked. Do not loosen it.

## Environment and deployment

- **CI** (`.github/workflows/ci.yml`) runs on every push to `main` and every PR: build the native kernels, `./check.sh`, UI build, UI unit tests. Python 3.12 only. It does not run screen tests.
- **Releases:** pushing a `v*` tag runs the release workflow and builds the Linux download. The Flatpak recipe in `packaging/flatpak/` is what Flathub builds. A tag needs the maintainer's go.
- **Which build the shortcut runs:** one launcher only, `launch.sh` in the main checkout, which runs whatever is built in that folder's `ui/dist` (and its `.tools/vst3-host-bin` helper). Keep the main checkout on `main` and run `cd ui && npm run build` after every merge or branch switch, with Decksynth closed. Never point a `.desktop` file at a worktree or another clone; try a batch from a terminal with `DECKSYNTH_ROOT=<folder> ./launch.sh` instead. Check what is built with `git branch --show-current`.
- `launch.sh` runs the app; the desktop shortcut runs it with `DECKSYNTH_USER_APP=1`, which is how `deck_busy.sh` knows the maintainer's app from a test run. Do not set that variable in tests.

## AI-specific instructions

- Report changes as what a person sees and can now do, not in code terms.
- If a request breaks a rule in this file, say so before suggesting an alternative.
- Keep a change to what was asked; note unrelated ideas instead of building them.
- Prefer small, readable changes over clever ones. Do not add features, settings or abstractions beyond what was asked.
