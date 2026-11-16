"""The engine worker stops when the app is killed, so an orphaned worker never keeps playing."""
import json
import os
import select
import signal
import subprocess
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / 'ui' / 'electron' / 'bridge.py'
ENV = dict(os.environ, SDL_AUDIODRIVER='dummy', DECKSYNTH_DIAGNOSTIC='1')

# Stands in for Electron: starts the bridge, prints the bridge's pid and the worker's pid, then waits to be killed.
FAKE_APP = r'''
import json, subprocess, sys, time
bridge = subprocess.Popen([sys.executable, '-u', sys.argv[1]], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
for line in bridge.stdout:
    msg = json.loads(line)
    if msg.get('bridge') == 'ready':
        print(json.dumps({'bridge': bridge.pid, 'worker': msg['process']}), flush=True); break
time.sleep(600)
'''


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:  # a zombie still answers kill(0); it has stopped running
        with open('/proc/%d/stat' % pid) as handle: return handle.read().split(')')[-1].split()[0] != 'Z'
    except OSError:
        return False


def wait_gone(pid, timeout=6.):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if not alive(pid): return True
        time.sleep(.1)
    return False


@unittest.skipUnless(sys.platform.startswith('linux'), 'process parents are checked on Linux')
class WorkerExitTest(unittest.TestCase):
    def start(self):
        app = subprocess.Popen([sys.executable, '-c', FAKE_APP, str(BRIDGE)], stdout=subprocess.PIPE, env=ENV, cwd=str(ROOT))
        def stop():
            if app.poll() is None: app.kill()
            app.wait(); app.stdout.close()
        self.addCleanup(stop)
        ready, _, _ = select.select([app.stdout], [], [], 30)
        self.assertTrue(ready, 'bridge did not start')
        pids = json.loads(app.stdout.readline())
        self.addCleanup(lambda: [os.kill(p, signal.SIGKILL) for p in pids.values() if alive(p)])
        self.assertTrue(alive(pids['worker']))
        return app, pids

    def test_worker_exits_when_the_bridge_is_killed(self):
        _, pids = self.start()
        os.kill(pids['bridge'], signal.SIGKILL)
        self.assertTrue(wait_gone(pids['worker']), 'worker kept running after the bridge was killed')

    def test_bridge_and_worker_exit_when_the_app_is_killed(self):
        app, pids = self.start()
        app.kill(); app.wait()
        self.assertTrue(wait_gone(pids['bridge']), 'bridge kept running after the app was killed')
        self.assertTrue(wait_gone(pids['worker']), 'worker kept running after the app was killed')


if __name__ == '__main__':
    unittest.main()
