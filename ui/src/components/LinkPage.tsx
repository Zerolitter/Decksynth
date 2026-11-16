import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Eraser, Link2, Magnet, Orbit, Pencil, Plus, X } from 'lucide-react';
import { Knob } from './Knob';
import { MorphPad } from './MorphPad';
import { FEEL_FACTOR, MOD_RATES, MOD_RATE_ORDER, RANDOM_SHAPES, STEP_COUNTS, normalizeChain, rateLabel, targetInfo,
  type FxChain, type FxModSource, type FxTarget, type ModFeel } from '../fx';
import { MACRO_COLORS, MOD_COLORS, RATE_BEATS, SHAPE_LABEL, ShapePreview, sourceColor, type Live, type Source } from './ModParts';
import { BipolarDepth, MacroSheet, ModSheet, PadGraphEditor, pointsFrom, type SheetTab } from './ModSheet';

type Props = {
  selected:number; chain?:FxChain; onChange:(c:FxChain)=>void; beat:number; live?:Live; bpm:number;
  edit:Source; onEdit:(s:Source)=>void;
  armed:Source|null; onLink:(s:Source|null)=>void;
};

/** The Link page (Sir, 16 Nov): every modulation source in one ordered place, away from Sound and FX.
 *  Left: the 8 macros, the 8 mod pads and the Morph pad. Right: the editor of the tapped source with its shape and
 *  every link as a depth bar. Tap a name (or Link knobs) to arm it: the Link box in the top bar lights, and every knob
 *  tapped on any page is linked to it until the box, blank space, Esc or B clears it. */
