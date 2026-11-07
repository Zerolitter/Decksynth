#!/usr/bin/env python3
"""S4 software expression render timing; no physical acceptance claim."""
from pathlib import Path
import json,math,statistics,sys,time
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from decksynth.core import Engine
from decksynth.fx import default_chain
out=ROOT/'artifacts/recovery/spectral-s4';rows=[]
for mode in ('poly-pitch-velocity','four-track-legato-glide'):
 e=Engine()
 for tr in range(4):
  p=e.project.tracks[tr]['instrument'];p.update(play_mode=2 if mode.startswith('four') else 0,glide=.1,pitch=0.,velocity_brightness=.5,velocity_cutoff=.4,vcf_keytrack=.5)
  if mode.startswith('poly'):
   c=default_chain();c['mods'][0]['targets']=[dict(module='sound',param='pitch',depth=.2)];e.set_fx(tr,c)
 e.configure()
 for tr in range(4):
  for i in range(1 if mode.startswith('four') else 4):e.voice_on(tr,48+tr+i*4,80+i*10,('s4',tr,i))
 times=[];peak=0.
 for i in range(800):
  if mode.startswith('four') and i%40==20:
   for tr in range(4):
    e.voice_on(tr,60+tr+(i//40%2)*7,100,('s4move',tr,i));e.voice_off(tr,0,('s4move',tr,i-40))
  t=time.perf_counter_ns();a=e.render(256);times.append((time.perf_counter_ns()-t)/1e6)
  assert all(math.isfinite(x) and abs(x)<=.950000001 for x in a);peak=max(peak,max(map(abs,a)))
 def stat(v):return dict(p99_ms=sorted(v)[math.ceil(.99*len(v))-1],max_ms=max(v),median_ms=statistics.median(v))
 rows.append(dict(case=mode,tracks=4,voices_total=4 if mode.startswith('four') else 16,frames=256,deadline_ms=256/48,cold=stat(times[:200]),warm=stat(times[200:]),peak=peak,finite=True))
r={'software_cases':rows,'physical_audio_exercised':False};(out/'audio-measurements.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
