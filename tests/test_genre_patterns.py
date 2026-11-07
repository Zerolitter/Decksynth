import copy,json,math,tempfile,unittest,wave,struct
from pathlib import Path
from decksynth.core import Engine,Project
from decksynth.keystep import current_pattern,validate_pattern
from decksynth.library import factory_bank
from decksynth.genre_patterns import catalog,template,resolve_pattern
class GenrePatterns(unittest.TestCase):
 def test_64_unique_playable_genres_preserve_64_originals(self):
  data=catalog();new=[p for p in data if p['id'].startswith('genre.')];self.assertEqual(len(new),64);self.assertEqual(len(data),128)
  self.assertEqual({g:sum(p['genre']==g for p in new) for g in ['EDM','House','Techno','Drum & Bass']},{g:16 for g in ['EDM','House','Techno','Drum & Bass']})
  signatures=set()
  for p in new:
   validate_pattern(p['pattern']);self.assertTrue(any(p['pattern']['steps']));self.assertTrue(all(36<=n['note']<=51 for s in p['pattern']['steps'] for n in s));signatures.add(json.dumps(p['pattern']['steps'],sort_keys=True))
  self.assertEqual(len(signatures),64)
  for b in range(1,5):
   for i,p in enumerate(factory_bank(b).values()):self.assertEqual(template(f'existing.{b}.{i+1:02}')['pattern'],p)
 def kit(self):
  e=Engine();e.set_device(0,'drum_rack');tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);f=Path(tmp.name)/'test.wav'
  with wave.open(str(f),'wb') as w:w.setparams((1,2,48000,24000,'NONE',''));w.writeframes(b''.join(struct.pack('<h',round(5000*math.cos(i*.08))) for i in range(24000)))
  kit=e.project.tracks[0]['drum_rack']
  for pad in [0,2,3,6,7]:
   e.import_drum_sample(0,kit['id'],pad,str(f));kit['pads'][pad]['name']=__import__('decksynth.drum_rack',fromlist=['NAMES']).NAMES[pad]
  return e
 def args(self,e):return dict(kind='pattern',track=0,bank=1,slot=1,device=e.project.tracks[0].get('device','synth'),kit=copy.deepcopy(e.project.tracks[0].get('drum_rack'))),copy.deepcopy(current_pattern(e.project.performance))
 def test_missing_kit_and_wrong_device_are_explicit_and_atomic(self):
  e=Engine();t,p=self.args(e);before=copy.deepcopy(e.project.data())
  with self.assertRaisesRegex(ValueError,'Drum Rack'):e.catalog_action('preview',t,p,'genre.edm.01')
  self.assertEqual(e.project.data(),before);e.set_device(0,'drum_rack');t,p=self.args(e)
  with self.assertRaisesRegex(ValueError,'missing|Missing'):e.catalog_action('load',t,p,'genre.edm.01')
 def test_preview_uses_native_pcm_without_project_history_or_recording(self):
  e=self.kit();t,p=self.args(e);before=copy.deepcopy(e.project.data());history=len(e.history);e.catalog_action('preview',t,p,'genre.edm.01');pcm=e.render_stereo(24000);self.assertGreater(max(map(abs,pcm)),.01);self.assertTrue(all(math.isfinite(x) for x in pcm));self.assertEqual(e.project.data(),before);self.assertEqual(len(e.history),history);self.assertEqual(e.pending,{});self.assertFalse(e.playing);self.assertIsNotNone(e.preview_status());e.catalog_action('stop',t,p,'genre.edm.01');e.render(1000);self.assertIsNone(e.preview_status())
 def test_load_one_slot_one_undo_and_project_recall(self):
  e=self.kit();t,p=self.args(e);before=copy.deepcopy(e.project.data());history=len(e.history);e.catalog_action('load',t,p,'genre.edm.01');self.assertEqual(len(e.history),history+1);self.assertTrue(any(current_pattern(e.project.performance)['steps']));self.assertEqual(e.project.bpm,before['bpm']);self.assertEqual(e.project.tracks,before['tracks'])
  with tempfile.TemporaryDirectory() as d:
   f=Path(d)/'g.decksynth';e.project.save(f);self.assertEqual(Project.load(f).performance,e.project.performance)
  e.undo();self.assertEqual(e.project.performance,before['performance'])
 def test_preview_stops_on_track_switch_and_recording_never_captures(self):
  e=self.kit();t,p=self.args(e);e.catalog_action('preview',t,p,'genre.edm.01');e.select(1);self.assertIsNone(e.preview_status());e.select(0);e.record(0)
  with self.assertRaises(ValueError):e.catalog_action('preview',t,p,'genre.edm.01')
 def test_foreign_stale_pattern_and_kit_reject_before_mutation(self):
  for change in ['track','pattern','kit']:
   e=self.kit();t,p=self.args(e)
   if change=='track':e.select(1)
   elif change=='pattern':e.perform_set('seq','length',32)
   else:e.project.tracks[0]['drum_rack']['pads'][0]['mute']=True
   before=copy.deepcopy(e.project.data())
   with self.assertRaises(ValueError):e.catalog_action('load',t,p,'genre.edm.01')
   self.assertEqual(e.project.data(),before)
 def test_actual_kit_roles_resolve_reordered_pads_without_renaming(self):
  e=self.kit();kit=e.project.tracks[0]['drum_rack'];kit['pads'][0]['name']='Snare';kit['pads'][2]['name']='Kick';p=resolve_pattern(template('genre.edm.01'),e.project.tracks[0],e.drums[0]);self.assertTrue(any(n['note']==38 for n in p['steps'][0]));self.assertEqual(kit['pads'][0]['name'],'Snare')

 def test_muted_track_cannot_claim_audible_preview(self):
  e=self.kit();e.project.tracks[0]['mute']=True;t,p=self.args(e)
  with self.assertRaisesRegex(ValueError,'muted'):e.catalog_action('preview',t,p,'genre.edm.01')
 def test_stopping_drum_preview_preserves_live_one_shot_owner(self):
  e=self.kit();t,p=self.args(e);e.voice_on(0,36,100,('live',0,36,36));e.catalog_action('preview',t,p,'genre.edm.01');e.render(128);self.assertEqual(e.drums[0].active_count,2);e.stop_pattern_preview();e.render(1000);self.assertEqual(e.drums[0].active_count,1);self.assertIn(('live',0,36,36),e.drum_gate_keys[0])
 def test_synth_preview_preserves_live_voices_and_uses_real_native_pcm(self):
  e=Engine();t,p=self.args(e);e.voice_on(0,60,100,('live',0,60,60));e.catalog_action('preview',t,p,'existing.1.01');pcm=e.render_stereo(2048);self.assertGreater(max(map(abs,pcm)),.01);self.assertTrue(any(isinstance(k,tuple) and k[0]=='preview' for k in e.synths[0].gated));e.stop_pattern_preview();self.assertIn(('live',0,60,60),e.synths[0].gated);self.assertFalse(any(isinstance(k,tuple) and k[0]=='preview' for k in e.synths[0].gated))

 def test_all_64_templates_reach_native_drum_pcm_with_all_roles(self):
  e=self.kit();kit=e.project.tracks[0]['drum_rack'];source=kit['pads'][0]['source']['path']
  for pad in [4,5,9,14]:e.import_drum_sample(0,kit['id'],pad,source)
  for item in catalog()[:64]:
   t,p=self.args(e);e.catalog_action('preview',t,p,item['id']);pcm=e.render_stereo(512);self.assertGreater(max(map(abs,pcm)),.001,item['id']);e.stop_pattern_preview();e.render(512)
