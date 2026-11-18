# Optional Dash0 observability

DeckSynth can export limited health telemetry to a Dash0-compatible OTLP/HTTP
endpoint. It is off by default. This is application monitoring for the audio
backend and bridge, not renderer, project, audio-content, MIDI-performance, or
development-agent monitoring.

DeckSynth is distributed through **GitHub Releases**. Release archives include
the small, hash-locked, pure-Python OpenTelemetry/OTLP dependencies in their
private `observability/` directory. They include no endpoint, token, dataset,
or telemetry configuration. `launch.sh` adds that directory to the Python
bridge path only when it exists; Electron's sandboxed renderer receives none
of those values.

## Enable for one launch

Obtain the organization-specific OTLP/HTTP base URL and a real Dash0 token
from your Dash0 administrator. Do not guess an endpoint, region, dataset, or
token. Then start DeckSynth from a terminal with all required variables:

```sh
export DASH0_ENABLED=true
export DASH0_OTEL_COLLECTOR_BASE_URL='https://your-organization-ingress.example'
export DASH0_AUTH_TOKEN='your-token'
export DASH0_DATASET='optional-dataset'
export OTEL_SERVICE_NAME='decksynth-desktop'
./launch.sh
```

`DASH0_DATASET` and `OTEL_SERVICE_NAME` are optional. The bridge exports the
audio worker as `decksynth-audio` and bridge/desktop operations as
`decksynth-desktop` by default. The supplied collector base URL is used with
the OTLP `/v1/traces` and `/v1/metrics` paths, and DeckSynth sends the token
as `Authorization: Bearer <token>`.

Unset `DASH0_ENABLED`, omit either required Dash0 value, or launch normally to
disable telemetry completely:

```sh
unset DASH0_ENABLED DASH0_OTEL_COLLECTOR_BASE_URL DASH0_AUTH_TOKEN DASH0_DATASET OTEL_SERVICE_NAME
./launch.sh
```

For Steam or a desktop-menu shortcut, ordinary shell exports do not
automatically propagate. Create a private wrapper script outside the release
archive (for example under `~/.local/bin`), make it executable only by you,
and add that wrapper to Steam instead of `launch.sh`. Keep the credential out
of Steam launch options, project files, presets, screenshots, and shell
history where practical.

```sh
mkdir -p ~/.local/bin
chmod 700 ~/.local/bin
# Create the wrapper in your preferred editor, then: chmod 700 ~/.local/bin/decksynth-with-dash0
```

The wrapper should export the variables above and `exec` the absolute path to
the release archive's `launch.sh`. This makes the environment flow explicit:
wrapper → Electron main process → Python bridge. Electron captures the small
allowlist for the bridge, removes every `DASH0_*` and `OTEL_*` variable from
itself, and the bridge permanently removes them before spawning the audio
worker. The renderer never receives credentials.

Source-checkout users may install the same lock into a private target
directory for development; normal source launches remain no-op when the SDK
is absent. Do not install the optional packages globally just for DeckSynth.

## Flatpak users

The repository retains a local Flatpak recipe for users who build and install
the package themselves. It is **not a Flathub submission target**. Its
published sandbox deliberately has no network permission, so DeckSynth and
its audio engine work normally without connectivity. The current local recipe
does not bundle the optional telemetry wheels; GitHub Release archives are the
supported opt-in package path.

Only a user who explicitly wants telemetry may grant network access:

```sh
flatpak override --user --share=network io.github.zerolitter.Decksynth
```

This override grants **general network access** to that Flatpak application,
not only Dash0. Revert it when telemetry is no longer wanted:

```sh
flatpak override --user --reset io.github.zerolitter.Decksynth
```

The override alone never enables telemetry: complete Dash0 configuration and
the optional exporter package are still required, and no credentials are
stored in the Flatpak manifest or package.

## What is exported

- Bridge/backend start and shutdown, backend initialization duration, worker
  lifecycle, and sanitized exception class plus operation name (never exception
  text).
- Once-per-second aggregate render count, total/worst render duration,
  render-budget overrun count, SDL queue-empty/starvation count, queue depth,
  target depth, and dropped aggregate count.
- Durations of only `play`, `stop`, `save`, `load`, `audio_device`,
  `export_wav`, `freeze`, and `unfreeze` commands.

An SDL queue-empty observation is queue starvation, not a confirmed physical
output-device underrun. No span is created per audio buffer.

## Safeguards and limits

- The audio worker creates no OpenTelemetry provider, exporter, network
  request, synchronous disk write, or unbounded queue.
- When enabled it writes primitive aggregate events at most once per second to
  an eight-event multiprocessing queue with `put_nowait`. A full queue drops
  the aggregate and carries its dropped count into the next successful one.
- Export failures, dependency import failures, and shutdown failures disable
  telemetry locally; they never prevent startup or interrupt audio processing.
- The bridge's export/shutdown work is background-only and bounded.
- No audio samples, recordings, MIDI notes/events, project or preset contents,
  filenames, paths, raw IPC payloads, or authentication tokens are exported.

## Verification status

The code is tested with an in-memory exporter and without a network request.
Actual Dash0 ingestion is intentionally unverified until a user supplies a
genuine authenticated organization endpoint and explicitly requests a live
smoke test.

See Dash0's [Python OpenTelemetry guidance](https://www.dash0.com/docs/dash0/opentelemetry/distributions/python/getting-started)
and [direct OTLP integration overview](https://www.dash0.com/hub/integrations/int_otlp/overview)
for organization-specific setup.
