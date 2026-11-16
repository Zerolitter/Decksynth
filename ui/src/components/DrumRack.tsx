import {useContextTarget} from './ContextWheel';
import { useEffect, useRef, useState,type ReactNode } from 'react';
import { Activity, ArrowUp, AudioWaveform, Crop, FolderOpen, SlidersHorizontal, Grid2X2, KeyboardMusic, Link2, ListMusic, Power, RotateCcw, Undo2 } from 'lucide-react';
import { Knob } from './Knob';
import { DrumKitBrowser } from './DrumKitBrowser';
import { TRACK_COLORS, noteName, DEFAULT_DRUM_SHAPE, type Track, type DrumRuntime, type DrumLibraryState, type DrumShape } from '../types';
import { DRUM_KINDS, drumKind, padLabel } from '../drum-kinds';
import { CompMeter, EnvelopeView, ToneView } from './DragGraphs';
import '../drum-rack.css';
import '../sampler.css';
import { SampleWindow } from './Sampler';
import type { SamplerSpec, SamplerRuntime } from '../types';

export { envelopePath } from '../drum-shape-graph';
export type { DrumPad, DrumRuntime } from '../types';
type Props = {browserOpen?:boolean;onBrowserOpen?:(open:boolean)=>void;track:Track;trackIndex:number;runtime?:DrumRuntime;onNote:(pad:number,velocity:number)=>void;onEdit:(pad:number,key:string,value:unknown)=>void;onImport:(pad:number,relink:boolean)=>void;library?:DrumLibraryState;onLoadFolder?:(folderId:string)=>void;onChooseLibrary?:()=>void;onRefreshLibrary?:()=>void;
  onBrowseFolder?:(folderId:string,page:number)=>void;onPreviewSample?:(folderId:string,index:number)=>void;
  onStopPreview?:()=>void;onReplaceSample?:(folderId:string,index:number,pad:number)=>void;
  steps?:(pad:import('../types').DrumPad)=>ReactNode;
  /** Opens the sheet that makes a Sampler track from this pad. */
  onPlayOnKeys?:(pad:number)=>void};

