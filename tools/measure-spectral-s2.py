#!/usr/bin/env python3
"""S2 offline native PCM and software block cost. No hardware/physical acceptance."""
from pathlib import Path
import json, math, statistics, struct, sys, time, wave
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from decksynth.core import Engine, Synth
from decksynth.filter_native import prepare_kernel, library_path
from decksynth.fx import default_chain
OUT=ROOT/'artifacts/recovery/spectral-s2';OUT.mkdir(parents=True,exist_ok=True)
assert prepare_kernel() is not None,'Build the optional S2 kernel first'
rows=[]
for note in (36,60,84):
 for velocity in (40,100):
  for morph in (0,.25,.5,.75,1):
   s=Synth();s.configure({**s.params,'vcf_type':1,'vcf_morph':morph,'vcf_cutoff':.55,'vcf_reso':.9,
    'vcf_env':.45,'fenv_a':.03,'fenv_d':.08,'fenv_s':.35,'fenv_r':.09,'modulation':0.})
   s.on(note,velocity);a=s.render(12000);s.off(note);a+=s.render(48000)
   rows.append(dict(note=note,velocity=velocity,morph=morph,peak=max(map(abs,a)),
    rms=math.sqrt(sum(x*x for x in a)/len(a)),finite=all(map(math.isfinite,a)),released=not s.voices))
assert all(x['finite'] and x['released'] for x in rows)

def stat(v):return dict(p99_ms=sorted(v)[math.ceil(.99*len(v))-1],max_ms=max(v),median_ms=statistics.median(v))
bench=[]
for kind in ('legacy','s2-fast-sweep'):
 e=Engine();
 for tr in range(4):
  params=e.project.tracks[tr]['instrument'];params.update(vcf_type=1,vcf_cutoff=.45,vcf_reso=1.,vcf_env=.35,modulation=0.,attack=.002,sustain=.6,release=.1)
  if kind.startswith('s2'):
   params.update(fenv_a=.015,fenv_d=.12,fenv_s=.35,fenv_r=.08,vcf_morph=.5)
   chain=default_chain()
   chain['mods'][0].update(shape='saw',rate=6,targets=[dict(module='sound',param='vcf_morph',depth=1),dict(module='sound',param='vcf_cutoff',depth=.65)])
   e.set_fx(tr,chain)
 e.configure()
 for tr in range(4):
  for i in range(4):e.voice_on(tr,48+tr+i*4,100,('s2bench',tr,i))
 timings=[];audio=[];boundary=[]
 for i in range(800):
  start=time.perf_counter_ns();a=e.render(256);timings.append((time.perf_counter_ns()-start)/1e6)
  if audio:boundary.append(abs(a[0]-audio[-1]))
  audio+=a
 assert all(math.isfinite(x) and abs(x)<=.950000001 for x in audio)
 delta=[abs(y-x) for x,y in zip(audio,audio[1:])]
 bench.append(dict(kind=kind,voices_total=16,tracks=4,block_frames=256,deadline_ms=256/48000*1000,
   cold=stat(timings[:200]),warm=stat(timings[200:]),peak=max(map(abs,audio)),
   max_command_boundary_delta=max(boundary),max_sample_delta=max(delta),
   command_boundary_p99=sorted(boundary)[math.ceil(.99*len(boundary))-1],finite=True,physical_xruns_measured=False))
 if kind.startswith('s2'):
  with wave.open(str(OUT/'filter-fast-sweep-16voices.wav'),'wb') as f:
   f.setnchannels(1);f.setsampwidth(2);f.setframerate(48000);f.writeframes(struct.pack('<'+str(len(audio))+'h',*[round(x*32767) for x in audio]))
result=dict(rate=48000,channels=1,kernel=str(library_path()),measurements=rows,software_render_benchmark=bench,physical_audio_exercised=False)
(OUT/'audio-measurements.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'fixtures':len(rows),'max_fixture_peak':max(r['peak'] for r in rows),'benchmarks':bench},indent=2))
