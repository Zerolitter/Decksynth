import json
from pathlib import Path
import tempfile
import unittest

from tools.diagnosis_source import collect_source, verify_source_inventory


class DiagnosisSourceTests(unittest.TestCase):
    def test_engine_source_is_included_but_numeric_core_dumps_are_not(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / 'source'
            paths = ['decksynth/core.py', 'ui/src/App.tsx', 'core.1234',
                     'core.123.456', 'core.pyc', '.env.local', 'reference/private.wav']
            for name in paths:
                p = root / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text('fixture: ' + name)
            out = Path(d) / 'collected'
            report = collect_source(root, out, paths)
            self.assertEqual((out / 'workspace/decksynth/core.py').read_bytes(),
                             (root / 'decksynth/core.py').read_bytes())
            self.assertEqual({x['path'] for x in report['files']},
                             {'decksynth/core.py', 'ui/src/App.tsx'})
            self.assertEqual(len(report['excluded']), 5)
            verify_source_inventory(root, out, paths, report)

    def test_missing_tracked_engine_is_detected_even_if_included_hashes_match(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / 'source'
            (root / 'decksynth').mkdir(parents=True)
            (root / 'decksynth/core.py').write_text('source')
            (root / 'other.py').write_text('other')
            out = Path(d) / 'collected'
            paths = ['decksynth/core.py', 'other.py']
            report = collect_source(root, out, paths)
            report['files'] = [x for x in report['files'] if x['path'] != 'decksynth/core.py']
            with self.assertRaisesRegex(ValueError, 'decksynth/core.py'):
                verify_source_inventory(root, out, paths, report)

    def test_modified_collected_member_fails_hash_verification(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / 'source'
            root.mkdir()
            (root / 'main.py').write_text('source')
            out = Path(d) / 'collected'
            report = collect_source(root, out, ['main.py'])
            (out / 'workspace/main.py').write_text('modified')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                verify_source_inventory(root, out, ['main.py'], report)
