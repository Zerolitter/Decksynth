/* Plugin tracks (27 Nov): a VST3 instrument as a track's device, next to Synth, Drum Rack and Sampler.
   The page: a tool rack (the plugin, its window, Resample, quick knobs, Swap), the plugin's live Output (a stereo wave
   and meter, drawn from the frame clock), eight quick knobs in two hands of four, and keys to play it.
   An empty Plugin track is the plugin picker itself. Resample captures what the plugin plays: the loop, what you
   play, or one note, and you choose where the take goes after it is done. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWindow, ArrowLeftRight, Circle, Download, Hand, Library, Music, Plug, RefreshCw, Repeat, SlidersHorizontal, Square, Trash2, X, AudioLines } from 'lucide-react';
import { deckStore, useDeck } from '../deck-store';
import { useFrame } from '../frame-clock';
import { CommittedKnob } from './DrumRack';
import { ValueBox } from './ValueBox';
import { noteName, PluginSetup, usePlugins } from './PluginHost';
import type { PluginParam, PluginStatus, PluginTake, PluginTrackStatus, Track } from '../types';

type Send = (cmd: string, args?: unknown) => void;
const BLACK = new Set([1, 3, 6, 8, 10]);
const QUICK = 8;
const RING = 1024;                                   // live blocks kept for the Output wave (5.5 s at 48 kHz)
const dB = (v: number) => v < .00003 ? '−∞' : (20 * Math.log10(v)).toFixed(1);

function usePluginTrack(): PluginTrackStatus | null {
  return useDeck(r => r.snapshot?.plugin_track ?? null, (a, b) => a === b);
}

/** The plugin's output peaks, kept in a ring the Output wave and meter read on every frame (never React state). */
const ring = { l: new Float32Array(RING), r: new Float32Array(RING), at: 0, hold: [0, 0], clip: -Infinity };
let lastOut: unknown = null;
deckStore.subscribe(() => {
  const out = deckStore.get().snapshot?.plugin_track?.out;
  if (!out || out === lastOut) return;
  lastOut = out;
  for (const [l, r] of out) { ring.l[ring.at % RING] = l; ring.r[ring.at % RING] = r; ring.at++; if (l >= 1 || r >= 1) ring.clip = performance.now(); }
});

