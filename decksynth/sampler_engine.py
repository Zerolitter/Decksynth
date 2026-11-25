"""Engine side of Sampler tracks: make one from a pad, edit it, load its sample, play it."""
import copy
from pathlib import Path
import re
from .devices import device_kind, track_index
from .drum_rack import new_kit, validate_kit
from .sampler import EDITABLE, Sampler, detect_root, new_sampler, validate_sampler
from . import sampler_chop as chopper
from .sampler_record import GAIN_RANGE, Recorder, amplify, gain, normalized
import math
import time


# Values a turning knob may preview (numbers only; never the sample, the slices or the play mode).
LIVE = frozenset(('g_swing', 'g_prob', 'g_range', 'g_speed', 'g_wander', 'g_smooth', 'g_jump', 'g_hold', 'g_rev', 'g_chaos', 'g_pulse', 'g_pos', 'g_size', 'g_density', 'g_spray', 'g_scan', 'g_spread', 'g_reverse', 'g_jitter', 'g_size_rnd', 'g_amp_rnd',
                  'tune', 'fine', 'gain', 'velocity', 'glide', 'cutoff', 'resonance', 'f_env', 'f_attack', 'f_decay', 'f_velocity',
                  'p_env', 'p_decay', 'attack', 'decay', 'sustain', 'release'))

