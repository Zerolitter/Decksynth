import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SourceInspector } from './SourceInspector';
import { depthAt, parseDepth } from '../depth';
import { Magnet, Pencil, X } from 'lucide-react';
import {
  DEFAULT_POINTS, FX_MODULES, MOD_RATES, MOD_RATE_ORDER, RANDOM_SHAPES, SHAPE_PAGES, SOUND_TARGETS, STEP_COUNTS, rateLabel, shapeValue, targetInfo,
  type FxChain, type FxModSource, type FxModuleId, type FxTarget, type ModFeel, type ModShape,
} from '../fx';
import { MACRO_COLORS, MOD_COLORS, SHAPE_LABEL } from './ModParts';

/* The mod pad sheet: everything about one mod pad in one big place, over the FX/Sound window.
   Shape tab: pick from 10 shapes, draw your own with points that snap, merge steps, set the rate.
   Links tab: pick targets as buttons and set each depth on a full-width bipolar bar (UI-RULES §6). */

export type SheetTab='shape'|'links';
const SNAP_X=16, SNAP_Y=8;
const snapTo=(v:number,n:number)=>Math.round(v*n)/n;
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));

/** Measured size of an element, so SVG units are pixels and dots stay round (rule 9). */
export function useSize<T extends HTMLElement>(){
  const ref=useRef<T>(null);const [size,setSize]=useState({w:300,h:120});
  useLayoutEffect(()=>{const el=ref.current;if(!el)return;
    const ro=new ResizeObserver(()=>{const r=el.getBoundingClientRect();setSize({w:Math.max(40,r.width),h:Math.max(40,r.height)});});
    ro.observe(el);return()=>ro.disconnect();},[]);
  return [ref,size] as const;
}

/** Shape points of any preset, to start a drawn shape from it. */
export function pointsFrom(m:FxModSource):[number,number][]{
  if(m.shape==='curve')return (m.points??DEFAULT_POINTS).map(p=>[...p] as [number,number]);
  if(m.shape==='square')return [[0,1],[.49,1],[.5,-1],[.99,-1]];
  if(m.shape==='pulse')return [[0,1],[.24,1],[.25,-1],[.99,-1]];
  if(m.shape==='saw')return [[0,1],[.99,-1]];
  if(m.shape==='ramp')return [[0,-1],[.99,1]];
  if(m.shape==='triangle')return [[0,-1],[.5,1]];
  const n=m.shape==='steps'?(m.count??16):8;
  return Array.from({length:n},(_,i)=>{const x=i/n;return [x,snapTo(shapeValue(m.shape,x,m.steps,0,m.count??16,m.points),SNAP_Y)] as [number,number];});
}

