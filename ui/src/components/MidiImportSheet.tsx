import { useEffect, useState } from 'react';
import { FileUp } from 'lucide-react';
import { noteName } from '../types';

export type MidiChannel = { channel: number; notes: number; low: number; high: number };
export type MidiFile = { path: string; channels: MidiChannel[] };

/** Which channels of a MIDI file go into the open clip. Drums (channel 10) start unticked unless the track is a Drum Rack. */
export function MidiImportSheet({ file, trackName, drums, onImport, onClose }: {
  file: MidiFile; trackName: string; drums: boolean; onImport(channels: number[]): void; onClose(): void;
}) {
  const [chosen, setChosen] = useState<Set<number>>(() => {
    const all = file.channels.map(c => c.channel);
    const pick = all.filter(c => (c === 10) === drums);
    return new Set(pick.length ? pick : all);
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const toggle = (c: number) => setChosen(prev => { const next = new Set(prev); if (next.has(c)) next.delete(c); else next.add(c); return next; });
  const fileName = file.path.split(/[\\/]/).pop();
  const count = file.channels.filter(c => chosen.has(c.channel)).reduce((sum, c) => sum + c.notes, 0);
  return <div className="smp-sheet-screen" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="smp-sheet midi-import-sheet" role="dialog" aria-label="Import MIDI to clip" style={{ ['--pad-accent' as string]: 'var(--accent)' }}>
      <header><FileUp size={20} /><h2>Import <em>{fileName}</em> to {trackName}</h2>
        <button type="button" className="smp-done" onClick={onClose}>Close</button></header>
      <div className="smp-targets" role="group" aria-label="Channels">
        {file.channels.map(c => <button key={c.channel} type="button" aria-pressed={chosen.has(c.channel)} onClick={() => toggle(c.channel)}>
          <b>Channel {c.channel}{c.channel === 10 ? ' · drums' : ''}</b>
          <span>{c.notes} note{c.notes === 1 ? '' : 's'} · {c.low === c.high ? noteName(c.low) : noteName(c.low) + '–' + noteName(c.high)}</span></button>)}
      </div>
      <footer><button type="button" className="smp-make" disabled={!chosen.size} onClick={() => onImport([...chosen].sort((a, b) => a - b))}>
        <FileUp size={18} />{chosen.size ? `Replace the clip with ${count} note${count === 1 ? '' : 's'}` : 'Choose a channel'}</button></footer>
    </div>
  </div>;
}
