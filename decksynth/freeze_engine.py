"""Engine side of frozen tracks: which tracks play their frozen audio, and reading it per block.

A track can hold two freezes (15 Nov, Sir: "Freeze that covers the whole song from any page"):
track['freeze'] is the Song timeline (or the Loop, for older projects and loop-only freezes) and
track['freeze_loop'] is the Loop next to a Song freeze. Each mode plays its own file, so a frozen
track stays frozen when you switch between Song and Loop."""
from .devices import device_kind
from .freeze import FrozenAudio, fingerprint, validate_freeze

FX_TAIL_SECONDS = 3.0
FREEZE_KEYS = ('freeze', 'freeze_loop')


def track_freezes(track):
    """{mode: meta} of everything frozen on this track."""
    out = {}
    for key in FREEZE_KEYS:
        meta = track.get(key)
        if meta is not None and meta['mode'] not in out: out[meta['mode']] = meta
    return out


class FreezeEngine:
    def init_freeze(self):
        self.freeze_render = False      # True inside an offline freeze render
        self.capture_track = None       # offline render: the track whose post-FX audio is captured
        self.captured = None
        self.frozen = [{} for _ in range(4)]     # mode -> open FrozenAudio, per track
        self.frozen_ok = [{} for _ in range(4)]  # mode -> the freeze still matches the project
        self.freeze_state = ['none']*4  # none / frozen / stale / missing (the whole track)
        self._frozen_on = [False]*4
        self.freeze_ring = {}           # track -> file cursor of the ring-out after a song ends
        self.fx_live_until = [0]*4

    def freeze_refresh(self):
        """Match each track's freezes to the project. Cheap enough for a few times a second."""
        for tr, t in enumerate(self.project.tracks):
            metas = track_freezes(t); players = self.frozen[tr]
            for mode in list(players):
                if mode not in metas or players[mode].meta != metas[mode]:
                    players.pop(mode).close()
            ok = {}; missing = False
            for mode, meta in metas.items():
                if mode not in players:
                    try: players[mode] = FrozenAudio(meta)
                    except (OSError, ValueError): missing = True; ok[mode] = False; continue
                ok[mode] = (meta['rate'] == self.rate and meta['bpm'] == self.project.bpm
                            and fingerprint(self.project, tr, mode) == meta['fingerprint'])
            self.frozen_ok[tr] = ok
            self.freeze_state[tr] = ('none' if not metas else 'missing' if missing
                                     else 'frozen' if all(ok.values()) else 'stale')

    def frozen_active(self, tr, mode):
        return (not self.freeze_render and self.frozen_ok[tr].get(mode, False) and mode in self.frozen[tr])

    def set_freeze(self, tr, meta):
        """meta: None (play live), one freeze, or a list of freezes (Song and Loop)."""
        metas = [] if meta is None else meta if isinstance(meta, list) else [meta]
        metas = [validate_freeze(m) for m in metas]
        if len({m['mode'] for m in metas}) != len(metas): raise ValueError('One freeze per mode')
        metas.sort(key=lambda m: m['mode'] != 'song')
        self.snapshot()
        t = self.project.tracks[tr]
        for key in FREEZE_KEYS: t.pop(key, None)
        if metas: t['freeze'] = metas[0]
        if len(metas) > 1: t['freeze_loop'] = metas[1]
        self.freeze_refresh()

    def _freeze_live(self, tr, synth):
        """Is something playing live on this track right now (keys, arp, chords, SEQ)?"""
        if synth.voices: return True
        kind = device_kind(self.project.tracks[tr])
        if kind == 'sampler': return self.samplers[tr].active_count > 0
        return kind == 'drum_rack' and self.drums[tr].active_count > 0

    def _freeze_block(self, tr, start, n, looping, mode='song'):
        """The frozen audio for this block as (left, right), or None."""
        if self.playing:
            f = self.frozen[tr].get(mode)
            if f is None: return None
            left, right, _ = f.block(start, n, looping)
            return left, right
        f = self.frozen[tr].get('song') or self.frozen[tr].get('loop')
        cursor = self.freeze_ring.get(tr)
        if cursor is None or f is None: return None
        left, right, _ = f.ring(cursor, n)
        if cursor+n >= f.frames: self.freeze_ring.pop(tr, None)
        else: self.freeze_ring[tr] = cursor+n
        return left, right

    def freeze_status(self):
        out = []
        for tr, t in enumerate(self.project.tracks):
            holds = []
            for mode, meta in track_freezes(t).items():
                beats = meta['pass_frames']/meta['rate']*meta['bpm']/60
                holds.append(dict(mode=mode, bars=round(beats/4, 2), ok=bool(self.frozen_ok[tr].get(mode))))
            holds.sort(key=lambda h: h['mode'] != 'song')
            out.append(dict(state=self.freeze_state[tr], active=any(self.frozen_ok[tr].values()), holds=holds))
        return out
