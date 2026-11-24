import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AudioWaveform, Power, SlidersHorizontal, Sparkles, Waves, X, Zap } from 'lucide-react';
import { createFrameBatch } from '../chordz-primitives/frame-batch';
import { evaluatedPartials } from '../spectral';
import { SHAPES, harmonicShape, type Shape } from '../spectral-seeds';
import { SOUND_GUIDES, type SoundGuideId } from '../sound-guides';
import { TRACK_COLORS, clamp, type Track } from '../types';
import { SOUND_TARGETS, normalizeChain, type FxChain } from '../fx';
import { Knob, KnobTint } from './Knob';
import { EnvEditor } from './EnvEditor';
import { useSize } from './ModSheet';
import { useRingDepth } from './RingDepth';
import { useContextTarget } from './ContextWheel';
import { FILTER_ENV_KEYS, FILTER_NAMES, UNISON_VOICES, VOICE_DEFAULTS, VOWELS, filterEnvelope, filterMorph, fmtCents, fmtHz, fmtMorph, fmtNoiseTone, fmtOct, voiceParam, type VoiceKey } from '../sound-cards';
import { MACRO_COLORS, MOD_COLORS, sourceColor, sourceTargets, withTargets, type Live, type Source } from './ModParts';

type Params=Track['instrument'];
type Props={
  track:Track; selected:number;
  onParam:(key:keyof Params,index:number|null,value:number)=>void;
  onTrack:(key:'volume'|'mute',value:number|boolean)=>void;
  onShape:(shape:Shape)=>void;
  onChain:(c:FxChain)=>void; armed:Source|null; source?:Source; live?:Live;
  /** the preset name and Save, shown inside the tool rack (Sir, 16 Nov) */ preset?:ReactNode;
  /** the track's Reverb and Delay sends (Sends.tsx), and the button for the shared settings in that card's title bar */ sends?:ReactNode; sendsAction?:ReactNode;
};
type View='wave'|'amp'|'filter'|'strike';
const TAGS={sends:'#8fb8ff',tone:'#f2c46d',envelope:'#7fd6bb',movement:'#7aa7f5',output:'#c79df5',filter:'#f29a6d',unison:'#6dc9f2',character:'#e59ee0',strike:'#f2d36d'};
const SHAPE_NAME:Record<string,string>={SAW:'Saw',SQUARE:'Square',TRIANGLE:'Triangle',PULSE:'Pulse',GAUSSIAN:'Gauss',SPREAD:'Spread',RANDOM:'Random'};
const SPECTRAL_NEUTRAL={curve:0,balance:.5,focus:0,focus_center:4};
const VIEW_KEY='decksynth.synth-view';
const GUIDE_KEY='decksynth.sound-guide';

/** A row of buttons for a value with a few fixed choices (UI rule 11). */
function Seg({name,options,value,onPick,wide}:{name:string;options:{label:ReactNode;value:number;aria?:string}[];value:number;onPick:(v:number)=>void;wide?:boolean}){
  return <div className={'ss-seg'+(wide?' wide':'')} role="radiogroup" aria-label={name}>
    {options.map(o=><button key={o.value} type="button" role="radio" aria-checked={value===o.value} aria-label={o.aria}
      onClick={()=>onPick(o.value)}>{o.label}</button>)}
  </div>;
}
/** Filter types drawn, not spelled (UI rule 50). */
function Curve({kind}:{kind:number}){
  const d=kind===1?'M2 6 H13 Q18 6 20 9 T26 16':kind===2?'M2 16 Q9 15 12 9 Q14 4 16 9 Q19 15 26 16':'M2 16 Q8 16 10 9 T15 6 H26';
  return <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
}

/** The synth's Sound page (Sir, 16 Nov): every sound-shaping editor in its own fixed place, nothing in tabs, nothing folded,
 *  no side scroll. Top: the 16 partials (draw them), the big graph (live wave, or the amp / filter envelope with points to drag)
 *  and a tool rack that picks the graph's view. Below: eight module cards in four columns. */
