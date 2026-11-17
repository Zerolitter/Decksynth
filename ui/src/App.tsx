import {soundDefault} from './parameter-registry';
import {ContextWheelProvider,ContextAreaScope} from './components/ContextWheel';
import {ModLinkProvider} from './components/ModLink';
import {expectedWithEvents,type NoteTarget} from './note-ops';
import {PanelScope} from './components/Panel';
import {InstrumentSwitcher} from './components/InstrumentSwitcher';
import {AutomationEditor} from './components/AutomationEditor';
import {FreezeSheet} from './components/Freeze';
import type {ControlTarget} from './parameter-registry';
import {MidiLearnProvider} from './components/MidiLearn';
import {FILTER_ENV_KEYS} from './sound-cards';
import { useCallback, useEffect, useRef, useState } from 'react';
import {deckStore,useDeck,useLive,sameExceptLive} from './deck-store';
import {useFrame,useClockValue} from './frame-clock';
import {
  AudioWaveform, CircleDot, CircleHelp, Disc3, FileDown,
  FolderOpen, Pause, Play, Redo2,
  RotateCcw, Save, Settings as SettingsIcon, Snowflake, Square,
} from 'lucide-react';
import { Timeline } from './components/Timeline';
import { Arranger, ClipSheet, SongBar, type SongSel, type SongView } from './components/SongArranger';
import { CLIP_NAMES, MAX_BARS, clipsOf, defaultSong, markerAt, previewClip, songOf,type Song } from './song';
import {clipPlayback} from './transport-clock';
import {LoopBars} from './components/LoopBars';
import {DrumSteps} from './components/DrumSteps';
import { AudioScope } from './components/AudioScope';
import { DrumRack } from './components/DrumRack';
import { SamplerPage, PlayOnKeysSheet, padChoices } from './components/Sampler';
import { drumKind, padLabel } from './drum-kinds';
import { LinkPage } from './components/LinkPage';
import { SynthSound } from './components/SynthSound';
import { SendKnobs, SendsOpen, SendsSheet } from './components/Sends';
import type { Source } from './components/ModParts';
import { Settings, readSettings, writeSettings, type AppSettings, type Cleanup } from './components/Settings';
import { defaultFxChain, normalizeChain } from './fx';
import { Performance, PerformTools } from './components/Performance';
import {Help} from './components/Help';
import { ValueBox } from './components/ValueBox';
import { LinkBox, PageBar, PageTabs, deviceName, type Page } from './components/PageBar';
import { FxCards } from './components/FxRack';
import type { FxChain } from './fx';
import { harmonicShape, nextSeed, type Shape } from './spectral-seeds';
import { totalNotes } from './pattern';
import { PresetBrowser, LIBRARY } from './components/PresetBrowser';
import { TRACK_COLORS, clamp, type BridgeMessage, type DeckUpdate, type Instrument, type Note, type SendBus, type StepNote } from './types';
import previewState from './preview-state.json';
import { voiceChord } from './chords';
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

/** The bar:beat readout in the top bar. Only this element renders as the beat moves. */
function TransportBeat({song,bars}:{song:Song;bars:number}){
  const b=Math.floor(useClockValue(p=>song.on?p.songBeat:p.clipBeat));
  const m=song.on?markerAt(song,Math.floor(b/4)):-1;
  return <div className="transport-beat" aria-label="Position"><strong>
    {String(Math.floor(b/4)+1).padStart(2,'0')}<i>:</i>
    {String(b%4+1).padStart(2,'0')}</strong>
    <span>{song.on?(m>=0?song.markers[m].name:'song')+' · '+song.length+' bars':'loop · '+bars+(bars===1?' bar':' bars')}</span></div>;
}
/** Meters, voices and load go straight from the store to the scope, without App. */
function LiveScope(props:{underruns:number;preview:boolean;bufferMs?:number}){
  const voices=useLive(s=>s?.voices??0),load=useLive(s=>s?.dsp_load);
  return <AudioScope voices={voices} load={load} {...props}/>;
}
/** The live effect and mod values of the selected track, for the page that shows them. */
function FxLive({children}:{children:(live:NonNullable<DeckUpdate['meter']>['fx_live'])=>React.ReactNode}){
  return <>{children(useLive(s=>s?.meter?.fx_live))}</>;
}
function ArpLive({children}:{children:(arp:DeckUpdate['arp_view'])=>React.ReactNode}){
  return <>{children(useLive(s=>s?.arp_view))}</>;
}

/** Preview mode: notes each chord pad key started, so its note-off releases them all. */
const previewPads=new Map<number,number[]>();

