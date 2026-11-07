import { useEffect, useRef, useState } from 'react';
import { AudioWaveform, FolderOpen, Grid2X2, Link2, Volume2 } from 'lucide-react';
import { Knob } from './Knob';
import { DrumKitBrowser } from './DrumKitBrowser';
import { TRACK_COLORS, noteName, type Track, type DrumRuntime, type DrumLibraryState } from '../types';
import { DRUM_KINDS, drumKind, padLabel } from '../drum-kinds';
import '../drum-rack.css';

export type { DrumPad, DrumRuntime } from '../types';
type Props = {browserOpen?:boolean;onBrowserOpen?:(open:boolean)=>void;track:Track;trackIndex:number;runtime?:DrumRuntime;output?:{peak:number;rms:number;voices:number;underruns:number;driver:string};onNote:(pad:number,velocity:number)=>void;onEdit:(pad:number,key:string,value:unknown)=>void;onImport:(pad:number,relink:boolean)=>void;library?:DrumLibraryState;onLoadFolder?:(folderId:string)=>void;onChooseLibrary?:()=>void;onRefreshLibrary?:()=>void};

/** The shared knob previews locally; only the end of its gesture reaches the worker. */
function CommittedKnob({id,name,value,min,max,step,suffix,precision,description,onCommit}:{
  id:string;name:string;value:number;min:number;max:number;step:number;suffix?:string;precision?:number;description:string;onCommit:(value:number)=>void;
}) {
  const [draft,setDraft]=useState(value);
  const latest=useRef(value),original=useRef(value),dirty=useRef(false),pointer=useRef(false);
  const commitRef=useRef(onCommit);commitRef.current=onCommit;
  const mounted=useRef(true);
  useEffect(()=>{if(!pointer.current){latest.current=value;original.current=value;dirty.current=false;setDraft(value);}},[value]);
  const finish=()=>{
    if(!mounted.current)return;
    pointer.current=false;
    if(dirty.current&&latest.current!==original.current){original.current=latest.current;dirty.current=false;commitRef.current(latest.current);}
    else dirty.current=false;
  };
  const cancel=()=>{if(!mounted.current)return;pointer.current=false;dirty.current=false;latest.current=original.current;setDraft(original.current);};
  useEffect(()=>{
    mounted.current=true;
    // RelativeDrag flushes in its document listener. Defer a task until the entire pointer event and its flush finish.
    const up=()=>{if(pointer.current)setTimeout(finish,0);};
    const abort=()=>{if(pointer.current)setTimeout(cancel,0);};
    document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',abort,true);window.addEventListener('blur',abort);
    return()=>{mounted.current=false;document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',abort,true);window.removeEventListener('blur',abort);};
  },[]);
  return <div className="drum-committed-knob" onPointerDownCapture={()=>{pointer.current=true;}}
    onKeyUpCapture={e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Enter'].includes(e.key))setTimeout(finish,0);}}
    onBlur={()=>{if(!pointer.current)setTimeout(finish,0);}}>
    <Knob id={id} name={name} value={draft} min={min} max={max} step={step} suffix={suffix} precision={precision} description={description} accent="var(--pad-accent)"
      onChange={next=>{latest.current=next;dirty.current=next!==original.current;setDraft(next);}}/>
  </div>;
}

function SourceWave({peaks}:{peaks:number[][]}) {
  const pairs=peaks.filter(p=>p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!pairs.length)return null;
  return <svg data-testid="drum-waveform" className="drum-waveform" viewBox="0 0 512 96" preserveAspectRatio="none" role="img" aria-label="Sample waveform from decoded PCM peaks">
    <path d="M0 48H512" className="drum-wave-zero"/>
    {pairs.map((p,i)=><line key={i} x1={(i+.5)*512/pairs.length} x2={(i+.5)*512/pairs.length}
      y1={48-Math.max(-1,Math.min(1,p[1]))*43} y2={48-Math.max(-1,Math.min(1,p[0]))*43} strokeWidth={Math.max(1,512/pairs.length*.75)}/>)}
  </svg>;
}

function RackSurface({browserOpen,onBrowserOpen,track,trackIndex,runtime,output,onNote,onEdit,onImport,library,onLoadFolder,onChooseLibrary,onRefreshLibrary}:Props) {
  const kit=track.drum_rack,pads=kit?.pads??[];
  const [selected,setSelected]=useState(0);
  const [localBrowsing,setLocalBrowsing]=useState(false);
  const browsing=browserOpen??localBrowsing,setBrowsing=onBrowserOpen??setLocalBrowsing;
  const [flashes,setFlashes]=useState<Set<number>>(()=>new Set());
  const serials=useRef<number[]|null>(null);
  const timers=useRef(new Map<number,ReturnType<typeof setTimeout>>());
  useEffect(()=>{
    if(!runtime)return;
    const next=runtime.pads.map(p=>p.event);
    if(serials.current===null){serials.current=next;return;}
    const prior=serials.current;serials.current=next;
    const hits=next.flatMap((n,i)=>n>(prior[i]??n)?[i]:[]);
    if(!hits.length)return;
    setFlashes(previous=>new Set([...previous,...hits]));
    hits.forEach(i=>{const old=timers.current.get(i);if(old)clearTimeout(old);timers.current.set(i,setTimeout(()=>{
      setFlashes(previous=>{const rest=new Set(previous);rest.delete(i);return rest;});timers.current.delete(i);
    },120));});
  },[runtime]);
  useEffect(()=>()=>{timers.current.forEach(clearTimeout);timers.current.clear();},[]);
  const pad=pads[selected],live=runtime?.pads[selected];
  const status=live?.status??(pad?.source?'LOADING':'EMPTY');
  const sourceReady=!!pad?.source&&!['EMPTY','MISSING','LOADING','ERROR'].includes(status);
  const loaded=runtime?.pads.filter(p=>['READY','PLAYING','MUTED'].includes(p.status)).length??0;
  const anySolo=pads.some(p=>p.solo),fileName=pad?.source?.path.split(/[\\/]/).pop();
  const edit=(key:string,value:unknown)=>onEdit(selected,key,value);
  if(!kit||!pad)return <section className="drum-rack drum-rack-loading" aria-label="Drum Rack"><AudioWaveform size={24}/><p>Preparing Drum Rack…</p></section>;
  const audition=(index:number,pressure=0)=>{setSelected(index);onNote(index,pressure>0?Math.max(1,Math.min(127,Math.round(pressure*127))):100);};
  const kinds=pads.map(p=>drumKind(p.name,p.source?.path));
  const selectedKind=DRUM_KINDS[kinds[selected]];
  const families=[...new Set(kinds.filter((_,i)=>!!pads[i].source))];
  return <section className="drum-rack" aria-label="Drum Rack" style={{['--drum-accent' as string]:TRACK_COLORS[trackIndex%TRACK_COLORS.length],['--pad-accent' as string]:pad.source?selectedKind.color:DRUM_KINDS.other.color}}>
    <header className="drum-device-bar">
      <div className="drum-device-title"><Grid2X2 size={23}/><h1>Drum Rack</h1><span>Track {trackIndex+1}</span></div>
      <div className="drum-device-meta"><span className="drum-kit-name" title={kit.name||'Custom kit'}>{kit.name||'Custom kit'}</span><strong>{loaded}/16 sources ready</strong>{onBrowserOpen?null:<button type="button" aria-expanded={browsing} onClick={()=>setBrowsing(!browsing)}><FolderOpen size={17}/>Kits</button>}</div>
    </header>
    <div className="drum-workspace">
      {browsing?<DrumKitBrowser library={library} onLoadFolder={onLoadFolder} onChooseLibrary={onChooseLibrary} onRefreshLibrary={onRefreshLibrary} onBack={()=>setBrowsing(false)}/>:<section className="drum-pads-panel" aria-labelledby="drum-pads-title">
        <div className="drum-section-bar"><h2 id="drum-pads-title">PADS</h2><span>Touch to play · MIDI 36–51</span></div>
        <div className="drum-pads" role="group" aria-label="Sixteen sample pads">
          {pads.map((p,i)=>{
            const state=runtime?.pads[i]?.status??(p.source?'LOADING':'EMPTY'),silenced=p.mute||(anySolo&&!p.solo),hit=flashes.has(i);
            const kind=kinds[i],family=DRUM_KINDS[kind];
            return <button type="button" key={p.note} style={{['--pad' as string]:p.source?family.color:DRUM_KINDS.other.color}} data-kind={p.source?kind:'empty'} className={'drum-pad'+(selected===i?' is-selected':'')+(hit?' is-triggered':'')+(silenced?' is-muted':'')+(state==='MISSING'?' is-missing':'')+(!p.source?' is-empty':'')}
              data-pad={i} data-note={p.note} data-triggered={hit?'true':'false'} data-status={state}
              aria-label={'Pad '+(i+1)+', '+p.name+', MIDI '+p.note+', '+(silenced?'MUTED':state)} aria-pressed={selected===i}
              onPointerDown={e=>{if(e.button===0)audition(i,e.pointerType==='touch'||e.pointerType==='pen'?e.pressure:0);}}
              onClick={e=>{if(e.detail===0)audition(i);}}>
              <span className="drum-pad-top"><b>{String(i+1).padStart(2,'0')}</b><span>{p.solo?'SOLO':p.mute?'MUTE':noteName(p.note)}</span></span>
              <strong className="drum-pad-name" title={p.name}>{padLabel(p.name,kit.name)||'Empty'}</strong>
              <span className="drum-pad-bottom"><span>{silenced?'MUTED':state}</span><span>{p.note}</span></span>
            </button>;
          })}
        </div>
        <div className="drum-family-legend" aria-label="Drum families">{families.map(kind=><span key={kind} style={{['--family' as string]:DRUM_KINDS[kind].color}}><i/>{DRUM_KINDS[kind].label}</span>)}</div>
        <div className="drum-pad-legend"><span><i className="selected"/>Selected</span><span><i className="trigger"/>Note event</span><span>One-shot playback</span></div>
        <div className="drum-unavailable">
          <div className="drum-pending-buttons" role="group" aria-label="Unavailable Drum Rack pages">{['SEQ','MIX','FX'].map(label=><button key={label} type="button" disabled aria-describedby="drum-pending-note">{label}</button>)}</div>
          <p id="drum-pending-note">SEQ, MIX and FX are not available in this version. Record pads with the existing SONG transport.</p>
        </div>
        <div className="drum-playback-note"><Volume2 size={17}/><p>One-shots play to the end. Pads in the same choke group stop each other. Tune changes pitch and duration together.</p></div>
      </section>}
      <section className="drum-pad-sound" aria-labelledby="drum-pad-sound-title">
        <div className="drum-section-bar"><h2 id="drum-pad-sound-title">PAD SOUND</h2><span>Pad {String(selected+1).padStart(2,'0')} · MIDI {pad.note}</span><div className="drum-import-actions">
          <button type="button" aria-label={pad.source?'Replace WAV':'Import WAV'} onClick={()=>onImport(selected,false)}><FolderOpen size={17}/>{pad.source?null:'Import WAV'}</button>
          {pad.source&&status==='MISSING'?<button type="button" className="drum-relink" onClick={()=>onImport(selected,true)}><Link2 size={17}/>Relink WAV</button>:null}
        </div></div>
        <div className="drum-source-heading"><strong title={pad.name}>{padLabel(pad.name,kit.name)||'Empty pad'}</strong><span className={'drum-status status-'+status.toLowerCase()}>{status}</span></div>
        <div className="drum-source-file" title={pad.source?.path}>{fileName??'No sample assigned'}</div>
        <div className="drum-wave-shell">
          {sourceReady&&live?.peaks.length?<SourceWave peaks={live.peaks}/>:<div className="drum-wave-empty"><AudioWaveform size={22}/><span>{status==='MISSING'?'Sample missing · relink the original WAV':status==='LOADING'?'Loading sample…':status==='ERROR'?'Sample could not load':'Import a WAV to see its waveform'}</span></div>}
          <span className="drum-wave-caption">{sourceReady?'SOURCE PCM · CACHED MIN / MAX':'SOURCE WAVEFORM'}</span>
        </div>
        {live?.error?<p className="drum-source-error" title={live.error} role="status">{live.error}</p>:null}
        <div className="drum-pad-controls" key={selected}>
          <CommittedKnob id={`drum-${trackIndex}-${selected}-gain`} name="Gain" value={pad.gain} min={0} max={2} step={.01} suffix="×" precision={2} description="Pad gain; applied to the next note" onCommit={n=>edit('gain',n)}/>
          <CommittedKnob id={`drum-${trackIndex}-${selected}-velocity`} name="Velocity" value={pad.velocity} min={0} max={2} step={.01} suffix="×" precision={2} description="Velocity response curve: 0 is fixed level, 1 is linear, 2 makes soft notes quieter" onCommit={n=>edit('velocity',n)}/>
          <CommittedKnob id={`drum-${trackIndex}-${selected}-tune`} name="Tune" value={pad.tune} min={-24} max={24} step={1} suffix="st" precision={0} description="Pitch in semitones; also changes sample duration" onCommit={n=>edit('tune',n)}/>
        </div>
        <div className="drum-pad-switches">
          <button type="button" aria-pressed={pad.mute} onClick={()=>edit('mute',!pad.mute)}>Mute</button>
          <button type="button" aria-pressed={pad.solo} onClick={()=>edit('solo',!pad.solo)}>Solo</button>
          <label>Choke group<select aria-label="Choke group" value={pad.choke} onChange={e=>edit('choke',Number(e.target.value))}><option value={0}>None</option>{Array.from({length:16},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label>
        </div>
        <div className="drum-pan"><button type="button" disabled aria-describedby="drum-mono-note">Pan</button><p id="drum-mono-note">Mono output. Stereo WAVs are downmixed; pan is unavailable.</p></div>
      </section>
    </div>
    {output?<footer className="drum-output" aria-label="Native audio output">
      <span className="drum-output-source">Native output <b data-output="driver">{output.driver}</b></span>
      <span className="drum-output-level"><meter min={0} max={1} low={.7} high={.9} optimum={.3}
        value={Math.max(0,Math.min(1,output.peak))} aria-label="Native output peak"/>
        <span>Peak <b>{output.peak>0?(20*Math.log10(output.peak)).toFixed(1):'−∞'} dBFS</b></span>
        <span data-output="rms" data-value={output.rms}>RMS <b>{output.rms>0?(20*Math.log10(output.rms)).toFixed(1):'−∞'} dBFS</b></span>
      </span>
      <span data-output="voices" data-value={output.voices}><b>{output.voices}</b> voices</span>
      <span data-output="underruns" data-value={output.underruns}><b>{output.underruns}</b> underruns</span>
    </footer>:null}
  </section>;
}

/** A new edit owner discards local gestures and historical event serials. */
export function DrumRack(props:Props) {return <RackSurface key={props.trackIndex+':'+(props.track.drum_rack?.id??'pending')} {...props}/>;}
