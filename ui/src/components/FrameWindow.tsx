import { useEffect, useState, type ReactNode } from 'react';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';

export type WindowTab = {id:string; label:string; render:()=>ReactNode; actions?:ReactNode};

/** The focus window: one fixed area whose tabs are its title bar. Switching tabs swaps what is
 *  inside; the window itself never moves or resizes. The last tab used is remembered per page. */
/** folded/onFold: an optional Hide/Show button; a folded window is only its title bar and gives its room to the cards below. */
export function FrameWindow({id,label,tabs,folded=false,onFold}:{id:string;label:string;tabs:WindowTab[];folded?:boolean;onFold?:(folded:boolean)=>void}) {
  const key='decksynth.window.'+id;
  const [tab,setTabState]=useState(()=>{try{const v=localStorage.getItem(key);return tabs.some(t=>t.id===v)?v!:tabs[0].id;}catch{return tabs[0].id;}});
  const setTab=(v:string)=>{setTabState(v);try{localStorage.setItem(key,v);}catch{/* optional */}};
  // Another part of the page can open a view here, e.g. the Envelope card opens the Envelope editor.
  useEffect(()=>{const on=(e:Event)=>{const d=(e as CustomEvent).detail;if(d?.id===id&&tabs.some(t=>t.id===d.tab))setTab(d.tab);};
    window.addEventListener('decksynth-window',on);return()=>window.removeEventListener('decksynth-window',on);});
  const current=tabs.find(t=>t.id===tab)??tabs[0];
  const open=(v:string)=>{setTab(v);if(folded)onFold?.(false);};
  return <section className={'frame-window'+(folded?' is-folded':'')} data-window={id} data-view={current.id} aria-label={label+' window'}>
    <header className="frame-window-bar">
      <span className="frame-window-label">{label}</span>
      <nav className="frame-tabs" role="tablist" aria-label={label+' views'}>
        {tabs.map(t=><button key={t.id} type="button" role="tab" aria-selected={t.id===current.id}
          className={t.id===current.id&&!folded?'active':''} onClick={()=>open(t.id)}>{t.label}</button>)}
      </nav>
      <span className="frame-window-actions">{folded?null:current.actions}
        {onFold?<button type="button" className="frame-window-fold" aria-expanded={!folded} title={folded?'Show '+tabs.map(t=>t.label).join(' and '):'Hide '+tabs.map(t=>t.label).join(' and ')+' to give the sound cards more room'}
          onClick={()=>onFold(!folded)}>{folded?<ChevronsUpDown size={16}/>:<ChevronsDownUp size={16}/>}{folded?'Show':'Hide'}</button>:null}</span>
    </header>
    {folded?null:<div className="frame-window-body">{current.render()}</div>}
  </section>;
}
