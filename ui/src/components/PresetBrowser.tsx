import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Sparkles, X } from 'lucide-react';
import { FX_MODULES, type FxModuleId } from '../fx';
import library from '../library.json';

export type LibraryPreset = { name:string; category:string; tags:string; instrument:{harmonics:number[]}; fx:string[] };
export const LIBRARY = library as { categories:string[]; presets:LibraryPreset[]; banks:string[]; patterns:string[][] };
export const PRESET_NAMES = LIBRARY.presets.map(p=>p.name);

type Props = { current:string; accent:string; onPreset:(name:string)=>void };

function Bars({h,color}:{h:number[],color:string}) {
  return <svg className="preset-bars" viewBox="0 0 64 20" preserveAspectRatio="none" aria-hidden="true">
    {h.map((v,i)=><rect key={i} x={i*4+.5} y={20-Math.max(1,v*20)} width="3" height={Math.max(1,v*20)} fill={color} opacity={.35+.65*v}/>)}
  </svg>;
}

function FxDots({fx}:{fx:string[]}) {
  return <span className="preset-fx" aria-label={'FX: '+fx.map(id=>FX_MODULES[id as FxModuleId]?.name??id).join(', ')}>
    {fx.map(id=><i key={id} style={{background:FX_MODULES[id as FxModuleId]?.color??'#888'}}/>)}
  </span>;
}

/** A one-line preset bar that opens a full browser. */
export function PresetBrowser({current,accent,onPreset}:Props) {
  const [open,setOpen]=useState(false);
  const index=PRESET_NAMES.indexOf(current);
  const active=index>=0?LIBRARY.presets[index]:null;
  const [category,setCategory]=useState(active?.category??LIBRARY.categories[0]);
  useEffect(()=>{if(active)setCategory(active.category);},[active?.category]);
  const list=useMemo(()=>LIBRARY.presets.filter(p=>p.category===category),[category]);
  return <div className={'preset-strip'+(open?' open':'')}>
    <div className="preset-bar">
      <button type="button" className="preset-current" aria-label="Browse presets" aria-expanded={open} onClick={()=>setOpen(!open)}>
        <span className="preset-cat">Presets</span>
        <strong>{current}</strong>
        {active?<FxDots fx={active.fx}/>:null}
        <LayoutGrid size={16}/>
      </button>
      <span className="preset-count">{index>=0?index+1:'–'} / {PRESET_NAMES.length}</span>
    </div>
    {open?<div className="preset-browser" role="dialog" aria-label="Preset library">
      <div className="preset-cats" role="tablist" aria-label="Preset categories">
        {LIBRARY.categories.map(c=><button key={c} type="button" role="tab" aria-selected={c===category}
          className={c===category?'active':''} onClick={()=>setCategory(c)}>{c}</button>)}
        <button type="button" className="preset-close" aria-label="Close preset library" onClick={()=>setOpen(false)}><X size={18}/></button>
      </div>
      <div className="preset-grid">
        {list.map(p=><button key={p.name} type="button" className={'preset-card'+(p.name===current?' selected':'')}
          aria-label={'Load preset '+p.name} aria-pressed={p.name===current} onClick={()=>onPreset(p.name)}>
          <Bars h={p.instrument.harmonics} color={p.name===current?accent:'#9fb3c8'}/>
          <strong>{p.name}</strong>
          <span className="preset-tags">{p.tags}</span>
          <span className="preset-card-foot"><FxDots fx={p.fx}/>{p.fx.length?<Sparkles size={11}/>:null}</span>
        </button>)}
      </div>
      <p className="preset-hint">Tap a sound to hear it on the selected track. Each preset also loads its FX rack, macros and mod pads. Your recorded notes are never changed.</p>
    </div>:null}
  </div>;
}
