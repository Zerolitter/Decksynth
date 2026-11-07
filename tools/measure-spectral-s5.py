#!/usr/bin/env python3
"""Stereo software load, actual cap and explicit64voice experiment; no hardware claim."""
from pathlib import Path
import sys,json,time,math,statistics
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from decksynth.core import Engine
from decksynth.fx import default_chain
rows=[]
for name,voices,direct,effects in [('legacy16',4,False,False),('stereo24-cap',16,False,True),('stereo64-experiment',16,True,True)]:
 e=Engine()
 for tr in range(4):
  if effects:
   c=default_chain()
   for m in c['modules']:
    if m['id'] in ('chorus','delay','reverb','cloud'):
     m['on']=True
     if m['id']!='cloud':m['params']['width']=.8
   e.set_fx(tr,c)
  for i in range(voices):
   if direct:e.synths[tr].on(42+i*2,90,('bench',tr,i))
   else:e.voice_on(tr,42+i*2,90,('bench',tr,i))
 actual=sum(sum(not v.get('fast',False) for v in s.voices.values()) for s in e.synths);times=[];peak=0
 for b in range(450):
  start=time.perf_counter_ns();a=e.render_stereo(256);times.append((time.perf_counter_ns()-start)/1e6)
  assert all(math.isfinite(v) for v in a);peak=max(peak,max(map(abs,a)))
 def stats(t):return dict(p99_ms=sorted(t)[math.ceil(len(t)*.99)-1],max_ms=max(t),median_ms=statistics.median(t))
 rows.append(dict(case=name,requested_voices=voices*4,actual_sustained_voices=actual,engine_admission_bypassed_for_capacity_experiment=direct,stereo_fx=effects,cold=stats(times[:150]),warm=stats(times[150:]),peak=peak,deadline_ms=256/48))
result=dict(cases=rows,application_voice_cap=24,physical_acceptance='pending');out=ROOT/'artifacts/recovery/spectral-s5/audio-measurements.json';out.write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
