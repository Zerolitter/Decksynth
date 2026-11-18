"""Optional, bridge-owned OBS-1 telemetry with a fail-closed boundary.

The audio worker never imports this module.  Its optional aggregate queue is
consumed by the Electron bridge, where this module keeps all exporter work out
of the SDL queue-fill path.
"""
from dataclasses import dataclass
import re
import threading
from typing import Mapping


_ENABLED = 'true'
_SAFE_NAME = re.compile(r'^[a-z][a-z0-9_.-]{0,63}$')
_AUDIO_METRICS = {
    'render_count': 'decksynth.audio.render.count',
    'render_duration_sum_s': 'decksynth.audio.render.duration',
    'render_duration_max_s': 'decksynth.audio.render.duration.max',
    'render_budget_overrun_count': 'decksynth.audio.render_budget_overrun.count',
    'sdl_queue_empty_count': 'decksynth.audio.sdl.queue_empty.count',
    'queue_frames': 'decksynth.audio.sdl.queue_frames',
    'buffer_target_frames': 'decksynth.audio.sdl.buffer_target_frames',
    'dropped_aggregate_count': 'decksynth.audio.aggregate_dropped.count',
}
_LIFECYCLE = {'started', 'stopped', 'unexpected_exit', 'heartbeat'}
_COMMANDS = {'play', 'stop', 'save', 'load', 'audio_device', 'export_wav', 'freeze', 'unfreeze'}


@dataclass(frozen=True)
class TelemetryConfig:
    """The small, bridge-only configuration captured before worker spawn."""

    collector_base_url: str
    auth_token: str
    dataset: str | None
    desktop_service_name: str

    @classmethod
    def from_environ(cls, environ: Mapping[str, str]):
        if environ.get('DASH0_ENABLED', '').strip().lower() != _ENABLED:
            return None
        base = environ.get('DASH0_OTEL_COLLECTOR_BASE_URL', '').strip().rstrip('/')
        token = environ.get('DASH0_AUTH_TOKEN', '').strip()
        if not base or not token:
            return None
        dataset = environ.get('DASH0_DATASET', '').strip() or None
        service = environ.get('OTEL_SERVICE_NAME', '').strip() or 'decksynth-desktop'
        if not _SAFE_NAME.match(service):
            service = 'decksynth-desktop'
        return cls(base, token, dataset, service)

    @property
    def headers(self):
        headers = {'Authorization': 'Bearer ' + self.auth_token}
        if self.dataset:
            headers['Dash0-Dataset'] = self.dataset
        return headers


class _OpenTelemetryExporter:
    """Explicit OTLP/HTTP providers; imported only in opt-in packaged runs."""

    def __init__(self, config: TelemetryConfig):
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        self._meters = {}
        self._tracers = {}
        self._providers = []
        self._metric_instruments = {}
        for service in ('decksynth-audio', config.desktop_service_name):
            resource = Resource.create({'service.name': service})
            tracer_provider = TracerProvider(resource=resource)
            tracer_provider.add_span_processor(BatchSpanProcessor(
                OTLPSpanExporter(endpoint=config.collector_base_url + '/v1/traces', headers=config.headers, timeout=1),
                max_queue_size=64, max_export_batch_size=16, schedule_delay_millis=1000, export_timeout_millis=1000,
            ))
            meter_provider = MeterProvider(
                metric_readers=[PeriodicExportingMetricReader(
                    OTLPMetricExporter(endpoint=config.collector_base_url + '/v1/metrics', headers=config.headers, timeout=1),
                    export_interval_millis=1000, export_timeout_millis=1000,
                )],
                resource=resource,
            )
            self._tracers[service] = tracer_provider.get_tracer('decksynth.obs1')
            self._meters[service] = meter_provider.get_meter('decksynth.obs1')
            self._providers.extend((tracer_provider, meter_provider))

    def metric(self, name, value, attributes, service):
        key = (service, name)
        instrument = self._metric_instruments.get(key)
        if instrument is None:
            meter = self._meters[service]
            if name.endswith('.max') or name.endswith('_frames'):
                instrument = meter.create_histogram(name)
            else:
                instrument = meter.create_counter(name)
            self._metric_instruments[key] = instrument
        if name.endswith('.max') or name.endswith('_frames'):
            instrument.record(value, attributes=attributes)
        else:
            instrument.add(value, attributes=attributes)

    def span(self, name, attributes, service):
        with self._tracers[service].start_as_current_span(name) as span:
            for key, value in attributes.items():
                span.set_attribute(key, value)

    def shutdown(self, timeout_s):
        timeout_ms = max(1, int(timeout_s * 1000))
        for provider in self._providers:
            provider.force_flush(timeout_millis=timeout_ms)
            provider.shutdown()
        return True


