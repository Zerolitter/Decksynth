import {NoteShortcuts} from './NoteShortcuts';
import {PianoRoll,type PianoRollHandle} from './PianoRoll';
import {useNoteGeneration} from './NoteGeneration';
import {PatternLibrary} from './PatternLibrary';
import {ChoiceList,STEP_CHOICES} from './LoopBars';
import {useNoteContext} from './useNoteContext';
import {useContextTarget,ContextAreaScope} from './ContextWheel';
import {useNoteEditing,type NoteTool} from './useNoteEditing';
import {patternEvents,type NoteTarget} from '../note-ops';
import {useClockValue,type Position} from '../frame-clock';
import {chainPosition} from '../structure';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, ChevronDown, ChevronsLeft, ChevronsRight, ChevronUp, CircleDot, Combine, Dices, Fingerprint, Keyboard, ListOrdered, Layers3,  MoreHorizontal, Plus, Power, RotateCcw, Shuffle, SlidersHorizontal, Waves, X, Pause, Play, Square, Scan, Maximize2, Minimize2, ListChecks, ListMusic, Repeat, Lightbulb } from 'lucide-react';
import {performanceRange} from '../piano-viewport';
import { Knob } from './Knob';
import { ValueBox } from './ValueBox';
import { StrumIcon, ChordDots } from './ChordIcons';
import { CHORD_ADVANCE, CHORD_EXTS, ROOTS, SCALES, chordName, chordText, chordUpper, diatonicChords, voiceChord, type ChordExt } from '../chords';
import { LIBRARY } from './PresetBrowser';
import { clamp, noteName, type PerformanceState, type StepNote, type StepPattern } from '../types';

/* Perform page: one compact panel in the KeyStep spirit.
   Mode tabs (Seq / Arp / Chord) swap the controls on the left and the lane on the right;
   the touch keyboard with Pitch / Mod / AT strips is always at the bottom, so nothing jumps. */

const RATE_BEATS:Record<string,number>={'1/2D':3,'1/2':2,'1/2T':4/3,'1/4D':1.5,'1/4':1,'1/4T':2/3,'1/8D':.75,'1/8':.5,'1/8T':1/3,'1/16D':.375,'1/16':.25,'1/16T':1/6,'1/32D':.1875,'1/32':.125,'1/32T':1/12};
const MODES=['Up','Down','UpDown','Order','Random','Poly','Short 1','Short 2','Long 1','Long 2','Long 3','Poly 1','Poly 2','Poly 3','Poly 4','User Sequence'];
const ARP_VELOCITY=['As played','Fixed 100','Accent first'] as const;
const STRUM_SYNC=['Off','1/64','1/32','1/16','1/8','1/4'];
const STRUM_ORDER=['Up','Down','Alt Up','Alt Down','Up-Down'];
const LOOP_RATES=['1/8','1/4','1/2','1 bar'] as const;
const VOICES=[0,2,3,4,5,6];
const BLACK=new Set([1,3,6,8,10]);
const SHEET_TITLE={midi:'MIDI and keyboard',library:'Pattern library and chain',scale:'Key and scale',mutate:'Pattern tools'} as const;

const RATE_BASES=['1/2','1/4','1/8','1/16','1/32'];
const SEQ_RATES=['1/4','1/8','1/16','1/32'];
const rateParts=(r:string)=>{const feel=/[TD]$/.test(r)?r.slice(-1):'';return {base:feel?r.slice(0,-1):r,feel};};
/** Halve or double a time division, keeping its straight/triplet/dotted feel. */
export function shiftRate(rate:string,dir:1|-1){
  const {base,feel}=rateParts(rate);const i=RATE_BASES.indexOf(base);
  const j=Math.max(0,Math.min(RATE_BASES.length-1,i+dir));return RATE_BASES[j]+feel;
}

/** Same note order as the engine for the fixed modes; used to draw the lane before the engine reports. */
export function arpOrder(held:number[],mode:string,octaves:number,octaveMode='Up'):number[][]{
  if((octaveMode==='Down'||octaveMode==='UpDown')&&octaves>1){
    const base=arpOrder(held,mode,1);const passes=Array.from({length:octaves},(_,o)=>o);
    const walk=octaveMode==='Down'?[...passes].reverse():[...passes,...passes.slice(1,-1).reverse()];
    return walk.flatMap(o=>base.map(g=>g.map(n=>n+12*o).filter(n=>n<=127)));
  }
  const unique=[...new Set(held)];
  if(!unique.length)return [];
  const ordered=Array.from({length:octaves},(_,o)=>unique.map(n=>n+o*12)).flat().filter(n=>n<=127);
  const asc=[...ordered].sort((a,b)=>a-b);
  if(mode==='Down')return [...asc].reverse().map(n=>[n]);
  if(mode==='UpDown')return [...asc,...asc.slice(1,-1).reverse()].map(n=>[n]);
  if(mode==='Order')return ordered.map(n=>[n]);
  if(mode==='Poly')return [asc];
  return asc.map(n=>[n]);
}

type Mode='seq'|'arp'|'chord';
type Section='seq'|'arp'|'chord'|'scale'|'sync';
type TransferTarget={track:number;device:string;clip:number;bars:number;bank:number;slot:number;transpose:number;pattern:StepPattern;notes:import('../types').Note[]};

export type ArpView={groups:number[][];step:number;phase?:number;paused?:boolean};
type Props={
  track:import('../types').Track;catalogStatus:import('../types').DeckUpdate['pattern_library'];onCommand:(command:string,args?:unknown)=>void;state:PerformanceState; playing:boolean; held:number[]; arpView?:ArpView|null;
  /** Step record cursor from the engine: the step the next recorded key goes to. */
  recStep?:number;
  selectedTrack:number;recording?:boolean;device?:string;onNoteEdit:(target:NoteTarget,expected:StepPattern,events:import('../types').Note[])=>void;onEditorNote:(track:number,id:string,note:number,velocity:number)=>void;onUndo:()=>void;onRedo:()=>void;editSound?:boolean;onSet:(section:Section,key:string,value:unknown)=>void;
  onStep:(index:number,notes:StepNote[],replace:boolean)=>void;
  onAction:(action:string,value?:unknown,expected?:TransferTarget)=>void;
  transfer:{clip:number;bars:number};
  /** The note grid edits the selected track's open Song clip instead of the SEQ pattern (SONG → Edit notes opens it here). */
  clipEdit?:boolean;
  onClipEdit?:(on:boolean)=>void;
  /** Where the open clip is playing (song blocks can play another clip), for the playhead while editing a clip. */
  clipClock?:(p:Position)=>{beat:number;playing:boolean}|null;
  onPlay:()=>void;
  onTempo:(bpm:number)=>void;
  /** Raw MIDI from the touch keyboard and strips: status, data1, data2. */
  onMidi:(status:number,data1:number,data2:number,notes?:number[]|'chord')=>void;
  /** Chords, Play in order: the saved chord the next key plays, and the one sounding (among saved chords). */
  chordStep?:number;chordNow?:number;
};

function defaultPattern(length:number,division:string):StepPattern {
  return {length,division,gate:.8,swing:.5,steps:Array.from({length},()=>[])};
}
const pct=(n:number)=>Math.round(n)+'%';

/** Panic and arp transport remain in the existing page bar. */
export function PerformTools({onPanic,arp=false,paused=false,onArp}:{onPanic:()=>void;
  /** arp is on: show Pause / Stop */ arp?:boolean; paused?:boolean; onArp?:(action:'arp_pause'|'arp_stop')=>void}){
  return <>
    {arp&&onArp?<>
      <button type="button" className={'pf-tool'+(paused?' on':'')} aria-pressed={paused} onClick={()=>onArp('arp_pause')}
        title={paused?'Carry on from the step after the one it stopped at':'Stop the arp for now, keep the chord and the step'}>
        {paused?<Play size={15}/>:<Pause size={15}/>}{paused?'Resume':'Pause'}</button>
      <button type="button" className="pf-tool" onClick={()=>onArp('arp_stop')}
        title="Stop the arp and let go of the held chord"><Square size={14}/>Stop arp</button>
    </>:null}
    <button type="button" className="pf-tool panic" onClick={onPanic} title="Stop every sounding note">Panic</button>
  </>;
}

