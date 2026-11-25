/* The sample library (Sampler editing stage 11). Browse it like the sound presets: categories along the top, a card per
   sample with its level outline; tap a card to load it into this Sampler (Undo brings the old one back), ▶ to hear it first.
   Save to library writes the whole sample, its trim or a slice into the save folder. Sir picks the save folder and the
   folders the library browses; both are remembered across launches. */
import { useEffect, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, FolderOpen, FolderPlus, Play, RefreshCw, Save, Square, X } from 'lucide-react';
import type { SamplerSpec } from '../types';

export type LibraryItem = { name: string; category: string; path: string; bytes: number; peaks: number[] | null };
export type SampleLibraryState = {
  save: string | null; load: string[]; scanning: boolean; revision: number; error: string | null; preview: string | null;
  categories: { name: string; count: number }[];
  page: { category: string; page: number; pages: number; total: number; items: LibraryItem[] } | null;
};
type What = 'whole' | 'trim' | 'slice';

function Outline({ peaks }: { peaks: number[] | null }) {
  if (!peaks?.length) return <svg className="preset-bars lib-bars empty" viewBox="0 0 96 20" aria-hidden="true"><path d="M0 10H96" /></svg>;
  const w = 96 / peaks.length;
  return <svg className="preset-bars lib-bars" viewBox="0 0 96 20" preserveAspectRatio="none" aria-hidden="true">
    {peaks.map((v, i) => <rect key={i} x={i * w + .4} y={10 - Math.max(.5, v * 10)} width={Math.max(.6, w - .8)} height={Math.max(1, v * 20)} />)}
  </svg>;
}

const short = (path: string | null) => !path ? 'not set' : path.replace(/^\/home\/[^/]+/, '~');

/** Choosing a WAV for something else than a Sampler (the synth's Sample layer, 25 Nov): a tap on a card hands back its path,
 *  the factory sounds come first, and there is no Save row. */
export type LibraryPick = { current: string | null; factory: { name: string; path: string }[]; onPick(path: string): void };
const NO_SPEC = { name: 'Sample', start: 0, end: 1, source: null } as unknown as SamplerSpec;

