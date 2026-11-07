import {useContextTarget} from './ContextWheel';
import { createContext,useContext,useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { ChevronDown,Pin,Power } from 'lucide-react';
import type { RackDrag } from './RackOrder';

/* Fold state lives in one small store so a rack can fold its own cards (auto-fold),
   and is remembered between sessions. */
const KEY='decksynth.folds',PIN_KEY='decksynth.pins';
const Scope=createContext('');
export function PanelScope({scope,children}:{scope:string;children:ReactNode}){return <Scope.Provider value={scope}>{children}</Scope.Provider>;}
export const usePanelScope=()=>useContext(Scope);
function read(key:string):Record<string,boolean>{try{return JSON.parse(localStorage.getItem(key)||'{}');}catch{return {};}}
let folds=read(KEY),pins=read(PIN_KEY);const automatic=new Set<string>();
const listeners=new Set<()=>void>(),notify=()=>listeners.forEach(l=>l());
const keyFor=(id:string,scope:string)=>scope?scope+':'+id:id;
export function setFold(id:string,folded:boolean,scope='',auto=false){
 const key=keyFor(id,scope);
 if(auto){if(folded)automatic.add(key);else automatic.delete(key);}
 else{automatic.delete(key);folds={...folds,[key]:folded};try{localStorage.setItem(KEY,JSON.stringify(folds));}catch{}}
 notify();
}
export function isFolded(id:string,defaultFolded=false,scope=''){const key=keyFor(id,scope);return automatic.has(key)||(folds[key]??folds[id]??defaultFolded);}
const subscribe=(l:()=>void)=>{listeners.add(l);return()=>{listeners.delete(l);};};
export function useFold(id:string,defaultFolded=false):[boolean,(v:boolean)=>void]{
 const scope=usePanelScope(),folded=useSyncExternalStore(subscribe,()=>isFolded(id,defaultFolded,scope));return [folded,v=>setFold(id,v,scope)];
}
export function isPinned(id:string,scope=''){return !!pins[keyFor(id,scope)];}
export function setPinned(id:string,value:boolean,scope=''){pins={...pins,[keyFor(id,scope)]:value};try{localStorage.setItem(PIN_KEY,JSON.stringify(pins));}catch{}notify();}
const lastUsed=new Map<string,number>();
export function markUsed(id:string,scope=''){lastUsed.set(keyFor(id,scope),performance.now());}
export function useAutoFold(ref:RefObject<HTMLElement|null>,ids:string[],enabled:boolean){
 const identity=ids.join('|'),scope=usePanelScope();
 useEffect(()=>{
  const el=ref.current;if(!el)return;
  if(!enabled){let changed=false;for(const id of ids)changed=automatic.delete(keyFor(id,scope))||changed;if(changed)notify();return;}
  let raf=0;const owners=new Set<number>();
  const check=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{
   if(owners.size||el.dataset.rackPanning||document.querySelector('[role="dialog"],[role="menu"],.midi-learn-status'))return;
   const controls=el.querySelector<HTMLElement>('.rack-scroll-controls');
   if(el.scrollWidth-(controls?controls.offsetWidth+8:0)<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1)return;
   const open=ids.filter(id=>!isFolded(id,false,scope));if(open.length<=1)return;
   const recent=(id:string)=>lastUsed.get(keyFor(id,scope))??0,newest=open.reduce((a,b)=>recent(a)>=recent(b)?a:b);
   const focused=document.activeElement?.closest<HTMLElement>('[data-panel]')?.dataset.panel;
   const victim=open.filter(id=>id!==newest&&id!==focused&&!isPinned(id,scope)&&!el.querySelector<HTMLElement>('[data-panel="'+id+'"]')?.matches(':hover')).sort((a,b)=>recent(a)-recent(b))[0];
   if(victim)setFold(victim,true,scope,true);
  });};
  const down=(e:PointerEvent)=>owners.add(e.pointerId),up=(e:PointerEvent)=>{owners.delete(e.pointerId);check();},blur=()=>{owners.clear();check();};
  el.addEventListener('pointerdown',down,true);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up);window.addEventListener('blur',blur);window.addEventListener('keyup',check);el.addEventListener('pointerleave',check);
  check();const ro=new ResizeObserver(check);ro.observe(el);const unsub=subscribe(check);
  return()=>{cancelAnimationFrame(raf);ro.disconnect();unsub();el.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);window.removeEventListener('blur',blur);window.removeEventListener('keyup',check);el.removeEventListener('pointerleave',check);};
 },[ref,identity,enabled,scope]);
}

export type PanelPower = {on:boolean; label:string; onToggle:()=>void};
type Props = {
  id:string; title:ReactNode; icon?:ReactNode; actions?:ReactNode; summary?:ReactNode;
  children:ReactNode; className?:string; defaultFolded?:boolean; grow?:boolean; accent?:string;
  /** colour tag shown in the title bar */ tag?:string;
  /** on/off button in the title bar, kept when folded */ power?:PanelPower;
  /** how many mod pads or macros are linked to this panel's knobs */ mods?:number;
  role?:string; label?:string; style?:React.CSSProperties;
  /** Rack cards fold individually into an upright, keyboard-operable rail. */
  rail?:boolean;
  onUse?:()=>void;
  reorder?:RackDrag;
  modColors?:string[];
};