export function Performance({track,catalogStatus,onCommand,state,playing,held,arpView,recStep=0,onSet,onStep,onAction,onTempo,onMidi,chordStep=0,chordNow=-1,selectedTrack,recording=false,device='synth',onNoteEdit,onEditorNote,onUndo,onRedo,editSound=true,transfer,clipEdit=false,onClipEdit,clipClock}:Props){
  const [noteEditorOpen,setNoteEditorOpen]=useState(false);
  const [mode,setMode]=useState<Mode>('seq');
  const [page,setPage]=useState(0);
  const octPending=useRef<number|null>(null);
  useEffect(()=>{octPending.current=null;},[state.scale.octave]);

  const [viewBases,setViewBases]=useState<Record<string,number>>({});
  const viewKey=selectedTrack+':'+device;
  const viewRange=performanceRange(device,viewBases[viewKey]);
  const gridBase=viewRange.base;
  const setGridBase=(base:number)=>setViewBases(v=>({...v,[viewKey]:performanceRange(device,base).base}));
  const [keyboardVisible,setKeyboardVisible]=useState(true);
  const keyboardId=useId();
  const keyboardShown=keyboardVisible&&!noteEditorOpen;
  const [strength,setStrength]=useState(.35);
  const [sheet,setSheet]=useState<null|'midi'|'library'|'scale'|'mutate'>(null);
  const [padMenu,setPadMenu]=useState<null|{bank:number;slot:number}>(null);
  const [clip,setClip]=useState<string|null>(null);
  const press=useRef<ReturnType<typeof setTimeout>|null>(null);
  const longPressed=useRef(false);
  const roll=useRef<PianoRollHandle>(null);
  const [overviewSlot,setOverviewSlot]=useState<HTMLDivElement|null>(null);
  const [message,setMessage]=useState('');
  const [tapTimes,setTapTimes]=useState<number[]>([]);
  // Chords: the chord last tapped (a pad or a My chords slot, as built at Oct 0), the one held down,
  // and for chord-off previews the chord before (Voice lead).
  type ChordSrc={id:string;raw:number[]};
  const [active,setActive]=useState<ChordSrc|null>(null);
  const [pressed,setPressed]=useState<string|null>(null);
  const [slotMenu,setSlotMenu]=useState<number|null>(null);
  const padKey=useRef<number|null>(null);
  const holding=useRef<ChordSrc|null>(null);
  const lastChord=useRef<number[]|null>(null);

  const seq=state.seq,arp=state.arp,chord=state.chord,scale=state.scale,sync=state.sync;
  // Chord type and inversion live in the project, so the engine voices every key the same way.
  const ext=(chord.ext??'triad') as ChordExt,inversion=chord.inversion??0;
  const setExt=(v:ChordExt)=>onSet('chord','ext',v),setInversion=(v:number)=>onSet('chord','inversion',Math.max(-3,Math.min(3,v)));
  const keysOct=scale.octave??0;
  const ref=seq.bank+':'+seq.slot;
  const pat=state.patterns[ref]??defaultPattern(seq.length,seq.division);
  // One note editor for both: the SEQ pattern, or (SONG → Edit notes) the selected track's open Song clip.
  const clipMode=clipEdit&&mode==='seq';
  const clipSpan=transfer.bars*4;
  const noteTarget:NoteTarget=clipMode?{kind:'clip',track:selectedTrack,clip:transfer.clip,bars:transfer.bars,device}
    :{kind:'pattern',track:selectedTrack,bank:seq.bank,slot:seq.slot,device};
  const noteBounds=clipMode?{span:clipSpan,snap:.25,maxDuration:clipSpan}:{span:pat.length,snap:1,maxDuration:Math.min(32,pat.length)};
  const noteExpected=clipMode?track.notes:pat;
  const edit=useNoteEditing({target:noteTarget,expected:noteExpected,events:clipMode?track.notes:patternEvents(pat),bounds:noteBounds,playing,recording,commit:(t,b,a)=>onNoteEdit(t,b as StepPattern,a),audition:onEditorNote,undo:onUndo,redo:onRedo,sound:editSound});
  const generation=useNoteGeneration(edit,noteTarget,noteBounds,recording,scale);
  const noteContext=useNoteContext({edit,target:noteTarget,expected:noteExpected,bounds:noteBounds,recording,generate:generation.open,open:()=>setNoteEditorOpen(true)});
  const tap=edit.tool,setTap=edit.setTool;

  const factoryName=undefined; // Slot number is not a factory identity after edits/imports.
  // A page is 16 steps of a pattern (a quarter of it, in 16s, past 64 steps), or a quarter of a clip
  // (one bar for clips up to 4 bars). Four page buttons always reach the whole pattern or clip.
  const pageSize=clipMode?Math.max(4,Math.ceil(transfer.bars/4)*4):Math.max(16,Math.ceil(pat.length/64)*16);
  const pages=clipMode?Math.min(4,Math.ceil(clipSpan/pageSize)):Math.max(1,Math.min(4,Math.ceil(pat.length/pageSize)));
  // Steps come from the shared clock: Perform re-renders once per step while playing, not per frame.
  // With Play in order on, the engine walks the Structure: the step shows only while this slot is the part playing.
  const chainAt=useClockValue(p=>playing&&seq.enabled&&seq.chain_enabled?(({key,step}:{key:string;step:number})=>key+'@'+step)(chainPosition(p.absoluteBeat,seq.chain,state.patterns,{length:seq.length,division:seq.division})??{key:'',step:-1}):'');
  const chainKey=chainAt?chainAt.split('@')[0]:'';
  const currentStep=useClockValue(p=>p.playing&&seq.enabled&&!seq.chain_enabled?Math.floor(p.clipBeat/(RATE_BEATS[pat.division]??.25))%pat.length:-1);
  const shownStep=seq.chain_enabled?(chainKey===ref?Number(chainAt.split('@')[1]):-1):currentStep;
  const closeSheet=useCallback(()=>setSheet(null),[]);
  const clipPlaying=useClockValue(p=>clipMode&&!!clipClock?.(p)?.playing);
  const cursor=seq.recording?recStep%pat.length:-1;
  const channel=scale.input_channel?scale.input_channel-1:0;
  const set=(sec:Section,key:string,value:unknown)=>onSet(sec,key,value);
  const action=(name:string,value?:unknown)=>{setMessage('');onAction(name,value);};
  const transferNotes=(name:'capture_song'|'commit_song')=>{
    edit.cancel();
    const expected:TransferTarget={track:selectedTrack,device,clip:transfer.clip,bars:transfer.bars,
      bank:seq.bank,slot:seq.slot,transpose:seq.transpose,pattern:clipMode?pat:edit.expectedState() as StepPattern,
      notes:clipMode?edit.expectedState() as import('../types').Note[]:track.notes};
    onAction(name,name==='commit_song'?'add':null,expected);
  };
  const tool=(c:string)=>({['--tool' as string]:'var(--t-'+c+')'});
  const slots=chord.slots??Array.from({length:8},()=>[] as number[]);
  const filledSlots=slots.map((c,i)=>c.length?i:-1).filter(i=>i>=0);
  const voicing={voices:chord.spread,inversion,bass:chord.bass??0,lead:chord.voicing};
  /** Keep a chord (as built, at Oct 0) in My chords: the given slot, else the first empty one. */
  const saveSlot=(raw:number[],at?:number)=>{
    if(!raw.length)return;
    const free=slots.findIndex(c=>!c.length);
    const i=at??(free<0?slots.length-1:free);
    action('save_slot',[i,[...new Set(raw)].sort((a,b)=>a-b).slice(0,8)]);
    setMessage('Saved to My chords '+(i+1)+'.');
  };
  // A chord pad or slot sounds while it is held, through the engine like a key, so strum, arp, Hold and REC apply.
  // Chord on: the engine builds and voices it (option changes re-voice it live). Play in order: a slot jumps there.
  const padOff=()=>{if(padKey.current!==null){onMidi(0x80|channel,padKey.current,0);padKey.current=null;}holding.current=null;setPressed(null);};
  const chordOn=(src:ChordSrc)=>{
    padOff();
    const slot=src.id.startsWith('slot-')?Number(src.id.slice(5)):-1;
    if(chord.enabled&&chord.follow&&slot>=0){
      action('chord_goto',Math.max(0,filledSlots.indexOf(slot)));
      padKey.current=src.raw[0];onMidi(0x90|channel,src.raw[0],100);
    }else if(chord.enabled){
      action('save_chord',src.raw);
      padKey.current=src.raw[0];onMidi(0x90|channel,src.raw[0],100,'chord');
    }else{
      const notes=voiceChord(src.raw.map(n=>n+12*keysOct),voicing,lastChord.current);
      lastChord.current=chordUpper(notes,voicing.bass);padKey.current=notes[0];
      onMidi(0x90|channel,notes[0],100,notes);
    }
    holding.current=src;setPressed(src.id);setActive(src);
  };
  useEffect(()=>()=>{if(padKey.current!==null)onMidi(0x80|channel,padKey.current,0);},[]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new pattern opens on its first page, centred on its notes.
  useEffect(()=>{
    setPage(0);
    const notes=pat.steps.flat().map(n=>n.note);
    if(notes.length&&device!=='drum_rack'){const low=Math.min(...notes);const base=clamp(Math.floor(low/12)*12,0,108);setGridBase(base);roll.current?.pitchTo(base+12);}
  },[seq.bank,seq.slot]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(page>=pages)setPage(pages-1);},[page,pages]);
  // Step rec: the grid follows the rec cursor (page and scroll) and shows the pitch just recorded.
  useEffect(()=>{if(cursor<0)return;const at=Math.floor(cursor/pageSize);if(at!==page)setPage(at);roll.current?.timeTo(Math.floor(cursor/16)*16);},[cursor]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastRecorded=seq.recording?pat.steps[(cursor-1+pat.length)%pat.length]?.map(n=>n.note).join(','):'';
  useEffect(()=>{
    if(!lastRecorded)return;
    const notes=lastRecorded.split(',').map(Number),range=performanceRange(device,gridBase);
    if(notes.every(n=>n>=range.base&&n<=range.top))return;
    const next=performanceRange(device,Math.floor(Math.min(...notes)/12)*12);
    setGridBase(next.base);roll.current?.pitchTo(next.viewTop);
  },[lastRecorded]); // eslint-disable-line react-hooks/exhaustive-deps
  // Step rec and pattern choices always work on the pattern: leave clip editing.
  useEffect(()=>{if(clipEdit&&seq.recording)onClipEdit?.(false);},[seq.recording,clipEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!message)return;const id=setTimeout(()=>setMessage(''),5000);return()=>clearTimeout(id);},[message]);

  const lane=arpView&&arpView.groups.length?arpView.groups:arpOrder(held,arp.mode,arp.octaves,arp.octave_mode);
  const arpStep=useClockValue(p=>playing&&lane.length?Math.floor(p.clipBeat/(RATE_BEATS[arp.division]??.25))%lane.length:-1);
  const laneStep=arpView&&arpView.groups.length?arpView.step
    :arpStep;
  const sounding=new Set(arp.enabled&&laneStep>=0?lane[laneStep]??[]:[]);

  const tapTempo=()=>{
    const now=performance.now();
    const recent=tapTimes.filter(t=>now-t<2200).concat(now).slice(-6);
    setTapTimes(recent);
    if(recent.length>=3){const intervals=recent.slice(1).map((t,i)=>t-recent[i]);
      const avg=intervals.reduce((a,b)=>a+b,0)/intervals.length;
      if(avg>0)onTempo(clamp(Math.round(60000/avg),30,240));}
  };

  /* ---------- chords: the pads of the key, My chords and what the keys play now ---------- */
  const pads=diatonicChords(scale.root,scale.name,ext,{octave:keysOct,inversion,voices:chord.spread,bass:chord.bass??0});
  const padRaw=(degree:number)=>(pads[degree]?.raw??[]).map(n=>n-12*keysOct);
  const shown=(raw:number[])=>voiceChord(raw.map(n=>n+12*keysOct),{...voicing,lead:false});
  const nameOf=(raw:number[])=>raw.length?chordName(raw[0],raw.map(n=>n-raw[0])):'';
  const following=chord.enabled&&!!chord.follow&&filledSlots.length>0;
  const nowSlot=following&&held.length&&chordNow>=0?filledSlots[chordNow%filledSlots.length]:-1;
  const nextSlot=following?filledSlots[chordStep%filledSlots.length]:-1;
  // Suggestions: the pads Tension steps above and below the last chord tapped (Sir, 16 Nov).
  const tension=chord.tension??0;
  const baseDegree=!active?-1:active.id.startsWith('pad-')?Number(active.id.slice(4))
    :pads.findIndex(c=>((c.raw[0]-active.raw[0])%12+12)%12===0);
  const suggestions=tension&&baseDegree>=0&&pads.length>1?[...new Set([(baseDegree+tension)%pads.length,((baseDegree-tension)%pads.length+pads.length)%pads.length])]
    .filter(d=>d!==baseDegree):[];
  const outline=following?shown(slots[nowSlot>=0?nowSlot:nextSlot]):active?shown(active.raw):null;
  // A new chord type, key or scale reshapes the tapped pad: chord on, the engine gets the new shape (heard live).
  const activePadRaw=active?.id.startsWith('pad-')?padRaw(Number(active.id.slice(4))).join(','):'';
  useEffect(()=>{
    if(!active||!active.id.startsWith('pad-')||!activePadRaw||activePadRaw===active.raw.join(','))return;
    const raw=activePadRaw.split(',').map(Number);setActive({id:active.id,raw});
    if(chord.enabled&&!chord.follow)action('save_chord',raw);
  },[activePadRaw]); // eslint-disable-line react-hooks/exhaustive-deps
  // Chord off, a pad held while an option changes: sound the new voicing (chord on, the engine does this).
  useEffect(()=>{
    const h=holding.current;if(!h||chord.enabled)return;
    chordOn(h.id.startsWith('pad-')?{id:h.id,raw:padRaw(Number(h.id.slice(4)))}:h);
  },[chord.spread,chord.bass,inversion,chord.voicing,keysOct,ext]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- left column: the controls of the chosen mode ---------- */
  const power=(on:boolean,label:string,toggle:()=>void)=>
    <button type="button" className={'pf-power'+(on?' on':'')} aria-pressed={on} onClick={toggle}>
      <Power size={16}/>{on?label+' on':'Turn '+label.toLowerCase()+' on'}</button>;
  const pctKnob=(id:string,name:string,value:number,min:number,max:number,onChange:(v:number)=>void,reset?:number)=>
    <Knob id={id} name={name} value={Math.round(value*100)} min={min} max={max} step={1} format={pct} defaultValue={reset}
      onChange={n=>onChange(Math.round(n)/100)}/>;

  const userPatterns=useContextTarget(el=>{const pad=el.closest<HTMLElement>('[data-user-pattern]');if(!pad)return null;const slot=Number(pad.dataset.userPattern);return {kind:'library.pattern',label:'User slot '+seq.bank+':'+slot,caps:{copy:()=>{setClip(seq.bank+':'+slot);setMessage('Copied slot '+seq.bank+':'+slot);},details:()=>{set('seq','slot',slot);setSheet('mutate');},library:()=>setSheet('library')}};});
  let controls:ReactNode;
  const hasNotes=(b:number,sl:number)=>{const ptn=state.patterns[b+':'+sl];return !!ptn&&ptn.steps.some(st=>st.length>0);};
  const density=(b:number,sl:number)=>{const ptn=state.patterns[b+':'+sl];if(!ptn)return [] as number[];
    return Array.from({length:8},(_,i)=>{const a=Math.floor(i*ptn.length/8),z=Math.floor((i+1)*ptn.length/8);
      return ptn.steps.slice(a,Math.max(a+1,z)).reduce((n,st)=>n+st.length,0);});};
  const pick=(b:number,sl:number)=>{if(clipEdit)onClipEdit?.(false);if(b!==seq.bank)set('seq','bank',b);if(sl!==seq.slot)set('seq','slot',sl);};
  const padDown=(b:number,sl:number)=>{longPressed.current=false;if(press.current)clearTimeout(press.current);
    press.current=setTimeout(()=>{longPressed.current=true;pick(b,sl);setPadMenu({bank:b,slot:sl});},450);};
  const padUp=()=>{if(press.current)clearTimeout(press.current);press.current=null;};
  if(mode==='seq')controls=<>
    <div className="pf-banks" role="group" aria-label="Pattern bank">
      <button type="button" className={'pf-lib-btn'+(sheet==='library'?' on':'')} aria-label="Library" style={tool('library')}
        title="Factory pattern banks and the pattern chain" onClick={()=>setSheet(sheet==='library'?null:'library')}><BookOpen size={17}/><span>Library</span></button>
      {[1,2,3,4].map(b=><button key={b} type="button" aria-pressed={seq.bank===b} className={seq.bank===b?'on':''}
        aria-label={'Bank '+b} onClick={()=>pick(b,seq.slot)}>{b}{[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16].some(sl=>hasNotes(b,sl))?<i/>:null}</button>)}
    </div>
    <div {...userPatterns} className="pf-pads" role="group" aria-label={'Patterns in bank '+seq.bank}>
      {Array.from({length:16},(_,i)=>{const sl=i+1,on=seq.slot===sl,full=hasNotes(seq.bank,sl),d=density(seq.bank,sl),top=Math.max(1,...d);
        return <button key={sl} data-user-pattern={sl} type="button" data-testid={'pf-pad-'+seq.bank+'-'+sl}
          aria-label={'Pattern '+seq.bank+'·'+sl+(full?'':' (empty)')} aria-pressed={on}
          className={'pf-pad'+(on?' on':'')+(full?' full':'')+((seq.chain_enabled?chainKey===seq.bank+':'+sl:on&&seq.enabled&&playing)?' playing':'')+(seq.chain_enabled&&seq.chain.includes(seq.bank+':'+sl)?' in-structure':'')}
          onPointerDown={()=>padDown(seq.bank,sl)} onPointerUp={padUp} onPointerLeave={padUp} onPointerCancel={padUp}
          onContextMenu={e=>e.preventDefault()}
          onClick={()=>{if(longPressed.current){longPressed.current=false;return;}pick(seq.bank,sl);}}>
          <b>{sl}</b>{full?<span className="pf-dens">{d.map((n,k)=><i key={k} style={{height:Math.max(2,n/top*10)+'px'}}/>)}</span>:null}
        </button>;})}
    </div>
    <p className="pf-info" aria-live="polite">{'Pattern '+seq.bank+'·'+String(seq.slot).padStart(2,'0')+(state.patterns[ref]&&factoryName?' '+factoryName:'')}
      {seq.recording?<b> · rec step {cursor+1}</b>:shownStep<0?null:' · step '+(shownStep+1)}</p>
    <div className="pf-buttons pf-rec-row">
      <button type="button" className={'pf-btn rec'+(seq.recording?' on':'')} aria-pressed={seq.recording}
        onClick={()=>set('seq','recording',!seq.recording)}><CircleDot size={15}/>Step rec</button>
      {seq.recording?<div className="pf-pair">
        <button type="button" className="pf-btn" aria-label="◀ Back" onClick={()=>action('rec_back')}
          title="Go back one step and clear it, so you can record it again">◀</button>
        <button type="button" className="pf-btn" aria-label="Rest ▶" onClick={()=>action('rec_rest')}
          title="Leave this step empty and move on">▶</button></div>
      :<button type="button" className="pf-btn" onClick={()=>set('seq','overdub',!seq.overdub)}
        title="What a recorded key does to a step that already has notes">{seq.overdub?'Overdub':'Replace'}</button>}
    </div>
    <div className="pf-transfers" role="group" aria-label="Pattern and Song transfers">
      <span data-testid="pf-transfer-target">Track {selectedTrack+1} · <button type="button" className={'pf-clip-link'+(clipMode?' on':'')} aria-pressed={clipMode}
        title={clipMode?'Back to editing the pattern':'Edit the notes of Clip '+String.fromCharCode(65+transfer.clip)+' here'}
        onClick={()=>onClipEdit?.(!clipMode)}>Clip {String.fromCharCode(65+transfer.clip)}</button> ↔ Pattern {seq.bank}·{seq.slot}</span>
      <button type="button" aria-label="Pattern → Song" disabled={recording||seq.recording||!edit.events.length}
        title={'Add Pattern '+seq.bank+'·'+seq.slot+' to Track '+(selectedTrack+1)+' Clip '+String.fromCharCode(65+transfer.clip)+', repeating to fill the clip'}
        onClick={()=>transferNotes('commit_song')}>Pattern → Song<small>Add · fill clip</small></button>
      <button type="button" aria-label="Song → Pattern" disabled={recording||seq.recording||!track.notes.length}
        title={'Replace Pattern '+seq.bank+'·'+seq.slot+' with Track '+(selectedTrack+1)+' Clip '+String.fromCharCode(65+transfer.clip)}
        onClick={()=>transferNotes('capture_song')}>Song → Pattern<small>Replace pattern</small></button>
    </div>
  </>;
  else if(mode==='arp')controls=<>
    {power(arp.enabled,'Arp',()=>set('arp','enabled',!arp.enabled))}
    <span className="pf-group-label">Octaves</span>
    <div className="pf-seg pf-seg-fill" role="group" aria-label="Arp octaves">
      {[1,2,3,4].map(o=><button key={o} type="button" aria-pressed={arp.octaves===o} className={arp.octaves===o?'on':''}
        onClick={()=>set('arp','octaves',o)}>{o}</button>)}
    </div>
    <div className="pf-seg pf-seg-fill" role="group" aria-label="Octave direction">
      {([['Up','Up',<ChevronUp key="u" size={14}/>],['Down','Down',<ChevronDown key="d" size={14}/>],['UpDown','Up-Down',null]] as const).map(([v,label,icon])=>
        <button key={v} type="button" aria-pressed={(arp.octave_mode??'Up')===v} className={(arp.octave_mode??'Up')===v?'on':''}
          disabled={arp.octaves<2} title="How the octaves are walked" onClick={()=>set('arp','octave_mode',v)}>{icon}{label}</button>)}
    </div>
    <div className="pf-knobs">
      {pctKnob('pf-arp-gate','Gate',arp.gate,10,90,v=>set('arp','gate',v),75)}
      {pctKnob('pf-arp-swing','Swing',arp.swing,50,75,v=>set('arp','swing',v),50)}
      {pctKnob('pf-arp-spice','Spice',arp.spice,0,100,v=>set('arp','spice',v),0)}
    </div>
    <div className="pf-buttons">
      <button type="button" className={'pf-btn'+(arp.retrigger?' on':'')} aria-pressed={arp.retrigger}
        title="Restart from the first note on every new key" onClick={()=>set('arp','retrigger',!arp.retrigger)}>Retrig</button>
      <button type="button" className="pf-btn" title="Velocity of the arp notes"
        onClick={()=>set('arp','velocity',ARP_VELOCITY[(ARP_VELOCITY.indexOf(arp.velocity??'As played')+1)%3])}>
        {arp.velocity==='Fixed 100'?'Vel 100':arp.velocity==='Accent first'?'Accent':'Vel played'}</button>
      <button type="button" className="pf-btn" style={tool('dice')} disabled={!arp.spice} title={arp.spice?'New spice variation':'Raise Spice first'}
        onClick={()=>set('arp','spice_seed',((arp.spice_seed??1)%1000000)+1)}><Dices size={15}/>Dice</button>
      <button type="button" className="pf-btn" style={tool('seq')} aria-label="To seq" disabled={!lane.length}
        onClick={()=>{action('arp_to_seq');setMessage('Copied into pattern '+seq.bank+'·'+seq.slot+'. Open Seq to edit it.');}} title="Copy one cycle of the arpeggio into the current pattern">
        <Layers3 size={15}/>To seq</button>
    </div>
  </>;
  else if(mode==='chord'){
    controls=<>
    {power(chord.enabled,'Chord',()=>set('chord','enabled',!chord.enabled))}
    <div className="cb-strum cb-card" role="group" aria-label="Strum">
      <span className="cb-card-title"><Waves size={14}/>Strum</span>
      <div className="pf-knobs pf-knobs-1">
        <Knob id="pf-strum" name="Time" value={chord.strum_ms} min={0} max={500} step={5} defaultValue={0} format={n=>Math.round(n)+' ms'}
          onChange={n=>set('chord','strum_ms',Math.round(n))}/>
      </div>
      <div className="pf-seg cb-fill" role="group" aria-label="Strum order">
        {STRUM_ORDER.map(o=><button key={o} type="button" aria-label={o} aria-pressed={chord.strum_type===o} className={chord.strum_type===o?'on':''}
          title={o==='Up-Down'?'Up, then down: with Loop the strum turns round each time':o}
          onClick={()=>set('chord','strum_type',o)}><StrumIcon order={o}/></button>)}
      </div>
      <span className="pf-group-label">Sync to tempo</span>
      <div className="pf-seg pf-seg-grid" role="group" aria-label="Strum sync">
        {STRUM_SYNC.map(o=><button key={o} type="button" aria-pressed={(chord.strum_sync??'Off')===o}
          className={(chord.strum_sync??'Off')===o?'on':''} onClick={()=>set('chord','strum_sync',o)}>{o}</button>)}
      </div>
    </div>
    <div className="cb-card cb-loop-card">
      <span className="cb-card-title"><Repeat size={14}/>Loop</span>
      <div className="cb-loop" role="group" aria-label="Strum loop">
        <button type="button" className={'pf-btn cb-loop-btn'+(chord.loop?' on':'')} aria-pressed={!!chord.loop} aria-label="Loop the strum"
          disabled={arp.enabled} title={arp.enabled?'The arp plays the held chord; Loop is for Chord without the arp'
            :chord.loop?'Loop on: the held chord strums again every '+(chord.loop_rate??'1/4'):'Loop off: one strum, then the chord holds'}
          onClick={()=>set('chord','loop',!chord.loop)}><Repeat size={18}/></button>
        <div className="pf-seg" role="group" aria-label="Loop rate">
          {LOOP_RATES.map(r=><button key={r} type="button" aria-pressed={(chord.loop_rate??'1/4')===r} className={(chord.loop_rate??'1/4')===r?'on':''}
            disabled={!chord.loop||arp.enabled} onClick={()=>set('chord','loop_rate',r)}>{r==='1 bar'?'Bar':r}</button>)}
        </div>
      </div>
    </div>
  </>;}
  else controls=null;

  /* ---------- right: the lane of the chosen mode ---------- */
  const showRange=(base:number)=>{
    const next=performanceRange(device,base);
    if(next.base===gridBase)return;
    edit.cancel();setGridBase(next.base);roll.current?.pitchTo(next.viewTop);
  };
  const gridTools=<>
    <div className="pf-overview-slot" ref={setOverviewSlot}/>
    <div className="pf-seg" role="group" aria-label="What a tap does">
      {(['select','draw','erase','accent'] as NoteTool[]).map(t=><button key={t} type="button" aria-label={t==='select'?'Select notes':t==='draw'?'Draw notes':t==='erase'?'Erase notes':'Accent'} aria-pressed={tap===t}
        className={tap===t?'on':''} onClick={()=>setTap(t)}>{t==='select'?'Select':t==='draw'?'Draw':t==='erase'?'Erase':'Accent'}</button>)}
    </div>
    <div className="pf-seg" role="group" aria-label="Length">
      <button type="button" aria-label="Longer notes" aria-pressed={tap==='length'} className={tap==='length'?'on':''} onClick={()=>setTap('length')}>Longer</button>
      <button type="button" aria-label="Legato notes" title="Legato selected notes, or all notes · Ctrl+L" disabled={!edit.events.length||recording} onClick={()=>edit.action({kind:'legato'})}>Legato</button>
      <button type="button" aria-label="Snap to grid" aria-pressed={edit.snap} title="Snap edits to the grid · Alt+drag for off-grid" className={edit.snap?'on':''} onClick={()=>edit.setSnap(v=>!v)}>Snap</button>
    </div>
    <div className="pf-seg pf-transpose pf-view-oct" role="group" aria-label="Viewed notes">
      <ValueBox label="View" className="pf-vbox" value={gridBase/12-1} min={-1} max={8} step={1} coarse={1}
        format={n=>noteName((Math.round(n)+1)*12)} parse={t=>{const m=/(-?\d+)\s*$/.exec(t);return m?Number(m[1]):null;}}
        title="Notes the grid shows: click, then scroll · hold and drag · two slow clicks to type" onChange={n=>showRange((Math.round(n)+1)*12)}/>
    </div>
  </>;
  // Keys octave (scale.octave): moves what the keys, the arp and the chord pads play, C3 -> C5 at +2.
  const oct=scale.octave??0;
  // Quick double taps step twice even before the engine has answered the first one.
  const shiftOct=(d:number)=>{const next=Math.max(-3,Math.min(3,(octPending.current??oct)+d));octPending.current=next;if(next!==oct)set('scale','octave',next);};
  const transposeTool=<div className="pf-seg pf-transpose" role="group" aria-label="Transpose keys" data-testid="pf-transpose-oct"
    title={'Keys play '+(oct?(oct>0?'+':'−')+Math.abs(oct)+' octave'+(Math.abs(oct)>1?'s':''):'as labelled')+' · C3 sounds '+noteName(48+12*oct)}>
    <ValueBox label="Oct" className={'pf-vbox'+(oct?' on':'')} value={oct} min={-3} max={3} step={1} coarse={1}
      format={n=>n>0?'+'+n:n<0?'−'+Math.abs(n):'0'} parse={t=>{const n=Number(t.replace('−','-'));return Number.isFinite(n)?Math.round(n):null;}}
      title="Keys octave: click, then scroll · hold and drag · two slow clicks to type" onChange={n=>shiftOct(n-(octPending.current??oct))}/>
  </div>;
  const ab=rateParts(arp.division);
  const arpTools=<>
    <div className="pf-seg" role="group" aria-label="Arp rate">
      {SEQ_RATES.map(r=><button key={r} type="button" aria-pressed={ab.base===r} className={ab.base===r?'on':''}
        onClick={()=>set('arp','division',r+ab.feel)}>{r}</button>)}</div>
    <div className="pf-seg" role="group" aria-label="Arp feel">
      {([['','Straight','—'],['T','Triplet','T'],['D','Dotted','D']] as const).map(([f,label,short])=>
        <button key={label} type="button" aria-label={label} aria-pressed={ab.feel===f} className={ab.feel===f?'on':''}
          onClick={()=>set('arp','division',ab.base+f)}>{short}</button>)}</div>
  </>;
  // The keys octave sits in the top bar next to Freeze (Sir, 17 Nov), the same for Seq, Arp and Chord.
  const [octSlot,setOctSlot]=useState<HTMLElement|null>(null);
  useEffect(()=>{setOctSlot(document.getElementById('pf-oct-slot'));},[]);
  let suggestBar:ReactNode=null;

  const chordContext=useContextTarget(el=>{const key=el.closest<HTMLElement>('[data-chord]');if(!key)return null;const notes=JSON.parse(key.dataset.chord!) as number[],raw=key.dataset.raw?JSON.parse(key.dataset.raw) as number[]:notes.map(n=>n-12*keysOct);return {kind:'chord.key',label:'Chord · '+chordText(notes),caps:{play:()=>{notes.forEach((n,i)=>onEditorNote(selectedTrack,'wheel-chord-'+i,n,100));setTimeout(()=>notes.forEach((n,i)=>onEditorNote(selectedTrack,'wheel-chord-'+i,n,0)),180);},invert:()=>setInversion(inversion>=3?0:inversion+1),spread:()=>set('chord','spread',chord.spread===3?4:3),chordType:()=>setExt(CHORD_EXTS[(CHORD_EXTS.findIndex(([v])=>v===ext)+1)%CHORD_EXTS.length][0]),saveChord:()=>saveSlot(raw)}};});
  const grid=<PianoRoll key={viewKey+(clipMode?':clip':'')} ref={roll} compact pitchBase={gridBase} edit={edit} target={noteTarget} bounds={noteBounds} context={noteContext} playing={clipMode?clipPlaying:currentStep>=0} beatAt={clipMode?p=>clipClock?.(p)?.beat??p.clipBeat:()=>shownStep} recording={recording} scale={device==='drum_rack'?{name:'Chromatic',root:0}:scale} onTime={time=>setPage(Math.min(pages-1,Math.floor(time/pageSize)))} onPlayFrom={clipMode?undefined:beat=>onCommand('play_from',beat)} overviewSlot={overviewSlot}/>;

  let laneView:ReactNode;
  const rb=rateParts(pat.division);
  const expandButton=<button type="button" aria-label={noteEditorOpen?'Restore compact notes':'Expand notes'} aria-expanded={noteEditorOpen}
      style={tool('more')} onClick={()=>{edit.cancel();setNoteEditorOpen(v=>!v);}}>{noteEditorOpen?<Minimize2 size={18}/>:<Maximize2 size={18}/>}<span>{noteEditorOpen?'Restore':'Expand'}</span></button>;
  // Clip notes: the same grid and tools, without the pattern-only actions (those rewrite a SEQ slot in the engine).
  const clipRail=<div className="pf-rail" role="toolbar" aria-label="Clip note tools">
    <button type="button" className="primary" style={tool('library')} aria-label="Back to pattern" title={'Edit Pattern '+seq.bank+'·'+seq.slot+' again'} onClick={()=>onClipEdit?.(false)}><Layers3 size={18}/><span>Pattern</span></button>
    <button type="button" style={tool('nudge')} aria-label="Quantize notes" disabled={!edit.events.length||recording} title="Snap selected notes, or all notes when none are selected" onClick={()=>edit.action({kind:'quantize'})}><b>Q</b><span>Quantize</span></button>
    <button type="button" style={tool('more')} aria-label="Select all notes" disabled={!edit.events.length} onClick={()=>edit.selectAll()}><ListChecks size={18}/><span>All</span></button>
    <button type="button" aria-label="Fit notes" style={tool('more')} onClick={()=>roll.current?.fit()}><Scan size={18}/><span>Fit</span></button>
    {expandButton}
    <NoteShortcuts compact/>
  </div>;
  const rail=clipMode?clipRail:<div className="pf-rail" role="toolbar" aria-label="Pattern tools">
    <button type="button" className="primary" style={tool('mutate')} aria-label="Mutate" title={'Mutate the pattern ('+pct(strength*100)+')'} onClick={()=>action('mutate',strength)}><Shuffle size={18}/><span>Mutate</span></button>
    <button type="button" style={tool('reset')} aria-label="Reset" title="Undo the mutations" onClick={()=>action('reset_mutate')}><RotateCcw size={18}/><span>Reset</span></button>
    <button type="button" style={tool('double')} aria-label="×2 length" title="Double the length" onClick={()=>action('double')}><b>×2</b><span>Length</span></button>
    <button type="button" style={tool('more')} aria-label={'More pattern tools'} className={sheet==='mutate'?'on':''} title="Amount, transpose, song and clear" onClick={()=>setSheet(sheet==='mutate'?null:'mutate')}><MoreHorizontal size={18}/><span>More</span></button>
    <button type="button" style={tool('nudge')} aria-label="◀ Nudge" title="Move every note one step earlier" onClick={()=>action('nudge',-1)}><ChevronsLeft size={18}/><span>Earlier</span></button>
    <button type="button" style={tool('nudge')} aria-label="Nudge ▶" title="Move every note one step later" onClick={()=>action('nudge',1)}><ChevronsRight size={18}/><span>Later</span></button>
    <button type="button" style={tool('oct')} aria-label="Oct −" title="Everything an octave down" onClick={()=>action('octave',-1)}><b>−8</b><span>Oct</span></button>
    <button type="button" style={tool('oct')} aria-label="Oct +" title="Everything an octave up" onClick={()=>action('octave',1)}><b>+8</b><span>Oct</span></button>
    <button type="button" style={tool('dice')} aria-label="Dice" disabled={!seq.spice} title={seq.spice?'New spice variation':'Raise Spice first'}
      onClick={()=>set('seq','spice_seed',(seq.spice_seed%1000000)+1)}><Dices size={18}/><span>Dice</span></button>
    <button type="button" aria-label="Fit notes" style={tool('more')} onClick={()=>roll.current?.fit()}><Scan size={18}/><span>Fit</span></button>
    {expandButton}
    <NoteShortcuts compact/>
  </div>;
  const timing=<div className="pf-bar" data-testid="pf-seq-timing" data-length={pat.length} data-division={pat.division}>
    <button type="button" className={'pf-power'+(seq.enabled?' on':'')} aria-pressed={seq.enabled}
      aria-label={seq.enabled?'Sequencer on':'Turn sequencer on'} onClick={()=>set('seq','enabled',!seq.enabled)}><Power size={16}/>Seq</button>
    <div className="pf-seg" role="group" aria-label="Sequencer rate">
      {SEQ_RATES.map(b=><button key={b} type="button" aria-pressed={rb.base===b} className={rb.base===b?'on':''}
        onClick={()=>set('seq','division',b+rb.feel)}>{b}</button>)}</div>
    <div className="pf-seg" role="group" aria-label="Sequencer feel">
      {([['','Straight','—'],['T','Triplet','T'],['D','Dotted','D']] as const).map(([f,label,short])=>
        <button key={label} type="button" aria-label={label} aria-pressed={rb.feel===f} className={rb.feel===f?'on':''}
          onClick={()=>set('seq','division',rb.base+f)}>{short}</button>)}</div>
    <div className="pf-seg" role="group" aria-label="Pattern steps">
      <ChoiceList values={STEP_CHOICES} value={pat.length} onChange={n=>set('seq','length',n)} columns={4} testId="pf-steps-list"
        className="pf-steps-list" label="Pattern steps list" title={'Pattern length · '+(pat.length*(RATE_BEATS[pat.division]??.25)/4).toFixed(2).replace(/\.?0+$/,'')+' bars at '+pat.division}
        trigger={<ListOrdered size={16} aria-hidden="true"/>} choice={n=>String(n)}/>
      <ValueBox label="Pattern steps" hideLabel className="pf-vbox" value={pat.length} min={1} max={256} step={1} coarse={4}
        format={n=>n+' steps'} onChange={n=>set('seq','length',n)}/></div>
    <div className="pf-bar-knobs">
      {pctKnob('pf-seq-swing','Swing',seq.swing,50,75,v=>set('seq','swing',v),50)}
      {pctKnob('pf-seq-gate','Gate',seq.gate,10,90,v=>set('seq','gate',v),80)}
      {pctKnob('pf-seq-spice','Spice',seq.spice,0,100,v=>set('seq','spice',v),0)}
    </div>
  </div>;
  const clipBar=<div className="pf-bar pf-clip-bar" data-testid="pf-clip-bar">
    <span className="pf-clip-title"><b>Clip {String.fromCharCode(65+transfer.clip)}</b> · Track {selectedTrack+1} · {transfer.bars} {transfer.bars===1?'bar':'bars'} · {edit.events.length} notes</span>
    <span className="pf-clip-hint">{recording?'Finish the take to edit':edit.status||(clipPlaying?'Playing from the Song':'The Song plays these notes')}</span>
    <button type="button" className="pf-clip-back" onClick={()=>onClipEdit?.(false)}><Layers3 size={15}/>Pattern {seq.bank}·{seq.slot}</button>
  </div>;
  if(mode==='seq')laneView=<>
    <div className="pf-seq-main">{grid}{rail}</div>
    {clipMode?clipBar:timing}
  </>;
  else if(mode==='arp'){
    // The real pattern as a small piano roll: columns are steps, rows are the pitches the arp walks through.
    const example=!lane.length;
    const groups=example?arpOrder([60,64,67],arp.mode,arp.octaves,arp.octave_mode):lane;
    const cycle=arp.retrigger?arp.length:groups.length;
    const cols=Math.max(1,Math.min(32,cycle));
    const shown=Array.from({length:cols},(_,i)=>groups[i%Math.max(1,groups.length)]??[]);
    const pitches=[...new Set(shown.flat())].sort((x,y)=>y-x);
    const phase=arpView&&arpView.groups.length&&arpView.phase!==undefined?arpView.phase:laneStep;
    const now=arp.enabled&&!example&&phase>=0?phase%cols:-1;
    laneView=<>
      <div className="pf-modes" role="group" aria-label="Arp pattern">
        {MODES.map(m=><button key={m} type="button" aria-pressed={arp.mode===m} className={arp.mode===m?'on':''}
          onClick={()=>set('arp','mode',m)}>{m==='User Sequence'?'From seq':m}</button>)}
      </div>
      <div className={'pf-roll'+(example?' example':'')} aria-label="Arpeggio steps" data-testid="arp-roll" data-notes={example?'':held.join(',')}
        style={{['--cols' as string]:cols,['--rows' as string]:Math.max(1,pitches.length)}}>
        <div className="pf-roll-head"><span/>{shown.map((g,i)=><span key={i} data-names={g.map(noteName).join(' ')} className={(i%4===0?'beat':'')+(i===now?' live':'')}>{i+1}</span>)}</div>
        {pitches.map(n=><div key={n} className={'pf-roll-row'+(BLACK.has(n%12)?' black':'')}>
          <button type="button" className="pf-row-note" aria-label={'Play '+noteName(n)}
            onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);edit.play(n,100,e.pointerId);}}
            onPointerUp={edit.stop} onPointerCancel={edit.stop}
            onContextMenu={e=>e.preventDefault()}>{noteName(n)}</button>
          {shown.map((g,i)=><span key={i} data-step={i} className={'pf-roll-cell'+(i%4===0?' beat':'')+(i===now?' live':'')}>
            {g.includes(n)?<i className={'pf-arp-note'+(i===now?' active':'')} style={{width:'calc('+Math.round(arp.gate*100)+'% - 2px)'}}/>:null}</span>)}
        </div>)}
        {example?<em className="pf-roll-hint">{arp.enabled?'Example for C E G. Hold keys below to play your own.':'Example for C E G. Turn the arp on and hold keys below.'}</em>:null}
      </div>
      <div className="pf-bar" data-testid="arp-timing" data-length={arp.length} data-division={arp.division}>
        <span className="pf-group-label">Steps</span>
        <div className="pf-seg" role="group" aria-label="Arp steps">
          {/* the same pick list as Seq (Sir, 16 Nov), up to the arp's 64 steps */}
          <ChoiceList values={STEP_CHOICES.filter(n=>n<=64)} value={arp.length} onChange={n=>set('arp','length',n)} columns={4} testId="pf-arp-steps-list"
            className="pf-steps-list" label="Arp steps list" title="Arp cycle length in steps" trigger={<ListOrdered size={16} aria-hidden="true"/>} choice={n=>String(n)}/>
          <ValueBox label="Arp steps" hideLabel className="pf-vbox" value={arp.length} min={1} max={64} step={1} coarse={4}
            format={n=>n+' steps'} onChange={n=>set('arp','length',n)}/></div>
        <button type="button" className={'pf-btn'+(arp.restart_bar?' on':'')} aria-pressed={!!arp.restart_bar}
          title="Start the pattern again on every bar line" onClick={()=>set('arp','restart_bar',!arp.restart_bar)}><RotateCcw size={15}/>Restart on bar</button>
        <p className="pf-roll-info" aria-live="polite">{!arp.enabled?'Arp off':example?'Hold keys to start'
          :held.map(noteName).join(' ')+(arpView?.paused?' · paused (Resume carries on, a key starts again)':now>=0?' · step '+(now+1)+' / '+cycle:'')}{arp.retrigger?'':' · free running'}</p>
      </div>
    </>;
  }
  else{
    // Press a pad or a saved chord to play it; slide the finger across to play the next one (no saving by holding).
    const chordAt=(x:number,y:number)=>(document.elementFromPoint(x,y) as HTMLElement|null)?.closest<HTMLElement>('[data-src]')??null;
    const srcOf=(el:HTMLElement):ChordSrc=>({id:el.dataset.src!,raw:JSON.parse(el.dataset.raw!) as number[]});
    const stopHold=()=>{if(press.current)clearTimeout(press.current);press.current=null;padOff();};
    const swipe=(menu:boolean)=>({
      onPointerDown:(e:React.PointerEvent<HTMLDivElement>)=>{
        if(e.button!==0)return;const el=(e.target as HTMLElement).closest<HTMLElement>('[data-src]');if(!el)return;
        e.currentTarget.setPointerCapture(e.pointerId);longPressed.current=false;chordOn(srcOf(el));
        if(press.current)clearTimeout(press.current);
        if(menu&&el.dataset.slot)press.current=setTimeout(()=>{longPressed.current=true;padOff();setSlotMenu(Number(el.dataset.slot));},600);},
      onPointerMove:(e:React.PointerEvent<HTMLDivElement>)=>{
        if(!holding.current||!e.currentTarget.hasPointerCapture(e.pointerId))return;
        const el=chordAt(e.clientX,e.clientY);
        if(el&&el.dataset.src!==holding.current.id){if(press.current)clearTimeout(press.current);press.current=null;chordOn(srcOf(el));}},
      onPointerUp:stopHold,onPointerCancel:stopHold,
      onContextMenu:(e:React.MouseEvent)=>e.preventDefault(),
    });
    const advance=chord.advance??'Key';
    const readRaw=following?slots[nowSlot>=0?nowSlot:nextSlot]:active?.raw??[];
    suggestBar=(
      <div className="cb-suggest" role="group" aria-label="Chord suggestions">
        <span className="cb-card-title cb-suggest-title"><Lightbulb size={14}/>Suggest</span>
        <ValueBox label="Tension" hideLabel className={'pf-vbox cb-tension'+(tension?' on':'')} value={tension} min={0} max={6} step={1} coarse={1} live
          title="How far the suggested chords are from the last one: scale steps up and down (0 is off). Click, then scroll · hold and drag · two slow clicks to type"
          format={n=>n?'Tension '+n:'Tension off'} onChange={v=>set('chord','tension',Math.max(0,Math.min(6,Math.round(v))))}/>
        <span className="cb-suggest-info">{!tension?'Turn Tension up to see chords that can follow':baseDegree<0?'Tap a chord to get suggestions'
          :'After '+pads[baseDegree].name+' · '+tension+' step'+(tension>1?'s':'')+' away'}</span>
        <div {...swipe(false)} className="cb-suggest-chips">
          {suggestions.map(d=>{const c=pads[d],id='pad-'+d;return <button key={id} type="button" data-src={id} data-raw={JSON.stringify(padRaw(d))}
            className={'cb-chip'+(pressed===id?' sounding':'')} aria-label={'Play suggested '+c.roman+' '+c.name}>
            <Lightbulb size={13}/><b>{c.roman}</b><strong>{c.name}</strong></button>;})}
        </div>
      </div>);
    laneView=<div className="cb">
      <div {...chordContext} {...swipe(false)} className="cb-pads" role="group" aria-label={'Chords in '+ROOTS[scale.root]+' '+(scale.name==='Chromatic'?'major':scale.name)}
        style={{['--pads' as string]:pads.length}}>
        {pads.map(c=>{const id='pad-'+c.degree;
          return <button key={id} type="button" data-src={id} data-raw={JSON.stringify(padRaw(c.degree))} data-chord={JSON.stringify(c.notes)} data-testid={'cb-pad-'+c.roman} aria-label={'Play '+c.roman+' '+c.name}
            className={'cb-pad'+(active?.id===id?' on':'')+(pressed===id?' sounding':'')+(suggestions.includes(c.degree)?' suggest':'')}>
            {suggestions.includes(c.degree)?<em className="cb-hint-badge"><Lightbulb size={11}/></em>:null}
            <b>{c.roman}</b><strong>{c.name}</strong><ChordDots notes={c.notes}/><span>{chordText(c.notes)}</span></button>;})}
      </div>
      <div className="cb-card cb-voicing" role="group" aria-label="Voicing">
      <span className="cb-card-title"><Combine size={14}/>Voicing</span>
      <div className="cb-row">
        <span className="pf-group-label cb-label">Type</span>
        <div className="pf-seg cb-fill" role="group" aria-label="Chord type">
          {CHORD_EXTS.map(([id,label])=><button key={id} type="button" aria-pressed={ext===id} className={ext===id?'on':''}
            onClick={()=>setExt(id)}>{label}</button>)}
        </div>
        <div className="pf-seg cb-inv" role="group" aria-label="Inversion">
          {chord.voicing?<button type="button" className="pf-vbox cb-auto" title="Voice lead picks the inversion nearest the last chord. Tap to choose it yourself."
            onClick={()=>set('chord','voicing',false)}>Inv auto</button>
          :<ValueBox label="Inversion" hideLabel className="pf-vbox" value={inversion} min={-3} max={3} step={1} coarse={1} live
            format={n=>n===0?'Root':(n>0?'Inv +':'Inv −')+Math.abs(n)} onChange={setInversion}/>}
        </div>
        <button type="button" className={'pf-btn'+(chord.voicing?' on':'')} aria-pressed={chord.voicing}
          title="Move chord voices as little as possible between chords" onClick={()=>set('chord','voicing',!chord.voicing)}>Voice lead</button>
      </div>
      <div className="cb-row">
        <span className="pf-group-label cb-label">Voices</span>
        <div className="pf-seg cb-fill" role="group" aria-label="Voices">
          {VOICES.map(v=>{const on=chord.spread===v||(v===0&&chord.spread>6);return <button key={v} type="button" aria-pressed={on} className={on?'on':''}
            onClick={()=>set('chord','spread',v)}>{v?v:'All'}</button>;})}
        </div>
        <span className="pf-group-label cb-label cb-label-mid">Bass</span>
        <div className="pf-seg cb-fill" role="group" aria-label="Bass note">
          {[0,1,2,3].map(v=><button key={v} type="button" aria-pressed={(chord.bass??0)===v} className={(chord.bass??0)===v?'on':''}
            aria-label={v?'Bass −'+v+' octave':'Bass off'} onClick={()=>set('chord','bass',v)}>{v?'−'+v:'Off'}</button>)}
        </div>
      </div>
      </div>
      <div className={'cb-seq cb-card'+(following?' following':'')}>
        <span className="cb-card-title"><ListMusic size={14}/>My chords</span>
        <div className="cb-seq-head">
          <button type="button" className={'pf-power cb-follow'+(chord.follow?' on':'')} aria-pressed={!!chord.follow} data-testid="cb-follow"
            disabled={!chord.follow&&!filledSlots.length} title={filledSlots.length?'Each key plays the next saved chord':'Save a chord first'}
            onClick={()=>{if(!chord.enabled&&!chord.follow)set('chord','enabled',true);set('chord','follow',!chord.follow);}}><ListMusic size={16}/>Play in order</button>
          <div className="pf-seg" role="group" aria-label="Next chord on">
            {CHORD_ADVANCE.map(o=><button key={o} type="button" aria-pressed={advance===o} className={advance===o?'on':''} disabled={!chord.follow}
              title={o==='Key'?'Every new key plays the next chord':'While a key is down, the chord changes every '+o+' (transport running)'}
              onClick={()=>set('chord','advance',o)}>{o==='Key'?'Each key':'Every '+o}</button>)}
          </div>
          <div className="cb-readout" aria-live="polite" data-testid="cb-display"
            title={!chord.enabled?'Chord off':following?(nowSlot>=0?'Playing my chord '+(nowSlot+1):'Next: my chord '+(nextSlot+1)):'What the keys play'}>
            <strong>{nameOf(readRaw)||'—'}</strong><em>{readRaw.length?chordText(shown(readRaw)):''}</em>
          </div>
          <button type="button" className="pf-btn cb-save-held" disabled={!held.length}
            title="Hold keys, then tap to keep them in My chords"
            onClick={()=>saveSlot((chord.enabled&&chord.bass?[...held].sort((a,b)=>a-b).slice(1):held).map(n=>n-12*keysOct))}><Fingerprint size={15}/>Save held</button>
        </div>
        <div {...chordContext} {...swipe(true)} className="cb-slots" role="group" aria-label="My chords">
          {slots.map((c,i)=>{const id='slot-'+i,now=nowSlot===i,next=!now&&nextSlot===i&&following;
            return c.length?<button key={id} type="button" data-src={id} data-slot={i} data-raw={JSON.stringify(c)} data-chord={JSON.stringify(shown(c))} data-testid={'cb-slot-'+(i+1)}
              aria-label={'Play my chord '+(i+1)+' '+nameOf(c)}
              className={'cb-slot full'+(pressed===id?' sounding':'')+(active?.id===id?' on':'')+(now?' now':'')+(next?' next':'')}>
              <i>{i+1}</i><strong>{nameOf(c)}</strong><span>{chordText(shown(c))}</span>{next?<em>next</em>:null}</button>
            :<button key={id} type="button" data-testid={'cb-slot-'+(i+1)} className="cb-slot" disabled={!active}
              aria-label={'Save to my chord '+(i+1)} title={active?'Keep '+nameOf(active.raw)+' here':'Tap a chord first'}
              onClick={()=>{if(active)saveSlot(active.raw,i);}}><Plus size={14}/>{active&&i===slots.findIndex(x=>!x.length)?nameOf(active.raw):i+1}</button>;})}
          {slotMenu!==null?<div className="pf-pad-menu cb-slot-menu" role="menu" aria-label={'My chord '+(slotMenu+1)}
            onPointerDown={e=>e.stopPropagation()}>
            <strong>My chord {slotMenu+1}</strong>
            <button type="button" role="menuitem" disabled={!active||active.id==='slot-'+slotMenu}
              onClick={()=>{if(active)saveSlot(active.raw,slotMenu);setSlotMenu(null);}}>{active&&active.id!=='slot-'+slotMenu?'Put '+nameOf(active.raw)+' here':'Replace'}</button>
            <button type="button" role="menuitem" className="danger" onClick={()=>{action('clear_slot',slotMenu);setSlotMenu(null);}}>Clear</button>
            <button type="button" role="menuitem" aria-label="Close" onClick={()=>setSlotMenu(null)}><X size={16}/></button>
          </div>:null}
        </div>
      </div>
    </div>;
  }

  return <ContextAreaScope area={mode==='chord'?'chord':mode==='arp'?'arp':'perform'}><section className={"pf pf-mode-"+mode+(keyboardShown?'':' keyboard-folded')+(noteEditorOpen?' notes-expanded':'')} aria-label="Perform"
    onKeyDown={e=>{if(e.key==='Escape'&&!e.defaultPrevented&&noteEditorOpen){e.preventDefault();setNoteEditorOpen(false);}}}>
    {generation.panel}
    <header className="pf-head">
      <div className="pf-tabs" role="tablist" aria-label="Perform mode">
        {([['seq','Seq',<Layers3 size={16}/>,seq.enabled],['arp','Arp',<Waves size={16}/>,arp.enabled],
          ['chord','Chord',<Combine size={16}/>,chord.enabled]] as const)
          .map(([id,label,icon,on])=><button key={id} type="button" role="tab" aria-selected={mode===id}
            className={(mode===id?'active':'')+(on?' live':'')} style={{['--sec' as string]:'var(--c-'+id+')'}} onClick={()=>{setMode(id);if(id!=='seq'&&clipEdit)onClipEdit?.(false);setNoteEditorOpen(false);setSheet(null);setSlotMenu(null);}}>
            {icon}<span>{label}</span><i className="pf-led"/></button>)}
      </div>
      <div className="pf-head-tools">{mode==='arp'?arpTools:mode==='chord'?suggestBar:gridTools}</div>
      {octSlot?createPortal(transposeTool,octSlot):null}
      <button type="button" className={'pf-tool pf-scale-btn'+(sheet==='scale'?' on':'')} aria-label="Key and scale" style={tool('scale')}
        onClick={()=>setSheet(sheet==='scale'?null:'scale')}><b>{ROOTS[scale.root]}</b><span>{scale.name}</span><ChevronDown size={14}/></button>
      <button type="button" className={'pf-tool pf-midi-btn'+(sheet==='midi'?' on':'')} style={tool('midi')} onClick={()=>setSheet(sheet==='midi'?null:'midi')}>
        <SlidersHorizontal size={15}/>MIDI</button>
    </header>
    <div className="pf-body">
      <div className={'pf-ctl pf-ctl-'+mode}>{controls}</div>
      {padMenu?<div className="pf-pad-menu" role="menu" aria-label={'Pattern '+padMenu.bank+'·'+padMenu.slot}>
        <strong>Pattern {padMenu.bank}·{padMenu.slot}</strong>
        <button type="button" role="menuitem" onClick={()=>{setClip(padMenu.bank+':'+padMenu.slot);setPadMenu(null);
          setMessage('Copied pattern '+padMenu.bank+'·'+padMenu.slot+'. Long-press another pad to paste.');}}>Copy</button>
        <button type="button" role="menuitem" disabled={!clip||clip===padMenu.bank+':'+padMenu.slot}
          onClick={()=>{action('paste_pattern',clip);setPadMenu(null);}}>Paste{clip?' '+clip.replace(':','·'):''}</button>
        <button type="button" role="menuitem" className="danger" onClick={()=>{action('clear');setPadMenu(null);}}>Clear</button>
        <button type="button" role="menuitem" aria-label="Close" onClick={()=>setPadMenu(null)}><X size={16}/></button>
      </div>:null}
      <div className={'pf-lane pf-lane-'+mode}>{laneView}
        {message?<span className="pf-msg" role="status">{message}</span>:null}</div>
      {sheet==='library'?<PatternLibrary patterns={state.patterns} trackIndex={selectedTrack} track={track} pattern={pat} seq={seq} playing={playing} recording={recording} status={catalogStatus} send={onCommand} close={closeSheet}/>:sheet?<div className={'pf-sheet pf-sheet-'+sheet} role="dialog" aria-label={SHEET_TITLE[sheet]}>
        <header><strong>{SHEET_TITLE[sheet]}</strong>
          <button type="button" aria-label="Close" onClick={()=>setSheet(null)}><X size={16}/></button></header>
        {sheet==='scale'?<div className="pf-scale-sheet">
          <span className="pf-sheet-label">Key</span>
          <div className="pf-roots">{ROOTS.map((r,i)=><button key={r} type="button" aria-pressed={scale.root===i}
            className={scale.root===i?'on':''} onClick={()=>set('scale','root',i)}>{r}</button>)}</div>
          <span className="pf-sheet-label">Scale</span>
          <div className="pf-scales">{Object.keys(SCALES).map(n=><button key={n} type="button" aria-pressed={scale.name===n}
            className={scale.name===n?'on':''} onClick={()=>{set('scale','name',n);setSheet(null);}}>{n}</button>)}</div>
        </div>:sheet==='mutate'?<div className="pf-mutate-sheet">
          <div className="pf-knobs">
            {pctKnob('pf-mutate','Amount',strength,0,100,setStrength,35)}
            <Knob id="pf-transpose" name="Transpose" value={seq.transpose} min={-24} max={24} step={1} defaultValue={0}
              format={n=>(Math.round(n)>0?'+':'')+Math.round(n)} onChange={n=>{const v=Math.round(n);if(v!==seq.transpose)set('seq','transpose',v);}}/>
          </div>
          <div className="pf-buttons">
            <button type="button" className="pf-btn danger wide" onClick={()=>{if(confirm('Clear this pattern?'))action('clear');}}>Clear pattern</button>
          </div>
        </div>:sheet==='midi'?<div className="pf-sheet-grid">
          <label className="pf-pick"><span>Octave shift</span><select value={scale.octave} onChange={e=>set('scale','octave',Number(e.target.value))}>
            {[-3,-2,-1,0,1,2,3].map(o=><option key={o} value={o}>{o>0?'+'+o:o}</option>)}</select></label>
          <label className="pf-pick"><span>Velocity</span><select value={scale.velocity_curve} onChange={e=>set('scale','velocity_curve',e.target.value)}>
            {['Linear','Logarithmic','Exponential','Fixed 100'].map(o=><option key={o}>{o}</option>)}</select></label>
          <label className="pf-pick"><span>Input channel</span><select value={scale.input_channel} onChange={e=>set('scale','input_channel',Number(e.target.value))}>
            {Array.from({length:17},(_,i)=><option key={i} value={i}>{i?'Channel '+i:'All'}</option>)}</select></label>
          <label className="pf-pick"><span>Clock</span><select value={sync.source} onChange={e=>set('sync','source',e.target.value)}>
            {['Internal','USB MIDI','Auto'].map(o=><option key={o}>{o}</option>)}</select></label>
          <button type="button" className={'pf-btn'+(sync.receive_transport?' on':'')} onClick={()=>set('sync','receive_transport',!sync.receive_transport)}>
            MIDI start/stop {sync.receive_transport?'on':'off'}</button>
          <button type="button" className="pf-btn" onClick={tapTempo}>Tap tempo{tapTimes.length?' ('+tapTimes.length+')':''}</button>
        </div>:null}
      </div>:null}
    </div>
    <div className="pf-performance-controls">
      <button type="button" className={'pf-tool'+(arp.hold?' on':'')} aria-pressed={arp.hold}
        onClick={()=>set('arp','hold',!arp.hold)} title="Keep the arpeggio going after you let go">Hold</button>
      <button type="button" className="pf-tool" aria-label={(keyboardShown?'Hide':'Show')+' playable keyboard'}
        title={(keyboardShown?'Hide':'Show')+' playable keyboard'} aria-controls={keyboardId} aria-expanded={keyboardShown}
        onClick={()=>{edit.cancel();if(noteEditorOpen){setNoteEditorOpen(false);setKeyboardVisible(true);}else setKeyboardVisible(v=>!v);}}><Keyboard size={20}/></button>
    </div>
    {keyboardShown&&<TouchKeys key={viewKey} id={keyboardId} base={viewRange.keyboardBase} keyCount={viewRange.keyCount} held={held} sounding={sounding} channel={channel} onMidi={onMidi}
      chord={(mode==='chord'||chord.enabled)&&outline?.length?outline:null}
      scale={scale.name==='Chromatic'?null:new Set((SCALES[scale.name]??[]).map(d=>(d+scale.root)%12))}/>}
  </section></ContextAreaScope>;
}

