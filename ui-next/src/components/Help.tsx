import {useEffect,useRef} from 'react';
import {X} from 'lucide-react';

const transportKeys=[
 ['F5 / Space','Play or pause. Space keeps its normal action on focused controls.'],
 ['F6 / F7','Stop / start or finish recording.'],
 ['F8 / F9','Previous / next track.'],
 ['F10','Undo.'],
];
const noteKeys=[
 ['Ctrl+A','Select all notes in the current pattern or clip.'],
 ['Ctrl+Shift+A','Select the focused note’s exact pitch row, including off-screen time.'],
 ['Ctrl+C / Ctrl+X','Copy / cut selected notes.'],
 ['Ctrl+V','Paste at the edit cursor.'],
 ['Ctrl+D','Duplicate selected notes into a free position.'],
 ['Delete / Backspace','Delete selected notes.'],
 ['Ctrl+Z','Undo. Redo is not supported.'],
 ['1 / 2 / 3','Select / Draw / Erase tool.'],
 ['← / →','Move by one displayed snap.'],
 ['↑ / ↓','Move selected notes one semitone.'],
 ['Ctrl+↑ / Ctrl+↓','Move selected notes one octave.'],
 ['Shift+← / Shift+→','Shorten / lengthen selected notes by one snap.'],
 ['Q','Quantize selected notes to the displayed snap.'],
 ['Escape','Cancel an active gesture; otherwise clear selection or close the current dialog.'],
 ['Ctrl+drag · empty grid','Select a rectangle in either Draw or Select mode.'],
 ['Ctrl+drag · selected notes','Preview a group copy; release commits once.'],
 ['Shift+click','Add or remove a note from the selection.'],
 ['Pitch key / note drag','Scrub pitch keys or drag existing notes to audition successive pitches. Drag a note’s end to resize it.'],
 ['Middle drag / Shift+wheel','Pan the grid / scroll time.'],
 ['Ctrl+wheel / Alt+wheel','Zoom time / change pitch-row density around the pointer.'],
 ['Fit','Frame selected notes, or all notes when none are selected.'],
 ['Right-click / touch-hold / Shift+F10','Open contextual commands for the current target.'],
];
function KeyTable({rows}:{rows:string[][]}){
 return <table><tbody>{rows.map(([key,action])=><tr key={key}><th scope="row">{key}</th><td>{action}</td></tr>)}</tbody></table>;
}

export function Help({section,invoker,close}:{section:'guide'|'notes';invoker:HTMLElement|null;close:()=>void}){
 const ref=useRef<HTMLElement>(null),done=useRef<HTMLButtonElement>(null),notes=useRef<HTMLHeadingElement>(null),content=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const origin=invoker??document.activeElement as HTMLElement|null;
  const others=[...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
   .filter(el=>el!==ref.current).map(el=>({el,inert:el.inert}));
  others.forEach(({el})=>el.inert=true);
  done.current?.focus({preventScroll:true});
  return()=>{others.forEach(({el,inert})=>el.inert=inert);if(origin?.isConnected)origin.focus({preventScroll:true});};
 },[]);
 useEffect(()=>{
  if(section==='notes'&&notes.current&&content.current)content.current.scrollTop=notes.current.offsetTop;
  else if(content.current)content.current.scrollTop=0;
 },[section]);
 return <section ref={ref} className="settings-dialog help-dialog" data-shortcut-reference data-help-section={section}
  role="dialog" aria-label="Decksynth help" aria-modal="true" onKeyDown={e=>{
   e.stopPropagation();
   if(e.key==='Escape'){e.preventDefault();close();return;}
   if(e.key==='Tab'){
    const items=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')];
    const i=items.indexOf(document.activeElement as HTMLElement);
    if(e.shiftKey&&i===0||!e.shiftKey&&i===items.length-1){e.preventDefault();items[e.shiftKey?items.length-1:0]?.focus();}
   }
  }}>
  <header><h2>Decksynth Help</h2><button ref={done} type="button" className="modal-close" aria-label="Close help" onClick={close}><X size={18}/></button></header>
  <div ref={content} className="help-content" tabIndex={0} aria-label="Help content">
   <h3>Guide</h3>
   <p><strong>Perform.</strong> Edit patterns with the compact grid. Hold is lower-left; the keyboard button beneath it hides or restores the playable keys. Wheel or drag vertically on the octave control to change the viewed range; its arrows and keyboard controls do the same. Drum tracks start at C2. Range navigation never transposes saved notes.</p>
   <p><strong>Song.</strong> Choose a track and an open clip (A–H), record a loop, or place clips on the arrangement timeline. The global transport controls playback and recording.</p>
   <p><strong>Sound and FX.</strong> Sound keeps Partials above the sound cards; edit all four ADSR controls inline. FX keeps Morph above the effect cards. Drag cards by their titles; double-tap a title to fold. Drag knobs vertically, hold Shift for finer changes, or tap the numeric value.</p>
   <p><strong>Modulation.</strong> Tap a pad’s label or a macro’s name, then the parameters to link. Shape and Links edit the selected source; Done, Escape or an empty-area tap ends linking. Link depth can be positive or negative.</p>
   <h3>Transport and tracks</h3>
   <KeyTable rows={transportKeys}/>
   <p>Text fields keep their own shortcuts. Transport keys are suspended while Help or Settings is open.</p>
   <h3 ref={notes}>Note editing</h3>
   <KeyTable rows={noteKeys}/>
   <p>The cursor follows a grid click or ruler position. Paste preserves pitch and relative timing; incompatible timing, collisions or out-of-range placements are rejected. Recording must finish before note edits. Selection, the edit cursor and the playback line are separate states.</p>
  </div>
 </section>;
}
