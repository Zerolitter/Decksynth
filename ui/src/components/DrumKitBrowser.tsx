import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FolderOpen, Headphones, Play, RefreshCw, Search, Replace, Volume2 } from 'lucide-react';
import type { DrumLibraryState } from '../types';
import { DRUM_KINDS, drumKind } from '../drum-kinds';

type Props = {
  library?:DrumLibraryState;
  selectedPad?:number;
  /** the kit on the pads now, marked "On the pads" */
  current?:string;
  onLoadFolder?:(folderId:string)=>void;
  onBrowseFolder?:(folderId:string,page:number)=>void;
  onPreviewSample?:(folderId:string,index:number)=>void;
  onStopPreview?:()=>void;
  onReplaceSample?:(folderId:string,index:number,pad:number)=>void;
  onChooseLibrary?:()=>void;
  onRefreshLibrary?:()=>void;
  onBack:()=>void;
};

const split=(name:string)=>{const parts=name.split('/');return {leaf:parts.pop()||name,group:parts.join('/')};};

/** Sixteen small squares, lit for each sound the kit has (up to 16): a kit's size at a glance. */
function PadGlyph({count}:{count:number}) {
  return <span className="kit-glyph" aria-hidden="true">{Array.from({length:16},(_,i)=><i key={i} className={i<count?'on':undefined}/>)}</span>;
}

/** All file selection uses the worker's indexed IDs, never a renderer-provided path.
 * Pre-listen is a transient native audio voice. A pad changes ONLY after Swap succeeds.
 * Laid out like the sound presets: group tabs, then a grid of kit cards; a kit opens its sounds to listen and swap. */
