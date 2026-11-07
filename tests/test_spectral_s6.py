"""Workflow isolation, parameter transaction ownership and source-clock automation."""
import copy,json,tempfile,unittest
from pathlib import Path
from decksynth.core import Engine,Project
from decksynth.fx import default_chain
class SpectralS6(unittest.TestCase):
 def test_ab_preserves_two_patch_sounds_and_notes_routes_and_other_tracks(self):
  e=Engine();before=copy.deepcopy(e.project.data());e.ab_action(0,'B');e.apply_control(0,'sound','filter',.1);b=e.project.tracks[0]['instrument']['filter'];e.ab_action(0,'A')
  self.assertEqual(e.project.tracks[0]['instrument'],before['tracks'][0]['instrument']);e.ab_action(0,'B');self.assertEqual(e.project.tracks[0]['instrument']['filter'],b)
  e.ab_action(0,'copy');e.ab_action(0,'A');self.assertEqual(e.project.tracks[0]['instrument']['filter'],b)
  self.assertEqual(e.project.tracks[1:],before['tracks'][1:]);self.assertEqual(e.project.song,before['song']);self.assertEqual(e.project.performance,before['performance']);self.assertEqual(e.project.tracks[0]['notes'],before['tracks'][0]['notes'])
 def test_ab_recall_and_invalid_patch_are_validated(self):
  e=Engine();e.ab_action(0,'B');e.apply_control(0,'sound','pan',1.)
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'s6.decksynth';e.project.save(p);q=Project.load(p);self.assertEqual(q.tracks,e.project.tracks)
   bad=q.data();bad['tracks'][0]['sound_ab']['A']['instrument']['attack']=-1;p.write_text(json.dumps(bad))
   with self.assertRaises(ValueError):Project.load(p)
 def test_one_gesture_is_one_dedicated_undo_without_touching_notes(self):
  e=Engine();before=copy.deepcopy(e.project.tracks[0]['instrument']);e.sound_gesture(0,'sound','filter','begin')
  for value in (.1,.2,.3):e.apply_control(0,'sound','filter',value)
  e.sound_gesture(0,'sound','filter','end');self.assertEqual(e.sound_undo_counts()[0],1)
  e.project.tracks[0]['notes'].append(dict(start=0.,duration=1.,note=60,velocity=100));e.sound_undo(0)
  self.assertEqual(e.project.tracks[0]['instrument'],before);self.assertEqual(len(e.project.tracks[0]['notes']),1);self.assertFalse(e.history)
 def test_cancel_and_stale_track_do_not_commit_or_clobber_other_edits(self):
  e=Engine();before=copy.deepcopy(e.project.tracks[0]['instrument']);e.sound_gesture(0,'sound','pitch','begin');e.apply_control(0,'sound','pitch',1.);e.apply_control(0,'sound','filter',.2);brightness=e.project.tracks[0]['instrument']['filter'];e.sound_gesture(0,'sound','pitch','cancel')
  self.assertNotIn('pitch',e.project.tracks[0]['instrument']);self.assertEqual(e.project.tracks[0]['instrument']['filter'],brightness);self.assertEqual(e.sound_undo_counts()[0],0)
  e.sound_gesture(0,'sound','pitch','begin');e.apply_control(0,'sound','pitch',1.);e.select(1)
  self.assertNotIn('pitch',e.project.tracks[0]['instrument'])
  with self.assertRaises(ValueError):e.sound_gesture(0,'sound','pitch','end')
 def test_gesture_undo_restores_inherited_filter_stages(self):
  e=Engine();e.sound_gesture(0,'sound','fenv_a','begin');e.apply_control(0,'sound','fenv_a',.5);e.sound_gesture(0,'sound','fenv_a','end');e.sound_undo(0)
  self.assertFalse(any(k.startswith('fenv_') for k in e.project.tracks[0]['instrument']))
 def test_record_requires_rec_and_automation_arm_keeps_midi_separate(self):
  e=Engine();e.apply_control(0,'sound','filter',.1);self.assertNotIn('automation',e.project.tracks[0]);e.automation_arm=True;e.apply_control(0,'sound','filter',.2);self.assertNotIn('automation',e.project.tracks[0])
  e.record(0);e.apply_control(0,'sound','filter',.3);e.render(1200);e.apply_control(0,'sound','filter',.7);e.finish_record()
  lane=e.project.tracks[0]['automation'][0];self.assertEqual((lane['module'],lane['param']),('sound','filter'));self.assertEqual(len(lane['points']),2);self.assertEqual(e.project.tracks[0]['notes'],[])
 def test_playback_uses_existing_clock_and_preserves_saved_base(self):
  e=Engine();e.set_automation(0,[dict(module='sound',param='pan',points=[[0.,0.],[1.,1.]])]);base=copy.deepcopy(e.project.tracks[0]['instrument']);e.playing=True;e.frame=12000;e.render_stereo(128)
  self.assertAlmostEqual(e.fx_live(0)['sound']['pan'],0.,places=3);self.assertEqual(e.project.tracks[0]['instrument'],base);self.assertEqual(e.absolute_frame,128)
  e.frame=24000;e.render_stereo(128);self.assertGreater(e.fx_live(0)['sound']['pan'],.99);e.stop();e.render_stereo(128);self.assertNotIn('pan',e.fx_live(0)['sound'])
 def test_automation_recall_disarms_and_rejects_unknown_unsorted_nonfinite(self):
  e=Engine();e.set_automation(0,[dict(module='sound',param='filter',points=[[0.,.2],[1.,.8]])])
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'s6.decksynth';e.project.save(p);self.assertEqual(Project.load(p).tracks,e.project.tracks)
   for lane in [dict(module='unknown',param='x',points=[[0,.2]]),dict(module='sound',param='filter',points=[[1,.2],[0,.3]]),dict(module='sound',param='filter',points=[[0,float('nan')]])]:
    bad=e.project.data();bad['tracks'][0]['automation']=[lane];p.write_text(json.dumps(bad))
    with self.assertRaises(ValueError):Project.load(p)
