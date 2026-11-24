import {useContextTarget,useContextArea} from './ContextWheel';
import {knobControl} from '../parameter-registry';
import {MACRO_COLORS,MOD_COLORS} from './ModParts';
import {useModLink,linkActions,linkedColors,tapToLink,linkTargetFor} from './ModLink';
import {FX_MODULES,type FxModuleId} from '../fx';
/** Steam Deck tactile knob.
 * Gesture math and pointer-lock safety: Chordz Studio's original utilities.
 * Procedural tick ring, cap shading and short-lived value bubble: originally
 * authored for DeckSynth after studying ReplicantTr8s (MIT).
 */
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
/** A card's colour for the knobs inside it, when they don't name one (Sir, 16 Nov: scan a card's knobs by colour). */
export const KnobTint=createContext<string|null>(null);
import {
  knobArc, knobDragValue, knobToUnit, knobQuantize, knobKeyValue, knobParseNumber,
} from '../chordz-primitives/knob';
import { startRelativeDrag, type RelativeDragHandle } from '../chordz-primitives/relative-drag';
import {useMidiLearn} from './MidiLearn';
import { createFrameBatch } from '../chordz-primitives/frame-batch';

type Props = {
  contextArea?:import('../context-actions').ContextArea;id: string; name: string; value: number; min: number; max: number;
  step?: number; suffix?: string; accent?: string; precision?: number;
  onChange: (next: number) => void;
  description?: string; compact?: boolean;
  /** Live modulated position (in value units) drawn as an outer ring; null/undefined hides it. */
  modValue?: number|null; modColor?: string;
  /** Optional text for the value (e.g. a rate name for a stepped knob). */
  format?: (n:number)=>string;
  /** What a double-click (or double-tap) resets to. Without it the factory / preset default is used. */
  defaultValue?: number;
  /** A visual-only interval suggested by the active Sound guide. */
  recommendedRange?: readonly [number,number];
};

