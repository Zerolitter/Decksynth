import { FX_MODULES, type FxModuleId } from './fx';

/** Factory settings for every effect: six starting points each. A preset sets the values it names and puts every other
 *  knob of that effect back to its default; the track pickers (Ducked by, Voice from) are left alone. */
export type FxPreset = { name: string; params: Record<string, number> };

const P = (name: string, params: Record<string, number>): FxPreset => ({ name, params });

export const FX_PRESETS: Record<FxModuleId, FxPreset[]> = {
  stutter: [
    P('Tight 16ths', { length: 3, speed: .6, repeats: 4, mix: .8 }),
    P('Roll', { length: 4, speed: .7, repeats: 8, mix: .9 }),
    P('Half-time', { length: 2, speed: .4, repeats: 2, mix: .7 }),
    P('Glitch', { length: 5, speed: .85, repeats: 6, mix: 1 }),
    P('Tape stop', { length: 1, speed: .2, repeats: 3, mix: .8 }),
    P('Subtle', { length: 3, speed: .5, repeats: 2, mix: .35 }),
  ],
  filter: [
    P('Warm low pass', { mode: 0, cutoff: .55, reso: .2, mix: 1 }),
    P('Dark', { mode: 0, cutoff: .25, reso: .15, mix: 1 }),
    P('Acid squeal', { mode: 0, cutoff: .45, reso: .85, mix: 1 }),
    P('Telephone', { mode: 1, cutoff: .55, reso: .4, mix: 1 }),
    P('Thin high pass', { mode: 2, cutoff: .4, reso: .2, mix: 1 }),
    P('Air only', { mode: 2, cutoff: .75, reso: .1, mix: 1 }),
  ],
  overdrive: [
    P('Warm', { drive: .25, mix: .6 }),
    P('Crunch', { drive: .5, mix: .8 }),
    P('Heavy', { drive: .8, mix: 1 }),
    P('Fuzz wall', { drive: 1, mix: 1 }),
    P('Parallel grit', { drive: .7, mix: .3 }),
    P('Edge', { drive: .15, mix: .4 }),
  ],
  bitcrusher: [
    P('Lo-fi', { rate: .3, bits: 12, mix: .6 }),
    P('8-bit', { rate: .5, bits: 8, mix: 1 }),
    P('Crunchy', { rate: .7, bits: 6, mix: .8 }),
    P('Radio', { rate: .6, bits: 10, mix: .5 }),
    P('Destroyed', { rate: .9, bits: 3, mix: 1 }),
    P('Dust', { rate: .15, bits: 14, mix: .4 }),
  ],
  volume: [
    P('Unity', { level: 1, mix: 1 }),
    P('Boost', { level: 1.3, mix: 1 }),
    P('Duck down', { level: .6, mix: 1 }),
    P('Half', { level: .5, mix: 1 }),
    P('Slight lift', { level: 1.15, mix: 1 }),
    P('Whisper', { level: .25, mix: 1 }),
  ],
  phaser: [
    P('Slow sweep', { rate: .15, depth: .6, feedback: .3, mix: .5 }),
    P('Jet', { rate: .3, depth: .9, feedback: .6, mix: .6 }),
    P('Shimmer', { rate: .5, depth: .4, feedback: .1, mix: .4 }),
    P('Deep', { rate: .1, depth: 1, feedback: .7, mix: .7 }),
    P('Hollow', { rate: .25, depth: .7, feedback: -.5, mix: .55 }),
    P('Fast wobble', { rate: .8, depth: .5, feedback: .2, mix: .5 }),
  ],
  flanger: [
    P('Classic', { rate: .2, depth: .5, feedback: .4, mix: .5 }),
    P('Jet plane', { rate: .1, depth: .9, feedback: .75, mix: .6 }),
    P('Metallic', { rate: .3, depth: .6, feedback: -.7, mix: .6 }),
    P('Gentle', { rate: .15, depth: .3, feedback: .2, mix: .35 }),
    P('Fast', { rate: .7, depth: .5, feedback: .4, mix: .5 }),
    P('Slow wash', { rate: .05, depth: .8, feedback: .5, mix: .5 }),
  ],
  ringmod: [
    P('Bell', { freq: .5, drive: .3, mix: .5 }),
    P('Low growl', { freq: .15, drive: .5, mix: .6 }),
    P('Metal', { freq: .7, drive: .6, mix: .7 }),
    P('Robot', { freq: .35, drive: .4, mix: 1 }),
    P('Sparkle', { freq: .9, drive: .2, mix: .3 }),
    P('Subtle', { freq: .4, drive: .2, mix: .25 }),
  ],
  delay: [
    P('Slapback', { time: 0, feedback: .15, mix: .3, width: .2 }),
    P('Eighth echo', { time: 2, feedback: .4, mix: .35, width: .5 }),
    P('Dotted eighth', { time: 3, feedback: .45, mix: .4, width: .7 }),
    P('Quarter dub', { time: 4, feedback: .6, mix: .4, width: .6 }),
    P('Long tail', { time: 5, feedback: .7, mix: .35, width: .8 }),
    P('Ping wide', { time: 1, feedback: .5, mix: .3, width: 1 }),
  ],
  reverb: [
    P('Small room', { predelay: .05, decay: .25, locut: .1, hicut: .7, mix: .25, width: .4 }),
    P('Plate', { predelay: .1, decay: .5, locut: .15, hicut: .85, mix: .3, width: .7 }),
    P('Hall', { predelay: .15, decay: .75, locut: .15, hicut: .75, mix: .35, width: .9 }),
    P('Cathedral', { predelay: .25, decay: .95, locut: .2, hicut: .6, mix: .4, width: 1 }),
    P('Dark space', { predelay: .1, decay: .8, locut: .1, hicut: .35, mix: .35, width: .8 }),
    P('Bright air', { predelay: .05, decay: .45, locut: .35, hicut: 1, mix: .25, width: .8 }),
  ],
  time: [
    P('Half speed', { speed: .5, mix: 1 }),
    P('Slow down', { speed: .75, mix: 1 }),
    P('Normal', { speed: 1, mix: 1 }),
    P('Speed up', { speed: 1.3, mix: 1 }),
    P('Double', { speed: 2, mix: 1 }),
    P('Tape wobble', { speed: .9, mix: .5 }),
  ],
  chorus: [
    P('Soft', { rate: .2, depth: .4, voices: 2, mix: .4, width: .6, haas: 0 }),
    P('Lush', { rate: .3, depth: .6, voices: 3, mix: .5, width: .9, haas: 0 }),
    P('Wide', { rate: .25, depth: .5, voices: 3, mix: .5, width: 1, haas: .012 }),
    P('Vibrato', { rate: .5, depth: .4, voices: 1, mix: 1, width: 0, haas: 0 }),
    P('Detune', { rate: .1, depth: .2, voices: 2, mix: .5, width: .7, haas: .006 }),
    P('Ensemble', { rate: .35, depth: .8, voices: 3, mix: .6, width: 1, haas: .02 }),
  ],
  compressor: [
    P('Gentle glue', { amount: .3, ratio: 0, attack: .3, release: .4, makeup: .2, mix: 1 }),
    P('Punch', { amount: .5, ratio: 1, attack: .4, release: .25, makeup: .3, mix: 1 }),
    P('Squash', { amount: .8, ratio: 2, attack: .1, release: .2, makeup: .5, mix: 1 }),
    P('Limiter', { amount: .9, ratio: 3, attack: .05, release: .15, makeup: .4, mix: 1 }),
    P('Parallel', { amount: .8, ratio: 2, attack: .15, release: .3, makeup: .5, mix: .4 }),
    P('Smooth levels', { amount: .4, ratio: 1, attack: .2, release: .5, makeup: .25, mix: 1 }),
  ],
  eq: [
    P('Flat', { low: 0, mid: 0, freq: .5, high: 0 }),
    P('Warm', { low: .25, mid: -.1, freq: .4, high: -.15 }),
    P('Bright', { low: -.1, mid: 0, freq: .5, high: .35 }),
    P('Smile', { low: .3, mid: -.3, freq: .5, high: .3 }),
    P('Mid boost', { low: -.15, mid: .4, freq: .55, high: -.1 }),
    P('Thin out', { low: -.6, mid: .1, freq: .6, high: .15 }),
  ],
  autowah: [
    P('Funk', { sens: .7, base: .3, range: .6, reso: .6, mix: .8 }),
    P('Quack', { sens: .9, base: .2, range: .8, reso: .8, mix: 1 }),
    P('Soft vowel', { sens: .4, base: .35, range: .4, reso: .4, mix: .6 }),
    P('Wide open', { sens: .6, base: .15, range: 1, reso: .55, mix: .8 }),
    P('Hard hit', { sens: 1, base: .25, range: .7, reso: .9, mix: 1 }),
    P('Subtle', { sens: .3, base: .4, range: .3, reso: .3, mix: .4 }),
  ],
  resonator: [
    P('Soft ring', { decay: .35, tone: .5, mix: .3, strings: 0 }),
    P('Glass', { decay: .6, tone: .8, mix: .4, strings: 1 }),
    P('Pipe', { decay: .5, tone: .3, mix: .4, strings: 2 }),
    P('Long bell', { decay: .9, tone: .6, mix: .35, strings: 1 }),
    P('Dark drone', { decay: .8, tone: .15, mix: .45, strings: 2 }),
    P('Short pluck', { decay: .2, tone: .7, mix: .5, strings: 0 }),
  ],
  cloud: [
    P('Soft haze', { time: .3, density: .6, scatter: .4, feedback: .3, tone: .6, mix: .3 }),
    P('Shimmer', { time: .45, density: .8, scatter: .7, feedback: .5, tone: .85, mix: .4 }),
    P('Frozen', { time: .6, density: .9, scatter: .3, feedback: .8, tone: .5, mix: .5 }),
    P('Grain storm', { time: .2, density: 1, scatter: 1, feedback: .4, tone: .6, mix: .5 }),
    P('Dark drift', { time: .5, density: .5, scatter: .6, feedback: .6, tone: .25, mix: .4 }),
    P('Sparse', { time: .35, density: .2, scatter: .8, feedback: .3, tone: .7, mix: .3 }),
  ],
  pitch: [
    P('Octave up', { semis: 12, cents: 0, mix: .5 }),
    P('Octave down', { semis: -12, cents: 0, mix: .6 }),
    P('Fifth up', { semis: 7, cents: 0, mix: .4 }),
    P('Detune thick', { semis: 0, cents: 12, mix: .5 }),
    P('Minor third', { semis: 3, cents: 0, mix: .4 }),
    P('Down a fourth', { semis: -5, cents: 0, mix: .5 }),
  ],
  autotune: [
    P('Natural', { speed: .5, amount: .6, mix: 1 }),
    P('Gentle', { speed: .3, amount: .8, mix: 1 }),
    P('Hard tune', { speed: .05, amount: 1, mix: 1 }),
    P('Robot', { speed: 0, amount: 1, mix: 1 }),
    P('Slow glide', { speed: .7, amount: 1, mix: 1 }),
    P('Blend', { speed: .15, amount: 1, mix: .5 }),
  ],
  duck: [
    P('Kick pump', { amount: .7, sens: .3, attack: .05, release: .3 }),
    P('Soft pump', { amount: .4, sens: .3, attack: .1, release: .4 }),
    P('Deep pump', { amount: 1, sens: .4, attack: .02, release: .5 }),
    P('Tight', { amount: .6, sens: .4, attack: .02, release: .15 }),
    P('Slow breathe', { amount: .6, sens: .25, attack: .3, release: .7 }),
    P('Sidechain hit', { amount: .9, sens: .5, attack: .0, release: .25 }),
  ],
  vocoder: [
    P('Classic', { response: .3, shift: 0, air: .3, mix: 1 }),
    P('Robot', { response: .15, shift: -.2, air: .2, mix: 1 }),
    P('Chipmunk', { response: .3, shift: .6, air: .4, mix: 1 }),
    P('Deep voice', { response: .3, shift: -.6, air: .2, mix: 1 }),
    P('Airy', { response: .4, shift: 0, air: .8, mix: .8 }),
    P('Blend', { response: .3, shift: 0, air: .3, mix: .5 }),
  ],
  // Ambient FX (25 Nov). Character 0/1/2 = Fresh/Worn/Broken; Interval 0..3 = +12/+7/+19/+24; Freeze 0/1.
  tape: [
    P('Fresh', { wow: .15, flutter: .1, drive: .2, age: .15, hiss: .1, mix: 1, character: 0 }),
    P('Cassette', { wow: .35, flutter: .35, drive: .35, age: .45, hiss: .35, mix: 1, character: 0 }),
    P('Worn Reel', { wow: .45, flutter: .25, drive: .4, age: .5, hiss: .3, mix: 1, character: 1 }),
    P('Warped', { wow: .9, flutter: .2, drive: .3, age: .4, hiss: .2, mix: 1, character: 1 }),
    P('Broken', { wow: .7, flutter: .6, drive: .6, age: .6, hiss: .5, mix: 1, character: 2 }),
    P('Lo-fi Dust', { wow: .3, flutter: .4, drive: .5, age: .8, hiss: .8, mix: 1, character: 1 }),
  ],
  smear: [
    P('Soft Blur', { size: .3, blur: .45, motion: .2, tone: .75, mix: .35 }),
    P('Wash', { size: .7, blur: .7, motion: .35, tone: .6, mix: .6 }),
    P('Glass', { size: .15, blur: .6, motion: .1, tone: 1, mix: .45 }),
    P('Drift', { size: .5, blur: .55, motion: .9, tone: .7, mix: .5 }),
    P('Haze', { size: .85, blur: .65, motion: .5, tone: .4, mix: .55 }),
    P('Thick Fog', { size: 1, blur: 1, motion: .6, tone: .3, mix: .8 }),
  ],
  shimmer: [
    P('Angel', { decay: 8, shimmer: .55, tone: .75, width: .9, mix: .4, interval: 0 }),
    P('Octave Bloom', { decay: 5, shimmer: .7, tone: .6, width: .8, mix: .45, interval: 0 }),
    P('Fifth Rise', { decay: 7, shimmer: .6, tone: .65, width: .85, mix: .4, interval: 1 }),
    P('Crystal', { decay: 4, shimmer: .5, tone: 1, width: 1, mix: .35, interval: 2 }),
    P('Choir Air', { decay: 10, shimmer: .4, tone: .45, width: .9, mix: .5, interval: 0 }),
    P('Endless', { decay: 20, shimmer: .8, tone: .55, width: 1, mix: .55, interval: 3 }),
  ],
  space: [
    P('Room to Hall', { size: .35, decay: 2.5, predelay: 10, damp: .5, mod: .2, mix: .3, freeze: 0 }),
    P('Big Hall', { size: .7, decay: 6, predelay: 25, damp: .4, mod: .3, mix: .4, freeze: 0 }),
    P('Cathedral', { size: .9, decay: 14, predelay: 45, damp: .35, mod: .25, mix: .45, freeze: 0 }),
    P('Infinite', { size: 1, decay: 60, predelay: 30, damp: .2, mod: .5, mix: .5, freeze: 0 }),
    P('Frozen Pad', { size: .85, decay: 20, predelay: 20, damp: .3, mod: .3, mix: .6, freeze: 1 }),
    P('Dark Void', { size: 1, decay: 30, predelay: 80, damp: .85, mod: .6, mix: .55, freeze: 0 }),
  ],
  gate: [
    P('Eighths', { length: 5, division: 2, steps: 0x5555, smooth: .3, depth: 1, pump: 0 }),
    P('Trance', { length: 5, division: 2, steps: 0xB6B6, smooth: .2, depth: 1, pump: 0 }),
    P('Stutter', { length: 5, division: 3, steps: 0xAAAA, smooth: .1, depth: 1, pump: 0 }),
    P('Offbeat', { length: 5, division: 2, steps: 0x6666, smooth: .35, depth: 1, pump: .3 }),
    P('Chop', { length: 5, division: 2, steps: 0xF0F0, smooth: .15, depth: 1, pump: 0 }),
    P('Soft tremolo', { length: 5, division: 3, steps: 0x5555, smooth: .8, depth: .6, pump: 0 }),
  ],
};

/** The values a preset writes: the effect's defaults, then the preset's own, with track pickers left as they are. */
export function presetParams(id: FxModuleId, preset: FxPreset, current: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of FX_MODULES[id].params) {
    if (p.editor === 'track') out[p.key] = current[p.key] ?? p.init;
    else out[p.key] = Math.min(p.max, Math.max(p.min, preset.params[p.key] ?? p.init));
  }
  return out;
}
