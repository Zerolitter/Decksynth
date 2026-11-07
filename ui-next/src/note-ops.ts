import type {Note,StepPattern} from './types';
export type NoteBounds={span:number;snap:number;maxDuration:number};
export type NoteAction={kind:'move';time:number;pitch:number}|{kind:'length';delta:number}|{kind:'velocity';value:number}|{kind:'duplicate'|'delete'|'quantize'};
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
export function paintNotes(events:Note[],from:number,to:number,pitch:number,b:NoteBounds,erase=false):Note[]{
 const lo=Math.max(0,Math.min(from,to)),hi=Math.min(b.span-b.snap,Math.max(from,to));let out=events.map(n=>({...n}));
 for(let start=lo;start<=hi+b.snap*.01;start=Math.round((start+b.snap)*1e6)/1e6){
  if(erase)out=out.filter(n=>!(n.note===pitch&&start>=n.start&&start<n.start+n.duration));
  else if(!out.some(n=>n.start===start&&n.note===pitch))out.push({start,duration:b.snap,note:pitch,velocity:100});
 }
 return out;
}
export function editNotes(events:Note[],selected:number[],action:NoteAction,b:NoteBounds):{events:Note[];selection:number[]}{
 const ids=selected.filter(i=>i>=0&&i<events.length),set=new Set(ids),out=events.map(n=>({...n}));if(!ids.length)return {events:out,selection:[]};
 if(action.kind==='delete')return {events:out.filter((_,i)=>!set.has(i)),selection:[]};
 if(action.kind==='duplicate'){
  for(let offset=b.snap;offset<b.span;offset+=b.snap){
   const copies=ids.map(i=>({...out[i],start:Math.round((out[i].start+offset)*1e6)/1e6}));
   if(copies.some(n=>n.start>=b.span))break;
   if(copies.some(n=>out.some(old=>old.start===n.start&&old.note===n.note)))continue;
   const first=out.length;out.push(...copies);return {events:out,selection:copies.map((_,i)=>first+i)};
  }
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
 }
 return {events:out,selection:ids};
}
export function expectedWithEvents(expected:Note[]|StepPattern,events:Note[]):Note[]|StepPattern{
 if(Array.isArray(expected))return events;
 const steps=Array.from({length:expected.length},()=>[] as StepPattern['steps'][number]);
 for(const n of events)steps[n.start]?.push({note:n.note,velocity:n.velocity,tie:n.duration});
 return {...expected,steps};
}
