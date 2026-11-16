import {RackScrollControls,useRackNavigation} from './RackNavigation';
import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRingDepth } from './RingDepth';
import { ChevronsDownUp, ChevronsUpDown, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { Knob } from './Knob';
import { Panel, markUsed, setFold, useAutoFold,usePanelScope } from './Panel';
import { useRackOrder } from './RackOrder';
import { FX_MODULES, FX_ORDER, addModule, normalizeChain, type FxChain, type FxModuleId, type FxParamDef, type FxTarget } from '../fx';
import { MorphPad } from './MorphPad';
import { GateSheet, GateStrip } from './GateSheet';
import { MACRO_COLORS, MOD_COLORS, linkedSourceColors, sourceColor, sourceTargets, withTargets, type Live, type Source } from './ModParts';

export { MACRO_COLORS, MOD_COLORS };
const NPAR=6;
const BLURB:Record<FxModuleId,string>={
  cloud:'Diffused, pitch-scattered stereo texture',stutter:'Repeats short slices in time', filter:'Low, band or high pass', overdrive:'Warm to heavy distortion',
  bitcrusher:'Lo-fi grit and aliasing', volume:'Level, for gating and tremolo', phaser:'Sweeping notches',
  flanger:'Jet-like comb sweep', ringmod:'Metallic, bell-like tones', delay:'Tempo-synced echoes',
  reverb:'Room to huge space', time:'Tape-style speed changes', chorus:'Wide, thick doubled voices',
  compressor:'Evens out loud and soft', eq:'Low, mid and high tone', autowah:'Opens up the harder you play',
  resonator:'Strings that ring with your notes', gate:'Rhythmic on/off pattern on the beat',
  pitch:'Up or down in semitones and cents', autotune:'Pulls notes to the project scale',
  duck:'Another track pushes this one down', vocoder:'Another track shapes this one\'s tone'};

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

type WindowProps = {chain?:FxChain; onChange:(c:FxChain)=>void; live?:Live; bpm?:number;
  /** Morph pad folded to its title bar so the effect cards get the room (as on the Sound tab). */
  folded?:boolean; onFold?:(folded:boolean)=>void};

/** Morph is always in the middle; its existing header also names the cards in the bottom chain. */
export function FxWindow({chain:raw,onChange,live,bpm,folded=false,onFold}:WindowProps) {
  const chain=normalizeChain(raw);
  const windowRef=useRef<HTMLElement>(null),scope=usePanelScope();
  const reveal=(id:FxModuleId)=>{
    const panel='fx-'+id,frame=windowRef.current?.closest('.frame');markUsed(panel,scope);setFold(panel,false,scope);
    requestAnimationFrame(()=>{if(!frame?.isConnected)return;const card=frame.querySelector<HTMLElement>('[data-panel="'+panel+'"]');
      card?.scrollIntoView({block:'nearest',inline:'nearest'});card?.querySelector<HTMLElement>('.ds-panel-title')?.focus({preventScroll:true});});
  };
  return <section ref={windowRef} className={'frame-window'+(folded?' is-folded':'')} data-window="fx" data-view="MORPH" aria-label="FX window">
    <header className="frame-window-bar">
      <span className="frame-window-label">Morph pad</span>
      <div className="fx-chain-tags" role="group" aria-label="FX card tags">
        {chain.modules.filter(m=>m.on).map(m=><button key={m.id} type="button" aria-label={'Show '+FX_MODULES[m.id].name+' card'}
          style={{['--fx-color' as string]:FX_MODULES[m.id].color}} onClick={()=>reveal(m.id)}>
          {FX_MODULES[m.id].name}{m.bypass?<small> · Off</small>:null}</button>)}
      </div>
      {onFold?<span className="frame-window-actions"><button type="button" className="frame-window-fold" aria-expanded={!folded}
        title={folded?'Show the Morph pad':'Hide the Morph pad to give the effect cards more room'}
        onClick={()=>onFold(!folded)}>{folded?<ChevronsUpDown size={16}/>:<ChevronsDownUp size={16}/>}{folded?'Show':'Hide'}</button></span>:null}
    </header>
    {folded?null:<div className="frame-window-body"><MorphPad chain={chain} onChange={onChange} live={live} bpm={bpm}/></div>}
  </section>;
}

/** FX page grid (Sir, 16 Nov: "this can be done better"). The page is 9 even columns; a column fits one
 *  knob cell (44 px dial + 76 px value box). Every card holds its controls in two lines, so a card is as wide as
 *  half its controls (at least 3 columns, so the title bar fits). Cards keep chain order and fill each row: the last card of a row takes the spare columns. */
export const FX_COLS=9;
const COL_PX=133;
/** columns (w) and lines (h) a control takes */
export function fxParamSize(p:FxParamDef):{w:number;h:number}{
  if(p.hidden)return {w:0,h:0};
  if(p.editor==='gate')return {w:2,h:2};
  if(p.editor==='track')return {w:4,h:1};
  // the name, then one button per option (12 px bold, about 7 px a letter)
  if(p.options){const px=p.label.length*6+18+p.options.reduce((n,o)=>n+Math.max(44,o.length*7+19)+3,0);return {w:Math.max(1,Math.ceil(px/COL_PX)),h:1};}
  return {w:1,h:1};
}
export function fxCardCols(id:FxModuleId):number{
  const sizes=FX_MODULES[id].params.map(fxParamSize).concat(id==='autotune'||id==='duck'?[{w:2,h:1}]:[]);
  const area=sizes.reduce((n,x)=>n+x.w*x.h,0),widest=sizes.reduce((n,x)=>Math.max(n,x.w),0);
  return Math.min(FX_COLS,Math.max(3,widest,Math.ceil(area/2)));
}
/** spans per card in chain order, plus the span left for the Add card on the last row (0: none) */
export function fxGridSpans(ids:FxModuleId[],withAdd:boolean):{spans:Record<string,number>;add:number}{
  const spans:Record<string,number>={};let used=0,last:FxModuleId|null=null;
  for(const id of ids){const c=fxCardCols(id);
    if(used+c>FX_COLS&&last){spans[last]+=FX_COLS-used;used=0;}
    spans[id]=c;used+=c;last=id;}
  const rest=FX_COLS-used;
  if(!withAdd){if(last&&rest>0)spans[last]+=rest;return {spans,add:0};}
  // Add effect takes at least 2 columns; on a full row it becomes a slim bar of its own
  if(rest>=2)return {spans,add:rest};
  if(last&&rest>0)spans[last]+=rest;
  return {spans,add:FX_COLS};
}

type CardProps = {selected:number; chain?:FxChain; onChange:(c:FxChain)=>void; live?:Live;
  onReorder:(ids:FxModuleId[])=>void;
  armed:Source|null; source?:Source; autoFold:boolean; beat?:number; playing?:boolean;
  /** names of the project's tracks, for Ducking and Vocoder sources */ tracks?:string[]};
const NOTE_NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const noteName=(m:number)=>NOTE_NAMES[((Math.round(m)%12)+12)%12]+(Math.floor(Math.round(m)/12)-1);

/** FX rack: one compact card per effect, left to right, wrapping to a second row.
 *  While a mod source is linking, tapping a knob routes it there (tap again to remove). */
export function FxCards({selected,chain:raw,onChange,onReorder,live,armed,source,autoFold,beat=0,playing=false,tracks=[]}:CardProps) {
  const chain=normalizeChain(raw);
  const [picking,setPicking]=useState(false);
  const [gateOpen,setGateOpen]=useState(false);
  const rack=useRef<HTMLDivElement>(null);
  const navigation=useRackNavigation(rack,'decksynth.rack-scroll.fx.'+selected);
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
  const grid=fxGridSpans(active.map(m=>m.id),inactive.length>0);
  const at=(p:FxParamDef)=>{const z=fxParamSize(p);return {gridColumn:'span '+z.w,gridRow:'span '+z.h};};

  return <div ref={rack} tabIndex={0} className={'frame-rack fx-cards'+(armed?' is-assigning':'')} role="list" aria-label="FX chain"
    style={{['--armed' as string]:armed?sourceColor(armed):'transparent'}} data-track={selected}>
    <RackScrollControls label="FX" nav={navigation}/>{active.map((state,pos)=>{
      const def=FX_MODULES[state.id], idx=FX_ORDER.indexOf(state.id);
      return {id:'fx-'+state.id,node:<Panel rail reorder={reorder('fx-'+state.id)} role="listitem" key={state.id} id={'fx-'+state.id} label={def.name} title={def.name}
        className={'rack-card fx-card-module on'+(state.bypass?' bypassed':'')} tag={def.color} mods={linksInto(state.id)}
        modColors={linkedSourceColors(chain,t=>t.module===state.id)}
        style={{['--fx-color' as string]:def.color,gridColumn:'span '+grid.spans[state.id]}}
        icon={<span className="fx-slot-no">{pos+1}</span>}
        power={{on:!state.bypass,label:def.name,onToggle:()=>setModule(state.id,m=>({...m,bypass:!m.bypass}))}}
        summary={state.bypass?'Off':undefined}
        actions={<span className="fx-order">
            <button type="button" aria-label={'Reset '+def.name} title="Reset this effect" onClick={()=>reset(state.id)}><RotateCcw size={14}/></button>
            <button type="button" className="fx-remove" aria-label={'Remove '+def.name}
              onClick={()=>remove(state.id)}><X size={15}/></button>
          </span>}>
        <div className="rack-card-body fx-grid-body" style={{gridTemplateColumns:'repeat('+grid.spans[state.id]+',minmax(0,1fr))'}}>
          {state.id==='autotune'||state.id==='duck'?<div className="fx-grid-cell" style={{gridColumn:'span 2'}}><FxReadout id={state.id} readout={live?.readout} color={def.color}/></div>:null}
          {def.params.map((p,j)=>{
            if(p.hidden)return null;
            if(p.editor==='gate')return <div key={p.key} className="fx-grid-cell fx-gate-cell" style={at(p)}><GateStrip params={state.params} runtime={live?.gate} onOpen={()=>setGateOpen(true)}/></div>;
            if(p.editor==='track'){const v=Math.round(state.params[p.key]??p.init);
              return <div key={p.key} className="fx-track-pick" style={at(p)}>
                <span className="fx-choice-label">{p.label}</span>
                <div className="fx-segment fx-track-buttons" role="radiogroup" aria-label={def.name+' '+p.label}>
                  {tracks.map((name,i)=><button key={i} type="button" role="radio" aria-checked={v===i} disabled={i===selected}
                    className={v===i?'active':''} title={i===selected?'This track: a track can\'t drive itself':'Track '+(i+1)+' · '+name}
                    aria-label={'Track '+(i+1)+', '+name+(i===selected?' (this track)':'')} onClick={()=>setParam(state.id,p.key,i)}>
                    <b>{i+1}</b><span>{name}</span></button>)}
                </div>
                {v===selected||v>=tracks.length?<small className="fx-track-warn">Pick another track: a track can't drive itself.</small>:null}
              </div>;}
            const routes=routesFor(state.id,p.key);
            const routed=!!armed&&sourceTargets(chain,armed).some(t=>t.module===state.id&&t.param===p.key);
            const preferred=armed??source;
            const color=preferred&&sourceTargets(chain,preferred).some(t=>t.module===state.id&&t.param===p.key)?sourceColor(preferred):routes[0]?.color;
            const cls=(routes.length?' has-mod':'')+(routed?' routed-here':'');
            if(p.options)return <div key={p.key} className={'fx-choice'+cls} style={at(p)} onPointerDownCapture={p.modulatable===false?undefined:capture(state.id,p.key)}>
              <span className="fx-choice-label">{p.label}</span>
              <div className="fx-segment" role="radiogroup" aria-label={def.name+' '+p.label}>
                {p.options.map((label,k)=>{const v=p.min+k,on=Math.round(state.params[p.key]??p.init)===v;
                  return <button key={label} type="button" role="radio" aria-checked={on} className={on?'active':''}
                    onClick={()=>setParam(state.id,p.key,v)}>{label}</button>;})}
              </div></div>;
            const liveValue=state.id==='gate'&&j>=NPAR?live?.gate?.values[p.key]:live?.params?.[idx*NPAR+j];
            // whole numbers are knobs too, with a value box (rule 36: value boxes, not steppers)
            return <div key={p.key} className={'fx-knob-cell'+cls} style={at(p)} onPointerDownCapture={capture(state.id,p.key)}>
              {<Knob id={selected+'-fx-'+state.id+'-'+p.key} name={p.label}
                value={state.params[p.key]??p.init} min={p.min} max={p.max} suffix={p.suffix??''}
                step={p.precision===0?1:.001} precision={p.precision??2} accent={def.color} compact
                modValue={routes.length&&liveValue!==undefined?liveValue:null}
                modColor={color}
                onChange={v=>setParam(state.id,p.key,v)}/>}
              {routes.length?<span className="fx-route-dots">{routes.map((r,k)=><i key={k} style={{background:r.color}}/>)}</span>:null}
            </div>;
          })}
        </div>
      </Panel>};
    }).map(({id,node})=><Fragment key={id}>{node}</Fragment>)}
    {!active.length?<div role="listitem" className="fx-empty-picker" aria-label="Add effect">
      <div className="fx-picker-head"><strong>Add an effect</strong><span>This track has none yet. Effects run left to right; tap one to add it.</span></div>
      <FxPickerGrid chain={chain} onAdd={add}/></div>
    :inactive.length?<div role="listitem" className="rack-card fx-add-card" style={{gridColumn:'span '+grid.add}}>
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

/** Auto-tune shows the note it hears and how far it pulls it; Ducking shows how far it pushes the track down now. */
function FxReadout({id,readout,color}:{id:'autotune'|'duck';readout?:{note:number;cents:number;duck:number}|null;color:string}){
  if(id==='duck'){const db=readout?.duck??0,fill=Math.min(1,db/24);
    return <div className="fx-readout" role="meter" aria-label="Ducking now" aria-valuemin={0} aria-valuemax={24} aria-valuenow={Math.round(db*10)/10}>
      <span>Ducking now</span><i className="fx-readout-bar"><b style={{width:(fill*100)+'%',background:color}}/></i><strong>{db>.05?'-'+db.toFixed(1)+' dB':'0 dB'}</strong></div>;}
  const note=readout?.note??0,c=readout?.cents??0;
  return <div className="fx-readout" role="status" aria-label="Auto-tune hears">
    <span>Hears</span><strong>{note>0?noteName(note)+' '+(note-Math.round(note)>=0?'+':'')+Math.round((note-Math.round(note))*100)+' ct':'—'}</strong>
    <span>Pull</span><strong style={{color}}>{note>0?(c>=0?'+':'')+Math.round(c)+' ct':'—'}</strong></div>;
}
