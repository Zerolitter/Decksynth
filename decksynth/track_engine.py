"""Add and remove tracks, 4 to 8 (Sir, 15 Nov evening: "add / remove tracks and extend tracks with max 8 tracks").

The project keeps one entry per track in tracks, song lanes, loop slots and the open loop. The engine keeps one runtime
object per track in each list named in _runtime(); sync_tracks() makes those lists match the project (called from
configure(), so Undo and opening a file follow too), and remove_track() drops the removed track's objects in place so the
tracks after it keep their voices, loaded samples and kits."""
import copy

from . import song as songs
from .devices import MAX_TRACKS, MIN_TRACKS

NEW_TRACK_PRESET = 'Warm Keys'


def _drop(gone):
    """Silence and close a removed track's runtime object (a synth, a Sampler, a dict of open frozen files, ...)."""
    for item in (gone.values() if isinstance(gone, dict) else [gone]):
        for stop in ('panic', 'close'):
            fn = getattr(item, stop, None)
            if callable(fn):
                try: fn()
                except Exception: pass


class TrackEngine:
    def _runtime(self):
        """Per-track runtime lists and how to make a fresh entry."""
        from .core import Synth, TrackFx
        from .drum_rack import DrumRack
        from .sampler import Sampler
        r = self.rate
        return {'synths': lambda: Synth(r), 'fx': lambda: TrackFx(r), '_pan_state': lambda: None,
                'drums': lambda: DrumRack(r, self.sample_cache), 'drum_gate_keys': set, 'drum_frames': lambda: [-1]*16,
                'samplers': lambda: Sampler(r, self.sample_cache),
                'frozen': dict, 'frozen_ok': dict, 'freeze_state': lambda: 'none', '_frozen_on': lambda: False,
                'fx_live_until': lambda: 0,
                'sound_history': lambda: {'A': [], 'B': []}, 'automation_values': dict}

    def sync_tracks(self):
        n = len(self.project.tracks)
        for name, make in self._runtime().items():
            items = getattr(self, name, None)
            if items is None: continue
            while len(items) < n: items.append(make())
            while len(items) > n:
                _drop(items.pop())
        if self.selected >= n: self.selected = n-1

    def new_track(self, index):
        from .core import instrument
        return dict(name=f'Track {index+1}', preset=NEW_TRACK_PRESET, instrument=instrument(NEW_TRACK_PRESET),
                    volume=.7, mute=False, notes=[])

    def _append_track(self):
        p = self.project
        p.tracks.append(self.new_track(len(p.tracks)))
        p.song['lanes'].append([])
        p.clips['slots'].append([[] for _ in range(songs.CLIPS)]); p.clips['open'].append(0)

    def keep_tracks(self, count=1):
        """A new session (launch, Start over): keep only the first count tracks (no undo step)."""
        p = self.project
        del p.tracks[count:]; del p.song['lanes'][count:]
        del p.clips['slots'][count:]; del p.clips['open'][count:]
        self.sync_tracks(); self.selected = min(self.selected, len(p.tracks)-1)
        self.configure()

    def grow_tracks(self, count):
        """Startup: as many tracks as last time (no undo step); configure() follows."""
        while len(self.project.tracks) < min(count, MAX_TRACKS): self._append_track()
        self.sync_tracks()

    def add_track(self):
        """One more synth track at the end (one undo step); it becomes the selected track."""
        p = self.project; n = len(p.tracks)
        if n >= MAX_TRACKS: raise ValueError(f'{MAX_TRACKS} tracks is the most')
        self.snapshot(); self._append_track()
        self.sync_tracks()
        self.synths[n].configure(p.tracks[n]['instrument']); self.fx[n].configure(p.tracks[n].get('fx'))
        self.select(n)
        return n

    def remove_track(self, track):
        """Remove a track and everything on it (one undo step). The tracks after it move up one."""
        p = self.project; n = len(p.tracks)
        if type(track) is not int or not 0 <= track < n: raise ValueError(f'Choose track 1–{n}')
        if n <= MIN_TRACKS: raise ValueError(f'Keep at least {MIN_TRACKS} tracks')
        tasks = getattr(self, 'sampler_tasks', None)
        if tasks is not None and tasks.jobs: raise ValueError('Wait until the sample work finishes')
        rec, target = getattr(self, 'recorder', None), getattr(self, 'record_target', None)
        if rec is not None and target is not None and rec.state != 'idle':
            if target[0] == track: rec.cancel()                       # a take on the removed track goes with it
            elif rec.state == 'saving': raise ValueError('Wait until the take is saved')
        if target is not None and target[0] > track: self.record_target = (target[0]-1,) + tuple(target[1:])
        self.stop(); self.snapshot()
        for name in self._runtime():
            items = getattr(self, name, None)
            if items is not None and len(items) == n:
                _drop(items.pop(track))
        del p.tracks[track]; del p.song['lanes'][track]
        del p.clips['slots'][track]; del p.clips['open'][track]
        if self.selected > track or self.selected >= len(p.tracks): self.selected = max(0, self.selected-1)
        self.configure()
