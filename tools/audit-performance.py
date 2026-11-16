#!/usr/bin/env python3
"""Offline recovery probes; reports known gaps without opening MIDI/audio or projects.

Run from any directory. Exit 0 means the audit ran, NOT feature acceptance.
The expected values describe the musical contracts proposed in the roadmap.
"""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from decksynth.core import Engine
from decksynth.keystep import (
    arp_groups, chord_notes, current_pattern, defaults, empty_pattern, mutate_pattern,
    schedule_notes, step_change,
)


def probe_results():
    results = []

    def record(identifier, expected, observed):
        results.append(dict(id=identifier, expected=expected, observed=observed,
                            meets_expectation=expected == observed))

    e = Engine(1000)
    e.perform_set('seq', 'enabled', True)
    e.perform_set('seq', 'recording', True)
    for pitch in (60, 62):
        e.midi(0x90, pitch, 100)
        e.midi(0x80, pitch, 0)
    record('stopped_step_record_advances', [[60], [62]],
           [[n['note'] for n in step]
            for step in current_pattern(e.project.performance)['steps'][:2]])

    e = Engine(1000)
    e.perform_set('scale', 'name', 'Major')
    e.perform_step(0, [dict(note=61, velocity=100, tie=1)])
    e.perform_set('seq', 'enabled', True)
    record('global_scale_covers_sequence', [60],
           [event[2] for event in schedule_notes(e.project.performance, [], 0, 1, e.fpb)
            if event[1]])

    e = Engine(1000)
    e.perform_set('scale', 'name', 'Major')
    e.perform_set('chord', 'enabled', True)
    e.perform_set('chord', 'preset', 'Minor Triad')
    record('global_scale_covers_chord_voices', [60, 62, 67],
           chord_notes(e.project.performance, 60))

    e = Engine(1000)
    e.perform_set('seq', 'gate', .2)
    e.perform_set('seq', 'swing', .7)
    e.perform_set('seq', 'slot', 2)
    e.perform_set('seq', 'gate', .9)
    e.perform_set('seq', 'swing', .5)
    e.perform_set('seq', 'slot', 1)
    record('pattern_recall_controls_match_sound', dict(gate=.2, swing=.7),
           {key: e.project.performance['seq'][key] for key in ('gate', 'swing')})

    e = Engine(1000)
    e.perform_set('seq', 'enabled', True)
    e.perform_set('seq', 'recording', True)
    e.perform_set('seq', 'overdub', False)
    e.playing = True
    for pitch in (60, 64, 67):
        e.midi(0x90, pitch, 100)
    record('replace_keeps_whole_new_chord', [60, 64, 67],
           [n['note'] for n in current_pattern(e.project.performance)['steps'][0]])

    state = defaults()
    state['seq']['enabled'] = True
    state['patterns']['1:1'] = step_change(empty_pattern(4), 0,
                                          [dict(note=60, velocity=100, tie=4)])
    events = schedule_notes(state, [], 0, 1000, 1000)
    record('tie_uses_full_steps_then_final_gate', 950,
           next(event[0] for event in events if event[1] == 0))

    e = Engine(1000)
    e.perform_set('seq', 'length', 4)
    e.perform_step(0, [dict(note=60, velocity=80, tie=1)])
    e.perform_step(1, [dict(note=67, velocity=90, tie=1)])
    e.perform_set('arp', 'mode', 'User Sequence')
    e.perform_set('arp', 'enabled', True)
    e.midi(0x90, 67, 100)
    sounding = [event[2] for event in schedule_notes(
        e.project.performance, e.perform_held.held(), 0, 500, e.fpb) if event[1]]
    e.perform_action('arp_to_seq')
    record('user_arp_capture_matches_playback', sounding,
           [n['note'] for step in current_pattern(e.project.performance)['steps'] for n in step])

    e = Engine(1000)
    e.perform_set('sync', 'source', 'USB MIDI')
    e.perform_set('arp', 'enabled', True)
    e.midi(0x90, 60, 100)
    record('external_only_waits_for_clock', False, e.playing)

    e = Engine(1000)
    e.perform_set('arp', 'enabled', True)
    e.record(0)
    e.midi(0x90, 60, 100)
    e.render(1000)
    e.midi(0x80, 60, 0)
    e.finish_record()
    record('song_record_captures_generated_arp', True,
           bool(e.project.tracks[0]['notes']))

    pattern = empty_pattern(16)
    for index in range(16):
        pattern = step_change(pattern, index,
                              [dict(note=60+n, velocity=100, tie=1) for n in range(8)])
    mutated = mutate_pattern(pattern, 1., 1)
    record('full_pattern_mutation_does_not_silently_drop_notes', 128,
           sum(map(len, mutated['steps'])))
    record('updown_descends_in_pitch_order', [[60], [64], [67], [72], [67], [64]],
           arp_groups([60, 64, 67, 72], 'UpDown'))
    return results


if __name__ == '__main__':
    paths = ['decksynth/core.py', 'decksynth/keystep.py', 'decksynth/backend.py',
             'ui/src/components/Performance.tsx']
    fingerprints = {p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths}
    results = probe_results()
    print(json.dumps(dict(kind='offline_gap_audit', physical_audio=False,
                          physical_midi=False, source_sha256=fingerprints,
                          gap_count=sum(not r['meets_expectation'] for r in results),
                          results=results), indent=2))
