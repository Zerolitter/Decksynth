/* Sampler track (15 Nov): one sample played across the keys, from a pad or a WAV file.
   The window is the sample. Trim: drag Start, End and, in Loop mode, the loop's two ends. Chop: cut it into
   slices (Threshold / Regions / BPM, Split / Join), tap a slice to hear it, and send slices to Drum Rack pads. The cards hold
   how it plays (Play), its pitch (Pitch) and its level over time (Amp). The keyboard plays it. */
import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, Ban, AudioWaveform, Sparkles, BookOpen, ChevronsUpDown, Crop, Eraser, SlidersHorizontal, FolderOpen, Grid3x3, KeyboardMusic, Maximize2, Merge, Mic, Power, ScanSearch, Scissors, Snowflake, Trash2, Undo2, ZoomIn, Square } from 'lucide-react';
import { SampleLibrarySheet, type SampleLibraryState } from './SampleLibrary';
import { CommittedKnob } from './DrumRack';
import { useContextTarget } from './ContextWheel';
import { ValueBox, parseNote } from './ValueBox';
import { type Env } from './EnvEditor';
import { FilterEnvView, FilterView, SamplerEnvView } from './DragGraphs';
import { DRUM_KINDS, drumKind, padLabel, type DrumKind } from '../drum-kinds';
import { TRACK_COLORS, noteName, type SamplerRecord, type SamplerRuntime, type SamplerSpec, type Track, type SamplerMode, type GrainScale, type GrainWindow, type GrainRoam, type GrainSync, type GrainRhythm, type GrainDiv, type GrainHarm } from '../types';
import '../sampler.css';

const BLACK = new Set([1, 3, 6, 8, 10]);
const KEYMAPS: ['whole' | 'slices' | 'pitched', string, string][] = [
  ['whole', 'Whole', 'The whole sample on every key, a semitone per key'],
  ['slices', 'Slices', 'One slice per key from the first key, each at its own pitch'],
  ['pitched', 'Pitched', "Each key plays the slice whose pitch is nearest, tuned to the key (finds each slice's pitch)"],
];
type FilterShape = 'lp' | 'lp24' | 'bp' | 'hp';
// Round 4 (Sir, 16 Nov): the filter types as drawings of their curves, and a power switch like the Drum Rack compressor.
const FILTERS: [FilterShape, string, string, string][] = [
  ['lp', 'LP', 'Low-pass', 'Low pass: keeps the lows, cuts above the cutoff'],
  ['lp24', 'LP 24', 'Low-pass 24 dB', 'Low pass 24 dB: cuts twice as steeply above the cutoff; darker, and the resonance sings (acid)'],
  ['bp', 'BP', 'Band-pass', 'Band pass: keeps a band around the cutoff'],
  ['hp', 'HP', 'High-pass', 'High pass: keeps the highs, cuts below the cutoff'],
];
const FILTER_PATH: Record<FilterShape, string> = {
  lp: 'M2 6 H15 Q19 6 21 9 L28 16',
  lp24: 'M2 6 H14 Q17 6 18 9 L21 16',
  bp: 'M2 16 L8 13 Q12 3 15 3 Q18 3 22 13 L28 16',
  hp: 'M2 16 L9 9 Q11 6 15 6 H28',
};
function FilterIcon({ shape }: { shape: FilterShape }) {
  return <svg className="smp-filter-icon" viewBox="0 0 30 19" width={30} height={19} aria-hidden="true">
    <path className="axis" d="M2 16 H28" /><path className="curve" d={FILTER_PATH[shape]} /></svg>;
}
/** Tool colours, as on the SEQ panel's rail: a coloured icon and a short label. */
const TOOL_COLOR = { trim: '#6fa8ff', chop: '#ff8f5c', env: '#61e3bf', filter: '#e47cf5', grain: 'var(--c-grain)', library: '#e0b07e', record: '#ff6b6b', load: '#a7b4ff', clear: '#9fb4c8' } as const;
const tool = (k: keyof typeof TOOL_COLOR) => ({ ['--tool' as string]: TOOL_COLOR[k] });
const hz = (f: number) => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + ' kHz' : Math.round(f) + ' Hz';
const MODES: [SamplerMode, string, string][] = [
  ['oneshot', 'One shot', 'Plays to the end, whatever the key does'],
  ['hold', 'Hold', 'Plays while the key is held, then the release'],
  ['loop', 'Loop', 'Repeats the loop while the key is held'],
  ['grain', 'Grain', 'Every key plays a cloud of short grains from around Position (Grain tab)'],
];
/** Grain mode: the fade of each grain, drawn (as the filter types are), and the steps Spread may land on. */
const WINDOWS: [GrainWindow, string, string, string][] = [
  ['hann', 'Soft', 'M2 16 C8 16 9 3 15 3 C21 3 22 16 28 16', 'Soft: a smooth bell, the classic grain'],
  ['tri', 'Tri', 'M2 16 L15 3 L28 16', 'Triangle: straight in and out'],
  ['welch', 'Round', 'M2 16 C4 4 9 3 15 3 C21 3 26 4 28 16', 'Round: fuller in the middle'],
  ['perc', 'Hit', 'M2 16 L3 3 C8 7 16 13 28 16', 'Hit: a fast attack and a decay, percussive grains'],
  ['rect', 'Flat', 'M2 16 L3 3 H27 L28 16', 'Flat: full level with tiny fades, grainy and dense'],
];
const SCALES: [GrainScale, string, string][] = [
  ['chromatic', 'All', 'Spread may land on any semitone'], ['major', 'Maj', 'Spread lands on a major scale from the played note'],
  ['minor', 'Min', 'Spread lands on a minor scale from the played note'], ['penta', 'Pent', 'Spread lands on a minor pentatonic scale'],
  ['octaves', 'Oct', 'Spread jumps only in octaves'], ['fifths', '5th', 'Spread lands on fifths and octaves'],
];
/** Harmony (24 Nov): which notes the sample holds. Spread then only uses shifts that keep all of them in the key
    (major or minor on the sample's root); the same rule as sampler_grain.harmony. */
