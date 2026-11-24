import type {Shape} from './spectral-seeds';

export type SoundGuideId='warm-round'|'bright-harmonic'|'bell-metallic'|'pluck-percussive'|'evolving-ambient'|'walking-bass';
export type GuideRange=readonly [number,number];
export type SoundGuide={
 id:SoundGuideId; name:string; character:string; shape:Shape; contour:readonly number[];
 ranges:Readonly<Record<string,GuideRange>>; advice:Readonly<Record<string,string>>;
 tone:string; movement:string; musical:string;
};

/** Visual reference profiles derived from the matching factory presets and engine-supported ranges. They never write sound state. */
export const SOUND_GUIDES:readonly SoundGuide[]=[
 {id:'warm-round',name:'Warm / Round',character:'Soft fundamentals with a gentle, low-order roll-off.',shape:'SAW',
  contour:[1,.5,.22,.12,.08,.04,.02,.01,0,0,0,0,0,0,0,0],
  ranges:{filter:[.55,.9],curve:[-.35,.05],balance:[.2,.55],focus:[0,.25],character:[-.2,.15],attack:[.004,.08],decay:[.35,1],sustain:[.25,.65],release:[.3,1],env_curve:[.45,.85],vcf_cutoff:[.35,.7],vcf_reso:[.05,.3],velocity_brightness:[.15,.55],vel_curve:[.35,.7]},
  advice:{filter:'A restrained brightness roll-off keeps the low partials dominant.',curve:'A slight downward tilt prevents upper partials from turning brittle.',attack:'A short but non-zero attack preserves the soft key-like onset.',velocity_brightness:'Velocity can add expression without making quiet notes dull.'},
  tone:'Keep energy in the first few harmonics; leave spectral focus broad.',movement:'Use a gentle onset and a shaped decay for weight without a click.',musical:'Velocity variation brings phrasing; note rhythm remains a Performance choice.'},
 {id:'bright-harmonic',name:'Bright / Harmonic',character:'An open harmonic series with audible upper partials.',shape:'SAW',
  contour:[1,.536,.372,.287,.235,.199,.174,.154,.138,.126,.116,.107,.099,.093,.087,.082],
  ranges:{filter:[.75,1],curve:[.05,.45],balance:[.5,.85],focus:[0,.35],focus_center:[5,10],attack:[.002,.06],decay:[.2,.8],sustain:[.5,.9],release:[.12,.65],vcf_cutoff:[.6,1],vcf_reso:[.05,.35],velocity_brightness:[.2,.65],air:[.2,.65]},
  advice:{filter:'Brightness retains the upper harmonics that make the series read clearly.',curve:'A positive curve lifts high partials after the base contour is set.',focus_center:'A mid-to-upper focus centre emphasizes a band instead of only more treble.',air:'Air extends the drawn roll-off above partial 16 for higher notes.'},
  tone:'Let a falling harmonic series remain visible instead of concentrating on one band.',movement:'Fast attacks keep articulation clear; moderate release avoids a smeared line.',musical:'Use melodic note lengths and velocity contrast to expose the added harmonics.'},
 {id:'bell-metallic',name:'Bell / Metallic',character:'Sparse, offset upper partials with inharmonic stretch.',shape:'SPREAD',
  contour:[1,0,.55,0,.3,0,.12,.08,0,.04,0,0,.02,0,0,0],
  ranges:{filter:[.75,1],curve:[-.1,.35],balance:[.45,.8],focus:[.1,.65],focus_center:[3,9],attack:[.001,.02],decay:[.8,2.2],sustain:[0,.18],release:[.7,2],env_curve:[.65,1],vcf_cutoff:[.65,1],vcf_reso:[.1,.5],inharm:[.35,1],velocity_brightness:[.2,.7]},
  advice:{inharm:'Stretch separates partials from exact multiples, creating bell-like beating.',sustain:'Very low sustain lets the struck decay define the sound.',env_curve:'A curved release makes the long tail fall more naturally to the ear.',focus:'Focus can feature one metallic cluster without rewriting saved partials.'},
  tone:'Use gaps and displaced partials, then add stretch rather than indiscriminate treble.',movement:'A fast strike followed by a long curved decay carries the metallic impression.',musical:'Single notes and space make the decaying pitch relationships easiest to hear.'},
 {id:'pluck-percussive',name:'Pluck / Percussive',character:'A sharp transient that quickly clears into a compact body.',shape:'GAUSSIAN',
  contour:[.06218,.16901,.36788,.64118,.89484,1,.89484,.64118,.36788,.16901,.06218,.01832,.00432,.00082,.00012,.00002],
  ranges:{filter:[.55,1],curve:[-.1,.35],balance:[.35,.75],focus:[.05,.55],focus_center:[3,8],attack:[.001,.015],decay:[.08,.65],sustain:[0,.2],release:[.04,.45],env_curve:[.5,1],vcf_cutoff:[.45,.9],vcf_reso:[.05,.45],vcf_env:[.15,.75],velocity_brightness:[.25,.75],vel_curve:[.25,.7]},
  advice:{attack:'Fast attack keeps the pluck transient percussive.',decay:'Decay controls how quickly the body gets out of the way of the next note.',sustain:'Low sustain makes note length and gate audible rather than a held pad.',vcf_env:'Filter envelope gives the transient a bright opening that can close quickly.'},
  tone:'A compact harmonic cluster keeps the transient focused rather than simply bright.',movement:'Short amp and filter envelopes create the pluck; modulation is optional.',musical:'Sequencer gate and note lengths decide how much space exists between plucks.'},
 {id:'evolving-ambient',name:'Evolving / Ambient',character:'A broad, slowly changing spectrum with a soft entrance and long tail.',shape:'SPREAD',
  contour:[1,.2,.5,.1,.3,.08,.18,.06,.1,.04,.06,.02,.04,.02,.01,0],
  ranges:{filter:[.45,.85],curve:[-.25,.25],balance:[.3,.7],focus:[.1,.55],focus_center:[3,10],attack:[.5,2],decay:[.65,2],sustain:[.6,.9],release:[1.2,3],env_curve:[.25,.7],vcf_cutoff:[.3,.75],vcf_reso:[.05,.3],modulation:[.2,.75],drift:[.35,.85],air:[.15,.55]},
  advice:{attack:'A slow onset removes the percussive edge.',modulation:'Movement can evolve the held tone; keep it low enough to avoid wobble.',drift:'Independent voice drift widens a sustained chord without changing notes.',release:'A long release carries the texture between chord changes.'},
  tone:'Spread energy across a few selected partials instead of a single bright series.',movement:'Slow envelope, drift, and modulation create evolution in the tone itself.',musical:'Long notes, held chords, and sparse harmonic rhythm shape the ambient result.'},
 {id:'walking-bass',name:'Walking Bass / Pluck',character:'A strong fundamental with a quick, articulated low-end body.',shape:'SAW',
  contour:[1,.406,.24,.165,.123,.097,.08,.067,.057,.05,.044,.04,.036,.032,.03,.027],
  ranges:{filter:[.35,.7],curve:[-.35,.1],balance:[.1,.55],focus:[0,.25],attack:[.001,.012],decay:[.12,.42],sustain:[.05,.45],release:[.05,.22],env_curve:[.4,.8],vcf_cutoff:[.25,.65],vcf_reso:[.05,.35],vcf_env:[.15,.65],sub:[.1,.55],glide:[0,.14],velocity_brightness:[.15,.55],vel_curve:[.2,.55]},
  advice:{filter:'A low-to-mid brightness roll-off keeps bass weight ahead of fizz.',decay:'Short decay creates articulation but does not create a walking line on its own.',sub:'A restrained sub supports the fundamental without obscuring note changes.',glide:'Small glide can connect legato notes; it is not a replacement for the pattern.',velocity_brightness:'Velocity makes accented steps speak without changing the programmed notes.'},
  tone:'Prioritize the fundamental and low harmonics; avoid treating brightness as groove.',movement:'Short envelopes, subtle filter movement, glide, and dynamics shape articulation.',musical:'The walking groove comes from note order, gate, velocity, swing, and timing in Performance.'},
];

export function isRecommended(range:GuideRange|undefined,value:number){return !!range&&value>=range[0]&&value<=range[1];}
