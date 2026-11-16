/* Sampler track (15 Nov): one sample played across the keys, from a pad or a WAV file.
   The window is the sample. Trim: drag Start, End and, in Loop mode, the loop's two ends. Chop: cut it into
   slices (Threshold / Regions / BPM, Split / Join), tap a slice to hear it, and send slices to Drum Rack pads. The cards hold
   how it plays (Play), its pitch (Pitch) and its level over time (Amp). The keyboard plays it. */
import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, ArrowUp, AudioWaveform, BookOpen, ChevronsUpDown, Crop, Eraser, SlidersHorizontal, FolderOpen, Grid3x3, KeyboardMusic, Maximize2, Merge, Mic, Power, ScanSearch, Scissors, Trash2, Undo2, ZoomIn, Square } from 'lucide-react';
import { SampleLibrarySheet, type SampleLibraryState } from './SampleLibrary';
import { CommittedKnob } from './DrumRack';
import { useContextTarget } from './ContextWheel';
import { ValueBox, parseNote } from './ValueBox';
import { type Env } from './EnvEditor';
import { FilterView, SamplerEnvView } from './DragGraphs';
import { DRUM_KINDS, drumKind, padLabel, type DrumKind } from '../drum-kinds';
import { TRACK_COLORS, noteName, type SamplerRecord, type SamplerRuntime, type SamplerSpec, type Track, type SamplerMode } from '../types';
import '../sampler.css';

const BLACK = new Set([1, 3, 6, 8, 10]);
const KEYMAPS: ['whole' | 'slices' | 'pitched', string, string][] = [
  ['whole', 'Whole', 'The whole sample on every key, a semitone per key'],
  ['slices', 'Slices', 'One slice per key from the first key, each at its own pitch'],
  ['pitched', 'Pitched', "Each key plays the slice whose pitch is nearest, tuned to the key (finds each slice's pitch)"],
];
type FilterShape = 'lp' | 'bp' | 'hp';
// Round 4 (Sir, 16 Nov): the filter types as drawings of their curves, and a power switch like the Drum Rack compressor.
const FILTERS: [FilterShape, string, string, string][] = [
  ['lp', 'LP', 'Low-pass', 'Low pass: keeps the lows, cuts above the cutoff'],
  ['bp', 'BP', 'Band-pass', 'Band pass: keeps a band around the cutoff'],
  ['hp', 'HP', 'High-pass', 'High pass: keeps the highs, cuts below the cutoff'],
];
const FILTER_PATH: Record<FilterShape, string> = {
  lp: 'M2 6 H15 Q19 6 21 9 L28 16',
  bp: 'M2 16 L8 13 Q12 3 15 3 Q18 3 22 13 L28 16',
  hp: 'M2 16 L9 9 Q11 6 15 6 H28',
};
function FilterIcon({ shape }: { shape: FilterShape }) {
  return <svg className="smp-filter-icon" viewBox="0 0 30 19" width={30} height={19} aria-hidden="true">
    <path className="axis" d="M2 16 H28" /><path className="curve" d={FILTER_PATH[shape]} /></svg>;
}
/** Tool colours, as on the SEQ panel's rail: a coloured icon and a short label. */
const TOOL_COLOR = { trim: '#6fa8ff', chop: '#ff8f5c', env: '#61e3bf', filter: '#e47cf5', library: '#e0b07e', record: '#ff6b6b', load: '#a7b4ff', clear: '#9fb4c8' } as const;
const tool = (k: keyof typeof TOOL_COLOR) => ({ ['--tool' as string]: TOOL_COLOR[k] });
const hz = (f: number) => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + ' kHz' : Math.round(f) + ' Hz';
const MODES: [SamplerMode, string, string][] = [
  ['oneshot', 'One shot', 'Plays to the end, whatever the key does'],
  ['hold', 'Hold', 'Plays while the key is held, then the release'],
  ['loop', 'Loop', 'Repeats the loop while the key is held'],
];
export const familyColor = (family?: string) => DRUM_KINDS[(family as DrumKind) in DRUM_KINDS ? family as DrumKind : 'other'].color;

type Edit = (key: string, value: unknown) => void;
type TrimKey = 'start' | 'end' | 'loop_start' | 'loop_end';
type Target = { kind: 'trim'; key: TrimKey } | { kind: 'slice'; i: number; edge: 0 | 1 };
const MIN_SLICE = .0005, MIN_VIEW = .0005;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
/** A view [a, b] inside 0..1, at least MIN_VIEW wide; the whole sample when it is (nearly) all of it. */
const fitView = (a: number, b: number): [number, number] => {
  const s = Math.min(1, Math.max(MIN_VIEW, b - a)); if (s >= .999) return [0, 1];
  const lo = Math.max(0, Math.min(1 - s, a)); return [lo, lo + s];
};

/** The waveform editor (UI-RULES 32, 33). Trim: Start / End and the loop as tag markers. Chop: every slice edge is a tag
    marker you drag (a shared edge moves both slices); tap a slice to hear it and choose it, double-click to split there.
    Works like the MIDI editor: wheel scrolls, Ctrl+wheel zooms at the pointer, middle-drag (or a one-finger drag when zoomed)
    pans, two fingers pinch. Keys: F fit, Z zoom to the slice, + / − zoom, ← / → previous / next slice, S split, J join,
    Delete removes the slice's start edge, Space / Enter plays it. Every handle has a 44 px hit zone; one drag is one undo step. */
