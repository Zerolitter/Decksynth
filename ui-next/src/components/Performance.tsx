import {useNoteEditing,type NoteTool} from './useNoteEditing';
import {patternEvents,type NoteTarget} from '../note-ops';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown, ChevronsLeft, ChevronsRight, ChevronUp, CircleDot, Combine, Dices, Fingerprint, Layers3, Minus, MoreHorizontal, Plus, Power, RotateCcw, Shuffle, SlidersHorizontal, Waves, X, Pause, Play, Square } from 'lucide-react';
import { Knob } from './Knob';
import { CHORD_EXTS, ROOTS, SCALES, chordName, chordText, diatonicChords, leadVoices, type ChordExt } from '../chords';
import { LIBRARY } from './PresetBrowser';
import { clamp, noteName, type PerformanceState, type StepNote, type StepPattern } from '../types';

/* Perform page: one compact panel in the KeyStep spirit.
   Mode tabs (Seq / Arp / Chord) swap the controls on the left and the lane on the right;
   the touch keyboard with Pitch / Mod / AT strips is always at the bottom, so nothing jumps. */

const RATE_BEATS:Record<string,number>={'1/2D':3,'1/2':2,'1/2T':4/3,'1/4D':1.5,'1/4':1,'1/4T':2/3,'1/8D':.75,'1/8':.5,'1/8T':1/3,'1/16D':.375,'1/16':.25,'1/16T':1/6,'1/32D':.1875,'1/32':.125,'1/32T':1/12};
const MODES=['Up','Down','UpDown','Order','Random','Poly','Short 1','Short 2','Long 1','Long 2','Long 3','Poly 1','Poly 2','Poly 3','Poly 4','User Sequence'];
const ARP_VELOCITY=['As played','Fixed 100','Accent first'] as const;
const STRUM_SYNC=['Off','1/64','1/32','1/16','1/8','1/4'];
const STRUM_ORDER=['Up','Down','Alt Up','Alt Down'];
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

export type ArpView={groups:number[][];step:number;phase?:number;paused?:boolean};
type Props={
  state:PerformanceState; beat:number; playing:boolean; held:number[]; arpView?:ArpView|null;
  /** Step record cursor from the engine: the step the next recorded key goes to. */
  recStep?:number;
  selectedTrack:number;recording?:boolean;device?:string;onNoteEdit:(target:NoteTarget,expected:StepPattern,events:import('../types').Note[])=>void;onEditorNote:(track:number,id:string,note:number,velocity:number)=>void;onUndo:()=>void;onSet:(section:Section,key:string,value:unknown)=>void;
  onStep:(index:number,notes:StepNote[],replace:boolean)=>void;
  onAction:(action:string,value?:unknown)=>void;
  onPlay:()=>void;
  onTempo:(bpm:number)=>void;
  /** Raw MIDI from the touch keyboard and strips: status, data1, data2. */
  onMidi:(status:number,data1:number,data2:number,notes?:number[])=>void;
};

function defaultPattern(length:number,division:string):StepPattern {
  return {length,division,gate:.8,swing:.5,steps:Array.from({length},()=>[])};
}
const pct=(n:number)=>Math.round(n)+'%';

/** Hold and Panic sit in the page bar on the right, like the patch browser on Sound. */
export function PerformTools({hold,onHold,onPanic,arp=false,paused=false,onArp}:{hold:boolean;onHold:()=>void;onPanic:()=>void;
  /** arp is on: show Pause / Stop */ arp?:boolean; paused?:boolean; onArp?:(action:'arp_pause'|'arp_stop')=>void}){
  return <>
    {arp&&onArp?<>
      <button type="button" className={'pf-tool'+(paused?' on':'')} aria-pressed={paused} onClick={()=>onArp('arp_pause')}
        title={paused?'Carry on from the step after the one it stopped at':'Stop the arp for now, keep the chord and the step'}>
        {paused?<Play size={15}/>:<Pause size={15}/>}{paused?'Resume':'Pause'}</button>
      <button type="button" className="pf-tool" onClick={()=>onArp('arp_stop')}
        title="Stop the arp and let go of the held chord"><Square size={14}/>Stop arp</button>
    </>:null}
    <button type="button" className={'pf-tool'+(hold?' on':'')} aria-pressed={hold} onClick={onHold}
      title="Keep the arpeggio going after you let go">Hold</button>
    <button type="button" className="pf-tool panic" onClick={onPanic} title="Stop every sounding note">Panic</button>
  </>;
}

