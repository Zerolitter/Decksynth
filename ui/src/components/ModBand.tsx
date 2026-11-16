import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Eraser, Maximize2 } from 'lucide-react';
import { Knob } from './Knob';
import { FEEL_FACTOR, MOD_RATES, MOD_RATE_ORDER, normalizeChain, rateLabel, type FxChain } from '../fx';
import {
  LinkSummary, MACRO_COLORS, MOD_COLORS, RATE_BEATS, SHAPE_LABEL, ShapePreview,
  sourceColor, type Live, type Source,
} from './ModParts';
import { MacroSheet, ModSheet, type SheetTab } from './ModSheet';

type Props = {
  selected:number; chain?:FxChain; onChange:(c:FxChain)=>void; beat:number; live?:Live;
  edit:Source; onEdit:(s:Source)=>void;
  armed:Source|null; onLink:(s:Source|null)=>void;
};

/** The mod band: macros stacked over the 8 mod pads, and the editor of the tapped source beside them.
 *  It sits in the same place on Sound and FX. Tap a pad to edit it. Tap the label on its bottom lip
 *  (or a macro's name) to link it: every knob tapped after that is routed to it, until Done or a second tap. */
export function ModBand({selected,chain:raw,onChange,beat,live,edit,onEdit,armed,onLink}:Props) {
  const chain=normalizeChain(raw);
  const phaseOf=(i:number)=>chain.mods[i].targets.length&&live?.phases?live.phases[i]
    :(beat/(RATE_BEATS[chain.mods[i].rate]*FEEL_FACTOR[chain.mods[i].feel??'']))%1;
  const band=useRef<HTMLElement>(null);
  const [sheet,setSheet]=useState<SheetTab|null>(null);
  useEffect(()=>{setSheet(null);},[selected,edit.kind,edit.index]);
  const isEdit=(k:Source['kind'],i:number)=>edit.kind===k&&edit.index===i;
  const color=sourceColor(edit);
  const mod=edit.kind==='mod'?chain.mods[edit.index]:null, macro=edit.kind==='macro'?chain.macros[edit.index]:null;
  const setMod=(patch:Partial<FxChain['mods'][number]>)=>onChange({...chain,mods:chain.mods.map((x,j)=>j===edit.index?{...x,...patch}:x)});
  const setMacro=(patch:Partial<FxChain['macros'][number]>)=>onChange({...chain,macros:chain.macros.map((x,j)=>j===edit.index?{...x,...patch}:x)});
  const linking=!!armed&&armed.kind===edit.kind&&armed.index===edit.index;
  const isArmed=(k:Source['kind'],i:number)=>armed?.kind===k&&armed.index===i;
  const lip=(src:Source)=>{if(isArmed(src.kind,src.index))onLink(null);else{onEdit(src);onLink(src);}};
  const label=mod?'Mod pad '+(edit.index+1):macro!.name;
  const links=(mod??macro)!.targets;

  return <section ref={band} className="mod-band" aria-label="Modulation" data-track={selected}>
    <div className="mb-sources">
      <div className="mb-row fx-macro-row" aria-label="Macros">
        {chain.macros.map((m,i)=><div key={i}
          className={'fx-macro'+(isEdit('macro',i)?' editing':'')+(armed?.kind==='macro'&&armed.index===i?' armed':'')+(m.targets.length?' routed':'')}
          style={{['--src' as string]:MACRO_COLORS[i]}}>
          <Knob id={selected+'-macro-'+i} name={m.name} value={m.value} min={0} max={1} accent={MACRO_COLORS[i]}
            compact onChange={v=>onChange({...chain,macros:chain.macros.map((x,j)=>j===i?{...x,value:v}:x)})}/>
          <button type="button" className="fx-src-arm" aria-pressed={isArmed('macro',i)}
            aria-label={'Link '+m.name+' to knobs'} onClick={()=>lip({kind:'macro',index:i})}>
            {m.name}{m.targets.length?' · '+m.targets.length:''}</button>
        </div>)}
      </div>
      <div className="mb-row fx-pad-row" aria-label="Mod pads">
        {chain.mods.map((m,i)=><div key={i}
          className={'fx-pad'+(isEdit('mod',i)?' editing':'')+(isArmed('mod',i)?' armed':'')+(m.targets.length?' routed':'')}
          style={{['--src' as string]:MOD_COLORS[i]}}>
          <button type="button" className="fx-pad-main" aria-pressed={isEdit('mod',i)} aria-label={'Mod pad '+(i+1)+' '+m.shape}
            onClick={()=>onEdit({kind:'mod',index:i})}>
            <ShapePreview shape={m.shape} steps={m.steps} count={m.count} points={m.points} phase={phaseOf(i)} color={MOD_COLORS[i]}
              live={m.targets.length?live?.mods?.[i]:undefined} active={m.targets.length>0}/>
          </button>
          <button type="button" className="fx-pad-label" aria-pressed={isArmed('mod',i)} aria-label={'Link Mod pad '+(i+1)+' to knobs'}
            onClick={()=>lip({kind:'mod',index:i})}>{i+1} · {rateLabel(m).replace('16 bars','16 bar')}</button>
        </div>)}
      </div>
    </div>

    <div className={'pad-editor'+(linking?' linking':'')} style={{['--src' as string]:color}} aria-label={label+' editor'} role="group">
      <header className="pe-bar">
        <i className="pe-dot"/>
        <span className="pe-no" aria-hidden="true">{edit.index+1}</span>
        {macro?<input className="pe-title-input" aria-label={'Macro '+(edit.index+1)+' name'} title="Tap to rename" value={macro.name} maxLength={24}
            onChange={e=>setMacro({name:e.target.value})}/>:<strong>{label}</strong>}
        {mod?<span className="pe-sub">{SHAPE_LABEL[mod.shape]} · {rateLabel(mod)}</span>
          :<span className="pe-sub">{Math.round(macro!.value*100)}%</span>}
        <span className="pe-gap"/>
        {linking?<span className="pe-linking" role="status">Tap knobs to link. Tap again to unlink.
            <button type="button" onClick={()=>onLink(null)}>Done</button></span>
          :null}
        <button type="button" className="pe-action" aria-label={'Remove all links from '+label} title="Remove every link from this source"
          disabled={!links.length} onClick={()=>mod?setMod({targets:[]}):setMacro({targets:[]})}><Eraser size={15}/></button>
      </header>
      {mod?<div className="pe-body">
        <button type="button" className="pe-graph pe-graph-open" aria-label={'Edit the shape of '+label} onClick={()=>setSheet('shape')}>
          <ShapePreview wide shape={mod.shape} steps={mod.steps} count={mod.count} points={mod.points} phase={phaseOf(edit.index)} color={color}
            active={mod.targets.length>0} live={mod.targets.length?live?.mods?.[edit.index]:undefined}/>
          <Maximize2 size={14} className="pe-graph-icon"/></button>
        <div className="pe-controls">
          <button type="button" className="pe-pick" aria-label={'Shape of '+label+': '+SHAPE_LABEL[mod.shape]} onClick={()=>setSheet('shape')}>
            <span>Shape</span><strong>{SHAPE_LABEL[mod.shape]}</strong><ChevronDown size={15}/></button>
        </div>
        <div className="pe-rates fx-segment" role="radiogroup" aria-label={'Rate of '+label}>
          {MOD_RATE_ORDER.map(i=><button key={i} type="button" role="radio" aria-checked={mod.rate===i} className={mod.rate===i?'active':''}
            aria-label={MOD_RATES[i]} onClick={()=>setMod({rate:i})}>{MOD_RATES[i]}</button>)}
        </div>
        <div className="pe-links"><LinkSummary targets={mod.targets} onOpen={()=>setSheet('links')}/></div>
        {sheet?<ModSheet key={'mod-'+edit.index} chain={chain} index={edit.index} tab={sheet} onTab={setSheet} onChange={onChange} onClose={()=>setSheet(null)}
          phase={phaseOf(edit.index)} live={mod.targets.length?live?.mods?.[edit.index]:undefined}
          container={band.current?.closest('.frame')??null} anchor={band.current?.querySelector('.pad-editor')??null}/>:null}
      </div>:<div className="pe-body">
        <div className="pe-links wide"><LinkSummary targets={macro!.targets} onOpen={()=>setSheet('links')}/></div>
        {sheet?<MacroSheet key={'macro-'+edit.index} chain={chain} index={edit.index} onChange={onChange} onClose={()=>setSheet(null)}
          container={band.current?.closest('.frame')??null} anchor={band.current?.querySelector('.pad-editor')??null}/>:null}
      </div>}
    </div>
  </section>;
}