export function SampleWindow({ spec, runtime, mode, selected, marker, onSelect, onEdit, onView, onChop, onAudition, onLibrary }: {
  spec: SamplerSpec; runtime?: SamplerRuntime | null; mode: 'trim' | 'chop'; selected: number; marker: number | null;
  onSelect(index: number, at: number): void; onEdit: Edit; onView(a: number, b: number): void;
  onChop(mode: string, options?: Record<string, unknown>): void; onAudition(index: number): void; onLibrary?(slice: number): void;
}) {
  const slices = spec.slices ?? [];
  const trim0 = (): Record<TrimKey, number> => ({ start: spec.start, end: spec.end, loop_start: spec.loop_start, loop_end: spec.loop_end });
  const [trimDraft, setTrimDraft] = useState<Partial<Record<TrimKey, number>> | null>(null);
  const [sliceDraft, setSliceDraft] = useState<number[][] | null>(null);
  const [localView, setLocalView] = useState<[number, number] | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const drag = useRef<{ target: Target; left: number; width: number; trim: Record<TrimKey, number>; slices: number[][]; x: number; moved: boolean } | null>(null);
  const pan = useRef<{ id: number; x: number; a: number; b: number; moved: boolean; tap: boolean } | null>(null);
  const touches = useRef(new Map<number, number>());
  const pinch = useRef<{ dist: number; mid: number; a: number; b: number } | null>(null);
  const sendView = useRef<{ timer?: number; next?: [number, number] }>({});
  const t = { ...trim0(), ...trimDraft };
  const shown = sliceDraft ?? slices;
  const looping = spec.mode === 'loop' && mode === 'trim';
  const pv = runtime?.view ?? [0, 1];
  useEffect(() => { setLocalView(null); }, [pv[0], pv[1]]);
  useEffect(() => () => window.clearTimeout(sendView.current.timer), []);
  const [va, vb] = localView ?? pv;
  const span = Math.max(1e-6, vb - va);
  const x = (u: number) => (u - va) / span;                    // 0..1 across the window
  const pct = (u: number) => (x(u) * 100) + '%';
  const visible = (u: number) => u >= va - 1e-9 && u <= vb + 1e-9;
  const peaks = (runtime?.peaks ?? []).filter(p => p.length >= 2);
  const secs = runtime?.seconds ?? 0, ms = (u: number) => Math.round(u * secs * 1000);
  const toU = (clientX: number, left = shell.current?.getBoundingClientRect().left ?? 0, width = shell.current?.getBoundingClientRect().width ?? 1) =>
    Math.max(0, Math.min(1, va + (clientX - left) / Math.max(1, width) * span));

  /** Moves the view now (drawn at once, old peaks stretched) and asks for new peaks at most every 60 ms. */
  const view = (a: number, b: number) => {
    const v = fitView(a, b); setLocalView(v); sendView.current.next = v;
    if (sendView.current.timer === undefined) sendView.current.timer = window.setTimeout(() => {
      sendView.current.timer = undefined; const n = sendView.current.next; if (n) onView(n[0], n[1]);
    }, 60);
  };
  const zoomAt = (u: number, factor: number) => { const s = Math.min(1, span * factor); const a = u - (u - va) * (s / span); view(a, a + s); };
  const zoomTo = () => {
    const sel = shown[selected];
    if (sel) { const pad = Math.max((sel[1] - sel[0]) * .15, .001); view(sel[0] - pad, sel[1] + pad); }
    else if (marker !== null) view(marker - .04, marker + .04);
  };

  // Wheel: scroll time; Ctrl+wheel: zoom around the pointer (as in the MIDI editor).
  useEffect(() => {
    const el = shell.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      const d = e.deltaY || e.deltaX; if (!d) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(toU(e.clientX, r.left, r.width), d < 0 ? .8 : 1.25);
      else if (span < .999) { const step = Math.sign(d) * span * (e.shiftKey ? .5 : .12); view(va + step, vb + step); }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const limits = (target: Target, s: Record<TrimKey, number>, list: number[][]): [number, number] => {
    if (target.kind === 'trim') {
      const k = target.key;
      return k === 'start' ? [0, s.end - .002] : k === 'end' ? [s.start + .002, 1]
        : k === 'loop_start' ? [s.start, s.loop_end - .002] : [s.loop_start + .002, s.end];
    }
    const { i, edge } = target, n = list.length;
    if (edge === 0) {
      const joined = i > 0 && near(list[i - 1][1], list[i][0]);
      return [i === 0 ? 0 : joined ? list[i - 1][0] + MIN_SLICE : list[i - 1][1], list[i][1] - MIN_SLICE];
    }
    const joined = i < n - 1 && near(list[i + 1][0], list[i][1]);
    return [list[i][0] + MIN_SLICE, i === n - 1 ? 1 : joined ? list[i + 1][1] - MIN_SLICE : list[i + 1][0]];
  };
  /** Puts an edge at u (clamped) and returns the new trim values and slices. A shared slice edge moves both slices. */
  const place = (target: Target, u: number, s: Record<TrimKey, number>, list: number[][]) => {
    const [lo, hi] = limits(target, s, list); const at = Math.max(lo, Math.min(hi, u));
    if (target.kind === 'trim') return { trim: { ...s, [target.key]: Math.round(at * 1e5) / 1e5 }, slices: list };
    const { i, edge } = target, v = r6(at), next = list.map(p => [...p]);
    if (edge === 0) { if (i > 0 && near(list[i - 1][1], list[i][0])) next[i - 1][1] = v; next[i][0] = v; }
    else { if (i < list.length - 1 && near(list[i + 1][0], list[i][1])) next[i + 1][0] = v; next[i][1] = v; }
    return { trim: s, slices: next };
  };
  const commit = (trim: Record<TrimKey, number>, list: number[][]) => {
    if (list !== slices && list.some((p, i) => p[0] !== slices[i][0] || p[1] !== slices[i][1])) { onEdit('slices', list); return; }
    const base = trim0(); const changed: Record<string, number> = {};
    (Object.keys(base) as TrimKey[]).forEach(k => { if (trim[k] !== base[k]) changed[k] = trim[k]; });
    // Start and End also keep the loop inside them.
    if ('start' in changed && trim.loop_start < trim.start) changed.loop_start = trim.start;
    if ('end' in changed && trim.loop_end > trim.end) changed.loop_end = trim.end;
    if (Object.keys(changed).length) onEdit('patch', changed);
  };
  const handleDown = (target: Target) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); shell.current?.focus({ preventScroll: true });
    const box = shell.current!.getBoundingClientRect(); e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { target, left: box.left, width: box.width, trim: trim0(), slices: slices.map(p => [...p]), x: e.clientX, moved: false };
  };
  const handleMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x) < 3) return;
    d.moved = true;
    const next = place(d.target, toU(e.clientX, d.left, d.width), trim0(), slices.map(p => [...p]));
    d.trim = next.trim; d.slices = next.slices;
    if (d.target.kind === 'trim') setTrimDraft({ ...next.trim }); else setSliceDraft(next.slices);
  };
  const handleUp = (ok: boolean) => (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null; setTrimDraft(null); setSliceDraft(null);
    if (!d) return;
    if (d.moved && ok) commit(d.trim, d.slices);
    else if (!d.moved && ok && mode === 'chop') { const at = toU(e.clientX); onSelect(slices.findIndex(([a, b]) => at >= a && at < b), at); }
  };
  const nudge = (target: Target, dir: number, e: React.KeyboardEvent) => {
    const step = span * (e.shiftKey ? .1 : e.ctrlKey ? .001 : .01) * dir;
    const now = target.kind === 'trim' ? trim0()[target.key] : slices[target.i][target.edge];
    const next = place(target, now + step, trim0(), slices.map(p => [...p])); commit(next.trim, next.slices);
  };
  const handle = (target: Target, label: string, at: number, cls: string, tag: string | null) => visible(at) ?
    <button key={label} type="button" className={'smp-handle ' + cls} style={{ left: pct(at) }}
      aria-label={label + ' ' + (Math.round(at * 1000) / 10) + '%'}
      onPointerDown={handleDown(target)} onPointerMove={handleMove} onPointerUp={handleUp(true)} onPointerCancel={handleUp(false)}
      onKeyDown={e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); e.stopPropagation();
        nudge(target, e.key === 'ArrowLeft' ? -1 : 1, e);
      }}><i />{tag !== null ? <b>{tag}</b> : null}</button> : null;

  // The waveform itself: tap selects (Chop), drag pans when zoomed, middle-drag pans, two fingers pinch.
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    shell.current?.focus({ preventScroll: true });
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, e.clientX);
      if (touches.current.size === 2) {
        const [p1, p2] = [...touches.current.values()]; pan.current = null;
        pinch.current = { dist: Math.max(20, Math.abs(p2 - p1)), mid: toU((p1 + p2) / 2), a: va, b: vb };
        return;
      }
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    pan.current = { id: e.pointerId, x: e.clientX, a: va, b: vb, moved: false, tap: e.button === 0 };
    if (e.button === 1) e.preventDefault();
  };
  const moveShell = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, e.clientX);
    const pz = pinch.current;
    if (pz && touches.current.size >= 2) {
      const [p1, p2] = [...touches.current.values()]; const s = Math.min(1, (pz.b - pz.a) * pz.dist / Math.max(20, Math.abs(p2 - p1)));
      const r = shell.current!.getBoundingClientRect(); const f = ((p1 + p2) / 2 - r.left) / r.width;
      view(pz.mid - f * s, pz.mid - f * s + s); return;
    }
    const p = pan.current; if (!p || p.id !== e.pointerId) return;
    if (!p.moved && Math.abs(e.clientX - p.x) < 6) return;
    if (p.b - p.a >= .999) { if (!p.tap) p.moved = true; return; }   // nothing to pan when the whole sample shows
    p.moved = true;
    const w = shell.current!.getBoundingClientRect().width; const du = (p.x - e.clientX) / w * (p.b - p.a);
    view(p.a + du, p.b + du);
  };
  const upShell = (e: React.PointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId); if (touches.current.size < 2) pinch.current = null;
    const p = pan.current; if (!p || p.id !== e.pointerId) return; pan.current = null;
    if (!p.moved && p.tap && mode === 'chop') { const at = toU(e.clientX); onSelect(slices.findIndex(([a, b]) => at >= a && at < b), at); }
  };
  const key = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;   // a focused handle nudges
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, sel = slices[selected];
    if (k === 'f') view(0, 1);
    else if (k === 'z') zoomTo();
    else if (k === '+' || k === '=') zoomAt(marker ?? (va + vb) / 2, .5);
    else if (k === '-' || k === '_') zoomAt(marker ?? (va + vb) / 2, 2);
    else if (mode === 'chop' && (k === 'ArrowLeft' || k === 'ArrowRight') && slices.length) {
      const i = Math.max(0, Math.min(slices.length - 1, selected < 0 ? 0 : selected + (k === 'ArrowLeft' ? -1 : 1)));
      onSelect(i, slices[i][0]);
      if (!visible(slices[i][0]) || !visible(slices[i][1])) { const w = span; view(slices[i][0] - w * .1, slices[i][0] + w * .9); }
    }
    else if (mode === 'chop' && k === 's' && sel && marker !== null && marker > sel[0] + MIN_SLICE && marker < sel[1] - MIN_SLICE) onChop('split', { index: selected, at: marker });
    else if (mode === 'chop' && k === 'j' && sel && selected < slices.length - 1) onChop('join', { index: selected });
    else if (mode === 'chop' && (k === 'Delete' || k === 'Backspace') && sel && slices.length > 1) {
      if (selected > 0) { onChop('join', { index: selected - 1 }); onSelect(selected - 1, slices[selected - 1][0]); } else onChop('join', { index: 0 });
    }
    else if (mode === 'chop' && (k === ' ' || k === 'Enter') && sel) onAudition(selected);
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  const doubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'chop' || (e.target as HTMLElement).closest('.smp-handle')) return;
    const at = toU(e.clientX), i = slices.findIndex(([a, b]) => at >= a && at < b);
    if (i >= 0 && at > slices[i][0] + MIN_SLICE && at < slices[i][1] - MIN_SLICE) onChop('split', { index: i, at: r6(at) });
  };

  // Right-click / touch-hold on the waveform: the radial menu (UI-RULES 37) with zoom and, in Chop, the slice under the pointer.
  const waveContext = useContextTarget((el, cx) => {
    if (!peaks.length) return null;
    const at = toU(cx), i = mode === 'chop' ? slices.findIndex(([a, b]) => at >= a && at < b) : -1, s = slices[i];
    return { area: 'sound', kind: 'sample.wave', label: mode === 'chop' ? (s ? 'Slice ' + (i + 1) : 'Chop') : 'Trim', caps: {
      ...(span > MIN_VIEW * 1.01 ? { zoomIn: () => zoomAt(at, .5) } : {}), zoomOut: () => zoomAt(at, 2), ...(span < .999 ? { zoomFit: () => view(0, 1) } : {}),
      ...(s && at > s[0] + MIN_SLICE && at < s[1] - MIN_SLICE ? { split: () => onChop('split', { index: i, at: r6(at) }) } : {}),
      ...(s && i < slices.length - 1 ? { join: () => onChop('join', { index: i }) } : {}),
      ...(s ? { play: () => { onSelect(i, s[0]); onAudition(i); } } : {}),
      ...(onLibrary ? { saveSample: () => onLibrary(s ? i : -1) } : {}),
      ...(mode === 'chop' && slices.length ? { clearSlices: () => { onChop('clear'); onSelect(-1, at); } } : {}),
    } };
  });
  const W = 512, pspan = Math.max(1e-6, pv[1] - pv[0]);
  const sel = shown[selected];
  return <div className={'smp-window' + (mode === 'chop' ? ' chop' : '')} data-testid="sampler-window">
    <div ref={shell} {...waveContext} className="smp-wave-shell" tabIndex={0} aria-label="Sample editor: wheel scrolls, Ctrl+wheel zooms, F fits"
      onPointerDown={down} onPointerMove={moveShell} onPointerUp={upShell} onPointerCancel={upShell} onKeyDown={key} onDoubleClick={doubleClick}
      onAuxClick={e => e.preventDefault()}>
      {peaks.length ? <svg className="smp-wave" viewBox={'0 0 ' + W + ' 120'} preserveAspectRatio="none" role="img" aria-label="The sample's waveform">
        {mode === 'chop' ? shown.map(([a, b], i) => <rect key={'s' + i} className={'smp-slice' + (i % 2 ? ' odd' : '') + (i === selected ? ' on' : '')}
          x={x(a) * W} y={0} width={Math.max(.5, (x(b) - x(a)) * W)} height={120} />) : null}
        <path d="M0 60H512" className="smp-zero" />
        <path className="smp-wave-fill" d={wavePath(peaks, u => x(u) * W, pv[0], pspan)} />
        {mode === 'trim' ? <>
          <rect className="smp-cut" x={0} y={0} width={Math.max(0, x(t.start) * W)} height={120} />
          <rect className="smp-cut" x={x(t.end) * W} y={0} width={Math.max(0, (1 - x(t.end)) * W)} height={120} />
          {looping ? <rect className="smp-loop" x={x(t.loop_start) * W} y={0} width={(x(t.loop_end) - x(t.loop_start)) * W} height={120} /> : null}
          {(['start', 'end'] as const).map(k => <line key={k} className="smp-edge" x1={x(t[k]) * W} x2={x(t[k]) * W} y1={0} y2={120} vectorEffect="non-scaling-stroke" />)}
          {looping ? (['loop_start', 'loop_end'] as const).map(k => <line key={k} className="smp-edge loop" x1={x(t[k]) * W} x2={x(t[k]) * W} y1={0} y2={120} vectorEffect="non-scaling-stroke" />) : null}
        </> : <>
          {shown.map(([a], i) => <line key={'e' + i} className={'smp-edge slice' + (i === selected ? ' on' : '')} x1={x(a) * W} x2={x(a) * W} y1={0} y2={120} vectorEffect="non-scaling-stroke" />)}
          {sel ? <line className="smp-edge slice on" x1={x(sel[1]) * W} x2={x(sel[1]) * W} y1={0} y2={120} vectorEffect="non-scaling-stroke" /> : null}
          {marker !== null && visible(marker) ? <line className="smp-marker" x1={x(marker) * W} x2={x(marker) * W} y1={0} y2={120} vectorEffect="non-scaling-stroke" /> : null}
          {runtime?.audition ? <line className="smp-playhead" x1={x(runtime.audition.at) * W} x2={x(runtime.audition.at) * W} y1={0} y2={120} vectorEffect="non-scaling-stroke" /> : null}
        </>}
        {(runtime?.playing ?? []).map((at, i) => <line key={'p' + i} className="smp-playhead" x1={x(at) * W} x2={x(at) * W} y1={0} y2={120} vectorEffect="non-scaling-stroke" />)}
      </svg> : null}
      {peaks.length && mode === 'trim' ? <>
        {handle({ kind: 'trim', key: 'start' }, 'Start', t.start, 'h-start', 'Start')}
        {handle({ kind: 'trim', key: 'end' }, 'End', t.end, 'h-end', 'End')}
        {looping ? <>{handle({ kind: 'trim', key: 'loop_start' }, 'Loop', t.loop_start, 'h-loop_start', 'Loop')}
          {handle({ kind: 'trim', key: 'loop_end' }, 'Loop end', t.loop_end, 'h-loop_end', 'Loop end')}</> : null}
      </> : null}
      {peaks.length && mode === 'chop' ? <>
        {shown.map(([a, b], i) => handle({ kind: 'slice', i, edge: 0 }, 'Slice ' + (i + 1), a, 'h-slice_start' + (i === selected ? ' on' : ''),
          i === selected || x(Math.min(b, shown[i + 1]?.[0] ?? b)) - x(a) > .022 ? String(i + 1) : null))}
        {sel && !(selected < shown.length - 1 && near(shown[selected + 1][0], sel[1]))
          ? handle({ kind: 'slice', i: selected, edge: 1 }, 'Slice ' + (selected + 1) + ' end', sel[1], 'h-slice_end on', null) : null}
      </> : null}
    </div>
    <span className="smp-caption">{secs ? (mode === 'trim' ? 'Plays ' + ms(t.start) + '–' + ms(t.end) + ' ms' + (looping ? ' · loops ' + ms(t.loop_start) + '–' + ms(t.loop_end) + ' ms' : '') + ' of ' + ms(1) + ' ms' : '')
      + (vb - va < .999 ? (mode === 'trim' ? ' · ' : '') + 'View ' + fmtS(va * secs) + '–' + fmtS(vb * secs) + ' of ' + fmtS(secs) : '') : ''}</span>
  </div>;
}

