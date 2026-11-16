import {useContextTarget,type ContextBinding} from './ContextWheel';
import {editNotes,harmonyNotes,noteIndexAt,type NoteBounds,type NoteTarget} from '../note-ops';
import type {Note,StepPattern} from '../types';
import {noteClipboardAvailable,type useNoteEditing} from './useNoteEditing';
export function useNoteContext({edit,target,bounds,recording,generate,open}:{edit:ReturnType<typeof useNoteEditing>;target:NoteTarget;expected:Note[]|StepPattern;bounds:NoteBounds;recording:boolean;generate?:(kind:'fill'|'chord',time:number,pitch:number,subdivision?:number)=>void;open?:()=>void}){
 return useContextTarget((el,x)=>{const cell=el.closest<HTMLElement>('[data-note-time][data-note-pitch]');if(!cell||recording)return null;
  const time=Number(cell.dataset.noteTime),pitch=Number(cell.dataset.notePitch);if(time>=bounds.span)return null;
  const expected=edit.expectedState(),r=cell.getBoundingClientRect(),at=time+Math.max(0,Math.min(.999,(x-r.left)/r.width))*bounds.snap,events=edit.events.map(n=>({...n})),hit=noteIndexAt(events,at,pitch),selection=hit>=0?(edit.selection.includes(hit)?[...edit.selection]:[hit]):[];
  const commit=(after:Note[],ids=selection)=>edit.commit(after,ids,expected,target),picked=new Set(selection);
  const apply=(action:Parameters<typeof editNotes>[2])=>{const next=editNotes(events,selection,action,bounds);commit(next.events,next.selection);};
  const velocity=(delta:number)=>commit(events.map((n,i)=>picked.has(i)?{...n,velocity:Math.max(1,Math.min(127,n.velocity+delta))}:n));
  const length=(factor:number)=>commit(events.map((n,i)=>picked.has(i)?{...n,duration:Math.max(target.kind==='pattern'?1:.000001,Math.min(bounds.maxDuration,target.kind==='pattern'?Math.round(n.duration*factor):n.duration*factor))}:n));
  const harmony=(mode:'invert'|'spread'|'major'|'minor')=>{const next=harmonyNotes(events,selection,mode,bounds);if(next)commit(next.events,next.selection);};
  const caps:ContextBinding['caps']={open,...(events.length?{selectAll:edit.selectAll}:{}),...(edit.selection.length?{samePitch:()=>edit.selectRow()}:{}),...(noteClipboardAvailable()?{paste:()=>edit.paste(time,expected,target,events)}:{})};
  if(generate)Object.assign(caps,{fillQuarter:()=>generate('fill',time,pitch,1),fillEighth:()=>generate('fill',time,pitch,.5),fillSixteenth:()=>generate('fill',time,pitch,.25),buildChord:()=>generate('chord',time,pitch)});
  if(hit<0){}
  else Object.assign(caps,{
   pitchUp:()=>apply({kind:'move',time:0,pitch:1}),pitchDown:()=>apply({kind:'move',time:0,pitch:-1}),octaveUp:()=>apply({kind:'move',time:0,pitch:12}),octaveDown:()=>apply({kind:'move',time:0,pitch:-12}),
   earlier:()=>apply({kind:'move',time:-bounds.snap,pitch:0}),later:()=>apply({kind:'move',time:bounds.snap,pitch:0}),longer:()=>apply({kind:'length',delta:bounds.snap}),shorter:()=>apply({kind:'length',delta:-bounds.snap}),halfLength:()=>length(.5),doubleLength:()=>length(2),repeat:()=>apply({kind:'duplicate'}),quantize:()=>apply({kind:'quantize'}),
   velocity:()=>apply({kind:'velocity',value:127}),velocitySoft:()=>apply({kind:'velocity',value:64}),velocityUp:()=>velocity(10),velocityDown:()=>velocity(-10),duplicate:()=>apply({kind:'duplicate'}),delete:()=>apply({kind:'delete'}),copy:()=>edit.copy(selection,events),cut:()=>{edit.copy(selection,events);apply({kind:'delete'});},selectAll:edit.selectAll,samePitch:()=>edit.selectRow(pitch),chordSelection:()=>edit.setSelection(events.flatMap((n,i)=>n.start===events[hit].start?[i]:[]))
  });
  if(selection.length>=2&&selection.every(i=>events[i].start===events[selection[0]].start)){for(const mode of ['invert','spread','major','minor'] as const)if(harmonyNotes(events,selection,mode,bounds))caps[mode]=()=>harmony(mode);}
  return {area:target.kind==='pattern'?'perform':'song',kind:hit<0?'seq.empty':target.kind==='pattern'?'seq.note':'song.note',label:(target.kind==='pattern'?'Step '+(time+1):'Beat '+time)+' · MIDI '+pitch,caps,cancel:()=>{edit.cancel();edit.setCursor(time);if(hit>=0)edit.setSelection(selection);}};
 });
}
