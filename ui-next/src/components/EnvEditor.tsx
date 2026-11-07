/* Envelope editor (PLAN E1): real proportions, three handles, the ADSR knobs under it.
   Time runs on a square-root scale so short attacks stay visible; level is linear, as the engine plays it. */
import { useEffect, useRef, useState } from 'react';
import { useSize } from './ModSheet';

export type Env={attack:number;decay:number;sustain:number;release:number};
type Key=keyof Env;
const MAX=3;
export const ENV_MIN:Record<'attack'|'decay'|'release',number>={attack:.001,decay:.001,release:.01};
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
/** Seconds to 0…1 along the time axis, and back. */
export const toU=(t:number,min:number)=>Math.sqrt(clamp((t-min)/(MAX-min),0,1));
export const fromU=(u:number,min:number)=>min+clamp(u,0,1)**2*(MAX-min);

/** Where each corner sits, in px: the sustain plateau is a fixed share so the note-off marker never moves far. */
export function envGeometry(e:Env,w:number,h:number,pad=12,bottom=0){
  const inner=w-2*pad, hold=inner*.16, zone=(inner-hold)/3, top=pad, base=h-pad-bottom;
  const y=(l:number)=>base-(base-top)*clamp(l,0,1);
  const ax=pad+toU(e.attack,ENV_MIN.attack)*zone;
  const dx=ax+toU(e.decay,ENV_MIN.decay)*zone;
  const nx=dx+hold;
  const rx=nx+toU(e.release,ENV_MIN.release)*zone;
  return {pad,zone,top,base,y,start:[pad,base],a:[ax,y(1)],d:[dx,y(e.sustain)],n:[nx,y(e.sustain)],r:[rx,base]} as const;
}

const fmt=(k:Key,v:number)=>k==='sustain'?Math.round(v*100)+'%':v<1?Math.round(v*1000)+' ms':v.toFixed(2)+' s';

/** Small, honest envelope picture for the card. Tapping it opens the editor. */
export function EnvelopeGraph({p}:{p:Env}){
  const w=120,h=56,g=envGeometry(p,w,h,6);
  const line=`M${g.start} L${g.a} L${g.d} L${g.n} L${g.r}`;
  return <svg className="env-graph" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Envelope shape" style={{color:'var(--panel-tag,#f2c46d)'}}>
    <path d={line+` L${g.r[0]},${g.base} Z`} fill="currentColor" opacity={.12}/>
    <path d={`M${g.start} L${g.a} L${g.d}`} stroke="currentColor" fill="none" strokeWidth={2} strokeLinejoin="round"/>
    <path d={`M${g.d} L${g.n}`} stroke="currentColor" fill="none" strokeWidth={2} strokeDasharray="3 3"/>
    <path d={`M${g.n} L${g.r}`} stroke="currentColor" fill="none" strokeWidth={2}/>
  </svg>;
}

type Drag={key:'a'|'d'|'r';x0:number;y0:number;start:Env;fine:boolean;held:ReturnType<typeof setTimeout>|null};

/** The big editor: drag Attack sideways, Decay sideways and Sustain up and down, Release sideways.
 *  Drags are relative (no jump on touch); hold still for 0.4 s before moving for fine steps. */
