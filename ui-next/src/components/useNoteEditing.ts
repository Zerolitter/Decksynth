import {useEffect,useId,useRef,useState} from 'react';
import {editNotes,expectedWithEvents,paintNotes,sameNotes,noteIndexAt,type NoteAction,type NoteBounds,type NoteTarget} from '../note-ops';
import type {Note,StepPattern} from '../types';
export type NoteTool='select'|'draw'|'erase'|'length'|'accent';
type Props={target:NoteTarget;expected:Note[]|StepPattern;events:Note[];bounds:NoteBounds;playing:boolean;recording:boolean;commit:(target:NoteTarget,expected:Note[]|StepPattern,events:Note[])=>void;audition:(track:number,id:string,note:number,velocity:number)=>void;undo:()=>void};
type Gesture={preview:Note[];hit:number;moved:boolean;id:number;kind:NoteTool|'move'|'resize'|'box';base:Note[];expected:Note[]|StepPattern;target:NoteTarget;selection:number[];time:number;pitch:number;note:number;locate:(x:number,y:number)=>{time:number;pitch:number}|null};
type Pending={before:string;after:string;events:Note[];expected:Note[]|StepPattern};
export function useNoteEditing(props:Props){
 const latest=useRef(props);latest.current=props;const id=useId(),counter=useRef(0),gesture=useRef<Gesture|null>(null),pending=useRef<Pending[]>([]),audition=useRef<{track:number;id:string;note:number}|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [tool,setTool]=useState<NoteTool>('draw'),[selection,setSelection]=useState<number[]>([]),[draft,setDraft]=useState<Note[]|null>(null);
 const identity=JSON.stringify(props.target),source=JSON.stringify(props.expected);
 const stop=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;const a=audition.current;if(a)latest.current.audition(a.track,a.id,a.note,0);audition.current=null;};
 const play=(note:number,velocity=100)=>{stop();const a={track:latest.current.target.track,id:'edit-'+id+'-'+(++counter.current),note};audition.current=a;latest.current.audition(a.track,a.id,note,velocity);};
 const cancel=()=>{gesture.current=null;stop();setDraft(pending.current.at(-1)?.events??null);};
 useEffect(()=>{cancel();pending.current=[];setDraft(null);setSelection([]);return stop;},[identity,props.playing,props.recording]); // source changes are reconciled below
 useEffect(()=>{const q=pending.current,i=q.findIndex(x=>x.after===source);
  if(i>=0){q.splice(0,i+1);if(!gesture.current)setDraft(q.at(-1)?.events??null);}
  else if(q.length&&q[0].before!==source){pending.current=[];cancel();setDraft(null);setSelection([]);}
  else if(gesture.current&&JSON.stringify(gesture.current.expected)!==source&&!q.some(x=>x.after===JSON.stringify(gesture.current?.expected))){cancel();setSelection([]);}
 },[source]);
 useEffect(()=>{const rejected=()=>{pending.current=[];gesture.current=null;stop();setDraft(null);setSelection([]);};window.addEventListener('decksynth-command-rejected',rejected);return()=>window.removeEventListener('decksynth-command-rejected',rejected);},[]);
 useEffect(()=>{const blur=()=>cancel();window.addEventListener('blur',blur);return()=>{window.removeEventListener('blur',blur);stop();};},[]);
 const current=()=>draft??pending.current.at(-1)?.events??latest.current.events;
 function commit(events:Note[],selected:number[],expected?:Note[]|StepPattern,target?:NoteTarget){
  const p=latest.current,base=pending.current.at(-1),before=expected??base?.expected??p.expected;let after=events;
  const picked=selected.map(i=>events[i]);if((target??p.target).kind==='pattern')after=[...events].sort((a,b)=>a.start-b.start);
  setSelection(picked.map(n=>after.indexOf(n)).filter(i=>i>=0));
  const next=expectedWithEvents(before,after);if(sameNotes(before,next)){setDraft(base?.events??null);return;}
  pending.current.push({before:JSON.stringify(before),after:JSON.stringify(next),events:after,expected:next});setDraft(after);p.commit(target??p.target,before,after);
 }
 function action(a:NoteAction){if(latest.current.recording)return;const out=editNotes(current(),selection,a,latest.current.bounds);commit(out.events,out.selection);}
 function tap(time:number,pitch:number){if(latest.current.recording)return;const base=current(),hit=noteIndexAt(base,time,pitch);
  if(tool==='erase'){if(hit>=0)commit(base.filter((_,i)=>i!==hit),[]);return;}
  if(hit>=0){setSelection([hit]);if(tool==='length')commit(base.map((n,i)=>i===hit?{...n,duration:n.duration>=latest.current.bounds.maxDuration?latest.current.bounds.snap:n.duration+latest.current.bounds.snap}:n),[hit]);if(tool==='accent')commit(base.map((n,i)=>i===hit?{...n,velocity:n.velocity>=120?100:127}:n),[hit]);}
  else if(tool==='draw'||tool==='accent'){const next=paintNotes(base,time,time,pitch,latest.current.bounds);commit(next,[next.length-1]);}
  play(pitch);timer.current=setTimeout(stop,100);
 }
 function begin(e:React.PointerEvent<HTMLElement>,time:number,pitch:number,locate:Gesture['locate']){
  if(e.button!==0||latest.current.recording)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);
  const r=e.currentTarget.getBoundingClientRect(),at=time+Math.max(0,Math.min(.999,(e.clientX-r.left)/r.width))*latest.current.bounds.snap;
  const base=current().map(n=>({...n})),hit=noteIndexAt(base,at,pitch),picked=hit<0?[]:e.shiftKey?(selection.includes(hit)?selection.filter(i=>i!==hit):[...selection,hit]):selection.includes(hit)?selection:[hit];
  setSelection(picked);if(e.shiftKey&&hit>=0)return;
  let kind:Gesture['kind']=tool;
  if(hit>=0&&(tool==='select'||tool==='draw')){const edge=r.left+(base[hit].start+base[hit].duration-time)/latest.current.bounds.snap*r.width;kind=Math.abs(e.clientX-edge)<=9?'resize':'move';}
  if(hit<0&&tool==='select')kind='box';
  const g:Gesture={preview:base,hit,moved:false,id:e.pointerId,kind,base,expected:pending.current.at(-1)?.expected??latest.current.expected,target:{...latest.current.target},selection:picked,time,pitch,note:pitch,locate};gesture.current=g;
  if(kind==='draw'||kind==='erase'){const next=paintNotes(base,time,time,pitch,latest.current.bounds,kind==='erase');g.preview=next;setDraft(next);g.selection=next.flatMap((n,i)=>n.note===pitch&&n.start===time?[i]:[]);setSelection(g.selection);}
  if(kind==='length'&&hit>=0){const next=base.map((n,i)=>i===hit?{...n,duration:n.duration>=latest.current.bounds.maxDuration?latest.current.bounds.snap:n.duration+latest.current.bounds.snap}:n);g.preview=next;setDraft(next);}
  if(kind==='accent'){const next=hit>=0?base.map((n,i)=>i===hit?{...n,velocity:n.velocity>=120?100:127}:n):paintNotes(base,time,time,pitch,latest.current.bounds).map(n=>n.note===pitch&&n.start===time?{...n,velocity:127}:n);g.preview=next;setDraft(next);}
  if(e.pointerType!=='touch'&&kind!=='box'&&kind!=='erase')play(pitch);
 }
 function move(e:React.PointerEvent<HTMLElement>){const g=gesture.current;if(!g||g.id!==e.pointerId)return;const point=g.locate(e.clientX,e.clientY);if(!point)return;
  if(point.time!==g.time||point.pitch!==g.pitch)g.moved=true;
  if(g.kind==='draw'||g.kind==='erase'){const next=paintNotes(g.base,g.time,point.time,g.pitch,latest.current.bounds,g.kind==='erase');g.preview=next;setDraft(next);g.selection=next.flatMap((n,i)=>n.note===g.pitch&&n.start>=Math.min(g.time,point.time)&&n.start<=Math.max(g.time,point.time)?[i]:[]);setSelection(g.selection);}
  if(g.kind==='move'||g.kind==='resize'){const a:NoteAction=g.kind==='move'?{kind:'move',time:point.time-g.time,pitch:point.pitch-g.pitch}:{kind:'length',delta:point.time-g.time};g.preview=g.kind==='resize'&&point.time===g.time?g.base:editNotes(g.base,g.selection,a,latest.current.bounds).events;setDraft(g.preview);}
  if(g.kind==='box'){g.selection=g.base.flatMap((n,i)=>n.start>=Math.min(g.time,point.time)&&n.start<=Math.max(g.time,point.time)&&n.note>=Math.min(g.pitch,point.pitch)&&n.note<=Math.max(g.pitch,point.pitch)?[i]:[]);setSelection(g.selection);}
 }
 function end(e:React.PointerEvent<HTMLElement>){const g=gesture.current;if(!g||g.id!==e.pointerId){stop();return;}gesture.current=null;
  if(g.kind!=='box')commit(g.preview,g.selection,g.expected,g.target);
  if(g.kind==='move'&&!g.moved&&g.hit>=0)setSelection([g.hit]);
  if(e.pointerType==='touch'&&g.kind!=='erase'&&g.kind!=='box'){play(g.note);timer.current=setTimeout(stop,100);}else stop();
  try{e.currentTarget.releasePointerCapture(e.pointerId);}catch{}
 }
 function key(e:React.KeyboardEvent<HTMLElement>){if((e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]'))return;
  const k=e.key.toLowerCase();let a:NoteAction|null=null;
  if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();e.stopPropagation();cancel();pending.current=[];setDraft(null);latest.current.undo();return;}
  if(k==='escape'){const active=!!gesture.current;cancel();setSelection([]);if(active){e.preventDefault();e.stopPropagation();}return;}
  if(!e.ctrlKey&&!e.metaKey&&['1','2','3'].includes(k)){e.preventDefault();e.stopPropagation();setTool(k==='1'?'select':k==='2'?'draw':'erase');return;}
  if((e.ctrlKey||e.metaKey)&&k==='d')a={kind:'duplicate'};
  else if(k==='delete'||k==='backspace')a={kind:'delete'};
  else if(k==='q')a={kind:'quantize'};
  else if(k.startsWith('arrow'))a=e.shiftKey?{kind:'length',delta:(k==='arrowleft'||k==='arrowdown'?-1:1)*latest.current.bounds.snap}:{kind:'move',time:k==='arrowleft'?-latest.current.bounds.snap:k==='arrowright'?latest.current.bounds.snap:0,pitch:k==='arrowup'?1:k==='arrowdown'?-1:0};
  if(a){e.preventDefault();e.stopPropagation();action(a);}
 }
 return {events:draft??pending.current.at(-1)?.events??props.events,selection,tool,setTool,begin,move,end,cancel,key,action,setSelection,play,stop,commit,tap};
}
