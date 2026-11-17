import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown} from 'lucide-react';

/** Clip loop lengths in bars (engine BAR_CHOICES). */
export const BAR_CHOICES=[1,2,4,8,16,32];
/** Pattern lengths offered in the SEQ steps list (engine STEP_CHOICES). */
export const STEP_CHOICES=[4,8,12,16,24,32,48,64,96,128,192,256];

type ChoiceProps={values:number[];value:number;onChange(value:number):void;
  /** Text on the trigger and on each choice. */
  trigger:ReactNode;choice(n:number):string;
  label:string;listLabel?:string;title?:string;className?:string;columns?:number;testId?:string;
  /** Extra controls under the choices (e.g. a custom-length stepper); they keep the list open. */
  extra?:ReactNode};

/** A button that opens a list of choices (the existing discrete-choice vocabulary).
 * One column for a few choices; a grid for nine or more (UI rule 11). The portal keeps the opened
 * choices outside clipping parents, and the list opens upward when there is no room below. */
export function ChoiceList({values,value,onChange,trigger:face,choice,label,listLabel,title,className,columns=1,testId,extra}:ChoiceProps){
 const id=useId(),trigger=useRef<HTMLButtonElement>(null),list=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState<{left:number;top:number}|null>(null);
 const [focus,setFocus]=useState(value);
 const close=(restore=false)=>{setPosition(null);if(restore)trigger.current?.focus();};
 const open=()=>{const r=trigger.current?.getBoundingClientRect();if(!r)return;setFocus(values.includes(value)?value:values[0]);
  const rows=Math.ceil(values.length/columns)+(extra?1:0),height=rows*48+10,width=columns*96+10;
  const top=r.bottom+4+height>window.innerHeight?Math.max(4,r.top-4-height):r.bottom+4;
  setPosition({left:Math.max(4,Math.min(r.left,window.innerWidth-width-4)),top});};
 useEffect(()=>{
  if(!position)return;
  list.current?.querySelector<HTMLButtonElement>(`[data-choice="${focus}"]`)?.focus();
 },[position,focus]);
 useEffect(()=>{
  if(!position)return;
  const outside=(e:PointerEvent)=>{if(!list.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setPosition(null);};
  const resize=()=>setPosition(null);
  document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',resize);
  return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',resize);};
 },[position]);
 return <>
  <button ref={trigger} type="button" className={className} aria-label={label} data-testid={testId}
   title={title} aria-haspopup="listbox" aria-expanded={!!position} aria-controls={position?id:undefined}
   onClick={()=>position?close():open()} onKeyDown={e=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open();}
    if(e.key==='Escape'&&position){e.preventDefault();close(true);}
   }}>{face}<ChevronDown size={13} aria-hidden="true"/></button>
  {position?createPortal(<div ref={list} id={id} role="listbox" aria-label={listLabel??label} data-context-ignore
   className={'loop-bars-choices'+(columns>1?' is-grid':'')} style={{...position,['--cols' as string]:columns}} onBlur={e=>{
    if(!e.currentTarget.contains(e.relatedTarget as Node)&&e.relatedTarget!==trigger.current)setPosition(null);
   }} onKeyDown={e=>{
    const index=Math.max(0,values.indexOf(focus)),n=values.length;
    const step=e.key==='ArrowDown'?columns:e.key==='ArrowUp'?-columns:e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;
    if(step||e.key==='Home'||e.key==='End'){
     e.preventDefault();setFocus(e.key==='Home'?values[0]:e.key==='End'?values[n-1]:values[(index+step+n)%n]);
    }else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}
    else if(e.key==='Tab'){trigger.current?.focus();setPosition(null);}
   }}>
   {values.map(n=><button key={n} type="button" role="option" aria-selected={value===n} data-choice={n} data-bars={n} tabIndex={focus===n?0:-1}
    onClick={()=>{if(n!==value)onChange(n);close(true);}}>{choice(n)}</button>)}
   {extra?<div className="choice-extra" role="group">{extra}</div>:null}
  </div>,document.body):null}
 </>;
}

/** Longest clip loop (engine MAX_BARS). */
export const MAX_BARS=32;
/** Clip content length: any whole number of bars from 1 to 32. The list offers the usual lengths;
 * the − / + row under it sets an uneven one (17 bars, 6 bars...). */
export function LoopBars({value,onChange}:{value:number;onChange(value:number):void}){
 const nudge=(d:number)=>{const n=Math.max(1,Math.min(MAX_BARS,value+d));if(n!==value)onChange(n);};
 return <ChoiceList values={BAR_CHOICES} value={value} onChange={onChange} className="loop-bars-trigger" label="Loop bars" listLabel="Clip loop length"
  title="Clip loop length · changes notes in all clips" trigger={<>{value} {value===1?'BAR':'BARS'}</>}
  choice={n=>n+' '+(n===1?'bar':'bars')}
  extra={<><button type="button" aria-label="One bar shorter" disabled={value<=1} onClick={()=>nudge(-1)}>−</button>
   <output aria-live="polite">{value}</output>
   <button type="button" aria-label="One bar longer" disabled={value>=MAX_BARS} onClick={()=>nudge(1)}>+</button></>}/>;
}
