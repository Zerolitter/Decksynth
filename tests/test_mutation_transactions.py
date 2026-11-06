"""M1b occurrence conservation, owned reset/Undo and rejected edit transactions."""
import copy
from pathlib import Path
import unittest
from unittest.mock import patch

from decksynth.core import Engine, Project
from decksynth.keystep import empty_pattern, current_pattern, mutate_pattern, validate_pattern, schedule_notes


def note(pitch=60,velocity=100,tie=1):return dict(note=pitch,velocity=velocity,tie=tie)


class MutationCapacityTests(unittest.TestCase):
    def test_full_16_by_8_pattern_conserves_all_128_occurrences(self):
        p=empty_pattern(16)
        p['steps']=[[note(48+j,70+j) for j in range(8)] for _ in range(16)]
        before=copy.deepcopy(p);result=mutate_pattern(p,1.,1)
        self.assertEqual(sum(map(len,result['steps'])),128)
        self.assertTrue(all(len(step)<=8 for step in result['steps']))
        self.assertEqual(result,mutate_pattern(p,1.,1))
        self.assertEqual(p,before);validate_pattern(result)

    def test_full_destination_leaves_source_and_target_unchanged(self):
        p=empty_pattern(2);p['steps']=[[note(60+j) for j in range(8)],[note(80,91,2)]]
        before=copy.deepcopy(p)
        with patch('decksynth.keystep.random.Random') as random:
            random.return_value.random.side_effect=[1.]*8+[0.]
            random.return_value.choice.side_effect=[-1,7]
            result=mutate_pattern(p,.5,1)
        self.assertEqual(result,before)
        self.assertEqual(p,before)

    def test_same_step_full_and_duplicate_notes_replace_their_own_occurrences(self):
        for duplicate in (False,True,'identical'):
            with self.subTest(duplicate=duplicate):
                p=empty_pattern(1);p['steps'][0]=[note(60 if duplicate else 60+j,70 if duplicate=='identical' else 70+j) for j in range(8)]
                before=copy.deepcopy(p)
                with patch('decksynth.keystep.random.Random') as random:
                    random.return_value.random.return_value=0.
                    random.return_value.choice.side_effect=[0,2]*8
                    result=mutate_pattern(p,1.,1)
                self.assertEqual(result['steps'][0],[note(62 if duplicate else 62+j,70 if duplicate=='identical' else 70+j) for j in range(8)])
                self.assertEqual(p,before)


