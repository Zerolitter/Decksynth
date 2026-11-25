"""A worker whose window has gone must end (25 Nov: one kept playing and crackling for 20 minutes), and deck_busy.sh must see an orphan."""
import os
import subprocess
import threading
import unittest
from pathlib import Path

from decksynth.backend import parent_watchdog

ROOT = Path(__file__).resolve().parents[1]


class WatchdogTest(unittest.TestCase):
    def test_exits_after_the_grace_once_the_parent_is_gone(self):
        done = threading.Event(); codes = []
        parent_watchdog(os.getpid() + 999999, grace=.05, poll=.01, exit=lambda c: (codes.append(c), done.set()))
        self.assertTrue(done.wait(3)); self.assertEqual(codes, [0])

    def test_stays_while_the_parent_lives(self):
        codes = []
        t = parent_watchdog(os.getppid(), grace=0, poll=.01, exit=codes.append)
        t.join(.3); self.assertTrue(t.is_alive()); self.assertEqual(codes, [])


class DeckBusyTest(unittest.TestCase):
    def test_script_is_valid_and_lists_nothing_extra_for_this_test(self):
        self.assertEqual(subprocess.run(['sh', '-n', str(ROOT / 'tools/deck_busy.sh')]).returncode, 0)
        out = subprocess.run(['sh', str(ROOT / 'tools/deck_busy.sh'), '--list'], capture_output=True, text=True).stdout.split()
        self.assertNotIn(str(os.getpid()), out)


if __name__ == '__main__':
    unittest.main()