/** The waveform as one closed outline: the highs left to right, then the lows back. Smooth at any zoom. */
function wavePath(peaks: number[][], px: (u: number) => number, a: number, span: number): string {
  if (!peaks.length) return '';
  const n = peaks.length, y = (v: number) => (60 - Math.max(-1, Math.min(1, v)) * 56).toFixed(2);
  const at = (i: number) => px(a + (i + .5) / n * span).toFixed(2);
  let d = 'M' + px(a).toFixed(2) + ' 60';
  for (let i = 0; i < n; i++) d += 'L' + at(i) + ' ' + y(Math.max(peaks[i][1], 0.004));
  d += 'L' + px(a + span).toFixed(2) + ' 60';
  for (let i = n - 1; i >= 0; i--) d += 'L' + at(i) + ' ' + y(Math.min(peaks[i][0], -0.004));
  return d + 'Z';
}

const fmtS = (s: number) => s < 10 ? s.toFixed(2) + ' s' : s < 60 ? s.toFixed(1) + ' s' : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const BEATS: [number, string][] = [[.25, '1/16'], [.5, '1/8'], [1, '1/4'], [2, '1/2'], [4, 'Bar']];
const dB = (n: number) => (Number.isInteger(n) ? n : n.toFixed(1)) + ' dB';
const bpmText = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1);
type ChopMode = 'threshold' | 'regions' | 'bpm';
type ChopSettings = { mode: ChopMode; threshold: number; min_ms: number; count: number; bpm: number; beats: number };

/** Chop tools, one row under the waveform: how to find slices, then Split / Join / Clear, Zoom and To pads. */
function ChopBar({ spec, settings, onSettings, selected, marker, zoomed, onChop, onZoom }: {
  spec: SamplerSpec; settings: ChopSettings; onSettings(s: ChopSettings, apply: boolean): void;
  selected: number; marker: number | null; zoomed: boolean;
  onChop(mode: string, options?: Record<string, unknown>): void; onZoom(): void;
}) {
  const slices = spec.slices ?? [];
  const sel = slices[selected];
  const set = (patch: Partial<ChopSettings>) => onSettings({ ...settings, ...patch }, true);
  const canSplit = !!sel && marker !== null && marker > sel[0] + .0005 && marker < sel[1] - .0005;
  return <div className="smp-chop smp-rack" role="toolbar" aria-label="Chop">
    <div className="smp-seg" role="radiogroup" aria-label="Find slices by">
      {([['threshold', 'Threshold', 'A slice starts at each hit or played note'], ['regions', 'Regions', 'Equal slices'], ['bpm', 'BPM', 'One slice per beat length']] as const).map(([m, label, title]) =>
        <button key={m} type="button" role="radio" aria-checked={settings.mode === m} title={title} onClick={() => set({ mode: m })}>{label}</button>)}
    </div>
    <div className="smp-chop-params">
      {settings.mode === 'threshold' ? <>
        <ValueBox label="Level" value={settings.threshold} min={-60} max={-3} step={1} coarse={6} fine={.5} format={dB} onChange={n => set({ threshold: n })}
          title="Level: a slice starts where the sound rises above this. Click, then scroll (Shift big, Ctrl fine) · two slow clicks to type" />
        <ValueBox label="Min" value={settings.min_ms} min={10} max={2000} step={10} coarse={100} fine={1} format={n => Math.round(n) + ' ms'} onChange={n => set({ min_ms: n })}
          title="Min: the shortest slice; hits closer than this keep the stronger one" />
      </> : settings.mode === 'regions' ?
        <ValueBox label="Slices" value={settings.count} min={2} max={64} step={1} coarse={8} fine={1} onChange={n => set({ count: n })} />
        : <>
          <ValueBox label="BPM" value={settings.bpm} min={40} max={300} step={1} coarse={10} fine={.1} format={bpmText} onChange={n => set({ bpm: n })} />
          <div className="smp-seg" role="radiogroup" aria-label="Slice length">
            {BEATS.map(([b, label]) => <button key={b} type="button" role="radio" aria-checked={settings.beats === b} onClick={() => set({ beats: b })}>{label}</button>)}
          </div>
        </>}
    </div>
    <div className="smp-chop-edit">
      <button type="button" className="smp-tool" style={tool('chop')} aria-label="Split" disabled={!canSplit} title="Split: cut the chosen slice where you last tapped (S)" onClick={() => onChop('split', { index: selected, at: marker })}><Scissors size={17} /><span>Split</span></button>
      <button type="button" className="smp-tool" style={tool('trim')} aria-label="Join" disabled={!sel || selected >= slices.length - 1} title="Join: merge the chosen slice with the next one (J)" onClick={() => onChop('join', { index: selected })}><Merge size={17} /><span>Join</span></button>
      <button type="button" className="smp-tool" style={tool('clear')} aria-label="Clear slices" disabled={!slices.length} title="Clear slices: remove every slice (the sample stays)" onClick={() => onChop('clear')}><Eraser size={17} /><span>Clear</span></button>
      <button type="button" className="smp-tool" style={tool('env')} aria-label="Zoom" aria-pressed={zoomed} disabled={!zoomed && !sel && marker === null} title="Zoom to the chosen slice (Z); again for the whole sample" onClick={onZoom}><ZoomIn size={17} /><span>Zoom</span></button>
    </div>
  </div>;
}

