"""Small line-delimited JSON bridge to the existing DeckSynth audio/MIDI worker.

Only Electron's local process can send commands through stdin; no HTTP server,
web socket or externally reachable endpoint. All worker logic remains unchanged.
"""
import json
import multiprocessing as mp
import os
import queue
import sys
import threading
import time
import itertools
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from decksynth.observability import Observability, TelemetryConfig, TelemetryEventConsumer
from decksynth.worker_entry import diagnostic_worker, isolation_probe, sanitized_worker

COMMANDS = {
    'drum_library_root', 'drum_library_refresh', 'drum_load_folder',
    'drum_list_samples', 'drum_preview_sample', 'drum_preview_stop', 'drum_replace_sample',
    'set_device', 'drum_note', 'drum_edit', 'drum_draft', 'drum_clear', 'drum_crop', 'drum_export', 'drum_import', 'sampler_make', 'sampler_edit', 'sampler_live', 'sampler_detect', 'spectral_seed',
    'sampler_load_wav', 'sampler_clear', 'add_track', 'remove_track', 'sample_save', 'sample_library_folder', 'sample_library_scan', 'sample_library_browse', 'sample_library_preview', 'sample_library_stop', 'sample_library_load', 'sampler_chop', 'sampler_view', 'sampler_audition', 'sampler_audition_stop', 'sampler_send', 'sampler_slice_roots', 'sampler_inputs', 'sampler_record',
    'perform_set', 'perform_step', 'perform_action',
    'midi', 'sound_gesture','sound_undo','sound_ab','automation_arm','automation','learn_cc', 'unlearn_cc', 'cancel_cc_learn', 'select', 'play', 'stop', 'panic', 'record', 'record_options', 'audio_latency', 'undo', 'quantize',
    'clear', 'device', 'audio_device', 'preset', 'parameter',
    'edit_note','note_edit','editor_note','catalog_action', 'structure_add', 'structure_load', 'structure_set', 'structure_merge','structure_part_length', 'structure_extend', 'track', 'send', 'send_setting', 'song', 'clip', 'tempo', 'bars', 'metronome', 'fx', 'fx_reorder', 'cleanup',
    'save', 'load', 'export','export_wav', 'freeze', 'unfreeze', 'save_preset', 'load_preset',
}
TELEMETRY_COMMANDS = {'play', 'stop', 'save', 'load', 'audio_device', 'export_wav', 'freeze', 'unfreeze'}

def encode(value):
    try:
        return json.dumps(value, separators=(',', ':'), allow_nan=False)
    except (ValueError, TypeError):
        return json.dumps({'error':'Non-finite backend result suppressed'})

def strip_telemetry_environment(environ):
    for key in tuple(environ):
        if key.startswith(('DASH0_', 'OTEL_')):
            environ.pop(key, None)

def capture_telemetry_config(environ):
    """Capture bridge-only configuration, then remove it before `spawn` inherits."""
    config = TelemetryConfig.from_environ(environ)
    strip_telemetry_environment(environ)
    return config

def spawn_worker_without_telemetry(target, args, context=mp):
    """Start a worker only after permanently clearing inherited telemetry env."""
    strip_telemetry_environment(os.environ)
    process = context.Process(target=target, args=args, daemon=True)
    process.start()
    return process

def worker_environment_probe(environ):
    """Test-only spawned-process probe; it restores the calling test environment afterwards."""
    original = dict(os.environ)
    context = mp.get_context('spawn')
    results = context.Queue(1)
    process = None
    try:
        os.environ.clear()
        os.environ.update(environ)
        capture_telemetry_config(os.environ)
        process = spawn_worker_without_telemetry(isolation_probe, (results,), context)
        result = results.get(timeout=3)
        process.join(3)
        return result
    finally:
        if process is not None and process.is_alive():
            process.terminate()
            process.join(1)
        results.close()
        os.environ.clear()
        os.environ.update(original)

def main():
    mp.set_start_method('spawn', force=True)
    config = capture_telemetry_config(os.environ)
    observability = Observability(config)
    telemetry_events = mp.Queue(8) if observability.enabled else None
    pending_commands = {}
    pending_lock = threading.Lock()
    request_ids = itertools.count(1)

    def record_command_result(event):
        request_id = event.get('request_id')
        with pending_lock:
            pending = pending_commands.pop(request_id, None)
        if pending is not None:
            operation, started_at = pending
            observability.record_command(operation, time.monotonic() - started_at, event.get('ok') is True)

    telemetry_consumer = TelemetryEventConsumer(telemetry_events, observability, record_command_result) if telemetry_events is not None else None
    if telemetry_consumer is not None:
        telemetry_consumer.start()
    commands = mp.Queue(512)
    updates = mp.Queue(64)
    target = diagnostic_worker if os.environ.get('DECKSYNTH_DIAGNOSTIC') == '1' else sanitized_worker
    process = spawn_worker_without_telemetry(target, (commands, updates, telemetry_events))
    alive = threading.Event()
    alive.set()

    def accept_input():
        try:
            for line in sys.stdin:
                if not alive.is_set():
                    break
                request_id = None
                try:
                    item = json.loads(line, parse_constant=lambda name: (_ for _ in ()).throw(ValueError(name)))
                    if not isinstance(item, dict) or item.get('cmd') not in COMMANDS:
                        raise ValueError('Unsupported DeckSynth action')
                    command, args = item['cmd'], item.get('args')
                    if telemetry_consumer is not None and command in TELEMETRY_COMMANDS:
                        now = time.monotonic()
                        with pending_lock:
                            stale = [key for key, (_, started_at) in pending_commands.items() if now - started_at > 5]
                            for key in stale:
                                pending_commands.pop(key, None)
                            if len(pending_commands) < 64:
                                request_id = next(request_ids)
                                pending_commands[request_id] = (command, now)
                        if request_id is not None:
                            commands.put((command, args, request_id), timeout=2)
                        else:
                            commands.put((command, args), timeout=2)
                    else:
                        commands.put((command, args), timeout=2)
                except (ValueError,TypeError,queue.Full,KeyError) as exc:
                    if request_id is not None:
                        with pending_lock:
                            pending_commands.pop(request_id, None)
                    print(encode({'error':'Command rejected: '+str(exc)}),flush=True)
        finally:
            alive.clear()

    reader = threading.Thread(target=accept_input,daemon=True)
    reader.start()

    # If Electron is killed (no clean stdin close), the bridge is re-parented: stop, so the finally below
    # tells the worker to quit, and the worker also checks its own parent.
    electron = os.getppid()
    def watch_parent():
        while alive.is_set():
            if os.getppid() != electron:
                alive.clear(); break
            time.sleep(.25)
    threading.Thread(target=watch_parent,daemon=True).start()
    print(encode({'bridge':'ready','process':process.pid}),flush=True)
    try:
        while alive.is_set() and process.is_alive():
            try: message = updates.get(timeout=.2)
            except queue.Empty: continue
            print(encode(message),flush=True)
    finally:
        alive.clear()
        try: commands.put(('quit',None),timeout=.5)
        except queue.Full: pass
        process.join(2)
        if process.is_alive():
            process.terminate()
            process.join(1)
        commands.close()
        updates.close()
        if telemetry_consumer is not None:
            telemetry_consumer.stop(.25)
        if telemetry_events is not None:
            telemetry_events.close()
        observability.shutdown(.25)

if __name__=='__main__':
    main()
