import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FolderOpen, Headphones, Play, RefreshCw, Search, Replace } from 'lucide-react';
import type { DrumLibraryState } from '../types';

type Props = {
  library?:DrumLibraryState;
  selectedPad?:number;
  onLoadFolder?:(folderId:string)=>void;
  onBrowseFolder?:(folderId:string,page:number)=>void;
  onPreviewSample?:(folderId:string,index:number)=>void;
  onStopPreview?:()=>void;
  onReplaceSample?:(folderId:string,index:number,pad:number)=>void;
  onChooseLibrary?:()=>void;
  onRefreshLibrary?:()=>void;
  onBack:()=>void;
};

/** All file selection uses the worker's indexed IDs, never a renderer-provided path.
 * Pre-listen is a transient native audio voice. A pad changes ONLY after Swap succeeds. */
export function DrumKitBrowser({library,selectedPad=0,onLoadFolder,onBrowseFolder,onPreviewSample,onStopPreview,onReplaceSample,onChooseLibrary,onRefreshLibrary,onBack}:Props) {
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [showSamples,setShowSamples]=useState(false);
  const folders=library?.folders??[];
  const busy=!!(library?.scanning||library?.loading);
  const chosen=folders.find(folder=>folder.id===selected);
  const matches=useMemo(()=>folders.filter(folder=>folder.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),[folders,search]);
  const page=showSamples && library?.sample_page?.folder===selected ? library.sample_page : null;
  useEffect(()=>{if(selected!==null&&!folders.some(folder=>folder.id===selected)){setSelected(null);setShowSamples(false);}},[folders,selected]);
  const back=()=>{onStopPreview?.();onBack();};
  const pick=(folder:string)=>{
    onStopPreview?.();setSelected(folder);setShowSamples(true);
    onBrowseFolder?.(folder,0);
  };
  const allKits=()=>{onStopPreview?.();setShowSamples(false);};
  return <section className="drum-kit-browser" aria-labelledby="drum-kit-browser-title" aria-busy={busy}>
    <div className="drum-section-bar"><h2 id="drum-kit-browser-title">{showSamples?'Kit sounds':'Kit folders'}</h2>
      <button type="button" onClick={back}><ArrowLeft size={16}/>Back to pads</button></div>
    <div className="drum-library-root" title={library?.root??undefined}>{library?.root??'Choose your sample library to find kit folders.'}</div>
    <div className="drum-library-actions">
      <button type="button" onClick={onChooseLibrary} disabled={busy||!onChooseLibrary}><FolderOpen size={17}/>Choose sample folder</button>
      <button type="button" onClick={onRefreshLibrary} disabled={busy||!library?.root||!onRefreshLibrary}><RefreshCw size={16}/>Refresh</button>
    </div>
    {!showSamples?
      <>
        <label className="drum-kit-search"><Search size={17}/><input type="search" aria-label="Search kit folders" placeholder="Search kit folders" value={search}
          onChange={event=>setSearch(event.target.value)} disabled={!library?.root}/></label>
        <div className="drum-kit-list" role="group" aria-label="Sample folders">
          {library?.scanning?<p className="drum-library-empty" role="status">Scanning sample folders…</p>
            :matches.length?matches.map(folder=><button type="button" key={folder.id} className="drum-kit-folder" aria-pressed={folder.id===selected}
              disabled={busy} onClick={()=>pick(folder.id)}>
              <FolderOpen size={18}/><span title={folder.name}>{folder.name}</span><strong>{folder.count} WAV{folder.count===1?'':'s'}</strong>
            </button>)
            :<p className="drum-library-empty" role="status">{!library?.root?'Your folders become kits. WAVs stay in their original location.'
              :search.trim()?'No matching kit folders. Try another name.':'No WAV folders found. Choose another sample folder or refresh after adding WAVs.'}</p>}
        </div>
      </>:
      <>
        <div className="drum-samples-heading">
          <button type="button" className="drum-samples-back" onClick={allKits}><ArrowLeft size={16}/>All kits</button>
          <strong title={chosen?.name}>{chosen?.name??'Kit'}</strong>
        </div>
        <div className="drum-audition-hint"><Headphones size={16}/><span>Listen before swapping · Target pad {String(selectedPad+1).padStart(2,'0')}</span></div>
        <div className="drum-kit-list drum-sample-list" role="group" aria-label="Preview WAVs in selected kit">
          {page?.items ? page.items.map(item=>{
            const current=library?.preview?.folder===selected && library?.preview?.index===item.index;
            return <div key={item.index} className={'drum-sample-row'+(current?' is-preview':'')}>
              <span className="drum-sample-name" title={item.filename}>{item.name}</span>
              <button type="button" aria-label={'Listen to '+item.name} title={'Audition '+item.filename} disabled={busy||!onPreviewSample}
                onClick={()=>onPreviewSample?.(selected!,item.index)}>
                <Play size={15}/><span>{current&&library?.preview?.loading?'Loading':current&&library?.preview?.active?'Playing':'Listen'}</span>
              </button>
              <button type="button" className="drum-sample-swap" aria-label={'Replace pad '+(selectedPad+1)+' with '+item.name}
                title={'Replace pad '+(selectedPad+1)+' after preview'} disabled={busy||!onReplaceSample}
                onClick={()=>onReplaceSample?.(selected!,item.index,selectedPad)}><Replace size={16}/>Swap</button>
            </div>;
          }):<p className="drum-library-empty" role="status">Preparing sample names…</p>}
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
    <div className="drum-kit-selection">
      <div><strong title={chosen?.name}>{chosen?.name??'Choose a kit'}</strong>
        <p>{library?.loading?'Loading kit… Your previous kit stays available until it is ready.'
          :chosen?(chosen.count>16?'Load the first sixteen role-matched sounds as a kit, or listen and swap one.':'Play samples individually, swap into the selected pad, or load the whole kit.')
          :'Tap a folder to hear individual sounds before loading.'}</p></div>
      <button type="button" className="drum-kit-load" disabled={!chosen||busy||!onLoadFolder}
        onClick={()=>{if(chosen)onLoadFolder?.(chosen.id);}}>{library?.loading?'Loading…':'Load kit'}</button>
    </div>
  </section>;
}