/** What Chop has made, in the tool rack: the slice count (and the chosen slice), and Pads to send them on. */
function ChopOut({ spec, runtime, selected, onSend }: { spec: SamplerSpec; runtime?: SamplerRuntime | null; selected: number; onSend(): void }) {
  const slices = spec.slices ?? [], sel = slices[selected], busy = runtime?.busy ?? [], secs = runtime?.seconds ?? 0;
  return <div className="smp-rack-row smp-rack-out">
    <span className="smp-chop-info" aria-live="polite">{busy.includes('chop') ? 'Chopping…' : busy.includes('send') ? 'Writing slices…' :
      !slices.length ? 'No slices yet' : <><b>{slices.length} slices</b>{sel ? <small><i> · </i>{(selected + 1) + ': ' + fmtS(sel[0] * secs) + '–' + fmtS(sel[1] * secs)}</small> : null}</>}</span>
    <button type="button" className="smp-send" aria-label="To pads" disabled={!slices.length} title="Send the slices to Drum Rack pads" onClick={onSend}><Grid3x3 size={16} />Pads<ArrowRight size={15} /></button>
  </div>;
}

/** Whole : Env — one box that swaps the envelope view's time scale. The active one is bright, the other dim. */
function ScaleSwap({ scale, onChange }: { scale: 'sound' | 'env'; onChange(s: 'sound' | 'env'): void }) {
  const [a, b] = scale === 'sound' ? ['Whole', 'Env'] : ['Env', 'Whole'];
  return <button type="button" className="smp-scale-swap" aria-label={'Time scale: ' + (scale === 'sound' ? 'Whole sound' : 'Envelope') + '. Swap'}
    title={scale === 'sound' ? 'Showing the whole sound, the key held to near its end. Tap to zoom in on the envelope times' : 'Zoomed in on the envelope times. Tap for the whole sound'}
    onClick={() => onChange(scale === 'sound' ? 'env' : 'sound')}>
    <b>{a}</b><i aria-hidden="true">:</i><em>{b}</em><ChevronsUpDown size={13} aria-hidden="true" /></button>;
}

/** Send slices to a Drum Rack: a new 16-pad kit, or the chosen slice onto one pad. Done, a blank tap, Esc or To pads close it. */
function SendSheet({ spec, selected, trackIndex, tracks, onSend, onClose }: {
  spec: SamplerSpec; selected: number; trackIndex: number; tracks: Track[];
  onSend(target: number, mode: 'kit' | 'pad', options: Record<string, unknown>): void; onClose(): void;
}) {
  const slices = spec.slices ?? [];
  const others = tracks.map((_, i) => i).filter(i => i !== trackIndex);
  const [target, setTarget] = useState(others.find(i => tracks[i]?.device === 'drum_rack') ?? others[0]);
  const kit = tracks[target]?.device === 'drum_rack' ? tracks[target]?.drum_rack : undefined;
  const [what, setWhat] = useState<'kit' | 'pad'>('kit');
  const [bank, setBank] = useState(Math.max(0, Math.floor(Math.max(0, selected) / 16)));
  const [pad, setPad] = useState(0);
  const banks = Math.ceil(slices.length / 16);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const mode = what === 'pad' && kit && selected >= 0 ? 'pad' : 'kit';
  const first = bank * 16 + 1, last = Math.min(slices.length, bank * 16 + 16);
  const describe = (i: number) => { const t = tracks[i]; if (!t) return '';
    return t.device === 'drum_rack' ? 'Drum Rack' + (t.drum_rack?.name ? ' · ' + t.drum_rack.name : '') : t.device === 'sampler' ? 'Sampler · ' + (t.sampler?.source ? t.sampler.name : 'empty') : 'Synth · ' + t.preset; };
  return <div className="smp-sheet-screen" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="smp-sheet" role="dialog" aria-label="Send slices to pads">
      <header><Grid3x3 size={20} /><h2>Send slices of <em>{spec.name}</em> to pads</h2><button type="button" className="smp-done" onClick={onClose}>Done</button></header>
      <div className="smp-targets" role="radiogroup" aria-label="Track">
        {others.map(i => <button key={i} type="button" role="radio" aria-checked={target === i} onClick={() => setTarget(i)}>
          <b>Track {i + 1}</b><span>{describe(i)}</span></button>)}
      </div>
      <div className="smp-seg" role="radiogroup" aria-label="What to send">
        <button type="button" role="radio" aria-checked={mode === 'kit'} onClick={() => setWhat('kit')}>New kit of 16 slices</button>
        <button type="button" role="radio" aria-checked={mode === 'pad'} disabled={!kit || selected < 0}
          title={!kit ? 'Choose a Drum Rack track' : selected < 0 ? 'Choose a slice first' : undefined} onClick={() => setWhat('pad')}>
          {selected >= 0 ? 'Slice ' + (selected + 1) + ' to one pad' : 'One slice to one pad'}</button>
      </div>
      {mode === 'kit' ? <>
        {banks > 1 ? <div className="smp-seg" role="radiogroup" aria-label="Slices">
          {Array.from({ length: banks }, (_, b) => <button key={b} type="button" role="radio" aria-checked={bank === b} onClick={() => setBank(b)}>
            Slices {b * 16 + 1}–{Math.min(slices.length, b * 16 + 16)}</button>)}
        </div> : null}
        <p>{tracks[target]?.device === 'drum_rack' ? 'Its kit is replaced' : 'Track ' + (target + 1) + ' becomes a Drum Rack'}: slices {first}–{last} go on pads 1–{last - first + 1}, as WAV files of their own. Undo brings the track back.</p>
      </> : <div className="smp-padgrid" role="radiogroup" aria-label="Pad">
        {[12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3].map(i => <button key={i} type="button" role="radio" aria-checked={pad === i} onClick={() => setPad(i)}>
          <b>{String(i + 1).padStart(2, '0')}</b><span>{kit?.pads[i]?.source ? kit.pads[i].name : 'empty'}</span></button>)}
      </div>}
      <footer><button type="button" className="smp-make" onClick={() => {
        if (mode === 'pad' && kit) onSend(target, 'pad', { index: selected, pad, kit: kit.id }); else onSend(target, 'kit', { bank });
        onClose();
      }}><Grid3x3 size={18} />{mode === 'pad' ? 'Put slice ' + (selected + 1) + ' on pad ' + (pad + 1) : 'Make the kit on track ' + (target + 1)}</button></footer>
    </div>
  </div>;
}

/** Keys from the C below the root, three octaves. Holds, glides between keys, velocity from how low you touch. */
function SamplerKeys({ spec, onMidi }: { spec: SamplerSpec; onMidi: (s: number, a: number, b: number) => void }) {
  const root = spec.root, slices = spec.keymap !== 'whole' ? spec.slices ?? [] : [];
  const roots = spec.keymap === 'pitched' ? slices.map(p => p[2]).filter((r): r is number => typeof r === 'number') : [];
  const low = spec.keymap === 'slices' ? root : roots.length ? Math.min(...roots) : root;
  const base = Math.max(0, Math.min(91, low - low % 12 - (spec.keymap === 'whole' ? 12 : 0)));
  const keys = Array.from({ length: 37 }, (_, i) => base + i);
  const whites = keys.filter(n => !BLACK.has(n % 12));
  const pointers = useRef(new Map<number, number>());
  const send = useRef(onMidi); send.current = onMidi;
  const [down, setDown] = useState<number[]>([]);
  const sync = () => setDown([...new Set(pointers.current.values())]);
  const noteAt = (x: number, y: number) => {
    const n = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-note]')?.dataset.note;
    return n === undefined ? null : Number(n);
  };
  const velocity = (y: number, el: Element | null) => {
    if (!el) return 100; const r = el.getBoundingClientRect();
    return Math.max(1, Math.min(127, Math.round(40 + 87 * ((y - r.top) / Math.max(1, r.height)))));
  };
  const press = (id: number, note: number, vel: number) => {
    const old = pointers.current.get(id); if (old === note) return;
    if (old !== undefined && ![...pointers.current.entries()].some(([k, n]) => k !== id && n === old)) send.current(0x80, old, 0);
    pointers.current.set(id, note); send.current(0x90, note, vel); sync();
  };
  const release = (id: number) => {
    const old = pointers.current.get(id); pointers.current.delete(id);
    if (old !== undefined && ![...pointers.current.values()].includes(old)) send.current(0x80, old, 0);
    sync();
  };
  useEffect(() => () => { for (const id of [...pointers.current.keys()]) release(id); }, [base]);
  // Whole: the root and two octaves above it. Slices: one slice per key from the root. Pitched: each slice's root.
  const sliceOn = (n: number) => spec.keymap === 'slices' && n >= root && n < root + slices.length ? n - root : -1;
  const rootOf = (n: number) => roots.indexOf(n);
  const cls = (n: number) => (spec.keymap === 'whole' ? (n === root ? ' root' : '') + (n > root + 24 ? ' far' : '')
    : spec.keymap === 'slices' ? (sliceOn(n) >= 0 ? ' slice' : ' far') : (rootOf(n) >= 0 ? ' root' : ''))
    + (down.includes(n) ? ' down' : '');
  const label = (n: number) => spec.keymap === 'slices' ? (sliceOn(n) >= 0 ? String(sliceOn(n) + 1) : null)
    : spec.keymap === 'pitched' ? (rootOf(n) >= 0 ? noteName(n) : n % 12 === 0 ? noteName(n) : null)
    : n === root ? 'Root ' + noteName(n) : n % 12 === 0 ? noteName(n) : null;
  return <div className="smp-keys" role="group" aria-label="Sampler keyboard"
    onPointerDown={e => { if (e.button !== 0) return; const n = noteAt(e.clientX, e.clientY); if (n === null) return;
      e.currentTarget.setPointerCapture(e.pointerId); press(e.pointerId, n, velocity(e.clientY, (e.target as HTMLElement).closest('[data-note]'))); }}
    onPointerMove={e => { if (!pointers.current.has(e.pointerId)) return; const n = noteAt(e.clientX, e.clientY);
      if (n !== null) press(e.pointerId, n, velocity(e.clientY, (e.target as HTMLElement).closest('[data-note]'))); }}
    onPointerUp={e => release(e.pointerId)} onPointerCancel={e => release(e.pointerId)} onLostPointerCapture={e => release(e.pointerId)}
    onContextMenu={e => e.preventDefault()}>
    {whites.map(n => <span key={n} data-note={n} className={'smp-white' + cls(n)}
      title={spec.keymap === 'whole' && n > root + 24 ? 'More than two octaves above the root: may sound harsh' : sliceOn(n) >= 0 ? 'Slice ' + (sliceOn(n) + 1) : undefined}>
      {label(n) ? <em>{label(n)}</em> : null}</span>)}
    {keys.filter(n => BLACK.has(n % 12)).map(n => {
      const left = whites.filter(w => w < n).length;
      return <span key={n} data-note={n} className={'smp-black' + cls(n)} title={sliceOn(n) >= 0 ? 'Slice ' + (sliceOn(n) + 1) : undefined}
        style={{ left: 'calc(' + (left / whites.length * 100) + '% - ' + (100 / whites.length * .31) + '%)', width: (100 / whites.length * .62) + '%' }}>
        {spec.keymap === 'slices' && sliceOn(n) >= 0 ? <em>{sliceOn(n) + 1}</em> : null}</span>;
    })}
  </div>;
}

