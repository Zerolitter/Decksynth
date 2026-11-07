import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ccForControl,controlName,knobControl,type ControlTarget,type MidiMapping} from '../parameter-registry';
type Learn=ControlTarget&{track:number};
type Menu={target:ControlTarget;x:number;y:number};
type Context={canLearn:(id:string)=>boolean;cc:(id:string)=>number|null;open:(id:string,x:number,y:number)=>void};
const MidiContext=createContext<Context|null>(null);
export const useMidiLearn=()=>useContext(MidiContext);
export function MidiLearnProvider({selected,mappings,active,send,children}:{selected:number;mappings:MidiMapping[];active:Learn|null|undefined;send:(cmd:string,args?:unknown)=>void;children:ReactNode}){
 const [menu,setMenu]=useState<Menu|null>(null);
 useEffect(()=>setMenu(null),[selected]);
 useEffect(()=>{if(!menu&&!active)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMenu(null);if(active)send('cancel_cc_learn');}};
  const pointer=(e:PointerEvent)=>{if(active&&!(e.target as Element).closest('.midi-learn-status'))send('cancel_cc_learn');};
  window.addEventListener('keydown',key);window.addEventListener('pointerdown',pointer,true);
  return()=>{window.removeEventListener('keydown',key);window.removeEventListener('pointerdown',pointer,true);};},[menu,active,send]);
 const context:Context={canLearn:id=>knobControl(id,selected)!==null,cc:id=>{const t=knobControl(id,selected);return t?ccForControl(t,mappings):null;},
  open:(id,x,y)=>{const target=knobControl(id,selected);if(target)setMenu({target,x:Math.min(innerWidth-208,Math.max(8,x)),y:Math.min(innerHeight-152,Math.max(8,y))});}};
 const host=document.querySelector('.harness-shell')??document.body;
 return <MidiContext.Provider value={context}>{children}
  {menu?createPortal(<div className="midi-menu-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)setMenu(null);}}>
   <div className="midi-control-menu" role="menu" aria-label="MIDI control" style={{left:menu.x,top:menu.y}}>
    <strong>{controlName(menu.target)}</strong>
    <button type="button" role="menuitem" onClick={()=>{send('learn_cc',[selected,menu.target.module,menu.target.param]);setMenu(null);}}>Learn MIDI CC</button>
    {mappings.some(m=>m.module===menu.target.module&&m.param===menu.target.param)?<button type="button" role="menuitem" onClick={()=>{send('unlearn_cc',[selected,menu.target.module,menu.target.param]);setMenu(null);}}>Remove MIDI CC</button>:null}
    <button type="button" role="menuitem" onClick={()=>setMenu(null)}>Cancel</button>
   </div>
  </div>,host):null}
  {active?createPortal(<div className="midi-learn-status" role="status" aria-label="MIDI Learn"><span>Move a MIDI controller · {controlName(active)}</span><button type="button" onClick={()=>send('cancel_cc_learn')}>Cancel</button></div>,host):null}
 </MidiContext.Provider>;
}
