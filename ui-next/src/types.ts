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
  pan?:number;play_mode?:number;glide?:number;pitch?:number;velocity_brightness?:number;velocity_cutoff?:number;vcf_keytrack?:number;
  vcf_morph?:number; fenv_a?:number; fenv_d?:number; fenv_s?:number; fenv_r?:number;
  uni_voices?: number; uni_detune?: number;
  formant?: number; vowel?: number; inharm?: number; sub?: number; sub_oct?: number;
};
export type DrumPad = {
  note:number;name:string;source:null|{path:string;sha256:string;[key:string]:unknown};
  gain:number;velocity:number;mute:boolean;solo:boolean;tune:number;choke:number;
  /** Non-destructive pad shaping (trim, fades, envelope, EQ, compressor, drive, pan); absent = as recorded. */
  shape?:DrumShape;
};
export type DrumShape={start:number;end:number;reverse:boolean;fade_in:number;fade_out:number;attack:number;hold:number;decay:number;
  low_cut:number;high_cut:number;eq_low:number;eq_mid:number;eq_freq:number;eq_high:number;
  comp_threshold:number;comp_ratio:number;comp_attack:number;comp_release:number;comp_makeup:number;drive:number;pan:number};
/** Mirrors decksynth/drum_shape.py DEFAULT_SHAPE. */
export const DEFAULT_DRUM_SHAPE:DrumShape={start:0,end:1,reverse:false,fade_in:0,fade_out:0,attack:0,hold:0,decay:0,
  low_cut:20,high_cut:20000,eq_low:0,eq_mid:0,eq_freq:1000,eq_high:0,
  comp_threshold:-18,comp_ratio:1,comp_attack:5,comp_release:120,comp_makeup:0,drive:0,pan:0};
export type DrumLibraryState = {root:string|null;folders:{id:string;name:string;count:number}[];scanning:boolean;loading:boolean;loading_track:number|null;error:string|null;memory_error?:string|null;
  sample_page?:{folder:string;page:number;total:number;items:{index:number;name:string;filename:string}[]}|null;
  preview?:{folder:string;index:number;loading:boolean;active:boolean}|null};
export type DrumRuntime = {accelerated?:boolean;native_warning?:string|null;pads:{status:string;peaks:number[][];event:number;playing:boolean;error?:string;
  /** Where the pad's sounding voices are, 0..1 of the sample (round 2: a moving playhead). */ at?:number[]}[]};
export type AutomationLane={module:string;param:string;points:[number,number][]};
export type Track = {
  sound_ab?:{active:'A'|'B';A:unknown;B:unknown};automation?:AutomationLane[];
  midi_cc?:import('./parameter-registry').MidiMapping[];
  device?:'synth'|'drum_rack'|'sampler';drum_rack?:{version:1;id:string;pads:DrumPad[];name?:string};
  /** A pad played across the keys (decksynth/sampler.py). */
  sampler?:SamplerSpec;
  name: string; preset: string; instrument: Instrument;
  volume: number; mute: boolean; notes: Note[];
  fx?: import('./fx').FxChain;
  /** Frozen to audio (decksynth/freeze.py): metadata only. */
  freeze?: FreezeMeta;
  /** The Loop freeze next to a Song freeze: a frozen track stays frozen in both modes. */
  freeze_loop?: FreezeMeta;
};
export type SamplerMode='oneshot'|'hold'|'loop';
export type SamplerSpec={version:1;id:string;name:string;family:string;source:DrumPad['source'];shape?:Partial<DrumShape>;
  root:number;tune:number;fine:number;mode:SamplerMode;start:number;end:number;loop_start:number;loop_end:number;
  attack:number;decay:number;sustain:number;release:number;poly:boolean;glide:number;gain:number;velocity:number;
  /** Chop: [start, end] or [start, end, root] pairs, 0..1 of the sample, in order (sampler expansion stage 3). */ slices?:number[][];
  /** Stage 4: how keys play the slices, and the extra tuning. */
  keymap?:'whole'|'slices'|'pitched';reverse?:boolean;normalize?:boolean;filter?:'off'|'lp'|'bp'|'hp';cutoff?:number;resonance?:number;
  f_env?:number;f_attack?:number;f_decay?:number;f_velocity?:number;p_env?:number;p_decay?:number};
