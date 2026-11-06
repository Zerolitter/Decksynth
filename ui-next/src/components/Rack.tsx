import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, CircleHelp, SlidersHorizontal, Volume2, Waves } from 'lucide-react';
import { autoFold, type FoldItem } from '../chordz-primitives/fold';
import { Knob } from './Knob';
import { TRACK_COLORS, type Track } from '../types';

type Params=Track['instrument'];
type Props = {
  track:Track;selected:number;
  onParam:(key:keyof Params,index:number|null,value:number)=>void;
  onTrack:(key:'volume'|'mute',value:number|boolean)=>void;
  onSound:()=>void;
};

export function EnvelopeGraph({p}: {p:Params}) {
  const attack=Math.max(.01,p.attack),decay=Math.max(.01,p.decay);
  const release=Math.max(.01,p.release),hold=.65,sec=attack+decay+hold+release;
  const point=(t:number,a:number) => (12+t/sec*292)+','+(78-a*62);
  const path='M 12,78 L '+point(attack,1)+' L '+point(attack+decay,p.sustain)+
      ' L '+point(attack+decay+hold,p.sustain)+' L '+point(sec,0);
  return <svg className="env-graph" viewBox="0 0 320 92" preserveAspectRatio="none"
    role="img" aria-label="Live ADSR envelope curve">
    <defs><linearGradient id="envArea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#7bd8bb" stopOpacity=".2"/>
      <stop offset="100%" stopColor="#7bd8bb" stopOpacity="0"/>
    </linearGradient></defs>
    <path d={path+' L 304,78 Z'} fill="url(#envArea)"/>
    <line x1="0" y1="78" x2="320" y2="78" stroke="#42505a" strokeWidth="1"/>
    <path d={path} stroke="#91e6ca" fill="none" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx={12+attack/sec*292} cy="16" r="3.5" fill="#e9f7eb"/>
    <circle cx={12+(attack+decay)/sec*292} cy={78-p.sustain*62} r="3.5" fill="#e9f7eb"/>
  </svg>;
}

