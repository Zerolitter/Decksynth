"""Stereo source-clock bus, native effects, mono compatibility and real device/export layout."""
import copy,math,os,struct,tempfile,unittest,wave
from pathlib import Path
from decksynth.core import Engine,Project
from decksynth.fx import TrackFx,default_chain,validate_chain

class SpectralS5(unittest.TestCase):
 def engine(self):
  e=Engine();e.voice_on(0,60,100,('test',0));return e
 def test_center_sum_preserves_mono_pcm_and_scheduler(self):
  a=self.engine();b=self.engine();b.master_enabled=False  # the raw mix: the master stage is tested on its own
  mono=a.render(4096);st=b.render_stereo(4096)
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
  a=e.render_stereo(12000)
  if e.master.available:
   # the C master stage: no sample past its -1 dBTP ceiling, and it really is that loud (no headroom thrown away)
   self.assertLessEqual(max(map(abs,a)),10**(-1/20)+1e-12);self.assertGreater(max(map(abs,a)),.8)
  else:self.assertLessEqual(max(map(abs,a)),.95);self.assertLessEqual(max(abs(l+r) for l,r in zip(a[::2],a[1::2])),.95)
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
 def test_stereo_export_rehydrates_drums_and_rejects_missing_assets(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'generated.wav'
   with wave.open(str(p),'wb') as w:w.setparams((1,2,48000,0,'NONE','PCM'));w.writeframes(struct.pack('<1024h',*[5000]*1024))
   e=Engine();e.set_device(0,'drum_rack');e.import_drum_sample(0,e.project.tracks[0]['drum_rack']['id'],0,str(p))
   e.project.tracks[0]['notes']=[dict(start=0.,duration=.25,note=36,velocity=100)];out=Path(d)/'out.wav';e.export_wav(out,.1)
   with wave.open(str(out)) as w:a=struct.unpack('<'+str(w.getnframes()*2)+'h',w.readframes(w.getnframes()))
   self.assertGreater(max(map(abs,a)),100)
   p.unlink()
   with self.assertRaisesRegex(ValueError,'missing|Missing|unavailable'):e.export_wav(out,.1)
 def test_cloud_clock_never_jumps_when_individual_tap_phases_wrap(self):
  c=default_chain();m=next(m for m in c['modules'] if m['id']=='cloud');m['on']=True;m['params'].update(time=.1,density=1.,scatter=1.,feedback=0.,tone=1.,mix=1.)
  f=TrackFx(48000);f.configure(c);out=[]
  for start in range(0,131072,128):out+=f.process_stereo([.2*math.sin(2*math.pi*440*(start+i)/48000) for i in range(128)],120)[0]
  self.assertLess(max(abs(a-b) for a,b in zip(out[10000:],out[10001:])),.02)
 def test_pan_changes_slew_without_channel_steps(self):
  from unittest.mock import patch
  e=Engine();e.master_enabled=False;e.project.tracks[0]['volume']=1.;e.project.tracks[0]['instrument']['pan']=-1.
  from decksynth import cbus
  with patch.object(e.synths[0],'render',side_effect=lambda n:[.2]*n),\
       patch.object(e.synths[0],'render_into',side_effect=lambda buf,at,n:cbus.put(buf,at,[.2]*n)):
   e.render_stereo(128);e.project.tracks[0]['instrument']['pan']=1.;a=e.render_stereo(128)
   self.assertGreater(a[0],.19);self.assertLess(a[1],.01);self.assertLess(max(abs(x-y) for x,y in zip(a[::2],a[2::2])),.002)
   b=e.render_stereo(512);self.assertAlmostEqual(b[-2],0.);self.assertAlmostEqual(b[-1],.2)
 def test_unsupported_stereo_kernel_rejects_enabled_new_controls(self):
  from unittest.mock import patch
  from decksynth import fx
  class NoStereo:
   # An older library without the stereo kernel (a freshly built libdsfx.so has it, so hide it).
   def __init__(self,lib):self.lib=lib
   def __getattr__(self,k):
    if k=='dsfx_process_stereo':raise AttributeError(k)
    return getattr(self.lib,k)
  legacy=NoStereo(fx._load(legacy=True))
  for module,key in [('cloud','mix'),('chorus','width'),('chorus','haas'),('delay','width'),('reverb','width')]:
   c=default_chain();m=next(m for m in c['modules'] if m['id']==module);m['on']=True;m['params'][key]=.01
   with patch.object(fx,'_load',return_value=legacy):
    f=TrackFx(48000)
    with self.assertRaisesRegex(ValueError,'cached native|kernel'):f.configure(c)
 def test_compressor_telemetry_reports_strongest_stereo_reduction(self):
  c=default_chain()
  for m in c['modules']:
   if m['id'] in ('chorus','compressor'):m['on']=True
  next(m for m in c['modules'] if m['id']=='chorus')['params'].update(mix=0.,haas=.03)
  f=TrackFx(48000);f.configure(c)
  for i in range(50):f.process_stereo([.3]*128,120)
  f.process_stereo([0.]*512,120)
  self.assertGreater(f.lib.dsfx_comp_gr(f.right),f.lib.dsfx_comp_gr(f.handle))
  self.assertEqual(f.comp_reduction(),round(max(f.lib.dsfx_comp_gr(f.handle),f.lib.dsfx_comp_gr(f.right)),2))
 def test_sdl_queue_counts_stereo_frames(self):
  from decksynth.backend import Audio
  previous=os.environ.get('SDL_AUDIODRIVER');os.environ['SDL_AUDIODRIVER']='dummy'
  try:
   a=Audio('System default');self.assertEqual(a.channels,2);a.write([0.]*512);self.assertEqual(a.queued(),256);a.close()
  finally:
   if previous is None:os.environ.pop('SDL_AUDIODRIVER',None)
   else:os.environ['SDL_AUDIODRIVER']=previous
