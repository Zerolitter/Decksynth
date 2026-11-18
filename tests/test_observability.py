"""OBS-1 unit contracts for bridge-owned optional telemetry."""
import time
import unittest
import queue
import sys
from pathlib import Path

from decksynth.observability import Observability, TelemetryConfig, TelemetryEventConsumer
from decksynth.backend import AudioAggregatePublisher

ELECTRON_DIR = Path(__file__).resolve().parents[1] / 'ui' / 'electron'
sys.path.insert(0, str(ELECTRON_DIR))
from bridge import worker_environment_probe


def complete_env(**overrides):
    env = {
        'DASH0_ENABLED': 'true',
        'DASH0_OTEL_COLLECTOR_BASE_URL': 'https://collector.example.test',
        'DASH0_AUTH_TOKEN': 'test-token',
        'DASH0_DATASET': 'deck-test',
        'OTEL_SERVICE_NAME': 'decksynth-desktop-test',
    }
    env.update(overrides)
    return env


def audio_aggregate():
    return {
        'render_count': 4,
        'render_duration_sum_s': .012,
        'render_duration_max_s': .004,
        'render_budget_overrun_count': 1,
        'sdl_queue_empty_count': 2,
        'queue_frames': 256,
        'buffer_target_frames': 512,
        'dropped_aggregate_count': 0,
        'heartbeat_monotonic_s': 10.,
    }


class InMemoryExporter:
    def __init__(self):
        self.metrics = []
        self.spans = []
        self.shutdown_called = False

    def metric(self, name, value, attributes, service):
        self.metrics.append((name, value, attributes, service))

    def span(self, name, attributes, service):
        self.spans.append((name, attributes, service))

    def shutdown(self, timeout_s):
        self.shutdown_called = True
        return True

    def has_metric(self, name):
        return any(metric[0] == name for metric in self.metrics)

    def has_span(self, name):
        return any(span[0] == name for span in self.spans)


class RaisingExporter:
    def metric(self, *_args):
        raise RuntimeError('exporter offline')

    def span(self, *_args):
        raise RuntimeError('exporter offline')

    def shutdown(self, _timeout_s):
        raise RuntimeError('exporter offline')


class ObservabilityTests(unittest.TestCase):
    def test_disabled_config_creates_no_exporter_or_network_work(self):
        self.assertIsNone(TelemetryConfig.from_environ({}))
        observability = Observability.disabled()
        observability.record_audio_aggregate({'render_count': 1})
        self.assertFalse(observability.shutdown(.01))

    def test_enabled_test_exporter_receives_aggregate_metrics_and_lifecycle_span(self):
        config = TelemetryConfig.from_environ(complete_env())
        exporter = InMemoryExporter()
        observability = Observability(config, exporter_factory=lambda _: exporter)

        observability.record_audio_aggregate(audio_aggregate())
        observability.record_worker_lifecycle('started', .125)

        self.assertTrue(exporter.has_metric('decksynth.audio.render.duration'))
        self.assertTrue(exporter.has_metric('decksynth.audio.worker.heartbeat'))
        self.assertTrue(exporter.has_metric('decksynth.audio.startup.duration'))
        self.assertTrue(exporter.has_span('decksynth.audio.worker.started'))
        self.assertTrue(observability.shutdown(.01))
        self.assertTrue(exporter.shutdown_called)


class CredentialIsolationTests(unittest.TestCase):
    def test_spawned_audio_worker_has_no_otel_or_dash0_variables(self):
        result = worker_environment_probe(complete_env(OTEL_EXPORTER_OTLP_HEADERS='secret-header'))
        self.assertFalse(result['environment'])

    def test_spawned_audio_worker_does_not_import_observability_or_otel_modules(self):
        result = worker_environment_probe(complete_env())
        self.assertFalse([name for name in result['modules'] if name == 'decksynth.observability' or name.startswith('opentelemetry')])


class FullQueue:
    def __init__(self):
        self.full = True
        self.items = []

    def put_nowait(self, item):
        if self.full:
            raise queue.Full
        self.items.append(item)

    def make_room(self):
        self.full = False