/* ---------- touch keyboard and expression strips ---------- */
/** Layers, top first: keys you press > notes the arp/seq sounds > held keys > the chord outline > the scale tint. */
function TouchKeys({id,base,keyCount,held,sounding,channel,onMidi,chord,scale}:{id:string;base:number;keyCount:number;held:number[];sounding:Set<number>;channel:number;
  onMidi:(s:number,a:number,b:number)=>void;chord:number[]|null;scale:Set<number>|null}){
  const [down,setDown]=useState<number[]>([]);
  const pointers=useRef(new Map<number,number>());
  const ownerChannel=useRef(channel),sendMidi=useRef(onMidi);sendMidi.current=onMidi;
  const keys=Array.from({length:keyCount},(_,i)=>base+i).filter(n=>n<=127);
  const whites=keys.filter(n=>!BLACK.has(n%12));
  const heldSet=new Set(held);
  const chordSet=new Set(chord??[]);const chordRoot=chord?.[0];
  const layers=(n:number)=>(scale&&scale.has(n%12)?' in-scale':'')+(chordSet.has(n)?' chord':'')+(n===chordRoot?' chord-root':'')
    +(heldSet.has(n)?' held':'')+(sounding.has(n)?' sound':'')+(down.includes(n)?' down':'');
  const sync=()=>setDown([...new Set(pointers.current.values())]);
  const noteAt=(x:number,y:number)=>{
    const el=document.elementFromPoint(x,y) as HTMLElement|null;
    const n=el?.closest<HTMLElement>('[data-note]')?.dataset.note;
    return n===undefined?null:Number(n);
  };
  const velocityAt=(y:number,el:Element|null)=>{
    if(!el)return 100;const r=el.getBoundingClientRect();
    return clamp(Math.round(40+87*((y-r.top)/Math.max(1,r.height))),1,127);
  };
  const press=(id:number,note:number,vel:number)=>{
    const old=pointers.current.get(id);
    if(old===note)return;
    if(old!==undefined&&![...pointers.current.entries()].some(([k,v])=>k!==id&&v===old))sendMidi.current(0x80|ownerChannel.current,old,0);
    pointers.current.set(id,note);
    sendMidi.current(0x90|ownerChannel.current,note,vel);sync();
  };
  const release=(id:number)=>{
    const old=pointers.current.get(id);
    pointers.current.delete(id);
    if(old!==undefined&&![...pointers.current.values()].includes(old))sendMidi.current(0x80|ownerChannel.current,old,0);
    sync();
  };
  const releaseAll=()=>{for(const id of [...pointers.current.keys()])release(id);};
  useEffect(()=>{releaseAll();ownerChannel.current=channel;},[base,channel]);
  useEffect(()=>{window.addEventListener('blur',releaseAll);return()=>{window.removeEventListener('blur',releaseAll);releaseAll();};},[]);

  return <div id={id} className="pf-keys">
    <span aria-hidden="true"/>
    <div className="pf-piano" role="group" aria-label="Touch keyboard"
      onPointerDown={e=>{if(e.button!==0)return;const n=noteAt(e.clientX,e.clientY);if(n===null)return;
        e.currentTarget.setPointerCapture(e.pointerId);
        press(e.pointerId,n,velocityAt(e.clientY,(e.target as HTMLElement).closest('[data-note]')));}}
      onPointerMove={e=>{if(!pointers.current.has(e.pointerId))return;const n=noteAt(e.clientX,e.clientY);
        if(n!==null)press(e.pointerId,n,velocityAt(e.clientY,(e.target as HTMLElement).closest('[data-note]')));}}
      onPointerUp={e=>release(e.pointerId)} onPointerCancel={e=>release(e.pointerId)}
      onLostPointerCapture={e=>release(e.pointerId)}
      onContextMenu={e=>e.preventDefault()}>
      {whites.map(n=><span key={n} data-note={n} className={'pf-white'+layers(n)}>
        {n%12===0?<em>{noteName(n)}</em>:null}</span>)}
      {keys.filter(n=>BLACK.has(n%12)).map(n=>{
        const left=whites.filter(w=>w<n).length;
        return <span key={n} data-note={n} style={{left:'calc('+(left/whites.length*100)+'% - '+(100/whites.length*.31)+'%)',width:(100/whites.length*.62)+'%'}}
          className={'pf-black'+layers(n)}/>;
      })}
    </div>
    <Strip label="Pitch" center onValue={v=>{
      // A small dead zone round the middle: a finger that lands near the centre doesn't detune the note.
      const d=v-.5,w=Math.abs(d)<.05?.5:.5+Math.sign(d)*(Math.abs(d)-.05)/.45*.5;
      const b=Math.min(16383,Math.round(w*16384));onMidi(0xe0|channel,b&127,b>>7);}}/>
    <Strip label="Mod" onValue={v=>onMidi(0xb0|channel,1,Math.round(v*127))}/>
    <Strip label="AT" spring onValue={v=>onMidi(0xd0|channel,Math.round(v*127),0)}/>
  </div>;
}

