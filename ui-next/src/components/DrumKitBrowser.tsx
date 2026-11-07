import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FolderOpen, RefreshCw, Search } from 'lucide-react';
import type { DrumLibraryState } from '../types';

type Props = {
  library?:DrumLibraryState;
  onLoadFolder?:(folderId:string)=>void;
  onChooseLibrary?:()=>void;
  onRefreshLibrary?:()=>void;
  onBack:()=>void;
};

/** Folder names and counts come from the native index; source WAVs stay in place. */
export function DrumKitBrowser({library,onLoadFolder,onChooseLibrary,onRefreshLibrary,onBack}:Props) {
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const folders=library?.folders??[];
  const busy=!!(library?.scanning||library?.loading);
  const chosen=folders.find(folder=>folder.id===selected);
  const matches=useMemo(()=>folders.filter(folder=>folder.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),[folders,search]);
  useEffect(()=>{if(selected!==null&&!folders.some(folder=>folder.id===selected))setSelected(null);},[folders,selected]);
  return <section className="drum-kit-browser" aria-labelledby="drum-kit-browser-title" aria-busy={busy}>
    <div className="drum-section-bar"><h2 id="drum-kit-browser-title">Kit folders</h2><button type="button" onClick={onBack}><ArrowLeft size={16}/>Back to pads</button></div>
    <div className="drum-library-root" title={library?.root??undefined}>{library?.root??'Choose your sample library to find kit folders.'}</div>
    <div className="drum-library-actions">
      <button type="button" onClick={onChooseLibrary} disabled={busy||!onChooseLibrary}><FolderOpen size={17}/>Choose sample folder</button>
      <button type="button" onClick={onRefreshLibrary} disabled={busy||!library?.root||!onRefreshLibrary}><RefreshCw size={16}/>Refresh</button>
    </div>
    <label className="drum-kit-search"><Search size={17}/><input type="search" aria-label="Search kit folders" placeholder="Search kit folders" value={search} onChange={event=>setSearch(event.target.value)} disabled={!library?.root}/></label>
    {library?.error?<p className="drum-library-error" role="alert">{library.error} <span>Choose another folder or refresh to try again.</span></p>:null}
    {library?.memory_error?<p className="drum-library-error" role="status">Startup recall could not be saved: {library.memory_error}</p>:null}
    <div className="drum-kit-list" role="group" aria-label="Sample folders">
      {library?.scanning?<p className="drum-library-empty" role="status">Scanning sample folders…</p>:matches.length?matches.map(folder=><button type="button" key={folder.id} className="drum-kit-folder" aria-pressed={folder.id===selected} disabled={busy} onClick={()=>setSelected(folder.id)}>
        <FolderOpen size={18}/><span title={folder.name}>{folder.name}</span><strong>{folder.count} WAV{folder.count===1?'':'s'}</strong>
      </button>):<p className="drum-library-empty" role="status">{!library?.root?'Your folders become kits. WAVs stay in their original location.':search.trim()?'No matching kit folders. Try another name.':'No WAV folders found. Choose another sample folder or refresh after adding WAVs.'}</p>}
    </div>
    <div className="drum-kit-selection">
      <div><strong title={chosen?.name}>{chosen?.name??'Select a folder to load a kit'}</strong><p>{library?.loading?'Loading kit… Your current kit stays available until it is ready.':chosen?(chosen.count>16?'16 sounds selected automatically from '+chosen.count+' WAVs. All source files stay in their folder.':'Load '+chosen.count+' sound'+(chosen.count===1?'':'s')+' into the 16 pads. Source WAVs stay in their folder.'):'Each folder loads up to 16 sounds together.'}</p></div>
      <button type="button" className="drum-kit-load" disabled={!chosen||busy||!onLoadFolder} onClick={()=>{if(chosen)onLoadFolder?.(chosen.id);}}>{library?.loading?'Loading…':'Load kit'}</button>
    </div>
  </section>;
}