class PatternTransactionTests(unittest.TestCase):
    def engine(self,length=4):
        e=Engine(1000);p=empty_pattern(length);p['steps'][0]=[note()]
        e.project.performance['patterns']['1:1']=p;e.project.performance['seq']['length']=length
        e.project.tracks[1]['notes']=[dict(start=0.,duration=.5,note=48,velocity=90)]
        return e

    def test_reset_is_owned_by_each_slot_and_wrong_slot_cannot_consume_another_session(self):
        e=self.engine();a=copy.deepcopy(current_pattern(e.project.performance))
        e.perform_action('mutate',1.);e.perform_set('seq','slot',2)
        before=copy.deepcopy(e.project.data());history=copy.deepcopy(e.history)
        with self.assertRaisesRegex(ValueError,'No mutation'):
            e.perform_action('reset_mutate')
        self.assertEqual(e.project.data(),before);self.assertEqual(e.history,history)
        e.perform_step(0,[note(64)]);b=copy.deepcopy(current_pattern(e.project.performance))
        e.perform_action('mutate',1.);e.perform_action('reset_mutate')
        self.assertEqual(current_pattern(e.project.performance),b)
        e.perform_set('seq','slot',1);e.perform_action('reset_mutate')
        self.assertEqual(current_pattern(e.project.performance),a)
        self.assertEqual(e.project.performance['patterns']['1:2'],b)

    def test_reset_rejects_later_step_or_timing_edits_without_altering_history(self):
        for timing in (False,True):
            with self.subTest(timing=timing):
                e=self.engine();e.perform_action('mutate',1.)
                if timing:e.perform_set('seq','gate',.3)
                else:e.perform_step(1,[note(72)])
                before=copy.deepcopy(e.project.data());history=copy.deepcopy(e.history)
                with self.assertRaisesRegex(ValueError,'changed'):
                    e.perform_action('reset_mutate')
                self.assertEqual(e.project.data(),before);self.assertEqual(e.history,history)

    def test_new_mutation_after_edit_uses_the_edited_pattern_as_baseline(self):
        e=self.engine();e.perform_action('mutate',1.);e.perform_step(1,[note(72)])
        edited=copy.deepcopy(current_pattern(e.project.performance))
        e.perform_action('mutate',1.);e.perform_action('reset_mutate')
        self.assertEqual(current_pattern(e.project.performance),edited)

    def test_pattern_undo_keeps_other_pattern_song_selection_and_later_seed(self):
        e=self.engine();original=copy.deepcopy(current_pattern(e.project.performance))
        e.perform_action('mutate',1.)
        e.perform_set('seq','slot',2);e.perform_set('seq','gate',.4)
        e.perform_set('seq','mutate_seed',999)
        e.project.tracks[1]['notes'].append(dict(start=1.,duration=.25,note=50,velocity=81))
        song=copy.deepcopy(e.project.tracks);other=copy.deepcopy(e.project.performance['patterns']['1:2'])
        e.undo()
        self.assertEqual(e.project.performance['patterns']['1:1'],original)
        self.assertEqual(e.project.performance['patterns']['1:2'],other)
        self.assertEqual(e.project.tracks,song)
        self.assertEqual(e.project.performance['seq']['slot'],2)
        self.assertEqual(e.project.performance['seq']['gate'],.4)
        self.assertEqual(e.project.performance['seq']['mutate_seed'],999)

    def test_undo_of_stale_pattern_entry_rejects_without_consuming_it(self):
        e=self.engine();e.perform_action('mutate',1.);e.perform_set('seq','gate',.3)
        before=copy.deepcopy(e.project.data());history=copy.deepcopy(e.history)
        with self.assertRaisesRegex(ValueError,'changed'):e.undo()
        self.assertEqual(e.project.data(),before);self.assertEqual(e.history,history)

    def test_conversion_undo_restores_owned_mode_flags_but_preserves_later_mode_choice(self):
        for later_choice in (False,True):
            with self.subTest(later_choice=later_choice):
                e=self.engine();e.perform_set('arp','enabled',True)
                original=copy.deepcopy(current_pattern(e.project.performance));song=copy.deepcopy(e.project.tracks)
                e.midi(0x90,60,100);e.perform_action('arp_to_seq')
                self.assertTrue(e.project.performance['seq']['enabled'])
                self.assertFalse(e.project.performance['arp']['enabled'])
                if later_choice:e.perform_set('seq','enabled',False)
                e.undo()
                self.assertEqual(current_pattern(e.project.performance),original)
                self.assertFalse(e.project.performance['seq']['enabled'])
                self.assertEqual(e.project.performance['arp']['enabled'],not later_choice)
                self.assertEqual(e.project.tracks,song)

    def test_undo_restores_reset_eligibility_and_removes_stale_baselines(self):
        e=self.engine();original=copy.deepcopy(current_pattern(e.project.performance))
        e.perform_action('mutate',1.);mutated=copy.deepcopy(current_pattern(e.project.performance))
        e.perform_step(1,[note(72)]);e.undo();e.perform_action('reset_mutate')
        self.assertEqual(current_pattern(e.project.performance),original)
        e.undo();self.assertEqual(current_pattern(e.project.performance),mutated)
        e.perform_action('reset_mutate');self.assertEqual(current_pattern(e.project.performance),original)
        e.undo();e.undo()
        before=copy.deepcopy(e.project.data());history=copy.deepcopy(e.history)
        with self.assertRaisesRegex(ValueError,'No mutation'):e.perform_action('reset_mutate')
        self.assertEqual(e.project.data(),before);self.assertEqual(e.history,history)

    def test_rejected_edits_preserve_data_history_and_scheduled_voices(self):
        cases=[('double',None),('nudge',2),('nudge',1.5),('octave',2),('octave',1.5),
               ('mutate',float('nan')),('mutate',float('inf')),('mutate',2),('unknown',None)]
        for action,value in cases:
            with self.subTest(action=action,value=value):
                e=self.engine(64);e.perform_action('mutate',0.)
                e.perform_set('seq','enabled',True);e.playing=True;e.render(1)
                before=copy.deepcopy(e.project.data());history=copy.deepcopy(e.history)
                voices=copy.deepcopy(e.synths[0].voices)
                with self.assertRaises(ValueError):e.perform_action(action,value)
                self.assertEqual(e.project.data(),before);self.assertEqual(e.history,history)
                self.assertEqual(e.synths[0].voices,voices)

    def test_rejected_enable_does_not_clear_held_notes(self):
        e=self.engine();e.midi(0x90,60,100)
        before=copy.deepcopy(e.project.data());held=e.perform_held.held()
        with self.assertRaises(ValueError):e.perform_set('seq','enabled','invalid')
        self.assertEqual(e.project.data(),before)
        self.assertEqual(e.perform_held.held(),held)

    def test_mutation_reset_and_undo_preserve_m1a_chain_cycle_and_song(self):
        path=Path(__file__).parent/'fixtures/m1a-chain-23.decksynth';source=path.read_bytes()
        e=Engine(1000);e.project=Project.load(path)
        baseline=copy.deepcopy(e.project.performance);song=copy.deepcopy(e.project.tracks)
        e.perform_action('mutate',1.);e.perform_action('reset_mutate')
        self.assertEqual(e.project.performance['patterns'],baseline['patterns'])
        self.assertEqual(e.project.tracks,song)
        self.assertEqual([v[0] for v in schedule_notes(e.project.performance,[],0,12000,1000) if v[1]],
                         [0,5750,11500])
        self.assertEqual(path.read_bytes(),source)
