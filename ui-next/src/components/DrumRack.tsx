import {useContextTarget} from './ContextWheel';
import { useEffect, useRef, useState,type ReactNode } from 'react';
import { AudioWaveform, FolderOpen, Grid2X2, KeyboardMusic, Link2, ListMusic } from 'lucide-react';
import { Knob } from './Knob';
import { DrumKitBrowser } from './DrumKitBrowser';
import { TRACK_COLORS, noteName, DEFAULT_DRUM_SHAPE, type Track, type DrumRuntime, type DrumLibraryState, type DrumShape } from '../types';
import { DRUM_KINDS, drumKind, padLabel } from '../drum-kinds';
import { compressorPath, envelopePath, responsePath } from '../drum-shape-graph';
import '../drum-rack.css';

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
  const mounted=useRef(true);
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
  return <div className="drum-committed-knob" onPointerDownCapture={()=>{pointer.current=true;}}
    onKeyUpCapture={e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Enter'].includes(e.key))setTimeout(finish,0);}}
    // Exact numeric entry commits on Enter and then unmounts its input, so neither keyup nor blur reaches this wrapper.
    onKeyDownCapture={e=>{if(e.key==='Enter')setTimeout(finish,0);}}
    onBlur={()=>{if(!pointer.current)setTimeout(finish,0);}}>
    <Knob contextArea="drum" id={id} name={name} value={draft} min={min} max={max} step={step} suffix={suffix} precision={precision} description={description} accent="var(--pad-accent)" format={format} defaultValue={defaultValue}
      onChange={next=>{latest.current=next;dirty.current=next!==original.current;setDraft(next);draftRef.current?.(next);}}/>
  </div>;
}

function SourceWave({peaks,shape,seconds,step}:{peaks:number[][];shape:DrumShape;seconds:number;step:number}) {
  const pairs=peaks.filter(p=>p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!pairs.length)return null;
  // The level line only when something changes the level over time (EQ, compressor and pan do not).
  const shaped=(['start','end','reverse','fade_in','fade_out','attack','hold','decay'] as const).some(k=>shape[k]!==DEFAULT_DRUM_SHAPE[k]);
  return <svg data-testid="drum-waveform" className="drum-waveform" viewBox="0 0 512 96" preserveAspectRatio="none" role="img" aria-label="Sample waveform from decoded PCM peaks, with the pad's trim, fades and envelope">
    <path d="M0 48H512" className="drum-wave-zero"/>
    {pairs.map((p,i)=><line key={i} x1={(i+.5)*512/pairs.length} x2={(i+.5)*512/pairs.length}
      y1={48-Math.max(-1,Math.min(1,p[1]))*43} y2={48-Math.max(-1,Math.min(1,p[0]))*43} strokeWidth={Math.max(1,512/pairs.length*.75)}/>)}
    {/* drawn over the peaks: the cut-off parts are dimmed */}
    {shape.start>0?<rect className="drum-wave-trimmed" x={0} y={0} width={shape.start*512} height={96}/>:null}
    {shape.end<1?<rect className="drum-wave-trimmed" x={shape.end*512} y={0} width={(1-shape.end)*512} height={96}/>:null}
    {shaped?<path data-testid="drum-envelope" className="drum-wave-envelope" d={envelopePath(shape,seconds,step)} vectorEffect="non-scaling-stroke"/>:null}
  </svg>;
}

/** Small live graph beside the EQ / filter / compressor knobs (no handles, so it may stretch). */
function ShapeGraph({kind,shape}:{kind:'eq'|'comp';shape:DrumShape}){
  const w=220,h=88;
  return <svg data-testid={'drum-graph-'+kind} className="drum-shape-graph" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img"
    aria-label={kind==='eq'?'EQ and filter response, 20 Hz to 20 kHz':'Compressor curve, input against output level'}>
    {kind==='eq'?<>{[100,1000,10000].map(f=><line key={f} className="grid" x1={Math.log10(f/20)/3*w} x2={Math.log10(f/20)/3*w} y1={0} y2={h}/>)}
      <line className="grid zero" x1={0} x2={w} y1={h/2} y2={h/2}/><path d={responsePath(shape,w,h)} vectorEffect="non-scaling-stroke"/></>
    :<><line className="grid zero" x1={0} x2={w} y1={h} y2={h-48/72*h}/>
      <line className="grid" x1={(shape.comp_threshold+48)/48*w} x2={(shape.comp_threshold+48)/48*w} y1={0} y2={h}/><path d={compressorPath(shape,w,h)} vectorEffect="non-scaling-stroke"/></>}
  </svg>;
}