export function SynthSound({track,selected,onParam,onTrack,onShape,onChain,armed,source,live,preset,sends,sendsAction}:Props){
  const p=track.instrument, accent=TRACK_COLORS[selected];
  const chain=normalizeChain(track.fx);
  const [view,setViewState]=useState<View>(()=>{try{return (localStorage.getItem(VIEW_KEY) as View)||'wave';}catch{return 'wave';}});
  const setView=(v:View)=>{setViewState(v);try{localStorage.setItem(VIEW_KEY,v);}catch{/* optional */}};
  const [guideId,setGuideIdState]=useState<SoundGuideId>(()=>{try{const saved=localStorage.getItem(GUIDE_KEY) as SoundGuideId|null;if(saved&&SOUND_GUIDES.some(guide=>guide.id===saved))return saved;return 'warm-round';}catch{return 'warm-round';}});
  const [guideOpen,setGuideOpen]=useState(false);
  const [guideActive,setGuideActive]=useState(false);
  const [guidedParams,setGuidedParams]=useState<Set<string>>(()=>new Set());
  const guide=SOUND_GUIDES.find(candidate=>candidate.id===guideId)??SOUND_GUIDES[0];
  const setGuide=(id:SoundGuideId)=>{setGuideIdState(id);setGuideActive(true);setGuidedParams(new Set());try{localStorage.setItem(GUIDE_KEY,id);}catch{/* optional */}};
  const set=(key:keyof Params,value:number)=>onParam(key,null,value);
  const vp=(k:VoiceKey)=>voiceParam(p,k);
  const spectral=(key:'curve'|'balance'|'focus'|'focus_center')=>p[key]??SPECTRAL_NEUTRAL[key];
  const pct=(v:number)=>Math.round(v*100)+'%';
  const ftype=vp('vcf_type'), lastType=useRef(1); if(ftype)lastType.current=ftype;
  const fenv=filterEnvelope(p), morph=filterMorph(p);
  const fenvLive=Object.fromEntries(Object.entries(FILTER_ENV_KEYS).flatMap(([k,v])=>live?.sound?.[v]===undefined?[]:[[k,live.sound[v]]]));

  /* ---- linking: every knob sits in a cell that takes the tap while the Link box is lit ---- */
  const routesFor=(param:string)=>{const out:string[]=[];
    chain.macros.forEach((m,i)=>m.targets.some(t=>t.module==='sound'&&t.param===param)&&out.push(MACRO_COLORS[i]));
    chain.mods.forEach((m,i)=>m.targets.some(t=>t.module==='sound'&&t.param===param)&&out.push(MOD_COLORS[i]));return out;};
  const toggle=(param:string)=>{if(!armed)return;
    const t=sourceTargets(chain,armed), at=t.findIndex(x=>x.module==='sound'&&x.param===param);
    const next=at>=0?t.filter((_,i)=>i!==at):[...t,{module:'sound' as const,param,depth:armed.kind==='macro'?.5:.4}];
    onChain(withTargets(chain,armed,next.slice(0,16)));};
  const ring=useRingDepth(chain,onChain,armed,(_m,q)=>toggle(q));
  const cell=(param:string,knob:(mod:{modValue:number|null,modColor?:string})=>ReactNode)=>{
    const routes=routesFor(param), here=!!armed&&sourceTargets(chain,armed).some(t=>t.module==='sound'&&t.param===param);
    const preferred=armed??source;
    const color=preferred&&sourceTargets(chain,preferred).some(t=>t.module==='sound'&&t.param===param)?sourceColor(preferred):routes[0];
    const now=live?.sound?.[param];
    return <div key={param} className={'fx-knob-cell sound-knob-cell ss-cell'+(routes.length?' has-mod':'')+(here?' routed-here':'')}
      onPointerDownCapture={ring.capture('sound',param)}>
      {knob({modValue:routes.length&&now!==undefined?now:null,modColor:color})}
      {routes.length?<span className="fx-route-dots">{routes.map((c,k)=><i key={k} style={{background:c}}/>)}</span>:null}
    </div>;};
  const linksInto=(card:string)=>{const colors:string[]=[];let n=0;
    [...chain.macros.map((m,i)=>[m,MACRO_COLORS[i]] as const),...chain.mods.map((m,i)=>[m,MOD_COLORS[i]] as const)].forEach(([src,c])=>{
      const k=src.targets.filter(t=>t.module==='sound'&&SOUND_TARGETS[t.param]?.card===card).length;if(k){n+=k;colors.push(c);}});
    return {n,colors};};
  const K=(param:keyof Params|string,name:string,value:number,min:number,max:number,extra:Partial<Parameters<typeof Knob>[0]>&{onChange:(v:number)=>void})=>
    {const {id,description,recommendedRange,onChange,...rest}=extra,paramKey=String(param),guideRange=guideActive&&!guidedParams.has(paramKey)?(guide.ranges[paramKey]??recommendedRange):undefined,guideAdvice=guideRange?guide.advice[paramKey]:undefined;return cell(paramKey,m=><Knob id={selected+'-'+(id??paramKey.replace(/_/g,'-'))} name={name} value={value} min={min} max={max} step={.005}
      compact description={[description,guideAdvice].filter(Boolean).join(' ')} recommendedRange={guideRange} onChange={v=>{if(guideRange)setGuidedParams(previous=>new Set(previous).add(paramKey));onChange(v);}} {...rest} {...m}/>);};

  /* ---- partials ---- */
  const shapeUsed=useMemo(()=>SHAPES.find(name=>(name!=='RANDOM'||p.random_seed!==undefined)&&harmonicShape(name,p.random_seed??0).every((v,i)=>Math.abs(v-p.harmonics[i])<1e-7))??'CUSTOM',[p.harmonics,p.random_seed]);
  const [activePartial,setActivePartial]=useState(0);
  const spectrum=useRef<HTMLDivElement>(null), dragging=useRef(false);
  const args=useRef(onParam);args.current=onParam;
  const batch=useMemo(()=>createFrameBatch<{index:number;value:number}>(item=>args.current('harmonics',item.index,item.value)),[]);
  useEffect(()=>()=>batch.discard(),[batch]);
  const editPartial=(e:React.PointerEvent)=>{const el=spectrum.current;if(!el)return;const b=el.getBoundingClientRect();
    const idx=clamp(Math.floor((e.clientX-b.left)/b.width*16),0,15),value=clamp((b.bottom-e.clientY)/Math.max(1,b.height),0,1);
    setActivePartial(idx);batch.push({index:idx,value:Number(value.toFixed(4))});};
  const heard=useMemo(()=>live?.partials??evaluatedPartials(p,live?.sound),[p,live?.sound,live?.partials]);

  /* ---- the big graph ---- */
  const [gref,{w,h}]=useSize<HTMLDivElement>();
  const wave=useMemo(()=>{const pts:string[]=[],mid=h/2,amp=h*.4,N=Math.max(80,Math.round(w/2)),cycles=3;
    let peak=0;const ys:number[]=[];
    for(let j=0;j<=N;j++){const ph=j/N*Math.PI*2*cycles;let s=0;for(let i=0;i<16;i++)s+=heard[i]*Math.sin(ph*(i+1))/(1+i*.15);ys.push(s);peak=Math.max(peak,Math.abs(s));}
    ys.forEach((s,j)=>pts.push((j?'L':'M')+(j/N*w).toFixed(1)+' '+(mid-s/Math.max(.001,peak)*amp).toFixed(1)));
    return {line:pts.join(' '),mid};},[heard,w,h]);
  const voices=Math.max(0,Math.round(live?.sound?.voices??0));

  const card=(id:string,title:string,tag:string,body:ReactNode,opts:{power?:{on:boolean;label:string;toggle:()=>void};reset?:()=>void;cls?:string;action?:ReactNode}={})=>{
    const l=linksInto(id);
    return <Card key={id} id={id} title={title} tag={tag} links={l} power={opts.power} reset={opts.reset} cls={opts.cls} action={opts.action}>{body}</Card>;};

  return <section className={'synth-sound'+(armed?' is-assigning':'')} aria-label="Sound" style={{['--accent-track' as string]:accent,['--armed' as string]:armed?sourceColor(armed):'transparent'}}>
    <div className="ss-top">
      <div className="ss-partials" aria-label="Partials">
        <div className="ss-graph-label">Partials <span>drag to draw · white is what you hear</span></div>
        <button type="button" className="ss-guide-toggle" aria-label="Sound guidance" aria-pressed={guideOpen} title={guideOpen?'Close sound guidance':'Open sound guidance'} onClick={()=>{setGuideActive(true);setGuideOpen(open=>!open);}}><Sparkles size={17}/></button>
        <div ref={spectrum} className="ss-bars" role="group" aria-label="Touch or drag to adjust the 16 harmonic partial levels"
          onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);dragging.current=true;editPartial(e);}}
          onPointerMove={e=>{if(dragging.current&&e.buttons)editPartial(e);}}
          onPointerUp={()=>{dragging.current=false;batch.flush();}} onPointerCancel={()=>{dragging.current=false;batch.flush();}}>
          {p.harmonics.map((v,i)=><div key={i} className={'ss-bar'+(activePartial===i?' current':'')} role="slider" aria-label={'Harmonic '+(i+1)}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v*100)} style={{['--v' as string]:v,['--heard' as string]:clamp(heard[i]??0,0,1)}}>
            {guideOpen?<i className="ss-bar-guide" style={{['--guide' as string]:guide.contour[i]}}/>:null}<i className="ss-bar-fill"/><i className="ss-bar-heard"/><span>{i+1}</span></div>)}
        </div>
        <div className="ss-shapes" role="radiogroup" aria-label="Starting shape">{SHAPES.map(name=>
          <button key={name} type="button" role="radio" aria-checked={shapeUsed===name} title={name==='RANDOM'?'New random partials · seed '+(p.random_seed??0):undefined}
            onClick={()=>{batch.flush();onShape(name);}}>{SHAPE_NAME[name]??name}</button>)}</div>
      </div>
      <div className={'ss-graph view-'+view} aria-label={view==='wave'?'Wave':view==='amp'?'Amp envelope':view==='strike'?'Strike':'Filter envelope'}>
        <div className="ss-graph-label" style={{color:view==='wave'?accent:view==='amp'?TAGS.envelope:view==='strike'?TAGS.strike:TAGS.filter}}>
          {view==='wave'?'Wave':view==='amp'?'Amp envelope':view==='strike'?'Strike':'Filter envelope'}
          <span>{view==='wave'?(live?.partials?'live · ':'preview · ')+'three cycles of the partials':view==='strike'?'the first second of a note':'drag the points · hold still for fine'}</span></div>
        <div ref={gref} className="ss-graph-plot">
          {view==='wave'?<svg width={w} height={h} aria-hidden="true">
            <line x1={0} x2={w} y1={wave.mid} y2={wave.mid} className="ss-zero"/>
            <path d={wave.line+` L${w} ${wave.mid} L0 ${wave.mid} Z`} fill={accent} opacity={.13}/>
            <path d={wave.line} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round"/></svg>
          :view==='strike'?<div className="ss-strike"><StrikeGraph p={p} colors={TAGS}/><div className="ss-knobs">

          {K('damp','Damping',vp('damp'),0,1,{suffix:'%',description:'The upper partials die away faster than the note itself, as on a string, a piano or a bell.',onChange:v=>set('damp',v)})}
          {K('noise','Noise',vp('noise'),0,1,{suffix:'%',description:'A short noise burst at the start of each note: a pick, a hammer or a breath.',onChange:v=>set('noise',v)})}
          {K('noise_decay','Noise time',vp('noise_decay'),.002,1,{step:.001,suffix:'s',onChange:v=>set('noise_decay',v)})}
          {K('noise_tone','Noise tone',vp('noise_tone'),0,1,{format:fmtNoiseTone,onChange:v=>set('noise_tone',v)})}
          {K('pitch_env','Pitch drop',vp('pitch_env'),-24,24,{step:.1,suffix:'st',description:'Each note starts this many semitones above its pitch (below, if negative) and slides to it.',onChange:v=>set('pitch_env',v)})}
          {K('pitch_decay','Drop time',vp('pitch_decay'),.005,1,{step:.001,suffix:'s',onChange:v=>set('pitch_decay',v)})}
          </div></div>
          :view==='amp'?<EnvEditor env={p} color={TAGS.envelope} live={live?.sound} onChange={(k,v)=>set(k,v)}/>
          :<EnvEditor env={fenv} color={TAGS.filter} live={fenvLive} onChange={(k,v)=>set(FILTER_ENV_KEYS[k],v)}/>}
        </div>
      </div>
      <div className="smp-rack ss-rack" role="toolbar" aria-label="Sound tools">
        <div className="ss-tools" role="radiogroup" aria-label="Big graph">
          {([['wave','Wave','Wave',<AudioWaveform key="w" size={18}/>,accent],['amp','Amp env','Amp',<SlidersHorizontal key="a" size={18}/>,TAGS.envelope],
            ['filter','Filter env','Filter',<Waves key="f" size={18}/>,TAGS.filter],['strike','Strike','Strike',<Zap key="s" size={18}/>,TAGS.strike]] as [View,string,string,ReactNode,string][]).map(([v,label,short,icon,c])=>
            <button key={v} type="button" role="radio" aria-checked={view===v} aria-label={label} className="smp-tool" style={{['--tool' as string]:c}} onClick={()=>setView(v)}>{icon}<span>{short}</span></button>)}
        </div>
        <div className="ss-display" aria-live="polite">
          <span className={'ss-led'+(voices?' on':'')}/><b>{voices?voices+(voices===1?' voice':' voices'):'idle'}</b>
          <small>{shapeUsed==='CUSTOM'?'Drawn':SHAPE_NAME[shapeUsed]} · {p.harmonics.filter(v=>v>.005).length} partials</small>
        </div>
        {preset?<div className="ss-preset">{preset}</div>:null}
      </div>
      <section className="ss-guide-panel" aria-label="Sound guidance" hidden={!guideOpen}>
        <div className="ss-guide-left"><header className="ss-guide-head"><div><b>Sound guidance</b></div></header><div className="ss-guide-picker">
          <div className="ss-guide-choices" role="radiogroup" aria-label="Sound design guide">
            {SOUND_GUIDES.map(candidate=><button key={candidate.id} type="button" role="radio" aria-checked={guide.id===candidate.id}
              className={guide.id===candidate.id?'on':''} onClick={()=>setGuide(candidate.id)}>{candidate.name}</button>)}
          </div>
          <small>{guide.character} Start with {SHAPE_NAME[guide.shape]}.</small>
        </div></div>
        <div className="ss-guide-right"><header className="ss-guide-right-head"><b>Why</b><div className="ss-guide-legend" aria-label="Sound and guide visual legend"><span><i className="ss-current-swatch"/>Saved partial</span><span><i className="ss-heard-swatch"/>Heard now</span><span><i className="ss-guide-swatch"/>Guide reference</span></div><button type="button" aria-label="Close sound guidance" title="Close sound guidance" onClick={()=>setGuideOpen(false)}><X size={17}/></button></header>
          <details className="ss-guide-details">
            <summary>Why this guide works</summary>
            <div className="ss-guide-explanation"><p><b>Tone</b>{guide.tone}</p><p><b>Movement</b>{guide.movement}</p><p><b>Music</b>{guide.musical}</p></div>
          </details>
        </div>
      </section>
    </div>

    <div className="ss-cards">
      <div className="ss-col">
        {card('sound-tone','Tone',TAGS.tone,<div className="ss-knobs">
          {K('filter','Brightness',p.filter,.02,1,{id:'brightness',suffix:'%',onChange:v=>set('filter',v)})}
          {K('curve','Curve',spectral('curve'),-1,1,{step:.01,precision:2,onChange:v=>set('curve',v)})}
          {K('balance','Balance',spectral('balance'),0,1,{suffix:'%',onChange:v=>set('balance',v)})}
          {K('focus','Focus',spectral('focus'),0,1,{suffix:'%',onChange:v=>set('focus',v)})}
          {K('focus_center','Focus on',spectral('focus_center'),1,16,{step:1,precision:0,onChange:v=>set('focus_center',Math.round(v))})}
          {K('pitch','Pitch',vp('pitch'),-12,12,{step:.01,suffix:'st',onChange:v=>set('pitch',v)})}
          {K('velocity_brightness','Vel bright',vp('velocity_brightness'),-1,1,{suffix:'%',onChange:v=>set('velocity_brightness',v)})}
          {K('air','Air',vp('air'),0,1,{suffix:'%',description:'Partials past 16: low notes keep their top end.',onChange:v=>set('air',v)})}
        </div>,{reset:()=>(['curve','balance','focus','focus_center'] as const).forEach(k=>set(k,SPECTRAL_NEUTRAL[k]))})}
        {card('sound-unison','Unison',TAGS.unison,<>
          <Seg name="Unison voices" value={vp('uni_voices')} onPick={v=>set('uni_voices',v)} options={UNISON_VOICES.map(n=>({label:String(n),value:n,aria:n+(n===1?' voice':' voices')}))}/>
          <div className="ss-knobs">{K('uni_detune','Detune',vp('uni_detune'),0,1,{format:fmtCents,onChange:v=>set('uni_detune',v)})}</div>
        </>,{reset:()=>(['uni_voices','uni_detune'] as VoiceKey[]).forEach(k=>set(k,VOICE_DEFAULTS[k]))})}
      </div>
      <div className="ss-col">
        {card('rack-envelope','Amp envelope',TAGS.envelope,<div className="ss-knobs">
          {K('attack','Attack',p.attack,.001,3,{step:.001,suffix:'s',onChange:v=>set('attack',v)})}
          {K('decay','Decay',p.decay,.001,3,{step:.001,suffix:'s',onChange:v=>set('decay',v)})}
          {K('sustain','Sustain',p.sustain,0,1,{suffix:'%',onChange:v=>set('sustain',v)})}
          {K('release','Release',p.release,.01,3,{suffix:'s',onChange:v=>set('release',v)})}
          {K('env_curve','Shape',vp('env_curve'),0,1,{suffix:'%',description:'0: decay and release fall in a straight line (loud, then a drop at the end). Up: they fade evenly to the ear, like a struck string.',onChange:v=>set('env_curve',v)})}
        </div>,{reset:()=>{set('attack',.008);set('decay',.6);set('sustain',.35);set('release',.5);set('env_curve',0);}})}
        {card('motion-synth','Play',TAGS.movement,<>
          <Seg name="Voice mode" value={vp('play_mode')} onPick={v=>set('play_mode',v)} options={['Poly','Mono','Legato'].map((label,value)=>({label,value}))}/>
          <div className="ss-knobs">
            {K('glide','Glide',vp('glide'),0,2,{step:.001,suffix:'s',onChange:v=>set('glide',v)})}
            {K('modulation','Movement',p.modulation,0,1,{id:'tone-motion',suffix:'%',description:'Vibrato and tremolo. The mod wheel adds to it.',onChange:v=>set('modulation',v)})}
            {K('drift','Drift',vp('drift'),0,1,{suffix:'%',description:'Each note gets its own start and a few cents of its own tuning, like an analog synth.',onChange:v=>set('drift',v)})}
            {K('vel_curve','Dynamics',vp('vel_curve'),0,1,{suffix:'%',description:'How much softer a soft note is. 0: the old straight line; up: more like a real piano.',onChange:v=>set('vel_curve',v)})}
          </div></>,{reset:()=>{set('modulation',.08);set('glide',0);set('play_mode',0);set('drift',0);set('vel_curve',0);}})}
      </div>
      <div className="ss-col">
        {card('sound-filter','Filter',TAGS.filter,<>
          <Seg name="Filter type" value={morph===0?1:morph===.5?2:morph===1?3:0} onPick={v=>{set('vcf_type',v);set('vcf_morph',(v-1)/2);}}
            options={[1,2,3].map(i=>({label:<><Curve kind={i}/><span>{['LP','BP','HP'][i-1]}</span></>,value:i,aria:FILTER_NAMES[i]}))}/>
          <div className={'ss-knobs'+(ftype?'':' is-off')}>
            {K('vcf_cutoff','Cutoff',vp('vcf_cutoff'),0,1,{step:.002,format:fmtHz,onChange:v=>set('vcf_cutoff',v)})}
            {K('vcf_reso','Resonance',vp('vcf_reso'),0,1,{suffix:'%',onChange:v=>set('vcf_reso',v)})}
            {K('vcf_env','Env amount',vp('vcf_env'),-1,1,{format:fmtOct,onChange:v=>set('vcf_env',v)})}
            {K('vcf_morph','Morph',morph,0,1,{step:.002,format:fmtMorph,onChange:v=>set('vcf_morph',v)})}
            {K('vcf_keytrack','Key track',vp('vcf_keytrack'),0,1,{suffix:'%',onChange:v=>set('vcf_keytrack',v)})}
            {K('velocity_cutoff','Vel cutoff',vp('velocity_cutoff'),-1,1,{suffix:'%',onChange:v=>set('velocity_cutoff',v)})}
          </div></>,{power:{on:ftype>0,label:'filter',toggle:()=>set('vcf_type',ftype?0:lastType.current)},
          reset:()=>{(['vcf_cutoff','vcf_reso','vcf_env'] as VoiceKey[]).forEach(k=>set(k,VOICE_DEFAULTS[k]));set('vcf_morph',0);},cls:ftype?'':'off'})}
        {card('sound-filter-env','Filter envelope',TAGS.filter,<div className={'ss-knobs'+(ftype?'':' is-off')}>
          {(Object.entries(FILTER_ENV_KEYS) as [keyof typeof fenv,typeof FILTER_ENV_KEYS[keyof typeof fenv]][]).map(([k,param])=>
            K(param,k[0].toUpperCase()+k.slice(1),fenv[k],k==='sustain'?0:k==='release'?.01:.001,k==='sustain'?1:3,
              {id:param.replace('_','-'),step:k==='sustain'?.005:.001,suffix:k==='sustain'?'%':'s',onChange:v=>set(param,v)}))}
        </div>,{reset:()=>Object.entries(FILTER_ENV_KEYS).forEach(([k,v])=>set(v,p[k as keyof typeof fenv])),cls:ftype?'':'off'})}
      </div>
      <div className="ss-col">
        {card('sound-character','Character',TAGS.character,<>
          <Seg name="Vowel" value={Math.round(vp('vowel'))} onPick={v=>{set('vowel',v);if(!vp('formant'))set('formant',.7);}} options={VOWELS.map((l,i)=>({label:l,value:i,aria:'Vowel '+l}))}/>
          <div className="ss-knobs">
            {K('character','Character',p.character??0,-1,1,{format:v=>(v>0?'+':'')+Math.round(v*100)+'%',description:'Odd/even balance: +100% odd only, −100% even only.',onChange:v=>set('character',v)})}
            {K('formant','Formant',vp('formant'),0,1,{suffix:'%',onChange:v=>set('formant',v)})}
            {K('inharm','Stretch',vp('inharm'),0,1,{suffix:'%',description:'Inharmonicity: pulls the partials apart like a bell or a piano string.',onChange:v=>set('inharm',v)})}
            {K('sub','Sub',vp('sub'),0,1,{suffix:'%',onChange:v=>set('sub',v)})}
          </div>
          <Seg name="Sub octave" value={vp('sub_oct')} onPick={v=>set('sub_oct',v)} options={[{label:'Sub −1 oct',value:1,aria:'One octave down'},{label:'Sub −2 oct',value:2,aria:'Two octaves down'}]}/>
        </>,{reset:()=>{set('character',0);(['formant','vowel','inharm','sub','sub_oct'] as VoiceKey[]).forEach(k=>set(k,VOICE_DEFAULTS[k]));}})}
        {card('rack-output','Output & Sends',TAGS.output,<>
          <div className="ss-knobs">
            {cell('volume',m=><Knob id={selected+'-volume'} name="Volume" value={track.volume} min={0} max={1} step={.005} defaultValue={.7} suffix="%" compact onChange={v=>onTrack('volume',v)} {...m}/>)}
            {K('pan','Pan',vp('pan'),-1,1,{step:.01,onChange:v=>set('pan',v)})}
          </div>
          {sends?<div className="ss-sends-inline" role="group" aria-label="Track sends">{sends}</div>:null}
        </>,{power:{on:!track.mute,label:'track output',toggle:()=>onTrack('mute',!track.mute)},action:sendsAction})}
      </div>
    </div>
    {ring.bubble}
  </section>;
}

