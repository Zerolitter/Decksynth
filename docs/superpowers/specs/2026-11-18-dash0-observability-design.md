# Dash0 Observability (OBS-1) Design

## Intent

Add optional, privacy-conscious health telemetry to DeckSynth without changing synthesis, musical state, scheduling, or the published package sandbox. The integration is disabled unless the user explicitly supplies complete Dash0 configuration. GitHub Releases is the distribution channel; OBS-1 does not prepare or maintain a Flathub submission.

## Chosen approach

Use an audio-first, explicit OpenTelemetry integration.

- The Python audio worker records only primitive counters and timing aggregates while it renders: render count, total and worst render duration, deadline misses, queue underruns, and worker lifecycle events.
- When telemetry is explicitly enabled, once per second it attempts a non-blocking write of the aggregate to an eight-event multiprocessing queue. A full queue drops the aggregate and carries a dropped-aggregate count forward. Disabled mode creates no telemetry queue. The worker never creates spans, metrics, network requests, disk writes, or unbounded data structures in the render/SDL queue-fill path.
- `ui/electron/bridge.py` owns the background OpenTelemetry provider and bounded exporter work. It converts audio aggregates into metrics/spans with the `decksynth-audio` service identity. It emits bridge lifecycle and sanitized command-duration telemetry under a separate `decksynth-desktop` provider only if safe with the installed SDK.
- The bridge captures configuration into an in-memory `TelemetryConfig`, then permanently removes all `DASH0_*` and `OTEL_*` variables from its environment before it spawns the audio worker. The renderer receives neither configuration nor credentials. Raw IPC arguments, project state, notes, MIDI, preset data, file paths, sample data, and audio data are excluded by construction.

The Dash0 Python distribution is evaluated as the optional dependency, but DeckSynth does not run broad `opentelemetry-instrument` auto-instrumentation. GitHub release archives use the host Python selected by `launch.sh`, rather than shipping a Python runtime; package only pure-Python wheels and verify them with the actual release build/runtime environment. Unsupported imports must fail closed to disabled operation.

## Alternatives considered

1. **Dash0 auto-instrumentation wrapper** — rejected. The distribution loads a large auto-instrumentation set, which is too broad for the audio worker and offers insufficient control over process/multiprocessing behavior.
2. **Electron plus Python SDKs in OBS-1** — deferred. Electron observability needs a separate Node SDK compatibility and packaging assessment; it is not needed to safely expose the initial audio/bridge health signals.
3. **Collector sidecar** — deferred. It adds a deployment process and does not solve the package network policy.

## Distribution, configuration, and sandbox policy

DeckSynth ships ready-to-run Linux archives through GitHub Releases. `packaging/release/build-release.sh` assembles those archives and `launch.sh` starts Electron, which in turn launches the Python bridge. OBS-1 verifies that this launcher environment reaches the bridge without placing configuration in the renderer or release artifact.

The repository retains a local Flatpak manifest for users who build/install that package themselves. It is not a Flathub submission target, and OBS-1 does not add any Flathub review, publishing, or validation work.

Telemetry is enabled only when all are present:

- `DASH0_ENABLED=true`
- `DASH0_OTEL_COLLECTOR_BASE_URL`
- `DASH0_AUTH_TOKEN`

`OTEL_SERVICE_NAME` is optional and defaults only within the process-specific provider. `Dash0-Dataset` may be appended to the OTLP headers from an explicit, non-secret environment value.

The retained Flatpak manifest remains without `--share=network`. A Flatpak user who consciously opts in must grant general network access outside the application:

```sh
flatpak override --user --share=network io.github.zerolitter.Decksynth
```

This allows general network access for that Flatpak application, not only Dash0. Revert it with:

```sh
flatpak override --user --reset io.github.zerolitter.Decksynth
```

No credential is stored in a GitHub Release artifact, Flatpak manifest, desktop entry, project, UI, screenshot, or logs.

## Metrics and traces

- Backend/bridge startup duration and clean/unclean termination.
- Worker start, exit, recovery, and unresponsive-heartbeat events.
- Aggregate render duration count/sum/max and deadline-miss count, emitted at most once per second.
- SDL queue-empty/starvation count and buffer target/current depth samples, emitted at most once per second. This is not reported as a confirmed physical output-device underrun.
- Sanitized backend exceptions grouped by stable error class/operation, not message text.
- Bridge command duration by approved command name only; no arguments or raw payloads.

No span or metric includes audio samples, MIDI, performance events, project/preset contents, filenames/paths, auth tokens, or raw IPC payloads.

## Failure behavior

All optional imports, SDK setup, metric recording, export, and shutdown flushing are catch-and-disable operations. Export queues are bounded. The worker ignores a full aggregate queue and continues audio processing. Shutdown flushing occurs only in bridge teardown, with a small timeout; it never blocks the worker or prevents ordinary shutdown.

## Test strategy

Use a test exporter behind an injected observability interface to prove disabled behavior, complete configuration, aggregate metric/span generation, sanitized exception classification, failed exports, bounded queues, and bounded shutdown. Compare deterministic engine render output and worker/project/MIDI behavior with telemetry disabled and enabled.

## Deferred work

- Node/Electron OpenTelemetry SDK integration, after Electron 39 / Node runtime compatibility and package implications are separately verified.
- A live Dash0 ingestion smoke test, pending genuine organization endpoint and credentials.
