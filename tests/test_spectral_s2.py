"""S2 audible envelope independence, morph continuity, lifecycle, parity and legacy recall."""
import copy
from contextlib import nullcontext
import hashlib
import json
import math
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
from decksynth import core
from decksynth.core import Synth, Project, Engine
from decksynth.fx import SOUND_PARAMS, default_chain, validate_chain

FIXTURES=Path(__file__).parent/'fixtures'


def synth(**params):
    s=Synth();s.configure({**s.params,'attack':.001,'decay':.001,'sustain':1.,'release':.4,
        'modulation':0.,'vcf_type':1,'vcf_cutoff':.25,'vcf_reso':.4,'vcf_env':.8,**params})
    s.on(60,100);return s


class SpectralS2Tests(unittest.TestCase):
    def test_filter_adsr_changes_timbre_without_changing_amp_or_partials(self):
        opening=synth(fenv_a=.2,fenv_d=.1,fenv_s=1.,fenv_r=.1)
        closed=synth(fenv_a=.001,fenv_d=.001,fenv_s=0.,fenv_r=.1)
        opening.render(12000);closed.render(12000)
        a=opening.render(4800);b=closed.render(4800)
        self.assertGreater(sum(x*x for x in a),sum(x*x for x in b)*8)
        self.assertEqual(opening.voices[60]['level'],closed.voices[60]['level'])
        self.assertEqual(opening.params['harmonics'],closed.params['harmonics'])

    def test_filter_release_uses_its_own_level_and_sustain_retrigger_lifecycle(self):
        s=synth(fenv_a=.1,fenv_d=.1,fenv_s=.3,fenv_r=.1)
        s.render(2400)
        self.assertAlmostEqual(s.voices[60]['fstate'][0],2399/4800,places=10)
        s.pedal(True);s.off(60);s.render(1200)
        self.assertIsNone(s.voices[60]['release'])
        level=s.voices[60]['fstate'][0];s.pedal(False);s.render(1200)
        self.assertAlmostEqual(s.voices[60]['fstate'][0],level*(1-1199/4800),places=10)
        self.assertGreater(s.voices[60]['level'],.8)
        s.on(60,100);s.render(1);self.assertEqual(s.voices[60]['fstate'][0],0)
        s.panic();self.assertFalse(s.voices)

    def test_morph_endpoints_match_legacy_and_intermediates_mix_svf_outputs(self):
        out=[]
        for value,ft in ((0.,1),(.5,2),(1.,3)):
            old=synth(vcf_type=ft,vcf_env=0);new=synth(vcf_type=ft,vcf_env=0,vcf_morph=value)
            a=old.render(9600);b=new.render(9600)
            self.assertLess(max(abs(x-y) for x,y in zip(a,b)),1e-12)
            out.append(b)
        for value,left,right in ((.25,0,1),(.75,1,2)):
            s=synth(vcf_env=0,vcf_morph=value);a=s.render(9600)
            self.assertLess(max(abs(x-(y+z)*.5) for x,y,z in zip(a,out[left],out[right])),1e-12)

    def test_filter_native_python_parity_modulation_and_mid_note_enable(self):
        from decksynth.filter_native import prepare_kernel
        self.assertIsNotNone(prepare_kernel(),'build the optional S2 renderer for native parity')
        def render(fallback):
            ctx=patch('decksynth.core.native_filter_voice',return_value=None) if fallback else patch('decksynth.filter_native.library_path',side_effect=AssertionError('I/O during render'))
            s=synth(uni_voices=3,sub=.2,inharm=.3)
            with ctx:
                a=s.render(384)
                s.configure({**s.params,'fenv_a':.035,'fenv_d':.04,'fenv_s':.2,'fenv_r':.06,'vcf_morph':.2})
                for i in range(12):
                    s.modulate({'vcf_morph':i/11-.2,'fenv_s':.3});a+=s.render(128)
                s.off(60)
                for i in range(25):a+=s.render(128)
            return a
        a=render(False);b=render(True)
        self.assertLess(max(abs(x-y) for x,y in zip(a,b)),1e-9)

    def test_optional_fields_validate_persist_and_modulate_from_inherited_defaults(self):
        e=Engine();before=copy.deepcopy(e.project.data())
        values={'fenv_a':.07,'fenv_d':.19,'fenv_s':.41,'fenv_r':.8,'vcf_morph':.37}
        for k in values:self.assertIn(k,SOUND_PARAMS)
        chain=default_chain();chain['macros'][0]['targets']=[{'module':'sound','param':k,'depth':.4} for k in values]
        self.assertEqual(len(validate_chain(chain)['macros'][0]['targets']),5)
        s=e.synths[0];s.modulate({'fenv_a':.1,'fenv_s':.1,'vcf_morph':.1})
        self.assertAlmostEqual(s.live['fenv_a'],s.params['attack']+.1)
        self.assertAlmostEqual(s.live['fenv_s'],s.params['sustain']+.1)
        e.project.tracks[0]['instrument'].update(values)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'s2.decksynth';e.project.save(p);loaded=Project.load(p)
            self.assertEqual(loaded.tracks,e.project.tracks)
            self.assertEqual(loaded.song,before['song']);self.assertEqual(loaded.performance,before['performance'])
            for key,bad in ((k,v) for k in values for v in (float('nan'),float('inf'),True,-1,4)):
                data=copy.deepcopy(e.project.data());data['tracks'][0]['instrument'][key]=bad;p.write_text(json.dumps(data))
                with self.subTest(key=key,bad=bad),self.assertRaises(ValueError):Project.load(p)

    def test_first_independent_filter_edit_during_release_preserves_sounding_level(self):
        for fallback in (False,True):
            for modulation in (False,True):
                with self.subTest(fallback=fallback,modulation=modulation), (patch('decksynth.core.native_filter_voice',return_value=None) if fallback else nullcontext()):
                    params=dict(attack=.001,decay=.001,sustain=1.,release=1.,vcf_morph=0.,vcf_env=1.,vcf_cutoff=.2)
                    control=synth(**params);edited=synth(**params)
                    for s in (control,edited):s.render(4800);s.off(60);s.render(2400)
                    if modulation:edited.modulate({'fenv_s':0.})
                    else:edited.configure({**edited.params,'fenv_a':.001,'fenv_d':.001,'fenv_s':1.,'fenv_r':1.})
                    want=control.render(256);got=edited.render(256)
                    self.assertAlmostEqual(edited.voices[60]['fstate'][0],edited.voices[60]['level'],places=12)
                    self.assertLess(max(abs(x-y) for x,y in zip(want,got)),1e-12)

    def test_legacy_filtered_pcm_is_sample_identical(self):
        for fixture in json.loads((FIXTURES/'spectral_s2_legacy_filter_pcm.json').read_text()):
            s=Synth();s.configure(fixture['params']);s.on(60,100);a=s.render(4096);s.off(60);a+=s.render(32768)
            self.assertEqual(hashlib.sha256(struct.pack('<'+str(len(a))+'d',*a)).hexdigest(),fixture['sha256'])

    def test_fast_high_resonance_morph_sweep_is_finite_bounded_and_smooth(self):
        s=synth(vcf_env=0,vcf_reso=1,vcf_morph=0.,vcf_cutoff=.42)
        for note in range(48,63):s.on(note,100)
        out=[]
        for i in range(120):
            s.modulate({'vcf_morph':1. if i%2 else 0.});out+=s.render(256)
        self.assertTrue(all(math.isfinite(x) for x in out))
        self.assertLess(max(abs(x) for x in out),8.)
        # At every command boundary, no jump beyond the normal local waveform slope.
        jumps=[abs(out[i]-out[i-1]) for i in range(256,len(out),256)]
        self.assertLess(max(jumps),.5)
        s.panic();self.assertFalse(s.voices)

if __name__=='__main__':unittest.main()
