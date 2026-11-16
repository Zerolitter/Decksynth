import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** A non-modal inspector anchored to the source summary, without covering the whole workspace. */
export function SourceInspector({container,anchor,label,color,onClose,children}:{container:Element|null;anchor:Element|null;label:string;color:string;onClose:()=>void;children:ReactNode}){
  const section=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose;
  const [opener]=useState(()=>document.activeElement instanceof HTMLElement?document.activeElement:null);
  const [box,setBox]=useState({left:8,top:178,width:744,height:360});
  useLayoutEffect(()=>{
    if(!container||!anchor)return;
    // An anchor marked data-cover (the Link page editor) is covered by the inspector instead of opening below it.
    const place=()=>{const c=container.getBoundingClientRect(),a=anchor.getBoundingClientRect();
      if((anchor as HTMLElement).dataset?.cover){setBox({left:a.left-c.left,top:a.top-c.top,width:a.width,height:a.height});return;}
      const width=Math.min(744,Math.max(0,c.width-16));
      const top=Math.max(8,Math.min(a.bottom-c.top+6,c.height-160));
      setBox({left:Math.max(8,Math.min(a.right-c.left-width,c.width-width-8)),top,width,height:Math.min(360,Math.max(0,c.height-top-8))});};
    place();const observer=new ResizeObserver(place);observer.observe(container);observer.observe(anchor);window.addEventListener('resize',place);
    const shell=section.current;
    const outside=(e:PointerEvent)=>{const target=e.target as Node;if(!shell?.contains(target)&&!opener?.contains(target))close.current();};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close.current();}};
    document.addEventListener('pointerdown',outside,true);window.addEventListener('keydown',key);
    shell?.querySelector<HTMLElement>('[aria-selected="true"],button,input')?.focus({preventScroll:true});
    return()=>{observer.disconnect();window.removeEventListener('resize',place);document.removeEventListener('pointerdown',outside,true);window.removeEventListener('keydown',key);
      if(opener?.isConnected&&(document.activeElement===document.body||shell?.contains(document.activeElement)))opener.focus({preventScroll:true});};
  },[container,anchor,opener]);
  if(!container)return null;
  return createPortal(<section ref={section} className="mod-sheet source-inspector" role="dialog" aria-modal="false" aria-label={label}
    style={{['--src' as string]:color,left:box.left,top:box.top,width:box.width,maxHeight:box.height,...((anchor as HTMLElement|null)?.dataset?.cover?{height:box.height}:{})}}>{children}</section>,container);
}
