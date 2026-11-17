import type {StepPattern} from './types';

/** The Structure is the seq chain shown as parts: a slot address with how many times it plays in a row. */
export type StructurePart={key:string;repeats:number};
export const MAX_PLAYS=64;

export function structureParts(chain:readonly string[]):StructurePart[]{
  const out:StructurePart[]=[];
  for(const key of chain){const last=out[out.length-1];if(last&&last.key===key&&last.repeats<16)last.repeats++;else out.push({key,repeats:1});}
  return out;
}
export const flattenParts=(parts:readonly StructurePart[])=>parts.flatMap(p=>Array(p.repeats).fill(p.key) as string[]).slice(0,MAX_PLAYS);

const RATE:Record<string,number>={'1/2D':3,'1/2':2,'1/2T':4/3,'1/4D':1.5,'1/4':1,'1/4T':2/3,'1/8D':.75,'1/8':.5,'1/8T':1/3,'1/16D':.375,'1/16':.25,'1/16T':1/6,'1/32D':.1875,'1/32':.125,'1/32T':1/12};
export const rateBeats=(division:string)=>RATE[division]??.25;

/** Where the engine is in the chain at an unwrapped beat (keystep.schedule_notes does the same sum). */
export function chainPosition(beat:number,chain:readonly string[],patterns:Record<string,StepPattern>,fallback:{length:number;division:string}){
  const sizes=chain.map(k=>patterns[k]?.length??fallback.length);
  const total=sizes.reduce((a,b)=>a+b,0);
  if(!total||!Number.isFinite(beat))return null;
  const division=patterns[chain[0]]?.division??fallback.division;
  let offset=((Math.floor(beat/rateBeats(division)+1e-6)%total)+total)%total,play=0;
  while(offset>=sizes[play]){offset-=sizes[play];play++;}
  // which part (run of repeats) and which repeat of it
  let part=-1,repeat=0;
  for(let i=0;i<=play;i++){if(i===0||chain[i]!==chain[i-1]){part++;repeat=0;}else repeat++;}
  return {play,part,repeat,key:chain[play],step:offset,length:sizes[play]};
}

/** Bars a structure lasts, at 16 steps a bar. */
export function structureBars(chain:readonly string[],patterns:Record<string,StepPattern>,fallback:{length:number;division:string}){
  const beats=chain.reduce((n,k)=>{const p=patterns[k];return n+(p?.length??fallback.length)*rateBeats(p?.division??fallback.division);},0);
  return beats/4;
}
