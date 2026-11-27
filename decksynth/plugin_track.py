"""Plugin tracks (27 Nov): a VST3 instrument as a track's device, next to Synth, Drum Rack and Sampler.

The track keeps which plugin it plays and its eight quick knobs ('plugin' in the track). The plugin itself runs in
the plugin helper (plugin_host.py); its live audio becomes this track's audio, so volume, pan, FX and sends work on it.

Resample captures what the plugin plays, from its live output, in stereo: the loop (the track's clip from bar 1),
what you play (from your first note until the sound dies), or one note. The audio loop only appends each block and
its peaks here; the WAV is written in a thread."""
import threading
import wave
from array import array
from pathlib import Path

QUICK = 8                                  # quick knobs per plugin track: two hands of four
MAX_SECONDS = 60.                          # the longest take
SILENT = .001                              # -60 dB: quieter than this counts as silence
QUIET_TAIL = 2.                            # 'What I play' ends this long after the sound died (all keys up)
LOOP_TAIL_MAX = 10.                        # a loop's tail rings out for at most this long
OVERVIEW = 240                             # points in a take's waveform


def new_plugin_spec():
    return dict(version=1, path='', name='', vendor='', quick=[None] * QUICK)


def validate_plugin_spec(value):
    if not isinstance(value, dict) or set(value) - {'version', 'path', 'name', 'vendor', 'quick'}:
        raise ValueError('Invalid plugin track')
    if value.get('version') != 1: raise ValueError('Unsupported plugin track version')
    out = new_plugin_spec()
    for key, limit in (('path', 4096), ('name', 80), ('vendor', 80)):
        v = value.get(key, '')
        if not isinstance(v, str) or len(v) > limit: raise ValueError('Invalid plugin %s' % key)
        out[key] = v
    quick = value.get('quick', [None] * QUICK)
    if not isinstance(quick, list) or len(quick) != QUICK: raise ValueError('A plugin track has %d quick knobs' % QUICK)
    for slot, q in enumerate(quick):
        if q is None: continue
        if (not isinstance(q, dict) or set(q) != {'i', 'name'} or type(q['i']) is not int or not 0 <= q['i'] < 100000
                or not isinstance(q['name'], str) or len(q['name']) > 80):
            raise ValueError('Invalid quick knob')
        out['quick'][slot] = dict(i=q['i'], name=q['name'])
    return out


def block_peaks(left, right):
    """(min L, max L, min R, max R) of one live block; min()/max() run in C."""
    return (min(left), max(left), min(right), max(right)) if len(left) else (0., 0., 0., 0.)


