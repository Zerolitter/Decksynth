/** Steam Deck tactile knob.
 * Gesture math and pointer-lock safety: Chordz Studio's original utilities.
 * Procedural tick ring, cap shading and short-lived value bubble: originally
 * authored for DeckSynth after studying ReplicantTr8s (MIT).
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  knobArc, knobDragValue, knobToUnit, knobQuantize, knobKeyValue, knobParseNumber,
} from '../chordz-primitives/knob';
import { startRelativeDrag, type RelativeDragHandle } from '../chordz-primitives/relative-drag';
import { createFrameBatch } from '../chordz-primitives/frame-batch';

type Props = {
  id: string; name: string; value: number; min: number; max: number;
  step?: number; suffix?: string; accent?: string; precision?: number;
  onChange: (next: number) => void;
  description?: string; compact?: boolean;
};

export function Knob({id,name,value,min,max,step=.001,suffix='',accent='var(--accent)',
  precision=2,onChange,description='',compact=false}:Props) {
  const gradientId = useId().replace(/:/g,'');
  const drag = useRef<RelativeDragHandle|null>(null);
  const dragging = useRef(false);
  const latest = useRef(value);
  const onChangeRef=useRef(onChange);onChangeRef.current=onChange;
  const [local,setLocal]=useState(value);
  const [engaged,setEngaged]=useState(false);
  const [showBubble,setShowBubble]=useState(false);
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(String(value));
  const input=useRef<HTMLInputElement>(null);
  const readoutTimeout=useRef<ReturnType<typeof setTimeout>|null>(null);

  const batch=useMemo(()=>createFrameBatch<number>(n=>onChangeRef.current(n)),[]);
  useEffect(()=>{
    if(!dragging.current){setLocal(value);latest.current=value;}
  },[value]);
  useEffect(()=>()=> {
    drag.current?.cancel();batch.discard();
    if(readoutTimeout.current!==null)clearTimeout(readoutTimeout.current);
  },[batch,id]);
  useEffect(()=>{if(editing){setDraft(String(local));input.current?.select();}},[editing]);

  function show(n:number){
    if(suffix==='%'&&max<=1)return Math.round(n*100)+'%';
    if(suffix==='Hz')return n>=1000?(n/1000).toFixed(2)+'kHz':Math.round(n)+'Hz';
    return n.toFixed(precision)+(suffix?' '+suffix:'');
  }
  function reveal(){
    if(readoutTimeout.current!==null)clearTimeout(readoutTimeout.current);
    readoutTimeout.current=null;
    setShowBubble(true);
  }
  function hideLater(){
    if(readoutTimeout.current!==null)clearTimeout(readoutTimeout.current);
    readoutTimeout.current=setTimeout(()=>{setEngaged(false);setShowBubble(false);},1250);
  }
  const onPointerDown=(e:React.PointerEvent<HTMLDivElement>)=>{
    if(editing||e.button!==0)return;
    reveal();setEngaged(true);
    drag.current?.cancel();
    latest.current=local;
    drag.current=startRelativeDrag(e.currentTarget,e.nativeEvent,{
      threshold:3,pointerLock:e.pointerType==='mouse',
      onStart:()=>{dragging.current=true;return true;},
      onMove:({dy,fine})=>{
        const n=knobQuantize(knobDragValue(latest.current,dy,{min,max},fine),min,max,step);
        latest.current=n;setLocal(n);batch.push(n);reveal();
      },
      onEnd:(canceled)=>{
        dragging.current=false;
        if(canceled){batch.discard();setLocal(value);latest.current=value;onChangeRef.current(value);}
        else batch.flush();
        hideLater();
      },
    });
  };
  const onKeyDown=(e:React.KeyboardEvent)=>{
    if(editing)return;
    const next=knobKeyValue(e.key,local,{min,max,step},e.shiftKey);
    if(next!==null){
      e.preventDefault();setLocal(next);latest.current=next;
      onChangeRef.current(next);reveal();hideLater();
    }
    if(e.key==='Enter'){e.preventDefault();setEditing(true);reveal();}
  };
  const commit=()=>{
    const parsed=knobParseNumber(draft,min,max);
    if(parsed!==null){
      const next=knobQuantize(parsed,min,max,step);
      latest.current=next;setLocal(next);onChangeRef.current(next);
      reveal();hideLater();
    }
    setEditing(false);
  };
  const unit=knobToUnit(local,min,max);
  const angle=(-225+unit*270)*Math.PI/180;
  const ux=Math.cos(angle),uy=Math.sin(angle);
  const ticks=Array.from({length:11},(_,i)=>{
    const a=(-225+i*27)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    const long=i===0||i===5||i===10;
    return <line key={i} x1={28+22*c} y1={28+22*s}
      x2={28+(long?27.0:25.3)*c} y2={28+(long?27.0:25.3)*s}
      stroke={i/10<=unit+1e-6?accent:'#516068'}
      strokeWidth={long?1.8:1.2} strokeLinecap="round"
      opacity={i/10<=unit+1e-6?.96:.65}/>;
  });
  return <div className={'parameter-knob tactile-knob'+(compact?' compact':'')+
    (engaged?' is-engaged':'')}
    data-param={id} title={description||name}>
    <div className="knob-heading">{name}</div>
    <div role="slider" tabIndex={0} aria-orientation="vertical"
      data-testid={'knob-'+id} className="knob-target" aria-label={name}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={local} aria-valuetext={show(local)}
      onPointerDown={onPointerDown} onPointerUp={hideLater}
      onPointerCancel={hideLater} onKeyDown={onKeyDown}
      onDoubleClick={()=>{drag.current?.cancel();setEditing(true);}}>
      <svg className="knob-svg" viewBox="0 0 56 56" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId+'-skirt'} x1="0" y1="0" x2=".85" y2="1">
            <stop offset="0" stopColor="#414b52"/>
            <stop offset=".62" stopColor="#252b32"/>
            <stop offset="1" stopColor="#151c23"/>
          </linearGradient>
          <linearGradient id={gradientId+'-cap'} x1=".1" y1="0" x2=".9" y2="1">
            <stop offset="0" stopColor="#4b5960"/>
            <stop offset=".48" stopColor="#303a42"/>
            <stop offset="1" stopColor="#171e25"/>
          </linearGradient>
        </defs>
        {ticks}
        <circle cx="28" cy="28.9" r="21" fill="#080d10" opacity=".68"/>
        <circle cx="28" cy="28" r="20" fill={'url(#'+gradientId+'-skirt)'}
          stroke="#11181c" strokeWidth="1.4"/>
        {Array.from({length:16},(_,i)=>{
          const a=i*Math.PI/8, cos=Math.cos(a),sin=Math.sin(a);
          return <line key={i} x1={28+16*cos} y1={28+16*sin}
            x2={28+19*cos} y2={28+19*sin}
            stroke="#75838a" strokeWidth=".85" opacity=".38"/>;
        })}
        <circle cx="28" cy="28" r="14.2" fill={'url(#'+gradientId+'-cap)'}
          stroke="#697982" strokeWidth=".8"/>
        <path d={knobArc(0,unit)} fill="none" stroke={accent} strokeWidth="2.1"
          strokeLinecap="round" opacity={engaged?1:.68}/>
        <line x1={28+3*ux} y1={28+3*uy} x2={28+15.8*ux} y2={28+15.8*uy}
          stroke="#f8f9f7" strokeWidth="3" strokeLinecap="round"/>
        <circle cx="28" cy="28" r="2" fill="#f7f8f4" opacity=".84"/>
      </svg>
      {showBubble&&!editing&&<span className="knob-live-value" role="status">
        {name}<b>{show(local)}</b></span>}
    </div>
    {editing?
      <input ref={input} className="knob-entry" aria-label={name+' numeric value'}
        type="text" inputMode="decimal" value={draft} autoFocus
        onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')commit();if(e.key==='Escape'){setEditing(false);hideLater();}}}
        onBlur={commit}/>:
      <button type="button" className="knob-value" title="Tap for exact numeric entry"
        onClick={()=>setEditing(true)}>{show(local)}</button>}
  </div>;
}
