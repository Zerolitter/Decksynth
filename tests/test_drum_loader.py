"""Real threaded loader commit boundaries; no hardware or library WAVs."""
import copy
from pathlib import Path
import tempfile
import time
import unittest
import wave
from decksynth.core import Engine


class LoaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)/'hit.wav'
        with wave.open(str(self.path), 'wb') as f:
            f.setparams((1, 2, 48000, 500, 'NONE', 'PCM')); f.writeframes(b'\x00\x20'*500)
        self.e = Engine(); self.e.set_device(0, 'drum_rack')
        self.kit = self.e.project.tracks[0]['drum_rack']['id']

    def loader(self):
        from decksynth import drum_loader
        loader = drum_loader.DrumLoader(self.e)
        self.addCleanup(loader.close)
        return loader

    def finish(self, loader):
        deadline = time.monotonic()+5
        while loader.jobs and time.monotonic()<deadline:
            loader.poll(); time.sleep(.002)
        self.assertFalse(loader.jobs)

    def test_import_loading_and_commit_stay_on_captured_track(self):
        loader = self.loader()
        loader.request(0, self.kit, 0, str(self.path))
        self.assertEqual(self.e.drum_state()[0]['pads'][0]['status'], 'LOADING')
        self.e.select(1); self.finish(loader)
        self.assertIsNotNone(self.e.project.tracks[0]['drum_rack']['pads'][0]['source'])
        self.assertNotIn('drum_rack', self.e.project.tracks[1])

    def test_undo_discards_completed_but_uncommitted_import(self):
        loader = self.loader()
        loader.request(0, self.kit, 0, str(self.path))
        self.e.undo(); before = copy.deepcopy(self.e.project.data())
        self.finish(loader)
        self.assertEqual(self.e.project.data(), before)
        self.assertNotIn('device', self.e.project.tracks[0])

    def test_failed_replacement_preserves_previous_audio_and_history(self):
        self.e.import_drum_sample(0, self.kit, 0, str(self.path))
        loader = self.loader(); loader.poll(); self.finish(loader)
        before = copy.deepcopy(self.e.project.data()); history = copy.deepcopy(self.e.history)
        loader.request(0, self.kit, 0, str(self.path.with_name('missing.wav')))
        self.finish(loader)
        self.assertEqual(self.e.project.data(), before)
        self.assertEqual(self.e.history, history)
        self.assertEqual(self.e.drum_state()[0]['pads'][0]['status'], 'READY')
        self.assertTrue(self.e.drum_note(0, self.kit, 0, 100))

    def test_load_missing_reference_is_explicit_without_mutation(self):
        self.e.import_drum_sample(0, self.kit, 0, str(self.path))
        self.path.unlink(); before = copy.deepcopy(self.e.project.data())
        self.e.configure(); loader = self.loader(); loader.poll(); self.finish(loader)
        self.assertEqual(self.e.drum_state()[0]['pads'][0]['status'], 'MISSING')
        self.assertEqual(self.e.project.data(), before)
