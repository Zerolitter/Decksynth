import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { AudioWaveform, Layers, Mic2, RotateCcw, SlidersHorizontal, Sparkles, Volume2, Waves } from 'lucide-react';
import { Panel, useAutoFold } from './Panel';
import { Knob } from './Knob';
import { TRACK_COLORS, type Track } from '../types';
import { SOUND_TARGETS, normalizeChain, type FxChain } from '../fx';
import { EnvelopeGraph } from './EnvEditor';
import { EnvSheet } from './EnvSheet';
import { useRingDepth } from './RingDepth';
import { FILTER_NAMES, FILTER_TYPES, UNISON_VOICES, VOICE_DEFAULTS, VOWELS, fmtCents, fmtHz, fmtOct, fmtVowel, voiceParam, type VoiceKey } from '../sound-cards';
import { MACRO_COLORS, MOD_COLORS, sourceColor, sourceTargets, withTargets, type Live, type Source } from './ModParts';

type Params=Track['instrument'];
type Props = {
  track:Track;selected:number;
  onParam:(key:keyof Params,index:number|null,value:number)=>void;
  onTrack:(key:'volume'|'mute',value:number|boolean)=>void;
  autoFold:boolean;
  /** Linking: while a macro or pad is armed, tapping a knob links it (or unlinks it). */
  onChain?:(c:FxChain)=>void; armed?:Source|null; live?:Live;
};
const CARD_IDS=['sound-tone','rack-envelope','motion-synth','rack-output','sound-filter','sound-unison','sound-character'];
const TAGS={tone:'#7fd6bb',envelope:'#f2c46d',movement:'#7aa7f5',output:'#c79df5',filter:'#f29a6d',unison:'#6dc9f2',character:'#e59ee0'};
/** A row of buttons for a value with a few fixed choices (UI rule: discrete values are buttons). */
function Choice({label,name,options,value,onPick}:{label:string;name:string;options:{label:string;value:number;aria?:string}[];value:number;onPick:(v:number)=>void}){
  return <div className="fx-choice sound-choice"><span className="fx-choice-label">{label}</span>
    <div className="fx-segment" role="radiogroup" aria-label={name}>
      {options.map(o=><button key={o.value} type="button" role="radio" aria-checked={value===o.value} aria-label={o.aria}
        className={value===o.value?'active':''} onClick={()=>onPick(o.value)}>{o.label}</button>)}
    </div></div>;
}
const SPECTRAL_NEUTRAL={curve:0,balance:.5,focus:0,focus_center:4};

/** Sound rack: compact cards, each as wide as its knobs and as tall as the mod pad row.
 *  Double-tap a card's title to fold it. ↺ resets just that card. */
