/* Settings > Plugins (27 Nov): VST3 plugins hosted in their own helper process. Load one, turn its parameters here
   (or in its own window), and record what it plays as a sample: into this Sampler, onto a new Sampler track, or
   only into the sample library (category Plugins). An effect plugin records the selected Sampler's sample played
   through it. Each part is one Settings row, so search finds them. */
import { useEffect, useMemo, useState } from 'react';
import { AppWindow, CircleDot, Download, Ear, Plug, RefreshCw, Square, X } from 'lucide-react';
import { useDeck } from '../deck-store';
import { ValueBox } from './ValueBox';
import type { PluginParam, PluginStatus } from '../types';

export type PluginTrack = { index: number; device: string; samplerId: string | null; hasSample: boolean; sampleName: string | null };
type Send = (cmd: string, args?: unknown) => void;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n: number) => NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 2);   // 60 = C3, as on the keys
const SHOWN = 24;

export function usePlugins(): PluginStatus | null {
  return useDeck(r => r.snapshot?.plugins ?? null);
}

/** Host set up: ready, being set up (with progress), or a button that fetches the libraries. */
export function PluginSetup({ status, send }: { status: PluginStatus | null; send: Send }) {
  if (!status) return <p className="sv-status" role="status">The engine is not connected.</p>;
  if (status.setup === 'installing') return <p className="sv-status" role="status">Setting up… {Math.round((status.progress ?? 0) * 100)} %</p>;
  if (status.setup === 'ready') return <p className="sv-status" role="status">Ready{status.version ? ' · pedalboard ' + status.version : ''}</p>;
  return <button type="button" className="sv-btn" onClick={() => send('plugin', ['setup'])}><Download size={16} /> Set up</button>;
}

/** The plugins found. A tap loads one (a fresh helper each time); the loaded one is orange. */
export function PluginList({ status, send }: { status: PluginStatus; send: Send }) {
  const list = status.plugins;
  if (!status.scanned) return <p className="sv-status" role="status">Looking for plugins…</p>;
  if (!list.length) return <p className="sv-status" role="status">No VST3 plugins found{status.vst2 ? ` (${status.vst2} VST2 found: Decksynth hosts VST3 only)` : ''}.</p>;
  const picked = status.loaded?.path ?? '';
  return <div className="sv-tap" role="radiogroup" aria-label="Plugins">
    {list.map(p => <button key={p.path} type="button" role="radio" aria-checked={picked === p.path} className={picked === p.path ? 'on' : ''}
      disabled={(p.windows ? !status.native_ready : status.setup !== 'ready') || !!status.busy} onClick={() => send('plugin', ['load', p.path])}>
      <span>{p.name}<small>{p.windows ? 'Windows plugin through yabridge' : 'VST3'}</small></span>
      {picked === p.path ? <Plug size={16} /> : null}</button>)}
  </div>;
}

/** What is loaded, with its window and Unload. */
export function PluginLoaded({ status, send }: { status: PluginStatus; send: Send }) {
  const l = status.loaded;
  if (status.busy === 'loading') return <p className="sv-status" role="status">Loading…</p>;
  if (!l) return <p className="sv-status" role="status">{status.error ?? 'Tap a plugin above to load it.'}</p>;
  return <div className="sv-plug-loaded">
    <span><strong>{l.name}</strong><small>{l.kind === 'instrument' ? 'Instrument' : 'Effect'}{l.vendor ? ' · ' + l.vendor : ''}</small></span>
    <button type="button" className={'sv-btn' + (l.editor ? ' on' : '')} aria-pressed={l.editor} disabled={!!status.busy}
      onClick={() => send('plugin', [l.editor ? 'editor_close' : 'editor'])}><AppWindow size={16} /> {l.editor ? 'Close its window' : 'Open its window'}</button>
    {l.kind === 'instrument' ? <button type="button" className={'sv-btn' + (l.live ? ' on' : '')} aria-pressed={l.live} disabled={!!status.busy}
      onClick={() => send('plugin', ['live', !l.live])}><CircleDot size={16} /> {l.live ? 'Stop live' : 'Live'}</button> : null}
    <button type="button" className="sv-btn" onClick={() => send('plugin', ['unload'])}><X size={16} /> Unload</button>
  </div>;
}

