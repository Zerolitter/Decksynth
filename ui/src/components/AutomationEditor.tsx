import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Plus} from 'lucide-react';
import {controlName,type ControlTarget} from '../parameter-registry';
import type {AutomationLane} from '../types';
import {useFrame} from '../frame-clock';

type Point=[number,number];
type Props={track:number;lanes:AutomationLane[];target:ControlTarget|null;beats:number;/** the lane runs over the song (else over the loop) */song:boolean;playing:boolean;armed:boolean;send:(cmd:string,args?:unknown)=>void;close:()=>void};

/** Sound and macro targets offered when adding a lane (a grid of buttons, rule 11). Every one exists in the engine registry. */
export const AUTOMATION_CHOICES:ControlTarget[]=[
  ...['filter','vcf_cutoff','vcf_reso','vcf_morph','vcf_env','modulation','volume','pan','uni_detune','formant','vowel','character','sub','pitch','attack','release']
    .map(param=>({module:'sound',param})),
  ...Array.from({length:8},(_,i)=>({module:'macro',param:String(i)})),
];
const H=120,MAX_HANDLES=64;
const same=(a:ControlTarget,b:ControlTarget)=>a.module===b.module&&a.param===b.param;

/** Drop points that sit on the straight line between their neighbours: same curve, far fewer points to store,
 *  send every 100 ms and draw. A drawn gesture at 1/16 beat easily makes hundreds. */
export function thinPoints(points:Point[],tolerance=.004):Point[]{
  if(points.length<3)return points;
  const out:Point[]=[points[0]];
  for(let i=1;i<points.length-1;i++){
    const a=out[out.length-1],b=points[i],c=points[i+1];
    const t=(b[0]-a[0])/Math.max(1e-9,c[0]-a[0]),y=a[1]+(c[1]-a[1])*t;
    if(Math.abs(y-b[1])>tolerance)out.push(b);
  }
  out.push(points[points.length-1]);
  return out;
}

