import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Trash2, VolumeX, X } from 'lucide-react';
import { Knob } from './Knob';
import { FX_MODULES, addModule, defaultFxChain, normalizeChain, type FxChain, type FxModuleId } from '../fx';
import { TRACK_COLORS, type FxBus, type Track } from '../types';
import { deviceName } from './PageBar';
import '../buses.css';

/** FX buses A to D (decksynth/sends.py), seen from the FX page: chips beside the tracks, the bus view's feeds,
 *  and each track's sends under its own chain (26 Nov, mockup fx-layering-v2). */
export const MAX_BUSES=4;
export const BUS_LETTERS='ABCD';
export const busColor=(bus:FxBus|undefined,i:number)=>'var(--bus-'+'abcd'[(bus?.colour??i)%4]+')';
const pct=(v:number)=>Math.round(v*100)+' %';

/** A new project's buses (the engine leaves them out of the state while they are these): Reverb on A, Delay on B,
 *  each at Mix 1 (all wet in a bus) and Return 80 %, as decksynth/sends.py defaults(). */
const single=(id:FxModuleId,name:string,colour:number):FxBus=>{const c=addModule(defaultFxChain(),id);
  return {name,colour,return:.8,mute:false,chain:{...c,modules:c.modules.map(m=>m.id===id?{...m,params:{...m.params,mix:1}}:m)}};};
export const DEFAULT_BUSES:FxBus[]=[single('reverb','Reverb',0),single('delay','Delay',1)];
export const busesOf=(p:{buses?:FxBus[]})=>p.buses??DEFAULT_BUSES;

/** What one track feeds into a bus (0 when it doesn't). */
export const feedOf=(t:Track,i:number)=>t.sends?.[String(i)]??{amount:0,through:false};
const feeds=(tracks:Track[],i:number)=>tracks.filter(t=>{const f=feedOf(t,i);return f.amount>0||f.through;}).length;
/** The effects a bus runs, in chain order. */
export const busEffects=(bus:FxBus)=>normalizeChain(bus.chain).modules.filter(m=>m.on&&!m.bypass).map(m=>m.id);

/** Bus chips for the FX page's track row: tap one to see that bus; + makes a new one (four at most). */
export function BusChips({buses,tracks,view,onView,onNew,newOpen}:{buses:FxBus[];tracks:Track[];view:number|null;
  onView:(i:number)=>void;onNew:()=>void;newOpen:boolean}){
  const tight=tracks.length>5;
  return <div className={'bus-chips'+(tight?' tight':'')} role="group" aria-label="FX buses">
    {buses.map((b,i)=>{const n=feeds(tracks,i);
      return <button key={i} type="button" className={'bus-chip'+(view===i?' active':'')} aria-pressed={view===i}
        aria-label={'Bus '+BUS_LETTERS[i]+' '+b.name+', fed by '+n+' track'+(n===1?'':'s')} style={{['--bus' as string]:busColor(b,i)}}
        onClick={()=>onView(i)}>
        <span className="bus-chip-no">{BUS_LETTERS[i]}</span>
        <span className="bus-chip-text"><b>{b.name}</b>{tight?null:<small>{b.mute?'muted':'bus · '+n+' track'+(n===1?'':'s')}</small>}</span>
      </button>;})}
    {buses.length<MAX_BUSES?<button type="button" className={'bus-chip-add'+(newOpen?' lit':'')} aria-label="New bus" aria-expanded={newOpen}
      data-bus-opener title={'New FX bus ('+buses.length+' of '+MAX_BUSES+')'} onClick={onNew}><Plus size={18}/></button>:null}
  </div>;
}

/** A horizontal fader: drag sideways from where it is (no jump to the finger; full range over at least 200 px),
 *  double-tap resets. One gesture is one change on release; the value follows the finger while dragging. */