class Capture:
    """One Resample take, fed from the audio loop with the plugin's live blocks and the notes sent to it.

    mode 'loop': records from the moment it starts (the backend starts the loop at bar 1) for `frames`, then the
    backend stops the transport and the tail rings until quiet. mode 'play': armed until the first note-on, then
    records until all keys are up and the sound has been quiet for QUIET_TAIL. mode 'note': like 'loop', the backend
    plays one note for `frames`."""

    def __init__(self, mode, rate, frames=0):
        if mode not in ('loop', 'play', 'note'): raise ValueError('Choose what to resample')
        self.mode = mode; self.rate = int(rate); self.body = int(frames)
        self.state = 'armed' if mode == 'play' else 'recording'
        self.left = []; self.right = []; self.peaks = []; self.frames = 0
        self.held = set(); self.quiet = 0; self.body_done = mode == 'play'
        self.limit = int(MAX_SECONDS * rate)
        self.peak = 0.
        # The growing waveform for the screen: one point per ~40 ms, built as blocks arrive (never recomputed).
        self.group = max(1, int(.04 * rate / 256)); self.points = []; self._acc = None; self._in = 0

    # -- the audio loop -------------------------------------------------------------------------
    def notes(self, events):
        """The MIDI sent to the plugin this block: (frame, 3 bytes)."""
        for _, msg in events:
            status = msg[0] & 0xF0
            if status == 0x90 and msg[2] > 0:
                self.held.add(msg[1])
                if self.state == 'armed': self.state = 'recording'
            elif status == 0x80 or (status == 0x90 and msg[2] == 0): self.held.discard(msg[1])
            elif status == 0xB0 and msg[1] == 123: self.held.clear()

    def feed(self, block):
        """One live block (left, right), or None (the helper sent nothing). Returns True when the take just ended."""
        if self.state != 'recording': return False
        n = 256 if block is None else len(block[0])
        if block is None: block = (array('d', bytes(8 * n)), array('d', bytes(8 * n)))
        p = block_peaks(*block)
        loud = max(-p[0], p[1], -p[2], p[3])
        self.peak = max(self.peak, loud)
        self.left.append(block[0]); self.right.append(block[1]); self.peaks.append(p); self.frames += n
        a = self._acc
        self._acc = list(p) if a is None else [min(a[0], p[0]), max(a[1], p[1]), min(a[2], p[2]), max(a[3], p[3])]
        self._in += 1
        if self._in >= self.group:
            self.points.append([round(v, 3) for v in self._acc]); self._acc = None; self._in = 0
        if not self.body_done and self.frames >= self.body: self.body_done = True
        self.quiet = self.quiet + n if loud < SILENT else 0
        if self.frames >= self.limit: self.state = 'done'
        elif self.body_done:
            need = QUIET_TAIL if self.mode == 'play' else .05
            if not (self.mode == 'play' and self.held) and self.quiet >= need * self.rate and self.frames > self.quiet: self.state = 'done'
            elif self.mode != 'play' and self.frames - self.body > LOOP_TAIL_MAX * self.rate: self.state = 'done'
        return self.state == 'done'

    def stop(self):
        """Stop and keep: ends now (an armed take that heard nothing is just dropped)."""
        self.state = 'done' if self.frames else 'empty'

    # -- after the take ---------------------------------------------------------------------------
    def span(self):
        """[first, last) frames worth keeping: from 2 ms before the first sound to 50 ms after the last."""
        first = last = None; at = 0
        for p in self.peaks:
            n = 256
            if max(-p[0], p[1], -p[2], p[3]) >= SILENT:
                if first is None: first = at
                last = at + n
            at += n
        if first is None: return 0, 0
        return max(0, first - int(.002 * self.rate)), min(self.frames, last + int(.05 * self.rate))

    def status(self):
        """For the screen: state, seconds, peak, and the waveform so far (min/max per point, L and R)."""
        if self.state == 'done':
            if getattr(self, '_final', None) is None:
                first, last = self.span(); self._final = overview(self.peaks[first // 256:-(-last // 256)], OVERVIEW)  # what Keep keeps
            wave = self._final
        else:
            k = -(-len(self.points) // 300) or 1; wave = self.points[::k]
        return dict(mode=self.mode, state=self.state, seconds=round(self.frames / self.rate, 2), peak=round(self.peak, 4), wave=wave)

    def samples(self):
        """The whole take as two flat arrays (called once, in the writer thread)."""
        left = array('d'); right = array('d')
        for a in self.left: left.extend(a)
        for a in self.right: right.extend(a)
        return left, right


def overview(peaks, points):
    """Waveform points [[minL, maxL, minR, maxR], ...]: about `points` across the whole take."""
    if not peaks: return []
    step = max(1, -(-len(peaks) // points))
    out = []
    for i in range(0, len(peaks), step):
        chunk = peaks[i:i + step]
        out.append([round(min(p[0] for p in chunk), 3), round(max(p[1] for p in chunk), 3),
                    round(min(p[2] for p in chunk), 3), round(max(p[3] for p in chunk), 3)])
    return out


def write_take(path, left, right, rate, start, end, gain=1.):
    """Stereo 24-bit PCM from frame `start` to `end`, with 2 ms fades so the cut never clicks."""
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    n = max(0, end - start); fade = min(n // 2, int(.002 * rate)) or 1
    pcm = bytearray()
    for j in range(n):
        g = gain * min(1., (j + 1) / fade, (n - j) / fade)
        for v in (left[start + j], right[start + j]):
            x = max(-8388608, min(8388607, int(round(v * g * 8388607))))
            pcm += (x & 0xFFFFFF).to_bytes(3, 'little')
    temp = path.with_suffix('.part')
    with wave.open(str(temp), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(3); w.setframerate(rate); w.writeframes(bytes(pcm))
    temp.replace(path)
    return path


class TakeWriter:
    """Writes a kept take without holding up audio: a thread saves the raw blocks (file I/O, C-speed copies) and a
    child process trims, normalizes and packs the 24-bit WAV, so the packing never holds the engine's GIL."""

    def __init__(self, capture, path, start, end, normalize):
        import subprocess, sys
        self.result = {}
        left, right, rate = capture.left, capture.right, capture.rate
        path = Path(path)

        def work():
            raw = path.with_suffix('.raw')
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                with open(raw, 'wb') as f:
                    for a in left: a.tofile(f)
                    for a in right: a.tofile(f)
                proc = subprocess.run([sys.executable, '-I', str(Path(__file__).resolve()), str(raw), str(path), str(rate),
                                       str(int(start)), str(int(end)), '1' if normalize else '0'],
                                      capture_output=True, text=True, timeout=120)
                if proc.returncode: raise ValueError((proc.stderr.strip().splitlines() or ['could not write the take'])[-1][:200])
                seconds, clipped = proc.stdout.split()
                self.result.update(path=str(path), seconds=float(seconds), clipped=clipped == '1')
            except Exception as exc:
                self.result['error'] = str(exc)
            finally:
                try: raw.unlink()
                except OSError: pass
        self.thread = threading.Thread(target=work, name='plugin-take', daemon=True)
        self.thread.start()

    def done(self):
        return not self.thread.is_alive()


def _write_from_raw(raw, out, rate, start, end, normalize):
    """The child process: the raw file holds all left samples, then all right ones (float64)."""
    data = array('d')
    with open(raw, 'rb') as f: data.frombytes(f.read())
    half = len(data) // 2
    left, right = data[:half], data[half:]
    s, e = max(0, start), min(half, end)
    if e <= s: raise SystemExit('The take is empty')
    peak = max(max(map(abs, left[s:e])), max(map(abs, right[s:e])))
    gain = (10 ** (-1 / 20) / peak) if normalize and peak > 1e-6 else 1.
    write_take(out, left, right, rate, s, e, gain)
    print(round((e - s) / rate, 3), 1 if peak * gain >= 1. else 0)


if __name__ == '__main__':
    import sys
    a = sys.argv[1:]
    _write_from_raw(a[0], a[1], int(a[2]), int(a[3]), int(a[4]), a[5] == '1')


class PluginTracks:
    """The backend's side of Plugin tracks: which plugin plays where, the quick knobs' values, Learn, the live
    output peaks for the screen, and Resample. Everything here runs between audio blocks and stays small."""

    def __init__(self, rate):
        self.rate = int(rate)
        self.values = {}                      # parameter index -> (raw, text, name), from the helper's replies
        self.learn = None                     # (track, slot, {index: raw} before the window opened)
        self.out = []                         # [peak L, peak R] per live block since the last status
        self.capture = None; self.capture_track = None; self.capture_label = ''
        self.writer = None; self.writer_ctx = None
        self.loop_stopped = False; self.note_off_at = None; self.note = None
        self.tried = set()                    # plugin paths auto-loaded once (a failing one is not retried)

    # -- which track the live plugin plays on ------------------------------------------------------
    @staticmethod
    def plugin_track(engine, plugins):
        """The track index the loaded plugin plays on, if that track still is a Plugin track with this plugin."""
        pl = plugins.loaded
        if not pl or not pl.get('live') or pl.get('track') is None: return None
        tr = pl['track']; tracks = engine.project.tracks
        if not 0 <= tr < len(tracks): return None
        t = tracks[tr]
        return tr if t.get('device') == 'plugin' and t.get('plugin', {}).get('path') == pl['path'] else None

    # -- the audio loop -----------------------------------------------------------------------------
    def audio(self, engine, live, events):
        """After each block: `live` is the plugin's block that played (or None), `events` the notes sent to it."""
        if live is not None:
            p = block_peaks(*live)
            if len(self.out) < 512: self.out.append((max(-p[0], p[1]), max(-p[2], p[3])))
        c = self.capture
        if c is None or c.state not in ('armed', 'recording'): return
        c.notes(events)
        c.feed(live)
        if c.mode == 'loop' and c.body_done and not self.loop_stopped:
            self.loop_stopped = True; engine.stop()          # the loop played once: let its notes ring out
        if c.mode == 'note' and c.body_done and self.note is not None:
            engine.voice_off(self.capture_track, self.note, ('resample',)); self.note = None

    # -- between passes ---------------------------------------------------------------------------
    def poll(self, engine, plugins):
        """Turns Live on for a freshly loaded Plugin track, loads a Plugin track's plugin when none is loaded."""
        pl = plugins.loaded
        if pl and pl.pop('auto_live', False) and pl.get('kind') == 'instrument' and not pl.get('live'):
            plugins.set_live(True)
        if pl is None and not plugins.busy and plugins.scanned and plugins.status()['setup'] == 'ready':
            for tr, t in enumerate(engine.project.tracks):
                path = t.get('plugin', {}).get('path') if t.get('device') == 'plugin' else None
                if path and path not in self.tried and any(p['path'] == path for p in plugins.plugins):
                    self.tried.add(path)
                    try: plugins.load(path, tr)
                    except ValueError: pass
                    break
        if pl and pl.get('paged') and pl.get('track') is not None and not pl.get('asked'):
            pl['asked'] = True                    # a Windows plugin sends its values page by page: ask for the quick ones
            self.ask_values(engine, plugins, pl['track'])
        out = []
        if self.writer is not None and self.writer.done():
            out.append(dict(take=self.writer.result, ctx=self.writer_ctx)); self.writer = None; self.writer_ctx = None
        return out

    def params_event(self, event):
        """Keeps the values the helper reports (all of them, or one page), and finishes a Learn."""
        if 'plugin_params' in event:
            for p in event['plugin_params'].get('params', []):
                self.values[p['i']] = (p['raw'], p.get('text', ''), p['name'])
        elif 'plugin_param' in event:
            p = event['plugin_param']; old = self.values.get(p['i'])
            self.values[p['i']] = (p['raw'], p.get('text', ''), old[2] if old else '')

    def finish_learn(self, engine):
        """The plugin window closed: the parameter that moved most fills the armed slot. Returns a message."""
        if self.learn is None: return None
        tr, slot, before = self.learn; self.learn = None
        moved = [(abs(v[0] - before[i]), i) for i, v in self.values.items() if i in before and abs(v[0] - before[i]) > 1e-4]
        if not moved: return dict(error='Nothing moved in the plugin window: turn a control there, then close it')
        _, index = max(moved)
        self.set_quick(engine, tr, slot, index, self.values[index][2])
        return dict(message='Quick knob %d is %s' % (slot + 1, self.values[index][2] or 'parameter %d' % (index + 1)))

    # -- commands from the screen ----------------------------------------------------------------
    @staticmethod
    def spec(engine, track):
        if type(track) is not int or not 0 <= track < len(engine.project.tracks): raise ValueError('Choose a track')
        t = engine.project.tracks[track]
        if t.get('device') != 'plugin': raise ValueError('Track %d is not a Plugin track' % (track + 1))
        return t['plugin']

    def choose(self, engine, plugins, track, path):
        """Puts a plugin on a Plugin track (one undo step) and loads it there."""
        plugin = next((p for p in plugins.plugins if p['path'] == path), None)
        if plugin is None: raise ValueError('Choose a plugin from the list')
        spec = self.spec(engine, track)
        if spec['path'] != path:
            engine.snapshot()
            spec.update(path=path, name=plugin['name'], vendor='', quick=[None] * QUICK)
        self.tried.add(path)
        plugins.load(path, track)

    def activate(self, engine, plugins, track):
        """Loads this Plugin track's plugin, unless it already plays here."""
        spec = self.spec(engine, track)
        pl = plugins.loaded
        if not spec['path']: return
        if pl and pl['path'] == spec['path']:
            if pl.get('track') != track:
                pl['track'] = track; plugins.revision += 1
                if pl.get('kind') == 'instrument' and not pl.get('live'): plugins.set_live(True)
            return
        plugins.load(spec['path'], track)

    def ask_values(self, engine, plugins, track):
        spec = engine.project.tracks[track].get('plugin') if 0 <= track < len(engine.project.tracks) else None
        for q in (spec or {}).get('quick', []):
            if q is not None and q['i'] not in self.values:
                try: plugins.request_params(0, q['name'])
                except ValueError: pass

    def set_quick(self, engine, track, slot, index, name=''):
        spec = self.spec(engine, track)
        if type(slot) is not int or not 0 <= slot < QUICK: raise ValueError('Choose quick knob 1–%d' % QUICK)
        if index is not None and (type(index) is not int or not 0 <= index < 100000): raise ValueError('Choose a parameter')
        value = None if index is None else dict(i=index, name=str(name or self.values.get(index, (0, '', ''))[2])[:80])
        if spec['quick'][slot] == value: return
        engine.snapshot(); spec['quick'][slot] = value

    def start_learn(self, engine, plugins, track, slot):
        self.spec(engine, track)
        if type(slot) is not int or not 0 <= slot < QUICK: raise ValueError('Choose quick knob 1–%d' % QUICK)
        if not plugins.loaded: raise ValueError('Load the plugin first')
        self.learn = (track, slot, {i: v[0] for i, v in self.values.items()})
        if not plugins.editor: plugins.open_editor()

    def resample(self, engine, plugins, track, mode, options):
        """Starts a take of what the plugin plays on this track."""
        self.spec(engine, track)
        if self.plugin_track(engine, plugins) != track: raise ValueError('The plugin is not playing on this track yet')
        if self.writer is not None: raise ValueError('Wait until the last take is saved')
        name = plugins.loaded['name']
        delay = (plugins.live_delay_blocks + 2) * 256          # the helper's audio arrives a few blocks after its notes
        if mode == 'loop':
            frames = int(round(engine.project.beats * engine.fpb)) + delay
            self.capture = Capture('loop', self.rate, frames); self.capture_label = '%s loop' % name
            engine.stop(); engine.playing = True; self.loop_stopped = False
        elif mode == 'note':
            note = options.get('note', 60); vel = options.get('velocity', 100); hold = options.get('hold', 2.)
            if type(note) is not int or not 0 <= note <= 127: raise ValueError('Choose a note')
            if type(vel) is not int or not 1 <= vel <= 127: raise ValueError('Velocity is 1 to 127')
            if type(hold) not in (int, float) or not .05 <= hold <= 30: raise ValueError('Hold is 0.05 to 30 s')
            from .plugin_host import note_name
            self.capture = Capture('note', self.rate, int(hold * self.rate) + delay)
            self.capture_label = '%s %s' % (name, note_name(note))
            self.note = note; engine.voice_on(track, note, vel, ('resample',))
        elif mode == 'play':
            self.capture = Capture('play', self.rate); self.capture_label = '%s take' % name
        else: raise ValueError('Choose what to resample')
        self.capture_track = track

    def stop(self, engine):
        c = self.capture
        if c is None: return
        if self.note is not None: engine.voice_off(self.capture_track, self.note, ('resample',)); self.note = None
        if c.mode == 'loop' and not self.loop_stopped: engine.stop(); self.loop_stopped = True
        c.stop()
        if c.state == 'empty': self.capture = None

    def discard(self, engine):
        self.stop(engine); self.capture = None

    def keep(self, engine, sample_lib, dest, start, end, normalize):
        c = self.capture
        if c is None or c.state != 'done': raise ValueError('There is no take to keep')
        if dest not in ('new', 'library'): raise ValueError('Choose where the take goes')
        if dest == 'new':
            from .devices import MAX_TRACKS
            if len(engine.project.tracks) >= MAX_TRACKS: raise ValueError('%d tracks is the most: remove one to make room' % MAX_TRACKS)
        first, last = c.span()
        if last <= first: raise ValueError('The take is silent')
        for v in (start, end):
            if type(v) not in (int, float) or not 0. <= v <= 1.: raise ValueError('Start and End are 0 to 1')
        if end <= start: raise ValueError('End must come after Start')
        a = first + int((last - first) * start); b = first + int((last - first) * end)
        path = sample_lib.target('Plugins', self.capture_label)
        self.writer = TakeWriter(c, path, a, b, bool(normalize))
        self.writer_ctx = dict(mode='record', dest=dest, track=None, sampler_id=None, label=self.capture_label)
        self.capture = None

    # -- the screen -------------------------------------------------------------------------------
    def status(self, engine, plugins):
        out, self.out = self.out, []
        c = self.capture
        quick = None
        pl = plugins.loaded
        if pl and pl.get('track') is not None and 0 <= pl['track'] < len(engine.project.tracks):
            spec = engine.project.tracks[pl['track']].get('plugin')
            if spec and spec.get('path') == pl['path']:
                quick = [None if q is None else [round(self.values.get(q['i'], (0., '', ''))[0], 4), self.values.get(q['i'], (0., '', ''))[1]]
                         for q in spec['quick']]
        take = None
        if c is not None:
            take = dict(c.status(), track=self.capture_track)
            if c.state == 'done':
                first, last = c.span(); take['span'] = [round(first / self.rate, 3), round(last / self.rate, 3)]
        return dict(out=[[round(a, 4), round(b, 4)] for a, b in out], quick=quick, take=take,
                    learning=None if self.learn is None else [self.learn[0], self.learn[1]],
                    saving=self.writer is not None)