/** Output: the last ~2 bars of the plugin's own output (L up, R down) and a stereo meter with a clip lamp. */
function Output({ name, bpm, live }: { name: string; bpm: number; live: boolean }) {
  const wave = useRef<HTMLCanvasElement>(null), meter = useRef<HTMLCanvasElement>(null), lamp = useRef<HTMLSpanElement>(null), peak = useRef<HTMLElement>(null);
  const bpmRef = useRef(bpm); bpmRef.current = bpm;
  useFrame(() => {
    const c = wave.current, m = meter.current; if (!c || !m) return;
    const css = getComputedStyle(c), left = css.getPropertyValue('--c-plugin').trim(), right = css.getPropertyValue('--c-plugin-r').trim();
    const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d'); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const span = Math.min(RING, Math.max(64, Math.round(8 * 60 / Math.max(30, bpmRef.current) * 48000 / 256)));   // 2 bars of 4/4
    const mid = h / 2, scale = mid - 6;
    g.strokeStyle = css.getPropertyValue('--ui-line-soft').trim(); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, mid + .5); g.lineTo(w, mid + .5); g.stroke();
    for (const [buf, colour, dir] of [[ring.l, left, -1], [ring.r, right, 1]] as const) {
      g.fillStyle = colour; g.globalAlpha = .78; g.beginPath(); g.moveTo(0, mid);
      for (let k = 0; k < span; k++) {
        const i = ring.at - span + k; const v = i < 0 ? 0 : Math.min(1, buf[((i % RING) + RING) % RING]);
        g.lineTo(k / (span - 1) * w, mid + dir * v * scale);
      }
      g.lineTo(w, mid); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
    // Meter: the last ~50 ms of each channel, with a falling peak hold.
    const mw = m.clientWidth, mh = m.clientHeight;
    if (m.width !== Math.round(mw * dpr) || m.height !== Math.round(mh * dpr)) { m.width = Math.round(mw * dpr); m.height = Math.round(mh * dpr); }
    const mg = m.getContext('2d'); if (!mg) return;
    mg.setTransform(dpr, 0, 0, dpr, 0, 0); mg.clearRect(0, 0, mw, mh);
    const level = (buf: Float32Array) => { let v = 0; for (let k = 1; k <= 10; k++) { const i = ring.at - k; if (i >= 0) v = Math.max(v, buf[i % RING]); } return v; };
    const pos = (v: number) => v <= .001 ? 0 : Math.min(1, (20 * Math.log10(v) + 60) / 60);
    const bw = (mw - 6) / 2;
    [level(ring.l), level(ring.r)].forEach((v, ch) => {
      ring.hold[ch] = Math.max(v, ring.hold[ch] * .97);
      const x = ch * (bw + 6), p = pos(v), hp = pos(ring.hold[ch]);
      mg.fillStyle = css.getPropertyValue('--ui-well').trim(); mg.fillRect(x, 0, bw, mh);
      mg.fillStyle = css.getPropertyValue(p > .9 ? '--ui-rec' : p > .7 ? '--ui-warn' : '--ui-play').trim(); mg.fillRect(x, mh * (1 - p), bw, mh * p);
      mg.fillStyle = css.getPropertyValue('--ui-text-hi').trim(); if (hp > 0) mg.fillRect(x, mh * (1 - hp), bw, 2);
    });
    if (lamp.current) lamp.current.classList.toggle('lit', performance.now() - ring.clip < 2000);
    if (peak.current) { const t = dB(Math.max(ring.hold[0], ring.hold[1])); if (peak.current.textContent !== t + ' dB') peak.current.textContent = t + ' dB'; }
  });
  return <section className="pt-out" aria-label={'Output of ' + name}>
    <header><h2>Output</h2><span>what {name} plays, before this track's FX</span><i /><span>peak <b ref={peak}>−∞ dB</b></span></header>
    <div className="pt-out-body">
      <div className="pt-wave">{!live ? <p className="pt-wave-note">Not playing yet</p> : null}<canvas ref={wave} aria-hidden="true" /><b className="pt-ch l">L</b><b className="pt-ch r">R</b></div>
      <div className="pt-meter"><span ref={lamp} className="pt-clip">CLIP</span><canvas ref={meter} role="img" aria-label="Output level, left and right" /><span className="pt-lr"><b>L</b><b>R</b></span></div>
    </div>
  </section>;
}

