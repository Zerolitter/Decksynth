import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, AudioWaveform, CircleDot, CircleHelp, Disc3, FileDown,
  FolderOpen, Pause, Play, Redo2,
  RotateCcw, Save, Settings as SettingsIcon, Square,
} from 'lucide-react';
import { Timeline } from './components/Timeline';
import { Arranger, ClipSheet, SongBar, type SongSel, type SongView } from './components/SongArranger';
import { CLIP_NAMES, MAX_BARS, clipsOf, defaultSong, markerAt, previewClip, songOf, type Song } from './song';
import { PatternSync } from './components/PatternSync';
import { AudioScope } from './components/AudioScope';
import { SoundWindow } from './components/SoundLab';
import { SoundCards } from './components/Rack';
import { DrumRack } from './components/DrumRack';
import { ModBand } from './components/ModBand';
import type { Source } from './components/ModParts';
import { Settings, readSettings, writeSettings, type AppSettings, type Cleanup } from './components/Settings';
import { defaultFxChain, normalizeChain } from './fx';
import { Performance, PerformTools } from './components/Performance';
import { Panel } from './components/Panel';
import { PageBar, PageTabs, type Page } from './components/PageBar';
import { FxCards, FxWindow } from './components/FxRack';
import type { FxChain } from './fx';
import { harmonicShape, nextSeed, type Shape } from './spectral-seeds';
import { interpolateBeat, totalNotes } from './pattern';
import { PresetBrowser, LIBRARY } from './components/PresetBrowser';
import { TRACK_COLORS, clamp, type BridgeMessage, type DeckUpdate, type Instrument, type Note, type StepNote } from './types';
import previewState from './preview-state.json';
import './styles.css';

type Dialog = 'settings'|'help'|null;
const api=window.deckApi;
const demoInitial = previewState as DeckUpdate;