export function Performance({state,beat,playing,held,arpView,recStep=0,onSet,onStep,onAction,onTempo,onMidi,selectedTrack,recording=false,device='synth',onNoteEdit,onEditorNote,onUndo}:Props){
  const [mode,setMode]=useState<Mode>('seq');
  const [page,setPage]=useState(0);

  const [gridBase,setGridBase]=useState(60);
  const [strength,setStrength]=useState(.35);
  const [sheet,setSheet]=useState<null|'midi'|'library'|'scale'|'mutate'>(null);
  const [padMenu,setPadMenu]=useState<null|{bank:number;slot:number}>(null);
  const [clip,setClip]=useState<string|null>(null);
  const press=useRef<ReturnType<typeof setTimeout>|null>(null);
  const longPressed=useRef(false);
  const gridRef=useRef<HTMLDivElement>(null);
  const [chainText,setChainText]=useState(state.seq.chain.join(','));
  const [message,setMessage]=useState('');
  const [tapTimes,setTapTimes]=useState<number[]>([]);
  // Chord builder: chord type, inversion, the chord last played (outlined on the keys) and the pad being held.
  const [ext,setExt]=useState<ChordExt>('triad');
  const [inversion,setInversion]=useState(0);
  const [active,setActive]=useState<{id:string;notes:number[]}|null>(null);
  const [pressed,setPressed]=useState<string|null>(null);
  const [slotMenu,setSlotMenu]=useState<number|null>(null);
  const padKey=useRef<number|null>(null);
  const lastChord=useRef<number[]|null>(null);

  const seq=state.seq,arp=state.arp,chord=state.chord,scale=state.scale,sync=state.sync;
  const ref=seq.bank+':'+seq.slot;
  const pat=state.patterns[ref]??defaultPattern(seq.length,seq.division);
  const edit=useNoteEditing({target:{kind:'pattern',track:selectedTrack,bank:seq.bank,slot:seq.slot,device},expected:pat,events:patternEvents(pat),bounds:{span:pat.length,snap:1,maxDuration:8},playing,recording,commit:(t,b,a)=>onNoteEdit(t,b as StepPattern,a),audition:onEditorNote,undo:onUndo});
  const tap=edit.tool,setTap=edit.setTool;
  const locate=(x:number,y:number)=>{const el=gridRef.current;if(!el)return null;const r=el.getBoundingClientRect(),lines=Array.from(el.querySelectorAll<HTMLElement>('.pf-row'));const row=lines.find(n=>{const b=n.getBoundingClientRect();return y>=b.top&&y<b.bottom;})??(y<r.top?lines[0]:lines.at(-1));return {time:clamp(page*16+Math.floor((x-r.left-40)/(r.width-40)*16),page*16,Math.min(pat.length-1,page*16+15)),pitch:Number(row?.dataset.pitch??60)};};
  const factoryName=LIBRARY.patterns[seq.bank-1]?.[seq.slot-1];
  const pages=Math.max(1,Math.ceil(pat.length/16));
  const currentStep=playing&&seq.enabled?Math.floor(beat/(RATE_BEATS[pat.division]??.25))%pat.length:-1;
  const cursor=seq.recording?recStep%pat.length:-1;
  const channel=scale.input_channel?scale.input_channel-1:0;
  const set=(sec:Section,key:string,value:unknown)=>onSet(sec,key,value);
  const action=(name:string,value?:unknown)=>{setMessage('');onAction(name,value);};
  const tool=(c:string)=>({['--tool' as string]:'var(--t-'+c+')'});
  const slots=chord.slots??Array.from({length:8},()=>[] as number[]);
  const saveSlot=(notes:number[])=>{
    if(!notes.length)return;
    const free=slots.findIndex(c=>!c.length);
    const at=free<0?slots.length-1:free;
    action('save_slot',[at,[...new Set(notes)].sort((a,b)=>a-b).slice(0,8)]);
    setMessage('Saved to My chords '+(at+1)+'.');
  };
  // A chord pad or slot sounds while it is held, through the engine like a key, so strum, arp, Hold and REC apply.
  const padOff=()=>{if(padKey.current!==null){onMidi(0x80|channel,padKey.current,0);padKey.current=null;}setPressed(null);};
  const padOn=(id:string,base:number[])=>{
    padOff();
    const notes=chord.voicing?leadVoices(base,lastChord.current):base;
    lastChord.current=notes;padKey.current=notes[0];
    onMidi(0x90|channel,notes[0],100,notes);
    setPressed(id);setActive({id,notes});
    if(chord.enabled)action('save_chord',notes);
  };
  useEffect(()=>()=>{if(padKey.current!==null)onMidi(0x80|channel,padKey.current,0);},[]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new pattern opens on its first page, centred on its notes.
  useEffect(()=>{
    setPage(0);
    const notes=pat.steps.flat().map(n=>n.note);
    if(notes.length){const low=Math.min(...notes);setGridBase(clamp(Math.floor(low/12)*12,0,108));}
  },[seq.bank,seq.slot]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(page>=pages)setPage(pages-1);},[page,pages]);
  useEffect(()=>{if(cursor>=0&&Math.floor(cursor/16)!==page)setPage(Math.floor(cursor/16));},[cursor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>setChainText(seq.chain.join(',')),[seq.chain]);
  useEffect(()=>{if(!message)return;const id=setTimeout(()=>setMessage(''),5000);return()=>clearTimeout(id);},[message]);

  const lane=arpView&&arpView.groups.length?arpView.groups:arpOrder(held,arp.mode,arp.octaves,arp.octave_mode);
  const laneStep=arpView&&arpView.groups.length?arpView.step
    :playing&&lane.length?Math.floor(beat/(RATE_BEATS[arp.division]??.25))%lane.length:-1;
  const sounding=new Set(arp.enabled&&laneStep>=0?lane[laneStep]??[]:[]);

  const tapTempo=()=>{
    const now=performance.now();
    const recent=tapTimes.filter(t=>now-t<2200).concat(now).slice(-6);
    setTapTimes(recent);
    if(recent.length>=3){const intervals=recent.slice(1).map((t,i)=>t-recent[i]);
      const avg=intervals.reduce((a,b)=>a+b,0)/intervals.length;
      if(avg>0)onTempo(clamp(Math.round(60000/avg),30,240));}
  };
  const setChain=()=>{
    const parsed=chainText.split(/[,\s]+/).map(x=>x.trim()).filter(Boolean);
    if(!parsed.length||parsed.length>64||parsed.some(x=>!/^[1-4]:(?:[1-9]|1[0-6])$/.test(x))){
      setMessage('Use bank:pattern pairs such as 1:1,1:2,2:1.');return;
    }
    set('seq','chain',parsed);setMessage('Chain set: '+parsed.join(' → '));
  };

  /* ---------- left column: the controls of the chosen mode ---------- */
  const power=(on:boolean,label:string,toggle:()=>void)=>
    <button type="button" className={'pf-power'+(on?' on':'')} aria-pressed={on} onClick={toggle}>
      <Power size={16}/>{on?label+' on':'Turn '+label.toLowerCase()+' on'}</button>;
  const pctKnob=(id:string,name:string,value:number,min:number,max:number,onChange:(v:number)=>void)=>
    <Knob id={id} name={name} value={Math.round(value*100)} min={min} max={max} step={1} format={pct}
      onChange={n=>onChange(Math.round(n)/100)}/>;

  let controls:ReactNode;
  const hasNotes=(b:number,sl:number)=>{const ptn=state.patterns[b+':'+sl];return !!ptn&&ptn.steps.some(st=>st.length>0);};
  const density=(b:number,sl:number)=>{const ptn=state.patterns[b+':'+sl];if(!ptn)return [] as number[];
    return Array.from({length:8},(_,i)=>{const a=Math.floor(i*ptn.length/8),z=Math.floor((i+1)*ptn.length/8);
      return ptn.steps.slice(a,Math.max(a+1,z)).reduce((n,st)=>n+st.length,0);});};
  const pick=(b:number,sl:number)=>{if(b!==seq.bank)set('seq','bank',b);if(sl!==seq.slot)set('seq','slot',sl);};
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
    <div className="pf-pads" role="group" aria-label={'Patterns in bank '+seq.bank}>
      {Array.from({length:16},(_,i)=>{const sl=i+1,on=seq.slot===sl,full=hasNotes(seq.bank,sl),d=density(seq.bank,sl),top=Math.max(1,...d);
        return <button key={sl} type="button" data-testid={'pf-pad-'+seq.bank+'-'+sl}
          aria-label={'Pattern '+seq.bank+'·'+sl+(full?'':' (empty)')} aria-pressed={on}
          className={'pf-pad'+(on?' on':'')+(full?' full':'')+(on&&seq.enabled&&playing?' playing':'')}
          onPointerDown={()=>padDown(seq.bank,sl)} onPointerUp={padUp} onPointerLeave={padUp} onPointerCancel={padUp}
          onContextMenu={e=>e.preventDefault()}
          onClick={()=>{if(longPressed.current){longPressed.current=false;return;}pick(seq.bank,sl);}}>
          <b>{sl}</b>{full?<span className="pf-dens">{d.map((n,k)=><i key={k} style={{height:Math.max(2,n/top*10)+'px'}}/>)}</span>:null}
        </button>;})}
    </div>
    <p className="pf-info" aria-live="polite">{'Pattern '+seq.bank+'·'+String(seq.slot).padStart(2,'0')+(state.patterns[ref]&&factoryName?' '+factoryName:'')}
      {seq.recording?<b> · rec step {cursor+1}</b>:currentStep<0?null:' · step '+(currentStep+1)}</p>
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
      {pctKnob('pf-arp-gate','Gate',arp.gate,10,90,v=>set('arp','gate',v))}
      {pctKnob('pf-arp-swing','Swing',arp.swing,50,75,v=>set('arp','swing',v))}
      {pctKnob('pf-arp-spice','Spice',arp.spice,0,100,v=>set('arp','spice',v))}
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
  else if(mode==='chord')controls=<>
    {power(chord.enabled,'Chord',()=>set('chord','enabled',!chord.enabled))}
    <p className="pf-hint-line">{chord.enabled?'Each key plays the last chord you tapped.':'Tap a chord to hear it. Turn chord on to play it from one key.'}</p>
    <div className="pf-knobs pf-knobs-1">
      <Knob id="pf-strum" name="Strum" value={chord.strum_ms} min={0} max={500} step={5} format={n=>Math.round(n)+' ms'}
        onChange={n=>set('chord','strum_ms',Math.round(n))}/>
    </div>
    <span className="pf-group-label">Strum sync</span>
    <div className="pf-seg pf-seg-grid" role="group" aria-label="Strum sync">
      {STRUM_SYNC.map(o=><button key={o} type="button" aria-pressed={(chord.strum_sync??'Off')===o}
        className={(chord.strum_sync??'Off')===o?'on':''} onClick={()=>set('chord','strum_sync',o)}>{o}</button>)}
    </div>
    <div className="pf-buttons">
      <button type="button" className="pf-btn wide" disabled={!held.length} onClick={()=>saveSlot(held)}
        title="Hold keys, then tap to keep them in My chords"><Fingerprint size={15}/>Save held keys</button>
    </div>
  </>;
  else controls=null;

  /* ---------- right: the lane of the chosen mode ---------- */
  const rows=useMemo(()=>{
    const degrees=SCALES[scale.name]??SCALES.Chromatic;
    const span=degrees.length+1;
    const out:number[]=[];
    for(let n=gridBase;out.length<span&&n<=127;n++)if(degrees.includes(((n-scale.root)%12+12)%12))out.push(n);
    return out.reverse();
  },[gridBase,scale.name,scale.root]);
  const visible=Array.from({length:16},(_,i)=>page*16+i);
  const outside=(index:number,dir:1|-1)=>(pat.steps[index]??[]).filter(n=>dir>0?n.note>rows[0]:n.note<rows[rows.length-1]).length;

  const gridTools=<>
    <div className="pf-seg" role="group" aria-label="Pattern page">
      {Array.from({length:4},(_,i)=><button key={i} type="button" disabled={i>=pages} aria-pressed={page===i}
        className={page===i?'on':''} onClick={()=>setPage(i)}>{i*16+1}–{i*16+16}</button>)}
    </div>
    <div className="pf-seg" role="group" aria-label="What a tap does">
      {(['select','draw','erase','length','accent'] as NoteTool[]).map(t=><button key={t} type="button" aria-label={t==='select'?'Select notes':t==='draw'?'Draw notes':t==='erase'?'Erase notes':t==='length'?'Longer':'Accent'} aria-pressed={tap===t}
        className={tap===t?'on':''} onClick={()=>setTap(t)}>{t==='select'?'Select':t==='draw'?'Draw':t==='erase'?'Erase':t==='length'?'Longer':'Accent'}</button>)}
    </div>
    <div className="pf-oct">
      <button type="button" aria-label="Show lower notes" onClick={()=>setGridBase(Math.max(0,gridBase-12))}><ChevronDown size={16}/></button>
      <span>{noteName(rows[rows.length-1]??gridBase)}</span>
      <button type="button" aria-label="Show higher notes" onClick={()=>setGridBase(Math.min(108,gridBase+12))}><ChevronUp size={16}/></button>
    </div>
  </>;
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
  const chordTools=<div className="pf-seg" role="group" aria-label="Strum order">
    {STRUM_ORDER.map(o=><button key={o} type="button" aria-pressed={chord.strum_type===o} className={chord.strum_type===o?'on':''}
      onClick={()=>set('chord','strum_type',o)}>{o}</button>)}
  </div>;

  const grid=<div ref={gridRef} className="pf-grid" onKeyDown={edit.key} style={{['--rows' as string]:rows.length}}>
    <div className="pf-grid-head"><span/>
      {visible.map(i=><span key={i} className={(i%4===0?'beat ':'')+(i===currentStep?'live':'')+(i>=pat.length?' off':'')+(i===cursor?' rec':'')}
>
        {outside(i,1)?<em title="Notes above">▲</em>:null}{i+1}{outside(i,-1)?<em title="Notes below">▼</em>:null}</span>)}
    </div>
    {rows.map(note=><div key={note} data-pitch={note} className={'pf-row'+(BLACK.has(note%12)?' black':'')+((note-scale.root)%12===0?' root':'')}>
      <button type="button" className="pf-row-note" aria-label={'Play '+noteName(note)}
        onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);edit.play(note);}}
        onPointerUp={edit.stop} onPointerCancel={edit.stop}
        onContextMenu={e=>e.preventDefault()}>{noteName(note)}</button>
      {visible.map(i=>{
        const eventIndex=edit.events.findIndex(n=>n.start===i&&n.note===note),shown=edit.events[eventIndex],item=shown?{note:shown.note,velocity:shown.velocity,tie:shown.duration}:null;
        return <button key={i} type="button" data-testid={'pf-cell-'+(i+1)+'-'+note}
          aria-label={'Step '+(i+1)+' '+noteName(note)+(item?' on':'')}
          className={'pf-cell'+(i%4===0?' beat':'')+(i===currentStep?' live':'')+(i>=pat.length?' off':'')+(i===cursor?' rec':'')+(edit.selection.includes(eventIndex)?' selected':'')}
          data-note-time={i} data-note-pitch={note} onPointerDown={e=>edit.begin(e,i,note,locate)} onPointerMove={edit.move} onPointerUp={edit.end} onPointerCancel={edit.cancel}
          onClick={e=>{if(e.detail===0)edit.tap(i,note);}}>
          {item?<i className={'pf-note'+(item.velocity>=120?' accent':'')+(i===currentStep?' hit':'')}
            style={{width:'calc('+Math.min(item.tie,16-(i%16))*100+'% - 4px)'}}/>:null}
        </button>;
      })}
    </div>)}
  </div>;

  let laneView:ReactNode;
  const rb=rateParts(pat.division);
  const rail=<div className="pf-rail" role="toolbar" aria-label="Pattern tools">
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
      {[8,16,32,64].map(n=><button key={n} type="button" aria-pressed={pat.length===n} className={pat.length===n?'on':''}
        onClick={()=>set('seq','length',n)}>{n}</button>)}
      <button type="button" aria-label="Fewer steps" disabled={pat.length<=1} onClick={()=>set('seq','length',pat.length-1)}><Minus size={14}/></button>
      <span className="pf-steps-n" aria-label="Steps">{pat.length}</span>
      <button type="button" aria-label="More steps" disabled={pat.length>=64} onClick={()=>set('seq','length',pat.length+1)}><Plus size={14}/></button></div>
    <div className="pf-bar-knobs">
      {pctKnob('pf-seq-swing','Swing',seq.swing,50,75,v=>set('seq','swing',v))}
      {pctKnob('pf-seq-gate','Gate',seq.gate,10,90,v=>set('seq','gate',v))}
      {pctKnob('pf-seq-spice','Spice',seq.spice,0,100,v=>set('seq','spice',v))}
    </div>
  </div>;
  if(mode==='seq')laneView=<>
    <div className="pf-seq-main">{grid}{rail}</div>
    {timing}
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
            onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);edit.play(n);}}
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
          {[4,8,16,32].map(n=><button key={n} type="button" aria-pressed={arp.length===n} className={arp.length===n?'on':''}
            onClick={()=>set('arp','length',n)}>{n}</button>)}
          <button type="button" aria-label="Fewer arp steps" disabled={arp.length<=1} onClick={()=>set('arp','length',arp.length-1)}><Minus size={14}/></button>
          <span className="pf-steps-n" aria-label="Arp steps count">{arp.length}</span>
          <button type="button" aria-label="More arp steps" disabled={arp.length>=64} onClick={()=>set('arp','length',arp.length+1)}><Plus size={14}/></button></div>
        <button type="button" className={'pf-btn'+(arp.restart_bar?' on':'')} aria-pressed={!!arp.restart_bar}
          title="Start the pattern again on every bar line" onClick={()=>set('arp','restart_bar',!arp.restart_bar)}><RotateCcw size={15}/>Restart on bar</button>
        <p className="pf-roll-info" aria-live="polite">{!arp.enabled?'Arp off':example?'Hold keys to start'
          :held.map(noteName).join(' ')+(arpView?.paused?' · paused (Resume carries on, a key starts again)':now>=0?' · step '+(now+1)+' / '+cycle:'')}{arp.retrigger?'':' · free running'}</p>
      </div>
    </>;
  }
  else{
    const pads=diatonicChords(scale.root,scale.name,ext,{octave:scale.octave,inversion,voices:chord.spread,bass:chord.bass??0});
    const hold=(id:string,notes:number[],onLong?:()=>void)=>({
      onPointerDown:(e:React.PointerEvent<HTMLButtonElement>)=>{e.currentTarget.setPointerCapture(e.pointerId);longPressed.current=false;
        padOn(id,notes);if(press.current)clearTimeout(press.current);
        if(onLong)press.current=setTimeout(()=>{longPressed.current=true;onLong();},600);},
      onPointerUp:()=>{if(press.current)clearTimeout(press.current);padOff();},
      onPointerCancel:()=>{if(press.current)clearTimeout(press.current);padOff();},
      onContextMenu:(e:React.MouseEvent)=>e.preventDefault(),
    });
    laneView=<div className="cb">
      <div className="cb-pads" role="group" aria-label={'Chords in '+ROOTS[scale.root]+' '+(scale.name==='Chromatic'?'major':scale.name)}
        style={{['--pads' as string]:pads.length}}>
        {pads.map(c=>{const id='pad-'+c.degree;
          return <button key={id} type="button" data-testid={'cb-pad-'+c.roman} aria-label={'Play '+c.roman+' '+c.name}
            className={'cb-pad'+(active?.id===id?' on':'')+(pressed===id?' sounding':'')}
            {...hold(id,c.notes,()=>saveSlot(active?.id===id?active.notes:c.notes))}>
            <b>{c.roman}</b><strong>{c.name}</strong><span>{chordText(c.notes)}</span></button>;})}
      </div>
      <div className="cb-row">
        <div className="pf-seg" role="group" aria-label="Chord type">
          {CHORD_EXTS.map(([id,label])=><button key={id} type="button" aria-pressed={ext===id} className={ext===id?'on':''}
            onPointerDown={()=>{setExt(id);const c=diatonicChords(scale.root,scale.name,id,{octave:scale.octave,inversion,voices:chord.spread,bass:chord.bass??0})[0];
              if(c)padOn('pad-0',c.notes);}} onPointerUp={padOff} onPointerCancel={padOff} onPointerLeave={padOff}>{label}</button>)}
        </div>
        <div className="pf-seg cb-inv" role="group" aria-label="Inversion">
          <button type="button" aria-label="Inversion down" disabled={inversion<=-3} onClick={()=>setInversion(inversion-1)}><Minus size={14}/></button>
          <span>{inversion===0?'Root':(inversion>0?'Inv +':'Inv −')+Math.abs(inversion)}</span>
          <button type="button" aria-label="Inversion up" disabled={inversion>=3} onClick={()=>setInversion(inversion+1)}><Plus size={14}/></button>
        </div>
        <button type="button" className={'pf-btn'+(chord.voicing?' on':'')} aria-pressed={chord.voicing}
          title="Move chord voices as little as possible between chords" onClick={()=>set('chord','voicing',!chord.voicing)}>Voice lead</button>
      </div>
      <div className="cb-row">
        <span className="pf-group-label">Voices</span>
        <div className="pf-seg" role="group" aria-label="Voices">
          {VOICES.map(v=>{const on=chord.spread===v||(v===0&&chord.spread>6);return <button key={v} type="button" aria-pressed={on} className={on?'on':''}
            onClick={()=>set('chord','spread',v)}>{v?v:'All'}</button>;})}
        </div>
        <span className="pf-group-label">Bass</span>
        <div className="pf-seg" role="group" aria-label="Bass note">
          {[0,1,2,3].map(v=><button key={v} type="button" aria-pressed={(chord.bass??0)===v} className={(chord.bass??0)===v?'on':''}
            aria-label={v?'Bass −'+v+' octave':'Bass off'} onClick={()=>set('chord','bass',v)}>{v?'−'+v:'Off'}</button>)}
        </div>
      </div>
      <div className="cb-slots" role="group" aria-label="My chords">
        <span className="pf-group-label">My chords</span>
        {slots.map((c,i)=>{const id='slot-'+i;
          return c.length?<button key={id} type="button" data-testid={'cb-slot-'+(i+1)} aria-label={'Play my chord '+(i+1)+' '+chordName(c[0],c.map(n=>n-c[0]))}
            className={'cb-slot full'+(pressed===id?' sounding':'')+(active?.id===id?' on':'')}
            {...hold(id,c,()=>setSlotMenu(i))}><strong>{chordName(c[0],c.map(n=>n-c[0]))}</strong><span>{chordText(c)}</span></button>
          :<button key={id} type="button" data-testid={'cb-slot-'+(i+1)} className="cb-slot" disabled={!active}
            aria-label={'Save to my chord '+(i+1)} title={active?'Keep the last chord here':'Tap a chord first'}
            onClick={()=>{if(active){action('save_slot',[i,active.notes]);setMessage('Saved to My chords '+(i+1)+'.');}}}><Plus size={14}/>{i+1}</button>;})}
        {slotMenu!==null?<div className="pf-pad-menu cb-slot-menu" role="menu" aria-label={'My chord '+(slotMenu+1)}>
          <strong>My chord {slotMenu+1}</strong>
          <button type="button" role="menuitem" className="danger" onClick={()=>{action('clear_slot',slotMenu);setSlotMenu(null);}}>Clear</button>
          <button type="button" role="menuitem" aria-label="Close" onClick={()=>setSlotMenu(null)}><X size={16}/></button>
        </div>:null}
      </div>
    </div>;
  }

  return <section className={"pf pf-mode-"+mode} aria-label="Perform">
    <header className="pf-head">
      <div className="pf-tabs" role="tablist" aria-label="Perform mode">
        {([['seq','Seq',<Layers3 size={16}/>,seq.enabled],['arp','Arp',<Waves size={16}/>,arp.enabled],
          ['chord','Chord',<Combine size={16}/>,chord.enabled]] as const)
          .map(([id,label,icon,on])=><button key={id} type="button" role="tab" aria-selected={mode===id}
            className={(mode===id?'active':'')+(on?' live':'')} style={{['--sec' as string]:'var(--c-'+id+')'}} onClick={()=>{setMode(id);setSheet(null);setSlotMenu(null);}}>
            {icon}<span>{label}</span><i className="pf-led"/></button>)}
      </div>
      <div className="pf-head-tools">{mode==='arp'?arpTools:mode==='chord'?chordTools:gridTools}</div>
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
      {sheet?<div className={'pf-sheet pf-sheet-'+sheet} role="dialog" aria-label={SHEET_TITLE[sheet]}>
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
            {pctKnob('pf-mutate','Amount',strength,0,100,setStrength)}
            <Knob id="pf-transpose" name="Transpose" value={seq.transpose} min={-24} max={24} step={1}
              format={n=>(Math.round(n)>0?'+':'')+Math.round(n)} onChange={n=>{const v=Math.round(n);if(v!==seq.transpose)set('seq','transpose',v);}}/>
          </div>
          <div className="pf-buttons">
            <button type="button" className="pf-btn" onClick={()=>action('capture_song')} title="Copy the song track into this pattern">Song → ptn</button>
            <button type="button" className="pf-btn" onClick={()=>action('commit_song','add')} title="Add this pattern to the song track">Ptn → song</button>
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
        </div>:<div className="pf-library">
          {LIBRARY.banks.map((name,i)=><div key={name} className="pf-lib-row">
            <div><strong>Bank {i+1} · {name}</strong><span>{LIBRARY.patterns[i].slice(0,4).join(' · ')} …</span></div>
            <button type="button" className="pf-btn" aria-label={'Load '+name+' into bank '+(i+1)}
              onClick={()=>{onAction('load_factory',i+1);set('seq','bank',i+1);set('seq','slot',1);setSheet(null);
                setMessage('Loaded '+name.toLowerCase()+' into bank '+(i+1)+'. Undo brings the old ones back.');}}>Load</button>
          </div>)}
          <div className="pf-lib-row chain">
            <button type="button" className={'pf-btn'+(seq.chain_enabled?' on':'')} aria-pressed={seq.chain_enabled}
              onClick={()=>set('seq','chain_enabled',!seq.chain_enabled)}>Chain {seq.chain_enabled?'on':'off'}</button>
            <input type="text" value={chainText} onChange={e=>setChainText(e.target.value)} aria-label="Pattern chain, bank:pattern"/>
            <button type="button" className="pf-btn" onClick={setChain}>Set</button>
          </div>
        </div>}
      </div>:null}
    </div>
    <TouchKeys held={held} sounding={sounding} channel={channel} onMidi={onMidi}
      chord={(mode==='chord'||chord.enabled)&&active?active.notes:null}
      scale={scale.name==='Chromatic'?null:new Set((SCALES[scale.name]??[]).map(d=>(d+scale.root)%12))}/>
  </section>;
}

