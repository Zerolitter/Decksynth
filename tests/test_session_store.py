"""Autosave, recovery files and On launch (Sir, 25 Nov)."""
import json
import os
import signal
import tempfile
import time
import unittest
from pathlib import Path

from decksynth.core import Project
from decksynth.session_store import Session, KEEP


class Clock:
    def __init__(self): self.t = 1000.
    def __call__(self): return self.t


class SessionStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.dir = Path(self.tmp.name)
        self.clock = Clock()

    def tearDown(self): self.tmp.cleanup()

    def session(self): return Session(self.dir, clock=self.clock)

    def test_autosave_writes_when_due_and_only_when_changed(self):
        s = self.session(); p = Project(); s.start()
        self.assertIsNone(s.tick(p))                       # not due yet
        self.clock.t += 61
        path = s.tick(p); self.assertEqual(path.name, 'Autosave.decksynth')
        self.assertEqual(Project.load(path).bpm, p.bpm)
        self.clock.t += 61
        self.assertIsNone(s.tick(p))                       # nothing changed
        p.bpm = 97; self.clock.t += 61
        self.assertIsNotNone(s.tick(p)); self.assertEqual(Project.load(self.dir/'Autosave.decksynth').bpm, 97)

    def test_off_never_writes_and_settings_are_checked_and_kept(self):
        s = self.session(); s.set(dict(autosave=0, on_launch='new')); p = Project(); s.start()
        self.clock.t += 10_000
        self.assertIsNone(s.tick(p))
        for bad in (dict(autosave=45), dict(on_launch='old'), dict(colour='red'), 'x'):
            with self.assertRaises(ValueError): s.set(bad)
        self.assertEqual(self.session().settings, dict(autosave=0, on_launch='new'))

    def test_last_project_opens_again_and_the_one_before_is_kept(self):
        s = self.session(); p = Project(); p.bpm = 123; s.start(); s.stop(p)
        again = self.session(); opened = again.start()
        self.assertEqual(Project.load(opened).bpm, 123)
        self.assertFalse(again.crashed)
        self.assertTrue(again.recovered.name.startswith('Recovered '))
        self.assertEqual(Project.load(again.recovered).bpm, 123)

    def test_new_project_on_launch_still_keeps_the_last_session(self):
        s = self.session(); s.set(dict(on_launch='new')); p = Project(); p.bpm = 88; s.start(); s.stop(p)
        again = self.session()
        self.assertIsNone(again.start())
        self.assertEqual(Project.load(again.recovered).bpm, 88)

    def test_a_crash_is_noticed_at_the_next_launch(self):
        s = self.session(); p = Project(); s.start(); self.clock.t += 61; s.tick(p)   # no stop(): it crashed
        again = self.session(); again.start()
        self.assertTrue(again.crashed)

    def test_save_now_and_recovery_files_are_capped(self):
        s = self.session(); p = Project(); s.start()
        s.rescue = True
        path = s.tick(p); self.assertTrue(path.name.startswith('Saved now '))
        for i in range(KEEP + 4):
            (self.dir/('Recovered 2026-01-%02d 000000.decksynth' % (i+1))).write_text('{}')
            os.utime(self.dir/('Recovered 2026-01-%02d 000000.decksynth' % (i+1)), (i, i))
        s._prune()
        self.assertEqual(len(list(self.dir.glob('Recovered *.decksynth'))), KEEP)

    def test_diagnostic_runs_without_a_data_dir_do_nothing(self):
        old = dict(os.environ)
        try:
            os.environ.pop('DECKSYNTH_DATA_DIR', None); os.environ['DECKSYNTH_DIAGNOSTIC'] = '1'
            s = Session(); self.assertFalse(s.on); self.assertIsNone(s.start()); self.assertIsNone(s.tick(Project(), force=True))
        finally:
            os.environ.clear(); os.environ.update(old)




