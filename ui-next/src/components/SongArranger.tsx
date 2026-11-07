/* Song page (PLAN K): a timeline of clip blocks per track with markers on top, like a DAW arrangement.
   SongBar is the toolbar (play mode, view, length, end, zoom) plus the context row for what is selected;
   Arranger draws the ruler and the four lanes; ClipSheet picks, copies and clears a track's clips A–H. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft, ChevronRight, CopyPlus, Eraser, Flag, Layers3, AudioWaveform, Minus, Pencil, Plus, Repeat, Repeat1,
  Scissors, Sparkles, Trash2, Volume2, VolumeX, Copy,
} from 'lucide-react';
import { TRACK_COLORS, type Note, type Project } from '../types';
import {
  CLIP_NAMES, CLIPS, MARKER_NAMES, MAX_BARS, blockAt, changeBlock, clipNotes, clipsOf, deleteBlock, duplicateBlock,
  emptyClip, markerAt, moveBlock, nextMarkerName, phase, place, setLength, setMarker, splitBlock, type Block, type Song,
} from '../song';

export type SongView = 'arrange' | 'clips';
export type SongSel = {kind:'block'; track:number; at:number; bar:number} | {kind:'bar'; bar:number} | null;
export const ZOOMS = [8, 16, 32];

const pad2 = (n:number) => String(n).padStart(2, '0');

type BarProps = {
  project:Project; song:Song; view:SongView; onView(v:SongView):void; onSong(s:Song):void;
  zoom:number; onZoom(z:number):void; start:number; onStart(bar:number):void;
  sel:SongSel; onSel(s:SongSel):void; playing:boolean; songBeat:number; loopBeat:number;
  onClip(track:number, action:'open'|'copy'|'clear', clip:number, source?:number):void; onEditClip(track:number, clip:number):void;
};

export function SongBar(props:BarProps) {
  const {project, song, view, onView, onSong, zoom, onZoom, start, onStart, playing, songBeat, loopBeat} = props;
  const bars = project.bars, step = Math.max(1, bars);
  const at = Math.floor(songBeat / 4), m = song.on ? markerAt(song, at) : -1;
  return <div className={'song-bar' + (song.on ? ' is-song' : '')}>
    <div className="song-row">
      <div className="fx-segment song-mode" role="radiogroup" aria-label="Play mode">
        <button type="button" role="radio" aria-checked={!song.on} className={!song.on ? 'active' : ''}
          title="Each track repeats its open clip" onClick={() => { if (song.on) onSong({...song, on:false}); onView('clips'); }}><Repeat1 size={16}/>Loop</button>
        <button type="button" role="radio" aria-checked={song.on} className={song.on ? 'active' : ''}
          title="Play the timeline" onClick={() => { if (!song.on) onSong({...song, on:true}); onView('arrange'); }}><Repeat size={16}/>Song</button>
      </div>
      <div className="fx-segment song-view" role="radiogroup" aria-label="View">
        <button type="button" role="radio" aria-checked={view==='arrange'} className={view==='arrange' ? 'active' : ''} onClick={() => onView('arrange')}>Timeline</button>
        <button type="button" role="radio" aria-checked={view==='clips'} className={view==='clips' ? 'active' : ''} onClick={() => onView('clips')}>Clip notes</button>
      </div>
      {view==='arrange' ? <>
        <span className="song-label">Length</span>
        <div className="song-stepper" role="group" aria-label="Song length">
          <button type="button" aria-label="Shorter song" disabled={song.length <= 1} onClick={() => onSong(setLength(song, song.length - step, bars))}><Minus size={16}/></button>
          <span aria-live="polite"><b>{song.length}</b> bars</span>
          <button type="button" aria-label="Longer song" disabled={song.length >= MAX_BARS} onClick={() => onSong(setLength(song, song.length + step, bars))}><Plus size={16}/></button>
        </div>
        <div className="fx-segment" role="radiogroup" aria-label="At the end">
          <button type="button" role="radio" aria-checked={song.loop} className={song.loop ? 'active' : ''} onClick={() => onSong({...song, loop:true})}>Loop song</button>
          <button type="button" role="radio" aria-checked={!song.loop} className={!song.loop ? 'active' : ''} onClick={() => onSong({...song, loop:false})}>Play once</button>
        </div>
        <span className="song-gap"/>
        <div className="fx-segment" role="radiogroup" aria-label="Bars in view">
          {ZOOMS.map(z => <button key={z} type="button" role="radio" aria-checked={zoom===z} className={zoom===z ? 'active' : ''} onClick={() => onZoom(z)}>{z}</button>)}
        </div>
        <div className="song-tools">
          <button type="button" aria-label="Earlier bars" disabled={start===0} onClick={() => onStart(Math.max(0, start - zoom / 2))}><ChevronLeft size={18}/></button>
          <button type="button" aria-label="Later bars" disabled={start + zoom >= MAX_BARS} onClick={() => onStart(Math.min(MAX_BARS - zoom, start + zoom / 2))}><ChevronRight size={18}/></button>
        </div>
      </> : <span className="song-gap"/>}
      <span className="song-readout" aria-label="Song position">
        {song.on && view==='arrange' ? <>{m >= 0 ? <em>{song.markers[m].name}</em> : null}{pad2(at + 1)}<span>.</span>{Math.floor(songBeat % 4) + 1}</>
          : <>{pad2(Math.floor(loopBeat / 4) + 1)}<span>:</span>{pad2(Math.floor(loopBeat % 4) + 1)}</>}
      </span>
    </div>
    {view==='arrange' ? <ContextRow {...props}/> : <div className="song-row song-edit">
      <span className="song-hint">Notes of each track's open clip. Tap the clip letter to open another clip, copy one, or clear it. Recording always goes into the open clip.</span>
      <span className="song-gap"/>
      <span className="timeline-summary song-summary">{bars} bars per clip · {project.tracks.reduce((n, t) => n + t.notes.length, 0)} notes</span>
    </div>}
  </div>;
}

/** The second row: tools for the selected block or bar, or a short hint. */
function ContextRow({project, song, onSong, sel, onSel, onClip, onEditClip}:BarProps) {
  const bars = project.bars;
  if (sel?.kind==='block') {
    const b = song.lanes[sel.track].find(x => x.at===sel.at);
    if (!b) return <div className="song-row song-edit"/>;
    const first = phase(b, b.at, bars) + 1, empty = emptyClip(project, sel.track);
    const edit = (patch:Partial<Block>) => onSong(changeBlock(song, sel.track, b.at, patch, bars));
    return <div className="song-row song-edit block-tools" role="group" aria-label="Block" style={{['--tc' as string]:TRACK_COLORS[sel.track]}}>
      <span className="bt-name"><i/>Track {sel.track + 1}<small>bars {b.at + 1}–{b.at + b.len}</small></span>
      <div className="fx-segment bt-clips" role="radiogroup" aria-label="Block clip">
        {Array.from({length:CLIPS}, (_, k) => <button key={k} type="button" role="radio" aria-checked={b.clip===k}
          aria-label={'Clip ' + CLIP_NAMES[k] + (clipNotes(project, sel.track, k).length ? '' : ', empty')}
          className={(b.clip===k ? 'active' : '') + (clipNotes(project, sel.track, k).length ? '' : ' empty')} onClick={() => edit({clip:k})}>{CLIP_NAMES[k]}</button>)}
      </div>
      <div className="song-stepper" role="group" aria-label="Block length">
        <button type="button" aria-label="Shorter block" disabled={b.len <= 1} onClick={() => edit({len:b.len - 1})}><Minus size={16}/></button>
        <span><b>{b.len}</b> {b.len===1 ? 'bar' : 'bars'}</span>
        <button type="button" aria-label="Longer block" disabled={b.at + b.len >= MAX_BARS} onClick={() => edit({len:b.len + 1})}><Plus size={16}/></button>
      </div>
      {bars > 1 ? <div className="song-stepper" role="group" aria-label="Starts on clip bar" title="Which bar of the clip the block starts on">
        <button type="button" aria-label="Start on an earlier clip bar" onClick={() => edit({off:(b.off ?? 0) - 1})}><Minus size={16}/></button>
        <span>from <b>{first}</b>/{bars}</span>
        <button type="button" aria-label="Start on a later clip bar" onClick={() => edit({off:(b.off ?? 0) + 1})}><Plus size={16}/></button>
      </div> : null}
      <div className="song-tools">
        <button type="button" aria-label="Duplicate block" title="Copy this block right after it" onClick={() => { onSong(duplicateBlock(song, sel.track, b.at, bars)); onSel({...sel, at:b.at + b.len, bar:b.at + b.len}); }}><Copy size={17}/></button>
        <button type="button" aria-label="Split block" title="Cut in two at the bar you tapped" disabled={b.len < 2} onClick={() => onSong(splitBlock(song, sel.track, b.at, sel.bar, bars))}><Scissors size={17}/></button>
        <button type="button" aria-label="Make a new clip from this block" title={empty===undefined ? 'All 8 clips are in use' : 'Copy clip ' + CLIP_NAMES[b.clip] + ' to ' + CLIP_NAMES[empty] + ' and use it here, for a variation or a fill'}
          disabled={empty===undefined} onClick={() => { if (empty===undefined) return; onClip(sel.track, 'copy', empty, b.clip); onClip(sel.track, 'open', empty); edit({clip:empty}); }}><Sparkles size={17}/></button>
        <button type="button" aria-label="Edit this clip's notes" title="Open this clip in Clip notes" onClick={() => onEditClip(sel.track, b.clip)}><Pencil size={17}/></button>
        <button type="button" aria-label="Delete block" onClick={() => { onSong(deleteBlock(song, sel.track, b.at)); onSel(null); }}><Trash2 size={17}/></button>
      </div>
      <span className="song-gap"/>
      <button type="button" className="mod-sheet-done" onClick={() => onSel(null)}>Done</button>
    </div>;
  }
  if (sel?.kind==='bar') {
    const mark = song.markers.find(m => m.bar===sel.bar);
    return <div className="song-row song-edit marker-tools" role="group" aria-label="Marker">
      <span className="bt-name"><Flag size={15}/>Bar {sel.bar + 1}</span>
      {mark ? <>
        <input className="song-name" aria-label="Marker name" value={mark.name} maxLength={24} onChange={e => onSong(setMarker(song, sel.bar, e.target.value))}/>
        <div className="fx-segment" role="radiogroup" aria-label="Marker names">
          {MARKER_NAMES.map(n => <button key={n} type="button" role="radio" aria-checked={mark.name===n} className={mark.name===n ? 'active' : ''}
            onClick={() => onSong(setMarker(song, sel.bar, n))}>{n}</button>)}
        </div>
        <div className="song-tools"><button type="button" aria-label="Delete marker" onClick={() => onSong(setMarker(song, sel.bar, null))}><Trash2 size={17}/></button></div>
      </> : <button type="button" className="song-action" disabled={sel.bar >= song.length} onClick={() => onSong(setMarker(song, sel.bar, nextMarkerName(song)))}>
        <Flag size={16}/>Add a marker here</button>}
      {sel.bar < song.length ? <button type="button" className="song-action" title="The song ends after this bar"
        onClick={() => { onSong(setLength(song, sel.bar + 1, bars)); }}>End song here</button> : null}
      <span className="song-gap"/>
      <button type="button" className="mod-sheet-done" onClick={() => onSel(null)}>Done</button>
    </div>;
  }
  return <div className="song-row song-edit">
    <span className="song-hint">{song.on
      ? 'Tap an empty bar to place the track\'s open clip there. Tap a block to change, copy or split it, or drag it to move it. Tap the ruler for markers.'
      : 'Song is off: each track repeats its open clip. Switch to Song to play this timeline.'}</span>
    <span className="song-gap"/>
    <span className="timeline-summary song-summary">{bars} {bars===1 ? 'bar' : 'bars'} per clip · {song.markers.length} {song.markers.length===1 ? 'marker' : 'markers'}</span>
  </div>;
}

