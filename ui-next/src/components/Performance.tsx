import { useEffect, useMemo, useState } from 'react';
import {
  AudioLines, BookOpen, ChevronLeft, ChevronRight, CircleDot, ClipboardCopy,
  Combine, Dices, Fingerprint, Gauge, KeyboardMusic, Layers3, Minus, Plus,
  RotateCcw, Save, SlidersHorizontal, Sparkles, Waves, Zap
} from 'lucide-react';
import { clamp, noteName, type PerformanceState, type StepNote, type StepPattern } from '../types';

const RATES=['1/2D','1/2','1/2T','1/4D','1/4','1/4T','1/8D','1/8','1/8T','1/16D','1/16','1/16T','1/32D','1/32','1/32T'];
const RATE_BEATS:Record<string,number>={'1/2D':3,'1/2':2,'1/2T':4/3,'1/4D':1.5,'1/4':1,'1/4T':2/3,'1/8D':.75,'1/8':.5,'1/8T':1/3,'1/16D':.375,'1/16':.25,'1/16T':1/6,'1/32D':.1875,'1/32':.125,'1/32T':1/12};
const MODES=['Up','Down','UpDown','Random','Order','Poly','Short 1','Short 2','Long 1','Long 2','Long 3','Poly 1','Poly 2','Poly 3','Poly 4','User Sequence'];
const CHORDS=['User','Octave','5th','Major Triad','Minor Triad','Sus 2','Sus 4','Major 7','Minor 7','Major 9','Minor 9','Major 11','Minor 11'];
const SCALES=['Chromatic','Major','Minor','Dorian','Mixolydian','Major Pentatonic','Minor Pentatonic','Blues','Harmonic Minor'];
const ROOTS=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
type Tab='SEQUENCER'|'ARPEGGIATOR'|'CHORD'|'KEYBOARD';
type Section='seq'|'arp'|'chord'|'scale'|'sync';
type Props={
  state:PerformanceState; beat:number; playing:boolean; held:number[];
  selectedTrack:number; onSet:(section:Section,key:string,value:unknown)=>void;
  onStep:(index:number,notes:StepNote[],replace:boolean)=>void;
  onAction:(action:string,value?:unknown)=>void;
  onPlay:()=>void;
  onTempo:(bpm:number)=>void;
};
function defaultPattern(length:number,division:string):StepPattern {
  return {length,division,gate:.8,swing:.5,steps:Array.from({length},()=>[])};
}
const slider=(value:number,min:number,max:number,step:number,fn:(value:number)=>void)=>
  <input className="perf-range" type="range" min={min} max={max} step={step}
         value={value} onChange={e=>fn(Number(e.target.value))}/>;
