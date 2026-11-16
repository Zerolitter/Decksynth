// FX chain model shared by the UI and (from step 3) the Python engine.
// Module set follows the user's PrismFX reference recordings; all DSP is DeckSynth's own.

export type FxModuleId = 'stutter'|'filter'|'overdrive'|'bitcrusher'|'volume'|'phaser'
  |'flanger'|'ringmod'|'delay'|'reverb'|'time'|'chorus'|'compressor'|'eq'|'autowah'|'resonator'|'gate'|'cloud'|'pitch'|'autotune'|'duck'|'vocoder';

export type FxParamDef = { key:string; label:string; min:number; max:number; init:number; suffix?:string; precision?:number;
  /** labels for each whole value from min to max: shown as tap buttons instead of a knob */ options?:string[];
  /** set in the effect's own sheet, not on the card, and not a link target */ hidden?:boolean;
  /** drawn by a custom editor on the card (the gate's step strip, or a pick list of tracks) */ editor?:'gate'|'track'; modulatable?:boolean;
  /** a turning knob even for whole numbers (precision 0 otherwise shows - and + buttons) */ knob?:boolean };
export type FxModuleDef = { name:string; color:string; params:FxParamDef[]; blurb?:string };
export type FxModuleState = { id:FxModuleId; on:boolean; params:Record<string,number>; /** kept in the rack but not heard */ bypass?:boolean };
/** 'sound' targets are the Sound page knobs of the same track. */
export type FxTarget = { module:FxModuleId|'sound'|'sampler'|'drum'; param:string; depth:number };
export type FxMacro = { name:string; value:number; targets:FxTarget[] };
export type ModShape = 'sine'|'triangle'|'saw'|'ramp'|'square'|'pulse'|'random'|'smooth'|'steps'|'curve'
  |'cosine'|'half_sine'|'exp_up'|'log_up'|'exp_down'|'log_down'|'s_curve'|'shark'|'double_sine'|'warm'
  |'pluck'|'swell'|'ad'|'trapezoid'|'ramp_hold'|'pump'|'pump2'|'bounce'|'heartbeat'|'wobble'
  |'pulse_narrow'|'pulse_wide'|'gate2'|'gate3'|'gate4'|'trance'|'euclid5'|'offbeat'|'stairs4'|'stairs8'
  |'sh16'|'drift';
export type ModFeel = ''|'T'|'D';
export type FxModSource = { shape:ModShape; rate:number; steps:number[]; targets:FxTarget[];
  /** straight, triplet or dotted cycle */ feel?:ModFeel; /** Steps shape: how many steps (cells merge in groups) */ count?:4|8|16;
  /** Drawn shape: points [x 0..1, y -1..1], sorted by x */ points?:[number,number][] };
export type MorphPath = 'hand'|'circle'|'eight'|'flower'|'triangle'|'square'|'spiral'|'star'|'wave'|'drift';
export type MorphMode = 'follow'|'retrigger'|'freeze';
/** x/y is the centre you touch; with a path the engine moves the puck around it in audio time. */
export type FxMorph = { x:number; y:number; xMacro:number; yMacro:number; /** -1: Pad mix drives no macro */ mixMacro:number;
  path:MorphPath; rate:number; size:number; wander:number; spin:number; mode:MorphMode };
export type FxChain = { modules:FxModuleState[]; macros:FxMacro[]; mods:FxModSource[]; morph:FxMorph };