const HARMS: [GrainHarm, string, string][] = [
  ['off', 'Off', 'Harmony off: Spread follows the scale on the Grain page'],
  ['root', 'Root', 'The sample is one note, its root'], ['fifth', 'Fifth', 'The sample holds its root and the fifth'],
  ['triad', 'Triad', 'The sample is a chord: root, third and fifth'], ['scale', 'Scale', 'The sample uses the whole scale (only octaves fit then)'],
  ['own', 'Own notes', 'Pick the notes the sample holds yourself'],
];
const KEY_STEPS = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
function harmonySteps(spec: SamplerSpec): number[] | null {
  const held = spec.g_harm ?? 'off'; if (held === 'off') return null;
  const minor = spec.g_kmode === 'minor', key = KEY_STEPS[minor ? 'minor' : 'major'];
  const notes = held === 'root' ? [0] : held === 'fifth' ? [0, 7] : held === 'triad' ? (minor ? [0, 3, 7] : [0, 4, 7]) : held === 'scale' ? key : (spec.g_notes?.length ? spec.g_notes : [0]);
  return Array.from({ length: 12 }, (_, s) => s).filter(s => s === 0 || notes.every(n => key.includes((n + s) % 12)));
}
const pitchName = (n: number) => noteName(n).replace(/-?\d+$/, '');
const ROAMS: [GrainRoam, string, typeof ArrowRight, string][] = [
  ['off', 'Off', Ban, 'Roam off: grains stay around Position (Jump and Wander can still move it)'],
  ['forward', 'Forward', ArrowRight, 'Roam forward through the bracket, then start again'],
  ['reverse', 'Reverse', ArrowLeft, 'Roam backwards through the bracket'],
  ['bounce', 'Bounce', ArrowLeftRight, 'Roam to the end of the bracket and back'],
];
const SYNCS: [GrainSync, string, string][] = [
  ['free', 'Free', 'Free speed: the Speed knob sets it'], ['1/4', '¼', 'One pass every quarter bar'], ['1/2', '½', 'One pass every half bar'],
  ['1', '1', 'One pass a bar'], ['2', '2', 'One pass every 2 bars'], ['4', '4', 'One pass every 4 bars'], ['8', '8', 'One pass every 8 bars'],
  ['16', '16', 'One pass every 16 bars'],
];
const RHYTHMS: [GrainRhythm, string, string][] = [
  ['off', 'Off', 'Rhythm off: Position, Roam and Motion place the grains'],
  ['skip', 'Skip', 'Each step moves to the next slice; slices that are off are skipped'],
  ['hold', 'Hold', 'Each step moves to its slice; on a slice that is off it stays where it was'],
  ['gate', 'Gate', 'Each step moves to its slice; slices that are off are silent'],
  ['flow', 'Flow', 'Like Skip, but the grains travel on through the slice between steps'],
  ['random', 'Rand', 'Each step picks a random slice that is on'],
  ['pingpong', 'Ping', 'Forwards through the slices that are on, then back'],
];
const DIVS: [GrainDiv, string, string][] = [
  ['1/4', '¼', 'A step every quarter note'], ['1/8', '⅛', 'A step every eighth note'], ['1/16', '1/16', 'A step every sixteenth note'],
  ['1/32', '1/32', 'A step every 32nd note'], ['1/8t', '⅛T', 'Eighth-note triplets'], ['1/16t', '1/16T', 'Sixteenth-note triplets'],
];
const VARS = ['A', 'B', 'C', 'D'] as const;
const NO_MASKS = [[], [], [], []] as number[][];
/** Rhythm's Generate: which slices are on, as a fresh list of the ones that are off. */
const GENERATE: [string, string, (n: number, off: Set<number>) => number[]][] = [
  ['Even', 'Every other slice on', n => [...Array(n).keys()].filter(i => i % 2)],
  ['Sparse', 'About a third of the slices on', n => { const on = [...Array(n).keys()].filter(() => Math.random() < .33); if (!on.length) on.push(0); return [...Array(n).keys()].filter(i => !on.includes(i)); }],
  ['Dense', 'About three quarters of the slices on', n => [...Array(n).keys()].filter(i => i && Math.random() < .25)],
  ['Random', 'Each slice on or off at random', n => [...Array(n).keys()].filter(i => i && Math.random() < .5)],
  ['All', 'Every slice on, and none reversed', () => []],
  ['Invert', 'Slices that are on go off, and the other way round', (n, off) => [...Array(n).keys()].filter(i => !off.has(i))],
];
/** Grain presets (G5): a whole grain setting in one tap, on whatever sample is loaded. Position and the Rhythm patterns stay
    (they belong to the sample); everything else starts from the grain defaults. One tap is one undo step. */
const GRAIN_BASE: Partial<SamplerSpec> = { g_size: .12, g_density: 14, g_spray: .08, g_scan: 0, g_spread: 0, g_scale: 'chromatic', g_reverse: 0, g_jitter: 0,
  g_size_rnd: 0, g_amp_rnd: 0, g_window: 'hann', g_roam: 'off', g_range: .4, g_speed: .25, g_sync: 'free', g_wander: 0, g_smooth: .5, g_jump: 0, g_hold: 0,
  g_rev: 0, g_chaos: 0, g_pulse: 0, g_rhythm: 'off', g_div: '1/8', g_swing: 0, g_prob: 1 };