/** The pad's graph as an editor: drag points (Drawn) or bars (Steps); everything snaps to the grid when Snap is on. */
export function PadGraphEditor({mod,color,phase,live,snap,editing=true,onChange}:{mod:FxModSource;color:string;phase:number;live?:number;snap:boolean;
  /** Drawn points show their handles and take taps only while editing (the Link page's Edit points / Done). */ editing?:boolean;
  onChange:(patch:Partial<FxModSource>)=>void}){
  const [ref,{w,h}]=useSize<HTMLDivElement>();
  const drag=useRef<number|null>(null);const lastTap=useRef({i:-1,t:0,moved:false});
  const pad=10,mid=h/2,amp=(h-pad*2)/2;
  const X=(x:number)=>x*w, Y=(v:number)=>mid-v*amp;
  const at=(e:React.PointerEvent)=>{const r=(e.currentTarget as Element).closest('svg')!.getBoundingClientRect();
    let x=clamp((e.clientX-r.left)/r.width,0,1),y=clamp((mid-(e.clientY-r.top))/amp,-1,1);
    if(snap){x=snapTo(x,SNAP_X);y=snapTo(y,SNAP_Y);}return [Math.min(x,.999),y] as [number,number];};
  const count=mod.count??16;
  const curve=mod.shape==='curve'&&editing, steps=mod.shape==='steps';
  const pts=mod.points??DEFAULT_POINTS;
  const N=Math.max(64,Math.round(w/3));
  const path=Array.from({length:N+1},(_,i)=>{const x=i/N;return (i?'L':'M')+X(x).toFixed(1)+' '+Y(shapeValue(mod.shape,x,mod.steps,0,count,pts)).toFixed(1);}).join(' ');
  const setStep=(e:React.PointerEvent)=>{const [x,y]=at(e);const k=Math.min(count-1,Math.floor(x*count)),g=16/count;
    onChange({steps:mod.steps.map((v,j)=>Math.floor(j/g)===k?(snap?y:Math.round(y*20)/20):v)});};
  const movePoint=(i:number,e:React.PointerEvent)=>{const [x,y]=at(e);
    const lo=i>0?pts[i-1][0]+.001:0,hi=i<pts.length-1?pts[i+1][0]-.001:.999;
    onChange({points:pts.map((p,j)=>j===i?[clamp(x,lo,hi),y] as [number,number]:p)});};
  const grid=[];
  for(let i=1;i<SNAP_X;i++)grid.push(<line key={'x'+i} x1={X(i/SNAP_X)} x2={X(i/SNAP_X)} y1={pad} y2={h-pad} className={i%4?'g':'g beat'}/>);
  for(let i=-SNAP_Y+1;i<SNAP_Y;i++)if(i)grid.push(<line key={'y'+i} x1={0} x2={w} y1={Y(i/SNAP_Y)} y2={Y(i/SNAP_Y)} className="g"/>);
  return <div ref={ref} className="pad-graph-editor" data-testid="pad-graph-editor" data-shape={mod.shape}>
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
      onPointerDown={e=>{
        if(steps){(e.currentTarget as Element).setPointerCapture(e.pointerId);drag.current=-2;setStep(e);return;}
        if(curve&&e.target===e.currentTarget){ // tap on empty graph: a new point
          const [x,y]=at(e);if(pts.length>=32||pts.some(p=>Math.abs(p[0]-x)<.004))return;
          const next=[...pts,[x,y] as [number,number]].sort((a,b)=>a[0]-b[0]);onChange({points:next});
          drag.current=next.findIndex(p=>p[0]===x);(e.currentTarget as Element).setPointerCapture(e.pointerId);}
      }}
      onPointerMove={e=>{if(drag.current===-2&&e.buttons)setStep(e);else if(drag.current!==null&&drag.current>=0&&e.buttons){lastTap.current.moved=true;movePoint(drag.current,e);}}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
      <g className="pad-grid">{snap?grid:null}<line x1={0} x2={w} y1={mid} y2={mid} className="g zero"/></g>
      {steps?Array.from({length:count},(_,k)=>{const v=mod.steps[k*(16/count)]??0,cw=w/count;
        return <g key={k}><rect x={k*cw+2} width={cw-4} y={pad} height={h-2*pad} rx={3} className="step-slot" pointerEvents="none"/>
          <rect x={k*cw+2} width={cw-4} y={v>=0?Y(v):mid} height={Math.max(1,Math.abs(v)*amp)} rx={3}
          fill={color} opacity={Math.floor(phase*count)===k?1:.6} pointerEvents="none"/></g>;})
        :<path d={path} fill="none" stroke={color} strokeWidth={3} pointerEvents="none"/>}
      <line x1={X(phase)} x2={X(phase)} y1={pad} y2={h-pad} stroke="#ffffff66" pointerEvents="none"/>
      <circle cx={X(phase)} cy={Y(live??shapeValue(mod.shape,phase,mod.steps,0,count,pts))} r={5} fill="#fff" pointerEvents="none"/>
      {curve?pts.map((p,i)=><g key={i} className="pad-point" data-testid={'pad-point-'+i}
        onPointerDown={e=>{e.stopPropagation();(e.currentTarget.ownerSVGElement as Element).setPointerCapture(e.pointerId);
          const now=performance.now();
          if(lastTap.current.i===i&&!lastTap.current.moved&&now-lastTap.current.t<350&&pts.length>2){onChange({points:pts.filter((_,j)=>j!==i)});drag.current=null;return;}
          lastTap.current={i,t:now,moved:false};drag.current=i;}}>
        <circle cx={X(p[0])} cy={Y(p[1])} r={22} fill="transparent"/>
        <circle cx={X(p[0])} cy={Y(p[1])} r={8} fill={color} stroke="#fff" strokeWidth={2}/>
      </g>):null}
    </svg>
  </div>;
}

/** −100 % … +100 % depth bar (UI-RULES §6): relative drag with travel = max(200 px, bar width), a hold before
 *  moving for fine mode, a sticky zero, a value bubble, double-tap to reset, long-press to type it, cancel restores. */
export function BipolarDepth({value,color,label,onChange}:{value:number;color:string;label:string;onChange:(v:number)=>void}){
  const [preview,setPreview]=useState<number|null>(null);
  const [typing,setTyping]=useState<string|null>(null);
  const g=useRef<{v0:number;x0:number;w:number;fine:boolean;held:ReturnType<typeof setTimeout>|null;long:ReturnType<typeof setTimeout>|null;
    moved:boolean;lastX:number;lastT:number}|null>(null);
  const tap=useRef(0);
  useEffect(()=>()=>{const s=g.current;if(s?.held)clearTimeout(s.held);if(s?.long)clearTimeout(s.long);g.current=null;},[]);
  const v=preview??value;
  const stopTimers=()=>{const s=g.current;if(s?.held)clearTimeout(s.held);if(s?.long)clearTimeout(s.long);};
  if(typing!==null)return <div className="bipolar typing" style={{['--src' as string]:color}}>
    <input autoFocus inputMode="decimal" aria-label={label+' value'} value={typing} onChange={e=>setTyping(e.target.value)}
      onKeyDown={e=>{if(e.key==='Enter'){const n=parseDepth(typing);if(n!==null)onChange(n);setTyping(null);}
        if(e.key==='Escape'){e.stopPropagation();setTyping(null);}}}
      onBlur={()=>{const n=parseDepth(typing);if(n!==null)onChange(n);setTyping(null);}}/>
    <span>%</span></div>;
  return <div className={'bipolar'+(preview!==null?' dragging':'')} role="slider" aria-label={label} aria-valuemin={-100} aria-valuemax={100}
    aria-valuenow={Math.round(v*100)} tabIndex={0} style={{['--src' as string]:color}}
    onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowUp')onChange(Math.min(1,Math.round((value+.05)*100)/100));
      if(e.key==='ArrowLeft'||e.key==='ArrowDown')onChange(Math.max(-1,Math.round((value-.05)*100)/100));
      if(e.key==='Enter')setTyping(String(Math.round(value*100)));}}
    onPointerDown={e=>{
      const now=performance.now();
      if(now-tap.current<300){tap.current=0;onChange(0);return;}tap.current=now;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      const r=(e.currentTarget as Element).getBoundingClientRect();
      const s={v0:value,x0:e.clientX,w:r.width,fine:false,moved:false,lastX:e.clientX,lastT:now,
        held:setTimeout(()=>{if(g.current)g.current.fine=true;},400) as ReturnType<typeof setTimeout>|null,
        long:setTimeout(()=>{if(g.current&&!g.current.moved){g.current=null;setPreview(null);setTyping(String(Math.round(value*100)));}},650) as ReturnType<typeof setTimeout>|null};
      g.current=s;setPreview(value);}}
    onPointerMove={e=>{const s=g.current;if(!s)return;
      if(Math.abs(e.clientX-s.x0)>3){s.moved=true;if(s.held){clearTimeout(s.held);s.held=null;}if(s.long){clearTimeout(s.long);s.long=null;}}
      const now=performance.now(),fast=Math.abs(e.clientX-s.lastX)/Math.max(1,now-s.lastT)>1;s.lastX=e.clientX;s.lastT=now;
      setPreview(depthAt(s.v0,e.clientX-s.x0,{length:s.w,fine:s.fine,fast}));}}
    onPointerUp={()=>{stopTimers();g.current=null;if(preview!==null&&preview!==value)onChange(preview);setPreview(null);}}
    onPointerCancel={()=>{stopTimers();g.current=null;setPreview(null);}}>
    <i className="bipolar-zero"/>
    <i className={'bipolar-fill'+(v<0?' neg':'')} style={v>=0?{left:'50%',width:v*50+'%'}:{right:'50%',width:-v*50+'%'}}/>
    {preview!==null?<b className="bipolar-bubble">{(v>0?'+':'')+Math.round(v*100)}%{g.current?.fine?' fine':''}</b>
      :<b className="bipolar-value">{(v>0?'+':'')+Math.round(v*100)}%</b>}
  </div>;
}

