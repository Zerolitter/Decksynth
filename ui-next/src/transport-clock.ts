import type {DeckUpdate,Project} from './types';
import {blockAt,clipsOf,phase,songOf} from './song.ts';

type ClockSample=Pick<DeckUpdate,'beat'|'song_beat'|'playing'> & {state:Pick<Project,'bars'|'bpm'|'song'>};
const mod=(beat:number,span:number)=>((beat%span)+span)%span;

/** One native sample and its receipt time form an epoch. Never compare its
 * wrapped phase with visual state from another render. Delayed/focus-return
 * frames may advance at most 220ms until the next authoritative sample. */
export function transportPosition(sample:ClockSample|null,receivedAt:number,now:number,maxAheadMs=220){
 if(!sample)return {absoluteBeat:0,clipBeat:0,songBeat:0};
 const elapsed=sample.playing?Math.max(0,Math.min(maxAheadMs,now-receivedAt)):0;
 const absoluteBeat=(sample.song_beat??sample.beat)+elapsed*sample.state.bpm/60000;
 const clipBeat=mod(absoluteBeat,Math.max(1,sample.state.bars)*4);
 const song=sample.state.song,span=Math.max(1,song?.length??16)*4;
 return {absoluteBeat,clipBeat,songBeat:song?.loop===false?Math.min(absoluteBeat,span):mod(absoluteBeat,span)};
}

/** The open edit target and the arrangement's sounding clip are independent.
 * A block offset is in bars; use the wrapped song position, not absolute time. */
export function clipPlayback(project:Project,track:number,songBeat:number,loopBeat:number,playing:boolean){
 const song=songOf(project),open=clipsOf(project).open[track];
 const bar=Math.floor(songBeat/4),block=song.on?blockAt(song,track,bar):undefined;
 const heard=song.on?block?.clip:open;
 const beat=block?phase(block,bar,project.bars)*4+songBeat%4:loopBeat;
 return {playing:playing&&heard===open,beat,heard,open};
}
