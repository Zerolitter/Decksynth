#!/usr/bin/env python3
"""Offline S3 native gain/synth timing, without claiming physical latency or xruns."""
from pathlib import Path
import json,math,statistics,sys,time
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from decksynth.core import Engine
from decksynth.fx import default_chain
OUT=ROOT/'artifacts/recovery/spectral-s3'
e=Engine()
for tr in range(4):
 c=default_chain();g=next(m for m in c['modules'] if m['id']=='gate');g['on']=True;g['params'].update(retrig=0,phase=.1*tr,notelen=.55,hold=0)
 e.set_fx(tr,c)
 for i in range(4):e.voice_on(tr,48+i*4+tr,100,('s3',tr,i))
times=[];peak=0.
for i in range(800):
 if i%64==32:
  for tr in range(4):e.voice_off(tr,48+tr,('s3',tr,0));e.voice_on(tr,48+tr,100,('s3',tr,0))
 start=time.perf_counter_ns();a=e.render(256);times.append((time.perf_counter_ns()-start)/1e6)
 assert all(math.isfinite(x) and abs(x)<=.950000001 for x in a);peak=max(peak,max(map(abs,a)))
def stat(v):return {'p99_ms':sorted(v)[math.ceil(.99*len(v))-1],'max_ms':max(v),'median_ms':statistics.median(v)}
r={'voices_total':16,'tracks':4,'block_frames':256,'rate':48000,'deadline_ms':256/48,'cold':stat(times[:200]),'warm':stat(times[200:]),'peak':peak,'finite':True,'physical_audio_exercised':False}
(OUT/'audio-measurements.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