/** A starting pattern for Steps when the pad has none yet, so there is something to drag. */
const STARTER_STEPS=[1,.25,-.5,.5,.75,-.25,.5,-1,1,.5,-.5,.25,.75,-.75,.25,-.25];

const MiniShape=({shape,color}:{shape:ModShape;color:string})=>{
  const pts=Array.from({length:33},(_,i)=>{const x=i/32;const st=[1,.5,-.5,.25,-1,.75,0,-.25,1,.5,-.5,.25,-1,.75,0,-.25];
    return (i?'L':'M')+(x*44).toFixed(1)+' '+(12-shapeValue(shape,x,st,0,16,DEFAULT_POINTS)*9).toFixed(1);}).join(' ');
  return <svg width={44} height={24} viewBox="0 0 44 24" aria-hidden="true"><path d={pts} fill="none" stroke={color} strokeWidth={2}/></svg>;
};

type SheetProps={chain:FxChain;index:number;tab:SheetTab;onTab:(t:SheetTab)=>void;onChange:(c:FxChain)=>void;onClose:()=>void;
  phase:number;live?:number;container:Element|null;anchor:Element|null};

export function ModSheet({chain,index,tab,onTab,onChange,onClose,phase,live,container,anchor}:SheetProps){
  const mod=chain.mods[index];const color=MOD_COLORS[index];
  const [snap,setSnap]=useState(true);
  // The shape list is pages of 2 x 5; it opens on the page that holds the current shape.
  const [shapePage,setShapePage]=useState(()=>Math.max(0,SHAPE_PAGES.findIndex(p=>p.shapes.includes(mod.shape))));
  const set=(patch:Partial<FxModSource>)=>onChange({...chain,mods:chain.mods.map((m,i)=>i===index?{...m,...patch}:m)});
  const setTargets=(t:FxTarget[])=>set({targets:t.slice(0,16)});
  if(!container)return null;
  return <SourceInspector container={container} anchor={anchor} label={'Mod pad '+(index+1)+' editor'} color={color} onClose={onClose}>
      <header className="mod-sheet-bar">
        <i className="pe-dot"/><strong>Mod pad {index+1}</strong>
        <nav className="frame-tabs" role="tablist" aria-label="Mod pad views">
          <button type="button" role="tab" aria-selected={tab==='shape'} className={tab==='shape'?'active':''} onClick={()=>onTab('shape')}>Shape</button>
          <button type="button" role="tab" aria-selected={tab==='links'} className={tab==='links'?'active':''} onClick={()=>onTab('links')}>
            Links{mod.targets.length?' · '+mod.targets.length:''}</button>
        </nav>
        <span className="pe-sub">{SHAPE_LABEL[mod.shape]} · {rateLabel(mod)}</span>
        <span className="pe-gap"/>
        <button type="button" className="mod-sheet-done" onClick={onClose}>Done</button>
      </header>
      {tab==='shape'?<div className="mod-sheet-body shape">
        <div className="mod-sheet-graph">
          <PadGraphEditor mod={mod} color={color} phase={phase} live={live} snap={snap} onChange={set}/>
          <p className="mod-sheet-tip">{mod.shape==='curve'?'Drag points. Tap the graph to add one, double-tap a point to remove it.'
            :mod.shape==='steps'?'Drag across the bars to set each step.':'Tap Edit points to change this shape by hand.'}</p>
        </div>
        <div className="mod-sheet-side">
          <div className="mod-shape-head"><span className="mod-group-label">Shape · {SHAPE_PAGES[shapePage].name}</span>
            <div className="fx-segment mod-shape-pages" role="tablist" aria-label="Shape pages">
              {SHAPE_PAGES.map((p,i)=><button key={p.name} type="button" role="tab" aria-selected={shapePage===i} aria-label={'Shapes '+(i+1)+': '+p.name}
                title={p.name} className={(shapePage===i?'active':'')+(p.shapes.includes(mod.shape)?' holds':'')} onClick={()=>setShapePage(i)}>{i+1}</button>)}</div></div>
          <div className="mod-shape-grid" role="radiogroup" aria-label={'Mod pad '+(index+1)+' shape'}>
            {SHAPE_PAGES[shapePage].shapes.map(sh=><button key={sh} type="button" role="radio" aria-checked={mod.shape===sh} className={mod.shape===sh?'active':''}
              onClick={()=>set(sh==='steps'&&mod.steps.every(v=>Math.abs(v)<.01)?{shape:sh,steps:STARTER_STEPS}:{shape:sh})}><MiniShape shape={sh} color={color}/>{SHAPE_LABEL[sh]}</button>)}
          </div>
          <div className="mod-rate-row">
            <div className="fx-segment" role="radiogroup" aria-label="Mod pad rate">
              {MOD_RATE_ORDER.map(i=><button key={i} type="button" role="radio" aria-label={MOD_RATES[i]} aria-checked={mod.rate===i} className={mod.rate===i?'active':''}
                onClick={()=>set({rate:i})}>{MOD_RATES[i].replace(' bars',' bar')}</button>)}</div>
          </div>
          <div className="mod-tools-row">
            <div className="fx-segment" role="radiogroup" aria-label="Mod pad feel">
              {([['','Straight','—'],['T','Triplet','T'],['D','Dotted','D']] as [ModFeel,string,string][]).map(([f,l,sh])=>
                <button key={l} type="button" role="radio" aria-label={l} aria-checked={(mod.feel??'')===f} className={(mod.feel??'')===f?'active':''}
                  onClick={()=>set({feel:f})}>{sh}</button>)}</div>
            {mod.shape==='steps'?<><span className="mod-group-label">Steps</span>
              <div className="fx-segment" role="radiogroup" aria-label="Step count">
                {STEP_COUNTS.map(n=><button key={n} type="button" role="radio" aria-checked={(mod.count??16)===n} className={(mod.count??16)===n?'active':''}
                  onClick={()=>set({count:n})}>{n}</button>)}</div></>:null}
            <button type="button" className={'mod-tool'+(snap?' on':'')} aria-pressed={snap} onClick={()=>setSnap(!snap)}
              title="Points and steps lock to the grid"><Magnet size={16}/>Snap</button>
            {mod.shape!=='curve'&&mod.shape!=='steps'&&!RANDOM_SHAPES.has(mod.shape)?
              <button type="button" className="mod-tool" onClick={()=>set({shape:'curve',points:pointsFrom(mod)})}><Pencil size={16}/>Edit points</button>:null}
          </div>
        </div>
      </div>:<LinksBody chain={chain} targets={mod.targets} color={color} onTargets={setTargets}/>}
  </SourceInspector>;
}

