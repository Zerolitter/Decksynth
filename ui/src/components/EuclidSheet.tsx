import {useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {ValueBox} from './ValueBox';
import type {useNoteEditing} from './useNoteEditing';
import type {NoteTarget} from '../note-ops';
import {euclidCycle,euclidNotes,degreePitch,writeLanes,type EuclidLane} from '../euclid';
import {GENRES,DRUM_ROLES,SYNTH_ROLES,ROLE_LABEL,SYNTH_LABEL,drumRolePads,type Genre,type DrumRole,type SynthRole} from '../euclid-genres';
import {DRUM_KINDS,type DrumKind} from '../drum-kinds';
import {ROOTS} from '../chords';
import {noteName,type DrumPad,type StepPattern} from '../types';

type Lane={key:string;label:string;color:string;lane:EuclidLane;note:number;degrees:number[];octave:number};
type Scale={name:string;root:number};
const KIND:Record<DrumRole,DrumKind>={kick:'kick',snare:'snare',clap:'clap',hat:'hat',openhat:'hat',perc:'perc'};
const SYNTH_COLOUR:Record<SynthRole,string>={bass:'var(--t-oct)',arp:'var(--t-nudge)'};
const off=(fill:number,steps=16,velocity=100):EuclidLane=>({on:false,fill,steps,shift:0,velocity});

/** The lanes this device can write: one per drum role the kit has a pad for, or a bass and an arp for a synth. */
function startLanes(drums:boolean,pads:readonly DrumPad[]):Lane[]{
 if(drums){
  const found=drumRolePads(pads);
  return DRUM_ROLES.flatMap(role=>{const pad=found[role];if(!pad)return [];
   const lane=role==='kick'?{...off(4,16,110),on:true}:role==='hat'?{...off(8,16,70),on:true}:off(role==='snare'||role==='clap'?2:5,16,95);
   if(role==='snare'||role==='clap')lane.shift=4;
   return [{key:role,label:ROLE_LABEL[role],color:DRUM_KINDS[KIND[role]].color,lane,note:pad.note,degrees:[],octave:0}];});
 }
 return SYNTH_ROLES.map(role=>({key:role,label:SYNTH_LABEL[role],color:SYNTH_COLOUR[role],lane:role==='bass'?{...off(4,16,100),on:true}:off(7,16,80),note:0,degrees:role==='bass'?[0]:[0,2,4,2],octave:role==='bass'?0:2}));
}

/** A genre sets every lane: the ones it names switch on with its values, the rest switch off but keep theirs. */
function withGenre(lanes:Lane[],g:Genre,drums:boolean):Lane[]{
 return lanes.map(l=>{
  const src=drums?g.drums[l.key as DrumRole]:g.synth[l.key as SynthRole]?.lane;
  if(!src)return {...l,lane:{...l.lane,on:false}};
  const [fill,steps,shift,velocity]=src,syn=drums?null:g.synth[l.key as SynthRole];
  return {...l,lane:{on:true,fill,steps,shift,velocity},degrees:syn?.degrees??l.degrees,octave:syn?.octave??l.octave};
 });
}

const pitchOf=(l:Lane,drums:boolean,scale:Scale)=>drums?()=>l.note:(k:number)=>degreePitch(36+scale.root+12*l.octave,scale.name,l.degrees[k%l.degrees.length]);

/** The ring view: one ring per lane, the selected one bright. It draws the same cycles the Write button writes. */
function Rings({lanes,selected}:{lanes:Lane[];selected:number}){
 return <svg className="euclid-rings" viewBox="0 0 220 220" role="img" aria-label={'Rings of '+lanes.filter(l=>l.lane.on).map(l=>l.label+' '+l.lane.fill+' of '+l.lane.steps).join(', ')}>
  {lanes.map((l,i)=>{
   const r=100-i*(lanes.length>4?13:18),cycle=euclidCycle(l.lane.fill,l.lane.steps,l.lane.shift),n=cycle.length;
   const dim=!l.lane.on,sel=i===selected;
   return <g key={l.key} className={'euclid-ring'+(sel?' sel':'')+(dim?' off':'')} style={{['--lane' as string]:l.color}}>
    <circle cx="110" cy="110" r={r} className="euclid-track"/>
    {cycle.map((hit,s)=>{const a=s/n*Math.PI*2-Math.PI/2,x=110+r*Math.cos(a),y=110+r*Math.sin(a);
     return hit?<circle key={s} cx={x} cy={y} r={sel?5.5:4} className="euclid-hit"/>:<circle key={s} cx={x} cy={y} r={1.6} className="euclid-gap"/>;})}
   </g>;
  })}
 </svg>;
}

export function useEuclid({edit,target,recording,pat,drums,pads,scale}:{edit:ReturnType<typeof useNoteEditing>;target:NoteTarget;recording:boolean;pat:StepPattern;drums:boolean;pads:readonly DrumPad[];scale:Scale}){
 const [open,setOpen]=useState(false);
 const latest=useRef({target,recording});latest.current={target,recording};
 const opened=useRef(JSON.stringify(target));
 useEffect(()=>{if(open&&(recording||JSON.stringify(target)!==opened.current))setOpen(false);},[open,recording,JSON.stringify(target)]);
 return {open:()=>{if(recording)return;opened.current=JSON.stringify(target);setOpen(true);},
  panel:open?<EuclidPanel edit={edit} target={target} pat={pat} drums={drums} pads={pads} scale={scale} close={()=>setOpen(false)}/>:null as ReactNode};
}

function EuclidPanel({edit,target,pat,drums,pads,scale,close}:{edit:ReturnType<typeof useNoteEditing>;target:NoteTarget;pat:StepPattern;drums:boolean;pads:readonly DrumPad[];scale:Scale;close:()=>void}){
 const [lanes,setLanes]=useState<Lane[]>(()=>startLanes(drums,pads)),[sel,setSel]=useState(0),[genre,setGenre]=useState<Genre|null>(null),[done,setDone]=useState('');
 const closeRef=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;closeRef.current?.focus();return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 const cur=lanes[Math.min(sel,lanes.length-1)];
 const patch=(i:number,change:Partial<EuclidLane>)=>{setDone('');setLanes(ls=>ls.map((l,j)=>j===i?{...l,lane:{...l.lane,...change}}:l));};
 const notesOf=(l:Lane)=>euclidNotes(l.lane,pat.length,pitchOf(l,drums,scale));
 const active=lanes.filter(l=>l.lane.on),count=active.reduce((n,l)=>n+notesOf(l).length,0);
 const audition=(l:Lane)=>edit.auditionPitch(drums?l.note:degreePitch(36+scale.root+12*l.octave,scale.name,l.degrees[0]??0));
 const write=()=>{
  if(!active.length)return;
  const next=writeLanes(edit.events,active.map(notesOf),drums?active.map(l=>l.note):null);
  edit.commit(next,[],edit.expectedState(),target);
  setDone('Written: '+count+' notes');
 };
 const tp=target.kind==='pattern'?'Pattern '+target.bank+':'+target.slot:'Pattern';
 return createPortal(<div className="generation-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)close();}}>
  <section role="dialog" aria-modal="true" aria-label="Euclid rhythm" className="note-generation euclid-sheet" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}}}>
   <header><div><strong>Euclid</strong><span>{tp} · {pat.length} steps{drums?'':' · '+ROOTS[scale.root]+' '+(scale.name==='Chromatic'?'minor':scale.name)}</span></div>
    <button type="button" ref={closeRef} className="euclid-done" aria-label="Done" onClick={close}><X size={18}/>Done</button></header>
   <div className="euclid-genres" role="group" aria-label="Genre starting points">
    {GENRES.map(g=><button type="button" key={g.id} aria-pressed={genre?.id===g.id} title={g.name+' · usually '+g.bpm[0]+'–'+g.bpm[1]+' BPM (the tempo is not changed)'}
     onClick={()=>{setGenre(g);setDone('');setLanes(ls=>withGenre(ls,g,drums));}}>{g.name}</button>)}
    <button type="button" className="euclid-clear" title="Switch every lane off" onClick={()=>{setGenre(null);setDone('');setLanes(ls=>ls.map(l=>({...l,lane:{...l.lane,on:false}})));}}>All off</button>
   </div>
   <div className="euclid-body">
    <div className="euclid-lanes" role="group" aria-label="Lanes">
     {lanes.map((l,i)=><div key={l.key} className={'euclid-lane'+(i===sel?' sel':'')} style={{['--lane' as string]:l.color}}>
      <button type="button" className="euclid-power" aria-pressed={l.lane.on} aria-label={l.label+(l.lane.on?' on':' off')} title={l.lane.on?'Leave '+l.label+' out':'Write '+l.label}
       onClick={()=>patch(i,{on:!l.lane.on})}><i aria-hidden="true"/></button>
      <button type="button" className="euclid-pick" aria-pressed={i===sel} onClick={()=>{setSel(i);audition(l);}}>
       <b>{l.label}</b><small>{drums?noteName(l.note):l.degrees.map(d=>d+1).join('·')}</small><em>{l.lane.fill}/{l.lane.steps}{l.lane.shift?' +'+l.lane.shift:''}</em></button>
     </div>)}
    </div>
    <div className="euclid-side">
     <Rings lanes={lanes} selected={sel}/>
     <div className="euclid-values" role="group" aria-label={cur.label+' settings'} style={{['--pad-accent' as string]:cur.color}}>
      <ValueBox label="Fill" value={cur.lane.fill} min={0} max={cur.lane.steps} step={1} coarse={4} onChange={n=>patch(sel,{fill:n,on:n>0})}/>
      <ValueBox label="Steps" value={cur.lane.steps} min={2} max={32} step={1} coarse={4} onChange={n=>patch(sel,{steps:n,fill:Math.min(cur.lane.fill,n),shift:cur.lane.shift%n})}/>
      <ValueBox label="Shift" value={cur.lane.shift} min={0} max={cur.lane.steps-1} step={1} coarse={4} onChange={n=>patch(sel,{shift:n})}/>
      <ValueBox label="Velocity" value={cur.lane.velocity} min={1} max={127} step={1} coarse={10} onChange={n=>patch(sel,{velocity:n})}/>
     </div>
    </div>
   </div>
   <footer>
    <small aria-live="polite">{done||(active.length?active.length+(active.length>1?' lanes · ':' lane · ')+count+' notes · '+(drums?'replaces only these pads in the pattern':'replaces every note in the pattern')+(genre?' · '+genre.name+' is usually '+genre.bpm[0]+'–'+genre.bpm[1]+' BPM':''):'Switch a lane on, or pick a genre')}</small>
    <button type="button" className="euclid-write" disabled={!active.length} onClick={write}>Write to pattern</button>
   </footer>
  </section></div>,document.querySelector('.harness-shell')??document.body);
}
