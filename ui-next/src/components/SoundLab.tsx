import { useEffect, useMemo, useRef, useState } from 'react';
import { createFrameBatch } from '../chordz-primitives/frame-batch';
import { evaluatedPartials } from '../spectral';

import { TRACK_COLORS, clamp, type Track } from '../types';
import { FrameWindow } from './FrameWindow';
import { MorphPad } from './MorphPad';
import type { Live } from './ModParts';
import type { FxChain } from '../fx';
import { normalizeChain } from '../fx';
import { SHAPES, harmonicShape, type Shape } from '../spectral-seeds';

type Props = {
  track:Track; selected:number;
  onParam:(key:'harmonics'|'filter'|'modulation'|'curve'|'balance'|'focus'|'focus_center'|'attack'|'decay'|'sustain'|'release',index:number|null,value:number)=>void;
  chain?:FxChain; onChain:(c:FxChain)=>void;
  onShape:(shape:Shape)=>void;
  live?:Live; bpm?:number;
};

export function createHarmonicShape(name:Shape,seed=0) { return harmonicShape(name,seed); }

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

export function SoundWindow({track,selected,onParam,onShape,chain,onChain,live,bpm}:Props) {
  const p=track.instrument;
  const [activePartial,setActivePartial]=useState(0);
  const shapeUsed=useMemo(()=>SHAPES.find(name=>
    (name!=='RANDOM'||p.random_seed!==undefined)&&harmonicShape(name,p.random_seed??0).every((v,i)=>Math.abs(v-p.harmonics[i])<1e-7))??'CUSTOM',[p.harmonics,p.random_seed]);
  const [dragging,setDragging]=useState(false);
  const spectrum=useRef<HTMLDivElement>(null);
  const args=useRef(onParam);args.current=onParam;
  const batch=useMemo(()=>createFrameBatch<{index:number;value:number}>(item=>
    args.current('harmonics',item.index,item.value)),[]);
  useEffect(()=>{setActivePartial(0);setDragging(false);},[selected]);
  useEffect(()=>()=>batch.discard(),[batch]);

  function editPartial(e:React.PointerEvent){
    if(!spectrum.current)return;
    const b=spectrum.current.getBoundingClientRect();
    const line=spectrum.current.querySelector('.bar-line')?.getBoundingClientRect()??b;
    const idx=clamp(Math.floor((e.clientX-b.left)/b.width*16),0,15);
    const value=clamp((line.bottom-e.clientY)/Math.max(1,line.height),0,1);
    setActivePartial(idx);
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
    onShape(name);
  };
  const result=useMemo(()=>live?.partials??evaluatedPartials(p,live?.sound),[p,live?.sound,live?.partials]);
  const wave=useMemo(()=>waveform(result),[result]);
  const accent=TRACK_COLORS[selected];

  return <FrameWindow id="sound" label="Sound" tabs={[
    {id:'PARTIALS',label:'Partials',
      actions:<><svg className="wave-thumb" viewBox="0 0 476 98" preserveAspectRatio="none" role="img" aria-label="Waveform of the partials">
          <line x1="0" x2="476" y1="49" y2="49" stroke="#37414a" strokeDasharray="4 5" vectorEffect="non-scaling-stroke"/>
          <path d={wave} fill="none" stroke={accent} strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg>
        <div className="spectral-legend" aria-hidden="true"><span><i className="legend-bar"/> saved</span>
          <span title="Partial gains before filter and effects; latest active voice, or idle preview"><i className="legend-line"/> {live?.partials?'heard':'preview'}</span></div>
        <div className="shape-chips" role="group" aria-label="Starting shape">{SHAPES.map(name=>
        <button key={name} type="button" className={shapeUsed===name?'selected':''} aria-pressed={shapeUsed===name}
          title={name==='RANDOM'?'New random partials · seed '+(p.random_seed??0):undefined}
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