/** The Links view, shared by mod pads and macros: pick an effect, tap parameters to link them, set each depth. */
export function LinksBody({chain,targets,color,onTargets}:{chain:FxChain;targets:FxTarget[];color:string;onTargets:(t:FxTarget[])=>void}){
  const used:(FxModuleId|'sound')[]=['sound',...chain.modules.filter(m=>m.on).map(m=>m.id)];
  const [module,setModule]=useState<FxModuleId|'sound'>('sound');
  const pick=used.includes(module)?module:'sound';
  const params=pick==='sound'?Object.entries(SOUND_TARGETS).map(([key,d])=>({key,label:d.label})):FX_MODULES[pick].params.filter(p=>!p.hidden&&!p.editor&&p.modulatable!==false);
  const linked=(m:string,p:string)=>targets.findIndex(t=>t.module===m&&t.param===p);
  const setTargets=(t:FxTarget[])=>onTargets(t.slice(0,16));
  const mod={targets};
  return <div className={'mod-sheet-body links'+(targets.length?'':' no-routes')}>
        <div className="mod-link-pick">
          <span className="mod-group-label">Link to</span>
          <div className="fx-segment mod-link-modules" role="radiogroup" aria-label="Target effect">
            {used.map(id=><button key={id} type="button" role="radio" aria-checked={pick===id} className={pick===id?'active':''}
              style={{['--fx-color' as string]:id==='sound'?undefined:FX_MODULES[id].color}}
              onClick={()=>setModule(id)}>{id==='sound'?'Sound':FX_MODULES[id].name}</button>)}</div>
          {/* Sir, 16 Nov: guide the eye. Knob names are grouped by the card they sit on, in that card's colour. */}
          {(pick==='sound'
            ?SOUND_GROUPS.map(([card,title,color])=>({title,color,items:params.filter(p=>SOUND_TARGETS[p.key]?.card===card)}))
              .concat([{title:'Other',color:'#9aa0a6',items:params.filter(p=>!SOUND_GROUPS.some(([c])=>c===SOUND_TARGETS[p.key]?.card))}])
            :[{title:FX_MODULES[pick].name,color:FX_MODULES[pick].color,items:params}]).filter(g=>g.items.length).map(g=>
            <div key={g.title} className="mod-link-group" style={{['--grp' as string]:g.color}}>
              <span className="mod-link-group-name">{g.title}</span>
              <div className="mod-link-params">
                {g.items.map(p=>{const k=linked(pick,p.key);return <button type="button" key={p.key} aria-pressed={k>=0} className={k>=0?'on':''}
                  disabled={k<0&&mod.targets.length>=16}
                  onClick={()=>setTargets(k>=0?mod.targets.filter((_,j)=>j!==k):[...mod.targets,{module:pick,param:p.key,depth:.5}])}>{p.label}</button>;})}
              </div></div>)}
          <p className="mod-sheet-tip">Tap a knob name to link it, tap again to unlink. You can also tap the name under a pad or macro, then tap knobs on the page.</p>
        </div>
        <div className="mod-link-list" aria-label="Linked knobs">
          {mod.targets.length?mod.targets.map((t,k)=>{const info=targetInfo(t);return <div key={k} className="mod-link" style={{['--fx-color' as string]:info.color}}>
            <span><i/>{info.name} · {info.label}</span>
            <BipolarDepth value={t.depth} color={color} label={'Depth '+info.name+' '+info.label}
              onChange={d=>setTargets(mod.targets.map((x,j)=>j===k?{...x,depth:d}:x))}/>
            <button type="button" aria-label={'Unlink '+info.name+' '+info.label} onClick={()=>setTargets(mod.targets.filter((_,j)=>j!==k))}><X size={16}/></button>
          </div>;}):<p className="mod-empty">Nothing linked yet. Choose a parameter below to add a link.</p>}
        </div>
      </div>;
}

