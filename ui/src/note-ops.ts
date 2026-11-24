import type {Note,StepPattern} from './types';
export type NoteBounds={span:number;snap:number;maxDuration:number};
export type NoteAction={kind:'move';time:number;pitch:number}|{kind:'length';delta:number}|{kind:'velocity';value:number}|{kind:'duplicate'|'delete'|'quantize'|'legato'};
export type NoteTarget={kind:'clip';track:number;clip:number;bars:number;device?:string}|{kind:'pattern';track:number;bank:number;slot:number;device?:string};
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
export const sameNotes=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
// Prefer a later head over an earlier tail on the same pitch.
export function noteIndexAt(events:Note[],time:number,pitch:number):number{
 let hit=-1;events.forEach((n,i)=>{if(n.note===pitch&&time>=n.start&&time<n.start+n.duration&&(hit<0||n.start>=events[hit].start))hit=i;});return hit;
}
export function notesInCell(events:Note[],time:number,pitch:number,snap:number,pageStart:number){
 return events.flatMap((note,index)=>note.note===pitch&&((note.start>=time&&note.start<time+snap)||(time===pageStart&&note.start<time&&note.start+note.duration>time))?[{note,index}]:[]);
}
export function patternEvents(p:StepPattern):Note[]{return p.steps.flatMap((step,start)=>step.map(n=>({start,note:n.note,duration:n.tie,velocity:n.velocity})));}
export function paintNotes(events:Note[],from:number,to:number,pitch:number,b:NoteBounds,erase=false,duration=b.snap):Note[]{
 const lo=Math.max(0,Math.min(from,to)),hi=Math.min(b.span-b.snap,Math.max(from,to));let out=events.map(n=>({...n}));
 for(let start=lo;start<=hi+b.snap*.01;start=Math.round((start+b.snap)*1e6)/1e6){
  if(erase)out=out.filter(n=>!(n.note===pitch&&start>=n.start&&start<n.start+n.duration));
  else if(!out.some(n=>n.start===start&&n.note===pitch))out.push({start,duration:Math.min(duration,b.span-start,b.maxDuration),note:pitch,velocity:100});
 }
 return out;
}
export function editNotes(events:Note[],selected:number[],action:NoteAction,b:NoteBounds):{events:Note[];selection:number[]}{
 const ids=selected.filter(i=>i>=0&&i<events.length),set=new Set(ids),out=events.map(n=>({...n}));if(!ids.length)return {events:out,selection:[]};
 if(action.kind==='delete')return {events:out.filter((_,i)=>!set.has(i)),selection:[]};
 if(action.kind==='duplicate'){
  const extent=Math.max(...ids.map(i=>out[i].start+out[i].duration))-Math.min(...ids.map(i=>out[i].start));
  for(let offset=Math.max(b.snap,Math.ceil(extent/b.snap)*b.snap);offset<b.span;offset+=b.snap){const next=copyDragNotes(events,ids,offset,0,b);if(next)return next;}
  return {events:out,selection:ids};
 }
 let time=0,pitch=0;
 if(action.kind==='move'){
  time=clamp(action.time,-Math.min(...ids.map(i=>out[i].start)),Math.max(0,b.span-b.snap-Math.max(...ids.map(i=>out[i].start))));
  pitch=clamp(action.pitch,-Math.min(...ids.map(i=>out[i].note)),127-Math.max(...ids.map(i=>out[i].note)));
 }
 for(const i of ids){const n=out[i];
  if(action.kind==='move'){n.start=Math.round((n.start+time)*1e6)/1e6;n.note+=pitch;}
  if(action.kind==='length')n.duration=clamp(Math.round((n.duration+action.delta)*1e6)/1e6,b.snap,b.maxDuration);
  if(action.kind==='velocity')n.velocity=clamp(Math.round(action.value),1,127);
  if(action.kind==='quantize')n.start=clamp(Math.round(n.start/b.snap)*b.snap,0,b.span-b.snap);
  if(action.kind==='legato'){
   // A chord shares the next musical onset: its voices lengthen together rather
   // than leaving one member behind.  The final event keeps its existing tail.
   const next=out.reduce<number|undefined>((at,other)=>other.start>n.start&&(at===undefined||other.start<at)?other.start:at,undefined);
   if(next!==undefined)n.duration=clamp(Math.round((next-n.start)*1e6)/1e6,b.snap,b.maxDuration);
  }
 }
 return {events:out,selection:ids};
}
export function expectedWithEvents(expected:Note[]|StepPattern,events:Note[]):Note[]|StepPattern{
 if(Array.isArray(expected))return events;
 const steps=Array.from({length:expected.length},()=>[] as StepPattern['steps'][number]);
 for(const n of events)steps[n.start]?.push({note:n.note,velocity:n.velocity,tie:n.duration});
 return {...expected,steps};
}

