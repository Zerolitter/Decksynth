import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleDot, Disc3, Guitar, MoveHorizontal, SlidersHorizontal, Waves } from 'lucide-react';
import { createFrameBatch } from '../chordz-primitives/frame-batch';
import { Knob } from './Knob';
import { TRACK_COLORS, PRESETS, clamp, type Track } from '../types';

type Props = {
  track:Track; selected:number;
  onParam:(key:'harmonics'|'filter'|'modulation',index:number|null,value:number)=>void;
  onPreset:(preset:string)=>void; onSaveSound:()=>void;
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

export function SoundLab({track,selected,onParam,onPreset,onSaveSound}:Props) {
  const p=track.instrument;
  const [activePartial,setActivePartial]=useState(0);
  const [shapeUsed,setShapeUsed]=useState<string>('CUSTOM');
  const [dragging,setDragging]=useState(false);
  const touched=useRef<number|null>(null);
  const spectrum=useRef<HTMLDivElement>(null);
  const args=useRef(onParam);args.current=onParam;
  const batch=useMemo(()=>createFrameBatch<{index:number;value:number}>(item=>
    args.current('harmonics',item.index,item.value)),[]);
  useEffect(()=>{setActivePartial(0);setShapeUsed('CUSTOM');setDragging(false);},[selected]);
  useEffect(()=>()=>batch.discard(),[batch]);

  function editPartial(e:React.PointerEvent){
    if(!spectrum.current)return;
    const b=spectrum.current.getBoundingClientRect();
    const idx=clamp(Math.floor((e.clientX-b.left)/b.width*16),0,15);
    const value=clamp((b.bottom-28-e.clientY)/Math.max(1,b.height-74),0,1);
    setActivePartial(idx);
    setShapeUsed('CUSTOM');
    touched.current=idx;
    batch.push({index:idx,value:Number(value.toFixed(4))});
  }
  const begin=(e:React.PointerEvent)=>{
    if(e.button!==0)return;
    e.preventDefault();(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);editPartial(e);
  };
  const move=(e:React.PointerEvent)=>{
    if(dragging&&e.buttons!==0)editPartial(e);
  };
  const end=()=>{setDragging(false);batch.flush();touched.current=null;};
  const applyShape=(name:Shape)=>{
    batch.flush();
    const weights=shape(name);
    weights.forEach((value,index)=>onParam('harmonics',index,value));
    setShapeUsed(name);
  };
  const wave=useMemo(()=>waveform(p.harmonics),[p.harmonics]);
  const accent=TRACK_COLORS[selected];

  return <section className="sound-lab" aria-label="Spectral instrument editor">
    <div className="sound-lab-head">
      <div><span className="eyebrow">SOUND DESIGN / ACTIVE TRACK {selected+1}</span>
        <h2>Spectral designer <span>·</span> <strong>{track.preset}</strong></h2></div>
      <div className="sound-head-actions">
        <label className="sound-preset-picker"><span>PATCH</span>
          <select className="sound-preset-switch" value={track.preset}
            aria-label="Choose instrument preset" onChange={e=>onPreset(e.target.value)}>
            {!PRESETS.includes(track.preset as typeof PRESETS[number])?<option value={track.preset}>{track.preset}</option>:null}
            {PRESETS.map(preset=><option value={preset} key={preset}>{preset}</option>)}
          </select>
        </label>
        <button className="sound-save" type="button" onClick={onSaveSound}><Disc3 size={16}/> SAVE PATCH</button>
      </div>
    </div>
    <div className="sound-lab-body">
      <aside className="patch-browser" aria-label="Instrument presets">
        <div className="patch-heading"><span>PATCH LIBRARY</span><span>{PRESETS.length} presets</span></div>
        {PRESETS.map((preset,index)=>
          <button type="button" key={preset} className={'patch-row'+(track.preset===preset?' selected':'')}
            onClick={()=>onPreset(preset)}>
            <span className="patch-icon">{index===1?<Guitar size={17}/>:<Waves size={17}/>}</span>
            <span><strong>{preset}</strong><small>{['KEYS','LOW END','PADS','TONES','TEXTURES'][index]}</small></span>
            {preset===track.preset&&<CircleDot size={15} className="patch-active"/>}
          </button>)}
        <div className="patch-note"><strong>Non-destructive</strong>
          <span>Change the patch without altering your recorded MIDI notes.</span></div>
      </aside>
      <div className="spectral-card">
        <div className="spectral-head">
          <div><span className="eyebrow">ADDITIVE / 16 PARTIALS</span>
            <h3>Harmonic spectrum</h3></div>
          <div className="spectral-selected"><span>PARTIAL</span><strong>{String(activePartial+1).padStart(2,'0')}</strong></div>
        </div>
        <div ref={spectrum} className="harmonic-spectrum" role="group"
          aria-label="Touch or drag to adjust the 16 harmonic partial levels"
          onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
          <div className="spectrum-guides" aria-hidden="true"/>
          {p.harmonics.map((value,index)=>
            <button key={index} type="button"
              aria-label={'Harmonic '+(index+1)+' at '+Math.round(value*100)+' percent'}
              className={'harmonic-bar'+(activePartial===index?' current':'')}
              style={{'--partial':(value*100)+'%', '--partial-color':accent} as React.CSSProperties}
              onClick={e=>{e.stopPropagation();setActivePartial(index);}}>
              <span className="bar-index">{String(index+1).padStart(2,'0')}</span>
              <span className="bar-line"><span/></span>
              <span className="bar-value">{Math.round(value*100)}%</span>
            </button>)}
        </div>
        <div className="shape-selector">
          <span>STARTING SHAPE</span>
          <div className="shape-buttons">{SHAPES.map(name=>
            <button key={name} type="button" className={shapeUsed===name?'selected':''}
              onClick={()=>applyShape(name)}>{name}</button>)}</div>
        </div>
        <div className="spectral-footer">
          <div className="wave-mini"><span className="soft-label">HARMONIC RESULT</span>
            <svg viewBox="0 0 476 98" role="img" aria-label="Calculated waveform from the 16 harmonic levels">
              <line x1="0" x2="476" y1="49" y2="49" stroke="#37414a" strokeDasharray="4 5"/>
              <path d={wave} fill="none" stroke={accent} strokeWidth="2" opacity=".85"/></svg></div>
          <div className="partial-focus">
            <div className="partial-focus-head"><SlidersHorizontal size={16}/><span>FINE TUNING</span></div>
            <Knob id={'partial-'+selected+'-'+activePartial}
              name={'PARTIAL '+String(activePartial+1).padStart(2,'0')}
              value={p.harmonics[activePartial]} min={0} max={1} step={.001} suffix="%"
              onChange={v=>onParam('harmonics',activePartial,v)} accent={accent}/>
            <div className="partial-hint"><MoveHorizontal size={13}/> Drag / Shift to fine tune</div>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
