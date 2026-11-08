import { AudioLines, Gauge, SignalHigh } from 'lucide-react';
import { clamp } from '../types';
import { meterIntensity } from '../pattern';

type Monitor = {channels?: {peak:number}[]; rms:number; peak:number};
type Props = {monitor:Monitor|null; voices:number; underruns:number; preview?:boolean; load?:number; bufferMs?:number};

function dbfs(value:number) {
  return value<.00003 ? '−∞' : (20*Math.log10(value)).toFixed(1);
}

export function AudioScope({monitor,voices,underruns,preview=false,load,bufferMs}:Props) {
  const peak=clamp(monitor?.peak??0,0,1);
  const channels=monitor?.channels;
  const stereo=channels?.length===2;
  const peaks=stereo ? channels.map(channel=>channel.peak) : [peak];
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
      <span>RMS <strong>{dbfs(monitor?.rms??0)} dB</strong></span>
      <span>Peak <strong>{dbfs(peak)} dB</strong></span>
    </div>
    <div className="scope-stereo-meters" role="group" aria-label={stereo?'Stereo peak meters':'Peak meter'}>
      {peaks.map((value,index)=>{
        const side=index===0?'Left':'Right';
        return <div key={index} className="scope-meter">
          <div className="scope-meter-leds" role="img" aria-label={(stereo?side+' peak':'Peak')+' '+dbfs(value)+' dBFS'}>
            {Array.from({length:18},(_,i)=><span key={i} className={meterIntensity(value)*18>i?'lit':''}/>)}
          </div>
          <span className="meter-label" aria-hidden="true">{stereo?side[0]:'Peak'}</span>
        </div>;
      })}
    </div>
  </section>;
}