/** Amp card: the envelope you drag, with the same four values as knobs. A drag is one undo step. */
function AmpCard({ spec, id, onEdit, onLive, shown: onBig, onShow }: { spec: SamplerSpec; id: string; onEdit: Edit; onLive: Edit; shown: boolean; onShow(): void }) {
  const [draft, setDraft] = useState<Partial<Env>>({});
  const held = useRef(false), latest = useRef<Partial<Env>>({});
  const env: Env = { attack: spec.attack, decay: spec.decay, sustain: spec.sustain, release: spec.release };
  useEffect(() => {
    const up = () => { if (!held.current) return; held.current = false; const d = latest.current; latest.current = {}; setDraft({});
      if (Object.keys(d).length) onEdit('patch', d); };
    document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
    return () => { document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true); };
  }, [onEdit]);
  const shown = { ...env, ...draft };
  const knob = (key: keyof Env, name: string, max: number, description: string) =>
    <CommittedKnob id={id + '-' + key} defaultValue={AMP_DEFAULTS[key]} name={name} value={spec[key]} min={0} max={max} step={key === 'sustain' ? .01 : .001}
      suffix={key === 'sustain' ? '%' : 's'} precision={key === 'sustain' ? 0 : 3} description={description}
      format={key === 'sustain' ? n => Math.round(n * 100) + '%' : n => n < 1 ? Math.round(n * 1000) + ' ms' : n.toFixed(2) + ' s'}
      onDraft={n => onLive(key, n)} onCommit={n => onEdit(key, n)} />;
  return <section className="smp-card smp-amp-card" aria-label="Amp">
    <div className="smp-card-head"><h2>Amp</h2>
      <button type="button" className="smp-card-icon" aria-label="Edit the envelope on the waveform" aria-pressed={onBig}
        title={onBig ? 'Back to Trim' : 'Drag Attack, Decay, Sustain and Release over the sound above'} onClick={onShow}><ArrowUp size={18} /></button></div>
    <div className="smp-knobs two smp-amp-knobs">
      {knob('attack', 'Attack', 3, 'Time to full level after a key goes down')}
      {knob('decay', 'Decay', 3, 'Time to fall to the sustain level')}
      {knob('sustain', 'Sustain', 1, 'Level while the key is held')}
      {knob('release', 'Release', 3, 'Fade after the key comes up (Hold and Loop)')}
    </div>
  </section>;
}

const AMP_DEFAULTS: Record<keyof Env, number> = { attack: 0, decay: 0, sustain: 1, release: .25 };

type PadChoice = { track: number; kit: string; pad: number; name: string; family: DrumKind };

