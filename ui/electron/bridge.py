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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from decksynth.backend import worker

def diagnostic_worker(commands, updates):
    # Test mode never opens actual Roland MIDI or other /dev/snd/midi endpoints.
    from decksynth.backend import MidiDevice
    MidiDevice.devices = staticmethod(lambda: [])
    worker(commands, updates)

COMMANDS = {
    'drum_library_root', 'drum_library_refresh', 'drum_load_folder',
    'drum_list_samples', 'drum_preview_sample', 'drum_preview_stop', 'drum_replace_sample',
    'set_device', 'drum_note', 'drum_edit', 'drum_draft', 'drum_clear', 'drum_crop', 'drum_export', 'drum_import', 'sampler_make', 'sampler_edit', 'sampler_live', 'sampler_detect', 'spectral_seed',
    'sampler_load_wav', 'sampler_clear', 'add_track', 'remove_track', 'sample_save', 'sample_library_folder', 'sample_library_scan', 'sample_library_browse', 'sample_library_preview', 'sample_library_stop', 'sample_library_load', 'sampler_chop', 'sampler_view', 'sampler_audition', 'sampler_audition_stop', 'sampler_send', 'sampler_slice_roots', 'sampler_inputs', 'sampler_record',
    'perform_set', 'perform_step', 'perform_action',
    'midi', 'sound_gesture','sound_undo','sound_ab','automation_arm','automation','learn_cc', 'unlearn_cc', 'cancel_cc_learn', 'select', 'play', 'stop', 'panic', 'record', 'record_options', 'audio_latency', 'undo', 'quantize',
    'clear', 'device', 'audio_device', 'preset', 'parameter',
    'edit_note','note_edit','editor_note','catalog_action', 'structure_add', 'structure_load', 'structure_set', 'structure_merge', 'structure_extend', 'track', 'send', 'send_setting', 'song', 'clip', 'tempo', 'bars', 'metronome', 'fx', 'fx_reorder', 'cleanup',
    'save', 'load', 'export','export_wav', 'freeze', 'unfreeze', 'save_preset', 'load_preset',
}

def encode(value):
    try:
        return json.dumps(value, separators=(',', ':'), allow_nan=False)
    except (ValueError, TypeError):
        return json.dumps({'error':'Non-finite backend result suppressed'})

def main():
    mp.set_start_method('spawn', force=True)
    commands = mp.Queue(512)
    updates = mp.Queue(64)
    target = diagnostic_worker if os.environ.get('DECKSYNTH_DIAGNOSTIC') == '1' else worker
    process = mp.Process(target=target, args=(commands, updates), daemon=True)
    process.start()
    alive = threading.Event()
    alive.set()

    def accept_input():
        try:
            for line in sys.stdin:
                if not alive.is_set():
                    break
                try:
                    item = json.loads(line, parse_constant=lambda name: (_ for _ in ()).throw(ValueError(name)))
                    if not isinstance(item, dict) or item.get('cmd') not in COMMANDS:
                        raise ValueError('Unsupported DeckSynth action')
                    commands.put((item['cmd'],item.get('args')),timeout=2)
                except (ValueError,TypeError,queue.Full,KeyError) as exc:
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

if __name__=='__main__':
    main()