class SamplerEngine:
    def init_samplers(self):
        self.samplers = [Sampler(self.rate, self.sample_cache) for _ in range(4)]
        self.sampler_tasks = chopper.Tasks()
        self.sample_envs = {}          # sha -> chop envelope, made once per sample on the worker
        self.chop_directory = None     # where sliced WAVs are written (the backend sets the data folder)
        self.recorder = None           # the take being armed or recorded, and which Sampler it goes to
        self.record_target = None      # (track, sampler id, None) or (track, drum rack id, pad)
        self.record_gain = 0.          # input gain in dB (Record sheet)
        self.record_normalize = True   # bring each take to -1 dBFS when it is saved
        self.record_inputs = []        # capture devices the backend found; record_input is the open one
        self.record_input = None; self.record_error = None
        self.live_track = None          # the Sampler track whose grains come from the open input

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

    # Finding the pitch takes about 0.1 s of Python, more than the whole audio buffer: the worker uses these two,
    # which find it in the background and apply the result from poll_sampler_tasks(), so the audio never waits.
    def make_sampler_later(self, track, kit_id, pad, target, root=None, family='other'):
        """make_sampler, with the root found in the background when it is None. Its message comes from the poll."""
        def made(result):
            self.select(result['track'])
            spec = self.project.tracks[result['track']]['sampler']
            return 'Track %d plays %s on the keys' % (result['track'] + 1, spec['name'])
        if root is not None: return made(self.make_sampler(track, kit_id, pad, target, root, family))
        kit = self.drum_target(track, kit_id, pad); track_index(target)
        if kit['pads'][pad]['source'] is None: raise ValueError('This pad has no sample to play on the keys')
        if self.sampler_tasks.busy(('make', track)): raise ValueError('Still finding the pitch of the last pad')
        sample, rate = self.drums[track].samples[pad], self.rate

        def commit(found):
            if self.drums[track].samples[pad] is not sample: raise ValueError('the pad changed while its pitch was found')
            return made(self.make_sampler(track, kit_id, pad, target, found or 60, family))
        self.sampler_tasks.submit(('make', track), lambda: detect_root(sample, rate), commit, None, 'Not played on the keys: ')

    def detect_sampler_root_later(self, track, sampler_id):
        """detect_sampler_root in the background. Its message comes from the poll."""
        track = track_index(track); spec, sample = self._playing_sample(track, sampler_id)
        if self.sampler_tasks.busy(('detect', track)): raise ValueError('Still finding the pitch')
        sha, rate = sample.sha256, self.rate

        def commit(found):
            if self._still(track, sampler_id, sha) is None: return None
            if found is None: return 'No clear pitch in this sample; the root stays where it was'
            self.edit_sampler(track, sampler_id, 'root', found)
            return 'Root set to ' + note_name(found)
        self.sampler_tasks.submit(('detect', track), lambda: detect_root(sample, rate), commit, None, 'Pitch not found: ')

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
        if clean['mode'] != 'grain' and self.live_track == track: self.samplers[track].live_off(); self.live_track = None
        self.samplers[track].configure(clean)

    def preview_sampler(self, track, sampler_id, changes):
        """A knob that is still turning: the playing Sampler follows; the project and undo wait for the release."""
        spec = self.sampler_target(track, sampler_id)
        if not isinstance(changes, dict) or not changes or not set(changes) <= LIVE:
            raise ValueError('Unknown Sampler parameter')
        candidate = copy.deepcopy(spec); candidate.update(changes)
        self.samplers[track].configure(validate_sampler(candidate))

    def clear_sampler(self, track, sampler_id):
        """Clear sample: the Sampler goes back to empty (one undo step). The WAV file stays on disk."""
        spec = self.sampler_target(track, sampler_id)
        if spec['source'] is None: return
        if self.recorder is not None and self.recorder.state in ('armed', 'recording') and self.record_target and self.record_target[0] == track:
            raise ValueError('Stop the recording first')
        clean = copy.deepcopy(spec)
        clean.update(source=None, name='Sampler', family='other', slices=[], keymap='whole', start=0., end=1., loop_start=0., loop_end=1.)
        clean.pop('shape', None)
        clean = validate_sampler(clean)
        self.snapshot(); self.project.tracks[track]['sampler'] = clean
        self.samplers[track].panic(); self.samplers[track].configure(clean)

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
        level [threshold, length] changes them; stop keeps the take; cancel drops it.
        With a fifth value, a pad (0-15), the id is a Drum Rack's and the take goes onto that pad (16 Nov)."""
        if action in ('arm', 'now'):
            if len(args) not in (4, 5): raise ValueError('Record needs a track, a Sampler or Drum Rack, a threshold and a length')
            track, sampler_id, threshold, length = args[:4]; pad = args[4] if len(args) == 5 else None
            track = track_index(track)
            if pad is None: self.sampler_target(track, sampler_id)
            else: self.drum_target(track, sampler_id, pad)
            if self.record_input is None: raise ValueError('Choose an input first')
            if self.sampler_tasks.busy(('record', track)) or self.sampler_tasks.busy(('load', track)): raise ValueError('The last take is still being saved')
            # Record here takes over: a take on another track is kept (saved to its Sampler), and this one starts fresh.
            old = self.recorder
            if old is not None and old.state == 'recording':
                try: self._keep_take()
                except ValueError: old.cancel()   # a silent take is dropped
            if old is not None and old.state in ('recording', 'saving'):
                self.recorder = Recorder(self.rate, old.threshold_db, old.max_seconds)
            if self.recorder is None: self.recorder = Recorder(self.rate)
            self.recorder.set_threshold(threshold); self.recorder.set_length(length)
            self.record_target = (track, sampler_id, pad)
            self.recorder.arm() if action == 'arm' else self.recorder.start()
        elif action == 'level':
            if self.recorder is None: self.recorder = Recorder(self.rate)
            if len(args) not in (2, 4): raise ValueError('Level needs a threshold and a length (and gain, normalize)')
            threshold, length = args[:2]
            self.recorder.set_threshold(threshold); self.recorder.set_length(length)
            if len(args) == 4:
                g = float(args[2])
                if not math.isfinite(g): raise ValueError('Gain must be a number')
                self.record_gain = max(GAIN_RANGE[0], min(GAIN_RANGE[1], g))
                if type(args[3]) is not bool: raise ValueError('Normalize must be on or off')
                self.record_normalize = args[3]
        elif action == 'stop': self._keep_take()
        elif action == 'cancel':
            if self.recorder is not None: self.recorder.cancel()
        else: raise ValueError('Unknown record action')

    def record_feed(self, block):
        """One block of mono input. Ends the take by itself when it reaches its length."""
        if self.recorder is None: self.recorder = Recorder(self.rate)
        if self.record_gain: block = amplify(block, gain(self.record_gain))
        if self.live_track is not None: self.samplers[self.live_track].live_feed(block)
        if self.recorder.feed(block): self._keep_take()

    def sampler_live(self, track, sampler_id, action):
        """Grain mode's live input: 'on', 'off', 'freeze' (stop listening, keep the last 8 s) or 'thaw'."""
        spec = self.sampler_target(track, sampler_id); tr = track_index(track)
        if action == 'on':
            if spec['mode'] != 'grain': raise ValueError('Live input plays in Grain mode')
            if self.live_track is not None and self.live_track != tr: self.samplers[self.live_track].live_off()
            self.samplers[tr].live_on(); self.live_track = tr
        elif action == 'off':
            self.samplers[tr].live_off()
            if self.live_track == tr: self.live_track = None
        elif action in ('freeze', 'thaw'):
            live = self.samplers[tr].live
            if live is None: raise ValueError('Live input is off')
            live.frozen = action == 'freeze'
        else: raise ValueError('Unknown live input action')

    def record_lost(self, reason):
        """The input went away (unplugged): keep what was recorded, and say so."""
        self.record_error = reason
        if self.live_track is not None: self.samplers[self.live_track].live_off(); self.live_track = None
        if self.recorder is not None and self.recorder.state == 'recording': self._keep_take(lost=True)
        elif self.recorder is not None: self.recorder.cancel()

    def _keep_take(self, lost=False):
        rec = self.recorder
        if rec is None or rec.state != 'recording':
            if rec is not None: rec.cancel()
            return
        track, sampler_id, pad = self.record_target
        clipped = rec.clipped; data = rec.take()
        if self.sample_cache is None or self.chop_directory is None:
            rec.saved(); raise ValueError('No data folder for recordings')
        folder = Path(self.chop_directory) / 'Samples' / 'Recordings'
        path = folder / ('Recording %s.wav' % time.strftime('%d %b %H-%M-%S'))
        cache, rate = self.sample_cache, self.rate
        lift = [0.]
        if self.record_normalize: data, lift[0] = normalized(data)

        def work():
            folder.mkdir(parents=True, exist_ok=True)
            chopper.write_wav(path, data, rate)
            sample = cache.load(str(path))
            return sample, detect_root(sample, rate)

        def commit(result):
            rec.saved()
            if pad is not None:
                try: self.commit_drum_sample(track, sampler_id, pad, result[0], name=path.stem[:80])
                except ValueError: return 'Recording saved as ' + path.name + '; the Drum Rack changed, so it was not put on the pad'
                note = 'Recorded %.1f s onto pad %d' % (result[0].frames / rate, pad + 1)
            elif self._still(track, sampler_id) is None: return 'Recording saved as ' + path.name + '; the Sampler changed, so it was not loaded'
            else: note = self.install_sampler_sample(track, sampler_id, *result).replace('Loaded', 'Recorded', 1)
            if lift[0] >= .5: note += ', normalized +%.0f dB' % lift[0]
            if clipped: note += '. It clipped: turn the input down'
            if lost: note += '. The input went away, so the take ends there'
            return note

        def fail(exc):
            rec.saved()
        self.sampler_tasks.submit(('record', track), work, commit, fail, 'Recording not saved: ')

    def export_drum_kit(self, track, kit_id, name, root=None, done=None):
        """Save the 16 pads as a kit folder in the library (Sir, 16 Nov): <root>/My kits/<name>/, one WAV per pad
        (its Start-End part) and decksynth-kit.json with the pad names and sound settings, so loading the folder
        from Kits gives the same kit back. Other apps just see the WAVs."""
        import json
        from .drum_library import KIT_FILE
        track = track_index(track); kit = self.drum_target(track, kit_id)
        if not root: raise ValueError('Choose a sample library folder first (Kits, then the folder button)')
        clean = lambda s, fallback: re.sub(r'[^\w .()-]+', '', str(s or '')).strip()[:60] or fallback
        title = clean(name or kit.get('name'), 'My kit')
        base = Path(root) / 'My kits'; folder = base / title; n = 2
        while folder.exists(): folder = base / ('%s %d' % (title, n)); n += 1
        files = []; side = dict(version=1, name=folder.name, pads=[None] * len(kit['pads']))
        for i, p in enumerate(kit['pads']):
            raw = self.drums[track].raw[i]
            if p['source'] is None or raw is None: continue
            shape = dict(p.get('shape') or {}); frames = raw.frames
            lo = max(0, min(frames - 1, int(float(shape.get('start', 0.)) * frames)))
            hi = max(lo + 1, min(frames, int(round(float(shape.get('end', 1.)) * frames))))
            file = '%02d %s.wav' % (i + 1, clean(p['name'], 'Pad %d' % (i + 1)))
            files.append((file, raw.data[lo:hi], raw.rate))
            if shape: shape.update(start=0., end=1.)
            side['pads'][i] = dict(file=file, name=p['name'], gain=p['gain'], velocity=p['velocity'], tune=p['tune'],
                                   choke=p['choke'], **(dict(shape=shape) if shape else {}))
        if not files: raise ValueError('The kit has no sounds to save')

        def work():
            folder.mkdir(parents=True)
            for file, data, rate in files: chopper.write_wav(folder / file, data, rate)
            (folder / KIT_FILE).write_text(json.dumps(side, indent=1))
            return folder

        def commit(path):
            if done is not None:
                try: done()
                except ValueError: pass
            return 'Kit saved to the library as My kits / %s (%d sound%s). Find it under Kits' % (path.name, len(files), '' if len(files) == 1 else 's')
        self.sampler_tasks.submit(('export_kit', track), work, commit, None, 'Kit not saved: ')
        return str(folder)

    def crop_drum_pad(self, track, kit_id, pad):
        """Crop a pad to its Start-End (Sir, 16 Nov): the part outside is dropped from a new WAV, the pad plays
        that file with Start and End back at the edges. Same sound, one undo step; the old file stays on disk."""
        track = track_index(track); kit = self.drum_target(track, kit_id, pad)
        p = kit['pads'][pad]; shape = p.get('shape') or {}; raw = self.drums[track].raw[pad]
        if p['source'] is None or raw is None: raise ValueError('Load a sample on this pad first')
        start, end = float(shape.get('start', 0.)), float(shape.get('end', 1.))
        if start <= 0 and end >= 1: raise ValueError('Move Start or End first: the whole sample is in use')
        if self.sample_cache is None or self.chop_directory is None: raise ValueError('No data folder for cropped samples')
        n = raw.frames; lo = max(0, min(n - 1, int(start * n))); hi = max(lo + 1, min(n, int(round(end * n))))
        data = raw.data[lo:hi]; rate = raw.rate; cache = self.sample_cache
        stem = re.sub(r'[^\w .-]+', '', p['name']).strip()[:60] or 'Pad %d' % (pad + 1)
        path = Path(self.chop_directory) / 'Samples' / 'Cropped' / ('%s crop %s.wav' % (stem, time.strftime('%d %b %H-%M-%S')))
        source = p['source']

        def work():
            path.parent.mkdir(parents=True, exist_ok=True)
            chopper.write_wav(path, data, rate)
            return cache.load(str(path))

        def commit(sample):
            now = self.project.tracks[track].get('drum_rack')
            if now is None or now['id'] != kit_id or now['pads'][pad]['source'] != source:
                return 'Cropped copy saved as ' + path.name + '; the pad changed, so it was not swapped'
            candidate = copy.deepcopy(now); q = candidate['pads'][pad]
            q['source'] = sample.source; q['shape'] = dict(q.get('shape') or {}, start=0., end=1.)
            clean = validate_kit(candidate)
            self.snapshot(); self.project.tracks[track]['drum_rack'] = clean
            self.drums[track].configure(clean); self.drums[track].bind(pad, sample)
            return 'Pad %d cropped to %.2f s (was %.2f s). Undo brings the full sample back' % (pad + 1, sample.frames / rate, n / rate)
        self.sampler_tasks.submit(('crop', track), work, commit, None, 'Not cropped: ')
        return str(path)

    def save_sample_to_library(self, track, sampler_id, what, index, name, category):
        """Save to library: the whole sample, its trim (Start to End) or one slice, as a WAV in the library's save folder
        (<save>/<category>/<name>.wav). Written in the background; the library rescans when it is done."""
        lib = getattr(self, 'sample_library', None)
        if lib is None: raise ValueError('The sample library is not available')
        track = track_index(track); spec = self.sampler_target(track, sampler_id); sample = self.samplers[track].sample
        if spec['source'] is None or sample is None: raise ValueError('Load a sample first')
        if what == 'whole': a, b = 0., 1.
        elif what == 'trim': a, b = spec['start'], spec['end']
        elif what == 'slice':
            if type(index) is not int or not 0 <= index < len(spec['slices']): raise ValueError('Choose a slice to save')
            a, b = spec['slices'][index][:2]
        else: raise ValueError('Save the whole sample, its trim or a slice')
        n = sample.frames; lo = max(0, min(n - 1, int(a * n))); hi = max(lo + 1, min(n, int(round(b * n))))
        data = sample.data[lo:hi]; path = lib.target(category, name); rate = self.rate

        def work():
            chopper.write_wav(path, data, rate); return path

        def commit(p):
            lib.scan(); return 'Saved %s to the library (%s)' % (p.stem, p.parent.name)
        self.sampler_tasks.submit(('library', track), work, commit, None, 'Not saved to the library: ')
        return str(path)

    def record_state(self):
        out = dict(inputs=self.record_inputs, input=self.record_input, error=self.record_error,
                   **(self.recorder.status() if self.recorder is not None else dict(state='idle', level=-90., peak=-90., threshold=-40., length=60., seconds=0., clipped=False)))
        # Only a live take belongs to a track; an old, saved take never blocks another Sampler.
        out['track'] = self.record_target[0] if self.record_target and out['state'] != 'idle' else None
        out['pad'] = self.record_target[2] if out['track'] is not None else None
        out['gain'] = self.record_gain; out['normalize'] = self.record_normalize
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


def note_name(n):
    return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][n % 12] + str(n // 12 - 1)
