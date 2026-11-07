import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FlipHorizontal2, Shuffle, Square, SquareDashed } from 'lucide-react';
import { GATE_DIVS, GATE_LENGTHS, gateCell, gateOpen, gateToggle } from '../fx';

type Params = Record<string, number>;
const cellsOf = (p:Params) => GATE_LENGTHS[Math.round(p.length ?? 2)] ?? 8;

/** On the Audio gate card: the pattern at a glance, with the cell the song is in. Tap to edit it. */
export function GateStrip({params, beat, playing, onOpen}:{params:Params; beat:number; playing:boolean; onOpen():void}) {
  const L = cellsOf(params), now = playing ? gateCell(beat, params.length ?? 2, params.division ?? 2) : -1;
  return <button type="button" className="gate-strip" aria-label="Edit gate steps" onClick={onOpen}>
    <span className="gate-strip-cells" style={{gridTemplateColumns:`repeat(${L},minmax(0,1fr))`}}>
      {Array.from({length:L}, (_, k) => <i key={k} className={(gateOpen(params.steps ?? 0, k) ? 'open' : '') + (k===now ? ' now' : '')}/>)}
    </span>
    <span className="gate-strip-label">{L} × {GATE_DIVS[Math.round(params.division ?? 2)]} · Edit steps</span>
  </button>;
}

type SheetProps = {params:Params; color:string; beat:number; playing:boolean; container:Element|null;
  onParam(key:string, v:number):void; onClose():void};

/** The gate's own sheet: how many cells, how long each one is, and which ones let the sound through. */
export function GateSheet({params, color, beat, playing, container, onParam, onClose}:SheetProps) {
  useEffect(() => { const k = (e:KeyboardEvent) => { if (e.key==='Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  if (!container) return null;
  const L = cellsOf(params), steps = Math.round(params.steps ?? 0), all = (1 << L) - 1;
  const now = playing ? gateCell(beat, params.length ?? 2, params.division ?? 2) : -1;
  const setSteps = (v:number) => onParam('steps', v & 0xffff);
  // Cells past the length keep their bits, so a shorter gate can grow back to the same pattern.
  const fill = (bits:number) => setSteps((steps & ~all) | (bits & all));
  const pattern = (f:(k:number) => boolean) => fill(Array.from({length:L}, (_, k) => f(k) ? 1 << k : 0).reduce((a, b) => a | b, 0));
  return createPortal(<div className="mod-sheet-backdrop" onPointerDown={e => { if (e.target===e.currentTarget) onClose(); }}>
    <section className="mod-sheet gate-sheet" role="dialog" aria-label="Audio gate steps" style={{['--src' as string]:color}}>
      <header className="mod-sheet-bar">
        <i className="pe-dot"/><strong>Audio gate</strong>
        <span className="pe-sub">Lit cells let the sound through. The gate follows the song position.</span>
        <span className="pe-gap"/>
        <button type="button" className="mod-sheet-done" onClick={onClose}>Done</button>
      </header>
      <div className="gate-body">
        <div className="gate-row">
          <span className="song-label">Cells</span>
          <div className="fx-segment" role="radiogroup" aria-label="Gate cells">
            {GATE_LENGTHS.map((n, i) => <button key={n} type="button" role="radio" aria-checked={Math.round(params.length ?? 2)===i}
              className={Math.round(params.length ?? 2)===i ? 'active' : ''} onClick={() => onParam('length', i)}>{n}</button>)}
          </div>
          <span className="song-label">Cell size</span>
          <div className="fx-segment" role="radiogroup" aria-label="Gate cell size">
            {GATE_DIVS.map((d, i) => <button key={d} type="button" role="radio" aria-checked={Math.round(params.division ?? 2)===i}
              className={Math.round(params.division ?? 2)===i ? 'active' : ''} onClick={() => onParam('division', i)}>{d}</button>)}
          </div>
        </div>
        <div className="gate-cells" role="group" aria-label="Gate steps" style={{gridTemplateColumns:`repeat(${L},minmax(0,1fr))`}}>
          {Array.from({length:L}, (_, k) => {
            const on = gateOpen(steps, k);
            return <button key={k} type="button" aria-pressed={on} aria-label={'Cell ' + (k + 1) + (on ? ', open' : ', closed')}
              className={'gate-cell' + (on ? ' open' : '') + (k===now ? ' now' : '')} onClick={() => setSteps(gateToggle(steps, k))}>
              <b>{k + 1}</b></button>;
          })}
        </div>
        <div className="gate-row gate-tools">
          <button type="button" onClick={() => fill(all)}><Square size={16}/>All open</button>
          <button type="button" onClick={() => fill(0)}><SquareDashed size={16}/>All closed</button>
          <button type="button" onClick={() => fill(~steps)}><FlipHorizontal2 size={16}/>Invert</button>
          <button type="button" onClick={() => pattern(k => k % 2===0)}>On the beat</button>
          <button type="button" onClick={() => pattern(k => k % 2===1)}>Off-beat</button>
          <button type="button" onClick={() => pattern(() => Math.random() < .55)}><Shuffle size={16}/>Random</button>
          <span className="loop-tip">Smooth, Depth and Pump are on the card.</span>
        </div>
      </div>
    </section>
  </div>, container);
}
