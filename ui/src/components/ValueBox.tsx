/* Value box (Sir, 15 Nov evening; UI-RULES 36). Replaces − / + steppers.
   - One click arms it: the mouse wheel moves the value (Shift = big steps, Ctrl = fine steps). Arrow keys work too.
   - Two slow clicks (like renaming a file: the second 0.4–1.6 s after the first) open number entry. Enter keeps, Esc drops.
   - Touch: hold and drag. Up/down moves in normal steps, left/right in fine steps. Mouse drag works the same.
   - A wheel or drag gesture is one change (committed when it settles), so it is one undo step.
   - A live box has a subtle accent edge and a small ⇕ cue instead of − / + buttons. */
import { useEffect, useRef, useState } from 'react';
import '../vbox.css';

export type ValueBoxProps = {
  label: string; value: number; onChange(n: number): void;
  /** A list of allowed values (thresholds, lengths): steps move through it. */
  list?: number[];
  min?: number; max?: number; step?: number; coarse?: number; fine?: number;
  format?(n: number): string; parse?(text: string): number | null;
  disabled?: boolean; className?: string; title?: string; hideLabel?: boolean;
  /** Fires per wheel tick / drag step instead of only on settle (e.g. a local-only value). */
  live?: boolean;
};

const SLOW_MIN = 400, SLOW_MAX = 1600, SETTLE = 350, DRAG_PX = 14, HOLD_MS = 220;

