"""Drum device integration, separate from the existing synth/performance model."""
import copy
from pathlib import Path
from .devices import DEVICE_REGISTRY, device_kind, track_index
from .drum_rack import DrumRack, new_kit, validate_kit
from .samples import SampleCache


class DrumEngine:
    def init_drums(self):
        # Legacy timing fixtures may use a sub-audio clock. Samples require a supported output rate.
        self.sample_cache = SampleCache(self.rate) if 8000 <= self.rate <= 192000 else None
        self.drums = [DrumRack(self.rate, self.sample_cache) for _ in range(4)]
        self.drum_epoch = 0
        self.drum_keys = {}
        self.drum_frames = [[-1]*16 for _ in range(4)]
        self._event_frame = None

    def configure_drums(self):
        self.drum_epoch += 1
        self.drum_keys.clear()
        for tr, t in enumerate(self.project.tracks):
            self.drums[tr].configure(t.get('drum_rack') if device_kind(t) == 'drum_rack' else None)

    def set_device(self, track, kind):
        tr = track_index(track)
        if not isinstance(kind, str) or kind not in DEVICE_REGISTRY: raise ValueError('Unknown track device')
        if kind == 'drum_rack' and self.sample_cache is None: raise ValueError('Drum Rack requires an audio rate of 8000–192000 Hz')
        t = self.project.tracks[tr]
        if device_kind(t) == kind: return
        kit = validate_kit(t['drum_rack']) if 'drum_rack' in t else new_kit()
        self.snapshot()
        for key, (_, _, owner) in list(self.pending.items()):
            if owner == tr: self.close_note(key)
        self.synths[tr].panic(); self.drums[tr].panic()
        self.scheduled_live = [event for event in self.scheduled_live if event[1] != tr]
        self.drum_keys = {key: owner for key, owner in self.drum_keys.items() if owner != tr}
        if tr == self.selected:
            self.perform_held.reset(); self.live_note_map.clear(); self.down.clear()
        t['device'] = kind
        if kind == 'drum_rack': t['drum_rack'] = kit
        self.drum_epoch += 1
        self.drums[tr].configure(t.get('drum_rack') if kind == 'drum_rack' else None)

    def drum_target(self, track, kit_id, pad=None):
        tr = track_index(track); t = self.project.tracks[tr]
        if device_kind(t) != 'drum_rack' or t.get('drum_rack', {}).get('id') != kit_id:
            raise ValueError('Drum Rack changed; select the current device')
        if pad is not None and (type(pad) is not int or not 0 <= pad < 16):
            raise ValueError('Choose pad 1–16')
        return t['drum_rack']

    def edit_drum_pad(self, track, kit_id, pad, key, value):
        kit = self.drum_target(track, kit_id, pad)
        if key not in ('gain', 'velocity', 'tune', 'mute', 'solo', 'choke', 'name'):
            raise ValueError('Unknown drum pad parameter')
        candidate = copy.deepcopy(kit); candidate['pads'][pad][key] = value
        clean = validate_kit(candidate)
        if clean == kit: return
        self.snapshot(); self.project.tracks[track]['drum_rack'] = clean
        self.drums[track].configure(clean)

    def commit_drum_sample(self, track, kit_id, pad, sample, epoch=None, restore=False, source=None):
        kit = self.drum_target(track, kit_id, pad)
        if epoch is not None and epoch != self.drum_epoch: return False
        if restore:
            current = kit['pads'][pad]['source']
            if current is None or current != source: return False
            actual = sample.source
            if any(current[k] != actual[k] for k in ('sha256', 'source_rate', 'channels', 'frames', 'bits')):
                raise ValueError('Sample metadata does not match the saved source')
            self.drums[track].bind(pad, sample)
            return True
        candidate = copy.deepcopy(kit)
        candidate['pads'][pad]['source'] = sample.source
        # Source filenames are user content; keep the deliberately named pad.
        clean = validate_kit(candidate)
        if clean != kit:
            self.snapshot(); self.project.tracks[track]['drum_rack'] = clean
            self.drums[track].configure(clean)
        self.drums[track].bind(pad, sample)
        return True

    def import_drum_sample(self, track, kit_id, pad, path, expected_sha=None):
        """Offline/synchronous entry point. The live worker runs load in its loader thread."""
        self.drum_target(track, kit_id, pad)
        sample = self.sample_cache.load(path, expected_sha)
        self.commit_drum_sample(track, kit_id, pad, sample)

    def load_drum_sources(self):
        """Offline rehydration. The live worker uses asynchronous source jobs instead."""
        for tr, t in enumerate(self.project.tracks):
            if device_kind(t) != 'drum_rack': continue
            kit = t['drum_rack']
            for i, p in enumerate(kit['pads']):
                source = p['source']
                if source is None: continue
                try:
                    sample = self.sample_cache.load(source['path'], source['sha256'])
                    self.commit_drum_sample(tr, kit['id'], i, sample, restore=True, source=source)
                except (ValueError, OSError) as exc: self.drums[tr].missing(i, exc)

    def import_reference_drum_kit(self, track, draft, asset_root):
        """Explicit offline importer; all assets validate before a single Undo gesture."""
        from .drum_import import prepare_reference_kit
        tr = track_index(track)
        if self.sample_cache is None: raise ValueError('Unsupported output sample rate')
        kit, samples = prepare_reference_kit(draft, asset_root, self.sample_cache)
        self.snapshot()
        for key, (_, _, owner) in list(self.pending.items()):
            if owner == tr: self.close_note(key)
        self.synths[tr].panic(); self.drums[tr].panic()
        self.scheduled_live = [event for event in self.scheduled_live if event[1] != tr]
        self.drum_keys = {key: owner for key, owner in self.drum_keys.items() if owner != tr}
        t = self.project.tracks[tr]; t['device'] = 'drum_rack'; t['drum_rack'] = kit
        self.drum_epoch += 1; self.drums[tr].configure(kit)
        for i, sample in enumerate(samples): self.drums[tr].bind(i, sample)

    def install_drum_kit(self, track, kit_id, kit, samples, epoch=None, expected=None):
        current=self.drum_target(track,kit_id)
        if epoch is not None and epoch!=self.drum_epoch:
            raise ValueError('The device changed while the kit was loading; choose the folder again')
        if expected is not None and current!=expected:
            raise ValueError('The kit was edited while the folder was loading; choose it again')
        clean=validate_kit(kit)
        if not isinstance(samples,(list,tuple)) or len(samples)!=16:raise ValueError('Invalid prepared kit samples')
        for p,sample in zip(clean['pads'],samples):
            if (p['source'] is None)!=(sample is None) or (sample is not None and p['source']!=sample.source):
                raise ValueError('Prepared sample does not match its kit source')
        self.snapshot()
        for key,(_,_,owner) in list(self.pending.items()):
            if owner==track:self.close_note(key)
        self.synths[track].panic();self.drums[track].panic()
        self.scheduled_live=[event for event in self.scheduled_live if event[1]!=track]
        self.drum_keys={key:owner for key,owner in self.drum_keys.items() if owner!=track}
        if track==self.selected:
            self.perform_held.reset();self.live_note_map.clear();self.down.clear()
        self.project.tracks[track]['drum_rack']=clean
        self.drum_epoch+=1;self.drums[track].configure(clean)
        for i,sample in enumerate(samples):self.drums[track].bind(i,sample)

    def drum_note(self, track, kit_id, pad, velocity):
        kit = self.drum_target(track, kit_id, pad)
        if type(velocity) is not int or not 1 <= velocity <= 127: raise ValueError('Velocity must be 1–127')
        hit = self.voice_on(track, kit['pads'][pad]['note'], velocity, ('touch', kit_id, pad))
        if hit and self.recording:
            sample = self.drums[track].samples[pad]
            duration = min(self.project.beats, max(1/self.fpb, sample.frames/self.rate*self.project.bpm/60))
            self.project.tracks[track]['notes'].append(dict(start=self.beat % self.project.beats,
                duration=duration, note=36+pad, velocity=velocity))
        return hit

    def drum_midi(self, status, note, value):
        kind = status & 0xf0; key = (status & 15, note)
        off = kind == 0x80 or kind == 0x90 and value == 0
        if kind == 0x90 and value and device_kind(self.project.tracks[self.selected]) != 'drum_rack':
            self.drum_keys.pop(key, None)
            return False
        if off and key in self.drum_keys:
            self.drum_keys.pop(key)
            self.down.discard(key)
            self.close_note((key[0], note, note))
            return True
        tr = self.selected; t = self.project.tracks[tr]
        if device_kind(t) != 'drum_rack': return False
        channel = self.project.performance['scale']['input_channel']
        if channel and key[0] != channel-1: return True
        if kind == 0x90 and value:
            if type(note) is not int or type(value) is not int or not 1 <= value <= 127:
                raise ValueError('Invalid drum MIDI note')
            if not 36 <= note <= 51: return True
            pending = (key[0], note, note)
            self.close_note(pending)
            if self.voice_on(tr, note, value, ('live', key[0], note, note)):
                self.drum_keys[key] = tr; self.down.add(key)
                if self.recording: self.pending[pending] = (self.frame, value, tr)
            return True
        if kind == 0xb0 and note in (120, 123): self.panic()
        return True  # Pitch, sustain and scale/chord transforms do not affect one-shots.

    def voice_off(self, track, note, token=None):
        if device_kind(self.project.tracks[track]) == 'drum_rack': self.drums[track].off(note, token)
        else: self.synths[track].off(note, token)

    def drum_state(self):
        states = [rack.state() if device_kind(t) == 'drum_rack' else None
                  for t, rack in zip(self.project.tracks, self.drums)]
        for tr, state in enumerate(states):
            if state:
                for i, pad in enumerate(state['pads']): pad['frame'] = self.drum_frames[tr][i]
        return states
