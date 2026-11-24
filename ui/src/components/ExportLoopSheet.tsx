import { useEffect, useRef, useState } from 'react';
import { FileAudio } from 'lucide-react';

export type LoopKind = 'pass' | 'tail' | 'loop';
export type LoopExport = { track: number | null; kind: LoopKind; headroom: boolean };

const KINDS: { id: LoopKind; label: string; hint: string }[] = [
  { id: 'loop', label: 'Seamless loop', hint: 'Repeats without a click: the end rings into the start' },
  { id: 'tail', label: 'With tail', hint: 'One pass, then the ring-out, cut to whole beats' },
  { id: 'pass', label: 'One pass', hint: 'Exactly the loop, from silence' },
];

/** Export the open loop as a WAV for a DAW or the Sampler: which tracks, how long, what level. */
export function ExportLoopSheet({ selected, trackName, bars, bpm, exporting, onExport, onClose }: {
  selected: number; trackName: string; bars: number; bpm: number; exporting: number | null | undefined;
  onExport(choice: LoopExport, name: string): void; onClose(): void;
}) {
  const [track, setTrack] = useState<number | null>(selected);
  const [kind, setKind] = useState<LoopKind>('loop');
  const [headroom, setHeadroom] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  // Close once the export this sheet started has finished (the message says where it went).
  useEffect(() => {
    if (exporting != null) started.current = true;
    else if (started.current) onClose();
  }, [exporting, onClose]);
  const busy = exporting != null;
  const base = (track === null ? 'mix' : trackName).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'loop';
  const name = `${base}-${Math.round(bpm)}bpm-${bars}bar${bars === 1 ? '' : 's'}${kind === 'loop' ? '-loop' : kind === 'tail' ? '-tail' : ''}.wav`;
  return <div className="smp-sheet-screen" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="smp-sheet export-loop-sheet" role="dialog" aria-label="Export loop as WAV" style={{ ['--pad-accent' as string]: 'var(--accent)' }}>
      <header><FileAudio size={20} /><h2>Export loop as WAV <em>{bars} bar{bars === 1 ? '' : 's'} · {Math.round(bpm)} BPM</em></h2>
        <button type="button" className="smp-done" onClick={onClose}>Close</button></header>
      <div className="xl-row" role="radiogroup" aria-label="What">
        <span>What</span>
        <button type="button" role="radio" aria-checked={track !== null} disabled={busy} onClick={() => setTrack(selected)}>Track {selected + 1} · {trackName}</button>
        <button type="button" role="radio" aria-checked={track === null} disabled={busy} onClick={() => setTrack(null)}>Whole mix</button>
      </div>
      <div className="xl-row" role="radiogroup" aria-label="Length">
        <span>Length</span>
        {KINDS.map(k => <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} disabled={busy} title={k.hint} onClick={() => setKind(k.id)}>{k.label}</button>)}
      </div>
      <div className="xl-row" role="radiogroup" aria-label="Level">
        <span>Level</span>
        <button type="button" role="radio" aria-checked={!headroom} disabled={busy} onClick={() => setHeadroom(false)}>As played</button>
        <button type="button" role="radio" aria-checked={headroom} disabled={busy} title="Turned down, never up, so the peak sits at −6 dB" onClick={() => setHeadroom(true)}>Headroom −6 dB</button>
      </div>
      <p className="xl-hint">{KINDS.find(k => k.id === kind)!.hint}.</p>
      <footer>
        {busy ? <div className="xl-progress" role="progressbar" aria-label="Exporting" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((exporting ?? 0) * 100)}>
          <i style={{ width: Math.round((exporting ?? 0) * 100) + '%' }} /><b>Exporting {Math.round((exporting ?? 0) * 100)} %</b></div>
          : <button type="button" className="smp-make" onClick={() => onExport({ track, kind, headroom }, name)}><FileAudio size={18} />Export…</button>}
      </footer>
    </div>
  </div>;
}
