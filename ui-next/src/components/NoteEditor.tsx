import {PianoRoll,type PianoRollHandle} from './PianoRoll';
import {useNoteGeneration} from './NoteGeneration';
import {NoteShortcuts} from './NoteShortcuts';import {useNoteContext} from './useNoteContext';import {useEffect,useMemo,useRef,useState} from 'react';import {createPortal} from 'react-dom';import {ChevronLeft,ChevronRight,Plus,Minus,Trash2,Copy,Undo2,Scan} from 'lucide-react';import {noteName,type Note,type StepPattern} from '../types';import {notesInCell,type NoteTarget} from '../note-ops';import {useNoteEditing,type NoteTool} from './useNoteEditing';
type Props={target:NoteTarget;notes:Note[];expected:Note[]|StepPattern;span:number;snap?:number;beat:number;playing:boolean;recording:boolean;send:(cmd:string,args?:unknown)=>void;close:()=>void;sharedEdit?:ReturnType<typeof useNoteEditing>};
export function NoteEditor(props:Props){return props.sharedEdit?<NoteEditorView {...props} edit={props.sharedEdit}/>:<OwnedNoteEditor {...props}/>;}
function OwnedNoteEditor(props:Props){const bounds={span:props.span,snap:props.snap??.25,maxDuration:props.target.kind==='pattern'?8:props.span},edit=useNoteEditing({target:props.target,expected:props.expected,events:props.notes,bounds,playing:props.playing,recording:props.recording,commit:(t,b,a)=>props.send('note_edit',[t,b,a]),audition:(track,id,n,v)=>props.send('editor_note',[track,id,n,v]),undo:()=>props.send('undo')});return <NoteEditorView {...props} edit={edit}/>;}
function NoteEditorView({target,notes,expected,span,snap=.25,beat,playing,recording,send,close,edit}:Props&{edit:ReturnType<typeof useNoteEditing>}){
 const [velocity,setVelocity]=useState(100),roll=useRef<PianoRollHandle>(null),done=useRef<HTMLButtonElement>(null);
 const bounds=useMemo(()=>({span,snap,maxDuration:target.kind==='pattern'?8:span}),[span,snap,target.kind]);
 const generation=useNoteGeneration(edit,target,bounds,recording);
 const context=useNoteContext({edit,target,expected,bounds,recording,generate:generation.open});
 useEffect(()=>{const previous=document.activeElement as HTMLElement;done.current?.focus();return()=>{edit.cancel();if(previous?.isConnected)previous.focus();};},[]);
 const modes:[NoteTool,string][]=[['select','Select'],['draw','Draw'],['erase','Erase']];
 return createPortal(<div className="note-editor-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)close();}}><section className="note-editor" role="dialog" aria-modal="true" aria-label="MIDI note editor" onKeyDown={e=>{
  edit.key(e);if(e.defaultPrevented)return;if(e.key==='Escape'){e.preventDefault();close();}
  if(e.key==='Tab'){const items=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')),i=items.indexOf(document.activeElement as HTMLElement);if(e.shiftKey&&i===0||!e.shiftKey&&i===items.length-1){e.preventDefault();items[e.shiftKey?items.length-1:0]?.focus();}}
 }}>
 {generation.panel}<header><strong>Track {target.track+1} · {target.kind==='clip'?'Clip '+String.fromCharCode(65+target.clip):'Pattern '+target.bank+'·'+target.slot} · Notes</strong><span>{recording?'Finish the take to edit':edit.selection.length+' selected'}</span><NoteShortcuts/><button ref={done} type="button" onClick={close}>Done</button></header>
 <div className="note-editor-tools"><div role="group" aria-label="Note editing mode">{modes.map(([mode,label])=><button key={mode} type="button" aria-label={label+' notes'} aria-pressed={edit.tool===mode} onClick={()=>edit.setTool(mode)}>{label}</button>)}</div>
 <button type="button" aria-label="Earlier time" onClick={()=>roll.current?.panTime(-1)}><ChevronLeft size={17}/></button><span>Cursor {edit.cursor}</span><button type="button" aria-label="Later time" onClick={()=>roll.current?.panTime(1)}><ChevronRight size={17}/></button>
 <button type="button" aria-label="Lower note range" onClick={()=>roll.current?.panPitch(-1)}><Minus size={16}/></button><button type="button" aria-label="Higher note range" onClick={()=>roll.current?.panPitch(1)}><Plus size={16}/></button>
 <button type="button" aria-label="Fit notes" onClick={()=>roll.current?.fit()}><Scan size={16}/>Fit</button><span className="note-snap">Snap {target.kind==='pattern'?'1 step':'¼ beat'} · Ctrl-wheel zoom · Alt-wheel rows</span></div>
 <PianoRoll ref={roll} edit={edit} target={target} bounds={bounds} context={context} playing={playing} beat={beat} recording={recording}/>

 <footer><div><button type="button" aria-label="Delete selected notes" disabled={!edit.selection.length} onClick={()=>edit.action({kind:'delete'})}><Trash2 size={16}/></button><button type="button" aria-label="Duplicate selected notes" disabled={!edit.selection.length} onClick={()=>edit.action({kind:'duplicate'})}><Copy size={16}/></button><button type="button" aria-label="Undo note edit" onClick={()=>send('undo')}><Undo2 size={16}/></button><button type="button" disabled={!edit.selection.length} onClick={()=>edit.action({kind:'quantize'})}>Quantize</button></div>
 <label>Velocity <input type="number" min={1} max={127} aria-label="Selected note velocity" value={velocity} onChange={e=>setVelocity(Number(e.target.value))}/></label><button type="button" disabled={!edit.selection.length} onClick={()=>edit.action({kind:'velocity',value:velocity})}>Apply velocity</button><small aria-live="polite">{edit.status||'Cursor '+edit.cursor+' · Ctrl+drag copies · Shortcuts above'}</small></footer>
 </section></div>,document.querySelector('.harness-shell')??document.body);
}
