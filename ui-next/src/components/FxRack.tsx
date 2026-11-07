import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRingDepth } from './RingDepth';
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { Knob } from './Knob';
import { FxGraph } from './FxGraph';
import { Spectrum } from './Spectrum';
import { FrameWindow } from './FrameWindow';
import { Panel, useAutoFold } from './Panel';
import { FX_MODULES, FX_ORDER, addModule, normalizeChain, type FxChain, type FxModuleId, type FxTarget } from '../fx';
import { MorphPad } from './MorphPad';
import { GateSheet, GateStrip } from './GateSheet';
import { MACRO_COLORS, MOD_COLORS, sourceColor, sourceTargets, withTargets, type Live, type Source } from './ModParts';

export { MACRO_COLORS, MOD_COLORS };
const NPAR=6;
const BLURB:Record<FxModuleId,string>={
  stutter:'Repeats short slices in time', filter:'Low, band or high pass', overdrive:'Warm to heavy distortion',
  bitcrusher:'Lo-fi grit and aliasing', volume:'Level, for gating and tremolo', phaser:'Sweeping notches',
  flanger:'Jet-like comb sweep', ringmod:'Metallic, bell-like tones', delay:'Tempo-synced echoes',
  reverb:'Room to huge space', time:'Tape-style speed changes', chorus:'Wide, thick doubled voices',
  compressor:'Evens out loud and soft', eq:'Low, mid and high tone', autowah:'Opens up the harder you play',
  resonator:'Strings that ring with your notes', gate:'Rhythmic on/off pattern on the beat'};

/** The effects you can still add, as big tap targets. Used in the empty FX window and in the Add sheet. */
function FxPickerGrid({chain,onAdd}:{chain:FxChain;onAdd:(id:FxModuleId)=>void}){
  const inactive=FX_ORDER.filter(id=>!chain.modules.find(m=>m.id===id)?.on);
  return <div className="fx-picker-grid" role="group" aria-label="Choose an effect">
    {inactive.map(id=><button key={id} type="button" aria-label={'Add '+FX_MODULES[id].name}
      style={{['--fx-color' as string]:FX_MODULES[id].color}} onClick={()=>onAdd(id)}>
      <strong>{FX_MODULES[id].name}</strong><span>{BLURB[id]}</span></button>)}
  </div>;
}

function Stepper({label,name,value,min,max,color,onChange}:{label:string,name:string,value:number,min:number,max:number,color:string,onChange:(v:number)=>void}) {
  const v=Math.round(value);
  return <div className="fx-stepper" style={{['--fx-color' as string]:color}}>
    <span className="fx-stepper-label">{label}</span>
    <div><button type="button" aria-label={'Lower '+name} disabled={v<=min} onClick={()=>onChange(v-1)}><Minus size={15}/></button>
      <strong>{v}</strong>
      <button type="button" aria-label={'Raise '+name} disabled={v>=max} onClick={()=>onChange(v+1)}><Plus size={15}/></button></div>
  </div>;
}

type WindowProps = {chain?:FxChain; onChange:(c:FxChain)=>void; levels?:number[]; live?:Live; spectrum?:number[]; bpm?:number; focus?:FxModuleId|null; onFocus?:(id:FxModuleId)=>void};

/** FX focus window: the animated graph of each effect in use, or the Morph pad. */
export function FxWindow({chain:raw,onChange,levels,live,spectrum,bpm,focus,onFocus}:WindowProps) {
  const chain=normalizeChain(raw);
  const active=chain.modules.filter(m=>m.on);
  return <FrameWindow id="fx" label="FX" tabs={[
    {id:'GRAPHS',label:'Effects',render:()=>active.length?<div className="fx-focus">
      <div className="fx-focus-pick" role="group" aria-label="Effect to inspect">{active.map(m=><button type="button" key={m.id} aria-label={'Focus '+FX_MODULES[m.id].name}
        aria-pressed={m.id===(active.find(m=>m.id===focus)??active[0]).id} style={{['--fx-color' as string]:FX_MODULES[m.id].color}} onClick={()=>onFocus?.(m.id)}>{FX_MODULES[m.id].name}</button>)}</div>
      <div className="fx-graph-strip" style={{gridTemplateColumns:'minmax(0,1fr) 196px'}}>
      {(()=>{const state=active.find(m=>m.id===focus)??active[0],def=FX_MODULES[state.id],idx=FX_ORDER.indexOf(state.id);
        return <div className="fx-graph-tile" data-module={state.id} style={{['--fx-color' as string]:def.color}}>
          <span>{def.name} · {state.bypass?'Bypassed · ':''}Parameter preview</span>
          <FxGraph id={state.id} level={levels?.[idx]??0} color={def.color} on={!state.bypass} reduction={live?.comp} strings={live?.strings}
            params={live?.params?Object.fromEntries(def.params.map((p,j)=>[p.key,live.params[idx*NPAR+j]??state.params[p.key]])):state.params}/>
        </div>;})()}
      <div className="fx-graph-tile fx-output-tile" style={{['--fx-color' as string]:'#adb3bd'}}><span>Native output</span><Spectrum samples={spectrum}/></div>
      </div></div>:<div className="fx-window-pick"><p>Pick an effect to edit its controls and inspect its parameters.</p><FxPickerGrid chain={chain} onAdd={id=>onChange(addModule(chain,id))}/></div>},
    {id:'MORPH',label:'Morph pad',render:()=><MorphPad chain={chain} onChange={onChange} live={live} bpm={bpm}/>},
  ]}/>;
}

