# Dash0 Observability (OBS-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, bounded, privacy-preserving OpenTelemetry/Dash0 telemetry path for DeckSynth’s Python bridge and audio backend without changing audio or musical behavior.

**Architecture:** Electron passes only a curated telemetry environment to its Python bridge and immediately removes those variables from its own runtime environment. The bridge captures that configuration in memory, permanently strips all telemetry variables before spawning the audio worker, owns OpenTelemetry providers/exporters, and only creates an aggregate queue/consumer when telemetry is enabled. The worker performs only primitive accumulation in its queue-fill/render loop and uses non-blocking, once-per-second aggregate publication.

**Tech Stack:** host Python used by GitHub Release archives (verified during packaging); explicit OpenTelemetry API/SDK; Dash0 pure-Python OTLP/HTTP exporter packages; Electron 39 child-process bridge; GitHub Release packaging.

**Spec:** `docs/superpowers/specs/2026-11-18-dash0-observability-design.md`

## Global Constraints

- Preserve all pre-existing uncommitted S6/UI changes; do not reset, stash, switch branches, commit, or push.
- GitHub Releases is the only OBS-1 distribution channel. Do not add Flathub submission, review, publication, or validation work.
- Do not alter DSP algorithms, SDL buffers, MIDI timing, sequencer behavior, project persistence, renderer code, or the published package sandbox.
- No renderer telemetry, raw IPC payloads, credentials, audio samples, MIDI/performance events, project/preset contents, filenames, paths, or exception messages may become telemetry attributes.
- Telemetry is disabled unless `DASH0_ENABLED=true`, `DASH0_OTEL_COLLECTOR_BASE_URL`, and `DASH0_AUTH_TOKEN` are all supplied.
- The bridge permanently removes all `DASH0_*` and `OTEL_*` variables from its environment after capturing `TelemetryConfig` and before worker spawn; the audio worker receives none and contains no exporter/provider/network code.
- Create the 8-event multiprocessing aggregate queue and its consumer only when telemetry is enabled. Publication is `put_nowait`; a full queue drops the aggregate and increments a local dropped counter included in the next successfully published aggregate.
- Emit periodic aggregate metrics at most once per second. Never emit a span/metric/export request per audio buffer.
- Use spans only for backend/worker lifecycle and explicitly allowlisted, low-rate bridge commands; do not instrument parameter, MIDI, meter, or other high-rate commands.
- Dash0 direct ingress uses the organization-provided OTLP/HTTP base URL and standard `Authorization`/optional `Dash0-Dataset` headers; never guess endpoint, region, dataset, or token.
- The retained local Flatpak manifest remains without `--share=network`; it is not a Flathub target. Documentation must use `io.github.zerolitter.Decksynth` in its per-user override/reset commands and explain that the override grants general network access.
- All initialization/export/shutdown errors fail closed to local no-op behavior. Shutdown flushing is bridge-only and bounded.

## Review Focus

- **Credential inheritance:** prove audio worker environment contains none of the telemetry variables while the bridge can still initialize from captured configuration.
- **Audio-loop overload:** prove an 8-slot full aggregate queue never blocks and reports dropped aggregate count on the next success.
- **Metric meaning:** prove render-budget overruns and SDL queue-empty/starvation events become distinct counters, and neither is labeled as a confirmed hardware/device dropout.
- **Exporter outage:** prove exporter exceptions/timeouts do not alter worker output, terminate the bridge, or prevent ordinary shutdown.
- **Packaging/runtime mismatch:** prove the selected pure-Python lock resolves and imports in Python 3.13; unsupported Python/import failures leave telemetry disabled.

---

### Task 1: Pin and package the minimal Python telemetry dependency set

**Files:**
- Create: `requirements-observability.txt`
- Create: `requirements-observability.lock`
- Modify: `packaging/release/build-release.sh`
- Modify: `launch.sh`
- Test: `tests/test_observability_packaging.py`

**Interfaces:**
- Consumes: Dash0 package metadata and the GitHub Release build/launcher environment. The release workflow provisions Python 3.13 with pip to vendor the pure-Python wheel set; the archive itself still uses the user's host Python.
- Produces: a hash-pinned, pure-Python dependency set available on `PYTHONPATH` to `ui/electron/bridge.py`, and no dependency change for disabled source-only execution.

- [ ] **Step 1: Write failing packaging tests**

