import {useEffect,useId,useRef,useState} from 'react';
import {dragDelta,clipboardNotes,copyDragNotes,pasteNotes,stepBeats,editNotes,expectedWithEvents,paintNotes,sameNotes,noteIndexAt,type NoteAction,type NoteBounds,type NoteTarget} from '../note-ops';
import type {Note,StepPattern} from '../types';
export type NoteTool='select'|'draw'|'erase'|'length'|'accent';
type Props={target:NoteTarget;expected:Note[]|StepPattern;events:Note[];bounds:NoteBounds;playing:boolean;recording:boolean;commit:(target:NoteTarget,expected:Note[]|StepPattern,events:Note[])=>void;audition:(track:number,id:string,note:number,velocity:number)=>void;undo:()=>void};
let clipboard:import('../note-ops').NoteClipboard|null=null;
export const noteClipboardAvailable=()=>!!clipboard?.notes.length;
type SelectionBox={from:number;to:number;low:number;high:number};
type Gesture={capture:HTMLElement;beforeSelection:number[];beforePitch:number|null;beforeRange:[number,number]|null;beforeCursor:number;visiblePitches:readonly number[];valid:boolean;output:number[];x:number;y:number;preview:Note[];hit:number;moved:boolean;id:number;kind:NoteTool|'move'|'copy'|'resize'|'box';base:Note[];expected:Note[]|StepPattern;target:NoteTarget;selection:number[];time:number;pitch:number;locate:(x:number,y:number)=>{time:number;pitch:number}|null};
type Pending={before:string;after:string;events:Note[];expected:Note[]|StepPattern};
export function useNoteEditing(props:Props){
 const latest=useRef(props);latest.current=props;const id=useId(),counter=useRef(0),gesture=useRef<Gesture|null>(null),pending=useRef<Pending[]>([]),audition=useRef<{track:number;id:string;note:number;pointer?:number}|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [range,setRange]=useState<[number,number]|null>(null);
 const [box,setBox]=useState<SelectionBox|null>(null),activePitch=useRef<number|null>(null);
 const [cursor,setCursor]=useState(0),[status,setStatus]=useState(''),[copyGhosts,setCopyGhosts]=useState<number[]>([]);
 const [tool,setTool]=useState<NoteTool>('draw'),[selection,setSelection]=useState<number[]>([]),[draft,setDraft]=useState<Note[]|null>(null);
 const identity=JSON.stringify(props.target),source=JSON.stringify(props.expected),observedSource=useRef(source);
 const stop=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;const a=audition.current;if(a)latest.current.audition(a.track,a.id,a.note,0);audition.current=null;};
 const play=(note:number,velocity=100,pointer?:number)=>{stop();const a={track:latest.current.target.track,id:'edit-'+id+'-'+(++counter.current),note,pointer};audition.current=a;latest.current.audition(a.track,a.id,note,velocity);};
 const scrub=(note:number|null,velocity:number,pointer:number)=>{
  const a=audition.current;
  if(note===null){if(a?.pointer===pointer)stop();return;}
  if(a?.pointer!==pointer||a.note!==note)play(note,velocity,pointer);
 };
 const auditionPitch=(pitch:number)=>{play(pitch);timer.current=setTimeout(stop,100);};
 const clearGesture=(g:Gesture)=>{
  gesture.current=null;
  setBox(null);
  setCopyGhosts([]);
  if(g.capture.hasPointerCapture(g.id))g.capture.releasePointerCapture(g.id);
 };
 const cancel=()=>{
  const g=gesture.current;
  if(g){
   clearGesture(g);
   setSelection(g.beforeSelection);
   activePitch.current=g.beforePitch;
   setRange(g.beforeRange);
   setCursor(g.beforeCursor);
  }
  setStatus('');
  stop();
  setDraft(pending.current.at(-1)?.events??null);
 };
 const cancelCapture=(el:HTMLElement,pointer?:number)=>{
  const g=gesture.current;
  if(g?.capture===el&&(pointer===undefined||g.id===pointer))cancel();
 };
 useEffect(()=>{cancel();pending.current=[];setDraft(null);setSelection([]);activePitch.current=null;setRange(null);setCursor(0);return stop;},[identity,props.playing,props.recording]); // source changes are reconciled below
 useEffect(()=>{const changed=observedSource.current!==source;observedSource.current=source;const q=pending.current,i=q.findIndex(x=>x.after===source);
  if(i>=0){q.splice(0,i+1);if(!gesture.current)setDraft(q.at(-1)?.events??null);}
  else if(q.length&&q[0].before!==source){pending.current=[];cancel();setDraft(null);setSelection([]);}
  else if(gesture.current&&JSON.stringify(gesture.current.expected)!==source&&!q.some(x=>x.after===JSON.stringify(gesture.current?.expected))){cancel();setSelection([]);}
  else if(changed&&!q.length){setSelection([]);setRange(null);}
 },[source]);
 useEffect(()=>{const rejected=()=>{pending.current=[];cancel();setSelection([]);};window.addEventListener('decksynth-command-rejected',rejected);window.addEventListener('decksynth-undo',rejected);return()=>{window.removeEventListener('decksynth-command-rejected',rejected);window.removeEventListener('decksynth-undo',rejected);};},[]);
 useEffect(()=>{const blur=()=>cancel(),up=(e:PointerEvent)=>{if(audition.current?.pointer===e.pointerId&&(e.type==='pointercancel'||e.pointerType!=='mouse'||e.button===0))stop();};window.addEventListener('blur',blur);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);return()=>{window.removeEventListener('blur',blur);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',up,true);stop();};},[]);
 const current=()=>gesture.current?.preview??pending.current.at(-1)?.events??latest.current.events;
 const editingBounds=()=>({...latest.current.bounds,integer:latest.current.target.kind==='pattern'});
 function copy(ids=selection,events=current()){if(!ids.some(i=>events[i]))return;clipboard=clipboardNotes(events,ids,stepBeats(pending.current.at(-1)?.expected??latest.current.expected));setStatus('Copied '+clipboard.notes.length+' notes');}
 function paste(time=cursor,expected?:Note[]|StepPattern,target?:NoteTarget,events=current()){if(!clipboard?.notes.length)return;const p=latest.current,out=pasteNotes(events,clipboard,time,{...p.bounds,integer:(target??p.target).kind==='pattern'},stepBeats(expected??pending.current.at(-1)?.expected??p.expected));if(!out){setStatus('Paste rejected: incompatible timing, overlap or range');return;}commit(out.events,out.selection,expected,target);setStatus('Pasted '+out.selection.length+' notes at '+time);}
 function selectAll(){setSelection(current().map((_,i)=>i));}
 function undo(){cancel();pending.current=[];setDraft(null);latest.current.undo();}
 function selectRow(pitch?:number){
  const events=current();
  const active=selection.find(i=>events[i]?.note===activePitch.current)??selection.at(-1);
  const row=pitch??(active===undefined?undefined:events[active]?.note);
  if(row===undefined){setStatus('Select a note to select its pitch row');return;}
  activePitch.current=row;
  setSelection(events.flatMap((n,i)=>n.note===row?[i]:[]));
 }

 function commit(events:Note[],selected:number[],expected?:Note[]|StepPattern,target?:NoteTarget){
  const p=latest.current,base=pending.current.at(-1),before=expected??base?.expected??p.expected;let after=events;
  const picked=selected.map(i=>events[i]);if((target??p.target).kind==='pattern')after=[...events].sort((a,b)=>a.start-b.start);
  setSelection(picked.map(n=>after.indexOf(n)).filter(i=>i>=0));
  const next=expectedWithEvents(before,after);if(sameNotes(before,next)){setDraft(base?.events??null);return;}
  pending.current.push({before:JSON.stringify(before),after:JSON.stringify(next),events:after,expected:next});setDraft(after);p.commit(target??p.target,before,after);
 }
 function action(a:NoteAction){if(latest.current.recording||gesture.current)return;const out=editNotes(current(),selection,a,latest.current.bounds);commit(out.events,out.selection);}
 function tap(time:number,pitch:number){if(latest.current.recording)return;const base=current(),hit=noteIndexAt(base,time,pitch);
  if(tool==='erase'){if(hit>=0)commit(base.filter((_,i)=>i!==hit),[]);return;}
  if(hit>=0){activePitch.current=pitch;setSelection([hit]);if(tool==='length')commit(base.map((n,i)=>i===hit?{...n,duration:n.duration>=latest.current.bounds.maxDuration?latest.current.bounds.snap:n.duration+latest.current.bounds.snap}:n),[hit]);if(tool==='accent')commit(base.map((n,i)=>i===hit?{...n,velocity:n.velocity>=120?100:127}:n),[hit]);}
  else if(tool==='draw'||tool==='accent'){const next=paintNotes(base,time,time,pitch,latest.current.bounds);commit(next,[next.length-1]);}
  auditionPitch(pitch);
 }
 function begin(e:React.PointerEvent<HTMLElement>,time:number,pitch:number,locate:Gesture['locate'],capture:HTMLElement,visiblePitches:readonly number[]){
  if(e.button!==0||latest.current.recording||gesture.current)return;
  e.preventDefault();
  e.stopPropagation();
  capture.focus({preventScroll:true});
  const r=e.currentTarget.getBoundingClientRect(),at=time+Math.max(0,Math.min(.999,(e.clientX-r.left)/r.width))*latest.current.bounds.snap;
  const base=current().map(n=>({...n})),hit=noteIndexAt(base,at,pitch),modified=e.ctrlKey||e.metaKey;
  const picked=hit<0?[]:e.shiftKey?(selection.includes(hit)?selection.filter(i=>i!==hit):[...selection,hit]):selection.includes(hit)?selection:[hit];
  const beforePitch=activePitch.current;
  if(hit>=0)activePitch.current=pitch;
  setCursor(time);
  setRange(null);
  setSelection(picked);
  if(e.shiftKey&&hit>=0)return;
  let kind:Gesture['kind']=tool;
  if(hit>=0&&modified)kind='copy';
  else if(hit>=0&&(tool==='select'||tool==='draw')){
   const edge=r.left+(base[hit].start+base[hit].duration-time)/latest.current.bounds.snap*r.width;
   kind=Math.abs(e.clientX-edge)<=9?'resize':'move';
  }else if(hit<0&&(tool==='select'||modified))kind='box';
  capture.setPointerCapture(e.pointerId);
  const g:Gesture={capture,beforeSelection:selection,beforePitch,beforeRange:range,beforeCursor:cursor,visiblePitches,
   valid:true,output:picked,x:e.clientX,y:e.clientY,preview:base,hit,moved:false,id:e.pointerId,kind,base,
   expected:pending.current.at(-1)?.expected??latest.current.expected,target:{...latest.current.target},
   selection:picked,time,pitch,locate};
  gesture.current=g;
  if(kind==='draw'||kind==='erase'){const next=paintNotes(base,time,time,pitch,latest.current.bounds,kind==='erase');g.preview=next;setDraft(next);g.selection=next.flatMap((n,i)=>n.note===pitch&&n.start===time?[i]:[]);setSelection(g.selection);}
  if(kind==='length'&&hit>=0){const next=base.map((n,i)=>i===hit?{...n,duration:n.duration>=latest.current.bounds.maxDuration?latest.current.bounds.snap:n.duration+latest.current.bounds.snap}:n);g.preview=next;setDraft(next);}
  if(kind==='accent'){const next=hit>=0?base.map((n,i)=>i===hit?{...n,velocity:n.velocity>=120?100:127}:n):paintNotes(base,time,time,pitch,latest.current.bounds).map(n=>n.note===pitch&&n.start===time?{...n,velocity:127}:n);g.preview=next;setDraft(next);}
  if(kind!=='box'&&kind!=='erase')scrub(pitch,base[hit]?.velocity??100,e.pointerId);
 }
 function move(e:React.PointerEvent<HTMLElement>){
  const g=gesture.current;
  if(!g||g.id!==e.pointerId||g.capture!==e.currentTarget)return;
  const point=g.locate(e.clientX,e.clientY);
  if(!point){
   if(g.kind==='copy'){g.valid=false;g.preview=g.base;setCopyGhosts([]);setDraft(g.base);}
   scrub(null,100,e.pointerId);
   return;
  }
  if(Math.hypot(e.clientX-g.x,e.clientY-g.y)>=4&&(point.time!==g.time||point.pitch!==g.pitch))g.moved=true;
  if(g.kind==='copy'){const out=g.moved?copyDragNotes(g.base,g.selection,dragDelta(g.base[g.hit].start,g.time,point.time,latest.current.bounds.snap),point.pitch-g.pitch,editingBounds()):null;g.valid=!!out;g.preview=out?.events??g.base;g.output=out?.selection??g.selection;setCopyGhosts(out?.selection??[]);setDraft(g.preview);setStatus(out?'Copy preview · release to insert':g.moved?'Invalid copy destination':'Ctrl-drag to copy');}
  if(g.kind==='draw'||g.kind==='erase'){const next=paintNotes(g.base,g.time,point.time,g.pitch,latest.current.bounds,g.kind==='erase');g.preview=next;setDraft(next);g.selection=next.flatMap((n,i)=>n.note===g.pitch&&n.start>=Math.min(g.time,point.time)&&n.start<=Math.max(g.time,point.time)?[i]:[]);setSelection(g.selection);}
  if(g.kind==='move'||g.kind==='resize'){const a:NoteAction=g.kind==='move'?{kind:'move',time:point.time-g.time,pitch:point.pitch-g.pitch}:{kind:'length',delta:point.time-g.time};g.preview=g.kind==='resize'&&point.time===g.time?g.base:editNotes(g.base,g.selection,a,latest.current.bounds).events;setDraft(g.preview);}
  if(g.kind==='move'||g.kind==='copy'){
   const note=g.kind==='move'?g.preview[g.hit]:g.valid?g.preview[g.output[g.selection.indexOf(g.hit)]]:null;
   scrub(note?.note??null,note?.velocity??100,e.pointerId);
  }
  if(g.kind==='box'&&g.moved){
   const from=Math.min(g.time,point.time),to=Math.max(g.time,point.time)+latest.current.bounds.snap;
   const low=Math.min(g.pitch,point.pitch),high=Math.max(g.pitch,point.pitch);
   setRange([from,to]);
   setBox({from,to,low,high});
   g.selection=g.base.flatMap((n,i)=>n.start<to&&n.start+n.duration>from&&n.note>=low&&n.note<=high
    &&g.visiblePitches.includes(n.note)?[i]:[]);
   setSelection(g.selection);
  }
 }
 function end(e:React.PointerEvent<HTMLElement>){
  const g=gesture.current;
  if(!g||g.id!==e.pointerId||g.capture!==e.currentTarget)return;
  clearGesture(g);
  if(g.kind==='move'&&g.preview[g.hit])activePitch.current=g.preview[g.hit].note;
  if(g.kind==='copy'&&g.valid&&g.moved)activePitch.current=g.preview[g.output[g.selection.indexOf(g.hit)]]?.note??null;
  if(g.kind==='copy'){if(g.moved&&g.valid&&g.locate(e.clientX,e.clientY)){commit(g.preview,g.output,g.expected,g.target);setStatus('Copied '+g.output.length+' notes');}else{setDraft(pending.current.at(-1)?.events??null);setSelection(g.selection);}}
  else if(g.kind!=='box')commit(g.preview,g.selection,g.expected,g.target);
  if(g.kind==='move'&&!g.moved&&g.hit>=0)setSelection([g.hit]);
  scrub(null,100,e.pointerId);
 }
 function key(e:React.KeyboardEvent<HTMLElement>){
  if((e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true],[data-shortcut-reference]'))return;
  const k=e.key.toLowerCase(),ctrl=e.ctrlKey||e.metaKey;let a:NoteAction|null=null;if(gesture.current&&k==='f10'){e.preventDefault();e.stopPropagation();return;}
  if(k==='escape'){const active=!!gesture.current;cancel();if(active){e.preventDefault();e.stopPropagation();}else setSelection([]);return;}
  const recognized=ctrl?['a','c','v','x','d','z','arrowup','arrowdown'].includes(k):['1','2','3','q','delete','backspace','arrowleft','arrowright','arrowup','arrowdown'].includes(k);
  if(!recognized||e.altKey)return;if(gesture.current){e.preventDefault();e.stopPropagation();return;}
  e.preventDefault();e.stopPropagation();
  if(ctrl&&k==='z'){if(e.shiftKey){setStatus('Redo is not supported by the canonical engine');return;}undo();return;}
  if(latest.current.recording)return;
  if(ctrl&&k==='a'){if(e.shiftKey)selectRow();else selectAll();return;}
  if(ctrl&&k==='c'){copy();return;}
  if(ctrl&&k==='v'){paste();return;}
  if(ctrl&&k==='x'){copy();action({kind:'delete'});return;}
  if(ctrl&&k==='d')a={kind:'duplicate'};
  else if(!ctrl&&['1','2','3'].includes(k)){setTool(k==='1'?'select':k==='2'?'draw':'erase');return;}
  else if(k==='delete'||k==='backspace')a={kind:'delete'};
  else if(k==='q')a={kind:'quantize'};
  else if(k.startsWith('arrow'))a=ctrl?{kind:'move',time:0,pitch:k==='arrowup'?12:-12}:e.shiftKey?{kind:'length',delta:(k==='arrowleft'||k==='arrowdown'?-1:1)*latest.current.bounds.snap}:{kind:'move',time:k==='arrowleft'?-latest.current.bounds.snap:k==='arrowright'?latest.current.bounds.snap:0,pitch:k==='arrowup'?1:k==='arrowdown'?-1:0};
  if(a)action(a);
 }
 return {range,box,events:draft??pending.current.at(-1)?.events??props.events,selection,tool,setTool,begin,move,end,cancel,cancelCapture,key,action,setSelection,play,stop,scrub,auditionPitch,commit,tap,cursor,setCursor,status,copyGhosts,copy,paste,selectAll,selectRow,undo,active:()=>!!gesture.current,expectedState:()=>pending.current.at(-1)?.expected??latest.current.expected};
}