const GRAIN_PRESETS: [string, string, string, Partial<SamplerSpec>][] = [
  ['Cloud Pad', 'pad', 'Long soft grains, a slow swell', { g_size: .25, g_density: 20, g_spray: .15, attack: .4, release: 1.2 }],
  ['Shimmer', 'pad', 'Octaves above and below, drifting forward', { g_size: .2, g_density: 30, g_spray: .1, g_spread: 12, g_scale: 'octaves', g_roam: 'forward', g_speed: .05, g_range: .3, attack: .3, release: 1.5 }],
  ['Glass Choir', 'pad', 'Fifths and octaves, round grains', { g_size: .3, g_density: 24, g_spread: 7, g_scale: 'fifths', g_window: 'welch', attack: .5, release: 1.5 }],
  ['Major Bloom', 'pad', 'A cloud on a major scale', { g_size: .15, g_density: 35, g_spread: 12, g_scale: 'major', g_amp_rnd: .4, attack: .2, release: 1 }],
  ['Minor Haze', 'pad', 'A minor-scale haze with some grains backwards', { g_size: .18, g_density: 28, g_spray: .2, g_spread: 7, g_scale: 'minor', g_reverse: .3, attack: .3, release: 1.2 }],
  ['Frozen', 'drone', 'Holds one moment of the sample', { g_size: .4, g_density: 25, g_spray: .02, g_jitter: .3, attack: .2, release: .8 }],
  ['Slow Drift', 'drone', 'Wanders slowly through most of the sample', { g_size: .35, g_density: 18, g_roam: 'forward', g_speed: .05, g_range: .8, g_wander: .4, g_smooth: .8, attack: .5, release: 1.5 }],
  ['Tidal', 'drone', 'Bounces back and forth, breathing', { g_size: .25, g_density: 22, g_roam: 'bounce', g_speed: .3, g_range: .6, g_pulse: .8, attack: .3, release: 1 }],
  ['Backwards Tape', 'drone', 'Every grain backwards, rolling back', { g_size: .3, g_density: 16, g_reverse: 1, g_roam: 'reverse', g_speed: .5, g_range: .5, release: .8 }],
  ['Deep Drone', 'drone', 'Long, dense, slow grains kept in key: a deep ambient bed', { g_size: .7, g_density: 40, g_spray: .3, g_spread: 12, g_scale: 'octaves', g_jitter: .5, g_size_rnd: .3, g_amp_rnd: .3, g_roam: 'forward', g_speed: .02, g_range: .5, g_wander: .3, g_smooth: .9, attack: 1.5, release: 3 }],
  ['Space', 'drone', 'An octave up and mostly backwards: the sound of space', { g_size: .45, g_density: 45, g_spray: .25, g_spread: 12, g_scale: 'octaves', g_reverse: .85, g_jitter: .4, g_amp_rnd: .4, g_roam: 'reverse', g_speed: .04, g_range: .6, attack: 1, release: 2.5 }],
  ['Wanderer', 'drone', 'Drifts and jumps around Position', { g_size: .2, g_density: 20, g_range: .6, g_wander: .8, g_smooth: .9, g_jump: .2, release: 1 }],
  ['Dust', 'texture', 'Tiny flat grains scattered everywhere', { g_size: .02, g_density: 60, g_spray: .6, g_window: 'rect', g_amp_rnd: .8, g_jitter: 1 }],
  ['Swarm', 'texture', 'A dense buzz of short, detuned grains', { g_size: .04, g_density: 80, g_spray: .4, g_spread: 3, g_jitter: .7 }],
  ['Scatter', 'texture', 'Grains from anywhere, half of them backwards', { g_size: .08, g_density: 25, g_spray: 1, g_reverse: .5, g_size_rnd: .5 }],
  ['Grain Hits', 'texture', 'Sparse percussive grains', { g_size: .05, g_density: 8, g_spray: .3, g_window: 'perc', g_jitter: .5 }],
  ['Glitch Jumps', 'glitch', 'Plays through, jumping and freezing', { g_size: .05, g_density: 40, g_window: 'perc', g_roam: 'forward', g_speed: 1, g_range: 1, g_jump: .8, g_hold: .6, g_chaos: .8 }],
  ['Hiccup', 'glitch', 'Stops and turns back at random', { g_size: .08, g_density: 30, g_roam: 'forward', g_speed: 1, g_range: 1, g_hold: 1, g_rev: .5, g_chaos: 1 }],
  ['Slice Skip', 'rhythm', 'Steps through the Chop slices in eighths', { g_size: .1, g_density: 30, g_spray: .02, g_rhythm: 'skip', g_div: '1/8' }],
  ['Gated 16ths', 'rhythm', 'Sixteenths through the slices, some steps stay', { g_size: .06, g_density: 50, g_spray: .02, g_window: 'rect', g_rhythm: 'gate', g_div: '1/16', g_prob: .8 }],
  ['Random Chops', 'rhythm', 'A random slice each sixteenth, swung', { g_size: .07, g_density: 40, g_window: 'perc', g_rhythm: 'random', g_div: '1/16', g_swing: .3 }],
  ['Ping Flow', 'rhythm', 'Through the slices and back, flowing', { g_size: .12, g_density: 30, g_rhythm: 'pingpong', g_div: '1/8' }],
];
const PRESET_COLOR: Record<string, string> = { pad: 'var(--c-grain)', drone: '#61e3bf', texture: '#a7b4ff', glitch: '#ff8f5c', rhythm: '#e47cf5' };
/** Rhythm steps the read point through the Chop slices. */
const stepping = (s: SamplerSpec) => (s.g_rhythm ?? 'off') !== 'off' && (s.slices?.length ?? 0) > 0;
/** Roam or Motion moves the read point inside the bracket Position .. Position + Range. */
const roaming = (s: SamplerSpec) => (s.g_roam ?? 'off') !== 'off' || (s.g_jump ?? 0) > 0 || (s.g_wander ?? 0) > 0;
function WindowIcon({ path }: { path: string }) {
  return <svg className="smp-filter-icon" viewBox="0 0 30 19" width={30} height={19} aria-hidden="true">
    <path className="axis" d="M2 16 H28" /><path className="curve" d={path} /></svg>;
}
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
export function SampleWindow({ spec, runtime, mode, selected, marker, onSelect, onEdit, onLive, onView, onChop, onAudition, onLibrary, onSliceTap, tapFlip }: {
  spec: SamplerSpec; runtime?: SamplerRuntime | null; mode: 'trim' | 'chop' | 'grain'; selected: number; marker: number | null;
  onSliceTap?(index: number): void; tapFlip?: boolean;
  onSelect(index: number, at: number): void; onEdit: Edit; onLive?: Edit; onView(a: number, b: number): void;
  onChop(mode: string, options?: Record<string, unknown>): void; onAudition(index: number): void; onLibrary?(slice: number): void;
}) {
  // Live input: the window is the last 8 s of the input; Position counts back from now, and Roam / Rhythm rest.
  if (runtime?.live && mode === 'grain') spec = { ...spec, start: 0, end: 1, g_roam: 'off', g_jump: 0, g_wander: 0, g_rhythm: 'off' };
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
  // Grain: Position is a tag inside the trimmed part; dragging it is heard at once and is one undo step on release.
  const [posDraft, setPosDraft] = useState<number | null>(null);
  const gdrag = useRef<{ left: number; width: number; x: number; moved: boolean; value: number; key: 'g_pos' | 'g_range' } | null>(null);
  const [rangeDraft, setRangeDraft] = useState<number | null>(null);
  const gpos = posDraft ?? spec.g_pos ?? .3, zoneU = Math.max(1e-6, spec.end - spec.start);
  const posAt = spec.start + gpos * zoneU, sprayU = (spec.g_spray ?? .08) * .5 * zoneU;
  const toPos = (u: number) => Math.round(Math.max(0, Math.min(1, (u - spec.start) / zoneU)) * 1e4) / 1e4;
  const steps = stepping(spec), vi = Math.max(0, VARS.indexOf(spec.g_var ?? 'A'));
  const offs = new Set((spec.g_off ?? NO_MASKS)[vi] ?? []), flips = new Set((spec.g_flip ?? NO_MASKS)[vi] ?? []), now = new Set(runtime?.steps ?? []);
  const roams = !steps && roaming(spec), grange = rangeDraft ?? spec.g_range ?? .4, gEnd = gpos + grange;
  const roamEndAt = spec.start + (gEnd > 1 + 1e-9 ? gEnd - 1 : gEnd) * zoneU;
  const toRange = (u: number) => { let r = toPos(u) - gpos; if (r < .02) r += 1; return Math.round(Math.max(.02, Math.min(1, r)) * 1e4) / 1e4; };
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
    else if (!p.moved && p.tap && mode === 'grain' && steps && onSliceTap) { const at = toU(e.clientX), i = slices.findIndex(([a, b]) => at >= a && at < b); if (i >= 0) onSliceTap(i); }
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
        {mode === 'grain' ? <>
          <rect className="smp-cut" x={0} y={0} width={Math.max(0, x(spec.start) * W)} height={120} />
          <rect className="smp-cut" x={x(spec.end) * W} y={0} width={Math.max(0, (1 - x(spec.end)) * W)} height={120} />
          {steps ? slices.map(([a, b], i) => <rect key={'st' + i} className={'smp-step' + (offs.has(i) ? ' off' : '') + (flips.has(i) ? ' flip' : '') + (now.has(i) ? ' now' : '')}
            x={x(a) * W + .5} y={0} width={Math.max(.5, (x(b) - x(a)) * W - 1)} height={120} />) : null}
          {roams ? (gEnd <= 1 ? [[posAt, roamEndAt]] : [[posAt, spec.end], [spec.start, roamEndAt]]).map(([a, b], i) =>
            <rect key={'r' + i} className="smp-roam" x={x(a) * W} y={0} width={Math.max(.5, (x(b) - x(a)) * W)} height={120} />) : null}
          {roams && visible(roamEndAt) ? <line className="smp-edge roam" x1={x(roamEndAt) * W} x2={x(roamEndAt) * W} y1={0} y2={120} vectorEffect="non-scaling-stroke" /> : null}
          {steps ? null : <rect className="smp-spray" x={x(Math.max(spec.start, posAt - sprayU)) * W} y={0} width={Math.max(.5, (x(Math.min(spec.end, posAt + sprayU)) - x(Math.max(spec.start, posAt - sprayU))) * W)} height={120} />}
          {(runtime?.grains ?? []).map((at, i) => visible(at) ? <line key={'g' + i} className="smp-grain-tick" x1={x(at) * W} x2={x(at) * W} y1={84 + (i * 7) % 30} y2={92 + (i * 7) % 30} vectorEffect="non-scaling-stroke" /> : null)}
          {!steps && visible(posAt) ? <line className="smp-edge grain" x1={x(posAt) * W} x2={x(posAt) * W} y1={0} y2={120} vectorEffect="non-scaling-stroke" /> : null}
        </> : mode === 'trim' ? <>
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
      {peaks.length && mode === 'grain' && !steps && visible(posAt) ? <button type="button" className="smp-handle h-grain" style={{ left: pct(posAt) }}
        aria-label={'Position ' + Math.round(gpos * 100) + '%'} title="Position: where the grains come from. Drag it; arrow keys nudge"
        onPointerDown={e => { if (e.button !== 0) return; e.stopPropagation(); const box = shell.current!.getBoundingClientRect(); e.currentTarget.setPointerCapture(e.pointerId);
          gdrag.current = { left: box.left, width: box.width, x: e.clientX, moved: false, value: gpos, key: 'g_pos' }; }}
        onPointerMove={e => { const d = gdrag.current; if (!d || (!d.moved && Math.abs(e.clientX - d.x) < 3)) return; d.moved = true;
          d.value = toPos(toU(e.clientX, d.left, d.width)); setPosDraft(d.value); onLive?.('g_pos', d.value); }}
        onPointerUp={() => { const d = gdrag.current; gdrag.current = null; setPosDraft(null); if (d?.moved) onEdit('g_pos', d.value); }}
        onPointerCancel={() => { const d = gdrag.current; gdrag.current = null; setPosDraft(null); if (d?.moved) onLive?.('g_pos', spec.g_pos ?? .3); }}
        onKeyDown={e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); e.stopPropagation();
          const step = (e.shiftKey ? .1 : e.ctrlKey ? .001 : .01) * (e.key === 'ArrowLeft' ? -1 : 1); onEdit('g_pos', Math.round(Math.max(0, Math.min(1, gpos + step)) * 1e4) / 1e4); }}>
        <i /><b>Position</b></button> : null}
      {peaks.length && mode === 'grain' && roams && visible(roamEndAt) ? <button type="button" className="smp-handle h-roam" style={{ left: pct(roamEndAt) }}
        aria-label={'Roam end ' + Math.round(grange * 100) + '%'} title="Roam end: how far the grains travel from Position. Drag it; arrow keys nudge"
        onPointerDown={e => { if (e.button !== 0) return; e.stopPropagation(); const box = shell.current!.getBoundingClientRect(); e.currentTarget.setPointerCapture(e.pointerId);
          gdrag.current = { left: box.left, width: box.width, x: e.clientX, moved: false, value: grange, key: 'g_range' }; }}
        onPointerMove={e => { const d = gdrag.current; if (!d || (!d.moved && Math.abs(e.clientX - d.x) < 3)) return; d.moved = true;
          d.value = toRange(toU(e.clientX, d.left, d.width)); setRangeDraft(d.value); onLive?.('g_range', d.value); }}
        onPointerUp={() => { const d = gdrag.current; gdrag.current = null; setRangeDraft(null); if (d?.moved) onEdit('g_range', d.value); }}
        onPointerCancel={() => { const d = gdrag.current; gdrag.current = null; setRangeDraft(null); if (d?.moved) onLive?.('g_range', spec.g_range ?? .4); }}
        onKeyDown={e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); e.stopPropagation();
          const step = (e.shiftKey ? .1 : e.ctrlKey ? .001 : .01) * (e.key === 'ArrowLeft' ? -1 : 1); onEdit('g_range', Math.round(Math.max(.02, Math.min(1, grange + step)) * 1e4) / 1e4); }}>
        <i /><b>Roam end</b></button> : null}
      {peaks.length && mode === 'chop' ? <>
        {shown.map(([a, b], i) => handle({ kind: 'slice', i, edge: 0 }, 'Slice ' + (i + 1), a, 'h-slice_start' + (i === selected ? ' on' : ''),
          i === selected || x(Math.min(b, shown[i + 1]?.[0] ?? b)) - x(a) > .022 ? String(i + 1) : null))}
        {sel && !(selected < shown.length - 1 && near(shown[selected + 1][0], sel[1]))
          ? handle({ kind: 'slice', i: selected, edge: 1 }, 'Slice ' + (selected + 1) + ' end', sel[1], 'h-slice_end on', null) : null}
      </> : null}
    </div>
    <span className="smp-caption">{secs ? (mode === 'grain' && runtime?.live ? 'Live input, the last ' + Math.round(secs) + ' s' + (runtime.live.frozen ? ' (frozen)' : '') + ' · grains from ' + (((1 - gpos) * secs) < .05 ? 'just now' : ((1 - gpos) * secs).toFixed(1) + ' s ago') + ' · ' + (runtime?.grains?.length ?? 0) + ' sounding'
      : mode === 'grain' && steps ? 'Rhythm over ' + slices.length + ' slices, pattern ' + VARS[vi] + ' · tap a slice to ' + (tapFlip ? 'reverse it' : 'turn it on or off') + ' · ' + (runtime?.grains?.length ?? 0) + ' sounding'
      : mode === 'grain' ? 'Grains from ' + ms(posAt) + ' ms' + (roams ? ' to ' + ms(roamEndAt) + ' ms' + ((spec.g_roam ?? 'off') === 'off' ? ' (Motion)' : ' (Roam)') : '') + ' · ' + (runtime?.grains?.length ?? 0) + ' sounding' + ((spec.keymap ?? 'whole') !== 'whole' ? ' · each key reads its own slice' : '') : '') + (mode === 'trim' ? 'Plays ' + ms(t.start) + '–' + ms(t.end) + ' ms' + (looping ? ' · loops ' + ms(t.loop_start) + '–' + ms(t.loop_end) + ' ms' : '') + ' of ' + ms(1) + ' ms' : '')
      + (vb - va < .999 ? (mode !== 'chop' ? ' · ' : '') + 'View ' + fmtS(va * secs) + '–' + fmtS(vb * secs) + ' of ' + fmtS(secs) : '') : ''}</span>
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
/** Grain mode's controls (24 Nov). The card's title is its page switch (UI-RULES 18): Grain shapes each grain,
    Roam moves the read point through the bracket on the waveform, Motion adds jumps, holds and backwards stretches. */