/** The keys: two and a half octaves that play the plugin (through this track, so Perform, the arp and REC hear them). */
function Keys({ onMidi, base, setBase }: { onMidi: (s: number, a: number, b: number) => void; base: number; setBase: (n: number) => void }) {
  const keys = Array.from({ length: 30 }, (_, i) => base + i), whites = keys.filter(n => !BLACK.has(n % 12));
  const pointers = useRef(new Map<number, number>()), send = useRef(onMidi); send.current = onMidi;
  const [down, setDown] = useState<number[]>([]);
  const sync = () => setDown([...new Set(pointers.current.values())]);
  const noteAt = (x: number, y: number) => { const n = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-note]')?.dataset.note; return n === undefined ? null : Number(n); };
  const velocity = (y: number, el: Element | null) => { if (!el) return 100; const r = el.getBoundingClientRect(); return Math.max(1, Math.min(127, Math.round(40 + 87 * ((y - r.top) / Math.max(1, r.height))))); };
  const press = (id: number, note: number, vel: number) => {
    const old = pointers.current.get(id); if (old === note) return;
    if (old !== undefined && ![...pointers.current.entries()].some(([k, n]) => k !== id && n === old)) send.current(0x80, old, 0);
    pointers.current.set(id, note); send.current(0x90, note, vel); sync();
  };
  const release = (id: number) => { const old = pointers.current.get(id); pointers.current.delete(id);
    if (old !== undefined && ![...pointers.current.values()].includes(old)) send.current(0x80, old, 0); sync(); };
  useEffect(() => () => { for (const id of [...pointers.current.keys()]) release(id); }, [base]); // eslint-disable-line react-hooks/exhaustive-deps
  return <section className="pt-keys-card" aria-label="Keys">
    <header><b>Keys</b><span>play the plugin</span><i />
      <div className="pt-oct"><button type="button" aria-label="Octave down" disabled={base <= 12} onClick={() => setBase(base - 12)}>−</button>
        <span>{noteName(base)}–{noteName(base + 29)}</span>
        <button type="button" aria-label="Octave up" disabled={base >= 84} onClick={() => setBase(base + 12)}>+</button></div></header>
    <div className="pt-keys" role="group" aria-label="Plugin keyboard"
      onPointerDown={e => { if (e.button !== 0) return; const n = noteAt(e.clientX, e.clientY); if (n === null) return;
        e.currentTarget.setPointerCapture(e.pointerId); press(e.pointerId, n, velocity(e.clientY, (e.target as HTMLElement).closest('[data-note]'))); }}
      onPointerMove={e => { if (!pointers.current.has(e.pointerId)) return; const n = noteAt(e.clientX, e.clientY);
        if (n !== null) press(e.pointerId, n, velocity(e.clientY, (e.target as HTMLElement).closest('[data-note]'))); }}
      onPointerUp={e => release(e.pointerId)} onPointerCancel={e => release(e.pointerId)} onLostPointerCapture={e => release(e.pointerId)}
      onContextMenu={e => e.preventDefault()}>
      {whites.map(n => <span key={n} data-note={n} className={'pt-white' + (down.includes(n) ? ' down' : '')}>{n % 12 === 0 ? <em>{noteName(n)}</em> : null}</span>)}
      {keys.filter(n => BLACK.has(n % 12)).map(n => { const left = whites.filter(w => w < n).length;
        return <span key={n} data-note={n} className={'pt-black' + (down.includes(n) ? ' down' : '')}
          style={{ left: 'calc(' + (left / whites.length * 100) + '% - ' + (100 / whites.length * .31) + '%)', width: (100 / whites.length * .62) + '%' }} />; })}
    </div>
  </section>;
}

/** One quick knob: the plugin's own parameter, turned here (live while dragging, one step on release). */
function QuickKnob({ track, slot, q, value, send, onPick, learning }: { track: number; slot: number; q: { i: number; name: string } | null;
  value: [number, string] | null; send: Send; onPick: () => void; learning: boolean }) {
  const last = useRef(0);
  if (!q) return <button type="button" className={'pt-qk-empty' + (learning ? ' learning' : '')} onClick={onPick}
    aria-label={'Choose quick knob ' + (slot + 1)}><b>{learning ? 'Learning' : 'Knob ' + (slot + 1)}</b><span>{learning ? 'turn it in the window' : 'Choose'}</span></button>;
  const raw = value?.[0] ?? 0, text = value?.[1] ?? '';
  return <div className={'pt-qk' + (learning ? ' learning' : '')}>
    <CommittedKnob id={'plug-' + track + '-q' + slot} name={q.name} value={raw} min={0} max={1} step={.001} description={q.name + ' in the plugin'}
      format={n => text && Math.abs(n - raw) < .0005 ? text : Math.round(n * 100) + ' %'}
      onDraft={n => { const now = performance.now(); if (now - last.current > 40) { last.current = now; send('plugin', ['set', q.i, n]); } }}
      onCommit={n => send('plugin', ['set', q.i, n])} />
  </div>;
}

