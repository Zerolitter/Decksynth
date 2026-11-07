import type { Instrument } from './types';

/** Same neutral values as decksynth/core.py VOICE_DEFAULTS: a missing key plays like before. */
export const VOICE_DEFAULTS = {vcf_type:0, vcf_cutoff:.65, vcf_reso:.2, vcf_env:.3, uni_voices:1, uni_detune:.3,
  formant:0, vowel:0, inharm:0, sub:0, sub_oct:1};
export type VoiceKey = keyof typeof VOICE_DEFAULTS;
export const voiceParam = (p:Instrument, k:VoiceKey):number => (p[k] as number|undefined) ?? VOICE_DEFAULTS[k];

export const FILTER_TYPES = ['LP', 'BP', 'HP'];
export const FILTER_NAMES = ['Off', 'Low-pass', 'Band-pass', 'High-pass'];
export const UNISON_VOICES = [1, 2, 3, 4, 5, 7];
export const VOWELS = ['A', 'E', 'I', 'O', 'U'];

/** Cutoff knob 0-1 as the engine hears it at middle C (20 Hz-18 kHz). */
export const cutoffHz = (v:number) => 20 * Math.pow(900, v);
export const fmtHz = (v:number) => { const hz = cutoffHz(v); return hz >= 1000 ? (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + ' kHz' : Math.round(hz) + ' Hz'; };
export const fmtOct = (v:number) => (v >= 0 ? '+' : '') + (v * 6).toFixed(1) + ' oct';
export const fmtCents = (v:number) => Math.round(v * 50) + ' ct';
export const fmtVowel = (v:number) => { const i = Math.min(3, Math.floor(v)), t = v - i;
  return t < .08 ? VOWELS[i] : t > .92 ? VOWELS[i + 1] : VOWELS[i] + '→' + VOWELS[i + 1]; };

/** Missing filter stages inherit this sound's amp envelope until the first filter edit. */
export const FILTER_ENV_KEYS={attack:'fenv_a',decay:'fenv_d',sustain:'fenv_s',release:'fenv_r'} as const;
type FilterEnvelopeSource=Pick<Instrument,'attack'|'decay'|'sustain'|'release'|'fenv_a'|'fenv_d'|'fenv_s'|'fenv_r'>;
export const filterEnvelope=(p:FilterEnvelopeSource)=>({attack:p.fenv_a??p.attack,decay:p.fenv_d??p.decay,
  sustain:p.fenv_s??p.sustain,release:p.fenv_r??p.release});
export const filterMorph=(p:Pick<Instrument,'vcf_type'|'vcf_morph'>)=>p.vcf_morph??Math.max(0,(p.vcf_type??1)-1)/2;
export const fmtMorph=(v:number)=>v===0?'LP':v===.5?'BP':v===1?'HP':v<.5?'LP→BP':'BP→HP';
