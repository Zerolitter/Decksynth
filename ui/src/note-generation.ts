import type {Note} from './types';
import {SCALES} from './chords.ts';
export type Generation={kind:'fill'|'chord';pitch:number;quality:string;voices:number;inversion:number;spread:'close'|'open';scale:string;key:number;subdivision:number;placement:'once'|'repeat';scope:'bar'|'selection'|'all';time:number;span:number;unitBeat:number;integer:boolean;maxDuration:number;velocity:number;beatsPerBar?:number;range?:[number,number]};
export const CHORD_QUALITIES:Record<string,{name:string;intervals:number[]}>={major:{name:'Major',intervals:[0,4,7]},minor:{name:'Minor',intervals:[0,3,7]},diminished:{name:'Diminished',intervals:[0,3,6]},augmented:{name:'Augmented',intervals:[0,4,8]},sus2:{name:'Sus 2',intervals:[0,2,7]},sus4:{name:'Sus 4',intervals:[0,5,7]},major7:{name:'Major 7',intervals:[0,4,7,11]},minor7:{name:'Minor 7',intervals:[0,3,7,10]},dominant7:{name:'Dominant 7',intervals:[0,4,7,10]},dim7:{name:'Diminished 7',intervals:[0,3,6,9]}};
export function generateNotes(events:Note[],selection:number[],c:Generation){
 if(![c.pitch,c.voices,c.inversion,c.velocity,c.key].every(Number.isInteger)||c.pitch<0||c.pitch>127||c.voices<1||c.voices>8||Math.abs(c.inversion)>7||c.velocity<1||c.velocity>127||c.key<0||c.key>11)throw Error('Voice, pitch or velocity outside MIDI range');
 if(![c.span,c.unitBeat,c.subdivision,c.maxDuration,c.time,c.beatsPerBar??4].every(Number.isFinite)||c.span<=0||c.unitBeat<=0||c.subdivision<=0||c.maxDuration<=0||(c.beatsPerBar??4)<=0)throw Error('Invalid musical range');
 const bar=(c.beatsPerBar??4)/c.unitBeat,chosen=selection.map(i=>events[i]).filter(Boolean);
 let from=c.scope==='bar'?Math.floor(c.time/bar)*bar:0,to=c.scope==='bar'?Math.min(c.span,from+bar):c.span;
 if(c.scope==='selection'){const range=c.range??(chosen.length?[Math.min(...chosen.map(n=>n.start)),Math.max(...chosen.map(n=>n.start+n.duration))]:null);if(!range)throw Error('Select a time range first');[from,to]=range;to=Math.min(c.span,to);}
 if(from<0||to<=from||to>c.span)throw Error('Invalid insertion range');
 const spacing=c.subdivision/c.unitBeat,whole=(v:number)=>Math.abs(v-Math.round(v))<1e-8;
 if(c.integer&&(!whole(spacing)||!whole(from)||!whole(to)))throw Error('This subdivision needs finer pattern steps; choose a compatible rate');
 let pitches=[c.pitch];
 if(c.kind==='chord'){
  const q=CHORD_QUALITIES[c.quality];if(!q)throw Error('Unknown chord quality');
  pitches=Array.from({length:c.voices},(_,i)=>c.pitch+q.intervals[i%q.intervals.length]+12*Math.floor(i/q.intervals.length));
  for(let i=0;i<Math.abs(c.inversion);i++){if(c.inversion>=0)pitches.push(pitches.shift()!+12);else pitches.unshift(pitches.pop()!-12);}
  if(c.spread==='open')pitches=pitches.map((n,i)=>n+(i%2?12:0));pitches.sort((a,b)=>a-b);
  if(pitches.some(n=>n<0||n>127)||new Set(pitches).size!==pitches.length)throw Error('Chord exceeds MIDI range; lower root, voices or spread');
  const scale=SCALES[c.scale];if(!scale)throw Error('Unknown scale');
  if(pitches.some(n=>!scale.includes((n-c.key+1200)%12)))throw Error('Chord quality is outside this scale; choose Chromatic or a compatible quality');
 }
 const out=events.map(n=>({...n})),added:number[]=[];
 const first=c.kind==='chord'&&c.placement==='once'?c.time:from;
 if(first<from||first>=to)throw Error('Cursor is outside the insertion scope');
 for(let start=first;start<to-1e-8;start+=spacing){const at=c.integer?Math.round(start):Math.round(start*1e9)/1e9,duration=Math.min(spacing,c.maxDuration,to-at);
  if(c.integer&&(!whole(at)||!whole(duration)))throw Error('Notes need whole pattern steps');
  for(const note of pitches){if(out.some(n=>n.note===note&&Math.abs(n.start-at)<1e-8))continue;
   if(out.some(n=>n.note===note&&at<n.start+n.duration-1e-8&&n.start<at+duration-1e-8))throw Error('Overlapping notes: adjust scope or pitch; existing notes are preserved');
   if(c.integer&&out.filter(n=>n.start===at).length>=8)throw Error('Maximum eight voices per pattern step');
   added.push(out.length);out.push({start:at,duration,note,velocity:c.velocity});
  }
  if(c.kind==='chord'&&c.placement==='once')break;
 }
 if(out.length>(c.integer?512:100000))throw Error('Too many notes in this range');
 return {events:out,selection:added,added:added.length,from,to,pitches};
}
