/* On-knob depth (UI-RULES §6): while a source is linking, drag the outer ring of a knob it is linked to
   and that link's depth follows. A tap anywhere on the knob still links or unlinks it. */
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { depthAt, ringDelta } from '../depth';
import { sourceColor, sourceTargets, withTargets, type Source } from './ModParts';
import type { FxChain } from '../fx';

type Drag={x0:number;y0:number;v0:number;length:number;fine:boolean;held:ReturnType<typeof setTimeout>|null;moved:boolean;
  lastX:number;lastY:number;lastT:number;v:number;module:string;param:string};

export function useRingDepth(chain:FxChain,onChain:((c:FxChain)=>void)|undefined,armed:Source|null|undefined,
  toggle:(module:string,param:string)=>void){
  const [bubble,setBubble]=useState<{x:number;y:number;v:number;fine:boolean}|null>(null);
  const d=useRef<Drag|null>(null);
  const capture=(module:string,param:string)=>(e:React.PointerEvent)=>{
    if(!armed||e.button>0)return;
    const t=sourceTargets(chain,armed);const at=t.findIndex(x=>x.module===module&&x.param===param);
    const dial=(e.currentTarget as Element).querySelector('.knob-svg');
    const r=dial?.getBoundingClientRect();
    const dist=r?Math.hypot(e.clientX-(r.left+r.width/2),e.clientY-(r.top+r.height/2)):0;
    // Only the outer ring of a knob that is already linked starts a depth drag.
    if(at<0||!r||!onChain||dist<r.width*.3||dist>r.width/2+10){
      // Sir, 16 Nov: knobs still turn while linking. A tap links or unlinks; a drag turns the knob as usual.
      const x0=e.clientX,y0=e.clientY,t0=performance.now();let moved=false;
      let travel=0;const mv=(ev:PointerEvent)=>{travel+=Math.abs(ev.movementX||0)+Math.abs(ev.movementY||0);if(travel>6||Math.hypot(ev.clientX-x0,ev.clientY-y0)>6)moved=true;};
      const end=(ok:boolean)=>()=>{window.removeEventListener('pointermove',mv,true);window.removeEventListener('pointerup',upT,true);window.removeEventListener('pointercancel',cancelT,true);
        if(ok&&!moved&&performance.now()-t0<600)toggle(module,param);};
      const upT=end(true),cancelT=end(false);
      window.addEventListener('pointermove',mv,true);window.addEventListener('pointerup',upT,true);window.addEventListener('pointercancel',cancelT,true);
      return;}
    e.stopPropagation();e.preventDefault();
    const el=e.currentTarget as Element;el.setPointerCapture?.(e.pointerId);
    const s:Drag={x0:e.clientX,y0:e.clientY,v0:t[at].depth,length:r.width,fine:false,held:null,moved:false,
      lastX:e.clientX,lastY:e.clientY,lastT:performance.now(),v:t[at].depth,module,param};
    s.held=setTimeout(()=>{if(d.current===s){s.fine=true;setBubble(b=>b&&{...b,fine:true});}},400);
    d.current=s;setBubble({x:r.left+r.width/2,y:r.top,v:s.v0,fine:false});
    const move=(ev:PointerEvent)=>{const g=d.current;if(!g)return;
      const dx=ev.clientX-g.x0,dy=ev.clientY-g.y0;
      if(Math.hypot(dx,dy)>3){g.moved=true;if(g.held){clearTimeout(g.held);g.held=null;}}
      const now=performance.now(),fast=Math.hypot(ev.clientX-g.lastX,ev.clientY-g.lastY)/Math.max(1,now-g.lastT)>1;
      g.lastX=ev.clientX;g.lastY=ev.clientY;g.lastT=now;
      g.v=depthAt(g.v0,ringDelta(dx,dy),{length:g.length,fine:g.fine,fast});
      setBubble(b=>b&&{...b,v:g.v,fine:g.fine});};
    const stop=(commit:boolean)=>()=>{const g=d.current;window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);
      if(g?.held)clearTimeout(g.held);d.current=null;setBubble(null);
      if(!g||!armed)return;
      if(!g.moved){if(commit)toggle(g.module,g.param);return;}
      if(commit&&g.v!==g.v0){const cur=sourceTargets(chain,armed);
        onChain!(withTargets(chain,armed,cur.map(x=>x.module===g.module&&x.param===g.param?{...x,depth:g.v}:x)));}};
    const up=stop(true),cancel=stop(false);
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);
  };
  const node:ReactNode=bubble&&armed?createPortal(<b className="ring-bubble" role="status"
    style={{left:bubble.x,top:bubble.y,['--src' as string]:sourceColor(armed)}}>
    {(bubble.v>0?'+':'')+Math.round(bubble.v*100)}%{bubble.fine?' fine':''}</b>,document.body):null;
  return {capture,bubble:node};
}
