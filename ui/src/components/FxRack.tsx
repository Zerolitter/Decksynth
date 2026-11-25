import {RackScrollControls,useRackNavigation} from './RackNavigation';
import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRingDepth } from './RingDepth';
import { ListMusic, Plus, RotateCcw, X } from 'lucide-react';
import { Knob } from './Knob';
import { Panel, useAutoFold } from './Panel';
import { useRackOrder } from './RackOrder';
import { FX_MODULES, FX_ORDER, addModule, normalizeChain, type FxChain, type FxModuleId, type FxParamDef, type FxTarget } from '../fx';
import { GateSheet, GateStrip } from './GateSheet';
import { FX_PRESETS, presetParams } from '../fx-presets';
import { MACRO_COLORS, MOD_COLORS, linkedSourceColors, sourceColor, sourceTargets, withTargets, type Live, type Source } from './ModParts';

export { MACRO_COLORS, MOD_COLORS };
const NPAR=8;  // parameters per module in the engine's array (decksynth/fx.py NPAR)
const BLURB:Record<FxModuleId,string>={
  cloud:'Diffused, pitch-scattered stereo texture',stutter:'Repeats short slices in time', filter:'Low, band or high pass', overdrive:'Warm to heavy distortion',
  bitcrusher:'Lo-fi grit and aliasing', volume:'Level, for gating and tremolo', phaser:'Sweeping notches',
  flanger:'Jet-like comb sweep', ringmod:'Metallic, bell-like tones', delay:'Tempo-synced echoes',
  reverb:'Room to huge space', time:'Tape-style speed changes', chorus:'Wide, thick doubled voices',
  compressor:'Evens out loud and soft', eq:'Low, mid and high tone', autowah:'Opens up the harder you play',
  resonator:'Strings that ring with your notes', gate:'Rhythmic on/off pattern on the beat',
  pitch:'Up or down in semitones and cents', autotune:'Pulls notes to the project scale',
  duck:'Another track pushes this one down', vocoder:'Another track shapes this one\'s tone',
  tape:'Wow, flutter, saturation and hiss', smear:'Blurs the sound in time', shimmer:'Reverb that climbs in pitch',
  space:'Huge hall with Freeze'};

