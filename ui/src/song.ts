/* Song timeline in the UI (mirrors decksynth/song.py): clips A–H per track, and a song of bars with four
   lanes of clip blocks and named markers. In song bar b a block plays clip bar (off + b − at) mod clip bars. */
import type { Note, Project } from './types';

export type Block = { at:number; len:number; clip:number; off?:number };
export type Marker = { bar:number; name:string };
export type Song = { on:boolean; loop:boolean; length:number; markers:Marker[]; lanes:Block[][] };

export const CLIPS = 8;
export const CLIP_NAMES = 'ABCDEFGH';
export const MAX_BARS = 256;
export const MAX_MARKERS = 32;
export const MARKER_NAMES = ['Intro','Verse','Build','Drop','Break','Chorus','Bridge','Outro'];

export const defaultSong = (bars = 4):Song => {
  const length = Math.max(16, bars * 4);
  return {on:false, loop:true, length, markers:[{bar:0, name:'Intro'}], lanes:[0, 1, 2, 3].map(() => [{at:0, len:length, clip:0, off:0}])};
};
/** A project's song; one saved before the timeline (sections) shows as the default until the engine converts it. */
export const songOf = (p:Project):Song => p.song && Array.isArray((p.song as Song).lanes) ? p.song : defaultSong(p.bars);
export const clipsOf = (p:Project) => p.clips ?? {open:p.tracks.map(()=>0), slots:p.tracks.map(t=>[t.notes, ...Array.from({length:CLIPS-1}, ()=>[] as Note[])])};

/** A track's clip by slot (the open clip is the track's own notes). */
export function clipNotes(p:Project, track:number, clip:number):Note[] {
  const c = clipsOf(p);
  return clip===c.open[track] ? p.tracks[track].notes : c.slots[track]?.[clip] ?? [];
}
export const emptyClip = (p:Project, track:number) => Array.from({length:CLIPS}, (_, k) => k).find(k => !clipNotes(p, track, k).length);

const mod = (a:number, n:number) => ((a % n) + n) % n;
/** The clip bar a block plays in a timeline bar. */
export const phase = (b:Block, bar:number, bars:number) => mod((b.off ?? 0) + bar - b.at, bars);

/** Sorted and clipped to the song with no overlaps: a later block wins, and cuts the one under it in two. */
export function merge(blocks:Block[], length:number, bars:number):Block[] {
  const cells:([number, number, number] | null)[] = Array.from({length}, () => null);
  blocks.forEach((b, i) => { for (let bar = Math.max(0, b.at); bar < Math.min(length, b.at + b.len); bar++) cells[bar] = [i, b.clip, phase(b, bar, bars)]; });
  const out:Block[] = []; let owner = -1;
  cells.forEach((cell, bar) => {
    if (!cell) { owner = -1; return; }
    const [i, k, ph] = cell, last = out[out.length - 1];
    if (last && owner===i && last.at + last.len===bar) last.len++;
    else out.push({at:bar, len:1, clip:k, off:ph});
    owner = i;
  });
  return out;
}
const tidy = (s:Song, bars:number):Song => ({...s, lanes:s.lanes.map(l => merge(l, s.length, bars)),
  markers:s.markers.filter(m => m.bar < s.length).sort((a, b) => a.bar - b.bar)});

export const blockAt = (s:Song, track:number, bar:number) => s.lanes[track]?.find(b => b.at <= bar && bar < b.at + b.len);
export const markerAt = (s:Song, bar:number) => { let found = -1; s.markers.forEach((m, i) => { if (m.bar <= bar) found = i; }); return found; };
/** First bar after `bar` that holds a block on this lane (or the end of the song area). */
const nextBlock = (s:Song, track:number, bar:number) => Math.min(MAX_BARS, ...s.lanes[track].filter(b => b.at > bar).map(b => b.at));

const grow = (s:Song, end:number):Song => ({...s, length:Math.min(MAX_BARS, Math.max(s.length, end))});
const setLane = (s:Song, track:number, lane:Block[], bars:number) => tidy({...s, lanes:s.lanes.map((l, t) => t===track ? lane : l)}, bars);

