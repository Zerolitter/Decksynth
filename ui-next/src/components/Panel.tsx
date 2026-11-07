import { Fragment, useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { ChevronDown, Power } from 'lucide-react';

/* Fold state lives in one small store so a rack can fold its own cards (auto-fold),
   and is remembered between sessions. */
const KEY='decksynth.folds';
function readFolds():Record<string,boolean>{try{return JSON.parse(localStorage.getItem(KEY)||'{}');}catch{return {};}}
let folds=readFolds();
const listeners=new Set<()=>void>();
export function setFold(id:string,folded:boolean){
  folds={...folds,[id]:folded};
  try{localStorage.setItem(KEY,JSON.stringify(folds));}catch{/* storage is optional */}
  listeners.forEach(l=>l());
}
export function isFolded(id:string,defaultFolded=false){return folds[id]??defaultFolded;}
const subscribe=(l:()=>void)=>{listeners.add(l);return()=>{listeners.delete(l);};};

/** All fold states, for racks that stack their folded cards. */
export function useFolds(){return useSyncExternalStore(subscribe,()=>folds);}

/** Folded cards stack three high in one rack slot instead of each taking a full slot. */
export function stackFolded(items:{id:string;node:ReactNode}[],all:Record<string,boolean>):ReactNode[]{
  const out:ReactNode[]=[];let stack:{id:string;node:ReactNode}[]=[];
  const flush=()=>{if(stack.length)out.push(<div key={'stack-'+stack[0].id} className="fold-stack">{stack.map(x=><Fragment key={x.id}>{x.node}</Fragment>)}</div>);stack=[];};
  for(const item of items){
    if(all[item.id]){stack.push(item);if(stack.length===3)flush();}
    else{flush();out.push(<Fragment key={item.id}>{item.node}</Fragment>);}
  }
  flush();return out;
}

/** Remembered fold state for one panel id. */
export function useFold(id:string,defaultFolded=false):[boolean,(v:boolean)=>void]{
  const folded=useSyncExternalStore(subscribe,()=>folds[id]??defaultFolded);
  return [folded,v=>setFold(id,v)];
}

/* Auto-fold: when a rack's cards no longer fit its two rows, the card used longest ago folds,
   one at a time, until they fit. Only runs when the setting allows it. */
const lastUsed=new Map<string,number>();
export function markUsed(id:string){lastUsed.set(id,performance.now());}
export function useAutoFold(ref:RefObject<HTMLElement|null>,ids:string[],enabled:boolean){
  const key=ids.join('|');
  useEffect(()=>{
    const el=ref.current;if(!el||!enabled)return;
    let raf=0;
    const check=()=>{
      cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>{
        if(el.scrollHeight<=el.clientHeight+1)return;
        const open=ids.filter(id=>!isFolded(id));
        if(open.length<=1)return;
        const newest=open.reduce((a,b)=>(lastUsed.get(a)??0)>=(lastUsed.get(b)??0)?a:b);
        const victim=open.filter(id=>id!==newest).sort((a,b)=>(lastUsed.get(a)??0)-(lastUsed.get(b)??0))[0];
        if(victim)setFold(victim,true);
      });
    };
    check();
    const ro=new ResizeObserver(check);ro.observe(el);
    const unsub=subscribe(check);
    return()=>{cancelAnimationFrame(raf);ro.disconnect();unsub();};
  },[ref,key,enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

export type PanelPower = {on:boolean; label:string; onToggle:()=>void};
type Props = {
  id:string; title:ReactNode; icon?:ReactNode; actions?:ReactNode; summary?:ReactNode;
  children:ReactNode; className?:string; defaultFolded?:boolean; grow?:boolean; accent?:string;
  /** colour tag shown in the title bar */ tag?:string;
  /** on/off button in the title bar, kept when folded */ power?:PanelPower;
  /** how many mod pads or macros are linked to this panel's knobs */ mods?:number;
  role?:string; label?:string; style?:React.CSSProperties;
};

/** A panel with a title bar. Double-tap (or double-click) the title bar, or tap the arrow,
 *  to fold it down to its title. A folded panel keeps its on/off button, colour tag and
 *  linked-mods badge. The fold state is remembered between sessions. */
export function Panel({id,title,icon,actions,summary,children,className='',defaultFolded=false,grow=false,accent,
  tag,power,mods=0,role,label,style}:Props){
  const [folded,setFolded]=useFold(id,defaultFolded);
  const lastTap=useRef(0);
  const onBarPointerUp=(e:React.PointerEvent)=>{
    if((e.target as HTMLElement).closest('button,select,input,a,[role="tab"]'))return;
    const now=e.timeStamp;
    if(now-lastTap.current<350){setFolded(!folded);lastTap.current=0;}
    else lastTap.current=now;
  };
  const name=typeof title==='string'?title:(label??id);
  return <section className={'ds-panel'+(folded?' folded':'')+(grow?' grow':'')+(power&&!power.on?' powered-off':'')+(className?' '+className:'')}
    data-panel={id} role={role} aria-label={label}
    style={{...(accent?{['--panel-accent' as string]:accent}:{}),...(tag?{['--panel-tag' as string]:tag}:{}),...style}}
    onPointerDownCapture={()=>markUsed(id)}>
    <header className="ds-panel-bar" onPointerUp={onBarPointerUp} title="Double-tap to fold or unfold">
      {power?<button type="button" className={'ds-panel-power'+(power.on?' on':'')} aria-pressed={power.on}
        aria-label={(power.on?'Turn off ':'Turn on ')+power.label} title={power.on?'On':'Off'} onClick={power.onToggle}><Power size={14}/></button>:null}
      {tag?<i className="ds-panel-tag" aria-hidden="true"/>:null}
      {icon?<span className="ds-panel-icon">{icon}</span>:null}
      <h3 className="ds-panel-title">{title}</h3>
      {mods>0?<span className="ds-panel-mods" title={mods+' mod link'+(mods>1?'s':'')}>◆ {mods}</span>:null}
      {folded&&summary?<span className="ds-panel-summary">{summary}</span>:null}
      <span className="ds-panel-actions">{folded?null:actions}</span>
      <button type="button" className="ds-panel-fold" aria-expanded={!folded}
        aria-label={(folded?'Unfold ':'Fold ')+name} onClick={()=>setFolded(!folded)}>
        <ChevronDown size={18}/></button>
    </header>
    {folded?null:<div className="ds-panel-body">{children}</div>}
  </section>;
}
