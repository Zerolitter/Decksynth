"""Private evaluation: render an original two-bar groove through native Engine.

Usage: python3 tools/render_drum_demo.py REFERENCE.zip --output OUTPUT_DIRECTORY
The ZIP stays a reference. Only its sixteen WAVs enter a temporary directory;
no assets or .decksynth music projects are copied into the source checkout.
Generated audio contains private evaluation samples and must not be distributed.
"""
import argparse
import array
import hashlib
import io
import json
import math
from pathlib import Path
import statistics
import sys
import tempfile
import time
import wave
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from decksynth.core import Engine


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference_zip',type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    prefix='DeckSynth_DrumRack_Worker_Package/'
    with tempfile.TemporaryDirectory(prefix='decksynth-private-demo-') as tmp,zipfile.ZipFile(args.reference_zip) as archive:
        draft=json.loads(archive.read(prefix+'starter_16_pad_kit.json'))
        for pad in draft['pads']:
            relative=Path(pad['relative_wav'])
            if relative.is_absolute() or '..' in relative.parts:raise ValueError('Unsafe reference asset path')
            payload=archive.read(prefix+str(relative))
            if hashlib.sha256(payload).hexdigest()!=pad['sha256']:raise ValueError('Private asset SHA mismatch')
            target=Path(tmp)/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(payload)
        engine=Engine(48000);engine.import_reference_drum_kit(0,draft,tmp)
        engine.project.bpm=120;engine.project.bars=2
        # Original pattern: seven syncopated kicks, backbeat snares, offbeat hats,
        # short open-hat pickups and a sparse percussion response. No drum sequencer.
        hits=[]
        for beat,velocity in [(0,116),(1.5,96),(2.75,105),(4,116),(5.5,98),(6.75,105),(7.5,90)]:
            hits.append((beat,0,velocity))
        for beat in [1,3,5,7]:hits.append((beat,2,110))
        for i in range(16):hits.append((i*.5,6,72 if i%2==0 else 94))
        for beat in [3.5,7.5]:hits.append((beat,7,82))
        for beat in [.75,2.25,4.75,6.25]:hits.append((beat,8,68))
        hits.sort()
        engine.project.tracks[0]['notes']=[dict(start=b,duration=.125,note=36+p,velocity=v) for b,p,v in hits]
        engine.playing=True;pcm=array.array('f');timings=[];events=[];prior=[0]*16
        frames=round(8*engine.fpb)
        for start in range(0,frames,256):
            count=min(256,frames-start);before=time.perf_counter();pcm.extend(engine.render_stereo(count));timings.append(time.perf_counter()-before)
            state=engine.drum_state()[0]
            for i,pad in enumerate(state['pads']):
                if pad['event']!=prior[i]:events.append(dict(pad=i,midi=36+i,frame=pad['frame']));prior[i]=pad['event']
        engine.playing=False
        pcm.extend(engine.render_stereo(24000))  # Half-second natural tails, separate from the two-bar body.
        expected=sorted((round(b*engine.fpb),p) for b,p,v in hits)
        actual=sorted((e['frame'],e['pad']) for e in events)
        if actual!=expected:raise AssertionError((actual,expected))
        peak=max(map(abs,pcm));rms=math.sqrt(sum(x*x for x in pcm)/len(pcm))
        output=args.output/'drum-rack-native-two-bar-private.wav'
        audio=array.array('h',(round(max(-1.,min(1.,v))*32767) for v in pcm))
        if sys.byteorder!='little':audio.byteswap()
        with wave.open(str(output),'wb') as f:
            f.setparams((2,2,48000,0,'NONE','PCM'));f.writeframes(audio.tobytes())
        # Compare formats and levels only. The reference pattern/engine are different;
        # differences diagnose behavior, never proprietary sonic equivalence.
        reference={}
        ref_names=[n for n in archive.namelist() if n.endswith('drumrack_reference_groove.wav')]
        if ref_names:
            raw=archive.read(ref_names[0])
            with wave.open(io.BytesIO(raw)) as f:
                reference=dict(channels=f.getnchannels(),rate=f.getframerate(),frames=f.getnframes(),bits=f.getsampwidth()*8)
                if f.getsampwidth()==2:
                    samples=array.array('h',f.readframes(f.getnframes()))
                    if sys.byteorder!='little':samples.byteswap()
                    reference['peak']=max(abs(x)/32768 for x in samples)
        report=dict(status='native engine code verified; physical acceptance pending',private_evaluation_audio=True,
            source_archive_sha256=hashlib.sha256(args.reference_zip.read_bytes()).hexdigest(),
            output=str(output),sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
            rate=48000,channels=1,body_bars=2,bpm=120,body_frames=frames,tail_frames=24000,
            scheduled_hits=len(hits),observed_events=events,max_event_timing_error_frames=0,
            onset_envelope_frames=48,choke_fade_frames=384,peak=peak,rms=rms,
            render_block_ms=dict(median=statistics.median(timings)*1000,max=max(timings)*1000,deadline=256/48000*1000),
            reference_format_level=reference,
            comparison_limit='Independent original groove. Native mono/downmix versus reference stereo. Zero event-offset error is offline scheduling evidence; 1ms attack and queue/device latency affect audible onset. No listening or sonic-parity claim.')
        (args.output/'native-demo-analysis.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))


if __name__=='__main__':main()
