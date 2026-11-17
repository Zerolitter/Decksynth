import { useMemo, useRef } from 'react';
import { Plus } from 'lucide-react';
import { useFrame } from '../frame-clock';
import { shapeValue, targetInfo, type FxChain, type FxTarget, type ModShape } from '../fx';

/** Shared modulation pieces used by the mod band, the FX page and the Sound page. */
export type Source = {kind:'macro'|'mod',index:number};
export type Live = {partials?:number[]|null;gate?:import('../fx').GateRuntime|null;params:number[],mods:number[],phases?:number[],/** Morph pad puck x, y and pad mix */puck?:number[],/** linked Sound knobs, where they are now */sound?:Record<string,number>,
  /** compressor gain reduction (dB) and resonator string notes */comp?:number,strings?:number[],
  /** Auto-tune: note heard (MIDI, 0 = none) and its correction in cents; Ducking: how far it pushes down (dB) */
  readout?:{note:number;cents:number;duck:number}|null};
export const MACRO_COLORS=['#f2c46d','#f08a5d','#e06c9f','#b38cf0','#7aa7f5','#5fd3c8','#8fd36a','#d9d36a'];
export const MOD_COLORS=['#f2a65a','#6cb6f0','#f08ab0','#5fd3a8','#c79df5','#e5d75a','#7ee0e8','#f27c7c'];
/** Beats per cycle, by saved rate number (8 and 16 bars appended 15 Nov). */
export const RATE_BEATS=[16,8,4,2,1,.5,.25,32,64,128];
export const SHAPE_LABEL:Record<ModShape,string>={sine:'Sine',triangle:'Triangle',saw:'Saw down',ramp:'Ramp up',square:'Square',
  pulse:'Pulse',random:'Random',smooth:'Smooth',steps:'Steps',curve:'Drawn',
  cosine:'Cosine',half_sine:'Half sine',exp_up:'Exp rise',log_up:'Fast rise',exp_down:'Decay',log_down:'Late fall',
  s_curve:'S-curve',shark:'Shark fin',double_sine:'Sine ×2',warm:'Sine + tri',
  pluck:'Pluck',swell:'Swell',ad:'Attack-decay',trapezoid:'Trapezoid',ramp_hold:'Rise & hold',pump:'Pump',pump2:'Pump ×2',
  bounce:'Bounce',heartbeat:'Heartbeat',wobble:'Wobble',
  pulse_narrow:'Pulse 1/8',pulse_wide:'Pulse 3/4',gate2:'Gate ×2',gate3:'Gate ×3',gate4:'Gate ×4',trance:'Trance gate',
  euclid5:'Euclid 5',offbeat:'Off-beat',stairs4:'Stairs 4',stairs8:'Stairs 8',
  sh16:'S&H 16',drift:'Drift'};
export const sourceTargets=(c:FxChain,s:Source)=>s.kind==='macro'?c.macros[s.index].targets:c.mods[s.index].targets;
export const withTargets=(c:FxChain,s:Source,t:FxTarget[]):FxChain=>s.kind==='macro'
  ?{...c,macros:c.macros.map((m,i)=>i===s.index?{...m,targets:t}:m)}
  :{...c,mods:c.mods.map((m,i)=>i===s.index?{...m,targets:t}:m)};
export const sourceColor=(s:Source)=>(s.kind==='macro'?MACRO_COLORS:MOD_COLORS)[s.index];
export function linkedSourceColors(chain:FxChain,accept:(target:FxTarget)=>boolean):string[]{
  return [...chain.macros.flatMap((s,i)=>s.targets.some(accept)?[MACRO_COLORS[i]]:[]),
    ...chain.mods.flatMap((s,i)=>s.targets.some(accept)?[MOD_COLORS[i]]:[])];
}

/** What a source is linked to, as a short list that never scrolls, with the button that opens the full list. */
export function LinkSummary({targets,onOpen}:{targets:FxTarget[];onOpen:()=>void}){
  const shown=targets.slice(0,2);
  return <div className="fx-targets compact">
    <span className="mod-group-label">Links{targets.length?' · '+targets.length:''}</span>
    {targets.length?shown.map((t,k)=>{const info=targetInfo(t);return <span key={k} className="link-chip" style={{['--fx-color' as string]:info.color}}>
      <i/><span className="link-label">{info.name} · {info.label}</span><b>{t.depth>0?'+':''}{Math.round(t.depth*100)}%</b></span>;})
      :<p className="mod-empty">Not linked yet.</p>}
    <button type="button" className="fx-add" onClick={onOpen}><Plus size={15}/>{targets.length?'Edit links':'Add target'}</button>
  </div>;
}

/** A value that is either fixed or read on every frame (so the moving dot never needs a React render). */
type Live1<T>=T|(()=>T);
const read=<T,>(v:Live1<T>):T=>typeof v==='function'?(v as ()=>T)():v;

/** A mod shape with its moving dot, drawn on a canvas. The curve is painted once into an offscreen layer; each frame only
 * copies it and draws the playhead and dot (`useFrame`). `phase` and `live` may be functions, read on each frame. */
export function ShapePreview({shape,steps,phase,active,color,live,wide,count=16,points}:{shape:ModShape,steps:number[],phase:Live1<number>,active:boolean,color:string,live?:Live1<number|undefined>,wide?:boolean,
  count?:number,points?:[number,number][]}) {
  const W=wide?480:120,H=wide?90:44,S=2,mid=H/2,amp=H*.39;
  const canvas=useRef<HTMLCanvasElement>(null);
  const layer=useMemo(()=>{
    if(typeof document==='undefined')return null;
    const c=document.createElement('canvas');c.width=W*S;c.height=H*S;
    const g=c.getContext('2d');if(!g)return null;
    const N=wide?160:64;
    g.scale(S,S);g.beginPath();
    for(let i=0;i<=N;i++){const x=i/N,y=mid-shapeValue(shape,x,steps,0,count,points)*amp;if(i)g.lineTo(x*W,y);else g.moveTo(x*W,y);}
    g.strokeStyle=color;g.lineWidth=wide?3:2;g.globalAlpha=active?1:.55;g.lineJoin='round';g.stroke();
    return c;
  },[shape,steps,count,points,color,active,wide,W,H,mid,amp]);
  useFrame(()=>{
    const c=canvas.current,g=c?.getContext('2d');if(!c||!g)return;
    const p=read(phase),v=read(live);
    g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,c.width,c.height);
    if(layer)g.drawImage(layer,0,0);
    g.scale(S,S);
    const x=p*W,y=mid-(v??shapeValue(shape,p,steps,0,count,points))*amp;
    g.strokeStyle='rgba(255,255,255,.33)';g.lineWidth=1;g.beginPath();g.moveTo(x,2);g.lineTo(x,H-2);g.stroke();
    g.shadowColor=color;g.shadowBlur=4;g.fillStyle=color;g.beginPath();g.arc(x,y,wide?6:4,0,Math.PI*2);g.fill();
  });
  return <canvas ref={canvas} className={'mod-shape'+(active?' active':'')} width={W*S} height={H*S} aria-hidden="true"/>;
}
