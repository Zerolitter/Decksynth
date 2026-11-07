import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRingDepth } from './RingDepth';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';
import { Knob } from './Knob';
import { Panel, markUsed, setFold, useAutoFold } from './Panel';
import { useRackOrder } from './RackOrder';
import { FX_MODULES, FX_ORDER, addModule, normalizeChain, type FxChain, type FxModuleId, type FxTarget } from '../fx';
import { MorphPad } from './MorphPad';
import { GateSheet, GateStrip } from './GateSheet';
import { MACRO_COLORS, MOD_COLORS, linkedSourceColors, sourceColor, sourceTargets, withTargets, type Live, type Source } from './ModParts';

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

type WindowProps = {chain?:FxChain; onChange:(c:FxChain)=>void; live?:Live; bpm?:number};

/** Morph is always in the middle; its existing header also names the cards in the bottom chain. */
export function FxWindow({chain:raw,onChange,live,bpm}:WindowProps) {
  const chain=normalizeChain(raw);
  const windowRef=useRef<HTMLElement>(null);
  const reveal=(id:FxModuleId)=>{
    const panel='fx-'+id,frame=windowRef.current?.closest('.frame');markUsed(panel);setFold(panel,false);
    requestAnimationFrame(()=>{if(!frame?.isConnected)return;const card=frame.querySelector<HTMLElement>('[data-panel="'+panel+'"]');
      card?.scrollIntoView({block:'nearest',inline:'nearest'});card?.querySelector<HTMLElement>('.ds-panel-title')?.focus({preventScroll:true});});
  };
  return <section ref={windowRef} className="frame-window" data-window="fx" data-view="MORPH" aria-label="FX window">
    <header className="frame-window-bar">
      <span className="frame-window-label">Morph pad</span>
      <div className="fx-chain-tags" role="group" aria-label="FX card tags">
        {chain.modules.filter(m=>m.on).map(m=><button key={m.id} type="button" aria-label={'Show '+FX_MODULES[m.id].name+' card'}
          style={{['--fx-color' as string]:FX_MODULES[m.id].color}} onClick={()=>reveal(m.id)}>
          {FX_MODULES[m.id].name}{m.bypass?<small> · Off</small>:null}</button>)}
      </div>
    </header>
    <div className="frame-window-body"><MorphPad chain={chain} onChange={onChange} live={live} bpm={bpm}/></div>
  </section>;
}

type CardProps = {selected:number; chain?:FxChain; onChange:(c:FxChain)=>void; live?:Live;
  onReorder:(ids:FxModuleId[])=>void;
  armed:Source|null; source?:Source; autoFold:boolean; beat?:number; playing?:boolean};

/** FX rack: one compact card per effect, left to right, wrapping to a second row.
 *  While a mod source is linking, tapping a knob routes it there (tap again to remove). */
