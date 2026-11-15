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
const sampleKeys=[
 ['Wheel / Shift+wheel','Scroll the waveform (when zoomed); Shift scrolls further.'],
 ['Ctrl+wheel','Zoom in or out around the pointer.'],
 ['Middle drag / drag when zoomed','Pan the waveform. On touch: one finger pans, two fingers pinch to zoom.'],
 ['F / Z / + / −','Fit the whole sample / zoom to the chosen slice / zoom in / zoom out.'],
 ['Tap · double-click','Choose and hear a slice · split the slice where you double-click.'],
 ['Drag a tag marker','Move Start, End, Loop, Loop end or a slice edge. A shared slice edge moves both slices.'],
 ['← / → on the waveform','Previous / next slice (and hear it).'],
 ['← / → on a marker','Nudge it 1% of the view; Shift 10%, Ctrl 0.1%.'],
 ['S / J / Delete','Split at the last tap / join with the next slice / remove the slice\'s start edge.'],
 ['Space / Enter','Play the chosen slice.'],
 ['Right-click / touch-hold','Radial menu: Zoom in / out / Fit whole; in Chop also Split here, Join next, Audition, Save to library and Clear slices (the sample stays).'],
 ['Library','The sample library: tap a card to load it (Undo brings the old sample back), ▶ to hear it first. Save the whole sample, its trim or a slice into a category. Saves to and Browses set the folders; they are remembered.'],
 ['Right-click a knob','Edit value, Reset default, Link to › Macros or Mod pads (each in its colour, a tick when linked), Unlink. Works on Sampler and Drum Rack knobs too.'],
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
  if(section==='notes'&&notes.current&&content.current){
   const el=content.current;
   el.scrollTop=Math.floor(el.scrollTop+notes.current.getBoundingClientRect().top-el.getBoundingClientRect().top);
  }
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
   <p><strong>Perform.</strong> Edit patterns with the compact grid. Hold is lower-left; the keyboard button beneath it hides or restores the playable keys. Wheel or drag vertically on the octave control to change the viewed range; its arrows and keyboard controls do the same. Drum tracks start at C2. Range navigation never transposes saved notes. Expand enlarges this same grid; Restore or Escape returns to the compact view.</p>
   <p><strong>Pattern ↔ Song.</strong> The direct buttons name the track, open clip and pattern. Pattern → Song adds notes and repeats to fill the clip. Song → Pattern replaces the named pattern, preserving exact timing where the division, gate and tie range allow it. Incompatible copies are rejected; one Undo restores the transfer.</p>
   <p><strong>Song.</strong> Choose a track and an open clip (A–H), record a loop, or place clips on the arrangement timeline. The global transport controls playback and recording.</p>
   <p><strong>Drum Rack.</strong> The lower step lane edits the selected pad’s MIDI pitch in the named open Song clip. Its 16 steps cover one bar of sixteenth notes; use the bar arrows for longer clips. Tap a step to add or remove a hit. Audition previews the selected pad without recording it. Undo restores the last edit.</p>
   <p><strong>Sound and FX.</strong> Sound keeps Partials above the sound cards; edit all four ADSR controls inline. FX keeps Morph above the effect cards. Drag cards by their titles; double-tap a title to fold. Drag knobs vertically, hold Shift for finer changes, or tap the numeric value.</p>
   <p><strong>Modulation.</strong> Tap a pad’s label or a macro’s name, then the parameters to link. Shape and Links edit the selected source; Done, Escape or an empty-area tap ends linking. Link depth can be positive or negative.</p>
   <h3>Support Decksynth</h3>
   <p>Contribute to development through <span className="support-url">https://www.paypal.com/donate/?hosted_button_id=EWZ2SZB92EYJE</span>. For contact, use Discord: <strong>zerolitter</strong>.</p>
   <h3>Transport and tracks</h3>
   <KeyTable rows={transportKeys}/>
   <p>Text fields keep their own shortcuts. Transport keys are suspended while Help or Settings is open.</p>
   <h3 ref={notes}>Note editing</h3>
   <KeyTable rows={noteKeys}/>
   <p>The cursor follows a grid click or ruler position. Paste preserves pitch and relative timing; incompatible timing, collisions or out-of-range placements are rejected. Recording must finish before note edits. Selection, the edit cursor and the playback line are separate states.</p>
   <h3>Sample editor (Sampler waveform)</h3>
   <KeyTable rows={sampleKeys}/>
  </div>
 </section>;
}