type CardProps = {selected:number; chain?:FxChain; onChange:(c:FxChain)=>void; live?:Live;
  armed:Source|null; autoFold:boolean; beat?:number; playing?:boolean; onFocus?:(id:FxModuleId)=>void};

/** FX rack: one compact card per effect, left to right, wrapping to a second row.
 *  While a mod source is linking, tapping a knob routes it there (tap again to remove). */
export function FxCards({selected,chain:raw,onChange,live,armed,autoFold,beat=0,playing=false,onFocus}:CardProps) {
  const chain=normalizeChain(raw);
  const [picking,setPicking]=useState(false);
  const [gateOpen,setGateOpen]=useState(false);
  const rack=useRef<HTMLDivElement>(null);
  useEffect(()=>{setPicking(false);setGateOpen(false);},[selected]);
  const active=chain.modules.filter(m=>m.on), inactive=chain.modules.filter(m=>!m.on);
  useAutoFold(rack,active.map(m=>'fx-'+m.id),autoFold);
  const linksInto=(id:FxModuleId)=>[...chain.macros,...chain.mods].reduce((n,src)=>n+src.targets.filter(t=>t.module===id).length,0);
  const setModule=(id:FxModuleId,patch:(m:FxChain['modules'][number])=>FxChain['modules'][number])=>
    onChange({...chain,modules:chain.modules.map(m=>m.id===id?patch(m):m)});
  const setParam=(id:FxModuleId,key:string,v:number)=>setModule(id,m=>({...m,params:{...m.params,[key]:v}}));
  const reset=(id:FxModuleId)=>setModule(id,m=>({...m,params:Object.fromEntries(FX_MODULES[id].params.map(p=>[p.key,p.init]))}));
  const move=(id:FxModuleId,dir:-1|1)=>{
    const order=[...active], i=order.findIndex(m=>m.id===id), j=i+dir;
    if(j<0||j>=order.length)return;
    [order[i],order[j]]=[order[j],order[i]];onChange({...chain,modules:[...order,...inactive]});
  };
  const add=(id:FxModuleId)=>{onChange(addModule(chain,id));setPicking(false);};
  useEffect(()=>{if(!picking)return;const k=(e:KeyboardEvent)=>{if(e.key==='Escape')setPicking(false);};
    window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k);},[picking]);
  // Removing an effect also drops the macro and mod-pad links that pointed at it.
  const remove=(id:FxModuleId)=>{
    const drop=(t:FxTarget[])=>t.filter(x=>x.module!==id);
    onChange({...chain,modules:[...active.filter(x=>x.id!==id),{...chain.modules.find(x=>x.id===id)!,on:false},...inactive],
      macros:chain.macros.map(m=>({...m,targets:drop(m.targets)})),mods:chain.mods.map(m=>({...m,targets:drop(m.targets)}))});
  };
  const toggleRoute=(module:FxModuleId,param:string)=>{
    if(!armed)return;
    const t=sourceTargets(chain,armed);
    const exists=t.findIndex(x=>x.module===module&&x.param===param);
    const next=exists>=0?t.filter((_,i)=>i!==exists):[...t,{module,param,depth:armed.kind==='macro'?.5:.4}];
    onChange(withTargets(chain,armed,next.slice(0,16)));
  };
  const routesFor=(module:FxModuleId,param:string)=>{
    const out:{color:string}[]=[];
    chain.macros.forEach((m,i)=>m.targets.some(t=>t.module===module&&t.param===param)&&out.push({color:MACRO_COLORS[i]}));
    chain.mods.forEach((m,i)=>m.targets.some(t=>t.module===module&&t.param===param)&&out.push({color:MOD_COLORS[i]}));
    return out;
  };
  const ring=useRingDepth(chain,onChange,armed,(m,p)=>toggleRoute(m as FxModuleId,p));
  const capture=(module:FxModuleId,param:string)=>ring.capture(module,param);

  return <div ref={rack} className={'frame-rack fx-cards'+(armed?' is-assigning':'')} role="list" aria-label="FX chain"
    style={{['--armed' as string]:armed?sourceColor(armed):'transparent'}} data-track={selected}>
    {active.map((state,pos)=>{
      const def=FX_MODULES[state.id], idx=FX_ORDER.indexOf(state.id);
      return {id:'fx-'+state.id,node:<Panel rail onUse={()=>{onFocus?.(state.id);window.dispatchEvent(new CustomEvent('decksynth-window',{detail:{id:'fx',tab:'GRAPHS'}}));}} role="listitem" key={state.id} id={'fx-'+state.id} label={def.name} title={def.name}
        className={'rack-card fx-card-module on'+(state.bypass?' bypassed':'')} tag={def.color} mods={linksInto(state.id)}
        style={{['--fx-color' as string]:def.color}}
        icon={<span className="fx-slot-no">{pos+1}</span>}
        power={{on:!state.bypass,label:def.name,onToggle:()=>setModule(state.id,m=>({...m,bypass:!m.bypass}))}}
        summary={state.bypass?'Off':undefined}
        actions={<span className="fx-order">
            <button type="button" aria-label={'Reset '+def.name} title="Reset this effect" onClick={()=>reset(state.id)}><RotateCcw size={14}/></button>
            <button type="button" aria-label={'Move '+def.name+' earlier'} disabled={pos===0}
              onClick={()=>move(state.id,-1)}><ChevronLeft size={15}/></button>
            <button type="button" aria-label={'Move '+def.name+' later'} disabled={pos===active.length-1}
              onClick={()=>move(state.id,1)}><ChevronRight size={15}/></button>
            <button type="button" className="fx-remove" aria-label={'Remove '+def.name}
              onClick={()=>remove(state.id)}><X size={15}/></button>
          </span>}>
        <div className="rack-card-body">
          {def.params.map((p,j)=>{
            if(p.hidden)return null;
            if(p.editor==='gate')return <GateStrip key={p.key} params={state.params} beat={beat} playing={playing} onOpen={()=>setGateOpen(true)}/>;
            const routes=routesFor(state.id,p.key);
            const routed=!!armed&&sourceTargets(chain,armed).some(t=>t.module===state.id&&t.param===p.key);
            const cls=(routes.length?' has-mod':'')+(routed?' routed-here':'');
            if(p.options)return <div key={p.key} className={'fx-choice'+cls} onPointerDownCapture={capture(state.id,p.key)}>
              <span className="fx-choice-label">{p.label}</span>
              <div className="fx-segment" role="radiogroup" aria-label={def.name+' '+p.label}>
                {p.options.map((label,k)=>{const v=p.min+k,on=Math.round(state.params[p.key])===v;
                  return <button key={label} type="button" role="radio" aria-checked={on} className={on?'active':''}
                    onClick={()=>setParam(state.id,p.key,v)}>{label}</button>;})}
              </div></div>;
            const liveValue=live?.params?.[idx*NPAR+j];
            return <div key={p.key} className={'fx-knob-cell'+cls} onPointerDownCapture={capture(state.id,p.key)}>
              {p.precision===0?<Stepper label={p.label} value={state.params[p.key]} min={p.min} max={p.max}
                name={def.name+' '+p.label} color={def.color} onChange={v=>setParam(state.id,p.key,v)}/>
              :<Knob id={selected+'-fx-'+state.id+'-'+p.key} name={p.label}
                value={state.params[p.key]} min={p.min} max={p.max} suffix={p.suffix??''}
                step={.001} precision={p.precision??2} accent={def.color} compact
                modValue={routes.length&&liveValue!==undefined?liveValue:null}
                modColor={routes[0]?.color}
                onChange={v=>setParam(state.id,p.key,v)}/>}
              {routes.length?<span className="fx-route-dots">{routes.map((r,k)=><i key={k} style={{background:r.color}}/>)}</span>:null}
            </div>;
          })}
        </div>
      </Panel>};
    }).map(({id,node})=><Fragment key={id}>{node}</Fragment>)}
    {inactive.length?<div role="listitem" className={'rack-card fx-add-card'+(active.length?'':' empty')}>
      <button type="button" className="fx-add-open" aria-label="Add effect" aria-expanded={picking} onClick={()=>setPicking(v=>!v)}>
        <Plus size={22}/><strong>Add effect</strong>
        {active.length?null:<span>This track has no effects yet.</span>}
      </button>
    </div>:null}
    {picking&&rack.current?.closest('.frame')?createPortal(<div className="fx-picker-sheet" onPointerDown={e=>{if(e.target===e.currentTarget)setPicking(false);}}>
      <div className="fx-picker" role="dialog" aria-label="Add effect">
        <div className="fx-picker-head"><strong>Add effect</strong><span>Effects run left to right.</span>
          <button type="button" aria-label="Cancel adding effect" onClick={()=>setPicking(false)}><X size={16}/></button></div>
        <FxPickerGrid chain={chain} onAdd={add}/>
      </div></div>,rack.current.closest('.frame')!):null}
    {gateOpen&&chain.modules.find(m=>m.id==='gate')?.on?<GateSheet params={chain.modules.find(m=>m.id==='gate')!.params}
      color={FX_MODULES.gate.color} beat={beat} playing={playing} container={rack.current?.closest('.frame')??null}
      onParam={(k,v)=>setParam('gate',k,v)} onClose={()=>setGateOpen(false)}/>:null}
    {ring.bubble}
  </div>;
}
