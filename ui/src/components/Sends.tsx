import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Settings2, Timer, Waves } from 'lucide-react';
import { Knob, KnobTint } from './Knob';
import type { SendBus, Sends, Track } from '../types';
import '../sends.css';

/** The shared Reverb and Delay (decksynth/sends.py): each track feeds them with its Send knobs. */
export const SEND_COLORS:Record<SendBus,string>={reverb:'#8fb8ff',delay:'#5fd3c6'};
export const SEND_NAMES:Record<SendBus,string>={reverb:'Reverb',delay:'Delay'};
export const SEND_DEFAULTS:Sends={reverb:{params:{predelay:.1,decay:.6,locut:.1,hicut:.8,width:0},level:.8},
  delay:{params:{time:2,feedback:.4,width:0},level:.8}};
const DELAY_TIMES=['1/32','1/16','1/8','1/8 D','1/4','1/2'];
const pct=(v:number)=>Math.round(v*100)+'%';

/** A track's two Send knobs and the button that opens the shared settings. */
export function SendKnobs({track,index,open,onSend,onOpen,inHeader=false}:{track:Track;index:number;open:boolean;
  onSend:(bus:SendBus,v:number)=>void;onOpen:(e:HTMLButtonElement)=>void;
  /** the Shared button sits in the card's title bar instead (the synth's Sends card, where height is short at 718) */ inHeader?:boolean}){
  return <div className={'ss-knobs sends-row'+(inHeader?' no-open':'')}>
    {(['reverb','delay'] as SendBus[]).map(bus=><KnobTint.Provider key={bus} value={SEND_COLORS[bus]}>
      <Knob id={index+'-send-'+bus} name={SEND_NAMES[bus]} value={track.sends?.[bus]??0} min={0} max={1} step={.005} defaultValue={0}
        compact accent={SEND_COLORS[bus]} format={pct} description={'How much of this track goes to the shared '+SEND_NAMES[bus].toLowerCase()+' (after its volume and pan).'}
        onChange={v=>onSend(bus,v)}/></KnobTint.Provider>)}
    {inHeader?null:<SendsOpen open={open} onOpen={onOpen}/>}
  </div>;
}

/** Opens the shared Reverb and Delay settings. */
export function SendsOpen({open,onOpen,small=false}:{open:boolean;onOpen:(e:HTMLButtonElement)=>void;small?:boolean}){
  return <button type="button" className={'sends-open'+(small?' small':'')} aria-label="Shared reverb and delay settings" aria-expanded={open} aria-haspopup="dialog"
      title="Shared reverb and delay: every track's sends go here" onClick={e=>onOpen(e.currentTarget)}><Settings2 size={small?14:18}/><span>Shared</span></button>;
}

/** The shared Reverb and Delay settings, in a sheet over the cards (UI rule 14: Done, blank tap, the same button, Esc / B). */
export function SendsSheet({sends,tracks,onSetting,onClose}:{sends:Sends|undefined;tracks:Track[];
  onSetting:(bus:SendBus,key:string,value:number)=>void;onClose:()=>void}){
  const s=sends??SEND_DEFAULTS;
  const opener=useRef(document.activeElement instanceof HTMLElement?document.activeElement:null);
  useEffect(()=>()=>{if(opener.current?.isConnected)opener.current.focus({preventScroll:true});},[]);
  useEffect(()=>{const k=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();onClose();}};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k);},[onClose]);
  const feeding=(bus:SendBus)=>tracks.map((t,i)=>[t,i] as const).filter(([t])=>(t.sends?.[bus]??0)>0);
  const knob=(bus:SendBus,key:string,name:string,value:number,min:number,max:number,init:number,format=pct,step=.005)=>
    <Knob key={key} id={'sends-'+bus+'-'+key} name={name} value={value} min={min} max={max} step={step} defaultValue={init} compact
      accent={SEND_COLORS[bus]} format={format} onChange={v=>onSetting(bus,key,v)}/>;
  const card=(bus:SendBus,icon:ReactNode,body:ReactNode)=>{const f=feeding(bus);
    return <section className="ss-card sends-card" aria-label={'Shared '+SEND_NAMES[bus].toLowerCase()} style={{['--tag' as string]:SEND_COLORS[bus]}}>
      <header className="ss-card-head">{icon}<h2>{SEND_NAMES[bus]}</h2>
        <span className="sends-feeds" aria-label={f.length?'Fed by '+f.map(([,i])=>'track '+(i+1)).join(', '):'No track sends here yet'}>
          {f.length?f.map(([t,i])=><i key={i} title={t.name+' · '+pct(t.sends?.[bus]??0)}>{i+1}</i>):<em>no sends yet</em>}</span>
      </header>
      <KnobTint.Provider value={SEND_COLORS[bus]}>{body}</KnobTint.Provider>
    </section>;};
  return createPortal(<div className="sends-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="sends-sheet" role="dialog" aria-label="Shared reverb and delay">
      <header className="sends-bar"><strong>Sends</strong><span>One reverb and one delay for every track. Each track's Send knobs feed them.</span>
        <button type="button" className="sends-done" onClick={onClose}>Done</button></header>
      <div className="sends-body">
        {card('reverb',<Waves size={18}/>,<div className="ss-knobs sends-knobs">
          {knob('reverb','level','Return',s.reverb.level,0,1,.8)}
          {knob('reverb','decay','Decay',s.reverb.params.decay,0,1,.6)}
          {knob('reverb','predelay','Pre-delay',s.reverb.params.predelay,0,1,.1)}
          {knob('reverb','locut','Lo cut',s.reverb.params.locut,0,1,.1)}
          {knob('reverb','hicut','Hi cut',s.reverb.params.hicut,0,1,.8)}
          {knob('reverb','width','Width',s.reverb.params.width,0,1,0)}
        </div>)}
        {card('delay',<Timer size={18}/>,<>
          <div className="ss-seg sends-time" role="radiogroup" aria-label="Delay time">
            {DELAY_TIMES.map((label,i)=><button key={label} type="button" role="radio" aria-checked={Math.round(s.delay.params.time)===i}
              onClick={()=>onSetting('delay','time',i)}>{label}</button>)}
          </div>
          <div className="ss-knobs sends-knobs">
            {knob('delay','level','Return',s.delay.level,0,1,.8)}
            {knob('delay','feedback','Feedback',s.delay.params.feedback,0,.95,.4)}
            {knob('delay','width','Ping-pong',s.delay.params.width,0,1,0)}
          </div></>)}
      </div>
    </section>
  </div>,document.querySelector('.harness-shell')??document.body);
}
