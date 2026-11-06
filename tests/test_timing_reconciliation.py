"""M1a timing reconciliation and legacy-chain compatibility; no device access."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from decksynth.core import Engine, Project
from decksynth.keystep import empty_pattern, current_pattern, schedule_notes


def pattern(length,division,gate,swing,note=60):
    p=empty_pattern(length,division)
    p.update(gate=gate,swing=swing)
    p['steps'][0]=[dict(note=note,velocity=100,tie=1)]
    return p


class TimingReconciliationTests(unittest.TestCase):
    def assert_timing(self,state,expected):
        fields=('length','division','gate','swing')
        self.assertEqual(tuple(state['seq'][k] for k in fields),expected)
        self.assertEqual(tuple(current_pattern(state)[k] for k in fields),expected)

    def engine(self):
        e=Engine(1000)
        e.project.performance['patterns']={
            '1:1':pattern(7,'1/8T',.2,.7),
            '1:2':pattern(16,'1/16',.9,.5,64),
            '2:2':pattern(9,'1/8',.3,.6,67),
        }
        e.project.performance['seq'].update(slot=2,gate=.9,swing=.5)
        e.project.tracks[0]['notes']=[dict(start=0.,duration=.5,note=60,velocity=91),
                                    dict(start=1.,duration=.25,note=64,velocity=82)]
        return e

    def test_bank_and_slot_selection_reconcile_all_four_fields_without_editing_notes(self):
        for key,value,expected in [('slot',1,(7,'1/8T',.2,.7)),('bank',2,(9,'1/8',.3,.6))]:
            with self.subTest(key=key):
                e=self.engine();patterns=copy.deepcopy(e.project.performance['patterns'])
                tracks=copy.deepcopy(e.project.tracks)
                e.perform_set('seq',key,value)
                self.assert_timing(e.project.performance,expected)
                self.assertEqual(e.project.performance['patterns'],patterns)
                self.assertEqual(e.project.tracks,tracks)

    def test_selecting_absent_slot_keeps_selection_defaults_without_materializing(self):
        e=self.engine();e.project.performance['seq'].update(length=7,division='1/8T',gate=.2,swing=.7)
        before=copy.deepcopy(e.project.performance['patterns'])
        e.perform_set('seq','slot',3)
        self.assert_timing(e.project.performance,(16,'1/16',.8,.5))
        self.assertEqual(e.project.performance['patterns'],before)

    def test_load_inconsistent_timing_prefers_stored_pattern_without_rewriting_file(self):
        e=self.engine();data=e.project.data();data['performance']['seq'].update(slot=1,recording=True)
        before=copy.deepcopy(data)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'inconsistent.decksynth';path.write_text(json.dumps(data))
            original=path.read_bytes();loaded=Project.load(path)
            self.assert_timing(loaded.performance,(7,'1/8T',.2,.7))
            self.assertFalse(loaded.performance['seq']['recording'])
            self.assertEqual(loaded.performance['patterns'],before['performance']['patterns'])
            self.assertEqual(loaded.tracks,before['tracks'])
            self.assertEqual(path.read_bytes(),original)

    def test_legacy_absent_slot_load_keeps_saved_length_and_rate(self):
        for without_sync in (False,True):
            with self.subTest(without_sync=without_sync),tempfile.TemporaryDirectory() as directory:
                data=Project().data();state=data['performance']
                state['seq'].update(length=7,division='1/8T',gate=.2,swing=.7,recording=True)
                if without_sync:state.pop('sync')
                path=Path(directory)/'legacy.decksynth';path.write_text(json.dumps(data));original=path.read_bytes()
                loaded=Project.load(path)
                self.assert_timing(loaded.performance,(7,'1/8T',.8,.5))
                self.assertEqual(loaded.performance['patterns'],{})
                self.assertFalse(loaded.performance['seq']['recording'])
                self.assertEqual(path.read_bytes(),original)

    def test_song_to_pattern_reconciles_converter_defaults_and_preserves_song(self):
        e=self.engine();e.perform_set('seq','slot',1)
        e.perform_set('seq','gate',.2);e.perform_set('seq','swing',.7)
        tracks=copy.deepcopy(e.project.tracks);other=copy.deepcopy(e.project.performance['patterns']['1:2'])
        e.perform_action('capture_song')
        self.assert_timing(e.project.performance,(7,'1/8T',.8,.5))
        steps=current_pattern(e.project.performance)['steps']
        self.assertEqual(steps[0],[dict(note=60,velocity=91,tie=2)])
        self.assertEqual(steps[3],[dict(note=64,velocity=82,tie=1)])
        self.assertEqual(e.project.tracks,tracks)
        self.assertEqual(e.project.performance['patterns']['1:2'],other)

    def test_arp_to_seq_reconciles_generated_timing_without_changing_algorithm(self):
        e=self.engine();e.perform_set('seq','slot',1)
        e.perform_set('arp','enabled',True)
        for key,value in [('division','1/8T'),('gate',.6),('swing',.62),('length',9)]:
            e.perform_set('arp',key,value)
        for note in [60,64,67]:e.midi(0x90,note,100)
        tracks=copy.deepcopy(e.project.tracks);other=copy.deepcopy(e.project.performance['patterns']['1:2'])
        e.perform_action('arp_to_seq')
        self.assert_timing(e.project.performance,(3,'1/8T',.6,.62))
        self.assertEqual(current_pattern(e.project.performance)['steps'],
                         [[dict(note=n,velocity=100,tie=1)] for n in [60,64,67]])
        self.assertTrue(e.project.performance['seq']['enabled'])
        self.assertFalse(e.project.performance['arp']['enabled'])
        self.assertEqual(e.project.tracks,tracks)
        self.assertEqual(e.project.performance['patterns']['1:2'],other)

    def test_invalid_conversion_keeps_project_and_history(self):
        e=self.engine();e.project.performance['patterns']['1:1']['division']='1/16'
        e.perform_set('seq','chain',['1:1','1:2']);e.perform_set('seq','chain_enabled',True)
        e.perform_set('arp','enabled',True);e.perform_set('arp','division','1/8')
        e.midi(0x90,60,100)
        before=copy.deepcopy(e.project.data());history=copy.deepcopy(e.history)
        with self.assertRaisesRegex(ValueError,'matching step divisions'):
            e.perform_action('arp_to_seq')
        self.assertEqual(e.project.data(),before)
        self.assertEqual(e.history,history)

    def test_legacy_enabled_chain_keeps_23_step_cycle_and_source_bytes(self):
        fixture=Path(__file__).parent/'fixtures/m1a-chain-23.decksynth'
        original=fixture.read_bytes();data=json.loads(original)
        # Literal cycle evidence before load: 7 stored steps + 16 inherited empty steps.
        baseline=schedule_notes(data['performance'],[],0,12000,1000)
        self.assertEqual([v[0] for v in baseline if v[1]],[0,5750,11500])
        loaded=Project.load(fixture)
        self.assert_timing(loaded.performance,(7,'1/16',.2,.5))
        self.assertEqual(schedule_notes(loaded.performance,[],0,12000,1000),baseline)
        self.assertEqual(loaded.performance['patterns']['1:1'],data['performance']['patterns']['1:1'])
        self.assertEqual(loaded.performance['patterns']['1:2']['length'],16)
        self.assertTrue(all(not step for step in loaded.performance['patterns']['1:2']['steps']))
        self.assertEqual(loaded.tracks,data['tracks'])
        self.assertEqual(fixture.read_bytes(),original)
        with tempfile.TemporaryDirectory() as directory:
            copy_path=Path(directory)/'resolved.decksynth';loaded.save(copy_path)
            again=Project.load(copy_path)
            self.assertEqual(schedule_notes(again.performance,[],0,12000,1000),baseline)
        self.assertEqual(fixture.read_bytes(),original)
