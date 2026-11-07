import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Hand } from 'lucide-react';
import { Knob } from './Knob';
import { MACRO_COLORS, MOD_COLORS, type Live } from './ModParts';
import { MOD_RATES, MORPH_PATHS, defaultMorph, morphPoint, padMix, shapeValue,
  type FxChain, type FxMorph, type MorphMode, type MorphPath } from '../fx';

/** Path symbols, drawn in a 32×32 box. DeckSynth's own drawings. */
const SYMBOL:Record<Exclude<MorphPath,'hand'>,string>={
  circle:'M27 16 A11 11 0 1 1 5 16 A11 11 0 1 1 27 16',
  eight:'M16 16 C 4 2, 4 30, 16 16 C 28 2, 28 30, 16 16',
  flower:'M16 16 C 10 3, 22 3, 16 16 C 29 10, 29 22, 16 16 C 22 29, 10 29, 16 16 C 3 22, 3 10, 16 16',
  triangle:'M16 4 L28 27 L4 27 Z',
  square:'M5 5 H27 V27 H5 Z',
  spiral:'M16 16 m0 -2 a2 2 0 1 1 -2 2 a5 5 0 1 1 5 5 a8 8 0 1 1 -8 -8 a11 11 0 1 1 11 11',
  star:'M16 3 L19 13 L29 13 L21 19 L24 29 L16 23 L8 29 L11 19 L3 13 L13 13 Z',
  wave:'M3 16 C 8 4, 12 4, 16 16 S 24 28, 29 16',
  drift:'M4 20 L9 9 L13 18 L18 6 L22 22 L28 12',
};
const PATH_NAME:Record<MorphPath,string>={hand:'Hand',circle:'Circle',eight:'Figure 8',flower:'Flower',triangle:'Triangle',
  square:'Square',spiral:'Spiral',star:'Star',wave:'Wave',drift:'Drift'};
const MODES:[MorphMode,string][]=[['follow','Follow'],['retrigger','Retrigger'],['freeze','Freeze']];
const RATE_BEATS=[16,8,4,2,1,.5,.25];
const CORNERS=[{label:'Pad 1',x:0,y:1},{label:'Pad 2',x:1,y:1},{label:'Pad 3',x:0,y:0},{label:'Pad 4',x:1,y:0}];

type Props={chain:FxChain; onChange:(c:FxChain)=>void; live?:Live; bpm?:number};

/** The Morph pad: touch to place the centre, pick a path symbol and the puck travels it in time with the song.
 *  Puck X, Puck Y and the Pad mix (a blend of pads 1-4 in the corners) each drive a macro. */
