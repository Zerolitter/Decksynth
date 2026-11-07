import {useNoteContext} from './useNoteContext';
import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronLeft,ChevronRight,Plus,Minus,Trash2,Copy,Undo2} from 'lucide-react';
import {noteName,type Note,type StepPattern} from '../types';
import {notesInCell,type NoteTarget} from '../note-ops';
import {useNoteEditing,type NoteTool} from './useNoteEditing';
type Props={target:NoteTarget;notes:Note[];expected:Note[]|StepPattern;span:number;snap?:number;beat:number;playing:boolean;recording:boolean;send:(cmd:string,args?:unknown)=>void;close:()=>void};
export function NoteEditor({target,notes,expected,span,snap=.25,beat,playing,recording,send,close}:Props){
 const [page,setPage]=useState(0),[base,setBase]=useState(()=>notes.length?Math.max(0,Math.min(120,Math.floor(Math.min(...notes.map(n=>n.note))/12)*12)):48),[velocity,setVelocity]=useState(100);
 const grid=useRef<HTMLDivElement>(null),done=useRef<HTMLButtonElement>(null),columns=16,windowSpan=columns*snap,pages=Math.ceil(span/windowSpan),start=page*windowSpan;
 const bounds=useMemo(()=>({span,snap,maxDuration:target.kind==='pattern'?8:span}),[span,snap,target.kind]);
 const edit=useNoteEditing({target,expected,events:notes,bounds,playing,recording,commit:(t,b,a)=>send('note_edit',[t,b,a]),audition:(track,id,n,v)=>send('editor_note',[track,id,n,v]),undo:()=>send('undo')});
 const context=useNoteContext({edit,target,expected,bounds,recording});
 useEffect(()=>{const previous=document.activeElement as HTMLElement;done.current?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
 const locate=(x:number,y:number)=>{const r=grid.current?.getBoundingClientRect();if(!r)return null;return {time:Math.max(start,Math.min(Math.min(span-snap,start+windowSpan-snap),start+Math.floor((x-r.left-44)/(r.width-44)*16)*snap)),pitch:Math.max(base,Math.min(base+7,base+7-Math.floor((y-r.top-24)/44)))}};
 const modes:[NoteTool,string][]=[['select','Select'],['draw','Draw'],['erase','Erase']];
 return createPortal(<div className="note-editor-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)close();}}><section className="note-editor" role="dialog" aria-modal="true" aria-label="MIDI note editor" onKeyDown={e=>{
  if(e.key==='Escape'){e.preventDefault();close();}
  if(e.key==='Tab'){const items=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]'));const i=items.indexOf(document.activeElement as HTMLElement);if((e.shiftKey&&i===0)||(!e.shiftKey&&i===items.length-1)){e.preventDefault();items[e.shiftKey?items.length-1:0]?.focus();}}
 }}>
  <header><strong>Track {target.track+1} · {target.kind==='clip'?'Clip '+String.fromCharCode(65+target.clip):'Pattern '+target.bank+'·'+target.slot} · Notes</strong><span>{recording?'Finish the take to edit':edit.selection.length+' selected'}</span><button ref={done} type="button" onClick={close}>Done</button></header>
  <div className="note-editor-tools"><div role="group" aria-label="Note editing mode">{modes.map(([mode,label])=><button key={mode} type="button" aria-label={label+' notes'} aria-pressed={edit.tool===mode} onClick={()=>edit.setTool(mode)}>{label}</button>)}</div>
   <button type="button" aria-label="Previous note page" disabled={page===0} onClick={()=>setPage(page-1)}><ChevronLeft size={17}/></button><span>{page+1} / {pages}</span><button type="button" aria-label="Next note page" disabled={page+1>=pages} onClick={()=>setPage(page+1)}><ChevronRight size={17}/></button>
   <button type="button" aria-label="Lower note octave" disabled={base<12} onClick={()=>setBase(Math.max(0,base-12))}><Minus size={16}/></button><span>{noteName(base)}</span><button type="button" aria-label="Higher note octave" disabled={base>=120} onClick={()=>setBase(Math.min(120,base+12))}><Plus size={16}/></button><span className="note-snap">Snap {target.kind==='pattern'?'1 step':'¼ beat'}</span>
  </div>
  <div ref={grid} {...context} className="note-editor-grid" role="group" aria-label="Editable pitch and time grid" onKeyDown={edit.key}>
   <div className="note-editor-ruler"><span/>{Array.from({length:16},(_,c)=><span key={c}>{(start+c*snap)%1===0?(start+c*snap)+1:'·'}</span>)}</div>
   {Array.from({length:8},(_,r)=>base+7-r).map(pitch=><div className={'note-editor-row'+([1,3,6,8,10].includes(pitch%12)?' black':'')} key={pitch}>
    <button type="button" aria-label={'Play '+noteName(pitch)} onPointerDown={e=>{if(e.button===0){e.currentTarget.setPointerCapture(e.pointerId);edit.play(pitch);}}} onPointerUp={edit.stop} onPointerCancel={edit.stop}>{noteName(pitch)}</button>
    {Array.from({length:16},(_,c)=>{const time=start+c*snap,blocks=notesInCell(edit.events,time,pitch,snap,start),selected=blocks.some(b=>edit.selection.includes(b.index));return <button key={c} type="button" className={'note-time-cell'+(c%4===0?' beat':'')+(selected?' selected':'')+(playing&&beat>=time&&beat<time+snap?' live':'')} data-testid={'note-cell-'+time+'-'+pitch} data-note-time={time} data-note-pitch={pitch} aria-label={noteName(pitch)+' at '+time+' beats'+(blocks.length?' note '+blocks.map(b=>b.note.start).join(', '):' empty')} disabled={time>=span||recording}
     onPointerDown={e=>edit.begin(e,time,pitch,locate)} onPointerMove={edit.move} onPointerUp={edit.end} onPointerCancel={edit.cancel}>{blocks.map(({note:n,index})=>{const left=Math.max(n.start,time),end=Math.min(n.start+n.duration,start+windowSpan);return <i key={index} className={"note-editor-block"+(edit.selection.includes(index)?" selected":"")} style={{left:((left-time)/snap*100)+"%",width:"max(3px, calc("+((end-left)/snap*100)+"% - 4px))"}}><span>{n.velocity}</span></i>;})}</button>;})}
   </div>)}
  </div>
  <footer><div><button type="button" aria-label="Delete selected notes" disabled={!edit.selection.length} onClick={()=>edit.action({kind:'delete'})}><Trash2 size={16}/></button><button type="button" aria-label="Duplicate selected notes" disabled={!edit.selection.length} onClick={()=>edit.action({kind:'duplicate'})}><Copy size={16}/></button><button type="button" aria-label="Undo note edit" onClick={()=>send('undo')}><Undo2 size={16}/></button><button type="button" disabled={!edit.selection.length} onClick={()=>edit.action({kind:'quantize'})}>Quantize</button></div>
   <label>Velocity <input type="number" min={1} max={127} aria-label="Selected note velocity" value={velocity} onChange={e=>setVelocity(Number(e.target.value))}/></label><button type="button" disabled={!edit.selection.length} onClick={()=>edit.action({kind:'velocity',value:velocity})}>Apply velocity</button>
   <small>1 Select · 2 Draw · 3 Erase · arrows move · Shift length · Delete · Ctrl+D / Z</small>
  </footer>
 </section></div>,document.querySelector('.harness-shell')??document.body);
}
