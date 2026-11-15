/* Link a knob to a macro or a mod pad from its radial menu (UI-RULES 37, Sampler editing stage 9).
   Right-click or touch-hold any linkable knob: Link to › Macros / Mod pads shows the eight sources in their own colours,
   a tick on the ones already linked; picking one links it (or unlinks it when ticked). Unlink lists only what moves the knob.
   Sampler and Drum Rack knobs are linkable as well as the Sound and FX knobs. */
import { createContext, useContext, type ReactNode } from 'react';
import type { ContextAction } from '../context-actions';
import { normalizeChain, type FxChain, type FxTarget } from '../fx';
import { knobControl, type ControlTarget } from '../parameter-registry';
import { MACRO_COLORS, MOD_COLORS, sourceTargets, withTargets, type Source } from './ModParts';

type Link = { track: number; chain: FxChain | undefined; onChain(chain: FxChain): void };
const LinkContext = createContext<Link | null>(null);
export function ModLinkProvider({ track, chain, onChain, children }: Link & { children: ReactNode }) {
  return <LinkContext.Provider value={{ track, chain, onChain }}>{children}</LinkContext.Provider>;
}
export const useModLink = () => useContext(LinkContext);

/** Sampler knobs a macro or mod pad can move (engine: fx.SAMPLER_TARGETS). Cutoff moves in octaves, as its knob does. */
export const SAMPLER_LINKS: Record<string, string> = { gain: 'Gain', tune: 'Tune', fine: 'Fine', cutoff: 'Cutoff', resonance: 'Resonance', f_env: 'Filter env', p_env: 'Pitch env' };
/** Drum Rack pad knobs a macro or mod pad can move; they apply on the pad's next hit (engine: fx.DRUM_TARGETS). */
export const DRUM_LINKS: Record<string, string> = { gain: 'Gain', tune: 'Tune', pan: 'Pan' };

/** The modulation target behind a knob id, and its track; null when the knob cannot be linked. */
export function linkTargetFor(id: string): { track: number; target: ControlTarget } | null {
  const smp = /^smp-(\d+)-.+-([a-z_]+)$/.exec(id);
  if (smp) return SAMPLER_LINKS[smp[2]] ? { track: Number(smp[1]), target: { module: 'sampler', param: smp[2] } } : null;
  const drum = /^drum-(\d+)-(\d+)-([a-z_]+)$/.exec(id);
  if (drum) return DRUM_LINKS[drum[3]] && Number(drum[2]) < 16 ? { track: Number(drum[1]), target: { module: 'drum', param: drum[2] + ':' + drum[3] } } : null;
  const track = Number(id.split('-')[0]), control = Number.isFinite(track) ? knobControl(id, track) : null;
  return control && control.module !== 'macro' ? { track, target: control } : null;
}

const same = (t: FxTarget, target: ControlTarget) => t.module === target.module && t.param === target.param;
const SOURCES: Source[] = [...Array.from({ length: 8 }, (_, i) => ({ kind: 'macro' as const, index: i })), ...Array.from({ length: 8 }, (_, i) => ({ kind: 'mod' as const, index: i }))];
const colorOf = (s: Source) => (s.kind === 'macro' ? MACRO_COLORS : MOD_COLORS)[s.index];

/** The colours of the sources linked to a knob (for its dots), or [] when it is not linkable here. */
export function linkedColors(link: Link | null, id: string): string[] {
  const at = linkTargetFor(id); if (!link || !at || at.track !== link.track) return [];
  const chain = normalizeChain(link.chain);
  return SOURCES.filter(s => sourceTargets(chain, s).some(t => same(t, at.target))).map(colorOf);
}

/** "Link to" (Macros, Mod pads) and, when something is linked, "Unlink", for the knob's radial menu. */
export function linkActions(link: Link | null, id: string): ContextAction[] {
  const at = linkTargetFor(id); if (!link || !at || at.track !== link.track) return [];
  const chain = normalizeChain(link.chain), target = at.target;
  const linked = (s: Source) => sourceTargets(chain, s).some(t => same(t, target));
  const name = (s: Source) => s.kind === 'macro' ? (chain.macros[s.index]?.name || 'Macro ' + (s.index + 1)) : 'Mod ' + (s.index + 1);
  const set = (s: Source, on: boolean) => {
    const now = sourceTargets(chain, s).filter(t => !same(t, target));
    if (on && now.length >= 16) return;
    link.onChain(withTargets(chain, s, on ? [...now, { ...target, depth: s.kind === 'macro' ? .5 : .4 } as FxTarget] : now));
  };
  const item = (s: Source): ContextAction => ({ id: s.kind + s.index, title: name(s), color: colorOf(s), checked: linked(s), run: () => set(s, !linked(s)) });
  const out: ContextAction[] = [{ id: 'link', title: 'Link to', children: [
    { id: 'linkMacros', title: 'Macros', children: SOURCES.filter(s => s.kind === 'macro').map(item) },
    { id: 'linkMods', title: 'Mod pads', children: SOURCES.filter(s => s.kind === 'mod').map(item) }] }];
  const on = SOURCES.filter(linked);
  if (on.length === 1) out.push({ id: 'unlink', title: 'Unlink ' + name(on[0]), color: colorOf(on[0]), run: () => set(on[0], false) });
  else if (on.length) out.push({ id: 'unlink', title: 'Unlink', children: on.map(s => ({ id: 'un' + s.kind + s.index, title: name(s), color: colorOf(s), run: () => set(s, false) })) });
  return out;
}
