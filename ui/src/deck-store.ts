import {useEffect,useRef,useSyncExternalStore,type SetStateAction} from 'react';
import type {BridgeMessage,DeckUpdate} from './types';
import {transportPosition} from './transport-clock';

/** The engine's last state and when it arrived (the clock's epoch). One store for the whole screen:
 * a component reads only the slice it shows, so a status packet doesn't re-render the whole app. */
export type Received={snapshot:DeckUpdate|null;when:number};

/** Values that change on every status tick while playing. App ignores them; their users subscribe themselves. */
export const LIVE_KEYS=['beat','song_beat','meter','voices','dsp_load','arp_view','song_pos'] as const;
/** Big values the engine re-sends in full every 2 s: an unchanged copy keeps its old object. */
const STABLE_KEYS=['state','drum_racks','samplers','sample_library','drum_library','pattern_library','sampler_record','freeze','devices','audio_outputs','held_notes','plugins'] as const;

let current:Received={snapshot:null,when:performance.now()};
const listeners=new Set<()=>void>();
const emit=()=>{for(const l of [...listeners])l();};

const hasApi=()=>typeof window!=='undefined'&&!!window.deckApi;
/** How far ahead of the last engine sample the clock may run (the preview has no engine, so it runs freely). */
export const clockCap=(s:DeckUpdate|null)=>!hasApi()||s?.preview?100000:220;

function same(a:unknown,b:unknown){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
  try{return JSON.stringify(a)===JSON.stringify(b);}catch{return false;}
}

export const deckStore={
  get:()=>current,
  subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
  /** A whole new snapshot, or a change computed from the current one (the preview's local commands).
   * A computed change is rebased at the current position, so it can't reset the running clock. */
  set(update:SetStateAction<DeckUpdate|null>){
    const when=performance.now();
    let prior=current.snapshot;
    if(typeof update==='function'&&prior){
      const p=transportPosition(prior,current.when,when,clockCap(prior));
      prior={...prior,beat:p.clipBeat,song_beat:p.absoluteBeat};
    }
    const next=typeof update==='function'?update(prior):update;
    if(next===current.snapshot)return;
    current={snapshot:next,when};emit();
  },
  /** The engine sends only what changed; the first message is complete. */
  merge(obj:BridgeMessage){
    const prev=current.snapshot;
    if(!prev){if(obj.state&&typeof obj.beat==='number'){current={snapshot:obj as DeckUpdate,when:performance.now()};emit();}return;}
    const next:Record<string,unknown>={...prev,...obj},old=prev as unknown as Record<string,unknown>;
    for(const key of STABLE_KEYS)if(key in obj&&same(old[key],next[key]))next[key]=old[key];
    current={snapshot:next as unknown as DeckUpdate,when:performance.now()};emit();
  },
};

/** Read a slice of the engine state; the component re-renders only when `equal` says the slice changed. */
export function useDeck<T>(select:(r:Received)=>T,equal:(a:T,b:T)=>boolean=Object.is):T{
  const cache=useRef<{v:T}|null>(null);
  const read=()=>{
    const v=select(current);
    if(cache.current&&equal(cache.current.v,v))return cache.current.v;
    cache.current={v};return v;
  };
  return useSyncExternalStore(deckStore.subscribe,read,read);
}

const LIVE=new Set<string>(LIVE_KEYS);
/** Equal when every key except the live ones is the same object: App's view of the snapshot. */
export function sameExceptLive(a:DeckUpdate|null,b:DeckUpdate|null){
  if(a===b)return true;
  if(!a||!b)return false;
  const ka=Object.keys(a),kb=Object.keys(b);
  if(ka.length!==kb.length)return false;
  for(const k of ka)if(!LIVE.has(k)&&(a as Record<string,unknown>)[k]!==(b as Record<string,unknown>)[k])return false;
  return true;
}

/** Which meters are on screen. The engine builds the level, wave and spectrum data only for these (see `meters_watched`
 * in backend.py); a component that draws one calls `useMetersWatched('levels')` and it is counted while it is mounted. */
export type MeterKind='levels'|'wave'|'spectrum';
const watchedCount:Record<MeterKind,number>={levels:0,wave:0,spectrum:0};
let watchTimer:ReturnType<typeof setTimeout>|0=0;
function sendWatched(){
  watchTimer=0;
  try{window.deckApi?.send('meters_watched',(Object.keys(watchedCount) as MeterKind[]).filter(k=>watchedCount[k]>0));}catch{/* no engine (preview) */}
}
/** Count `kind` as watched while the calling component is mounted. A page change unmounts one and mounts another in
 * the same tick, so the message is sent once, after the tick. */
export function useMetersWatched(kind:MeterKind){
  useEffect(()=>{
    watchedCount[kind]++;
    if(!watchTimer)watchTimer=setTimeout(sendWatched,0);
    return()=>{watchedCount[kind]--;if(!watchTimer)watchTimer=setTimeout(sendWatched,0);};
  },[kind]);
}

/** One live slice of the snapshot, e.g. `useLive(s=>s?.meter?.fx_live)`. */
export function useLive<T>(select:(s:DeckUpdate|null)=>T,equal?:(a:T,b:T)=>boolean){
  return useDeck(r=>select(r.snapshot),equal);
}