/** Shape pages of 2 x 5 in the mod pad editor (same order as decksynth/fx.py SHAPES). */
export const SHAPE_PAGES:{name:string;shapes:ModShape[]}[]=[
  {name:'Basic',shapes:['sine','triangle','saw','ramp','square','pulse','random','smooth','steps','curve']},
  {name:'Curves',shapes:['cosine','half_sine','exp_up','log_up','exp_down','log_down','s_curve','shark','double_sine','warm']},
  {name:'Envelopes',shapes:['pluck','swell','ad','trapezoid','ramp_hold','pump','pump2','bounce','heartbeat','wobble']},
  {name:'Gates & rhythm',shapes:['pulse_narrow','pulse_wide','gate2','gate3','gate4','trance','euclid5','offbeat','stairs4','stairs8']},
  {name:'Random',shapes:['sh16','drift']},
];
export const MOD_SHAPES:ModShape[]=SHAPE_PAGES.flatMap(p=>p.shapes);
/** Shapes drawn from a random source: no "Edit points" (there is no fixed curve to copy). */
export const RANDOM_SHAPES=new Set<ModShape>(['random','smooth','sh16','drift']);
/** Indexed by the saved rate number; 8 and 16 bars were added at the end (15 Nov) so old projects keep their rates. */
export const MOD_RATES=['4 bars','2 bars','1 bar','1/2','1/4','1/8','1/16','8 bars','16 bars'];
/** Rate numbers in the order the editor shows them: slowest first. */
export const MOD_RATE_ORDER=[8,7,0,1,2,3,4,5,6];
/** Morph pad path speeds use the original seven rates only. */
export const PATH_RATE_COUNT=7;
export const FEEL_FACTOR:Record<ModFeel,number>={'':1,'T':2/3,'D':1.5};
export const STEP_COUNTS=[4,8,16] as const;
export const DEFAULT_POINTS:[number,number][]=[[0,0],[.5,1],[1,0]];
/** Rate label with its feel, e.g. "1/4 T". */
export const rateLabel=(m:{rate:number;feel?:ModFeel})=>MOD_RATES[m.rate]+(m.feel?' '+m.feel:'');
const PRESET_SHAPES:ModShape[]=['sine','triangle','saw','square','random','steps','sine','steps'];

/** Same as decksynth/fx.py curve_value: straight lines between points, wrapping around the ends. */
export function curveValue(points:[number,number][]|undefined,phase:number):number{
  const pts=points&&points.length>=2?points:[[0,0],[1,0]] as [number,number][];
  let a:[number,number],b:[number,number];
  const first=pts[0],last=pts[pts.length-1];
  if(phase>=last[0]){a=last;b=[first[0]+1,first[1]];}
  else if(phase<=first[0]){a=[last[0]-1,last[1]];b=first;}
  else{const k=pts.findIndex(p=>p[0]>=phase);a=pts[k-1];b=pts[k];}
  return b[0]-a[0]<1e-9?a[1]:a[1]+(b[1]-a[1])*(phase-a[0])/(b[0]-a[0]);
}

/** Same bipolar shapes as decksynth/fx.py shape_value, for drawing and preview. */
export function shapeValue(shape:ModShape,phase:number,steps:number[],seed=0,count=16,points?:[number,number][]):number{
  if(shape==='sine')return Math.sin(2*Math.PI*phase);
  if(shape==='triangle')return 1-4*Math.abs(phase-.5);
  if(shape==='saw')return 1-2*phase;
  if(shape==='ramp')return 2*phase-1;
  if(shape==='square')return phase<.5?1:-1;
  if(shape==='pulse')return phase<.25?1:-1;
  if(shape==='steps')return steps[(Math.floor(phase*count)%count)*(16/count)]??0;
  if(shape==='curve')return curveValue(points,phase);
  if(shape==='smooth')return noise(phase*8+seed*8,5);
  const extra=EXTRA_SHAPES[shape as keyof typeof EXTRA_SHAPES];
  if(extra)return Math.max(-1,Math.min(1,extra(phase,seed)));
  const k=Math.floor(phase*8)+seed*8;
  return ((k*2654435761)%1000)/500-1;
}

