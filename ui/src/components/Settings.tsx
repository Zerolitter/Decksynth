import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleDot, Eraser, Headphones, Keyboard, Lock, Maximize, Minus, Monitor, Plug, Plus, Power, Radio, RotateCcw, Save, Search, Sparkles, Trash2, Unlink, X, Zap } from 'lucide-react';
import '../settings.css';
import { ValueBox } from './ValueBox';
import { PluginList, PluginLoaded, PluginParams, PluginRescan, PluginSetup, PluginTake, usePlugins, type PluginTrack } from './PluginHost';
import { ACTIONS, FIXED, SCOPES, comboOf, isChanged, keysOf, problem, show, withKeys, cleanOverrides, type KeyOverrides } from '../hotkeys';

export type Cleanup = 'effects'|'sound'|'mods'|'links'|'all';
/** countIn: beats of click before a take from a stopped transport (0 = off, 1 to 16). recWait: REC waits for the first note (UI keys, pads or MIDI). */
/** knobBubble: the value that pops up over a knob while it turns (16 Nov: can be turned off; the value box stays). */
/** presetNoise: synth presets load with their Strike noise burst on (25 Nov: off by default; keys, plucks, bass and mallet presets carry it on themselves since 26 Nov; the Strike view's Noise switch turns it on per sound). */
/** latency: how much sound is kept ready before the speakers. low 5 ms, auto about 16 ms (grows after a dropout and shrinks back), safe 21 ms,
    custom a fixed buffer of latencyMs (3 to 50). */
