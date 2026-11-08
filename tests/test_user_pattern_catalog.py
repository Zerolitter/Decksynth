import unittest,copy,tempfile
from pathlib import Path
from decksynth.core import Engine,Project
from decksynth.keystep import current_pattern,empty_pattern
class UserPatternCatalog(unittest.TestCase):
 def setup_catalog(self):
  e=Engine();source=empty_pattern();source['steps'][0]=[dict(note=60,velocity=91,tie=2)];e.project.performance['patterns']['2:3']=source
  target=dict(kind='pattern',track=0,bank=1,slot=1,device='synth',kit=None)
  return e,target,copy.deepcopy(current_pattern(e.project.performance)),copy.deepcopy(source)
 def test_user_preview_native_pcm_never_writes_project_history_or_source(self):
  e,t,p,source=self.setup_catalog();before=copy.deepcopy(e.project.data());history=len(e.history)
  e.catalog_action('preview_user',t,p,'user.2.3',source);pcm=e.render_stereo(4096)
  self.assertGreater(max(map(abs,pcm)),.001);self.assertEqual(e.project.data(),before);self.assertEqual(len(e.history),history);self.assertEqual(e.preview_status()['id'],'user.2.3')
  e.stop_pattern_preview();self.assertFalse(any(isinstance(k,tuple) and k[0]=='preview' for k in e.synths[0].gated))
 def test_copy_user_slot_changes_only_destination_oneundo_and_reopens(self):
  e,t,p,source=self.setup_catalog();before=copy.deepcopy(e.project.data());history=len(e.history)
  e.catalog_action('load_user',t,p,'user.2.3',source);self.assertEqual(len(e.history),history+1);self.assertEqual(e.project.performance['patterns']['1:1'],source);self.assertEqual(e.project.performance['patterns']['2:3'],source)
  with tempfile.TemporaryDirectory() as d:
   f=Path(d)/'p.decksynth';e.project.save(f);self.assertEqual(Project.load(f).performance,e.project.performance)
  e.undo();self.assertEqual(e.project.performance,before['performance']);self.assertEqual(e.project.tracks,before['tracks'])
 def test_stale_foreign_or_missing_source_rejects_without_mutation(self):
  for change in ['source','target','missing']:
   e,t,p,source=self.setup_catalog()
   if change=='source':e.project.performance['patterns']['2:3']['steps'][0][0]['velocity']=92
   elif change=='target':e.select(1)
   else:del e.project.performance['patterns']['2:3']
   before=copy.deepcopy(e.project.data());history=len(e.history)
   with self.assertRaises(ValueError):e.catalog_action('load_user',t,p,'user.2.3',source)
   self.assertEqual(e.project.data(),before);self.assertEqual(len(e.history),history)
 def test_source_change_stops_its_preview(self):
  e,t,p,source=self.setup_catalog();e.catalog_action('preview_user',t,p,'user.2.3',source);e.project.performance['patterns']['2:3']['steps'][0]=[];e.render_stereo(128);self.assertIsNone(e.preview_status())