/** The shared knob previews locally (and reports the live value with onDraft); only the end of its gesture reaches the worker. */
export function CommittedKnob({id,name,value,min,max,step,suffix,precision,description,format,onCommit,onDraft,defaultValue}:{
  defaultValue?:number;id:string;name:string;value:number;min:number;max:number;step:number;suffix?:string;precision?:number;description:string;format?:(n:number)=>string;
  onCommit:(value:number)=>void;onDraft?:(value:number)=>void;
}) {
  const [draft,setDraft]=useState(value);
  const latest=useRef(value),original=useRef(value),dirty=useRef(false),pointer=useRef(false);
  const commitRef=useRef(onCommit);commitRef.current=onCommit;
  const draftRef=useRef(onDraft);draftRef.current=onDraft;
  const mounted=useRef(true),wrap=useRef<HTMLDivElement>(null);
  useEffect(()=>{const el=wrap.current;if(!el)return;const settle=()=>finish();el.addEventListener('knob-settle',settle);return()=>el.removeEventListener('knob-settle',settle);});
  useEffect(()=>{if(!pointer.current){latest.current=value;original.current=value;dirty.current=false;setDraft(value);}},[value]);
  const finish=()=>{
    if(!mounted.current)return;
    pointer.current=false;
    if(dirty.current&&latest.current!==original.current){original.current=latest.current;dirty.current=false;commitRef.current(latest.current);}
    else dirty.current=false;
  };
  const cancel=()=>{if(!mounted.current)return;pointer.current=false;dirty.current=false;latest.current=original.current;setDraft(original.current);draftRef.current?.(original.current);};
  useEffect(()=>{
    mounted.current=true;
    // RelativeDrag flushes in its document listener. Defer a task until the entire pointer event and its flush finish.
    const up=()=>{if(pointer.current)setTimeout(finish,0);};
    const abort=()=>{if(pointer.current)setTimeout(cancel,0);};
    document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',abort,true);window.addEventListener('blur',abort);
    return()=>{mounted.current=false;document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',abort,true);window.removeEventListener('blur',abort);};
  },[]);
  return <div ref={wrap} className="drum-committed-knob" onPointerDownCapture={()=>{pointer.current=true;}}
    onKeyUpCapture={e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Enter'].includes(e.key))setTimeout(finish,0);}}
    // Exact numeric entry commits on Enter and then unmounts its input, so neither keyup nor blur reaches this wrapper.
    onKeyDownCapture={e=>{if(e.key==='Enter')setTimeout(finish,0);}}
    onBlur={()=>{if(!pointer.current)setTimeout(finish,0);}}>
    <Knob contextArea={id.startsWith('smp-')?'sound':'drum'} id={id} name={name} value={draft} min={min} max={max} step={step} suffix={suffix} precision={precision} description={description} accent="var(--pad-accent)" format={format} defaultValue={defaultValue}
      onChange={next=>{latest.current=next;dirty.current=next!==original.current;setDraft(next);draftRef.current?.(next);}}/>
  </div>;
}

const panText=(n:number)=>Math.round(n)===0?'C':Math.round(n)<0?'L'+Math.round(-n):'R'+Math.round(n);
const ms=(n:number)=>n<1000?Math.round(n)+' ms':(n/1000).toFixed(2)+' s';

function RackSurface({browserOpen,onBrowserOpen,track,trackIndex,runtime,onNote,onEdit,onImport,library,onLoadFolder,onChooseLibrary,onRefreshLibrary,onBrowseFolder,onPreviewSample,onStopPreview,onReplaceSample,steps,onPlayOnKeys}:Props) {
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
  const context=useContextTarget(el=>{const button=el.closest<HTMLElement>('[data-pad]');if(!button||!kit)return null;const i=Number(button.dataset.pad),p=pads[i],ready=['READY','PLAYING','MUTED'].includes(runtime?.pads[i]?.status??'');if(!p)return null;return {accent:DRUM_KINDS[drumKind(p.name,p.source?.path)].color,kind:'drum.pad',label:'Pad '+(i+1)+' · '+p.name,caps:{...(ready?{play:()=>{setSelected(i);onNote(i,100);}}:{}),open:()=>setSelected(i),import:()=>onImport(i,false),...(p.source?{relink:()=>onImport(i,true)}:{}),mute:()=>onEdit(i,'mute',!p.mute),solo:()=>onEdit(i,'solo',!p.solo),kit:()=>setBrowsing(true)}};});
  const pad=pads[selected],live=runtime?.pads[selected];
  const status=live?.status??(pad?.source?'LOADING':'EMPTY');
  const sourceReady=!!pad?.source&&!['EMPTY','MISSING','LOADING','ERROR'].includes(status);
  const loaded=runtime?.pads.filter(p=>['READY','PLAYING','MUTED'].includes(p.status)).length??0;
  const anySolo=pads.some(p=>p.solo),fileName=pad?.source?.path.split(/[\\/]/).pop();
  const edit=(key:string,value:unknown)=>onEdit(selected,key,value);
  const [toneTab,setToneTab]=useState<'eq'|'filter'>('eq');
  // The big panel: trim markers, the envelope or the tone curve, each with points to drag.
  const [view,setView]=useState<'trim'|'env'|'tone'>('trim');
  // Knob values while turning: the graphs follow them live; the engine gets the value on release.
  const [drafts,setDrafts]=useState<Partial<DrumShape>&{tune?:number}>({});
  const lastRatio=useRef<Record<number,number>>({});   // Comp Off remembers the ratio for On
  const committed=JSON.stringify([selected,pad?.shape,pad?.tune]);
  useEffect(()=>{setDrafts({});},[committed]);
  if(!kit||!pad)return <section className="drum-rack drum-rack-loading" aria-label="Drum Rack"><AudioWaveform size={24}/><p>Preparing Drum Rack…</p></section>;
  const shape:DrumShape={...DEFAULT_DRUM_SHAPE,...pad.shape};
  const {tune:tuneDraft,...shapeDrafts}=drafts;
  const shown:DrumShape={...shape,...shapeDrafts};
  const step=2**((tuneDraft??pad.tune)/12);
  const seconds=pad.source&&typeof pad.source.frames==='number'&&typeof pad.source.source_rate==='number'?pad.source.frames/pad.source.source_rate:1;
  const setShape=(key:keyof DrumShape,value:number|boolean)=>edit('shape',{...shape,[key]:value});
  const draft=(key:keyof DrumShape|'tune')=>(n:number)=>setDrafts(d=>({...d,[key]:n}));
  const knob=(key:keyof DrumShape,name:string,min:number,max:number,stepSize:number,suffix:string,precision:number,description:string,scale=1,format?:(n:number)=>string)=>
    <CommittedKnob id={`drum-${trackIndex}-${selected}-${key}`} name={name} value={(shape[key] as number)*scale} min={min} max={max} step={stepSize} suffix={suffix} precision={precision}
      description={description} format={format} onDraft={n=>draft(key)(n/scale)} onCommit={n=>setShape(key,Math.round(n/scale*100000)/100000)}/>;
  const audition=(index:number,pressure=0)=>{setSelected(index);onNote(index,pressure>0?Math.max(1,Math.min(127,Math.round(pressure*127))):100);};
  const kinds=pads.map(p=>drumKind(p.name,p.source?.path));
  const selectedKind=DRUM_KINDS[kinds[selected]];
  const families=[...new Set(kinds.filter((_,i)=>!!pads[i].source))];
  // The Sampler's waveform editor shows the pad: Start and End are its tag markers (one drag, one undo step).
  const waveSpec={start:shown.start,end:shown.end,loop_start:shown.start,loop_end:shown.end,mode:'oneshot',slices:[]} as unknown as SamplerSpec;
  const waveRuntime={peaks:live?.peaks??[],seconds,playing:live?.at??[]} as unknown as SamplerRuntime;
  return <section className="drum-rack drum-smp" aria-label="Drum Rack" style={{['--drum-accent' as string]:TRACK_COLORS[trackIndex%TRACK_COLORS.length],['--pad-accent' as string]:pad.source?selectedKind.color:DRUM_KINDS.other.color}}>
    <div className={'drum-workspace'+(browsing?' is-browsing':'')}>
      {browsing?<DrumKitBrowser library={library} selectedPad={selected} current={kit.name||undefined} onLoadFolder={onLoadFolder} onChooseLibrary={onChooseLibrary} onRefreshLibrary={onRefreshLibrary}
        onBrowseFolder={onBrowseFolder} onPreviewSample={onPreviewSample} onStopPreview={onStopPreview} onReplaceSample={onReplaceSample}
        onBack={()=>setBrowsing(false)}/>:<section className="drum-pads-panel" aria-labelledby="drum-pads-title">
        <div className="drum-section-bar"><h2 id="drum-pads-title">PADS</h2><span>Touch to play · MIDI 36–51</span>
          <strong className={'drum-ready'+(loaded===16?' is-full':loaded===0?' is-none':'')} title={loaded+' of 16 pads have a sound ready'}>{loaded}/16 ready</strong></div>
        <div {...context} className="drum-pads" role="group" aria-label="Sixteen sample pads">
          {pads.map((p,i)=>{
            const state=runtime?.pads[i]?.status??(p.source?'LOADING':'EMPTY'),silenced=p.mute||(anySolo&&!p.solo),hit=flashes.has(i);
            const kind=kinds[i],family=DRUM_KINDS[kind];
            return <button type="button" key={p.note} style={{['--pad' as string]:p.source?family.color:DRUM_KINDS.other.color}} data-kind={p.source?kind:'empty'} className={'drum-pad'+(selected===i?' is-selected':'')+(hit?' is-triggered':'')+(silenced?' is-muted':'')+(state==='MISSING'?' is-missing':'')+(!p.source?' is-empty':'')}
              data-pad={i} data-note={p.note} data-triggered={hit?'true':'false'} data-status={state}
              aria-label={'Pad '+(i+1)+', '+p.name+', MIDI '+p.note+', '+(silenced?'MUTED':state)} aria-pressed={selected===i}
              onPointerDown={e=>{if(e.button===0)audition(i,e.pointerType==='touch'||e.pointerType==='pen'?e.pressure:0);}}
              onClick={e=>{if(e.detail===0)audition(i);}}>
              <span className="drum-pad-top"><b>{String(i+1).padStart(2,'0')}</b><span>{p.solo?'SOLO':p.mute?'MUTE':state==='EMPTY'?'':state==='READY'||state==='PLAYING'?noteName(p.note):state}</span></span>
              <strong className="drum-pad-name" title={p.name}>{padLabel(p.name,kit.name)||'Empty'}</strong>
            </button>;
          })}
        </div>
        <div className="drum-family-legend" aria-label="Drum families">{families.map(kind=><span key={kind} style={{['--family' as string]:DRUM_KINDS[kind].color}}><i/>{DRUM_KINDS[kind].label}</span>)}</div>
        <button type="button" className="drum-kits-wide" aria-label="Browse drum kits" aria-expanded={browsing} title="Load another kit, or swap single sounds" onClick={()=>setBrowsing(!browsing)}>
          <FolderOpen size={18}/><span><small>Kits</small><strong>{kit.name||'Choose a kit'}</strong></span></button>
        {steps?.(pad)}
      </section>}
      <section className="drum-pad-sound" aria-labelledby="drum-pad-sound-title">
        <div className="drum-section-bar"><h2 id="drum-pad-sound-title">PAD SOUND</h2>
          {pad.source?<div className="drum-view-tabs" role="radiogroup" aria-label="Waveform view">
            {([['trim','Trim','Start and end of the sound',<Crop key="i" size={15}/>],['env','Envelope','Attack, hold and decay over the sound',<Activity key="i" size={15}/>],['tone','Tone','EQ and cut filters',<SlidersHorizontal key="i" size={15}/>]] as const).map(([id,name,hint,icon])=>
              <button key={id} type="button" role="radio" aria-checked={view===id} title={hint} onClick={()=>setView(id)}>{icon}{name}</button>)}
          </div>:null}
          <strong className="drum-sound-name" title={pad.name+' · pad '+(selected+1)+' · MIDI '+pad.note}>{padLabel(pad.name,kit.name)||'Empty pad'}</strong>
          <span className="drum-source-file" title={pad.source?.path}>{fileName??'No sample assigned'}</span>
          <span className={'drum-status status-'+status.toLowerCase()}>{status}</span>
          <div className="drum-import-actions">
          {onPlayOnKeys?<button type="button" className="drum-play-keys" aria-label="Play this pad on the keys" title="Make a Sampler track that plays this sound on the keys" disabled={!sourceReady} onClick={()=>onPlayOnKeys(selected)}><KeyboardMusic size={17}/></button>:null}
          <button type="button" aria-label="Browse and audition sample sounds" title="Listen to library sounds and swap this pad" onClick={()=>setBrowsing(true)}><ListMusic size={17}/></button>
          <button type="button" aria-label={pad.source?'Import replacement WAV file':'Import WAV file'} title="Choose a WAV file directly" onClick={()=>onImport(selected,false)}><FolderOpen size={17}/></button>
          {pad.source&&status==='MISSING'?<button type="button" className="drum-relink" onClick={()=>onImport(selected,true)}><Link2 size={17}/>Relink WAV</button>:null}
        </div></div>
        <div className={'drum-wave-shell drum-smp-wave view-'+view}>
          {sourceReady&&live?.peaks.length&&view==='env'?<EnvelopeView shape={shown} seconds={seconds} step={step} peaks={live.peaks} at={live.at??[]}
            onDraft={p=>setDrafts(d=>({...d,...p}))} onCommit={p=>edit('shape',{...shape,...p})}/>
          :sourceReady&&view==='tone'?<ToneView shape={shown} onDraft={p=>setDrafts(d=>({...d,...p}))} onCommit={p=>edit('shape',{...shape,...p})}/>
          :sourceReady&&live?.peaks.length?<SampleWindow spec={waveSpec} runtime={waveRuntime} mode="trim" selected={-1} marker={null}
            onSelect={()=>{}} onView={()=>{}} onChop={()=>{}} onAudition={()=>onNote(selected,100)}
            onEdit={(k,v)=>{if(k!=='patch')return;const p=v as Partial<Record<'start'|'end',number>>;edit('shape',{...shape,...(p.start!==undefined?{start:p.start}:{}),...(p.end!==undefined?{end:p.end}:{})});}}/>
          :<div className={'drum-wave-empty is-'+status.toLowerCase()}><AudioWaveform size={26}/>
            <div className="drum-wave-empty-text"><strong>{status==='MISSING'?'The sample is missing':status==='LOADING'?'Loading sample…':status==='ERROR'?'The sample could not load':'Pad '+(selected+1)+' has no sound yet'}</strong>
              <span>{status==='MISSING'?'Point it at the original WAV again':status==='LOADING'||status==='ERROR'?(fileName??''):'Drop in a WAV, or pick one from the library'}</span></div>
            {status==='MISSING'?<button type="button" className="drum-empty-main" onClick={()=>onImport(selected,true)}><Link2 size={17}/>Find the WAV</button>
            :!pad.source?<><button type="button" className="drum-empty-main" title="Choose a WAV file for this pad" onClick={()=>onImport(selected,false)}><FolderOpen size={17}/>Choose a WAV</button>
              <button type="button" className="drum-empty-alt" onClick={()=>setBrowsing(true)}><ListMusic size={17}/>Browse sounds</button></>:null}
          </div>}
        </div>
        {live?.error?<p className="drum-source-error" title={live.error} role="status">{live.error}</p>:null}
        <div className="smp-cards drum-cards" key={selected} data-testid="drum-shape">
          <section className="smp-card drum-card-play" aria-label="Play">
            <h2>Play</h2>
            <div className="smp-line">
              <div className="smp-seg" role="group" aria-label="Mute and solo">
                <button type="button" aria-pressed={pad.mute} onClick={()=>edit('mute',!pad.mute)}>Mute</button>
                <button type="button" aria-pressed={pad.solo} onClick={()=>edit('solo',!pad.solo)}>Solo</button>
              </div>
              <button type="button" className="smp-toggle" aria-pressed={shape.reverse} title="Play backwards" onClick={()=>setShape('reverse',!shape.reverse)}><Undo2 size={15}/><span className="rev-label">Reverse</span></button>
            </div>
            <div className="smp-knobs two one">
              <CommittedKnob id={`drum-${trackIndex}-${selected}-gain`} defaultValue={1} name="Gain" value={pad.gain} min={0} max={2} step={.01} suffix="×" precision={2} description="Pad gain; applied to the next note" onCommit={n=>edit('gain',n)}/>
              <CommittedKnob id={`drum-${trackIndex}-${selected}-velocity`} defaultValue={1} name="Velocity" value={pad.velocity} min={0} max={2} step={.01} suffix="×" precision={2} description="Velocity response curve: 0 is fixed level, 1 is linear, 2 makes soft notes quieter" onCommit={n=>edit('velocity',n)}/>
              <CommittedKnob id={`drum-${trackIndex}-${selected}-tune`} defaultValue={0} name="Tune" value={pad.tune} min={-24} max={24} step={1} suffix="st" precision={0} description="Pitch in semitones; envelope times and EQ stay where you set them" onDraft={draft('tune')} onCommit={n=>edit('tune',n)}/>
              {knob('pan','Pan',-100,100,1,'',0,'Place the pad left or right (C is the middle)',100,panText)}
            </div>
            <label className="drum-choke">Choke<select aria-label="Choke group" value={pad.choke} onChange={e=>edit('choke',Number(e.target.value))}><option value={0}>None</option>{Array.from({length:16},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label>
          </section>
          <section className="smp-card drum-card-shape" aria-label="Shape">
            <div className="drum-card-head"><h2>Shape</h2>
              <button type="button" className="drum-card-icon drum-card-up" aria-label="Edit the envelope on the waveform" aria-pressed={view==='env'}
                title={view==='env'?'Back to Trim':'Drag the envelope on the big waveform above'} onClick={()=>setView(view==='env'?'trim':'env')}><ArrowUp size={18}/></button>
              <button type="button" className="drum-card-icon drum-card-reset" aria-label="Reset shape" disabled={JSON.stringify(shape)===JSON.stringify(DEFAULT_DRUM_SHAPE)}
                title="Back to the sample as recorded: trim, fades, envelope, EQ, filter, compressor and pan" onClick={()=>edit('shape',{...DEFAULT_DRUM_SHAPE})}><RotateCcw size={16}/></button></div>
            <div className="smp-knobs two one">
              {knob('attack','Attack',0,1000,1,'ms',0,'Rise time at the start of the hit',1000)}
              {knob('hold','Hold',0,4000,1,'ms',0,'Full level after the attack. With Decay off the pad stops after the hold',1000,ms)}
              {knob('decay','Decay',0,8000,1,'ms',0,'Fade to silence after the hold; Off plays to the end (or stops after the hold)',1000,n=>n<=0?'Off':ms(n))}
              {knob('fade_in','Fade in',0,2000,1,'ms',0,'Fade at the start of what plays',1000,ms)}
              {knob('fade_out','Fade out',0,2000,1,'ms',0,'Fade at the end of what plays',1000,ms)}
            </div>
          </section>
          <section className="smp-card drum-card-tone" aria-label="Tone">
            <div className="drum-card-head"><h2>Tone</h2>
              <button type="button" className="drum-card-icon drum-card-up" aria-label="Edit the EQ curve on the waveform" aria-pressed={view==='tone'}
                title={view==='tone'?'Back to Trim':'Drag the EQ curve on the big waveform above'} onClick={()=>setView(view==='tone'?'trim':'tone')}><ArrowUp size={18}/></button></div>
            <div className="smp-seg" role="radiogroup" aria-label="Tone controls">
              <button type="button" role="radio" aria-checked={toneTab==='eq'} onClick={()=>setToneTab('eq')}>EQ</button>
              <button type="button" role="radio" aria-checked={toneTab==='filter'} onClick={()=>setToneTab('filter')}>Filter</button>
            </div>
            {toneTab==='eq'?<div className="smp-knobs two one">
              {knob('eq_low','Low',-18,18,.5,'dB',1,'Low shelf at 200 Hz')}
              {knob('eq_high','High',-18,18,.5,'dB',1,'High shelf at 5 kHz')}
              {knob('eq_mid','Mid',-18,18,.5,'dB',1,'Bell at the Mid frequency')}
              {knob('eq_freq','Mid freq',100,8000,10,'Hz',0,'Centre of the Mid bell')}
            </div>:<div className="smp-knobs two one">
              {knob('low_cut','Low cut',20,2000,1,'Hz',0,'High-pass filter, 12 dB per octave; 20 Hz is off')}
              {knob('high_cut','High cut',500,20000,10,'Hz',0,'Low-pass filter, 12 dB per octave; 20000 Hz is off')}
              {knob('drive','Drive',0,100,1,'%',0,'Soft saturation',100)}
            </div>}
          </section>
          <section className={'smp-card drum-card-comp'+(shape.comp_ratio<=1?' off':'')} aria-label="Compressor">
            <div className="drum-card-head"><h2>Comp</h2>
              <button type="button" role="switch" className="drum-comp-power" aria-checked={shape.comp_ratio>1} aria-label="Compressor on"
                title={shape.comp_ratio>1?'Turn the compressor off (the settings are kept)':'Turn the compressor on'}
                onClick={()=>{if(shape.comp_ratio>1){lastRatio.current[selected]=shape.comp_ratio;edit('shape',{...shape,comp_ratio:1});}
                  else edit('shape',{...shape,comp_ratio:lastRatio.current[selected]??4});}}><Power size={14}/>{shape.comp_ratio>1?'On':'Off'}</button></div>
            <div className="drum-comp-body"><div className="smp-knobs two one">
              {knob('comp_threshold','Threshold',-48,0,.5,'dB',1,'Level where compression starts')}
              {knob('comp_ratio','Ratio',1,20,.1,':1',1,'1:1 is off')}
              {knob('comp_attack','Attack',.1,100,.1,'ms',1,'How fast it clamps down')}
              {knob('comp_release','Release',10,1000,1,'ms',0,'How fast it lets go')}
              {knob('comp_makeup','Gain',0,24,.5,'dB',1,'Make-up gain after compression')}
            </div>
            <CompMeter shape={shown} level={live?.lvl} onDraft={p=>setDrafts(d=>({...d,...p}))} onCommit={p=>edit('shape',{...shape,...p})}/></div>
          </section>
        </div>
      </section>
    </div>

  </section>;
}

/** A new edit owner discards local gestures and historical event serials. */
export function DrumRack(props:Props) {return <RackSurface key={props.trackIndex+':'+(props.track.drum_rack?.id??'pending')} {...props}/>;}