const E4=Math.exp(4)-1,TRANCE=[1,0,1,1,0,1,1,0,1,0,1,1,0,1,1,0],EUCLID5=[1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0];
const uni=(v:number)=>2*v-1,frac=(x:number)=>x-Math.floor(x);
const shark=(p:number)=>p<.5?1-(1-p/.5)**3:1-(p-.5)/.5;
const ad=(p:number)=>p<.15?p/.15:Math.exp(-5*(p-.15)/.85);
const trap=(p:number)=>p<.2?p/.2:p<.6?1:p<.8?1-(p-.6)/.2:0;
const pump=(p:number)=>1-Math.exp(-6*p);
const beatShape=(p:number)=>Math.min(1,Math.exp(-(((p-.1)/.04)**2))+.7*Math.exp(-(((p-.28)/.04)**2)));
/** Same maths as decksynth/fx.py _EXTRA (the 32 shapes added 15 Nov). */
const EXTRA_SHAPES:Partial<Record<ModShape,(p:number,s:number)=>number>>={
  cosine:p=>Math.cos(2*Math.PI*p), half_sine:p=>uni(Math.sin(Math.PI*p)),
  exp_up:p=>uni((Math.exp(4*p)-1)/E4), log_up:p=>uni(1-(1-p)**3), exp_down:p=>uni((1-p)**3), log_down:p=>uni(1-(Math.exp(4*p)-1)/E4),
  s_curve:p=>uni(p*p*(3-2*p)), shark:p=>uni(shark(p)), double_sine:p=>Math.sin(4*Math.PI*p),
  warm:p=>(Math.sin(2*Math.PI*p)+1-4*Math.abs(p-.5))/2,
  pluck:p=>uni(Math.exp(-6*p)), swell:p=>uni(p*p), ad:p=>uni(ad(p)), trapezoid:p=>uni(trap(p)), ramp_hold:p=>uni(Math.min(1,2*p)),
  pump:p=>uni(pump(p)), pump2:p=>uni(pump(frac(2*p))), bounce:p=>uni(Math.abs(Math.cos(3*Math.PI*p))*(1-p)),
  heartbeat:p=>uni(beatShape(p)), wobble:p=>Math.sin(8*Math.PI*p)*(1-p),
  pulse_narrow:p=>p<.125?1:-1, pulse_wide:p=>p<.75?1:-1,
  gate2:p=>frac(2*p)<.5?1:-1, gate3:p=>frac(3*p)<.5?1:-1, gate4:p=>frac(4*p)<.6?1:-1,
  trance:p=>TRANCE[Math.floor(16*p)%16]&&frac(16*p)<.8?1:-1, euclid5:p=>EUCLID5[Math.floor(16*p)%16]&&frac(16*p)<.5?1:-1,
  offbeat:p=>{const f=frac(4*p);return f>=.5&&f<.9?1:-1;},
  stairs4:p=>uni(Math.min(3,Math.floor(4*p))/3), stairs8:p=>uni(Math.min(7,Math.floor(8*p))/7),
  sh16:(p,s)=>(((Math.floor(16*p)+s*16)*2654435761+12345)%1000)/500-1,
  drift:(p,s)=>noise(p*2+s*2,9),
};

export const MORPH_PATHS:MorphPath[]=['hand','circle','eight','flower','triangle','square','spiral','star','wave','drift'];
export const defaultMorph=():FxMorph=>({x:.5,y:.5,xMacro:0,yMacro:1,mixMacro:-1,path:'hand',rate:0,size:.8,wander:.2,spin:0,mode:'follow'});
const TRI:[number,number][]=[[0,1],[.866,-.5],[-.866,-.5]];
const SQUARE:[number,number][]=[[-.85,.85],[.85,.85],[.85,-.85],[-.85,-.85]];
const STAR:[number,number][]=Array.from({length:10},(_,i)=>{const r=i%2?.42:1,a=Math.PI/2+i*Math.PI/5;return [r*Math.cos(a),r*Math.sin(a)];});
/** Same maths as decksynth/fx.py (_noise, path_point, morph_point, pad_mix). */
function noise(s:number,seed:number){
  const k=Math.floor(s);let f=s-k;f=f*f*(3-2*f);
  const h=(i:number)=>(((i+seed*7919)*2654435761)%1000+1000)%1000/500-1;
  return h(k)+(h(k+1)-h(k))*f;
}
function poly(pts:[number,number][],t:number):[number,number]{
  const n=pts.length,u=(((t%1)+1)%1)*n,i=Math.floor(u),f=u-i,a=pts[i%n],b=pts[(i+1)%n];
  return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
}
export function pathPoint(path:MorphPath,t:number,s=0):[number,number]{
  const a=2*Math.PI*t,tt=((t%1)+1)%1;
  switch(path){
    case 'circle':return [Math.cos(a),Math.sin(a)];
    case 'eight':return [Math.sin(a),.7*Math.sin(2*a)];
    case 'flower':{const r=Math.cos(2*a);return [r*Math.cos(a),r*Math.sin(a)];}
    case 'triangle':return poly(TRI,t);
    case 'square':return poly(SQUARE,t);
    case 'star':return poly(STAR,t);
    case 'spiral':{const r=.12+.88*(1-Math.abs(2*tt-1));return [r*Math.cos(3*a),r*Math.sin(3*a)];}
    case 'wave':return [1-4*Math.abs(tt-.5),.6*Math.sin(2*a)];
    case 'drift':return [noise(s*2,1),noise(s*2,2)];
    default:return [0,0];
  }
}
const unit=(v:number)=>Math.max(0,Math.min(1,v));
export function morphPoint(mo:FxMorph,t:number,s:number,wander=true):[number,number]{
  const [px,py]=pathPoint(mo.path,t,s),rot=mo.spin*2*Math.PI,c=Math.cos(rot),n=Math.sin(rot),r=mo.size*.5,w=wander?mo.wander*.3:0;
  return [unit(mo.x+(px*c-py*n)*r+noise(s*1.7,3)*w),unit(mo.y+(px*n+py*c)*r+noise(s*1.7,4)*w)];
}
export function padMix(x:number,y:number,pads:number[]){
  const v=[0,1,2,3].map(i=>pads[i]??0);
  return (1-x)*y*v[0]+x*y*v[1]+(1-x)*(1-y)*v[2]+x*(1-y)*v[3];
}

