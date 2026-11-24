"""Atomic note editing protects current ownership, persistent music and logical voice state."""
import copy,math,tempfile,unittest
from pathlib import Path
from decksynth.core import Engine,Project
from decksynth.keystep import current_pattern

def event(start=0.,note=60,duration=.25,velocity=100):return dict(start=start,note=note,duration=duration,velocity=velocity)
def target(e,kind='clip'):
 return dict(kind=kind,track=e.selected,clip=e.project.clips['open'][e.selected],bars=e.project.bars) if kind=='clip' else dict(kind=kind,track=e.selected,bank=e.project.performance['seq']['bank'],slot=e.project.performance['seq']['slot'])
class WorkflowNotes(unittest.TestCase):
 def test_paint_is_one_real_transaction_and_reopens(self):
  e=Engine();notes=[event(i*.25) for i in range(4)];e.note_edit(target(e),[],notes);self.assertEqual(e.project.tracks[0]['notes'],notes);self.assertEqual(len(e.history),1)
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'notes.decksynth';e.project.save(p);self.assertEqual(Project.load(p).tracks,e.project.tracks)
  e.undo();self.assertEqual(e.project.tracks[0]['notes'],[])
 def test_note_edit_undo_redo_restores_the_single_atomic_gesture(self):
  e=Engine();notes=[event(0.,60),event(.25,64)]
  e.note_edit(target(e),[],notes);e.undo_any()
  self.assertEqual(e.project.tracks[0]['notes'],[])
  self.assertTrue(e.redo_history)
  e.redo()
  self.assertEqual(e.project.tracks[0]['notes'],notes)
  self.assertEqual(len(e.history),1)
 def test_a_new_edit_discards_redo(self):
  e=Engine();e.note_edit(target(e),[],[event()]);e.undo_any();self.assertTrue(e.redo_history)
  e.note_edit(target(e),[],[event(1.,67)]);self.assertFalse(e.redo_history)
 def test_redo_refuses_after_a_change_that_has_no_undo_step(self):
  e=Engine();e.note_edit(target(e),[],[event()]);e.undo_any()
  e.project.tracks[0]['volume']=.123
  with self.assertRaises(ValueError):e.redo()
  self.assertEqual(e.project.tracks[0]['volume'],.123);self.assertFalse(e.redo_history)
 def test_a_refused_undo_leaves_no_redo_entry(self):
  e=Engine();e.note_edit(target(e),[],[event()]);e.project.tracks[0]['notes']=[event(1.,67)]
  with self.assertRaises(ValueError):e.undo_any()
  self.assertFalse(e.redo_history)
 def test_two_undos_redo_in_order(self):
  e=Engine();a=[event()];b=[event(),event(1.,67)]
  e.note_edit(target(e),[],a);e.note_edit(target(e),a,b);e.undo_any();e.undo_any()
  self.assertEqual(e.project.tracks[0]['notes'],[])
  e.redo();self.assertEqual(e.project.tracks[0]['notes'],a);e.redo();self.assertEqual(e.project.tracks[0]['notes'],b)
 def test_undo_preserves_unrelated_notes_added_after_the_edit(self):
  e=Engine();e.note_edit(target(e),[],[event()]);later=event(1.,67);e.project.tracks[1]['notes'].append(later);e.undo();self.assertEqual(e.project.tracks[1]['notes'],[later]);self.assertEqual(e.project.tracks[0]['notes'],[])
 def test_stale_owner_clip_bars_or_note_fingerprint_is_rejected(self):
  for change in ('track','clip','bars','notes'):
   e=Engine();t=target(e);before=copy.deepcopy(e.project.data())
   if change=='track':e.select(1)
   elif change=='clip':e.clip_action(0,'open',1)
   elif change=='bars':e.project.bars=8
   else:e.project.tracks[0]['notes']=[event(1.)]
   now=copy.deepcopy(e.project.data())
   with self.assertRaises(ValueError):e.note_edit(t,[],[event()])
   self.assertEqual(e.project.data(),now)
 def test_invalid_note_batches_do_not_change_state_or_history(self):
  for notes in ([event(note=128)],[event(duration=0.)],[event(start=float('nan'))],[event(velocity=True)],[event(start=-1.)]):
   e=Engine();before=copy.deepcopy(e.project.data())
   with self.assertRaises(ValueError):e.note_edit(target(e),[],notes)
   self.assertEqual(e.project.data(),before);self.assertEqual(e.history,[])
 def test_recording_rejects_mutation_without_losing_the_take(self):
  e=Engine();e.record(0);before=copy.deepcopy(e.project.data())
  with self.assertRaises(ValueError):e.note_edit(target(e),[],[event()])
  self.assertTrue(e.recording);self.assertEqual(e.project.data(),before)
 def test_pattern_batch_preserves_other_patterns_and_has_one_undo(self):
  e=Engine();before=copy.deepcopy(e.project.performance);p=copy.deepcopy(current_pattern(before));e.note_edit(target(e,'pattern'),p,[event(i,duration=1) for i in range(4)])
  self.assertTrue(all(e.project.performance['patterns']['1:1']['steps'][i] for i in range(4)));self.assertEqual(len(e.history),1)
  e.project.tracks[1]['notes']=[event(2.,72)];e.undo();self.assertEqual(e.project.performance['patterns'],before['patterns']);self.assertEqual(e.project.tracks[1]['notes'],[event(2.,72)])
 def test_stale_pattern_timing_and_capacity_are_rejected(self):
  e=Engine();p=copy.deepcopy(current_pattern(e.project.performance));e.perform_set('seq','length',32)
  with self.assertRaises(ValueError):e.note_edit(target(e,'pattern'),p,[event(0,duration=1)])
  p=copy.deepcopy(current_pattern(e.project.performance))
  for notes in ([event(0,n,duration=1) for n in range(60,69)],[event(0,duration=9)],[event(.1,duration=1)],[event(0,duration=1),event(0,duration=1)]):
   with self.assertRaises(ValueError):e.note_edit(target(e,'pattern'),p,notes)
 def test_edit_releases_only_changed_loop_owners_and_preserves_live_notes(self):
  e=Engine();e.project.tracks[0]['notes']=[event(0,60,duration=4),event(0,64,duration=4)];e.voice_on(0,60,100,('loop',0,0));e.voice_on(0,64,100,('loop',1,0));e.voice_on(0,67,100,('live',0,67,67));e.render(256)
  before=copy.deepcopy(e.project.tracks[0]['notes']);e.note_edit(target(e),before,[event(0,62,duration=4),before[1]])
  self.assertNotIn(('loop',0,0),e.synths[0].gated);self.assertIn(('loop',1,0),e.synths[0].gated);self.assertIn(('live',0,67,67),e.synths[0].gated)
 def test_editor_audition_has_own_note_ownership_and_never_records(self):
  e=Engine();e.record(0);e.voice_on(0,60,100,('live',0,60,60));e.synths[0].pedal(True);e.editor_note(0,'gesture-1',60,100);e.render(256);e.editor_note(0,'gesture-1',60,0)
  self.assertIn(('live',0,60,60),e.synths[0].gated);self.assertFalse(any(isinstance(k,tuple) and k[0]=='editor' for k in e.synths[0].gated));self.assertEqual(e.project.tracks[0]['notes'],[]);self.assertEqual(e.pending,{})
 def test_editor_audition_rejects_foreign_track_and_releases_on_selection(self):
  e=Engine()
  with self.assertRaises(ValueError):e.editor_note(1,'gesture-1',60,100)
  e.editor_note(0,'gesture-1',60,100);e.select(1);self.assertFalse(any(isinstance(k,tuple) and k[0]=='editor' for k in e.synths[0].gated));e.editor_note(0,'gesture-1',60,0)
 def test_bulk_edit_cancels_hidden_mono_notes_without_resurrection(self):
  e=Engine();e.project.tracks[0]['instrument']['play_mode']=2;e.configure();notes=[event(0,60,duration=4),event(0,64,duration=4)];e.project.tracks[0]['notes']=copy.deepcopy(notes)
  e.voice_on(0,60,100,('loop',0,0));e.voice_on(0,64,100,('loop',1,0));e.voice_on(0,67,100,('live',0,67,67));e.render(256);e.note_edit(target(e),notes,[]);e.voice_off(0,67,('live',0,67,67));e.render(48000)
  self.assertFalse(e.synths[0].gated);self.assertFalse(e.synths[0].mono_held);self.assertFalse(e.synths[0].voices)
 def test_manual_step_paint_keeps_the_step_record_cursor_contract(self):
  e=Engine();e.perform_set('seq','recording',True);p=copy.deepcopy(current_pattern(e.project.performance));e.note_edit(target(e,'pattern'),p,[event(i,duration=1) for i in range(4)]);self.assertEqual(e.rec_step,4);self.assertTrue(e.project.performance['seq']['recording'])
 def test_editor_created_song_notes_reach_native_pcm(self):
  e=Engine();e.note_edit(target(e),[],[event(0.,60,duration=1.)]);e.playing=True;a=e.render_stereo(4096);self.assertTrue(all(math.isfinite(x) for x in a));self.assertGreater(max(map(abs,a)),.01)
