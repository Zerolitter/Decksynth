export type Note = { start: number; duration: number; note: number; velocity: number };
export type Instrument = {
  harmonics: number[];
  attack: number; decay: number; sustain: number; release: number;
  filter: number; modulation: number;
  /** Optional spectral macros; missing = neutral (curve 0, balance .5, focus 0, centre 4). */
  curve?: number; balance?: number; focus?: number; focus_center?: number;
  character?:number; spectral_energy?:number; random_seed?:number;
  /** Filter, Unison and Character cards; missing = off (see VOICE_DEFAULTS in sound-cards.ts). */
  vcf_type?: number; vcf_cutoff?: number; vcf_reso?: number; vcf_env?: number;
  uni_voices?: number; uni_detune?: number;
  formant?: number; vowel?: number; inharm?: number; sub?: number; sub_oct?: number;
};
export type DrumPad = {
  note:number;name:string;source:null|{path:string;sha256:string;[key:string]:unknown};
  gain:number;velocity:number;mute:boolean;solo:boolean;tune:number;choke:number;
};
export type DrumLibraryState = {root:string|null;folders:{id:string;name:string;count:number}[];scanning:boolean;loading:boolean;loading_track:number|null;error:string|null;memory_error?:string|null};
export type DrumRuntime = {accelerated?:boolean;native_warning?:string|null;pads:{status:string;peaks:number[][];event:number;playing:boolean;error?:string}[]};
export type Track = {
  device?:'synth'|'drum_rack';drum_rack?:{version:1;id:string;pads:DrumPad[];name?:string};
  name: string; preset: string; instrument: Instrument;
  volume: number; mute: boolean; notes: Note[];
  fx?: import('./fx').FxChain;
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
    velocity?:'As played'|'Fixed 100'|'Accent first';spice_seed?:number;octave_mode?:'Up'|'Down'|'UpDown';restart_bar?:boolean;
  };
  chord: {
    enabled:boolean;preset:string;user:number[];spread:number;strum_ms:number;
    strum_type:string;voicing:boolean;strum_sync?:string;bass?:number;slots?:number[][];
  };
  scale:{
    name:string;root:number;octave:number;velocity_curve:string;input_channel:number;
  };
  patterns:Record<string,StepPattern>;
};
export type Project = {
  version: number; bpm: number; bars: number; metronome: boolean; tracks: Track[];
  performance:PerformanceState;
  song?: import('./song').Song;
  /** Loops per track: the open one is in each track's own notes. */
  clips?: {open:number[];slots:Note[][][]};
};
export type DeckUpdate = {
  drum_racks?: (DrumRuntime|null)[];
  drum_library?:DrumLibraryState;
  state: Project; selected: number; beat: number;
  playing: boolean; recording: boolean; connected: string | null;
  devices: string[]; audio: string; audio_output: string;
  audio_outputs: string[]; voices: number; underruns: number; dsp_load?: number; buffer_ms?: number; preview?: boolean;
  meter?: { rms: number; peak: number; wave: number[]; spectrum?: number[]; fx?: number[][]; fx_live?: { params:number[]; mods:number[]; phases?:number[]; puck?:number[]; sound?:Record<string,number> } };
  held_notes?: number[];
  /** Step record cursor: the step the next recorded key goes to. */
  rec_step?: number;
  arp_view?: { groups:number[][]; step:number; phase?:number; paused?:boolean } | null;
  /** song position in beats (not wrapped to the loop), for the audio gate cursor */ song_beat?: number;
  song_pos?: { bar:number; length:number; marker:number|null; name:string|null } | null;
};
export type BridgeMessage = Partial<DeckUpdate> & { error?: string; message?: string; bridge?: string };
export type DeckApi = {
  available: true;
  send(command: string, args?: unknown): void;
  onMessage(callback: (message: BridgeMessage) => void): () => void;
  chooseFile(operation: 'save'|'open', extension:'project'|'midi'|'instrument'|'sample'|'sample_folder'): Promise<string|null>;
};
declare global { interface Window { deckApi?: DeckApi } }
export const TRACK_COLORS = ['#78d8bf','#d7b67c','#ad9ce6','#8baddf'] as const;
export const PRESETS = ['Warm Keys','Bass','Atmospheric Pad','Bell','Evolving Texture'] as const;
export function noteName(n: number) {
  const names = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  return names[n%12] + (Math.floor(n/12)-1);
}
export function clamp(n:number,low:number,high:number) { return Math.min(high,Math.max(low,n)); }
