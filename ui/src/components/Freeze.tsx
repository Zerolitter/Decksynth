/* Freeze a track to audio: the lane button, and the lane overlay (waveform, progress, out of date).
   A frozen track plays a WAV of itself instead of its synth and FX, which frees the Deck's CPU. */
import { RefreshCw, Snowflake, X } from 'lucide-react';
import type { FreezeHold, FreezeInfo, FreezeMeta } from '../types';

/** The freeze this track holds for one mode (Song timeline or Loop), if any. */
export function freezeFor(t:{freeze?:FreezeMeta;freeze_loop?:FreezeMeta}, mode:'song'|'loop') {
  return [t.freeze, t.freeze_loop].find(m => m?.mode===mode);
}

/** 'Song 16 bars + Loop 8 bars': what a freeze holds, in Sir's words. */
export function describeHolds(holds:FreezeHold[]|undefined) {
  return (holds ?? []).map(h => (h.mode==='song' ? 'Song ' : 'Loop ') + (+h.bars.toFixed(2)) + (h.bars===1 ? ' bar' : ' bars')).join(' + ');
}

/** Why a frozen track plays live: another track's Ducking or Vocoder hears its own sound, which the freeze doesn't hold. */
export function listenedText(info:FreezeInfo|undefined) {
  return 'Track ' + ((info?.by ?? 0) + 1) + ' listens to it (Ducking or Vocoder), so it plays live';
}

export function freezeLabel(info:FreezeInfo|undefined, name:string) {
  const s = info?.state ?? 'none';
  if (s==='rendering') return {aria:'Cancel freezing ' + name, title:'Freezing… tap to cancel'};
  if (s==='frozen') return {aria:'Unfreeze ' + name, title:'Frozen: plays as audio. Tap to play it live again'};
  if (s==='listened') return {aria:'Unfreeze ' + name, title:listenedText(info) + '. Tap to unfreeze'};
  if (s==='stale' || s==='missing') return {aria:'Refreeze ' + name, title:'Changed since it was frozen, so it plays live. Tap to freeze again'};
  return {aria:'Freeze ' + name, title:'Freeze: turn this track into audio to save CPU'};
}

/** One 44 px button in the lane head. Tap: freeze, cancel, unfreeze or refreeze, by state. */
export function FreezeButton({info, name, onFreeze, onUnfreeze}:{info?:FreezeInfo; name:string; onFreeze():void; onUnfreeze():void}) {
  const s = info?.state ?? 'none', label = freezeLabel(info, name);
  const act = () => (s==='rendering' || s==='frozen' || s==='listened') ? onUnfreeze() : onFreeze();
  return <button type="button" className={'lane-freeze is-' + s} aria-label={label.aria} title={label.title}
    aria-pressed={s==='frozen' || s==='listened'} onClick={e => { e.stopPropagation(); act(); }}>
    {s==='rendering' ? <X size={17}/> : s==='stale' || s==='missing' ? <RefreshCw size={16}/> : <Snowflake size={18}/>}
    {s==='rendering' ? <i className="lf-ring" style={{['--p' as string]:Math.round((info?.progress ?? 0) * 100)}} aria-hidden="true"/> : null}
  </button>;
}

/** The lane overlay. `mode` is the transport mode now; the waveform is drawn only when the lane shows
 *  the same thing the freeze holds (`waveMode`: the song timeline or the open loop). `span` is how many beats the lane shows from `from` (beats); the frozen pass
 *  covers `passBeats`. Nothing is drawn for a track that isn't frozen or freezing. */
