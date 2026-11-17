import { useState } from 'react';
import { CircleDot, Eraser, Gauge, Headphones, LayoutGrid, Maximize, Minus, Power, Radio, RotateCcw, Sparkles, Trash2, Unlink } from 'lucide-react';

export type Cleanup = 'effects'|'sound'|'mods'|'links'|'all';
/** countIn: 4 clicks before a take from a stopped transport. recWait: REC waits for the first note (UI keys, pads or MIDI). */
/** knobBubble: the value that pops up over a knob while it turns (Sir, 16 Nov: can be turned off; the value box stays). */
/** latency: how much sound is kept ready before the speakers. low 5 ms, auto about 11 ms (grows after a dropout and shrinks back), safe 21 ms. */
export type Latency = 'low'|'auto'|'safe';
export type AppSettings = {noAutoFold:boolean;countIn:boolean;recWait:boolean;knobBubble:boolean;latency:Latency};
const DEFAULTS:AppSettings={noAutoFold:true,countIn:false,recWait:false,knobBubble:true,latency:'auto'};
const KEY='decksynth.settings';
export function readSettings():AppSettings{
  try{return {...DEFAULTS,...JSON.parse(localStorage.getItem(KEY)||'{}')};}catch{return {...DEFAULTS};}
}
export function writeSettings(s:AppSettings){try{localStorage.setItem(KEY,JSON.stringify(s));}catch{/* optional */}}

type Props = {
  settings:AppSettings; onSettings:(s:AppSettings)=>void;
  trackName:string; onCleanup:(c:Cleanup)=>void;
  devices:string[]; audioOutput:string; audioOutputs:string[];
  /** The connected MIDI keyboard (null: none) and the engine link, shown here instead of the top bar. */
  midiName?:string|null; bridgeStatus?:string; bufferMs?:number;
  onDevice:(d:string)=>void; onAudio:(d:string)=>void; onPanic:()=>void; onClose:()=>void;
};

