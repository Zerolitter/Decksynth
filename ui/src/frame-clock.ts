import {useEffect,useLayoutEffect,useRef,useSyncExternalStore} from 'react';
import {deckStore,clockCap} from './deck-store';
import {transportPosition} from './transport-clock';

/** Where the transport is now: clip (loop) beat, song beat, and the unwrapped beat. */
export type Position={clipBeat:number;songBeat:number;absoluteBeat:number;playing:boolean};

/** About 30 frames a second, as before: enough for a playhead, and half the work of 60. */
const FRAME_MS=32;
let position:Position=compute(performance.now());
let raf=0,lastFrame=0;
const frameListeners=new Set<(p:Position)=>void>();
const valueListeners=new Set<()=>void>();

function compute(at:number):Position{
  const {snapshot,when}=deckStore.get();
  const cap=clockCap(snapshot);
  const p=transportPosition(snapshot,when,Math.min(at,when+cap),cap);
  return {...p,playing:!!snapshot?.playing};
}

function publish(at:number){
  position=compute(at);
  for(const l of [...frameListeners])l(position);
  for(const l of [...valueListeners])l();
}

function loop(at:number){
  raf=0;
  if(!deckStore.get().snapshot?.playing)return;
  raf=requestAnimationFrame(loop);
  if(at-lastFrame<FRAME_MS)return;
  lastFrame=at;publish(at);
}
const running=()=>frameListeners.size+valueListeners.size>0;
function wake(){
  if(!running()){position=compute(performance.now());return;}
  // A new engine sample (or a stop) is shown at once; the loop then runs only while playing.
  publish(performance.now());
  if(!raf&&deckStore.get().snapshot?.playing)raf=requestAnimationFrame(loop);
}
deckStore.subscribe(wake);

/** The current position, read outside React (in an event handler, say). */
export function readPosition():Position{return compute(performance.now());}

/** Run `draw` on each frame while playing (and once on each engine update), without a React render.
 * For a playhead: set one style on a ref. `draw` may change between renders; the newest one runs. */
export function useFrame(draw:(p:Position)=>void){
  const latest=useRef(draw);latest.current=draw;
  useLayoutEffect(()=>{latest.current(compute(performance.now()));});
  useEffect(()=>{
    const l=(p:Position)=>latest.current(p);
    frameListeners.add(l);wake();
    return()=>{frameListeners.delete(l);};
  },[]);
}

/** Re-render this component only when `select(position)` changes: the current step, the current bar. */
export function useClockValue<T>(select:(p:Position)=>T):T{
  const fn=useRef(select);fn.current=select;
  const cache=useRef<{v:T}|null>(null);
  const read=()=>{
    const v=fn.current(position);
    if(cache.current&&Object.is(cache.current.v,v))return cache.current.v;
    cache.current={v};return v;
  };
  return useSyncExternalStore(subscribeValue,read,read);
}
function subscribeValue(l:()=>void){
  valueListeners.add(l);
  if(!raf&&deckStore.get().snapshot?.playing)raf=requestAnimationFrame(loop);
  return()=>{valueListeners.delete(l);};
}
