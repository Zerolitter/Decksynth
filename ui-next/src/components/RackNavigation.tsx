import {useEffect,useRef,useState,type RefObject} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
/** Native pointer ownership keeps panning separate from card reorder and parameter editing. */
export function useRackNavigation(ref:RefObject<HTMLElement|null>,key:string){
 const [edges,setEdges]=useState({left:false,right:true}),pan=useRef<{id:number;x:number;start:number;target:HTMLElement}|null>(null);
 useEffect(()=>{const el=ref.current;if(!el)return;let frame=0,space=false;
  const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const controls=el.querySelector<HTMLElement>('.rack-scroll-controls'),overflow=el.scrollWidth-(controls?controls.offsetWidth+8:0)>el.clientWidth+1;const next={left:overflow&&el.scrollLeft>1,right:overflow&&el.scrollWidth-el.clientWidth-el.scrollLeft>1};setEdges(old=>old.left===next.left&&old.right===next.right?old:next);el.dataset.overflowLeft=String(next.left);el.dataset.overflowRight=String(next.right);});};
  // Reserve navigation in the first render so a saved end position is not clamped before it mounts.
  try{el.scrollLeft=Number(sessionStorage.getItem(key)||0);}catch{}
  const scroll=()=>{try{sessionStorage.setItem(key,String(el.scrollLeft));}catch{}measure();};
  const wheel=(e:WheelEvent)=>{if(!e.deltaX&&!e.shiftKey)return;e.preventDefault();e.stopPropagation();el.scrollLeft+=e.deltaX||e.deltaY;};
  const finish=(cancel=false)=>{const active=pan.current;if(!active)return;if(cancel)el.scrollLeft=active.start;pan.current=null;delete el.dataset.rackPanning;try{active.target.releasePointerCapture(active.id);}catch{}scroll();};
  const down=(e:PointerEvent)=>{const target=e.target as HTMLElement;if(target.closest('input,textarea,select'))return;
   if(e.button!==1&&!(e.button===0&&space&&!target.closest('[data-panel],button')))return;
   e.preventDefault();e.stopImmediatePropagation();el.focus({preventScroll:true});pan.current={id:e.pointerId,x:e.clientX,start:el.scrollLeft,target:el};el.dataset.rackPanning='true';el.setPointerCapture(e.pointerId);};
  const move=(e:PointerEvent)=>{if(pan.current?.id!==e.pointerId)return;e.preventDefault();el.scrollLeft=pan.current.start+pan.current.x-e.clientX;};
  const up=(e:PointerEvent)=>{if(pan.current?.id===e.pointerId){e.preventDefault();e.stopImmediatePropagation();finish();}};
  const cancel=()=>finish(true),keyDown=(e:KeyboardEvent)=>{if(e.key==='Escape'&&pan.current){e.preventDefault();e.stopPropagation();cancel();return;}
   if(!el.contains(document.activeElement))return;if((e.target as HTMLElement).closest('input,textarea,select'))return;
   if(e.key===' '&&document.activeElement===el){space=true;e.preventDefault();e.stopPropagation();}
   if(e.ctrlKey||e.altKey||e.metaKey)return;
   if(['Home','End'].includes(e.key)&&(document.activeElement===el||(e.target as HTMLElement).closest('.ds-panel-title,.rail-open'))){const cards=Array.from(el.querySelectorAll<HTMLElement>('[data-panel] .ds-panel-title,[data-panel] .rail-open'));const target=cards[e.key==='Home'?0:cards.length-1];e.preventDefault();e.stopPropagation();target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest',inline:'nearest'});}
  },keyUp=(e:KeyboardEvent)=>{if(e.key===' ')space=false;};
  el.addEventListener('wheel',wheel,{passive:false});el.addEventListener('scroll',scroll);el.addEventListener('pointerdown',down,true);el.addEventListener('pointermove',move,true);el.addEventListener('pointerup',up,true);el.addEventListener('pointercancel',cancel,true);window.addEventListener('keydown',keyDown,true);window.addEventListener('keyup',keyUp,true);window.addEventListener('blur',cancel);
  const ro=new ResizeObserver(measure);ro.observe(el);const mo=new MutationObserver(measure);mo.observe(el,{childList:true,subtree:true});measure();
  return()=>{finish(true);cancelAnimationFrame(frame);ro.disconnect();mo.disconnect();el.removeEventListener('wheel',wheel);el.removeEventListener('scroll',scroll);el.removeEventListener('pointerdown',down,true);el.removeEventListener('pointermove',move,true);el.removeEventListener('pointerup',up,true);el.removeEventListener('pointercancel',cancel,true);window.removeEventListener('keydown',keyDown,true);window.removeEventListener('keyup',keyUp,true);window.removeEventListener('blur',cancel);};
 },[ref,key]);
 return {...edges,scroll:(direction:number)=>{const el=ref.current;if(el)el.scrollLeft+=direction*Math.max(160,el.clientWidth*.6);}};
}
export function RackScrollControls({label,nav}:{label:string;nav:ReturnType<typeof useRackNavigation>}){
 if(!nav.left&&!nav.right)return null;
 return <div className="rack-scroll-controls" role="group" aria-label={label+' card scrolling'}><button type="button" aria-label={'Scroll '+label+' cards left'} disabled={!nav.left} onClick={()=>nav.scroll(-1)} title="Scroll left · Shift+wheel or middle-drag also pans"><ChevronLeft size={19}/></button><button type="button" aria-label={'Scroll '+label+' cards right'} disabled={!nav.right} onClick={()=>nav.scroll(1)} title="Scroll right · Shift+wheel or middle-drag also pans"><ChevronRight size={19}/></button></div>;
}