export function SamplerPage({ track, trackIndex, runtime, record, pads, tracks, bpm, onEdit, onDetect, onMake, onMidi, onLoadWav, send, library, onChooseFolder, sends }: {
  track: Track; trackIndex: number; runtime?: SamplerRuntime | null; record?: SamplerRecord; pads: PadChoice[]; tracks: Track[]; bpm: number;
  onEdit: Edit; onDetect(): void; onMake(choice: PadChoice): void; onMidi(s: number, a: number, b: number): void;
  onLoadWav(): void; send(cmd: string, args: unknown): void;
  /** The sample library (stage 11) and the folder picker for its folders. */
  library?: SampleLibraryState | null; onChooseFolder?(): Promise<string | null>;
  /** the track's Reverb and Delay sends (Sends.tsx) */ sends?: import('react').ReactNode;
}) {
  const spec = track.sampler;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [mode, setMode] = useState<'trim' | 'chop'>(() => (spec?.slices?.length ? 'chop' : 'trim'));
  // Round 2: the big panel can also show the amp envelope or the filter curve, with points to drag.
  const [big, setBig] = useState<'wave' | 'env' | 'filter'>('wave');
  const [scale, setScale] = useState<'sound' | 'env'>('sound');
  const lastFilter = useRef<FilterShape>('lp');
  const [selected, setSelected] = useState(-1);
  const [marker, setMarker] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  // A take that has just been stopped goes straight into Chop.
  const lastState = useRef(record?.state);
  useEffect(() => {
    if (record?.state === 'saving' && lastState.current === 'recording' && record.track === trackIndex) { setRecording(false); setMode('chop'); }
    lastState.current = record?.state;
  }, [record?.state, record?.track, trackIndex]);
  const [settings, setSettings] = useState<ChopSettings>({ mode: 'threshold', threshold: -30, min_ms: 150, count: 16, bpm: Math.round(bpm) || 120, beats: 1 });
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A loaded WAV has no drum family: it takes the track's colour.
  const accent = spec?.family === 'sample' || !spec?.source ? TRACK_COLORS[trackIndex % TRACK_COLORS.length] : familyColor(spec?.family);
  const style = { ['--pad-accent' as string]: accent, ['--drum-accent' as string]: TRACK_COLORS[trackIndex % TRACK_COLORS.length] };
  if (!spec) return <section className="drum-rack sampler-page" aria-label="Sampler" style={style}><p className="smp-empty">Preparing the Sampler…</p></section>;
  const slices = spec.slices ?? [];
  const sel = selected < slices.length ? selected : -1;
  const status = runtime?.status ?? (spec.source ? 'LOADING' : 'EMPTY');
  const id = 'smp-' + trackIndex + '-' + spec.id;
  const file = spec.source?.path.split(/[\\/]/).pop();
  const view = runtime?.view ?? [0, 1];
  const zoomed = view[1] - view[0] < .999;
  const chop = (m: string, options?: Record<string, unknown>) => send('sampler_chop', [trackIndex, spec.id, m, options ?? {}]);
  const apply = (s: ChopSettings) => chop(s.mode, s.mode === 'threshold' ? { threshold: s.threshold, min_ms: s.min_ms }
    : s.mode === 'regions' ? { count: s.count } : { bpm: s.bpm, beats: s.beats });
  const setView = (a: number, b: number) => send('sampler_view', [trackIndex, spec.id, Math.max(0, a), Math.min(1, b)]);
  /** A knob that is still turning: the engine plays the value now; the edit (and its undo step) comes on release. */
  const onLive: Edit = (key, value) => send('sampler_live', [trackIndex, spec.id, { [key]: value }]);
  const toMode = (m: 'trim' | 'chop') => { setMode(m); setBig('wave'); };   // the zoom stays: F (or Fit) shows the whole sample
  const chopShown = mode === 'chop' && big === 'wave';
  const filterOn = (spec.filter ?? 'off') !== 'off';
  if (filterOn) lastFilter.current = spec.filter as FilterShape;
  const shape: FilterShape = filterOn ? spec.filter as FilterShape : lastFilter.current;
  const familyLabel = spec.family in DRUM_KINDS && spec.family !== 'other' ? DRUM_KINDS[spec.family as DrumKind].label : /^Recording/.test(spec.name) ? 'Recordings' : 'Samples';
  return <section className="drum-rack sampler-page" aria-label="Sampler" style={style}>
    {libraryOpen ? <SampleLibrarySheet library={library} spec={spec} track={trackIndex} selectedSlice={mode === 'chop' ? sel : -1} defaultCategory={familyLabel}
      onClose={() => setLibraryOpen(false)} onChooseFolder={() => onChooseFolder ? onChooseFolder() : Promise.resolve(null)} send={send} /> : null}
    {!spec.source ? <div className="smp-pick" aria-label="Choose a sound to play on the keys">
      <div className="smp-empty-zone">
        <AudioWaveform size={30} />
        <div className="smp-empty-title"><h2>Play a sound on the keys</h2><p>Track {trackIndex + 1} has no sample yet. Bring one in and it plays across the keyboard.</p></div>
        <div className="smp-empty-actions">
          <button type="button" className="smp-empty-card" aria-label="Load a WAV" onClick={onLoadWav}><FolderOpen size={22} /><strong>Load a WAV</strong><span>A bounce or a long take, up to 10 minutes</span></button>
          <button type="button" className="smp-empty-card" aria-label="Record" onClick={() => setRecording(true)}><Mic size={22} /><strong>Record</strong><span>The piano or a mic; it goes into Chop</span></button>
          <button type="button" className="smp-empty-card" aria-label="From the library" onClick={() => setLibraryOpen(true)}><BookOpen size={22} /><strong>From the library</strong><span>Samples you saved before</span></button>
        </div>
      </div>
      {pads.length ? <div className="smp-pick-pads"><h3>Or play a drum pad on the keys</h3>
        <div className="smp-pick-grid">{pads.map(p => <button key={p.track + ':' + p.pad} type="button" style={{ ['--pad' as string]: DRUM_KINDS[p.family].color }}
          onClick={() => onMake(p)}><b>Track {p.track + 1} · Pad {String(p.pad + 1).padStart(2, '0')}</b><span>{p.name}</span></button>)}</div></div>
        : <p className="smp-pick-hint">Tip: load a kit on a Drum Rack track, and its pads show up here to play on the keys.</p>}
    </div> : <>
      {big === 'env' ? <div className="smp-drag-shell"><SamplerEnvView env={{ attack: spec.attack, decay: spec.decay, sustain: spec.sustain, release: spec.release }}
        seconds={runtime?.seconds ?? 0} region={[spec.start, spec.end]} peaks={runtime?.peaks ?? []} view={runtime?.view ?? [0, 1]} playing={runtime?.playing ?? []} reverse={!!spec.reverse} scale={scale}
        onLive={onLive} onCommit={p => onEdit('patch', p)} /></div>
      : big === 'filter' ? <div className="smp-drag-shell"><FilterView type={spec.filter ?? 'off'} cutoff={spec.cutoff ?? 2000} resonance={spec.resonance ?? .2}
        onLive={onLive} onCommit={p => onEdit('patch', p)} /></div>
      : <SampleWindow spec={spec} runtime={runtime} mode={mode} selected={sel} marker={marker} onEdit={onEdit}
        onView={setView} onChop={(m, o) => { chop(m, o); }} onAudition={i => send('sampler_audition', [trackIndex, spec.id, i])}
        onLibrary={i => { if (i >= 0) setSelected(i); setLibraryOpen(true); }}
        onSelect={(i, at) => { setSelected(i); setMarker(at); if (i >= 0) send('sampler_audition', [trackIndex, spec.id, i]); }} />}
      {runtime?.error ? <p className="drum-source-error" role="status">{runtime.error}</p> : null}
      <div className={'smp-deck' + (chopShown ? ' has-chop' : '')}>
      {chopShown ? <ChopBar spec={spec} settings={settings} selected={sel} marker={marker} zoomed={zoomed}
        onSettings={(s, now) => { setSettings(s); if (now) { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => apply(s), 250); } }}
        onChop={(m, o) => { chop(m, o); if (m === 'clear') setSelected(-1); }}
        onZoom={() => {
          if (zoomed) { setView(0, 1); return; }
          if (sel >= 0) { const [a, b] = slices[sel]; const pad = Math.max((b - a) * .15, .001); setView(a - pad, b + pad); }
          else if (marker !== null) setView(marker - .04, marker + .04);
        }}
        /> : null}
      <div className="smp-cards" key={spec.id}>
        <section className="smp-card smp-play" aria-label="Play">
          <h2>Play</h2>
          <div className="smp-seg" role="radiogroup" aria-label="Play mode">
            {MODES.map(([m, label, title]) => <button key={m} type="button" role="radio" aria-checked={spec.mode === m} title={title} onClick={() => onEdit('mode', m)}>{label}</button>)}
          </div>
          <div className="smp-line">
            <div className="smp-seg" role="radiogroup" aria-label="Voices">
              <button type="button" role="radio" aria-checked={spec.poly} title="Chords: up to 16 notes at once" onClick={() => onEdit('poly', true)}>Poly</button>
              <button type="button" role="radio" aria-checked={!spec.poly} title="One note at a time; glides between held keys" onClick={() => onEdit('poly', false)}>Mono</button>
            </div>
            <button type="button" className="smp-toggle" aria-pressed={!!spec.reverse} title="Play backwards" onClick={() => onEdit('reverse', !spec.reverse)}><Undo2 size={15} />Reverse</button>
          </div>
          <div className="smp-knobs two">
            <CommittedKnob id={id + '-glide'} defaultValue={0} name="Glide" value={spec.glide} min={0} max={2} step={.001} suffix="s" precision={3}
              description="Mono only: slide from the held note to the next one" format={n => n <= 0 ? 'Off' : n < 1 ? Math.round(n * 1000) + ' ms' : n.toFixed(2) + ' s'} onDraft={n => onLive('glide', n)} onCommit={n => onEdit('glide', n)} />
            <CommittedKnob id={id + '-gain'} defaultValue={1} name="Gain" value={spec.gain} min={0} max={2} step={.01} suffix="×" precision={2} description="Level of every note" onDraft={n => onLive('gain', n)} onCommit={n => onEdit('gain', n)} />
            <CommittedKnob id={id + '-velocity'} defaultValue={1} name="Velocity" value={spec.velocity} min={0} max={2} step={.01} suffix="×" precision={2}
              description="How much softer soft notes are: 0 is fixed level, 1 is linear" onDraft={n => onLive('velocity', n)} onCommit={n => onEdit('velocity', n)} />
            <button type="button" className="smp-toggle" aria-pressed={!!spec.normalize} title="Bring the loudest peak to full level" onClick={() => onEdit('normalize', !spec.normalize)}><Maximize2 size={15} />Normalize</button>
          </div>
        </section>
        <section className="smp-card smp-pitch" aria-label="Pitch">
          <h2>Pitch</h2>
          <div className="smp-seg" role="radiogroup" aria-label="Keys">
            {KEYMAPS.map(([k, label, title]) => <button key={k} type="button" role="radio" aria-checked={(spec.keymap ?? 'whole') === k} title={title}
              disabled={k !== 'whole' && !slices.length}
              onClick={() => { if (k === 'pitched' && !slices.some(p => p.length > 2)) send('sampler_slice_roots', [trackIndex, spec.id]); else onEdit('keymap', k); }}>{label}</button>)}
          </div>
          {spec.keymap === 'pitched' ? <div className="smp-root" role="group" aria-label="Slice roots">
            <span>Roots</span><strong aria-live="polite">{slices.filter(p => p.length > 2).length} of {slices.length}</strong>
            <button type="button" className="smp-detect" title="Find each slice's pitch again" disabled={runtime?.busy?.includes('roots')}
              onClick={() => send('sampler_slice_roots', [trackIndex, spec.id])}><ScanSearch size={16} />{runtime?.busy?.includes('roots') ? 'Finding…' : 'Detect'}</button>
          </div> : <div className="smp-root" role="group" aria-label={spec.keymap === 'slices' ? 'First slice key' : 'Root note'}>
            <ValueBox label={spec.keymap === 'slices' ? 'Slice 1 on' : 'Root'} value={spec.root} min={0} max={127} step={1} coarse={12} fine={1}
              format={noteName} parse={parseNote} onChange={n => onEdit('root', n)}
              title="Click, then scroll: a semitone (Shift: an octave) · two slow clicks to type a note like C4 or a number" />
            {spec.keymap !== 'slices' ? <button type="button" className="smp-detect" title="Find the note the sample sounds at" onClick={onDetect}><ScanSearch size={16} />Detect</button> : null}
          </div>}
          <div className="smp-knobs two">
            <CommittedKnob id={id + '-tune'} defaultValue={0} name="Tune" value={spec.tune} min={-24} max={24} step={1} suffix="st" precision={0} description="Shift every key by semitones" onDraft={n => onLive('tune', n)} onCommit={n => onEdit('tune', n)} />
            <CommittedKnob id={id + '-fine'} defaultValue={0} name="Fine" value={spec.fine} min={-100} max={100} step={1} suffix="ct" precision={0} description="Fine tuning in cents" onDraft={n => onLive('fine', n)} onCommit={n => onEdit('fine', n)} />
            <CommittedKnob id={id + '-p_env'} defaultValue={0} name="Pitch env" value={spec.p_env ?? 0} min={-24} max={24} step={.1} suffix="st" precision={1}
              description="Each note starts this many semitones away and settles to its pitch" format={n => Math.abs(n) < .05 ? 'Off' : (n > 0 ? '+' : '') + n.toFixed(1) + ' st'} onDraft={n => onLive('p_env', n)} onCommit={n => onEdit('p_env', n)} />
            <CommittedKnob id={id + '-p_decay'} defaultValue={0.15} name="Env time" value={spec.p_decay ?? .15} min={0} max={3} step={.001} suffix="s" precision={3}
              description="How long the pitch envelope takes to settle" format={n => n < 1 ? Math.round(n * 1000) + ' ms' : n.toFixed(2) + ' s'} onDraft={n => onLive('p_decay', n)} onCommit={n => onEdit('p_decay', n)} />
          </div>
        </section>
        <section className={'smp-card smp-filter' + ((spec.filter ?? 'off') === 'off' ? ' off' : '')} aria-label="Filter">
          <div className="smp-card-head"><h2>Filter</h2>
            <button type="button" role="switch" className="smp-power" aria-checked={filterOn} aria-label="Filter on"
              title={filterOn ? 'Turn the filter off (the settings are kept)' : 'Turn the filter on'}
              onClick={() => onEdit('filter', filterOn ? 'off' : lastFilter.current)}><Power size={14} />{filterOn ? 'On' : 'Off'}</button>
            <button type="button" className="smp-card-icon" aria-label="Edit the filter on the waveform" aria-pressed={big === 'filter'}
              title={big === 'filter' ? 'Back to Trim' : 'Drag the cutoff and resonance on the big view above'} onClick={() => setBig(big === 'filter' ? 'wave' : 'filter')}><ArrowUp size={18} /></button></div>
          <div className="smp-seg smp-filter-shapes" role="radiogroup" aria-label="Filter type">
            {FILTERS.map(([f, short, name, title]) => <button key={f} type="button" role="radio" aria-label={name} aria-checked={shape === f} title={title}
              onClick={() => { lastFilter.current = f; onEdit('filter', f); }}><FilterIcon shape={f} /><span>{short}</span></button>)}
          </div>
          <div className="smp-knobs two">
            <CommittedKnob id={id + '-cutoff'} defaultValue={Math.log2(100)} name="Cutoff" value={Math.log2((spec.cutoff ?? 2000) / 20)} min={0} max={Math.log2(1000)} step={.01}
              description="Where the filter cuts" format={n => hz(20 * 2 ** n)} onDraft={n => onLive('cutoff', Math.round(Math.min(20000, Math.max(20, 20 * 2 ** n))))} onCommit={n => onEdit('cutoff', Math.round(Math.min(20000, Math.max(20, 20 * 2 ** n))))} />
            <CommittedKnob id={id + '-resonance'} defaultValue={0.2} name="Resonance" value={spec.resonance ?? .2} min={0} max={1} step={.01} suffix="%" precision={0}
              description="A peak at the cutoff" format={n => Math.round(n * 100) + '%'} onDraft={n => onLive('resonance', n)} onCommit={n => onEdit('resonance', n)} />
            <CommittedKnob id={id + '-f_env'} defaultValue={0} name="Env" value={spec.f_env ?? 0} min={-1} max={1} step={.01} suffix="%" precision={0}
              description="How far the filter's envelope moves the cutoff (100% is five octaves)" format={n => Math.abs(n) < .005 ? 'Off' : (n > 0 ? '+' : '') + Math.round(n * 100) + '%'} onDraft={n => onLive('f_env', n)} onCommit={n => onEdit('f_env', n)} />
            <CommittedKnob id={id + '-f_velocity'} defaultValue={0} name="Velocity" value={spec.f_velocity ?? 0} min={0} max={1} step={.01} suffix="%" precision={0}
              description="Soft notes are darker: up to four octaves lower" format={n => n < .005 ? 'Off' : Math.round(n * 100) + '%'} onDraft={n => onLive('f_velocity', n)} onCommit={n => onEdit('f_velocity', n)} />
            <CommittedKnob id={id + '-f_attack'} defaultValue={0} name="Attack" value={spec.f_attack ?? 0} min={0} max={3} step={.001} suffix="s" precision={3}
              description="Time for the filter envelope to rise" format={n => n < 1 ? Math.round(n * 1000) + ' ms' : n.toFixed(2) + ' s'} onDraft={n => onLive('f_attack', n)} onCommit={n => onEdit('f_attack', n)} />
            <CommittedKnob id={id + '-f_decay'} defaultValue={0.3} name="Decay" value={spec.f_decay ?? .3} min={0} max={3} step={.001} suffix="s" precision={3}
              description="Time for the filter envelope to fall back" format={n => n < 1 ? Math.round(n * 1000) + ' ms' : n.toFixed(2) + ' s'} onDraft={n => onLive('f_decay', n)} onCommit={n => onEdit('f_decay', n)} />
          </div>
        </section>
      </div>
      <aside className="smp-side">
        <div className="smp-rack smp-tools" role="toolbar" aria-label="Sampler tools">
          <div className="smp-rack-main"><div className="smp-rack-grid">
          <div className="smp-rack-row smp-tabs" role="radiogroup" aria-label="Edit">
            <button type="button" role="radio" className="smp-tool" style={tool('trim')} aria-label="Trim" aria-checked={big === 'wave' && mode === 'trim'} title="Trim: where the sample starts and ends, and its loop" onClick={() => toMode('trim')}><Crop size={18} /><span>Trim</span></button>
            <button type="button" role="radio" className="smp-tool" style={tool('chop')} aria-label="Chop" aria-checked={big === 'wave' && mode === 'chop'} title="Chop: cut it into slices for pads" onClick={() => toMode('chop')}><Scissors size={18} /><span>Chop</span></button>
            <button type="button" role="radio" className="smp-tool" style={tool('env')} aria-label="Envelope" aria-checked={big === 'env'} title="Envelope: drag Attack, Decay, Sustain and Release over the sound" onClick={() => setBig('env')}><Activity size={18} /><span>Env</span></button>
            <button type="button" role="radio" className="smp-tool" style={tool('filter')} aria-label="Filter" aria-checked={big === 'filter'} title="Filter: drag the cutoff and resonance" onClick={() => setBig('filter')}><SlidersHorizontal size={18} /><span>Filter</span></button>
          </div>
          <div className="smp-rack-row">
            <button type="button" className="smp-tool smp-lib-open" style={tool('library')} aria-label="Library" aria-pressed={libraryOpen} onClick={() => setLibraryOpen(o => !o)} title="Library: load a saved sample, or save this one"><BookOpen size={18} /><span>Library</span></button>
            <button type="button" className="smp-tool smp-rec-open" style={tool('record')} aria-label="Record" aria-pressed={recording} onClick={() => setRecording(r => !r)} title="Record the piano or another input into this Sampler"><Mic size={18} /><span>Record</span></button>
            <button type="button" className="smp-tool smp-load" style={tool('load')} aria-label="Load WAV" onClick={onLoadWav} title={'Load a WAV file, up to 10 minutes' + (file ? ' (now: ' + file + ')' : '')}><FolderOpen size={18} /><span>Load</span></button>
            <button type="button" className="smp-tool smp-clear-sample" style={tool('clear')} aria-label="Clear sample" title="Clear sample: empty this Sampler (Undo brings it back; the file stays)"
              onClick={() => { setSelected(-1); setMarker(null); setMode('trim'); send('sampler_clear', [trackIndex, spec.id]); }}><Trash2 size={17} /><span>Clear</span></button>
          </div></div>
          <div className="smp-rack-display" aria-live="polite">
            {big === 'env' ? <ScaleSwap scale={scale} onChange={setScale} /> : null}
            <strong className={'drum-status status-' + status.toLowerCase()}><i aria-hidden="true" />{status}</strong>
            {big !== 'env' && runtime?.seconds ? <span className="smp-rack-len">{fmtS(runtime.seconds)}</span> : null}
          </div></div>
          {chopShown ? <ChopOut spec={spec} runtime={runtime} selected={sel} onSend={() => setSending(s => !s)} /> : null}
        </div>
        <AmpCard key={spec.id} spec={spec} id={id} onEdit={onEdit} onLive={onLive} shown={big === 'env'} onShow={() => setBig(big === 'env' ? 'wave' : 'env')} />
        {sends ? <div className="drum-sends smp-sends" aria-label="Sends">{sends}</div> : null}
      </aside>
      </div>
      <SamplerKeys spec={spec} onMidi={onMidi} />
      {sending && mode === 'chop' ? <SendSheet spec={spec} selected={sel} trackIndex={trackIndex} tracks={tracks} onClose={() => setSending(false)}
        onSend={(target, how, options) => send('sampler_send', [trackIndex, spec.id, target, how, options])} /> : null}
    </>}
    {recording ? <RecordSheet spec={spec} trackIndex={trackIndex} record={record} send={send} onClose={() => setRecording(false)} /> : null}
  </section>;
}

