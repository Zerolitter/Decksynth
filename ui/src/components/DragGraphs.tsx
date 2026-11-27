// Round 2 (Sir, 16 Nov): graphs you edit by dragging their points, on the big waveform panel.
// Envelope (attack, hold, decay over the sound), Tone (cuts, shelves and the mid bell over a
// frequency grid) and a live compressor meter with a threshold line. Each drag is heard live and
// saved as one undo step when you let go; Shift drags finer; double-click a point resets it.
import { useRef, useState, type ReactNode } from 'react';
import type { DrumShape } from '../types';
import { padGain, padLength, responseDb } from '../drum-shape-graph';

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export type DragHandle = { key: string; label: string; x: number; y: number; axis: 'x' | 'y' | 'xy'; text: string; line?: boolean };

/** A box with points to drag. Positions are 0..1 of the box (y 0 is the top). */
export function DragBox({ className = '', label, handles, children, onMove, onDone, onReset }: {
  className?: string; label: string; handles: DragHandle[]; children?: ReactNode;
  onMove(key: string, x: number, y: number): void; onDone(key: string): void; onReset?(key: string): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: string; id: number; px: number; py: number; hx: number; hy: number; moved: boolean } | null>(null);
  const rel = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height)];
  };
  const end = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    drag.current = null; if (d.moved) onDone(d.key);
  };
  return <div ref={box} className={'drag-box ' + className} role="group" aria-label={label}>
    {children}
    {handles.map((h, i) => <button key={h.key} type="button" data-handle={h.key}
      className={'drag-handle axis-' + h.axis + (h.line ? ' is-line' : '') + (h.x > .78 ? ' label-left' : '')
        + (handles.some((o, j) => j < i && Math.abs(o.x - h.x) < .06 && Math.abs(o.y - h.y) < .2) ? ' label-stack' : '')}
      style={{ left: clamp(h.x, .012, .988) * 100 + '%', top: clamp(h.y, .03, .97) * 100 + '%' }}
      aria-label={h.label + ', ' + h.text} title={h.label + ': ' + h.text + ' · drag, Shift for fine, double-click resets'}
      onPointerDown={e => {
        if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const [px, py] = rel(e); drag.current = { key: h.key, id: e.pointerId, px, py, hx: h.x, hy: h.y, moved: false };
      }}
      onPointerMove={e => {
        const d = drag.current; if (!d || d.id !== e.pointerId) return;
        const [px, py] = rel(e), k = e.shiftKey ? .2 : 1;
        if (!d.moved && Math.hypot((px - d.px) * 400, (py - d.py) * 100) < 2) return;
        d.moved = true;
        onMove(h.key, clamp(d.hx + (px - d.px) * k), clamp(d.hy + (py - d.py) * k));
      }}
      onPointerUp={end} onPointerCancel={end}
      onDoubleClick={() => onReset?.(h.key)}
      onKeyDown={e => {
        const s = e.shiftKey ? .002 : .01;
        const dx = e.key === 'ArrowRight' ? s : e.key === 'ArrowLeft' ? -s : 0, dy = e.key === 'ArrowDown' ? s : e.key === 'ArrowUp' ? -s : 0;
        if ((!dx || h.axis === 'y') && (!dy || h.axis === 'x')) return;
        e.preventDefault(); onMove(h.key, clamp(h.x + dx), clamp(h.y + dy)); onDone(h.key);
      }}><i /><span>{h.label}</span></button>)}
  </div>;
}

type ShapeEdit = { onDraft(p: Partial<DrumShape>): void; onCommit(p: Partial<DrumShape>): void };
const msText = (s: number) => s <= 0 ? '0 ms' : s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s';
/** Keeps the edit made while dragging, to save it on release. */
function useDraft(onDraft: (p: Partial<DrumShape>) => void, onCommit: (p: Partial<DrumShape>) => void) {
  const pending = useRef<Partial<DrumShape>>({});
  return {
    move(p: Partial<DrumShape>) { pending.current = { ...pending.current, ...p }; onDraft(pending.current); },
    done() { const p = pending.current; pending.current = {}; if (Object.keys(p).length) onCommit(p); },
  };
}

const LEVEL_Y = (l: number) => .9 - l * .8;