/** Settings: layout, clean-up and audio/MIDI routing in one place behind the gear icon. */
export function Settings({settings,onSettings,trackName,onCleanup,midiName,bridgeStatus,bufferMs,devices,audioOutput,audioOutputs,onDevice,onAudio,onPanic,onClose}:Props) {
  const [confirm,setConfirm]=useState(false);
  const win=window.deckApi?.windowAction;
  const item=(c:Cleanup,icon:React.ReactNode,title:string,sub:string)=><button type="button" className="clean-item"
    onClick={()=>{onCleanup(c);onClose();}}>{icon}<span><strong>{title}</strong><small>{sub}</small></span></button>;
  return <section className="settings-dialog settings-panel" role="dialog" aria-label="Settings" aria-modal="true">
    <header><div><span className="eyebrow">DECKSYNTH</span><h2>Settings</h2></div>
      <button className="modal-close" onClick={onClose}>CLOSE ✕</button></header>
    <div className="settings-cols">
      <div className="settings-col">
        <h3><LayoutGrid size={15}/> Layout</h3>
        <label className="setting-switch">
          <span><strong>Turn off sound card auto-fold</strong>
            <small>On: cards only fold when you double-tap their title. Off: when the rack is full, the card you used longest ago folds by itself.</small></span>
          <input type="checkbox" role="switch" checked={settings.noAutoFold}
            onChange={e=>onSettings({...settings,noAutoFold:e.target.checked})}/>
        </label>
        <label className="setting-switch">
          <span><strong>Knob pop-up value</strong>
            <small>On: the value pops up over a knob while you turn it. Off: only the value box under the knob shows it.</small></span>
          <input type="checkbox" role="switch" aria-label="Knob pop-up value" checked={settings.knobBubble}
            onChange={e=>onSettings({...settings,knobBubble:e.target.checked})}/>
        </label>
        {win?<><h3><Maximize size={15}/> Window</h3>
        <div className="setting-seg setting-window" role="group" aria-label="Window">
          <button type="button" onClick={()=>win('fullscreen')}><Maximize size={16}/> Full screen</button>
          <button type="button" onClick={()=>{onClose();win('minimize');}}><Minus size={16}/> Minimise</button>
          <button type="button" className="danger" onClick={()=>win('quit')}><Power size={16}/> Quit</button>
        </div>
        <small className="setting-hint">F11 switches full screen, Ctrl+Q quits.</small></>:null}
        <h3><Radio size={15}/> Audio and MIDI</h3>
        <div className={'setting-midi-status'+(midiName?' connected':'')} role="status" aria-label="MIDI keyboard"><i/>
          <strong>{midiName??'No MIDI keyboard'}</strong>{bridgeStatus?<span className={bridgeStatus==='ERROR'?'error':''}>{bridgeStatus}</span>:null}</div>
        <label className="setting-field"><span><Radio size={16}/> MIDI INPUT</span>
          <select value="Auto" onChange={e=>onDevice(e.target.value)}>
            <option value="Auto">Auto detect</option>
            {devices.map(device=><option key={device} value={device}>{device}</option>)}
          </select></label>
        <label className="setting-field"><span><Headphones size={16}/> AUDIO OUTPUT</span>
          <select value={audioOutput} onChange={e=>onAudio(e.target.value)}>
            {Array.from(new Set(['Deck speakers','System default',...audioOutputs])).map(device=><option key={device} value={device}>{device}</option>)}
          </select></label>
        <button className="panic-action" onClick={onPanic}>PANIC · RELEASE ALL NOTES</button>
      </div>
      <div className="settings-col">
        <h3><Eraser size={15}/> Clean up · {trackName}</h3>
        {item('effects',<Trash2 size={17}/>,'Remove all effects','Empties this track\'s FX rack and the links into it')}
        {item('sound',<RotateCcw size={17}/>,'Reset the sound','Partials, tone and envelope back to the preset\'s start sound')}
        {item('mods',<Sparkles size={17}/>,'Clear mod pads and links','All 8 pads back to plain shapes, every link removed')}
        <h3><Eraser size={15}/> Clean up · whole session</h3>
        {item('links',<Unlink size={17}/>,'Clear all mod links','Every track keeps its sound and effects')}
        {confirm?<div className="clean-confirm" role="alert"><span>Start an empty session? Undo brings this one back.</span>
          <button type="button" className="danger" onClick={()=>{onCleanup('all');onClose();}}>Start over</button>
          <button type="button" onClick={()=>setConfirm(false)}>Keep working</button></div>
          :<button type="button" className="clean-item danger" onClick={()=>setConfirm(true)}><Trash2 size={17}/>
            <span><strong>Start over…</strong><small>Empty session. Asks once; Undo can bring the old one back</small></span></button>}
        <h3><CircleDot size={15}/> Recording</h3>
        <div className="setting-rec">
          <div className="setting-choice" role="group" aria-label="Count-in"><strong>Count-in</strong>
            <div className="setting-seg">
              {([[false,'Off'],[true,'4 beats']] as const).map(([v,label])=><button key={label} type="button" aria-pressed={settings.countIn===v}
                className={settings.countIn===v?'on':''} onClick={()=>onSettings({...settings,countIn:v})}>{label}</button>)}
            </div></div>
          <div className="setting-choice" role="group" aria-label="Start recording"><strong>Start</strong>
            <div className="setting-seg">
              {([[false,'On REC'],[true,'First note']] as const).map(([v,label])=><button key={label} type="button" aria-pressed={settings.recWait===v}
                className={settings.recWait===v?'on':''} onClick={()=>onSettings({...settings,recWait:v})}>{label}</button>)}
            </div></div>
          <small>{settings.recWait?(settings.countIn?'Your first note (keys, pads or MIDI) starts 4 clicks.':'Your first note (keys, pads or MIDI) starts the take.')
            :settings.countIn?'4 clicks, then the take starts on beat 1.':'The take starts when you press REC.'}{settings.countIn||settings.recWait?' From a stopped loop.':''}</small>
        </div>
        <h3><Gauge size={15}/> Latency{bufferMs!==undefined?' · '+bufferMs+' ms now':''}</h3>
        <div className="setting-rec">
          <div className="setting-choice" role="group" aria-label="Latency"
            title="Low: keys answer in about 5 ms, a busy song can click. Auto: about 11 ms, steps up after a dropout and back down after 30 quiet seconds. Safe: at least 21 ms, the most room for big songs."><strong>Buffer</strong>
            <div className="setting-seg">
              {([['low','Low'],['auto','Auto'],['safe','Safe']] as const).map(([v,label])=><button key={v} type="button" aria-pressed={settings.latency===v}
                className={settings.latency===v?'on':''} onClick={()=>onSettings({...settings,latency:v})}>{label}</button>)}
            </div></div>
        </div>
      </div>
    </div>
  </section>;
}
