"""The plugin helper (27 Nov): hosts one VST3 plugin in its own process, so a plugin that is slow, crashes or runs
through Wine (yabridge) can never stall or take down the audio engine.

It is started by plugin_host.py with the engine's Python and the plugin libraries (pedalboard + numpy) on
PYTHONPATH. It talks JSON lines: one request per line on stdin ({id, cmd, ...}), one answer per line on the
protocol pipe ({id, ok, ...} or {id, error}). Plugins print to stdout themselves, so the protocol moves to its
own copy of the pipe and stdout is pointed at stderr.

Commands: hello, load, set, params, render, editor, editor_close, quit. It exits when stdin closes, so it never
outlives the engine. Rendering is offline (faster than real time), never on the engine's audio thread."""
import json
import os
import queue
import re
import sys
import threading
import wave
import socket
import struct

PROTOCOL = None
MAX_SECONDS = 60.
MAX_TAIL = 10.
SILENCE = 10 ** (-70 / 20)
MAX_PARAMS = 4000
# A JUCE host lists 2048 "MIDI CC" parameters for every VST3 plugin; they are not the plugin's own.
IGNORE = re.compile(r'^MIDI CC |^MIDI Channel ', re.I)


def answer(obj):
    PROTOCOL.write(json.dumps(obj, separators=(',', ':')) + '\n'); PROTOCOL.flush()


def finite(v, lo, hi, what):
    if type(v) not in (int, float) or v != v or not lo <= v <= hi: raise ValueError('Invalid ' + what)
    return float(v)