export function LinkPage({selected,chain:raw,onChange,beat,live,bpm,edit,onEdit,armed,onLink}:Props) {
  const chain=normalizeChain(raw);
  const page=useRef<HTMLElement>(null);
  const [sheet,setSheet]=useState<SheetTab|null>(null);
  const [snap,setSnap]=useState(true);
  // Point editing is a mode (Sir, 16 Nov): Edit points turns into Done in the same spot, so the exit is where you went in.
  const [pointsEdit,setPointsEdit]=useState(false);
  // The Morph pad is not kept on screen (Sir, 16 Nov): a slim tile opens it in the editor area; closed, it is not drawn.
  const [morph,setMorph]=useState(false);
  const pick=(s:Source)=>{setMorph(false);onEdit(s);};
  useEffect(()=>{setSheet(null);setPointsEdit(false);},[selected,edit.kind,edit.index]);
  const phaseOf=(i:number)=>chain.mods[i].targets.length&&live?.phases?live.phases[i]
    :(beat/(RATE_BEATS[chain.mods[i].rate]*FEEL_FACTOR[chain.mods[i].feel??'']))%1;
  const isEdit=(k:Source['kind'],i:number)=>edit.kind===k&&edit.index===i;
  const isArmed=(k:Source['kind'],i:number)=>armed?.kind===k&&armed.index===i;
  const lip=(src:Source)=>{if(isArmed(src.kind,src.index))onLink(null);else{pick(src);onLink(src);}};
  const color=sourceColor(edit);
  const mod=edit.kind==='mod'?chain.mods[edit.index]:null, macro=edit.kind==='macro'?chain.macros[edit.index]:null;
  const setMod=(patch:Partial<FxModSource>)=>onChange({...chain,mods:chain.mods.map((x,j)=>j===edit.index?{...x,...patch}:x)});
  const setMacro=(patch:Partial<FxChain['macros'][number]>)=>onChange({...chain,macros:chain.macros.map((x,j)=>j===edit.index?{...x,...patch}:x)});
  const targets=(mod??macro)!.targets;
  const setTargets=(t:FxTarget[])=>mod?setMod({targets:t.slice(0,16)}):setMacro({targets:t.slice(0,16)});
  const linking=isArmed(edit.kind,edit.index);
  const label=mod?'Mod pad '+(edit.index+1):macro!.name;

  return <section ref={page} className="link-page" aria-label="Link" data-track={selected}>
    <div className="lp-left">
      <div className="lp-card lp-sources mod-band" aria-label="Sources">
        <header className="lp-head"><span className="lp-title">Macros</span><span className="lp-hint">tap a name to link it</span></header>
        <div className="lp-macros" aria-label="Macros">
          {chain.macros.map((m,i)=><div key={i}
            className={'fx-macro'+(isEdit('macro',i)?' editing':'')+(isArmed('macro',i)?' armed':'')+(m.targets.length?' routed':'')}
            style={{['--src' as string]:MACRO_COLORS[i]}} onPointerDownCapture={()=>{if(!isEdit('macro',i)||morph)pick({kind:'macro',index:i});}}>
            <Knob id={selected+'-macro-'+i} name={m.name} value={m.value} min={0} max={1} accent={MACRO_COLORS[i]}
              compact onChange={v=>onChange({...chain,macros:chain.macros.map((x,j)=>j===i?{...x,value:v}:x)})}/>
            <button type="button" className="fx-src-arm" aria-pressed={isArmed('macro',i)}
              aria-label={'Link '+m.name+' to knobs'} onClick={()=>lip({kind:'macro',index:i})}>
              {m.name}{m.targets.length?<small> · {m.targets.length}</small>:null}</button>
          </div>)}
        </div>
        <header className="lp-head"><span className="lp-title">Mod pads</span></header>
        <div className="lp-pads" aria-label="Mod pads">
          {chain.mods.map((m,i)=><div key={i}
            className={'fx-pad'+(isEdit('mod',i)?' editing':'')+(isArmed('mod',i)?' armed':'')+(m.targets.length?' routed':'')}
            style={{['--src' as string]:MOD_COLORS[i]}}>
            <button type="button" className="fx-pad-main" aria-pressed={isEdit('mod',i)} aria-label={'Mod pad '+(i+1)+' '+m.shape}
              onClick={()=>pick({kind:'mod',index:i})}>
              <ShapePreview shape={m.shape} steps={m.steps} count={m.count} points={m.points} phase={phaseOf(i)} color={MOD_COLORS[i]}
                live={m.targets.length?live?.mods?.[i]:undefined} active={m.targets.length>0}/>
            </button>
            <button type="button" className="fx-pad-label" aria-pressed={isArmed('mod',i)} aria-label={'Link Mod pad '+(i+1)+' to knobs'}
              onClick={()=>lip({kind:'mod',index:i})}>{i+1} · {rateLabel(m).replace(/(\d+) bars/,'$1 bar')}{m.targets.length?<small> · {m.targets.length}</small>:null}</button>
          </div>)}
        </div>
        <button type="button" className={'lp-morph-tile'+(morph?' open':'')} aria-pressed={morph} onClick={()=>setMorph(!morph)}
          title="The Morph pad: a puck that drives macros">
          <Orbit size={18}/><b>Morph pad</b><span>{chain.morph?.path&&chain.morph.path!=='hand'?'moving':'by hand'} · puck drives {chain.macros[chain.morph?.xMacro??0]?.name} and {chain.macros[chain.morph?.yMacro??1]?.name}</span><ChevronRight size={16}/></button>
      </div>

      <div className="lp-card lp-links" aria-label="Links" style={{['--src' as string]:color}}>
        <header className="lp-head"><span className="lp-title">Links · {targets.length}</span>
          <span className="lp-hint">{linking?'Tap knobs on any page. Tap a linked knob again to unlink.':'Drag a bar to set the depth; zero sits in the middle.'}</span>
          <button type="button" className="lp-tool" onClick={()=>setSheet('links')} disabled={targets.length>=16}><Plus size={15}/>By name</button></header>
        {targets.length?<div className="lp-link-list">{targets.map((t,k)=>{const info=targetInfo(t);
          return <div key={t.module+':'+t.param} className="mod-link lp-link" style={{['--fx-color' as string]:info.color}}>
            <span className="lp-link-name"><i/><small>{info.name}</small>{info.label}</span>
            <BipolarDepth value={t.depth} color={color} label={'Depth '+info.name+' '+info.label}
              onChange={d=>setTargets(targets.map((x,j)=>j===k?{...x,depth:d}:x))}/>
            <button type="button" className="lp-icon" aria-label={'Unlink '+info.name+' '+info.label} onClick={()=>setTargets(targets.filter((_,j)=>j!==k))}><X size={16}/></button>
          </div>;})}</div>
        :<button type="button" className="lp-empty" onClick={()=>onLink(edit)}>
          <Link2 size={22}/><b>Nothing linked yet</b><span>Tap here, then tap knobs on Sound, FX, Drum Rack or Sampler.</span></button>}
      </div>
    </div>

    {morph?<div className="lp-card lp-editor lp-morph" style={{['--src' as string]:'#b79cf0'}} role="group" aria-label="Morph pad editor">
      <header className="lp-ed-head"><Orbit size={18} color="#b79cf0"/><strong>Morph pad</strong><span className="pe-sub">the puck drives macros; pads 1 to 4 sit in the corners</span>
        <span className="pe-gap"/><button type="button" className="lp-tool" onClick={()=>setMorph(false)}>Done</button></header>
      <MorphPad chain={chain} onChange={onChange} live={live} bpm={bpm} compact/>
    </div>:
    <div className={'lp-card lp-editor'+(linking?' linking':'')} style={{['--src' as string]:color}} role="group" aria-label={label+' editor'} data-cover="1">
      <header className="lp-ed-head">
        <span className="pe-no" aria-hidden="true">{edit.index+1}</span>
        {macro?<input className="pe-title-input" aria-label={'Macro '+(edit.index+1)+' name'} title="Tap to rename" value={macro.name} maxLength={24}
            onChange={e=>setMacro({name:e.target.value})}/>:<strong>{label}</strong>}
        <span className="pe-sub">{mod?SHAPE_LABEL[mod.shape]+' · '+rateLabel(mod):Math.round(macro!.value*100)+'%'}</span>
        <span className="pe-gap"/>
        <button type="button" className={'lp-arm'+(linking?' on':'')} aria-pressed={linking}
          title={linking?'Stop linking':'Arm this source, then tap knobs on any page'} onClick={()=>onLink(linking?null:edit)}>
          <Link2 size={16}/>{linking?'Linking':'Link knobs'}</button>
        <button type="button" className="lp-icon" aria-label={'Remove all links from '+label} title="Remove every link from this source"
          disabled={!targets.length} onClick={()=>setTargets([])}><Eraser size={16}/></button>
      </header>
      {mod?<div className="lp-shape">
        <PadGraphEditor mod={mod} color={color} phase={phaseOf(edit.index)} live={mod.targets.length?live?.mods?.[edit.index]:undefined} snap={snap} editing={pointsEdit} onChange={setMod}/>
        <div className="lp-shape-tools">
          <button type="button" className="lp-pick" aria-label={'Shape of '+label+': '+SHAPE_LABEL[mod.shape]} onClick={()=>setSheet('shape')}>
            <span>Shape</span><strong>{SHAPE_LABEL[mod.shape]}</strong><ChevronDown size={15}/></button>
          <div className="fx-segment" role="radiogroup" aria-label="Mod pad feel">
            {([['','Straight','—'],['T','Triplet','T'],['D','Dotted','D']] as [ModFeel,string,string][]).map(([f,l,sh])=>
              <button key={l} type="button" role="radio" aria-label={l} aria-checked={(mod.feel??'')===f} className={(mod.feel??'')===f?'active':''}
                onClick={()=>setMod({feel:f})}>{sh}</button>)}</div>
          {mod.shape==='steps'?<div className="fx-segment" role="radiogroup" aria-label="Step count">
              {STEP_COUNTS.map(n=><button key={n} type="button" role="radio" aria-checked={(mod.count??16)===n} className={(mod.count??16)===n?'active':''}
                onClick={()=>setMod({count:n})}>{n}</button>)}</div>:null}
          <button type="button" className={'lp-tool'+(snap?' on':'')} aria-pressed={snap} onClick={()=>setSnap(!snap)} title="Points and steps lock to the grid"><Magnet size={15}/>Snap</button>
          {mod.shape!=='steps'&&!RANDOM_SHAPES.has(mod.shape)?(pointsEdit&&mod.shape==='curve'
            ?<button type="button" className="lp-tool lp-points on" aria-pressed="true" title="Stop editing points" onClick={()=>setPointsEdit(false)}><Check size={15}/>Done</button>
            :<button type="button" className="lp-tool lp-points" aria-pressed="false" title="Drag the points, tap the graph to add one, double-tap a point to remove it"
              onClick={()=>{if(mod.shape!=='curve')setMod({shape:'curve',points:pointsFrom(mod)});setPointsEdit(true);}}><Pencil size={15}/>Edit points</button>):null}
        </div>
        <div className="lp-rates fx-segment" role="radiogroup" aria-label={'Rate of '+label}>
          {MOD_RATE_ORDER.map(i=><button key={i} type="button" role="radio" aria-checked={mod.rate===i} className={mod.rate===i?'active':''}
            aria-label={MOD_RATES[i]} onClick={()=>setMod({rate:i})}>{MOD_RATES[i].replace(' bars',' bar')}</button>)}
        </div>
      </div>:<div className="lp-macro">
        <Knob id={selected+'-macro-big-'+edit.index} name={macro!.name} value={macro!.value} min={0} max={1} suffix="%" accent={color}
          onChange={v=>setMacro({value:v})}/>
        <div className="lp-macro-text">
          <b>{macro!.name} moves {macro!.targets.length?macro!.targets.length+(macro!.targets.length===1?' knob':' knobs'):'nothing yet'}</b>
          <span>Turn it here or on its small knob. {[['xMacro','Puck X'],['yMacro','Puck Y'],['mixMacro','Pad mix']].filter(([k])=>(chain.morph as unknown as Record<string,number>|undefined)?.[k]===edit.index).map(([,n])=>n).join(' and ')||'Nothing on the Morph pad'} {([['xMacro'],['yMacro'],['mixMacro']].some(([k])=>(chain.morph as unknown as Record<string,number>|undefined)?.[k]===edit.index))?'drives it too.':'drives it.'}</span>
          <span>To link it: tap <i>Link knobs</i>, go to any page and tap the knobs it should move. Each link gets a depth bar on the left.</span>
        </div>
      </div>}
      {sheet&&mod?<ModSheet key={'mod-'+edit.index} chain={chain} index={edit.index} tab={sheet} onTab={setSheet} onChange={onChange} onClose={()=>setSheet(null)}
        phase={phaseOf(edit.index)} live={mod.targets.length?live?.mods?.[edit.index]:undefined}
        container={page.current} anchor={page.current?.querySelector('.lp-editor')??null}/>:null}
      {sheet&&macro?<MacroSheet key={'macro-'+edit.index} chain={chain} index={edit.index} onChange={onChange} onClose={()=>setSheet(null)}
        container={page.current} anchor={page.current?.querySelector('.lp-editor')??null}/>:null}
    </div>}
  </section>;
}