function App() {
  // The engine state lives in one small store (deck-store.ts). App re-renders only when something other than the
  // live values (beat, meters, voices, load) changes; playheads and meters read the store and the clock themselves.
  const snapshot=useDeck(r=>r.snapshot,sameExceptLive);
  const setSnapshot=deckStore.set;
  const [page,setPageState]=useState<Page>(()=>{try{return (localStorage.getItem('decksynth.page') as Page)||'SONG';}catch{return 'SONG';}});
  const [edit,setEdit]=useState<Source>({kind:'mod',index:0});
  const [armed,setArmed]=useState<Source|null>(null);
  const [settings,setSettingsState]=useState<AppSettings>(readSettings);
  const setSettings=(s:AppSettings)=>{setSettingsState(s);writeSettings(s);};
  // An armed macro or mod pad stays armed across pages, so knobs anywhere can be tapped to link (Sir, 16 Nov).
  const setPage=(next:Page)=>{setPageState(next);try{localStorage.setItem('decksynth.page',next);}catch{/* optional */}};
  const closeAutomation=useCallback(()=>setAutomationEdit(undefined),[]);
  const [automationEdit,setAutomationEdit]=useState<ControlTarget|null|undefined>(undefined);
  const [fileMenu,setFileMenu]=useState(false);
  const [freezeOpen,setFreezeOpen]=useState(false);
  const freezeRef=useRef<HTMLDivElement>(null);
  // The Freeze sheet closes with Done, Esc, its own button, or a tap anywhere else.
  useEffect(()=>{if(!freezeOpen)return;
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();setFreezeOpen(false);}};
    const away=(e:PointerEvent)=>{if(!freezeRef.current?.contains(e.target as Node))setFreezeOpen(false);};
    window.addEventListener('keydown',key);window.addEventListener('pointerdown',away);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('pointerdown',away);};},[freezeOpen]);
  const [dialog,setDialog]=useState<Dialog>(null);
  const [helpSection,setHelpSection]=useState<'guide'|'notes'>('guide');
  const helpOrigin=useRef<HTMLElement|null>(null);
  const openHelp=(invoker:HTMLElement|null,section:'guide'|'notes'='guide')=>{
    helpOrigin.current=invoker;setHelpSection(section);setDialog('help');
  };
  useEffect(()=>{
    const open=(event:Event)=>{const detail=(event as CustomEvent<{section:'notes';invoker:HTMLElement}>).detail;openHelp(detail.invoker,detail.section);};
    window.addEventListener('decksynth-open-help',open);
    return()=>window.removeEventListener('decksynth-open-help',open);
  },[]);
  // Song page view: Clip notes in Loop mode and the Timeline in Song mode, until you pick one yourself.
  const [songViewPick,setSongView]=useState<SongView|null>(null);
  const [songZoom,setSongZoom]=useState(16);
  const [songStart,setSongStart]=useState(0);
  const [songSel,setSongSel]=useState<SongSel>(null);
  // SONG → Edit notes opens the selected track's open clip in the Perform note editor (one editor, not a second copy).
  const [performClip,setPerformClip]=useState(false);
  // Partials / Morph pad can be folded away (remembered): the sound cards then wrap over the freed room.
  const [soundFolded,setSoundFolded]=useState(()=>{try{return localStorage.getItem('decksynth.soundFolded')==='1';}catch{return false;}});
  const foldSound=(v:boolean)=>{setSoundFolded(v);try{localStorage.setItem('decksynth.soundFolded',v?'1':'0');}catch{/* optional */}};
  // The FX tab's Morph pad folds the same way, remembered on its own.
  const openClipNotes=(index:number)=>{command('select',index);setPerformClip(true);setPage('PERFORM');};
  const [clipSheet,setClipSheet]=useState<number|null>(null);
  const [toast,setToast]=useState('');
  const [bridgeStatus,setBridgeStatus]=useState(api?'CONNECTING':'PREVIEW');
  const selected=snapshot?.selected??0;
  const [kitBrowserTrack,setKitBrowserTrack]=useState<number|null>(null);
  const [keysSheet,setKeysSheet]=useState<{track:number;pad:number}|null>(null);
  const pendingKit=useRef<{track:number;id:string}|null>(null);
  const pendingSwap=useRef<{track:number;id:string;pad:number;source:string|null}|null>(null);
  useEffect(()=>{setKitBrowserTrack(null);},[selected]);
  // Only return to the pads AFTER the native worker has committed the complete
  // kit/sample. A failed load leaves the browser and existing sound untouched.
  useEffect(()=>{
    if(!snapshot)return;
    const kit=pendingKit.current;
    if(kit && snapshot.state.tracks[kit.track]?.drum_rack?.id!==kit.id){
      pendingKit.current=null;
      if(snapshot.selected===kit.track)setKitBrowserTrack(null);
    }
    const swap=pendingSwap.current;
    if(swap){
      const current=snapshot.state.tracks[swap.track]?.drum_rack;
      if(current?.id!==swap.id){pendingSwap.current=null;return;}
      const path=current.pads[swap.pad]?.source?.path??null;
      if(path!==swap.source){pendingSwap.current=null;if(snapshot.selected===swap.track)setKitBrowserTrack(null);}
    }
  },[snapshot]);
  const isPreview=!api||!!snapshot?.preview;
  const project=snapshot?.state;
  const track=project?.tracks[selected];
  // A counter that moves when the engine sends a new project state, instead of turning the whole project into text on every render.
  const stateRev=useRef<{p:unknown;n:number}>({p:undefined,n:0});
  const stateRevision=(p:unknown)=>{if(stateRev.current.p!==p)stateRev.current={p,n:stateRev.current.n+1};return stateRev.current.n;};
  const song=project?songOf(project):defaultSong();
  const songView:SongView=songViewPick??(song.on?'arrange':'clips');
  // Follow the playhead: when it runs out of the bars in view, page along with it (paging away yourself is kept).
  // Read from the shared frame clock: App only renders when the page actually turns.
  const lastHead=useRef(-1);
  useFrame(p=>{
    const headBar=Math.floor(p.songBeat/4),was=lastHead.current;lastHead.current=headBar;
    if(!(p.playing&&song.on)||was===headBar||was<0)return;
    const inView=(b:number)=>b>=songStart&&b<songStart+songZoom;
    if(inView(was)&&!inView(headBar))setSongStart(Math.min(MAX_BARS-songZoom,Math.floor(headBar/songZoom)*songZoom));
  });
  // Where the open clip of the selected track plays, for the note editor's playhead (song blocks can play another clip).
  const clipClock=useCallback((p:{songBeat:number;clipBeat:number;playing:boolean})=>project?clipPlayback(project,selected,p.songBeat,p.clipBeat,p.playing):null,[project,selected]);
  useEffect(()=>{setArmed(null);},[selected]);
  // Link mode ends on Done, a second tap on the label, Esc, the Deck's B button, or a tap on blank space.
  useEffect(()=>{
    if(!armed)return;
    const keep='button,input,select,textarea,a,[role="button"],[role="slider"],[role="tab"],.parameter-knob,.mod-band,.pad-editor,.fx-target-add,.link-box,.lp-editor,.lp-sources,.page-tabs,.source-inspector,.context-wheel';
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
      if(obj.error){window.dispatchEvent(new CustomEvent('decksynth-command-rejected'));setToast(obj.error);setBridgeStatus('ERROR');return;}
      if(obj.message){setToast(obj.message);return;}
      if(obj.bridge==='ready'){setBridgeStatus('CONNECTED');return;}
      // The engine sends only what changed: the store merges it into what the screen has.
      deckStore.merge(obj);
      setBridgeStatus(obj.preview?'PREVIEW':'CONNECTED');
    });
  },[]);

  useEffect(()=>{
    if(!toast)return;
    const id=window.setTimeout(()=>setToast(''),6000);
    return()=>window.clearTimeout(id);
  },[toast]);

  // Count-in settings live in the UI; the engine gets them whenever it (re)connects or they change.
  useEffect(()=>{if(api&&!isPreview&&bridgeStatus==='CONNECTED')api.send('audio_latency',[settings.latency]);},[settings.latency,bridgeStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(api&&!isPreview&&bridgeStatus==='CONNECTED')api.send('record_options',[settings.countIn?4:0,!!settings.recWait]);},[settings.countIn,settings.recWait,bridgeStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  const command=useCallback((cmd:string,args:unknown=null)=>{
    if(cmd==='undo')window.dispatchEvent(new Event('decksynth-undo'));
    if(api && !isPreview){api.send(cmd,args);return;}
    // Explicit demo-only interactions: never touch the original synth or disk.
    setSnapshot(prev=>{
      if(!prev)return prev;
      const next:DeckUpdate=structuredClone(prev);
      const arg=args as never;
      const owner=next.state.tracks[next.selected];
      if(cmd==='play')next.playing=!next.playing;
      else if(cmd==='stop'){next.playing=false;next.recording=false;next.beat=0;next.song_beat=0;}
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
        else if(name!=='harmonics'){
          if(Object.values(FILTER_ENV_KEYS).includes(name as never))for(const [amp,field] of Object.entries(FILTER_ENV_KEYS))
            owner.instrument[field]??=owner.instrument[amp as keyof typeof FILTER_ENV_KEYS];
          owner.instrument[name]=value;
        }
      }
      else if(cmd==='note_edit'){
        const [target,expected,events]=args as [NoteTarget,Note[]|import('./types').StepPattern,Note[]];if(target.track!==next.selected)return next;
        if(target.kind==='clip')next.state.tracks[target.track].notes=events;else next.state.performance.patterns[target.bank+':'+target.slot]=expectedWithEvents(expected,events) as import('./types').StepPattern;
      }
      else if(cmd==='editor_note'){const [,,note,value]=args as [number,string,number,number];next.held_notes=value?[note]:[];}
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
        const [status,note,,sent]=args as [number,number,number,number[]|'chord'|undefined];const kind=status&0xf0;
        // Chord pads ('chord') and Play in order, voiced like the engine does.
        const pf=next.state.performance,ch=pf.chord,oct=12*(pf.scale.octave??0),opts={voices:ch.spread,inversion:ch.inversion??0,bass:ch.bass??0};
        let padNotes=sent==='chord'?voiceChord(ch.user.map(n=>note+n+oct),opts):sent;
        if(!padNotes&&kind===0x90&&ch.enabled&&ch.follow){const filled=(ch.slots??[]).filter(c=>c.length);
          if(filled.length){const i=(next.chord_step??0)%filled.length;padNotes=voiceChord(filled[i].map(n=>n+oct),opts);next.chord_now=i;
            if((ch.advance??'Key')==='Key')next.chord_step=(i+1)%filled.length;}}
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
        if(action==='chord_goto'){next.chord_step=value as number;return next;}
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
              note:note.note,velocity:note.velocity,tie:Math.min(32,Math.max(1,Math.round(note.duration/beat)))});
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

  const showFileDialog=async(op:'open'|'save',extension:'project'|'midi'|'instrument'|'wav',cmd:string)=>{
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
  const onParam=(key:keyof Instrument,index:number|null,value:number)=>command('parameter',[key,index,value,selected]);
  const onTrack=(key:'mute'|'volume',value:boolean|number)=>command('track',[selected,key,value]);
  // Sends: the shared Reverb and Delay sheet opens over any Sound page; it closes when the page or track changes.
  const [sendsOpen,setSendsOpen]=useState(false);
  useEffect(()=>setSendsOpen(false),[page,selected]);
  const sendProps=track?{track,index:selected,open:sendsOpen,onSend:(bus:SendBus,v:number)=>command('send',[selected,bus,v]),onOpen:()=>setSendsOpen(o=>!o)}:null;
  const sendKnobs=sendProps?<SendKnobs {...sendProps}/>:null;

  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(dialog||event.defaultPrevented||event.shiftKey&&event.key==='F10')return;
      const target=event.target as HTMLElement;
      if(['INPUT','TEXTAREA','SELECT'].includes(target?.tagName)||target?.isContentEditable)return;
      const k=event.key;
      if(k===' '&&target?.closest('button,[role="button"],[role="slider"],[role="tab"]'))return;
      const controls:{[key:string]:string}={F5:'play',F6:'stop',F7:'record',F10:'undo'};
      if(controls[k]){event.preventDefault();command(controls[k]);return;}
      if(k==='F8'||k==='F9'){event.preventDefault();const n=project?.tracks.length??4;command('select',(selected+(k==='F8'?n-1:1))%n);}
      else if(k===' '){event.preventDefault();command('play');}
    };
    window.addEventListener('keydown',handler);
    return()=>window.removeEventListener('keydown',handler);
  },[selected,dialog,command]);

  const instruments=project?.tracks.map(t=>t.preset)||[];
  return <ContextWheelProvider revision={JSON.stringify([selected,page,stateRevision(project),snapshot?.playing,snapshot?.recording,automationEdit,performClip,dialog,fileMenu])} navigation={{song:()=>setPage('SONG'),sound:()=>setPage('SOUND'),fx:()=>setPage('FX'),perform:()=>setPage('PERFORM')}} notify={setToast}><MidiLearnProvider selected={selected} mappings={track?.midi_cc??[]} active={snapshot?.midi_learn} send={command} onModulation={()=>setArmed(edit)} defaultValue={t=>t.module!=='sound'?undefined:soundDefault(LIBRARY.presets.find(p=>p.name===track?.preset)?.instrument as unknown as Record<string,unknown>|undefined,t.param)} onAutomation={setAutomationEdit}><ModLinkProvider track={selected} chain={track?.fx} armed={armed} onChain={chain=>command('fx',[selected,chain])}><main className={'decksynth-shell harness-shell'+(settings.knobBubble?'':' no-knob-bubble')} data-page={page}>
    <header className="app-header transport" aria-label="Music transport">
      <div className="transport-actions">
        <button type="button" className={'transport-pad play'+(snapshot?.playing?' engaged':'')}
          onClick={()=>command('play')} aria-label={snapshot?.playing?'Pause loop':'Play loop'}>
          {snapshot?.playing?<Pause size={20} fill="currentColor"/>:<Play size={20} fill="currentColor"/>}
          <span>{snapshot?.playing?'PAUSE':'PLAY'}</span>
        </button>
        <button type="button" className="transport-pad stop" onClick={()=>command('stop')} aria-label="Stop">
          <Square size={17} fill="currentColor"/><span>STOP</span>
        </button>
        {(()=>{const c=snapshot?.count_in;
          const face=snapshot?.recording?'FINISH':c?.state==='count'?String(c.beat):c?.state==='armed'?'ARMED':'REC';
          return <button type="button" className={'transport-pad record'+(snapshot?.recording?' engaged':'')+(c?' counting '+c.state:'')}
            data-testid="rec-button" data-count={c?.state==='count'?c.beat:undefined}
            onClick={()=>command('record')} aria-label={snapshot?.recording?'Finish take':c?'Cancel record':'Record'}
            title={c?.state==='armed'?'Waiting for your first note · tap to cancel':c?.state==='count'?'Counting in · tap to cancel':undefined}>
            <CircleDot size={20}/><span>{face}</span>
          </button>;})()}
      </div>
      <div className="transport-lcd" role="group" aria-label="Tempo, loop and position">
      <div className="tempo-display" aria-label="Tempo">
        <ValueBox label="BPM" className="tempo-vbox" value={Math.round((project?.bpm??120)*10)/10} min={30} max={240} step={1} coarse={10} fine={.1}
          format={n=>Number.isInteger(n)?String(n):n.toFixed(1)} onChange={n=>command('tempo',clamp(n,30,240))}
          title="Tempo: click, then scroll (Shift ±10, Ctrl ±0.1) · two slow clicks to type · touch: hold and drag"/>
      </div>
      <div className="bars-display">
        <LoopBars value={project?.bars??4} onChange={bars=>command('bars',bars)}/>
      </div>
      <TransportBeat song={song} bars={project?.bars??4}/>
      </div>
      <button type="button" className={'metronome-button'+(project?.metronome?' active':'')} aria-pressed={!!project?.metronome}
        title="Metronome click" onClick={()=>command('metronome',!project?.metronome)}>
        <span className="button-led"/><span>CLICK</span></button>
      <button className="transport-utility" title="Undo" aria-label="Undo" onClick={()=>command('undo')}><RotateCcw size={18}/></button>
      {page==='SONG'&&!!track?.notes.length?<button className="transport-utility" title="Quantize selected track" aria-label="Quantize"
        onClick={()=>command('quantize')}><Redo2 size={18}/></button>:null}
      <PageTabs page={page} onPage={setPage}/>
      <LinkBox armed={armed} name={armed&&track?(armed.kind==='macro'?normalizeChain(track.fx).macros[armed.index]?.name||'Macro '+(armed.index+1):'Mod pad '+(armed.index+1)):''}
        onClear={()=>setArmed(null)} onOpen={()=>{setPage('LINK');setToast('Tap a macro or mod pad name to arm it, then tap knobs on any page.');}}/>
      {project?(()=>{const n=(snapshot?.freeze??[]).filter(f=>f.state==='frozen'||f.state==='rendering').length;
        return <div className="freeze-top" ref={freezeRef}>
          <button type="button" className={'icon-button'+(n?' is-on':'')} aria-label="Freeze tracks" aria-expanded={freezeOpen}
            title="Freeze: play tracks as audio to save CPU" onClick={()=>setFreezeOpen(v=>!v)}><Snowflake size={19}/>{n?<span className="ft-count">{n}</span>:null}</button>
          {freezeOpen?<FreezeSheet tracks={project.tracks} infos={snapshot?.freeze} colors={TRACK_COLORS}
            onFreeze={t=>command('freeze',t)} onUnfreeze={t=>command('unfreeze',t)} onClose={()=>setFreezeOpen(false)}/>:null}
        </div>;})():null}
      {page==='PERFORM'?<div id="pf-oct-slot" className="pf-oct-slot"/>:null}
      <div className="transport-spacer"/>
      {isPreview?<span className="demo-badge">PREVIEW · NO AUDIO</span>
        :<span className={'footer-status midi-hidden-status'+(bridgeStatus==='ERROR'?' error':'')}>{bridgeStatus}</span>}
      <div className="file-menu">
        <button className="icon-button" aria-label="Project files" title="Open, save, export"
          aria-expanded={fileMenu} onClick={()=>setFileMenu(v=>!v)}><FolderOpen size={19}/></button>
        {fileMenu?<div className="file-menu-pop" role="menu" onClick={()=>setFileMenu(false)}>
          <button role="menuitem" type="button" onClick={()=>showFileDialog('open','project','load')}><FolderOpen size={16}/> Open project</button>
          <button role="menuitem" type="button" onClick={()=>showFileDialog('save','project','save')}><Disc3 size={16}/> Save project</button>
          <button role="menuitem" type="button" onClick={()=>showFileDialog('save','midi','export')}><FileDown size={16}/> Export MIDI</button>
          <button role="menuitem" type="button" onClick={()=>showFileDialog('save','wav','export_wav')}><FileDown size={16}/> Export stereo WAV</button>
          <span className="file-menu-meta">{project?totalNotes(project)+' notes · '+(instruments[selected]??''):''}</span>
        </div>:null}
      </div>
      <button className="icon-button" aria-label="Help" title="Help" aria-haspopup="dialog" onClick={e=>openHelp(e.currentTarget)}><CircleHelp size={19}/></button>
      <button className="icon-button has-midi" aria-label="Settings" title={'Settings · '+(bridgeStatus==='ERROR'?'engine not connected':snapshot?.connected?renderMIDI(snapshot.connected):'no MIDI keyboard')}
        onClick={()=>setDialog('settings')}><SettingsIcon size={19}/>{bridgeStatus==='ERROR'?<i className="gear-dot error"/>:snapshot?.connected?<i className="gear-dot"/>:null}</button>
    </header>

    {automationEdit!==undefined&&project&&track?<AutomationEditor key={selected} track={selected} lanes={track.automation??[]} target={automationEdit} beats={project.song?.on?project.song.length*4:project.bars*4} song={!!project.song?.on} playing={snapshot?.playing??false} armed={snapshot?.automation_arm??false} send={command} close={closeAutomation}/>:null}
    {sendsOpen&&project?<SendsSheet sends={project.sends} tracks={project.tracks} onSetting={(bus,key,value)=>command('send_setting',[bus,key,value])} onClose={()=>setSendsOpen(false)}/>:null}
    <div className={'workspace-stage page-'+page.toLowerCase()}>
    {project&&track?<>
      {page!=='SONG'&&<PageBar freeze={snapshot?.freeze} onContext={i=>i===selected?{synth:()=>command('set_device',[i,'synth']),drums:()=>command('set_device',[i,'drum_rack']),mute:()=>command('track',[i,'mute',!track.mute]),presets:()=>{setPage('SOUND');if(track.device==='drum_rack')setKitBrowserTrack(i);else requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('[aria-label="Browse presets"]')?.click());}}:{}} onAdd={()=>command('add_track',null)} onRemove={i=>{command('remove_track',i);setToast('Removed track '+(i+1)+'. Undo brings it back.');}} tracks={project.tracks} selected={selected}
        onSelect={index=>command('select',index)} beats={project.bars*4} playing={snapshot?.playing??false}
        tools={page==='SOUND'?<>
          {(track.device??'synth')==='synth'?<div className="sound-workflow" role="group" aria-label="Sound workflow">
            {(['A','B'] as const).map(slot=><button key={slot} type="button" aria-label={'Compare sound '+slot} aria-pressed={(track.sound_ab?.active??'A')===slot} onClick={()=>command('sound_ab',[selected,slot])}>{slot}</button>)}
            <button type="button" aria-label="Copy sound to other slot" title="Copy to other slot" onClick={()=>command('sound_ab',[selected,'copy'])}>{track.sound_ab?.active==='B'?'B → A':'A → B'}</button>
            <button type="button" aria-label="Edit automation" aria-pressed={automationEdit!==undefined} onClick={()=>setAutomationEdit(automationEdit===undefined?null:undefined)}>Auto</button>
          </div>:null}
          <InstrumentSwitcher device={track.device??'synth'} onChange={device=>{if(isPreview){setToast('Select devices in the native audio app');return;}setKitBrowserTrack(null);command('set_device',[selected,device]);}}/>
          {/* The kit button sits next to the pads now (Sir, 16 Nov). */}
          {/* The synth's preset and Save live in the Sound tool rack now (Sir, 16 Nov). */}
        </>:page==='PERFORM'?<ArpLive>{view=><PerformTools
          onPanic={()=>command('panic')} arp={project.performance.arp.enabled} paused={!!view?.paused}
          onArp={a=>command('perform_action',[a,null])}/>}</ArpLive>:undefined}/>}
      <div className="page-body">
      {page==='SONG'?<div className="song-page">
        {(()=>{
          const bar=<SongBar project={project} song={song} view={songView} onView={v=>{setSongView(v);setSongSel(null);}} onSong={s=>command('song',s)}
            zoom={songZoom} onZoom={z=>{setSongZoom(z);setSongStart(Math.floor(songStart/z)*z);}} start={songStart} onStart={setSongStart}
            sel={songSel} onSel={setSongSel}
            onClip={(t,action,clip,source)=>command('clip',[t,action,clip,source??null])}
            onEditClip={(t,clip)=>{command('clip',[t,'open',clip,null]);command('select',t);setSongSel(null);setSongView('clips');}}/>;
          return songView==='arrange'?<section className="timeline song-timeline" aria-label="Song">
            {bar}
            <Arranger project={project} song={song} selected={selected} zoom={songZoom} start={songStart} sel={songSel} onSel={setSongSel}
              onSong={s=>command('song',s)} playing={snapshot?.playing??false}
              onSelect={index=>command('select',index)} onMute={(idx,next)=>command('track',[idx,'mute',next])} onClips={t=>setClipSheet(t)}
              freeze={snapshot?.freeze} onFreeze={t=>command('freeze',t)} onUnfreeze={t=>command('unfreeze',t)}/>
          </section>
          :<Timeline project={project} selected={selected} playing={snapshot?.playing??false}
            recording={snapshot?.recording??false} header={bar}
            loops={project.tracks.map((_,t)=>{const k=clipsOf(project).open[t];
              return {label:CLIP_NAMES[k],sub:'clip',aria:'Clips of track '+(t+1)+': clip '+CLIP_NAMES[k]+' is open',title:'Open, copy or clear this track\'s clips'};})}
            onLoops={t=>setClipSheet(t)}
            freeze={snapshot?.freeze} onFreeze={t=>command('freeze',t)} onUnfreeze={t=>command('unfreeze',t)}
            onSelect={index=>command('select',index)}
            onMute={(idx,next)=>command('track',[idx,'mute',next])}
            onEdit={(target,expected,notes)=>command('note_edit',[target,expected,notes])} onOpenNotes={openClipNotes}
            onOpenSound={index=>{command('select',index);setPage('SOUND');}}/>;
        })()}
        {clipSheet!==null?<ClipSheet project={project} song={song} track={clipSheet}
          container={document.querySelector('.song-page')} onClose={()=>setClipSheet(null)}
          onClip={(t,action,clip,source)=>command('clip',[t,action,clip,source??null])}/>:null}
        <LiveScope underruns={snapshot?.underruns??0} preview={isPreview} bufferMs={snapshot?.buffer_ms}/>
      </div>
      :page==='SOUND'&&track.device==='drum_rack'?<DrumRack key={selected+':'+track.drum_rack?.id} track={track} trackIndex={selected}
        runtime={snapshot?.drum_racks?.[selected]??undefined}
        steps={pad=><DrumSteps track={selected} kitId={track.drum_rack?.id??''} pad={pad} seq={project.performance.seq} patterns={project.performance.patterns}
            playing={snapshot?.playing??false} recording={!!snapshot?.recording} recStep={snapshot?.rec_step??0}
            onEdit={(target,expected,notes)=>command('note_edit',[target,expected,notes])}
            onEditorNote={(t,id,n,v)=>command('editor_note',[t,id,n,v])}
            onSeq={(key,value)=>command('perform_set',['seq',key,value])}
            onUndo={()=>command('undo')}/>}
        onNote={(pad,velocity)=>{if(track.drum_rack)command('drum_note',[selected,track.drum_rack.id,pad,velocity]);}}
        onEdit={(pad,key,value)=>{if(track.drum_rack)command('drum_edit',[selected,track.drum_rack.id,pad,key,value]);}}
        onImport={importDrum} browserOpen={kitBrowserTrack===selected} onBrowserOpen={open=>{if(!open)command('drum_preview_stop');setKitBrowserTrack(open?selected:null);}} library={snapshot?.drum_library}
        onLoadFolder={folder=>{if(track.drum_rack){pendingKit.current={track:selected,id:track.drum_rack.id};command('drum_load_folder',[selected,track.drum_rack.id,folder]);}}}
        onBrowseFolder={(folder,page)=>command('drum_list_samples',[folder,page])}
        onPreviewSample={(folder,index)=>command('drum_preview_sample',[folder,index])}
        onStopPreview={()=>command('drum_preview_stop')}
        onReplaceSample={(folder,index,pad)=>{if(track.drum_rack){pendingSwap.current={track:selected,id:track.drum_rack.id,pad,source:track.drum_rack.pads[pad].source?.path??null};command('drum_replace_sample',[selected,track.drum_rack.id,pad,folder,index]);}}}
        onChooseLibrary={chooseDrumLibrary} onRefreshLibrary={()=>command('drum_library_refresh')}
        onPlayOnKeys={isPreview?undefined:pad=>setKeysSheet({track:selected,pad})}
        record={snapshot?.sampler_record} send={(cmd,args)=>command(cmd,args)} sends={sendKnobs}/>
      :page==='SOUND'&&track.device==='sampler'?<SamplerPage key={selected+':'+track.sampler?.id} track={track} trackIndex={selected}
        runtime={snapshot?.samplers?.[selected]} record={snapshot?.sampler_record} pads={padChoices(project.tracks)} tracks={project.tracks} bpm={project.bpm}
        library={snapshot?.sample_library} onChooseFolder={()=>isPreview||!api?Promise.resolve(null):api.chooseFile('open','sample_folder')}
        onLoadWav={async()=>{if(isPreview||!api){setToast('Open the native audio app to load a WAV');return;}
          const id=track.sampler?.id,tr=selected;const filepath=await api.chooseFile('open','sample');
          if(filepath&&id)command('sampler_load_wav',[tr,id,filepath]);}}
        send={(cmd,args)=>command(cmd,args)}
        onEdit={(key,value)=>{if(track.sampler)command('sampler_edit',[selected,track.sampler.id,key,value]);}}
        onDetect={()=>{if(track.sampler)command('sampler_detect',[selected,track.sampler.id]);}}
        onMake={p=>command('sampler_make',[p.track,p.kit,p.pad,selected,null,p.family])}
        onMidi={(s,a,b)=>command('midi',[s,a,b])} sends={sendKnobs}/>
      :page==='SOUND'?<ContextAreaScope area="sound"><PanelScope scope={'track:'+selected}><FxLive>{live=><SynthSound key={selected} track={track} selected={selected}
          onParam={(name,index,val)=>onParam(name,index,val)} onTrack={onTrack} onShape={name=>command('spectral_seed',[selected,name])}
          onChain={chain=>command('fx',[selected,chain])} armed={armed} source={edit} live={live}
          preset={<><PresetBrowser key={selected} current={track.preset} accent={TRACK_COLORS[selected]} onPreset={preset=>command('preset',preset)}/>
            <button type="button" className="page-tool-icon ss-save" aria-label="Save patch" title="Save patch"
              onClick={()=>showFileDialog('save','instrument','save_preset')}><Save size={18}/></button></>} sends={sendProps?<SendKnobs {...sendProps} inHeader/>:null} sendsAction={<SendsOpen small open={sendsOpen} onOpen={()=>setSendsOpen(o=>!o)}/>}/>}</FxLive></PanelScope></ContextAreaScope>
      :page==='FX'?<ContextAreaScope area="fx"><PanelScope scope={'track:'+selected}><div className="frame frame-fx">
          <FxLive>{live=><FxCards key={selected} selected={selected} chain={track.fx} onChange={chain=>command('fx',[selected,chain])}
            onReorder={ids=>command('fx_reorder',[selected,ids])}
            live={live} armed={armed} source={edit} autoFold={!settings.noAutoFold}
            playing={snapshot?.playing??false} tracks={project.tracks.map(t=>deviceName(t))}/>}</FxLive>
      </div></PanelScope></ContextAreaScope>
      :page==='LINK'?<ContextAreaScope area="fx"><FxLive>{live=><LinkPage key={selected} selected={selected} chain={track.fx} onChange={chain=>command('fx',[selected,chain])}
          live={live} bpm={project.bpm} edit={edit} onEdit={setEdit} armed={armed} onLink={setArmed}/>}</FxLive></ContextAreaScope>
      :<div className="perform-page"><ArpLive>{arpView=><Performance track={track} catalogStatus={snapshot?.pattern_library} onCommand={command} state={project.performance}
          transfer={{clip:clipsOf(project).open[selected],bars:project.bars}}
          clipEdit={performClip} onClipEdit={setPerformClip} clipClock={clipClock}
          playing={snapshot?.playing??false} held={snapshot?.held_notes??[]} arpView={arpView} recStep={snapshot?.rec_step??0} chordStep={snapshot?.chord_step??0} chordNow={snapshot?.chord_now??-1}
          selectedTrack={selected} device={track.device??'synth'} recording={snapshot?.recording??false}
          onNoteEdit={(t,b,a)=>command('note_edit',[t,b,a])} onEditorNote={(t,id,n,v)=>command('editor_note',[t,id,n,v])} onUndo={()=>command('undo')}
          onSet={(section,key,value)=>command('perform_set',[section,key,value])}
          onStep={(index,notes,replace)=>command('perform_step',[index,notes,replace])}
          onAction={(action,value,expected)=>command('perform_action',expected?[action,value??null,expected]:[action,value??null])}
          onPlay={()=>command('play')}
          onTempo={bpm=>command('tempo',bpm)}
          onMidi={(status,a,b,notes)=>command('midi',notes?[status,a,b,notes]:[status,a,b])}/>}</ArpLive></div>}
      </div>
    </>:<div className="workspace loading-workspace"><AudioWaveform size={40}/><p>Connecting to the Decksynth audio engine…</p></div>}
    </div>

    {keysSheet&&project?.tracks[keysSheet.track]?.drum_rack?(()=>{const kit=project.tracks[keysSheet.track].drum_rack!,p=kit.pads[keysSheet.pad];
      return <PlayOnKeysSheet padName={padLabel(p.name,kit.name)} family={drumKind(p.name,p.source?.path)} sourceTrack={keysSheet.track} tracks={project.tracks}
        onClose={()=>setKeysSheet(null)}
        onMake={(target,root)=>{command('sampler_make',[keysSheet.track,kit.id,keysSheet.pad,target,root,drumKind(p.name,p.source?.path)]);setKeysSheet(null);}}/>;})():null}
    {toast?<div className="toast" role="status">{toast}<button aria-label="Dismiss message" onClick={()=>setToast('')}>✕</button></div>:null}
    {dialog?<div className={'modal-screen'+(dialog==='help'?' help-screen':'')} onPointerDown={event=>{if(event.target===event.currentTarget)setDialog(null);}}>
      {dialog==='settings'?<Settings settings={settings} onSettings={setSettings}
        trackName={(selected+1)+' '+(track?.preset??'')} onCleanup={(c:Cleanup)=>command('cleanup',c)}
        midiName={snapshot?.connected?renderMIDI(snapshot.connected):null} bridgeStatus={bridgeStatus} bufferMs={snapshot?.buffer_ms}
        devices={snapshot?.devices??[]} audioOutput={snapshot?.audio_output||'Deck speakers'} audioOutputs={snapshot?.audio_outputs??[]}
        onDevice={d=>command('device',d)} onAudio={d=>command('audio_device',d)} onPanic={()=>command('panic')}
        onClose={()=>setDialog(null)}/>
      :<Help section={helpSection} invoker={helpOrigin.current} close={()=>setDialog(null)}/>}
    </div>:null}
  </main></ModLinkProvider></MidiLearnProvider></ContextWheelProvider>;
}
export default App;
