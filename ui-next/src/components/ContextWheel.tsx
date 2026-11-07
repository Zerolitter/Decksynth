import {createContext,useContext,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {contextActions,sectorAt,wheelPosition,type Capabilities,type ContextAction,type ContextKind} from '../context-actions';
export type ContextBinding={kind:ContextKind;label:string;caps:Capabilities;cancel?:()=>void;valid?:()=>boolean};
type Resolve=(element:HTMLElement,x:number,y:number)=>ContextBinding|null;
const modalTargets=()=>Array.from(document.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"]'));
const sameModals=(old:Element[])=>{const now=modalTargets();return old.length===now.length&&old.every((el,i)=>el===now[i]);};
type Session={dialogs:Element[];binding:ContextBinding;revision:string;origin:{x:number;y:number};center:{x:number;y:number};invoker:HTMLElement;path:ContextAction[]};
const Context=createContext<{register:(id:string,r:Resolve|null)=>void;navigation:Capabilities}|null>(null);
export function useContextTarget(resolve:Resolve){const c=useContext(Context),id=useId(),latest=useRef(resolve);latest.current=resolve;useEffect(()=>{c?.register(id,(...a)=>latest.current(...a));return()=>c?.register(id,null);},[c?.register,id]);return {'data-context-target':id};}
export const useContextNavigation=()=>useContext(Context)?.navigation??{};
const blocked=(el:Element)=>!!el.closest('input,textarea,select,[contenteditable=true],a,[data-context-ignore]');
export function ContextWheelProvider({revision,navigation,notify,children}:{revision:string;navigation:Capabilities;notify:(message:string)=>void;children:ReactNode}){
 const registry=useRef(new Map<string,Resolve>()),rev=useRef(revision),nav=useRef(navigation);rev.current=revision;nav.current=navigation;
 const [session,setSession]=useState<Session|null>(null),[highlight,setHighlight]=useState(-1),[list,setList]=useState(false);
 const cancelPending=useRef<()=>void>(()=>{});
 const live=useRef(session);live.current=session;const menu=useRef<HTMLDivElement>(null),selected=useRef(-1);selected.current=highlight;
 const register=useRef((id:string,r:Resolve|null)=>{if(r)registry.current.set(id,r);else registry.current.delete(id);}).current;
 const close=()=>{const old=live.current;live.current=null;setSession(null);setHighlight(-1);if(old?.invoker.isConnected)old.invoker.focus?.({preventScroll:true});};
 const actions=(s:Session)=>s.path.at(-1)?.children??contextActions(s.binding.kind,{...nav.current,...s.binding.caps});
 const choose=(index:number)=>{const s=live.current;if(!s)return;if(s.revision!==rev.current||!s.invoker.isConnected||!sameModals(s.dialogs)||s.binding.valid?.()===false){close();notify('Target changed; open its commands again');return;}const a=actions(s)[index];if(!a)return;if(a.children){setSession({...s,path:[...s.path,a]});setHighlight(-1);}else{close();a.run?.();}};
 const back=()=>{const s=live.current;if(s?.path.length){setSession({...s,path:s.path.slice(0,-1)});setHighlight(-1);}else close();};
 useEffect(()=>{cancelPending.current();if(live.current&&live.current.revision!==revision)close();},[revision]);
 useEffect(()=>{if(session){menu.current?.focus({preventScroll:true});} },[session]);
 useEffect(()=>{
  let owner:number|null=null,held:{id:number;x:number;y:number;dragged:boolean}|null=null,touch:{id:number;x:number;y:number;element:HTMLElement;revision:string;dialogs:Element[];timer:ReturnType<typeof setTimeout>;binding:ContextBinding}|null=null,replaying=false,suppress=0,cancelledTouch:number|null=null,touchClickUntil=0;
  const invalidate=()=>{if(touch){cancelledTouch=touch.id;clearTimeout(touch.timer);touch=null;}if(held){cancelledTouch=held.id;held=null;}};cancelPending.current=invalidate;
  const touchValid=(t:NonNullable<typeof touch>)=>t.revision===rev.current&&t.element.isConnected&&sameModals(t.dialogs)&&t.binding.valid?.()!==false;
  const resolve=(target:EventTarget|null,x:number,y:number)=>{if(!(target instanceof Element)||blocked(target))return null;const host=target.closest<HTMLElement>('[data-context-target]');return host?registry.current.get(host.dataset.contextTarget!)?.(target as HTMLElement,x,y)??null:null;};
  const swallow=(e:Event)=>{e.preventDefault();e.stopImmediatePropagation();};
  const open=(binding:ContextBinding,element:HTMLElement,x:number,y:number,revision=rev.current)=>{if(revision!==rev.current||!element.isConnected||binding.valid?.()===false)return false;binding.cancel?.();const next={dialogs:modalTargets(),binding,revision,origin:{x,y},center:wheelPosition(x,y,innerWidth,innerHeight),invoker:element,path:[]};live.current=next;setSession(next);setList(false);setHighlight(-1);return true;};
  const replay=(el:HTMLElement,type:string,e:PointerEvent,x=e.clientX,y=e.clientY)=>{replaying=true;el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:e.pointerId,pointerType:e.pointerType,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,pressure:e.pressure}));replaying=false;};
  const down=(e:PointerEvent)=>{if(replaying)return;if(cancelledTouch===e.pointerId)cancelledTouch=null;if(live.current){if(!(e.target as Element).closest('.context-wheel-overlay')){swallow(e);close();}return;}
   const binding=resolve(e.target,e.clientX,e.clientY);if(!binding){if(e.button===0)owner=e.pointerId;return;}
   if(e.button===2){if(owner!==null)return;swallow(e);suppress=Date.now()+1000;open(binding,e.target as HTMLElement,e.clientX,e.clientY);held={id:e.pointerId,x:e.clientX,y:e.clientY,dragged:false};return;}
   if(e.button===0&&(e.pointerType==='touch'||e.pointerType==='pen')){swallow(e);const element=e.target as HTMLElement;touch={id:e.pointerId,x:e.clientX,y:e.clientY,element,binding,revision:rev.current,dialogs:modalTargets(),timer:setTimeout(()=>{if(!touch)return;if(!touchValid(touch)){invalidate();return;}const t=touch;touch=null;open(t.binding,t.element,t.x,t.y,t.revision);held={id:t.id,x:t.x,y:t.y,dragged:false};},500)};return;}
   if(e.button===0)owner=e.pointerId;
  };
  const move=(e:PointerEvent)=>{if(replaying)return;if(e.pointerId===cancelledTouch){swallow(e);return;}if(touch&&e.pointerId===touch.id){if(!touchValid(touch)){invalidate();swallow(e);return;}if(Math.hypot(e.clientX-touch.x,e.clientY-touch.y)>8){const t=touch;clearTimeout(t.timer);touch=null;owner=e.pointerId;replay(t.element,'pointerdown',e,t.x,t.y);replay(t.element,'pointermove',e);}else swallow(e);return;}
   const s=live.current;if(!s)return;if(held&&held.id===e.pointerId&&Math.hypot(e.clientX-held.x,e.clientY-held.y)>12)held.dragged=true;setHighlight(sectorAt(e.clientX,e.clientY,s.center,actions(s).length));
  };
  const up=(e:PointerEvent)=>{if(replaying)return;if(e.pointerId===cancelledTouch){swallow(e);cancelledTouch=null;touchClickUntil=Date.now()+700;return;}if(touch&&touch.id===e.pointerId){if(!touchValid(touch)){invalidate();swallow(e);touchClickUntil=Date.now()+700;return;}touchClickUntil=Date.now()+700;const t=touch;clearTimeout(t.timer);touch=null;swallow(e);replay(t.element,'pointerdown',e,t.x,t.y);replay(t.element,'pointerup',e);replaying=true;t.element.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1,clientX:e.clientX,clientY:e.clientY}));replaying=false;owner=null;return;}
   if(held?.id===e.pointerId){touchClickUntil=Date.now()+700;swallow(e);const h=held;held=null;if(h.dragged){const s=live.current;if(s){const i=sectorAt(e.clientX,e.clientY,s.center,actions(s).length);if(i>=0)choose(i);}}return;}if(owner===e.pointerId)owner=null;
  };
  const contextmenu=(e:MouseEvent)=>{if(Date.now()<suppress){swallow(e);return;}if(owner!==null)return;const b=resolve(e.target,e.clientX,e.clientY);if(b){swallow(e);open(b,e.target as HTMLElement,e.clientX,e.clientY);}};
  const cancel=()=>{invalidate();owner=null;close();};
  const click=(e:MouseEvent)=>{if(e.isTrusted&&Date.now()<touchClickUntil&&['touch','pen'].includes((e as PointerEvent).pointerType))swallow(e);};
  const observer=new MutationObserver(()=>{if(touch&&!touchValid(touch))invalidate();const s=live.current;if(s&&(!s.invoker.isConnected||!sameModals(s.dialogs))){invalidate();close();}});observer.observe(document.body,{childList:true,subtree:true});
  const key=(e:KeyboardEvent)=>{const s=live.current;if(s){if(blocked(e.target as Element))return;e.stopImmediatePropagation();if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();back();}else if(e.key.startsWith('Arrow')){e.preventDefault();setHighlight(i=>(i+(e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1)+actions(s).length)%actions(s).length);}else if(e.key==='Enter'){e.preventDefault();choose(selected.current);}else if(e.key==='Tab'){e.preventDefault();setList(true);setHighlight(i=>(i+(e.shiftKey?-1:1)+actions(s).length)%actions(s).length);}return;}
   if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){if(owner!==null||touch)return;const el=document.activeElement as HTMLElement,r=el.getBoundingClientRect(),b=resolve(el,r.x+r.width/2,r.y+r.height/2);if(b){swallow(e);open(b,el,r.x+r.width/2,r.y+r.height/2);}}
  };
  const wheel=(e:WheelEvent)=>{const s=live.current;if(s){swallow(e);setHighlight(i=>(i+(e.deltaY>=0?1:-1)+actions(s).length)%actions(s).length);}};
  let raf=0,wasB=true;const poll=()=>{const b=[...(navigator.getGamepads?.()??[])].some(p=>p?.buttons[1]?.pressed);if(b&&!wasB&&live.current)back();wasB=b;raf=requestAnimationFrame(poll);};raf=requestAnimationFrame(poll);
  document.addEventListener('click',click,true);document.addEventListener('pointerdown',down,true);document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',cancel,true);document.addEventListener('contextmenu',contextmenu,true);document.addEventListener('keydown',key,true);document.addEventListener('wheel',wheel,{capture:true,passive:false});window.addEventListener('blur',cancel);
  return()=>{cancelPending.current=()=>{};observer.disconnect();document.removeEventListener('click',click,true);if(touch)clearTimeout(touch.timer);cancelAnimationFrame(raf);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',cancel,true);document.removeEventListener('contextmenu',contextmenu,true);document.removeEventListener('keydown',key,true);document.removeEventListener('wheel',wheel,true);window.removeEventListener('blur',cancel);};
 },[]);
 const items=session?actions(session):[];
 const point=(a:number,r:number)=>[144+Math.cos(a)*r,144+Math.sin(a)*r];
 return <Context.Provider value={{register,navigation}}>{children}{session?createPortal(<div className="context-wheel-overlay" onPointerDown={e=>{if(e.target===e.currentTarget)close();}}>
  <svg className="context-wheel-anchor" aria-hidden="true"><path d={'M'+session.origin.x+' '+session.origin.y+' L'+session.center.x+' '+session.center.y}/><circle cx={session.origin.x} cy={session.origin.y} r="4"/></svg>
  <div ref={menu} className={'context-wheel'+(list?' linear':'')} role="menu" aria-label={session.binding.label+' commands'} tabIndex={-1} style={{left:session.center.x-144,top:list?Math.min(innerHeight-((items.length+1)*46+64),session.center.y-144):session.center.y-144}} data-context-kind={session.binding.kind}>
   <strong className="context-wheel-caption">{session.binding.label}{session.path.length?' › '+session.path.at(-1)!.title:''}</strong>
   {list?<div className="context-action-list">{items.map((a,i)=><button type="button" role="menuitem" key={a.id} aria-label={a.title} className={i===highlight?'active':''} onClick={()=>choose(i)}>{a.title}{a.children?' ›':''}</button>)}<button type="button" onClick={back}>{session.path.length?'Back':'Cancel'}</button></div>:<svg viewBox="0 0 288 288" className="context-wheel-ring">{items.map((a,i)=>{const from=-Math.PI/2+i*Math.PI*2/items.length,to=from+Math.PI*2/items.length-.025,p0=point(from+.025,132),p1=point(to,132),p2=point(to,48),p3=point(from+.025,48),p=point((from+to)/2,91);return <g key={a.id}><path role="menuitem" aria-label={a.title} data-action={a.id} className={i===highlight?'active':''} d={`M${p0} A132 132 0 ${to-from>Math.PI?1:0} 1 ${p1} L${p2} A48 48 0 ${to-from>Math.PI?1:0} 0 ${p3} Z`} onClick={()=>choose(i)}/><text x={p[0]} y={p[1]-2} textAnchor="middle">{a.title.split(' ').map((word,j)=><tspan key={j} x={p[0]} dy={j?14:0}>{word}</tspan>)}{a.children?<tspan x={p[0]} dy="14">›</tspan>:null}</text></g>;})}<circle cx="144" cy="144" r="44"/><text x="144" y="149" textAnchor="middle">{session.path.length?'Back':'Cancel'}</text><circle role="menuitem" aria-label={session.path.length?'Back':'Cancel'} className="wheel-center" cx="144" cy="144" r="44" onClick={back}/></svg>}
   <button className="context-wheel-list-toggle" type="button" onClick={()=>setList(!list)}>{list?'Radial menu':'Action list'}</button>
  </div></div>,document.querySelector('.harness-shell')??document.body):null}</Context.Provider>;
}
