"""Stereo source-clock bus, native effects, mono compatibility and real device/export layout."""
import copy,math,os,struct,tempfile,unittest,wave
from pathlib import Path
from decksynth.core import Engine,Project
from decksynth.fx import TrackFx,default_chain,validate_chain

class SpectralS5(unittest.TestCase):
 def engine(self):
  e=Engine();e.voice_on(0,60,100,('test',0));return e
 def test_center_sum_preserves_mono_pcm_and_scheduler(self):
  a=self.engine();b=self.engine();mono=a.render(4096);st=b.render_stereo(4096)
  self.assertEqual(len(st),8192);self.assertEqual([l+r for l,r in zip(st[::2],st[1::2])],mono)
  self.assertEqual(a.absolute_frame,b.absolute_frame)
 def test_pan_endpoints_and_modulation_are_real_pcm(self):
  for pan,side in [(-1,0),(1,1)]:
   e=self.engine();e.project.tracks[0]['instrument']['pan']=pan;e.configure();a=e.render_stereo(2048)
   self.assertGreater(max(map(abs,a[side::2])),.01);self.assertEqual(max(map(abs,a[1-side::2])),0.)
  e=self.engine();c=default_chain();c['macros'][0].update(value=1.,targets=[dict(module='sound',param='pan',depth=.5)]);e.set_fx(0,c)
  a=e.render_stereo(1024);self.assertEqual(max(map(abs,a[::2])),0.)
 def test_default_effects_have_exact_mono_sum(self):
  for module in ('chorus','delay','reverb','gate'):
   c=default_chain();next(m for m in c['modules'] if m['id']==module)['on']=True
   a=TrackFx(48000);a.configure(c);b=TrackFx(48000);b.configure(c)
   x=[.2*math.sin(i*.1) for i in range(2048)]
   mono=a.process(x,120);st=b.process_stereo(x,120)
   self.assertEqual(mono,st[0],module);self.assertEqual(mono,st[1],module)
 def test_stereo_effects_produce_distinct_finite_channels(self):
  for module,key,value in [('chorus','width',1.),('chorus','haas',.02),('delay','width',1.),('reverb','width',1.),('cloud','scatter',.7)]:
   c=default_chain();m=next(m for m in c['modules'] if m['id']==module);m['on']=True;m['params'][key]=value
   f=TrackFx(48000);f.configure(c);l=[];r=[]
   for start in range(0,24000,128):
    a,b=f.process_stereo([.15*math.sin((start+i)*.09) if start<12000 else 0. for i in range(128)],120,frame=start);l+=a;r+=b
   self.assertTrue(all(math.isfinite(x) for x in l+r),module);self.assertGreater(sum(abs(a-b) for a,b in zip(l,r)),.01,(module,key))
 def test_pingpong_echo_alternates_without_mono_gain(self):
  c=default_chain();m=next(m for m in c['modules'] if m['id']=='delay');m['on']=True;m['params'].update(time=0,feedback=.5,mix=1.,width=1.)
  f=TrackFx(48000);f.configure(c);f.process_stereo([0.]*1024,120);l=[];r=[]
  for k in range(0,10000,128):
   a,b=f.process_stereo([1. if k+i==0 else 0. for i in range(128)],120);l+=a;r+=b
  self.assertAlmostEqual(l[3000],2.);self.assertEqual(r[3000],0.);self.assertAlmostEqual(r[6000],1.);self.assertEqual(l[6000],0.)
 def test_stereo_master_limits_channels_and_sum(self):
  e=Engine()
  for t in range(4):
   for n in range(48,64):e.voice_on(t,n,127,('load',t,n))
  a=e.render_stereo(12000);self.assertLessEqual(max(map(abs,a)),.95);self.assertLessEqual(max(abs(l+r) for l,r in zip(a[::2],a[1::2])),.95)
 def test_project_recall_and_stereo_wav_export(self):
  e=self.engine();e.project.tracks[0]['instrument']['pan']=-1.;e.project.tracks[0]['notes']=[dict(start=0.,duration=.25,note=60,velocity=100)]
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'s5.decksynth';e.project.save(p);self.assertEqual(Project.load(p).tracks,e.project.tracks)
   out=Path(d)/'s5.wav';e.export_wav(out,.5)
   with wave.open(str(out)) as w:
    self.assertEqual(w.getnchannels(),2);self.assertEqual(w.getnframes(),24000);self.assertEqual(w.getframerate(),48000)
 def test_drum_oneshot_uses_the_same_panned_stereo_bus(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'generated.wav'
   with wave.open(str(p),'wb') as w:w.setparams((1,2,48000,0,'NONE','PCM'));w.writeframes(struct.pack('<1024h',*[5000]*1024))
   e=Engine();e.set_device(0,'drum_rack');e.import_drum_sample(0,e.project.tracks[0]['drum_rack']['id'],0,str(p))
   e.project.tracks[0]['instrument']['pan']=1.;e.midi(0x90,36,100);a=e.render_stereo(512)
   self.assertEqual(max(map(abs,a[::2])),0.);self.assertGreater(max(map(abs,a[1::2])),.01)
 def test_sdl_queue_counts_stereo_frames(self):
  from decksynth.backend import Audio
  previous=os.environ.get('SDL_AUDIODRIVER');os.environ['SDL_AUDIODRIVER']='dummy'
  try:
   a=Audio('System default');self.assertEqual(a.channels,2);a.write([0.]*512);self.assertEqual(a.queued(),256);a.close()
  finally:
   if previous is None:os.environ.pop('SDL_AUDIODRIVER',None)
   else:os.environ['SDL_AUDIODRIVER']=previous
