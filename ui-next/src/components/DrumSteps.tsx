import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Undo2,Volume2} from 'lucide-react';
import {useNoteEditing} from './useNoteEditing';
import type {NoteTarget} from '../note-ops';
import {noteName,type Note,type DrumPad} from '../types';

type Props={track:number;clip:number;bars:number;kitId:string;pad:DrumPad;notes:Note[];
 playing:boolean;beat:number;recording:boolean;
 onEdit:(target:NoteTarget,expected:Note[],notes:Note[])=>void;
 onEditorNote:(track:number,id:string,pitch:number,velocity:number)=>void;
 onUndo:()=>void};
type Intent={id:number;capture:HTMLButtonElement;owner:string;source:string;step:number;events:Note[];expected:Note[];target:Extract<NoteTarget,{kind:'clip'}>};

/** One bar of the selected pad's actual open SONG clip; transport remains native. */
export function DrumSteps({track,clip,bars,kitId,pad,notes,playing,beat,recording,onEdit,onEditorNote,onUndo}:Props){
 const [bar,setBar]=useState(0),intent=useRef<Intent|null>(null);
 const target:NoteTarget={kind:'clip',track,clip,bars,device:'drum_rack'};
 const edit=useNoteEditing({target,expected:notes,events:notes,bounds:{span:bars*4,snap:.25,maxDuration:bars*4},
  playing,recording,commit:(t,b,a)=>onEdit(t,b as Note[],a),audition:onEditorNote,undo:onUndo});
 const owner=JSON.stringify([track,clip,bars,kitId,pad.note,bar]),source=JSON.stringify(edit.events);
 const cancel=()=>{const g=intent.current;intent.current=null;if(g?.capture.hasPointerCapture(g.id))g.capture.releasePointerCapture(g.id);};
 useEffect(()=>{cancel();return cancel;},[owner,source,recording,playing]);
 useEffect(()=>{window.addEventListener('blur',cancel);window.addEventListener('decksynth-undo',cancel);return()=>{window.removeEventListener('blur',cancel);window.removeEventListener('decksynth-undo',cancel);};},[]);
 useEffect(()=>{cancel();setBar(0);},[track,clip]);
 useEffect(()=>{if(bar>=bars){cancel();setBar(bars-1);}},[bars,bar]);
 const changeBar=(next:number)=>{cancel();setBar(Math.max(0,Math.min(bars-1,next)));};
 const apply=(step:number,events=edit.events,expected=edit.expectedState() as Note[],at=target)=>{
  if(recording)return;
  const from=bar*4+step*.25,to=from+.25;
  const hit=(n:Note)=>n.note===pad.note&&n.start>=from-1e-8&&n.start<to-1e-8;
  const remove=events.some(hit);
  const next=remove?events.filter(n=>!hit(n)):[...events,{start:from,note:pad.note,duration:.25,velocity:100}];
  edit.commit(next,[],expected,at);
  if(!remove)edit.auditionPitch(pad.note);
 };
 const active=playing&&Math.floor(beat/4)===bar&&beat>=0;
 return <section className="drum-steps" aria-label="Drum steps" onKeyDown={e=>{
  if(e.key==='Escape'&&intent.current){e.preventDefault();e.stopPropagation();cancel();}
 }}>
  <div className="drum-step-head">
   <strong data-testid="drum-step-target" title={pad.name}>Track {track+1} · Clip {String.fromCharCode(65+clip)} · {noteName(pad.note)} · MIDI {pad.note}</strong>
   <div className="drum-bar-nav" role="group" aria-label="Drum step bar">
    <button type="button" aria-label="Previous drum bar" disabled={bar<=0} onClick={()=>changeBar(bar-1)}><ChevronLeft size={17}/></button>
    <span aria-live="polite">Bar {bar+1} / {bars}<small>1/16</small></span>
    <button type="button" aria-label="Next drum bar" disabled={bar>=bars-1} onClick={()=>changeBar(bar+1)}><ChevronRight size={17}/></button>
   </div>
   <button type="button" aria-label="Audition selected drum pad" title={'Play '+pad.name} onClick={()=>edit.auditionPitch(pad.note)}><Volume2 size={18}/></button>
   <button type="button" aria-label="Undo last edit" title="Undo last edit" disabled={recording} onClick={()=>{cancel();edit.undo();}}><Undo2 size={18}/></button>
  </div>
  <div className="drum-step-grid" role="group" aria-label={'Sixteen sixteenth steps for '+pad.name}>
   {Array.from({length:16},(_,step)=>{
    const from=bar*4+step*.25,hit=edit.events.some(n=>n.note===pad.note&&n.start>=from-1e-8&&n.start<from+.25-1e-8);
    return <button key={step} type="button" data-testid={'drum-step-'+(step+1)} aria-pressed={hit} disabled={recording}
     aria-label={(hit?'Remove':'Add')+' step '+(step+1)+' · '+noteName(pad.note)+' · bar '+(bar+1)} className={step%4===0?'beat':''}
     onPointerDown={e=>{
      if(e.button!==0||recording||intent.current)return;
      e.currentTarget.setPointerCapture(e.pointerId);
      intent.current={id:e.pointerId,capture:e.currentTarget,owner,source,step,events:edit.events.map(n=>({...n})),expected:edit.expectedState() as Note[],target:{...target}};
     }}
     onPointerUp={e=>{
      const g=intent.current;if(!g||g.id!==e.pointerId)return;
      const r=e.currentTarget.getBoundingClientRect(),inside=e.clientX>=r.left&&e.clientX<r.right&&e.clientY>=r.top&&e.clientY<r.bottom;
      cancel();if(e.button===0&&inside&&g.owner===owner&&g.source===source&&!recording)apply(g.step,g.events,g.expected,g.target);
     }} onPointerCancel={cancel} onLostPointerCapture={cancel}
     onClick={e=>{if(e.detail===0)apply(step);}} onContextMenu={e=>e.preventDefault()}>
     {step+1}{hit&&<i aria-hidden="true"/>}
    </button>;
   })}
   {active&&<span className="drum-step-playhead" style={{left:((beat%4)/4*100)+'%'}} aria-hidden="true"/>}
  </div>
 </section>;
}
