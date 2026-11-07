import {useContextTarget} from './ContextWheel';
import {editNotes} from '../note-ops';
import type {NoteTarget} from '../note-ops';
import {clipsOf} from '../song';
import { useEffect, useRef, useState } from 'react';
import { AudioWaveform, CircleDot, Pencil,Layers3, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import { LIBRARY } from './PresetBrowser';

const categoryOf=(name:string)=>LIBRARY.presets.find(p=>p.name===name)?.category??'';
import { clamp, noteName, TRACK_COLORS, type Project, type Note } from '../types';

type Props = {
  project: Project; selected: number; beat: number;
  playing: boolean; recording: boolean;
  onSelect(index:number):void; onMute(index:number,next:boolean):void;
  onEdit(target:NoteTarget,expected:Note[],events:Note[]):void;onOpenNotes?:(track:number)=>void;
  onOpenSound?(index:number):void; compact?:boolean;
  /** Song page: each lane's clip button (the open clip's letter) and the toolbar above. */
  loops?:{label:string;sub:string;aria:string;title:string}[]; onLoops?(index:number):void; header?:React.ReactNode;
};

function pitchSpan(notes:Note[]) {
  if(!notes.length)return {low:48,high:84};
  const pitches=notes.map(n=>n.note),lo=Math.min(...pitches),hi=Math.max(...pitches);
  return {low:Math.max(0,lo-3), high:Math.min(127,Math.max(lo+15,hi+3))};
}

function ClipGrid({track,idx,bars,beat,selected,recording,playing,onSelect,onEdit,onOpenNotes,clip}:{
  track:Project['tracks'][number];idx:number;bars:number;beat:number;
  selected:boolean;recording:boolean;playing:boolean;
  clip:number;onOpenNotes?:()=>void;onSelect():void;onEdit(target:NoteTarget,expected:Note[],events:Note[]):void;
}) {
  const lane=useRef<HTMLDivElement>(null);
  const [laneHeight,setLaneHeight]=useState(58);
  useEffect(()=>{
    const el=lane.current;if(!el)return;
    const watch=new ResizeObserver(entries=>{
      const height=entries[0]?.contentRect.height;
      if(height)setLaneHeight(height);
    });
    watch.observe(el);
    return()=>watch.disconnect();
  },[]);
  const [drag,setDrag]=useState<{noteIndex:number;original:Note;expected:Note[];target:NoteTarget;startX:number;startY:number;shiftBeat:number;shiftPitch:number;id:number}|null>(null);
  const context=useContextTarget(el=>{const target:NoteTarget={kind:'clip',track:idx,clip,bars,device:track.device??'synth'},original=track.notes.map(n=>({...n})),head=el.closest<HTMLElement>('[data-song-note]'),index=head?Number(head.dataset.songNote):-1;const caps={focus:onSelect,open:onOpenNotes,...(selected&&!recording&&index>=0?{delete:()=>onEdit(target,original,original.filter((_,i)=>i!==index)),duplicate:()=>onEdit(target,original,editNotes(original,[index],{kind:'duplicate'},{span:bars*4,snap:.25,maxDuration:bars*4}).events),quantize:()=>onEdit(target,original,editNotes(original,[index],{kind:'quantize'},{span:bars*4,snap:.25,maxDuration:bars*4}).events)}:{})};return {kind:index>=0?'song.note':'song.empty',label:'Track '+(idx+1)+' · Clip '+String.fromCharCode(65+clip),caps,cancel:()=>setDrag(null)};});
  const beats=bars*4,{low,high}=pitchSpan(track.notes);
  const pos=clamp(beat/beats,0,1);
  const preview=(n:Note,i:number):Note=>{
    if(drag?.noteIndex!==i)return n;
    return {...n,start:(n.start+drag.shiftBeat+beats)%beats,note:clamp(n.note+drag.shiftPitch,0,127)};
  };
  useEffect(()=>setDrag(null),[selected,bars,clip,playing,recording]);
  const begin=(e:React.PointerEvent,num:number)=>{
    if(e.button!==0||recording)return;
    e.stopPropagation();onSelect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({noteIndex:num,original:{...track.notes[num]},expected:track.notes.map(n=>({...n})),target:{kind:'clip',track:idx,clip,bars,device:track.device??'synth'},startX:e.clientX,startY:e.clientY,
             shiftBeat:0,shiftPitch:0,id:e.pointerId});
  };
  const move=(e:React.PointerEvent)=>{
    if(!drag||e.pointerId!==drag.id||!lane.current)return;
    const w=lane.current.getBoundingClientRect().width;
    const deltaBeat=Math.round((e.clientX-drag.startX)/Math.max(1,w)*beats*4)/4;
    const deltaPitch=-Math.round((e.clientY-drag.startY)/12);
    if(deltaBeat!==drag.shiftBeat||deltaPitch!==drag.shiftPitch)
      setDrag({...drag,shiftBeat:deltaBeat,shiftPitch:deltaPitch});
  };
  const end=(e:React.PointerEvent)=>{
    if(!drag||e.pointerId!==drag.id)return;
    if(drag.shiftBeat!==0||drag.shiftPitch!==0)
      onEdit(drag.target,drag.expected,drag.expected.map((n,i)=>i===drag.noteIndex?{...drag.original,start:(drag.original.start+drag.shiftBeat+beats)%beats,note:clamp(drag.original.note+drag.shiftPitch,0,127)}:n));
    setDrag(null);
  };
  return <div ref={lane} {...context} tabIndex={0} className={'clip-lane'+(track.notes.length?' has-notes':'')+
     (selected?' is-selected':'')+(recording?' is-recording':'')}
    style={{'--track-accent':TRACK_COLORS[idx]} as React.CSSProperties} onClick={onSelect} onDoubleClick={onOpenNotes}>
    <div className="clip-gridlines" style={{backgroundSize:(100/beats)+'% 100%'}} aria-hidden="true"/>
    <div className="clip-bar-numbers">
      {Array.from({length:bars},(_,i)=><span key={i} style={{left:(i/bars*100)+'%'}}>{String(i+1).padStart(2,'0')}</span>)}
    </div>
    {track.notes.length===0?<div className="clip-empty"><CircleDot size={14}/> Double-click to edit notes</div>:null}
    {track.notes.map((note,i)=>{
      const displayed=preview(note,i),left=displayed.start/beats*100;
      const width=Math.max(.7,Math.min(displayed.duration/beats*100,100-left));
      const minTop=24,maxTop=Math.max(minTop,laneHeight-17);
      const top=minTop+(high-displayed.note)/Math.max(1,high-low)*(maxTop-minTop);
      return <div data-song-note={i} key={i} role="button" tabIndex={0}
        title={noteName(displayed.note)+' · '+displayed.duration.toFixed(2)+' beats — drag to move'}
        aria-label={noteName(displayed.note)+' note in bar '+(Math.floor(displayed.start/4)+1)}
        className={'clip-note'+(drag?.noteIndex===i?' dragging':'')}
        style={{left:left+'%',width:width+'%',top:top+'px'}}
        onPointerDown={e=>begin(e,i)} onPointerMove={move} onPointerUp={end}
        onPointerCancel={()=>setDrag(null)} onClick={e=>e.stopPropagation()}
        onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();onSelect();}}}>
        {width>5?<span>{noteName(displayed.note)}</span>:null}
      </div>;
    })}
    {track.notes.filter(n=>n.start+n.duration>beats).map((n,i)=>
      <div key={'tail'+i} className="clip-tail"
        style={{left:0,width:((n.start+n.duration-beats)/beats*100)+'%',
                top:(24+(high-n.note)/Math.max(1,high-low)*(Math.max(24,laneHeight-17)-24))+'px'}}/>
    )}
    {(playing||recording)&&<div className="clip-playhead" style={{left:(pos*100)+'%'}} aria-hidden="true"><span className="playhead-cap"/></div>}
    <span className="clip-status">{recording?'● RECORDING':track.notes.length?
      track.notes.length+' NOTES':'EMPTY'}</span>
  </div>;
}

