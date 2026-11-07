// FX chain model shared by the UI and (from step 3) the Python engine.
// Module set follows the user's PrismFX reference recordings; all DSP is DeckSynth's own.

export type FxModuleId = 'stutter'|'filter'|'overdrive'|'bitcrusher'|'volume'|'phaser'
  |'flanger'|'ringmod'|'delay'|'reverb'|'time'|'chorus'|'compressor'|'eq'|'autowah'|'resonator'|'gate';

export type FxParamDef = { key:string; label:string; min:number; max:number; init:number; suffix?:string; precision?:number;
  /** labels for each whole value from min to max: shown as tap buttons instead of a knob */ options?:string[];
  /** set in the effect's own sheet, not on the card, and not a link target */ hidden?:boolean;
  /** drawn by a custom editor on the card (the gate's step strip) */ editor?:'gate' };
export type FxModuleDef = { name:string; color:string; params:FxParamDef[]; blurb?:string };
export type FxModuleState = { id:FxModuleId; on:boolean; params:Record<string,number>; /** kept in the rack but not heard */ bypass?:boolean };
/** 'sound' targets are the Sound page knobs of the same track. */
export type FxTarget = { module:FxModuleId|'sound'; param:string; depth:number };
export type FxMacro = { name:string; value:number; targets:FxTarget[] };
export type ModShape = 'sine'|'triangle'|'saw'|'ramp'|'square'|'pulse'|'random'|'smooth'|'steps'|'curve';
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

export const MOD_SHAPES:ModShape[]=['sine','triangle','saw','ramp','square','pulse','random','smooth','steps','curve'];
export const MOD_RATES=['4 bars','2 bars','1 bar','1/2','1/4','1/8','1/16'];
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
  const k=Math.floor(phase*8)+seed*8;
  return ((k*2654435761)%1000)/500-1;
}

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
    {key:'time',label:'Time',min:0,max:5,init:2,precision:0,options:['1/32','1/16','1/8','1/8 dot','1/4','1/2']},{key:'feedback',label:'Feedback',min:0,max:.95,init:.4},mix]},
  reverb:{name:'Reverb',color:'#4fc1c9',params:[
    {key:'predelay',label:'Pre-delay',min:0,max:1,init:.1},{key:'decay',label:'Decay',min:0,max:1,init:.6},
    {key:'locut',label:'Lo cut',min:0,max:1,init:.1},{key:'hicut',label:'Hi cut',min:0,max:1,init:.8},mix]},
  time:{name:'Time',color:'#8fa3b8',params:[
    {key:'speed',label:'Speed',min:.25,max:2,init:1},{...mix,init:1}]},
  chorus:{name:'Chorus',color:'#7ec8ff',params:[
    {key:'rate',label:'Rate',min:0,max:1,init:.3},{key:'depth',label:'Depth',min:0,max:1,init:.5},
    {key:'voices',label:'Voices',min:1,max:3,init:2,precision:0,options:['1','2','3']},mix]},
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
  gate:{name:'Audio gate',color:'#ff7eb6',params:[
    {key:'length',label:'Cells',min:0,max:5,init:2,precision:0,hidden:true},
    {key:'division',label:'Cell size',min:0,max:4,init:2,precision:0,hidden:true},
    {key:'steps',label:'Steps',min:0,max:65535,init:44461,precision:0,editor:'gate'},
    {key:'smooth',label:'Smooth',min:0,max:1,init:.3},{key:'depth',label:'Depth',min:0,max:1,init:1},
    {key:'pump',label:'Pump',min:0,max:1,init:0}]},
};
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
  filter:{label:'Brightness',card:'sound-tone',min:.02,max:1},curve:{label:'Curve',card:'sound-tone',min:-1,max:1},
  balance:{label:'Balance',card:'sound-tone',min:0,max:1},focus:{label:'Focus',card:'sound-tone',min:0,max:1},
  focus_center:{label:'Focus on',card:'sound-tone',min:1,max:16},
  attack:{label:'Attack',card:'rack-envelope',min:.001,max:3},decay:{label:'Decay',card:'rack-envelope',min:.001,max:3},
  sustain:{label:'Sustain',card:'rack-envelope',min:0,max:1},release:{label:'Release',card:'rack-envelope',min:.01,max:3},
  modulation:{label:'Movement',card:'motion-synth',min:0,max:1},volume:{label:'Volume',card:'rack-output',min:0,max:1},
  vcf_cutoff:{label:'Cutoff',card:'sound-filter',min:0,max:1},vcf_reso:{label:'Resonance',card:'sound-filter',min:0,max:1},
  vcf_env:{label:'Env amount',card:'sound-filter',min:-1,max:1},uni_detune:{label:'Detune',card:'sound-unison',min:0,max:1},
  formant:{label:'Formant',card:'sound-character',min:0,max:1},vowel:{label:'Vowel',card:'sound-character',min:0,max:4},
  inharm:{label:'Stretch',card:'sound-character',min:0,max:1},sub:{label:'Sub',card:'sound-character',min:0,max:1},
  character:{label:'Character',card:'sound-character',min:-1,max:1},
};
export const SOUND_COLOR='#7fd6bb';
/** Name, knob label and colour of a link target, for lists and badges. */
export function targetInfo(t:{module:FxTarget['module'];param:string}){
  if(t.module==='sound')return {name:'Sound',label:SOUND_TARGETS[t.param]?.label??t.param,color:SOUND_COLOR};
  const def=FX_MODULES[t.module];
  return {name:def.name,label:def.params.find(p=>p.key===t.param)?.label??t.param,color:def.color};
}

export const FX_ORDER:FxModuleId[]=['stutter','filter','overdrive','bitcrusher','volume','phaser',
  'flanger','ringmod','delay','reverb','time','chorus','compressor','eq','autowah','resonator','gate'];
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
