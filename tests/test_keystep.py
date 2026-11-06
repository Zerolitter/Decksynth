"""KeyStep mk2-inspired performance engine: reference-contract regression tests.

No Roland/Arturia firmware, no physical CV or controller required.
"""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from decksynth.core import Engine, Project
from decksynth.keystep import (
    ARP_MODES, CHORDS, DIVISIONS, SCALES, HeldNotes, arp_groups,
    chord_notes, current_pattern, defaults, empty_pattern, mutate_pattern,
    pattern_from_song, scale_snap, schedule_notes, slot_key, song_from_pattern,
    step_change, validate_pattern, validate_state, velocity_transform,
)


class KeystepDataTests(unittest.TestCase):
    def test_64_banks_and_64_step_polyphony(self):
        addresses={slot_key(bank,slot) for bank in range(1,5) for slot in range(1,17)}
        self.assertEqual(len(addresses),64)
        p=empty_pattern(64,'1/16T')
        n=[dict(note=60+i,velocity=70+i,tie=1) for i in range(8)]
        p=step_change(p,63,n)
        validate_pattern(p)
        self.assertEqual(len(p['steps'][63]),8)
        with self.assertRaises(ValueError):step_change(p,63,[dict(note=90,velocity=99,tie=1)],False)

    def test_scale_chord_and_velocity(self):
        state=defaults();state['scale']['name']='Major';state['scale']['root']=0
        self.assertEqual(scale_snap(61,0,'Major'),60)
        state['chord']['enabled']=True
        self.assertEqual(chord_notes(state,61),[60,64,67])
        state['chord']['preset']='Minor 9'
        self.assertEqual(chord_notes(state,60),[60,63,67,70,74])
        state['chord']['preset']='User';state['chord']['user']=[0,7,12]
        self.assertEqual(chord_notes(state,60),[60,67,72])
        self.assertEqual(velocity_transform(16,'Fixed 100'),100)
        self.assertLess(velocity_transform(40,'Exponential'),40)
        self.assertGreater(velocity_transform(40,'Logarithmic'),40)

    def test_arp_modes_and_persistent_hold(self):
        pool=[60,64,67]
        self.assertTrue(set(ARP_MODES).issuperset({'Up','Down','UpDown','Random','Order','Poly','Short 1','Poly 4','User Sequence'}))
        self.assertEqual(arp_groups(pool,'Up',1),[[60],[64],[67]])
        self.assertEqual(arp_groups(pool,'Down',1),[[67],[64],[60]])
        self.assertEqual(arp_groups(pool,'Poly',1),[[60,64,67]])
        self.assertEqual(arp_groups(pool,'Up',2)[-3:],[[72],[76],[79]])
        self.assertEqual(arp_groups(pool,'Random',1,seed=55),arp_groups(pool,'Random',1,seed=55))
        self.assertEqual(arp_groups(pool,'Poly 4',1,seed=7),arp_groups(pool,'Poly 4',1,seed=7))
        h=HeldNotes()
        h.set_hold(True);h.on((0,60),[60,64,67]);h.off((0,60))
        self.assertEqual(h.held(),[60,64,67])
        h.on((0,62),[62,65,69])
        self.assertEqual(h.held(),[62,65,69])
        h.set_hold(False);h.off((0,62))
        self.assertEqual(h.held(),[])

    def test_song_transfer_and_mutate_is_non_destructive(self):
        pattern=empty_pattern(16)
        pattern=step_change(pattern,0,[dict(note=60,velocity=100,tie=2)])
        pattern=step_change(pattern,4,[dict(note=64,velocity=90,tie=1)])
        original=copy.deepcopy(pattern)
        notes=song_from_pattern(pattern,4)
        self.assertEqual(len(notes),2)
        self.assertAlmostEqual(notes[0]['duration'],.4)
        again=pattern_from_song(notes,4,'1/16',16)
        self.assertEqual(again['steps'][0][0]['note'],60)
        varied=mutate_pattern(pattern,.65,seed=1)
        self.assertEqual(pattern,original)
        validate_pattern(varied)

    def test_validation_rejects_bogus_controller_data(self):
        state=defaults();validate_state(state)
        state['arp']['division']='not-a-clock'
        with self.assertRaises(ValueError):validate_state(state)
        state=defaults();state['seq']['chain']=['5:19']
        with self.assertRaises(ValueError):validate_state(state)
        state=defaults();state['patterns']['1:1']=empty_pattern(64)
        state['patterns']['1:1']['steps'][0]=[{'note':180,'velocity':90,'tie':1}]
        with self.assertRaises(ValueError):validate_state(state)

    def test_project_save_reopen_backward_compatible(self):
        p=Project();p.performance['seq']['enabled']=True
        p.performance['patterns']['3:7']=step_change(empty_pattern(),0,[dict(note=62,velocity=104,tie=1)])
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'song.decksynth'
            p.save(path);q=Project.load(path)
            self.assertEqual(q.performance,p.performance)
            data=q.data();data.pop('performance')
            path.write_text(json.dumps(data));legacy=Project.load(path)
            self.assertEqual(legacy.performance,defaults())