/* ---------- touch keyboard and expression strips ---------- */
/** Layers, top first: keys you press > notes the arp/seq sounds > held keys > the chord outline > the scale tint. */
function TouchKeys({held,sounding,channel,onMidi,chord,scale}:{held:number[];sounding:Set<number>;channel:number;
  onMidi:(s:number,a:number,b:number)=>void;chord:number[]|null;scale:Set<number>|null}){
  const [octave,setOctave]=useState(3);
  const [down,setDown]=useState<number[]>([]);
  const pointers=useRef(new Map<number,number>());
  const base=(octave+1)*12;
  const keys=Array.from({length:37},(_,i)=>base+i).filter(n=>n<=127);
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
    if(old!==undefined&&![...pointers.current.entries()].some(([k,v])=>k!==id&&v===old))onMidi(0x80|channel,old,0);
    pointers.current.set(id,note);
    onMidi(0x90|channel,note,vel);sync();
  };
  const release=(id:number)=>{
    const old=pointers.current.get(id);
    pointers.current.delete(id);
    if(old!==undefined&&![...pointers.current.values()].includes(old))onMidi(0x80|channel,old,0);
    sync();
  };
  // Changing octave or leaving the page must not leave a key hanging.
  useEffect(()=>()=>{for(const id of [...pointers.current.keys()])release(id);},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const shiftOctave=(dir:number)=>{for(const id of [...pointers.current.keys()])release(id);setOctave(clamp(octave+dir,0,7));};

  return <div className="pf-keys">
    <div className="pf-octave">
      <button type="button" aria-label="Octave up" onClick={()=>shiftOctave(1)}><Plus size={18}/></button>
      <strong>{noteName(base)}</strong>
      <button type="button" aria-label="Octave down" onClick={()=>shiftOctave(-1)}><Minus size={18}/></button>
    </div>
    <div className="pf-piano" role="group" aria-label="Touch keyboard"
      onPointerDown={e=>{const n=noteAt(e.clientX,e.clientY);if(n===null)return;
        e.currentTarget.setPointerCapture(e.pointerId);
        press(e.pointerId,n,velocityAt(e.clientY,(e.target as HTMLElement).closest('[data-note]')));}}
      onPointerMove={e=>{if(!pointers.current.has(e.pointerId))return;const n=noteAt(e.clientX,e.clientY);
        if(n!==null)press(e.pointerId,n,velocityAt(e.clientY,(e.target as HTMLElement).closest('[data-note]')));}}
      onPointerUp={e=>release(e.pointerId)} onPointerCancel={e=>release(e.pointerId)}
      onContextMenu={e=>e.preventDefault()}>
      {whites.map(n=><span key={n} data-note={n} className={'pf-white'+layers(n)}>
        {n%12===0?<em>{noteName(n)}</em>:null}</span>)}
      {keys.filter(n=>BLACK.has(n%12)).map(n=>{
        const left=whites.filter(w=>w<n).length;
        return <span key={n} data-note={n} style={{left:'calc('+(left/whites.length*100)+'% - '+(100/whites.length*.31)+'%)',width:(100/whites.length*.62)+'%'}}
          className={'pf-black'+layers(n)}/>;
      })}
    </div>
    <Strip label="Pitch" center onValue={v=>{const b=Math.round(v*16383);onMidi(0xe0|channel,b&127,b>>7);}}/>
    <Strip label="Mod" onValue={v=>onMidi(0xb0|channel,1,Math.round(v*127))}/>
    <Strip label="AT" spring onValue={v=>onMidi(0xd0|channel,Math.round(v*127),0)}/>
  </div>;
}