class Observability:
    """No-op-by-default bridge facade with strict metric and attribute allowlists."""

    def __init__(self, config: TelemetryConfig | None, exporter_factory=None):
        self.config = config
        self._exporter = None
        self.enabled = False
        if config is None:
            return
        try:
            self._exporter = (exporter_factory or _OpenTelemetryExporter)(config)
            self.enabled = self._exporter is not None
        except Exception:
            self._exporter = None

    @classmethod
    def disabled(cls):
        return cls(None)

    def _call(self, method, *args):
        if not self.enabled or self._exporter is None:
            return False
        try:
            getattr(self._exporter, method)(*args)
            return True
        except Exception:
            self.enabled = False
            self._exporter = None
            return False

    def record_audio_aggregate(self, aggregate):
        for key, metric_name in _AUDIO_METRICS.items():
            value = aggregate.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
                continue
            self._call('metric', metric_name, value, {}, 'decksynth-audio')
        heartbeat = aggregate.get('heartbeat_monotonic_s')
        if isinstance(heartbeat, (int, float)) and not isinstance(heartbeat, bool) and heartbeat >= 0:
            self._call('metric', 'decksynth.audio.worker.heartbeat', 1, {}, 'decksynth-audio')

    def record_worker_lifecycle(self, state, startup_duration_s=None):
        if state in _LIFECYCLE:
            self._call('span', 'decksynth.audio.worker.' + state, {'state': state}, 'decksynth-audio')
        if state == 'started' and isinstance(startup_duration_s, (int, float)) and not isinstance(startup_duration_s, bool):
            self._call('metric', 'decksynth.audio.startup.duration', max(0., startup_duration_s), {}, 'decksynth-audio')

    def record_command(self, operation, duration_s, ok):
        if operation not in _COMMANDS or isinstance(duration_s, bool) or not isinstance(duration_s, (int, float)):
            return
        attributes = {'operation': operation, 'ok': bool(ok)}
        self._call('metric', 'decksynth.desktop.command.duration', max(0., duration_s), attributes, self.config.desktop_service_name)

    def record_exception(self, operation, exc):
        self.record_exception_type(operation, type(exc).__name__)

    def record_exception_type(self, operation, exception_type, service=None):
        if not isinstance(operation, str) or not _SAFE_NAME.match(operation):
            operation = 'unknown'
        if not isinstance(exception_type, str) or not re.match(r'^[A-Za-z][A-Za-z0-9_]{0,63}$', exception_type):
            exception_type = 'Exception'
        target_service = service if service in ('decksynth-audio', self.config.desktop_service_name if self.config else 'decksynth-desktop') \
            else (self.config.desktop_service_name if self.config else 'decksynth-desktop')
        self._call('span', 'decksynth.audio.exception' if target_service == 'decksynth-audio' else 'decksynth.desktop.exception', {
            'operation': operation,
            'exception.type': exception_type,
        }, target_service)

    def shutdown(self, timeout_s: float):
        if not self.enabled or self._exporter is None:
            return False
        exporter = self._exporter
        self.enabled = False
        self._exporter = None
        result = []

        def close():
            try:
                result.append(bool(exporter.shutdown(max(0., timeout_s))) )
            except Exception:
                result.append(False)

        thread = threading.Thread(target=close, name='decksynth-telemetry-shutdown', daemon=True)
        thread.start()
        thread.join(max(0., timeout_s))
        return bool(result and result[0])


class TelemetryEventConsumer:
    """Bridge-side reader for the worker's bounded aggregate queue."""

    def __init__(self, events, observability: Observability, on_command_result=None):
        self._events = events
        self._observability = observability
        self._on_command_result = on_command_result
        self._stopped = threading.Event()
        self._thread = threading.Thread(target=self._run, name='decksynth-telemetry-consumer', daemon=True)

    def start(self):
        self._thread.start()

    def stop(self, timeout_s):
        self._stopped.set()
        self._thread.join(max(0., timeout_s))
        return not self._thread.is_alive()

    def _run(self):
        import queue
        while not self._stopped.is_set():
            try:
                event = self._events.get(timeout=.1)
            except queue.Empty:
                continue
            if not isinstance(event, dict):
                continue
            if event.get('kind') == 'audio_aggregate':
                aggregate = event.get('aggregate')
                if isinstance(aggregate, dict):
                    self._observability.record_audio_aggregate(aggregate)
            elif event.get('kind') == 'worker_lifecycle':
                self._observability.record_worker_lifecycle(event.get('state'), event.get('startup_duration_s'))
            elif event.get('kind') == 'worker_exception':
                self._observability.record_exception_type(event.get('operation'), event.get('exception_type'), 'decksynth-audio')
            elif event.get('kind') == 'command_result' and callable(self._on_command_result):
                self._on_command_result(event)