/** Notes of the bars of a clip that a block plays, drawn across the block. */
function BlockNotes({notes, b, from, to, bars, color}:{notes:Note[]; b:Block; from:number; to:number; bars:number; color:string}) {
  if (!notes.length) return null;
  const lo = Math.min(...notes.map(n => n.note)), hi = Math.max(lo + 6, ...notes.map(n => n.note));
  const span = (to - from) * 4, rects:React.ReactNode[] = [];
  for (let bar = from; bar < to && rects.length < 400; bar++) {
    const ph = phase(b, bar, bars) * 4;
    notes.forEach((n, i) => {
      const s = n.start % (bars * 4);
      if (s < ph || s >= ph + 4) return;
      const x = ((bar - from) * 4 + s - ph) / span * 100;
      rects.push(<rect key={bar + ':' + i} x={x} y={27 - (n.note - lo) / (hi - lo) * 24} width={Math.max(.6, n.duration / span * 100)} height={2.6} rx={.8} fill={color}/>);
    });
  }
  return <svg className="blk-notes" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">{rects}</svg>;
}

type ArrProps = {
  project:Project; song:Song; selected:number; zoom:number; start:number; sel:SongSel; onSel(s:SongSel):void; onSong(s:Song):void;
  playing:boolean; songBeat:number; onSelect(track:number):void; onMute(track:number, next:boolean):void; onClips(track:number):void;
};