/** keys: only the hotkeys you changed (hotkeys.ts). */
export type Latency = 'low'|'auto'|'safe'|'custom';
export type AppSettings = {noAutoFold:boolean;countIn:number;recWait:boolean;knobBubble:boolean;latency:Latency;latencyMs:number;editSound:boolean;presetNoise:boolean;keys:KeyOverrides};
const DEFAULTS:AppSettings={noAutoFold:true,countIn:0,recWait:false,knobBubble:true,latency:'auto',latencyMs:10,editSound:true,presetNoise:false,keys:{}};
const KEY='decksynth.settings';
const whole=(v:unknown,lo:number,hi:number,fallback:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=lo&&v<=hi?v:fallback;
export function readSettings():AppSettings{
  try{
    const raw=JSON.parse(localStorage.getItem(KEY)||'{}')??{},s={...DEFAULTS,...raw};
    s.countIn=raw.countIn===true?4:raw.countIn===false?0:whole(raw.countIn,0,16,0);       // it was On / Off (4 beats) before 25 Nov
    s.latencyMs=whole(s.latencyMs,3,50,10);
    if(!['low','auto','safe','custom'].includes(s.latency))s.latency='auto';
    s.keys=cleanOverrides(raw.keys);
    return s;
  }catch{return {...DEFAULTS};}
}
export function writeSettings(s:AppSettings){try{localStorage.setItem(KEY,JSON.stringify(s));}catch{/* optional */}}

/** What the engine is told about the latency: a mode, plus the milliseconds for a custom buffer. */
export const latencyArgs=(s:AppSettings):[string]|[string,number]=>s.latency==='custom'?['custom',s.latencyMs]:[s.latency];

type SectionId='session'|'audio'|'midi'|'recording'|'display'|'sound'|'plugins'|'hotkeys'|'cleanup';
const SECTIONS:{id:SectionId;label:string;icon:React.ReactNode;colour:string}[]=[
  {id:'session',label:'Session',icon:<Save size={18}/>,colour:'var(--c-song)'},
  {id:'audio',label:'Audio',icon:<Headphones size={18}/>,colour:'var(--c-perform)'},
  {id:'midi',label:'MIDI',icon:<Radio size={18}/>,colour:'var(--t-midi)'},
  {id:'recording',label:'Recording',icon:<CircleDot size={18}/>,colour:'var(--ui-rec)'},
  {id:'display',label:'Display',icon:<Monitor size={18}/>,colour:'var(--c-guide)'},
  {id:'sound',label:'Sound and editing',icon:<Zap size={18}/>,colour:'var(--c-fx)'},
  {id:'plugins',label:'Plugins',icon:<Plug size={18}/>,colour:'var(--c-plugin)'},
  {id:'hotkeys',label:'Hotkeys',icon:<Keyboard size={18}/>,colour:'var(--t-help)'},
  {id:'cleanup',label:'Clean up',icon:<Eraser size={18}/>,colour:'var(--t-reset)'},
];

type Props = {
  settings:AppSettings; onSettings:(s:AppSettings)=>void;
  trackName:string; onCleanup:(c:Cleanup)=>void;
  devices:string[]; audioOutput:string; audioOutputs:string[];
  /** The connected MIDI keyboard (null: none) and the engine link, shown here instead of the top bar. */
  midiName?:string|null; bridgeStatus?:string; bufferMs?:number;
  /** Autosave and On launch live in the engine, so they work even when this window is dead. */
  session?:import('../types').DeckUpdate['session']; onSession?:(changes:Record<string,unknown>)=>void;
  onDevice:(d:string)=>void; onAudio:(d:string)=>void; onPanic:()=>void; onClose:()=>void;
  /** Plugins: the engine command and the selected track (a take can go into its Sampler). */
  command?:(cmd:string,args?:unknown)=>void; pluginTrack?:PluginTrack;
  initialSection?:SectionId;
};

/* ---------- small controls ---------- */
function Seg<T extends string|number|boolean>({label,options,value,onPick}:{label:string;options:readonly (readonly [T,string])[];value:T|null;onPick:(v:T)=>void}){
  return <div className="sv-seg" role="group" aria-label={label}>
    {options.map(([v,text])=><button key={String(v)} type="button" aria-pressed={value===v} className={value===v?'on':''} onClick={()=>onPick(v)}>{text}</button>)}
  </div>;
}

/** Segmented presets with a last button, Custom: tapping it shows a value box (rule 36) for any number in the range. */
function CustomSeg({label,presets,value,range,unit,format,parse,onPick,startAt}:{label:string;presets:readonly (readonly [number,string])[];value:number;
  range:{min:number;max:number;step:number;coarse:number;fine:number};unit:string;format:(n:number)=>string;parse?:(t:string)=>number|null;
  onPick:(n:number)=>void;startAt:(current:number)=>number}){
  const isPreset=presets.some(([v])=>v===value);
  const [open,setOpen]=useState(false);
  const custom=open||!isPreset;
  return <div className="sv-custom">
    <div className="sv-seg" role="group" aria-label={label}>
      {presets.map(([v,text])=><button key={v} type="button" aria-pressed={!custom&&value===v} className={!custom&&value===v?'on':''}
        onClick={()=>{setOpen(false);onPick(v);}}>{text}</button>)}
      <button type="button" aria-pressed={custom} className={custom?'on':''}
        onClick={()=>{setOpen(true);if(isPreset)onPick(startAt(value));}}>Custom</button>
    </div>
    {custom?<ValueBox label={label+' · '+unit} value={value} min={range.min} max={range.max} step={range.step} coarse={range.coarse} fine={range.fine}
      format={format} parse={parse} onChange={n=>onPick(Math.round(n))}/>:null}
  </div>;
}

const seconds=(n:number)=>n<60?n+' s':n%60===0?(n/60)+' min':Math.floor(n/60)+' min '+(n%60)+' s';
const parseSeconds=(t:string):number|null=>{
  const m=t.trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*(s|sec|secs|m|min|mins)?$/);if(!m)return null;
  const n=parseFloat(m[1].replace(',','.'));return m[2]&&m[2][0]==='m'?n*60:n;
};

function Switch({label,on,onChange}:{label:string;on:boolean;onChange:(v:boolean)=>void}){
  return <input type="checkbox" role="switch" aria-label={label} checked={on} onChange={e=>onChange(e.target.checked)}/>;
}

/** A tap list: every choice is a 44 px button; the picked one is orange (rule 11: no native drop-downs). */
function TapList({label,items,picked,onPick}:{label:string;items:{value:string;text:string;sub?:string}[];picked:string;onPick:(v:string)=>void}){
  return <div className="sv-tap" role="radiogroup" aria-label={label}>
    {items.map(i=><button key={i.value} type="button" role="radio" aria-checked={picked===i.value} className={picked===i.value?'on':''} onClick={()=>onPick(i.value)}>
      <span>{i.text}{i.sub?<small>{i.sub}</small>:null}</span>{picked===i.value?<Check size={16}/>:null}</button>)}
  </div>;
}

