import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioWaveform, ChevronDown, CircleDot, CircleHelp, Disc3, FileDown,
  FolderOpen, Headphones, Music2, Pause, Play, Radio, Redo2,
  RotateCcw, Settings2, Square, Waves,
} from 'lucide-react';
import { Timeline } from './components/Timeline';
import { PatternSync } from './components/PatternSync';
import { AudioScope } from './components/AudioScope';
import { SoundLab } from './components/SoundLab';
import { SoundRack } from './components/Rack';
import { Performance } from './components/Performance';
import { interpolateBeat, totalNotes } from './pattern';
import { PRESETS, TRACK_COLORS, clamp, type BridgeMessage, type DeckUpdate, type Instrument, type Note, type StepNote } from './types';
import previewState from './preview-state.json';
import './styles.css';

type Mode = 'SONG'|'SOUND'|'PERFORM';
type Dialog = 'settings'|'help'|null;
const api=window.deckApi;
const demoInitial = previewState as DeckUpdate;

function emptyInstrument(preset:string):Instrument {
  const base:Instrument={harmonics:[1,.5,.22,.12,.08,.04,.02,.01,0,0,0,0,0,0,0,0],
    attack:.008,decay:.6,sustain:.35,release:.5,filter:.85,modulation:.08};
  if(preset==='Bass')return {...base,attack:.004,decay:.2,sustain:.65,release:.15,filter:.35};
  if(preset==='Bell')return {...base,harmonics:[1,0,.55,0,.3,0,.12,.08,0,.04,0,0,.02,0,0,0],release:1.3};
  if(preset==='Atmospheric Pad')return {...base,attack:.7,decay:.8,sustain:.75,release:1.8,filter:.65};
  if(preset==='Evolving Texture')return {...base,attack:1.2,decay:.8,sustain:.7,release:2,filter:.7,modulation:.7};
  return base;
}

function renderMIDI(value:string|null) {
  return value ? value.split('/').pop()||'MIDI device' : 'No MIDI keyboard';
}