export function ValueBox({ label, value, onChange, list, min = -Infinity, max = Infinity, step = 1, coarse, fine, format, parse,
  disabled, className, title, hideLabel, live }: ValueBoxProps) {
  const [armed, setArmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = draft ?? value;
  const latest = useRef(shown); latest.current = shown;
  const valueRef = useRef(value); valueRef.current = value;
  const change = useRef(onChange); change.current = onChange;
  const lastClick = useRef(0);
  const settle = useRef<number | undefined>(undefined);
  const drag = useRef<{ id: number; x: number; y: number; start: number; on: boolean; timer?: number; moved: boolean } | null>(null);

  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const snap = (n: number) => {
    if (list?.length) return list.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a, list[0]);
    const q = fine ?? step; return clamp(+(Math.round(n / q) * q).toFixed(6));
  };
  /** Moves `from` by `steps` of a kind: 'normal' | 'coarse' | 'fine'. */
  const move = (from: number, steps: number, kind: 'normal' | 'coarse' | 'fine') => {
    if (list?.length) {
      const at = list.indexOf(snap(from)), jump = kind === 'coarse' ? 3 : 1;
      return list[Math.max(0, Math.min(list.length - 1, at + Math.sign(steps) * jump * Math.max(1, Math.round(Math.abs(steps)))))];
    }
    const size = kind === 'coarse' ? (coarse ?? step * 10) : kind === 'fine' ? (fine ?? step / 10) : step;
    const n = from + steps * size; const q = kind === 'fine' ? (fine ?? step / 10) : step;   // big steps keep the normal grid (121 + 10 = 131)
    return clamp(+(Math.round(n / q) * q).toFixed(6));
  };
  const commitSoon = (n: number) => {
    setDraft(n); if (live) change.current(n);
    window.clearTimeout(settle.current);
    // Commit to the handler the edit started on: if the track is switched before it settles, the new track must not get it.
    const target = change.current;
    settle.current = window.setTimeout(() => { setDraft(null); if (!live && n !== valueRef.current) target(n); }, SETTLE);
  };
  const commitNow = (n: number) => { window.clearTimeout(settle.current); setDraft(null); if (n !== valueRef.current) change.current(n); };
  useEffect(() => () => window.clearTimeout(settle.current), []);

  // The wheel needs a non-passive listener to stop the page (and Ctrl+wheel zoom) from moving.
  useEffect(() => {
    const el = box.current; if (!el || !armed || disabled) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      const d = e.deltaY || e.deltaX; if (!d) return;            // Shift+wheel arrives as deltaX in Chromium
      lastClick.current = 0;                                      // a click after scrolling never opens entry
      commitSoon(move(latest.current, d < 0 ? 1 : -1, e.shiftKey ? 'coarse' : e.ctrlKey || e.metaKey ? 'fine' : 'normal'));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  // Clicking anywhere else disarms it.
  useEffect(() => {
    if (!armed) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setArmed(false); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [armed]);
  useEffect(() => { if (editing) { setText(format ? format(value).replace(/[^\d.,:+-]+$/g, '').trim() : String(value)); requestAnimationFrame(() => input.current?.select()); } }, [editing]);

  const closed = useRef(true);
  const openEntry = () => { if (!disabled) { closed.current = false; setArmed(false); setEditing(true); } };
  const finishEntry = (keep: boolean) => {
    if (closed.current) return; closed.current = true;     // Esc then the blur it causes: only the first counts
    if (keep) {
      const raw = text.trim().replace(',', '.');
      const n = parse ? parse(raw) : Number.parseFloat(raw);
      if (n !== null && Number.isFinite(n)) commitNow(snap(clamp(n)));
    }
    setEditing(false); box.current?.focus();
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || editing || e.button !== 0) return;
    const now = performance.now(), since = now - lastClick.current;
    lastClick.current = now;
    if (armed && since >= SLOW_MIN && since <= SLOW_MAX) { e.preventDefault(); lastClick.current = 0; openEntry(); return; }
    setArmed(true); box.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = { id: e.pointerId, x: e.clientX, y: e.clientY, start: latest.current, on: e.pointerType === 'mouse', moved: false, timer: undefined as number | undefined };
    // Touch: hold first, so a swipe across the screen still scrolls / plays what it should.
    if (e.pointerType !== 'mouse') d.timer = window.setTimeout(() => { if (drag.current === d) { d.on = true; setArmed(true); } }, HOLD_MS);
    drag.current = d;
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = d.y - e.clientY;
    if (!d.on) { if (Math.hypot(dx, dy) > 10) { window.clearTimeout(d.timer); drag.current = null; } return; }
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    // Up/down: normal steps (Shift: big). Left/right: fine steps. Both add up.
    let n = move(d.start, Math.trunc(dy / DRAG_PX), e.shiftKey ? 'coarse' : 'normal');
    if (!list?.length && Math.abs(dx) >= DRAG_PX) n = move(n, Math.trunc(dx / DRAG_PX), 'fine');
    else if (list?.length && Math.abs(dx) >= DRAG_PX * 2 && Math.abs(dx) > Math.abs(dy)) n = move(d.start, Math.trunc(dx / (DRAG_PX * 2)), 'normal');
    setDraft(n); if (live) change.current(n);
  };
  const upDrag = (cancel: boolean) => (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    window.clearTimeout(d.timer); drag.current = null;
    if (d.moved) { lastClick.current = 0; if (cancel) { setDraft(null); if (live) change.current(d.start); } else commitNow(latest.current); }
  };
  const key = (e: React.KeyboardEvent) => {
    if (editing || disabled) return;
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (dir) { e.preventDefault(); commitSoon(move(latest.current, dir, e.shiftKey ? 'coarse' : e.ctrlKey ? 'fine' : 'normal')); }
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); openEntry(); }
    else if (e.key === 'Escape' && armed) { e.stopPropagation(); setArmed(false); box.current?.blur(); }
  };
  const words = format ? format(shown) : String(shown);
  return <div ref={box} className={'vbox' + (armed ? ' armed' : '') + (editing ? ' editing' : '') + (draft !== null ? ' moving' : '') + (className ? ' ' + className : '')}
    role="spinbutton" aria-label={label} aria-valuenow={shown} aria-valuetext={words} aria-disabled={disabled || undefined}
    aria-valuemin={list?.length ? list[0] : Number.isFinite(min) ? min : undefined} aria-valuemax={list?.length ? list[list.length - 1] : Number.isFinite(max) ? max : undefined}
    tabIndex={disabled ? -1 : 0} data-testid={'vbox-' + label}
    title={title ?? label + ': click, then scroll (Shift big, Ctrl fine) · two slow clicks to type · touch: hold and drag'}
    onPointerDown={down} onPointerMove={moveDrag} onPointerUp={upDrag(false)} onPointerCancel={upDrag(true)}
    onKeyDown={key} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setArmed(false); }}>
    {hideLabel ? null : <span className="vbox-label">{label}</span>}
    {editing ? <input ref={input} className="vbox-input" inputMode="decimal" aria-label={label + ' value'} value={text}
      onChange={e => setText(e.target.value)} onPointerDown={e => e.stopPropagation()}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') finishEntry(true); else if (e.key === 'Escape') finishEntry(false); }}
      onBlur={() => finishEntry(true)} />
      : <strong className="vbox-value" aria-live="polite">{words}</strong>}
    <i className="vbox-cue" aria-hidden="true" />
  </div>;
}

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "C4", "F#3", "Bb2", "C♯4" (C4 is 60) or a MIDI number. */
export function parseNote(text: string): number | null {
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(text.trim());
  if (m) return (Number(m[3]) + 1) * 12 + PITCH[m[1].toUpperCase()] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0);
  const n = Number(text); return Number.isFinite(n) ? Math.round(n) : null;
}
