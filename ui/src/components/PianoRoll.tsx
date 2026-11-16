import {forwardRef,useEffect,useImperativeHandle,useMemo,useRef} from 'react';
import {notesInCell,type NoteBounds,type NoteTarget} from '../note-ops';
import {noteName} from '../types';
import {SCALES} from '../chords';
import {performanceRange} from '../piano-viewport';
import {usePianoViewport} from './usePianoViewport';
import type {useNoteEditing} from './useNoteEditing';

export type PianoRollHandle={fit:()=>void;timeTo:(time:number)=>void;pitchTo:(pitch:number)=>void;panTime:(direction:number)=>void;panPitch:(direction:number)=>void};
type Props={
  edit:ReturnType<typeof useNoteEditing>;
  target:NoteTarget;
  bounds:NoteBounds;
  context:Record<string,string>;
  playing:boolean;
  beat:number;
  recording:boolean;
  compact?:boolean;
  pitchBase?:number;
  scale?:{name:string;root:number};
  onTime?:(step:number)=>void;
};

const KEY_WIDTH=44;
const RULER_HEIGHT=24;

export const PianoRoll=forwardRef<PianoRollHandle,Props>(function PianoRoll(
  {edit,target,bounds,context,playing,beat,recording,compact=false,pitchBase,scale,onTime},handle
){
  const grid=useRef<HTMLDivElement>(null);
  const keyPointer=useRef<number|null>(null);
  const pitches=useMemo(()=>Array.from({length:128},(_,i)=>127-i)
    .filter(n=>!compact||!scale||(SCALES[scale.name]??SCALES.Chromatic).includes((n-scale.root+1200)%12)),
  [compact,scale?.name,scale?.root]);
  const range=performanceRange(target.device??'synth',pitchBase);
  const nav=usePianoViewport(grid,bounds.span,bounds.snap,edit.events,
    ()=>edit.active()||keyPointer.current!==null,
    {pitches,compact,firstPitch:compact?range.viewTop:undefined,
      rows:target.device==='drum_rack'?range.viewRows:Math.min(range.viewRows,scale?(SCALES[scale.name]??SCALES.Chromatic).length+1:9)});
  const {timePx,rowHeight}=nav;

  const stopKeys=(el:HTMLDivElement,pointer=keyPointer.current)=>{
    if(pointer===null||keyPointer.current!==pointer)return false;
    keyPointer.current=null;
    edit.scrub(null,100,pointer);
    if(el.hasPointerCapture(pointer))el.releasePointerCapture(pointer);
    return true;
  };
  const identity=JSON.stringify(target);
  useEffect(()=>{
    const el=grid.current;
    if(!el)return;
    const release=()=>{stopKeys(el);edit.cancelCapture(el);};
    window.addEventListener('blur',release);
    return ()=>{window.removeEventListener('blur',release);release();};
  },[identity,playing,recording,scale?.name,scale?.root]);
  useEffect(()=>nav.cancel(),[identity,playing,recording,scale?.name,scale?.root]);
  useEffect(()=>onTime?.(Math.max(0,(nav.left-KEY_WIDTH)/timePx*bounds.snap)),[nav.left,timePx]);
  useImperativeHandle(handle,()=>({
    fit:()=>nav.fit(edit.selection.length?edit.selection.map(i=>edit.events[i]).filter(Boolean):edit.events),
    timeTo:nav.timeTo,pitchTo:nav.pitchTo,panTime:nav.time,panPitch:nav.pitch,
  }));

  const columns=Array.from({length:Math.max(0,nav.lastCol-nav.firstCol)},(_,i)=>nav.firstCol+i);
  const rows=Array.from({length:Math.max(0,nav.lastRow-nav.firstRow)},(_,i)=>nav.firstRow+i);
  const xAt=(time:number)=>KEY_WIDTH+time/bounds.snap*timePx;
  const width=xAt(Math.ceil(bounds.span/bounds.snap)*bounds.snap);
  const height=RULER_HEIGHT+pitches.length*rowHeight;
  const start=nav.firstCol*bounds.snap;
  const visibleHigh=pitches[Math.floor(nav.top/rowHeight)];
  const visibleLow=pitches[Math.min(pitches.length-1,Math.ceil((nav.top+nav.height-RULER_HEIGHT)/rowHeight)-1)];
  const guides=new Map<number,number>();
  for(const note of edit.events){
    const side=note.note>visibleHigh?1:note.note<visibleLow?2:0;
    if(!side)continue;
    const column=Math.floor(note.start/bounds.snap);
    guides.set(column,(guides.get(column)??0)|side);
  }
  const playhead=xAt(beat);
  const showPlayhead=(playing||recording)&&beat>=0&&beat<bounds.span
    &&playhead>=nav.left+KEY_WIDTH&&playhead<nav.left+nav.width;
  const box=edit.box&&{
    left:xAt(edit.box.from),
    top:RULER_HEIGHT+pitches.indexOf(edit.box.high)*rowHeight,
    width:(edit.box.to-edit.box.from)/bounds.snap*timePx,
    height:(pitches.indexOf(edit.box.low)-pitches.indexOf(edit.box.high)+1)*rowHeight,
  };

  return <div ref={grid} {...context}
    className={(compact?'pf-grid compact-roll':'note-editor-grid')+' piano-roll'+(nav.panning?' panning':'')}
    tabIndex={0} role="group" aria-label={compact?'Editable sequencer piano roll':'Editable pitch and time grid'}
    data-time-px={timePx} data-row-height={rowHeight} data-edit-cursor={edit.cursor} data-selection-count={edit.selection.length}
    onKeyDown={e=>{
      if(nav.active()){if(e.key==='Escape')nav.cancel();e.preventDefault();e.stopPropagation();return;}
      if(e.key==='Escape'&&stopKeys(e.currentTarget)){e.preventDefault();e.stopPropagation();return;}
      edit.key(e);
    }}
    onPointerDownCapture={nav.begin} onPointerMoveCapture={nav.move} onPointerUpCapture={nav.end}
    onPointerCancelCapture={nav.cancel}
    onPointerMove={e=>{
      if(keyPointer.current===e.pointerId){
        const r=e.currentTarget.getBoundingClientRect();
        const pitch=e.clientX>=r.left&&e.clientX<r.left+KEY_WIDTH?nav.pitchAt(e.clientY):null;
        edit.scrub(pitch,100,e.pointerId);
      }else edit.move(e);
    }}
    onPointerUp={e=>{if(!stopKeys(e.currentTarget,e.pointerId))edit.end(e);}}
    onPointerCancel={e=>{
      stopKeys(e.currentTarget,e.pointerId);
      edit.cancelCapture(e.currentTarget,e.pointerId);
    }}
    onLostPointerCapture={e=>{
      if(e.target!==e.currentTarget)return;
      stopKeys(e.currentTarget,e.pointerId);
      edit.cancelCapture(e.currentTarget,e.pointerId);
      if(nav.active())nav.cancel();
    }}>
    <div className="piano-canvas" style={{width,height}}>
      <div className="note-editor-ruler" style={{width}}>
        <span className="piano-ruler-corner"/>
        {columns.map(c=>{
          const time=c*bounds.snap,guide=guides.get(c)??0;
          const above=Boolean(guide&1),below=Boolean(guide&2);
          return <button type="button" key={c} className="piano-ruler-tick"
            aria-label={'Set edit cursor at '+time+(above?' · notes above':'')+(below?' · notes below':'')}
            style={{left:xAt(time),width:timePx}} onClick={()=>edit.setCursor(time)}>
            {above&&<span className="piano-note-guide" title="Notes above" aria-hidden="true">▲</span>}
            {time%1===0?time+1:'·'}
            {below&&<span className="piano-note-guide" title="Notes below" aria-hidden="true">▼</span>}
          </button>;
        })}
      </div>
      {rows.map(row=>{
        const pitch=pitches[row];
        return <div key={pitch} data-pitch={pitch} className={'note-editor-row'+([1,3,6,8,10].includes(pitch%12)?' black':'')}
          style={{top:RULER_HEIGHT+row*rowHeight,height:rowHeight,width}}>
          <button className="piano-pitch-key" type="button" style={{height:rowHeight,minHeight:rowHeight}}
            aria-label={'Play '+noteName(pitch)}
            onPointerDown={e=>{
              const el=grid.current;
              if(e.button!==0||!el||keyPointer.current!==null||edit.active())return;
              e.preventDefault();
              el.focus({preventScroll:true});
              el.setPointerCapture(e.pointerId);
              keyPointer.current=e.pointerId;
              edit.scrub(pitch,100,e.pointerId);
            }}
            onClick={e=>{if(e.detail===0)edit.auditionPitch(pitch);}}>{noteName(pitch)}</button>
          {columns.map(c=>{
            const time=c*bounds.snap,blocks=notesInCell(edit.events,time,pitch,bounds.snap,start);
            const selected=blocks.some(b=>edit.selection.includes(b.index));
            return <button key={c} type="button"
              className={'note-time-cell'+(compact?' pf-cell':'')+(c%4===0?' beat':'')+(selected?' selected':'')}
              style={{left:xAt(time),width:timePx,height:rowHeight}}
              data-testid={(compact?'pf-cell-'+(time+1):'note-cell-'+time)+'-'+pitch}
              data-note-time={time} data-note-pitch={pitch}
              aria-label={noteName(pitch)+' at '+time+(blocks.length?' note':' empty')} disabled={recording}
              onPointerDown={e=>{
                if(grid.current&&keyPointer.current===null)edit.begin(e,time,pitch,nav.locate,grid.current,pitches);
              }}
              onClick={e=>{if(e.detail===0)edit.tap(time,pitch);}}>
              {blocks.map(({note:n,index})=>{
                const left=Math.max(n.start,time),end=Math.min(n.start+n.duration,bounds.span);
                return <i key={index} className={'note-editor-block'+(compact?' pf-note':'')
                  +(edit.copyGhosts.includes(index)?' copy-preview':'')+(edit.selection.includes(index)?' selected':'')}
                  style={{left:(left-time)/bounds.snap*100+'%',width:'max(3px, calc('+(end-left)/bounds.snap*100+'% - 4px))'}}>
                  {!compact&&<span>{n.velocity}</span>}
                </i>;
              })}
            </button>;
          })}
        </div>;
      })}
      <div className="piano-edit-cursor" style={{left:xAt(edit.cursor)}} aria-hidden="true"/>
      {box&&<div className="piano-box-selection" style={box} aria-hidden="true"/>}
      {showPlayhead&&<div className={'piano-playhead'+(recording?' recording':'')}
        style={{left:playhead,top:nav.top}} aria-hidden="true"/>}
    </div>
  </div>;
});