export function FxCards({selected,chain:raw,onChange,onReorder,live,armed,source,autoFold,beat=0,playing=false}:CardProps) {
  const chain=normalizeChain(raw);
  const [picking,setPicking]=useState(false);
  const [gateOpen,setGateOpen]=useState(false);
  const rack=useRef<HTMLDivElement>(null);
  useEffect(()=>{setPicking(false);setGateOpen(false);},[selected]);
  const active=chain.modules.filter(m=>m.on), inactive=chain.modules.filter(m=>!m.on);
  const reorder=useRackOrder(rack,active.map(m=>'fx-'+m.id),ids=>{
    onReorder(ids.map(id=>id.slice(3) as FxModuleId));
  },selected);
  useAutoFold(rack,active.map(m=>'fx-'+m.id),autoFold);
  const linksInto=(id:FxModuleId)=>[...chain.macros,...chain.mods].reduce((n,src)=>n+src.targets.filter(t=>t.module===id).length,0);
  const setModule=(id:FxModuleId,patch:(m:FxChain['modules'][number])=>FxChain['modules'][number])=>
    onChange({...chain,modules:chain.modules.map(m=>m.id===id?patch(m):m)});
  const setParam=(id:FxModuleId,key:string,v:number)=>setModule(id,m=>({...m,params:{...m.params,[key]:v}}));
  const reset=(id:FxModuleId)=>setModule(id,m=>({...m,params:Object.fromEntries(FX_MODULES[id].params.map(p=>[p.key,p.init]))}));
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
      return {id:'fx-'+state.id,node:<Panel rail reorder={reorder('fx-'+state.id)} role="listitem" key={state.id} id={'fx-'+state.id} label={def.name} title={def.name}
        className={'rack-card fx-card-module on'+(state.bypass?' bypassed':'')} tag={def.color} mods={linksInto(state.id)}
        modColors={linkedSourceColors(chain,t=>t.module===state.id)}
        style={{['--fx-color' as string]:def.color}}
        icon={<span className="fx-slot-no">{pos+1}</span>}
        power={{on:!state.bypass,label:def.name,onToggle:()=>setModule(state.id,m=>({...m,bypass:!m.bypass}))}}
        summary={state.bypass?'Off':undefined}
        actions={<span className="fx-order">
            <button type="button" aria-label={'Reset '+def.name} title="Reset this effect" onClick={()=>reset(state.id)}><RotateCcw size={14}/></button>
            <button type="button" className="fx-remove" aria-label={'Remove '+def.name}
              onClick={()=>remove(state.id)}><X size={15}/></button>
          </span>}>
        <div className="rack-card-body">
          {def.params.map((p,j)=>{
            if(p.hidden)return null;
            if(p.editor==='gate')return <GateStrip key={p.key} params={state.params} runtime={live?.gate} onOpen={()=>setGateOpen(true)}/>;
            const routes=routesFor(state.id,p.key);
            const routed=!!armed&&sourceTargets(chain,armed).some(t=>t.module===state.id&&t.param===p.key);
            const preferred=armed??source;
            const color=preferred&&sourceTargets(chain,preferred).some(t=>t.module===state.id&&t.param===p.key)?sourceColor(preferred):routes[0]?.color;
            const cls=(routes.length?' has-mod':'')+(routed?' routed-here':'');
            if(p.options)return <div key={p.key} className={'fx-choice'+cls} onPointerDownCapture={p.modulatable===false?undefined:capture(state.id,p.key)}>
              <span className="fx-choice-label">{p.label}</span>
              <div className="fx-segment" role="radiogroup" aria-label={def.name+' '+p.label}>
                {p.options.map((label,k)=>{const v=p.min+k,on=Math.round(state.params[p.key]??p.init)===v;
                  return <button key={label} type="button" role="radio" aria-checked={on} className={on?'active':''}
                    onClick={()=>setParam(state.id,p.key,v)}>{label}</button>;})}
              </div></div>;
            const liveValue=state.id==='gate'&&j>=NPAR?live?.gate?.values[p.key]:live?.params?.[idx*NPAR+j];
            return <div key={p.key} className={'fx-knob-cell'+cls} onPointerDownCapture={capture(state.id,p.key)}>
              {p.precision===0?<Stepper label={p.label} value={state.params[p.key]??p.init} min={p.min} max={p.max}
                name={def.name+' '+p.label} color={def.color} onChange={v=>setParam(state.id,p.key,v)}/>
              :<Knob id={selected+'-fx-'+state.id+'-'+p.key} name={p.label}
                value={state.params[p.key]??p.init} min={p.min} max={p.max} suffix={p.suffix??''}
                step={.001} precision={p.precision??2} accent={def.color} compact
                modValue={routes.length&&liveValue!==undefined?liveValue:null}
                modColor={color}
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
      color={FX_MODULES.gate.color} runtime={live?.gate} container={rack.current?.closest('.frame')??null}
      onParam={(k,v)=>setParam('gate',k,v)} onClose={()=>setGateOpen(false)}/>:null}
    {ring.bubble}
  </div>;
}