/** The plugin's own parameters: a value box for a continuous one, segments for 2 to 8 choices, a switch for on/off.
 *  A long list is searched rather than scrolled. */
export function PluginParams({ send }: { send: Send }) {
  const sent = useDeck(r => r.snapshot?.plugin_params ?? null);
  const one = useDeck(r => r.snapshot?.plugin_param ?? null);
  const paged = useDeck(r => !!r.snapshot?.plugins?.loaded?.paged);
  const [params, setParams] = useState<PluginParam[]>([]);
  const [find, setFind] = useState('');
  useEffect(() => { setParams(sent?.params ?? []); }, [sent]);
  useEffect(() => { if (one) setParams(ps => ps.map(p => p.i === one.i ? { ...p, raw: one.raw, text: one.text } : p)); }, [one]);
  useEffect(() => {
    if (!paged || !sent?.path) return;
    const timer = window.setTimeout(() => send('plugin', ['params', 0, find]), 150);
    return () => window.clearTimeout(timer);
  }, [find, paged, sent?.path]); // send is supplied by the stable bridge hook
  const words = find.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = useMemo(() => params.filter(p => words.every(w => p.name.toLowerCase().includes(w))), [params, find]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: PluginParam, raw: number) => { setParams(ps => ps.map(q => q.i === p.i ? { ...q, raw } : q)); send('plugin', ['set', p.i, raw]); };
  if (!params.length) return <p className="sv-status" role="status">This plugin shows no parameters to the host; use its own window.</p>;
  return <div className="sv-plug-params">
    {paged || params.length > SHOWN ? <label className="sv-search sv-plug-find"><input type="search" value={find} onChange={e => setFind(e.target.value)}
      placeholder={`Find one of ${sent?.parameter_count ?? params.length} parameters`} aria-label="Find a plugin parameter" autoComplete="off" spellCheck={false} />
      {find ? <button type="button" aria-label="Clear" onClick={() => setFind('')}><X size={16} /></button> : null}</label> : null}
    <div className="sv-plug-grid">
      {hits.slice(0, SHOWN).map(p => <div key={p.i} className="sv-plug-param">
        <span className="sv-plug-name" title={p.name}>{p.name}</span>
        {p.kind === 'switch'
          ? <input type="checkbox" role="switch" aria-label={p.name} checked={p.raw >= .5} onChange={e => set(p, e.target.checked ? 1 : 0)} />
          : p.kind === 'options' && p.options
            ? <div className="sv-seg" role="group" aria-label={p.name}>{p.options.map((o, k) => {
              const raw = k / (p.options!.length - 1), on = Math.abs(p.raw - raw) < .5 / (p.options!.length - 1);
              return <button key={k} type="button" aria-pressed={on} className={on ? 'on' : ''} onClick={() => set(p, raw)}>{o}</button>;
            })}</div>
            : <ValueBox label={p.name} hideLabel value={Math.round(p.raw * 1000) / 10} min={0} max={100} step={1} coarse={10} fine={.1}
              format={n => p.text && Math.abs(n / 100 - p.raw) < .0005 ? p.text + (p.label && !p.text.endsWith(p.label) ? ' ' + p.label : '') : (Math.round(n * 10) / 10) + ' %'}
              onChange={n => set(p, Math.max(0, Math.min(1, n / 100)))} />}
      </div>)}
    </div>
    {hits.length > SHOWN ? <p className="sv-status" role="status">Showing 24 of {sent?.parameter_count ?? hits.length}: type more of a name to narrow them.</p>
      : !hits.length ? <p className="sv-status" role="status">No parameter matches “{find}”.</p> : null}
  </div>;
}