const width:FxParamDef={key:'width',label:'Width',min:0,max:1,init:0,suffix:'%'};
const mix:FxParamDef={key:'mix',label:'Mix',min:0,max:1,init:.5};

export const FX_MODULES:Record<FxModuleId,FxModuleDef>={
  stutter:{name:'Stutter',color:'#e06c75',params:[
    {key:'length',label:'Slice',min:1,max:6,init:3,precision:0,options:['1/4','1/8','1/16','1/32','1/64','1/128']},
    {key:'speed',label:'Speed',min:0,max:1,init:.6},
    {key:'repeats',label:'Repeats',min:1,max:8,init:4,precision:0},mix]},
  filter:{name:'Filter',color:'#5fd3a8',params:[
    {key:'mode',label:'Type',min:0,max:2,init:0,precision:0,options:['Low pass','Band pass','High pass']},
    {key:'cutoff',label:'Cutoff',min:0,max:1,init:.7},
    {key:'reso',label:'Reso',min:0,max:1,init:.3},{...mix,init:1}]},
  overdrive:{name:'Overdrive',color:'#e5a65a',params:[
    {key:'drive',label:'Drive',min:0,max:1,init:.4},mix]},
  bitcrusher:{name:'Bitcrusher',color:'#5aa9e6',params:[
    {key:'rate',label:'Rate',min:0,max:1,init:.3},
    {key:'bits',label:'Bit depth',min:2,max:16,init:9,precision:0},mix]},
  volume:{name:'Volume',color:'#a98ee6',params:[
    {key:'level',label:'Level',min:0,max:1.5,init:1},{...mix,init:1}]},
  phaser:{name:'Phaser',color:'#e66fb0',params:[
    {key:'rate',label:'Rate',min:0,max:1,init:.3},{key:'depth',label:'Depth',min:0,max:1,init:.6},
    {key:'feedback',label:'Feedback',min:-1,max:1,init:.2},mix]},
  flanger:{name:'Flanger',color:'#e07a5f',params:[
    {key:'rate',label:'Rate',min:0,max:1,init:.3},{key:'depth',label:'Depth',min:0,max:1,init:.5},
    {key:'feedback',label:'Feedback',min:-1,max:1,init:.4},mix]},
  ringmod:{name:'Ring Mod',color:'#d4b44a',params:[
    {key:'freq',label:'Freq',min:0,max:1,init:.4},{key:'drive',label:'Drive',min:0,max:1,init:.3},mix]},
  delay:{name:'Delay',color:'#6ccf7f',params:[
    {key:'time',label:'Time',min:0,max:5,init:2,precision:0,options:['1/32','1/16','1/8','1/8 dot','1/4','1/2']},{key:'feedback',label:'Feedback',min:0,max:.95,init:.4},mix,width]},
  reverb:{name:'Reverb',color:'#4fc1c9',params:[
    {key:'predelay',label:'Pre-delay',min:0,max:1,init:.1},{key:'decay',label:'Decay',min:0,max:1,init:.6},
    {key:'locut',label:'Lo cut',min:0,max:1,init:.1},{key:'hicut',label:'Hi cut',min:0,max:1,init:.8},mix,width]},
  time:{name:'Time',color:'#8fa3b8',params:[
    {key:'speed',label:'Speed',min:.25,max:2,init:1},{...mix,init:1}]},
  chorus:{name:'Chorus',color:'#7ec8ff',params:[
    {key:'rate',label:'Rate',min:0,max:1,init:.3},{key:'depth',label:'Depth',min:0,max:1,init:.5},
    {key:'voices',label:'Voices',min:1,max:3,init:2,precision:0,options:['1','2','3']},mix,width,{key:'haas',label:'Haas',min:0,max:.03,init:0,suffix:'s',precision:3}]},
  compressor:{name:'Compressor',color:'#f2d16b',params:[
    {key:'amount',label:'Amount',min:0,max:1,init:.4},
    {key:'ratio',label:'Ratio',min:0,max:3,init:1,precision:0,options:['2:1','4:1','8:1','20:1']},
    {key:'attack',label:'Attack',min:0,max:1,init:.2},{key:'release',label:'Release',min:0,max:1,init:.3},
    {key:'makeup',label:'Makeup',min:0,max:1,init:.2},{...mix,init:1}]},
  eq:{name:'EQ',color:'#9be37a',params:[
    {key:'low',label:'Low',min:-1,max:1,init:0},{key:'mid',label:'Mid',min:-1,max:1,init:0},
    {key:'freq',label:'Mid freq',min:0,max:1,init:.5},{key:'high',label:'High',min:-1,max:1,init:0}]},
  autowah:{name:'Auto-wah',color:'#ff9d6b',params:[
    {key:'sens',label:'Sensitivity',min:0,max:1,init:.5},{key:'base',label:'Base',min:0,max:1,init:.3},
    {key:'range',label:'Range',min:0,max:1,init:.6},{key:'reso',label:'Reso',min:0,max:1,init:.6},{...mix,init:.8}]},
  resonator:{name:'Resonator',color:'#c38bff',params:[
    {key:'decay',label:'Ring',min:0,max:1,init:.5},{key:'tone',label:'Tone',min:0,max:1,init:.5},{...mix,init:.4},
    {key:'strings',label:'Strings',min:0,max:2,init:1,precision:0,options:['Notes','+ Octave','+ Fifth']}]},
  cloud:{name:'Cloud',color:'#a1a5f4',params:[{key:'time',label:'Time',min:0,max:1,init:.35},{key:'density',label:'Density',min:0,max:1,init:.7},{key:'scatter',label:'Scatter',min:0,max:1,init:.5},{key:'feedback',label:'Feedback',min:0,max:.88,init:.4},{key:'tone',label:'Tone',min:0,max:1,init:.6},{...mix,init:.4}]},
  pitch:{name:'Pitch shift',color:'#6fd0e6',blurb:'Moves the track up or down in semitones and cents.',params:[
    {key:'semis',label:'Semitones',min:-12,max:12,init:0,precision:0,suffix:' st'},
    {key:'cents',label:'Cents',min:-100,max:100,init:0,precision:0,suffix:' ct',knob:true},{...mix,init:1}]},
  autotune:{name:'Auto-tune',color:'#f28ad8',blurb:'Pulls the notes it hears to the project scale (Perform page).',params:[
    {key:'speed',label:'Speed',min:0,max:1,init:.15},{key:'amount',label:'Amount',min:0,max:1,init:1},{...mix,init:1}]},
  duck:{name:'Ducking',color:'#9fd46a',blurb:'Another track pushes this one down, like a kick ducking the bass.',params:[
    {key:'source',label:'Ducked by',min:0,max:15,init:0,precision:0,editor:'track',modulatable:false},
    {key:'amount',label:'Amount',min:0,max:1,init:.7},{key:'sens',label:'Sensitivity',min:0,max:1,init:.3},
    {key:'attack',label:'Attack',min:0,max:1,init:.05},{key:'release',label:'Release',min:0,max:1,init:.3}]},
  vocoder:{name:'Vocoder',color:'#c9a2ff',blurb:'Another track (a voice, a drum loop) shapes the tone of this one.',params:[
    {key:'source',label:'Voice from',min:0,max:15,init:0,precision:0,editor:'track',modulatable:false},
    {key:'response',label:'Response',min:0,max:1,init:.3},{key:'shift',label:'Formant',min:-1,max:1,init:0},
    {key:'air',label:'Air',min:0,max:1,init:.3},{...mix,init:1}]},
  gate:{name:'Audio gate',color:'#ff7eb6',params:[
    {key:'length',label:'Cells',min:0,max:5,init:2,precision:0,hidden:true},
    {key:'division',label:'Cell size',min:0,max:4,init:2,precision:0,hidden:true},
    {key:'steps',label:'Steps',min:0,max:65535,init:44461,precision:0,editor:'gate'},
    {key:'smooth',label:'Smooth',min:0,max:1,init:.3},{key:'depth',label:'Depth',min:0,max:1,init:1},
    {key:'pump',label:'Pump',min:0,max:1,init:0},
    {key:'retrig',label:'Retrigger',min:0,max:2,init:2,precision:0,options:['Always','No Notes','Never'],modulatable:false},
    {key:'phase',label:'Phase',min:0,max:1,init:0,suffix:'%'},
    {key:'notelen',label:'Note length',min:0,max:1,init:1,suffix:'%'},
    {key:'hold',label:'Hold',min:0,max:1,init:0,precision:0,options:['Run','Hold'],modulatable:false}]},
};
export type GateRuntime={beat:number;position:number;cell:number;active:boolean;values:Record<string,number>};
/** Audio gate cells and cell sizes, same order as decksynth/native/dsfx.c GATE_LEN / GATE_DIV. */
export const GATE_LENGTHS=[4,6,8,9,12,16];
export const GATE_DIVS=['1/4','1/8','1/16','1/8T','1/16T'];
export const GATE_DIV_BEATS=[1,.5,.25,1/3,1/6];
export const gateOpen=(steps:number,k:number)=>((Math.round(steps)>>k)&1)===1;
export const gateToggle=(steps:number,k:number)=>Math.round(steps)^(1<<k);
/** Which cell of the gate the song is in at this beat. */
export const gateCell=(beat:number,length:number,division:number)=>{
  const L=GATE_LENGTHS[Math.round(length)]??8, d=GATE_DIV_BEATS[Math.round(division)]??.25;
  return ((Math.floor(beat/d)%L)+L)%L;
};

