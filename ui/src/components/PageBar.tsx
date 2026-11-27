import {useContextTarget,useContextNavigation} from './ContextWheel';
import { Fragment, useRef, type ReactNode } from 'react';
import { useFrame } from '../frame-clock';
import { CircleDot, Disc3, Link2, Plus, Snowflake, Sparkles, Waves } from 'lucide-react';
import type { Source } from './ModParts';
import { sourceColor } from './ModParts';
import { MAX_TRACKS, MIN_TRACKS, TRACK_COLORS, type FreezeInfo, type Track } from '../types';

export type Page = 'SONG'|'SOUND'|'FX'|'LINK'|'PERFORM';
const PAGES:{id:Page,label:string,icon:ReactNode}[]=[
  {id:'SONG',label:'Song',icon:<Disc3 size={17}/>},
  {id:'SOUND',label:'Sound',icon:<Waves size={17}/>},
  {id:'FX',label:'FX',icon:<Sparkles size={17}/>},
  {id:'LINK',label:'Link',icon:<Link2 size={17}/>},
  {id:'PERFORM',label:'Perform',icon:<CircleDot size={17}/>},
];

type Props = { tracks:Track[]; selected:number; onSelect:(i:number)=>void;
  beats:number; playing:boolean; tools?:ReactNode; freeze?:FreezeInfo[];onContext?:(track:number)=>import('../context-actions').Capabilities };

/** The track's recorded notes as a thin line, with the playhead, so the song stays in view. */
function NoteLine({track,beats,playing}:{track:Track;beats:number;playing:boolean}){
  const span=Math.max(1,beats),head=useRef<SVGRectElement>(null);
  // The playhead moves on the shared frame clock: no React render per frame.
  useFrame(p=>head.current?.setAttribute('x',String((p.clipBeat%span)/span*100)));
  return <svg className="page-track-notes" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
    <rect x="0" y="2.5" width="100" height="1" fill="currentColor" opacity=".18"/>
    {track.notes.map((n,i)=><rect key={i} x={n.start/span*100} y="1" width={Math.max(.8,n.duration/span*100)} height="4" rx=".6" fill="var(--track-accent)"/>)}
    {playing?<rect ref={head} x="0" y="0" width=".9" height="6" fill="#fff"/>:null}
  </svg>;
}

/** The page tabs; they sit in the top bar with the transport. */
export function PageTabs({page,onPage}:{page:Page;onPage:(p:Page)=>void}){
  return <div className="page-tabs" role="tablist" aria-label="Workspace">
    {PAGES.map(p=><button key={p.id} type="button" role="tab" aria-selected={page===p.id}
      className={'page-tab-'+p.id.toLowerCase()+(page===p.id?' active':'')} style={{['--sec' as string]:'var(--c-'+p.id.toLowerCase()+')'}}
      onClick={()=>onPage(p.id)}>{p.icon}<span>{p.label}</span></button>)}
  </div>;
}

/** The Link box in the top bar (Sir, 16 Nov): dim until a macro or mod pad is armed on the Link page, then lit in that
 *  source's colour with its name. While it is lit, knobs tapped on any page are linked. Tapping it clears it; it cannot
 *  be lit by itself, so tapping it unlit opens the Link page where the sources are. */
export function LinkBox({armed,name,onClear,onOpen}:{armed:Source|null;name:string;onClear:()=>void;onOpen:()=>void}){
  return <button type="button" className={'link-box'+(armed?' lit':'')} aria-pressed={!!armed}
    style={armed?{['--src' as string]:sourceColor(armed)}:undefined}
    aria-label={armed?'Linking '+name+': tap to stop':'Link: arm a macro or mod pad first'}
    title={armed?'Linking '+name+'. Tap knobs on any page; tap here, blank space or Esc to stop.':'Arm a macro or mod pad on the Link page first'}
    onClick={()=>armed?onClear():onOpen()}>
    <Link2 size={18}/>{armed?<span className="link-box-who"><b>{name}</b><em>tap knobs</em></span>:<span className="link-box-label">Link</span>}
  </button>;
}

/** The second row on Sound, FX and Perform: the track you are working on, and the page's own tools on the right. */
export function PageBar({tracks,selected,onSelect,beats,playing,tools,freeze,onContext,onAdd,onRemove,chipExtra}:Props&{onAdd?:()=>void;onRemove?:(track:number)=>void;
  /** Something beside a track's chip (a Plugin track's window button). */ chipExtra?:(track:number)=>ReactNode}){
  const navigation=useContextNavigation(),context=useContextTarget(el=>{const h=el.closest<HTMLElement>('[data-track-index]');if(!h)return null;const i=Number(h.dataset.trackIndex);return {area:tracks[i].device==='drum_rack'?'drum':'sound',kind:'track.header',label:'Track '+(i+1),caps:{...navigation,focus:()=>onSelect(i),...(onContext?.(i)??{}),...(onAdd&&tracks.length<MAX_TRACKS?{addTrack:onAdd}:{}),...(onRemove&&tracks.length>MIN_TRACKS?{removeTrack:()=>onRemove(i)}:{})}};});
  return <nav {...context} className="page-bar" aria-label="Tracks">
    <div className={"page-tracks"+(tracks.length>5?" many":"")} role="group" aria-label="Track to edit">
      {tracks.map((t,i)=><Fragment key={i}><button data-track-index={i} type="button" aria-pressed={i===selected}
        aria-label={'Edit track '+(i+1)+' '+deviceName(t)}
        className={'page-track'+(i===selected?' active':'')+(t.mute?' muted':'')}
        style={{['--track-accent' as string]:TRACK_COLORS[i]}} onClick={()=>onSelect(i)}>
        <span className="page-track-no">{i+1}</span>
        <span className="page-track-text"><span className="page-track-name">{deviceName(t)}</span>
          <NoteLine track={t} beats={beats} playing={playing}/></span>
        {freeze?.[i]?.state==='frozen'?<span className="page-track-ice" title="Frozen: plays as audio"><Snowflake size={14}/></span>:null}
      </button>{chipExtra?.(i)}</Fragment>)}
      {onAdd&&tracks.length<MAX_TRACKS?<button type="button" className="page-track-add" aria-label="Add track" title={'Add a track ('+tracks.length+' of '+MAX_TRACKS+'). Right-click a track to remove it.'} onClick={onAdd}><Plus size={18}/></button>:null}
    </div>
    {tools?<div className="page-tools">{tools}</div>:null}
  </nav>;
}

/** What a track plays, in the words its page uses. */
export function deviceName(t:{device?:string;preset:string;sampler?:{name:string;source:unknown};plugin?:{name:string}}){
  return t.device==='drum_rack'?'Drum Rack':t.device==='sampler'?(t.sampler?.source?t.sampler.name:'Sampler'):t.device==='plugin'?(t.plugin?.name||'Plugin'):t.preset;
}
