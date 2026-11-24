import {forwardRef,useEffect,useImperativeHandle,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {notesInCell,type NoteBounds,type NoteTarget} from '../note-ops';
import {noteName} from '../types';
import {SCALES} from '../chords';
import {performanceRange} from '../piano-viewport';
import {usePianoViewport} from './usePianoViewport';
import type {useNoteEditing} from './useNoteEditing';
import {useClockValue,useFrame,type Position} from '../frame-clock';

export type PianoRollHandle={fit:()=>void;timeTo:(time:number)=>void;pitchTo:(pitch:number)=>void;panTime:(direction:number)=>void;panPitch:(direction:number)=>void};
type Props={
  edit:ReturnType<typeof useNoteEditing>;
  target:NoteTarget;
  bounds:NoteBounds;
  context:Record<string,string>;
  playing:boolean;
  /** Where the playhead is, in grid units, read on each frame of the shared clock. */
  beatAt:(p:Position)=>number;
  recording:boolean;
  compact?:boolean;
  pitchBase?:number;
  scale?:{name:string;root:number};
  onTime?:(step:number)=>void;
  /** Double-tap on the ruler: play from the start of that bar. */
  onPlayFrom?:(beat:number)=>void;
  /** Where the overview map goes (Perform: the toolbar slot that used to hold the page buttons). */
  overviewSlot?:HTMLElement|null;
};

const KEY_WIDTH=44;
const RULER_HEIGHT=24;

export const PianoRoll=forwardRef<PianoRollHandle,Props>(function PianoRoll(
  {edit,target,bounds,context,playing,beatAt,recording,compact=false,pitchBase,scale,onTime,onPlayFrom,overviewSlot},handle
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
  const [follow,setFollow]=useState(false);
  const overviewDrag=useRef<{id:number;mode:'move'|'left'|'right';x:number;left:number;width:number}|null>(null);

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
  // The playhead moves on the shared frame clock: one style change per frame, no React render.
  const head=useRef<HTMLDivElement>(null);
  useFrame(p=>{
    const el=head.current;if(!el)return;
    const beat=beatAt(p),x=xAt(beat);
    const show=beat>=0&&beat<bounds.span&&x>=nav.left+KEY_WIDTH&&x<nav.left+nav.width;
    el.style.display=show?'':'none';
    if(show){el.style.left=x+'px';el.style.top=nav.top+'px';}
  });
  // Two fingers on the grid pinch-zoom time and pan (Chisper row 4). The second finger cancels
  // any edit the first one started, and neither finger edits until both are lifted.
  const pinchRefs=useRef({edit,nav});pinchRefs.current={edit,nav};
  useEffect(()=>{const el=grid.current;if(!el)return;
    const pts=new Map<number,{x:number;y:number}>();let pinch:null|{d:number;mx:number;my:number;start:{left:number;top:number;timePx:number;anchor:number}}=null;
    const mid=()=>{const [a,b]=[...pts.values()];return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)};};
    const down=(e:PointerEvent)=>{if(e.pointerType!=='touch')return;pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pts.size===2&&!pinch){pinchRefs.current.edit.cancel();const m=mid(),r=el.getBoundingClientRect();
        pinch={d:Math.max(24,m.d),mx:m.x,my:m.y,start:{left:el.scrollLeft,top:el.scrollTop,timePx:pinchRefs.current.nav.timePx,anchor:m.x-r.left}};}
      if(pinch){e.preventDefault();e.stopPropagation();}};
    const move=(e:PointerEvent)=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,{x:e.clientX,y:e.clientY});if(!pinch)return;
      e.preventDefault();e.stopPropagation();if(pts.size<2)return;const m=mid();pinchRefs.current.nav.pinchTo(pinch.start,m.d/pinch.d,m.x-pinch.mx,m.y-pinch.my);};
    const up=(e:PointerEvent)=>{if(!pts.delete(e.pointerId))return;if(pinch){e.stopPropagation();if(!pts.size)pinch=null;}};
    el.addEventListener('pointerdown',down,true);el.addEventListener('pointermove',move,true);el.addEventListener('pointerup',up,true);el.addEventListener('pointercancel',up,true);
    return()=>{el.removeEventListener('pointerdown',down,true);el.removeEventListener('pointermove',move,true);el.removeEventListener('pointerup',up,true);el.removeEventListener('pointercancel',up,true);};
  },[]);
  // Recording turns Follow on so the view keeps up with what you play; it goes back to your choice after.
  const rulerTap=useRef<{at:number;bar:number}|null>(null);
  const followBefore=useRef<boolean|null>(null);
  useEffect(()=>{
    if(recording&&followBefore.current===null){followBefore.current=follow;setFollow(true);}
    else if(!recording&&followBefore.current!==null){setFollow(followBefore.current);followBefore.current=null;}
  },[recording]);// eslint-disable-line react-hooks/exhaustive-deps
  const followBeat=useClockValue(p=>follow&&(playing||recording)?Math.floor(beatAt(p)/bounds.snap)*bounds.snap:-1);
  useEffect(()=>{if(followBeat>=0&&followBeat<bounds.span)nav.followTime(followBeat);},[followBeat,bounds.span,nav.followTime]);
  const box=edit.box&&{
    left:xAt(edit.box.from),
    top:RULER_HEIGHT+pitches.indexOf(edit.box.high)*rowHeight,
    width:(edit.box.to-edit.box.from)/bounds.snap*timePx,
    height:(pitches.indexOf(edit.box.low)-pitches.indexOf(edit.box.high)+1)*rowHeight,
  };

  const visibleNotes=edit.events.flatMap((note,index)=>{
    const x=xAt(note.start)-nav.left;
    return x>=KEY_WIDTH-8&&x<=nav.width+8?[{note,index,x}]:[];
  });
  const overviewWidth=Math.max(1,width-KEY_WIDTH),windowLeft=Math.max(0,(nav.left-KEY_WIDTH)/overviewWidth),windowWidth=Math.min(1,Math.max(.04,(nav.width-KEY_WIDTH)/overviewWidth));
  // The velocity lane belongs to the Accent (velocity) tool; the overview and Follow only
  // matter when the pattern is wider than the view. Neither holds space otherwise.
  // Sir, 20 Nov: the velocity lane lives under the grid; the overview replaces the page buttons.
  const labelEvery=[1,2,4,8,16,32].find(n=>n*timePx>=18)??64;
  const overviewDown=(e:React.PointerEvent<HTMLDivElement>)=>{
    if(e.button!==0)return;const r=e.currentTarget.getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
    // Each edge owns a 44 px finger zone (22 px either side of the line, rule 10); a press
    // beside the window centres it there, then drags as a move.
    const x=ratio*r.width,at=windowLeft*r.width,size=windowWidth*r.width,edge=Math.min(22,size/3);
    let mode:'move'|'left'|'right'=Math.abs(x-at)<=edge?'left':Math.abs(x-(at+size))<=edge?'right':'move',left=windowLeft;
    if(mode==='move'&&(x<at||x>at+size)){left=Math.max(0,Math.min(1-windowWidth,ratio-windowWidth/2));nav.overviewTo(left/(1-windowWidth||1));}
    e.currentTarget.setPointerCapture(e.pointerId);overviewDrag.current={id:e.pointerId,mode,x:e.clientX,left,width:windowWidth};
  };
  const overviewMove=(e:React.PointerEvent<HTMLDivElement>)=>{const g=overviewDrag.current;if(!g||g.id!==e.pointerId)return;const r=e.currentTarget.getBoundingClientRect(),delta=(e.clientX-g.x)/r.width;if(g.mode==='move')nav.overviewTo(Math.max(0,Math.min(1-g.width,g.left+delta))/(1-g.width||1));else nav.overviewZoom(g.mode,Math.max(-.9,Math.min(.9,delta)));};
  const overviewEnd=(e:React.PointerEvent<HTMLDivElement>)=>{if(overviewDrag.current?.id!==e.pointerId)return;overviewDrag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);};

  return <div className="piano-roll-shell">
  <div ref={grid} {...context}
    className={(compact?'pf-grid compact-roll':'note-editor-grid')+' piano-roll'+(nav.panning?' panning':'')}
    tabIndex={0} role="group" aria-label={compact?'Editable sequencer piano roll':'Editable pitch and time grid'}
    data-time-px={timePx} data-row-height={rowHeight} data-edit-cursor={edit.cursor} data-selection-count={edit.selection.length} data-snap={edit.snap}
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
            aria-label={'Set edit cursor at '+time+(onPlayFrom?' · double-tap plays from bar '+(Math.floor(time/4)+1):'')+(above?' · notes above':'')+(below?' · notes below':'')}
            style={{left:xAt(time),width:timePx}} onClick={()=>{
              // One tap sets the edit cursor; a second tap within 350 ms plays from the start of that bar.
              const now=performance.now(),bar=Math.floor(time/4)*4,last=rulerTap.current;
              rulerTap.current={at:now,bar};
              if(onPlayFrom&&last&&last.bar===bar&&now-last.at<350){rulerTap.current=null;onPlayFrom(bar);return;}
              edit.setCursor(time);}}>
            {above&&<span className="piano-note-guide" title="Notes above" aria-hidden="true">▲</span>}
            {time%1===0?((time%labelEvery===0)?time+1:''):(timePx>=14?'·':'')}
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
              onClick={e=>{if(e.detail===0)edit.tap(time,pitch);else if(e.detail===2)edit.doubleTap(time,pitch);}}>
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
      <div ref={head} className={'piano-playhead'+(recording?' recording':'')}
        aria-hidden="true"/>
    </div>
  </div>
  <div className="piano-velocity" aria-label="Velocity lane"
    onPointerMove={e=>{const r=e.currentTarget.querySelector<HTMLElement>('.piano-velocity-stems')?.getBoundingClientRect();const hits=r?visibleNotes.filter(v=>Math.abs(e.clientX-r.left-(v.x-KEY_WIDTH))<Math.max(7,timePx*.18)).map(v=>v.index):[];edit.velocityMove(e,hits);}}
    onPointerUp={edit.velocityEnd} onPointerCancel={edit.cancel}>
    <span className="piano-lane-label">Vel</span>
    <div className="piano-velocity-stems">{visibleNotes.map(({note,index,x})=><button key={index} type="button" data-velocity-note={index}
      className={'piano-velocity-stem'+(edit.selection.includes(index)?' selected':'')} aria-label={'Velocity '+note.velocity}
      style={{left:x-KEY_WIDTH,height:Math.max(3,note.velocity/127*100)+'%'}} onPointerDown={e=>edit.velocityBegin(e,index)}/>)}</div>
  </div>
  {overviewSlot&&createPortal(<div className="piano-overview" aria-label="Note overview">
    <button type="button" className={'piano-follow'+(follow?' on':'')} aria-pressed={follow} onClick={()=>setFollow(v=>!v)} title="Keep the playhead in view">Follow</button>
    <div className="piano-overview-map" role="slider" aria-label="Overview viewport" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(windowLeft*100)}
      onPointerDown={overviewDown} onPointerMove={overviewMove} onPointerUp={overviewEnd} onPointerCancel={overviewEnd}>
      {edit.events.map((n,i)=><i key={i} className="piano-overview-note" style={{left:(n.start/bounds.span*100)+'%',width:Math.max(.4,n.duration/bounds.span*100)+'%'}}/>)}
      <span className="piano-overview-window" style={{left:(windowLeft*100)+'%',width:(windowWidth*100)+'%'}}/>
    </div>
  </div>,overviewSlot)}
  </div>;
});
