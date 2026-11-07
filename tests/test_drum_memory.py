"""Kits are recalled without saving, replacing or overlaying a music project."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from decksynth.core import Engine, Project
from decksynth.drum_rack import new_kit, validate_kit


class DrumMemoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)

    def memory(self):
        from decksynth.drum_memory import KitMemory
        return KitMemory(self.root)

    def test_optional_kit_name_migrates_without_altering_old_kit(self):
        original=new_kit();self.assertEqual(validate_kit(original),original)
        named={**original,'name':'Legend 707'}
        self.assertEqual(validate_kit(named),named)
        for name in ['',None,'x'*81]:
            with self.assertRaises(ValueError):validate_kit({**original,'name':name})

    def test_remembered_kit_and_selected_track_survive_fresh_engine(self):
        e=Engine();e.set_device(2,'drum_rack');e.select(2)
        kit=e.project.tracks[2]['drum_rack'];kit['name']='Legend 707';kit['pads'][6]['tune']=3.
        memory=self.memory();saved=memory.capture(e);memory.write(saved)
        reopened=Engine();before=copy.deepcopy(reopened.project.data())
        memory.restore(reopened,memory.read())
        self.assertEqual(reopened.project.tracks[2]['drum_rack'],kit)
        self.assertEqual(reopened.selected,2)
        self.assertEqual(reopened.project.performance,before['performance'])
        for i in range(4):
            self.assertEqual(reopened.project.tracks[i]['notes'],before['tracks'][i]['notes'])
            self.assertEqual(reopened.project.tracks[i]['instrument'],before['tracks'][i]['instrument'])
        self.assertEqual(reopened.history,[])

    def test_memory_excludes_song_notes_and_other_instrument_state(self):
        e=Engine();e.set_device(0,'drum_rack');e.project.tracks[0]['notes']=[dict(start=0.,duration=1.,note=36,velocity=100)]
        saved=self.memory().capture(e)
        self.assertEqual(set(saved),{'version','selected','tracks'})
        self.assertEqual(set(saved['tracks'][0]),{'device','drum_rack'})
        for key in ['notes','performance','song','bpm','instrument']:
            self.assertNotIn('"'+key+'"',json.dumps(saved))

    def test_recalled_metadata_does_not_replace_existing_song_or_key_step(self):
        e=Engine();e.set_device(0,'drum_rack');memory=self.memory();saved=memory.capture(e)
        target=Engine();target.project.tracks[3]['notes']=[dict(start=1.,duration=.5,note=60,velocity=99)]
        target.project.performance['scale']['root']=7;target.project.bpm=143
        before=copy.deepcopy(target.project.data());memory.restore(target,saved)
        self.assertEqual(target.project.tracks[3]['notes'],before['tracks'][3]['notes'])
        self.assertEqual(target.project.performance,before['performance']);self.assertEqual(target.project.bpm,143)

    def test_changing_back_to_synth_remembers_that_choice_and_keeps_kit(self):
        e=Engine();e.set_device(0,'drum_rack');kit=copy.deepcopy(e.project.tracks[0]['drum_rack']);e.set_device(0,'synth')
        memory=self.memory();memory.write(memory.capture(e));new=Engine();memory.restore(new,memory.read())
        self.assertEqual(new.project.tracks[0]['device'],'synth');self.assertEqual(new.project.tracks[0]['drum_rack'],kit)

    def test_corrupt_or_oversized_memory_rejected_without_rewriting(self):
        memory=self.memory();memory.path.write_text('{bad JSON');before=memory.path.read_bytes()
        with self.assertRaises(ValueError):memory.read()
        self.assertEqual(memory.path.read_bytes(),before)
        memory.path.write_bytes(b' '*300000)
        with self.assertRaises(ValueError):memory.read()

    def test_invalid_final_kit_does_not_partially_restore(self):
        e=Engine();memory=self.memory();state=memory.capture(e)
        state['tracks'][0]={'device':'drum_rack','drum_rack':new_kit()}
        state['tracks'][3]={'device':'drum_rack','drum_rack':new_kit()};state['tracks'][3]['drum_rack']['pads'][0]['gain']=999
        before=copy.deepcopy(e.project.data())
        with self.assertRaises(ValueError):memory.restore(e,state)
        self.assertEqual(e.project.data(),before)

    def test_explicit_diagnostics_settings_isolate_real_user_data(self):
        from decksynth.drum_memory import data_directory
        with patch.dict(os.environ,{'DECKSYNTH_DIAGNOSTIC':'1'},clear=True):self.assertIsNone(data_directory())
        with patch.dict(os.environ,{'DECKSYNTH_DIAGNOSTIC':'1','DECKSYNTH_DATA_DIR':str(self.root)},clear=True):self.assertEqual(data_directory(),self.root)

    def test_atomic_memory_write_rejects_invalid_state_preserving_previous(self):
        e=Engine();memory=self.memory();state=memory.capture(e);memory.write(state);before=memory.path.read_bytes()
        bad=copy.deepcopy(state);bad['selected']=99
        with self.assertRaises(ValueError):memory.write(bad)
        self.assertEqual(memory.path.read_bytes(),before)
        self.assertFalse(list(self.root.glob('*.tmp')))