/** A panel with a title bar. Double-tap (or double-click) the title bar, or tap the arrow,
 *  to fold it down to its title. A folded panel keeps its on/off button, colour tag and
 *  linked-mods badge. The fold state is remembered between sessions. */
export function Panel({id,title,icon,actions,summary,children,className='',defaultFolded=false,grow=false,accent,
  tag,power,mods=0,role,label,style,rail=false,onUse,reorder,modColors=[]}:Props){
  const scope=usePanelScope(),pinned=useSyncExternalStore(subscribe,()=>isPinned(id,scope));
  const [folded,setFolded]=useFold(id,defaultFolded);
  const section=useRef<HTMLElement>(null);
  const reopen=()=>{markUsed(id,scope);setFolded(false);requestAnimationFrame(()=>section.current?.scrollIntoView({block:'nearest',inline:'nearest'}));};
  const context=useContextTarget(()=>rail?{kind:'rack.card',label:typeof title==='string'?title:id,caps:{open:reopen,fold:()=>setFolded(!folded),pin:()=>setPinned(id,!pinned,scope),...(power?{bypass:power.onToggle}:{}),previous:()=>{const prev=section.current?.previousElementSibling as HTMLElement;prev?.scrollIntoView({block:'nearest',inline:'nearest'});},next:()=>{const next=section.current?.nextElementSibling as HTMLElement;next?.scrollIntoView({block:'nearest',inline:'nearest'});}}}:null);
  const lastTap=useRef(0);
  const onBarPointerUp=(e:React.PointerEvent)=>{
    if(reorder?.moved()){lastTap.current=0;return;}
    if((e.target as HTMLElement).closest('button,select,input,a,[role="tab"]'))return;
    const now=e.timeStamp;
    if(now-lastTap.current<350){setFolded(!folded);lastTap.current=0;}
    else lastTap.current=now;
  };
  const name=typeof title==='string'?title:(label??id);
  const badge=mods>0?<span className="ds-panel-mods" title={mods+' mod link'+(mods>1?'s':'')}>
    {Array.from(new Set(modColors)).map(c=><i key={c} data-source-color={c} style={{background:c}}/>)}<span>{mods}</span></span>:null;
  return <section ref={section} {...context} className={'ds-panel'+(rail?' rack-rail':'')+(folded?' folded':'')+(grow?' grow':'')+(power&&!power.on?' powered-off':'')+(className?' '+className:'')}
    data-panel={id} data-pinned={pinned?'true':undefined} role={role} aria-label={label}
    style={{...(accent?{['--panel-accent' as string]:accent}:{}),...(tag?{['--panel-tag' as string]:tag}:{}),...style}}
    onPointerDownCapture={()=>{markUsed(id,scope);onUse?.();}} onFocusCapture={()=>markUsed(id,scope)}>
    {rail&&folded?<header className="ds-panel-bar rail-bar" onPointerDown={reorder?.start}>
      <button type="button" className="rail-open" aria-label={'Unfold '+name} aria-expanded={false} title={'Open '+name+' · Drag to move'} onKeyDown={e=>reorder?.key(e)} onClick={e=>{if(e.detail===0||!reorder?.moved())reopen();}}>
        <span className="rail-title">{title}</span>{badge}
      </button>
      {power?<button type="button" className={'ds-panel-power'+(power.on?' on':'')} aria-pressed={power.on} aria-label={(power.on?'Turn off ':'Turn on ')+power.label} onClick={power.onToggle}><Power size={16}/></button>:null}
    </header>:<header className="ds-panel-bar" onPointerDown={reorder?.start} onPointerUp={onBarPointerUp} title={rail?'Drag to move · Double-tap title to fold':'Double-tap to fold or unfold'}>
      {power?<button type="button" className={'ds-panel-power'+(power.on?' on':'')} aria-pressed={power.on}
        aria-label={(power.on?'Turn off ':'Turn on ')+power.label} title={power.on?'On':'Off'} onClick={power.onToggle}><Power size={14}/></button>:null}
      {tag?<i className="ds-panel-tag" aria-hidden="true"/>:null}
      {icon?<span className="ds-panel-icon">{icon}</span>:null}
      <h3 className="ds-panel-title" role={rail?'button':undefined} tabIndex={rail?0:undefined}
        aria-label={rail?'Fold '+name:undefined} aria-expanded={rail?!folded:undefined}
        onKeyDown={rail?e=>{if(reorder?.key(e))return;if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();setFolded(!folded);}}:undefined}>{title}</h3>
      {power&&!power.on?<span className="panel-bypass">Bypassed</span>:null}
      {badge}
      {folded&&summary?<span className="ds-panel-summary">{summary}</span>:null}
      <span className="ds-panel-actions">{rail&&!folded?<button type="button" className="panel-icon-action panel-pin" aria-label={(pinned?'Unpin ':'Pin ')+name+' card'} aria-pressed={pinned} title={pinned?'Pinned: protected from auto-fold':'Pin: keep this card open'} onClick={()=>setPinned(id,!pinned,scope)}><Pin size={14}/></button>:null}{folded?null:actions}</span>
      {rail?null:<button type="button" className="ds-panel-fold" aria-expanded={!folded}
        aria-label={(folded?'Unfold ':'Fold ')+name} onClick={()=>setFolded(!folded)}>
        <ChevronDown size={18}/></button>}
    </header>}
    {folded?null:<div className="ds-panel-body">{children}</div>}
  </section>;
}
