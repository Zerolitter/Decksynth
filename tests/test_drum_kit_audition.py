"""Audition/replace browser tests with generated WAVs and real native Engine PCM.

Expected RED before implementation: explicit indexed file browsing and the
non-mutating preview bus do not exist yet.
"""
import copy
from pathlib import Path
import math
import tempfile
import time
import unittest
import wave

from decksynth.core import Engine, Project
from decksynth.drum_library import scan_library
from decksynth.drum_library_service import DrumLibraryService
from decksynth.drum_loader import DrumLoader


class KitPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folder = self.root / 'Test sounds'
        self.folder.mkdir()
        for name, freq in [('Kick',90),('Snare',330),('Hat Closed',1900)]:
            self.wav(name, freq)
        self.engine = Engine(48000)
        self.engine.set_device(0,'drum_rack')
        self.kit_id = self.engine.project.tracks[0]['drum_rack']['id']

    def wav(self, name, freq):
        path = self.folder/(name+'.wav')
        with wave.open(str(path),'wb') as f:
            f.setparams((1,2,48000,0,'NONE','PCM'))
            f.writeframes(b''.join(int(22000*math.sin(2*math.pi*freq*i/48000)).to_bytes(2,'little',signed=True) for i in range(12000)))
        return path

    def wait(self,service,stop):
        deadline = time.monotonic()+5
        while time.monotonic()<deadline:
            service.poll()
            if stop(service.snapshot()):return
            time.sleep(.004)
        self.fail('Asynchronous action failed to settle: '+str(service.snapshot()))

    def test_indexed_browse_pages_and_path_restrictions(self):
        index = scan_library(self.root)
        listing = index.browse('Test sounds',0)
        self.assertEqual(listing['total'],3)
        self.assertEqual([x['name'] for x in listing['items']],['Hat Closed','Kick','Snare'])
        self.assertEqual(index.sample_path('Test sounds',1),self.folder/'Kick.wav')
        for folder,number in [('Unknown',0),('../Test sounds',0),('Test sounds',100),('Test sounds',-1)]:
            with self.subTest(folder=folder,number=number), self.assertRaises(ValueError):
                index.sample_path(folder,number)
        with self.assertRaises(ValueError):index.browse('Test sounds',99)

    def test_audition_is_nonmutating_and_stops(self):
        service = DrumLibraryService(self.engine,directory=None)
        self.addCleanup(service.close)
        service.set_root(str(self.root))
        self.wait(service,lambda s:not s['scanning'])
        original=copy.deepcopy(self.engine.project.data())
        history=len(self.engine.history)
        service.browse_folder('Test sounds',0)
        service.preview_sample('Test sounds',1)
        self.wait(service,lambda s:s.get('preview') is not None and not s['preview'].get('loading',True))
        block=self.engine.render_stereo(2048)
        self.assertGreater(max(map(abs,block)),.02,'native preview is audible without playing SONG')
        self.assertEqual(self.engine.project.data(),original,'preview must not modify the music')
        self.assertEqual(len(self.engine.history),history)
        service.stop_preview()
        self.engine.render_stereo(12000)  # the master stage's look-ahead and 20 Hz rumble filter let the last of it out
        block=self.engine.render_stereo(2048)
        self.assertLess(max(map(abs,block)),1e-5,'stop audition silences native preview')
        self.assertEqual(self.engine.project.data(),original)

    def test_replace_is_single_atomic_undo_and_preserves_song(self):
        service=DrumLibraryService(self.engine,directory=None)
        self.addCleanup(service.close)
        loader=DrumLoader(self.engine)
        self.addCleanup(loader.close)
        service.set_root(str(self.root))
        self.wait(service,lambda s:not s['scanning'])
        expected=copy.deepcopy(self.engine.project.data())
        path=service.sample_path('Test sounds',2)
        loader.request(0,self.kit_id,2,str(path),None,name=path.stem)
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            loader.poll()
            if self.engine.project.tracks[0]['drum_rack']['pads'][2]['source'] is not None:break
            time.sleep(.004)
        pad=self.engine.project.tracks[0]['drum_rack']['pads'][2]
        self.assertEqual(pad['name'],'Snare')
        self.assertEqual(pad['source']['path'],str(path))
        self.assertEqual(len(self.engine.history),2,'set_device plus one replacement')
        self.assertEqual(self.engine.project.song,expected['song'])
        with tempfile.TemporaryDirectory() as d:
            project=Path(d)/'edited.decksynth'
            self.engine.project.save(project)
            reopened=Project.load(project)
        self.assertEqual(reopened.tracks[0]['drum_rack']['pads'][2],pad)
        self.engine.undo()
        self.assertEqual(self.engine.project.data(),expected)

    def test_untrusted_file_cannot_escape_index(self):
        index=scan_library(self.root)
        path=self.folder/'Kick.wav'
        path.unlink()
        path.symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):index.sample_path('Test sounds',1)


if __name__=='__main__':
    unittest.main()