export function EnvEditor({env,color,onChange,live,compact=false}:{env:Env;color:string;onChange:(k:Key,v:number)=>void;live?:Partial<Env>;compact?:boolean}){
  const [ref,{w,h}]=useSize<HTMLDivElement>();
  const [drag,setDrag]=useState<Drag|null>(null);
  const d=useRef<Drag|null>(null);
  const pad=compact?22:16,bottom=compact?0:18;
  const g=envGeometry(env,w,h,pad,bottom);
  const lv={...env,...Object.fromEntries(Object.entries(live??{}).filter(([,v])=>typeof v==='number'))} as Env;
  const moved=JSON.stringify(lv)!==JSON.stringify(env)?envGeometry(lv,w,h,pad,bottom):null;
  useEffect(()=>()=>{if(d.current?.held)clearTimeout(d.current.held);d.current=null;},[]);
  const begin=(key:Drag['key'])=>(e:React.PointerEvent)=>{
    e.stopPropagation();(e.currentTarget as Element).setPointerCapture(e.pointerId);
    if(compact&&ref.current){
      const r=ref.current.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
      // Large touch targets may overlap on a short envelope. The nearest visible dot owns the drag.
      key=(['a','d','r'] as const).reduce((a,b)=>Math.hypot(x-g[a][0],y-g[a][1])<=Math.hypot(x-g[b][0],y-g[b][1])?a:b);
    }
    const s:Drag={key,x0:e.clientX,y0:e.clientY,start:{...env},fine:false,held:null};
    s.held=setTimeout(()=>{if(d.current===s){s.fine=true;setDrag({...s});}},400);
    d.current=s;setDrag(s);};
  const move=(e:React.PointerEvent)=>{const s=d.current;if(!s)return;
    const dx=e.clientX-s.x0,dy=e.clientY-s.y0;
    if(s.held&&Math.hypot(dx,dy)>3){clearTimeout(s.held);s.held=null;}
    const k=s.fine?5:1, du=dx/g.zone/k;
    if(s.key==='a')onChange('attack',+fromU(toU(s.start.attack,ENV_MIN.attack)+du,ENV_MIN.attack).toFixed(3));
    if(s.key==='r')onChange('release',+fromU(toU(s.start.release,ENV_MIN.release)+du,ENV_MIN.release).toFixed(3));
    if(s.key==='d'){onChange('decay',+fromU(toU(s.start.decay,ENV_MIN.decay)+du,ENV_MIN.decay).toFixed(3));
      onChange('sustain',+clamp(s.start.sustain-dy/(g.base-g.top)/k,0,1).toFixed(3));}};
  const end=()=>{const s=d.current;if(s?.held)clearTimeout(s.held);d.current=null;setDrag(null);};
  const cancel=()=>{const s=d.current;end();if(s)(Object.keys(s.start) as Key[]).forEach(k=>s.start[k]!==env[k]&&onChange(k,s.start[k]));};
  const handle=(key:Drag['key'],at:readonly number[],label:string,keys:Key[])=>{
    const on=drag?.key===key;
    return <g className={'env-handle'+(on?' dragging':'')} role="slider" tabIndex={0} aria-label={label}
      aria-valuetext={keys.map(k=>k+' '+fmt(k,env[k])).join(', ')} data-handle={key}
      onPointerDown={begin(key)}
      onKeyDown={e=>{const step=e.shiftKey?.01:.05;const k=keys[0],min=ENV_MIN[k as 'attack'];
        if(e.key.startsWith('Arrow')){e.preventDefault();e.stopPropagation();}
        if(e.key==='ArrowRight'||e.key==='ArrowLeft'){const s=e.key==='ArrowRight'?step:-step;onChange(k,+fromU(toU(env[k],min)+s,min).toFixed(3));}
        if(key==='d'&&(e.key==='ArrowUp'||e.key==='ArrowDown'))onChange('sustain',clamp(env.sustain+(e.key==='ArrowUp'?step:-step),0,1));}}>
      <circle cx={at[0]} cy={at[1]} r={22} fill="transparent"/>
      <circle cx={at[0]} cy={at[1]} r={on?8:6} fill={on?'#fff':color} stroke="#fff" strokeWidth={2}/>
      {on?<g className="env-bubble" transform={`translate(${clamp(at[0],50,w-50)},${Math.max(18,at[1]-22)})`}>
        <rect x={-46} y={-13} width={92} height={22} rx={6}/>
        <text textAnchor="middle" y={3}>{keys.map(k=>fmt(k,env[k])).join(' · ')}{drag?.fine?' fine':''}</text></g>:null}
    </g>;};
  const line=`M${g.start} L${g.a} L${g.d}`;
  return <div ref={ref} className={'env-editor'+(compact?' compact':'')} style={{['--env' as string]:color}}
    onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}>
    <svg width={w} height={h} role="group" aria-label="Envelope editor">
      <line x1={g.pad} x2={w-g.pad} y1={g.base} y2={g.base} className="env-axis"/>
      <line x1={g.n[0]} x2={g.n[0]} y1={g.top} y2={g.base} className="env-noteoff"/>
      {compact?null:<text x={g.n[0]+4} y={g.top+10} className="env-tag">note off</text>}
      {compact?null:(['Attack','Decay','Sustain','Release'] as const).map((t,i)=>{const xs=[g.start[0],g.a[0],g.d[0],g.n[0],g.r[0]];
        const x=i===2?(g.d[0]+g.n[0])/2:(xs[i>2?3:i]+xs[i>2?4:i+1])/2;
        return <text key={t} x={x} y={h-4} textAnchor="middle" className="env-tag">{t}</text>;})}
      <path d={line+` L${g.n} L${g.r} Z`} fill={color} opacity={.12}/>
      {moved?<path d={`M${moved.start} L${moved.a} L${moved.d} L${moved.n} L${moved.r}`} className="env-live" pointerEvents="none"/>:null}
      <path d={line} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" pointerEvents="none"/>
      <path d={`M${g.d} L${g.n}`} fill="none" stroke={color} strokeWidth={3} strokeDasharray="6 5" pointerEvents="none"/>
      <path d={`M${g.n} L${g.r}`} fill="none" stroke={color} strokeWidth={3} pointerEvents="none"/>
      {handle('a',g.a,'Attack handle',['attack'])}
      {handle('d',g.d,'Decay and sustain handle',['decay','sustain'])}
      {handle('r',g.r,'Release handle',['release'])}
    </svg>
  </div>;
}