/** The pad's level over time, drawn over its sound. Attack, Hold and Decay are points to drag. */
export function EnvelopeView({ shape, seconds, step, peaks, at, onDraft, onCommit }: {
  shape: DrumShape; seconds: number; step: number; peaks: number[][]; at: number[];
} & ShapeEdit) {
  const d = useDraft(onDraft, onCommit);
  const span = Math.max(1e-4, (shape.end - shape.start) * seconds / step);
  const total = shape.attack + shape.hold + Math.max(0, shape.decay);
  const natural = Math.max(span, total, .05) * 1.12;
  const [frozen, setFrozen] = useState<number | null>(null);  // the time axis holds still while you drag
  const T = frozen ?? natural;
  const length = padLength(shape, seconds, step);
  const W = 1000, H = 100, N = 220;
  const amp = (t: number) => {
    if (t > span || !peaks.length) return 0;
    const u = shape.reverse ? shape.end - t / span * (shape.end - shape.start) : shape.start + t / span * (shape.end - shape.start);
    const p = peaks[Math.min(peaks.length - 1, Math.max(0, Math.floor(u * peaks.length)))];
    return p ? Math.max(Math.abs(p[0]), Math.abs(p[1])) : 0;
  };
  const wave = (gain: (t: number) => number) => {
    const top: string[] = [], bottom: string[] = [];
    for (let i = 0; i <= N; i++) {
      const t = T * i / N, a = Math.min(1, amp(t) * gain(t)) * .4 * H;
      top.push((i / N * W).toFixed(1) + ' ' + (H / 2 - a).toFixed(1)); bottom.unshift((i / N * W).toFixed(1) + ' ' + (H / 2 + a).toFixed(1));
    }
    return 'M' + top.join('L') + 'L' + bottom.join('L') + 'Z';
  };
  const gain = (t: number) => t <= length ? padGain(shape, t, length) : 0;
  const line: string[] = [];
  for (let i = 0; i <= N; i++) { const t = T * i / N; line.push((i / N * W).toFixed(1) + ' ' + (LEVEL_Y(gain(t)) * H).toFixed(1)); }
  const decayOff = shape.decay <= 0, playsAll = decayOff && shape.hold <= 0;
  const fadeIn = Math.max(0, shape.fade_in), fadeOut = Math.max(0, shape.fade_out);
  const handles: DragHandle[] = [
    { key: 'attack', label: 'Attack', x: shape.attack / T, y: LEVEL_Y(1), axis: 'x', text: msText(shape.attack) },
    // With Decay off, Hold 0 means "plays to the end", so its point sits at the end of the sound, not at the start
    // (Sir, 16 Nov: dragging Hold to the left edge made the whole sound jump back).
    { key: 'hold', label: 'Hold', x: (playsAll ? span : shape.attack + shape.hold) / T, y: LEVEL_Y(1), axis: 'x', text: playsAll ? 'to the end' : msText(shape.hold) },
    { key: 'decay', label: decayOff ? 'Decay off' : 'Decay', x: (playsAll ? span : shape.attack + shape.hold + Math.max(0, shape.decay)) / T, y: LEVEL_Y(0), axis: 'x', text: decayOff ? 'off, plays to the end' : msText(shape.decay) },
    // Round 4: the fades sit on the sound's middle line, at the start and the end of what plays.
    { key: 'fade_in', label: 'Fade in', x: Math.min(fadeIn, length) / T, y: .5, axis: 'x', text: msText(fadeIn) },
    { key: 'fade_out', label: 'Fade out', x: Math.max(0, length - fadeOut) / T, y: .5, axis: 'x', text: msText(fadeOut) },
  ];
  const move = (key: string, x: number) => {
    if (frozen === null) setFrozen(T);
    const t = x * T;
    if (key === 'attack') d.move({ attack: Math.round(clamp(t, 0, 1) * 1000) / 1000 });
    // No drag flips the pad between "stops here" and "plays to the end": with Decay off, Hold reaches 0 (to the end)
    // only at the end of the sound, and Decay never drops to off (double-click it to turn it off).
    if (key === 'hold') d.move({ hold: decayOff
      ? (t >= span - .002 ? 0 : Math.round(clamp(t - shape.attack, .005, 4) * 1000) / 1000)
      : Math.round(clamp(t - shape.attack, 0, 4) * 1000) / 1000 });
    if (key === 'decay') d.move({ decay: Math.round(clamp(t - shape.attack - shape.hold, .005, 8) * 1000) / 1000 });
    const fade = (v: number) => { const c = clamp(v, 0, Math.min(2, length)); return c < .002 ? 0 : Math.round(c * 1000) / 1000; };
    if (key === 'fade_in') d.move({ fade_in: fade(t) });
    if (key === 'fade_out') d.move({ fade_out: fade(length - t) });
  };
  const ticks = [0, .25, .5, .75, 1];
  return <div className="drag-graph drag-envelope">
    <DragBox label="Envelope: drag Attack, Hold, Decay and the fades" handles={handles} onMove={move}
      onDone={() => { d.done(); setFrozen(null); }} onReset={key => onCommit({ [key]: 0 } as Partial<DrumShape>)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {[1, .5, .25].map(l => <line key={l} className="grid" x1={0} x2={W} y1={LEVEL_Y(l) * H} y2={LEVEL_Y(l) * H} />)}
        {ticks.slice(1, -1).map(f => <line key={f} className="grid" x1={f * W} x2={f * W} y1={0} y2={H} />)}
        <line className="grid zero" x1={0} x2={W} y1={H / 2} y2={H / 2} />
        <path className="wave-source" d={wave(() => 1)} />
        <path className="wave-heard" d={wave(gain)} />
        <path className="env-fill" d={'M0 ' + (LEVEL_Y(0) * H) + 'L' + line.join('L') + 'L' + W + ' ' + (LEVEL_Y(0) * H) + 'Z'} />
        <path className="env-line" d={'M' + line.join('L')} vectorEffect="non-scaling-stroke" />
        {fadeIn > 0 ? <><path className="fade-zone" d={`M0 0L${Math.min(fadeIn, length) / T * W} 0L0 ${H}Z`} />
          <line className="fade-line" x1={0} y1={H} x2={Math.min(fadeIn, length) / T * W} y2={0} vectorEffect="non-scaling-stroke" /></> : null}
        {fadeOut > 0 ? <><path className="fade-zone" d={`M${Math.max(0, length - fadeOut) / T * W} 0L${length / T * W} 0L${length / T * W} ${H}Z`} />
          <line className="fade-line" x1={Math.max(0, length - fadeOut) / T * W} y1={0} x2={length / T * W} y2={H} vectorEffect="non-scaling-stroke" /></> : null}
        {span < T ? <line className="grid end" x1={span / T * W} x2={span / T * W} y1={0} y2={H} /> : null}
        {at.map((f, i) => <line key={i} className="playhead" x1={f * length / T * W} x2={f * length / T * W} y1={0} y2={H} vectorEffect="non-scaling-stroke" />)}
      </svg>
      <span className="drag-axis-label top">0 dB</span><span className="drag-axis-label mid">-6</span>
    </DragBox>
    <div className="drag-ruler" aria-hidden="true">{ticks.map(f => <span key={f} style={{ left: f * 100 + '%' }}>{msText(f * T)}</span>)}</div>
  </div>;
}

const FX = (f: number) => Math.log10(f / 20) / 3;
const FREQ = (x: number) => 20 * 1000 ** x;
const DB_Y = (db: number) => .5 - clamp(db, -24, 24) / 24 * .44;
const Y_DB = (y: number) => (.5 - y) / .44 * 24;
const hz = (f: number) => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + ' kHz' : Math.round(f) + ' Hz';
const db = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';

/** EQ and cut filters as one response curve. Low cut, Low, Mid, High and High cut are points to drag. */
export function ToneView({ shape, onDraft, onCommit }: { shape: DrumShape } & ShapeEdit) {
  const d = useDraft(onDraft, onCommit);
  const W = 1000, H = 100, pts: string[] = [];
  for (let i = 0; i <= 120; i++) pts.push((i / 120 * W).toFixed(1) + ' ' + (DB_Y(responseDb(shape, FREQ(i / 120))) * H).toFixed(1));
  const on = (f: number) => DB_Y(responseDb(shape, f));
  const handles: DragHandle[] = [
    { key: 'low_cut', label: 'Low cut', x: FX(shape.low_cut), y: on(shape.low_cut), axis: 'x', text: shape.low_cut <= 20.5 ? 'off' : hz(shape.low_cut) },
    { key: 'eq_low', label: 'Low', x: FX(200), y: DB_Y(shape.eq_low), axis: 'y', text: db(shape.eq_low) + ' at 200 Hz' },
    { key: 'mid', label: 'Mid', x: FX(shape.eq_freq), y: DB_Y(shape.eq_mid), axis: 'xy', text: db(shape.eq_mid) + ' at ' + hz(shape.eq_freq) },
    { key: 'eq_high', label: 'High', x: FX(5000), y: DB_Y(shape.eq_high), axis: 'y', text: db(shape.eq_high) + ' at 5 kHz' },
    { key: 'high_cut', label: 'High cut', x: FX(shape.high_cut), y: on(shape.high_cut), axis: 'x', text: shape.high_cut >= 19999.5 ? 'off' : hz(shape.high_cut) },
  ];
  const gain = (y: number) => Math.round(clamp(Y_DB(y), -18, 18) * 2) / 2;
  const move = (key: string, x: number, y: number) => {
    const f = FREQ(x);
    if (key === 'low_cut') d.move({ low_cut: Math.round(clamp(f, 20, 2000)) });
    if (key === 'high_cut') d.move({ high_cut: Math.round(clamp(f, 500, 20000) / 10) * 10 });
    if (key === 'eq_low') d.move({ eq_low: gain(y) });
    if (key === 'eq_high') d.move({ eq_high: gain(y) });
    if (key === 'mid') d.move({ eq_mid: gain(y), eq_freq: Math.round(clamp(f, 100, 8000) / 10) * 10 });
  };
  const reset = (key: string) => onCommit(key === 'mid' ? { eq_mid: 0, eq_freq: 1000 } : key === 'low_cut' ? { low_cut: 20 } : key === 'high_cut' ? { high_cut: 20000 } : { [key]: 0 } as Partial<DrumShape>);
  return <div className="drag-graph drag-tone">
    <DragBox label="Tone: drag Low cut, Low, Mid, High and High cut" handles={handles} onMove={move} onDone={() => d.done()} onReset={reset}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {[100, 1000, 10000].map(f => <line key={f} className="grid" x1={FX(f) * W} x2={FX(f) * W} y1={0} y2={H} />)}
        {[12, -12].map(v => <line key={v} className="grid" x1={0} x2={W} y1={DB_Y(v) * H} y2={DB_Y(v) * H} />)}
        <line className="grid zero" x1={0} x2={W} y1={H / 2} y2={H / 2} />
        <path className="env-fill" d={'M0 ' + H / 2 + 'L' + pts.join('L') + 'L' + W + ' ' + H / 2 + 'Z'} />
        <path className="env-line" d={'M' + pts.join('L')} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="drag-axis-label top">+12</span><span className="drag-axis-label low">-12</span>
    </DragBox>
    <div className="drag-ruler" aria-hidden="true">{[20, 100, 1000, 10000, 20000].map(f => <span key={f} style={{ left: FX(f) * 100 + '%' }}>{hz(f)}</span>)}</div>
  </div>;
}

/** Live level going into the pad's compressor, what comes out, and the Threshold as a line to drag. */
export function CompMeter({ shape, level, onDraft, onCommit }: { shape: DrumShape; level?: number[] | null } & ShapeEdit) {
  const d = useDraft(onDraft, onCommit);
  const Y = (v: number) => clamp(-v / 48);   // 0 dB at the top, -48 at the bottom
  const [inDb, outDb] = level ?? [-99, -99];
  const handles: DragHandle[] = [{ key: 'thr', label: 'Threshold', x: .5, y: Y(shape.comp_threshold), axis: 'y', line: true, text: shape.comp_threshold.toFixed(1) + ' dB' }];
  const over = level && inDb > shape.comp_threshold && shape.comp_ratio > 1;
  return <div className={'comp-meter' + (shape.comp_ratio <= 1 ? ' is-off' : '') + (over ? ' is-over' : '')}>
    <DragBox label="Compressor level and threshold" handles={handles}
      onMove={(_, __, y) => d.move({ comp_threshold: Math.round(clamp(-y * 48, -48, 0) * 2) / 2 })}
      onDone={() => d.done()} onReset={() => onCommit({ comp_threshold: -18 })}>
      <div className="comp-meter-scale" aria-hidden="true">{[0, 12, 24, 36].map(db => <i key={db} style={{ top: Y(-db) * 100 + '%' }}>{db ? '-' + db : '0'}</i>)}</div>
      <div className="comp-meter-bars" role="meter" aria-label="Level into the compressor" aria-valuemin={-48} aria-valuemax={0} aria-valuenow={Math.round(Math.max(-48, inDb) * 10) / 10}>
        <span className="slot"><b className="in" style={{ height: (1 - Y(inDb)) * 100 + '%' }} /></span>
        <span className="slot"><b className="out" style={{ height: (1 - Y(outDb)) * 100 + '%' }} /></span>
      </div>
    </DragBox>
    <div className="comp-meter-legend" aria-hidden="true"><span>In</span><span>Out</span></div>
  </div>;
}

// ---- Sampler: the same drag points on its big panel ----

type LiveEdit = { onLive(key: string, value: number): void; onCommit(patch: Record<string, number>): void };
/** Keeps a drag's values: heard at once through onLive, saved as one patch (one undo step) on release. */
function useLive(onLive: (k: string, v: number) => void, onCommit: (p: Record<string, number>) => void) {
  const pending = useRef<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, number>>({});
  return {
    draft,
    move(p: Record<string, number>) { pending.current = { ...pending.current, ...p }; setDraft(pending.current); for (const [k, v] of Object.entries(p)) onLive(k, v); },
    done() { const p = pending.current; pending.current = {}; setDraft({}); if (Object.keys(p).length) onCommit(p); },
  };
}

/** The Sampler's amp envelope over its sound: Attack, Decay (with the sustain level) and Release to drag, and (27 Nov)
 *  Fade in and Fade out on the sound's middle line at the start and end of what plays, like the Drum Rack's. */
export function SamplerEnvView({ env, fades, seconds, region, peaks, view = [0, 1], playing = [], reverse = false, scale: scaleProp, onLive, onCommit }: {
  env: { attack: number; decay: number; sustain: number; release: number }; seconds: number; region: [number, number]; peaks: number[][];
  /** the fades (seconds of the sample); left out in Grain mode. A loop never reaches End, so it has no Fade out point. */
  fades?: { fade_in: number; fade_out: number; looping: boolean };
  /** the part of the sample (0..1) the peaks cover */ view?: number[];
  /** where the sounding voices are, 0..1 of the sample */ playing?: number[]; reverse?: boolean;
  /** the time scale, when the tool rack holds its switch (Whole : Env) */ scale?: 'sound' | 'env';
} & LiveEdit) {
  const d = useLive(onLive, onCommit);
  const e = { ...env, ...d.draft };
  const span = Math.max(1e-4, (region[1] - region[0]) * seconds);
  const fadeIn = fades ? Math.min(span, Math.max(0, d.draft.fade_in ?? fades.fade_in)) : 0;
  const fadeOut = fades && !fades.looping ? Math.min(span, Math.max(0, d.draft.fade_out ?? fades.fade_out)) : 0;
  const fadeGain = (t: number) => (fadeIn > 0 && t < fadeIn ? t / fadeIn : 1) * (fadeOut > 0 && t > span - fadeOut ? Math.max(0, span - t) / fadeOut : 1);
  // Sound: the whole sample with the key held until near its end (like the Drum Rack). Envelope: zoomed in on the ADSR times.
  const [ownScale, setScale] = useState<'sound' | 'env'>('sound');
  const scale = scaleProp ?? ownScale;
  const short = Math.max(.15, (e.attack + e.decay + e.release) * .35);
  const holdShown = scale === 'sound' ? Math.max(short, span - e.attack - e.decay - Math.min(e.release, span * .25)) : short;
  const natural = Math.max(.2, scale === 'sound' ? Math.max(span, e.attack + e.decay + holdShown + e.release) : e.attack + e.decay + holdShown + e.release) * (scale === 'sound' ? 1.03 : 1.12);
  const [frozen, setFrozen] = useState<number | null>(null);
  const T = frozen ?? natural, W = 1000, H = 100, N = 260;
  const keyUp = e.attack + e.decay + holdShown;
  const heads = playing.map(f => (reverse ? region[1] - f : f - region[0]) / Math.max(1e-9, region[1] - region[0]) * span).filter(t => t >= 0 && t <= T);
  const level = (t: number) => {
    if (t < e.attack) return e.attack > 0 ? t / e.attack : 1;
    if (t < e.attack + e.decay) return 1 - (1 - e.sustain) * (t - e.attack) / Math.max(1e-6, e.decay);
    if (t < keyUp) return e.sustain;
    if (t < keyUp + e.release) return e.sustain * (1 - (t - keyUp) / Math.max(1e-6, e.release));
    return 0;
  };
  const amp = (t: number) => {
    if (t > span || !peaks.length) return 0;
    const u = region[0] + t / span * (region[1] - region[0]), f = (u - view[0]) / Math.max(1e-9, view[1] - view[0]);
    if (f < 0 || f >= 1) return 0;
    const p = peaks[Math.min(peaks.length - 1, Math.floor(f * peaks.length))];
    return p ? Math.max(Math.abs(p[0]), Math.abs(p[1])) : 0;
  };
  const top: string[] = [], bottom: string[] = [], line: string[] = [], htop: string[] = [], hbottom: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = T * i / N, a = Math.min(1, amp(t)) * .4 * H, x = (i / N * W).toFixed(1), h = a * level(t) * fadeGain(t);
    top.push(x + ' ' + (H / 2 - a).toFixed(1)); bottom.unshift(x + ' ' + (H / 2 + a).toFixed(1));
    htop.push(x + ' ' + (H / 2 - h).toFixed(1)); hbottom.unshift(x + ' ' + (H / 2 + h).toFixed(1));
    line.push(x + ' ' + (LEVEL_Y(level(t)) * H).toFixed(1));
  }
  const handles: DragHandle[] = [
    { key: 'attack', label: 'Attack', x: e.attack / T, y: LEVEL_Y(1), axis: 'x', text: msText(e.attack) },
    { key: 'decay', label: 'Decay · Sustain', x: (e.attack + e.decay) / T, y: LEVEL_Y(e.sustain), axis: 'xy', text: msText(e.decay) + ', sustain ' + Math.round(e.sustain * 100) + '%' },
    { key: 'release', label: 'Release', x: (keyUp + e.release) / T, y: LEVEL_Y(0), axis: 'x', text: msText(e.release) },
  ];
  if (fades) handles.push({ key: 'fade_in', label: 'Fade in', x: fadeIn / T, y: .5, axis: 'x', text: fadeIn > 0 ? msText(fadeIn) : 'off' });
  if (fades && !fades.looping && span <= T) handles.push({ key: 'fade_out', label: 'Fade out', x: (span - fadeOut) / T, y: .5, axis: 'x', text: fadeOut > 0 ? msText(fadeOut) : 'off' });
  const fade = (v: number) => { const c = clamp(v, 0, Math.min(2, span)); return c < .002 ? 0 : Math.round(c * 1000) / 1000; };
  const r3 = (v: number) => Math.round(clamp(v, 0, 3) * 1000) / 1000;
  const move = (key: string, x: number, y: number) => {
    if (frozen === null) setFrozen(T);
    const t = x * T;
    if (key === 'attack') d.move({ attack: r3(t) });
    if (key === 'decay') d.move({ decay: r3(t - e.attack), sustain: Math.round(clamp((.9 - y) / .8) * 100) / 100 });
    if (key === 'release') d.move({ release: r3(t - keyUp) });
    if (key === 'fade_in') d.move({ fade_in: fade(t) });
    if (key === 'fade_out') d.move({ fade_out: fade(span - t) });
  };
  const ticks = [0, .25, .5, .75, 1];
  return <div className="drag-graph drag-envelope smp-drag">
    <DragBox label={fades ? 'Amp envelope: drag Attack, Decay, Release and the fades' : 'Amp envelope: drag Attack, Decay and Release'} handles={handles} onMove={move}
      onDone={() => { d.done(); setFrozen(null); }}
      onReset={key => onCommit(key === 'decay' ? { decay: 0, sustain: 1 } : key === 'release' ? { release: .25 } : key === 'fade_in' || key === 'fade_out' ? { [key]: 0 } : { attack: 0 })}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {[1, .5, .25].map(l => <line key={l} className="grid" x1={0} x2={W} y1={LEVEL_Y(l) * H} y2={LEVEL_Y(l) * H} />)}
        <line className="grid zero" x1={0} x2={W} y1={H / 2} y2={H / 2} />
        <path className="wave-source" d={'M' + top.join('L') + 'L' + bottom.join('L') + 'Z'} />
        <path className="wave-heard" d={'M' + htop.join('L') + 'L' + hbottom.join('L') + 'Z'} />
        <path className="env-fill" d={'M0 ' + LEVEL_Y(0) * H + 'L' + line.join('L') + 'L' + W + ' ' + LEVEL_Y(0) * H + 'Z'} />
        <path className="env-line" d={'M' + line.join('L')} vectorEffect="non-scaling-stroke" />
        {fadeIn > 0 ? <><path className="fade-zone" d={`M0 0L${fadeIn / T * W} 0L0 ${H}Z`} />
          <line className="fade-line" x1={0} y1={H} x2={fadeIn / T * W} y2={0} vectorEffect="non-scaling-stroke" /></> : null}
        {fadeOut > 0 && span <= T ? <><path className="fade-zone" d={`M${(span - fadeOut) / T * W} 0L${span / T * W} 0L${span / T * W} ${H}Z`} />
          <line className="fade-line" x1={(span - fadeOut) / T * W} y1={0} x2={span / T * W} y2={H} vectorEffect="non-scaling-stroke" /></> : null}
        <line className="grid end" x1={keyUp / T * W} x2={keyUp / T * W} y1={0} y2={H} />
        {span < T ? <line className="grid end" x1={span / T * W} x2={span / T * W} y1={0} y2={H} /> : null}
        {heads.map((h, i) => <line key={i} className="playhead" x1={h / T * W} x2={h / T * W} y1={0} y2={H} vectorEffect="non-scaling-stroke" />)}
      </svg>
      <span className="drag-axis-label top">0 dB</span>
      <span className="drag-key-up" style={{ left: keyUp / T * 100 + '%' }}>key up</span>
      {scaleProp ? null : <div className="drag-scale" role="radiogroup" aria-label="Time scale">
        <button type="button" role="radio" aria-checked={scale === 'sound'} title="The whole sound, with the key held to near its end" onClick={() => setScale('sound')}>Whole sound</button>
        <button type="button" role="radio" aria-checked={scale === 'env'} title="Zoom in on the envelope times" onClick={() => setScale('env')}>Envelope</button>
      </div>}
    </DragBox>
    <div className="drag-ruler" aria-hidden="true">{ticks.map(f => <span key={f} style={{ left: f * 100 + '%' }}>{msText(f * T)}</span>)}</div>
  </div>;
}