/** A vertical touch strip. Pitch springs back to the middle, AT back to zero, Mod stays where you leave it. */
function Strip({label,onValue,center=false,spring=false}:{label:string;onValue:(v:number)=>void;center?:boolean;spring?:boolean}){
  const rest=center?.5:0;
  const [value,setValue]=useState(rest);
  const active=useRef(false);
  const move=(e:React.PointerEvent<HTMLDivElement>)=>{
    const r=e.currentTarget.getBoundingClientRect();
    const v=clamp(1-(e.clientY-r.top)/Math.max(1,r.height),0,1);
    setValue(v);onValue(v);
  };
  const end=()=>{active.current=false;if(center||spring){setValue(rest);onValue(rest);}};
  return <div className="pf-strip">
    <span>{label}</span>
    <div className={'pf-strip-track'+(center?' center':'')} role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(value*100)}
      onPointerDown={e=>{active.current=true;e.currentTarget.setPointerCapture(e.pointerId);move(e);}}
      onPointerMove={e=>{if(active.current)move(e);}} onPointerUp={end} onPointerCancel={end}>
      <i className="pf-strip-fill" style={center?{bottom:Math.min(value,.5)*100+'%',height:Math.abs(value-.5)*100+'%'}:{height:value*100+'%'}}/>
      <b style={{bottom:'calc('+value*100+'% - 9px)'}}/>
    </div>
  </div>;
}