/* ---------- search ---------- */
type Item={sec:SectionId;group?:string;title:string;hint?:string;kw?:string;wide?:boolean;danger?:boolean;control:React.ReactNode};
const words=(q:string)=>q.toLowerCase().split(/\s+/).filter(Boolean);
function Marked({text,q}:{text:string;q:string[]}){
  if(!q.length)return <>{text}</>;
  const re=new RegExp('('+q.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','ig');
  return <>{text.split(re).map((part,i)=>i%2?<mark key={i}>{part}</mark>:<Fragment key={i}>{part}</Fragment>)}</>;
}

/** Settings: eight sections in a left navigation, a search over all of them, and the window actions at the bottom of the navigation. */
export function Settings({settings,onSettings,trackName,onCleanup,midiName,bridgeStatus,bufferMs,session,onSession,devices,audioOutput,audioOutputs,onDevice,onAudio,onPanic,onClose,command,pluginTrack,initialSection}:Props) {
  const plugins=usePlugins();
  const [section,setSection]=useState<SectionId>(initialSection ?? 'session');
  const [query,setQuery]=useState('');
  const [confirm,setConfirm]=useState(false);
  const [midiPick,setMidiPick]=useState('Auto');
  const [rec,setRec]=useState<{id:string;index:number}|null>(null);       // a key being recorded: index = keys.length adds a second one
  const [keyError,setKeyError]=useState<{id:string;text:string}|null>(null);
  const win=window.deckApi?.windowAction;
  const q=words(query);
  const set=(patch:Partial<AppSettings>)=>onSettings({...settings,...patch});

  /* Plugins: look for them the first time the section opens (and once hosting is set up). */
  const pluginsReady=plugins?.setup==='ready',pluginsScanned=!!plugins?.scanned;
  useEffect(()=>{if(command&&(section==='plugins'||q.length)&&pluginsReady&&!pluginsScanned)command('plugin',['scan']);},[section,pluginsReady,pluginsScanned,q.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Esc: stop recording a key, then clear the search, then close. (App's own keys stay off while a dialog is open.) */
  const esc=useRef<()=>void>(()=>{});
  esc.current=()=>{if(rec)setRec(null);else if(query)setQuery('');else onClose();};
  useEffect(()=>{
    const on=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();esc.current();}
    };
    window.addEventListener('keydown',on,true);return()=>window.removeEventListener('keydown',on,true);
  },[]);

  /* Recording a key: the next press is the new key. */
  const recRef=useRef(rec);recRef.current=rec;
  const settingsRef=useRef(settings);settingsRef.current=settings;
  useEffect(()=>{
    if(!rec)return;
    const on=(e:KeyboardEvent)=>{
      const r=recRef.current;if(!r||e.key==='Escape')return;
      e.preventDefault();e.stopImmediatePropagation();
      const c=comboOf(e);if(!c)return;
      const cur=settingsRef.current,keys=keysOf(r.id,cur.keys),rest=keys.filter((_,i)=>i!==r.index);
      const err=problem(r.id,c,withKeys(cur.keys,r.id,rest.length?rest:['__none__']));
      if(err){setKeyError({id:r.id,text:err});setRec(null);return;}
      const next=r.index<keys.length?keys.map((k,i)=>i===r.index?c:k):[...keys,c];
      setKeyError(null);setRec(null);
      onSettings({...cur,keys:withKeys(cur.keys,r.id,next)});
    };
    window.addEventListener('keydown',on,true);return()=>window.removeEventListener('keydown',on,true);
  },[rec]); // eslint-disable-line react-hooks/exhaustive-deps

  const keyRow=(id:string)=>{
    const keys=keysOf(id,settings.keys),changed=isChanged(id,settings.keys);
    return <div className="sv-keys">
      {keys.map((k,i)=>rec?.id===id&&rec.index===i
        ?<span key={k+i} className="sv-keychip rec" role="status">Press a key…
          {keys.length>1?<button type="button" className="sv-keyx" aria-label={'Remove '+show(k)} onClick={()=>{setRec(null);onSettings({...settings,keys:withKeys(settings.keys,id,keys.filter((_,j)=>j!==i))});}}><X size={14}/></button>:null}</span>
        :<button key={k+i} type="button" className="sv-keychip" aria-label={'Change key '+show(k)} onClick={()=>{setKeyError(null);setRec({id,index:i});}}>{show(k)}</button>)}
      {rec?.id===id&&rec.index===keys.length?<span className="sv-keychip rec" role="status">Press a key…</span>
        :<button type="button" className="sv-keyadd" aria-label="Add a second key" title="Add a second key" onClick={()=>{setKeyError(null);setRec({id,index:keys.length});}}><Plus size={16}/></button>}
      {changed?<button type="button" className="sv-keyreset" aria-label="Put this key back" title="Put this key back"
        onClick={()=>{setKeyError(null);onSettings({...settings,keys:withKeys(settings.keys,id,ACTIONS.find(a=>a.id===id)!.keys)});}}><RotateCcw size={15}/></button>:null}
      {keyError?.id===id?<span className="sv-keyerr" role="alert">{keyError.text}</span>:null}
    </div>;
  };

  const clean=(c:Cleanup,icon:React.ReactNode,title:string,sub:string,sec:SectionId,group:string,kw=''):Item=>({sec,group,title,hint:sub,kw,wide:true,
    control:<button type="button" className="sv-act" aria-label={title} onClick={()=>{onCleanup(c);onClose();}}>{icon}<span><strong>{title}</strong><small>{sub}</small></span></button>});

  const items=useMemo<Item[]>(()=>{
    const out:Item[]=[];
    const add=(i:Item)=>out.push(i);
    /* Session */
    if(session&&onSession){
      add({sec:'session',title:'Autosave',kw:'save backup recover interval seconds minutes',
        hint:'How often the project is written to the Autosave file (only when something changed). It works even if this window goes blank.',
        control:<CustomSeg label="Autosave" presets={[[0,'Off'],[30,'30 s'],[60,'1 min'],[120,'2 min'],[300,'5 min'],[600,'10 min']]} value={session.autosave}
          range={{min:10,max:3600,step:10,coarse:60,fine:1}} unit="seconds" format={seconds} parse={parseSeconds} onPick={n=>onSession({autosave:n})} startAt={cur=>cur||60}/>});
      add({sec:'session',title:'On launch',kw:'startup open last new project',hint:'What Decksynth opens when it starts. The session before is always kept as a Recovered file in the Autosave folder.',
        control:<Seg label="On launch" options={[['last','Last project'],['new','New project']] as const} value={session.on_launch as 'last'|'new'} onPick={v=>onSession({on_launch:v})}/>});
      add({sec:'session',title:'Autosave status',wide:true,kw:'folder last save error',control:<p className="sv-status" role="status">{session.error?'Autosave failed: '+session.error:session.saved_at?'Last autosave '+new Date(session.saved_at*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+'. ':'No autosave yet. '}
        {session.folder?'Autosave and recovered sessions: '+session.folder.replace(/^\/home\/[^/]+/,'~'):''}</p>});
    }else add({sec:'session',title:'Autosave',hint:'Autosave is not available right now (the engine is not connected).',control:null});
    /* Audio */
    const outputs=Array.from(new Set(['System default','Deck speakers',...audioOutputs]));
    add({sec:'audio',title:'Output',wide:true,kw:'audio output speakers device headphones',hint:'Where the sound goes.',
      control:<TapList label="Audio output" picked={audioOutput} onPick={onAudio} items={outputs.map(d=>({value:d,text:d}))}/>});
    add({sec:'audio',title:'Latency'+(bufferMs!==undefined?' · '+bufferMs+' ms now':''),kw:'buffer delay milliseconds ms low auto safe',
      hint:'Low: keys answer in about 5 ms, a busy song can click. Auto: about 16 ms, steps up after a dropout and back down after 2 quiet minutes. Safe: at least 21 ms, the most room for big songs. Custom: a fixed buffer, 3 to 50 ms.',
      control:<div className="sv-custom"><div className="sv-seg" role="group" aria-label="Latency">
        {([['low','Low'],['auto','Auto'],['safe','Safe'],['custom','Custom']] as const).map(([v,text])=><button key={v} type="button" aria-pressed={settings.latency===v}
          className={settings.latency===v?'on':''} onClick={()=>set({latency:v})}>{text}</button>)}</div>
        {settings.latency==='custom'?<ValueBox label="Latency · ms" value={settings.latencyMs} min={3} max={50} step={1} coarse={5} fine={1} format={n=>n+' ms'} onChange={n=>set({latencyMs:Math.round(n)})}/>:null}</div>});
    add({sec:'audio',title:'Safety',kw:'panic stuck notes release',hint:'Stuck note? This lets every note go.',
      control:<button type="button" className="sv-panic" onClick={onPanic}>PANIC · RELEASE ALL NOTES</button>});
    /* MIDI */
    add({sec:'midi',title:'Keyboard',kw:'midi keyboard status connected engine',wide:true,control:<div className={'sv-midi'+(midiName?' connected':'')} role="status" aria-label="MIDI keyboard"><i/>
      <strong>{midiName??'No MIDI keyboard'}</strong>{bridgeStatus?<span className={bridgeStatus==='ERROR'?'error':''}>{bridgeStatus}</span>:null}</div>});
    add({sec:'midi',title:'Input',wide:true,kw:'midi input device auto detect',hint:'Which MIDI device Decksynth listens to.',
      control:<TapList label="MIDI input" picked={midiPick} onPick={v=>{setMidiPick(v);onDevice(v);}} items={[{value:'Auto',text:'Auto detect'},...devices.map(d=>({value:d,text:d}))]}/>});
    /* Recording */
    add({sec:'recording',title:'Count-in',kw:'beats clicks metronome take',hint:'Clicks before a take from a stopped loop. Off, 4 beats, or any number from 1 to 16.',
      control:<CustomSeg label="Count-in" presets={[[0,'Off'],[4,'4 beats']]} value={settings.countIn} range={{min:1,max:16,step:1,coarse:4,fine:1}} unit="beats"
        format={n=>n+(n===1?' beat':' beats')} onPick={n=>set({countIn:n})} startAt={cur=>cur||4}/>});
    add({sec:'recording',title:'Start',kw:'take rec first note wait',
      hint:settings.recWait?(settings.countIn?`Your first note (keys, pads or MIDI) starts ${settings.countIn} ${settings.countIn===1?'click':'clicks'}. From a stopped loop.`:'Your first note (keys, pads or MIDI) starts the take. From a stopped loop.')
        :settings.countIn?`${settings.countIn} ${settings.countIn===1?'click':'clicks'}, then the take starts on beat 1. From a stopped loop.`:'The take starts when you press REC.',
      control:<Seg label="Start recording" options={[[false,'On REC'],[true,'First note']] as const} value={settings.recWait} onPick={v=>set({recWait:v})}/>});
    /* Display */
    add({sec:'display',title:'Knob pop-up value',kw:'knob bubble value turn',hint:'On: the value pops up over a knob while you turn it. Off: only the value box under the knob shows it.',
      control:<Switch label="Knob pop-up value" on={settings.knobBubble} onChange={v=>set({knobBubble:v})}/>});
    add({sec:'display',title:'Cards fold by themselves',kw:'sound page auto fold rack cards',
      hint:'On: when the rack is full, the card you used longest ago folds by itself. Off: cards only fold when you double-tap their title.',
      control:<Switch label="Cards fold by themselves" on={!settings.noAutoFold} onChange={v=>set({noAutoFold:!v})}/>});
    /* Sound and editing */
    add({sec:'sound',group:'Note editor',title:'Hear notes while editing',kw:'audition piano roll grid',hint:'On: drawing, moving or picking a note in the Perform grid plays it briefly. Off: editing is silent.',
      control:<Switch label="Hear notes while editing" on={settings.editSound} onChange={v=>set({editSound:v})}/>});
    add({sec:'sound',group:'Presets',title:'Load presets with Strike noise',kw:'strike noise burst synth preset',hint:'On: a synth preset loads with its noise burst at the start of each note. Off: it loads without it; the Noise switch on the Strike view turns it on.',
      control:<Switch label="Load presets with Strike noise" on={settings.presetNoise} onChange={v=>set({presetNoise:v})}/>});
    /* Plugins */
    if(command){
      const ready=plugins?.setup==='ready',l=plugins?.loaded;
      add({sec:'plugins',title:'Plugin hosting',kw:'vst vst3 plugin host set up install pedalboard',
        hint:ready?'VST3 plugins run in a helper of their own: one that hangs or crashes never stops Decksynth.'
          :'Hosts Linux VST3 plugins in a helper of their own, so a plugin can never stop the sound. Set up downloads pedalboard and numpy (about 21 MB, from PyPI) into Decksynth\'s data folder.',
        control:<PluginSetup status={plugins} send={command}/>});
      if(plugins&&ready){
        add({sec:'plugins',group:'Plugins',title:'Plugins found',wide:true,kw:'vst vst3 yabridge windows load list',control:<PluginList status={plugins} send={command}/>});
        add({sec:'plugins',group:'Plugins',title:'Plugin folders',kw:'vst3 path folder yabridge scan',
          hint:'~/.vst3, /usr/lib/vst3, /usr/local/lib/vst3 and VST3_PATH. Windows plugins appear after yabridgectl sync (in ~/.vst3/yabridge), and yabridge must be installed for this user.',
          control:<PluginRescan status={plugins} send={command}/>});
        add({sec:'plugins',group:'Loaded',title:'Loaded plugin',wide:true,kw:'plugin window editor unload',control:<PluginLoaded status={plugins} send={command}/>});
        if(l){
          add({sec:'plugins',group:'Loaded',title:'Parameters',wide:true,kw:'plugin parameter knob value',control:<PluginParams send={command}/>});
          if(pluginTrack)add({sec:'plugins',group:'Loaded',title:'Record as a sample',wide:true,kw:'record render bounce sample sampler take listen',
            hint:l.kind==='instrument'?'Plays one note, held for the Tap length (or as long as you hold Record), then until it is quiet (10 s at most). Record keeps the take in the sample library (Plugins) and loads it where you choose.'
              :'Plays the selected Sampler\'s sample through the effect, with its tail. Record keeps the take in the sample library (Plugins) and loads it where you choose.',
            control:<PluginTake status={plugins} send={command} track={pluginTrack}/>});
        }
      }
    }
    /* Hotkeys */
    for(const a of ACTIONS)add({sec:'hotkeys',group:a.scope,title:a.label,hint:a.about,kw:keysOf(a.id,settings.keys).map(show).join(' ')+' key shortcut hotkey',control:keyRow(a.id)});
    for(const f of FIXED)add({sec:'hotkeys',group:f.scope,title:f.keys,hint:f.about,kw:'locked gesture mouse touch',control:<span className="sv-lock"><Lock size={14}/> fixed</span>});
    /* Clean up */
    add(clean('effects',<Trash2 size={17}/>,'Remove all effects','Empties this track\'s FX rack and the links into it','cleanup','track'));
    add(clean('sound',<RotateCcw size={17}/>,'Reset the sound','Partials, tone and envelope back to the preset\'s start sound','cleanup','track'));
    add(clean('mods',<Sparkles size={17}/>,'Clear mod pads and links','All 8 pads back to plain shapes, every link removed','cleanup','track'));
    add(clean('links',<Unlink size={17}/>,'Clear all mod links','Every track keeps its sound and effects','cleanup','session'));
    add({sec:'cleanup',group:'session',title:'Start over…',wide:true,danger:true,kw:'empty new session reset everything',hint:'Empty session. Asks once; Undo can bring the old one back',
      control:confirm?<div className="sv-confirm" role="alert"><span>Start an empty session? Undo brings this one back.</span>
        <button type="button" className="danger" onClick={()=>{onCleanup('all');onClose();}}>Start over</button>
        <button type="button" onClick={()=>setConfirm(false)}>Keep working</button></div>
        :<button type="button" className="sv-act danger" onClick={()=>setConfirm(true)}><Trash2 size={17}/><span><strong>Start over…</strong><small>Empty session. Asks once; Undo can bring the old one back</small></span></button>});
    return out;
  },[settings,session,onSession,bufferMs,audioOutput,audioOutputs,devices,midiName,bridgeStatus,midiPick,confirm,rec,keyError,trackName,plugins,pluginTrack,command]); // eslint-disable-line react-hooks/exhaustive-deps

  const secOf=(id:SectionId)=>SECTIONS.find(s=>s.id===id)!;
  const scopeTitle=(g?:string)=>SCOPES.find(s=>s.id===g)?.title??g;
  const groupTitle=(sec:SectionId,g?:string)=>sec==='hotkeys'?scopeTitle(g):sec==='cleanup'?(g==='track'?'This track · '+trackName:'Whole session'):g;
  const hits=q.length?items.filter(i=>{
    const hay=(i.title+' '+(i.hint??'')+' '+(i.kw??'')+' '+secOf(i.sec).label+' '+(i.group??'')).toLowerCase();
    return q.every(w=>hay.includes(w));
  }):[];

  const row=(i:Item,k:string|number,tag?:boolean)=><div key={k} className={'sv-row'+(i.wide?' wide':'')+(i.danger?' danger':'')+(i.sec==='hotkeys'?' keyrow':'')}>
    <div className="sv-label">{tag?<span className="sv-tag" style={{['--tag' as string]:secOf(i.sec).colour}}>{secOf(i.sec).label}</span>:null}
      <strong><Marked text={i.title} q={q}/></strong>{i.hint?<small><Marked text={i.hint} q={q}/></small>:null}</div>
    <div className="sv-control">{i.control}</div></div>;

  const body=()=>{
    if(q.length){
      return hits.length?hits.map((i,n)=>row(i,n,true)):<p className="sv-empty" role="status">Nothing in Settings matches “{query}”.</p>;
    }
    const list=items.filter(i=>i.sec===section);
    const groups:string[]=[...new Set(list.map(i=>i.group??''))];
    const head=(g:string)=>{
      if(!g)return null;
      const t=groupTitle(section,g);
      return <h4 className="sv-group">{section==='hotkeys'?<>{t}<small>{SCOPES.find(s=>s.id===g)?.help}</small></>:t}</h4>;
    };
    return <>
      {section==='hotkeys'?<div className="sv-hotbar"><p>Tap a key to record a new one, <Plus size={13}/> adds a second key, <RotateCcw size={13}/> puts one change back. Mouse and touch gestures are listed but fixed.</p>
        {Object.keys(settings.keys).length?<button type="button" className="sv-resetall" onClick={()=>{setKeyError(null);set({keys:{}});}}><RotateCcw size={15}/> Reset all keys</button>:null}</div>:null}
      {groups.map(g=><Fragment key={g}>{head(g)}{list.filter(i=>(i.group??'')===g).map((i,n)=>row(i,g+n))}</Fragment>)}
    </>;
  };

  return <section className="settings-dialog settings-panel sv-dialog" role="dialog" aria-label="Settings" aria-modal="true">
    <header>
      <h2>Settings</h2>
      <label className="sv-search"><Search size={17}/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search settings and keys" aria-label="Search settings"
        autoComplete="off" spellCheck={false}/>{query?<button type="button" aria-label="Clear search" onClick={()=>setQuery('')}><X size={16}/></button>:null}</label>
      <button className="modal-close" onClick={onClose}>CLOSE ✕</button>
    </header>
    <div className="sv-body">
      <nav className="sv-nav" aria-label="Settings sections">
        <div role="tablist" aria-orientation="vertical">
          {SECTIONS.map(s=><Fragment key={s.id}>
            {s.id==='cleanup'?<hr/>:null}
            <button type="button" role="tab" aria-selected={!q.length&&section===s.id} className={!q.length&&section===s.id?'on':''} style={{['--tag' as string]:s.colour}}
              onClick={()=>{setQuery('');setSection(s.id);}}>{s.icon}<span>{s.label}</span></button></Fragment>)}
        </div>
        {win?<div className="sv-win"><hr/>
          <button type="button" onClick={()=>win('fullscreen')}><Maximize size={17}/><span>Full screen</span></button>
          <button type="button" onClick={()=>{onClose();win('minimize');}}><Minus size={17}/><span>Minimise</span></button>
          <button type="button" className="danger" onClick={()=>win('quit')}><Power size={17}/><span>Quit</span></button></div>:null}
      </nav>
      <div className="sv-content" role="tabpanel" aria-label={q.length?'Search results':secOf(section).label} tabIndex={-1}>
        <h3 className="sv-title" style={{['--tag' as string]:q.length?'var(--ui-accent)':secOf(section).colour}}>
          {q.length?<><Search size={18}/> {hits.length} found</>:<>{secOf(section).icon} {secOf(section).label}</>}</h3>
        {body()}
      </div>
    </div>
  </section>;
}
