#!/usr/bin/env python3
"""Render real synth output offline; no device is opened or MIDI hardware claimed."""
import array
import math
from pathlib import Path
import sys
import time
import wave
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from decksynth.core import Synth, PRESETS, instrument

def main():
    destination=Path(sys.argv[1] if len(sys.argv)>1 else 'artifacts/preset-audition.wav')
    destination.parent.mkdir(parents=True,exist_ok=True)
    start=time.perf_counter(); sr=48000; samples=array.array('h')
    for name in PRESETS:
        s=Synth(sr); s.configure(instrument(name))
        notes=(36,43) if name=='Bass' else (60,64,67)
        for n in notes:s.on(n,100)
        audio=s.render(sr*2)
        for n in notes:s.off(n)
        audio+=s.render(sr*3)
        peak=max(map(abs,audio)); rms=math.sqrt(sum(v*v for v in audio)/len(audio))
        assert peak>.001 and all(math.isfinite(v) for v in audio)
        print(f'{name}: peak {peak:.3f}, RMS {rms:.3f}')
        samples.extend(int(max(-1,min(1,v))*32767) for v in audio)
    if sys.byteorder!='little':samples.byteswap()
    with wave.open(str(destination),'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(sr); out.writeframes(samples.tobytes())
    print(f'Wrote {destination}: 25 seconds of synth audio in {time.perf_counter()-start:.2f}s')
if __name__=='__main__':main()
