import type { Instrument } from './types';

/** Same maths as decksynth/core.py spectral_gain: the saved partials are never rewritten. */
export function spectralGain(p:Instrument,k:number):number{
  const c=p.curve??0,b=p.balance??.5,f=p.focus??0,m=p.focus_center??4;
  let g=c?Math.pow(k,c*1.5):1;
  if(b!==.5)g*=Math.max(0,1+(b-.5)*2*(2*(k-1)/15-1));
  if(f)g*=(1-f)+f*Math.exp(-Math.pow((k-m)/2.2,2));
  const character=p.character??0;
  if(character)g*=(character>0&&k%2===0)||(character<0&&k%2===1)?1-Math.abs(character):1;
  return g;
}

/** J_n(x) by its power series, as decksynth/core.py bessel_j. */
function besselJ(n:number,x:number):number{
  let fact=1;for(let i=2;i<=n;i++)fact*=i;
  let term=Math.pow(x/2,n)/fact,total=term;
  for(let k=1;k<30;k++){term*=-(x/2)*(x/2)/(k*(k+n));total+=term;}
  return total;
}

/** The Oscillator's partials (saw, pulse, FM) scaled so the loudest is 1, as decksynth/core.py wave_partials; null for drawn partials. */
export function wavePartials(p:Instrument,count:number):number[]|null{
  const wave=Math.round(p.wave??0);
  if(!wave)return null;
  let w:number[];
  if(wave===1)w=Array.from({length:count},(_,k)=>1/(k+1));
  else if(wave===2){const d=Math.min(.5,Math.max(.02,p.pulse_width??.5));w=Array.from({length:count},(_,k)=>Math.abs(Math.sin(Math.PI*(k+1)*d))/(k+1));}
  else{
    const r=Math.round(p.fm_ratio??2),index=Math.min(1,Math.max(0,p.fm_index??.3))*6;w=Array(count).fill(0);
    for(let n=-16;n<=16;n++){const f=1+n*r;if(f===0||Math.abs(f)>count)continue;
      const j=besselJ(Math.abs(n),index)*(n<0&&Math.abs(n)%2?-1:1);w[Math.abs(f)-1]+=f>0?j:-j;}
    w=w.map(Math.abs);
  }
  const top=Math.max(...w)||1;
  return w.map(v=>v/top);
}

/** What the engine plays for each partial (spectral macros plus the Brightness roll-off),
 *  scaled so the loudest partial is 1. */
export function evaluatedPartials(saved:Instrument,effective:Partial<Instrument>={}):number[]{
  const p={...saved,...effective};
  const generated=wavePartials(p,16);
  const corner=1+p.filter*15+(generated?(p.air??0)*48:0);
  const w=(generated??p.harmonics).map((h,i)=>h*spectralGain(p,i+1)/(1+Math.pow(i/corner,4)));
  const top=Math.max(1e-9,...w);
  return w.map(v=>v/top);
}
