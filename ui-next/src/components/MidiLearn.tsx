import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ccForControl,controlName,knobControl,type ControlTarget,type MidiMapping} from '../parameter-registry';
type Learn=ControlTarget&{track:number};
type Menu={target:ControlTarget;x:number;y:number};
type Context={gesture:(id:string,action:'begin'|'end'|'cancel')=>void;canLearn:(id:string)=>boolean;cc:(id:string)=>number|null;defaultValue:(id:string)=>number|undefined;modulation:(id:string)=>void;automation:(id:string)=>void;learn:(id:string)=>void;open:(id:string,x:number,y:number)=>void};
const MidiContext=createContext<Context|null>(null);
export const useMidiLearn=()=>useContext(MidiContext);
export function MidiLearnProvider({selected,mappings,active,send,onAutomation,onModulation,defaultValue,children}:{defaultValue?:(target:ControlTarget)=>number|undefined;onModulation?:(target:ControlTarget)=>void;onAutomation?:(target:ControlTarget)=>void;selected:number;mappings:MidiMapping[];active:Learn|null|undefined;send:(cmd:string,args?:unknown)=>void;children:ReactNode}){
 const [menu,setMenu]=useState<Menu|null>(null);
 const menuRef=useRef<HTMLDivElement>(null),invoker=useRef<HTMLElement|null>(null);
 useEffect(()=>{if(!menu)return;menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  return()=>{if(invoker.current?.isConnected)invoker.current.focus();};},[menu]);
 useEffect(()=>setMenu(null),[selected]);
 useEffect(()=>{if(!menu&&!active)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMenu(null);if(active)send('cancel_cc_learn');}};
  const pointer=(e:PointerEvent)=>{if(active&&!(e.target as Element).closest('.midi-learn-status'))send('cancel_cc_learn');};
  window.addEventListener('keydown',key);window.addEventListener('pointerdown',pointer,true);
  return()=>{window.removeEventListener('keydown',key);window.removeEventListener('pointerdown',pointer,true);};},[menu,active,send]);
 const context:Context={gesture:(id,action)=>{const t=knobControl(id,selected);if(t)send('sound_gesture',[selected,t.module,t.param,action]);},canLearn:id=>knobControl(id,selected)!==null,cc:id=>{const t=knobControl(id,selected);return t?ccForControl(t,mappings):null;},
  defaultValue:id=>{const t=knobControl(id,selected);return t?defaultValue?.(t):undefined;},modulation:id=>{const t=knobControl(id,selected);if(t)onModulation?.(t);},automation:id=>{const t=knobControl(id,selected);if(t)onAutomation?.(t);},learn:id=>{const t=knobControl(id,selected);if(t)send('learn_cc',[selected,t.module,t.param]);},
  open:(id,x,y)=>{const target=knobControl(id,selected);if(target){invoker.current=document.querySelector<HTMLElement>('[data-param="'+id+'"] [role="slider"]');setMenu({target,x:Math.min(innerWidth-208,Math.max(8,x)),y:Math.min(innerHeight-216,Math.max(8,y))});}}};
 const host=document.querySelector('.harness-shell')??document.body;
 return <MidiContext.Provider value={context}>{children}
  {menu?createPortal(<div className="midi-menu-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)setMenu(null);}}>
   <div ref={menuRef} className="midi-control-menu" role="menu" aria-label="MIDI control" style={{left:menu.x,top:menu.y}} onKeyDown={e=>{
    e.stopPropagation();const items=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')),i=items.indexOf(document.activeElement as HTMLElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}
    if(e.key==='Escape'){e.preventDefault();setMenu(null);}
   }}>
    <strong>{controlName(menu.target)}</strong>
    <button type="button" role="menuitem" onClick={()=>{send('learn_cc',[selected,menu.target.module,menu.target.param]);setMenu(null);}}>Learn MIDI CC</button>
    {mappings.some(m=>m.module===menu.target.module&&m.param===menu.target.param)?<button type="button" role="menuitem" onClick={()=>{send('unlearn_cc',[selected,menu.target.module,menu.target.param]);setMenu(null);}}>Remove MIDI CC</button>:null}
    <button type="button" role="menuitem" onClick={()=>{onAutomation?.(menu.target);setMenu(null);}}>Automation</button>
    <button type="button" role="menuitem" onClick={()=>setMenu(null)}>Cancel</button>
   </div>
  </div>,host):null}
  {active?createPortal(<div className="midi-learn-status" role="status" aria-label="MIDI Learn"><span>Move a MIDI controller · {controlName(active)}</span><button type="button" onClick={()=>send('cancel_cc_learn')}>Cancel</button></div>,host):null}
 </MidiContext.Provider>;
}
