import type { ReactNode } from 'react';
import { CircleDot, Disc3, Sparkles, Waves } from 'lucide-react';
import { TRACK_COLORS, type Track } from '../types';

export type Page = 'SONG'|'SOUND'|'FX'|'PERFORM';
const PAGES:{id:Page,label:string,icon:ReactNode}[]=[
  {id:'SONG',label:'Song',icon:<Disc3 size={17}/>},
  {id:'SOUND',label:'Sound',icon:<Waves size={17}/>},
  {id:'FX',label:'FX',icon:<Sparkles size={17}/>},
  {id:'PERFORM',label:'Perform',icon:<CircleDot size={17}/>},
];

type Props = { tracks:Track[]; selected:number; onSelect:(i:number)=>void;
  beat:number; beats:number; playing:boolean; tools?:ReactNode };

/** The track's recorded notes as a thin line, with the playhead, so the song stays in view. */
function NoteLine({track,beats,beat,playing}:{track:Track;beats:number;beat:number;playing:boolean}){
  const span=Math.max(1,beats);
  return <svg className="page-track-notes" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
    <rect x="0" y="2.5" width="100" height="1" fill="currentColor" opacity=".18"/>
    {track.notes.map((n,i)=><rect key={i} x={n.start/span*100} y="1" width={Math.max(.8,n.duration/span*100)} height="4" rx=".6" fill="var(--track-accent)"/>)}
    {playing?<rect x={(beat%span)/span*100} y="0" width=".9" height="6" fill="#fff"/>:null}
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

/** The second row on Sound, FX and Perform: the track you are working on, and the page's own tools on the right. */
export function PageBar({tracks,selected,onSelect,beat,beats,playing,tools}:Props){
  return <nav className="page-bar" aria-label="Tracks">
    <div className="page-tracks" role="group" aria-label="Track to edit">
      {tracks.map((t,i)=><button key={i} type="button" aria-pressed={i===selected}
        aria-label={'Edit track '+(i+1)+' '+(t.device==='drum_rack'?'Drum Rack':t.preset)}
        className={'page-track'+(i===selected?' active':'')+(t.mute?' muted':'')}
        style={{['--track-accent' as string]:TRACK_COLORS[i]}} onClick={()=>onSelect(i)}>
        <span className="page-track-no">{i+1}</span>
        <span className="page-track-text"><span className="page-track-name">{t.device==='drum_rack'?'Drum Rack':t.preset}</span>
          <NoteLine track={t} beats={beats} beat={beat} playing={playing}/></span>
      </button>)}
    </div>
    {tools?<div className="page-tools">{tools}</div>:null}
  </nav>;
}
