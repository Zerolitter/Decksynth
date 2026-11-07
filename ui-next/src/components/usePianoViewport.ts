import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import type {Note} from '../types';import {bound,fitNotesView,zoomAt} from '../piano-viewport';
export function usePianoViewport(ref:RefObject<HTMLDivElement|null>,span:number,snap:number,notes:Note[],busy:()=>boolean){
 const initial=useRef(Math.max(0,Math.min(120,Math.floor((notes.length?Math.min(...notes.map(n=>n.note)):48)/12)*12)));
 const [timePx,setTimePx]=useState(64),[rowHeight,setRowHeight]=useState(44),[panning,setPanning]=useState(false),[view,setView]=useState({left:0,top:(127-initial.current-7)*44,width:1032,height:376});
 const requested=useRef<{left:number;top:number}|null>({left:0,top:(127-initial.current-7)*44}),pan=useRef<{id:number;x:number;y:number;left:number;top:number}|null>(null),latest=useRef({timePx,rowHeight,span,snap,busy});latest.current={timePx,rowHeight,span,snap,busy};
 const measure=()=>{const el=ref.current;if(!el)return;setView(v=>v.left===el.scrollLeft&&v.top===el.scrollTop&&v.width===el.clientWidth&&v.height===el.clientHeight?v:{left:el.scrollLeft,top:el.scrollTop,width:el.clientWidth,height:el.clientHeight});};
 const cancel=()=>{const g=pan.current,el=ref.current;if(g&&el){el.scrollLeft=g.left;el.scrollTop=g.top;try{el.releasePointerCapture(g.id);}catch{}}pan.current=null;setPanning(false);measure();};
 useLayoutEffect(()=>{const el=ref.current;if(!el)return;if(requested.current){el.scrollLeft=requested.current.left;el.scrollTop=requested.current.top;requested.current=null;}measure();},[timePx,rowHeight,span,snap]);
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
 const locate=(x:number,y:number)=>{const el=ref.current;if(!el)return null;const r=el.getBoundingClientRect();if(x<r.left+44||x>=r.right||y<r.top+24||y>=r.bottom)return null;const column=(el.scrollLeft+x-r.left-44)/timePx,row=(el.scrollTop+y-r.top-24)/rowHeight;if(column<0||column>=span/snap||row<0||row>=128)return null;return {time:bound(Math.floor(column)*snap,0,span-snap),pitch:127-Math.floor(row)};};
 const fit=(selected:Note[]=notes)=>{const el=ref.current;if(!el||latest.current.busy()||pan.current)return;const next=fitNotesView(selected,span,snap,el.clientWidth,el.clientHeight);requested.current={left:next.left,top:next.top};setTimePx(next.timePx);setRowHeight(next.rowHeight);requestAnimationFrame(()=>{if(requested.current){el.scrollLeft=next.left;el.scrollTop=next.top;requested.current=null;measure();}});};
 const time=(direction:number)=>ref.current?.scrollBy({left:direction*(view.width-44)*.8,behavior:'smooth'});
 const pitch=(direction:number)=>ref.current?.scrollBy({top:-direction*8*rowHeight,behavior:'smooth'});
 const firstCol=Math.max(0,Math.floor((view.left-44)/timePx)-1),lastCol=Math.min(Math.ceil(span/snap),Math.ceil((view.left+view.width-44)/timePx)+1),firstRow=Math.max(0,Math.floor((view.top-24)/rowHeight)-1),lastRow=Math.min(128,Math.ceil((view.top+view.height-24)/rowHeight)+1);
 return {...view,timePx,rowHeight,panning,firstCol,lastCol,firstRow,lastRow,begin,move,end,cancel,locate,fit,time,pitch,active:()=>!!pan.current};
}
