"""Audio gate sample-clock behavior, event ownership, lifecycle and legacy compatibility."""
import copy,hashlib,json,math,struct,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from decksynth import fx as fx_module
from decksynth.fx import TrackFx,default_chain,validate_chain,ORDER
from decksynth.core import Engine,Project


def chain(**params):
 c=default_chain();m=next(m for m in c['modules'] if m['id']=='gate');m['on']=True
 m['params'].update(length=0,division=2,steps=1,smooth=0.,depth=1.,pump=0.);m['params'].update(params)
 return validate_chain(c)

def fx(**params):
 f=TrackFx(48000);f.configure(chain(**params));return f


class SpectralS3(unittest.TestCase):
 def test_phase_and_open_time_change_actual_gain_windows(self):
  a=fx(phase=.5).process([1.]*4000,120,clock=0)
  self.assertLess(max(abs(x) for x in a[-1000:]),1e-6)
  b=fx(notelen=.25).process([1.]*5000,120,clock=0)
  self.assertGreater(min(b[900:1400]),.99);self.assertLess(max(b[2500:4500]),1e-6)

 def test_hold_freezes_rendered_fractional_cell_until_released(self):
  f=fx(phase=0.,hold=0);f.process([1.]*2000,120,clock=0);before=f.gate_runtime()
  c=chain(phase=0.,hold=1);f.configure(c);out=f.process([1.]*18000,120,clock=8)
  self.assertAlmostEqual(f.gate_runtime()['position'],before['position'],places=9)
  self.assertGreater(min(out[-1000:]),.99)
  f.configure(chain(phase=0.,hold=0));f.process([1.]*600,120,clock=.5)
  self.assertEqual(f.gate_runtime()['cell'],2)

 def test_retrigger_modes_are_sample_accurate_within_a_block(self):
  for retrig,empty,want in ((0,False,.2),(1,False,.4),(1,True,.2),(2,True,.4)):
   f=fx(retrig=retrig);f.retrigger(frame=4800,empty=empty)
   f.process([1.]*9600,120,clock=0.,frame=0)
   self.assertAlmostEqual(f.gate_runtime()['beat'],want,places=9,msg=(retrig,empty))

 def test_trigger_at_block_start_still_processes_the_whole_block(self):
  f=fx(retrig=0,notelen=0.);f.retrigger(frame=0)
  out=f.process([1.]*2000,120,frame=0)
  self.assertLess(max(out[-1000:]),1e-6)

 def test_engine_tracks_held_notes_sustain_retrigger_and_panic(self):
  e=Engine();e.set_fx(0,chain(retrig=1));e.midi(0x90,60,100);e.render(2400)
  e.midi(0x90,64,100);e.render(2400);self.assertAlmostEqual(e.fx[0].gate_runtime()['beat'],.2,places=8)
  e.midi(0xb0,64,127);e.midi(0x80,60,0);e.midi(0x80,64,0);e.render(1200)
  e.midi(0x90,67,100);e.render(1200);self.assertAlmostEqual(e.fx[0].gate_runtime()['beat'],.3,places=8)
  e.midi(0x80,67,0);e.midi(0xb0,64,0);e.midi(0x90,72,100);e.render(1200)
  self.assertAlmostEqual(e.fx[0].gate_runtime()['beat'],.05,places=8)
  e.stop();self.assertFalse(any(s.voices for s in e.synths));e.midi(0x90,60,100);e.render(1200)
  self.assertAlmostEqual(e.fx[0].gate_runtime()['beat'],.05,places=8)

 def test_200_identical_loops_keep_the_same_open_and_closed_windows(self):
  f=fx(phase=0.,retrig=2,notelen=1.,hold=0)
  for loop in range(200):
   out=f.process([1.]*48000,240,clock=loop*4.)
   self.assertGreater(min(out[500:2000]),.99,loop)
   self.assertLess(max(out[4500:5500]),1e-6,loop)
  self.assertTrue(all(map(math.isfinite,out)))

 def test_optional_validation_project_recall_and_disabled_gate_preserve_notes(self):
  e=Engine();before=copy.deepcopy(e.project.data());e.set_fx(0,chain(retrig=1,phase=.37,notelen=.4,hold=1))
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'s3.decksynth';e.project.save(p);q=Project.load(p)
   self.assertEqual(q.tracks,e.project.tracks);self.assertEqual(q.performance,before['performance']);self.assertEqual(q.song,before['song'])
  for key,value in (('phase',float('nan')),('phase',True),('notelen',float('inf')),('hold',2),('retrig',.5)):
   c=chain();next(m for m in c['modules'] if m['id']=='gate')['params'][key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):validate_chain(c)
  old=next(m for m in chain()['modules'] if m['id']=='gate')['params'];self.assertNotIn('phase',old)

 def test_retriggers_do_not_change_other_fx_even_with_gate_disabled(self):
  for enabled in (False,True):
   a=fx(retrig=0);b=fx(retrig=0)
   c=chain(retrig=0);next(m for m in c['modules'] if m['id']=='gate').update(on=enabled)
   next(m for m in c['modules'] if m['id']=='gate')['params']['steps']=65535
   volume=next(m for m in c['modules'] if m['id']=='volume');volume['on']=True
   for f in (a,b):f.configure(c);f.process([1.]*1024,120,frame=0)
   c=copy.deepcopy(c);next(m for m in c['modules'] if m['id']=='volume')['params']['level']=0.
   for f in (a,b):f.configure(c)
   b.retrigger(frame=1088);want=a.process([1.]*128,120,frame=1024);got=b.process([1.]*128,120,frame=1024)
   self.assertEqual(got,want,enabled)

 def test_retrigger_clock_integrates_tempo_changes_without_rewinding(self):
  f=fx(retrig=0);f.retrigger(frame=0);f.process([1.]*24000,120,frame=0)
  self.assertAlmostEqual(f.gate_runtime()['beat'],1.,places=9)
  f.process([1.]*128,60,frame=24000)
  self.assertAlmostEqual(f.gate_runtime()['beat'],1+128/48000,places=9)

 def test_no_notes_keeps_logical_synth_keys_after_voice_steal(self):
  e=Engine();e.set_fx(0,chain(retrig=1));e.voice_on(0,60,100,('live',0,60,60));e.render(2400)
  for i in range(23):e.voice_on(1,65+i,100,('held',i))
  e.voice_on(0,64,100,('live',0,64,64));e.render(128)
  self.assertAlmostEqual(e.fx[0].gate_runtime()['beat'],(2400+128)/24000,places=9)
 def test_no_notes_uses_drum_note_off_instead_of_one_shot_tails(self):
  import wave
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'one-shot.wav'
   with wave.open(str(p),'wb') as w:w.setparams((1,2,48000,48000,'NONE','not compressed'));w.writeframes(struct.pack('<h',3000)*48000)
   e=Engine();e.set_device(0,'drum_rack');kit=e.project.tracks[0]['drum_rack']['id'];e.import_drum_sample(0,kit,0,str(p));e.set_fx(0,chain(retrig=1))
   e.midi(0x90,36,100);e.render(2400);e.midi(0x80,36,0);self.assertGreater(e.drums[0].active_count,0)
   e.midi(0x90,36,100);e.render(128);self.assertAlmostEqual(e.fx[0].gate_runtime()['beat'],128/24000,places=9)

 def test_gate_lights_report_effective_modulated_division(self):
  f=fx(phase=0.);c=chain(phase=0.);c['macros'][0]['value']=1.
  c['macros'][0]['targets']=[dict(module='gate',param='division',depth=.5)];f.configure(c)
  f.process([1.]*128,120,clock=.2)
  self.assertEqual(f.gate_runtime()['cell'],1)

 def test_panic_discards_cancelled_gate_triggers(self):
  e=Engine();e.set_fx(0,chain(retrig=0));e.midi(0x90,60,100);e.render(2400)
  e.midi(0x90,64,100);e.panic();e.render(128)
  self.assertAlmostEqual(e.fx[0].gate_runtime()['beat'],(2400+128)/24000,places=9)

 def test_legacy_fx_pcm_is_sample_identical(self):
  gold=json.loads((Path(__file__).parent/'fixtures/spectral_s3_legacy_fx_pcm.json').read_text())
  for row in gold:
   f=TrackFx(48000);c=default_chain();next(m for m in c['modules'] if m['id']==row['module'])['on']=True;f.configure(c);out=[]
   for block in range(20):out+=f.process([.08*math.sin((block*128+i)*2*math.pi*220/48000) for i in range(128)],120,clock=block*128/24000)
   digest=hashlib.sha256(struct.pack('<'+str(len(out))+'d',*out)).hexdigest()
   if digest==row['sha256']:continue
   # Another C library (CI's older glibc) rounds pow/sin/tanh in the last bit, so the hash can't match
   # there. Then the PCM must still match the Deck's to far below audibility (native parity is 1e-9).
   ref=samples()[row['module']]
   self.assertEqual(len(out),len(ref),row['module'])
   self.assertLess(max(abs(x-y) for x,y in zip(out,ref)),1e-9,row['module'])

_SAMPLES=None
def samples():
 """The Deck's PCM for each legacy FX module (12 significant digits), for platforms whose libm rounds differently."""
 global _SAMPLES
 if _SAMPLES is None:
  import gzip
  _SAMPLES=json.loads(gzip.decompress((Path(__file__).parent/'fixtures/spectral_s3_legacy_fx_pcm_samples.json.gz').read_bytes()))
 return _SAMPLES

if __name__=='__main__':unittest.main()
