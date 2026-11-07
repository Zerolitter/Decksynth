import { useEffect, useMemo, useRef, useState } from 'react';
import { createFrameBatch } from '../chordz-primitives/frame-batch';
import { evaluatedPartials } from '../spectral';

import { TRACK_COLORS, clamp, type Track } from '../types';
import { FrameWindow } from './FrameWindow';
import { MorphPad } from './MorphPad';
import type { Live } from './ModParts';
import type { FxChain } from '../fx';
import { normalizeChain } from '../fx';

type Props = {
  track:Track; selected:number;
  onParam:(key:'harmonics'|'filter'|'modulation'|'curve'|'balance'|'focus'|'focus_center'|'attack'|'decay'|'sustain'|'release',index:number|null,value:number)=>void;
  chain?:FxChain; onChain:(c:FxChain)=>void;
  live?:Live; bpm?:number;
};

type Shape = 'SAW'|'SQUARE'|'TRIANGLE'|'PULSE'|'GAUSSIAN'|'SPREAD';
const SHAPES:Shape[]=['SAW','SQUARE','TRIANGLE','PULSE','GAUSSIAN','SPREAD'];
function shape(name:Shape):number[] {
  const out:number[]=[];
  for(let i=0;i<16;i++){
    const n=i+1;
    let v=0;
    if(name==='SAW')v=1/n;
    else if(name==='SQUARE')v=n%2?1/n:0;
    else if(name==='TRIANGLE')v=n%2?1/(n*n):0;
    else if(name==='PULSE')v=.7*(1/n)*(1+Math.cos((n-1)*Math.PI/3));
    else if(name==='GAUSSIAN')v=Math.exp(-Math.pow((i-5)/3,2));
    else v=i%3===0?.85:i%3===1?.28:.09;
    out.push(clamp(Number(v.toFixed(5)),0,1));
  }
  return out;
}
export function createHarmonicShape(name:Shape) { return shape(name); }

function waveform(harmonics:number[]) {
  const points:number[]=[];
  for(let j=0;j<=160;j++){
    const phase=j/160*Math.PI*5;
    let sample=0,total=0;
    for(let i=0;i<16;i++){sample+=harmonics[i]*Math.sin(phase*(i+1));total+=harmonics[i];}
    points.push(clamp(sample/Math.max(1,total),-1,1));
  }
  return points.map((y,i)=>(i===0?'M':'L')+' '+(i*2.9+6).toFixed(2)+' '+(49-y*38).toFixed(2)).join(' ');
}

export function SoundWindow({track,selected,onParam,chain,onChain,live,bpm}:Props) {
  const p=track.instrument;
  const [activePartial,setActivePartial]=useState(0);
  const [shapeUsed,setShapeUsed]=useState<string>('CUSTOM');
  const [dragging,setDragging]=useState(false);
  const spectrum=useRef<HTMLDivElement>(null);
  const args=useRef(onParam);args.current=onParam;
  const batch=useMemo(()=>createFrameBatch<{index:number;value:number}>(item=>
    args.current('harmonics',item.index,item.value)),[]);
  useEffect(()=>{setActivePartial(0);setShapeUsed('CUSTOM');setDragging(false);},[selected]);
  useEffect(()=>()=>batch.discard(),[batch]);

  function editPartial(e:React.PointerEvent){
    if(!spectrum.current)return;
    const b=spectrum.current.getBoundingClientRect();
    const line=spectrum.current.querySelector('.bar-line')?.getBoundingClientRect()??b;
    const idx=clamp(Math.floor((e.clientX-b.left)/b.width*16),0,15);
    const value=clamp((line.bottom-e.clientY)/Math.max(1,line.height),0,1);
    setActivePartial(idx);setShapeUsed('CUSTOM');
    batch.push({index:idx,value:Number(value.toFixed(4))});
  }
  const begin=(e:React.PointerEvent)=>{
    if(e.button!==0)return;
    e.preventDefault();(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);editPartial(e);
  };
  const move=(e:React.PointerEvent)=>{if(dragging&&e.buttons!==0)editPartial(e);};
  const end=()=>{setDragging(false);batch.flush();};
  const applyShape=(name:Shape)=>{
    batch.flush();
    shape(name).forEach((value,index)=>onParam('harmonics',index,value));
    setShapeUsed(name);
  };
  const result=useMemo(()=>evaluatedPartials(p),[p]);
  const wave=useMemo(()=>waveform(result),[result]);
  const accent=TRACK_COLORS[selected];

  return <FrameWindow id="sound" label="Sound" tabs={[
    {id:'PARTIALS',label:'Partials',
      actions:<><svg className="wave-thumb" viewBox="0 0 476 98" preserveAspectRatio="none" role="img" aria-label="Waveform of the partials">
          <line x1="0" x2="476" y1="49" y2="49" stroke="#37414a" strokeDasharray="4 5" vectorEffect="non-scaling-stroke"/>
          <path d={wave} fill="none" stroke={accent} strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg>
        <div className="spectral-legend" aria-hidden="true"><span><i className="legend-bar"/> saved</span>
          <span><i className="legend-line"/> heard</span></div>
        <div className="shape-chips" role="group" aria-label="Starting shape">{SHAPES.map(name=>
        <button key={name} type="button" className={shapeUsed===name?'selected':''} aria-pressed={shapeUsed===name}
          onClick={()=>applyShape(name)}>{name}</button>)}</div></>,
      render:()=><div ref={spectrum} className="harmonic-spectrum" role="group" style={{['--panel-accent' as string]:accent}}
        aria-label="Touch or drag to adjust the 16 harmonic partial levels"
        onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        {p.harmonics.map((value,index)=>
          <button key={index} type="button"
            aria-label={'Harmonic '+(index+1)+' at '+Math.round(value*100)+' percent'}
            className={'harmonic-bar'+(activePartial===index?' current':'')}
            style={{'--partial':(value*100)+'%', '--partial-color':accent} as React.CSSProperties}
            onClick={e=>{e.stopPropagation();setActivePartial(index);}}>
            <span className="bar-index">{String(index+1).padStart(2,'0')}</span>
            <span className="bar-line"><span/><i className="bar-result" style={{bottom:(result[index]*100)+'%'}} aria-hidden="true"/></span>
            <span className="bar-value">{Math.round(value*100)}</span>
          </button>)}
      </div>},
    {id:'MORPH',label:'Morph pad',render:()=><MorphPad chain={normalizeChain(chain)} onChange={onChain} live={live} bpm={bpm}/>},
  ]}/>;
}