/** The Sampler's filter as a response curve: drag the point sideways for Cutoff, up and down for Resonance.
 *  LP 24 (25 Nov) is two low-passes in a row, the first flat (Butterworth), the resonance on the second, as the engine runs it. */
const K24 = 1.8478, k24 = (res: number) => .7654 - .7254 * clamp(res);
export function FilterView({ type, cutoff, resonance, onLive, onCommit }: {
  type: 'off' | 'lp' | 'lp24' | 'bp' | 'hp'; cutoff: number; resonance: number;
} & LiveEdit) {
  const d = useLive(onLive, onCommit);
  const fc = d.draft.cutoff ?? cutoff, res = d.draft.resonance ?? resonance;
  const steep = type === 'lp24';
  const k = steep ? k24(res) : 2 - 1.96 * clamp(res), W = 1000, H = 100, pts: string[] = [];
  const mag = (f: number) => {
    if (type === 'off') return 0;
    const w = f / fc, den = Math.hypot(1 - w * w, k * w), num = type === 'lp' || steep ? 1 : type === 'hp' ? w * w : k * w;
    return 20 * Math.log10(Math.max(1e-6, num / den / (steep ? Math.hypot(1 - w * w, K24 * w) : 1)));
  };
  for (let i = 0; i <= 140; i++) pts.push((i / 140 * W).toFixed(1) + ' ' + (DB_Y(mag(FREQ(i / 140))) * H).toFixed(1));
  // resonance height at the cutoff (band pass is drawn level, the point still shows it); 24 dB: both stages at the cutoff
  const peakDb = type === 'off' ? 0 : -20 * Math.log10(steep ? k * K24 : k);
  const handles: DragHandle[] = [{ key: 'cut', label: type === 'off' ? 'Cutoff (filter off)' : 'Cutoff · Resonance', x: FX(fc), y: DB_Y(peakDb), axis: 'xy', text: hz(fc) + ', resonance ' + Math.round(res * 100) + '%' }];
  const move = (_: string, x: number, y: number) => {
    // up = more resonance: the point rides the peak, whose height is -20·log10(k) (12 dB) or -20·log10(k·K24) (24 dB)
    const kk = 10 ** (-Y_DB(y) / 20) / (steep ? K24 : 1);
    d.move({ cutoff: Math.round(clamp(FREQ(x), 20, 20000)), resonance: Math.round(clamp(steep ? (.7654 - kk) / .7254 : (2 - kk) / 1.96) * 100) / 100 });
  };
  return <div className={'drag-graph drag-tone smp-drag' + (type === 'off' ? ' is-off' : '')}>
    <DragBox label="Filter: drag the point for Cutoff and Resonance" handles={handles} onMove={move} onDone={() => d.done()}
      onReset={() => onCommit({ cutoff: 2000, resonance: .2 })}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {[100, 1000, 10000].map(f => <line key={f} className="grid" x1={FX(f) * W} x2={FX(f) * W} y1={0} y2={H} />)}
        {[12, -12].map(v => <line key={v} className="grid" x1={0} x2={W} y1={DB_Y(v) * H} y2={DB_Y(v) * H} />)}
        <line className="grid zero" x1={0} x2={W} y1={H / 2} y2={H / 2} />
        <path className="env-fill" d={'M0 ' + H + 'L' + pts.join('L') + 'L' + W + ' ' + H + 'Z'} />
        <path className="env-line" d={'M' + pts.join('L')} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="drag-axis-label top">+12</span><span className="drag-axis-label low">-12</span>
      {type === 'off' ? <span className="drag-note">Filter is off: switch it on in the Filter card</span> : null}
    </DragBox>
    <div className="drag-ruler" aria-hidden="true">{[20, 100, 1000, 10000, 20000].map(f => <span key={f} style={{ left: FX(f) * 100 + '%' }}>{hz(f)}</span>)}</div>
  </div>;
}

