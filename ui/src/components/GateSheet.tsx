import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Knob } from './Knob';
import { FlipHorizontal2, Shuffle, Square, SquareDashed } from 'lucide-react';
import { GATE_DIVS, GATE_LENGTHS, gateOpen, gateToggle, type GateRuntime } from '../fx';

type Params = Record<string, number>;
const cellsOf = (p:Params) => GATE_LENGTHS[Math.round(p.length ?? 2)] ?? 8;

/** On the Audio gate card: the pattern at a glance, with the cell the song is in. Tap to edit it. */
export function GateStrip({params, runtime, onOpen}:{params:Params;runtime?:GateRuntime|null;onOpen():void}) {
  const L = cellsOf(params), now = runtime?.active ? runtime.cell : -1;
  return <button type="button" className="gate-strip" aria-label="Edit gate steps" onClick={onOpen}>
    <span className="gate-strip-cells" style={{gridTemplateColumns:`repeat(${L},minmax(0,1fr))`}}>
      {Array.from({length:L}, (_, k) => <i key={k} className={(gateOpen(params.steps ?? 0, k) ? 'open' : '') + (k===now ? ' now' : '')}/>)}
    </span>
    <span className="gate-strip-label">{L} × {GATE_DIVS[Math.round(params.division ?? 2)]} · Edit steps</span>
  </button>;
}

type SheetProps = {params:Params;color:string;runtime?:GateRuntime|null;container:Element|null;
  onParam(key:string, v:number):void; onClose():void};

/** The gate's own sheet: how many cells, how long each one is, and which ones let the sound through. */
export function GateSheet({params,color,runtime,container,onParam,onClose}:SheetProps) {
  useEffect(() => { const k = (e:KeyboardEvent) => { if (e.key==='Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  if (!container) return null;
  const L = cellsOf(params), steps = Math.round(params.steps ?? 0), all = (1 << L) - 1;
  const now = runtime?.active ? runtime.cell : -1;
  const setSteps = (v:number) => onParam('steps', v & 0xffff);
  // Cells past the length keep their bits, so a shorter gate can grow back to the same pattern.
  const fill = (bits:number) => setSteps((steps & ~all) | (bits & all));
  const pattern = (f:(k:number) => boolean) => fill(Array.from({length:L}, (_, k) => f(k) ? 1 << k : 0).reduce((a, b) => a | b, 0));
  return createPortal(<div className="mod-sheet-backdrop gate-backdrop" onPointerDown={e => { if (e.target===e.currentTarget) onClose(); }}>
    <section className="mod-sheet gate-sheet" role="dialog" aria-label="Audio gate steps" style={{['--src' as string]:color}}>
      <header className="mod-sheet-bar">
        <i className="pe-dot"/><strong>Audio gate</strong>
        <span className="pe-sub">Lit cells let the sound through.</span>
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
        <div className="gate-row gate-performance">
          <span className="song-label">Retrigger</span>
          <div className="fx-segment" role="radiogroup" aria-label="Gate retrigger">
            {['Always','No Notes','Never'].map((label,i)=><button key={label} type="button" role="radio"
              aria-checked={(params.retrig??2)===i} className={(params.retrig??2)===i?'active':''}
              onClick={()=>onParam('retrig',i)}>{label}</button>)}
          </div>
          <Knob id="gate-sheet-phase" name="Gate phase" defaultValue={0} value={params.phase??0} min={0} max={1} suffix="%" compact accent={color}
            onChange={v=>onParam('phase',v)}/>
          <Knob id="gate-sheet-notelen" name="Gate note length" defaultValue={1} value={params.notelen??1} min={0} max={1} suffix="%" compact accent={color}
            onChange={v=>onParam('notelen',v)}/>
          <button type="button" className="panel-toggle" aria-pressed={!!params.hold} aria-label={params.hold?'Resume gate':'Hold gate'}
            onClick={()=>onParam('hold',params.hold?0:1)}>{params.hold?'Resume':'Hold'}</button>
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
