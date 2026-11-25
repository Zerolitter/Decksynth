"""Every command the engine's bridge handles must be in the Electron allowlist, or the window shows 'Restart Decksynth'."""
import re, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent

class CommandAllowlist(unittest.TestCase):
    def test_backend_commands_are_allowed_through(self):
        main = (ROOT/'ui/electron/main.cjs').read_text()
        start = main.index('const COMMANDS'); block = main[start:main.index(']);', start)]
        allowed = set(re.findall(r"'(\w+)'", block))
        handled = set(re.findall(r"cmd\s*==\s*'(\w+)'", (ROOT/'decksynth/backend.py').read_text()))
        self.assertEqual(sorted(handled - allowed - {'quit'}), [])

if __name__ == '__main__':
    unittest.main()
