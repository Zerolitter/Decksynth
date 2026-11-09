import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown} from 'lucide-react';

const values=[1,2,4,8];
/** Clip content length, using the existing discrete-choice button vocabulary.
 * The portal keeps the opened choices outside the transport LCD's clipping. */
export function LoopBars({value,onChange}:{value:number;onChange(value:number):void}){
 const id=useId(),trigger=useRef<HTMLButtonElement>(null),list=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState<{left:number;top:number}|null>(null);
 const [focus,setFocus]=useState(value);
 const close=(restore=false)=>{setPosition(null);if(restore)trigger.current?.focus();};
 const open=()=>{const r=trigger.current?.getBoundingClientRect();if(r){setFocus(value);setPosition({left:r.left,top:r.bottom+4});}};
 useEffect(()=>{
  if(!position)return;
  list.current?.querySelector<HTMLButtonElement>(`[data-bars="${focus}"]`)?.focus();
 },[position,focus]);
 useEffect(()=>{
  if(!position)return;
  const outside=(e:PointerEvent)=>{if(!list.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setPosition(null);};
  const resize=()=>setPosition(null);
  document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',resize);
  return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',resize);};
 },[position]);
 return <>
  <button ref={trigger} type="button" className="loop-bars-trigger" aria-label="Loop bars"
   title="Clip loop length · changes notes in all clips" aria-haspopup="listbox" aria-expanded={!!position} aria-controls={position?id:undefined}
   onClick={()=>position?close():open()} onKeyDown={e=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open();}
    if(e.key==='Escape'&&position){e.preventDefault();close(true);}
   }}>{value} {value===1?'BAR':'BARS'}<ChevronDown size={13} aria-hidden="true"/></button>
  {position?createPortal(<div ref={list} id={id} role="listbox" aria-label="Clip loop length" data-context-ignore
   className="loop-bars-choices" style={position} onBlur={e=>{
    if(!e.currentTarget.contains(e.relatedTarget as Node)&&e.relatedTarget!==trigger.current)setPosition(null);
   }} onKeyDown={e=>{
    const index=values.indexOf(focus);
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
     e.preventDefault();setFocus(e.key==='Home'?1:e.key==='End'?8:values[(index+(e.key==='ArrowDown'?1:3))%4]);
    }else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}
    else if(e.key==='Tab'){trigger.current?.focus();setPosition(null);}
   }}>
   {values.map(n=><button key={n} type="button" role="option" aria-selected={value===n} data-bars={n} tabIndex={focus===n?0:-1}
    onClick={()=>{if(n!==value)onChange(n);close(true);}}>{n} {n===1?'bar':'bars'}</button>)}
  </div>,document.body):null}
 </>;
}