export type SamplerRuntime={status:'EMPTY'|'LOADING'|'MISSING'|'READY'|'PLAYING';peaks:number[][];seconds:number;playing:number[];event:number;voices:number;error?:string|null;accelerated?:boolean;native_warning?:string|null;
  /** The waveform's zoom (0..1) the peaks cover, the slice being auditioned, and background jobs. */
  view?:[number,number];audition?:{index:number;at:number}|null;busy?:string[]};
export type FreezeMeta = {file:string;mode:'song'|'loop';fingerprint:string;frames:number;pass_frames:number;rate:number;bpm:number;peaks:number[]};
export type FreezeHold = {mode:'song'|'loop';bars:number;ok:boolean};
export type FreezeInfo = {state:'none'|'rendering'|'frozen'|'stale'|'missing';active?:boolean;progress?:number;holds?:FreezeHold[]};
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
  pattern_library?:{roles:Record<string,number>;ready:Record<string,boolean>;preview:{id:string;track:number;step:number}|null};
  midi_learn?:{track:number;module:string;param:string}|null;
  drum_racks?: (DrumRuntime|null)[];
  sample_library?: import('./components/SampleLibrary').SampleLibraryState | null;
  samplers?: (SamplerRuntime|null)[];
  /** Recording into a Sampler: the open input, its level, and the take. */
  sampler_record?: SamplerRecord;
  drum_library?:DrumLibraryState;
  state: Project; selected: number; beat: number;
  playing: boolean; recording: boolean; connected: string | null;
  /** REC count-in: counting (beat n of 4) or armed (waiting for the first note). */
  count_in?: {state:'count';beat:number;of:number}|{state:'armed';count:number}|null;
  devices: string[]; audio: string; audio_output: string;
  audio_outputs: string[]; voices: number; underruns: number; dsp_load?: number; buffer_ms?: number; preview?: boolean;
  sound_undo?:number[];automation_arm?:boolean;audio_channels?:number;
  meter?: { channels?:{rms:number;peak:number;wave:number[]}[];rms: number; peak: number; wave: number[]; spectrum?: number[]; fx?: number[][]; fx_live?: { gate?:import('./fx').GateRuntime|null;partials?:number[]|null;params:number[]; mods:number[]; phases?:number[]; puck?:number[]; sound?:Record<string,number> } };
  held_notes?: number[];
  /** Step record cursor: the step the next recorded key goes to. */
  rec_step?: number;
  arp_view?: { groups:number[][]; step:number; phase?:number; paused?:boolean } | null;
  /** song position in beats (not wrapped to the loop), for the audio gate cursor */ song_beat?: number;
  song_pos?: { bar:number; length:number; marker:number|null; name:string|null } | null;
  /** Per track: frozen, out of date, or freezing (with progress 0..1). */
  freeze?: FreezeInfo[];
  /** WAV export progress 0..1 while it runs. */
  exporting?: number|null;
};
export type BridgeMessage = Partial<DeckUpdate> & { error?: string; message?: string; bridge?: string };
export type DeckApi = {
  available: true;
  send(command: string, args?: unknown): void;
  onMessage(callback: (message: BridgeMessage) => void): () => void;
  chooseFile(operation: 'save'|'open', extension:'project'|'midi'|'instrument'|'wav'|'sample'|'sample_folder'): Promise<string|null>;
};
declare global { interface Window { deckApi?: DeckApi } }
export const TRACK_COLORS = ['#d7b67c','#78d8bf','#ad9ce6','#8baddf','#e59a7a','#6fc6d8','#d68fc0','#a9b4c2'] as const;
/** Tracks can be added up to 8 and removed down to 4 (Sampler editing stage 10). */
export const MIN_TRACKS = 4, MAX_TRACKS = 8;
export const SONG_TRACK_COLORS = ['#a1b9d4', TRACK_COLORS[1], TRACK_COLORS[2], '#8193ab', TRACK_COLORS[4], TRACK_COLORS[5], TRACK_COLORS[6], TRACK_COLORS[7]] as const;
export const PRESETS = ['Warm Keys','Bass','Atmospheric Pad','Bell','Evolving Texture'] as const;
export function noteName(n: number) {
  const names = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  return names[n%12] + (Math.floor(n/12)-1);
}
export function clamp(n:number,low:number,high:number) { return Math.min(high,Math.max(low,n)); }

export type SamplerRecord = {
  inputs: string[]; input: string | null; error: string | null; track: number | null;
  state: 'idle' | 'armed' | 'recording' | 'saving'; level: number; peak?: number; threshold: number; length: number; seconds: number; clipped: boolean;
  gain?: number; normalize?: boolean;
};