/** A vertical touch strip. Pitch springs back to the middle, AT back to zero, Mod stays where you leave it. */
function Strip({label,onValue,center=false,spring=false}:{label:string;onValue:(v:number)=>void;center?:boolean;spring?:boolean}){
  const rest=center?.5:0;
  const [value,setValue]=useState(rest);
  const active=useRef(false);
  const latestValue=useRef(onValue);latestValue.current=onValue;
  const move=(e:React.PointerEvent<HTMLDivElement>)=>{
    const r=e.currentTarget.getBoundingClientRect();
    const v=clamp(1-(e.clientY-r.top)/Math.max(1,r.height),0,1);
    setValue(v);onValue(v);
  };
  const end=()=>{if(!active.current)return;active.current=false;if(center||spring){setValue(rest);latestValue.current(rest);}};
  useEffect(()=>{window.addEventListener('blur',end);return()=>{window.removeEventListener('blur',end);end();};},[]);
  return <div className="pf-strip">
    <span>{label}</span>
    <div className={'pf-strip-track'+(center?' center':'')} role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(value*100)}
      onPointerDown={e=>{active.current=true;e.currentTarget.setPointerCapture(e.pointerId);move(e);}}
      onPointerMove={e=>{if(active.current)move(e);}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
      <i className="pf-strip-fill" style={center?{bottom:Math.min(value,.5)*100+'%',height:Math.abs(value-.5)*100+'%'}:{height:value*100+'%'}}/>
      <b style={{bottom:'calc('+value*100+'% - 9px)'}}/>
    </div>
  </div>;
}
