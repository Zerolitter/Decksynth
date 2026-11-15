// Pure maths behind the pad sound graphs. Mirrors decksynth/drum_shape.py so the picture is what you hear.
import type {DrumShape} from './types';

const RELEASE=.005;

/** Gain (0..1) of the pad at playback time t seconds, and how long the pad plays. */
export function padLength(shape:DrumShape,seconds:number,step:number){
  const span=Math.max(1e-6,(shape.end-shape.start)*seconds)/step;  // playback seconds of the trimmed region
  if(shape.decay>0)return Math.min(span,shape.attack+shape.hold+shape.decay);
  if(shape.hold>0)return Math.min(span,shape.attack+shape.hold+RELEASE);
  return span;
}
export function padGain(shape:DrumShape,t:number,length:number){
  let g=1;
  if(t<shape.attack)g*=t/Math.max(1e-6,shape.attack);
  else if(shape.decay>0&&t>=shape.attack+shape.hold)g*=Math.exp(-6.907755*(t-shape.attack-shape.hold)/shape.decay);
  if(shape.fade_in>0&&t<shape.fade_in)g*=t/shape.fade_in;
  if(shape.fade_out>0&&length-t<shape.fade_out)g*=Math.max(0,length-t)/shape.fade_out;
  if(shape.decay<=0&&shape.hold>0&&length-t<RELEASE)g*=Math.max(0,length-t)/RELEASE;
  return Math.max(0,Math.min(1,g));
}

/** SVG path of the pad's level over the source, in a 512×96 box (x across the whole sample). */
export function envelopePath(shape:DrumShape,seconds:number,step=1){
  const x0=shape.start*512,x1=shape.end*512,span=Math.max(1e-6,(shape.end-shape.start)*seconds)/step;
  const length=padLength(shape,seconds,step),pts:[number,number][]=[];
  for(let i=0;i<=96;i++){
    const t=length*i/96,level=padGain(shape,t,length);
    const x=shape.reverse?x1-(t/span)*(x1-x0):x0+(t/span)*(x1-x0);
    pts.push([x,92-level*84]);
  }
  return 'M'+pts.map(([x,y])=>x.toFixed(1)+' '+y.toFixed(1)).join('L');
}

type Coef=[number,number,number,number,number];
/** RBJ cookbook, as native/drum_mix.c. kind: 0 low-pass, 1 high-pass, 2 peak, 3 low shelf, 4 high shelf. */
export function biquad(kind:number,freq:number,rate:number,q:number,db:number):Coef{
  const f=Math.min(freq,rate*.45),w=2*Math.PI*f/rate,cw=Math.cos(w),sw=Math.sin(w),A=10**(db/40),alpha=sw/(2*q);
  let b0,b1,b2,a0,a1,a2;
  if(kind===0){b0=b2=(1-cw)/2;b1=1-cw;a0=1+alpha;a1=-2*cw;a2=1-alpha;}
  else if(kind===1){b0=b2=(1+cw)/2;b1=-(1+cw);a0=1+alpha;a1=-2*cw;a2=1-alpha;}
  else if(kind===2){b0=1+alpha*A;b1=-2*cw;b2=1-alpha*A;a0=1+alpha/A;a1=-2*cw;a2=1-alpha/A;}
  else{const s=2*Math.sqrt(A)*(sw/(2*.7071)),sign=kind===3?-1:1;
    b0=A*((A+1)+sign*(A-1)*cw+s);b1=-2*sign*A*((A-1)+sign*(A+1)*cw);b2=A*((A+1)+sign*(A-1)*cw-s);
    a0=(A+1)-sign*(A-1)*cw+s;a1=2*sign*((A-1)-sign*(A+1)*cw);a2=(A+1)-sign*(A-1)*cw-s;}
  return [b0/a0,b1/a0,b2/a0,a1/a0,a2/a0];
}
function magnitudeDb([b0,b1,b2,a1,a2]:Coef,freq:number,rate:number){
  const w=2*Math.PI*freq/rate,c1=Math.cos(w),s1=Math.sin(w),c2=Math.cos(2*w),s2=Math.sin(2*w);
  const nr=b0+b1*c1+b2*c2,ni=-(b1*s1+b2*s2),dr=1+a1*c1+a2*c2,di=-(a1*s1+a2*s2);
  return 10*Math.log10(Math.max(1e-30,(nr*nr+ni*ni)/(dr*dr+di*di)));
}
/** The pad's EQ + cut filter response in dB at freq (Hz, as heard). */
export function responseDb(shape:DrumShape,freq:number,rate=48000){
  const filters:Coef[]=[];
  if(shape.low_cut>20.5)filters.push(biquad(1,shape.low_cut,rate,.7071,0));
  if(shape.high_cut<19999.5)filters.push(biquad(0,shape.high_cut,rate,.7071,0));
  if(shape.eq_low)filters.push(biquad(3,200,rate,.7071,shape.eq_low));
  if(shape.eq_mid)filters.push(biquad(2,shape.eq_freq,rate,1,shape.eq_mid));
  if(shape.eq_high)filters.push(biquad(4,5000,rate,.7071,shape.eq_high));
  return filters.reduce((db,c)=>db+magnitudeDb(c,freq,rate),0);
}
/** Response curve in a w×h box: 20 Hz–20 kHz log across, ±24 dB up/down. */
export function responsePath(shape:DrumShape,w:number,h:number){
  const pts:string[]=[];
  for(let i=0;i<=80;i++){
    const f=20*1000**(i/80),db=Math.max(-24,Math.min(24,responseDb(shape,f)));
    pts.push((i/80*w).toFixed(1)+' '+(h/2-db/24*(h/2-2)).toFixed(1));
  }
  return 'M'+pts.join('L');
}
/** Compressor static curve, input -48..0 dB across, output -48..+24 up. */
export function compressorPath(shape:DrumShape,w:number,h:number){
  const pts:string[]=[];
  for(let i=0;i<=48;i++){
    const x=-48+i,thr=shape.comp_threshold,ratio=Math.max(1,shape.comp_ratio);
    const y=(x>thr?thr+(x-thr)/ratio:x)+shape.comp_makeup;
    pts.push((i/48*w).toFixed(1)+' '+(h-(Math.min(24,y)+48)/72*h).toFixed(1));
  }
  return 'M'+pts.join('L');
}