export function SoundRack({track,selected,onParam,onTrack,onSound}:Props) {
  const row=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(1100);
  const [active,setActive]=useState('tone');
  const [editor,setEditor]=useState(false);
  const [handFold,setHandFold]=useState<Set<string>>(new Set());
  const p=track.instrument;
  useEffect(()=>{setEditor(false);},[selected]);
  useEffect(()=>{
    const node=row.current;if(!node)return;
    const observer=new ResizeObserver(entries=>{
      const w=entries[0]?.contentRect.width;if(w)setWidth(w);
    });
    observer.observe(node);return()=>observer.disconnect();
  },[]);
  const items=useMemo<FoldItem[]>(()=>[
    {id:'tone',width:306,instrument:true},
    {id:'envelope',width:334,instrument:false},
    {id:'motion',width:240,instrument:false},
    {id:'mix',width:238,instrument:false},
  ],[]);
  const folded=useMemo(()=> {
    const auto=autoFold(items,active,handFold,width);
    return new Set([...handFold,...auto]);
  },[items,active,handFold,width]);
  const accent=TRACK_COLORS[selected];
  const set=(key:keyof Params,value:number)=>onParam(key,null,value);
  const controls:{id:string;title:string;icon:React.ReactNode;content:React.ReactNode}[]=[
    {id:'tone',title:'SPECTRAL TONE',icon:<Waves size={15}/>,content:<>
      <div className="rack-preset"><span className="soft-label">ACTIVE INSTRUMENT</span>
        <strong>{track.preset}</strong></div>
      <div className="rack-knobs">
        <Knob id={selected+'-brightness'} name="Brightness" value={p.filter}
          min={.02} max={1} step={.005} suffix="%" compact accent={accent}
          onChange={v=>set('filter',v)}/>
        <Knob id={selected+'-tone-motion'} name="Movement" value={p.modulation}
          min={0} max={1} step={.005} suffix="%" compact accent={accent}
          onChange={v=>set('modulation',v)}/>
      </div>
    </>},
    {id:'envelope',title:'AMPLITUDE ENVELOPE',icon:<SlidersHorizontal size={15}/>,content:<>
      <button className="mini-graph-btn" type="button" onClick={()=>setEditor(true)}
        aria-label="Open detailed envelope editor"><EnvelopeGraph p={p}/>
        <ArrowUpRight size={15}/></button>
      <div className="rack-knobs env-summary">
        <Knob id={selected+'-attack'} name="Attack" value={p.attack}
          min={.001} max={3} step={.001} suffix="s" compact accent={accent}
          onChange={v=>set('attack',v)}/>
        <Knob id={selected+'-release'} name="Release" value={p.release}
          min={.01} max={3} step={.005} suffix="s" compact accent={accent}
          onChange={v=>set('release',v)}/>
      </div>
    </>},
    {id:'motion',title:'MOVEMENT',icon:<Waves size={15}/>,content:<>
      <div className="rack-summary-name">Slow modulation</div>
      <div className="rack-knobs">
        <Knob id={selected+'-motion'} name="Motion" value={p.modulation}
          min={0} max={1} step={.005} suffix="%" compact accent={accent}
          onChange={v=>set('modulation',v)}/>
      </div>
      <div className="rack-subtext">Modulation follows the live synth clock.</div>
    </>},
    {id:'mix',title:'TRACK OUTPUT',icon:<Volume2 size={15}/>,content:<>
      <div className="rack-knobs">
        <Knob id={selected+'-volume'} name="Volume" value={track.volume}
          min={0} max={1} step={.005} suffix="%" compact accent={accent}
          onChange={v=>onTrack('volume',v)}/>
      </div>
      <button type="button" className={'rack-mute'+(track.mute?' on':'')} onClick={()=>onTrack('mute',!track.mute)}>
        {track.mute?'MUTED':'MUTE TRACK'}</button>
    </>},
  ];
  return <section className="sound-rack" aria-label="Instrument device rack">
    <div className="rack-heading">
      <div><span className="rack-status-led" style={{background:accent}}/>
        <strong>Device rack</strong><span className="rack-divider">/</span><span className="rack-track-label">{track.preset}</span></div>
      <button onClick={onSound} type="button">OPEN SOUND EDITOR <ChevronRight size={14}/></button>
    </div>
    <div ref={row} className="rack-card-row" style={{'--rack-accent':accent} as React.CSSProperties}>
      {controls.map(c=><article key={c.id} className={'rack-card'+(folded.has(c.id)?' folded':'')+(active===c.id?' selected':'')}
        style={{width:folded.has(c.id)?32:items.find(i=>i.id===c.id)?.width}}>
        {folded.has(c.id)?
          <button className="rack-spine" type="button" title={'Expand '+c.title}
            onClick={()=>{setActive(c.id);setHandFold(old=>{const next=new Set(old);next.delete(c.id);return next;});}}>
            <span>{c.title}</span></button>:
          <>
            <div className="rack-card-header">
              <button className="rack-card-title" onClick={()=>setActive(c.id)} type="button">
                {c.icon}<span>{c.title}</span></button>
              <button className="rack-card-fold" type="button" aria-label={'Fold '+c.title}
                onClick={()=>setHandFold(old=>new Set([...old,c.id]))}>▸</button>
            </div>
            <div className="rack-card-inner">{c.content}</div>
          </>}
      </article>)}
    </div>
    {editor&&<div className="float-shade" onPointerDown={e=>{if(e.target===e.currentTarget)setEditor(false);}}>
      <div role="dialog" aria-label="Amplitude envelope editor" aria-modal="true" className="floating-envelope">
        <header><div><span className="eyebrow">DEVICE EDITOR</span><h3>Amplitude envelope</h3></div>
          <button className="close-float" type="button" onClick={()=>setEditor(false)}>Close ✕</button></header>
        <EnvelopeGraph p={p}/>
        <div className="float-knobs">
          <Knob id={selected+'-float-attack'} name="Attack" value={p.attack} min={.001} max={3} step={.001} suffix="s" onChange={v=>set('attack',v)}/>
          <Knob id={selected+'-float-decay'} name="Decay" value={p.decay} min={.001} max={3} step={.001} suffix="s" onChange={v=>set('decay',v)}/>
          <Knob id={selected+'-float-sustain'} name="Sustain" value={p.sustain} min={0} max={1} step={.005} suffix="%" onChange={v=>set('sustain',v)}/>
          <Knob id={selected+'-float-release'} name="Release" value={p.release} min={.01} max={3} step={.005} suffix="s" onChange={v=>set('release',v)}/>
        </div>
        <p>Drag a knob vertically. Hold Shift for fine adjustments, or click its number for exact entry.</p>
      </div>
    </div>}
  </section>;
}