export function DrumKitBrowser({library,selectedPad=0,current,onLoadFolder,onBrowseFolder,onPreviewSample,onStopPreview,onReplaceSample,onChooseLibrary,onRefreshLibrary,onBack}:Props) {
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [showSamples,setShowSamples]=useState(false);
  const [group,setGroup]=useState('All');
  const folders=library?.folders??[];
  const busy=!!(library?.scanning||library?.loading);
  const chosen=folders.find(folder=>folder.id===selected);
  const groups=useMemo(()=>['All',...new Set(folders.map(f=>split(f.name).group).filter(Boolean))],[folders]);
  const matches=useMemo(()=>folders.filter(folder=>folder.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    &&(group==='All'||split(folder.name).group===group)),[folders,search,group]);
  const page=showSamples && library?.sample_page?.folder===selected ? library.sample_page : null;
  useEffect(()=>{if(selected!==null&&!folders.some(folder=>folder.id===selected)){setSelected(null);setShowSamples(false);}},[folders,selected]);
  useEffect(()=>{if(!groups.includes(group))setGroup('All');},[groups,group]);
  const back=()=>{onStopPreview?.();onBack();};
  const pick=(folder:string)=>{
    onStopPreview?.();setSelected(folder);setShowSamples(true);
    onBrowseFolder?.(folder,0);
  };
  const allKits=()=>{onStopPreview?.();setShowSamples(false);};
  const root=library?.root??null;
  const rootLeaf=root?root.split(/[\\/]/).filter(Boolean).pop():null;
  const padNo=String(selectedPad+1).padStart(2,'0');
  return <section className="drum-kit-browser kit-browser" aria-labelledby="drum-kit-browser-title" aria-busy={busy}>
    <div className="drum-section-bar"><h2 id="drum-kit-browser-title">{showSamples?'Kit sounds':'Kit folders'}</h2>
      <span className="kit-root" title={root??undefined}><FolderOpen size={14}/>{rootLeaf??'No sample folder yet'}</span>
      <button type="button" className="kit-icon" aria-label="Choose sample folder" title="Choose the folder your kits live in" onClick={onChooseLibrary} disabled={busy||!onChooseLibrary}><FolderOpen size={17}/></button>
      <button type="button" className="kit-icon" aria-label="Refresh" title="Look for new WAVs" onClick={onRefreshLibrary} disabled={busy||!root||!onRefreshLibrary}><RefreshCw size={16}/></button>
      <button type="button" className="kit-back" onClick={back}><ArrowLeft size={16}/>Back to pads</button></div>
    {!showSamples?
      <>
        <div className="kit-tools">
          <label className="drum-kit-search"><Search size={17}/><input type="search" aria-label="Search kit folders" placeholder="Search kits" value={search}
            onChange={event=>setSearch(event.target.value)} disabled={!root}/></label>
          {groups.length>2?<div className="kit-groups" role="tablist" aria-label="Kit groups">
            {groups.map(g=><button key={g} type="button" role="tab" aria-selected={g===group} onClick={()=>setGroup(g)}>{g==='All'?'All':split(g).leaf}</button>)}
          </div>:null}
        </div>
        <div className="drum-kit-list kit-grid" role="group" aria-label="Sample folders">
          {library?.scanning?<p className="drum-library-empty" role="status">Scanning sample folders…</p>
            :matches.length?matches.map(folder=>{const {leaf}=split(folder.name),on=!!current&&current===folder.name;
              return <button type="button" key={folder.id} className={'drum-kit-folder kit-card'+(on?' is-current':'')} aria-pressed={folder.id===selected}
                aria-label={folder.name+', '+folder.count+' WAV'+(folder.count===1?'':'s')+(on?', on the pads':'')}
                disabled={busy} onClick={()=>pick(folder.id)}>
                <PadGlyph count={folder.count}/>
                <span className="kit-card-text"><strong title={folder.name}>{leaf}</strong>
                  <small>{folder.count} sound{folder.count===1?'':'s'}</small></span>
                {on?<em className="kit-card-on">On the pads</em>:null}
              </button>;})
            :<p className="drum-library-empty" role="status">{!root?'Choose the folder your kits live in. Each folder of WAVs becomes a kit, and the files stay where they are.'
              :search.trim()?'No kit matches "'+search.trim()+'".':'No WAV folders found here. Choose another folder, or refresh after adding WAVs.'}</p>}
        </div>
      </>:
      <>
        <div className="drum-samples-heading kit-heading">
          <button type="button" className="drum-samples-back" onClick={allKits}><ArrowLeft size={16}/>All kits</button>
          <div className="kit-heading-name"><strong title={chosen?.name}>{chosen?split(chosen.name).leaf:'Kit'}</strong>
            <small>{chosen?chosen.count+' sound'+(chosen.count===1?'':'s'):''}</small></div>
        </div>
        <div className="drum-audition-hint"><Headphones size={15}/><span>Listen, then <b>Swap</b> puts a sound on pad {padNo}</span></div>
        <div className="drum-kit-list drum-sample-list" role="group" aria-label="Preview WAVs in selected kit">
          {page?.items ? page.items.map(item=>{
            const playing=library?.preview?.folder===selected && library?.preview?.index===item.index;
            const kind=drumKind(item.name,item.filename);
            return <div key={item.index} className={'drum-sample-row'+(playing?' is-preview':'')} style={{['--family' as string]:DRUM_KINDS[kind].color}}>
              <i className="kit-family" title={DRUM_KINDS[kind].label}/>
              <span className="drum-sample-name" title={item.filename}>{item.name}<small>{DRUM_KINDS[kind].label}</small></span>
              <button type="button" className="kit-listen" aria-label={'Listen to '+item.name} title={'Audition '+item.filename} disabled={busy||!onPreviewSample}
                onClick={()=>onPreviewSample?.(selected!,item.index)}>
                {playing&&library?.preview?.active?<Volume2 size={16}/>:<Play size={15}/>}<span>{playing&&library?.preview?.loading?'Loading':playing&&library?.preview?.active?'Playing':'Listen'}</span>
              </button>
              <button type="button" className="drum-sample-swap" aria-label={'Replace pad '+(selectedPad+1)+' with '+item.name}
                title={'Put this sound on pad '+(selectedPad+1)} disabled={busy||!onReplaceSample}
                onClick={()=>onReplaceSample?.(selected!,item.index,selectedPad)}><Replace size={15}/>Swap</button>
            </div>;
          }):<p className="drum-library-empty" role="status">Reading the kit…</p>}
        </div>
        {page&&page.total>page.items.length?
          <div className="drum-sample-pagination"><button type="button" disabled={page.page===0||busy}
            onClick={()=>onBrowseFolder?.(selected!,page.page-1)}>Previous</button>
            <span>{page.page*48+1}–{page.page*48+page.items.length} of {page.total}</span>
            <button type="button" disabled={(page.page+1)*48>=page.total||busy}
              onClick={()=>onBrowseFolder?.(selected!,page.page+1)}>Next</button></div>:null}
      </>}
    {library?.error?<p className="drum-library-error" role="alert">{library.error} <span>Existing pad/kit remains available.</span></p>:null}
    {library?.memory_error?<p className="drum-library-error" role="status">Kit recall could not be saved: {library.memory_error}</p>:null}
    {chosen?<div className="drum-kit-selection">
      <PadGlyph count={chosen.count}/>
      <div><strong title={chosen.name}>{split(chosen.name).leaf}</strong>
        <p>{library?.loading?'Loading kit… your kit stays on the pads until this one is ready.'
          :chosen.count>16?'More than 16 sounds: Load kit picks 16 automatically by role.'
          :'Load kit puts all '+chosen.count+' on the pads.'}</p></div>
      <button type="button" className="drum-kit-load" disabled={busy||!onLoadFolder}
        onClick={()=>onLoadFolder?.(chosen.id)}>{library?.loading?'Loading…':'Load kit'}</button>
    </div>:null}
  </section>;
}