function labeledSelect(label:string,value:string|number,options:{value:string|number;label:string}[],callback:(v:string)=>void){
  return <label className="perf-select"><span>{label}</span><select value={value} onChange={e=>callback(e.target.value)}>
    {options.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
  </select></label>;
}
function level(label:string,value:number,min:number,max:number,step:number,onChange:(v:number)=>void,suffix=''){
  return <label className="perf-level"><div><span>{label}</span><strong>{Math.round(value*100)/100}{suffix}</strong></div>
    {slider(value,min,max,step,onChange)}</label>;
}
export function Performance({state,beat,playing,held,selectedTrack,onSet,onStep,onAction,onPlay,onTempo}:Props){
  const [tab,setTab]=useState<Tab>('SEQUENCER');
  const [selectedStep,setSelectedStep]=useState(0);
  const [page,setPage]=useState(0);
  const [pitch,setPitch]=useState(60);
  const [velocity,setVelocity]=useState(100);
  const [tie,setTie]=useState(1);
  const [strength,setStrength]=useState(.35);
  const [chainText,setChainText]=useState(state.seq.chain.join(','));
  const [chordText,setChordText]=useState('60,64,67');
  const [message,setMessage]=useState('');
  const [tapTimes,setTapTimes]=useState<number[]>([]);

  const seq=state.seq,arp=state.arp,chord=state.chord,scale=state.scale,sync=state.sync;
  const ref=seq.bank+':'+seq.slot;
  const pat=state.patterns[ref]??defaultPattern(seq.length,seq.division);
  const maxPage=Math.max(0,Math.ceil(pat.length/16)-1);
  const visible=pat.steps.slice(page*16,page*16+16);
  const currentStep=playing?Math.floor(beat/(RATE_BEATS[pat.division]??.25))%pat.length:-1;
  useEffect(()=>{setPage(0);setSelectedStep(0);},[seq.bank,seq.slot,seq.length]);
  useEffect(()=>setChainText(seq.chain.join(',')),[seq.chain]);
  const focused=pat.steps[selectedStep]??[];
  const set=(sec:Section,key:string,value:unknown)=>onSet(sec,key,value);
  const tapTempo=()=>{
    const now=performance.now();
    const recent=tapTimes.filter(t=>now-t<2200).concat(now).slice(-6);
    setTapTimes(recent);
    if(recent.length>=3){const intervals=recent.slice(1).map((t,i)=>t-recent[i]);
      const avg=intervals.reduce((a,b)=>a+b,0)/intervals.length;
      if(avg>0)onTempo(clamp(Math.round(60000/avg),30,240));}
  };
  const action=(name:string,value?:unknown)=>{setMessage('');onAction(name,value);};
  const add=()=>{
    if(focused.length>=8){setMessage('Maximum 8 notes per step.');return;}
    onStep(selectedStep,[{note:pitch,velocity,tie}],false);
  };
  const rest=()=>onStep(selectedStep,[],true);
  const extend=()=>{
    if(!focused.length){setMessage('Add a note before tying this step.');return;}
    onStep(selectedStep,focused.map(x=>({...x,tie:Math.min(8,x.tie+1)})),true);
  };
  const setChain=()=>{
    const parsed=chainText.split(/[,\s]+/).map(x=>x.trim()).filter(Boolean);
    if(!parsed.length||parsed.length>64||parsed.some(x=>!/^[1-4]:(?:[1-9]|1[0-6])$/.test(x))){
      setMessage('Use bank:slot references such as 1:1,1:2,2:1.');return;
    }
    set('seq','chain',parsed);
  };

  return <section className="perf-workspace" aria-label="KeyStep-inspired music performance engine">
    <header className="perf-header">
      <div className="perf-head-title"><span className="eyebrow">MUSICAL PERFORMANCE / TRACK {selectedTrack+1}</span>
        <h2>Performance Engine</h2><p>Sequence, arpeggiate, voice chords and shape live MIDI.</p></div>
      <nav role="tablist" className="perf-tabs" aria-label="Performance modules">
        {(['SEQUENCER','ARPEGGIATOR','CHORD','KEYBOARD'] as Tab[]).map(name=><button key={name} type="button" role="tab"
          aria-selected={tab===name} className={tab===name?'active':''} onClick={()=>setTab(name)}>
          {name==='SEQUENCER'?<Layers3 size={17}/>:name==='ARPEGGIATOR'?<Waves size={17}/>:name==='CHORD'?<Combine size={17}/>:<KeyboardMusic size={17}/>}
          <span>{name==='SEQUENCER'?'SEQ':name==='ARPEGGIATOR'?'ARP':name==='KEYBOARD'?'KEYS':'CHORD'}</span>
        </button>)}
      </nav>
      <span className="perf-clock"><span className={'pulse'+(playing?' live':'')}/>
        {playing?'CLOCK RUNNING':'CLOCK STOPPED'}</span>
    </header>

    {tab==='SEQUENCER'&&<div className="perf-main sequencer">
      <div className="perf-top-controls">
        <button type="button" className={'perf-big-toggle'+(seq.enabled?' on':'')} aria-pressed={seq.enabled}
          onClick={()=>set('seq','enabled',!seq.enabled)}><Zap size={18}/>{seq.enabled?'SEQ ON':'ENABLE SEQ'}</button>
        {labeledSelect('BANK',seq.bank,[1,2,3,4].map(n=>({value:n,label:'BANK '+n})),v=>set('seq','bank',Number(v)))}
        {labeledSelect('PATTERN',seq.slot,Array.from({length:16},(_,i)=>({value:i+1,label:'PTN '+String(i+1).padStart(2,'0')})),v=>set('seq','slot',Number(v)))}
        <div className="perf-counter"><span>STEPS</span>
          <div><button onClick={()=>set('seq','length',Math.max(1,pat.length-1))} aria-label="Reduce pattern length"><Minus size={16}/></button><strong>{pat.length}</strong>
          <button onClick={()=>set('seq','length',Math.min(64,pat.length+1))} aria-label="Increase pattern length"><Plus size={16}/></button></div>
        </div>
        {labeledSelect('STEP RATE',seq.division,RATES.map(x=>({value:x,label:x})),v=>set('seq','division',v))}
        <button type="button" className={'perf-rec-toggle'+(seq.recording?' active':'')}
          onClick={()=>set('seq','recording',!seq.recording)}>
          <CircleDot size={16}/>{seq.recording?'STEP RECORDING':'STEP RECORD'}</button>
        <button type="button" className={'perf-hold'+(seq.overdub?' active':'')}
          onClick={()=>set('seq','overdub',!seq.overdub)}>{seq.overdub?'OVERDUB':'REPLACE'}</button>
      </div>
      <div className="perf-pattern-heading">
        <div><strong>PATTERN {seq.bank}-{String(seq.slot).padStart(2,'0')}</strong>
          <span>16 visible per page · up to 8 notes per step · select to edit</span></div>
        <div className="perf-page-stepper">
          <button onClick={()=>setPage(Math.max(0,page-1))} disabled={page===0}><ChevronLeft size={18}/></button>
          <strong>PAGE {page+1} / {maxPage+1}</strong>
          <button onClick={()=>setPage(Math.min(maxPage,page+1))} disabled={page===maxPage}><ChevronRight size={18}/></button>
        </div>
      </div>
      <div className="perf-step-grid" style={{'--perf-track-accent':'var(--accent)'} as React.CSSProperties}>
        {visible.map((notes,i)=>{
          const index=page*16+i,active=selectedStep===index,live=currentStep===index;
          return <button type="button" key={index} data-testid={'performance-step-'+(index+1)}
            className={'perf-step'+(notes.length?' programmed':'')+(active?' selected':'')+(live?' playing':'')}
            aria-label={'Step '+(index+1)+', '+notes.length+' notes'}
            aria-pressed={active} onClick={()=>setSelectedStep(index)}>
            <span className="step-num">{String(index+1).padStart(2,'0')}</span>
            <span className="step-note-count">{notes.length?notes.length+' NOTES':'REST'}</span>
            <span className="step-pitches">{notes.length?notes.slice(0,3).map(n=>noteName(n.note)).join(' '):'—'}</span>
            <span className="perf-step-led"/>
          </button>;
        })}
      </div>
      <div className="perf-edit-row">
        <div className="perf-selected-step"><span className="eyebrow">SELECTED STEP</span><strong>{String(selectedStep+1).padStart(2,'0')}</strong>
          <span>{focused.length} / 8 voices</span></div>
        {labeledSelect('PITCH',pitch,Array.from({length:61},(_,i)=>({value:i+36,label:noteName(i+36)})),v=>setPitch(Number(v)))}
        <div className="perf-counter"><span>VELOCITY</span><div>
          <button onClick={()=>setVelocity(Math.max(1,velocity-10))}>−</button>
          <strong>{velocity}</strong>
          <button onClick={()=>setVelocity(Math.min(127,velocity+10))}>+</button></div></div>
        <div className="perf-counter"><span>TIE</span><div>
          <button onClick={()=>setTie(Math.max(1,tie-1))}>−</button><strong>{tie}</strong>
          <button onClick={()=>setTie(Math.min(8,tie+1))}>+</button></div></div>
        <button className="perf-tool primary" onClick={add}><Plus size={17}/> ADD NOTE</button>
        <button className="perf-tool" onClick={extend}>TIE +1</button>
        <button className="perf-tool" onClick={rest}>REST / CLEAR</button>
      </div>
      <div className="perf-step-note-list">{focused.length?
        focused.map((n,i)=><button key={i} type="button"
          onClick={()=>onStep(selectedStep,focused.filter((_,j)=>i!==j),true)}
          title="Remove just this note">{noteName(n.note)} · V{n.velocity} · ×{n.tie} <span>×</span></button>):
        <span>Empty step — choose a pitch and tap Add Note, or play your keyboard with Step Record enabled.</span>}
      </div>
      <div className="perf-utilities">
        {level('GATE',Math.round(seq.gate*100),10,90,5,v=>set('seq','gate',v/100),'%')}
        {level('SWING',Math.round(seq.swing*100),50,75,1,v=>set('seq','swing',v/100),'%')}
        {level('SPICE',Math.round(seq.spice*100),0,100,5,v=>set('seq','spice',v/100),'%')}
        {level('QUANTIZE',Math.round(seq.quantize_strength*100),0,100,10,v=>set('seq','quantize_strength',v/100),'%')}
        <div className="perf-action-row">
          <button onClick={()=>action('mutate',strength)}><Dices size={16}/> MUTATE</button>
          <button onClick={()=>action('reset_mutate')}><RotateCcw size={16}/> RESET</button>
          <button onClick={()=>action('nudge',-1)}>◀ NUDGE</button>
          <button onClick={()=>action('nudge',1)}>NUDGE ▶</button>
          <details className="perf-advanced-tools"><summary>TOOLS <ChevronRight size={14}/></summary>
            <div className="perf-advanced-menu">
              {level('MUTATION STRENGTH',Math.round(strength*100),0,100,5,v=>setStrength(v/100),'%')}
              <button type="button" onClick={()=>action('double')}>×2 LENGTH</button>
              <button type="button" onClick={()=>action('octave',-1)}>OCTAVE DOWN</button>
              <button type="button" onClick={()=>action('octave',1)}>OCTAVE UP</button>
              <button type="button" onClick={()=>action('quantize')}>QUANTIZE SONG</button>
              <button type="button" onClick={()=>{if(confirm('Clear this sequencer pattern?'))action('clear');}}>CLEAR PATTERN</button>
            </div>
          </details>
        </div>
      </div>
      <div className="perf-bottom-actions">
        <label className="perf-chain-field"><input type="checkbox" checked={seq.chain_enabled}
          onChange={e=>set('seq','chain_enabled',e.target.checked)}/><strong>CHAIN</strong>
          <input type="text" value={chainText} onChange={e=>setChainText(e.target.value)}
            aria-label="Pattern chain bank and pattern slots"/>
          <button onClick={setChain}>SET</button></label>
        <button onClick={()=>action('capture_song')}><ClipboardCopy size={15}/> SONG → PATTERN</button>
        <button onClick={()=>action('commit_song','add')}><Plus size={15}/> PATTERN → SONG</button>
        <button onClick={()=>{if(confirm('Replace recorded notes on the selected song track?'))action('commit_song','replace');}}>
          REPLACE SONG TRACK</button>
      </div>
    </div>}

    {tab==='ARPEGGIATOR'&&<div className="perf-main perf-simple">
      <div className="perf-lead">
        <div><span className="eyebrow">ARPEGGIATOR</span><h3>Turn held notes into motion</h3>
          <p>Play a chord on the connected keyboard. Select an order, rate and number of octaves.</p></div>
        <button className={'perf-big-toggle'+(arp.enabled?' on':'')} onClick={()=>set('arp','enabled',!arp.enabled)}>
          {arp.enabled?'ARP ON':'ENABLE ARP'}</button>
      </div>
      <div className="perf-arp-controls">
        {labeledSelect('PATTERN MODE',arp.mode,MODES.map(x=>({value:x,label:x})),v=>set('arp','mode',v))}
        {labeledSelect('TIME DIVISION',arp.division,RATES.map(x=>({value:x,label:x})),v=>set('arp','division',v))}
        {labeledSelect('OCTAVE RANGE',arp.octaves,[1,2,3,4].map(x=>({value:x,label:x+' octave'+(x>1?'s':'')})),v=>set('arp','octaves',Number(v)))}
        {labeledSelect('ARP STEPS',arp.length,Array.from({length:64},(_,i)=>({value:i+1,label:String(i+1)})),v=>set('arp','length',Number(v)))}
        <button className={'perf-hold'+(arp.hold?' active':'')} onClick={()=>set('arp','hold',!arp.hold)}>
          {arp.hold?'HOLD / LATCH ON':'HOLD / LATCH OFF'}</button>
        <button className={'perf-hold'+(arp.retrigger?' active':'')} onClick={()=>set('arp','retrigger',!arp.retrigger)}>
          {arp.retrigger?'RETRIGGER ON':'RETRIGGER OFF'}</button>
      </div>
      <div className="perf-numerics">
        {level('GATE',Math.round(arp.gate*100),10,90,5,v=>set('arp','gate',v/100),'%')}
        {level('SWING',Math.round(arp.swing*100),50,75,1,v=>set('arp','swing',v/100),'%')}
        {level('SPICE',Math.round(arp.spice*100),0,100,5,v=>set('arp','spice',v/100),'%')}
      </div>
      <div className="perf-held-area"><div><span className="eyebrow">LIVE HELD NOTES</span>
        <strong>{held.length?held.map(noteName).join('  ·  '):'No keys held'}</strong></div>
        <div className="perf-arp-pills">{Array.from({length:8},(_,i)=><span key={i} className={held.length&&i%Math.max(1,held.length)===Math.floor(beat*4)%held.length?'active':''}>{String(i+1).padStart(2,'0')}</span>)}</div>
      </div>
      <div className="perf-music-actions">
        <button onClick={()=>set('arp','seed',Math.floor((arp.seed+1)%1000000))}><Dices size={17}/> NEW VARIATION</button>
        <button onClick={()=>action('arp_to_seq')}><Layers3 size={17}/> ARP → SEQUENCE</button>
        <button onClick={onPlay}><Waves size={17}/> {playing?'TRANSPORT PLAYING':'START TRANSPORT'}</button>
      </div>
      <p className="perf-footnote">Modes 7–15 generate deterministic variations. Hold sustains the note set; Spice changes gates and can add rests. Export to the sequencer to edit the notes individually.</p>
    </div>}

    {tab==='CHORD'&&<div className="perf-main perf-simple">
      <div className="perf-lead">
        <div><span className="eyebrow">CHORD MEMORY</span><h3>One key. A whole harmony.</h3>
          <p>Select a voicing or capture your own chord; velocity, pedal and note releases remain live.</p></div>
        <button className={'perf-big-toggle'+(chord.enabled?' on':'')} onClick={()=>set('chord','enabled',!chord.enabled)}>
          {chord.enabled?'CHORD ON':'ENABLE CHORD'}</button>
      </div>
      <div className="perf-chord-presets">
        {CHORDS.map(name=><button key={name} className={chord.preset===name?'selected':''}
          onClick={()=>set('chord','preset',name)}>{name}</button>)}
      </div>
      <div className="perf-chord-controls">
        {level('STRUM DELAY',chord.strum_ms,0,500,25,v=>set('chord','strum_ms',v),'ms')}
        {labeledSelect('STRUM ORDER',chord.strum_type,['Up','Down','Alt Up','Alt Down'].map(x=>({value:x,label:x})),v=>set('chord','strum_type',v))}
        {labeledSelect('SPREAD',chord.spread,[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16].map(x=>({value:x,label:x===0?'FULL CHORD':String(x)})),v=>set('chord','spread',Number(v)))}
        <button type="button" className={'perf-hold'+(chord.voicing?' active':'')} onClick={()=>set('chord','voicing',!chord.voicing)}>
          {chord.voicing?'VOICE LEADING ON':'VOICE LEADING OFF'}</button>
      </div>
      <div className="perf-chord-memory">
        <div><span className="eyebrow">CUSTOM CHORD MEMORY</span>
          <p>Enter up to 16 MIDI note numbers, comma separated. The first note becomes the root.</p></div>
        <input type="text" value={chordText} onChange={e=>setChordText(e.target.value)}
          aria-label="Custom chord MIDI notes" placeholder="60,64,67"/>
        <button onClick={()=>{
          const notes=chordText.split(',').map(n=>Number(n.trim()));
          if(!notes.length||notes.length>16||notes.some(n=>!Number.isInteger(n)||n<0||n>127)){
            setMessage('Enter 1–16 MIDI note numbers between 0 and 127.');return;
          }
          action('save_chord',notes);
        }}>SAVE USER CHORD</button>
        <button onClick={()=>action('learn_chord')}><Fingerprint size={15}/> LEARN HELD KEYS</button>
      </div>
      <div className="perf-held-area"><div><span className="eyebrow">PLAYING NOTES</span>
        <strong>{held.length?held.map(noteName).join(' · '):'Hold a note to preview'}</strong></div></div>
      <p className="perf-footnote">Chord mode can feed the arpeggiator. Strum delays are scheduled in the real audio engine, not a visual-only effect.</p>
    </div>}

    {tab==='KEYBOARD'&&<div className="perf-main perf-simple">
      <div className="perf-lead"><div><span className="eyebrow">KEYBOARD AND MIDI</span><h3>Performance tuning</h3>
        <p>Set musical scale, root, octave and expressive velocity response for your external MIDI keyboard.</p></div>
        <div className="perf-live-status"><span className="pulse live"/>INPUT ROUTING</div></div>
      <div className="perf-keyboard-controls">
        {labeledSelect('SCALE',scale.name,SCALES.map(x=>({value:x,label:x})),v=>set('scale','name',v))}
        {labeledSelect('KEY / ROOT',scale.root,ROOTS.map((name,i)=>({value:i,label:name})),v=>set('scale','root',Number(v)))}
        {labeledSelect('OCTAVE SHIFT',scale.octave,Array.from({length:7},(_,i)=>({value:i-3,label:(i-3>0?'+':'')+(i-3)+' octaves'})),v=>set('scale','octave',Number(v)))}
        {labeledSelect('VELOCITY CURVE',scale.velocity_curve,['Linear','Logarithmic','Exponential','Fixed 100'].map(x=>({value:x,label:x})),v=>set('scale','velocity_curve',v))}
        {labeledSelect('MIDI INPUT CHANNEL',scale.input_channel,Array.from({length:17},(_,i)=>({value:i,label:i===0?'ALL CHANNELS':'CHANNEL '+i})),v=>set('scale','input_channel',Number(v)))}
        {labeledSelect('CLOCK SOURCE',sync.source,['Internal','USB MIDI','Auto'].map(x=>({value:x,label:x})),v=>set('sync','source',v))}
        <button className={'perf-hold'+(sync.receive_transport?' active':'')}
          onClick={()=>set('sync','receive_transport',!sync.receive_transport)}>
          {sync.receive_transport?'MIDI START/STOP ON':'MIDI START/STOP OFF'}</button>
      </div>
      <div className="perf-info-grid">
        <div><Gauge size={21}/><strong>Velocity</strong><span>Four response curves including fixed velocity.</span></div>
        <div><Waves size={21}/><strong>Expression</strong><span>Pitch bend, sustain pedal, CC1 and aftertouch reach the synth.</span></div>
        <div><AudioLines size={21}/><strong>Timing</strong><span>Both MIDI pattern and song clips follow the same sample clock.</span></div>
      </div>
      <div className="perf-music-actions">
        <button onClick={tapTempo}><Gauge size={16}/> TAP TEMPO{tapTimes.length>=1?' ('+tapTimes.length+' TAPS)':''}</button>
        <button onClick={()=>set('sync','source','Internal')}>USE INTERNAL CLOCK</button>
      </div>
      <p className="perf-footnote">USB MIDI clock receives tempo and transport messages but does not transmit clock or guarantee external phase lock. CV/Gate/Mod require compatible physical hardware; DeckSynth does not emulate voltage outputs.</p>
    </div>}
    {message&&<div className="perf-feedback" role="status">{message}</div>}
  </section>;
}