export function Arranger({project, song, selected, zoom, start, sel, onSel, onSong, playing, songBeat, onSelect, onMute, onClips}:ArrProps) {
  const open = clipsOf(project).open, bars = project.bars;
  const area = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{track:number; at:number; x:number; id:number; by:number; moved:boolean}|null>(null);
  const width = () => area.current?.getBoundingClientRect().width ?? 1;
  const barOf = (e:React.PointerEvent|React.MouseEvent) => {
    const r = area.current!.getBoundingClientRect();
    return start + Math.max(0, Math.min(zoom - 1, Math.floor((e.clientX - r.left) / r.width * zoom)));
  };
  useEffect(() => { const k = (e:KeyboardEvent) => { if (e.key==='Escape') onSel(null); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onSel]);
  const cells = Array.from({length:zoom}, (_, i) => start + i);
  const head = Math.floor(songBeat / 4), headPos = (songBeat / 4 - start) / zoom * 100;
  const tapLane = (track:number, e:React.MouseEvent) => {
    if (e.target!==e.currentTarget && !(e.target as Element).classList.contains('arr-cell')) return;
    onSelect(track);
    if (sel) { onSel(null); return; }  // a blank tap ends the selection first
    const bar = barOf(e);
    if (blockAt(song, track, bar)) return;
    onSong(place(song, track, bar, open[track], bars));
  };
  return <section className={'arranger' + (song.on ? '' : ' is-off')} aria-label="Song timeline">
    <div className="arr-row arr-ruler-row">
      <div className="arr-head arr-ruler-head"><Flag size={14}/>Markers</div>
      <div className="arr-ruler" role="group" aria-label="Bars">
        {cells.map(bar => {
          const m = song.markers.find(x => x.bar===bar);
          const picked = sel?.kind==='bar' && sel.bar===bar;
          return <button key={bar} type="button" className={'arr-tick' + (bar % bars===0 ? ' phrase' : '') + (bar >= song.length ? ' after' : '') + (picked ? ' picked' : '') + (m ? ' has-marker' : '')}
            aria-label={'Bar ' + (bar + 1) + (m ? ', marker ' + m.name : '')} onClick={() => onSel(picked ? null : {kind:'bar', bar})}>
            <span>{bar + 1}</span>{m ? <em className="arr-marker"><Flag size={11}/>{m.name}</em> : null}
          </button>;
        })}
        {song.length > start && song.length <= start + zoom ? <i className="arr-end" style={{left:(song.length - start) / zoom * 100 + '%'}} aria-hidden="true"/> : null}
      </div>
    </div>
    <div className="arr-lanes">
      {project.tracks.map((t, tr) => {
        const color = TRACK_COLORS[tr];
        return <div key={tr} className={'arr-row arr-lane-row' + (selected===tr ? ' active' : '') + (t.mute ? ' muted' : '')} style={{['--tc' as string]:color}}>
          <div className="arr-head">
            <button type="button" className="arr-title" aria-pressed={selected===tr} onClick={() => onSelect(tr)}>
              <span className="track-index">{pad2(tr + 1)}</span>
              <span className="track-glyph">{tr===1 ? <AudioWaveform size={15}/> : <Layers3 size={15}/>}</span>
              <strong>{t.preset}</strong>
            </button>
            <button type="button" className="lane-loop" aria-label={'Clips of track ' + (tr + 1) + ': clip ' + CLIP_NAMES[open[tr]] + ' is open'}
              title="The open clip: you record into it and empty bars get it" onClick={() => onClips(tr)}><b>{CLIP_NAMES[open[tr]]}</b><small>clip</small></button>
            <button type="button" className={'lane-mute' + (t.mute ? ' muted' : '')} aria-label={(t.mute ? 'Unmute ' : 'Mute ') + t.preset} aria-pressed={t.mute}
              onClick={() => onMute(tr, !t.mute)}>{t.mute ? <VolumeX size={18}/> : <Volume2 size={18}/>}</button>
          </div>
          <div className="arr-lane" ref={tr===0 ? area : undefined} role="group" aria-label={'Track ' + (tr + 1) + ' lane'} onClick={e => tapLane(tr, e)}>
            {cells.map(bar => <span key={bar} className={'arr-cell' + (bar % bars===0 ? ' phrase' : '') + (bar >= song.length ? ' after' : '')}
              style={{left:(bar - start) / zoom * 100 + '%', width:100 / zoom + '%'}}/>)}
            {song.lanes[tr].filter(b => b.at < start + zoom && b.at + b.len > start).map(b => {
              const by = drag && drag.track===tr && drag.at===b.at ? drag.by : 0;
              const from = Math.max(b.at, start - by), to = Math.min(b.at + b.len, start + zoom - by);
              const picked = sel?.kind==='block' && sel.track===tr && sel.at===b.at;
              const notes = clipNotes(project, tr, b.clip), playingHere = playing && song.on && head >= b.at && head < b.at + b.len;
              return <div key={b.at} role="button" tabIndex={0}
                aria-label={'Track ' + (tr + 1) + ' block ' + CLIP_NAMES[b.clip] + ', bars ' + (b.at + 1) + ' to ' + (b.at + b.len)}
                aria-pressed={picked} className={'arr-block' + (picked ? ' picked' : '') + (notes.length ? '' : ' empty') + (by ? ' dragging' : '') + (playingHere ? ' live' : '')}
                style={{left:(from + by - start) / zoom * 100 + '%', width:(to - from) / zoom * 100 + '%'}}
                onPointerDown={e => { if (e.button!==0) return; e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setDrag({track:tr, at:b.at, x:e.clientX, id:e.pointerId, by:0, moved:false}); }}
                onPointerMove={e => { if (!drag || drag.id!==e.pointerId) return;
                  const by = Math.round((e.clientX - drag.x) / width() * zoom), clamped = Math.max(-b.at, Math.min(MAX_BARS - b.len - b.at, by));
                  if (clamped!==drag.by || (!drag.moved && Math.abs(e.clientX - drag.x) > 8)) setDrag({...drag, by:clamped, moved:drag.moved || Math.abs(e.clientX - drag.x) > 8}); }}
                onPointerUp={e => { if (!drag || drag.id!==e.pointerId) return; const d = drag; setDrag(null); onSelect(tr);
                  if (d.by) { onSong(moveBlock(song, tr, b.at, b.at + d.by, bars)); onSel({kind:'block', track:tr, at:b.at + d.by, bar:b.at + d.by}); }
                  else if (!d.moved) onSel(picked ? null : {kind:'block', track:tr, at:b.at, bar:barOf(e)}); }}
                onPointerCancel={() => setDrag(null)} onClick={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key==='Enter' || e.key===' ') { e.preventDefault(); onSel({kind:'block', track:tr, at:b.at, bar:b.at}); } }}>
                <b className="blk-name">{CLIP_NAMES[b.clip]}</b>
                <BlockNotes notes={notes} b={b} from={from} to={to} bars={bars} color={color}/>
                {notes.length ? null : <small className="blk-empty">empty</small>}
              </div>;
            })}
            {playing && song.on && headPos >= 0 && headPos <= 100 ? <i className="arr-playhead" style={{left:headPos + '%'}} aria-hidden="true"/> : null}
          </div>
        </div>;
      })}
    </div>
  </section>;
}