export function SampleLibrarySheet({ library, spec = NO_SPEC, track = 0, selectedSlice = -1, defaultCategory = 'Samples', pick, onClose, onChooseFolder, send }: {
  library?: SampleLibraryState | null; spec?: SamplerSpec; track?: number; selectedSlice?: number; defaultCategory?: string; pick?: LibraryPick;
  onClose(): void; onChooseFolder(): Promise<string | null>; send(cmd: string, args: unknown): void;
}) {
  const [category, setCategory] = useState(library?.page?.category ?? '');
  const [what, setWhat] = useState<What>(selectedSlice >= 0 ? 'slice' : spec.start > 0 || spec.end < 1 ? 'trim' : 'whole');
  const [name, setName] = useState(spec.name || 'Sample');
  const [folder, setFolder] = useState(defaultCategory);
  useEffect(() => { send('sample_library_browse', [category, 0]); }, [category]);
  useEffect(() => () => send('sample_library_stop', null), []);
  useEffect(() => { setName(spec.name + (what === 'slice' && selectedSlice >= 0 ? ' slice ' + (selectedSlice + 1) : what === 'trim' ? ' trim' : '')); }, [what, selectedSlice, spec.name]);
  const page = library?.page && library.page.category === category ? library.page : null;
  const save = () => send('sample_save', [track, spec.id, what, what === 'slice' ? selectedSlice : null, name, folder]);
  const choose = async (role: 'save' | 'add') => { const dir = await onChooseFolder(); if (dir) send('sample_library_folder', [role, dir]); };
  return <div className="smp-sheet-screen" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={'smp-sheet smp-library' + (pick ? ' pick' : '')} role="dialog" aria-label="Sample library">
      <header><BookOpen size={20} /><h2>Sample library</h2>
        <span className="lib-count">{library?.scanning ? 'Looking for samples…' : (library?.categories.reduce((n, c) => n + c.count, 0) ?? 0) + ' samples'}</span>
        <button type="button" className="lib-icon" aria-label="Look again" title="Look for new samples in the library folders" onClick={() => send('sample_library_scan', null)}><RefreshCw size={16} /></button>
        <button type="button" className="smp-done" aria-label="Close sample library" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="preset-cats lib-cats" role="tablist" aria-label="Sample categories">
        <button type="button" role="tab" aria-selected={category === ''} className={category === '' ? 'active' : ''} onClick={() => setCategory('')}>All</button>
        {(library?.categories ?? []).map(c => <button key={c.name} type="button" role="tab" aria-selected={c.name === category}
          className={c.name === category ? 'active' : ''} onClick={() => setCategory(c.name)}>{c.name}<small>{c.count}</small></button>)}
      </div>
      {pick ? <div className="lib-factory" role="group" aria-label="Factory sounds"><b>Factory</b>
        {pick.factory.map(f => <button key={f.path} type="button" aria-pressed={pick.current === f.path} onClick={() => pick.onPick(f.path)}>{f.name}</button>)}</div> : null}
      <div className="preset-grid lib-grid" aria-label="Samples">
        {page?.items.map(item => {
          const playing = library?.preview === item.path;
          return <div key={item.path} className={'preset-card lib-card' + ((pick ? pick.current : spec.source?.path) === item.path ? ' selected' : '')}>
            <button type="button" className="lib-load" aria-label={(pick ? 'Choose sample ' : 'Load sample ') + item.name} title={(pick ? 'Use as the Sample layer · ' : 'Load into this Sampler · ') + short(item.path)}
              onClick={() => pick ? pick.onPick(item.path) : send('sample_library_load', [track, spec.id, item.path])}>
              <Outline peaks={item.peaks} /><strong>{item.name}</strong><span className="preset-tags">{item.category}</span>
            </button>
            <button type="button" className="lib-play" aria-label={(playing ? 'Stop ' : 'Hear ') + item.name} aria-pressed={playing}
              onClick={() => send(playing ? 'sample_library_stop' : 'sample_library_preview', playing ? null : item.path)}>{playing ? <Square size={13} /> : <Play size={13} />}</button>
          </div>;
        })}
        {page && !page.items.length ? <p className="lib-empty">{library?.scanning ? 'Looking…' : (pick ? 'No samples here yet. Add a folder that has WAV files, or use a factory sound.' : 'No samples here yet. Save one below, or add a folder that has WAV files.')}</p> : null}
      </div>
      {page && page.pages > 1 ? <div className="lib-pages">
        <button type="button" aria-label="Previous page" disabled={page.page === 0} onClick={() => send('sample_library_browse', [category, page.page - 1])}><ChevronLeft size={16} /></button>
        <span>{page.page + 1} / {page.pages}</span>
        <button type="button" aria-label="Next page" disabled={page.page >= page.pages - 1} onClick={() => send('sample_library_browse', [category, page.page + 1])}><ChevronRight size={16} /></button>
      </div> : null}
      {!pick && spec.source ? <section className="lib-save" aria-label="Save to library">
        <div className="smp-seg" role="radiogroup" aria-label="What to save">
          <button type="button" role="radio" aria-checked={what === 'whole'} onClick={() => setWhat('whole')}>Whole sample</button>
          <button type="button" role="radio" aria-checked={what === 'trim'} onClick={() => setWhat('trim')}>Trim</button>
          <button type="button" role="radio" aria-checked={what === 'slice'} disabled={selectedSlice < 0} title={selectedSlice < 0 ? 'Choose a slice in Chop first' : ''}
            onClick={() => setWhat('slice')}>{selectedSlice >= 0 ? 'Slice ' + (selectedSlice + 1) : 'Slice'}</button>
        </div>
        <label>Name<input value={name} maxLength={80} onChange={e => setName(e.target.value)} onKeyDown={e => e.stopPropagation()} /></label>
        <label>Category<input value={folder} maxLength={40} list="lib-category-list" onChange={e => setFolder(e.target.value)} onKeyDown={e => e.stopPropagation()} /></label>
        <datalist id="lib-category-list">{(library?.categories ?? []).map(c => <option key={c.name} value={c.name} />)}</datalist>
        <button type="button" className="smp-send lib-save-button" disabled={!name.trim()} onClick={save}><Save size={16} />Save to library</button>
      </section> : null}
      <section className="lib-folders" aria-label="Library folders">
        <div><b>Saves to</b><span title={library?.save ?? ''}>{short(library?.save ?? null)}</span>
          <button type="button" onClick={() => choose('save')}><FolderOpen size={14} />Change</button></div>
        <div><b>Browses</b>{(library?.load ?? []).map(f => <span key={f} className="lib-folder" title={f}>{short(f)}
          <button type="button" aria-label={'Stop browsing ' + f} onClick={() => send('sample_library_folder', ['remove', f])}><X size={12} /></button></span>)}
          <button type="button" onClick={() => choose('add')}><FolderPlus size={14} />Add folder</button></div>
        {library?.error ? <p className="lib-error">{library.error}</p> : null}
      </section>
    </div>
  </div>;
}
