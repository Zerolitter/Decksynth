"""Engine side of Sampler tracks: make one from a pad, edit it, load its sample, play it."""
import copy
from pathlib import Path
import re
from .devices import device_kind, track_index
from .drum_rack import new_kit, validate_kit
from .sampler import EDITABLE, Sampler, detect_root, new_sampler, validate_sampler
from . import sampler_chop as chopper
from .sampler_record import Recorder
import time


class SamplerEngine:
    def init_samplers(self):
        self.samplers = [Sampler(self.rate, self.sample_cache) for _ in range(4)]
        self.sampler_tasks = chopper.Tasks()
        self.sample_envs = {}          # sha -> chop envelope, made once per sample on the worker
        self.chop_directory = None     # where sliced WAVs are written (the backend sets the data folder)
        self.recorder = None           # the take being armed or recorded, and which Sampler it goes to
        self.record_target = None      # (track, sampler id)
        self.record_inputs = []        # capture devices the backend found; record_input is the open one
        self.record_input = None; self.record_error = None

    def configure_samplers(self):
        for tr, t in enumerate(self.project.tracks):
            self.samplers[tr].configure(t.get('sampler') if device_kind(t) == 'sampler' else None)

    def sampler_target(self, track, sampler_id):
        tr = track_index(track); t = self.project.tracks[tr]
        if device_kind(t) != 'sampler' or t.get('sampler', {}).get('id') != sampler_id:
            raise ValueError('Sampler changed; select the current track')
        return t['sampler']

    def _clear_track_notes(self, tr):
        """Silence a track before its instrument changes, and forget its held keys."""
        for key, (_, _, owner) in list(self.pending.items()):
            if owner == tr: self.close_note(key)
        self.synths[tr].panic(); self.drums[tr].panic(); self.samplers[tr].panic(); self.drum_gate_keys[tr].clear()
        self.scheduled_live = [event for event in self.scheduled_live if event[1] != tr]
        self.drum_keys = {key: owner for key, owner in self.drum_keys.items() if owner != tr}
        if tr == self.selected:
            self.perform_held.reset(); self.live_note_map.clear(); self.down.clear()

    def make_sampler(self, track, kit_id, pad, target, root=None, family='other'):
        """Play a Drum Rack pad on the keys: its sample (and shaping) becomes a Sampler on `target`.
        root None: detect it from the sample (C4 when it has no clear pitch)."""
        kit = self.drum_target(track, kit_id, pad); tr = track_index(target)
        p = kit['pads'][pad]
        if p['source'] is None: raise ValueError('This pad has no sample to play on the keys')
        if root is None: root = detect_root(self.drums[track].samples[pad], self.rate) or 60
        if type(root) is not int or not 0 <= root <= 127: raise ValueError('Root note must be MIDI 0-127')
        if not isinstance(family, str) or not re.fullmatch(r'[a-z]{1,16}', family): family = 'other'
        name = p['name'] if not kit.get('name') else (p['name'] + ' - ' + kit['name'])[:80]
        spec = new_sampler(copy.deepcopy(p['source']), name, family, copy.deepcopy(p.get('shape')), root, p['tune'])
        raw = self.drums[track].raw[pad]
        self.snapshot(); self._clear_track_notes(tr)
        t = self.project.tracks[tr]; t['device'] = 'sampler'; t['sampler'] = spec
        self.drum_epoch += 1
        self.drums[tr].configure(None); self.samplers[tr].configure(spec)
        if raw is not None and raw.sha256 == spec['source']['sha256']: self.samplers[tr].bind(raw)
        return dict(track=tr, id=spec['id'])

    def detect_sampler_root(self, track, sampler_id):
        """Set the root from the sample's pitch. Returns the note, or None when there is no clear pitch."""
        self.sampler_target(track, sampler_id)
        note = detect_root(self.samplers[track].sample, self.rate)
        if note is not None: self.edit_sampler(track, sampler_id, 'root', note)
        return note

    def edit_sampler(self, track, sampler_id, key, value):
        """One gesture: a parameter, or several at once with key 'patch' (a dict)."""
        spec = self.sampler_target(track, sampler_id)
        changes = value if key == 'patch' else {key: value}
        if not isinstance(changes, dict) or not changes or not set(changes) <= EDITABLE:
            raise ValueError('Unknown Sampler parameter')
        candidate = copy.deepcopy(spec); candidate.update(changes)
        clean = validate_sampler(candidate)
        if clean == spec: return
        self.snapshot(); self.project.tracks[track]['sampler'] = clean
        if clean['mode'] != spec['mode'] or clean['poly'] != spec['poly']: self.samplers[track].panic()
        self.samplers[track].configure(clean)

    def commit_sampler_sample(self, track, sampler_id, sample, epoch=None):
        spec = self.sampler_target(track, sampler_id)
        if epoch is not None and epoch != self.drum_epoch: return False
        source = spec['source']
        if source is None or any(source[k] != sample.source[k] for k in ('sha256', 'source_rate', 'channels', 'frames', 'bits')):
            raise ValueError('Sample metadata does not match the saved source')
        self.samplers[track].bind(sample)
        return True

    # -- sampler expansion (stage 3): load a WAV, chop it, send slices to pads -------------------
    def _playing_sample(self, track, sampler_id):
        spec = self.sampler_target(track, sampler_id)
        sample = self.samplers[track].sample
        if sample is None or spec['source'] is None: raise ValueError('Wait for the sample to load')
        return spec, sample

    def _still(self, track, sampler_id, sha=None):
        t = self.project.tracks[track]
        spec = t.get('sampler') if device_kind(t) == 'sampler' else None
        if spec is None or spec['id'] != sampler_id: return None
        if sha is not None and (spec['source'] is None or spec['source']['sha256'] != sha): return None
        return spec

    def load_sampler_wav(self, track, sampler_id, path):
        """Load a WAV (up to 10 minutes) into this Sampler, in the background. One undo step."""
        track = track_index(track); self.sampler_target(track, sampler_id)
        if self.sample_cache is None: raise ValueError('The Sampler needs an audio rate of 8000-192000 Hz')
        if not isinstance(path, str) or not path or len(path) > 4096 or '\0' in path: raise ValueError('Choose a WAV file')
        if self.sampler_tasks.busy(('load', track)): raise ValueError('A WAV is already loading on this track')
        cache, rate = self.sample_cache, self.rate

        def work():
            sample = cache.load(path)
            return sample, detect_root(sample, rate)

        def commit(result):
            sample, root = result
            self.samplers[track].loading = False
            if self._still(track, sampler_id) is None: return None
            return self.install_sampler_sample(track, sampler_id, sample, root)
        def fail(exc):
            self.samplers[track].loading = False
        self.samplers[track].loading = True; self.samplers[track].error = None
        self.sampler_tasks.submit(('load', track), work, commit, fail, 'WAV not loaded: ')

    def install_sampler_sample(self, track, sampler_id, sample, root=None):
        spec = self.sampler_target(track, sampler_id)
        clean = copy.deepcopy(spec); clean.pop('shape', None)
        clean.update(source=sample.source, name=(Path(sample.path).stem or 'Sample')[:80], family='sample',
                     start=0., end=1., loop_start=0., loop_end=1., slices=[], root=root if root is not None else 60)
        clean = validate_sampler(clean)
        self.snapshot(); self._clear_track_notes(track)
        self.project.tracks[track]['sampler'] = clean
        self.samplers[track].configure(clean); self.samplers[track].bind(sample)
        minutes, seconds = divmod(int(round(sample.frames / self.rate)), 60)
        return 'Loaded %s (%d:%02d) on track %d' % (clean['name'], minutes, seconds, track + 1)

    def chop_sampler(self, track, sampler_id, mode, options=None):
        """Threshold / Regions / BPM / Split / Join / Clear. One undo step when it lands."""
        track = track_index(track); spec, sample = self._playing_sample(track, sampler_id)
        if mode not in chopper.CHOP_MODES: raise ValueError('Unknown chop mode')
        if mode == 'clear':
            self.edit_sampler(track, sampler_id, 'slices', []); return
        sha = spec['source']['sha256']; envs = self.sample_envs; rate = self.rate
        start, end, slices = spec['start'], spec['end'], copy.deepcopy(spec['slices'])
        data = sample.data

        def work():
            env = envs.get(sha) if mode == 'threshold' else None
            if mode == 'threshold' and env is None: env = chopper.envelope(data)
            return env, chopper.chop(data, rate, env, start, end, mode, options, slices)

        def commit(result):
            env, made = result
            if env is not None:
                envs[sha] = env
                while len(envs) > 8: envs.pop(next(iter(envs)))
            if self._still(track, sampler_id, sha) is None: return None
            self.edit_sampler(track, sampler_id, 'slices', made)
            if mode in ('split', 'join'): return None
            return '%d slice%s' % (len(made), '' if len(made) == 1 else 's') + (' (the most a Sampler holds)' if len(made) >= 64 else '')
        self.sampler_tasks.submit(('chop', track), work, commit)

    def sampler_view(self, track, sampler_id, a, b):
        """Zoom the waveform to a..b (0..1): the peaks are made in the background."""
        track = track_index(track); spec, sample = self._playing_sample(track, sampler_id)
        if any(type(v) not in (int, float) for v in (a, b)) or not 0 <= a < b <= 1: raise ValueError('Invalid zoom')
        sampler = self.samplers[track]
        if b - a >= .999:
            sampler.view = None; return
        n = sample.frames; lo = int(a * n); hi = max(lo + 2, min(n, int(round(b * n))))
        if hi - lo < 64: raise ValueError('Zoomed in as far as it goes')
        data = sample.data; sha = sample.sha256

        def commit(peaks):
            if sampler.sample is not None and sampler.sample.sha256 == sha: sampler.view = (sha, lo / n, hi / n, peaks)
        self.sampler_tasks.submit(('view', track), lambda: chopper.peaks_of_view(data, lo, hi), commit)

    def audition_slice(self, track, sampler_id, index):
        """Hear one slice (or the trimmed sample with index -1) as it is, at its own pitch."""
        track = track_index(track); spec, sample = self._playing_sample(track, sampler_id)
        if type(index) is not int or not -1 <= index < len(spec['slices']): raise ValueError('Choose a slice')
        pair = spec['slices'][index] if index >= 0 else [spec['start'], spec['end']]
        a, b = chopper.slice_frames(sample.data, pair)
        b = min(b, a + 5 * self.rate)
        audition = chopper.SliceAudition(sample.data[a:b], self.rate)
        audition.gain = min(1., .6 * spec['gain']); audition.slice = (track, index, a / sample.frames, b / sample.frames)
        self.play_sample_preview(audition)

    def sampler_audition_state(self, track):
        preview = getattr(self, '_sample_preview', None)
        if not isinstance(preview, chopper.SliceAudition) or preview.slice[0] != track: return None
        _, index, a, b = preview.slice
        return dict(index=index, at=round(a + (b - a) * min(1., self._preview_cursor / max(1, preview.frames)), 5))

    def slices_to_pads(self, track, sampler_id, target, mode, options=None):
        """'kit': slices 1-16 (or the bank's 16) become a new Drum Rack kit on `target`.
        'pad': one slice replaces one pad of the Drum Rack on `target`. WAVs are written in the background."""
        track = track_index(track); target = track_index(target)
        spec, sample = self._playing_sample(track, sampler_id)
        if target == track: raise ValueError('Send the slices to another track')
        opts = options if isinstance(options, dict) else {}
        slices = spec['slices']
        if not slices: raise ValueError('Chop the sample first')
        if mode == 'kit':
            bank = opts.get('bank', 0)
            if type(bank) is not int or not 0 <= bank * 16 < len(slices): raise ValueError('Choose slices to send')
            chosen = [(bank * 16 + i + 1, pair) for i, pair in enumerate(slices[bank * 16:bank * 16 + 16])]
            kit_id = None
        elif mode == 'pad':
            index, pad = opts.get('index'), opts.get('pad')
            if type(index) is not int or not 0 <= index < len(slices): raise ValueError('Choose a slice')
            kit_id = self.drum_target(target, opts.get('kit'), pad)['id']
            chosen = [(index + 1, slices[index])]
        else:
            raise ValueError('Unknown send mode')
        if self.sampler_tasks.busy(('send', track)): raise ValueError('Slices are already being sent')
        directory, cache, rate, data, name = self.chop_directory, self.sample_cache, self.rate, sample.data, spec['name']
        sha = sample.sha256

        def work():
            return chopper.export_slices(directory, name, data, rate, chosen, cache)

        def commit(result):
            folder, samples = result
            if mode == 'pad':
                pad = opts['pad']
                self.commit_drum_sample(target, kit_id, pad, samples[0], name='%s %02d' % (name[:76], chosen[0][0]))
                return 'Slice %d is on pad %d of track %d' % (chosen[0][0], pad + 1, target + 1)
            kit = new_kit(); kit['name'] = name[:80]
            for p, (number, _), smp in zip(kit['pads'], chosen, samples):
                p['name'] = ('%s %02d' % (name[:76], number)); p['source'] = smp.source; p['choke'] = 0
            for p in kit['pads'][len(samples):]: p['choke'] = 0
            self.install_slice_kit(target, kit, samples + [None] * (16 - len(samples)))
            return 'Track %d is a Drum Rack with slices %d-%d of %s' % (target + 1, chosen[0][0], chosen[-1][0], name)
        self.sampler_tasks.submit(('send', track), work, commit)

    def detect_slice_roots(self, track, sampler_id):
        """Find each slice's pitch (in the background), then play them as a multisampled instrument (Keys: Pitched)."""
        track = track_index(track); spec, sample = self._playing_sample(track, sampler_id)
        if not spec['slices']: raise ValueError('Chop the sample first')
        sha = sample.sha256; data = sample.data; rate = self.rate; slices = copy.deepcopy(spec['slices'])

        def work():
            roots = []
            for pair in slices:
                a, b = chopper.slice_frames(data, pair)
                roots.append(detect_root(chopper.SliceAudition(data[a:b], rate), rate))
            return roots

        def commit(roots):
            current = self._still(track, sampler_id, sha)
            if current is None: return None
            if [p[:2] for p in current['slices']] != [p[:2] for p in slices]: raise ValueError('The slices changed; detect again')
            found = sum(1 for r in roots if r is not None)
            if not found: raise ValueError('No slice has a clear pitch; use Keys: Slices instead')
            made = [[p[0], p[1], r] if r is not None else [p[0], p[1]] for p, r in zip(slices, roots)]
            self.edit_sampler(track, sampler_id, 'patch', dict(slices=made, keymap='pitched'))
            return 'Found the pitch of %d of %d slices' % (found, len(slices))
        self.sampler_tasks.submit(('roots', track), work, commit)

    def install_slice_kit(self, target, kit, samples):
        """Make `target` a Drum Rack holding `kit` in one undo step."""
        clean = validate_kit(kit)
        self.snapshot(); self._clear_track_notes(target)
        t = self.project.tracks[target]; t['device'] = 'drum_rack'; t['drum_rack'] = clean
        self.drum_epoch += 1
        self.samplers[target].configure(None); self.drums[target].configure(clean)
        for i, smp in enumerate(samples):
            if smp is not None: self.drums[target].bind(i, smp)

    def poll_sampler_tasks(self):
        return self.sampler_tasks.poll()

    # Recording a take into a Sampler (Stage 5). The backend opens the input and feeds it here.
    def sampler_record(self, action, *args):
        """arm [track, id, threshold dB, length s] waits for the level; now [...] records at once;
        level [threshold, length] changes them; stop keeps the take; cancel drops it."""
        if action in ('arm', 'now'):
            if len(args) != 4: raise ValueError('Record needs a track, a Sampler, a threshold and a length')
            track, sampler_id, threshold, length = args
            track = track_index(track); self.sampler_target(track, sampler_id)
            if self.record_input is None: raise ValueError('Choose an input first')
            if self.sampler_tasks.busy(('record', track)) or self.sampler_tasks.busy(('load', track)): raise ValueError('The last take is still being saved')
            if self.recorder is None: self.recorder = Recorder(self.rate)
            self.recorder.set_threshold(threshold); self.recorder.set_length(length)
            self.record_target = (track, sampler_id)
            self.recorder.arm() if action == 'arm' else self.recorder.start()
        elif action == 'level':
            if self.recorder is None: self.recorder = Recorder(self.rate)
            threshold, length = args
            self.recorder.set_threshold(threshold); self.recorder.set_length(length)
        elif action == 'stop': self._keep_take()
        elif action == 'cancel':
            if self.recorder is not None: self.recorder.cancel()
        else: raise ValueError('Unknown record action')

    def record_feed(self, block):
        """One block of mono input. Ends the take by itself when it reaches its length."""
        if self.recorder is None: self.recorder = Recorder(self.rate)
        if self.recorder.feed(block): self._keep_take()

    def record_lost(self, reason):
        """The input went away (unplugged): keep what was recorded, and say so."""
        self.record_error = reason
        if self.recorder is not None and self.recorder.state == 'recording': self._keep_take(lost=True)
        elif self.recorder is not None: self.recorder.cancel()

    def _keep_take(self, lost=False):
        rec = self.recorder
        if rec is None or rec.state != 'recording':
            if rec is not None: rec.cancel()
            return
        track, sampler_id = self.record_target
        clipped = rec.clipped; data = rec.take()
        if self.sample_cache is None or self.chop_directory is None:
            rec.saved(); raise ValueError('No data folder for recordings')
        folder = Path(self.chop_directory) / 'Samples' / 'Recordings'
        path = folder / ('Recording %s.wav' % time.strftime('%d %b %H-%M-%S'))
        cache, rate = self.sample_cache, self.rate

        def work():
            folder.mkdir(parents=True, exist_ok=True)
            chopper.write_wav(path, data, rate)
            sample = cache.load(str(path))
            return sample, detect_root(sample, rate)

        def commit(result):
            rec.saved()
            if self._still(track, sampler_id) is None: return 'Recording saved as ' + path.name + '; the Sampler changed, so it was not loaded'
            note = self.install_sampler_sample(track, sampler_id, *result).replace('Loaded', 'Recorded', 1)
            if clipped: note += '. It clipped: turn the input down'
            if lost: note += '. The input went away, so the take ends there'
            return note

        def fail(exc):
            rec.saved()
        self.sampler_tasks.submit(('record', track), work, commit, fail, 'Recording not saved: ')

    def record_state(self):
        out = dict(inputs=self.record_inputs, input=self.record_input, error=self.record_error,
                   **(self.recorder.status() if self.recorder is not None else dict(state='idle', level=-90., threshold=-40., length=60., seconds=0., clipped=False)))
        out['track'] = self.record_target[0] if self.record_target else None
        return out

    def load_sampler_sources(self):
        """Offline rehydration (export, freeze, tests). The live worker loads in the background."""
        for tr, t in enumerate(self.project.tracks):
            if device_kind(t) != 'sampler' or t['sampler']['source'] is None or self.sample_cache is None: continue
            source = t['sampler']['source']
            try: self.commit_sampler_sample(tr, t['sampler']['id'], self.sample_cache.load(source['path'], source['sha256']))
            except (ValueError, OSError) as exc: self.samplers[tr].missing(exc)

    def settle_offline_shaping(self):
        """Offline renders (export, freeze) wait for shaped pad and Sampler copies before the first block."""
        from .drum_shape import PadShaper
        PadShaper.wait()
        for sampler in self.samplers: sampler.take_pending()

    def sampler_state(self):
        out = []
        for tr, t in enumerate(self.project.tracks):
            if device_kind(t) != 'sampler': out.append(None); continue
            state = self.samplers[tr].state()
            state['audition'] = self.sampler_audition_state(tr)
            state['busy'] = [key[0] for key, future, *_ in self.sampler_tasks.jobs if key[1] == tr and not future.done()]
            out.append(state)
        return out
