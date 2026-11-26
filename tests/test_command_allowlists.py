"""The Electron window and the Python bridge each keep a list of the commands they pass on. A command missing
from one of them is dropped with a confusing notice ('Restart Decksynth' or 'Unsupported DeckSynth action'),
so the two lists must hold the same commands."""
import re
import unittest
from pathlib import Path

UI = Path(__file__).resolve().parents[1] / 'ui' / 'electron'


def names(text, start, end):
    i = text.index(start); return set(re.findall(r"'([a-z_0-9]+)'", text[i:text.index(end, i)]))


class AllowlistTest(unittest.TestCase):
    def test_window_and_bridge_pass_the_same_commands(self):
        window = names((UI / 'main.cjs').read_text(), 'const COMMANDS', ']')
        bridge = names((UI / 'bridge.py').read_text(), 'COMMANDS', '}')
        self.assertEqual(sorted(window - bridge), [], 'in main.cjs but not in bridge.py')
        self.assertEqual(sorted(bridge - window), [], 'in bridge.py but not in main.cjs')
        self.assertIn('meters_watched', bridge)


if __name__ == '__main__':
    unittest.main()