function Fader({label,no,colour,value,onChange,reset=0,tag,round=false}:{label:string;no:string;colour:string;value:number;
  onChange:(v:number)=>void;reset?:number;tag?:string;round?:boolean}){
  const [drag,setDrag]=useState<number|null>(null);
  const start=useRef<{x:number;v:number;w:number;id:number}|null>(null),last=useRef(0);
  const shown=drag??value;
  return <div role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown*100)}
    className={'bus-fader'+(shown>0?'':' zero')} style={{['--fc' as string]:colour,['--w' as string]:(shown*100)+'%'}}
    onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);
      start.current={x:e.clientX,v:value,w:Math.max(200,e.currentTarget.clientWidth),id:e.pointerId};
      if(e.timeStamp-last.current<320){onChange(reset);start.current=null;setDrag(null);}last.current=e.timeStamp;}}
    onPointerMove={e=>{const s=start.current;if(!s||s.id!==e.pointerId)return;
      const v=Math.min(1,Math.max(0,s.v+(e.clientX-s.x)/s.w));setDrag(Math.round(v*100)/100);}}
    onPointerUp={()=>{if(start.current&&drag!==null&&drag!==start.current.v)onChange(drag);start.current=null;setDrag(null);}}
    onPointerCancel={()=>{start.current=null;setDrag(null);}}
    onKeyDown={e=>{const d=e.key==='ArrowRight'||e.key==='ArrowUp'?.01:e.key==='ArrowLeft'||e.key==='ArrowDown'?-.01:0;
      if(d){e.preventDefault();onChange(Math.min(1,Math.max(0,Math.round((value+d*(e.shiftKey?10:1))*100)/100)));}}}>
    <span className="bus-fader-fill"/>
    <span className={'bus-fader-no'+(round?' round':'')}>{no}</span><b>{label}</b>
    {tag?<span className="bus-fader-tag">{tag}</span>:null}<em>{pct(shown)}</em>
  </div>;
}

/** The bus view's top band: who feeds this bus (one fader per track), its Return, Mute and Remove. */
export function BusFeeds({bus,index,tracks,onSend,onSet,onRemove}:{bus:FxBus;index:number;tracks:Track[];
  onSend:(track:number,amount:number)=>void;onSet:(key:'return'|'mute',v:number|boolean)=>void;onRemove:()=>void}){
  const c=busColor(bus,index),n=feeds(tracks,index);
  return <section className="bus-band bus-feeds-band" aria-label={'Bus '+BUS_LETTERS[index]+' feeds'} style={{['--bus' as string]:c}}>
    <div className="bus-band-head"><b>Bus {BUS_LETTERS[index]} · {bus.name}</b><small>Fed by these tracks, after their volume.</small>
      <span className="bus-saves">Runs <b>once</b> for <b>{n} track{n===1?'':'s'}</b></span></div>
    <div className={'bus-feeds'+(tracks.length>6?' many':'')}>
      {tracks.map((t,i)=>{const f=feedOf(t,index);
        return <Fader key={i} label={deviceName(t)} no={String(i+1)} colour={TRACK_COLORS[i]} value={f.amount}
          tag={f.through?'THROUGH':undefined} onChange={v=>onSend(i,v)}/>;})}
    </div>
    <div className="bus-return">
      <Fader label="Return" no={BUS_LETTERS[index]} round colour={c} value={bus.return} reset={.8} onChange={v=>onSet('return',v)}/>
      <div className="bus-return-row">
        <button type="button" className={'bus-tog'+(bus.mute?' on':'')} aria-pressed={bus.mute} onClick={()=>onSet('mute',!bus.mute)}><VolumeX size={16}/>Mute</button>
        <button type="button" className="bus-tog warn" aria-label={'Remove bus '+BUS_LETTERS[index]}
          title="Take this bus out: its sends go, and Through tracks play straight to the mix again. Undo brings it back." onClick={onRemove}><Trash2 size={16}/>Remove</button>
      </div>
    </div>
  </section>;
}