const LENGTHS = [10, 20, 30, 60, 120, 300, 600];
/** A pad is a hit or a phrase: 5 s to a minute (MPC's default is 20 s). */
const PAD_LENGTHS = [5, 10, 20, 30, 60];
const parseClock = (t: string) => { const m = /^(\d+):(\d{1,2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : Number.isFinite(Number(t)) ? Number(t) : null; };
const clock = (s: number) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

/** Record the piano (or any input) into this Sampler, or onto a Drum Rack pad (pad given, 16 Nov): pick the input,
 *  watch its level, arm, play. A Sampler take goes into Chop; a pad take goes onto the pad. */
export function RecordSheet({ spec, trackIndex, record, send, onClose, pad }: {
  spec: { id: string }; trackIndex: number; record?: SamplerRecord; send(cmd: string, args: unknown): void; onClose(): void; pad?: number;
}) {
  const onPad = pad !== undefined;
  const lengths = onPad ? PAD_LENGTHS : LENGTHS;
  const [threshold, setThreshold] = useState(record?.threshold ?? -40);
  const [length, setLength] = useState(record?.length && lengths.includes(record.length) ? record.length : onPad ? 20 : 60);
  const [gainDb, setGainDb] = useState(record?.gain ?? 0);
  const [normalize, setNormalize] = useState(record?.normalize ?? true);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    send('sampler_record', ['open', null]);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close.current(); } };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); send('sampler_record', ['close']); };
    // Opened once per sheet; closing it stops a take (and keeps it) or drops an armed one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const sendNow = useRef(send); sendNow.current = send;
  useEffect(() => { sendNow.current('sampler_record', ['level', threshold, length, gainDb, normalize]); }, [threshold, length, gainDb, normalize]);
  const state = record?.state ?? 'idle';
  // Another track's live take never blocks this one: Arm or Record now here keeps that take and starts this one.
  const other = record?.track !== null && record?.track !== undefined && (record.track !== trackIndex || (record.pad ?? undefined) !== pad) && (state === 'armed' || state === 'recording');
  const mine = !other;
  const busy = mine && (state === 'armed' || state === 'recording');
  const peak = record?.peak ?? -90;
  const inputs = record?.inputs ?? [];
  const level = Math.max(-60, record?.level ?? -90);
  const pct = (d: number) => Math.max(0, Math.min(100, (d + 60) / 60 * 100)) + '%';
  const go = (how: 'arm' | 'now') => send('sampler_record', onPad ? [how, trackIndex, spec.id, threshold, length, pad] : [how, trackIndex, spec.id, threshold, length]);
  const where = (t: number, p?: number | null) => p !== null && p !== undefined ? 'Pad ' + (p + 1) + ' on track ' + (t + 1) : 'Track ' + (t + 1);
  const words = !inputs.length ? 'No input found. Plug in the piano\'s USB audio, or an audio interface, then tap Look again.'
    : record?.error && state === 'idle' ? record.error
    : !mine ? where(record?.track ?? 0, record?.pad) + (state === 'armed' ? ' is armed. Arm here to take over.' : ' is recording. Arm or Record now here keeps that take and starts this one.')
    : state === 'armed' ? 'Waiting for sound above ' + threshold + ' dB. Play now.'
    : state === 'recording' ? 'Recording ' + clock(record?.seconds ?? 0) + ' of ' + clock(length) + (record?.clipped ? '. It clipped: turn the input down.' : '')
    : state === 'saving' ? 'Saving the take…'
    : 'Arm waits for you to play: the take starts when the level passes the threshold, and goes ' + (onPad ? 'onto pad ' + ((pad ?? 0) + 1) : 'into Chop') + ' when you stop.';
  return <div className="smp-sheet-screen" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="smp-sheet smp-record" role="dialog" aria-label={onPad ? 'Record into the pad' : 'Record into the Sampler'}>
      <header><Mic size={20} /><h2>Record into <em>{onPad ? 'Pad ' + ((pad ?? 0) + 1) : 'Track ' + (trackIndex + 1)}</em></h2>
        <button type="button" className="smp-done" onClick={onClose}>Done</button></header>
      {inputs.length ? <div className="smp-targets smp-inputs" role="radiogroup" aria-label="Input">
        {inputs.map(name => <button key={name} type="button" role="radio" aria-checked={record?.input === name} disabled={busy} title={name}
          onClick={() => send('sampler_record', ['open', name])}>{/piano|keys|synth/i.test(name) ? <KeyboardMusic size={17} /> : <Mic size={17} />}
          <b>{name.replace(/^Monitor of /, '').replace(/ (Analog )?Stereo$| Internal Microphone$/, m => m.includes('Micro') ? ' mic' : '')}</b>
          <span>{name.startsWith('Monitor of') ? 'What this computer plays' : name === 'Test input' ? 'A test recording' : /micro/i.test(name) ? 'Microphone' : 'Line in'}</span></button>)}
      </div> : <button type="button" className="smp-look" onClick={() => send('sampler_record', ['open', null])}><ScanSearch size={17} />Look again</button>}
      <div className="rec-meter-wrap">
        <div className="rec-readout"><strong className={level > -1 ? 'hot' : level > -12 ? 'warm' : ''}>{record?.input ? Math.round(level) : '–'}<small> dB</small></strong>
          <span>peak {peak > -90 ? Math.round(peak) + ' dB' : '–'}</span></div>
        <div className="smp-meter rec-meter" role="meter" aria-label="Input level" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.round(level)}>
          <div className="rec-segs">{Array.from({ length: 30 }, (_, i) => { const db = -60 + i * 2;
            return <i key={i} className={(level >= db ? 'lit ' : '') + (db >= -6 ? 'red' : db >= -18 ? 'amber' : 'green') + (peak > -60 && Math.abs(peak - db) < 1 ? ' peak' : '')} />; })}</div>
          <b className="rec-threshold" style={{ left: pct(threshold) }}><span>Threshold</span></b>
          <div className="rec-scale" aria-hidden="true">{[-60, -48, -36, -24, -18, -12, -6, 0].map(d => <span key={d} style={{ left: pct(d) }}>{d}</span>)}</div>
        </div>
      </div>
      <div className="rec-controls">
        <CommittedKnob id={'smp-rec-gain-' + trackIndex} defaultValue={0} name="Input gain" value={gainDb} min={0} max={30} step={.5} suffix="dB" precision={1}
          description="Lifts a quiet input before the meter and the threshold (the piano's line out is low)" format={n => '+' + n.toFixed(1) + ' dB'} onCommit={setGainDb} />
        <ValueBox label="Threshold" value={threshold} min={-60} max={-6} step={1} coarse={6} fine={.5} format={dB} onChange={setThreshold}
          title="Arm starts the take when the level passes this. Click, then scroll (Shift big, Ctrl fine) · two slow clicks to type" />
        <ValueBox label="Longest" value={length} list={lengths} format={clock} disabled={busy} onChange={setLength} parse={parseClock}
          title="The take stops by itself at this length" />
        <button type="button" className="smp-toggle" aria-pressed={normalize} title="Bring each take's loudest peak to -1 dB when it is saved (at most +24 dB)"
          onClick={() => setNormalize(v => !v)}><Maximize2 size={15} />Normalize take</button>
      </div>
      {peak > -90 && peak < -18 && !busy ? <em className="rec-hint">Quiet input: raise Input gain</em> : peak >= -0.5 ? <em className="rec-hint hot">Clipping: lower Input gain</em> : null}
      <p role="status" className={'smp-record-words ' + state}>{words}</p>
      <footer>
        {state === 'recording' && mine ? <button type="button" className="smp-make smp-stop" onClick={() => send('sampler_record', ['stop'])}>{onPad ? <><Square size={16} />Stop and keep</> : <><Scissors size={18} />Stop and chop</>}</button> : <>
          {state === 'armed' && mine ? <button type="button" onClick={() => send('sampler_record', ['cancel'])}>Disarm</button> : null}
          <button type="button" disabled={!record?.input || (state === 'saving' && mine)} onClick={() => go('now')}>Record now</button>
          {state !== 'armed' || !mine ? <button type="button" className="smp-make" disabled={!record?.input || (state === 'saving' && mine)} onClick={() => go('arm')}><Mic size={18} />Arm</button> : null}
        </>}
      </footer>
    </div>
  </div>;
}