/** Sound cards in page order, with the colours of their card titles on the Sound page */
const SOUND_GROUPS:[string,string,string][]=[['sound-tone','Tone','#f2c46d'],['rack-envelope','Amp envelope','#7fd6bb'],['sound-filter','Filter','#f29a6d'],
  ['sound-character','Character','#e59ee0'],['sound-unison','Unison','#6dc9f2'],['motion-synth','Play','#7aa7f5'],['rack-output','Output','#c79df5']];

type MacroSheetProps={chain:FxChain;index:number;onChange:(c:FxChain)=>void;onClose:()=>void;container:Element|null;anchor:Element|null};

/** A macro's links in the same sheet as the mod pads use; its name is edited in the title. */
export function MacroSheet({chain,index,onChange,onClose,container,anchor}:MacroSheetProps){
  const macro=chain.macros[index];const color=MACRO_COLORS[index];
  const set=(patch:Partial<FxChain['macros'][number]>)=>onChange({...chain,macros:chain.macros.map((m,i)=>i===index?{...m,...patch}:m)});
  if(!container)return null;
  return <SourceInspector container={container} anchor={anchor} label={'Macro '+(index+1)+' links'} color={color} onClose={onClose}>
      <header className="mod-sheet-bar">
        <i className="pe-dot"/><input className="pe-title-input" aria-label={'Macro '+(index+1)+' name'} value={macro.name} maxLength={24}
          onChange={e=>set({name:e.target.value})}/>
        <span className="pe-sub">Links{macro.targets.length?' · '+macro.targets.length:''}</span>
        <span className="pe-gap"/>
        <button type="button" className="mod-sheet-done" onClick={onClose}>Done</button>
      </header>
      <LinksBody chain={chain} targets={macro.targets} color={color} onTargets={targets=>set({targets})}/>
  </SourceInspector>;
}