type GrainPage = 'grain' | 'roam' | 'motion' | 'rhythm' | 'harmony' | 'presets';
const GRAIN_PAGES: [GrainPage, string, string][] = [
  ['grain', 'Grain', 'Each grain: its shape, length, density, spread and scale'],
  ['roam', 'Roam', 'The read point travels through the bracket on the waveform'],
  ['motion', 'Motion', 'Jumps, holds, backwards stretches and a breathing pulse'],
  ['rhythm', 'Rhythm', 'Steps through the Chop slices in time'],
  ['harmony', 'Harmony', 'Spread keeps the notes of the sample in key'],
  ['presets', 'Presets', 'Ready-made grain sounds for the loaded sample'],
];
function GrainCard({ spec, id, onEdit, onLive, onChop, tapFlip, onTapFlip }: { spec: SamplerSpec; id: string; onEdit: Edit; onLive: Edit;
  onChop(): void; tapFlip: boolean; onTapFlip(flip: boolean): void }) {
  const [page, setPage] = useState<GrainPage>('grain');
  const pct = (n: number) => Math.round(n * 100) + '%';
  const secs = (n: number) => n < 1 ? Math.round(n * 1000) + ' ms' : n.toFixed(2) + ' s';
  const off = (n: number) => n < .005 ? 'Off' : pct(n);
  const knob = (key: string, name: string, min: number, max: number, def: number, step: number, format: (n: number) => string, description: string) =>
    <CommittedKnob key={key} id={id + '-' + key} defaultValue={def} name={name} value={(spec as Record<string, unknown>)[key] as number ?? def} min={min} max={max} step={step}
      description={description} format={format} onDraft={n => onLive(key, n)} onCommit={n => onEdit(key, n)} />;
  const win = spec.g_window ?? 'hann', scale = spec.g_scale ?? 'chromatic', roam = spec.g_roam ?? 'off', sync = spec.g_sync ?? 'free';
  return <section className={'smp-card smp-grain page-' + page} aria-label="Grain">
    <div className="smp-seg smp-grain-pages" role="radiogroup" aria-label="Grain page">
      {GRAIN_PAGES.map(([k, label, title]) => <button key={k} type="button" role="radio" aria-checked={page === k} title={title} onClick={() => setPage(k)}>
        {label}{k === 'roam' && roam !== 'off' ? <i className="smp-grain-dot" aria-hidden="true" /> : null}
        {k === 'rhythm' && stepping(spec) ? <i className="smp-grain-dot" aria-hidden="true" /> : null}
        {k === 'harmony' && (spec.g_harm ?? 'off') !== 'off' ? <i className="smp-grain-dot" aria-hidden="true" /> : null}
        {k === 'motion' && ((spec.g_jump ?? 0) + (spec.g_hold ?? 0) + (spec.g_rev ?? 0) + (spec.g_pulse ?? 0)) > 0 ? <i className="smp-grain-dot" aria-hidden="true" /> : null}</button>)}
    </div>
    {page === 'grain' ? <>
      <div className="smp-grain-head">
        <div className="smp-seg smp-filter-shapes smp-windows" role="radiogroup" aria-label="Grain shape">
          {WINDOWS.map(([w, label, path, title]) => <button key={w} type="button" role="radio" aria-label={label} aria-checked={win === w} title={title}
            onClick={() => onEdit('g_window', w)}><WindowIcon path={path} /><span>{label}</span></button>)}</div>
        {harmonySteps(spec) ? <button type="button" className="smp-harm-tag" title="Harmony picks the steps Spread lands on. Tap to open it." onClick={() => setPage('harmony')}>Steps: Harmony</button>
          : <div className="smp-seg smp-scales" role="radiogroup" aria-label="Spread scale">
          {SCALES.map(([k, label, title]) => <button key={k} type="button" role="radio" aria-checked={scale === k} title={title} onClick={() => onEdit('g_scale', k)}>{label}</button>)}</div>}
      </div>
      <div className="smp-knobs two smp-knobs-grain">
        {knob('g_pos', 'Position', 0, 1, .3, .001, pct, 'Where in the sample the grains come from (also the tag on the waveform)')}
        {knob('g_size', 'Size', .01, 1, .12, .001, secs, 'How long each grain is')}
        {knob('g_density', 'Density', 1, 80, 14, .1, n => (n < 10 ? n.toFixed(1) : Math.round(n)) + ' /s', 'How many new grains start each second')}
        {knob('g_spray', 'Spray', 0, 1, .08, .001, pct, 'Scatters each grain\'s start around Position (100% is the whole region)')}
        {knob('g_spread', 'Spread', 0, 12, 0, 1, n => n < .5 ? 'Off' : '±' + Math.round(n) + ' st', 'Each grain gets its own random pitch, up to this many semitones, on the scale above')}
        {knob('g_reverse', 'Reverse', 0, 1, 0, .01, off, 'Chance that a grain plays backwards')}
        {knob('g_jitter', 'Timing', 0, 1, 0, .01, n => n < .005 ? 'Even' : pct(n), 'Uneven gaps between grains: clusters and pauses, same average')}
        {knob('g_size_rnd', 'Size var', 0, 1, 0, .01, off, 'Each grain gets its own length, from a quarter to twice Size at 100%')}
        {knob('g_amp_rnd', 'Level var', 0, 1, 0, .01, off, 'Each grain gets its own level')}
      </div>
    </> : page === 'roam' ? <>
      <div className="smp-grain-head">
        <div className="smp-seg smp-roams" role="radiogroup" aria-label="Roam direction">
          {ROAMS.map(([k, label, Icon, title]) => <button key={k} type="button" role="radio" aria-label={label} aria-checked={roam === k} title={title}
            onClick={() => onEdit('g_roam', k)}><Icon size={16} /><span>{label}</span></button>)}</div>
      </div>
      <div className="smp-grain-head">
        <div className="smp-seg smp-syncs" role="radiogroup" aria-label="Roam speed: free or bars per pass">
          {SYNCS.map(([k, label, title]) => <button key={k} type="button" role="radio" aria-label={k === 'free' ? 'Free' : k + (k === '1' ? ' bar' : ' bars')} aria-checked={sync === k} title={title}
            onClick={() => onEdit('g_sync', k)}>{label}</button>)}<span className="smp-seg-unit">bars</span></div>
      </div>
      <div className="smp-knobs two smp-knobs-grain">
        {knob('g_range', 'Range', .02, 1, .4, .001, pct, 'How much of the sample it travels from Position (also the Roam end tag on the waveform)')}
        {sync === 'free' ? knob('g_speed', 'Speed', .02, 4, .25, .01, n => n.toFixed(2) + '×', 'Travel speed: 1× is playing speed') : null}
        {knob('g_wander', 'Wander', 0, 1, 0, .01, off, 'A random drift on top of the travel')}
        {knob('g_smooth', 'Smooth', 0, 1, .5, .01, pct, 'Makes the drift slow and heavy')}
      </div>
    </> : page === 'presets' ? <div className="smp-grain-presets" role="group" aria-label="Grain presets">
      {GRAIN_PRESETS.map(([name, kind, title, patch]) => <button key={name} type="button" className="smp-preset" style={{ ['--tool' as string]: PRESET_COLOR[kind] }}
        title={title + (kind === 'rhythm' && !(spec.slices?.length) ? ' (chop the sample to hear the steps)' : '')} onClick={() => onEdit('patch', { ...GRAIN_BASE, attack: 0, release: .25, ...patch })}>{name}</button>)}
    </div> : page === 'harmony' ? <HarmonyPage spec={spec} onEdit={onEdit} onSpread={() => setPage('grain')} />
    : page === 'rhythm' ? <RhythmPage spec={spec} onEdit={onEdit} onChop={onChop} tapFlip={tapFlip} onTapFlip={onTapFlip} knob={knob} />
    : <div className="smp-knobs two smp-knobs-grain">
      {knob('g_jump', 'Jump', 0, 1, 0, .01, off, 'Random jumps to another place in the bracket')}
      {knob('g_hold', 'Hold', 0, 1, 0, .01, off, 'Freezes the travel for a moment now and then')}
      {knob('g_rev', 'Rev', 0, 1, 0, .01, off, 'Travels backwards for a stretch now and then')}
      {knob('g_chaos', 'Chaos', 0, 1, 0, .01, n => n < .005 ? 'Even' : pct(n), 'Uneven timing for Jump, Hold and Rev: calm spells and bursts')}
      {knob('g_pulse', 'Pulse', 0, 1, 0, .01, off, 'The travel speed swells up and down like breathing')}
    </div>}
  </section>;
}

