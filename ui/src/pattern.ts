import type { Note, Project } from './types';

/** Translate the actual saved MIDI notes into a compact 16-cell performance overview.
 * This is a visualization of the MIDI loops, not an independent hidden drum sequencer. */
export function patternCells(notes: readonly Note[], bars: number, steps = 16) {
  const safeBars = Number.isFinite(bars) ? Math.max(1,bars) : 4;
  const beatWindow = safeBars * 4 / steps;
  return Array.from({length:steps},(_,i) => {
    const start=i*beatWindow,end=start+beatWindow;
    const on = notes.filter(n => n.start >= start && n.start < end).length;
    const held = notes.some(n => {
      const noteEnd=n.start+n.duration;
      return n.start < end && noteEnd > start ||
             noteEnd > safeBars*4 && (noteEnd-safeBars*4) > start;
    });
    return {on,held};
  });
}

export function activeStep(beat:number,bars:number,steps=16) {
  const safeBars=Math.max(1,bars);
  if(!Number.isFinite(beat))return 0;
  const total=safeBars*4;
  const position=((beat%total)+total)%total;
  return Math.min(steps-1,Math.max(0,Math.floor(position/total*steps)));
}

export function interpolateBeat(
  sampleBeat:number,
  sampleTimeMs:number,
  nowMs:number,
  bpm:number,
  bars:number,
  playing:boolean,
  maxAheadMs=220
) {
  const total=Math.max(1,bars)*4;
  if(!playing)return ((sampleBeat%total)+total)%total;
  const dt=Math.min(Math.max(0,nowMs-sampleTimeMs),maxAheadMs);
  return ((sampleBeat+dt*bpm/60000)%total+total)%total;
}

export function meterIntensity(peak:number) {
  return Math.min(1,Math.max(0,Math.sqrt(Math.max(0,peak))*1.35));
}

export function totalNotes(project:Project) {
  return project.tracks.reduce((v,t)=>v+t.notes.length,0);
}
