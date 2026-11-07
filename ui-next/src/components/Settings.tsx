import { useState } from 'react';
import { Eraser, Headphones, LayoutGrid, Radio, RotateCcw, Sparkles, Trash2, Unlink } from 'lucide-react';

export type Cleanup = 'effects'|'sound'|'mods'|'links'|'all';
export type AppSettings = {noAutoFold:boolean};
const KEY='decksynth.settings';
export function readSettings():AppSettings{
  try{return {noAutoFold:true,...JSON.parse(localStorage.getItem(KEY)||'{}')};}catch{return {noAutoFold:true};}
}
export function writeSettings(s:AppSettings){try{localStorage.setItem(KEY,JSON.stringify(s));}catch{/* optional */}}

type Props = {
  settings:AppSettings; onSettings:(s:AppSettings)=>void;
  trackName:string; onCleanup:(c:Cleanup)=>void;
  devices:string[]; audioOutput:string; audioOutputs:string[];
  onDevice:(d:string)=>void; onAudio:(d:string)=>void; onPanic:()=>void; onClose:()=>void;
};

/** Settings: layout, clean-up and audio/MIDI routing in one place behind the gear icon. */
export function Settings({settings,onSettings,trackName,onCleanup,devices,audioOutput,audioOutputs,onDevice,onAudio,onPanic,onClose}:Props) {
  const [confirm,setConfirm]=useState(false);
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
        <h3><Radio size={15}/> Audio and MIDI</h3>
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
      </div>
    </div>
  </section>;
}