/** Harmony: what the sample holds, major or minor on its root, and the shifts Spread may use (true values, rule 2). */
function HarmonyPage({ spec, onEdit, onSpread }: { spec: SamplerSpec; onEdit: Edit; onSpread(): void }) {
  const held = spec.g_harm ?? 'off', kmode = spec.g_kmode ?? 'major', notes = spec.g_notes ?? [0, 4, 7], root = spec.root ?? 60;
  const steps = harmonySteps(spec), spread = Math.round(spec.g_spread ?? 0);
  const toggle = (n: number) => { const next = notes.includes(n) ? notes.filter(x => x !== n) : [...notes, n].sort((a, b) => a - b); if (next.length) onEdit('g_notes', next); };
  const lands = steps ? [...new Set(Array.from({ length: 2 * spread + 1 }, (_, i) => i - spread).map(k => {
    const o = Math.floor(k / 12) * 12, r = k - o; let best = 12;
    for (const d of [...steps, 12]) if (Math.abs(r - d) < Math.abs(r - best) || (Math.abs(r - d) === Math.abs(r - best) && d < best)) best = d;
    return o + best; }))].sort((a, b) => a - b) : [];
  return <>
    <div className="smp-grain-head">
      <div className="smp-seg smp-harms" role="radiogroup" aria-label="The sample holds">
        {HARMS.map(([k, label, title]) => <button key={k} type="button" role="radio" aria-label={label} aria-checked={held === k} title={title} onClick={() => onEdit('g_harm', k)}>{k === 'own' ? 'Own' : label}</button>)}</div>
    </div>
    <div className="smp-grain-head smp-harm-row">
      <div className="smp-seg smp-kmodes" role="radiogroup" aria-label="Key">
        {(['major', 'minor'] as const).map(k => <button key={k} type="button" role="radio" aria-checked={kmode === k}
          title={'The sample is in ' + pitchName(root) + ' ' + k + ' (its root is set in the Play card)'} onClick={() => onEdit('g_kmode', k)}>{pitchName(root)} {k}</button>)}</div>
      {steps ? <p className="smp-harm-lands" aria-label="Spread lands on">{spread ? <>Spread lands on <b>{lands.map(k => (k > 0 ? '+' : '') + k).join('  ')}</b> st</>
        : <>Spread is off. <button type="button" className="smp-harm-link" onClick={onSpread}>Turn it up on the Grain page</button></>}</p> : null}
    </div>
    {held === 'own' ? <div className="smp-seg smp-notes" role="group" aria-label="Notes the sample holds">
      {Array.from({ length: 12 }, (_, n) => <button key={n} type="button" aria-pressed={notes.includes(n)} aria-label={'Note ' + pitchName(root + n)}
        title={notes.includes(n) && notes.length === 1 ? 'At least one note stays' : 'The sample holds ' + pitchName(root + n)} onClick={() => toggle(n)}>{pitchName(root + n)}</button>)}
    </div> : null}
  </>;
}