class KeystepAudioTests(unittest.TestCase):
    def test_selected_pattern_sounds_only_in_play(self):
        e=Engine(1000)
        e.perform_step(0,[dict(note=60,velocity=120,tie=1)])
        self.assertEqual(max(map(abs,e.render(512))),0)
        e.perform_set('seq','enabled',True)
        e.playing=True
        self.assertGreater(max(map(abs,e.render(512))),.001)
        e.stop()
        self.assertFalse(any(s.voices for s in e.synths))

    def test_sequencer_midi_step_overdub_and_commit(self):
        e=Engine(1000)
        e.perform_set('seq','enabled',True)
        e.perform_set('seq','recording',True)
        e.playing=True;e.midi(0x90,60,90)
        pattern=current_pattern(e.project.performance)
        self.assertEqual(pattern['steps'][0][0]['note'],60)
        self.assertEqual(e.project.tracks[0]['notes'],[],'Sequencer must not silently edit song clips')
        e.perform_set('seq','recording',False)
        e.perform_action('commit_song','add')
        self.assertEqual(len(e.project.tracks[0]['notes']),1)
        self.assertEqual(e.project.tracks[0]['notes'][0]['note'],60)

    def test_chord_live_voice_and_sustain(self):
        e=Engine(1000)
        e.perform_set('chord','enabled',True)
        e.midi(0x90,60,110)
        pitches=sorted(v['note'] for v in e.synths[0].voices.values())
        self.assertEqual(pitches,[60,64,67])
        e.render(200)
        e.midi(0xb0,64,127);e.midi(0x80,60,0)
        e.render(50)
        self.assertTrue(e.synths[0].voices)
        e.midi(0xb0,64,0)
        e.render(1000)
        self.assertEqual(e.synths[0].voices,{})

    def test_chord_strum_is_audible_and_release_cancels_pending(self):
        e=Engine(1000)
        e.perform_set('chord','enabled',True)
        e.perform_set('chord','strum_ms',100)
        e.midi(0x90,60,110)
        self.assertEqual(len(e.synths[0].voices),1)
        e.render(115)
        self.assertEqual(len(e.synths[0].voices),2)
        e.midi(0x80,60,0)
        self.assertEqual(e.scheduled_live,[])
        e.render(600)
        self.assertEqual(e.synths[0].voices,{})

    def test_arpeggiator_from_held_midi_and_to_sequence(self):
        e=Engine(1000);e.perform_set('arp','enabled',True)
        for pitch in (60,64,67):e.midi(0x90,pitch,105)
        self.assertTrue(e.playing)
        self.assertGreater(max(map(abs,e.render(1000))),.001)
        e.perform_action('arp_to_seq')
        self.assertFalse(e.project.performance['arp']['enabled'])
        self.assertTrue(e.project.performance['seq']['enabled'])
        self.assertEqual(len(current_pattern(e.project.performance)['steps']),3)
        self.assertEqual(e.project.tracks[0]['notes'],[])

    def test_mutate_reset_undo_and_banks(self):
        e=Engine(1000)
        e.perform_step(0,[dict(note=60,velocity=100,tie=1)])
        original=copy.deepcopy(current_pattern(e.project.performance))
        e.perform_action('mutate',1.)
        e.perform_action('reset_mutate')
        self.assertEqual(current_pattern(e.project.performance),original)
        e.perform_set('seq','slot',2)
        self.assertEqual(current_pattern(e.project.performance)['steps'][0],[])
        e.perform_set('seq','slot',1)
        self.assertEqual(current_pattern(e.project.performance),original)

    def test_perf_generated_voices_release_on_held_keys_up(self):
        e=Engine(1000)
        e.perform_set('arp','enabled',True)
        e.midi(0x90,60,100)
        e.render(75)
        self.assertTrue(e.synths[0].voices)
        e.midi(0x80,60,0)
        e.render(650)
        self.assertFalse(e.synths[0].voices)

    def test_spice_is_deterministic_and_ratchets_gate(self):
        state=defaults()
        state['seq']['enabled']=True
        pat=empty_pattern(16,'1/16')
        pat=step_change(pat,0,[dict(note=60,velocity=100,tie=1)])
        state['patterns']['1:1']=pat
        initial=schedule_notes(state,[],0,8000,1000)
        sounding=[e for e in initial if e[1]==1]
        self.assertEqual(len(sounding),2,'16-step pattern must loop every four beats')
        state['seq']['spice']=1.
        enhanced=schedule_notes(state,[],0,8000,1000)
        self.assertEqual(enhanced,schedule_notes(state,[],0,8000,1000),'Spice must be reproducible per tick')
        self.assertTrue(all(0<=e[0]<8000 for e in enhanced))
        self.assertTrue(all(0<=e[2]<=127 for e in enhanced))
        # Spice creates skip/ratchet variants, without changing stored pattern notes.
        self.assertEqual(len(pat['steps'][0]),1)
        self.assertNotEqual(enhanced,initial)

    def test_user_sequence_arpeggiates_saved_steps(self):
        state=defaults()
        state['arp']['enabled']=True
        state['arp']['mode']='User Sequence'
        pat=empty_pattern(4)
        pat=step_change(pat,0,[dict(note=60,velocity=80,tie=1)])
        pat=step_change(pat,1,[dict(note=67,velocity=80,tie=1)])
        state['patterns']['1:1']=pat
        events=schedule_notes(state,[64],0,900,1000)
        pitch=[e[2] for e in events if e[1]==1]
        self.assertEqual(pitch[:2],[64,71])
        self.assertTrue(all(e[0]>=0 for e in events))

    def test_mismatched_chain_rates_rejected_before_audio(self):
        e=Engine(1000)
        e.perform_step(0,[dict(note=60,velocity=100,tie=1)])
        e.perform_set('seq','slot',2)
        e.perform_set('seq','division','1/8')
        e.perform_set('seq','chain',['1:1','1:2'])
        with self.assertRaisesRegex(ValueError,'matching step divisions'):
            e.perform_set('seq','chain_enabled',True)
        self.assertFalse(e.project.performance['seq']['chain_enabled'])
        e.perform_set('seq','slot',1)
        e.perform_set('seq','chain',['1:1'])
        e.perform_set('seq','chain_enabled',True)
        e.perform_set('seq','enabled',True)
        e.playing=True
        self.assertGreater(max(map(abs,e.render(200))),.001)

    def test_usb_midi_clock_tempo_and_transport(self):
        e=Engine(1000)
        self.assertFalse(e.playing)
        e.receive_midi_clock(0xfa,1.)
        self.assertFalse(e.playing,'Internal mode ignores incoming clock/transport')
        e.perform_set('sync','source','USB MIDI')
        e.receive_midi_clock(0xfa,2.)
        self.assertTrue(e.playing)
        self.assertEqual(e.frame,0)
        # At 144 BPM a MIDI clock delivers 24 ticks per quarter note.
        for i in range(48):
            e.receive_midi_clock(0xf8,2.01+i*(60/(24*144)))
        self.assertTrue(e.clock_following)
        self.assertAlmostEqual(e.project.bpm,144,delta=1)
        e.render(500)
        beat=e.beat
        e.perform_set('sync','receive_transport',False)
        e.receive_midi_clock(0xfc,3.2)
        self.assertTrue(e.playing,'Off must ignore incoming stop')
        e.perform_set('sync','receive_transport',True)
        e.receive_midi_clock(0xfc,3.3)
        self.assertFalse(e.playing)
        self.assertEqual(e.frame,0)
        e.receive_midi_clock(0xfb,3.4)
        self.assertTrue(e.playing)
        # Running status parser continues to ignore real-time bytes.
        from decksynth.core import MidiParser
        self.assertEqual(MidiParser().feed(bytes([0x90,60,100,0xf8,64,90])),
                         [(0x90,60,100),(0x90,64,90)])

    def test_performance_schema_without_sync_is_migrated(self):
        state=defaults();state.pop('sync')
        upgraded=validate_state(state)
        self.assertEqual(upgraded['sync']['source'],'Internal')
        self.assertTrue(upgraded['sync']['receive_transport'])

    def test_project_does_not_rearm_live_step_record(self):
        p=Project();p.performance['seq']['recording']=True
        with tempfile.TemporaryDirectory() as root:
            saved=Path(root)/'record-on.decksynth'
            p.save(saved)
            reopened=Project.load(saved)
            self.assertFalse(reopened.performance['seq']['recording'])

    def test_realtime_bytes_interleaved_with_midi_note_stream(self):
        from unittest.mock import patch
        from decksynth.backend import MidiDevice
        e=Engine(1000);e.perform_set('sync','source','USB MIDI')
        m=MidiDevice();m.fd=101;m.connected='test-midi';m.next_scan=10**15
        data=bytes([0xfa,0xf8,0x90,60,100,0xf8,64,90])
        with patch('decksynth.backend.os.read',return_value=data):
            m.poll(e)
        # Avoid ever closing an unrelated host file descriptor in a synthetic test.
        m.fd=None
        self.assertTrue(e.playing)
        self.assertIn(('live',0,60,60),e.synths[0].voices)
        self.assertIn(('live',0,64,64),e.synths[0].voices)

    def test_song_notes_stay_while_arp_or_seq_plays(self):
        e=Engine(1000)
        e.project.tracks[0]['notes']=[dict(start=1.,duration=.4,note=48,velocity=100)]
        e.perform_set('seq','enabled',True)
        e.perform_step(0,[dict(note=72,velocity=100,tie=1)])
        e.playing=True;e.render(2200)
        self.assertEqual(e.project.tracks[0]['notes'][0]['note'],48)


if __name__=='__main__':unittest.main()
