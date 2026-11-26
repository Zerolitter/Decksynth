import type {DrumPad} from './types';
import {drumKind} from './drum-kinds.ts';

/** Decksynth's own genre starting points: a few Euclid lanes per genre, written for 16 steps of 16ths in 4/4.
 *  They are starting points to tweak, not copies of any other product's presets. `bpm` is a hint, never applied. */
export type DrumRole='kick'|'snare'|'clap'|'hat'|'openhat'|'perc';
export const DRUM_ROLES:DrumRole[]=['kick','snare','clap','hat','openhat','perc'];
export const ROLE_LABEL:Record<DrumRole,string>={kick:'Kick',snare:'Snare',clap:'Clap',hat:'Hat',openhat:'Open hat',perc:'Perc'};
type L=[fill:number,steps:number,shift:number,velocity:number];
export type SynthRole='bass'|'arp';
export const SYNTH_ROLES:SynthRole[]=['bass','arp'];
export const SYNTH_LABEL:Record<SynthRole,string>={bass:'Bass',arp:'Arp'};
/** A synth lane walks its `degrees` (scale steps from the root) pulse by pulse, `octave` octaves above the root note. */
export type SynthLane={lane:L;degrees:number[];octave:number};
export type Genre={id:string;name:string;bpm:[number,number];drums:Partial<Record<DrumRole,L>>;synth:Record<SynthRole,SynthLane>};

export const GENRES:Genre[]=[
 {id:'chill',name:'Chill & Ambient',bpm:[70,100],
  drums:{kick:[3,16,0,90],snare:[2,16,4,70],hat:[7,16,0,55],perc:[5,16,2,50]},
  synth:{bass:{lane:[3,16,0,80],degrees:[0,0,-2],octave:0},arp:{lane:[5,16,1,60],degrees:[0,2,4,6,4,2],octave:2}}},
 {id:'techno',name:'Techno',bpm:[128,140],
  drums:{kick:[4,16,0,118],clap:[2,16,4,100],hat:[11,16,0,70],openhat:[4,16,2,85],perc:[5,16,3,75]},
  synth:{bass:{lane:[7,16,2,100],degrees:[0,0,0,3],octave:0},arp:{lane:[9,16,0,80],degrees:[0,4,7,4],octave:2}}},
 {id:'progressive',name:'Progressive',bpm:[120,128],
  drums:{kick:[4,16,0,112],clap:[2,16,4,95],hat:[9,16,0,65],openhat:[4,16,2,80],perc:[7,16,1,60]},
  synth:{bass:{lane:[5,16,0,95],degrees:[0,0,4,3],octave:0},arp:{lane:[7,16,1,75],degrees:[0,2,4,2,7,4],octave:2}}},
 {id:'edm',name:'Dance & EDM',bpm:[124,130],
  drums:{kick:[4,16,0,120],clap:[2,16,4,105],hat:[8,16,0,80],openhat:[4,16,2,95]},
  synth:{bass:{lane:[8,16,2,105],degrees:[0],octave:0},arp:{lane:[11,16,0,85],degrees:[0,2,4,7,4,2],octave:2}}},
 {id:'hiphop',name:'Hip Hop & Trap',bpm:[70,145],
  drums:{kick:[3,16,0,115],snare:[1,16,8,110],clap:[1,16,8,90],hat:[11,16,0,62],openhat:[1,16,14,72]},
  synth:{bass:{lane:[3,16,0,110],degrees:[0,0,-2,0],octave:0},arp:{lane:[5,16,3,70],degrees:[0,2,4,2],octave:2}}},
 {id:'dubstep',name:'Dubstep',bpm:[138,142],
  drums:{kick:[1,16,0,122],snare:[1,16,8,118],clap:[1,16,8,90],hat:[5,16,0,68],perc:[3,16,5,65]},
  synth:{bass:{lane:[4,16,0,112],degrees:[0,0,1,0],octave:0},arp:{lane:[3,8,0,78],degrees:[0,3,5],octave:2}}},
 {id:'reggaeton',name:'Reggaeton',bpm:[88,100],
  drums:{kick:[4,16,0,112],snare:[3,8,0,98],hat:[8,16,0,70],perc:[5,16,3,60]},
  synth:{bass:{lane:[3,8,0,105],degrees:[0,0,-2],octave:0},arp:{lane:[5,16,2,72],degrees:[0,2,4,2],octave:2}}},
];

/** The pad that plays each drum role in this kit, matched by what the pad is (its name or sample), never by MIDI note.
 *  A role with no matching pad is absent, so a lane never silently lands on the wrong sound. */
export function drumRolePads(pads:readonly DrumPad[]):Partial<Record<DrumRole,DrumPad>>{
 const kind=(p:DrumPad)=>drumKind(p.name,p.source?.path),open=(p:DrumPad)=>/\b(open|oh|ohh)\b/i.test(p.name.replace(/([a-z])([A-Z])/g,'$1 $2'));
 const by=(k:string)=>pads.filter(p=>kind(p)===k),hats=by('hat');
 const pick=(...list:(DrumPad|undefined)[])=>list.find(Boolean);
 const out:Partial<Record<DrumRole,DrumPad>>={};
 const set=(role:DrumRole,pad?:DrumPad)=>{if(pad)out[role]=pad;};
 set('kick',by('kick')[0]);set('snare',by('snare')[0]);set('clap',pick(by('clap')[0],by('rim')[0]));
 set('hat',hats.find(p=>!open(p)));set('openhat',hats.find(open));
 set('perc',pick(by('perc')[0],by('tom')[0]));
 return out;
}