/** Rhythm (G4): the read point steps through the Chop slices. Which slices are on, and which play backwards,
    is tapped on the waveform; four patterns A-D, and Generate fills the one that plays. */
function RhythmPage({ spec, onEdit, onChop, tapFlip, onTapFlip, knob }: { spec: SamplerSpec; onEdit: Edit; onChop(): void; tapFlip: boolean;
  onTapFlip(flip: boolean): void; knob: (key: string, name: string, min: number, max: number, def: number, step: number, format: (n: number) => string, description: string) => React.ReactElement }) {
  const n = spec.slices?.length ?? 0, rhythm = spec.g_rhythm ?? 'off', div = spec.g_div ?? '1/8', v = spec.g_var ?? 'A', vi = VARS.indexOf(v);
  if (!n) return <div className="smp-rhythm-empty">
    <p>Rhythm steps through the slices of the sample. Chop it first.</p>
    <button type="button" className="smp-send" onClick={onChop}><Scissors size={16} />Chop the sample</button></div>;
  const masks = (key: 'g_off' | 'g_flip') => (spec[key] ?? NO_MASKS).map(a => [...a]);
  const generate = (make: (n: number, off: Set<number>) => number[]) => {
    const off = masks('g_off'), flip = masks('g_flip'); off[vi] = make(n, new Set(off[vi])); flip[vi] = []; onEdit('patch', { g_off: off, g_flip: flip }); };
  return <>
    <div className="smp-grain-head">
      <div className="smp-seg smp-rhythms" role="radiogroup" aria-label="Rhythm mode">
        {RHYTHMS.map(([k, label, title]) => <button key={k} type="button" role="radio" aria-label={k === 'random' ? 'Random step' : k === 'pingpong' ? 'Ping-pong' : label}
          aria-checked={rhythm === k} title={title} onClick={() => onEdit('g_rhythm', k)}>{label}</button>)}</div>
    </div>
    <div className="smp-grain-head">
      <div className="smp-seg smp-divs" role="radiogroup" aria-label="Step length">
        {DIVS.map(([k, label, title]) => <button key={k} type="button" role="radio" aria-label={k} aria-checked={div === k} title={title} onClick={() => onEdit('g_div', k)}>{label}</button>)}</div>
      <div className="smp-seg smp-vars" role="radiogroup" aria-label="Pattern">
        {VARS.map(k => <button key={k} type="button" role="radio" aria-label={'Pattern ' + k} aria-checked={v === k} title={'Play pattern ' + k} onClick={() => onEdit('g_var', k)}>{k}</button>)}</div>
    </div>
    <div className="smp-grain-head smp-generate" role="group" aria-label="Generate a pattern">
      {GENERATE.map(([label, title, make]) => <button key={label} type="button" className="smp-gen" aria-label={'Generate ' + label.toLowerCase()} title={title + ' (pattern ' + v + ')'}
        onClick={() => generate(make)}>{label}</button>)}
    </div>
    <div className="smp-grain-head smp-rhythm-row">
      <div className="smp-knobs two smp-knobs-rhythm">
        {knob('g_swing', 'Swing', 0, .75, 0, .01, n => n < .005 ? 'Straight' : Math.round(50 + n * 100 / 3 * 2) + '%', 'Every second step comes late')}
        {knob('g_prob', 'Chance', 0, 1, 1, .01, n => Math.round(n * 100) + '%', 'The chance that a step moves on (else it stays on its slice)')}
      </div>
      <div className="smp-seg smp-tapmode" role="radiogroup" aria-label="Tapping a slice">
        <button type="button" role="radio" aria-checked={!tapFlip} title="Tap a slice on the waveform to turn it on or off" onClick={() => onTapFlip(false)}>On/off</button>
        <button type="button" role="radio" aria-checked={tapFlip} title="Tap a slice on the waveform to make its grains play backwards" onClick={() => onTapFlip(true)}><Undo2 size={15} />Reverse</button>
      </div>
    </div>
  </>;
}

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
const GLIDE_MODES: ['legato' | 'always', string, string][] = [
  ['legato', 'Legato', 'Glide only between keys held together; a new phrase starts on its own note'],
  ['always', 'Always', 'Glide from the last note even after it was let go (a one-shot bass that slides)'],
];
const panText = (n: number) => Math.abs(n) < .005 ? 'C' : (n < 0 ? 'L ' : 'R ') + Math.round(Math.abs(n) * 100);
const secs = (n: number) => n < 1 ? Math.round(n * 1000) + ' ms' : n.toFixed(2) + ' s';

/** Filter (25 Nov): its tabs are its title (rule 18). Filter: the type, Cutoff, Resonance and how far the envelope and
 *  velocity move them. Env: the filter's own envelope, Attack, Hold, Decay, Sustain and Release (points on the big view). */