/** Strike view (24 Nov): the first second of a note as the engine plays it at middle C, on a square-root time axis
 *  so the first milliseconds get room. Pitch: semitones above the note. Noise: the burst's level. Top: where the
 *  damping low-pass sits, in octaves above the note (7 = wide open), as in decksynth/strike.py. */
function StrikeGraph({p,colors}:{p:Params;colors:Record<string,string>}){
  const [ref,{w,h}]=useSize<HTMLDivElement>();
  const v=(k:VoiceKey)=>voiceParam(p,k);
  const pe=v('pitch_env'),pd=Math.max(.005,v('pitch_decay')),nz=v('noise'),nd=Math.max(.002,v('noise_decay')),damp=v('damp');
  const tau=(.04+3*(1-damp)**2),lo=1.6-damp*.6;
  const lanes:[string,string,(t:number)=>number,boolean][]=[
    ['Pitch',colors.movement,t=>.5+pe*Math.exp(-t/pd)/48,true],
    ['Noise',colors.character,t=>nz*Math.exp(-t/nd),false],
    ['Top',colors.tone,t=>damp>0?(lo+(7-lo)*Math.exp(-t/tau))/7:1,false]];
  const lh=Math.max(1,(h-14)/3),X=(t:number)=>Math.sqrt(t)*Math.max(1,w-4)+2,N=72;
  return <div ref={ref} className="ss-strike-graph" aria-hidden="true">{w>0&&h>0?<svg width={w} height={h}>
    {lanes.map(([name,c,f,mid],i)=>{const top=i*lh+2,bot=top+lh-4;
      const pts=Array.from({length:N+1},(_,j)=>{const t=(j/N)**2;return (j?'L':'M')+X(t).toFixed(1)+' '+(bot-clamp(f(t),0,1)*(bot-top)).toFixed(1);}).join(' ');
      return <g key={name}>{mid?<line x1={0} x2={w} y1={(top+bot)/2} y2={(top+bot)/2} className="ss-zero"/>:<line x1={0} x2={w} y1={bot} y2={bot} className="ss-zero"/>}
        <path d={pts} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round"/><text x={4} y={top+10} fill={c} className="ss-strike-lane">{name}</text></g>;})}
    {[[.01,'10 ms'],[.1,'0.1 s'],[1,'1 s']].map(([t,l])=><text key={l as string} x={Math.min(w-22,X(t as number))} y={h-2} className="ss-strike-tick">{l}</text>)}
  </svg>:null}</div>;
}

/** A module card: title in its section colour, the linked-mods badge, an optional On/Off switch; Reset is in the radial menu. */
function Card({id,title,tag,links,power,reset,cls,action,children}:{id:string;title:string;tag:string;links:{n:number;colors:string[]};
  power?:{on:boolean;label:string;toggle:()=>void};reset?:()=>void;cls?:string;action?:ReactNode;children:ReactNode}){
  const context=useContextTarget(()=>({area:'sound',kind:'rack.card',label:title,caps:{...(power?{bypass:power.toggle}:{}),...(reset?{reset}:{})}}));
  return <section {...context} className={'ss-card'+(cls?' '+cls:'')} data-panel={id} aria-label={title} style={{['--tag' as string]:tag}}>
    <header className="ss-card-head"><h2>{title}</h2>
      {links.n?<span className="ss-mods" title={links.n+' mod link'+(links.n>1?'s':'')}>{Array.from(new Set(links.colors)).map(c=><i key={c} style={{background:c}}/>)}{links.n}</span>:null}
      {power?<button type="button" role="switch" className="ss-power" aria-checked={power.on} aria-label={'Turn '+power.label+(power.on?' off':' on')}
        onClick={power.toggle}><Power size={13}/>{power.on?'On':'Off'}</button>:null}
      {action}
    </header>
    <KnobTint.Provider value={tag}>{children}</KnobTint.Provider>
  </section>;
}