class Host:
    def __init__(self, pb, np, live_socket=None):
        self.pb, self.np = pb, np
        self.plugin = None; self.path = None; self.editor_close = None
        self.live_socket=live_socket;self.live_stop=threading.Event();self.live_thread=None;self.live_enabled=False

    # -- loading and parameters ---------------------------------------------------------------
    def params(self):
        out = []
        for p in getattr(self.plugin, '_parameters', []):
            name = str(p.name)
            if IGNORE.match(name): continue
            steps = int(p.num_steps) if 1 < int(p.num_steps) < 1000 else 0
            item = dict(i=int(p.index), name=name[:60], raw=round(float(p.raw_value), 5), text=str(p.string_value)[:40],
                        label=str(getattr(p, 'label', '') or '')[:12])
            if p.is_boolean: item['kind'] = 'switch'
            elif 2 <= steps <= 8:
                item['kind'] = 'options'
                item['options'] = [str(p.get_text_for_raw_value(k / (steps - 1)))[:24] for k in range(steps)]
            else: item['kind'] = 'value'
            out.append(item)
            if len(out) >= MAX_PARAMS: break
        return out

    def find(self, index):
        for p in getattr(self.plugin, '_parameters', []):
            if int(p.index) == index: return p
        raise ValueError('That parameter is gone')

    def load(self, path, state_file=None):
        if not isinstance(path, str) or not path: raise ValueError('Choose a plugin')
        if self.editor_close is not None: raise ValueError('Close the plugin window first')
        names = self.pb.VST3Plugin.get_plugin_names_for_file(path)
        plugin = self.pb.VST3Plugin(path, plugin_name=names[0] if len(names) > 1 else None)
        if state_file and os.path.isfile(state_file):
            try:
                import base64
                with open(state_file, encoding='utf-8') as f: plugin.raw_state = base64.b64decode(json.load(f)['state'])
            except Exception: pass            # an old or foreign state: the plugin keeps its own defaults
        self.plugin, self.path = plugin, path
        kind = 'instrument' if plugin.is_instrument else 'effect'
        return dict(name=str(plugin.name)[:80], vendor=str(getattr(plugin, 'manufacturer_name', '') or '')[:60], kind=kind,
                    params=self.params(), latency=int(getattr(plugin, 'reported_latency_samples', 0) or 0))

    def save_state(self, state_file):
        """Keeps the plugin's own settings for the next load (its raw state, which can be megabytes)."""
        import base64
        if self.plugin is None or not state_file: return dict(saved=False)
        try: body = dict(path=self.path, state=base64.b64encode(bytes(self.plugin.raw_state)).decode('ascii'))
        except Exception: return dict(saved=False)
        os.makedirs(os.path.dirname(state_file), exist_ok=True)
        with open(state_file + '.part', 'w', encoding='utf-8') as f: json.dump(body, f)
        os.replace(state_file + '.part', state_file)
        return dict(saved=True)

    def need(self):
        if self.plugin is None: raise ValueError('Load a plugin first')
        return self.plugin

    def set(self, index, raw):
        self.need()
        p = self.find(int(index)); p.raw_value = finite(raw, 0., 1., 'value')
        return dict(i=int(p.index), raw=round(float(p.raw_value), 5), text=str(p.string_value)[:40])

    def live_enable(self, rate):
        if not self.need().is_instrument: raise ValueError('Live mode is for instrument plugins')
        self.rate=int(rate)
        if self.live_thread is None or not self.live_thread.is_alive():
            self.live_stop.clear();self.live_thread=threading.Thread(target=self._live_loop,daemon=True);self.live_thread.start()
        self.live_enabled=True;return dict(live=True)

    def live_disable(self):
        self.live_enabled=False;self.live_stop.set();return dict(live=False)

    def _recv(self,n):
        out=b''
        while len(out)<n:
            part=self.live_socket.recv(n-len(out))
            if not part:return b''
            out+=part
        return out

    def _live_loop(self):
        try:
            while not self.live_stop.is_set():
                head=self._recv(8)
                if not head:break
                seq,frames,count=struct.unpack('<IHH',head);events=[]
                for _ in range(count):
                    entry=self._recv(5)
                    if not entry:return
                    at,msg=struct.unpack('<H3s',entry);events.append((msg,at/self.rate))
                audio=self.need()(events,duration=frames/self.rate,sample_rate=self.rate,num_channels=2,buffer_size=frames,reset=False)
                audio=self.np.asarray(audio,dtype=self.np.float32)
                if audio.ndim==1:audio=audio[None,:]
                if audio.shape[0]==1:audio=self.np.vstack([audio,audio])
                audio=self.np.nan_to_num(audio[:2,:frames],nan=0.,posinf=0.,neginf=0.)
                if audio.shape[1]<frames:audio=self.np.pad(audio,((0,0),(0,frames-audio.shape[1])))
                self.live_socket.sendall(struct.pack('<IH',seq,frames)+audio.T.astype('<f4',copy=False).tobytes())
        except Exception: pass

    # -- rendering ----------------------------------------------------------------------------
    def render(self, req):
        plugin = self.need(); np = self.np
        rate = int(finite(req.get('rate'), 8000, 192000, 'rate'))
        path = req.get('path')
        if not isinstance(path, str) or not path.endswith('.wav'): raise ValueError('Invalid take path')
        tail = finite(req.get('tail', MAX_TAIL), 0., MAX_TAIL, 'tail')
        if plugin.is_instrument:
            hold = finite(req.get('hold'), .02, MAX_SECONDS, 'length')
            notes = req.get('notes') or []
            if not isinstance(notes, list) or not 1 <= len(notes) <= 16: raise ValueError('Choose 1 to 16 notes')
            events = []
            for n in notes:
                note = int(finite(n.get('note'), 0, 127, 'note')); vel = int(finite(n.get('velocity', 100), 1, 127, 'velocity'))
                events.append((bytes([0x90, note, vel]), 0.)); events.append((bytes([0x80, note, 0]), hold))
            audio = plugin(events, duration=hold + tail, sample_rate=rate, num_channels=2, buffer_size=512, reset=True)
            body = int(hold * rate)
        else:
            source = req.get('source')
            if not isinstance(source, str) or not source: raise ValueError('This effect needs a sample to play through it')
            dry, src_rate = read_wav(np, source)
            if src_rate != rate: dry = resample(np, dry, src_rate, rate)
            body = dry.shape[1]
            if body > rate * MAX_SECONDS * 10: raise ValueError('The sample is too long for an effect take (10 min at most)')
            padded = np.concatenate([dry, np.zeros((dry.shape[0], int(tail * rate)), dtype=np.float32)], axis=1)
            audio = plugin(padded, rate, buffer_size=512, reset=True)
        audio = np.asarray(audio, dtype=np.float32)
        if audio.ndim == 1: audio = audio[None, :]
        late = int(getattr(plugin, 'reported_latency_samples', 0) or 0)
        if 0 < late < audio.shape[1]: audio = audio[:, late:]
        audio = np.nan_to_num(audio, nan=0., posinf=0., neginf=0.)
        # The tail ends when the sound has died away (a 50 ms ring-out is kept); the held part always stays.
        level = np.max(np.abs(audio), axis=0)
        loud = np.nonzero(level > SILENCE)[0]
        if not len(loud): raise ValueError('The plugin made no sound' + (' (is it an instrument that needs a preset?)' if plugin.is_instrument else ''))
        end = min(audio.shape[1], max(body, int(loud[-1]) + int(rate * .05)))
        audio = audio[:, :end]
        peak = float(np.max(np.abs(audio)))
        write_wav(np, path, audio, rate)
        return dict(path=path, seconds=round(end / rate, 3), peak=round(peak, 4), clipped=peak >= 1.)

    def editor(self, req_id):
        plugin = self.need()
        if self.editor_close is not None: raise ValueError('The plugin window is already open')
        self.editor_close = threading.Event()
        answer(dict(id=req_id, ok=True, editor='open'))
        try: plugin.show_editor(self.editor_close)
        finally: self.editor_close = None
        return dict(editor='closed', params=self.params())