type Dest = 'sampler' | 'new' | 'library';
/** Listen and Record. An instrument plays one note (held, then until it is quiet); an effect plays the selected
 *  Sampler's sample through it. */
export function PluginTake({ status, send, track }: { status: PluginStatus; send: Send; track: PluginTrack }) {
  const [note, setNote] = useState(60), [velocity, setVelocity] = useState(100), [hold, setHold] = useState(1);   // hold in seconds
  const isSampler = track.device === 'sampler' && !!track.samplerId;
  const [dest, setDest] = useState<Dest>('new');            // never replaces a sample unless asked
  const l = status.loaded;
  useEffect(() => { if (!isSampler && dest === 'sampler') setDest('new'); }, [isSampler, dest]);
  if (!l) return <p className="sv-status" role="status">Load a plugin to record it.</p>;
  const effect = l.kind === 'effect', needsSample = effect && !(isSampler && track.hasSample);
  const opts = () => ({ note, velocity, hold, track: track.index, sampler_id: track.samplerId });
  const dests: [Dest, string][] = [...(isSampler ? [['sampler', 'This Sampler'] as [Dest, string]] : []), ['new', 'New Sampler track'], ['library', 'Library only']];
  const busy = !!status.busy || l.editor || l.live;
  return <div className="sv-plug-take">
    {effect ? <p className="sv-status">{needsSample ? 'Select a Sampler track with a sample: the effect plays it through itself.'
      : `Plays “${track.sampleName ?? 'the sample'}” on track ${track.index + 1} through ${l.name}.`}</p>
      : <div className="sv-plug-note">
        <ValueBox label="Note" value={note} min={0} max={127} step={1} coarse={12} fine={1} format={noteName} onChange={n => setNote(Math.round(n))} />
        <ValueBox label="Velocity" value={velocity} min={1} max={127} step={1} coarse={10} fine={1} onChange={n => setVelocity(Math.round(n))} />
        <ValueBox label="Hold" value={hold} min={0.1} max={30} step={0.5} coarse={5} fine={0.1}
          format={n => (Math.round(n * 10) / 10) + ' s'} onChange={n => setHold(Math.round(n * 10) / 10)} />
      </div>}
    <div className="sv-plug-go">
      <div className="sv-seg" role="group" aria-label="Record into">
        {dests.map(([v, t]) => <button key={v} type="button" aria-pressed={dest === v} className={dest === v ? 'on' : ''} onClick={() => setDest(v)}>{t}</button>)}
      </div>
      <button type="button" className="sv-btn" disabled={busy || needsSample} onClick={() => send('plugin', ['render', { ...opts(), mode: 'listen' }])}><Ear size={16} /> Listen</button>
      <button type="button" className="sv-btn" aria-label="Stop listening" title="Stop listening" onClick={() => send('plugin', ['stop_listen'])}><Square size={14} /></button>
      <button type="button" className="sv-btn rec" disabled={busy || needsSample}
        onClick={() => send('plugin', ['render', { ...opts(), mode: 'record', dest }])}><CircleDot size={16} /> Record</button>
    </div>
    <p className="sv-status" role="status">{status.busy === 'record' ? 'Recording…' : status.busy === 'listen' ? 'Rendering…'
      : l.live ? 'Live audio is playing through Decksynth. Stop live audio to render a take.' : l.editor ? 'Close the plugin window to record.' : status.take ? `Last take: ${status.take.name} (${status.take.seconds.toFixed(1)} s) in ${status.take.where}${status.take.clipped ? ', clipped' : ''}.` : ' '}</p>
  </div>;
}

export function PluginRescan({ status, send }: { status: PluginStatus; send: Send }) {
  return <button type="button" className="sv-btn" disabled={status.scanning} onClick={() => send('plugin', ['scan'])}><RefreshCw size={16} /> {status.scanning ? 'Looking…' : 'Look again'}</button>;
}