/** A track's sends, under its own chain: one tile per bus with the amount and Send / Through. */
export function TrackSends({track,index,buses,onSend,onNew,newOpen,held}:{track:Track;index:number;buses:FxBus[];
  onSend:(bus:number,amount:number,through?:boolean)=>void;onNew:()=>void;newOpen:boolean;
  /** a send the playing or edited clip sets: its letter and the Base amount (FX per clip) */ held?:(bus:number)=>{letter:string;base:number}|null}){
  const name=deviceName(track);
  return <section className="bus-band bus-sends-band" aria-label="Send to buses">
    <div className="bus-band-head"><b>Send to buses</b><small>After {name}'s chain and volume.{Object.values(track.sends??{}).some(f=>f.through)?'':' '+name+' also plays dry.'}</small></div>
    {buses.map((b,i)=>{const f=feedOf(track,i),c=busColor(b,i);
      return <div key={i} className={'bus-send'+(f.amount>0||f.through?'':' zero')} style={{['--bus' as string]:c}}>
        <div className="bus-send-head"><span className="bus-letter">{BUS_LETTERS[i]}</span><b>{b.name}</b>
          <span className="bus-fx-tags">{busEffects(b).slice(0,3).map(id=><i key={id} style={{['--fc' as string]:FX_MODULES[id].color}}>{FX_MODULES[id].name}</i>)}</span></div>
        <div className="bus-send-body">
          <Knob id={index+'-send-'+i} name="Send" value={f.amount} min={0} max={1} step={.005} defaultValue={0} compact accent={c}
            format={pct} description={'How much of this track goes to bus '+BUS_LETTERS[i]+' (after its volume and pan).'} onChange={v=>onSend(i,v)}/>
          {(()=>{const h=held?.(i);return h?<span className="clip-held" title={'Clip '+h.letter+' sets this send; Base is '+pct(h.base)}><s>{pct(h.base)}</s><i>{h.letter}</i></span>:null;})()}
          <div className="bus-seg" role="radiogroup" aria-label={'Bus '+BUS_LETTERS[i]+' send or through'}>
            <button type="button" role="radio" aria-checked={!f.through} className={f.through?'':'active'} title="The track still plays dry; the bus adds its effect on top"
              onClick={()=>onSend(i,f.amount,false)}>Send</button>
            <button type="button" role="radio" aria-checked={f.through} className={f.through?'active':''} title="All of the track goes through the bus and not straight to the mix (a group)"
              onClick={()=>onSend(i,f.through?f.amount:Math.max(f.amount,1),true)}>Through</button>
          </div>
        </div>
      </div>;})}
    {buses.length<MAX_BUSES?<button type="button" className={'bus-send-add'+(newOpen?' lit':'')} data-bus-opener aria-expanded={newOpen}
      onClick={onNew}><Plus size={20}/>Bus {BUS_LETTERS[buses.length]}</button>:null}
  </section>;
}

/** The effect a bus already runs that this track also runs on its own, for the card's "Move it there" offer. */
export function busRunning(buses:FxBus[],id:FxModuleId):number{
  return buses.findIndex(b=>busEffects(b).includes(id));
}

type Template={name:string;blurb:string;fx:[FxModuleId,Record<string,number>?][]};
/** Starting chains for a new bus. Inside a bus an effect's Mix 1 is all wet. */
const TEMPLATES:Template[]=[
  {name:'Empty',blurb:'Start with no effects',fx:[]},
  {name:'Big space',blurb:'A long hall for pads and vocals',fx:[['space',{mix:1}],['eq']]},
  {name:'Echo',blurb:'Tempo echoes that stay out of the way',fx:[['delay',{mix:1}],['filter']]},
  {name:'Drum glue',blurb:'Squeeze a group of drums together',fx:[['compressor'],['tape']]},
  {name:'Wash',blurb:'Grainy cloud behind a sound',fx:[['cloud',{mix:1}],['smear',{mix:1}]]},
  {name:'Parallel crunch',blurb:'Dirt beside the clean sound',fx:[['overdrive',{mix:1}],['bitcrusher',{mix:1}],['eq']]},
];
function templateChain(t:Template):FxChain{
  let c=defaultFxChain();
  for(const [id,params] of t.fx){c=addModule(c,id);if(params)c={...c,modules:c.modules.map(m=>m.id===id?{...m,params:{...m.params,...params}}:m)};}
  return c;
}

