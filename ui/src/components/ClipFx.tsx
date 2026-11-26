import { useEffect } from 'react';
import { Check, Layers, Pencil } from 'lucide-react';
import { CLIPS, CLIP_NAMES, clipNotes, clipsOf, songOf } from '../song';
import { TRACK_COLORS, type FxBus, type Project } from '../types';
import { entryOf, summary, type ClipChange } from '../clip-fx';
export * from '../clip-fx';
import '../clip-fx.css';

/** The FX page's title bar on a track: Base and the track's clips. A dot marks the clip playing, an orange edge the
 *  one being edited. Tapping a clip edits its FX; Base or Done goes back. */
export function ClipFxStrip({project,track,buses,playing,editing,onEdit}:{project:Project;track:number;buses:FxBus[];
  playing:number|null;editing:number|null;onEdit:(clip:number|null)=>void}){
  const song=songOf(project),colour=TRACK_COLORS[track];
  const used=(k:number)=>clipNotes(project,track,k).length>0||!!entryOf(project,track,k)||song.lanes[track]?.some(b=>b.clip===k);
  return <div className="clip-fx-strip" role="group" aria-label="Clip FX" style={{['--tc' as string]:colour}}>
    <span className="clip-fx-label"><Layers size={18}/>CLIP FX</span>
    <button type="button" className={'clip-fx-clip base'+(editing===null?'':'')} aria-label="Base: the track's own FX, in every clip" onClick={()=>onEdit(null)}>
      <b>Base</b><small>every clip</small></button>
    {Array.from({length:CLIPS},(_,k)=>{const e=entryOf(project,track,k),name=project.tracks[track].clip_names?.[k];
      const cls=(k===playing?' live':'')+(k===editing?' sel':'');
      return used(k)?<button key={k} type="button" className={'clip-fx-clip'+(e?' has':'')+cls} aria-pressed={k===editing}
          aria-label={'Clip '+CLIP_NAMES[k]+(name?' '+name:'')+': '+summary(e,buses)+(k===playing?', playing':'')} onClick={()=>onEdit(k===editing?null:k)}>
          <b><i>{CLIP_NAMES[k]}</i>{name||'Clip '+CLIP_NAMES[k]}</b><small>{summary(e,buses)}</small></button>
        :<button key={k} type="button" className={'clip-fx-clip empty'+cls} aria-pressed={k===editing} aria-label={'Clip '+CLIP_NAMES[k]+' (empty)'}
          onClick={()=>onEdit(k===editing?null:k)}><b>{CLIP_NAMES[k]}</b></button>;})}
    <span className="clip-fx-sp"/>
    <button type="button" className={'clip-fx-edit'+(editing!==null?' on':'')} data-clip-opener
      aria-label={editing!==null?'Done editing clip FX':'Edit clip FX'} onClick={()=>onEdit(editing!==null?null:playing??clipsOf(project).open[track]??0)}>
      {editing!==null?<><Check size={18}/>Done</>:<><Pencil size={17}/>Edit clip FX</>}</button>
  </div>;
}

/** While a clip's FX are edited: what you hear, when its FX start, Copy from another clip and Clear. */
export function ClipEditRow({project,track,clip,buses,heard,onChange,onCopy,onClear}:{project:Project;track:number;clip:number;buses:FxBus[];
  heard:boolean;onChange:(c:ClipChange)=>void;onCopy:(from:number)=>void;onClear:()=>void}){
  const e=entryOf(project,track,clip),k=CLIP_NAMES[clip],name=project.tracks[track].clip_names?.[clip];
  const change=e?.change??'jump';
  const others=Array.from({length:CLIPS},(_,i)=>i).filter(i=>i!==clip&&entryOf(project,track,i));
  return <div className="clip-edit-row" style={{['--tc' as string]:TRACK_COLORS[track]}}>
    <div className="clip-edit-msg">Editing clip {k}{name?' · '+name:''}{heard?' · you hear '+k:''}
      <small>Changes you make now play only while clip {k} plays.</small></div>
    <span className="clip-fx-sp"/>
    <span className="clip-edit-mini">When {k} starts</span>
    <div className="clip-edit-seg" role="radiogroup" aria-label={'When clip '+k+' starts'}>
      {([['jump','Jump'],['beat','1 beat'],['bar','1 bar']] as [ClipChange,string][]).map(([v,label])=>
        <button key={v} type="button" role="radio" aria-checked={change===v} className={change===v?'active':''} disabled={!e&&v!=='jump'}
          title={v==='jump'?'Its knob values land at once':'Its knobs glide there over '+label+' (choices and on/off still jump)'} onClick={()=>onChange(v)}>{label}</button>)}
    </div>
    <div className="clip-edit-copy" role="group" aria-label="Copy FX from">
      {others.length?<span className="clip-edit-mini">Copy from</span>:null}
      {others.map(i=><button key={i} type="button" aria-label={'Copy FX from clip '+CLIP_NAMES[i]} onClick={()=>onCopy(i)}>{CLIP_NAMES[i]}</button>)}
    </div>
    <button type="button" className="clip-edit-clear" disabled={!e} onClick={onClear}>Clear {k}'s FX</button>
  </div>;
}

/** Esc, the Deck's B button and a tap on blank space end editing (rule 14). */
export function useClipEditExit(active:boolean,exit:()=>void){
  useEffect(()=>{if(!active)return;
    const keep='button,input,select,textarea,a,[role="button"],[role="slider"],[role="radio"],.parameter-knob,.tactile-knob,.context-wheel,.fx-picker-sheet,.bus-sheet';
    const down=(e:PointerEvent)=>{const t=e.target as Element|null;if(t&&!t.closest(keep))exit();};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')exit();};
    let raf=0,was=true;const poll=()=>{const b=[...(navigator.getGamepads?.()??[])].some(g=>!!g?.buttons?.[1]?.pressed);if(b&&!was){exit();return;}was=b;raf=requestAnimationFrame(poll);};
    raf=requestAnimationFrame(poll);document.addEventListener('pointerdown',down,true);window.addEventListener('keydown',key);
    return()=>{cancelAnimationFrame(raf);document.removeEventListener('pointerdown',down,true);window.removeEventListener('keydown',key);};},[active,exit]);
}