/** The effects you can still add, as big tap targets. Used in the empty FX window and in the Add sheet. */
function FxPickerGrid({chain,onAdd}:{chain:FxChain;onAdd:(id:FxModuleId)=>void}){
  const inactive=FX_ORDER.filter(id=>!chain.modules.find(m=>m.id===id)?.on);
  return <div className="fx-picker-grid" role="group" aria-label="Choose an effect">
    {inactive.map(id=><button key={id} type="button" aria-label={'Add '+FX_MODULES[id].name}
      style={{['--fx-color' as string]:FX_MODULES[id].color}} onClick={()=>onAdd(id)}>
      <strong>{FX_MODULES[id].name}</strong><span>{BLURB[id]}</span></button>)}
  </div>;
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
  const [presetsFor,setPresetsFor]=useState<FxModuleId|null>(null);
  const rack=useRef<HTMLDivElement>(null);
  const navigation=useRackNavigation(rack,'decksynth.rack-scroll.fx.'+selected);
  useEffect(()=>{setPicking(false);setGateOpen(false);setPresetsFor(null);},[selected]);
  const active=chain.modules.filter(m=>m.on), inactive=chain.modules.filter(m=>!m.on);
  const reorder=useRackOrder(rack,active.map(m=>'fx-'+m.id),ids=>{
    onReorder(ids.map(id=>id.slice(3) as FxModuleId));
  },selected);
  useAutoFold(rack,active.map(m=>'fx-'+m.id),autoFold);
  const linksInto=(id:FxModuleId)=>[...chain.macros,...chain.mods].reduce((n,src)=>n+src.targets.filter(t=>t.module===id).length,0);
  const setModule=(id:FxModuleId,patch:(m:FxChain['modules'][number])=>FxChain['modules'][number])=>
    onChange({...chain,modules:chain.modules.map(m=>m.id===id?patch(m):m)});
  const setParam=(id:FxModuleId,key:string,v:number)=>setModule(id,m=>({...m,params:{...m.params,[key]:v}}));
  const setParams=(id:FxModuleId,params:Record<string,number>)=>setModule(id,m=>({...m,params:{...m.params,...params}}));
  const reset=(id:FxModuleId)=>setModule(id,m=>({...m,params:Object.fromEntries(FX_MODULES[id].params.map(p=>[p.key,p.init]))}));
  const add=(id:FxModuleId)=>{onChange(addModule(chain,id));setPicking(false);};
  useEffect(()=>{if(!picking&&!presetsFor)return;const k=(e:KeyboardEvent)=>{if(e.key==='Escape'){setPicking(false);setPresetsFor(null);}};
    window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k);},[picking,presetsFor]);
  // A tap anywhere outside the open sheet closes it (UI-RULES 14; Sir, 25 Nov: the presets sheet stayed open). The sheet fills
  // the window below the mod band, so this listens on the whole document, not on its backdrop. Its own opener toggles as before.
  useEffect(()=>{if(!picking&&!presetsFor)return;
    const down=(e:PointerEvent)=>{const t=e.target as Element|null;
      if(!t||t.closest?.('.fx-picker-sheet .fx-picker')||t.closest?.('[data-fx-opener]'))return;
      setPicking(false);setPresetsFor(null);};
    document.addEventListener('pointerdown',down,true);return()=>document.removeEventListener('pointerdown',down,true);},[picking,presetsFor]);
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
            <button type="button" data-fx-opener aria-label={'Presets for '+def.name} title="Presets" aria-expanded={presetsFor===state.id} onClick={()=>setPresetsFor(presetsFor===state.id?null:state.id)}><ListMusic size={14}/></button>
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
                <span className="fx-choice-label">{p.label}
                  {v===selected||v>=tracks.length?<small className="fx-track-warn" title="A track can't drive itself">Pick another track</small>:null}</span>
                <div className="fx-segment fx-track-buttons" role="radiogroup" aria-label={def.name+' '+p.label}>
                  {tracks.map((name,i)=><button key={i} type="button" role="radio" aria-checked={v===i} disabled={i===selected}
                    className={v===i?'active':''} title={i===selected?'This track: a track can\'t drive itself':'Track '+(i+1)+' · '+name}
                    aria-label={'Track '+(i+1)+', '+name+(i===selected?' (this track)':'')} onClick={()=>setParam(state.id,p.key,i)}>
                    <b>{i+1}</b><span>{name}</span></button>)}
                </div>
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
                value={state.params[p.key]??p.init} min={p.min} max={p.max} suffix={p.suffix??''} defaultValue={p.init}
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
      <button type="button" className="fx-add-open" data-fx-opener aria-label="Add effect" aria-expanded={picking} onClick={()=>setPicking(v=>!v)}>
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
    {presetsFor&&rack.current?.closest('.frame')?(()=>{const id=presetsFor,def=FX_MODULES[id],cur=chain.modules.find(m=>m.id===id)?.params??{};
      return createPortal(<div className="fx-picker-sheet" onPointerDown={e=>{if(e.target===e.currentTarget)setPresetsFor(null);}}>
        <div className="fx-picker fx-presets" role="dialog" aria-label={def.name+' presets'} style={{['--fx-color' as string]:def.color}}>
          <div className="fx-picker-head"><strong>{def.name} presets</strong><span>Sets this effect's knobs. Tap one to hear it.</span>
            <button type="button" aria-label="Close presets" onClick={()=>setPresetsFor(null)}><X size={16}/></button></div>
          <div className="fx-picker-grid" role="group" aria-label={def.name+' presets'}>
            {FX_PRESETS[id].map(pr=>{const v=presetParams(id,pr,cur),on=def.params.every(p=>Math.abs((cur[p.key]??p.init)-v[p.key])<1e-6);
              return <button key={pr.name} type="button" className={on?'active':''} aria-pressed={on} aria-label={def.name+' preset '+pr.name}
                style={{['--fx-color' as string]:def.color}} onClick={()=>{setParams(id,v);}}>
                <strong>{pr.name}</strong></button>;})}
          </div></div></div>,rack.current!.closest('.frame')!);})():null}
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
