"""Spawn-safe audio worker entrypoints with no observability dependency.

`multiprocessing` imports a target's module in a spawned child.  Keeping these
small entrypoints outside Electron's bridge guarantees an audio worker cannot
load its telemetry facade or any OpenTelemetry exporter code as a side effect
of process startup.
"""
import os
import sys


def strip_telemetry_environment(environ=None):
    environ = os.environ if environ is None else environ
    for key in tuple(environ):
        if key.startswith(('DASH0_', 'OTEL_')):
            environ.pop(key, None)


def sanitized_worker(commands, updates, telemetry_events=None):
    strip_telemetry_environment()
    from decksynth.backend import worker
    worker(commands, updates, telemetry_events)


def diagnostic_worker(commands, updates, telemetry_events=None):
    # Test mode never opens actual Roland MIDI or other /dev/snd/midi endpoints.
    strip_telemetry_environment()
    from decksynth.backend import MidiDevice, worker
    MidiDevice.devices = staticmethod(lambda: [])
    worker(commands, updates, telemetry_events)


def isolation_probe(results):
    """Test-only proof that a worker inherits neither config nor telemetry code."""
    results.put({
        'environment': [key for key in os.environ if key.startswith(('DASH0_', 'OTEL_'))],
        'modules': list(sys.modules),
    })