/** Choose the eight knobs: Learn from the plugin window, or find a parameter by name. */
function QuickSheet({ track, spec, status, send, slot, setSlot, learning, onClose }: { track: number; spec: NonNullable<Track['plugin']>; status: PluginStatus;
  send: Send; slot: number; setSlot: (n: number) => void; learning: [number, number] | null; onClose: () => void }) {
  const sent = useDeck(r => r.snapshot?.plugin_params ?? null);
  const paged = !!status.loaded?.paged;
  const [find, setFind] = useState('');
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close.current(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
  useEffect(() => { if (!paged) return; const t = window.setTimeout(() => send('plugin', ['params', 0, find]), 150); return () => window.clearTimeout(t); }, [find, paged]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = find.toLowerCase().split(/\s+/).filter(Boolean);
  const params: PluginParam[] = sent?.params ?? [];
  const hits = useMemo(() => params.filter(p => words.every(w => p.name.toLowerCase().includes(w))), [params, find]); // eslint-disable-line react-hooks/exhaustive-deps
  const SHOWN = 20;                                  // five rows of four: the sheet never scrolls
  const q = spec.quick[slot], learnHere = learning?.[0] === track && learning[1] === slot;
  const total = sent?.parameter_count ?? params.length;
  return <div className="smp-sheet-screen" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="smp-sheet pt-sheet pt-quick-sheet" role="dialog" aria-label="Choose quick knobs">
      <header><SlidersHorizontal size={20} /><h2>Quick knob <em>{slot + 1}</em> for <em>{spec.name}</em></h2>
        {q ? <button type="button" className="pt-clear" onClick={() => send('plugin_track', ['quick', track, slot, null, ''])}><X size={16} />Clear knob {slot + 1}</button> : null}
        <button type="button" className="smp-done" onClick={onClose}>Done</button></header>
      <div className="pt-slots" role="radiogroup" aria-label="Quick knob">
        {spec.quick.map((s, i) => <button key={i} type="button" role="radio" aria-checked={i === slot} onClick={() => setSlot(i)}>
          <b>{i + 1}</b><span>{s?.name ?? 'empty'}</span></button>)}
      </div>
      <div className="pt-learn-row">
        <button type="button" className={'pt-learn' + (learnHere ? ' on' : '')} aria-pressed={learnHere}
          onClick={() => send('plugin_track', learnHere ? ['learn_cancel'] : ['learn', track, slot])}>
          <Hand size={26} /><span><b>{learnHere ? 'Turn a control in the window, then close it' : 'Learn from the plugin window'}</b>
            <small>{learnHere ? 'The control that moved most fills knob ' + (slot + 1) + '. Tap to stop learning.' : 'Opens ' + spec.name + '\'s window; the control you turn fills knob ' + (slot + 1) + '.'}</small></span></button>
        <label className="pt-find"><input type="search" value={find} onChange={e => setFind(e.target.value)} placeholder={'Find one of ' + total + ' by name'}
          aria-label="Find a plugin parameter" autoComplete="off" spellCheck={false} />{find ? <button type="button" aria-label="Clear" onClick={() => setFind('')}><X size={16} /></button> : null}</label>
      </div>
      {hits.length ? <div className="pt-params">{hits.slice(0, SHOWN).map(p => <button key={p.i} type="button" aria-pressed={q?.i === p.i}
          onClick={() => send('plugin_track', ['quick', track, slot, p.i, p.name])}>
          {p.name}<small>{p.text ? p.text + (p.label && !p.text.endsWith(p.label) ? ' ' + p.label : '') : Math.round(p.raw * 100) + ' %'}</small></button>)}</div>
        : <p>{params.length ? 'No parameter matches “' + find + '”.' : 'This plugin shows no parameters to the host: use Learn, or its own window.'}</p>}
      {hits.length > SHOWN ? <p>Showing {SHOWN} of {paged ? total : hits.length}: type more of a name to narrow them.</p> : null}
    </div>
  </div>;
}

const clock = (s: number) => Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');

/** The take's waveform (L up, R down). In review, Start and End are tags to drag (44 px zones); the wave keeps half a
 *  tag clear at each side, so a tag at either end is still whole. */
const EDGE = 22;
const at = (f: number) => 'calc(' + EDGE + 'px + ' + f + ' * (100% - ' + 2 * EDGE + 'px))';
function TakeWave({ take, start, end, onTrim }: { take: PluginTake; start: number; end: number; onTrim?: (s: number, e: number) => void }) {
  const box = useRef<HTMLDivElement>(null), drag = useRef<'start' | 'end' | null>(null);
  const pts = take.wave, n = Math.max(1, pts.length), H = 100, W = 1000;
  const recording = take.state !== 'done';
  const width = recording ? Math.max(n, Math.ceil(n / 200 + 1) * 200) : n;       // while recording the wave grows into its box
  // Each channel's magnitude per point: L above the centre line, R below it.
  const path = (lo: number, hi: number, dir: 1 | -1) => 'M0 50 ' + pts.map((p, i) => 'L' + (i / Math.max(1, width - 1) * W).toFixed(1) + ' '
    + (50 - dir * Math.min(1, Math.max(-p[lo], p[hi])) * 46).toFixed(1)).join(' ') + ' L' + ((n - 1) / Math.max(1, width - 1) * W).toFixed(1) + ' 50 Z';
  const move = (e: React.PointerEvent) => {
    const which = drag.current, r = box.current?.getBoundingClientRect(); if (!which || !r || !onTrim) return;
    const f = Math.max(0, Math.min(1, (e.clientX - r.left - EDGE) / Math.max(1, r.width - 2 * EDGE)));
    if (which === 'start') onTrim(Math.min(f, end - .01), end); else onTrim(start, Math.max(f, start + .01));
  };
  return <div ref={box} className="pt-take-wave" onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="50" x2={W} y2="50" className="pt-take-mid" />
      <path d={path(0, 1, 1)} className="pt-take-l" /><path d={path(2, 3, -1)} className="pt-take-r" />
    </svg>
    {recording && take.state === 'recording' ? <i className="pt-take-head" style={{ left: at((n - 1) / Math.max(1, width - 1)) }} /> : null}
    {onTrim ? <>
      <i className="pt-take-shade" style={{ left: 0, width: at(start) }} /><i className="pt-take-shade" style={{ left: at(end), right: 0 }} />
      {(['start', 'end'] as const).map(k => <span key={k} className="pt-tag" style={{ left: at(k === 'start' ? start : end) }}
        role="slider" aria-label={k === 'start' ? 'Start' : 'End'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((k === 'start' ? start : end) * 100)} tabIndex={0}
        onKeyDown={e => { const d = e.key === 'ArrowLeft' ? -.01 : e.key === 'ArrowRight' ? .01 : 0; if (!d) return; e.preventDefault();
          if (k === 'start') onTrim(Math.max(0, Math.min(end - .01, start + d)), end); else onTrim(start, Math.min(1, Math.max(start + .01, end + d))); }}
        onPointerDown={e => { e.stopPropagation(); box.current?.setPointerCapture(e.pointerId); drag.current = k; }}
        onDoubleClick={() => k === 'start' ? onTrim(0, end) : onTrim(start, 1)}><b>{k === 'start' ? 'Start' : 'End'}</b></span>)}
    </> : null}
    <b className="pt-ch l">L</b><b className="pt-ch r">R</b>
  </div>;
}

/** Resample: what to capture, the take as it records, then where it goes. */
function ResampleSheet({ track, name, bars, send, onClose }: { track: number; name: string; bars: number; send: Send; onClose: () => void }) {
  const pt = usePluginTrack(); const take = pt?.take && pt.take.track === track ? pt.take : null;
  const [mode, setMode] = useState<'loop' | 'play' | 'note'>(take?.mode ?? 'play');
  const [note, setNote] = useState(60), [hold, setHold] = useState(2);
  const [trim, setTrim] = useState<[number, number]>([0, 1]), [normalize, setNormalize] = useState(true);
  const close = useRef(onClose); close.current = onClose;
  const state = take?.state ?? 'idle';
  const leave = useRef(() => {}); leave.current = () => { if (state === 'armed' || state === 'recording') send('plugin_track', ['take_discard']); onClose(); };
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); leave.current(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
  useEffect(() => { if (state === 'done') setTrim([0, 1]); }, [state]);
  const start = () => send('plugin_track', ['resample', track, mode, mode === 'note' ? { note, velocity: 100, hold } : {}]);
  const length = take?.span ? (take.span[1] - take.span[0]) * (trim[1] - trim[0]) : 0;
  const MODES: [typeof mode, string, string, typeof Hand][] = [['loop', 'The loop', 'this track\'s clip, ' + bars + ' bars + tail', Repeat],
    ['play', 'What I play', 'starts on my first note', Hand], ['note', 'One note', 'for a Sampler instrument', Music]];
  return <div className="smp-sheet-screen" onPointerDown={e => { if (e.target === e.currentTarget) leave.current(); }}>
    <div className="smp-sheet pt-sheet pt-resample" role="dialog" aria-label="Resample">
      <header><Circle size={20} /><h2>{state === 'done' ? <>Take · <em>{name}</em> · {length.toFixed(1)} s</> : <>Resample <em>{name}</em></>}</h2>
        {state === 'done' ? <>
          <button type="button" onClick={() => { send('plugin_track', ['take_discard']); setTimeout(start, 0); }}><Repeat size={16} />Again</button>
          <button type="button" onClick={() => send('plugin_track', ['take_discard'])}><Trash2 size={16} />Discard</button></> : null}
        <button type="button" className="smp-done" onClick={() => leave.current()}>Done</button></header>
      {state !== 'done' ? <div className="pt-modes" role="radiogroup" aria-label="What to resample">
        {MODES.map(([m, t, s, Icon]) => <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={state === 'armed' || state === 'recording'}
          onClick={() => setMode(m)}><Icon size={20} /><span><b>{t}</b><small>{s}</small></span></button>)}
      </div> : null}
      {mode === 'note' && state === 'idle' ? <div className="pt-note-row">
        <ValueBox label="Note" value={note} min={0} max={127} step={1} coarse={12} fine={1} format={noteName} onChange={n => setNote(Math.round(n))} />
        <ValueBox label="Length" value={hold} min={.1} max={30} step={.5} coarse={5} fine={.1} format={n => (Math.round(n * 10) / 10) + ' s'} onChange={n => setHold(Math.round(n * 10) / 10)} />
      </div> : null}
      {take ? <TakeWave take={take} start={trim[0]} end={trim[1]} onTrim={state === 'done' ? (s, e) => setTrim([s, e]) : undefined} />
        : <div className="pt-take-wave empty"><p>{mode === 'loop' ? 'Record plays this track\'s loop from bar 1 through ' + name + ' and keeps its tail.'
          : mode === 'play' ? 'Record arms: the take starts on your first note and ends by itself 2 s after the sound dies. Both hands stay on the keys.'
          : 'Record plays one note for the Length, then keeps its tail.'}</p></div>}
      {state === 'done' ? <>
        <div className="pt-review-row"><span>peak {dB(take?.peak ?? 0)} dB · stereo · 24-bit</span><i />
          <span>Normalize</span><div className="pt-seg" role="group" aria-label="Normalize">
            <button type="button" aria-pressed={!normalize} onClick={() => setNormalize(false)}>Off</button>
            <button type="button" aria-pressed={normalize} onClick={() => setNormalize(true)}>−1 dB</button></div></div>
        <div className="pt-dest">
          <button type="button" disabled={pt?.saving} onClick={() => { send('plugin_track', ['take_keep', 'new', trim[0], trim[1], normalize]); onClose(); }}>
            <AudioLines size={24} /><span><b>New Sampler track</b><small>plays it on the keys</small></span></button>
          <button type="button" disabled={pt?.saving} onClick={() => { send('plugin_track', ['take_keep', 'library', trim[0], trim[1], normalize]); onClose(); }}>
            <Library size={24} /><span><b>Library only</b><small>category Plugins</small></span></button>
        </div></> : <footer className="pt-rec-foot">
        <span className="pt-rec-time"><i className={state === 'recording' ? 'on' : ''} />{state === 'recording' ? clock(take?.seconds ?? 0) : state === 'armed' ? 'Waiting for your first note…' : ''}</span>
        {state === 'recording' && take ? <span className="pt-rec-note">peak {dB(take.peak)} dB · {mode === 'play' ? 'ends 2 s after the sound dies' : 'ends when the tail is quiet'}</span> : null}
        <i />
        {state === 'armed' || state === 'recording'
          ? <><button type="button" onClick={() => send('plugin_track', ['take_discard'])}><X size={16} />Cancel</button>
            <button type="button" className="pt-stop" disabled={state !== 'recording'} onClick={() => send('plugin_track', ['resample_stop'])}><Square size={16} />Stop and keep</button></>
          : <button type="button" className="pt-record" onClick={start}><Circle size={18} />{mode === 'play' ? 'Arm' : 'Record'}</button>}
      </footer>}
    </div>
  </div>;
}

/** An empty Plugin track: the plugins found, right here (rule 5). */
function Picker({ status, send, track, onBack }: { status: PluginStatus | null; send: Send; track: number; onBack?: () => void }) {
  useEffect(() => { if (status && !status.scanned && !status.scanning) send('plugin', ['scan']); }, [status?.scanned]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = status?.setup === 'ready';
  return <section className="pt-picker" aria-label="Choose a plugin">
    <header><h3>Choose an instrument plugin for track {track + 1}</h3><i />{onBack ? <button type="button" onClick={onBack}><X size={16} />Keep the current one</button> : null}</header>
    {!status ? <p>The engine is not connected.</p>
      : !ready ? <div className="pt-setup"><p>Plugins run in a helper of their own, so a plugin can never stop the sound. Set up fetches pedalboard and numpy (about 21 MB) into Decksynth's data folder once.</p><PluginSetup status={status} send={send} /></div>
      : !status.scanned ? <p>Looking for plugins…</p>
      : !status.plugins.length ? <p>No VST3 plugins found{status.vst2 ? ' (' + status.vst2 + ' VST2: Decksynth hosts VST3 only)' : ''}. Windows plugins show up after yabridgectl sync.</p>
      : <div className="pt-grid">{status.plugins.map(p => { const blocked = p.windows && !status.native_ready;
        return <button key={p.path} type="button" disabled={blocked || !!status.busy} title={blocked ? 'Windows plugins need the Decksynth VST3 helper' : p.path}
          onClick={() => send('plugin_track', ['choose', track, p.path])}><Plug size={24} /><span><b>{p.name}</b>
            <small>{p.windows ? 'Windows plugin through yabridge' : 'Linux VST3'}{blocked ? ' · needs the VST3 helper' : ''}</small></span></button>; })}</div>}
    <footer><span><Download size={15} />{status?.plugins.length ?? 0} plugins in ~/.vst3, ~/.vst3/yabridge, /usr/lib/vst3 and VST3_PATH</span><i />
      <button type="button" disabled={!ready || status?.scanning} onClick={() => send('plugin', ['scan'])}><RefreshCw size={16} />{status?.scanning ? 'Looking…' : 'Look again'}</button></footer>
  </section>;
}

export function PluginTrackPage({ track, trackIndex, bpm, bars, send, onMidi }: { track: Track; trackIndex: number; bpm: number; bars: number; send: Send;
  onMidi: (s: number, a: number, b: number) => void }) {
  const status = usePlugins(), pt = usePluginTrack();
  const spec = track.plugin;
  const [swap, setSwap] = useState(false), [quickOpen, setQuickOpen] = useState(false), [slot, setSlot] = useState(0), [resample, setResample] = useState(false);
  const [base, setBase] = useState(48);
  const l = status?.loaded, here = !!(l && spec?.path && l.path === spec.path && l.track === trackIndex);
  // The plugin plays on the track whose page is open: load it (or move it here) when it isn't.
  useEffect(() => { if (spec?.path && status?.setup === 'ready' && status.scanned && !here && !status.busy) send('plugin_track', ['activate', trackIndex]); },
    [spec?.path, trackIndex, here, status?.setup, status?.scanned, status?.busy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (spec?.path) setSwap(false); }, [spec?.path]);
  if (!spec?.path || swap) return <div className="pt-page" style={{ ['--pad-accent' as string]: 'var(--c-plugin)' }}>
    <Picker status={status} send={send} track={trackIndex} onBack={swap ? () => setSwap(false) : undefined} />
    <Keys onMidi={onMidi} base={base} setBase={setBase} /></div>;
  const live = here && !!l?.live, effect = here && l?.kind === 'effect';
  const words = status?.busy === 'loading' ? 'Loading…' : !here ? (status?.error ?? 'Not loaded') : effect ? 'An effect: it belongs on the FX page'
    : l?.live_fault ? l.live_fault : live ? 'Playing' : 'Starting…';
  const learning = pt?.learning ?? null;
  const pick = (i: number) => { setSlot(i); setQuickOpen(true); };
  return <div className="pt-page" style={{ ['--pad-accent' as string]: 'var(--c-plugin)' }}>
    <div className="pt-top">
      <section className="pt-rack" aria-label="Plugin tools">
        <div className="pt-display"><b title={spec.path}>{spec.name}</b><span className={live ? 'ok' : l?.live_fault || (!here && status?.error) ? 'bad' : ''}>{live ? '● ' : ''}{words}</span></div>
        <div className="pt-tools">
          <button type="button" className={'pt-tool win' + (here && l?.editor ? ' on' : '')} aria-pressed={here && !!l?.editor} disabled={!here || !!status?.busy}
            onClick={() => send('plugin', [l?.editor ? 'editor_close' : 'editor'])}><AppWindow size={24} />{l?.editor && here ? 'Close window' : 'Window'}</button>
          <button type="button" className={'pt-tool rec' + (resample ? ' on' : '')} disabled={!live} onClick={() => setResample(true)}><Circle size={24} />Resample</button>
          <button type="button" className={'pt-tool knobs' + (quickOpen ? ' on' : '')} disabled={!here} onClick={() => pick(Math.max(0, spec.quick.findIndex(q => !q)))}><SlidersHorizontal size={24} />Knobs</button>
          <button type="button" className="pt-tool swap" onClick={() => setSwap(true)}><ArrowLeftRight size={24} />Swap</button>
        </div>
      </section>
      <Output name={spec.name} bpm={bpm} live={live} />
    </div>
    <section className="pt-quick" aria-label="Quick knobs">
      <header><h2>Quick knobs</h2><span>{spec.quick.filter(Boolean).length} of 8 · saved with this track</span><i />
        <button type="button" disabled={!here} onClick={() => pick(slot)}><SlidersHorizontal size={16} />Choose</button></header>
      <div className="pt-hands">{[0, 1].map(h => <div key={h} className="pt-hand">{spec.quick.slice(h * 4, h * 4 + 4).map((q, k) => { const i = h * 4 + k;
        return <QuickKnob key={i + ':' + (q?.i ?? 'x')} track={trackIndex} slot={i} q={q} value={pt?.quick?.[i] ?? null} send={send} onPick={() => here && pick(i)}
          learning={learning?.[0] === trackIndex && learning[1] === i} />; })}</div>)}</div>
    </section>
    <Keys onMidi={onMidi} base={base} setBase={setBase} />
    {quickOpen && status ? <QuickSheet track={trackIndex} spec={spec} status={status} send={send} slot={slot} setSlot={setSlot} learning={learning} onClose={() => setQuickOpen(false)} /> : null}
    {resample ? <ResampleSheet track={trackIndex} name={spec.name} bars={bars} send={send} onClose={() => setResample(false)} /> : null}
  </div>;
}

/** The window button beside a Plugin track's chip: the plugin's window from any page (Sir: "open it quickly"). */
export function PluginWindowButton({ track, spec, send }: { track: number; spec: Track['plugin']; send: Send }) {
  const status = usePlugins(), l = status?.loaded;
  const here = !!(l && spec?.path && l.path === spec.path && l.track === track);
  if (!spec?.path) return null;
  const open = here && !!l?.editor;
  return <button type="button" className={'page-track-window' + (open ? ' on' : '')} aria-pressed={open}
    aria-label={(open ? 'Close ' : 'Open ') + spec.name + ' window'} title={(open ? 'Close ' : 'Open ') + spec.name + '\'s window'} disabled={!!status?.busy}
    onClick={() => here ? send('plugin', [open ? 'editor_close' : 'editor']) : send('plugin_track', ['activate', track])}>
    <AppWindow size={18} /></button>;
}