export function MorphPad({chain,onChange,live,bpm=120}:Props) {
  const ref=useRef<HTMLDivElement>(null);
  // Quick taps build on what was just sent, not on the engine's echo that is still on its way back.
  const sent=useRef<{m:FxMorph,t:number}|null>(null);
  const latest=():FxMorph=>sent.current&&performance.now()-sent.current.t<700?sent.current.m:{...defaultMorph(),...chain.morph};
  const [,redraw]=useState(0);
  const mo=latest();
  const moving=mo.path!=='hand';
  const engine=live?.puck;
  // Without the engine (preview) the screen runs the same maths on its own clock.
  const [clock,setClock]=useState(0);
  useEffect(()=>{
    if(!moving||engine)return;
    let id=0;const start=performance.now();
    const tick=()=>{setClock((performance.now()-start)/1000*bpm/60);id=requestAnimationFrame(tick);};
    id=requestAnimationFrame(tick);return ()=>cancelAnimationFrame(id);
  },[moving,!!engine,bpm]);
  const frozen=useRef(0);
  if(mo.mode!=='freeze')frozen.current=clock;
  const pos=(mo.mode==='freeze'?frozen.current:clock)/RATE_BEATS[mo.rate];
  const local=moving?morphPoint(mo,((pos%1)+1)%1,pos):[mo.x,mo.y] as [number,number];
  const pads=chain.mods.slice(0,4).map(m=>{const p=clock/RATE_BEATS[m.rate];return shapeValue(m.shape,p%1,m.steps,Math.floor(p));});
  const [px,py]=moving&&engine?engine:local;
  const mix=engine?engine[2]:padMix(px,py,pads);
  const trail=useRef<[number,number][]>([]);
  useEffect(()=>{if(moving){trail.current=[...trail.current.slice(-18),[px,py]];}else trail.current=[];},[px,py,moving]);

  const set=(patch:Partial<FxMorph>,macros=chain.macros)=>{
    const morph={...latest(),...patch};sent.current={m:morph,t:performance.now()};onChange({...chain,macros,morph});redraw(n=>n+1);
  };
  const move=(e:React.PointerEvent)=>{
    const r=ref.current?.getBoundingClientRect(); if(!r)return;
    const x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)), y=Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height));
    // By hand the finger is the puck; with a path the finger moves the centre the path circles around.
    set({x,y},moving?chain.macros:chain.macros.map((m,i)=>i===mo.xMacro?{...m,value:x}:i===mo.yMacro?{...m,value:y}:m));
  };
  // The path outline, drawn around the centre (without Wander so it reads as the symbol).
  const outline=moving&&mo.path!=='drift'?Array.from({length:121},(_,i)=>{const [x,y]=morphPoint(mo,i/120,0,false);
    return (i?'L':'M')+(x*100).toFixed(2)+' '+((1-y)*100).toFixed(2);}).join(' '):'';
  const macroPick=(label:string,value:number,key:'xMacro'|'yMacro'|'mixMacro',off=false,meter?:string)=><label className="morph-source">
    <span>{label}{meter?<small>{meter}</small>:null}</span>
    <select aria-label={label+' drives'} value={value} onChange={e=>set({[key]:Number(e.target.value)})}>
      {off?<option value={-1}>Nothing</option>:null}
      {chain.macros.map((m,i)=><option key={i} value={i}>{m.name}</option>)}</select>
  </label>;

  return <div className="morph-wrap morph-v2">
    <div ref={ref} className={'morph-pad'+(moving?' moving':'')} role="slider" aria-label="Morph pad"
      aria-valuenow={Math.round(px*100)} aria-valuetext={`X ${Math.round(px*100)}%, Y ${Math.round(py*100)}%`}
      style={{['--mx' as string]:MACRO_COLORS[mo.xMacro],['--my' as string]:MACRO_COLORS[mo.yMacro]}}
      onPointerDown={e=>{(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);move(e);}}
      onPointerMove={e=>{if(e.buttons)move(e);}}>
      <svg className="morph-art" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {outline?<path d={outline} vectorEffect="non-scaling-stroke"/>:null}
        {mo.path==='drift'?<circle cx={mo.x*100} cy={(1-mo.y)*100} r={mo.size*50} className="drift" vectorEffect="non-scaling-stroke"/>:null}
      </svg>
      {CORNERS.map((c,i)=><span key={i} className="morph-corner" style={{['--c' as string]:MOD_COLORS[i],
        left:c.x?undefined:6,right:c.x?6:undefined,top:c.y?6:undefined,bottom:c.y?undefined:6,
        opacity:.45+.55*Math.max(0,1-Math.hypot(px-c.x,py-c.y))}}>{c.label}</span>)}
      {moving?<span className="morph-centre" style={{left:mo.x*100+'%',top:(1-mo.y)*100+'%'}}/>:null}
      {trail.current.map(([x,y],i,a)=><span key={i} className="morph-trail" style={{left:x*100+'%',top:(1-y)*100+'%',opacity:i/a.length*.35}}/>)}
      <span className="morph-cross-x" style={{left:px*100+'%'}}/><span className="morph-cross-y" style={{top:(1-py)*100+'%'}}/>
      <span className="morph-dot" style={{left:px*100+'%',top:(1-py)*100+'%'}}/>
    </div>
    <div className="morph-controls">
      <span className="mod-group-label">Path symbol</span>
      <div className="morph-symbols" role="radiogroup" aria-label="Path symbol">
        {MORPH_PATHS.map(p=><button key={p} type="button" role="radio" aria-checked={mo.path===p} aria-label={PATH_NAME[p]}
          title={PATH_NAME[p]} className={mo.path===p?'active':''} onClick={()=>set({path:p})}>
          {p==='hand'?<Hand size={21}/>:<svg viewBox="0 0 32 32" aria-hidden="true"><path d={SYMBOL[p]}/></svg>}</button>)}
      </div>
      <div className="morph-row">
        <div className="fx-segment morph-modes" role="radiogroup" aria-label="Puck motion">
          {MODES.map(([m,label])=><button key={m} type="button" role="radio" aria-checked={mo.mode===m} disabled={!moving}
            className={mo.mode===m?'active':''} onClick={()=>set({mode:m})}>{label}</button>)}
        </div>
        <div className="morph-rate" role="group" aria-label="Path speed">
          <button type="button" aria-label="Slower path" disabled={mo.rate<=0} onClick={()=>set({rate:Math.max(0,latest().rate-1)})}><ChevronLeft size={18}/></button>
          <strong>{MOD_RATES[mo.rate]}</strong>
          <button type="button" aria-label="Faster path" disabled={mo.rate>=MOD_RATES.length-1} onClick={()=>set({rate:Math.min(MOD_RATES.length-1,latest().rate+1)})}><ChevronRight size={18}/></button>
        </div>
      </div>
    </div>
    <div className="morph-knobs">
      <Knob id="morph-size" name="Size" value={Math.round(mo.size*100)} min={0} max={100} step={1} precision={0} suffix="%"
        accent="#b79cf0" onChange={v=>set({size:v/100})}/>
      <Knob id="morph-wander" name="Wander" value={Math.round(mo.wander*100)} min={0} max={100} step={1} precision={0} suffix="%"
        accent="#b79cf0" onChange={v=>set({wander:v/100})}/>
      <Knob id="morph-spin" name="Spin" value={Math.round(mo.spin*360)} min={0} max={360} step={1} precision={0} suffix="°"
        accent="#b79cf0" onChange={v=>set({spin:v/360})}/>
    </div>
    <div className="morph-sources" role="group" aria-label="Puck sources">
      {macroPick('Puck X',mo.xMacro,'xMacro')}{macroPick('Puck Y',mo.yMacro,'yMacro')}
      {macroPick('Pad mix',mo.mixMacro,'mixMacro',true,(mix>=0?'+':'')+Math.round(mix*100)+'%')}
    </div>
  </div>;
}
