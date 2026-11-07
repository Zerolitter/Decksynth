import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {controlName,type ControlTarget} from '../parameter-registry';
import type {AutomationLane} from '../types';
type Props={track:number;lanes:AutomationLane[];target:ControlTarget|null;beats:number;armed:boolean;send:(cmd:string,args?:unknown)=>void;close:()=>void};
export function AutomationEditor({track,lanes,target,beats,armed,send,close}:Props){
 const [selected,setSelected]=useState<ControlTarget>(target??lanes[0]??{module:'sound',param:'filter'}),[index,setIndex]=useState(0);
 const done=useRef<HTMLButtonElement>(null),drag=useRef(false),points=useRef<[number,number][]>([]);
 const lane=lanes.find(l=>l.module===selected.module&&l.param===selected.param),current=lane?.points??[];
 const [draft,setDraft]=useState<[number,number][]>(current);
 useEffect(()=>{if(!drag.current)setDraft(current);},[lane]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;done.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close();}};window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();};},[close]);
 function commit(next:[number,number][]){const others=lanes.filter(l=>l.module!==selected.module||l.param!==selected.param);send('automation',[track,next.length?[...others,{...selected,points:next}]:others]);}
 function edit(e:React.PointerEvent<SVGSVGElement>){const b=e.currentTarget.getBoundingClientRect(),beat=Math.round(Math.max(0,Math.min(beats-.000001,(e.clientX-b.left)/b.width*beats))*16)/16,unit=Math.max(0,Math.min(1,1-(e.clientY-b.top)/b.height));const next=points.current.filter(p=>Math.abs(p[0]-beat)>.00001);next.push([Math.min(beats-.000001,beat),Math.round(unit*1000)/1000]);next.sort((a,b)=>a[0]-b[0]);points.current=next;setDraft(next);setIndex(next.findIndex(p=>p[0]===beat));}
 const choices=[...lanes,...(!lanes.some(l=>l.module===selected.module&&l.param===selected.param)?[selected]:[])];
 const point=draft[Math.max(0,Math.min(index,draft.length-1))];
 return createPortal(<div className="automation-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)close();}}>
  <section role="dialog" aria-modal="true" aria-label="Parameter automation" className="automation-editor" onKeyDown={e=>{if(e.key==='Tab'){const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]'));const i=buttons.indexOf(document.activeElement as HTMLElement);if((e.shiftKey&&i===0)||(!e.shiftKey&&i===buttons.length-1)){e.preventDefault();buttons[e.shiftKey?buttons.length-1:0]?.focus();}}}}>
   <header><strong>Automation · Track {track+1} · {controlName(selected)}</strong><button type="button" aria-pressed={armed} onClick={()=>send('automation_arm',!armed)}>{armed?'Automation armed':'Arm automation'}</button><button ref={done} type="button" onClick={close}>Done</button></header>
   <div className="automation-content"><div className="automation-lanes" role="group" aria-label="Automation lanes">{choices.map(l=><button key={l.module+'.'+l.param} type="button" aria-pressed={l.module===selected.module&&l.param===selected.param} onClick={()=>{setSelected(l);setIndex(0);}}>{controlName(l)}</button>)}<p>Add a lane from a knob’s menu.</p></div>
    <div className="automation-lane-editor"><svg role="slider" tabIndex={0} aria-label={controlName(selected)+' automation lane'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((point?.[1]??0)*100)} viewBox="0 0 520 180" preserveAspectRatio="none"
     onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current=true;points.current=current.map(p=>[...p]);edit(e);}} onPointerMove={e=>{if(drag.current)edit(e);}} onPointerUp={()=>{if(drag.current){drag.current=false;commit(points.current);}}} onPointerCancel={()=>{drag.current=false;setDraft(current);}}
     onKeyDown={e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Delete','Home'].includes(e.key)){e.preventDefault();const next=draft.length?draft.map(p=>[...p] as [number,number]):[[0,.5] as [number,number]];let i=Math.max(0,Math.min(index,next.length-1));if(e.key==='ArrowRight')setIndex(Math.min(i+1,next.length-1));else if(e.key==='ArrowLeft')setIndex(Math.max(0,i-1));else if(e.key==='Delete'){next.splice(i,1);commit(next);}else if(e.key==='Home'){next[i][1]=.5;commit(next);}else{next[i][1]=Math.max(0,Math.min(1,next[i][1]+(e.key==='ArrowUp'?.01:-.01)));commit(next);}}}}>
      <path d={draft.map((p,i)=>(i?'L':'M')+(p[0]/beats*520)+' '+((1-p[1])*180)).join(' ')} fill="none" stroke="currentColor" strokeWidth="3"/>{draft.map((p,i)=><circle key={p[0]} cx={p[0]/beats*520} cy={(1-p[1])*180} r={i===index?6:4}/>)}</svg>
     <footer><span>{draft.length?draft.length+' points · '+beats+' beats':'Touch to draw · REC + arm records knob moves'}</span><button type="button" onClick={()=>commit([])}>Clear lane</button></footer>
    </div></div>
  </section></div>,document.querySelector('.harness-shell')??document.body);
}
