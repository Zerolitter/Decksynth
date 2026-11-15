import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Power,Undo2,Volume2} from 'lucide-react';
import {useNoteEditing} from './useNoteEditing';
import {patternEvents,type NoteTarget} from '../note-ops';
import {noteName,type Note,type DrumPad,type PerformanceState,type StepPattern} from '../types';

const RATE_BEATS:Record<string,number>={'1/2D':3,'1/2':2,'1/2T':4/3,'1/4D':1.5,'1/4':1,'1/4T':2/3,'1/8D':.75,'1/8':.5,'1/8T':1/3,'1/16D':.375,'1/16':.25,'1/16T':1/6,'1/32D':.1875,'1/32':.125,'1/32T':1/12};

type Props={track:number;kitId:string;pad:DrumPad;seq:PerformanceState['seq'];patterns:Record<string,StepPattern>;
 playing:boolean;beat:number;recording:boolean;recStep:number;
 onEdit:(target:NoteTarget,expected:StepPattern,notes:Note[])=>void;
 onEditorNote:(track:number,id:string,pitch:number,velocity:number)=>void;
 onSeq:(key:string,value:unknown)=>void;
 onUndo:()=>void};
type Intent={id:number;capture:HTMLButtonElement;owner:string;source:string;step:number;events:Note[];expected:StepPattern;target:Extract<NoteTarget,{kind:'pattern'}>};

/** The selected pad's row of the open SEQ pattern: the same pattern Perform edits and SEQ plays. */
export function DrumSteps({track,kitId,pad,seq,patterns,playing,beat,recording,recStep,onEdit,onEditorNote,onSeq,onUndo}:Props){
 const pat:StepPattern=patterns[seq.bank+':'+seq.slot]??{length:seq.length,division:seq.division,gate:.8,swing:.5,steps:Array.from({length:seq.length},()=>[])};
 const pages=Math.max(1,Math.ceil(pat.length/16));
 const [page,setPage]=useState(0),intent=useRef<Intent|null>(null);
 const target:NoteTarget={kind:'pattern',track,bank:seq.bank,slot:seq.slot,device:'drum_rack'};
 const edit=useNoteEditing({target,expected:pat,events:patternEvents(pat),bounds:{span:pat.length,snap:1,maxDuration:Math.min(32,pat.length)},
  playing,recording,commit:(t,b,a)=>onEdit(t,b as StepPattern,a),audition:onEditorNote,undo:onUndo});
 const owner=JSON.stringify([track,seq.bank,seq.slot,pat.length,kitId,pad.note,page]),source=JSON.stringify(edit.events);
 const cancel=()=>{const g=intent.current;intent.current=null;if(g?.capture.hasPointerCapture(g.id))g.capture.releasePointerCapture(g.id);};
 useEffect(()=>{cancel();return cancel;},[owner,source,recording,playing]);
 useEffect(()=>{window.addEventListener('blur',cancel);window.addEventListener('decksynth-undo',cancel);return()=>{window.removeEventListener('blur',cancel);window.removeEventListener('decksynth-undo',cancel);};},[]);
 useEffect(()=>{if(page>=pages){cancel();setPage(pages-1);}},[pages,page]);
 const current=playing&&seq.enabled?Math.floor(beat/(RATE_BEATS[pat.division]??.25))%pat.length:-1;
 const cursor=seq.recording?recStep%pat.length:-1;
 // Follow the playhead (or the step-rec cursor) across pages, like the Perform grid.
 const follow=cursor>=0?cursor:current;
 useEffect(()=>{if(follow>=0&&!intent.current)setPage(Math.floor(follow/16));},[Math.floor(Math.max(0,follow)/16),follow>=0]);
 const changePage=(next:number)=>{cancel();setPage(Math.max(0,Math.min(pages-1,next)));};
 const apply=(step:number,events=edit.events,expected=edit.expectedState() as StepPattern,at=target)=>{
  if(recording)return;
  const hit=(n:Note)=>n.note===pad.note&&n.start===step;
  const remove=events.some(hit);
  const next=remove?events.filter(n=>!hit(n)):[...events,{start:step,note:pad.note,duration:1,velocity:100}];
  edit.commit(next,[],expected,at);
  if(!remove)edit.auditionPitch(pad.note);
 };
 const count=Math.min(16,pat.length-page*16);
 return <section className="drum-steps" aria-label="Drum steps" onKeyDown={e=>{
  if(e.key==='Escape'&&intent.current){e.preventDefault();e.stopPropagation();cancel();}
 }}>
  <div className="drum-step-head">
   <button type="button" className="drum-seq-power" aria-pressed={seq.enabled} title={seq.enabled?'SEQ is playing this pattern':'SEQ is off: turn it on to hear the pattern'} onClick={()=>onSeq('enabled',!seq.enabled)}><Power size={16}/>SEQ</button>
   <strong data-testid="drum-step-target" title={'Pattern '+seq.bank+':'+seq.slot+', the same pattern as Perform · '+pad.name}>{seq.bank}:{seq.slot} · {noteName(pad.note)}</strong>
   <div className="drum-bar-nav" role="group" aria-label="Drum step page">
    <button type="button" aria-label="Previous step page" disabled={page<=0} onClick={()=>changePage(page-1)}><ChevronLeft size={17}/></button>
    <span aria-live="polite">{page*16+1}–{page*16+count}<small>of {pat.length} · {pat.division}</small></span>
    <button type="button" aria-label="Next step page" disabled={page>=pages-1} onClick={()=>changePage(page+1)}><ChevronRight size={17}/></button>
   </div>
   <button type="button" aria-label="Audition selected drum pad" title={'Play '+pad.name} onClick={()=>edit.auditionPitch(pad.note)}><Volume2 size={18}/></button>
   <button type="button" aria-label="Undo last edit" title="Undo last edit" disabled={recording} onClick={()=>{cancel();edit.undo();}}><Undo2 size={18}/></button>
  </div>
  <div className="drum-step-grid" role="group" aria-label={'Steps of pattern '+seq.bank+':'+seq.slot+' for '+pad.name}>
   {Array.from({length:16},(_,i)=>{
    const step=page*16+i;
    if(i>=count)return <span key={i} className="drum-step-blank" aria-hidden="true"/>;
    const hit=edit.events.some(n=>n.note===pad.note&&n.start===step);
    return <button key={i} type="button" data-testid={'drum-step-'+(i+1)} aria-pressed={hit} disabled={recording}
     aria-label={(hit?'Remove':'Add')+' step '+(step+1)+' · '+noteName(pad.note)} className={(i%4===0?'beat':'')+(step===current?' is-now':'')+(step===cursor?' is-cursor':'')}
     onPointerDown={e=>{
      if(e.button!==0||recording||intent.current)return;
      e.currentTarget.setPointerCapture(e.pointerId);
      intent.current={id:e.pointerId,capture:e.currentTarget,owner,source,step,events:edit.events.map(n=>({...n})),expected:edit.expectedState() as StepPattern,target:{...target} as Extract<NoteTarget,{kind:'pattern'}>};
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
  </div>
 </section>;
}