```python
def test_observability_lock_uses_minimal_explicit_packages_and_hashes():
    lock = Path('requirements-observability.lock').read_text()
    assert 'dash0-opentelemetry==' not in lock
    assert 'opentelemetry-api==' in lock
    assert 'opentelemetry-sdk==' in lock
    assert 'dash0-opentelemetry-exporter-otlp-pyproto-http==' in lock
    assert '--hash=sha256:' in lock

def test_release_archive_carries_locked_wheels_without_credentials():
    release = Path('packaging/release/build-release.sh').read_text()
    assert 'requirements-observability.lock' in release
    assert 'DASH0_AUTH_TOKEN' not in release
```

- [ ] **Step 2: Run the new packaging tests and verify RED**

Run: `python3 -m unittest -v tests.test_observability_packaging`

Expected: FAIL because the lock, source manifest, and package commands do not exist.

- [ ] **Step 3: Resolve the Python 3.13 dependency graph and write hash-pinned manifests**

Compare `dash0-opentelemetry`’s complete auto-instrumentation dependency graph with the explicit set: `opentelemetry-api`, `opentelemetry-sdk`, Dash0’s `dash0-opentelemetry-pyproto`, `dash0-opentelemetry-exporter-otlp-pyproto-common`, and `dash0-opentelemetry-exporter-otlp-pyproto-http`. Pin all direct/transitive distributions with hashes after resolving against the Python used by the GitHub Release build/runtime. Reject the full distribution because it carries every contrib instrumentor. Use the Dash0 package index only when its verified wheel hashes are included in the lock.

- [ ] **Step 4: Package only the pinned pure-Python wheels**

Install the locked wheel set into a private directory in the GitHub Release archive; set `PYTHONPATH` only in `launch.sh` before Electron starts. Do not install dependencies into the host or expose package paths to the renderer. Do not place configuration or credentials in the archive. Leave the retained Flatpak manifest and its network finish arguments unchanged.

- [ ] **Step 5: Run packaging tests and Python 3.13 import verification**

Run: `python3 -m unittest -v tests.test_observability_packaging` and the GitHub Release build/runtime import command recorded in the test.

Expected: PASS; imports resolve without `grpcio` or `protobuf` native dependencies.

### Task 2: Build the opt-in bridge-owned observability layer

**Files:**
- Create: `decksynth/observability.py`
- Create: `tests/test_observability.py`
- Modify: `ui/electron/bridge.py`

**Interfaces:**
- Consumes: `TelemetryConfig.from_environ(environ: Mapping[str, str]) -> TelemetryConfig | None`; worker aggregate dictionaries.
- Produces: `Observability(config, exporter_factory=None, clock=time.monotonic)` with `record_audio_aggregate`, `record_worker_lifecycle`, `record_command`, `record_exception`, and `shutdown(timeout_s: float)` no-op-safe methods.

- [ ] **Step 1: Write failing observability unit tests**

```python
def test_disabled_config_creates_no_exporter_or_network_work():
    assert TelemetryConfig.from_environ({}) is None
    observability = Observability.disabled()
    observability.record_audio_aggregate({'render_count': 1})
    assert observability.shutdown(.01) is False

def test_enabled_test_exporter_receives_aggregate_metrics_and_lifecycle_span():
    config = TelemetryConfig.from_environ(complete_env())
    exporter = InMemoryExporter()
    observability = Observability(config, exporter_factory=lambda _: exporter)
    observability.record_audio_aggregate(audio_aggregate())
    observability.record_worker_lifecycle('started')
    assert exporter.metric('decksynth.audio.render.duration')
    assert exporter.span('decksynth.audio.worker.started')

def test_export_failure_is_swallowed_and_shutdown_is_bounded():
    observability = Observability(enabled_config(), exporter_factory=lambda _: RaisingExporter())
    observability.record_audio_aggregate(audio_aggregate())
    assert observability.shutdown(.01) in (False, True)
```

- [ ] **Step 2: Run the observability tests and verify RED**

Run: `python3 -m unittest -v tests.test_observability`

Expected: FAIL because the observability module does not exist.

- [ ] **Step 3: Implement explicit configuration, providers, and sanitized attributes**

`TelemetryConfig` must reject incomplete/false configuration and construct only OTLP/HTTP base endpoint, authorization, optional dataset, and service names. Use explicit providers/exporters rather than `opentelemetry-instrument`. Create separate resource providers for `decksynth-audio` and `decksynth-desktop`; turn logs off. Attribute allowlists must accept numeric aggregates, approved operation names, boolean status, and sanitized exception class only.

- [ ] **Step 4: Implement bridge consumption and bounded shutdown**

