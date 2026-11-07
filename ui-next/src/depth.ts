/* Bipolar depth mapping (UI-RULES §6), shared by the depth bar and the knob ring. Pure, so it is unit tested. */

export const DETENT_PX=12;
export const MIN_TRAVEL=200;
const clamp=(v:number)=>Math.min(1,Math.max(-1,v));

/** Depth after moving `delta` px from where the drag started at `v0`.
 *  travel = max(200 px, control length); fine mode is 5× slower; crossing 0 sticks there for 12 px;
 *  values snap to 1 %, or 5 % while moving fast outside fine mode. */
export function depthAt(v0:number,delta:number,{length=0,fine=false,fast=false}:{length?:number;fine?:boolean;fast?:boolean}={}):number{
  const travel=Math.max(MIN_TRAVEL,length)*(fine?5:1);
  let v=v0+delta/travel;
  if(v0!==0&&Math.sign(v)!==Math.sign(v0)){
    const past=Math.abs(v)*travel;
    v=past<DETENT_PX?0:Math.sign(v)*(past-DETENT_PX)/travel;
  }
  const q=fast&&!fine?20:100;
  return clamp(Math.round(v*q)/q);
}

/** The movement along a ring: vertical or horizontal, whichever is bigger (up and right are positive). */
export const ringDelta=(dx:number,dy:number)=>Math.abs(dx)>=Math.abs(dy)?dx:-dy;

/** Text for exact entry: "+35", "-20 %", "0.5" (read as 50 %). Returns null when it can't be read. */
export function parseDepth(text:string):number|null{
  const t=text.replace(/[%\s]/g,'').replace('−','-').replace(',','.');
  if(!/^[-+]?\d*\.?\d+$/.test(t))return null;
  const n=Number(t);
  return clamp(Math.abs(n)<=1&&t.includes('.')?n:n/100);
}