function MiniLoop({notes, beats, color}:{notes:Note[]; beats:number; color:string}) {
  if (!notes.length) return <span className="ls-empty">empty</span>;
  const lo = Math.min(...notes.map(n => n.note)), hi = Math.max(lo + 6, ...notes.map(n => n.note));
  return <svg viewBox="0 0 100 30" className="ls-mini" aria-hidden="true">
    {notes.slice(0, 200).map((n, i) => <rect key={i} x={n.start / beats * 100} y={26 - (n.note - lo) / (hi - lo) * 24} width={Math.max(1.5, n.duration / beats * 100)} height={3} rx={1} fill={color}/>)}
  </svg>;
}

type SheetProps = {
  project:Project; song:Song; track:number; container:Element|null; onClose():void;
  onClip(track:number, action:'open'|'copy'|'clear', clip:number, source?:number):void;
};

/** One track's 8 clips: open one (you record into it and edit it; in Loop mode it plays), copy it to a new clip, or clear it. */
export function ClipSheet({project, song, track, container, onClose, onClip}:SheetProps) {
  // A steady listener: other Esc handlers re-render the page mid-event, and a re-added listener would miss that Esc.
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => { const k = (e:KeyboardEvent) => { if (e.key==='Escape') close.current(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  if (!container) return null;
  const open = clipsOf(project).open[track], color = TRACK_COLORS[track], beats = project.bars * 4;
  const empty = emptyClip(project, track);
  const uses = (k:number) => song.lanes[track].filter(b => b.clip===k).reduce((n, b) => n + b.len, 0);
  return createPortal(<div className="mod-sheet-backdrop loop-backdrop" onPointerDown={e => { if (e.target===e.currentTarget) onClose(); }}>
    <section className="mod-sheet loop-sheet" role="dialog" aria-label={'Track ' + (track + 1) + ' clips'} style={{['--src' as string]:color}}>
      <header className="mod-sheet-bar">
        <i className="pe-dot"/><strong>Track {track + 1} · {project.tracks[track].preset}</strong>
        <span className="pe-sub">Clips. The open one is what you record into and edit{song.on ? '' : ', and what Loop mode plays'}.</span>
        <span className="pe-gap"/>
        <button type="button" className="mod-sheet-done" onClick={onClose}>Done</button>
      </header>
      <div className="loop-body">
        <div className="loop-slots clip-slots" role="radiogroup" aria-label="Open clip">
          {Array.from({length:CLIPS}, (_, k) => {
            const notes = clipNotes(project, track, k), used = uses(k);
            return <button key={k} type="button" role="radio" aria-checked={open===k} aria-label={'Clip ' + CLIP_NAMES[k] + (notes.length ? ', ' + notes.length + ' notes' : ', empty')}
              className={'loop-slot' + (open===k ? ' active' : '') + (notes.length ? ' full' : '')} onClick={() => onClip(track, 'open', k)}>
              <b>{CLIP_NAMES[k]}</b><MiniLoop notes={notes} beats={beats} color={color}/>
              <small className="ls-use">{used ? 'in song: ' + used + (used===1 ? ' bar' : ' bars') : 'not in song'}</small>
            </button>;
          })}
        </div>
        <div className="loop-actions">
          <button type="button" disabled={empty===undefined || !clipNotes(project, track, open).length}
            onClick={() => { if (empty===undefined) return; onClip(track, 'copy', empty, open); onClip(track, 'open', empty); }}>
            <CopyPlus size={17}/>Copy {CLIP_NAMES[open]} to a new clip{empty!==undefined ? ' (' + CLIP_NAMES[empty] + ')' : ''}</button>
          <button type="button" disabled={!clipNotes(project, track, open).length} onClick={() => onClip(track, 'clear', open)}>
            <Eraser size={17}/>Clear clip {CLIP_NAMES[open]}</button>
          <span className="loop-tip">For a variation or a fill: copy a clip, change the copy, then put it on the timeline (tap a block and pick its letter).</span>
        </div>
      </div>
    </section>
  </div>, container);
}