def read_wav(np, path):
    """A PCM WAV (16, 24 or 32 bit, mono or stereo) as float32 [channels, frames]."""
    with wave.open(path, 'rb') as w:
        ch, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(frames)
    if ch not in (1, 2) or width not in (2, 3, 4): raise ValueError('Only 16, 24 or 32 bit PCM WAVs can go through an effect')
    if width == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        ints = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
        ints = np.where(ints >= 1 << 23, ints - (1 << 24), ints); data = ints / float(1 << 23)
    else:
        data = np.frombuffer(raw, dtype='<i2' if width == 2 else '<i4') / float(1 << (8 * width - 1))
    return data.reshape(-1, ch).T.astype(np.float32), rate


def resample(np, data, src, dst):
    n = int(round(data.shape[1] * dst / src))
    x = np.linspace(0, data.shape[1] - 1, n)
    return np.stack([np.interp(x, np.arange(data.shape[1]), c) for c in data]).astype(np.float32)


def write_wav(np, path, audio, rate):
    """Stereo 24-bit PCM, written to a .part file first so a half take never shows in the library."""
    fade = min(audio.shape[1] // 2, max(1, int(rate * .002)))
    audio = audio.copy(); audio[:, -fade:] *= np.linspace(1., 0., fade, dtype=np.float32)
    if audio.shape[0] == 1: audio = np.vstack([audio, audio])
    ints = np.ascontiguousarray((np.clip(audio[:2].T, -1., 1.) * 8388607.).astype('<i4'))
    pcm = ints.view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    tmp = path + '.part'
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(3); w.setframerate(rate); w.writeframes(pcm)
    os.replace(tmp, path)


def main():
    global PROTOCOL
    PROTOCOL = os.fdopen(os.dup(1), 'w', buffering=1, encoding='utf-8')
    os.dup2(2, 1)                    # a plugin's own prints go to the log, never into the answers
    sys.stdout = sys.stderr
    try: os.nice(10)                 # offline renders stay behind the audio engine
    except OSError: pass
    try:
        import numpy as np
        import pedalboard as pb
    except Exception as exc:
        answer(dict(id=0, ready=False, error='Plugin hosting is not set up (%s)' % exc)); return
    answer(dict(id=0, ready=True, version=str(getattr(pb, '__version__', '?'))))
    fd=os.environ.get('DECKSYNTH_LIVE_FD');live_socket=socket.socket(fileno=int(fd)) if fd else None
    host = Host(pb, np, live_socket)
    jobs = queue.Queue()

    def reader():
        for line in sys.stdin:
            try: req = json.loads(line)
            except ValueError: continue
            if req.get('cmd') == 'editor_close':      # the window runs on the main thread: close it from here
                if host.editor_close is not None: host.editor_close.set()
                continue
            jobs.put(req)
        os._exit(0)                                   # the engine is gone (or said quit): never linger
    threading.Thread(target=reader, daemon=True).start()
    while True:
        req = jobs.get(); rid = req.get('id'); cmd = req.get('cmd')
        try:
            if cmd == 'quit': os._exit(0)
            elif cmd == 'load': out = host.load(req.get('path'), req.get('state_file'))
            elif cmd == 'set': out = host.set(req.get('index'), req.get('raw'))
            elif cmd == 'live_enable': out = host.live_enable(req.get('rate'))
            elif cmd == 'live_disable': out = host.live_disable()
            elif cmd == 'params': out = dict(params=host.params())
            elif cmd == 'render': out = host.render(req)
            elif cmd == 'editor': out = host.editor(rid)
            elif cmd == 'state': out = host.save_state(req.get('state_file'))
            else: raise ValueError('Unknown plugin command')
            answer(dict(out, id=rid, ok=True))
        except Exception as exc:
            answer(dict(id=rid, error=str(exc) or exc.__class__.__name__))


if __name__ == '__main__':
    main()
