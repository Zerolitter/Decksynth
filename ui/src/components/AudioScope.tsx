import { useEffect, useRef } from 'react';
import { AudioLines, Gauge, SignalHigh } from 'lucide-react';
import { clamp } from '../types';
import { meterIntensity } from '../pattern';
import { deckStore, useLive, useMetersWatched } from '../deck-store';

type Props = {voices:number; underruns:number; preview?:boolean; load?:number; bufferMs?:number};

const LEDS = 18;

function dbfs(value:number) {
  return value<.00003 ? '−∞' : (20*Math.log10(value)).toFixed(1);
}

/** The peak of one channel (index 0 or 1), or of the mix when the engine sends no channels (index -1). */
function peakOf(channel:number) {
  const m = deckStore.get().snapshot?.meter;
  if(!m) return 0;
  if(channel>=0 && m.channels?.length===2) return clamp(m.channels[channel].peak,0,1);
  return clamp(m.peak??0,0,1);
}

/** One LED column on a canvas: redrawn only when the number of lit LEDs changes, never through React. */
function LedMeter({channel}:{channel:number}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const c = canvas.current, ctx = c?.getContext('2d');
    if(!c || !ctx) return;
    const css = getComputedStyle(c);
    const colour = (name:string) => css.getPropertyValue(name).trim() || 'gray';
    const off = colour('--led-off'), on = colour('--led-on'), warm = colour('--led-warm'), hot = colour('--led-hot');
    let lit = -1;
    const draw = () => {
      const count = Math.ceil(meterIntensity(peakOf(channel))*LEDS - 1e-9);
      if(count === lit) return;
      lit = count;
      if(c.parentElement) c.parentElement.dataset.lit = String(count);
      const w = c.width, h = c.height, cell = h/LEDS;
      ctx.clearRect(0,0,w,h);
      for(let i=0;i<LEDS;i++){
        ctx.fillStyle = i<count ? (i>=16 ? hot : i>=14 ? warm : on) : off;
        ctx.fillRect(0, h-(i+1)*cell+.5, w, Math.max(1,cell-1));
      }
    };
    draw();
    return deckStore.subscribe(draw);
  },[channel]);
  return <canvas ref={canvas} className="scope-meter-canvas" width={14} height={72} aria-hidden="true"/>;
}

export function AudioScope({voices,underruns,preview=false,load,bufferMs}:Props) {
  useMetersWatched('levels');
  const stereo = useLive(s=>s?.meter?.channels?.length===2);
  // Text that changes only when its shown digits do, so the scope re-renders a few times a second, not on every packet.
  const rms = useLive(s=>dbfs(s?.meter?.rms??0)), peak = useLive(s=>dbfs(clamp(s?.meter?.peak??0,0,1)));
  const peaks = stereo ? [0,1] : [-1];
  return <section className="audio-scope song-output" aria-label="Live output">
    <div className="scope-title"><AudioLines size={16} aria-hidden="true"/><strong>LIVE OUTPUT</strong></div>
    <div className="scope-stat">
      <span><SignalHigh size={13} aria-hidden="true"/> {voices} voices</span>
      <span className={'scope-dropouts'+(underruns?' warn':'')} title="Audio dropouts since start">
        <Gauge size={13} aria-hidden="true"/> {underruns} dropout{underruns===1?'':'s'}
      </span>
      {load!==undefined?<span className={'scope-load'+(load>.7?' warn':'')}
        title="Engine load: the slowest audio block of the last second, as a share of the time it may take">
        DSP {Math.round(load*100)}%{bufferMs!==undefined?' · '+bufferMs+' ms':''}
      </span>:null}
      {preview?<span className="preview-label">DEMO SIGNAL</span>:null}
    </div>
    <div className="song-output-levels">
      <span>RMS <strong>{rms} dB</strong></span>
      <span>Peak <strong>{peak} dB</strong></span>
    </div>
    <div className="scope-stereo-meters" role="group" aria-label={stereo?'Stereo peak meters':'Peak meter'}>
      {peaks.map(channel=>{
        const side=channel===0?'Left':'Right';
        return <div key={channel} className="scope-meter">
          <div className="scope-meter-leds" role="img" aria-label={(stereo?side+' peak':'Peak')+' meter'}>
            <LedMeter channel={channel}/>
          </div>
          <span className="meter-label" aria-hidden="true">{stereo?side[0]:'Peak'}</span>
        </div>;
      })}
    </div>
  </section>;
}
