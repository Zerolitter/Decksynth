"""Bounded background folder preparation and user-local kit recall/persistence."""
import copy
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from .drum_library import scan_library
from .samples import SampleCache
from .drum_memory import KitMemory, read_settings, write_settings


class DrumLibraryService:
    def __init__(self, engine, directory=None):
        self.engine=engine;self.directory=Path(directory) if directory is not None else None
        self.memory=KitMemory(self.directory) if self.directory else None
        self._io=ThreadPoolExecutor(max_workers=1,thread_name_prefix='drum-folder')
        self._saver=ThreadPoolExecutor(max_workers=1,thread_name_prefix='drum-recall') if self.memory else None
        self._scan=None;self._load=None;self._index=None;self._memory_future=None;self._root_future=None
        self._preview=None;self._preview_token=0
        self._memory_pending=None;self._root_pending=None;self._closed=False
        self._state=dict(root=None,folders=[],scanning=False,loading=False,loading_track=None,
                         sample_page=None,preview=None,error=None,memory_error=None)
        remembered=None;memory_bad=False
        if self.memory:
            try:
                remembered=self.memory.read()
                self.memory.restore(engine,remembered)
            except (OSError,ValueError) as exc:
                memory_bad=True;self._state['memory_error']='Could not restore the last kit: '+str(exc)
        self._memory_seen=KitMemory.capture(engine)
        if self.memory and remembered is None and not memory_bad and any('drum_rack' in t for t in self._memory_seen['tracks']):
            self._memory_pending=self._memory_seen
        if self.directory:
            try:
                configured=read_settings(self.directory/'sample-library.json')
                if configured is not None:
                    if (not isinstance(configured,dict) or set(configured)!={'version','root'} or
                        type(configured['version']) is not int or configured['version']!=1 or not isinstance(configured['root'],str)):
                        raise ValueError('Invalid sample library settings')
                    self._state['root']=configured['root']
                    self.set_root(configured['root'])
            except (OSError,ValueError) as exc:self._state['error']='Could not open the sample library: '+str(exc)

    def snapshot(self):
        return dict(self._state)

    def sample_path(self, folder_id, sample_index):
        if self._index is None or self._scan is not None:
            raise ValueError('Wait for the sample library scan')
        return self._index.sample_path(folder_id,sample_index)

    def browse_folder(self, folder_id, page=0):
        if self._index is None or self._scan is not None:
            raise ValueError('Wait for the sample library scan')
        self.stop_preview()
        self._state['sample_page']=self._index.browse(folder_id,page)

    @staticmethod
    def _load_preview(path, rate):
        # Independent short-lived cache: auditioning hundreds of files cannot
        # permanently exhaust the playing kit's 64-MiB sample cache.
        return SampleCache(rate,16*1024*1024).load(path)

    def preview_sample(self, folder_id, sample_index):
        if self._load is not None:raise ValueError('Wait for the kit to finish loading')
        path=self.sample_path(folder_id,sample_index)
        page=self._state['sample_page']
        if not page or page['folder']!=folder_id or sample_index not in [item['index'] for item in page['items']]:
            raise ValueError('Open the sample folder before auditioning')
        self.stop_preview()
        token=self._preview_token
        future=self._io.submit(self._load_preview,path,self.engine.rate)
        self._preview=(future,token,folder_id,sample_index)
        self._state['preview']=dict(folder=folder_id,index=sample_index,loading=True,active=False)

    def stop_preview(self):
        self._preview_token+=1
        self._preview=None  # running asynchronous jobs finish without committing
        self._state['preview']=None
        self.engine.stop_sample_preview()

    def set_root(self, path):
        if self._closed:raise ValueError('Sample library is closed')
        if not isinstance(path,str) or not path or len(path)>4096 or '\0' in path:raise ValueError('Choose a sample folder')
        if self._scan is not None:raise ValueError('The sample library is scanning')
        if self._load is not None:raise ValueError('Wait for the current kit to finish loading before changing the library')
        self.stop_preview()
        self._state['sample_page']=None
        self._scan=self._io.submit(scan_library,path)
        self._state.update(scanning=True,error=None)

    def refresh(self):
        if not self._state['root']:raise ValueError('Choose a sample folder first')
        self.set_root(self._state['root'])

    def load_folder(self, track, kit_id, folder_id):
        if self._closed:raise ValueError('Sample library is closed')
        if self._index is None or self._state['scanning']:raise ValueError('Wait for the sample library scan')
        if self._load is not None:raise ValueError('A kit is already loading')
        expected=copy.deepcopy(self.engine.drum_target(track,kit_id))
        if not isinstance(folder_id,str):raise ValueError('Choose a kit folder')
        self.stop_preview()
        future=self._io.submit(self._index.prepare,folder_id,self.engine.sample_cache)
        self._load=(future,track,kit_id,self.engine.drum_epoch,expected)
        self._state.update(loading=True,loading_track=track,error=None)

    def observe(self):
        """Called after committed worker actions; identical display frames never write."""
        if not self.memory or self._closed:return
        current=self.memory.capture(self.engine)
        if current!=self._memory_seen:
            self._memory_seen=current;self._memory_pending=current
        self._flush_settings()

    def _flush_settings(self):
        if self._saver is None:return
        for attr,label in [('_memory_future','memory_error'),('_root_future','error')]:
            future=getattr(self,attr)
            if future is not None and future.done():
                setattr(self,attr,None)
                try:
                    future.result()
                    if attr=='_memory_future':self._state['memory_error']=None
                except (OSError,ValueError) as exc:self._state[label]='Could not remember settings: '+str(exc)
        if self._memory_future is None and self._memory_pending is not None:
            value=self._memory_pending;self._memory_pending=None
            self._memory_future=self._saver.submit(self.memory.write,value)
        if self._root_future is None and self._root_pending is not None:
            value=self._root_pending;self._root_pending=None
            self._root_future=self._saver.submit(write_settings,self.directory/'sample-library.json',value)

    def poll(self):
        if self._closed:return
        if self._scan is not None and self._scan.done():
            future=self._scan;self._scan=None;self._state['scanning']=False
            try:
                index=future.result();self._index=index
                self._state.update(root=index.root,folders=index.folders,error=None)
                if self.directory:self._root_pending=dict(version=1,root=index.root)
            except (OSError,ValueError) as exc:self._state['error']='Could not scan the sample folder: '+str(exc)
        if self._load is not None and self._load[0].done():
            future,tr,kit_id,epoch,expected=self._load;self._load=None
            self._state.update(loading=False,loading_track=None)
            try:
                kit,samples=future.result()
                self.engine.install_drum_kit(tr,kit_id,kit,samples,epoch=epoch,expected=expected)
                self._state['error']=None
            except (OSError,ValueError) as exc:self._state['error']='Kit was not changed: '+str(exc)
        if self._preview is not None and self._preview[0].done():
            future,token,folder_id,index=self._preview;self._preview=None
            if token==self._preview_token:
                try:
                    sample=future.result()
                    if self.sample_path(folder_id,index)!=Path(sample.path):
                        raise ValueError('The selected audio source changed during audition')
                    self.engine.play_sample_preview(sample)
                    self._state['preview']=dict(folder=folder_id,index=index,loading=False,active=True)
                    self._state['error']=None
                except (OSError,ValueError) as exc:
                    self._state['preview']=None
                    self._state['error']='Could not preview sound: '+str(exc)
        if self._state['preview'] and not self._state['preview']['loading']:
            self._state['preview']['active']=self.engine.sample_preview_active()
        self._flush_settings()

    def close(self):
        if self._closed:return
        self.stop_preview()
        self.observe()
        if self._saver:
            # At most one latest pending snapshot per file; ordering prevents an older
            # queued write winning after the final committed edit during shutdown.
            if self._memory_pending is not None:self._saver.submit(self.memory.write,self._memory_pending)
            if self._root_pending is not None:self._saver.submit(write_settings,self.directory/'sample-library.json',self._root_pending)
            self._saver.shutdown(wait=True)
        self._closed=True;self._io.shutdown(wait=False,cancel_futures=True)
