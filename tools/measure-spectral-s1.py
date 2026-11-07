#!/usr/bin/env python3
"""Offline native DSP fixtures and software block cost; never a physical latency/xrun test."""
from pathlib import Path
import json
import math
import statistics
import struct
import sys
import time
import wave

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from decksynth.core import Synth,Engine
from decksynth.spectral import SHAPES,seed_shape
from decksynth.spectral_native import prepare_kernel,library_path
from decksynth.fx import available,default_chain

OUT=ROOT/'artifacts/recovery/spectral-s1'
OUT.mkdir(parents=True,exist_ok=True)
rows=[]
for note in (36,60,84):
    for velocity in (40,100):
        for shape in SHAPES:
            s=Synth(48000)
            s.configure({**s.params,'harmonics':seed_shape(shape,42),'spectral_energy':1,'filter':1.,
                'attack':.001,'decay':.001,'sustain':1.,'release':.01,'modulation':0.})
            s.on(note,velocity);s.render(4800);a=s.render(24000)
            rms=math.sqrt(sum(x*x for x in a)/len(a))
            row=dict(note=note,velocity=velocity,shape=shape,rms=rms,dbfs=20*math.log10(rms),
                peak=max(abs(x) for x in a),table_peak=max(abs(x) for x in s.table(note)),finite=all(math.isfinite(x) for x in a))
            s.off(note);s.render(1000);row['released']=not s.voices;rows.append(row)
spans=[]
for note in (36,60,84):
    for velocity in (40,100):
        a=[r['dbfs'] for r in rows if r['note']==note and r['velocity']==velocity]
        span=max(a)-min(a);assert span<3;spans.append(dict(note=note,velocity=velocity,span_db=span))
assert all(r['finite'] and r['released'] and r['table_peak']<=1.000000001 for r in rows)

def stat(values):
    return dict(p99_ms=sorted(values)[math.ceil(.99*len(values))-1],max_ms=max(values),median_ms=statistics.median(values))

bench=[]
for voices in (8,16):
    e=Engine(48000)
    for tr in range(4):
        e.select(tr);e.seed_spectral(tr,'RANDOM');chain=default_chain()
        chain['mods'][0].update(shape='sine',rate=5,targets=[dict(module='sound',param='character',depth=.5)])
        e.set_fx(tr,chain)
        for i in range(voices//4):e.voice_on(tr,48+i*4+tr,100,('s1_bench',tr,i))
    timings=[]
    for i in range(800):
        start=time.perf_counter_ns();block=e.render(256);timings.append((time.perf_counter_ns()-start)/1e6)
        assert all(math.isfinite(x) and abs(x)<=.950000001 for x in block)
    bench.append(dict(voices_total=voices,tracks=4,block_frames=256,deadline_ms=256/48000*1000,
        cold=stat(timings[:200]),warm=stat(timings[200:]),wave_cache_max=max(len(s.wave_cache) for s in e.synths),physical_xruns_measured=False))
result=dict(native=available(),native_peak_helper=prepare_kernel() is not None,helper_library=str(library_path()),
    rate=48000,channels=1,measurements=rows,spans=spans,software_render_benchmark=bench,physical_audio_exercised=False)
(OUT/'audio-measurements.json').write_text(json.dumps(result,indent=2)+'\n')

audio=[]
for index,character in enumerate((-1.,0.,1.)):
    e=Engine(48000);e.project.tracks[0]['instrument'].update(harmonics=seed_shape('RANDOM',42),random_seed=42,
        spectral_energy=1,character=character,filter=1.,attack=.002,decay=.05,sustain=.65,release=.08,modulation=0.)
    e.configure();token=('s1_demo',index);e.voice_on(0,60,100,token)
    audio+=e.render(38400);e.synths[0].off(60,token);audio+=e.render(4800)
with wave.open(str(OUT/'character-even-neutral-odd.wav'),'wb') as f:
    f.setnchannels(1);f.setsampwidth(2);f.setframerate(48000)
    f.writeframes(struct.pack('<'+str(len(audio))+'h',*[max(-32768,min(32767,round(x*32767))) for x in audio]))
print(json.dumps(dict(max_shape_span_db=max(x['span_db'] for x in spans),benchmarks=bench,
    native_peak_helper=result['native_peak_helper'],demo_seconds=len(audio)/48000),indent=2))