/** Song edits: each returns a new, tidy song. */
export function place(s:Song, track:number, bar:number, clip:number, bars:number):Song {
  // One clip length, in line with the clip's bar grid, stopping at the next block.
  const len = Math.max(1, Math.min(bars - mod(bar, bars), nextBlock(s, track, bar) - bar));
  const g = grow(s, bar + len);
  return setLane(g, track, [...g.lanes[track], {at:bar, len, clip, off:mod(bar, bars)}], bars);
}
export function changeBlock(s:Song, track:number, at:number, patch:Partial<Block>, bars:number):Song {
  const b = s.lanes[track].find(x => x.at===at); if (!b) return s;
  const next = {...b, ...patch}; next.len = Math.max(1, Math.min(MAX_BARS - next.at, next.len)); next.off = mod(next.off ?? 0, bars);
  const g = grow(s, next.at + next.len);
  // Growing a block covers what follows it; a later block wins in merge, so put this one last.
  return setLane(g, track, [...g.lanes[track].filter(x => x!==b), next], bars);
}
export function moveBlock(s:Song, track:number, at:number, to:number, bars:number):Song {
  const b = s.lanes[track].find(x => x.at===at); if (!b) return s;
  const dest = Math.max(0, Math.min(MAX_BARS - b.len, to));
  const g = grow(s, dest + b.len);
  return setLane(g, track, [...g.lanes[track].filter(x => x!==b), {...b, at:dest}], bars);
}
export function duplicateBlock(s:Song, track:number, at:number, bars:number):Song {
  const b = s.lanes[track].find(x => x.at===at); if (!b || b.at + 2 * b.len > MAX_BARS) return s;
  const g = grow(s, b.at + 2 * b.len);
  return setLane(g, track, [...g.lanes[track], {...b, at:b.at + b.len}], bars);
}
/** Split a block in two at a bar inside it (or in the middle); the right part carries on the clip. */
export function splitBlock(s:Song, track:number, at:number, bar:number, bars:number):Song {
  const b = s.lanes[track].find(x => x.at===at); if (!b || b.len < 2) return s;
  const cut = bar > b.at && bar < b.at + b.len ? bar : b.at + Math.floor(b.len / 2);
  const right = {at:cut, len:b.at + b.len - cut, clip:b.clip, off:phase(b, cut, bars)};
  return setLane(s, track, [...s.lanes[track].filter(x => x!==b), {...b, len:cut - b.at}, right], bars);
}
export const deleteBlock = (s:Song, track:number, at:number):Song => ({...s, lanes:s.lanes.map((l, t) => t===track ? l.filter(b => b.at!==at) : l)});
export const setLength = (s:Song, length:number, bars:number):Song => tidy({...s, length:Math.max(1, Math.min(MAX_BARS, length))}, bars);
export function setMarker(s:Song, bar:number, name:string|null):Song {
  const rest = s.markers.filter(m => m.bar!==bar);
  if (name===null) return {...s, markers:rest};
  if (rest.length >= MAX_MARKERS) return s;
  return {...s, markers:[...rest, {bar, name:name.slice(0, 24)}].sort((a, b) => a.bar - b.bar)};
}
export function nextMarkerName(s:Song) {
  const used = new Set(s.markers.map(m => m.name));
  return MARKER_NAMES.find(n => !used.has(n)) ?? 'Part ' + (s.markers.length + 1);
}

/** Preview mode: mirror the engine's clip actions on a project copy. */
export function previewClip(p:Project, [track, action, clip, source]:[number, string, number, number?]) {
  const c = clipsOf(p); p.clips = c;
  const put = (k:number, notes:Note[]) => { if (k===c.open[track]) p.tracks[track].notes = notes; else c.slots[track][k] = notes; };
  if (action==='open' && clip!==c.open[track]) {
    c.slots[track][c.open[track]] = p.tracks[track].notes; p.tracks[track].notes = c.slots[track][clip] ?? []; c.slots[track][clip] = [];
    c.open[track] = clip;
  } else if (action==='copy' && source!==undefined) put(clip, clipNotes(p, track, source).map(n => ({...n})));
  else if (action==='clear') put(clip, []);
}
