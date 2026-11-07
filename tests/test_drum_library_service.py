"""Whole-folder loads and remembered kits cross real asynchronous boundaries."""
import copy
import json
from pathlib import Path
import tempfile
import time
import unittest
import wave
from decksynth.core import Engine, Project


class LibraryServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.assets=self.root/'Samples';self.folder=self.assets/'Legend test';self.folder.mkdir(parents=True)
        for i in range(16):
            with wave.open(str(self.folder/f'Hit {i+1:02}.wav'),'wb') as f:
                f.setparams((1,2,48000,2000,'NONE','PCM'));f.writeframes((1000+i).to_bytes(2,'little',signed=True)*2000)
        self.settings=self.root/'settings';self.settings.mkdir()
        self.e=Engine();self.e.set_device(0,'drum_rack');self.kit=self.e.project.tracks[0]['drum_rack']['id']

    def service(self,e=None,directory=True):
        from decksynth.drum_library_service import DrumLibraryService
        s=DrumLibraryService(e or self.e,self.settings if directory else None);self.addCleanup(s.close)
        return s

    def wait(self,s,predicate):
        end=time.monotonic()+8
        while time.monotonic()<end:
            s.poll()
            if predicate(s.snapshot()):return
            time.sleep(.003)
        self.fail(str(s.snapshot()))

    def scanned(self):
        s=self.service();s.set_root(str(self.assets));self.wait(s,lambda state:not state['scanning'])
        self.assertEqual(len(s.snapshot()['folders']),1)
        return s

    def test_folder_load_is_one_undo_and_preserves_song_and_other_voices(self):
        s=self.scanned();before=copy.deepcopy(self.e.project.data());n=len(self.e.history)
        self.e.voice_on(1,60,100,('loop',1,0));self.e.playing=True
        s.load_folder(0,self.kit,'Legend test');self.wait(s,lambda state:not state['loading'])
        self.assertIsNone(s.snapshot()['error'])
        self.assertEqual(self.e.project.tracks[0]['drum_rack']['name'],'Legend test')
        self.assertEqual(sum(p['source'] is not None for p in self.e.project.tracks[0]['drum_rack']['pads']),16)
        self.assertEqual(len(self.e.history),n+1);self.assertTrue(self.e.playing);self.assertTrue(self.e.synths[1].voices)
        self.assertEqual(self.e.project.performance,before['performance']);self.assertEqual(self.e.project.song,before['song'])
        self.e.undo();self.assertEqual(self.e.project.data(),before)

    def test_track_selection_cannot_redirect_completed_folder(self):
        s=self.scanned();s.load_folder(0,self.kit,'Legend test');self.e.select(1)
        self.wait(s,lambda state:not state['loading'])
        self.assertEqual(self.e.project.tracks[0]['drum_rack']['name'],'Legend test');self.assertNotIn('drum_rack',self.e.project.tracks[1])

    def test_edit_or_undo_during_load_rejects_stale_result(self):
        s=self.scanned();s.load_folder(0,self.kit,'Legend test')
        self.e.edit_drum_pad(0,self.kit,0,'tune',5);before=copy.deepcopy(self.e.project.data());history=copy.deepcopy(self.e.history)
        self.wait(s,lambda state:not state['loading'])
        self.assertEqual(self.e.project.data(),before);self.assertEqual(self.e.history,history)
        self.assertTrue(s.snapshot()['error'])

    def test_invalid_last_sample_preserves_current_kit_and_history(self):
        s=self.scanned();(self.folder/'Hit 16.wav').write_bytes(b'corrupt')
        before=copy.deepcopy(self.e.project.data());history=copy.deepcopy(self.e.history)
        s.load_folder(0,self.kit,'Legend test');self.wait(s,lambda state:not state['loading'])
        self.assertEqual(self.e.project.data(),before);self.assertEqual(self.e.history,history);self.assertTrue(s.snapshot()['error'])

    def test_kit_and_edits_reappear_on_fresh_start_without_import(self):
        s=self.scanned();s.load_folder(0,self.kit,'Legend test');self.wait(s,lambda state:not state['loading'])
        kit=self.e.project.tracks[0]['drum_rack'];self.e.edit_drum_pad(0,kit['id'],3,'tune',7)
        s.observe();s.close()
        restarted=Engine();new=self.service(restarted)
        self.assertEqual(restarted.project.tracks[0]['drum_rack']['pads'][3]['tune'],7)
        self.assertEqual(restarted.project.tracks[0]['drum_rack']['name'],'Legend test')
        self.assertEqual(new.snapshot()['root'],str(self.assets.resolve()))
        restarted.load_drum_sources();self.assertTrue(all(p['status']=='READY' for p in restarted.drum_state()[0]['pads']))

    def test_library_root_cannot_change_while_a_kit_is_pending(self):
        s=self.scanned();s.load_folder(0,self.kit,'Legend test')
        other=self.root/'Other samples';other.mkdir()
        with self.assertRaises(ValueError):s.set_root(str(other))
        self.wait(s,lambda state:not state['loading'])
        self.assertEqual(s.snapshot()['root'],str(self.assets.resolve()))
        self.assertEqual(self.e.project.tracks[0]['drum_rack']['name'],'Legend test')

    def test_project_load_not_overlaid_with_remembered_kit(self):
        s=self.scanned();s.load_folder(0,self.kit,'Legend test');self.wait(s,lambda state:not state['loading'])
        self.e.project=Project();self.e.configure();before=copy.deepcopy(self.e.project.data())
        s.poll();self.assertEqual(self.e.project.data(),before)

    def test_repeated_unchanged_observe_does_not_write_per_frame(self):
        s=self.scanned();s.observe();s.close()
        path=self.settings/'last-drum-kits.json';before=path.stat().st_mtime_ns
        fresh=self.service()  # The same restored engine/state is stable.
        for _ in range(20):fresh.observe();fresh.poll()
        fresh.close();self.assertEqual(path.stat().st_mtime_ns,before)

    def test_memory_write_error_clears_after_real_filesystem_recovery(self):
        blocked=self.settings/'last-drum-kits.json';blocked.mkdir()
        s=self.service()
        self.e.edit_drum_pad(0,self.kit,0,'tune',1);s.observe()
        self.wait(s,lambda state:bool(state['memory_error']) and 'remember' in state['memory_error'])
        blocked.rmdir()
        self.e.edit_drum_pad(0,self.kit,0,'tune',2);s.observe()
        self.wait(s,lambda state:blocked.is_file() and state['memory_error'] is None)
        self.assertEqual(json.loads(blocked.read_text())['tracks'][0]['drum_rack']['pads'][0]['tune'],2)

    def test_disabled_settings_never_touch_a_user_data_directory(self):
        s=self.service(directory=False);s.observe();s.close()
        self.assertEqual(list(self.settings.iterdir()),[])
