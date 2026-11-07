import {useContextTarget,type ContextBinding} from './ContextWheel';
import {editNotes,noteIndexAt,paintNotes,type NoteBounds,type NoteTarget} from '../note-ops';
import type {Note,StepPattern} from '../types';
import type {useNoteEditing} from './useNoteEditing';
let clipboard:{kind:NoteTarget['kind'];notes:Note[]}|null=null;
export function useNoteContext({edit,target,expected,bounds,recording,chord,open}:{edit:ReturnType<typeof useNoteEditing>;target:NoteTarget;expected:Note[]|StepPattern;bounds:NoteBounds;recording:boolean;chord?:(pitch:number)=>number[];open?:()=>void}){
 return useContextTarget((el,x)=>{const cell=el.closest<HTMLElement>('[data-note-time][data-note-pitch]');if(!cell||recording)return null;const time=Number(cell.dataset.noteTime),pitch=Number(cell.dataset.notePitch);if(time>=bounds.span)return null;
  const r=cell.getBoundingClientRect(),at=time+Math.max(0,Math.min(.999,(x-r.left)/r.width))*bounds.snap,events=edit.events.map(n=>({...n})),hit=noteIndexAt(events,at,pitch),selection=hit>=0?(edit.selection.includes(hit)?[...edit.selection]:[hit]):[];
  const apply=(action:Parameters<typeof editNotes>[2])=>{const next=editNotes(events,selection,action,bounds);edit.commit(next.events,next.selection,expected,target);};
  const audition=(n:number)=>{edit.play(n);setTimeout(edit.stop,100);};
  const caps:ContextBinding['caps']={open,...(clipboard?.kind===target.kind?{paste:()=>{const notes=clipboard!.notes,origin=Math.min(...notes.map(n=>n.start)),root=Math.min(...notes.map(n=>n.note)),next=[...events,...notes.map(n=>({...n,start:n.start-origin+time,note:Math.max(0,Math.min(127,n.note-root+pitch))})).filter(n=>n.start<bounds.span&&!events.some(old=>old.start===n.start&&old.note===n.note))];edit.commit(next,[],expected,target);}}:{})};
  if(hit<0){caps.add=()=>{const next=paintNotes(events,time,time,pitch,bounds);edit.commit(next,[next.length-1],expected,target);audition(pitch);};if(chord)caps.chord=()=>{let next=events;for(const n of chord(pitch).slice(0,8))next=paintNotes(next,time,time,n,bounds);edit.commit(next,[],expected,target);audition(pitch);};}
  else Object.assign(caps,{pitchUp:()=>apply({kind:'move',time:0,pitch:1}),pitchDown:()=>apply({kind:'move',time:0,pitch:-1}),octaveUp:()=>apply({kind:'move',time:0,pitch:12}),octaveDown:()=>apply({kind:'move',time:0,pitch:-12}),earlier:()=>apply({kind:'move',time:-bounds.snap,pitch:0}),later:()=>apply({kind:'move',time:bounds.snap,pitch:0}),longer:()=>apply({kind:'length',delta:bounds.snap}),shorter:()=>apply({kind:'length',delta:-bounds.snap}),quantize:()=>apply({kind:'quantize'}),velocity:()=>apply({kind:'velocity',value:127}),duplicate:()=>apply({kind:'duplicate'}),delete:()=>apply({kind:'delete'}),copy:()=>{clipboard={kind:target.kind,notes:selection.map(i=>({...events[i]}))};},selectAll:()=>edit.setSelection(events.map((_,i)=>i))});
  return {kind:hit<0?'seq.empty':target.kind==='pattern'?'seq.note':'song.note',label:(target.kind==='pattern'?'Step '+(time+1):'Beat '+time)+' · MIDI '+pitch,caps,cancel:()=>{edit.cancel();if(hit>=0)edit.setSelection(selection);}};
 });
}
