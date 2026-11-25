import {useEffect,useRef,useState} from 'react';
import {ACTIONS,FIXED,showAll,subscribe,type KeyScope} from '../hotkeys';
import {X} from 'lucide-react';

/** The keys come from the shared key map (hotkeys.ts), so Help always shows the keys you really have. */
const rowsFor=(scope:KeyScope):string[][]=>[
 ...ACTIONS.filter(a=>a.scope===scope).map(a=>[showAll(a.id),a.about]),
 ...FIXED.filter(f=>f.scope===scope).map(f=>[f.keys,f.about]),
];
const sampleMore=[
 ['Drum Rack Pad Sound','The same waveform editor: drag the Start / End tags, wheel and Ctrl+wheel, F / Z / + / −, and the radial menu. Play, Shape, Tone and Comp are compact cards like the Sampler\'s.'],
 ['Drag points','Drum Rack: Trim, Envelope and Tone beside the big waveform. Sampler: Envelope and Filter next to Trim and Chop. Drag a point to hear it change; letting go is one undo step. Shift drags finer, double-click resets a point, arrow keys nudge it. The compressor meter shows the level going in (coloured) and coming out (grey); drag its orange line to set the threshold.'],
 ['New effects','Pitch shift (semitones and cents), Auto-tune (pulls notes to the scale set on the Perform page), Ducking (another track pushes this one down, like a kick ducking the bass) and Vocoder (another track, such as a voice, shapes this one\'s tone). Ducking and Vocoder listen to the other track\'s own sound, even when it is muted.'],
 ['Ambient effects','Tape (wow, flutter, drive, age and hiss; Character Fresh / Worn / Broken), Smear (blurs the sound in time), Shimmer (a long reverb whose tail climbs by the Interval) and Space (a huge hall; Freeze holds the tail while new notes still play dry).'],
 ['Library','The sample library: tap a card to load it (Undo brings the old sample back), ▶ to hear it first. Save the whole sample, its trim or a slice into a category. Saves to and Browses set the folders; they are remembered.'],
 ['Sends','Every track has a Reverb and a Delay send on its Sound page (Synth: the Sends card; Drum Rack: under the kit buttons; Sampler: under Amp). They all feed one shared reverb and one shared delay, after the track\'s volume and pan. Shared opens their settings: Return level, Decay, Pre-delay, Lo and Hi cut, Width; delay Time, Feedback and Ping-pong.'],
 ['Autosave','Settings › Session: the project is written to ~/Music/Decksynth/Autosave every 10 s to 60 min (Off, 30 s, 1, 2, 5, 10 min or Custom; only when it changed), even if the window goes blank. On launch opens the Last project or a New project; the session before is always kept there as a Recovered file (the newest 10). F5 reloads a blank window; the sound keeps playing. From a terminal, tools/save-now.sh saves right now.'],
 ['To Grain','Perform, the yellow Grain button beside Step rec: bounces this track\'s loop (a pattern goes into the clip first) and plays it as Grain on a new Sampler track. No WAV to export or load.'],
 ['Hold (Sampler keys)','Beside the Sampler keyboard: keys and MIDI notes keep sounding after you let go; the next chord replaces them. Tap Hold again to let them go.'],
 ['Chop','Opening Chop on a sample with no slices chops it at once with the current settings (Threshold by default). Change Level or Min to chop again.'],
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
/** Re-reads the key map whenever a key is changed in Settings. */
function useKeymap(){const[,tick]=useState(0);useEffect(()=>subscribe(()=>tick(n=>n+1)),[]);}
function KeyTable({rows}:{rows:string[][]}){
 return <table><tbody>{rows.map(([key,action])=><tr key={key}><th scope="row">{key}</th><td>{action}</td></tr>)}</tbody></table>;
}

export function Help({section,invoker,close}:{section:'guide'|'notes';invoker:HTMLElement|null;close:()=>void}){
 useKeymap();
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
   <p><strong>Window.</strong> Decksynth fills the screen without a title bar. Full screen, Minimise and Quit are at the bottom of Settings; F11 and Ctrl+Q do the same from the keyboard.</p>
   <p><strong>Drum piano roll.</strong> On Perform a Drum Rack shows 12 of its 16 pad rows, from the kick up; scroll or drag the octave control for the rest.</p>
   <h3>Knobs and value boxes</h3>
   <KeyTable rows={valueKeys}/>
   <h3>Support Decksynth</h3>
   <p>Contribute to development through <span className="support-url">https://www.paypal.com/donate/?hosted_button_id=EWZ2SZB92EYJE</span>. For contact, use Discord: <strong>zerolitter</strong>.</p>
   <h3>Transport and tracks</h3>
   <KeyTable rows={rowsFor('transport')}/>
   <p>Text fields keep their own shortcuts. Transport keys are suspended while Help or Settings is open. Change any key in Settings › Hotkeys.</p>
   <h3 ref={notes}>Note editing</h3>
   <KeyTable rows={rowsFor('notes')}/>
   <p>The cursor follows a grid click or ruler position. Paste preserves pitch and relative timing; incompatible timing, collisions or out-of-range placements are rejected. Recording must finish before note edits. Selection, the edit cursor and the playback line are separate states.</p>
   <h3>Pattern library and Structure (Perform › Seq › Library)</h3>
   <KeyTable rows={rowsFor('library')}/>
   <h3>Sample editor (Sampler waveform)</h3>
   <KeyTable rows={[...rowsFor('sample'),...sampleMore]}/>
  </div>
 </section>;
}