class AudioAggregateTests(unittest.TestCase):
    def test_worker_aggregate_queue_is_nonblocking_and_reports_lost_aggregate(self):
        events = FullQueue()
        accumulator = AudioAggregatePublisher(events, report_interval_s=1)
        accumulator.record_render(.006, .005)
        accumulator.publish_if_due(now=1, queue_frames=0, buffer_target_frames=512)
        self.assertEqual(accumulator.dropped_aggregates, 1)

        events.make_room()
        event = accumulator.publish_if_due(now=2, queue_frames=256, buffer_target_frames=512)

        self.assertEqual(event['dropped_aggregate_count'], 1)
        self.assertEqual(events.items[-1], {'kind': 'audio_aggregate', 'aggregate': event})

    def test_render_budget_overrun_and_sdl_queue_empty_are_distinct(self):
        accumulator = AudioAggregatePublisher(FullQueue(), report_interval_s=1)
        accumulator.record_render(.006, .005)
        accumulator.record_sdl_queue_empty()

        aggregate = accumulator.snapshot(now=1, queue_frames=0, buffer_target_frames=512)

        self.assertEqual(aggregate['render_budget_overrun_count'], 1)
        self.assertEqual(aggregate['sdl_queue_empty_count'], 1)

    def test_export_failure_is_swallowed_and_shutdown_is_bounded(self):
        config = TelemetryConfig.from_environ(complete_env())
        observability = Observability(config, exporter_factory=lambda _: RaisingExporter())
        started = time.monotonic()
        observability.record_audio_aggregate(audio_aggregate())
        self.assertIn(observability.shutdown(.01), (False, True))
        self.assertLess(time.monotonic() - started, .25)

    def test_config_rejects_incomplete_or_disabled_values(self):
        self.assertIsNone(TelemetryConfig.from_environ(complete_env(DASH0_ENABLED='false')))
        self.assertIsNone(TelemetryConfig.from_environ(complete_env(DASH0_AUTH_TOKEN='')))
        self.assertIsNone(TelemetryConfig.from_environ(complete_env(DASH0_OTEL_COLLECTOR_BASE_URL='')))

    def test_config_uses_dash0_bearer_and_optional_dataset_headers(self):
        config = TelemetryConfig.from_environ(complete_env())
        self.assertEqual(config.headers, {
            'Authorization': 'Bearer test-token',
            'Dash0-Dataset': 'deck-test',
        })

    def test_exception_attributes_exclude_exception_message(self):
        config = TelemetryConfig.from_environ(complete_env())
        exporter = InMemoryExporter()
        observability = Observability(config, exporter_factory=lambda _: exporter)

        observability.record_exception('bridge_start', ValueError('secret project path'))

        span = exporter.spans[-1]
        self.assertEqual(span[0], 'decksynth.desktop.exception')
        self.assertEqual(span[1], {'operation': 'bridge_start', 'exception.type': 'ValueError'})

    def test_consumer_records_queue_events_without_touching_worker_path(self):
        exporter = InMemoryExporter()
        observability = Observability(TelemetryConfig.from_environ(complete_env()), exporter_factory=lambda _: exporter)
        events = queue.Queue(maxsize=8)
        consumer = TelemetryEventConsumer(events, observability)

        consumer.start()
        events.put({'kind': 'audio_aggregate', 'aggregate': audio_aggregate()})
        events.put({'kind': 'worker_lifecycle', 'state': 'started'})
        deadline = time.monotonic() + .5
        while time.monotonic() < deadline and not exporter.has_span('decksynth.audio.worker.started'):
            time.sleep(.005)
        consumer.stop(.1)

        self.assertTrue(exporter.has_metric('decksynth.audio.render.duration'))
        self.assertTrue(exporter.has_span('decksynth.audio.worker.started'))

    def test_consumer_routes_sanitized_low_rate_command_completion(self):
        completed = []
        events = queue.Queue(maxsize=8)
        consumer = TelemetryEventConsumer(events, Observability.disabled(), on_command_result=completed.append)

        consumer.start()
        events.put({'kind': 'command_result', 'request_id': 7, 'ok': True})
        deadline = time.monotonic() + .5
        while time.monotonic() < deadline and not completed:
            time.sleep(.005)
        consumer.stop(.1)

        self.assertEqual(completed, [{'kind': 'command_result', 'request_id': 7, 'ok': True}])

    def test_consumer_reports_only_the_worker_exception_class(self):
        exporter = InMemoryExporter()
        observability = Observability(TelemetryConfig.from_environ(complete_env()), exporter_factory=lambda _: exporter)
        events = queue.Queue(maxsize=8)
        consumer = TelemetryEventConsumer(events, observability)

        consumer.start()
        events.put({'kind': 'worker_exception', 'operation': 'worker_loop', 'exception_type': 'RuntimeError'})
        deadline = time.monotonic() + .5
        while time.monotonic() < deadline and not exporter.has_span('decksynth.audio.exception'):
            time.sleep(.005)
        consumer.stop(.1)

        self.assertEqual(exporter.spans[-1], (
            'decksynth.audio.exception',
            {'operation': 'worker_loop', 'exception.type': 'RuntimeError'},
            'decksynth-audio',
        ))


if __name__ == '__main__':
    unittest.main()