export type NoteClipboard={unitBeat:number;notes:Note[]};
export function stepBeats(p:Note[]|StepPattern):number{if(Array.isArray(p))return 1;const m=/^1\/(\d+)([TD]?)$/.exec(p.division);return m?4/Number(m[1])*(m[2]==='T'?2/3:m[2]==='D'?1.5:1):.25;}
export function clipboardNotes(events:Note[],ids:number[],unitBeat:number):NoteClipboard{
 const picked=ids.filter(i=>events[i]).map(i=>({...events[i]})),origin=Math.min(...picked.map(n=>n.start));
 return {unitBeat,notes:picked.map(n=>({...n,start:n.start-origin}))};
}
function inserted(events:Note[],copies:Note[],b:NoteBounds&{integer?:boolean}):{events:Note[];selection:number[]}|null{
 if(!copies.length)return null;
 for(let i=0;i<copies.length;i++){const n=copies[i];
  if(!Number.isFinite(n.start)||!Number.isFinite(n.duration)||n.start<0||n.start>=b.span||n.duration<=0||n.duration>b.maxDuration||!Number.isInteger(n.note)||n.note<0||n.note>127||!Number.isInteger(n.velocity)||n.velocity<1||n.velocity>127)return null;
  if(b.integer&&(!Number.isInteger(n.start)||!Number.isInteger(n.duration)))return null;
  if(events.some(old=>old.note===n.note&&n.start<old.start+old.duration-1e-7&&old.start<n.start+n.duration-1e-7))return null;
  if(copies.slice(0,i).some(old=>old.note===n.note&&Math.abs(old.start-n.start)<1e-7))return null;
 }
 const next=[...events.map(n=>({...n})),...copies];
 if(b.integer&&next.some(n=>next.filter(old=>old.start===n.start).length>8))return null;
 return {events:next,selection:copies.map((_,i)=>events.length+i)};
}
export function copyDragNotes(events:Note[],ids:number[],time:number,pitch:number,b:NoteBounds&{integer?:boolean}){
 if(!time&&!pitch)return null;return inserted(events,ids.filter(i=>events[i]).map(i=>({...events[i],start:Math.round((events[i].start+time)*1e6)/1e6,note:events[i].note+pitch})),b);
}
export function pasteNotes(events:Note[],payload:NoteClipboard,cursor:number,b:NoteBounds&{integer?:boolean},unitBeat:number){
 const ratio=payload.unitBeat/unitBeat,normalize=(v:number)=>b.integer&&Math.abs(v-Math.round(v))<1e-8?Math.round(v):v;return inserted(events,payload.notes.map(n=>({...n,start:normalize(cursor+n.start*ratio),duration:normalize(n.duration*ratio)})),b);
}
export function harmonyNotes(events:Note[],ids:number[],mode:'invert'|'spread'|'major'|'minor',b:NoteBounds){
 const sorted=ids.filter(i=>events[i]).sort((a,z)=>events[a].note-events[z].note);if(sorted.length<2||sorted.some(i=>events[i].start!==events[sorted[0]].start))return null;
 if((mode==='major'||mode==='minor')&&sorted.length!==3)return null;
 const out=events.map(n=>({...n})),root=out[sorted[0]].note;
 sorted.forEach((i,k)=>{if(mode==='invert'&&k===0)out[i].note+=12;if(mode==='spread'&&k%2)out[i].note+=12;if(mode==='major'||mode==='minor')out[i].note=root+[0,mode==='major'?4:3,7][k];});
 if(out.some((n,i)=>n.note>127||n.note<0||n.start>=b.span||out.some((a,j)=>i!==j&&a.start===n.start&&a.note===n.note)))return null;
 return {events:out,selection:ids};
}
export function dragDelta(sourceStart:number,fromCell:number,toCell:number,snap:number){return Math.round((toCell-fromCell+Math.round(sourceStart/snap)*snap-sourceStart)*1e6)/1e6;}