export function SoundCards({track,selected,onParam,onTrack,autoFold,onChain,armed=null,live}:Props) {
  const rack=useRef<HTMLDivElement>(null);
  const [envOpen,setEnvOpen]=useState(false);
  useEffect(()=>setEnvOpen(false),[selected]);
  const chain=normalizeChain(track.fx);
  const routesFor=(param:string)=>{
    const out:string[]=[];
    chain.macros.forEach((m,i)=>m.targets.some(t=>t.module==='sound'&&t.param===param)&&out.push(MACRO_COLORS[i]));
    chain.mods.forEach((m,i)=>m.targets.some(t=>t.module==='sound'&&t.param===param)&&out.push(MOD_COLORS[i]));
    return out;
  };
  const linksInto=(card:string)=>[...chain.macros,...chain.mods].reduce((n,src)=>
    n+src.targets.filter(t=>t.module==='sound'&&SOUND_TARGETS[t.param]?.card===card).length,0);
  const toggle=(param:string)=>{
    if(!armed||!onChain)return;
    const t=sourceTargets(chain,armed), at=t.findIndex(x=>x.module==='sound'&&x.param===param);
    const next=at>=0?t.filter((_,i)=>i!==at):[...t,{module:'sound' as const,param,depth:armed.kind==='macro'?.5:.4}];
    onChain(withTargets(chain,armed,next.slice(0,16)));
  };
  const ring=useRingDepth(chain,onChain,armed,(_m,p)=>toggle(p));
  // Every Sound knob sits in a cell that takes the tap while linking and shows who moves it.
  const cell=(param:string,knob:(mod:{modValue:number|null,modColor?:string})=>ReactNode)=>{
    const routes=routesFor(param), here=!!armed&&sourceTargets(chain,armed).some(t=>t.module==='sound'&&t.param===param);
    const now=live?.sound?.[param];
    return <div key={param} className={'fx-knob-cell sound-knob-cell'+(routes.length?' has-mod':'')+(here?' routed-here':'')}
      onPointerDownCapture={ring.capture('sound',param)}>
      {knob({modValue:routes.length&&now!==undefined?now:null,modColor:routes[0]})}
      {routes.length?<span className="fx-route-dots">{routes.map((c,k)=><i key={k} style={{background:c}}/>)}</span>:null}
    </div>;
  };
  useAutoFold(rack,CARD_IDS,autoFold);
  const p=track.instrument;
  const accent=TRACK_COLORS[selected];
  const set=(key:keyof Params,value:number)=>onParam(key,null,value);
  const vp=(k:VoiceKey)=>voiceParam(p,k);
  const ftype=vp('vcf_type'), lastType=useRef(1); if(ftype)lastType.current=ftype;
  const resetVoice=(keys:VoiceKey[])=>keys.forEach(k=>set(k,VOICE_DEFAULTS[k]));
  const pct=(v:number)=>Math.round(v*100)+'%';
  const spectral=(key:'curve'|'balance'|'focus'|'focus_center')=>p[key]??SPECTRAL_NEUTRAL[key];
  const reset=(label:string,fn:()=>void)=><button type="button" className="panel-icon-action" aria-label={'Reset '+label}
    title={'Reset '+label} onClick={fn}><RotateCcw size={15}/></button>;
  return <div ref={rack} className={'frame-rack sound-cards'+(armed?' is-assigning':'')}
    style={{['--armed' as string]:armed?sourceColor(armed):'transparent'}}>{[
    {id:'sound-tone',node:<Panel rail id="sound-tone" className="rack-card sound-card card-tone" title="Tone" tag={TAGS.tone} mods={linksInto('sound-tone')} icon={<Sparkles size={15}/>} accent={accent}
      summary={'Bright '+pct(p.filter)+' · Curve '+spectral('curve').toFixed(2)}
      actions={reset('tone',()=>{(['curve','balance','focus','focus_center'] as const).forEach(k=>onParam(k,null,SPECTRAL_NEUTRAL[k]));})}>
      <div className="rack-knobs">
        {cell('filter',m=><Knob id={selected+'-brightness'} name="Brightness" value={p.filter} min={.02} max={1} step={.005} suffix="%"
          compact accent={accent} onChange={v=>set('filter',v)} {...m}/>)}
        {cell('curve',m=><Knob id={selected+'-curve'} name="Curve" value={spectral('curve')} min={-1} max={1} step={.01} precision={2}
          compact accent={accent} onChange={v=>set('curve',v)} {...m}/>)}
        {cell('balance',m=><Knob id={selected+'-balance'} name="Balance" value={spectral('balance')} min={0} max={1} step={.005} suffix="%"
          compact accent={accent} onChange={v=>set('balance',v)} {...m}/>)}
        {cell('focus',m=><Knob id={selected+'-focus'} name="Focus" value={spectral('focus')} min={0} max={1} step={.005} suffix="%"
          compact accent={accent} onChange={v=>set('focus',v)} {...m}/>)}
        {cell('focus_center',m=><Knob id={selected+'-focus-center'} name="Focus on" value={spectral('focus_center')} min={1} max={16} step={1} precision={0}
          compact accent={accent} onChange={v=>set('focus_center',Math.round(v))} {...m}/>)}
      </div>
    </Panel>},
    {id:'rack-envelope',node:<Panel rail id="rack-envelope" className="rack-card sound-card card-envelope sound-rack" icon={<SlidersHorizontal size={15}/>} title="Envelope" tag={TAGS.envelope} mods={linksInto('rack-envelope')}
      accent={accent}
      summary={'A '+p.attack.toFixed(2)+'s · D '+p.decay.toFixed(2)+'s · S '+pct(p.sustain)+' · R '+p.release.toFixed(2)+'s'}
      actions={reset('envelope',()=>{set('attack',.008);set('decay',.6);set('sustain',.35);set('release',.5);})}>
      <div className="rack-knobs">
        <button type="button" className="rack-mini-env" aria-label="Open the envelope editor" title="Open the envelope editor"
          onClick={()=>setEnvOpen(true)}><EnvelopeGraph p={p}/></button>
        {cell('attack',m=><Knob id={selected+'-attack'} name="Attack" value={p.attack}
          min={.001} max={3} step={.001} suffix="s" compact accent={accent} onChange={v=>set('attack',v)} {...m}/>)}
        {cell('decay',m=><Knob id={selected+'-decay'} name="Decay" value={p.decay}
          min={.001} max={3} step={.001} suffix="s" compact accent={accent} onChange={v=>set('decay',v)} {...m}/>)}
        {cell('sustain',m=><Knob id={selected+'-sustain'} name="Sustain" value={p.sustain}
          min={0} max={1} step={.005} suffix="%" compact accent={accent} onChange={v=>set('sustain',v)} {...m}/>)}
        {cell('release',m=><Knob id={selected+'-release'} name="Release" value={p.release}
          min={.01} max={3} step={.005} suffix="s" compact accent={accent} onChange={v=>set('release',v)} {...m}/>)}
      </div>
    </Panel>},
    {id:'motion-synth',node:<Panel rail id="motion-synth" className="rack-card sound-card card-movement" icon={<Waves size={15}/>} title="Movement" accent={accent} tag={TAGS.movement} mods={linksInto('motion-synth')}
      summary={pct(p.modulation)} actions={reset('movement',()=>set('modulation',.08))}>
      <div className="rack-knobs" title="Vibrato and tremolo. The mod wheel adds to it.">
        {cell('modulation',m=><Knob id={selected+'-tone-motion'} name="Amount" value={p.modulation}
          min={0} max={1} step={.005} suffix="%" compact accent={accent} onChange={v=>set('modulation',v)} {...m}/>)}
      </div>
    </Panel>},
    {id:'rack-output',node:<Panel rail id="rack-output" className="rack-card sound-card card-output" icon={<Volume2 size={15}/>} title="Output" accent={accent} tag={TAGS.output} mods={linksInto('rack-output')}
      power={{on:!track.mute,label:'track output',onToggle:()=>onTrack('mute',!track.mute)}}
      summary={(track.mute?'Muted · ':'')+pct(track.volume)}>
      <div className="rack-knobs">
        {cell('volume',m=><Knob id={selected+'-volume'} name="Volume" value={track.volume}
          min={0} max={1} step={.005} suffix="%" compact accent={accent}
          onChange={v=>onTrack('volume',v)} {...m}/>)}
        <button type="button" className={'panel-toggle'+(track.mute?' on':'')} aria-pressed={track.mute}
          onClick={()=>onTrack('mute',!track.mute)}>{track.mute?'Muted':'Mute'}</button>
      </div>
    </Panel>},
    {id:'sound-filter',node:<Panel rail id="sound-filter" className="rack-card sound-card card-filter" icon={<AudioWaveform size={15}/>} title="Filter" accent={accent} tag={TAGS.filter} mods={linksInto('sound-filter')}
      power={{on:ftype>0,label:'filter',onToggle:()=>set('vcf_type',ftype?0:lastType.current)}}
      summary={ftype?FILTER_TYPES[ftype-1]+' · '+fmtHz(vp('vcf_cutoff'))+' · Res '+pct(vp('vcf_reso')):'Off'}
      actions={reset('filter',()=>resetVoice(['vcf_cutoff','vcf_reso','vcf_env']))}>
      <div className={'rack-knobs'+(ftype?'':' is-off')} title="A filter on every note. Env amount opens it with the envelope.">
        <Choice label="Type" name="Filter type" value={ftype} onPick={v=>set('vcf_type',v)}
          options={FILTER_TYPES.map((l,i)=>({label:l,value:i+1,aria:FILTER_NAMES[i+1]}))}/>
        {cell('vcf_cutoff',m=><Knob id={selected+'-vcf-cutoff'} name="Cutoff" value={vp('vcf_cutoff')} min={0} max={1} step={.002}
          format={fmtHz} compact accent={accent} onChange={v=>set('vcf_cutoff',v)} {...m}/>)}
        {cell('vcf_reso',m=><Knob id={selected+'-vcf-reso'} name="Resonance" value={vp('vcf_reso')} min={0} max={1} step={.005} suffix="%"
          compact accent={accent} onChange={v=>set('vcf_reso',v)} {...m}/>)}
        {cell('vcf_env',m=><Knob id={selected+'-vcf-env'} name="Env amount" value={vp('vcf_env')} min={-1} max={1} step={.005}
          format={fmtOct} compact accent={accent} onChange={v=>set('vcf_env',v)} {...m}/>)}
      </div>
    </Panel>},
    {id:'sound-unison',node:<Panel rail id="sound-unison" className="rack-card sound-card card-unison" icon={<Layers size={15}/>} title="Unison" accent={accent} tag={TAGS.unison} mods={linksInto('sound-unison')}
      summary={vp('uni_voices')===1?'1 voice':vp('uni_voices')+' voices · '+fmtCents(vp('uni_detune'))}
      actions={reset('unison',()=>resetVoice(['uni_voices','uni_detune']))}>
      <div className="rack-knobs" title="Stacks detuned copies of each note for a wider, thicker sound.">
        <Choice label="Voices" name="Unison voices" value={vp('uni_voices')} onPick={v=>set('uni_voices',v)}
          options={UNISON_VOICES.map(n=>({label:String(n),value:n,aria:n+(n===1?' voice':' voices')}))}/>
        {cell('uni_detune',m=><Knob id={selected+'-uni-detune'} name="Detune" value={vp('uni_detune')} min={0} max={1} step={.005}
          format={fmtCents} compact accent={accent} onChange={v=>set('uni_detune',v)} {...m}/>)}
      </div>
    </Panel>},
    {id:'sound-character',node:<Panel rail id="sound-character" className="rack-card sound-card card-character" icon={<Mic2 size={15}/>} title="Character" accent={accent} tag={TAGS.character} mods={linksInto('sound-character')}
      summary={'Vowel '+fmtVowel(vp('vowel'))+' '+pct(vp('formant'))+' · Stretch '+pct(vp('inharm'))+' · Sub '+pct(vp('sub'))}
      actions={reset('character',()=>resetVoice(['formant','vowel','inharm','sub','sub_oct']))}>
      <div className="rack-knobs">
        <Choice label="Vowel" name="Vowel" value={Math.round(vp('vowel'))} onPick={v=>{set('vowel',v);if(!vp('formant'))set('formant',.7);}}
          options={VOWELS.map((l,i)=>({label:l,value:i,aria:'Vowel '+l}))}/>
        {cell('formant',m=><Knob id={selected+'-formant'} name="Formant" value={vp('formant')} min={0} max={1} step={.005} suffix="%"
          compact accent={accent} onChange={v=>set('formant',v)} {...m}/>)}
        {cell('inharm',m=><Knob id={selected+'-inharm'} name="Stretch" value={vp('inharm')} min={0} max={1} step={.005} suffix="%"
          description="Inharmonicity: pulls the partials apart like a bell or a piano string."
          compact accent={accent} onChange={v=>set('inharm',v)} {...m}/>)}
        {cell('sub',m=><Knob id={selected+'-sub'} name="Sub" value={vp('sub')} min={0} max={1} step={.005} suffix="%"
          compact accent={accent} onChange={v=>set('sub',v)} {...m}/>)}
        <Choice label="Sub octave" name="Sub octave" value={vp('sub_oct')} onPick={v=>set('sub_oct',v)}
          options={[{label:'−1',value:1,aria:'One octave down'},{label:'−2',value:2,aria:'Two octaves down'}]}/>
      </div>
    </Panel>}].map(({id,node})=><Fragment key={id}>{node}</Fragment>)}
    {envOpen?<EnvSheet env={p} color="#f2c46d" accent={accent} track={selected} live={live?.sound as never}
      container={rack.current?.closest('.frame')??null} onChange={(k,v)=>set(k,v)} onClose={()=>setEnvOpen(false)}/>:null}
    {ring.bubble}
  </div>;
}
