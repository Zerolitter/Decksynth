"""Draft kit is validated importer input, never the native project schema."""
import copy
from pathlib import Path
import tempfile
import unittest
import wave
from decksynth.core import Engine


class KitImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name); self.path=self.root/'hit.wav'
        with wave.open(str(self.path),'wb') as f:
            f.setparams((1,2,44100,1000,'NONE','PCM'));f.writeframes(b'\x00\x10'*1000)
        self.e=Engine();self.e.set_device(0,'drum_rack')
        sha=self.e.sample_cache.load(self.path).sha256
        self.draft=dict(schema='decksynth.drumrack-starter.evaluation.v1',pads=[
            dict(pad=i+1,midi_note=36+i,label='Pad '+str(i+1),relative_wav='hit.wav',sha256=sha,
                 one_shot=True,gain_db=-6.,pan=0,choke_group=1 if i in (6,7) else None) for i in range(16)])

    def importer(self):
        self.assertTrue(hasattr(self.e,'import_reference_drum_kit'),'Validated reference kit importer is required')
        return self.e.import_reference_drum_kit

    def test_atomic_import_and_one_undo_preserve_song(self):
        before=copy.deepcopy(self.e.project.data());n=len(self.e.history)
        self.importer()(0,self.draft,self.root)
        self.assertEqual(len(self.e.history),n+1)
        self.assertEqual(self.e.project.performance,before['performance'])
        self.assertAlmostEqual(self.e.project.tracks[0]['drum_rack']['pads'][0]['gain'],.5011872336272722)
        self.assertEqual(self.e.project.tracks[0]['drum_rack']['pads'][6]['choke'],1)
        self.assertNotIn('schema',self.e.project.data())
        self.e.undo();self.assertEqual(self.e.project.data(),before)

    def test_invalid_final_asset_mapping_and_traversal_leave_project_unchanged(self):
        before=copy.deepcopy(self.e.project.data());history=copy.deepcopy(self.e.history)
        for key,value in [('sha256','0'*64),('midi_note',99),('relative_wav','../hit.wav'),('pan',.5),('one_shot',False)]:
            with self.subTest(key=key):
                draft=copy.deepcopy(self.draft);draft['pads'][15][key]=value
                with self.assertRaises(ValueError):self.importer()(0,draft,self.root)
                self.assertEqual(self.e.project.data(),before);self.assertEqual(self.e.history,history)
