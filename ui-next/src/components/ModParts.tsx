import { Plus } from 'lucide-react';
import { shapeValue, targetInfo, type FxChain, type FxTarget, type ModShape } from '../fx';

/** Shared modulation pieces used by the mod band, the FX page and the Sound page. */
export type Source = {kind:'macro'|'mod',index:number};
export type Live = {params:number[],mods:number[],phases?:number[],/** Morph pad puck x, y and pad mix */puck?:number[],/** linked Sound knobs, where they are now */sound?:Record<string,number>,
  /** compressor gain reduction (dB) and resonator string notes */comp?:number,strings?:number[]};
export const MACRO_COLORS=['#f2c46d','#f08a5d','#e06c9f','#b38cf0','#7aa7f5','#5fd3c8','#8fd36a','#d9d36a'];
export const MOD_COLORS=['#5fd3a8','#6cb6f0','#f08ab0','#f2a65a','#c79df5','#e5d75a','#7ee0e8','#f27c7c'];
export const RATE_BEATS=[16,8,4,2,1,.5,.25];
export const SHAPE_LABEL:Record<ModShape,string>={sine:'Sine',triangle:'Triangle',saw:'Saw down',ramp:'Ramp up',square:'Square',
  pulse:'Pulse',random:'Random',smooth:'Smooth',steps:'Steps',curve:'Drawn'};
export const sourceTargets=(c:FxChain,s:Source)=>s.kind==='macro'?c.macros[s.index].targets:c.mods[s.index].targets;
export const withTargets=(c:FxChain,s:Source,t:FxTarget[]):FxChain=>s.kind==='macro'
  ?{...c,macros:c.macros.map((m,i)=>i===s.index?{...m,targets:t}:m)}
  :{...c,mods:c.mods.map((m,i)=>i===s.index?{...m,targets:t}:m)};
export const sourceColor=(s:Source)=>(s.kind==='macro'?MACRO_COLORS:MOD_COLORS)[s.index];

/** What a source is linked to, as a short list that never scrolls, with the button that opens the full list. */
export function LinkSummary({targets,onOpen}:{targets:FxTarget[];onOpen:()=>void}){
  const shown=targets.slice(0,2);
  return <div className="fx-targets compact">
    <span className="mod-group-label">Links{targets.length?' · '+targets.length:''}</span>
    {targets.length?shown.map((t,k)=>{const info=targetInfo(t);return <span key={k} className="link-chip" style={{['--fx-color' as string]:info.color}}>
      <i/><span className="link-label">{info.name} · {info.label}</span><b>{t.depth>0?'+':''}{Math.round(t.depth*100)}%</b></span>;})
      :<p className="mod-empty">Not linked yet.</p>}
    {targets.length>2?<span className="link-more">+{targets.length-2} more</span>:null}
    <button type="button" className="fx-add" onClick={onOpen}><Plus size={15}/>{targets.length?'Edit links':'Add target'}</button>
  </div>;
}

export function ShapePreview({shape,steps,phase,active,color,live,wide,count=16,points}:{shape:ModShape,steps:number[],phase:number,active:boolean,color:string,live?:number,wide?:boolean,
  count?:number,points?:[number,number][]}) {
  const W=wide?480:120,H=wide?90:44,mid=H/2,amp=H*.39;
  const N=wide?160:64;
  const pts=Array.from({length:N+1},(_,i)=>{const x=i/N;return (i?'L':'M')+(x*W).toFixed(1)+' '+(mid-shapeValue(shape,x,steps,0,count,points)*amp).toFixed(1);}).join(' ');
  const y=mid-(live??shapeValue(shape,phase,steps,0,count,points))*amp;
  return <svg className={'mod-shape'+(active?' active':'')} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
    <path d={pts} fill="none" stroke={color} strokeWidth={wide?3:2} opacity={active?1:.55}/>
    <line x1={phase*W} x2={phase*W} y1="2" y2={H-2} stroke="#ffffff55" strokeWidth="1"/>
    <circle cx={phase*W} cy={y} r={wide?6:4} fill={color} style={{filter:`drop-shadow(0 0 4px ${color})`}}/>
  </svg>;
}

