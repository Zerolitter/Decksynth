/* Chord builder theory: the chords of a key and scale, their names, and their voicing.
   Pure functions, so the UI and the tests share one source of truth. */

export const SCALES:Record<string,number[]>={'Chromatic':[0,1,2,3,4,5,6,7,8,9,10,11],'Major':[0,2,4,5,7,9,11],'Minor':[0,2,3,5,7,8,10],
  'Dorian':[0,2,3,5,7,9,10],'Mixolydian':[0,2,4,5,7,9,10],'Major Pentatonic':[0,2,4,7,9],'Minor Pentatonic':[0,3,5,7,10],
  'Blues':[0,3,5,6,7,10],'Harmonic Minor':[0,2,3,5,7,8,11],'Phrygian':[0,1,3,5,7,8,10],'Lydian':[0,2,4,6,7,9,11],
  'Locrian':[0,1,3,5,6,8,10],'Japanese':[0,1,5,7,8],'Gypsy':[0,2,3,6,7,8,11],'Arabic':[0,1,4,5,7,8,11],'Freygish':[0,1,4,5,7,8,10]};
export const ROOTS=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];

export type ChordExt='triad'|'7'|'9'|'11'|'sus2'|'sus4'|'5'|'oct';
export const CHORD_EXTS:[ChordExt,string][]=[['triad','Triad'],['7','7th'],['9','9th'],['11','11th'],
  ['sus2','Sus2'],['sus4','Sus4'],['5','5th'],['oct','Oct']];

export type PadChord={degree:number;roman:string;name:string;root:number;notes:number[]};
export type Voicing={octave?:number;inversion?:number;voices?:number;bass?:number};

const ROMAN=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
const QUALITY:Record<string,string>={
  '0,4,7':'','0,3,7':'m','0,3,6':'°','0,4,8':'+','0,2,7':'sus2','0,5,7':'sus4','0,7':'5','0,12':' oct',
  '0,4,7,11':'maj7','0,3,7,10':'m7','0,4,7,10':'7','0,3,6,10':'m7♭5','0,3,6,9':'°7','0,3,7,11':'m(maj7)','0,4,8,11':'+maj7',
  '0,4,7,11,14':'maj9','0,3,7,10,14':'m9','0,4,7,10,14':'9','0,4,7,10,13':'7♭9','0,3,7,10,13':'m7♭9','0,3,6,10,13':'m7♭5♭9',
  '0,3,6,10,14':'m9♭5','0,3,7,11,14':'m(maj9)','0,4,8,11,14':'+maj9','0,4,7,11,13':'maj7♭9',
  '0,4,7,11,14,17':'maj11','0,3,7,10,14,17':'m11','0,4,7,10,14,17':'11','0,4,7,11,14,18':'maj9♯11','0,3,6,10,13,17':'m11♭5♭9',
  '0,3,7,10,13,17':'m11♭9','0,4,7,10,13,17':'11♭9','0,3,6,10,14,17':'m11♭5',
};

/** Pitch-class note name without octave. */
export const pc=(n:number)=>ROOTS[((n%12)+12)%12];

/** Chord name from its root and the semitones above it, e.g. 57 + [0,3,7] = "Am". */
export function chordName(root:number,intervals:number[]):string{
  const key=[...new Set(intervals)].sort((a,b)=>a-b).join(',');
  const q=QUALITY[key];
  return pc(root)+(q??'('+intervals.slice(1).join(' ')+')');
}

/** The notes of one stacked chord on a scale degree, before voicing. */
function stack(scale:number[],base:number,degree:number,ext:ChordExt):number[]{
  const len=scale.length;
  const at=(k:number)=>base+scale[k%len]+12*Math.floor(k/len);
  const d=degree;
  if(ext==='oct')return [at(d),at(d)+12];
  if(ext==='5')return len>=7?[at(d),at(d+4)]:[at(d),at(d)+7];
  if(ext==='sus2')return len>=7?[at(d),at(d+1),at(d+4)]:[at(d),at(d)+2,at(d)+7];
  if(ext==='sus4')return len>=7?[at(d),at(d+3),at(d+4)]:[at(d),at(d)+5,at(d)+7];
  const count=ext==='triad'?3:ext==='7'?4:ext==='9'?5:6;
  return Array.from({length:count},(_,i)=>at(d+2*i));
}

/** Inversion, voice count and bass note, in the same order the engine uses for chord mode. */
export function voice(notes:number[],root:number,{inversion=0,voices=0,bass=0}:Voicing):number[]{
  let out=[...notes].sort((a,b)=>a-b);
  if(voices>0)out=out.slice(0,Math.max(1,voices));
  for(let i=0;i<Math.abs(inversion)&&out.length>1;i++){
    if(inversion>0){const low=out.shift()!;out.push(low+12);}
    else{const high=out.pop()!;out.unshift(high-12);}
  }
  if(bass>0)out.unshift(root-12*bass);
  return [...new Set(out.map(n=>Math.max(0,Math.min(127,n))))].sort((a,b)=>a-b);
}

/** The inversion of `notes` that sits closest to `previous`, so the voices move as little as possible. */
export function leadVoices(notes:number[],previous:number[]|null):number[]{
  if(!previous||!previous.length||notes.length<2)return notes;
  const mean=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
  const target=mean(previous);
  let best=notes,score=Infinity;
  for(let inv=-3;inv<=3;inv++){
    const v=voice(notes,notes[0],{inversion:inv});
    const s=Math.abs(mean(v)-target);
    if(s<score-1e-9){score=s;best=v;}
  }
  return best;
}

/** The chord pads for a key and scale: one per scale degree. Chromatic shows the major key of the root. */
export function diatonicChords(root:number,scaleName:string,ext:ChordExt,v:Voicing={}):PadChord[]{
  const scale=scaleName==='Chromatic'||!SCALES[scaleName]?SCALES.Major:SCALES[scaleName];
  const base=48+root+12*(v.octave??0);
  return scale.map((_,degree)=>{
    const raw=stack(scale,base,degree,ext);
    const r=raw[0];
    const intervals=raw.map(n=>n-r);
    const third=intervals.find(i=>i===3||i===4);
    const fifth=intervals.includes(6)?'°':intervals.includes(8)&&third===4?'+':'';
    let roman=ROMAN[degree]??String(degree+1);
    if(third===3)roman=roman.toLowerCase();
    if(ext==='triad'||ext==='7'||ext==='9'||ext==='11')roman+=fifth;
    return {degree,roman,name:chordName(r,intervals),root:r,notes:voice(raw,r,v)};
  });
}

/** Note names of a chord, low to high, e.g. "A C E". */
export const chordText=(notes:number[])=>notes.map(pc).join(' ');
