import copy,math,unittest
from decksynth.core import Engine
from decksynth.keystep import current_pattern
class DraftPreview(unittest.TestCase):
 def args(self,e):
  return dict(kind='pattern',track=0,bank=1,slot=1,device=e.project.tracks[0].get('device','synth'),kit=copy.deepcopy(e.project.tracks[0].get('drum_rack'))),copy.deepcopy(current_pattern(e.project.performance))
 def draft(self,e,notes):
  t,p=self.args(e);d=copy.deepcopy(p)
  d['steps']=[[dict(note=n,velocity=100,tie=1)] if i in notes else [] for i,n in [(i,60+i%3) for i in range(d['length'])]]
  return t,d
 def test_draft_plays_on_loop_and_never_touches_the_project(self):
  e=Engine();before=copy.deepcopy(e.project.data());history=len(e.history);t,d=self.draft(e,{0,4,8,12})
  e.catalog_action('preview_draft',t,None,'euclid.draft',d)
  pcm=e.render_stereo(48000);self.assertGreater(max(map(abs,pcm)),.01);self.assertTrue(all(math.isfinite(x) for x in pcm))
  self.assertEqual(e.preview_status()['id'],'euclid.draft');self.assertEqual(e.project.data(),before);self.assertEqual(len(e.history),history)
 def test_a_new_draft_takes_over_in_place_and_keeps_the_timing(self):
  e=Engine();t,d=self.draft(e,{0,8});e.catalog_action('preview_draft',t,None,'euclid.draft',d);e.render_stereo(2048)
  origin=e._pattern_preview['origin'];t,d2=self.draft(e,{0,2,4,6,8,10,12,14});e.catalog_action('preview_draft',t,None,'euclid.draft',d2)
  self.assertEqual(e._pattern_preview['origin'],origin);self.assertEqual(e._pattern_preview['state']['patterns']['1:1'],d2)
  pcm=e.render_stereo(24000);self.assertGreater(max(map(abs,pcm)),.01)
 def test_stop_and_track_switch_end_it(self):
  e=Engine();t,d=self.draft(e,{0});e.catalog_action('preview_draft',t,None,'euclid.draft',d);e.catalog_action('stop',t,None,'')
  self.assertIsNone(e.preview_status())
  e.catalog_action('preview_draft',t,None,'euclid.draft',d);e.select(1);e.render_stereo(512);self.assertIsNone(e.preview_status())
 def test_refused_while_recording_muted_or_invalid_and_leaves_no_preview(self):
  e=Engine();t,d=self.draft(e,{0})
  bad=copy.deepcopy(d);bad['steps']=bad['steps'][:3]
  with self.assertRaises(ValueError):e.catalog_action('preview_draft',t,None,'euclid.draft',bad)
  e.project.tracks[0]['mute']=True
  with self.assertRaisesRegex(ValueError,'muted'):e.catalog_action('preview_draft',t,None,'euclid.draft',d)
  e.project.tracks[0]['mute']=False;e.record(0)
  with self.assertRaises(ValueError):e.catalog_action('preview_draft',t,None,'euclid.draft',d)
  self.assertIsNone(e.preview_status())
if __name__=='__main__':unittest.main()
