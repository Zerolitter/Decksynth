import type {Note} from './types';
import {SCALES} from './chords.ts';

/** One Euclidean lane: `fill` pulses spread as evenly as possible over `steps` steps, turned forward by `shift`. */
export type EuclidLane={on:boolean;fill:number;steps:number;shift:number;velocity:number};

/** Which steps of one cycle sound. Pulses are as even as whole steps allow; shift 0 puts the first one on step 1. */
export function euclidCycle(fill:number,steps:number,shift=0):boolean[]{
 const n=Math.max(1,Math.round(steps)),k=Math.max(0,Math.min(n,Math.round(fill)));
 const out=Array<boolean>(n).fill(false);
 for(let i=0;i<n;i++)if((i*k)%n<k)out[(i+((Math.round(shift)%n)+n)%n)%n]=true;
 return out;
}

/** Step numbers (0-based) that sound across `length` pattern steps. The cycle repeats and is cut at the pattern end. */
export function euclidOnsets(lane:Pick<EuclidLane,'fill'|'steps'|'shift'>,length:number):number[]{
 const cycle=euclidCycle(lane.fill,lane.steps,lane.shift),out:number[]=[];
 for(let i=0;i<length;i++)if(cycle[i%cycle.length])out.push(i);
 return out;
}

/** Notes for a lane. `pitch(k)` gives the pitch of the k-th pulse, so a lane can walk through scale degrees. */
export function euclidNotes(lane:EuclidLane,length:number,pitch:(pulse:number)=>number):Note[]{
 return euclidOnsets(lane,length).map((start,k)=>({start,note:pitch(k),duration:1,velocity:Math.max(1,Math.min(127,Math.round(lane.velocity)))}));
}

/** A scale degree (0 = root, may be negative or past one octave) as a MIDI pitch above `root`. Chromatic reads as minor. */
export function degreePitch(root:number,scale:string,degree:number):number{
 const iv=scale==='Chromatic'||!SCALES[scale]?SCALES.Minor:SCALES[scale],oct=Math.floor(degree/iv.length),i=((degree%iv.length)+iv.length)%iv.length;
 return Math.max(0,Math.min(127,root+iv[i]+12*oct));
}

/** Writes lanes into a pattern: notes of `replace` pitches (or every note when null) are dropped first, then the lanes' notes are added. */
export function writeLanes(events:Note[],lanes:Note[][],replace:number[]|null):Note[]{
 const gone=replace?new Set(replace):null;
 return [...events.filter(n=>gone&&!gone.has(n.note)),...lanes.flat()].sort((a,b)=>a.start-b.start||a.note-b.note);
}
