/** Base partials only. Mirrors decksynth/spectral.py; native playback remains the authority. */
export const SHAPES=['SAW','SQUARE','TRIANGLE','PULSE','GAUSSIAN','SPREAD','RANDOM'] as const;
export type Shape=typeof SHAPES[number];
const UINT32=0xffffffff;
function checkedSeed(seed:number){if(!Number.isInteger(seed)||seed<0||seed>UINT32)throw new Error('Invalid spectral seed');return seed;}
export function nextSeed(seed:number):number{return (checkedSeed(seed)+0x9e3779b9)>>>0;}
export function harmonicShape(name:Shape,seed=0):number[]{
 if(!SHAPES.includes(name))throw new Error('Unknown spectral shape');
 let state=checkedSeed(seed);
 return Array.from({length:16},(_,i)=>{
  const k=i+1;let v:number;
  if(name==='SAW')v=1/k;
  else if(name==='SQUARE')v=k%2?1/k:0;
  else if(name==='TRIANGLE')v=k%2?1/(k*k):0;
  else if(name==='PULSE')v=.7/k*(1+Math.cos((k-1)*Math.PI/3));
  else if(name==='GAUSSIAN')v=Math.exp(-Math.pow((i-5)/3,2));
  else if(name==='SPREAD')v=[.85,.28,.09][i%3];
  else{state=(Math.imul(1664525,state)+1013904223)>>>0;v=state/UINT32;}
  return Math.min(1,Math.max(0,Math.round(v*1e5)/1e5));
 });
}
