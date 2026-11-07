import type { Instrument } from './types';

/** Same maths as decksynth/core.py spectral_gain: the saved partials are never rewritten. */
export function spectralGain(p:Instrument,k:number):number{
  const c=p.curve??0,b=p.balance??.5,f=p.focus??0,m=p.focus_center??4;
  let g=c?Math.pow(k,c*1.5):1;
  if(b!==.5)g*=Math.max(0,1+(b-.5)*2*(2*(k-1)/15-1));
  if(f)g*=(1-f)+f*Math.exp(-Math.pow((k-m)/2.2,2));
  return g;
}

/** What the engine plays for each partial (spectral macros plus the Brightness roll-off),
 *  scaled so the loudest partial is 1. */
export function evaluatedPartials(p:Instrument):number[]{
  const w=p.harmonics.map((h,i)=>h*spectralGain(p,i+1)/(1+Math.pow(i/(1+p.filter*15),4)));
  const top=Math.max(1e-9,...w);
  return w.map(v=>v/top);
}