function App() {
  const [snapshot,setSnapshot]=useState<DeckUpdate|null>(api?null:demoInitial);
  const [mode,setMode]=useState<Mode>('SONG');
  const [dialog,setDialog]=useState<Dialog>(null);
  const [toast,setToast]=useState('');
  const [bridgeStatus,setBridgeStatus]=useState(api?'CONNECTING':'PREVIEW');
  const [playhead,setPlayhead]=useState(0);
  const anchor=useRef({beat:0,when:performance.now(),bpm:120,bars:4,playing:false,preview:false});
  const lastVisualFrame=useRef(0);
  const selected=snapshot?.selected??0;
  const isPreview=!api||!!snapshot?.preview;
  const project=snapshot?.state;
  const track=project?.tracks[selected];

  useEffect(()=>{
    if(!api){setSnapshot(demoInitial);return;}
    return api.onMessage((obj:BridgeMessage)=>{
      if(obj.error){setToast(obj.error);setBridgeStatus('ERROR');return;}
      if(obj.message){setToast(obj.message);return;}
      if(obj.bridge==='ready'){setBridgeStatus('CONNECTED');return;}
      if(obj.state&&typeof obj.beat==='number'){
        setSnapshot(obj as DeckUpdate);
        setBridgeStatus(obj.preview?'PREVIEW':'CONNECTED');
      }
    });
  },[]);

  useEffect(()=>{
    if(!snapshot)return;
    anchor.current={beat:snapshot.beat,when:performance.now(),
                    bpm:snapshot.state.bpm,bars:snapshot.state.bars,
                    playing:snapshot.playing,preview:!!snapshot.preview||!api};
    setPlayhead(snapshot.beat);
  },[snapshot]);

  useEffect(()=>{
    let raf=0,active=true;
    const tick=(now:number)=>{
      if(!active)return;
      raf=requestAnimationFrame(tick);
      if(now-lastVisualFrame.current<32)return;
      lastVisualFrame.current=now;
      const a=anchor.current;
      const next=interpolateBeat(a.beat,a.when,now,a.bpm,a.bars,a.playing,a.preview?100000:220);
      setPlayhead(prev=>Math.abs(prev-next)>.0001?next:prev);
    };
    raf=requestAnimationFrame(tick);
    return()=>{active=false;cancelAnimationFrame(raf);};
  },[]);

  useEffect(()=>{
    if(!toast)return;
    const id=window.setTimeout(()=>setToast(''),6000);
    return()=>window.clearTimeout(id);
  },[toast]);

  const command=useCallback((cmd:string,args:unknown=null)=>{
    if(api && !isPreview){api.send(cmd,args);return;}
    // Explicit demo-only interactions: never touch the original synth or disk.
    setSnapshot(prev=>{
      if(!prev)return prev;
      const next:DeckUpdate=structuredClone(prev);
      const arg=args as never;
      const owner=next.state.tracks[next.selected];
      if(cmd==='play')next.playing=!next.playing;
      else if(cmd==='stop'){next.playing=false;next.recording=false;next.beat=0;}
      else if(cmd==='record'){next.recording=!next.recording;next.playing=true;}
      else if(cmd==='select')next.selected=clamp(Number(arg),0,3);
      else if(cmd==='tempo'){next.state.bpm=clamp(Number(arg),30,240);next.playing=false;}
      else if(cmd==='bars'){next.state.bars=Number(arg);next.playing=false;}
      else if(cmd==='metronome')next.state.metronome=!!arg;
      else if(cmd==='preset'){owner.preset=String(arg);owner.instrument=emptyInstrument(owner.preset);}
      else if(cmd==='track'){
        const [index,key,value]=args as [number,'mute'|'volume',boolean|number];
        if(key==='mute')next.state.tracks[index].mute=!!value;
        else next.state.tracks[index].volume=clamp(Number(value),0,1);
      }
      else if(cmd==='parameter'){
        const [name,index,value]=args as [keyof Instrument,number|null,number];
        if(name==='harmonics' && index!==null)owner.instrument.harmonics[index]=clamp(value,0,1);
        else if(name!=='harmonics')owner.instrument[name]=value;
      }
      else if(cmd==='edit_note'){
        const [index,noteIndex,note]=args as [number,number,Note];
        next.state.tracks[index].notes[noteIndex]=note;next.playing=false;
      }
      else if(cmd==='clear'){owner.notes=[];next.playing=false;}
      else if(cmd==='quantize'){owner.notes.forEach(n=>{n.start=Math.round(n.start*4)/4;});next.playing=false;}
      else if(cmd==='perform_set'){
        const [section,key,value]=args as ['seq'|'arp'|'chord'|'scale'|'sync',string,unknown];
        const branch=next.state.performance[section] as unknown as Record<string,unknown>;
        branch[key]=value;
        if(section==='seq'&&(key==='bank'||key==='slot')){
          const seq=next.state.performance.seq;
          const active=next.state.performance.patterns[seq.bank+':'+seq.slot];
          seq.length=active?.length??16;
          seq.division=active?.division??'1/16';
          seq.gate=active?.gate??.8;
          seq.swing=active?.swing??.5;
        }
        if(section==='seq'&&['length','division','gate','swing'].includes(key)){
          const seq=next.state.performance.seq,keyname=seq.bank+':'+seq.slot;
          const existing=next.state.performance.patterns[keyname]??{
            length:seq.length,division:seq.division,gate:seq.gate,swing:seq.swing,
            steps:Array.from({length:seq.length},()=>[]),
          };
          existing.length=seq.length;existing.division=seq.division;
          existing.gate=seq.gate;existing.swing=seq.swing;
          existing.steps=Array.from({length:seq.length},(_,i)=>existing.steps[i]??[]);
          next.state.performance.patterns[keyname]=existing;
        }
        if(section==='seq'&&key==='enabled'&&value)next.state.performance.arp.enabled=false;
        if(section==='arp'&&key==='enabled'&&value)next.state.performance.seq.enabled=false;
      }
      else if(cmd==='perform_step'){
        const [index,notes,replace]=args as [number,StepNote[],boolean];
        const seq=next.state.performance.seq;
        const key=seq.bank+':'+seq.slot;
        const existing=next.state.performance.patterns[key]??{
          length:seq.length,division:seq.division,gate:seq.gate,swing:seq.swing,
          steps:Array.from({length:seq.length},()=>[]),
        };
        if(index>=0&&index<existing.length){
          const combined=(replace?[]:existing.steps[index]).concat(notes);
          if(combined.length<=8)existing.steps[index]=combined;
          next.state.performance.patterns[key]=existing;
        }
      }
      else if(cmd==='perform_action'){
        const [action,value]=args as [string,unknown];
        const seq=next.state.performance.seq;
        const key=seq.bank+':'+seq.slot;
        const existing=next.state.performance.patterns[key]??{
          length:seq.length,division:seq.division,gate:seq.gate,swing:seq.swing,
          steps:Array.from({length:seq.length},()=>[]),
        };
        if(action==='clear')existing.steps.forEach(step=>step.splice(0));
        if(action==='capture_song'){
          // Match the native converter's timing defaults; notes keep the preview algorithm.
          existing.gate=.8;existing.swing=.5;
          const beat=.25;
          existing.steps.forEach(step=>step.splice(0));
          owner.notes.forEach(note=>{
            const i=Math.round(note.start/beat)%existing.length;
            if(existing.steps[i].length<8)existing.steps[i].push({
              note:note.note,velocity:note.velocity,tie:Math.min(8,Math.max(1,Math.round(note.duration/beat)))});
          });
          seq.length=existing.length;seq.division=existing.division;
          seq.gate=existing.gate;seq.swing=existing.swing;
        }
        if(action==='commit_song'){
          const converted=existing.steps.flatMap((step,i)=>step.map(note=>({
            note:note.note,velocity:note.velocity,start:i*.25,
            duration:.25*existing.gate*note.tie,
          })));
          owner.notes=value==='replace'?converted:owner.notes.concat(converted);
        }
        next.state.performance.patterns[key]=existing;
      }
      return next;
    });
  },[isPreview]);

  const showFileDialog=async(op:'open'|'save',extension:'project'|'midi'|'instrument',cmd:string)=>{
    if(isPreview||!api){setToast('Preview mode — projects are not changed');return;}
    const filepath=await api.chooseFile(op,extension);
    if(filepath)command(cmd,filepath);
  };
  const onParam=(key:keyof Instrument,index:number|null,value:number)=>command('parameter',[key,index,value]);
  const onTrack=(key:'mute'|'volume',value:boolean|number)=>command('track',[selected,key,value]);

  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(dialog)return;
      const target=event.target as HTMLElement;
      if(['INPUT','TEXTAREA','SELECT'].includes(target?.tagName)||target?.isContentEditable)return;
      const k=event.key;
      const controls:{[key:string]:string}={F5:'play',F6:'stop',F7:'record',F10:'undo'};
      if(controls[k]){event.preventDefault();command(controls[k]);return;}
      if(k==='F8'||k==='F9'){event.preventDefault();command('select',(selected+(k==='F8'?3:1))%4);}
      else if(k===' '){event.preventDefault();command('play');}
    };
    window.addEventListener('keydown',handler);
    return()=>window.removeEventListener('keydown',handler);
  },[selected,dialog,command]);

  const instruments=project?.tracks.map(t=>t.preset)||[];
  return <main className="decksynth-shell">
    <header className="app-header">
      <div className="app-identity">
        <span className="brand-glyph"><AudioWaveform size={24} strokeWidth={1.65}/></span>
        <div className="brand-names"><strong>DECKSYNTH<span> / NEXT</span></strong><small>PERFORMANCE INSTRUMENT</small></div>
      </div>
      <div className="app-mode-switch" role="tablist" aria-label="Workspace">
        <button type="button" role="tab" aria-selected={mode==='SONG'} className={mode==='SONG'?'active':''}
          onClick={()=>setMode('SONG')}><Disc3 size={16}/> Song</button>
        <button type="button" role="tab" aria-selected={mode==='SOUND'} className={mode==='SOUND'?'active':''}
          onClick={()=>setMode('SOUND')}><Waves size={16}/> Sound</button>
        <button type="button" role="tab" aria-selected={mode==='PERFORM'} className={mode==='PERFORM'?'active':''}
          onClick={()=>setMode('PERFORM')}><CircleDot size={16}/> Perform</button>
      </div>
      <div className="app-header-right">
        <div className={'device-pill'+(snapshot?.connected?' connected':'')}>
          <span className="pill-led"/>{renderMIDI(snapshot?.connected||null)}
        </div>
        {isPreview?<span className="demo-badge">UI PREVIEW · NO AUDIO</span>:null}
        <button className="icon-button" aria-label="Help" title="Help" onClick={()=>setDialog('help')}><CircleHelp size={19}/></button>
        <button className="icon-button" aria-label="Audio and MIDI setup" title="Audio and MIDI setup"
          onClick={()=>setDialog('settings')}><Settings2 size={19}/></button>
      </div>
    </header>

    <section className="transport" aria-label="Music transport">
      <div className="transport-actions">
        <button type="button" className={'transport-pad play'+(snapshot?.playing?' engaged':'')}
          onClick={()=>command('play')} aria-label={snapshot?.playing?'Pause loop':'Play loop'}>
          {snapshot?.playing?<Pause size={23} fill="currentColor"/>:<Play size={23} fill="currentColor"/>}
          <span>{snapshot?.playing?'PAUSE':'PLAY'}</span>
        </button>
        <button type="button" className="transport-pad stop" onClick={()=>command('stop')}>
          <Square size={19} fill="currentColor"/><span>STOP</span>
        </button>
        <button type="button" className={'transport-pad record'+(snapshot?.recording?' engaged':'')}
          onClick={()=>command('record')}>
          <CircleDot size={22}/><span>{snapshot?.recording?'FINISH TAKE':'RECORD'}</span>
        </button>
      </div>
      <div className="transport-divider"/>
      <div className="tempo-display" aria-label="Tempo">
        <span>BPM</span><strong>{Math.round(project?.bpm??120)}</strong>
        <div className="tempo-adjust">
          <button title="Tempo +5 BPM" onClick={()=>command('tempo',clamp((project?.bpm??120)+5,30,240))}>+</button>
          <button title="Tempo −5 BPM" onClick={()=>command('tempo',clamp((project?.bpm??120)-5,30,240))}>−</button>
        </div>
      </div>
      <div className="bars-display">
        <span>LOOP</span>
        <select aria-label="Loop bars" value={project?.bars??4}
          onChange={e=>command('bars',Number(e.target.value))}>
          {[1,2,4,8].map(n=><option value={n} key={n}>{n} BARS</option>)}
        </select>
      </div>
      <button type="button" className={'metronome-button'+(project?.metronome?' active':'')}
        onClick={()=>command('metronome',!project?.metronome)}>
        <span className="button-led"/><span>CLICK</span></button>
      <div className="transport-spacer"/>
      <div className="transport-beat"><span>POSITION</span><strong>
        {String(Math.floor(playhead/4)+1).padStart(2,'0')}<i>:</i>
        {String(Math.floor(playhead%4)+1).padStart(2,'0')}</strong></div>
      <button className="transport-utility" title="Undo" onClick={()=>command('undo')}><RotateCcw size={18}/></button>
      <button className="transport-utility" title="Quantize selected track"
        onClick={()=>command('quantize')}><Redo2 size={18}/></button>
    </section>

    {project&&track?
      <div className={'workspace '+(mode==='SONG'?'song-workspace':'sound-workspace')}>
        {mode==='SONG'?<>
          <Timeline project={project} selected={selected} beat={playhead} playing={snapshot?.playing??false}
            recording={snapshot?.recording??false}
            onSelect={index=>command('select',index)}
            onMute={(idx,next)=>command('track',[idx,'mute',next])}
            onEdit={(idx,noteIndex,note)=>command('edit_note',[idx,noteIndex,note])}/>
          <div className="song-lower">
            <PatternSync project={project} selected={selected} beat={playhead} playing={snapshot?.playing??false}
              recording={snapshot?.recording??false} onSelect={index=>command('select',index)}/>
            <AudioScope monitor={snapshot?.meter??null} running={snapshot?.playing??false}
              voices={snapshot?.voices??0} underruns={snapshot?.underruns??0} preview={isPreview}/>
          </div>
        </>:mode==='SOUND'?<>
          <div className="sound-top">
            <SoundLab track={track} selected={selected} onParam={(name,index,val)=>onParam(name,index,val)}
              onPreset={preset=>command('preset',preset)}
              onSaveSound={()=>showFileDialog('save','instrument','save_preset')}/>
            <AudioScope monitor={snapshot?.meter??null} running={snapshot?.playing??false}
              voices={snapshot?.voices??0} underruns={snapshot?.underruns??0} preview={isPreview}/>
          </div>
          <SoundRack track={track} selected={selected}
            onParam={(name,index,val)=>onParam(name,index,val)} onTrack={onTrack}
            onSound={()=>setMode('SOUND')}/>
        </>:<Performance state={project.performance} beat={playhead}
          playing={snapshot?.playing??false} held={snapshot?.held_notes??[]}
          selectedTrack={selected}
          onSet={(section,key,value)=>command('perform_set',[section,key,value])}
          onStep={(index,notes,replace)=>command('perform_step',[index,notes,replace])}
          onAction={(action,value)=>command('perform_action',[action,value??null])}
          onPlay={()=>command('play')}
          onTempo={bpm=>command('tempo',bpm)}/>}
      </div>
      :<div className="workspace loading-workspace"><AudioWaveform size={40}/><p>Connecting to the DeckSynth audio engine…</p></div>}

    <footer className="app-footer">
      <div className="foot-left"><span className="footer-brand">DS / INSTRUMENT 01</span>
        <span className={'footer-status'+(bridgeStatus==='ERROR'?' error':'')}>{bridgeStatus}</span>
        {project?<span className="foot-detail">{totalNotes(project)} MIDI notes <b>·</b> {instruments[selected]} selected</span>:null}
      </div>
      <div className="foot-right">
        <button type="button" onClick={()=>showFileDialog('open','project','load')}><FolderOpen size={16}/> OPEN</button>
        <button type="button" onClick={()=>showFileDialog('save','project','save')}><Disc3 size={16}/> SAVE</button>
        <button type="button" onClick={()=>showFileDialog('save','midi','export')}><FileDown size={16}/> MIDI EXPORT</button>
      </div>
    </footer>

    {toast?<div className="toast" role="status">{toast}<button aria-label="Dismiss message" onClick={()=>setToast('')}>✕</button></div>:null}
    {dialog?<div className="modal-screen" onPointerDown={event=>{if(event.target===event.currentTarget)setDialog(null);}}>
      {dialog==='settings'?<section className="settings-dialog" role="dialog" aria-label="Audio and MIDI settings" aria-modal="true">
        <header><div><span className="eyebrow">ROUTING</span><h2>Audio & MIDI</h2></div>
          <button className="modal-close" onClick={()=>setDialog(null)}>CLOSE ✕</button></header>
        <label className="setting-field"><span><Radio size={16}/> MIDI INPUT</span>
          <select value="Auto" onChange={e=>command('device',e.target.value)}>
            <option value="Auto">Auto detect</option>
            {snapshot?.devices.map(device=><option key={device} value={device}>{device}</option>)}
          </select></label>
        <label className="setting-field"><span><Headphones size={16}/> AUDIO OUTPUT</span>
          <select value={snapshot?.audio_output||'Deck speakers'}
            onChange={e=>command('audio_device',e.target.value)}>
            {Array.from(new Set(['Deck speakers','System default',...(snapshot?.audio_outputs||[])]))
              .map(device=><option key={device} value={device}>{device}</option>)}
          </select></label>
        <p>Output defaults to the Steam Deck speakers so connecting the Roland as a MIDI controller does not silently redirect audio to the piano.</p>
        <button className="panic-action" onClick={()=>command('panic')}>PANIC · RELEASE ALL NOTES</button>
      </section>:<section className="settings-dialog" role="dialog" aria-label="Performance help" aria-modal="true">
        <header><div><span className="eyebrow">SHORT GUIDE</span><h2>Play / Record / Shape</h2></div>
          <button className="modal-close" onClick={()=>setDialog(null)}>CLOSE ✕</button></header>
        <p>SONG: select a track, record a 1–8-bar MIDI loop, and layer more parts while the first loops. The sequencer pads are a visual mirror of the notes, not a separate drum machine.</p>
        <p>SOUND: choose presets and shape harmonics. Drag a knob vertically; hold Shift for fine control. Tap the numeric value for precise entry. The device rack has foldable panels and contextual envelope editing.</p>
        <p>Keys: F5 Play, F6 Stop, F7 Record, F8/F9 Track, F10 Undo. Audio monitor uses real synthesized PCM samples when the bridge is connected.</p>
      </section>}
    </div>:null}
  </main>;
}
export default App;
