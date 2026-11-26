import { FX_MODULES, normalizeChain, type FxChain, type FxModuleId, type FxModuleState } from './fx.ts';
import { CLIP_NAMES, blockAt, clipsOf, songOf } from './song.ts';
import type { FxBus, Project } from './types.ts';

/** FX per clip (decksynth/clip_fx.py, mockup fx-per-clip 26 Nov): a clip can switch cards on or off, set knobs
 *  and set its track's bus sends; while it plays, the track's chain (its Base) has those changes on top. */
export type ClipHold={on?:boolean;params?:Record<string,number>};
export type ClipChange='jump'|'beat'|'bar';
export type ClipEntry={fx?:Partial<Record<FxModuleId,ClipHold>>;sends?:Record<string,{amount:number;through:boolean}>;change?:ClipChange};

export const entryOf=(p:Project,track:number,clip:number|null):ClipEntry|null=>clip===null?null:p.tracks[track]?.clip_fx?.[String(clip)]??null;
const isOn=(m:FxModuleState)=>m.on&&!m.bypass;

/** The chain while a clip with these changes plays (as clip_fx.chain_for). */
export function chainFor(base:FxChain,entry:ClipEntry|null):FxChain{
  const holds=entry?.fx;if(!holds)return base;
  return {...base,modules:base.modules.map(m=>{const h=holds[m.id];if(!h)return m;let n={...m};
    if(h.on!==undefined)n=h.on&&!m.on?{...n,on:true,bypass:false}:{...n,bypass:!h.on};
    if(h.params)n={...n,params:{...n.params,...h.params}};return n;})};
}

/** The clip the track plays now: the song block under the playhead (null where the lane is silent), or the open clip. */
export function playingClip(p:Project,track:number,songBar:number|null):number|null{
  const song=songOf(p);
  if(song.on)return songBar===null?null:blockAt(song,track,songBar)?.clip??null;
  return clipsOf(p).open[track]??null;
}

/** An edit made on the cards (old → new chain as shown) split into the track's Base and the clip's changes.
 *  While editing a clip, every change goes to the clip; otherwise a knob or power button the playing clip holds
 *  changes the clip and everything else changes Base. Adding, moving and removing cards and links change Base;
 *  in a clip, a card added is off in Base and on in the clip, and a card removed is off in the clip only. */
export function splitEdit(shown:FxChain,next:FxChain,base:FxChain,entry:ClipEntry|null,editing:boolean):{base:FxChain;entry:ClipEntry|null;power:boolean}{
  const holds:Partial<Record<FxModuleId,ClipHold>>=structuredClone(entry?.fx??{});
  const was=new Map(shown.modules.map(m=>[m.id,m])),bases=new Map(base.modules.map(m=>[m.id,m]));
  let power=false;
  const modules=next.modules.map(nm=>{
    const om=was.get(nm.id)??nm,bm=bases.get(nm.id)??nm;let m:FxModuleState={...bm};
    const h:ClipHold={...holds[nm.id]};
    if(isOn(nm)!==isOn(om)){power=true;
      if(editing||h.on!==undefined){h.on=isOn(nm);if(isOn(nm)&&!bm.on)m={...m,on:true,bypass:true};}
      else m={...m,on:nm.on,bypass:nm.bypass};}
    for(const [k,v] of Object.entries(nm.params))if(v!==om.params[k]){
      if(editing||h.params?.[k]!==undefined)h.params={...h.params,[k]:v};
      else m={...m,params:{...m.params,[k]:v}};}
    if(h.on!==undefined||h.params)holds[nm.id]=h;else delete holds[nm.id];
    return m;});
  const nb:FxChain={...next,modules:[...modules.filter(m=>m.on),...modules.filter(m=>!m.on)]};
  const fx=Object.keys(holds).length?holds:undefined;
  const e:ClipEntry={...entry,fx};if(!fx)delete e.fx;
  return {base:nb,entry:e.fx||e.sends?e:null,power};
}

/** What a clip changes, in a few words: one change by name, more as a count. */
export function summary(entry:ClipEntry|null,buses:FxBus[]):string{
  const items:string[]=[];
  for(const [id,h] of Object.entries(entry?.fx??{}) as [FxModuleId,ClipHold][]){const def=FX_MODULES[id];
    if(h.on!==undefined)items.push(def.name+(h.on?' on':' off'));
    for(const k of Object.keys(h.params??{}))items.push(def.name+' '+(def.params.find(p=>p.key===k)?.label??k));}
  for(const b of Object.keys(entry?.sends??{}))items.push((buses[+b]?.name??'Bus')+' send');
  return !items.length?'same as Base':items.length===1?items[0]:items.length+' changes';
}

/** The knobs a clip holds, for the tag on their value box: the clip's letter and the Base value. */
export function heldBy(entry:ClipEntry|null,clip:number|null,base:FxChain){
  const b=normalizeChain(base);
  return (module:FxModuleId,key:string)=>{const v=entry?.fx?.[module]?.params?.[key];if(v===undefined||clip===null)return null;
    return {letter:CLIP_NAMES[clip],base:b.modules.find(m=>m.id===module)?.params[key]};};
}
