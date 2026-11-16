import type {Note} from './types';
export const bound=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
export function performanceRange(device:string,requested?:number){
 const drum=device==='drum_rack',base=bound(Math.round((requested??(drum?36:60))/12)*12,0,108);
 return {base,top:base+(drum?15:12),rows:drum?16:13,keyboardBase:drum?base:Math.max(0,base-12),keyCount:drum?16:37};
}
export function zoomAt(scroll:number,pointer:number,before:number,after:number,origin:number){return Math.max(0,origin+(scroll+pointer-origin)/before*after-pointer);}
export function fitNotesView(notes:Note[],span:number,snap:number,width:number,height:number){
 const first=notes.length?Math.min(...notes.map(n=>n.start)):0,last=notes.length?Math.max(...notes.map(n=>n.start+n.duration)):Math.min(span,16*snap),low=notes.length?Math.min(...notes.map(n=>n.note)):48,high=notes.length?Math.max(...notes.map(n=>n.note)):55;
 const timePx=bound((width-44)/((last-first+4*snap)/snap),12,192),rowHeight=bound((height-24)/(high-low+5),12,88);
 return {timePx,rowHeight,left:Math.max(0,(first-2*snap)/snap*timePx),top:Math.max(0,(127-high-2)*rowHeight)};
}
