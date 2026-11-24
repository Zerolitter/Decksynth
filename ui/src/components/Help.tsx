import {useEffect,useRef} from 'react';
import {X} from 'lucide-react';

const transportKeys=[
 ['F5 / Space','Play or pause. Space keeps its normal action on focused controls.'],
 ['F6 / F7','Stop / start or finish recording.'],
 ['F8 / F9','Previous / next track.'],
 ['F10','Undo.'],
 ['Ctrl+Z / Ctrl+Shift+Z','Undo / redo the latest committed edit.'],
 ['F11','Full screen on or off.'],
 ['Ctrl+Q','Quit Decksynth.'],
];
const noteKeys=[
 ['Ctrl+A','Select all notes in the current pattern or clip.'],
 ['Ctrl+Shift+A','Select the focused note’s exact pitch row, including off-screen time.'],
 ['Ctrl+C / Ctrl+X','Copy / cut selected notes.'],
 ['Ctrl+V','Paste at the edit cursor.'],
 ['Ctrl+D','Duplicate selected notes into a free position.'],
 ['Delete / Backspace','Delete selected notes.'],
 ['Ctrl+Z / Ctrl+Shift+Z','Undo / redo the latest committed edit.'],
 ['Ctrl+L','Legato selected notes, or every note when nothing is selected.'],
 ['1 / 2 / 3','Select / Draw / Erase tool.'],
 ['← / →','Move by one displayed snap.'],
 ['↑ / ↓','Move selected notes one semitone.'],
 ['Ctrl+↑ / Ctrl+↓','Move selected notes one octave.'],
 ['Shift+← / Shift+→','Shorten / lengthen selected notes by one snap.'],
 ['Q','Quantize selected notes, or every note when nothing is selected.'],
 ['Escape','Cancel an active gesture; otherwise clear selection or close the current dialog.'],
 ['Ctrl+drag · empty grid','Select a rectangle in either Draw or Select mode.'],
 ['Ctrl+drag · selected notes','Preview a group copy; release commits once.'],
 ['Shift+click','Add or remove a note from the selection.'],
 ['Pitch key / note drag','Scrub pitch keys or drag existing notes to audition successive pitches. Drag a note’s end to resize it.'],
 ['Alt+drag','Temporarily place or move notes off the displayed snap.'],
 ['Snap','Toggle grid snapping. The Follow control keeps the playhead in view.'],
 ['Velocity lane','Drag stems or paint across notes; Shift draws a straight velocity line.'],
 ['Ctrl+wheel / Alt+wheel','Zoom time / change pitch-row density around the pointer.'],
 ['Fit','Frame selected notes, or all notes when none are selected.'],
 ['Right-click / touch-hold / Shift+F10','Open contextual commands for the current target.'],
];
const libraryKeys=[
 ['Click / Space','Hear a pattern (Space again stops it).'],
 ['Double-click / Enter','Load it into the selected pattern slot.'],
 ['A / + / Shift+Enter','Add it to the end of the Structure.'],
 ['Arrow keys / Page Up / Page Down','Move through the cards and pages; ↓ from the last row goes to the Structure.'],
 ['Ctrl+F or /','Search. Esc clears the search, then closes the library.'],
 ['Structure part: ← / →','Select the part before or after.'],
 ['Structure part: Alt+← / Alt+→, or drag','Move the part earlier or later.'],
 ['Structure part: 1–9, + / −, mouse wheel','How many times the part plays in a row.'],
 ['Structure part: Ctrl+D','Duplicate the part.'],
 ['Structure part: Backspace / Delete','Remove the part (the pattern itself stays).'],
 ['Ctrl+Z','Undo the last Structure change.'],
 ['Esc / a press anywhere outside','Close the library.'],
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
 ['Drum Rack Pad Sound','The same waveform editor: drag the Start / End tags, wheel and Ctrl+wheel, F / Z / + / −, and the radial menu. Play, Shape, Tone and Comp are compact cards like the Sampler\'s.'],
 ['Drag points','Drum Rack: Trim, Envelope and Tone beside the big waveform. Sampler: Envelope and Filter next to Trim and Chop. Drag a point to hear it change; letting go is one undo step. Shift drags finer, double-click resets a point, arrow keys nudge it. The compressor meter shows the level going in (coloured) and coming out (grey); drag its orange line to set the threshold.'],
 ['New effects','Pitch shift (semitones and cents), Auto-tune (pulls notes to the scale set on the Perform page), Ducking (another track pushes this one down, like a kick ducking the bass) and Vocoder (another track, such as a voice, shapes this one\'s tone). Ducking and Vocoder listen to the other track\'s own sound, even when it is muted.'],
 ['Library','The sample library: tap a card to load it (Undo brings the old sample back), ▶ to hear it first. Save the whole sample, its trim or a slice into a category. Saves to and Browses set the folders; they are remembered.'],
 ['Sends','Every track has a Reverb and a Delay send on its Sound page (Synth: the Sends card; Drum Rack: under the kit buttons; Sampler: under Amp). They all feed one shared reverb and one shared delay, after the track\'s volume and pan. Shared opens their settings: Return level, Decay, Pre-delay, Lo and Hi cut, Width; delay Time, Feedback and Ping-pong.'],
 ['Right-click a knob','Edit value, Reset default, Link to › Macros or Mod pads (each in its colour, a tick when linked), Unlink. Works on Sampler and Drum Rack knobs too.'],
];
const valueKeys=[
 ['Drag a knob','Up and down turns it; hold Shift or Ctrl for finer moves. Every knob on every page works the same.'],
 ['Double-tap a knob','Back to its default.'],
 ['Value box: click, then wheel','The wheel moves the value; Shift is bigger steps, Ctrl finer. It counts as one change when the wheel rests.'],
 ['Value box: hold and drag','On touch, hold it a moment then drag: up and down in normal steps, left and right in fine steps. A mouse drags at once.'],
 ['Value box: two slow clicks','Type a number (Enter keeps it, Esc drops it). Arrow keys step a focused box.'],
 ['Right-click / touch-hold a knob','The radial menu: edit value, reset, link to a macro or mod pad.'],
 ['Steps, inversion, octave, song and block length','These are value boxes too: no − / + buttons. The small list button beside Steps offers the usual lengths.'],
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
   <p><strong>Sound and FX.</strong> Sound keeps Partials above the sound cards; edit all four controls inline. FX keeps Morph above the effect cards. Drag cards by their titles; double-tap a title to fold. Drag knobs vertically (Shift for finer), double-tap to reset, and use the value box under each knob: click and scroll, hold and drag, or two slow clicks to type. See Knobs and value boxes below.</p>
   <p><strong>Drum Rack pads.</strong> Tap a pad to hear it and edit it under Pad Sound. Trim, Envelope and Tone show the sound with points to drag; knobs and points are heard while you move them, and letting go is one undo step. With Decay off, Hold at the end of the sound means the pad plays to the end. Crop to Start–End keeps only the part you hear in a new WAV (the pad sounds the same; Undo brings the full sample back). The bin button clears the pad. Choke opens a grid of groups: pads in the same group cut each other off. <strong>Hold rec</strong> in the PADS bar records straight onto pads: hold a pad and it records the input (the one last chosen in Record) while your finger is down, and the take lands on that pad when you let go; a quick tap only picks the pad. Tap Hold rec again, or Esc, to play the pads again. An empty pad has Record: play the piano or sing into the input and the take lands on that pad; the radial menu has Record into pad and Clear pad for any pad. Kits, under the pads, loads a kit or swaps single sounds; Save kit puts these 16 pads, with their names and sound settings, into your library under My kits.</p>
   <p><strong>Perform: Seq, Arp and Chord.</strong> Seq records and plays patterns, Arp plays held notes in turn and Chord turns each key into the chord you tapped last. Chord pads, chord types, Inversion (or Voice lead), Voices and Bass build the chord, and every change is heard at once on the keys you hold. Slide across the pads to play one chord after another. My chords keeps up to 8 chords: tap an empty slot to keep the last chord, hold a slot to replace or clear it. Play in order makes every key (or every 1 or 2 bars) play the next saved chord. Loop (the repeat icon under Strum sync) strums the held chord again every 1/8, 1/4, 1/2 or bar; Up-Down strums forward, then back. Tension (Suggest) marks the chords that many scale steps above and below the last one you tapped. Arp Steps and Seq Steps use the same pick list.</p>
   <p><strong>Modulation.</strong> On the Link page, pick a mod pad or macro, then tap the knobs to link. The shapes sit right under the graph, five pages of ten (Basic, Curves, Envelopes, Gates, Random): tap one to use it. Rate goes up to 32 bars, and Edit points lets you drag the curve; Done sits in the same place when you finish. Link depth can be positive or negative.</p>
   <p><strong>Window.</strong> Decksynth fills the screen without a title bar. Settings › Window has Full screen on/off, Minimise and Quit; F11 and Ctrl+Q do the same from the keyboard.</p>
   <p><strong>Drum piano roll.</strong> On Perform a Drum Rack shows 12 of its 16 pad rows, from the kick up; scroll or drag the octave control for the rest.</p>
   <h3>Knobs and value boxes</h3>
   <KeyTable rows={valueKeys}/>
   <h3>Support Decksynth</h3>
   <p>Contribute to development through <span className="support-url">https://www.paypal.com/donate/?hosted_button_id=EWZ2SZB92EYJE</span>. For contact, use Discord: <strong>zerolitter</strong>.</p>
   <h3>Transport and tracks</h3>
   <KeyTable rows={transportKeys}/>
   <p>Text fields keep their own shortcuts. Transport keys are suspended while Help or Settings is open.</p>
   <h3 ref={notes}>Note editing</h3>
   <KeyTable rows={noteKeys}/>
   <p>The cursor follows a grid click or ruler position. Paste preserves pitch and relative timing; incompatible timing, collisions or out-of-range placements are rejected. Recording must finish before note edits. Selection, the edit cursor and the playback line are separate states.</p>
   <h3>Pattern library and Structure (Perform › Seq › Library)</h3>
   <KeyTable rows={libraryKeys}/>
   <h3>Sample editor (Sampler waveform)</h3>
   <KeyTable rows={sampleKeys}/>
  </div>
 </section>;
}
