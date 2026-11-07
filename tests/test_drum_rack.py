"""Native sample instrument contracts. Fixtures are generated, never library audio."""
import copy
import json
import math
from pathlib import Path
import struct
import tempfile
import unittest
import wave

from decksynth.core import Engine, Project, PRESETS


class DrumRackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.wav = Path(self.tmp.name) / 'hit.wav'
        with wave.open(str(self.wav), 'wb') as f:
            f.setparams((1, 2, 48000, 24000, 'NONE', 'not compressed'))
            f.writeframes(b''.join(struct.pack('<h', round(6000*math.cos(i*.03))) for i in range(24000)))
        self.e = Engine()

    def rack(self, track=0):
        self.assertTrue(hasattr(self.e, 'set_device'), 'Engine must register Drum Rack as an additive device')
        self.e.set_device(track, 'drum_rack')
        return self.e.project.tracks[track]['drum_rack']['id']

    def assign(self, pad=0, track=0, kit=None):
        kit = kit or self.rack(track)
        self.e.import_drum_sample(track, kit, pad, str(self.wav))
        return kit

    def test_additive_device_preserves_legacy_song_and_performance(self):
        self.e.project.tracks[0]['notes'] = [dict(start=0., duration=1., note=60, velocity=90)]
        before = copy.deepcopy(self.e.project.data())
        kit = self.rack()
        self.assertEqual(len(PRESETS), 5)
        t = self.e.project.tracks[0]
        self.assertEqual(t['instrument'], before['tracks'][0]['instrument'])
        self.assertEqual(t['notes'], before['tracks'][0]['notes'])
        self.assertEqual(self.e.project.performance, before['performance'])
        self.assertEqual(self.e.project.song, before['song'])
        self.assertEqual([p['note'] for p in t['drum_rack']['pads']], list(range(36, 52)))
        self.e.set_device(0, 'synth')
        self.e.set_device(0, 'drum_rack')
        self.assertEqual(self.e.project.tracks[0]['drum_rack']['id'], kit)

    def test_midi_mapping_bypasses_chord_and_scale_and_release_is_one_shot(self):
        kit = self.assign(0)
        self.assign(15, kit=kit)
        self.e.project.performance['chord']['enabled'] = True
        self.e.project.performance['scale']['octave'] = 2
        self.e.midi(0x90, 36, 100)
        self.e.midi(0x90, 51, 90)
        self.e.midi(0x80, 36, 0)
        state = self.e.drum_state()[0]
        self.assertEqual([i for i, p in enumerate(state['pads']) if p['event']], [0, 15])
        self.assertEqual(self.e.drums[0].active_count, 2)
        self.assertGreater(max(map(abs, self.e.render(512))), .001)
        self.e.render(24000)
        self.assertEqual(self.e.drums[0].active_count, 0)

    def test_all_sixteen_midi_notes_route_to_only_their_pad(self):
        kit = self.rack()
        for i in range(16): self.assign(i, kit=kit)
        for i in range(16):
            before = [p['event'] for p in self.e.drum_state()[0]['pads']]
            self.e.midi(0x90, 36+i, 100)
            after = [p['event'] for p in self.e.drum_state()[0]['pads']]
            self.assertEqual([j for j in range(16) if before[j]!=after[j]], [i])
            self.e.midi(0x80, 36+i, 0)
        self.assertEqual(self.e.drums[0].active_count, 16)

    def test_touch_uses_captured_track_and_rejects_stale_kit(self):
        kit = self.assign()
        self.e.select(1)
        self.e.drum_note(0, kit, 0, 110)
        self.assertEqual(self.e.drums[0].active_count, 1)
        self.assertFalse(self.e.synths[1].voices)
        with self.assertRaises(ValueError): self.e.drum_note(0, 'stale-kit', 0, 100)
        self.assertEqual(self.e.drums[0].active_count, 1)

    def test_choke_fades_hat_only_in_eight_ms(self):
        kit = self.assign(0)
        for p in (6, 7):
            self.assign(p, kit=kit)
            self.e.edit_drum_pad(0, kit, p, 'choke', 1)
        kit2 = self.assign(0, track=1)
        self.e.drum_note(0, kit, 0, 100)
        self.e.drum_note(0, kit, 7, 100)
        self.e.drum_note(1, kit2, 0, 100)
        self.e.render(256)
        self.e.drum_note(0, kit, 6, 100)
        self.e.render(383)
        self.assertEqual(self.e.drums[0].active_count, 3)
        self.e.render(2)
        self.assertEqual(self.e.drums[0].active_count, 2)
        self.assertEqual(self.e.drums[1].active_count, 1)

    def test_voice_pool_bounded_repeated_hits_and_stop_panic(self):
        kit = self.assign()
        slots = tuple(map(id, self.e.drums[0].voices))
        for _ in range(100): self.e.drum_note(0, kit, 0, 100)
        self.assertEqual(self.e.drums[0].active_count, 32)
        self.assertEqual(tuple(map(id, self.e.drums[0].voices)), slots)
        self.e.render(1024)
        self.assertTrue(all(math.isfinite(v) and abs(v) <= 1 for v in self.e.render(512)))
        self.e.stop()
        self.assertEqual(self.e.drums[0].active_count, 0)
        self.e.drum_note(0, kit, 0, 100)
        self.e.panic()
        self.assertEqual(self.e.drums[0].active_count, 0)

    def test_device_change_cleans_only_owned_voices(self):
        kit = self.assign()
        self.e.voice_on(1, 60, 100, ('loop', 1, 0))
        self.e.drum_note(0, kit, 0, 100)
        self.e.set_device(0, 'synth')
        self.assertEqual(self.e.drums[0].active_count, 0)
        self.assertIn(('loop', 1, 0), self.e.synths[1].voices)

    def test_edit_invalid_and_failed_import_do_not_change_history_or_project(self):
        kit = self.assign()
        before = copy.deepcopy(self.e.project.data()); history = copy.deepcopy(self.e.history)
        for key, value in [('tune', float('nan')), ('gain', -1), ('mute', 1), ('note', 127), ('choke', 99)]:
            with self.subTest(key=key):
                with self.assertRaises(ValueError): self.e.edit_drum_pad(0, kit, 0, key, value)
        with self.assertRaises((ValueError, OSError)):
            self.e.import_drum_sample(0, kit, 0, str(self.wav.with_name('missing.wav')))
        with self.assertRaises(ValueError):
            self.e.import_drum_sample(0, kit, 0, str(self.wav), expected_sha='0'*64)
        self.assertEqual(self.e.project.data(), before)
        self.assertEqual(self.e.history, history)

    def test_mute_solo_velocity_tune_gain_and_one_undo_per_commit(self):
        kit = self.assign()
        count = len(self.e.history)
        self.e.edit_drum_pad(0, kit, 0, 'gain', .25)
        self.assertEqual(len(self.e.history), count+1)
        self.e.undo()
        self.assertEqual(self.e.project.tracks[0]['drum_rack']['pads'][0]['gain'], 1.)
        self.e.edit_drum_pad(0, kit, 0, 'mute', True)
        self.e.drum_note(0, kit, 0, 100)
        self.assertEqual(self.e.drums[0].active_count, 0)
        self.e.edit_drum_pad(0, kit, 0, 'mute', False)
        self.e.edit_drum_pad(0, kit, 1, 'solo', True)
        self.e.drum_note(0, kit, 0, 100)
        self.assertEqual(self.e.drums[0].active_count, 0)
        self.e.edit_drum_pad(0, kit, 1, 'solo', False)
        self.e.edit_drum_pad(0, kit, 0, 'tune', 12.)
        self.e.drum_note(0, kit, 0, 127)
        self.e.render(12001)
        self.assertEqual(self.e.drums[0].active_count, 0)

    def test_save_reopen_missing_relink_preserves_notes_and_performance(self):
        kit = self.assign()
        self.e.project.tracks[1]['notes'] = [dict(start=.3, duration=.5, note=64, velocity=87)]
        before = copy.deepcopy(self.e.project.data())
        path = Path(self.tmp.name)/'song.decksynth'
        self.e.project.save(path)
        self.assertLess(path.stat().st_size, 50000)
        self.wav.rename(self.wav.with_name('moved.wav'))
        e2 = Engine(); e2.project = Project.load(path); e2.configure(); e2.load_drum_sources()
        self.assertEqual(e2.drum_state()[0]['pads'][0]['status'], 'MISSING')
        self.assertEqual(e2.project.data(), before)
        source = before['tracks'][0]['drum_rack']['pads'][0]['source']
        e2.import_drum_sample(0, kit, 0, str(self.wav.with_name('moved.wav')), source['sha256'])
        self.assertEqual(e2.drum_state()[0]['pads'][0]['status'], 'READY')
        self.assertEqual(e2.project.performance, before['performance'])
        self.assertEqual(e2.project.tracks[1]['notes'], before['tracks'][1]['notes'])

    def test_song_and_live_drums_share_sample_clock(self):
        kit = self.assign()
        self.e.project.bars = 1
        self.e.project.tracks[0]['notes'] = [dict(start=.25, duration=.1, note=36, velocity=100)]
        self.e.voice_on(1, 60, 100, ('live', 0, 60, 60))
        self.e.playing = True
        self.e.render(6000)
        self.assertEqual(self.e.drum_state()[0]['pads'][0]['event'], 0)
        self.e.render(1)
        self.assertEqual(self.e.drum_state()[0]['pads'][0]['event'], 1)
        self.e.drum_note(0, kit, 0, 110)
        self.assertEqual(self.e.drums[0].active_count, 2)
        self.assertTrue(self.e.synths[1].voices)

    def test_recorded_drum_note_keeps_original_pitch(self):
        kit = self.assign()
        self.e.record(0)
        self.e.midi(0x90, 36, 100); self.e.render(4800); self.e.midi(0x80, 36, 0)
        self.e.finish_record()
        self.assertEqual(self.e.project.tracks[0]['notes'][0]['note'], 36)
        self.assertEqual(self.e.drums[0].active_count, 1)

    def test_drum_key_does_not_swallow_subsequent_synth_note_off(self):
        kit = self.assign()
        self.e.midi(0x90, 36, 100)
        self.e.select(1)
        self.e.midi(0x90, 36, 100)
        self.e.midi(0x80, 36, 0)
        self.assertTrue(all(v['release'] is not None for v in self.e.synths[1].voices.values()))
        self.assertEqual(self.e.drums[0].active_count, 1, 'old drum one-shot may finish naturally')
        self.e.render(96000)
        self.assertFalse(self.e.synths[1].voices)

    def test_reopened_corrupt_drum_schema_rejected_without_touching_file(self):
        self.rack()
        path = Path(self.tmp.name)/'bad.decksynth'
        data = self.e.project.data(); data['tracks'][0]['drum_rack']['pads'][0]['gain'] = 900
        path.write_text(json.dumps(data)); original = path.read_bytes()
        with self.assertRaises(ValueError): Project.load(path)
        self.assertEqual(path.read_bytes(), original)

    def test_legacy_serialization_unchanged_without_device(self):
        p = Project(); before = copy.deepcopy(p.data())
        path = Path(self.tmp.name)/'legacy.decksynth'; p.save(path)
        self.assertEqual(Project.load(path).data(), before)
        self.assertNotIn('device', before['tracks'][0])


if __name__ == '__main__': unittest.main()