/** Sound knobs a macro or mod pad can move. Same ranges as SOUND_PARAMS in decksynth/fx.py. */
export const SOUND_TARGETS:Record<string,{label:string;card:string;min:number;max:number}>={
  pan:{label:'Pan',card:'rack-output',min:-1,max:1},
  filter:{label:'Brightness',card:'sound-tone',min:.02,max:1},curve:{label:'Curve',card:'sound-tone',min:-1,max:1},
  balance:{label:'Balance',card:'sound-tone',min:0,max:1},focus:{label:'Focus',card:'sound-tone',min:0,max:1},
  focus_center:{label:'Focus on',card:'sound-tone',min:1,max:16},
  attack:{label:'Attack',card:'rack-envelope',min:.001,max:3},decay:{label:'Decay',card:'rack-envelope',min:.001,max:3},
  sustain:{label:'Sustain',card:'rack-envelope',min:0,max:1},release:{label:'Release',card:'rack-envelope',min:.01,max:3},
  modulation:{label:'Movement',card:'motion-synth',min:0,max:1},volume:{label:'Volume',card:'rack-output',min:0,max:1},
  vcf_cutoff:{label:'Cutoff',card:'sound-filter',min:0,max:1},vcf_reso:{label:'Resonance',card:'sound-filter',min:0,max:1},
  vcf_morph:{label:'Filter morph',card:'sound-filter',min:0,max:1},
  fenv_a:{label:'Filter attack',card:'sound-filter',min:.001,max:3},fenv_d:{label:'Filter decay',card:'sound-filter',min:.001,max:3},
  fenv_s:{label:'Filter sustain',card:'sound-filter',min:0,max:1},fenv_r:{label:'Filter release',card:'sound-filter',min:.01,max:3},
  vcf_env:{label:'Env amount',card:'sound-filter',min:-1,max:1},uni_detune:{label:'Detune',card:'sound-unison',min:0,max:1},
  formant:{label:'Formant',card:'sound-character',min:0,max:1},vowel:{label:'Vowel',card:'sound-character',min:0,max:4},
  inharm:{label:'Stretch',card:'sound-character',min:0,max:1},sub:{label:'Sub',card:'sound-character',min:0,max:1},
  pitch:{label:'Pitch',card:'sound-tone',min:-12,max:12},velocity_brightness:{label:'Velocity brightness',card:'sound-tone',min:-1,max:1},
  glide:{label:'Glide',card:'rack-output',min:0,max:2},vcf_keytrack:{label:'Key track',card:'sound-filter',min:0,max:1},
  velocity_cutoff:{label:'Velocity cutoff',card:'sound-filter',min:-1,max:1},
  character:{label:'Character',card:'sound-character',min:-1,max:1},
};
export const SOUND_COLOR='#ddbd82';
/** Name, knob label and colour of a link target, for lists and badges. */
export function targetInfo(t:{module:FxTarget['module'];param:string}){
  if(t.module==='sound')return {name:'Sound',label:SOUND_TARGETS[t.param]?.label??t.param,color:SOUND_COLOR};
  if(t.module==='sampler')return {name:'Sampler',label:({gain:'Gain',tune:'Tune',fine:'Fine',cutoff:'Cutoff',resonance:'Resonance',f_env:'Filter env',p_env:'Pitch env'} as Record<string,string>)[t.param]??t.param,color:SOUND_COLOR};
  if(t.module==='drum'){const [pad,key]=t.param.split(':');return {name:'Pad '+(Number(pad)+1),label:({gain:'Gain',tune:'Tune',pan:'Pan'} as Record<string,string>)[key]??key,color:'#ff76a6'};}
  const def=FX_MODULES[t.module];
  return {name:def.name,label:def.params.find(p=>p.key===t.param)?.label??t.param,color:def.color};
}

