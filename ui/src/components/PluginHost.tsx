/* Settings > Plugins (27 Nov): only the host itself now. Plugins are played on a Plugin track (the Sound page), so
   Settings sets up the helper, lists what was found (and which track plays it) and where Decksynth looks. */
import { Download, Plug, RefreshCw } from 'lucide-react';
import { useDeck } from '../deck-store';
import type { PluginStatus } from '../types';

type Send = (cmd: string, args?: unknown) => void;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n: number) => NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 2);   // 60 = C3, as on the keys

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

/** The plugins found, read only: a Plugin track chooses one. The one playing says on which track. */
export function PluginList({ status }: { status: PluginStatus }) {
  const list = status.plugins;
  if (!status.scanned) return <p className="sv-status" role="status">Looking for plugins…</p>;
  if (!list.length) return <p className="sv-status" role="status">No VST3 plugins found{status.vst2 ? ` (${status.vst2} VST2 found: Decksynth hosts VST3 only)` : ''}.</p>;
  const l = status.loaded;
  return <ul className="sv-plug-found" aria-label="Plugins found">
    {list.map(p => { const on = l?.path === p.path && l.track != null;
      return <li key={p.path} className={on ? 'on' : ''}><span>{p.name}<small>{p.windows ? 'Windows plugin through yabridge' + (status.native_ready ? '' : ' · needs the VST3 helper') : 'Linux VST3'}</small></span>
        {on ? <em><Plug size={14} /> on track {(l!.track as number) + 1}</em> : null}</li>; })}
  </ul>;
}

export function PluginRescan({ status, send }: { status: PluginStatus; send: Send }) {
  return <button type="button" className="sv-btn" disabled={status.scanning} onClick={() => send('plugin', ['scan'])}><RefreshCw size={16} /> {status.scanning ? 'Looking…' : 'Look again'}</button>;
}
