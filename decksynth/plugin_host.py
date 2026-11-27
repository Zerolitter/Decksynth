"""VST3 plugins in Decksynth (27 Nov): find plugins, load one into the plugin helper (plugin_worker.py, its own
process), turn its parameters, open its own window, and record what it plays as a sample.

Everything here runs between audio blocks and stays small: the helper process does the plugin work, two reader
threads only move lines from its pipes, and folder scans run in a thread (file I/O only). poll() hands the backend
what came back: messages for the screen and finished takes to load into a Sampler.

Windows plugins work when yabridge has made a Linux VST3 for them (in ~/.vst3/yabridge) and yabridge itself is
installed where Decksynth runs. VST2 plugins are listed but not hosted (pedalboard hosts VST3 only on Linux)."""
import hashlib
import json
import os
import queue
import shlex
import subprocess
import sys
import threading
import time
import socket
import struct
from array import array
from collections import deque
from pathlib import Path

WORKER = Path(__file__).with_name('plugin_worker.py')
SETUP = Path(__file__).with_name('plugin_setup.py')
VST3_HOST = Path(__file__).with_name('native') / 'prebuilt' / 'decksynth_vst3_host'
DEV_VST3_HOST = Path(__file__).parent.parent / '.tools' / 'vst3-host-bin' / 'decksynth_vst3_host'
MAX_PLUGINS = 400
MAX_DEPTH = 4
LOAD_TIMEOUT = 20.
MAX_LIVE_EVENTS = 512                              # the helpers' limit per block
ALL_NOTES_OFF = b'\xb0\x7b\x00'                     # MIDI CC 123, channel 1
NOTE_NAMES = ('C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B')