Only when `TelemetryConfig` is enabled, add an 8-slot `telemetry_events` queue and bridge telemetry consumer; otherwise pass `None` to the worker and perform no telemetry queue operations. The consumer records one-second audio aggregates and lifecycle events in its own background context. Its failure path disables exporter work without affecting stdin/stdout bridging. On teardown, stop the consumer and call provider flush/shutdown with a short explicit deadline; never delay worker termination for telemetry.

- [ ] **Step 5: Run observability tests and existing bridge tests**

Run: `python3 -m unittest -v tests.test_observability tests.test_backend` and `cd ui && npm run test:bridge`.

Expected: PASS; disabled mode retains existing bridge behavior.

### Task 3: Enforce cross-process credential isolation and sanitized worker launch

**Files:**
- Create: `ui/electron/telemetry-env.cjs`
- Create: `ui/tests/telemetry_env.test.cjs`
- Modify: `ui/electron/main.cjs`
- Modify: `ui/electron/bridge.py`
- Modify: `tests/test_observability.py`

**Interfaces:**
- Consumes: `extractTelemetryEnv(env)` and `stripTelemetryEnv(env)` from `telemetry-env.cjs`; `spawn_worker_without_telemetry(...)` in the bridge.
- Produces: a bridge-only environment with explicit configuration; a spawned audio worker without any `DASH0_*`/`OTEL_*` variables.

- [ ] **Step 1: Write failing credential-boundary tests**

```javascript
test('only the bridge receives the allowlisted telemetry environment', () => {
  const env = { DASH0_ENABLED: 'true', DASH0_AUTH_TOKEN: 'secret', OTEL_SERVICE_NAME: 'x', KEEP: 'ok' };
  assert.deepEqual(extractTelemetryEnv(env), { DASH0_ENABLED: 'true', DASH0_AUTH_TOKEN: 'secret', OTEL_SERVICE_NAME: 'x' });
  assert.deepEqual(stripTelemetryEnv(env), { KEEP: 'ok' });
});
```

```python
def test_spawned_audio_worker_has_no_otel_or_dash0_variables():
    result = worker_environment_probe(complete_env())
    assert not [key for key in result if key.startswith(('DASH0_', 'OTEL_'))]
```

- [ ] **Step 2: Run the credential-boundary tests and verify RED**

Run: `node --test ui/tests/telemetry_env.test.cjs` and `python3 -m unittest -v tests.test_observability.CredentialIsolationTests`

Expected: FAIL because the helpers and sanitized spawn are absent.

- [ ] **Step 3: Implement the environment boundary**

Electron captures only the telemetry allowlist for the bridge spawn, removes telemetry keys from its own process environment immediately afterward, and never passes any environment value through preload/IPC. The bridge captures `TelemetryConfig` before spawning, permanently removes every `DASH0_*` and `OTEL_*` variable from its own environment, then starts the worker. The worker entrypoint defensively strips the same prefixes before invoking `worker`.

- [ ] **Step 4: Run credential-boundary tests and full bridge acceptance**

Run: `node --test ui/tests/telemetry_env.test.cjs`, `python3 -m unittest -v tests.test_observability`, and `cd ui && npm run test:bridge`.

Expected: PASS; renderer remains unchanged and receives no credential-bearing message.

### Task 4: Add worker-side bounded audio aggregation and lifecycle semantics

**Files:**
- Modify: `decksynth/backend.py`
- Modify: `ui/electron/bridge.py`
- Modify: `tests/test_backend.py`
- Modify: `tests/test_observability.py`

**Interfaces:**
- Consumes: optional `telemetry_events` queue passed to `worker(commands, updates, telemetry_events=None)`.
- Produces: at-most-once-per-second aggregate dictionaries with `render_count`, `render_duration_sum_s`, `render_duration_max_s`, `render_budget_overrun_count`, `sdl_queue_empty_count`, `queue_frames`, `buffer_target_frames`, `dropped_aggregate_count`, and monotonic heartbeat timestamp.

- [ ] **Step 1: Write failing worker aggregation tests**

```python
def test_worker_aggregate_queue_is_nonblocking_and_reports_lost_aggregate():
    queue = FullQueue(capacity=8)
    accumulator = AudioAggregatePublisher(queue, report_interval_s=1)
    accumulator.publish_if_due(now=1)
    assert accumulator.dropped_aggregates == 1
    queue.make_room()
    event = accumulator.publish_if_due(now=2)
    assert event['dropped_aggregate_count'] == 1

def test_render_budget_overrun_and_sdl_queue_empty_are_distinct():
    aggregate = aggregate_for(render_s=.006, budget_s=.005, queue_empty=True)
    assert aggregate['render_budget_overrun_count'] == 1
    assert aggregate['sdl_queue_empty_count'] == 1
```