type ShapeTab='env'|'trim'|'eq'|'comp'|'tone';
const TABS:[ShapeTab,string][]=[['env','Envelope'],['trim','Trim & fade'],['eq','EQ'],['comp','Compressor'],['tone','Filter & drive']];
/** Start/End handles on the waveform: drag to trim (44 px hit zones; one gesture is one edit). */
function TrimHandles({shape,onDraft,onCommit}:{shape:DrumShape;onDraft:(s:DrumShape|null)=>void;onCommit:(s:DrumShape)=>void}){
  const drag=useRef<{key:'start'|'end';el:HTMLElement;width:number;left:number;value:DrumShape;from:DrumShape}|null>(null);
  const begin=(key:'start'|'end')=>(e:React.PointerEvent<HTMLButtonElement>)=>{
    const shell=e.currentTarget.parentElement!.getBoundingClientRect();e.currentTarget.setPointerCapture(e.pointerId);
    drag.current={key,el:e.currentTarget,width:shell.width-10,left:shell.left+5,value:shape,from:shape};
  };
  const move=(e:React.PointerEvent)=>{const d=drag.current;if(!d)return;
    const at=Math.max(0,Math.min(1,(e.clientX-d.left)/d.width));
    const next={...d.value,[d.key]:d.key==='start'?Math.min(at,d.value.end-.002):Math.max(at,d.value.start+.002)};
    d.value={...next,start:Math.round(next.start*1000)/1000,end:Math.round(next.end*1000)/1000};onDraft(d.value);};
  const end=(commit:boolean)=>()=>{const d=drag.current;drag.current=null;onDraft(null);if(d&&commit&&(d.value.start!==d.from.start||d.value.end!==d.from.end))onCommit(d.value);};
  return <>{(['start','end'] as const).map(key=><button key={key} type="button" className={'drum-trim-handle '+key} style={{left:'calc(5px + (100% - 10px) * '+shape[key]+')'}}
    aria-label={'Trim '+key+' '+Math.round(shape[key]*1000)/10+'%'} onPointerDown={begin(key)} onPointerMove={move} onPointerUp={end(true)} onPointerCancel={end(false)}
    onKeyDown={e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();const step=e.key==='ArrowLeft'?-.01:.01;
      const v=Math.round((shape[key]+step)*1000)/1000;if(key==='start'?v>=0&&v<shape.end-.001:v<=1&&v>shape.start+.001)onCommit({...shape,[key]:v});}}><i/></button>)}</>;
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
  const [shapeTab,setShapeTab]=useState<ShapeTab>('env');
  const [trimDraft,setTrimDraft]=useState<DrumShape|null>(null);
  // Knob values while turning: the graphs follow them live; the engine gets the value on release.
  const [drafts,setDrafts]=useState<Partial<DrumShape>&{tune?:number}>({});
  const committed=JSON.stringify([selected,pad?.shape,pad?.tune]);
  useEffect(()=>{setDrafts({});},[committed]);
  if(!kit||!pad)return <section className="drum-rack drum-rack-loading" aria-label="Drum Rack"><AudioWaveform size={24}/><p>Preparing Drum Rack…</p></section>;
  const shape:DrumShape={...DEFAULT_DRUM_SHAPE,...pad.shape};
  const {tune:tuneDraft,...shapeDrafts}=drafts;
  const shown:DrumShape=trimDraft??{...shape,...shapeDrafts};
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
  const playMs=Math.round((shown.end-shown.start)*seconds/step*1000);
  return <section className="drum-rack" aria-label="Drum Rack" style={{['--drum-accent' as string]:TRACK_COLORS[trackIndex%TRACK_COLORS.length],['--pad-accent' as string]:pad.source?selectedKind.color:DRUM_KINDS.other.color}}>
    <header className="drum-device-bar">
      <div className="drum-device-title"><Grid2X2 size={21}/><h1>Drum Rack</h1><span>Track {trackIndex+1}</span></div>
      <div className="drum-device-meta"><span className="drum-kit-name" title={kit.name||'Custom kit'}>{kit.name||'Custom kit'}</span><strong>{loaded}/16 sources ready</strong>{onBrowserOpen?null:<button type="button" aria-expanded={browsing} onClick={()=>setBrowsing(!browsing)}><FolderOpen size={17}/>Kits</button>}</div>
    </header>
    <div className={'drum-workspace'+(browsing?' is-browsing':'')}>
      {browsing?<DrumKitBrowser library={library} selectedPad={selected} onLoadFolder={onLoadFolder} onChooseLibrary={onChooseLibrary} onRefreshLibrary={onRefreshLibrary}
        onBrowseFolder={onBrowseFolder} onPreviewSample={onPreviewSample} onStopPreview={onStopPreview} onReplaceSample={onReplaceSample}
        onBack={()=>setBrowsing(false)}/>:<section className="drum-pads-panel" aria-labelledby="drum-pads-title">
        <div className="drum-section-bar"><h2 id="drum-pads-title">PADS</h2><span>Touch to play · MIDI 36–51</span></div>
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
        {steps?.(pad)}
      </section>}
      <section className="drum-pad-sound" aria-labelledby="drum-pad-sound-title">
        <div className="drum-section-bar"><h2 id="drum-pad-sound-title">PAD SOUND</h2><span>Pad {String(selected+1).padStart(2,'0')} · MIDI {pad.note}</span>
          <strong className="drum-sound-name" title={pad.name}>{padLabel(pad.name,kit.name)||'Empty pad'}</strong>
          <span className="drum-source-file" title={pad.source?.path}>{fileName??'No sample assigned'}</span>
          <span className={'drum-status status-'+status.toLowerCase()}>{status}</span>
          <div className="drum-import-actions">
          {onPlayOnKeys?<button type="button" className="drum-play-keys" aria-label="Play this pad on the keys" title="Make a Sampler track that plays this sound on the keys" disabled={!sourceReady} onClick={()=>onPlayOnKeys(selected)}><KeyboardMusic size={17}/></button>:null}
          <button type="button" aria-label="Browse and audition sample sounds" title="Listen to library sounds and swap this pad" onClick={()=>setBrowsing(true)}><ListMusic size={17}/></button>
          <button type="button" aria-label={pad.source?'Import replacement WAV file':'Import WAV file'} title="Choose a WAV file directly" onClick={()=>onImport(selected,false)}><FolderOpen size={17}/>{pad.source?null:'Import WAV'}</button>
          {pad.source&&status==='MISSING'?<button type="button" className="drum-relink" onClick={()=>onImport(selected,true)}><Link2 size={17}/>Relink WAV</button>:null}
        </div></div>
        <div className="drum-wave-shell">
          {sourceReady&&live?.peaks.length?<><SourceWave peaks={live.peaks} shape={shown} seconds={seconds} step={step}/><TrimHandles shape={shown} onDraft={setTrimDraft} onCommit={s=>edit('shape',s)}/></>:<div className="drum-wave-empty"><AudioWaveform size={22}/><span>{status==='MISSING'?'Sample missing · relink the original WAV':status==='LOADING'?'Loading sample…':status==='ERROR'?'Sample could not load':'Import a WAV to see its waveform'}</span></div>}
          <span className="drum-wave-caption">{sourceReady?'SOURCE · '+(shown.end-shown.start<1?'TRIM '+Math.round(shown.start*seconds*1000)+'–'+Math.round(shown.end*seconds*1000)+' MS':Math.round(seconds*1000)+' MS')+(shown.reverse?' · REVERSED':'')+(step!==1?' · PLAYS '+playMs+' MS':''):'SOURCE WAVEFORM'}</span>
        </div>
        {live?.error?<p className="drum-source-error" title={live.error} role="status">{live.error}</p>:null}
        <div className="drum-pad-controls" key={selected}>
          <CommittedKnob id={`drum-${trackIndex}-${selected}-gain`} defaultValue={1} name="Gain" value={pad.gain} min={0} max={2} step={.01} suffix="×" precision={2} description="Pad gain; applied to the next note" onCommit={n=>edit('gain',n)}/>
          <CommittedKnob id={`drum-${trackIndex}-${selected}-velocity`} defaultValue={1} name="Velocity" value={pad.velocity} min={0} max={2} step={.01} suffix="×" precision={2} description="Velocity response curve: 0 is fixed level, 1 is linear, 2 makes soft notes quieter" onCommit={n=>edit('velocity',n)}/>
          <CommittedKnob id={`drum-${trackIndex}-${selected}-tune`} defaultValue={0} name="Tune" value={pad.tune} min={-24} max={24} step={1} suffix="st" precision={0} description="Pitch in semitones; envelope times and EQ stay where you set them" onDraft={draft('tune')} onCommit={n=>edit('tune',n)}/>
          {knob('pan','Pan',-100,100,1,'',0,'Place the pad left or right (C is the middle)',100,panText)}
          <div className="drum-pad-switches">
            <button type="button" aria-pressed={pad.mute} onClick={()=>edit('mute',!pad.mute)}>Mute</button>
            <button type="button" aria-pressed={pad.solo} onClick={()=>edit('solo',!pad.solo)}>Solo</button>
            <label>Choke<select aria-label="Choke group" value={pad.choke} onChange={e=>edit('choke',Number(e.target.value))}><option value={0}>None</option>{Array.from({length:16},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label>
          </div>
        </div>
        <div className="drum-shape" data-testid="drum-shape">
          <div className="drum-shape-tabs" role="tablist" aria-label="Pad sound shaping">
            {TABS.map(([id,label])=><button key={id} type="button" role="tab" aria-selected={shapeTab===id} onClick={()=>setShapeTab(id)}>{label}</button>)}
            <button type="button" className="drum-shape-reset" disabled={JSON.stringify(shape)===JSON.stringify(DEFAULT_DRUM_SHAPE)} title="Back to the sample as recorded" onClick={()=>edit('shape',{...DEFAULT_DRUM_SHAPE})}>Reset</button>
          </div>
          <div className={'drum-shape-controls tab-'+shapeTab} key={selected+':'+shapeTab}>
            {shapeTab==='env'?<>
              {knob('attack','Attack',0,1000,1,'ms',0,'Rise time at the start of the hit',1000)}
              {knob('hold','Hold',0,4000,1,'ms',0,'Full level after the attack. With Decay off the pad stops after the hold',1000,ms)}
              {knob('decay','Decay',0,8000,1,'ms',0,'Fade to silence after the hold; Off plays to the end (or stops after the hold)',1000,n=>n<=0?'Off':ms(n))}
              <p className="drum-shape-hint">Hold {shown.decay>0?'keeps full level, then Decay fades out.':shown.hold>0?'stops the pad after attack + hold.':'and Decay off: the sample plays to its end.'}</p>
            </>:shapeTab==='trim'?<>
              {knob('start','Start',0,99.8,.1,'%',1,'Where playback starts in the sample',100)}
              {knob('end','End',.2,100,.1,'%',1,'Where playback stops in the sample',100)}
              {knob('fade_in','Fade in',0,2000,1,'ms',0,'Fade at the start of what plays',1000,ms)}
              {knob('fade_out','Fade out',0,2000,1,'ms',0,'Fade at the end of what plays',1000,ms)}
              <button type="button" className="drum-shape-toggle" aria-pressed={shape.reverse} onClick={()=>setShape('reverse',!shape.reverse)}>{shape.reverse?'Reverse':'Forward'}</button>
            </>:shapeTab==='eq'?<>
              {knob('eq_low','Low',-18,18,.5,'dB',1,'Low shelf at 200 Hz')}
              {knob('eq_mid','Mid',-18,18,.5,'dB',1,'Bell at the Mid frequency')}
              {knob('eq_freq','Mid freq',100,8000,10,'Hz',0,'Centre of the Mid bell')}
              {knob('eq_high','High',-18,18,.5,'dB',1,'High shelf at 5 kHz')}
              <ShapeGraph kind="eq" shape={shown}/>
            </>:shapeTab==='comp'?<>
              {knob('comp_threshold','Threshold',-48,0,.5,'dB',1,'Level where compression starts')}
              {knob('comp_ratio','Ratio',1,20,.1,':1',1,'1:1 is off')}
              {knob('comp_attack','Attack',.1,100,.1,'ms',1,'How fast it clamps down')}
              {knob('comp_release','Release',10,1000,1,'ms',0,'How fast it lets go')}
              {knob('comp_makeup','Gain',0,24,.5,'dB',1,'Make-up gain after compression')}
              <ShapeGraph kind="comp" shape={shown}/>
            </>:<>
              {knob('low_cut','Low cut',20,2000,1,'Hz',0,'High-pass filter, 12 dB per octave; 20 Hz is off')}
              {knob('high_cut','High cut',500,20000,10,'Hz',0,'Low-pass filter, 12 dB per octave; 20000 Hz is off')}
              {knob('drive','Drive',0,100,1,'%',0,'Soft saturation',100)}
              <ShapeGraph kind="eq" shape={shown}/>
            </>}
          </div>
        </div>
      </section>
    </div>

  </section>;
}

/** A new edit owner discards local gestures and historical event serials. */
export function DrumRack(props:Props) {return <RackSurface key={props.trackIndex+':'+(props.track.drum_rack?.id??'pending')} {...props}/>;}