def note_name(n):
    return '%s%d' % (NOTE_NAMES[n % 12], n // 12 - 2)    # 60 = C3, as on the Decksynth keys


def _env_paths(name):
    return [p for p in os.environ.get(name, '').split(':') if p]


def vst3_folders(home=None):
    home = Path(home or Path.home())
    return _env_paths('VST3_PATH') + [str(home / '.vst3'), '/usr/lib/vst3', '/usr/local/lib/vst3', str(home / '.local/lib/vst3')]


def vst2_folders(home=None):
    home = Path(home or Path.home())
    return _env_paths('VST_PATH') + [str(home / '.vst'), str(home / '.lxvst'), '/usr/lib/vst', '/usr/lib/lxvst', '/usr/local/lib/vst']


def scan(vst3=None, vst2=None):
    """Plugins in the usual Linux folders: [{path, name, windows}] for VST3 bundles, and how many VST2 files there are."""
    found, seen, vst2_count = [], set(), 0

    def walk(folder, depth, on_hit, is_hit):
        try: entries = sorted(os.scandir(folder), key=lambda e: e.name.lower())
        except OSError: return
        for e in entries:
            if len(found) >= MAX_PLUGINS: return
            if is_hit(e): on_hit(e)
            elif depth < MAX_DEPTH and e.is_dir(follow_symlinks=True) and not e.name.startswith('.'): walk(e.path, depth + 1, on_hit, is_hit)

    def vst3_hit(e):
        real = os.path.realpath(e.path)
        if real in seen: return
        seen.add(real)
        windows = os.path.isdir(os.path.join(e.path, 'Contents', 'x86_64-win')) or '/yabridge/' in e.path + '/'
        found.append(dict(path=e.path, name=e.name[:-5][:80], windows=windows))

    def vst2_hit(e):
        nonlocal vst2_count
        vst2_count += 1

    for f in vst3 if vst3 is not None else vst3_folders():
        walk(f, 0, vst3_hit, lambda e: e.name.lower().endswith('.vst3'))
    for f in vst2 if vst2 is not None else vst2_folders():
        walk(f, 0, vst2_hit, lambda e: e.name.endswith('.so') and e.is_file())
    found.sort(key=lambda p: p['name'].lower())
    return found, vst2_count


def friendly(error, log, plugin=None):
    """Turns what a plugin or yabridge said into something Sir can act on."""
    text = ' '.join(log)
    if 'libyabridge' in text or 'yabridge-host' in text:
        return ('%s is a Windows plugin through yabridge, and yabridge is not installed where Decksynth runs. '
                'Install yabridge for this user (~/.local/share/yabridge) to use it.' % (plugin or 'This'))
    if 'wine' in text.lower() and 'not found' in text.lower():
        return 'Wine was not found: Windows plugins need Wine and yabridge'
    if 'Unable to scan plugin' in error or 'unsupported plugin format' in error:
        return '%s could not be opened: it is not a Linux VST3, or it is damaged' % (plugin or 'The plugin')
    return error


class PluginHost:
    def __init__(self, directory, rate, python=None, vst3_host=None):
        self.folder = Path(directory) / 'plugin-host' if directory else None
        self.rate = int(rate)
        self.python = os.environ.get('DECKSYNTH_PLUGIN_PYTHON') or python or sys.executable
        self.vst3_host = vst3_host
        self.lib = os.environ.get('DECKSYNTH_PLUGIN_PATH') or (str(self.folder / ('cp%d%d' % sys.version_info[:2])) if self.folder else '')
        self.proc = None; self.lines = queue.Queue(); self.log = deque(maxlen=40)
        self.next_id = 1; self.pending = {}
        self.ready = None; self.version = None; self.native_version = None  # None: the helper has not answered yet
        self.plugins = []; self.vst2 = 0; self.scanning = False; self.scanned = False
        self.loaded = None; self.busy = None; self.editor = False; self.load_deadline = None
        self.setup = None                              # a running set up: dict(proc, progress)
        self.take = None; self.error = None; self.live_socket = None; self.live_blocks = deque(maxlen=8); self.live_seq = 0; self.live_reply_seq = 0; self.live_delay_blocks = 0; self.live_fault = None; self.live_reset = False
        self.revision = 0; self._scan_result = None
        self._listen = None; self.listening = None
        self.backend = None

    # -- status ---------------------------------------------------------------------------------
    def installed(self):
        return bool(os.environ.get('DECKSYNTH_PLUGIN_PATH')) or bool(self.lib and Path(self.lib, 'pedalboard').is_dir())

    def _vst3_host_command(self):
        """The separate JUCE host for Windows VST3s, never needed for native Linux plugins."""
        if self.vst3_host is not None:
            return list(self.vst3_host)
        configured = os.environ.get('DECKSYNTH_VST3_HOST')
        if configured:
            return shlex.split(configured)
        for candidate in (VST3_HOST, DEV_VST3_HOST):
            if candidate.is_file() and os.access(candidate, os.X_OK): return [str(candidate)]
        return None

    def native_ready(self):
        command = self._vst3_host_command()
        return bool(command and Path(command[0]).is_file() and os.access(command[0], os.X_OK))

    def status(self):
        setup = 'installing' if self.setup else 'ready' if self.installed() and self.ready is not False else 'missing'
        return dict(setup=setup, progress=round(self.setup['progress'], 3) if self.setup else None, version=self.version,
                    native_ready=self.native_ready(), native_version=self.native_version,
                    plugins=self.plugins, vst2=self.vst2, scanning=self.scanning, scanned=self.scanned,
                    loaded=dict(self.loaded, editor=self.editor, live=bool(self.loaded and self.loaded.get('live')), live_fault=self.live_fault) if self.loaded else None, busy=self.busy,
                    take=self.take, error=self.error, listening=self.listening, revision=self.revision)

    # -- folders --------------------------------------------------------------------------------
    def rescan(self):
        if self.scanning: return
        self.scanning = True

        def work():
            try: self._scan_result = scan()
            except Exception: self._scan_result = ([], 0)
        threading.Thread(target=work, name='plugin-scan', daemon=True).start()

    # -- set up ---------------------------------------------------------------------------------
    def start_setup(self):
        if self.folder is None: raise ValueError('Decksynth has no data folder to keep the plugin libraries in')
        if self.setup: raise ValueError('Plugin hosting is already being set up')
        self.folder.mkdir(parents=True, exist_ok=True)
        proc = subprocess.Popen([sys.executable, '-I', str(SETUP), str(self.folder)], stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        self.setup = dict(proc=proc, progress=0., lines=queue.Queue())
        threading.Thread(target=self._pump, args=(proc.stdout, self.setup['lines']), name='plugin-setup', daemon=True).start()
        self.error = None

    # -- the helper process ---------------------------------------------------------------------
    @staticmethod
    def _pump(stream, sink, also=None):
        try:
            for line in stream:
                sink.put(line)
                if also is not None: also.append(line.strip()[:300])
        except (OSError, ValueError): pass
        sink.put(None)

    def _start(self, backend=None):
        if self.proc is not None and self.proc.poll() is None: return
        backend = backend or self.backend or 'pedalboard'
        env = dict(os.environ)
        if backend == 'juce':
            command = self._vst3_host_command()
            if not command or not self.native_ready():
                raise ValueError('The native VST3 host is unavailable; install the Decksynth JUCE helper to use Windows plugins through yabridge')
        else:
            if not self.installed(): raise ValueError('Set up plugin hosting first')
            command = [self.python, '-u', str(WORKER)]
            env.update(PYTHONPATH=self.lib, PYTHONNOUSERSITE='1')
        parent,child=socket.socketpair(); child.set_inheritable(True); env['DECKSYNTH_LIVE_FD']=str(child.fileno())
        self.proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, env=env, start_new_session=True, bufsize=1, pass_fds=(child.fileno(),))
        child.close(); self.live_socket = parent; self.live_blocks.clear(); self.live_fault = None
        self.live_seq = 0; self.live_reply_seq = 0; self.live_delay_blocks = 3 if backend == 'juce' else 0
        self.lines = queue.Queue(); self.log.clear(); self.ready = None
        threading.Thread(target=self._pump, args=(self.proc.stdout, self.lines), name='plugin-out', daemon=True).start()
        threading.Thread(target=self._pump, args=(self.proc.stderr, queue.Queue(), self.log), name='plugin-log', daemon=True).start()
        threading.Thread(target=self._live_reader, args=(parent,), name='plugin-live-audio', daemon=True).start()

    def _live_reader(self, sock):
        """Live audio replies from the helper: (sequence, frames, interleaved float32 L R ...). This thread owns
        one helper's socket, so a reader left over from an earlier helper can never read the new one. Each block
        is split into left/right double arrays here, so the audio loop only adds them to its mix in C."""
        try:
            while True:
                head = self._recv_exact(sock, 6)
                if head is None: break
                seq, frames = struct.unpack('<IH', head); raw = self._recv_exact(sock, frames * 8)
                if raw is None: break
                block = array('f'); block.frombytes(raw)
                if sys.byteorder != 'little': block.byteswap()
                self.live_reply_seq = max(self.live_reply_seq, seq + 1)
                self.live_blocks.append((seq, (array('d', block[0::2]), array('d', block[1::2]))))
        except OSError: pass
        if sock is self.live_socket and self.loaded and self.loaded.get('live'):
            self._live_failed('Live renderer stopped')

    @staticmethod
    def _recv_exact(sock, n):
        out = bytearray()
        while len(out) < n:
            part = sock.recv(n - len(out))
            if not part: return None
            out += part
        return bytes(out)

    def _live_failed(self, why):
        """Live audio stops (the helper fell behind or went away); the screen shows why and Live turns off."""
        self.live_fault = why
        if self.loaded: self.loaded['live'] = False
        self.revision += 1

    def _send(self, cmd, ctx=None, backend=None, **fields):
        self._start(backend)
        rid = self.next_id; self.next_id += 1
        self.pending[rid] = (cmd, ctx or {})
        try:
            self.proc.stdin.write(json.dumps(dict(fields, id=rid, cmd=cmd)) + '\n'); self.proc.stdin.flush()
        except (OSError, ValueError):
            self.pending.pop(rid, None); raise ValueError('The plugin helper stopped; load the plugin again')
        return rid

    def stop(self):
        """Ends the helper (a hung plugin, or Unload). Its window, if open, closes with it."""
        if self.proc is not None: self._drop(self.proc)
        sock, self.live_socket = self.live_socket, None
        if sock is not None:
            try: sock.shutdown(socket.SHUT_RDWR)          # wakes its reader thread
            except OSError: pass
            sock.close()
        self.proc = None; self.pending.clear(); self.loaded = None; self.busy = None; self.editor = False
        self.live_blocks.clear(); self.live_fault = None; self.backend = None
        self.revision += 1

    @staticmethod
    def _drop(proc):
        """Ends a helper and closes its pipes. Closing stdin makes it quit, even mid-render; one that hangs is killed
        after a second. The waiting happens in a thread, never between audio blocks."""
        try: proc.stdin.close()
        except (OSError, ValueError): pass

        def reap():
            try: proc.wait(timeout=1)
            except Exception:
                try: proc.kill(); proc.wait(timeout=2)
                except Exception: pass
            for stream in (proc.stdout, proc.stderr):
                try: stream.close()
                except (OSError, ValueError): pass
        threading.Thread(target=reap, name='plugin-reap', daemon=True).start()

    def close(self):
        self.stop()
        if self.setup:
            try: self.setup['proc'].kill()
            except Exception: pass
            self.setup = None

    # -- what Sir does ----------------------------------------------------------------------------
    def _state_file(self, path):
        return self.folder / 'states' / (hashlib.sha1(path.encode('utf-8', 'replace')).hexdigest()[:16] + '.json') if self.folder else None

    def load(self, path, track=None):
        """Loads one plugin; `track` is the Plugin track it plays on (its notes and audio), or None."""
        plugin = next((p for p in self.plugins if p['path'] == path), None)
        if not isinstance(path, str) or plugin is None: raise ValueError('Choose a plugin from the list')
        if self.busy: raise ValueError('Wait until the plugin is done')
        if self.editor: raise ValueError('Close the plugin window first')
        f = self._state_file(path)
        name = plugin['name']; backend = 'juce' if plugin.get('windows') else 'pedalboard'
        self.stop()                                    # one plugin at a time: a fresh helper for each
        self.error = None; self.busy = 'loading'; self.load_deadline = time.monotonic()+LOAD_TIMEOUT; self.backend = backend
        try:
            self._send('load', dict(path=path, name=name, track=track), backend=backend, path=path, rate=self.rate, state_file=str(f) if f else None)
        except Exception:
            self.busy = None; self.load_deadline = None; self.backend = None
            raise

    def set_param(self, index, raw):
        if not self.loaded: raise ValueError('Load a plugin first')
        if type(index) is not int or type(raw) not in (int, float) or not 0. <= raw <= 1.: raise ValueError('Invalid parameter value')
        self._send('set', None, index=index, raw=float(raw))

    def request_params(self, offset=0, query=None):
        """Fetch one bounded JUCE parameter page; native Pedalboard params are already local."""
        if not self.loaded: raise ValueError('Load a plugin first')
        if self.backend != 'juce': return
        if type(offset) is not int or offset < 0: raise ValueError('Invalid parameter page')
        if query is not None and not isinstance(query, str): raise ValueError('Invalid parameter search')
        self._send('params', dict(path=self.loaded['path']), offset=offset, query=(query or '')[:80])

    def set_live(self, enabled):
        if not self.loaded: raise ValueError('Load a plugin first')
        if enabled and self.loaded.get('kind')!='instrument': raise ValueError('Live mode is for instrument plugins')
        self.loaded['live'] = bool(enabled); self.live_fault = None
        # Notes held while Live was off (or before it fell behind) would hang in the plugin: release them first.
        self.live_reset = bool(enabled)
        self._send('live_enable' if enabled else 'live_disable', rate=self.rate)

    def send_live(self, events, frames=256):
        """Called by the audio loop after each block: send that block's MIDI to the helper. Never waits."""
        if not self.loaded or not self.loaded.get('live') or self.live_socket is None: return
        # live_blocks is not an in-flight counter (pull_live() may already have mixed a reply); the reader's
        # acknowledged sequence is. More than four blocks without a reply: the renderer cannot keep up.
        if self.live_seq - self.live_reply_seq > 4: self._live_failed('Live renderer fell behind'); return
        if self.live_reset: events = [(0, ALL_NOTES_OFF)] + list(events); self.live_reset = False
        events = events[:MAX_LIVE_EVENTS]
        body = b''.join(struct.pack('<H3s', int(at), msg) for at, msg in events)
        try:
            # MSG_DONTWAIT: a full socket means the helper is stuck; that is a fault, never a wait in the audio loop.
            packet = struct.pack('<IHH', self.live_seq, int(frames), len(events)) + body
            if self.live_socket.send(packet, socket.MSG_DONTWAIT) != len(packet):
                self.live_socket.shutdown(socket.SHUT_RDWR)   # half a block would garble every later one
                raise OSError('partial live block')
            self.live_seq += 1
        except OSError: self._live_failed('Live renderer stopped')

    def pull_live(self, frames=256):
        """Called by the audio loop before each block: the helper's audio as a (left, right) pair, or None."""
        if not self.loaded or not self.loaded.get('live'): return None
        # yabridge/Wine returns a block a little after its MIDI block. A bounded playout delay mixes ordered
        # audio instead of continually discarding the just-late block. A block that is still missing is silence.
        wanted = self.live_seq - 1 - self.live_delay_blocks
        if wanted < 0: return None
        blocks = self.live_blocks
        while blocks and blocks[0][0] < wanted: blocks.popleft()
        if blocks and blocks[0][0] == wanted:
            block = blocks.popleft()[1]
            return block if len(block[0]) == frames else None
        return None

    def open_editor(self):
        if not self.loaded: raise ValueError('Load a plugin first')
        if self.busy: raise ValueError('Wait until the plugin is done')
        if self.editor: return
        self.editor = True; self._send('editor')

    def close_editor(self):
        if self.editor and self.proc is not None:
            try: self.proc.stdin.write(json.dumps(dict(id=0, cmd='editor_close')) + '\n'); self.proc.stdin.flush()
            except (OSError, ValueError): pass

    def render(self, path, ctx, notes=None, hold=None, source=None):
        """A take: notes for an instrument (held `hold` seconds, then the tail until it is quiet), or the sample at
        `source` through an effect. `ctx` comes back with the finished take (where it goes)."""
        if not self.loaded: raise ValueError('Load a plugin first')
        if self.busy: raise ValueError('Wait until the plugin is done')
        if self.loaded.get('live'): raise ValueError('Stop live audio before rendering a take')
        if self.editor: raise ValueError('Close the plugin window first: it is using the plugin')
        self.busy = ctx.get('mode', 'record'); self.error = None
        self._send('render', ctx, path=str(path), rate=self.rate, notes=notes or [], hold=hold, source=source)

    def listen_load(self, path):
        """Plays a Listen take: the WAV loads in a thread (file I/O and the C decoder), poll() hands it over."""
        from .samples import SampleCache
        result = {}

        def work():
            try: result['sample'] = SampleCache(self.rate, 64 * 1024 * 1024).load(str(path))
            except Exception as exc: result['error'] = str(exc)
        t = threading.Thread(target=work, name='plugin-listen', daemon=True); t.start()
        self._listen = (t, result)

    # -- poll, between audio blocks --------------------------------------------------------------
    def poll(self):
        """Returns [events]: dict(message=...), dict(error=...), dict(plugin_params=...), dict(plugin_param=...),
        dict(take=..., ctx=...) and dict(listen=sample)."""
        out = []
        if self._scan_result is not None:
            self.plugins, self.vst2 = self._scan_result; self._scan_result = None
            self.scanning = False; self.scanned = True; self.revision += 1
        if self._listen is not None and not self._listen[0].is_alive():
            res = self._listen[1]; self._listen = None
            if 'sample' in res: out.append(dict(listen=res['sample']))
            else: out.append(dict(error='Could not play the take: ' + res.get('error', '?')))
        if self.setup:
            q = self.setup['lines']
            while True:
                try: line = q.get_nowait()
                except queue.Empty: break
                if line is None:
                    code = self.setup['proc'].wait(); self.setup = None; self.revision += 1
                    if code == 0 and self.installed():
                        self.ready = None; out.append(dict(message='Plugin hosting is set up'))
                    elif not self.error: self.error = 'Set up did not finish'
                    if self.error: out.append(dict(error='Plugin set up: ' + self.error))
                    break
                try: msg = json.loads(line)
                except ValueError: continue
                if 'progress' in msg: self.setup['progress'] = float(msg['progress'])
                if msg.get('error'): self.error = str(msg['error'])[:300]
        if self.busy=='loading' and self.load_deadline is not None and time.monotonic()>=self.load_deadline:
            self.stop(); self.load_deadline=None
            self.error='Plugin load timed out after %d seconds; this VST is not responding' % LOAD_TIMEOUT
            out.append(dict(error='Plugin: '+self.error)); return out
        if self.proc is None: return out
        while True:
            try: line = self.lines.get_nowait()
            except queue.Empty: break
            if line is None:                               # the helper ended
                crashed = bool(self.loaded or self.pending)
                name = self.loaded['name'] if self.loaded else None
                waiting = [c for c, _ in self.pending.values()]
                self._drop(self.proc)
                self.proc = None; self.pending.clear(); self.loaded = None; self.busy = None; self.editor = False; self.backend = None; self.revision += 1
                if crashed:
                    why = friendly('', list(self.log), name)
                    self.error = why or ('The plugin stopped (it may have crashed). Decksynth is fine: load it again.')
                    out.append(dict(error=self.error if why else 'Plugin: ' + self.error))
                elif waiting: out.append(dict(error='The plugin helper stopped'))
                return out
            try: msg = json.loads(line)
            except ValueError: continue
            rid = msg.get('id')
            if rid == 0:                                   # the hello
                self.ready = bool(msg.get('ready'))
                if self.backend == 'juce': self.native_version = msg.get('version')
                else: self.version = msg.get('version')
                self.revision += 1
                if not self.ready: self.error = str(msg.get('error', 'Plugin hosting is not set up'))[:300]; out.append(dict(error=self.error))
                continue
            if rid not in self.pending: continue
            cmd, ctx = self.pending[rid]
            if cmd == 'editor' and msg.get('editor') == 'open': continue    # the window is open; its close answers again
            self.pending.pop(rid)
            err = msg.get('error')
            if cmd == 'load':
                self.busy = None; self.load_deadline = None; self.revision += 1
                if err:
                    self.error = friendly(str(err), list(self.log), ctx.get('name'))[:400]; out.append(dict(error=self.error))
                    continue
                self.loaded = dict(path=ctx['path'], name=msg.get('name') or ctx['name'], vendor=msg.get('vendor', ''),
                                   kind=msg.get('kind', 'effect'), paged=self.backend == 'juce', track=ctx.get('track'),
                                   auto_live=ctx.get('track') is not None)
                out.append(self._parameter_event(ctx['path'], msg))
                out.append(dict(message='%s is ready (%s)' % (self.loaded['name'], 'instrument' if self.loaded['kind'] == 'instrument' else 'effect')))
            elif cmd == 'set':
                if err: out.append(dict(error='Plugin: ' + str(err)))
                else: out.append(dict(plugin_param=dict(i=msg['i'], raw=msg['raw'], text=msg.get('text', ''))))
            elif cmd == 'params':
                if err: out.append(dict(error='Plugin: ' + str(err)))
                else: out.append(self._parameter_event(ctx['path'], msg))
            elif cmd in ('live_enable', 'live_disable'):
                if err:
                    # set_live() updates optimistically so the audio loop can start on the
                    # next block. A native helper may still reject its socket, though; never
                    # leave the UI claiming a live renderer exists in that case.
                    if self.loaded: self.loaded['live'] = False
                    self.live_fault = str(err)[:300]
                    self.error = 'Live audio: ' + self.live_fault
                    self.revision += 1
                    out.append(dict(error=self.error))
                elif self.loaded:
                    self.loaded['live'] = bool(msg.get('live'))
                    self.live_fault = None
                    self.revision += 1
            elif cmd == 'editor':
                self.editor = False; self.revision += 1
                if err: out.append(dict(error='Plugin window: ' + friendly(str(err), list(self.log))))
                elif self.loaded: out.append(dict(plugin_params=dict(path=self.loaded['path'], params=msg.get('params', []))))
                self._remember()
            elif cmd == 'render':
                self.busy = None; self.revision += 1
                if err: self.error = str(err)[:300]; out.append(dict(error='Plugin take: ' + self.error))
                else:
                    out.append(dict(take=dict(path=msg['path'], seconds=msg.get('seconds', 0.), peak=msg.get('peak', 0.), clipped=bool(msg.get('clipped'))), ctx=ctx))
                    self._remember()
        return out

    @staticmethod
    def _parameter_event(path, msg):
        params = dict(path=path, params=msg.get('params', []))
        for key in ('parameter_count', 'parameter_offset'):
            if isinstance(msg.get(key), int): params[key] = msg[key]
        return dict(plugin_params=params)

    def _remember(self):
        """Keeps the plugin's own settings for next time (asked after a take or a closed window)."""
        if self.loaded and self.folder is not None:
            try: self._send('state', None, state_file=str(self._state_file(self.loaded['path'])))   # the helper writes it
            except ValueError: pass