export const FX_ORDER:FxModuleId[]=['stutter','filter','overdrive','bitcrusher','volume','phaser',
  'flanger','ringmod','delay','reverb','time','chorus','compressor','eq','autowah','resonator','gate','cloud',
  'pitch','autotune','duck','vocoder'];
export const defaultModule=(id:FxModuleId):FxModuleState=>({id,on:false,params:Object.fromEntries(FX_MODULES[id].params.map(p=>[p.key,p.init]))});
/** Switch an effect on at the end of the chain. */
export function addModule(chain:FxChain,id:FxModuleId):FxChain{
  const active=chain.modules.filter(m=>m.on),inactive=chain.modules.filter(m=>!m.on);
  const m=chain.modules.find(x=>x.id===id)??defaultModule(id);
  return {...chain,modules:[...active,{...m,on:true},...inactive.filter(x=>x.id!==id)]};
}

export function defaultFxChain():FxChain {
  return {
    modules:FX_ORDER.map(defaultModule),
    macros:Array.from({length:8},(_,i)=>({name:'Macro '+(i+1),value:0,targets:[]})),
    mods:Array.from({length:8},(_,i)=>({shape:PRESET_SHAPES[i],rate:2+i%4,steps:Array(16).fill(0),targets:[],feel:'' as ModFeel,count:16 as const,points:DEFAULT_POINTS.map(p=>[...p] as [number,number])})),
    morph:defaultMorph(),
  };
}

/** Fill in parts an older saved chain lacks. */
export function normalizeChain(chain:Partial<FxChain>|undefined):FxChain{
  const base=defaultFxChain();
  if(!chain?.modules)return base;
  // Chains saved before new effects existed get them, switched off, at the end (same as decksynth/fx.py).
  const have=new Set(chain.modules.map(m=>m.id));
  const modules=[...chain.modules,...FX_ORDER.filter(id=>!have.has(id)).map(defaultModule)];
  const mods=(chain.mods??base.mods).map((m,i)=>({...base.mods[i],...m}));
  return {modules,macros:chain.macros??base.macros,mods,morph:{...base.morph,...chain.morph}};
}
