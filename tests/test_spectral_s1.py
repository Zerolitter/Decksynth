import copy
import hashlib
import json
import math
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from decksynth import core
from decksynth.core import Engine, Project, Synth, spectral_gain
from tests.test_voice_cards import tone, power

FIXTURES = Path(__file__).parent / 'fixtures'


class SpectralS1Tests(unittest.TestCase):
    def test_native_table_bound_matches_python_and_never_prepares_in_rendering(self):
        from decksynth.spectral_native import prepare_kernel, bound_table
        import ctypes
        kernel=prepare_kernel()
        if kernel is None:self.skipTest('optional spectral table accelerator not built')
        table=(ctypes.c_double*4)(.5,-2.,1.5,0.)
        scale=bound_table(table);self.assertEqual(scale,2.);self.assertEqual(list(table),[.25,-1.,.75,0.])
        self.assertIsNone(bound_table([.5,-2.]))
        with patch('decksynth.spectral_native.library_path',side_effect=AssertionError('I/O in table preparation')):
            s=Synth();s.configure({**s.params,'spectral_energy':1,'character':.5});s.on(60,100);s.render(256)

    def test_seed_repeatability_bounds_and_new_seed(self):
        from decksynth.spectral import SHAPES, seed_shape, next_seed
        self.assertEqual(set(SHAPES), {'SAW','SQUARE','TRIANGLE','PULSE','GAUSSIAN','SPREAD','RANDOM'})
        for seed in (0, 1, 42, 2**32-1):
            h = seed_shape('RANDOM', seed)
            self.assertEqual(len(h), 16)
            self.assertEqual(h, seed_shape('RANDOM', seed))
            self.assertTrue(all(math.isfinite(v) and 0<=v<=1 for v in h))
            self.assertNotEqual(h, seed_shape('RANDOM', next_seed(seed)))
        for name in SHAPES:
            self.assertEqual(len(seed_shape(name, 1)), 16)
        for seed in (-1, 2**32, True, .5, float('nan')):
            with self.subTest(seed=seed), self.assertRaises(ValueError):seed_shape('RANDOM', seed)

    def test_character_odd_even_fft_and_saved_partials(self):
        flat = {'harmonics':[1.]*16, 'filter':1., 'modulation':0.}
        odd = tone({**flat,'character':1.}, frames=24000)
        even = tone({**flat,'character':-1.}, frames=24000)
        self.assertGreater(power(odd,220), power(odd,440)*100)
        self.assertGreater(power(even,440), power(even,220)*100)
        self.assertEqual(spectral_gain({'character':1.},2),0)
        self.assertEqual(spectral_gain({'character':-1.},1),0)
        self.assertEqual(spectral_gain({'character':0.},2),1)
        s=Synth();h=copy.deepcopy(s.params['harmonics']);s.configure({**s.params,'character':.8})
        self.assertEqual(s.params['harmonics'],h)

    def test_shapes_have_bounded_energy_peak_and_release(self):
        from decksynth.spectral import SHAPES, seed_shape
        for note in (36,60,84):
            for velocity in (40,100):
                levels=[]
                for name in SHAPES:
                    s=Synth(48000);s.configure({**s.params,'harmonics':seed_shape(name,42),'spectral_energy':1,
                        'filter':1.,'attack':.001,'decay':.001,'sustain':1.,'release':.01,'modulation':0.})
                    s.on(note,velocity);s.render(4800);a=s.render(24000)
                    self.assertTrue(all(math.isfinite(x) for x in a))
                    self.assertLessEqual(max(abs(x) for x in s.table(note)),1.000000001)
                    levels.append(math.sqrt(sum(x*x for x in a)/len(a)))
                    s.off(note);s.render(1000);self.assertFalse(s.voices)
                self.assertLess(20*math.log10(max(levels)/min(levels)),3,(note,velocity,levels))
        for h in ([0.]*16,[1e-12]*16):
            s=Synth();s.configure({**s.params,'harmonics':h,'spectral_energy':1});self.assertLess(max(abs(x) for x in s.table(60)),1e-10)

    def test_one_atomic_shape_undo_and_reopen_with_seed(self):
        e=Engine();before=copy.deepcopy(e.project.data());e.seed_spectral(0,'RANDOM')
        first=copy.deepcopy(e.project.tracks[0]['instrument']);self.assertIn('random_seed',first)
        self.assertEqual(first['spectral_energy'],1);self.assertEqual(len(e.history),1)
        e.seed_spectral(0,'RANDOM');self.assertNotEqual(e.project.tracks[0]['instrument']['random_seed'],first['random_seed'])
        self.assertNotEqual(e.project.tracks[0]['instrument']['harmonics'],first['harmonics'])
        self.assertEqual(e.project.song,before['song']);self.assertEqual(e.project.performance,before['performance'])
        self.assertEqual(e.project.tracks[1:],before['tracks'][1:])
        e.undo();self.assertEqual(e.project.tracks[0]['instrument'],first)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'s.decksynth';e.project.save(p);loaded=Project.load(p)
            self.assertEqual(loaded.tracks,e.project.tracks)
        e.undo();self.assertEqual(e.project.data(),before)

    def test_invalid_or_wrong_owner_shape_rejected_without_mutation(self):
        e=Engine();before=copy.deepcopy(e.project.data())
        for track,name in ((-1,'RANDOM'),(4,'SAW'),(True,'SAW'),(0,'UNKNOWN'),(0,{})):
            with self.subTest(track=track,name=name),self.assertRaises(ValueError):e.seed_spectral(track,name)
            self.assertEqual(e.project.data(),before);self.assertFalse(e.history)
        e.select(1)
        with self.assertRaises(ValueError):e.seed_spectral(0,'RANDOM')
        self.assertEqual(e.project.data(),before);self.assertFalse(e.history)

    def test_legacy_project_and_pcm_are_unchanged_and_new_metadata_rejected(self):
        path=FIXTURES/'spectral_s1_legacy.decksynth';p=Project.load(path)
        self.assertNotIn('character',p.tracks[0]['instrument']);self.assertNotIn('spectral_energy',p.tracks[0]['instrument'])
        with tempfile.TemporaryDirectory() as d:
            out=Path(d)/'saved.decksynth';p.save(out);self.assertEqual(out.read_bytes(),path.read_bytes())
            before=copy.deepcopy(p.data())
            for key,value in [('character',float('nan')),('character',2),('random_seed',-1),('random_seed',True),('spectral_energy',2)]:
                bad=copy.deepcopy(before);bad['tracks'][0]['instrument'][key]=value;out.write_text(json.dumps(bad))
                with self.subTest(key=key,value=value),self.assertRaises(ValueError):Project.load(out)
        gold=json.loads((FIXTURES/'spectral_s1_legacy_pcm.json').read_text())
        for fixture in gold['native_float64_fixtures']:
            outputs=[]
            for neutral in ({},{'character':0.,'spectral_energy':0}):
                s=Synth(48000);s.configure({**p.tracks[0]['instrument'],**neutral});s.on(fixture['note'],fixture['velocity']);a=s.render(9600);s.off(fixture['note']);a+=s.render(48000);outputs.append(a)
            self.assertEqual(outputs[0],outputs[1])
            digest=hashlib.sha256(struct.pack('<'+str(len(outputs[0]))+'d',*outputs[0])).hexdigest()
            self.assertEqual(digest,fixture['float64_sha256'])

    def test_character_native_python_parity_and_modulation_registry(self):
        from decksynth.fx import SOUND_PARAMS
        self.assertEqual(SOUND_PARAMS['character'],(-1,1))
        for params in ({'character':.7},{'character':-.8,'spectral_energy':1,'vcf_type':1,'uni_voices':3},
                       {'character':.4,'spectral_energy':1,'inharm':1.,'sub':.2}):
            a=tone(params,frames=4800,native=True)
            with patch.object(core,'build_table',return_value=None):
                b=tone(params,frames=4800,native=False)
            self.assertLess(max(abs(x-y) for x,y in zip(a,b)),1e-9)


if __name__=='__main__':unittest.main()