class WorkerAutosaveTest(unittest.TestCase):
    """The real worker: Settings › Session reaches it, SIGUSR1 saves now, quitting leaves the autosave, and the
    next launch opens it (On launch = Last project)."""
    def run_worker(self, data, steps):
        import multiprocessing as mp, queue
        from tests.test_backend import diagnostic_worker, merge_status
        old = os.environ.get('DECKSYNTH_DATA_DIR'); os.environ['DECKSYNTH_DATA_DIR'] = data
        ctx = mp.get_context('spawn'); commands = ctx.Queue(); updates = ctx.Queue(64)
        proc = ctx.Process(target=diagnostic_worker, args=(commands, updates)); proc.start()
        if old is None: os.environ.pop('DECKSYNTH_DATA_DIR')
        else: os.environ['DECKSYNTH_DATA_DIR'] = old
        whole = {}
        def receive(predicate, wait=15):
            deadline = time.monotonic() + wait
            while time.monotonic() < deadline:
                try: obj = updates.get(timeout=.2)
                except queue.Empty: continue
                obj = merge_status(whole, obj)
                if predicate(obj): return obj
            self.fail('Timed out')
        try: return steps(commands, receive, proc)
        finally:
            commands.put(('quit', None)); proc.join(10)
            if proc.is_alive(): proc.kill()

    def test_session_settings_save_now_and_last_project(self):
        with tempfile.TemporaryDirectory() as data:
            folder = Path(data)/'autosave'
            def first(commands, receive, proc):
                state = receive(lambda o: 'state' in o and 'session' in o)
                self.assertEqual(state['session']['autosave'], 60); self.assertEqual(state['session']['on_launch'], 'last')
                commands.put(('session', dict(autosave=30)))
                receive(lambda o: o.get('session', {}).get('autosave') == 30)
                commands.put(('tempo', 111))
                receive(lambda o: o.get('state', {}).get('bpm') == 111)
                os.kill(proc.pid, signal.SIGUSR1)
                saved = receive(lambda o: str(o.get('message', '')).startswith('Saved ') and 'Saved now' in o['message'])
                files = list(folder.glob('Saved now *.decksynth'))
                self.assertTrue(files); self.assertEqual(Project.load(files[0]).bpm, 111)   # loadable, with the edit
                self.assertTrue(proc.is_alive())
                commands.put(('tempo', 122))                                    # still answering after the rescue
                receive(lambda o: o.get('state', {}).get('bpm') == 122)
            self.run_worker(data, first)
            self.assertEqual(Project.load(folder/'Autosave.decksynth').bpm, 122)   # written on quit
            def second(commands, receive, proc):
                state = receive(lambda o: 'state' in o and o['state'].get('bpm') == 122)
                self.assertEqual(state['session']['autosave'], 30)
            self.run_worker(data, second)
            self.assertTrue(list(folder.glob('Recovered *.decksynth')))


class RescueScriptTest(unittest.TestCase):
    """tools/rescue-save.sh against a real bridge + worker: a loadable recovery file appears, nothing goes
    through the command pipe, and the engine keeps answering."""
    def test_rescue_script_saves_and_engine_stays_responsive(self):
        import select, subprocess, sys
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as data:
            env = dict(os.environ, SDL_AUDIODRIVER='dummy', DECKSYNTH_DIAGNOSTIC='1', DECKSYNTH_DATA_DIR=data)
            proc = subprocess.Popen([sys.executable, '-u', str(root/'ui'/'electron'/'bridge.py')], stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=str(root), env=env, bufsize=0)
            buf = bytearray(); whole = {}
            def receive(predicate, wait=20):
                end = time.monotonic() + wait
                while time.monotonic() < end:
                    if not select.select([proc.stdout], [], [], .3)[0]: continue
                    buf.extend(os.read(proc.stdout.fileno(), 65536))
                    while b'\n' in buf:
                        line, _, rest = buf.partition(b'\n'); buf[:] = rest
                        obj = json.loads(line)
                        if not any(k in obj for k in ('message', 'bridge', 'error')):
                            for k, v in obj.items():
                                whole[k] = {**whole.get(k, {}), **v} if isinstance(v, dict) and isinstance(whole.get(k), dict) else v
                            obj = dict(whole)
                        if predicate(obj): return obj
                self.fail('Timed out')
            def send(cmd, args=None): proc.stdin.write((json.dumps(dict(cmd=cmd, args=args)) + '\n').encode())
            try:
                receive(lambda o: o.get('bridge') == 'ready'); receive(lambda o: 'state' in o)
                send('tempo', 101); receive(lambda o: o.get('state', {}).get('bpm') == 101)
                out = subprocess.run(['sh', str(root/'tools'/'rescue-save.sh'), '--pid', str(proc.pid)], env=env,
                                     capture_output=True, text=True, timeout=30)
                self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
                files = list((Path(data)/'autosave').glob('Saved now *.decksynth'))
                self.assertEqual(len(files), 1); self.assertIn(files[0].name, out.stdout)
                self.assertEqual(Project.load(files[0]).bpm, 101)
                self.assertIsNone(proc.poll())
                send('tempo', 133); receive(lambda o: o.get('state', {}).get('bpm') == 133)   # still responsive
            finally:
                try: send('quit')
                except OSError: pass
                try: proc.wait(10)
                except subprocess.TimeoutExpired: proc.kill()


if __name__ == '__main__': unittest.main()