- [ ] **Step 2: Run the worker aggregation tests and verify RED**

Run: `python3 -m unittest -v tests.test_observability.AudioAggregateTests`

Expected: FAIL because no aggregate publisher exists.

- [ ] **Step 3: Implement primitive accumulation outside telemetry SDKs**

Reuse the existing `time.perf_counter()` render measurement in `backend.worker`; calculate the 256-frame budget from the actual audio rate. Count budget overruns when render duration exceeds that budget. Count SDL queue-empty events only at the existing `started and audio.queued() == 0` branch and name/export it as queue starvation, not a physical-device underrun. Publish at most one aggregate each second with `put_nowait`; never call OpenTelemetry, stringify data, or retry while filling the SDL queue.

- [ ] **Step 4: Add worker lifecycle and low-rate command events**

Emit worker startup/normal-stop/unexpected-exit events and heartbeat through the same bounded queue. Add request IDs only for an explicit allowlist of low-rate bridge commands (`play`, `stop`, `save`, `load`, `audio_device`, `export_wav`, `freeze`, `unfreeze`); bridge records their round-trip duration and sanitized status. Exclude parameter, MIDI, meter, automation, and performance actions.

- [ ] **Step 5: Run targeted tests plus deterministic engine comparison**

Run: `python3 -m unittest -v tests.test_observability tests.test_backend tests.test_audio_clean tests.test_goldens`.

Expected: PASS; metrics are distinct, full queues do not block, and existing audio golden output remains unchanged.

### Task 5: Document GitHub Release configuration, Flatpak opt-in, and operational limits

**Files:**
- Create: `docs/OBSERVABILITY.md`
- Modify: `README.md`
- Test: `tests/test_observability_packaging.py`

**Interfaces:**
- Consumes: finalized configuration/packaging behavior.
- Produces: secure operator documentation for GitHub Release users and users of the retained local Flatpak package.

- [ ] **Step 1: Write failing documentation assertions**

```python
def test_observability_docs_include_opt_in_and_flatpak_reversal():
    doc = Path('docs/OBSERVABILITY.md').read_text()
    assert 'DASH0_ENABLED=true' in doc
    assert 'flatpak override --user --share=network io.github.zerolitter.Decksynth' in doc
    assert 'flatpak override --user --reset io.github.zerolitter.Decksynth' in doc
    assert 'general network access' in doc
```

- [ ] **Step 2: Run documentation assertions and verify RED**

Run: `python3 -m unittest -v tests.test_observability_packaging.ObservabilityDocumentationTests`

Expected: FAIL because observability documentation does not exist.

- [ ] **Step 3: Document secure enablement, disablement, and limits**

Document GitHub Releases as the distribution channel; all required variables; optional dataset header construction; source/release launcher behavior; the Flatpak override and reset commands; and why the override allows general network access. State that the Flatpak recipe is not a Flathub submission target, no endpoint/token is shipped, missing configuration is a no-op, and no live smoke test runs without genuine organization credentials. Include the limited metric/span catalog and exclusions.

- [ ] **Step 4: Run documentation tests**

Run: `python3 -m unittest -v tests.test_observability_packaging.ObservabilityDocumentationTests`

Expected: PASS.

### Task 6: Full verification and bounded local smoke tests

**Files:**
- Modify: only files required to repair verified OBS-1 test failures.

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: verified disabled/default operation and test-exporter behavior without Dash0 credentials.

- [ ] **Step 1: Run the complete backend and UI suites**

Run: `./check.sh`, `cd ui && npm test`, `cd ui && npm run test:bridge`, and `git diff --check`.

Expected: all existing and new tests pass; report any unrelated failure without weakening it.

- [ ] **Step 2: Run local opt-in test-exporter smoke coverage**

Run the observability test exporter case with `DASH0_ENABLED=true` and synthetic endpoint/token values only inside the test double. Confirm no external DNS/HTTP request occurs and the engine/audio golden results match disabled mode.

- [ ] **Step 3: Do not run a live Dash0 smoke test without real credentials**

Record that ingestion remains unverified unless the user supplies an actual organization OTLP HTTP base URL, token, and optional dataset.

- [ ] **Step 4: Leave changes uncommitted**

Do not commit or push. Report exact changed files, package pins/hashes, test evidence, Dash0 ingestion status, deployment setup, and deferred Electron SDK instrumentation.
