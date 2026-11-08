import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import type {Note} from '../types';import {bound,fitNotesView,zoomAt} from '../piano-viewport';
export function usePianoViewport(ref:RefObject<HTMLDivElement|null>,span:number,snap:number,notes:Note[],busy:()=>boolean,options:{pitches?:number[];compact?:boolean;rows?:number}={}){
 const pitches=options.pitches??Array.from({length:128},(_,i)=>127-i),firstPitch=options.compact?72:Math.floor((notes.length?Math.min(...notes.map(n=>n.note)):48)/12)*12+7,initialRow=Math.max(0,pitches.findIndex(n=>n<=firstPitch)),density=options.compact?24:44;

 const [timePx,setTimePx]=useState(options.compact?56:64),[rowHeight,setRowHeight]=useState(density),[panning,setPanning]=useState(false),[view,setView]=useState({left:0,top:initialRow*density,width:1032,height:376});
 const previousPitches=useRef(pitches);
 const initialized=useRef(!options.compact);
 const requested=useRef<{left:number;top:number}|null>({left:0,top:initialRow*density}),pan=useRef<{id:number;x:number;y:number;left:number;top:number}|null>(null),latest=useRef({timePx,rowHeight,span,snap,busy,pitches});latest.current={timePx,rowHeight,span,snap,busy,pitches};
 useLayoutEffect(()=>{const el=ref.current,old=previousPitches.current;previousPitches.current=pitches;if(!el||old.join(',')===pitches.join(','))return;const pitch=old[Math.max(0,Math.floor((el.scrollTop-24)/rowHeight))]??72;el.scrollTop=Math.max(0,pitches.findIndex(n=>n<=pitch))*rowHeight;measure();},[pitches.join(',')]);
 const measure=()=>{const el=ref.current;if(!el)return;setView(v=>v.left===el.scrollLeft&&v.top===el.scrollTop&&v.width===el.clientWidth&&v.height===el.clientHeight?v:{left:el.scrollLeft,top:el.scrollTop,width:el.clientWidth,height:el.clientHeight});};
 const cancel=()=>{const g=pan.current,el=ref.current;if(g&&el){el.scrollLeft=g.left;el.scrollTop=g.top;try{el.releasePointerCapture(g.id);}catch{}}pan.current=null;setPanning(false);measure();};
 useLayoutEffect(()=>{const el=ref.current;if(!el)return;if(!initialized.current&&el.clientWidth&&el.clientHeight){initialized.current=true;const row=Math.max(12,(el.clientHeight-24)/(options.rows??13));requested.current={left:0,top:initialRow*row};setTimePx((el.clientWidth-44)/16);setRowHeight(row);return;}if(requested.current){el.scrollLeft=requested.current.left;el.scrollTop=requested.current.top;requested.current=null;}measure();},[timePx,rowHeight,span,snap]);
 useEffect(()=>{const el=ref.current;if(!el)return;let raf=0;const update=()=>{if(el.contains(document.activeElement))el.focus({preventScroll:true});if(!raf)raf=requestAnimationFrame(()=>{raf=0;measure();});};
  const wheel=(e:WheelEvent)=>{if(latest.current.busy()||pan.current){e.preventDefault();e.stopPropagation();return;}if(!e.ctrlKey&&!e.altKey&&!e.shiftKey)return;e.preventDefault();e.stopPropagation();el.focus({preventScroll:true});if(latest.current.busy()||pan.current)return;const s=latest.current,r=el.getBoundingClientRect(),delta=(e.deltaY||e.deltaX)*(e.deltaMode===1?16:e.deltaMode===2?el.clientHeight:1);
   if(e.ctrlKey){const value=bound(s.timePx*Math.exp(-delta*.002),12,192);requested.current={left:zoomAt(el.scrollLeft,e.clientX-r.left,s.timePx,value,44),top:el.scrollTop};setTimePx(value);}
   else if(e.altKey){const value=bound(s.rowHeight*Math.exp(-delta*.002),12,88);requested.current={left:el.scrollLeft,top:zoomAt(el.scrollTop,e.clientY-r.top,s.rowHeight,value,24)};setRowHeight(value);}
   else el.scrollLeft+=delta;
  };
  el.addEventListener('wheel',wheel,{passive:false});el.addEventListener('scroll',update);const ro=new ResizeObserver(update);ro.observe(el);window.addEventListener('blur',cancel);
  return()=>{cancelAnimationFrame(raf);ro.disconnect();el.removeEventListener('wheel',wheel);el.removeEventListener('scroll',update);window.removeEventListener('blur',cancel);};
 },[]);
 const begin=(e:React.PointerEvent<HTMLDivElement>)=>{if(e.button!==1||latest.current.busy())return false;e.preventDefault();e.stopPropagation();e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);pan.current={id:e.pointerId,x:e.clientX,y:e.clientY,left:e.currentTarget.scrollLeft,top:e.currentTarget.scrollTop};setPanning(true);return true;};
 const move=(e:React.PointerEvent<HTMLDivElement>)=>{const g=pan.current;if(!g||g.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();e.currentTarget.scrollLeft=g.left+g.x-e.clientX;e.currentTarget.scrollTop=g.top+g.y-e.clientY;measure();};
 const end=(e:React.PointerEvent<HTMLDivElement>)=>{if(pan.current?.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();pan.current=null;setPanning(false);try{e.currentTarget.releasePointerCapture(e.pointerId);}catch{}measure();};
 const pitchAt=(y:number)=>{
  const el=ref.current;
  if(!el)return null;
  const r=el.getBoundingClientRect();
  if(y<r.top+24||y>=r.top+el.clientHeight)return null;
  return pitches[Math.floor((el.scrollTop+y-r.top-24)/rowHeight)]??null;
 };
 const locate=(x:number,y:number)=>{
  const el=ref.current,pitch=pitchAt(y);
  if(!el||pitch===null)return null;
  const r=el.getBoundingClientRect();
  if(x<r.left+44||x>=r.left+el.clientWidth)return null;
  const column=(el.scrollLeft+x-r.left-44)/timePx;
  if(column<0||column>=span/snap)return null;
  return {time:bound(Math.floor(column)*snap,0,span-snap),pitch};
 };
 const fit=(selected:Note[]=notes)=>{const el=ref.current;if(!el||latest.current.busy()||pan.current)return;const next=fitNotesView(selected,span,snap,el.clientWidth,el.clientHeight);if(selected.length){const high=Math.max(...selected.map(n=>n.note)),low=Math.min(...selected.map(n=>n.note)),top=Math.max(0,pitches.findIndex(n=>n<=high)-2),bottom=Math.max(top+4,pitches.findIndex(n=>n<=low)+2);next.rowHeight=bound((el.clientHeight-24)/(bottom-top+1),12,88);next.top=top*next.rowHeight;}requested.current={left:next.left,top:next.top};setTimePx(next.timePx);setRowHeight(next.rowHeight);requestAnimationFrame(()=>{if(requested.current){el.scrollLeft=next.left;el.scrollTop=next.top;requested.current=null;measure();}});};
 const time=(direction:number)=>ref.current?.scrollBy({left:direction*(view.width-44)*.8,behavior:'smooth'});
 const pitch=(direction:number)=>ref.current?.scrollBy({top:-direction*8*rowHeight,behavior:'smooth'});
 const firstCol=Math.max(0,Math.floor((view.left-44)/timePx)-1),lastCol=Math.min(Math.ceil(span/snap),Math.ceil((view.left+view.width-44)/timePx)+1),firstRow=Math.max(0,Math.floor((view.top-24)/rowHeight)-1),lastRow=Math.min(pitches.length,Math.ceil((view.top+view.height-24)/rowHeight)+1);
 const timeTo=(time:number)=>{if(ref.current){ref.current.scrollLeft=time/snap*timePx;measure();}};
 const pitchTo=(pitch:number)=>{if(ref.current){ref.current.scrollTop=Math.max(0,pitches.findIndex(n=>n<=pitch))*rowHeight;measure();}};
 return {...view,timeTo,pitchTo,timePx,rowHeight,panning,firstCol,lastCol,firstRow,lastRow,begin,move,end,cancel,locate,pitchAt,fit,time,pitch,active:()=>!!pan.current};
}
