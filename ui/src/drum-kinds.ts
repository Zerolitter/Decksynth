/** Presentation only; families never change MIDI mapping or audio routing. */
export type DrumKind='kick'|'snare'|'clap'|'rim'|'hat'|'tom'|'cymbal'|'perc'|'fx'|'other';
export const DRUM_KINDS:Record<DrumKind,{label:string;color:string}>={
  kick:{label:'Kick',color:'#ff76a6'},snare:{label:'Snare',color:'#ffc16b'},
  clap:{label:'Clap',color:'#a6a1ff'},rim:{label:'Rim',color:'#c3a2ff'},
  hat:{label:'Hat',color:'#65dece'},tom:{label:'Tom',color:'#ef95dc'},
  cymbal:{label:'Cymbal',color:'#91d68b'},perc:{label:'Perc',color:'#ff9286'},
  fx:{label:'FX',color:'#e5d87d'},other:{label:'Sample',color:'#c1cbd2'},
};
const RULES:[DrumKind,RegExp][]=[
  ['kick',/\b(kicks?|kik|kck|bd|bassdrum|bass drum)\b/],
  ['hat',/\b(hats?|hi hats?|hihat|closedhat|openhat|hh|chh|ohh|ch|oh)\b/],
  ['rim',/\b(rim|rimshot|side ?stick|rs)\b/],
  ['clap',/\b(claps?|clp|cp|snaps?)\b/],
  ['snare',/\b(snares?|snr|sd|sn)\b/],
  ['tom',/\b(toms?|lt|mt|ht)\b/],
  ['perc',/\b(perc|percussion|conga|bongo|shaker|shk|tamb|tambourine|cowbell|cow bell|clave|woodblock|block|guiro|cabasa|timbale|triangle)\b/],
  ['cymbal',/\b(cym|cymbals?|ride|crash|china|splash)\b/],
  ['fx',/\b(fx|sfx|riser|sweep|impact|noise|zap|stab|vox|vocal|chop)\b/],
];
function classify(text:string):DrumKind {
  const words=text.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/([a-zA-Z])(\d)/g,'$1 $2').toLowerCase().replace(/[^a-z0-9]+/g,' ');
  return RULES.find(([,rule])=>rule.test(words))?.[0]??'other';
}
export function drumKind(name?:string|null,path?:string|null):DrumKind {
  const file=(path??'').split(/[\\/]/).pop()?.replace(/\.[a-z0-9]+$/i,'')??'';
  const fromFile=classify(file);
  return fromFile!=='other'?fromFile:classify(name??'');
}
/** Remove a complete repeated kit phrase, never individual drum/category words. */
export function padLabel(name:string,kit?:string|null):string {
  const phrase=kit?.split(/[\\/]/).pop()?.trim();
  if(!phrase)return name;
  const escaped=phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').split(/\s+/).join('[\\s_-]+');
  const short=name.replace(new RegExp('(?<![a-z0-9])'+escaped+'(?![a-z0-9])','ig'),' ').replace(/\s+/g,' ').trim();
  return short||name;
}