export function Timeline({project,selected,beat,playing,recording,onSelect,onMute,onEdit,onOpenNotes,onOpenSound,compact=false,loops,onLoops,header}:Props) {
  const noteCount=project.tracks.reduce((sum,t)=>sum+t.notes.length,0);
  return <section className={'timeline'+(compact?' compact':'')} aria-label="Four-track MIDI looping timeline">
    {header??(compact?null:<div className="timeline-toolbar">
      <div className="timeline-toolbar-left">
        <span className="eyebrow">COMPOSITION</span>
        <h2>Loop canvas</h2>
        <span className="timeline-summary">{project.bars} bars / 4:4 <span>·</span> {noteCount} notes</span>
      </div>
      <div className="timeline-toolbar-right">
        <span className={'timeline-state'+(recording?' recording':'')}>
          <span className="state-led"/>
          {recording?'RECORDING':playing?'LOOP ACTIVE':'READY'}
        </span>
        <span className="measure-readout">{String(Math.floor(beat/4)+1).padStart(2,'0')}
          <span>:</span>{String(Math.floor(beat%4)+1).padStart(2,'0')}</span>
      </div>
    </div>)}
    <div className="tracks" role="group" aria-label="Music tracks">
      {project.tracks.map((track,i)=>{
        const active=selected===i;
        const loop=loops?.[i];
        return <div key={i} className={'track-row'+(active?' active':'')}
          style={{'--track-accent':TRACK_COLORS[i]} as React.CSSProperties}>
          <button className="track-title" type="button" aria-pressed={active}
            onClick={()=>onSelect(i)}>
            <span className="track-index">{String(i+1).padStart(2,'0')}</span>
            <span className="track-glyph">{i===1?<AudioWaveform size={16}/>:<Layers3 size={16}/>}</span>
            <span className="track-info"><strong>{track.preset}</strong>
              <span>{[categoryOf(track.preset),track.notes.length?track.notes.length+' notes':'empty',track.mute?'muted':Math.round(track.volume*100)+'%'].filter(Boolean).join(' · ')}</span></span>
          </button>
          {loop&&onLoops?<button type="button" className="lane-loop" aria-label={loop.aria}
            title={loop.title} onClick={()=>onLoops(i)}><b>{loop.label}</b><small>{loop.sub}</small></button>:null}
          {onOpenNotes?<button type="button" className="lane-sound" aria-label={'Edit notes of track '+(i+1)} title="Edit MIDI notes" onClick={()=>onOpenNotes(i)}><Pencil size={17}/></button>:null}
          {onOpenSound?<button type="button" className="lane-sound" aria-label={'Edit sound of '+track.preset}
            title="Edit this sound" onClick={()=>onOpenSound(i)}><SlidersHorizontal size={17}/></button>:null}
          <button type="button" className={'lane-mute'+(track.mute?' muted':'')}
            aria-label={(track.mute?'Unmute ':'Mute ')+track.preset}
            aria-pressed={track.mute} title={track.mute?'Unmute':'Mute'}
            onClick={()=>onMute(i,!track.mute)}>
            {track.mute?<VolumeX size={19}/>:<Volume2 size={19}/>}
          </button>
          <ClipGrid track={track} idx={i} bars={project.bars} beat={beat}
            selected={active} recording={recording&&active} playing={playing}
            clip={clipsOf(project).open[i]} onOpenNotes={()=>onOpenNotes?.(i)} onSelect={()=>onSelect(i)} onEdit={onEdit}/>
        </div>;
      })}
    </div>
    {compact||header?null:<div className="timeline-foot">
      <span className="status-swatch"/> Notes remain editable after changing sounds
      <span className="timeline-foot-right">DRAG A NOTE TO MOVE IT</span>
    </div>}
  </section>;
}