function emptyInstrument(preset:string):Instrument {
  const lib=LIBRARY.presets.find(p=>p.name===preset);
  if(lib)return structuredClone(lib.instrument) as Instrument;
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

/** Preview mode: notes each chord pad key started, so its note-off releases them all. */
const previewPads=new Map<number,number[]>();

function App() {
  const [snapshot,setSnapshot]=useState<DeckUpdate|null>(api?null:demoInitial);
  const [page,setPageState]=useState<Page>(()=>{try{return (localStorage.getItem('decksynth.page') as Page)||'SONG';}catch{return 'SONG';}});
  const [edit,setEdit]=useState<Source>({kind:'mod',index:0});
  const [armed,setArmed]=useState<Source|null>(null);
  const [settings,setSettingsState]=useState<AppSettings>(readSettings);
  const setSettings=(s:AppSettings)=>{setSettingsState(s);writeSettings(s);};
  const setPage=(next:Page)=>{setPageState(next);if(next!=='FX'&&next!=='SOUND')setArmed(null);try{localStorage.setItem('decksynth.page',next);}catch{/* optional */}};
  const [fileMenu,setFileMenu]=useState(false);
  const [dialog,setDialog]=useState<Dialog>(null);
  // Song page view: Clip notes in Loop mode and the Timeline in Song mode, until you pick one yourself.
  const [songViewPick,setSongView]=useState<SongView|null>(null);
  const [songZoom,setSongZoom]=useState(16);
  const [songStart,setSongStart]=useState(0);
  const [songSel,setSongSel]=useState<SongSel>(null);
  const [clipSheet,setClipSheet]=useState<number|null>(null);
  const [toast,setToast]=useState('');
  const [bridgeStatus,setBridgeStatus]=useState(api?'CONNECTING':'PREVIEW');
  const [playhead,setPlayhead]=useState(0);
  const anchor=useRef({beat:0,when:performance.now(),bpm:120,bars:4,playing:false,preview:false});
  const lastVisualFrame=useRef(0);
  const selected=snapshot?.selected??0;
  const isPreview=!api||!!snapshot?.preview;
  const project=snapshot?.state;
  const track=project?.tracks[selected];
  const song=project?songOf(project):defaultSong();
  const songView:SongView=songViewPick??(song.on?'arrange':'clips');
  // Song playhead: the engine's beat since play started, moved on smoothly between updates, wrapped when the song loops.
  const loopBeats=(project?.bars??4)*4;
  const rawSongBeat=snapshot?.song_beat!==undefined?snapshot.song_beat+(((playhead-snapshot.beat)%loopBeats)+loopBeats)%loopBeats:playhead;
  const songBeat=song.loop?rawSongBeat%(song.length*4):Math.min(rawSongBeat,song.length*4);
  // Follow the playhead: when it runs out of the bars in view, page along with it (paging away yourself is kept).
  const headBar=Math.floor(songBeat/4),lastHead=useRef(headBar);
  useEffect(()=>{
    const was=lastHead.current;lastHead.current=headBar;
    if(!(snapshot?.playing&&song.on)||was===headBar)return;
    const inView=(b:number)=>b>=songStart&&b<songStart+songZoom;
    if(inView(was)&&!inView(headBar))setSongStart(Math.min(MAX_BARS-songZoom,Math.floor(headBar/songZoom)*songZoom));
  },[headBar]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{setArmed(null);},[selected]);
  // Link mode ends on Done, a second tap on the label, Esc, the Deck's B button, or a tap on blank space.
  useEffect(()=>{
    if(!armed)return;
    const keep='button,input,select,textarea,a,[role="button"],[role="slider"],[role="tab"],.parameter-knob,.mod-band,.pad-editor,.fx-target-add';
    const down=(e:PointerEvent)=>{const t=e.target as Element|null;if(t&&!t.closest(keep))setArmed(null);};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setArmed(null);};
    let raf=0,wasDown=true;
    const poll=()=>{const pads=navigator.getGamepads?.()??[];
      const b=[...pads].some(g=>!!g?.buttons?.[1]?.pressed);
      if(b&&!wasDown){setArmed(null);return;}wasDown=b;raf=requestAnimationFrame(poll);};
    raf=requestAnimationFrame(poll);
    document.addEventListener('pointerdown',down,true);window.addEventListener('keydown',key);
    return()=>{cancelAnimationFrame(raf);document.removeEventListener('pointerdown',down,true);window.removeEventListener('keydown',key);};
  },[armed]);

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
      else if(cmd==='fx'){const [index,chain]=args as [number,FxChain];next.state.tracks[index].fx=chain;}
      else if(cmd==='spectral_seed'){
        const [index,name]=args as [number,Shape];if(index!==next.selected)return next;
        const ins=next.state.tracks[index].instrument,seed=name==='RANDOM'?nextSeed(ins.random_seed??0):ins.random_seed??0;
        ins.harmonics=harmonicShape(name,seed);ins.spectral_energy=1;if(name==='RANDOM')ins.random_seed=seed;
      }
      else if(cmd==='fx_reorder'){
        const [index,ids]=args as [number,string[]],chain=normalizeChain(next.state.tracks[index].fx);
        next.state.tracks[index].fx={...chain,modules:[...ids.map(id=>chain.modules.find(m=>m.id===id)!),...chain.modules.filter(m=>!m.on)]};
      }
      else if(cmd==='cleanup'){
        const unlink=(c:FxChain):FxChain=>({...c,macros:c.macros.map(m=>({...m,targets:[]})),mods:c.mods.map(m=>({...m,targets:[]}))});
        if(arg==='all')return {...structuredClone(demoInitial),state:{...structuredClone(demoInitial.state),
          tracks:demoInitial.state.tracks.map(t=>({...structuredClone(t),notes:[],fx:undefined}))}};
        if(arg==='links')next.state.tracks.forEach(t=>{if(t.fx)t.fx=unlink(normalizeChain(t.fx));});
        if(arg==='sound')owner.instrument=emptyInstrument(owner.preset);
        if(arg==='effects'){const c=unlink(normalizeChain(owner.fx));owner.fx={...c,modules:c.modules.map(m=>({...m,on:false}))};}
        if(arg==='mods')owner.fx=unlink({...normalizeChain(owner.fx),mods:defaultFxChain().mods});
      }
      else if(cmd==='clear'){owner.notes=[];next.playing=false;}
      else if(cmd==='song')next.state.song=arg as Song;
      else if(cmd==='clip')previewClip(next.state,arg as [number,string,number,number?]);
      else if(cmd==='midi'){
        const [status,note,,padNotes]=args as [number,number,number,number[]|undefined];const kind=status&0xf0;
        const keys=new Set(next.held_notes??[]);
        // A chord pad sends its exact notes with the key; they are released together.
        if(kind===0x90&&padNotes)previewPads.set(note,padNotes);
        const sounding=kind===0x90?padNotes??[note]:previewPads.get(note)??[note];
        if(kind===0x80)previewPads.delete(note);
        if(kind===0x90)sounding.forEach(n=>keys.add(n));else if(kind===0x80&&!next.state.performance.arp.hold)sounding.forEach(n=>keys.delete(n));
        const seq=next.state.performance.seq;
        if(kind===0x90&&seq.recording){
          const key=seq.bank+':'+seq.slot;
          const pat=next.state.performance.patterns[key]??{length:seq.length,division:seq.division,gate:seq.gate,swing:seq.swing,
            steps:Array.from({length:seq.length},()=>[])};
          const at=(next.rec_step??0)%pat.length;
          pat.steps[at]=(seq.overdub?pat.steps[at]:[]).concat(sounding.map(n=>({note:n,velocity:100,tie:1}))).slice(0,8);
          next.state.performance.patterns[key]=pat;next.rec_step=(at+1)%pat.length;
        }
        next.held_notes=[...keys].sort((a,b)=>a-b);
      }
      else if(cmd==='panic')next.held_notes=[];
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
        if(section==='seq'&&(key==='recording'||key==='bank'||key==='slot'))next.rec_step=0;
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
        if(action==='rec_cursor')next.rec_step=value as number;
        if(action==='arp_pause'){next.arp_view={...(next.arp_view??{groups:[],step:-1}),paused:!next.arp_view?.paused};return next;}
        if(action==='arp_stop'){next.held_notes=[];next.arp_view=next.arp_view?{...next.arp_view,paused:false}:next.arp_view;return next;}
        const ch=next.state.performance.chord;
        if(action==='save_slot'){const [i,notes]=value as [number,number[]];ch.slots=(ch.slots??Array.from({length:8},()=>[])).map((c,k)=>k===i?[...notes]:c);return next;}
        if(action==='clear_slot'){ch.slots=(ch.slots??Array.from({length:8},()=>[])).map((c,k)=>k===value?[]:c);return next;}
        if(action==='save_chord'){const notes=value as number[];ch.user=notes.map(n=>n-notes[0]);ch.preset='User';return next;}
        if(action==='paste_pattern'&&typeof value==='string'&&next.state.performance.patterns[value]){
          const src=JSON.parse(JSON.stringify(next.state.performance.patterns[value]));
          next.state.performance.patterns[key]=src;Object.assign(seq,{length:src.length,division:src.division,gate:src.gate,swing:src.swing});
          return next;}
        if(action==='rec_rest')next.rec_step=((next.rec_step??0)+1)%existing.length;
        if(action==='rec_back'){next.rec_step=((next.rec_step??0)-1+existing.length)%existing.length;existing.steps[next.rec_step].splice(0);}
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
  const importDrum=async(pad:number,relink:boolean)=>{
    if(isPreview||!api){setToast('Open the native audio app to import a WAV');return;}
    const tr=selected,kit=track?.drum_rack;
    if(!kit)return;
    const sha=relink?kit.pads[pad].source?.sha256??null:null;
    const filepath=await api.chooseFile('open','sample');
    if(filepath)command('drum_import',[tr,kit.id,pad,filepath,sha]);
  };
  const chooseDrumLibrary=async()=>{
    if(isPreview||!api){setToast('Open the native audio app to choose a sample folder');return;}
    const directory=await api.chooseFile('open','sample_folder');
    if(directory)command('drum_library_root',directory);
  };
  const onParam=(key:keyof Instrument,index:number|null,value:number)=>command('parameter',key==='character'?[key,index,value,selected]:[key,index,value]);
  const onTrack=(key:'mute'|'volume',value:boolean|number)=>command('track',[selected,key,value]);

  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(dialog)return;
      const target=event.target as HTMLElement;
      if(['INPUT','TEXTAREA','SELECT'].includes(target?.tagName)||target?.isContentEditable)return;
      const k=event.key;
      if(k===' '&&target?.closest('button,[role="button"],[role="slider"],[role="tab"]'))return;
      const controls:{[key:string]:string}={F5:'play',F6:'stop',F7:'record',F10:'undo'};
      if(controls[k]){event.preventDefault();command(controls[k]);return;}
      if(k==='F8'||k==='F9'){event.preventDefault();command('select',(selected+(k==='F8'?3:1))%4);}
      else if(k===' '){event.preventDefault();command('play');}
    };
    window.addEventListener('keydown',handler);
    return()=>window.removeEventListener('keydown',handler);
  },[selected,dialog,command]);

  const instruments=project?.tracks.map(t=>t.preset)||[];
  return <main className="decksynth-shell harness-shell">
    <header className="app-header transport" aria-label="Music transport">
      <span className="brand-glyph" title="DeckSynth"><AudioWaveform size={22} strokeWidth={1.65}/></span>
      <div className="transport-actions">
        <button type="button" className={'transport-pad play'+(snapshot?.playing?' engaged':'')}
          onClick={()=>command('play')} aria-label={snapshot?.playing?'Pause loop':'Play loop'}>
          {snapshot?.playing?<Pause size={20} fill="currentColor"/>:<Play size={20} fill="currentColor"/>}
          <span>{snapshot?.playing?'PAUSE':'PLAY'}</span>
        </button>
        <button type="button" className="transport-pad stop" onClick={()=>command('stop')} aria-label="Stop">
          <Square size={17} fill="currentColor"/><span>STOP</span>
        </button>
        <button type="button" className={'transport-pad record'+(snapshot?.recording?' engaged':'')}
          onClick={()=>command('record')} aria-label={snapshot?.recording?'Finish take':'Record'}>
          <CircleDot size={20}/><span>{snapshot?.recording?'FINISH':'REC'}</span>
        </button>
      </div>
      <div className="transport-lcd" role="group" aria-label="Tempo, loop and position">
      <div className="tempo-display" aria-label="Tempo">
        <span>BPM</span><strong>{Math.round(project?.bpm??120)}</strong>
        <div className="tempo-adjust">
          <button title="Tempo −5 BPM" onClick={()=>command('tempo',clamp((project?.bpm??120)-5,30,240))}>−</button>
          <button title="Tempo +5 BPM" onClick={()=>command('tempo',clamp((project?.bpm??120)+5,30,240))}>+</button>
        </div>
      </div>
      <div className="bars-display">
        <select aria-label="Loop bars" value={project?.bars??4}
          onChange={e=>command('bars',Number(e.target.value))}>
          {[1,2,4,8].map(n=><option value={n} key={n}>{n} BARS</option>)}
        </select>
      </div>
      {(()=>{const b=song.on?songBeat:playhead,m=song.on?markerAt(song,Math.floor(songBeat/4)):-1;
        return <div className="transport-beat" aria-label="Position"><strong>
          {String(Math.floor(b/4)+1).padStart(2,'0')}<i>:</i>
          {String(Math.floor(b%4)+1).padStart(2,'0')}</strong>
          <span>{song.on?(m>=0?song.markers[m].name:'song')+' · '+song.length+' bars':'loop · '+(project?.bars??4)+(project?.bars===1?' bar':' bars')}</span></div>;})()}
      </div>
      <button type="button" className={'metronome-button'+(project?.metronome?' active':'')} aria-pressed={!!project?.metronome}
        title="Metronome click" onClick={()=>command('metronome',!project?.metronome)}>
        <span className="button-led"/><span>CLICK</span></button>
      <button className="transport-utility" title="Undo" aria-label="Undo" onClick={()=>command('undo')}><RotateCcw size={18}/></button>
      <button className="transport-utility" title="Quantize selected track" aria-label="Quantize"
        onClick={()=>command('quantize')}><Redo2 size={18}/></button>
      <PageTabs page={page} onPage={setPage}/>
      <div className="transport-spacer"/>
      {isPreview?<span className="demo-badge">PREVIEW · NO AUDIO</span>
        :<div className={'device-pill'+(snapshot?.connected?' connected':'')} title={renderMIDI(snapshot?.connected||null)}>
          <span className="pill-led"/><span className="pill-name">{snapshot?.connected?renderMIDI(snapshot.connected):'No MIDI'}</span>
          <span className={'footer-status'+(bridgeStatus==='ERROR'?' error':'')}>{bridgeStatus}</span>
        </div>}
      <div className="file-menu">
        <button className="icon-button" aria-label="Project files" title="Open, save, export"
          aria-expanded={fileMenu} onClick={()=>setFileMenu(v=>!v)}><FolderOpen size={19}/></button>
        {fileMenu?<div className="file-menu-pop" role="menu" onClick={()=>setFileMenu(false)}>
          <button role="menuitem" type="button" onClick={()=>showFileDialog('open','project','load')}><FolderOpen size={16}/> Open project</button>
          <button role="menuitem" type="button" onClick={()=>showFileDialog('save','project','save')}><Disc3 size={16}/> Save project</button>
          <button role="menuitem" type="button" onClick={()=>showFileDialog('save','midi','export')}><FileDown size={16}/> Export MIDI</button>
          <span className="file-menu-meta">{project?totalNotes(project)+' notes · '+(instruments[selected]??''):''}</span>
        </div>:null}
      </div>
      <button className="icon-button" aria-label="Help" title="Help" onClick={()=>setDialog('help')}><CircleHelp size={19}/></button>
      <button className="icon-button" aria-label="Settings" title="Settings"
        onClick={()=>setDialog('settings')}><SettingsIcon size={19}/></button>
    </header>

    <div className={'workspace-stage page-'+page.toLowerCase()}>
    {project&&track?<>
      <PageBar tracks={project.tracks} selected={selected}
        onSelect={index=>command('select',index)} beat={playhead} beats={project.bars*4} playing={snapshot?.playing??false}
        tools={page==='SOUND'?<>
          <select className="track-device-picker" aria-label="Track device" value={track.device??'synth'} style={{minHeight:44,minWidth:116,width:116,padding:'0 10px'}}
            onChange={e=>{if(isPreview){setToast('Select devices in the native audio app');return;}command('set_device',[selected,e.target.value]);}}>
            <option value="synth">Synth</option><option value="drum_rack">Drum Rack</option>
          </select>
          {track.device!=='drum_rack'?<><PresetBrowser current={track.preset} accent={TRACK_COLORS[selected]} onPreset={preset=>command('preset',preset)}/>
          <button type="button" className="page-tool-icon" aria-label="Save patch" title="Save patch"
            onClick={()=>showFileDialog('save','instrument','save_preset')}><Save size={18}/></button></>:null}
        </>:page==='PERFORM'?<PerformTools hold={project.performance.arp.hold}
          onHold={()=>command('perform_set',['arp','hold',!project.performance.arp.hold])}
          onPanic={()=>command('panic')} arp={project.performance.arp.enabled} paused={!!snapshot?.arp_view?.paused}
          onArp={a=>command('perform_action',[a,null])}/>:undefined}/>
      <div className="page-body">
      {page==='SONG'?<div className="song-page">
        {(()=>{
          const bar=<SongBar project={project} song={song} view={songView} onView={v=>{setSongView(v);setSongSel(null);}} onSong={s=>command('song',s)}
            zoom={songZoom} onZoom={z=>{setSongZoom(z);setSongStart(Math.floor(songStart/z)*z);}} start={songStart} onStart={setSongStart}
            sel={songSel} onSel={setSongSel} playing={snapshot?.playing??false} songBeat={songBeat} loopBeat={playhead}
            onClip={(t,action,clip,source)=>command('clip',[t,action,clip,source??null])}
            onEditClip={(t,clip)=>{command('clip',[t,'open',clip,null]);command('select',t);setSongSel(null);setSongView('clips');}}/>;
          return songView==='arrange'?<section className="timeline song-timeline" aria-label="Song">
            {bar}
            <Arranger project={project} song={song} selected={selected} zoom={songZoom} start={songStart} sel={songSel} onSel={setSongSel}
              onSong={s=>command('song',s)} playing={snapshot?.playing??false} songBeat={songBeat}
              onSelect={index=>command('select',index)} onMute={(idx,next)=>command('track',[idx,'mute',next])} onClips={t=>setClipSheet(t)}/>
          </section>
          :<Timeline project={project} selected={selected} beat={playhead} playing={snapshot?.playing??false}
            recording={snapshot?.recording??false} header={bar}
            loops={project.tracks.map((_,t)=>{const k=clipsOf(project).open[t];
              return {label:CLIP_NAMES[k],sub:'clip',aria:'Clips of track '+(t+1)+': clip '+CLIP_NAMES[k]+' is open',title:'Open, copy or clear this track\'s clips'};})}
            onLoops={t=>setClipSheet(t)}
            onSelect={index=>command('select',index)}
            onMute={(idx,next)=>command('track',[idx,'mute',next])}
            onEdit={(idx,noteIndex,note)=>command('edit_note',[idx,noteIndex,note])}
            onOpenSound={index=>{command('select',index);setPage('SOUND');}}/>;
        })()}
        {clipSheet!==null?<ClipSheet project={project} song={song} track={clipSheet}
          container={document.querySelector('.song-page')} onClose={()=>setClipSheet(null)}
          onClip={(t,action,clip,source)=>command('clip',[t,action,clip,source??null])}/>:null}
        <Panel id="song-lower" className="song-lower-panel" title="Step view and output" icon={<Activity size={15}/>}
          summary={(snapshot?.voices??0)+' voices'}>
          <div className="song-lower">
            <PatternSync project={project} selected={selected} beat={playhead} playing={snapshot?.playing??false}
              recording={snapshot?.recording??false} onSelect={index=>command('select',index)}/>
            <AudioScope monitor={snapshot?.meter??null} running={snapshot?.playing??false}
              voices={snapshot?.voices??0} underruns={snapshot?.underruns??0} preview={isPreview}
              load={snapshot?.dsp_load} bufferMs={snapshot?.buffer_ms}/>
          </div>
        </Panel>
      </div>
      :page==='SOUND'&&track.device==='drum_rack'?<DrumRack key={selected+':'+track.drum_rack?.id} track={track} trackIndex={selected}
        runtime={snapshot?.drum_racks?.[selected]??undefined}
        output={{peak:snapshot?.meter?.peak??0,rms:snapshot?.meter?.rms??0,voices:snapshot?.voices??0,underruns:snapshot?.underruns??0,driver:snapshot?.audio??'Unavailable'}}
        onNote={(pad,velocity)=>{if(track.drum_rack)command('drum_note',[selected,track.drum_rack.id,pad,velocity]);}}
        onEdit={(pad,key,value)=>{if(track.drum_rack)command('drum_edit',[selected,track.drum_rack.id,pad,key,value]);}}
        onImport={importDrum} library={snapshot?.drum_library}
        onLoadFolder={folder=>{if(track.drum_rack)command('drum_load_folder',[selected,track.drum_rack.id,folder]);}}
        onChooseLibrary={chooseDrumLibrary} onRefreshLibrary={()=>command('drum_library_refresh')}/>
      :page==='SOUND'||page==='FX'?<div className={'frame frame-'+page.toLowerCase()}>
        <ModBand key={selected} selected={selected} chain={track.fx} onChange={chain=>command('fx',[selected,chain])} beat={playhead}
          live={snapshot?.meter?.fx_live} edit={edit} onEdit={setEdit} armed={armed}
          onLink={setArmed}/>
        {page==='SOUND'?<>
          <SoundWindow track={track} selected={selected} onParam={(name,index,val)=>onParam(name,index,val)}
            onShape={name=>command('spectral_seed',[selected,name])}
            chain={track.fx} onChain={chain=>command('fx',[selected,chain])}
            live={snapshot?.meter?.fx_live} bpm={project.bpm}/>
          <SoundCards key={selected} track={track} selected={selected} onParam={(name,index,val)=>onParam(name,index,val)} onTrack={onTrack} autoFold={!settings.noAutoFold}
            onChain={chain=>command('fx',[selected,chain])} armed={armed} source={edit} live={snapshot?.meter?.fx_live}/>
        </>:<>
          <FxWindow chain={track.fx} onChange={chain=>command('fx',[selected,chain])} live={snapshot?.meter?.fx_live} bpm={project.bpm}/>
          <FxCards key={selected} selected={selected} chain={track.fx} onChange={chain=>command('fx',[selected,chain])}
            onReorder={ids=>command('fx_reorder',[selected,ids])}
            live={snapshot?.meter?.fx_live} armed={armed} source={edit} autoFold={!settings.noAutoFold}
            beat={snapshot?.song_beat??playhead} playing={snapshot?.playing??false}/>
        </>}
      </div>
      :<div className="perform-page"><Performance state={project.performance} beat={playhead}
          playing={snapshot?.playing??false} held={snapshot?.held_notes??[]} arpView={snapshot?.arp_view} recStep={snapshot?.rec_step??0}
          selectedTrack={selected}
          onSet={(section,key,value)=>command('perform_set',[section,key,value])}
          onStep={(index,notes,replace)=>command('perform_step',[index,notes,replace])}
          onAction={(action,value)=>command('perform_action',[action,value??null])}
          onPlay={()=>command('play')}
          onTempo={bpm=>command('tempo',bpm)}
          onMidi={(status,a,b,notes)=>command('midi',notes?[status,a,b,notes]:[status,a,b])}/></div>}
      </div>
    </>:<div className="workspace loading-workspace"><AudioWaveform size={40}/><p>Connecting to the DeckSynth audio engine…</p></div>}
    </div>

    {toast?<div className="toast" role="status">{toast}<button aria-label="Dismiss message" onClick={()=>setToast('')}>✕</button></div>:null}
    {dialog?<div className="modal-screen" onPointerDown={event=>{if(event.target===event.currentTarget)setDialog(null);}}>
      {dialog==='settings'?<Settings settings={settings} onSettings={setSettings}
        trackName={(selected+1)+' '+(track?.preset??'')} onCleanup={(c:Cleanup)=>command('cleanup',c)}
        devices={snapshot?.devices??[]} audioOutput={snapshot?.audio_output||'Deck speakers'} audioOutputs={snapshot?.audio_outputs??[]}
        onDevice={d=>command('device',d)} onAudio={d=>command('audio_device',d)} onPanic={()=>command('panic')}
        onClose={()=>setDialog(null)}/>
      :<section className="settings-dialog" role="dialog" aria-label="Performance help" aria-modal="true">
        <header><div><span className="eyebrow">SHORT GUIDE</span><h2>Play / Record / Shape</h2></div>
          <button className="modal-close" onClick={()=>setDialog(null)}>CLOSE ✕</button></header>
        <p>Song, Sound, FX and Perform are full pages. The track buttons next to the page tabs pick the track you are editing. On Sound and FX, the macros and mod pads sit top left with the editor of the tapped pad beside them; tap a pad's bottom label (or a macro's name), then tap knobs, then Done. Double-tap a card's title to fold it. Clean up lives in Settings (the gear).</p>
        <p>SONG: select a track, record a 1–8-bar MIDI loop, and layer more parts while the first loops. The sequencer pads are a visual mirror of the notes, not a separate drum machine.</p>
        <p>SONG TIMELINE: each track has 8 clips (A–H). Switch to Song, then tap empty bars to place a track's open clip, and tap a block to change its clip, length or start bar, copy it, split it or make a new clip from it for a variation or a fill. Tap the bar ruler to add a marker (Intro, Drop…).</p>
        <p>LINKING: tap the label under a mod pad (or a macro's name) and then tap knobs; tap Done, Esc or an empty spot to stop. Or open a pad's Links and tap parameter names. Each link's depth runs from −100 % to +100 %: drag its bar, or drag the outer ring of a linked knob while linking. Long-press a depth to type it.</p>
        <p>SOUND: choose presets and shape harmonics. Drag a knob vertically; hold Shift for fine control. Tap the numeric value for precise entry. Tap the small envelope picture to open the envelope editor and drag its dots; hold still a moment before moving for fine steps.</p>
        <p>Keys: F5 Play, F6 Stop, F7 Record, F8/F9 Track, F10 Undo. Audio monitor uses real synthesized PCM samples when the bridge is connected.</p>
      </section>}
    </div>:null}
  </main>;
}
export default App;