export type FilterEnv = { f_env: number; f_attack: number; f_hold: number; f_decay: number; f_sustain: number; f_release: number };
/** The filter's own envelope over time, as the engine runs it (25 Nov): Attack straight up, Hold at the top, Decay falls
 *  (to 1 % of the way at the Decay time) to Sustain while the key is held, Release falls from there after the key comes up.
 *  Attack, Hold, Decay · Sustain and Release are points to drag. The height is how far it moves the cutoff (Env). */
export function FilterEnvView({ env, onLive, onCommit }: { env: FilterEnv } & LiveEdit) {
  const d = useLive(onLive, onCommit);
  const e = { ...env, ...d.draft } as FilterEnv;
  const held = Math.max(.15, (e.f_attack + e.f_hold + e.f_decay + e.f_release) * .3);
  const natural = Math.max(.2, e.f_attack + e.f_hold + e.f_decay + held + e.f_release) * 1.1;
  const [frozen, setFrozen] = useState<number | null>(null);
  const T = frozen ?? natural, W = 1000, H = 100, N = 240;
  const keyUp = e.f_attack + e.f_hold + e.f_decay + held;
  const fall = 4.6 / Math.max(.001, e.f_decay), rfall = 4.6 / Math.max(.001, e.f_release);
  const before = (t: number) => t < e.f_attack ? t / e.f_attack : t < e.f_attack + e.f_hold ? 1
    : e.f_sustain + (1 - e.f_sustain) * Math.exp(-(t - e.f_attack - e.f_hold) * fall);
  const level = (t: number) => t < keyUp ? before(t) : before(keyUp) * Math.exp(-(t - keyUp) * rfall);
  const line: string[] = [];
  for (let i = 0; i <= N; i++) { const t = T * i / N; line.push((i / N * W).toFixed(1) + ' ' + (LEVEL_Y(level(t)) * H).toFixed(1)); }
  const a = e.f_attack, h = a + e.f_hold, dd = h + e.f_decay;
  const handles: DragHandle[] = [
    { key: 'f_attack', label: 'Attack', x: a / T, y: LEVEL_Y(1), axis: 'x', text: msText(e.f_attack) },
    { key: 'f_hold', label: 'Hold', x: h / T, y: LEVEL_Y(1), axis: 'x', text: msText(e.f_hold) },
    { key: 'f_decay', label: 'Decay · Sustain', x: dd / T, y: LEVEL_Y(level(dd)), axis: 'xy', text: msText(e.f_decay) + ', sustain ' + Math.round(e.f_sustain * 100) + '%' },
    { key: 'f_release', label: 'Release', x: (keyUp + e.f_release) / T, y: LEVEL_Y(0), axis: 'x', text: msText(e.f_release) },
  ];
  const r3 = (v: number) => Math.round(clamp(v, 0, 3) * 1000) / 1000;
  const move = (key: string, x: number, y: number) => {
    if (frozen === null) setFrozen(T);
    const t = x * T;
    if (key === 'f_attack') d.move({ f_attack: r3(t) });
    if (key === 'f_hold') d.move({ f_hold: r3(t - e.f_attack) });
    if (key === 'f_decay') {
      // the point sits where the curve is at the Decay time (1 % above Sustain), so y maps back through that
      const sustain = clamp(((.9 - y) / .8 - .01) / .99);
      d.move({ f_decay: r3(t - e.f_attack - e.f_hold), f_sustain: Math.round(sustain * 100) / 100 });
    }
    if (key === 'f_release') d.move({ f_release: r3(t - keyUp) });
  };
  const pct = Math.round(e.f_env * 100), ticks = [0, .25, .5, .75, 1];
  return <div className={'drag-graph drag-envelope smp-drag smp-fenv' + (Math.abs(e.f_env) < .005 ? ' is-off' : '')}>
    <DragBox label="Filter envelope: drag Attack, Hold, Decay and Release" handles={handles} onMove={move}
      onDone={() => { d.done(); setFrozen(null); }}
      onReset={key => onCommit(key === 'f_decay' ? { f_decay: .3, f_sustain: 0 } : { [key]: key === 'f_release' ? .3 : 0 })}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {[1, .5].map(l => <line key={l} className="grid" x1={0} x2={W} y1={LEVEL_Y(l) * H} y2={LEVEL_Y(l) * H} />)}
        <line className="grid zero" x1={0} x2={W} y1={LEVEL_Y(0) * H} y2={LEVEL_Y(0) * H} />
        <path className="env-fill" d={'M0 ' + LEVEL_Y(0) * H + 'L' + line.join('L') + 'L' + W + ' ' + LEVEL_Y(0) * H + 'Z'} />
        <path className="env-line" d={'M' + line.join('L')} vectorEffect="non-scaling-stroke" />
        <line className="grid end" x1={keyUp / T * W} x2={keyUp / T * W} y1={0} y2={H} />
      </svg>
      <span className="drag-axis-label top">{pct === 0 ? 'Env off' : (pct > 0 ? '+' : '') + pct + '% · ' + (Math.abs(e.f_env) * 5).toFixed(1) + ' oct'}</span>
      <span className="drag-key-up" style={{ left: keyUp / T * 100 + '%' }}>key up</span>
    </DragBox>
    <div className="drag-ruler" aria-hidden="true">{ticks.map(f => <span key={f} style={{ left: f * 100 + '%' }}>{msText(f * T)}</span>)}</div>
  </div>;
}