/** Pads with a sample on Drum Rack tracks, for the Sampler's empty state. */
export function padChoices(tracks: Track[]): PadChoice[] {
  return tracks.flatMap((t, track) => t.device === 'drum_rack' && t.drum_rack ? t.drum_rack.pads.flatMap((p, pad) => p.source ? [{
    track, kit: t.drum_rack!.id, pad, name: padLabel(p.name, t.drum_rack!.name), family: drumKind(p.name, p.source.path) }] : []) : []);
}

/** The sheet from Pad Sound: which track plays this pad on the keys, and from which root. */
export function PlayOnKeysSheet({ padName, family, sourceTrack, tracks, onMake, onClose }: {
  padName: string; family: DrumKind; sourceTrack: number; tracks: Track[];
  onMake(target: number, root: number | null): void; onClose(): void;
}) {
  // The pad's own track is a choice too: when one sound is all you need, the kit makes way for it (Undo brings the kit back).
  const others = tracks.map((_, i) => i);
  const [target, setTarget] = useState(others.find(i => i !== sourceTrack && tracks[i]?.device === 'sampler') ?? others.find(i => i !== sourceTrack) ?? sourceTrack);
  const [root, setRoot] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const what = (i: number) => { const t = tracks[i]; if (!t) return '';
    return t.device === 'drum_rack' ? 'Drum Rack' + (t.drum_rack?.name ? ' · ' + t.drum_rack.name : '') : t.device === 'sampler' ? 'Sampler · ' + (t.sampler?.source ? t.sampler.name : 'empty') : 'Synth · ' + t.preset; };
  return <div className="smp-sheet-screen" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} className="smp-sheet" role="dialog" aria-label={'Play ' + padName + ' on the keys'} style={{ ['--pad-accent' as string]: DRUM_KINDS[family].color }}>
      <header><KeyboardMusic size={20} /><h2>Play <em>{padName}</em> on the keys</h2><button type="button" className="smp-done" onClick={onClose}>Close</button></header>
      <p>Which track should play it? That track becomes a Sampler.</p>
      <div className="smp-targets" role="radiogroup" aria-label="Track">
        {others.map(i => <button key={i} type="button" role="radio" aria-checked={target === i} onClick={() => setTarget(i)}>
          <b>Track {i + 1}{i === sourceTrack ? ' · this one' : ''}</b><span>{i === sourceTrack ? 'Only this sound: the kit makes way' : what(i)}</span></button>)}
      </div>
      <div className="smp-root" role="group" aria-label="Root note">
        <span>Root note</span>
        <button type="button" aria-pressed={root === null} onClick={() => setRoot(null)} title="Find the note the sample sounds at; C4 when it has no clear pitch">Detect</button>
        <ValueBox label="Root" hideLabel value={root ?? 60} min={0} max={127} step={1} coarse={12} fine={1} format={n => root === null ? 'Auto' : noteName(n)} parse={parseNote} onChange={setRoot} />
      </div>
      <footer><button type="button" className="smp-make" onClick={() => onMake(target, root)}><KeyboardMusic size={18} />Make Sampler on track {target + 1}</button></footer>
    </div>
  </div>;
}
