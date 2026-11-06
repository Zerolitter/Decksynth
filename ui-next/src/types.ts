export type Note = { start: number; duration: number; note: number; velocity: number };
export type Instrument = {
  harmonics: number[];
  attack: number; decay: number; sustain: number; release: number;
  filter: number; modulation: number;
};
export type Track = {
  name: string; preset: string; instrument: Instrument;
  volume: number; mute: boolean; notes: Note[];
};
export type StepNote = { note: number; velocity: number; tie: number };
export type StepPattern = {
  length: number; division: string; gate: number; swing: number;
  steps: StepNote[][];
};
export type PerformanceState = {
  sync: {source: 'Internal'|'USB MIDI'|'Auto';receive_transport:boolean};
  seq: {
    enabled:boolean; recording:boolean; bank:number; slot:number; length:number;
    division:string; gate:number; swing:number; overdub:boolean;
    quantize_strength:number; transpose:number; spice:number;
    spice_seed:number; mutate_seed:number;chain:string[];chain_enabled:boolean;
  };
  arp: {
    enabled:boolean; mode:string; length:number; division:string; gate:number;swing:number;
    octaves:number;hold:boolean;retrigger:boolean;spice:number;seed:number;
  };
  chord: {
    enabled:boolean;preset:string;user:number[];spread:number;strum_ms:number;
    strum_type:string;voicing:boolean;
  };
  scale:{
    name:string;root:number;octave:number;velocity_curve:string;input_channel:number;
  };
  patterns:Record<string,StepPattern>;
};
export type Project = {
  version: number; bpm: number; bars: number; metronome: boolean; tracks: Track[];
  performance:PerformanceState;
};
export type DeckUpdate = {
  state: Project; selected: number; beat: number;
  playing: boolean; recording: boolean; connected: string | null;
  devices: string[]; audio: string; audio_output: string;
  audio_outputs: string[]; voices: number; underruns: number; preview?: boolean;
  meter?: { rms: number; peak: number; wave: number[] };
  held_notes?: number[];
};
export type BridgeMessage = Partial<DeckUpdate> & { error?: string; message?: string; bridge?: string };
export type DeckApi = {
  available: true;
  send(command: string, args?: unknown): void;
  onMessage(callback: (message: BridgeMessage) => void): () => void;
  chooseFile(operation: 'save'|'open', extension:'project'|'midi'|'instrument'): Promise<string|null>;
};
declare global { interface Window { deckApi?: DeckApi } }
export const TRACK_COLORS = ['#78d8bf','#d7b67c','#ad9ce6','#8baddf'] as const;
export const PRESETS = ['Warm Keys','Bass','Atmospheric Pad','Bell','Evolving Texture'] as const;
export function noteName(n: number) {
  const names = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  return names[n%12] + (Math.floor(n/12)-1);
}
export function clamp(n:number,low:number,high:number) { return Math.min(high,Math.max(low,n)); }