export function FreezeOverlay({info, meta, mode, waveMode, from, span, passBeats, onFreeze, onUnfreeze}:{
  info?:FreezeInfo; meta?:FreezeMeta; mode:'song'|'loop'; waveMode:'song'|'loop'; from:number; span:number; passBeats:number;
  onFreeze():void; onUnfreeze():void;
}) {
  const s = info?.state ?? 'none';
  if (s==='none') return null;
  if (s==='rendering') {
    const p = Math.round((info?.progress ?? 0) * 100);
    return <div className="freeze-overlay is-rendering" aria-live="polite">
      <i className="fo-progress" style={{width:p + '%'}} aria-hidden="true"/>
      <span className="fo-chip"><Snowflake size={13}/>Freezing {p}%</span>
    </div>;
  }
  if (s==='listened') {
    return <div className="freeze-overlay is-stale">
      <span className="fo-chip"><Snowflake size={13}/>{listenedText(info)}. Freeze that track too, or unfreeze this one</span>
      <button type="button" className="fo-btn" onClick={e => { e.stopPropagation(); onUnfreeze(); }}>Unfreeze</button>
    </div>;
  }
  if (s!=='frozen') {
    return <div className="freeze-overlay is-stale">
      <span className="fo-chip">{s==='missing' ? 'Frozen audio file is missing' : 'Changed since freeze'} · plays live</span>
      <button type="button" className="fo-btn" onClick={e => { e.stopPropagation(); onFreeze(); }}><RefreshCw size={15}/>Refreeze</button>
      <button type="button" className="fo-btn" onClick={e => { e.stopPropagation(); onUnfreeze(); }}>Unfreeze</button>
    </div>;
  }
  const same = info?.holds ? info.holds.some(h => h.mode===mode && h.ok) : meta?.mode===mode;
  const peaks = meta?.peaks ?? [], top = Math.max(1e-6, ...peaks, 0);  // drawn relative to its own loudest point
  // The waveform of the frozen pass, placed on the lane's own beat scale.
  const pts:string[] = [];
  if (meta?.mode===waveMode && peaks.length && passBeats > 0) {
    peaks.forEach((v, i) => {
      const x = ((i + .5) / peaks.length * passBeats - from) / span * 100;
      if (x >= -2 && x <= 102) pts.push(x.toFixed(2) + ',' + (30 - Math.max(.04, v / top) * 26).toFixed(2));
    });
  }
  return <div className={'freeze-overlay is-frozen' + (same ? '' : ' other-mode')}>
    {pts.length > 1 ? <svg className="fo-wave" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={pts[0].split(',')[0] + ',30 ' + pts.join(' ') + ' ' + pts[pts.length - 1].split(',')[0] + ',30'}/>
    </svg> : null}
    <span className="fo-chip"><Snowflake size={13}/>{same ? 'Frozen · ' + (describeHolds(info?.holds) || 'audio') : 'Frozen for ' + (meta?.mode==='song' ? 'Song' : 'Loop') + ' mode · plays live here'}</span>
  </div>;
}

/** The Freeze sheet, opened from the snowflake in the top bar on every page. One row per track says what its
 *  freeze holds (the whole Song timeline and the Loop) and offers Freeze, Refreeze, Unfreeze or Cancel. */
export function FreezeSheet({tracks, infos, colors, onFreeze, onUnfreeze, onClose}:{
  tracks:{preset:string;device?:string;sampler?:{name:string}}[]; infos?:FreezeInfo[]; colors:readonly string[];
  onFreeze(t:number):void; onUnfreeze(t:number):void; onClose():void;
}) {
  const live = tracks.map((_, i) => infos?.[i]?.state ?? 'none');
  const name = (t:typeof tracks[number]) => t.device==='drum_rack' ? 'Drum Rack' : t.device==='sampler' ? (t.sampler?.name || 'Sampler') : t.preset;
  return <section className="freeze-sheet" role="dialog" aria-label="Freeze tracks" onPointerDown={e => e.stopPropagation()}>
    <header><Snowflake size={16}/><strong>Freeze</strong><span>Plays a track as audio to save CPU. It holds the whole Song and the Loop.</span>
      <button type="button" className="fs-close" onClick={onClose}>Done</button></header>
    {tracks.map((t, i) => {
      const info = infos?.[i], s = live[i], p = Math.round((info?.progress ?? 0) * 100);
      const holds = describeHolds(info?.holds);
      const what = s==='rendering' ? 'Freezing… ' + p + '%' : s==='frozen' ? 'Frozen · ' + holds
        : s==='listened' ? listenedText(info)
        : s==='stale' ? 'Changed since freeze · plays live' : s==='missing' ? 'Frozen file is missing · plays live' : 'Live';
      return <div key={i} className={'fs-row is-' + s} style={{['--track-accent' as string]:colors[i]}}>
        <span className="fs-no">{i + 1}</span>
        <span className="fs-text"><strong>{name(t)}</strong><small>{what}</small>
          {s==='rendering' ? <i className="fs-bar" style={{width:p + '%'}} aria-hidden="true"/> : null}</span>
        {s==='rendering' ? <button type="button" onClick={() => onUnfreeze(i)}><X size={16}/>Cancel</button>
          : s==='none' ? <button type="button" className="fs-go" onClick={() => onFreeze(i)}><Snowflake size={16}/>Freeze</button>
          : <>{s!=='frozen' && s!=='listened' ? <button type="button" className="fs-go" onClick={() => onFreeze(i)}><RefreshCw size={15}/>Refreeze</button> : null}
              <button type="button" onClick={() => onUnfreeze(i)}>Unfreeze</button></>}
      </div>;
    })}
  </section>;
}
