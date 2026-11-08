"""Bounded background WAV preparation. Only poll() commits on the worker thread."""
from concurrent.futures import ThreadPoolExecutor
import threading
from .devices import device_kind


class DrumLoader:
    def __init__(self, engine):
        self.engine = engine
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='drum-sample')
        self.capacity = threading.BoundedSemaphore(64)
        self.jobs = {}; self.epoch = engine.drum_epoch
        self._restore_needed = True

    def _submit(self, tr, kit_id, pad, path, sha, restore, source, name=None):
        if (tr, pad) in self.jobs: raise ValueError('This pad already has a sample loading')
        if not self.capacity.acquire(blocking=False): raise ValueError('Sample loader is busy; try again shortly')
        epoch = self.engine.drum_epoch
        try: future = self.executor.submit(self.engine.sample_cache.load, path, sha)
        except Exception:
            self.capacity.release(); raise
        future.add_done_callback(lambda _: self.capacity.release())
        self.jobs[tr, pad] = (future, kit_id, epoch, restore, source, name)
        self.engine.drums[tr].loading[pad] = True
        self.engine.drums[tr].errors[pad] = None

    def request(self, tr, kit_id, pad, path, expected_sha=None, name=None):
        self._sync_epoch()
        self.engine.drum_target(tr, kit_id, pad)
        self._submit(tr, kit_id, pad, path, expected_sha, False, None, name)

    def _sync_epoch(self):
        if self.epoch != self.engine.drum_epoch:
            # Already-running jobs finish privately; their stale results have no commit path.
            self.jobs.clear(); self.epoch = self.engine.drum_epoch; self._restore_needed = True
            for rack in self.engine.drums: rack.loading[:] = [False]*16

    def poll(self):
        self._sync_epoch()
        if self._restore_needed:
            self._restore_needed = False
            for tr, t in enumerate(self.engine.project.tracks):
                if device_kind(t) != 'drum_rack': continue
                kit = t['drum_rack']
                for pad, p in enumerate(kit['pads']):
                    source = p['source']
                    if source is not None and (tr, pad) not in self.jobs:
                        try: self._submit(tr, kit['id'], pad, source['path'], source['sha256'], True, source)
                        except ValueError as exc: self.engine.drums[tr].missing(pad, exc)
        errors = []
        for (tr, pad), (future, kit_id, epoch, restore, source, name) in list(self.jobs.items()):
            if not future.done(): continue
            del self.jobs[tr, pad]
            if epoch != self.engine.drum_epoch: continue
            try:
                self.engine.commit_drum_sample(tr, kit_id, pad, future.result(), epoch, restore, source, name)
            except (OSError, ValueError) as exc:
                if restore: self.engine.drums[tr].missing(pad, exc)
                else:
                    self.engine.drums[tr].loading[pad] = False
                    self.engine.drums[tr].errors[pad] = str(exc)
                errors.append(str(exc))
        return errors

    def close(self):
        self.jobs.clear()
        self.executor.shutdown(wait=False, cancel_futures=True)