export function AutomationEditor({track,lanes,target,beats,song,playing,armed,send,close}:Props){
  const [selected,setSelected]=useState<ControlTarget>(target??lanes[0]??{module:'sound',param:'filter'});
  const [index,setIndex]=useState(0),[adding,setAdding]=useState(false);
  const done=useRef<HTMLButtonElement>(null),drag=useRef(false),points=useRef<Point[]>([]);
  const lane=lanes.find(l=>same(l,selected)),current=lane?.points??[];
  // The worker sends the whole project ten times a second; only react when this lane's points really changed.
  const signature=JSON.stringify(current);
  const [draft,setDraft]=useState<Point[]>(current as Point[]);
  useEffect(()=>{if(!drag.current)setDraft(JSON.parse(signature));},[signature]);
  const strip=useRef<HTMLElement>(null);
  const [place,setPlace]=useState<React.CSSProperties>({left:8,right:8,bottom:8});
  const [width,setWidth]=useState(1200);
  // Sit over the page's focus window (Partials, waveform, FX window), so the rack's knobs stay in reach.
  useEffect(()=>{const fit=()=>{const w=document.querySelector('.frame-window')?.getBoundingClientRect();
      setPlace(w&&w.height>120?{left:w.left,width:w.width,top:w.top,height:Math.min(w.height,232)}:{left:8,right:8,bottom:8});
      const svg=strip.current?.querySelector('.automation-lane-editor svg')?.getBoundingClientRect();if(svg&&svg.width>100)setWidth(Math.round(svg.width/svg.height*H));};
    fit();const ro=new ResizeObserver(fit);ro.observe(document.body);return()=>ro.disconnect();},[adding]);
  useEffect(()=>{const previous=document.activeElement as HTMLElement;
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();if(adding)setAdding(false);else close();}};
    // A tap on blank space (not a control) closes it; knobs and buttons elsewhere keep working.
    const blank=(e:PointerEvent)=>{const t=e.target as HTMLElement|null;if(!t||strip.current?.contains(t))return;
      if(t.closest('button,[role],input,select,a,svg,label,.knob'))return;close();};
    window.addEventListener('keydown',key);window.addEventListener('pointerdown',blank,true);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('pointerdown',blank,true);if(previous?.isConnected&&strip.current?.contains(document.activeElement))previous.focus();};},[close,adding]);
  function commit(next:Point[]){
    const others=lanes.filter(l=>!same(l,selected));
    send('automation',[track,next.length?[...others,{...selected,points:thinPoints(next)}]:others]);
  }
  function locate(e:React.PointerEvent<SVGSVGElement>){
    const b=e.currentTarget.getBoundingClientRect();
    const beatAt=Math.round(Math.max(0,Math.min(beats-.000001,(e.clientX-b.left)/b.width*beats))*16)/16;
    return {beat:Math.min(beats-.000001,beatAt),unit:Math.round(Math.max(0,Math.min(1,1-(e.clientY-b.top)/b.height))*1000)/1000};
  }
  function edit(e:React.PointerEvent<SVGSVGElement>){
    const {beat:at,unit}=locate(e);
    const next=points.current.filter(p=>Math.abs(p[0]-at)>.00001);next.push([at,unit]);next.sort((a,b)=>a[0]-b[0]);
    points.current=next;setDraft(next);setIndex(next.findIndex(p=>p[0]===at));
  }
  const choices=[...lanes.map(l=>({module:l.module,param:l.param})),...(!lanes.some(l=>same(l,selected))?[selected]:[])];
  const point=draft[Math.max(0,Math.min(index,draft.length-1))];
  const W=width;
  const path=useMemo(()=>draft.length?'M0 '+(1-draft[0][1])*H+' '+draft.map(p=>'L'+(p[0]/beats*W).toFixed(1)+' '+((1-p[1])*H).toFixed(1)).join(' ')+' L'+W+' '+((1-draft[draft.length-1][1])*H):'',[draft,beats,W]);
  // The playhead moves on the shared frame clock, without re-rendering the editor.
  const headLine=useRef<SVGLineElement>(null);
  useFrame(p=>{const el=headLine.current;if(!el)return;const b=song?p.songBeat:p.clipBeat,x=String(((b%beats)+beats)%beats/beats*W);el.setAttribute('x1',x);el.setAttribute('x2',x);});
  // A slim strip over the page's focus window, not a modal: the knobs stay visible and playable below it.
  return createPortal(<section ref={strip} role="dialog" aria-label="Parameter automation" className="automation-editor automation-strip" style={place}>
      <header>
        <strong>Automation</strong>
        <div className="automation-lanes" role="group" aria-label="Automation lanes">
          {choices.map(l=><button key={l.module+'.'+l.param} type="button" aria-pressed={!adding&&same(l,selected)} onClick={()=>{setSelected(l);setIndex(0);setAdding(false);}}>{controlName(l)}</button>)}
          <button type="button" className="automation-add" aria-expanded={adding} onClick={()=>setAdding(!adding)}><Plus size={15}/>Lane</button>
        </div>
        <span className="automation-readout">{draft.length?(point?Math.round(point[1]*100)+'% · beat '+(point[0]+1).toFixed(2)+' · ':'')+draft.length+' pts':'Drag to draw'}</span>
        <button type="button" disabled={!draft.length} onClick={()=>commit([])}>Clear</button>
        <button type="button" aria-pressed={armed} title="With REC on, knob moves are written into their lanes" onClick={()=>send('automation_arm',!armed)}>{armed?'Armed':'Arm REC'}</button>
        <button ref={done} type="button" onClick={close}>Done</button></header>
      <div className="automation-content">
        {adding?<div className="automation-targets" role="group" aria-label="Choose what to automate">
          {AUTOMATION_CHOICES.map(t=>{const used=lanes.some(l=>same(l,t));return <button key={t.module+'.'+t.param} type="button" aria-pressed={same(t,selected)} className={used?'used':''}
            onClick={()=>{setSelected(t);setIndex(0);setAdding(false);}}>{controlName(t)}{used?' ●':''}</button>;})}
        </div>
        :<div className="automation-lane-editor"><svg role="slider" tabIndex={0} aria-label={controlName(selected)+' automation lane'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((point?.[1]??0)*100)} viewBox={'0 0 '+W+' '+H}
          onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current=true;points.current=current.map(p=>[p[0],p[1]] as Point);edit(e);}} onPointerMove={e=>{if(drag.current)edit(e);}}
          onPointerUp={()=>{if(drag.current){drag.current=false;commit(points.current);}}} onPointerCancel={()=>{drag.current=false;setDraft(JSON.parse(signature));}}
          onKeyDown={e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Delete','Home'].includes(e.key)){e.preventDefault();const next=draft.length?draft.map(p=>[...p] as Point):[[0,.5] as Point];const i=Math.max(0,Math.min(index,next.length-1));if(e.key==='ArrowRight')setIndex(Math.min(i+1,next.length-1));else if(e.key==='ArrowLeft')setIndex(Math.max(0,i-1));else if(e.key==='Delete'){next.splice(i,1);commit(next);}else if(e.key==='Home'){next[i][1]=.5;commit(next);}else{next[i][1]=Math.max(0,Math.min(1,next[i][1]+(e.key==='ArrowUp'?.01:-.01)));commit(next);}}}}>
          {Array.from({length:Math.max(0,Math.floor(beats/4)-1)},(_,i)=><line key={i} className="automation-bar" x1={(i+1)*4/beats*W} x2={(i+1)*4/beats*W} y1={0} y2={H}/>)}
          {path?<path d={path} fill="none" stroke="currentColor" strokeWidth="3"/>:null}
          {draft.length<=MAX_HANDLES?draft.map((p,i)=><circle key={p[0]} cx={p[0]/beats*W} cy={(1-p[1])*H} r={i===index?6:4}/>)
            :point?<circle cx={point[0]/beats*W} cy={(1-point[1])*H} r={6}/>:null}
          {playing?<line ref={headLine} className="automation-head" x1={0} x2={0} y1={0} y2={H}/>:null}
        </svg>
        </div>}
      </div>
    </section>,document.querySelector('.harness-shell')??document.body);
}