/** New bus: a starting chain and the tracks that send to it (each at 30 %, Send). Closes on Cancel, a tap outside,
 *  the + again, Esc or B (rule 14). */
export function NewBusSheet({buses,tracks,selected,onMake,onClose}:{buses:FxBus[];tracks:Track[];selected:number|null;
  onMake:(name:string,chain:FxChain,from:number[])=>void;onClose:()=>void}){
  const i=buses.length;
  const [pick,setPick]=useState(0);
  const [from,setFrom]=useState<number[]>(selected!==null?[selected]:[]);
  useEffect(()=>{const k=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();onClose();}};
    let raf=0,was=true;const poll=()=>{const b=[...(navigator.getGamepads?.()??[])].some(g=>!!g?.buttons?.[1]?.pressed);if(b&&!was){onClose();return;}was=b;raf=requestAnimationFrame(poll);};
    raf=requestAnimationFrame(poll);window.addEventListener('keydown',k);return()=>{cancelAnimationFrame(raf);window.removeEventListener('keydown',k);};},[onClose]);
  const c='var(--bus-'+'abcd'[i]+')';
  return createPortal(<div className="bus-sheet-scrim" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="bus-sheet" role="dialog" aria-label={'New bus '+BUS_LETTERS[i]} style={{['--bus' as string]:c}}>
      <header><span className="bus-letter">{BUS_LETTERS[i]}</span><h3>New bus {BUS_LETTERS[i]}</h3>
        <span>A bus is an FX chain that tracks send to. It runs once however many tracks feed it.</span>
        <button type="button" className="bus-sheet-x" aria-label="Cancel new bus" onClick={onClose}><X size={18}/></button></header>
      <div className="bus-sheet-label">Start from</div>
      <div className="bus-templates" role="radiogroup" aria-label="Start from">
        {TEMPLATES.map((t,k)=><button key={t.name} type="button" role="radio" aria-checked={pick===k} className={pick===k?'active':''} onClick={()=>setPick(k)}>
          <b>{t.name}</b><small>{t.blurb}</small>
          <span className="bus-fx-tags">{t.fx.map(([id])=><i key={id} style={{['--fc' as string]:FX_MODULES[id].color}}>{FX_MODULES[id].name}</i>)}</span></button>)}
      </div>
      <div className="bus-sheet-label">Send to it from <small>(each starts at 30 %, Send)</small></div>
      <div className="bus-track-pick" role="group" aria-label="Tracks that send to the new bus">
        {tracks.map((t,k)=>{const on=from.includes(k);
          return <button key={k} type="button" aria-pressed={on} className={on?'active':''} style={{['--tc' as string]:TRACK_COLORS[k]}}
            onClick={()=>setFrom(on?from.filter(x=>x!==k):[...from,k].sort())}><span className="bus-track-no">{k+1}</span><b>{deviceName(t)}</b></button>;})}
      </div>
      <footer><span>{MAX_BUSES} buses at most (A–D)</span>
        <button type="button" className="bus-sheet-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="bus-sheet-btn go" onClick={()=>{const t=TEMPLATES[pick];onMake(t.name==='Empty'?'Bus '+BUS_LETTERS[i]:t.name,templateChain(t),from);}}>
          <Check size={16}/>Make bus {BUS_LETTERS[i]}</button></footer>
    </section></div>,document.querySelector('.harness-shell')??document.body);
}
