"""Expression controls: actual MIDI writes, note ownership, audible timbre/pitch and legacy recall."""
import copy,json,math,tempfile,unittest
from pathlib import Path
from decksynth import core
from decksynth.core import Engine,Synth,Project,cutoff_hz
from tests.test_voice_cards import power


def synth(**params):
 s=Synth();s.configure({**s.params,'attack':.001,'decay':.001,'sustain':1.,'release':.1,'modulation':0.,**params});return s

def lead(s):return [v for v in s.voices.values() if not v.get('fast') and v.get('release') is None]

class SpectralS4(unittest.TestCase):
 def test_registry_learn_default74_channel_and_reserved_controls(self):
  from decksynth.controllers import registry
  self.assertIn('sound.pitch',registry());self.assertIn('gate.phase',registry());self.assertIn('macro.2',registry())
  e=Engine();before=copy.deepcopy(e.project.data());e.midi(0xb0,74,127)
  self.assertEqual(e.project.tracks[0]['instrument']['vcf_cutoff'],1.)
  e.learn_cc(0,'sound','fenv_a');e.midi(0xb0,64,127);self.assertTrue(e.synths[0].sustain)
  self.assertNotIn('midi_cc',e.project.tracks[0]);e.midi(0xb0,21,127)
  ins=e.project.tracks[0]['instrument'];self.assertEqual(ins['fenv_a'],3.)
  for k,amp in [('fenv_d','decay'),('fenv_s','sustain'),('fenv_r','release')]:self.assertEqual(ins[k],ins[amp])
  e.midi(0xb1,21,0);self.assertEqual(ins['fenv_a'],3.,'learned channel owns the binding')
  e.midi(0xb0,21,0);self.assertEqual(ins['fenv_a'],.001)
  self.assertEqual(e.project.song,before['song']);self.assertEqual(e.project.performance,before['performance'])
  e.select(1)
  with self.assertRaises(ValueError):e.learn_cc(0,'sound','pitch')
  e.learn_cc(1,'sound','pitch');e.select(0);self.assertIsNone(e.midi_learn)

 def test_custom_cutoff_binding_replaces_default74_until_unlearned(self):
  e=Engine();e.learn_cc(0,'sound','vcf_cutoff');e.midi(0xb0,21,127);e.midi(0xb0,74,0)
  self.assertEqual(e.project.tracks[0]['instrument']['vcf_cutoff'],1.)
  e.unlearn_cc(0,'sound','vcf_cutoff');e.midi(0xb0,74,0)
  self.assertEqual(e.project.tracks[0]['instrument']['vcf_cutoff'],0.)

 def test_bipolar_pitch_controller_has_exact_neutral_at_cc64(self):
  e=Engine();e.learn_cc(0,'sound','pitch');e.midi(0xb0,21,64)
  self.assertEqual(e.project.tracks[0]['instrument']['pitch'],0.)
  e.midi(0xb0,21,0);self.assertEqual(e.project.tracks[0]['instrument']['pitch'],-12.)
  e.midi(0xb0,21,127);self.assertEqual(e.project.tracks[0]['instrument']['pitch'],12.)

 def test_learned_fx_and_macro_persist_without_entering_preset_or_notes(self):
  e=Engine();notes=copy.deepcopy([t['notes'] for t in e.project.tracks]);e.learn_cc(0,'gate','phase');e.midi(0xb0,22,64)
  self.assertAlmostEqual(next(m for m in e.project.tracks[0]['fx']['modules'] if m['id']=='gate')['params']['phase'],64/127)
  e.learn_cc(0,'macro','2');e.midi(0xb0,23,127);self.assertEqual(e.project.tracks[0]['fx']['macros'][2]['value'],1.)
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'s4.decksynth';e.project.save(p);q=Project.load(p);self.assertEqual(q.tracks,e.project.tracks)
   bad=q.data();bad['tracks'][0]['midi_cc'][0]['param']='unknown';p.write_text(json.dumps(bad))
   with self.assertRaises(ValueError):Project.load(p)
  self.assertNotIn('midi_cc',e.project.tracks[0]['instrument']);self.assertEqual([t['notes'] for t in e.project.tracks],notes)

 def test_mono_returns_last_held_note_and_legato_preserves_envelope_age(self):
  for mode in (1,2):
   s=synth(play_mode=mode);s.on(60,100);s.render(2400);age=lead(s)[0]['age'];s.on(64,90)
   self.assertEqual(len(lead(s)),1);self.assertEqual(lead(s)[0]['note'],64)
   self.assertEqual(lead(s)[0]['age'],age if mode==2 else 0)
   s.off(64);self.assertEqual(lead(s)[0]['note'],60);s.off(60);s.render(6000);self.assertFalse(s.voices);self.assertFalse(s.gated)

 def test_mono_repeated_note_sustain_and_panic_never_stick(self):
  s=synth(play_mode=2);s.on(60,100,('key',0));s.on(60,110,('key',1));s.off(60,('key',0));self.assertEqual(len(lead(s)),1)
  s.pedal(True);s.off(60,('key',1));self.assertEqual(len(lead(s)),1);s.pedal(False);s.render(6000);self.assertFalse(s.voices)
  for note in range(48,76):s.on(note,100)
  s.panic();self.assertFalse(s.voices);self.assertFalse(s.gated)

 def test_glide_runs_on_the_sample_clock_and_reaches_the_target(self):
  s=synth(play_mode=2,glide=.1);s.on(60,100);s.render(2000);s.on(72,100);s.render(2400)
  self.assertAlmostEqual(lead(s)[0]['current_note'],66.,places=6)
  s.render(2400);self.assertAlmostEqual(lead(s)[0]['current_note'],72.,places=6)
  s.off(72);s.render(4800);self.assertAlmostEqual(lead(s)[0]['current_note'],60.,places=6)

 def test_glide_modulation_sets_effective_time_without_editing_saved_sound(self):
  s=synth(play_mode=2,glide=.1);s.on(60,100);s.render(2400);s.modulate({'glide':.1});s.on(72,100);s.render(4800)
  self.assertAlmostEqual(lead(s)[0]['current_note'],66.,places=6);self.assertEqual(s.params['glide'],.1)

 def test_velocity_routes_and_key_tracking_change_timbre_without_editing_partials(self):
  for route in ('velocity_brightness','velocity_cutoff'):
   outputs=[]
   for velocity in (30,110):
    s=synth(**{route:1.},harmonics=[1.]*16,filter=.5,vcf_type=1 if route.endswith('cutoff') else 0,vcf_cutoff=.45,vcf_env=0.)
    h=list(s.params['harmonics']);s.on(57,velocity);a=s.render(24000);outputs.append(power(a,1760)/power(a,220));self.assertEqual(h,s.params['harmonics'])
   self.assertGreater(outputs[1],outputs[0]*10,route)
  p={'vcf_cutoff':.5,'vcf_keytrack':0.};self.assertEqual(cutoff_hz(p,36),cutoff_hz(p,84))
  self.assertAlmostEqual(cutoff_hz({**p,'vcf_keytrack':1.},72)/cutoff_hz(p,60),2.)

 def test_pitch_destination_is_audible_and_high_partials_do_not_alias(self):
  s=synth(harmonics=[1.]+[0.]*15,pitch=0.);s.modulate({'pitch':3.});s.on(57,100);a=s.render(24000)
  self.assertGreater(power(a,220*2**(.25)),power(a,220)*100)
  s=synth(harmonics=[1.]*16,filter=1.,pitch=12.);s.on(96,100);a=s.render(24000);freq=440*2**((108-69)/12)
  self.assertLess(power(a,48000-7*freq),power(a,freq)*.001)

 def test_track_change_cancels_hidden_mono_owners_without_phantom_notes(self):
  for mode in (1,2):
   e=Engine();e.project.tracks[0]['instrument']['play_mode']=mode;e.configure()
   e.midi(0x90,60,100);e.render(256);e.select(1);e.select(0);e.midi(0x80,60,0)
   e.midi(0x90,67,100);e.midi(0x80,67,0);e.render(48000)
   self.assertFalse(e.synths[0].voices,mode);self.assertFalse(e.synths[0].mono_held,mode)

 def test_loop_and_clip_cleanup_remove_suppressed_mono_notes(self):
  for mode in (1,2):
   for cancel in ('release','clip'):
    e=Engine();e.project.tracks[0]['instrument']['play_mode']=mode;e.configure()
    e.voice_on(0,60,100,('loop',0,0));e.voice_on(0,64,100,('loop',1,0));e.render(256)
    if cancel=='release':e.release_loops()
    else:e.clip_action(0,'open',1)
    e.midi(0x90,67,100);e.midi(0x80,67,0);e.render(48000)
    self.assertFalse(e.synths[0].voices,(mode,cancel));self.assertFalse(e.synths[0].mono_held,(mode,cancel))

 def test_cancelling_live_mono_sources_returns_to_a_valid_song_note(self):
  e=Engine();e.project.tracks[0]['instrument']['play_mode']=2;e.configure()
  e.voice_on(0,60,100,('loop',0,0));e.render(256);e.midi(0x90,67,100);e.select(1)
  self.assertEqual([v['note'] for v in lead(e.synths[0])],[60])
  e.voice_off(0,60,('loop',0,0));e.render(48000);self.assertFalse(e.synths[0].voices)

 def test_heard_partials_follow_the_actual_latest_voice_velocity(self):
  e=Engine();e.project.tracks[0]['instrument'].update(harmonics=[1.]*16,filter=.5,velocity_brightness=1.,modulation=0.)
  e.configure();e.voice_on(0,57,30,('quiet',0));e.render(256)
  quiet=e.fx_live(0).get('partials');self.assertIsNotNone(quiet)
  self.assertAlmostEqual(quiet[7],.000319,places=6)  # 17 Nov: Vel bright also tilts the spectrum
  e.voice_on(0,57,110,('loud',0));e.render(256);loud=e.fx_live(0)['partials']
  self.assertAlmostEqual(loud[7],.826341,places=6);self.assertEqual(e.project.tracks[0]['instrument']['harmonics'],[1.]*16)

 def test_new_optional_fields_reject_invalid_values_without_legacy_migration(self):
  fields={'play_mode':1,'glide':.3,'pitch':3.,'velocity_brightness':.2,'velocity_cutoff':.3,'vcf_keytrack':.7}
  p=Project();p.tracks[0]['instrument'].update(fields)
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'s4.decksynth';p.save(path);self.assertEqual(Project.load(path).tracks,p.tracks)
   for key,value in ((k,v) for k in fields for v in (True,float('nan'),99)):
    bad=copy.deepcopy(p.data());bad['tracks'][0]['instrument'][key]=value;path.write_text(json.dumps(bad))
    with self.subTest(key=key,value=value),self.assertRaises(ValueError):Project.load(path)

if __name__=='__main__':unittest.main()