export function Knob({contextArea,id,name,value,min,max,step=.001,suffix='',accent:accentProp,
  precision=2,onChange,description='',compact=false,modValue=null,modColor='#f2c46d',format,defaultValue,recommendedRange}:Props) {
  const tint=useContext(KnobTint),accent=accentProp??tint??'var(--accent)';
  const area=useContextArea(),midi=useMidiLearn(),cc=midi?.cc(id)??null,link=useModLink();
  // Sampler and Drum Rack knobs show who moves them here; Sound and FX knobs already sit in cells that do.
  const dots=/^(smp|drum)-/.test(id)?linkedColors(link,id):[];
  const gesture=useRef(false);
  const lastTap=useRef<{t:number;x:number;y:number}|null>(null);
  const resetTarget=():number|undefined=>{if(defaultValue!==undefined)return defaultValue;const control=knobControl(id,Number(id.split('-')[0]));return control&&control.module!=='sound'?FX_MODULES[control.module as FxModuleId]?.params.find(p=>p.key===control.param)?.init:midi?.defaultValue(id);};
  const beginGesture=()=>{if(!gesture.current){midi?.gesture(id,'begin');gesture.current=true;}};
  const endGesture=(cancel=false)=>{if(gesture.current){midi?.gesture(id,cancel?'cancel':'end');gesture.current=false;}};
  const commitChange=(n:number)=>{beginGesture();onChangeRef.current(n);endGesture();};
  const learnHold=useRef<{x:number;y:number;timer:ReturnType<typeof setTimeout>}|null>(null);
  const clearLearnHold=()=>{if(learnHold.current)clearTimeout(learnHold.current.timer);learnHold.current=null;};
  const context=useContextTarget(()=>{const control=knobControl(id,Number(id.split('-')[0])),factory=control&&control.module!=='sound'?FX_MODULES[control.module as FxModuleId]?.params.find(p=>p.key===control.param)?.init:midi?.defaultValue(id);return {area:contextArea??area??(control&&control.module!=='sound'&&control.module!=='macro'?'fx':'sound'),kind:'parameter',label:name,cancel:()=>{clearLearnHold();drag.current?.cancel();},caps:{value:()=>setEditing(true),...((defaultValue??factory)!==undefined?{reset:()=>commitChange((defaultValue??factory) as number)}:{}),...(midi?.canLearn(id)?{automation:()=>midi.automation(id),modulation:()=>midi.modulation(id),midi:()=>midi.learn(id)}:{}),open:()=>document.querySelector<HTMLElement>('[data-param="'+id+'"]')?.scrollIntoView({block:'nearest',inline:'nearest'})},extra:linkActions(link,id)};});
  const gradientId = useId().replace(/:/g,'');
  const drag = useRef<RelativeDragHandle|null>(null);
  const dragging = useRef(false);
  const latest = useRef(value);
  const onChangeRef=useRef(onChange);onChangeRef.current=onChange;
  const [local,setLocal]=useState(value);
  const [engaged,setEngaged]=useState(false);
  const [showBubble,setShowBubble]=useState(false);
  const [fineMode,setFineMode]=useState(false);
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(String(value));
  const input=useRef<HTMLInputElement>(null);
  // Value box (UI-RULES 36): one click arms the mouse wheel, two slow clicks (0.4-1.6 s apart) open number entry.
  const [armed,setArmed]=useState(false);
  const valueBox=useRef<HTMLButtonElement>(null),lastValueClick=useRef(0),openOnClick=useRef(false),wheelSettle=useRef<number|undefined>(undefined);
  const valueDown=(e:React.PointerEvent)=>{
    if(e.button!==0)return;
    const now=performance.now(),since=now-lastValueClick.current;lastValueClick.current=now;
    // Entry opens on the click (release): opening on the press would hand the focus back to the box and close it again.
    if(armed&&since>=400&&since<=1600){lastValueClick.current=0;openOnClick.current=true;return;}
    openOnClick.current=false;
    setArmed(true);
    // Hold and drag (rule 36, as Help says): up/down in normal steps, left/right in fine steps. Touch holds first,
    // so a swipe across the screen still scrolls; a mouse drags at once.
    const d={id:e.pointerId,x:e.clientX,y:e.clientY,start:latest.current,on:e.pointerType==='mouse',moved:false,timer:undefined as number|undefined};
    if(!d.on)d.timer=window.setTimeout(()=>{if(boxDrag.current===d){d.on=true;reveal();}},220);
    boxDrag.current=d;(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const boxDrag=useRef<{id:number;x:number;y:number;start:number;on:boolean;moved:boolean;timer?:number}|null>(null);
  const valueMove=(e:React.PointerEvent)=>{
    const d=boxDrag.current;if(!d||d.id!==e.pointerId)return;
    const dx=e.clientX-d.x,dy=d.y-e.clientY;
    if(!d.on){if(Math.hypot(dx,dy)>10){window.clearTimeout(d.timer);boxDrag.current=null;}return;}
    if(!d.moved&&Math.hypot(dx,dy)<4)return;
    if(!d.moved){d.moved=true;dragging.current=true;beginGesture();}
    const range=max-min,normal=Math.max(step,range/100)*(e.shiftKey?10:1),fine=Math.max(step,range/1000);
    const n=knobQuantize(Math.max(min,Math.min(max,d.start+Math.trunc(dy/7)*normal+Math.trunc(dx/7)*fine)),min,max,step);
    if(n!==latest.current){latest.current=n;setLocal(n);batch.push(n);}
    reveal();
  };
  const valueUp=(cancel:boolean)=>(e:React.PointerEvent)=>{
    const d=boxDrag.current;if(!d||d.id!==e.pointerId)return;
    window.clearTimeout(d.timer);boxDrag.current=null;
    if(!d.moved)return;
    dragging.current=false;lastValueClick.current=0;openOnClick.current=false;
    if(cancel){batch.discard();latest.current=d.start;setLocal(d.start);onChangeRef.current(d.start);}
    else batch.flush();
    endGesture(cancel);hideLater();
    valueBox.current?.dispatchEvent(new CustomEvent('knob-settle',{bubbles:true}));
  };
  useEffect(()=>{
    const el=valueBox.current;if(!el||!armed)return;
    const wheel=(e:WheelEvent)=>{
      e.preventDefault();e.stopPropagation();const d=e.deltaY||e.deltaX;if(!d)return;
      lastValueClick.current=0;   // a click after scrolling arms again; it never opens entry
      const range=max-min,size=e.shiftKey?Math.max(step,range/10):e.ctrlKey||e.metaKey?step:Math.max(step,range/100);
      const n=knobQuantize(Math.max(min,Math.min(max,latest.current+(d<0?size:-size))),min,max,step);
      if(n===latest.current)return;
      latest.current=n;setLocal(n);beginGesture();onChangeRef.current(n);reveal();
      window.clearTimeout(wheelSettle.current);
      // A run of wheel ticks is one change: it ends (one undo step) when the wheel rests.
      wheelSettle.current=window.setTimeout(()=>{endGesture();hideLater();el.dispatchEvent(new CustomEvent('knob-settle',{bubbles:true}));},350);
    };
    const away=(e:PointerEvent)=>{if(!el.contains(e.target as Node))setArmed(false);};
    el.addEventListener('wheel',wheel,{passive:false});document.addEventListener('pointerdown',away,true);
    return()=>{el.removeEventListener('wheel',wheel);document.removeEventListener('pointerdown',away,true);};
  });
  useEffect(()=>()=>window.clearTimeout(wheelSettle.current),[]);
  const readoutTimeout=useRef<ReturnType<typeof setTimeout>|null>(null);

  const batch=useMemo(()=>createFrameBatch<number>(n=>onChangeRef.current(n)),[]);
  useEffect(()=>{
    if(!dragging.current){setLocal(value);latest.current=value;}
  },[value]);
  useEffect(()=>()=> {
    clearLearnHold();drag.current?.cancel();batch.discard();endGesture(true);
    if(readoutTimeout.current!==null)clearTimeout(readoutTimeout.current);
  },[batch,id]);
  useEffect(()=>{if(editing){setDraft(String(local));input.current?.select();}},[editing]);

  function show(n:number){
    if(format)return format(n);
    if(suffix==='%'&&max<=1)return Math.round(n*100)+'%';
    if(suffix==='Hz')return n>=1000?(n/1000).toFixed(2)+'kHz':Math.round(n)+'Hz';
    return n.toFixed(precision)+(suffix?' '+suffix:'');
  }
  function reveal(){
    if(readoutTimeout.current!==null)clearTimeout(readoutTimeout.current);
    readoutTimeout.current=null;
    setShowBubble(true);
  }
  function hideLater(){
    if(readoutTimeout.current!==null)clearTimeout(readoutTimeout.current);
    readoutTimeout.current=setTimeout(()=>{setEngaged(false);setShowBubble(false);},1250);
  }
  const onPointerDown=(e:React.PointerEvent<HTMLDivElement>)=>{
    if(editing||e.button!==0)return;
    clearLearnHold();
    // Two quick clicks (or taps) reset to the default (UI-RULES 35).
    const now=performance.now(),last=lastTap.current;lastTap.current={t:now,x:e.clientX,y:e.clientY};
    if(last&&now-last.t<330&&Math.hypot(e.clientX-last.x,e.clientY-last.y)<14){
      lastTap.current=null;const d=resetTarget();
      if(d!==undefined){e.preventDefault();drag.current?.cancel();const n=knobQuantize(d,min,max,step);latest.current=n;setLocal(n);commitChange(n);reveal();hideLater();}
      return;
    }
    if(midi?.canLearn(id)){
      const x=e.clientX,y=e.clientY;
      learnHold.current={x,y,timer:setTimeout(()=>{if(!dragging.current){drag.current?.cancel();midi.open(id,x,y);}learnHold.current=null;},750)};
    }
    reveal();setEngaged(true);
    drag.current?.cancel();
    latest.current=local;
    drag.current=startRelativeDrag(e.currentTarget,e.nativeEvent,{
      threshold:3,pointerLock:e.pointerType==='mouse',
      onStart:()=>{dragging.current=true;beginGesture();return true;},
      onFineChange:setFineMode,
      onMove:({dy,fine})=>{
        const n=knobQuantize(knobDragValue(latest.current,dy,{min,max},fine),min,max,step);
        latest.current=n;setLocal(n);batch.push(n);reveal();
      },
      onEnd:(canceled)=>{
        dragging.current=false;
        if(canceled){batch.discard();setLocal(value);latest.current=value;onChangeRef.current(value);}
        else batch.flush();
        endGesture(canceled);setFineMode(false);hideLater();
      },
    });
  };
  const onKeyDown=(e:React.KeyboardEvent)=>{
    if(editing)return;
    const next=knobKeyValue(e.key,local,{min,max,step},e.shiftKey);
    if(next!==null){
      e.preventDefault();setLocal(next);latest.current=next;
      beginGesture();onChangeRef.current(next);reveal();hideLater();
    }
    if(e.key==='Enter'){e.preventDefault();setEditing(true);reveal();}
  };
  const commit=()=>{
    const parsed=knobParseNumber(draft,min,max);
    if(parsed!==null){
      const next=knobQuantize(parsed,min,max,step);
      latest.current=next;setLocal(next);commitChange(next);
      reveal();hideLater();
    }
    setEditing(false);
  };
  const unit=knobToUnit(local,min,max);
  const guideStart=recommendedRange?knobToUnit(recommendedRange[0],min,max):0;
  const guideEnd=recommendedRange?knobToUnit(recommendedRange[1],min,max):0;
  const guideMatch=!recommendedRange||local>=recommendedRange[0]&&local<=recommendedRange[1];
  const guideText=recommendedRange?'Guide '+show(recommendedRange[0])+'–'+show(recommendedRange[1])+' · '+(guideMatch?'within range':'outside range'):'';
  const guidePoint=(guideUnit:number)=>{const guideAngle=(-225+guideUnit*270)*Math.PI/180;return [28+30*Math.cos(guideAngle),28+30*Math.sin(guideAngle)];};
  const angle=(-225+unit*270)*Math.PI/180;
  const ux=Math.cos(angle),uy=Math.sin(angle);
  const ticks=Array.from({length:11},(_,i)=>{
    const a=(-225+i*27)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    const long=i===0||i===5||i===10;
    return <line key={i} x1={28+22*c} y1={28+22*s}
      x2={28+(long?27.0:25.3)*c} y2={28+(long?27.0:25.3)*s}
      stroke={i/10<=unit+1e-6?accent:'#516068'}
      strokeWidth={long?1.8:1.2} strokeLinecap="round"
      opacity={i/10<=unit+1e-6?.96:.65}/>;
  });
  return <div className={'parameter-knob tactile-knob'+(compact?' compact':'')+
    (engaged?' is-engaged':'')+(fineMode?' is-fine-mode':'')+(recommendedRange?(guideMatch?' is-guide-match':' is-guide-outside'):'')+(link?.armed&&/^(smp|drum)-/.test(id)&&linkTargetFor(id)?.track===link.track?' link-ready':'')}
    style={link?.armed?{['--link-src' as string]:(link.armed.kind==='macro'?MACRO_COLORS:MOD_COLORS)[link.armed.index]}:undefined}
    data-param={id} data-resettable={resetTarget()!==undefined?'1':'0'} data-guide-status={recommendedRange?(guideMatch?'within':'outside'):undefined} {...context} title={[description,guideText].filter(Boolean).join(' · ')||name}
    onContextMenu={e=>{if((e.target as Element).closest('input,textarea,select,[contenteditable=true]'))return;if(midi?.canLearn(id)){e.preventDefault();drag.current?.cancel();midi.open(id,e.clientX,e.clientY);}}}>
    <div className="knob-heading">{name}</div>{dots.length?<span className="knob-link-dots" data-linked={dots.length} title={'Moved by '+dots.length+(dots.length>1?' sources':' source')}>{dots.map((c,k)=><i key={k} style={{background:c}}/>)}</span>:null}{cc!==null?<span className="knob-midi-cc" data-midi-cc={cc}>CC{cc}</span>:null}
    <div role="slider" tabIndex={0} aria-orientation="vertical"
      data-testid={'knob-'+id} className="knob-target" aria-label={name}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={local} aria-valuetext={show(local)+(guideText?' · '+guideText:'')}
      onPointerDownCapture={e=>{if(e.button!==0||!link?.armed)return;
        // Sir, 16 Nov: knobs still turn while linking. A tap links or unlinks; a drag turns the knob.
        const x0=e.clientX,y0=e.clientY,t0=performance.now();let moved=false;
        let travel=0;const mv=(ev:PointerEvent)=>{travel+=Math.abs(ev.movementX||0)+Math.abs(ev.movementY||0);if(travel>6||Math.hypot(ev.clientX-x0,ev.clientY-y0)>6)moved=true;};
        const end=(ok:boolean)=>()=>{window.removeEventListener('pointermove',mv,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',cancel,true);
          if(ok&&!moved&&performance.now()-t0<600)tapToLink(link,id);};
        const up=end(true),cancel=end(false);
        window.addEventListener('pointermove',mv,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',cancel,true);}}
      onPointerDown={onPointerDown} onPointerUp={()=>{clearLearnHold();hideLater();}}
      onPointerMove={e=>{const h=learnHold.current;if(h&&(dragging.current||Math.hypot(e.clientX-h.x,e.clientY-h.y)>3))clearLearnHold();}}
      onPointerCancel={()=>{clearLearnHold();setFineMode(false);hideLater();}} onKeyUp={e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'].includes(e.key))endGesture();}} onBlur={()=>endGesture()} onKeyDown={e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){if(midi?.canLearn(id)){e.preventDefault();e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();midi.open(id,r.x+r.width/2,r.y+r.height/2);}}else onKeyDown(e);}}
      onDoubleClick={()=>{drag.current?.cancel();setEditing(true);}}>
      <svg className="knob-svg" viewBox="0 0 56 56" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId+'-skirt'} x1="0" y1="0" x2=".85" y2="1">
            <stop offset="0" stopColor="#414b52"/>
            <stop offset=".62" stopColor="#252b32"/>
            <stop offset="1" stopColor="#151c23"/>
          </linearGradient>
          <linearGradient id={gradientId+'-cap'} x1=".1" y1="0" x2=".9" y2="1">
            <stop offset="0" stopColor="#4b5960"/>
            <stop offset=".48" stopColor="#303a42"/>
            <stop offset="1" stopColor="#171e25"/>
          </linearGradient>
        </defs>
        {ticks}
        <circle cx="28" cy="28.9" r="21" fill="#080d10" opacity=".68"/>
        <circle cx="28" cy="28" r="20" fill={'url(#'+gradientId+'-skirt)'}
          stroke="#11181c" strokeWidth="1.4"/>
        {Array.from({length:16},(_,i)=>{
          const a=i*Math.PI/8, cos=Math.cos(a),sin=Math.sin(a);
          return <line key={i} x1={28+16*cos} y1={28+16*sin}
            x2={28+19*cos} y2={28+19*sin}
            stroke="#75838a" strokeWidth=".85" opacity=".38"/>;
        })}
        <circle cx="28" cy="28" r="14.2" fill={'url(#'+gradientId+'-cap)'}
          stroke="#697982" strokeWidth=".8"/>
        {recommendedRange?(()=>{const [x0,y0]=guidePoint(guideStart),[x1,y1]=guidePoint(guideEnd);return <g className="knob-guide"><path className="knob-guide-range" d={knobArc(guideStart,guideEnd)} fill="none" stroke="var(--c-guide)" strokeWidth="2.8" strokeLinecap="round"/><circle className="knob-guide-boundary" cx={x0} cy={y0} r="1.7" fill="var(--c-guide)"/><circle className="knob-guide-boundary" cx={x1} cy={y1} r="1.7" fill="var(--c-guide)"/></g>;})():null}
        <path className="knob-value-arc" d={knobArc(0,unit)} fill="none" stroke={accent} strokeWidth="2.1"
          strokeLinecap="round" opacity={engaged?1:.68}/>
        <line x1={28+3*ux} y1={28+3*uy} x2={28+15.8*ux} y2={28+15.8*uy}
          stroke="#f8f9f7" strokeWidth="3" strokeLinecap="round"/>
        <circle cx="28" cy="28" r="2" fill="#f7f8f4" opacity=".84"/>
        {modValue!==null&&modValue!==undefined?(()=>{
          const mu=knobToUnit(modValue,min,max),a0=Math.min(unit,mu),a1=Math.max(unit,mu);
          const pt=(u:number)=>{const a=(-225+u*270)*Math.PI/180;return [28+30*Math.cos(a),28+30*Math.sin(a)];};
          const [x0,y0]=pt(a0),[x1,y1]=pt(a1),[mx,my]=pt(mu);
          return <g className="knob-mod">
            {a1-a0>.004?<path d={`M${x0.toFixed(2)} ${y0.toFixed(2)} A30 30 0 ${(a1-a0)*270>180?1:0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`}
              fill="none" stroke={modColor} strokeWidth="3" strokeLinecap="round" opacity=".9"/>:null}
            <circle cx={mx} cy={my} r="3.2" fill={modColor} stroke="#0b1114" strokeWidth="1"/>
          </g>;
        })():null}
      </svg>
      {showBubble&&!editing&&<span className="knob-live-value" role="status">{name}<b>{show(local)}</b></span>}
    </div>
    {fineMode&&<span className="knob-fine-indicator" role="status">FINE</span>}
    {editing?
      <input ref={input} className="knob-entry" aria-label={name+' numeric value'}
        type="text" inputMode="decimal" value={draft} autoFocus
        onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')commit();if(e.key==='Escape'){setEditing(false);hideLater();}}}
        onBlur={commit}/>:
      <button ref={valueBox} type="button" className={'knob-value'+(armed?' armed':'')} aria-label={name+' value box'}
        title="Click, then scroll (Shift: bigger steps, Ctrl: finer) · hold and drag: up/down, left/right finer · two slow clicks to type a number"
        onPointerDown={valueDown} onPointerMove={valueMove} onPointerUp={valueUp(false)} onPointerCancel={valueUp(true)} onClick={()=>{if(openOnClick.current){openOnClick.current=false;setArmed(false);setEditing(true);}}} onBlur={()=>setArmed(false)}
        onKeyDown={e=>{if(e.key==='Enter'||e.key==='F2'){e.preventDefault();setArmed(false);setEditing(true);}}}>{show(local)}</button>}
  </div>;
}