function FilterCard({ spec, id, onEdit, onLive, big, onBig, lastFilter }: { spec: SamplerSpec; id: string; onEdit: Edit; onLive: Edit; big: boolean;
  onBig(): void; lastFilter: { current: FilterShape } }) {
  const [page, setPage] = useState<'filter' | 'env'>('filter');
  const filterOn = (spec.filter ?? 'off') !== 'off';
  const shape: FilterShape = filterOn ? spec.filter as FilterShape : lastFilter.current;
  const knob = (key: keyof SamplerSpec, name: string, min: number, max: number, def: number, step: number, format: (n: number) => string, description: string) =>
    <CommittedKnob key={key} id={id + '-' + key} defaultValue={def} name={name} value={(spec[key] as number | undefined) ?? def} min={min} max={max} step={step}
      description={description} format={format} onDraft={n => onLive(key, n)} onCommit={n => onEdit(key, n)} />;
  const off = (n: number) => n < .005 ? 'Off' : Math.round(n * 100) + '%';
  return <section className={'smp-card smp-filter page-' + page + (filterOn ? '' : ' off')} aria-label="Filter">
    <div className="smp-card-head">
      <div className="smp-seg smp-filter-pages" role="radiogroup" aria-label="Filter page">
        <button type="button" role="radio" aria-checked={page === 'filter'} title="Filter: the type, Cutoff and Resonance" onClick={() => setPage('filter')}>Filter</button>
        <button type="button" role="radio" aria-checked={page === 'env'} title="The filter's own envelope: Attack, Hold, Decay, Sustain, Release" onClick={() => setPage('env')}>Env</button>
      </div>
      <button type="button" role="switch" className="smp-power" aria-checked={filterOn} aria-label="Filter on"
        title={filterOn ? 'Turn the filter off (the settings are kept)' : 'Turn the filter on'}
        onClick={() => onEdit('filter', filterOn ? 'off' : lastFilter.current)}><Power size={14} />{filterOn ? 'On' : 'Off'}</button>
      <button type="button" className="smp-card-icon" aria-label="Edit the filter on the waveform" aria-pressed={big}
        title={big ? 'Back to Trim' : 'Drag the cutoff, resonance and the envelope points on the big view above'} onClick={onBig}><ArrowUp size={18} /></button></div>
    {page === 'filter' ? <>
      <div className="smp-seg smp-filter-shapes" role="radiogroup" aria-label="Filter type">
        {FILTERS.map(([f, short, name, title]) => <button key={f} type="button" role="radio" aria-label={name} aria-checked={shape === f} title={title}
          onClick={() => { lastFilter.current = f; onEdit('filter', f); }}><FilterIcon shape={f} /><span>{short}</span></button>)}
      </div>
      <div className="smp-knobs two">
        <CommittedKnob id={id + '-cutoff'} defaultValue={Math.log2(100)} name="Cutoff" value={Math.log2((spec.cutoff ?? 2000) / 20)} min={0} max={Math.log2(1000)} step={.01}
          description="Where the filter cuts" format={n => hz(20 * 2 ** n)} onDraft={n => onLive('cutoff', Math.round(Math.min(20000, Math.max(20, 20 * 2 ** n))))} onCommit={n => onEdit('cutoff', Math.round(Math.min(20000, Math.max(20, 20 * 2 ** n))))} />
        {knob('resonance', 'Resonance', 0, 1, .2, .01, n => Math.round(n * 100) + '%', 'A peak at the cutoff')}
        {knob('f_env', 'Env', -1, 1, 0, .01, n => Math.abs(n) < .005 ? 'Off' : (n > 0 ? '+' : '') + Math.round(n * 100) + '%', "How far the filter's envelope moves the cutoff (100% is five octaves); its shape is on the Env page")}
        {knob('f_env_vel', 'Env vel', 0, 1, 0, .01, off, 'Soft notes move the cutoff less: at 100% the envelope follows velocity fully')}
        {knob('f_velocity', 'Velocity', 0, 1, 0, .01, off, 'Soft notes are darker: up to four octaves lower')}
      </div>
    </> : <div className="smp-knobs two smp-fenv-knobs">
      {knob('f_attack', 'Attack', 0, 3, 0, .001, secs, 'Time for the filter envelope to rise')}
      {knob('f_hold', 'Hold', 0, 3, 0, .001, n => n <= 0 ? 'Off' : secs(n), 'Time it stays at the top before it falls')}
      {knob('f_decay', 'Decay', 0, 3, .3, .001, secs, 'Time to fall to the sustain level')}
      {knob('f_sustain', 'Sustain', 0, 1, 0, .01, n => Math.round(n * 100) + '%', 'Where it stays while the key is held')}
      {knob('f_release', 'Release', 0, 3, .3, .001, secs, 'Time to fall back after the key comes up')}
    </div>}
  </section>;
}

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
  const [big, setBig] = useState<'wave' | 'env' | 'filter' | 'grain'>(() => spec?.mode === 'grain' ? 'grain' : 'wave');
  // Choosing Grain opens its view; leaving Grain mode leaves it.
  const lastMode = useRef(spec?.mode);
  useEffect(() => {
    if (spec?.mode === 'grain' && lastMode.current !== 'grain') setBig('grain');
    if (spec?.mode !== 'grain' && lastMode.current === 'grain') setBig(b => b === 'grain' ? 'wave' : b);
    lastMode.current = spec?.mode;
  }, [spec?.mode]);
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
  // Chop chops at once (Sir, 25 Nov): a sample with no slices is cut with the current settings as soon as Chop
  // shows it (Threshold by default), once per sample, so there is no extra tap. Existing slices are kept.
  const autoChopped = useRef('');
  const sha = spec?.source?.sha256 ?? '', ready = ['READY', 'PLAYING'].includes(runtime?.status ?? '');
  useEffect(() => {
    if (mode !== 'chop' || big !== 'wave' || !spec || !sha || !ready || (spec.slices?.length ?? 0) > 0) return;
    if (autoChopped.current === spec.id + sha || runtime?.busy?.includes('chop')) return;
    autoChopped.current = spec.id + sha;
    send('sampler_chop', [trackIndex, spec.id, settings.mode, settings.mode === 'threshold' ? { threshold: settings.threshold, min_ms: settings.min_ms }
      : settings.mode === 'regions' ? { count: settings.count } : { bpm: settings.bpm, beats: settings.beats }]);
  }, [mode, big, spec?.id, sha, ready, spec?.slices?.length]);   // eslint-disable-line react-hooks/exhaustive-deps
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
  const toMode = (m: 'trim' | 'chop') => { setMode(m); setBig('wave'); };
  const [tapFlip, setTapFlip] = useState(false);
  const sliceTap = (i: number) => { if (!spec) return; const key = tapFlip ? 'g_flip' : 'g_off', vi = Math.max(0, VARS.indexOf(spec.g_var ?? 'A'));
    const all = (spec[key] ?? NO_MASKS).map(a => [...a]); all[vi] = all[vi].includes(i) ? all[vi].filter(x => x !== i) : [...all[vi], i].sort((a, b) => a - b); onEdit(key, all); };   // the zoom stays: F (or Fit) shows the whole sample
  const chopShown = mode === 'chop' && big === 'wave';
  const filterOn = (spec.filter ?? 'off') !== 'off';
  if (filterOn) lastFilter.current = spec.filter as FilterShape;
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
      : big === 'filter' ? <div className="smp-drag-shell smp-filter-shell"><FilterView type={spec.filter ?? 'off'} cutoff={spec.cutoff ?? 2000} resonance={spec.resonance ?? .2}
        onLive={onLive} onCommit={p => onEdit('patch', p)} />
        <FilterEnvView env={{ f_env: spec.f_env ?? 0, f_attack: spec.f_attack ?? 0, f_hold: spec.f_hold ?? 0, f_decay: spec.f_decay ?? .3, f_sustain: spec.f_sustain ?? 0, f_release: spec.f_release ?? .3 }}
          onLive={onLive} onCommit={p => onEdit('patch', p)} /></div>
      : <SampleWindow spec={spec} runtime={runtime} mode={big === 'grain' ? 'grain' : mode} selected={sel} marker={marker} onEdit={onEdit} onLive={onLive} onSliceTap={sliceTap} tapFlip={tapFlip}
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
      <div className={"smp-cards" + (big === 'grain' ? ' has-grain' : '')} key={spec.id}>
        <section className="smp-card smp-play" aria-label="Play">
          <h2>Play</h2>
          <div className="smp-seg" role="radiogroup" aria-label="Play mode">
            {MODES.map(([m, label, title]) => <button key={m} type="button" role="radio" aria-checked={spec.mode === m} title={title} onClick={() => onEdit('mode', m)}>{label}</button>)}
          </div>
          <div className="smp-line smp-play-line">
            <div className="smp-seg" role="radiogroup" aria-label="Voices">
              <button type="button" role="radio" aria-checked={spec.poly} title="Chords: up to 16 notes at once" onClick={() => onEdit('poly', true)}>Poly</button>
              <button type="button" role="radio" aria-checked={!spec.poly} title="One note at a time; it can glide between notes" onClick={() => onEdit('poly', false)}>Mono</button>
            </div>
            {spec.mode === 'grain' ? <button type="button" className="smp-toggle smp-mini smp-live-in" aria-pressed={!!runtime?.live} aria-label="Live in" title="Live input: grains from the input as it comes in (the last 8 seconds) instead of the sample (in Grain mode, Reverse is on the Grain card)"
              onClick={() => send('sampler_live_input', [trackIndex, spec.id, runtime?.live ? 'off' : 'on'])}><Mic size={15} /><span>Live in</span></button>
              : <button type="button" className="smp-toggle smp-mini" aria-pressed={!!spec.reverse} aria-label="Reverse" title="Play backwards" onClick={() => onEdit('reverse', !spec.reverse)}><Undo2 size={15} /><span>Reverse</span></button>}
            {runtime?.live ? <button type="button" className="smp-toggle smp-mini" aria-pressed={runtime.live.frozen} aria-label="Freeze" title="Freeze: stop listening and keep the last 8 seconds"
              onClick={() => send('sampler_live_input', [trackIndex, spec.id, runtime.live!.frozen ? 'thaw' : 'freeze'])}><Snowflake size={15} /><span>Freeze</span></button>
              : <button type="button" className="smp-toggle smp-mini" aria-pressed={!!spec.normalize} aria-label="Normalize" title="Normalize: bring the loudest peak to full level" onClick={() => onEdit('normalize', !spec.normalize)}><Maximize2 size={15} /><span>Normalize</span></button>}
          </div>
          <div className="smp-knobs two smp-play-knobs">
            <CommittedKnob id={id + '-glide'} defaultValue={0} name="Glide" value={spec.glide} min={0} max={2} step={.001} suffix="s" precision={3}
              description="Mono only: slide to the next note (Legato: only between held keys; Always: also from the last note after it was let go)" format={n => n <= 0 ? 'Off' : n < 1 ? Math.round(n * 1000) + ' ms' : n.toFixed(2) + ' s'} onDraft={n => onLive('glide', n)} onCommit={n => onEdit('glide', n)} />
            <div className="smp-seg smp-glide-mode" role="radiogroup" aria-label="Glide mode">
              {GLIDE_MODES.map(([k, label, title]) => <button key={k} type="button" role="radio" aria-checked={(spec.glide_mode ?? 'legato') === k} disabled={spec.poly}
                title={spec.poly ? 'Glide plays in Mono' : title} onClick={() => onEdit('glide_mode', k)}>{label}</button>)}
            </div>
            <CommittedKnob id={id + '-gain'} defaultValue={1} name="Gain" value={spec.gain} min={0} max={2} step={.01} suffix="×" precision={2} description="Level of every note" onDraft={n => onLive('gain', n)} onCommit={n => onEdit('gain', n)} />
            <CommittedKnob id={id + '-pan'} defaultValue={0} name="Pan" value={spec.pan ?? 0} min={-1} max={1} step={.01} precision={2}
              description="Place the Sampler left or right (C is the middle); link it to a mod pad for an autopan" format={panText} onDraft={n => onLive('pan', n)} onCommit={n => onEdit('pan', n)} />
            <CommittedKnob id={id + '-velocity'} defaultValue={1} name="Velocity" value={spec.velocity} min={0} max={2} step={.01} suffix="×" precision={2}
              description="How much softer soft notes are: 0 is fixed level, 1 is linear" onDraft={n => onLive('velocity', n)} onCommit={n => onEdit('velocity', n)} />
            <CommittedKnob id={id + '-vel_attack'} defaultValue={0} name="Vel attack" value={spec.vel_attack ?? 0} min={0} max={1} step={.01} suffix="%" precision={0}
              description="Hard notes snap, soft notes swell: at 100% the attack is up to 4 times shorter (hardest) or longer (softest)" format={n => n < .005 ? 'Off' : Math.round(n * 100) + '%'} onDraft={n => onLive('vel_attack', n)} onCommit={n => onEdit('vel_attack', n)} />
          </div>
        </section>
        {big === 'grain' ? <GrainCard key={'g' + spec.id} spec={spec} id={id} onEdit={onEdit} onLive={onLive} onChop={() => toMode('chop')} tapFlip={tapFlip} onTapFlip={setTapFlip} /> : <>
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
        <FilterCard spec={spec} id={id} onEdit={onEdit} onLive={onLive} big={big === 'filter'} onBig={() => setBig(big === 'filter' ? 'wave' : 'filter')} lastFilter={lastFilter} /></>}
      </div>
      <aside className="smp-side">
        <div className={"smp-rack smp-tools" + (spec.mode === 'grain' ? ' has-grain' : '')} role="toolbar" aria-label="Sampler tools">
          <div className="smp-rack-main"><div className="smp-rack-grid">
          <div className="smp-rack-row smp-tabs" role="radiogroup" aria-label="Edit">
            <button type="button" role="radio" className="smp-tool" style={tool('trim')} aria-label="Trim" aria-checked={big === 'wave' && mode === 'trim'} title="Trim: where the sample starts and ends, and its loop" onClick={() => toMode('trim')}><Crop size={18} /><span>Trim</span></button>
            <button type="button" role="radio" className="smp-tool" style={tool('chop')} aria-label="Chop" aria-checked={big === 'wave' && mode === 'chop'} title="Chop: cut it into slices for pads" onClick={() => toMode('chop')}><Scissors size={18} /><span>Chop</span></button>
            <button type="button" role="radio" className="smp-tool" style={tool('env')} aria-label="Envelope" aria-checked={big === 'env'} title="Envelope: drag Attack, Decay, Sustain and Release over the sound" onClick={() => setBig('env')}><Activity size={18} /><span>Env</span></button>
            <button type="button" role="radio" className="smp-tool" style={tool('filter')} aria-label="Filter" aria-checked={big === 'filter'} title="Filter: drag the cutoff and resonance" onClick={() => setBig('filter')}><SlidersHorizontal size={18} /><span>Filter</span></button>
            {spec.mode === 'grain' ? <button type="button" role="radio" className="smp-tool" style={tool('grain')} aria-label="Grain" aria-checked={big === 'grain'}
              title="Grain: Position on the waveform, the grains as they sound, and the Grain card" onClick={() => setBig('grain')}><Sparkles size={18} /><span>Grain</span></button> : null}
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
      <div className="smp-keyrow">
        <button type="button" className="smp-hold" aria-pressed={!!runtime?.hold} aria-label="Hold"
          title={runtime?.hold ? 'Hold on: notes keep sounding after you let go; the next chord replaces them. Tap to let them go' : 'Hold: keys and MIDI notes keep sounding after you let go'}
          onClick={() => send('sampler_hold', [trackIndex, !runtime?.hold])}>Hold</button>
        <SamplerKeys spec={spec} onMidi={onMidi} />
      </div>
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
