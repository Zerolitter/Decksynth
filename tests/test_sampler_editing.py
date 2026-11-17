import copy
"""Sampler editing and gesture controls (Sir, 15 Nov evening). Stage 6: record on any track, louder takes, Clear sample."""
import math,unittest
from array import array
from tests.test_sampler_expansion import SamplerTrack,tone,feed,R
from decksynth.sampler_record import Recorder,amplify,downmix,normalized,gain


class RecordOnAnyTrack(SamplerTrack,unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.e.set_device(2,'sampler');self.id2=self.e.project.tracks[2]['sampler']['id']
        self.e.record_input='Test input'

    def test_a_saved_take_does_not_block_another_sampler(self):
        e=self.e
        e.sampler_record('now',1,self.id,-30,20);feed(e.record_feed,tone(.5))
        e.sampler_record('stop');self.settle()
        st=e.record_state()
        self.assertEqual(st['state'],'idle');self.assertIsNone(st['track'],'an old take must not hold a track')
        e.sampler_record('arm',2,self.id2,-30,20)
        self.assertEqual(e.record_state()['track'],2)

    def test_record_here_takes_over_from_a_live_take_and_keeps_it(self):
        e=self.e
        e.sampler_record('now',1,self.id,-30,20);feed(e.record_feed,tone(.5))
        e.sampler_record('now',2,self.id2,-30,20)          # takes over
        st=e.record_state();self.assertEqual((st['state'],st['track']),('recording',2))
        feed(e.record_feed,tone(.5,330.))
        e.sampler_record('stop');notes=self.settle()
        recorded=[n['message'] for n in notes if n.get('message','').startswith('Recorded')]
        self.assertEqual(len(recorded),2,notes)
        self.assertIsNotNone(e.project.tracks[1]['sampler']['source']);self.assertIsNotNone(e.project.tracks[2]['sampler']['source'])

    def test_arming_elsewhere_moves_the_arm(self):
        e=self.e
        e.sampler_record('arm',1,self.id,-30,20);e.sampler_record('arm',2,self.id2,-30,20)
        st=e.record_state();self.assertEqual((st['state'],st['track']),('armed',2))


class Louder(SamplerTrack,unittest.TestCase):
    def test_downmix_keeps_a_one_sided_input_at_full_level(self):
        l=array('f',tone(.1,amp=.4));r=array('f',[0.]*len(l))
        self.assertAlmostEqual(max(downmix(l,r)),max(l),places=5)
        self.assertAlmostEqual(max(downmix(r,l)),max(l),places=5)
        both=downmix(l,l);self.assertAlmostEqual(max(both),max(l),places=5)

    def test_input_gain_lifts_the_meter_and_clips_at_full_scale(self):
        e=self.e;e.record_input='Test input'
        e.sampler_record('level',-30,20,12.,True)
        self.assertEqual(e.record_state()['gain'],12.)
        feed(e.record_feed,tone(.2,amp=.05))
        self.assertAlmostEqual(e.record_state()['peak'],20*math.log10(.05)+12,delta=.6)
        self.assertEqual(max(amplify(array('f',[.5,-.9]),4.)),1.);self.assertEqual(min(amplify(array('f',[.5,-.9]),4.)),-1.)
        with self.assertRaises(ValueError):e.sampler_record('level',-30,20,3.,'yes')

    def test_a_quiet_take_is_normalized_when_saved(self):
        e=self.e;e.record_input='Test input'
        e.sampler_record('level',-50,20,0.,True)
        e.sampler_record('now',1,self.id,-50,20);feed(e.record_feed,tone(.5,amp=.1))
        e.sampler_record('stop');notes=self.settle()
        self.assertTrue(any('normalized +' in n.get('message','') for n in notes),notes)
        data=e.samplers[1].raw.data if e.samplers[1].raw is not None else None
        self.assertIsNotNone(data)
        self.assertAlmostEqual(max(abs(v) for v in data),gain(-1.),delta=.02)
        d,lift=normalized(array('f',[.0001,-.0002]));self.assertAlmostEqual(lift,20*math.log10(16),places=3)
        d,lift=normalized(array('f',[.95]));self.assertEqual(lift,0.)


class ClearSample(SamplerTrack,unittest.TestCase):
    def test_clear_sample_empties_the_sampler_in_one_undo_step(self):
        self.load()
        self.e.chop_sampler(1,self.id,'regions',dict(count=4));self.settle()
        self.assertEqual(len(self.spec()['slices']),4)
        self.e.clear_sampler(1,self.id)
        s=self.spec();self.assertIsNone(s['source']);self.assertEqual(s['slices'],[]);self.assertEqual(s['name'],'Sampler')
        self.e.undo()
        s=self.spec();self.assertIsNotNone(s['source']);self.assertEqual(len(s['slices']),4)


if __name__=='__main__':unittest.main()


class LinkSamplerAndDrumKnobs(SamplerTrack,unittest.TestCase):
    """Stage 9: macros and mod pads can move Sampler knobs and Drum Rack pads."""
    def chain(self,targets,value=1.):
        from decksynth.fx import default_chain
        c=default_chain();c['macros'][0]['value']=value;c['macros'][0]['targets']=targets;return c

    def test_targets_are_checked(self):
        from decksynth.fx import validate_chain
        validate_chain(self.chain([dict(module='sampler',param='cutoff',depth=.5),dict(module='drum',param='15:pan',depth=-.5)]))
        for bad in [('sampler','root'),('drum','16:tune'),('drum','x:gain'),('drum','3:start'),('drum','3:reverse'),('drum','tune')]:
            with self.assertRaises(ValueError,msg=bad):validate_chain(self.chain([dict(module=bad[0],param=bad[1],depth=.5)]))

    def test_a_macro_retunes_the_sampler(self):
        e=self.e;self.load()
        e.set_fx(1,self.chain([dict(module='sampler',param='tune',depth=.25)]))
        e.render(256)
        self.assertAlmostEqual(e.samplers[1].mod['tune'],12.)
        s=e.samplers[1];s.on(60,100);s._modulate()
        v=next(v for v in s.voices if v.active);self.assertAlmostEqual(v.pmul,2.,places=6)
        s.mod={};s._modulate();self.assertAlmostEqual(v.pmul,1.,places=6,msg='unlinking puts the pitch back')

    def test_gain_link_scales_the_output(self):
        e=self.e;self.load();s=e.samplers[1]
        def level(mod):
            s.panic();s.mod=mod;s.on(60,127);out=[0.]*2048;s.render_into(out,2048);return max(abs(x) for x in out)
        dry=level({});self.assertGreater(dry,0.)
        self.assertAlmostEqual(level({'gain':-.5*s.spec['gain']})/dry,.5,places=3)

    def test_a_drum_pad_hit_reads_its_links(self):
        from decksynth.drum_rack import DrumRack
        e=self.e;e.set_device(2,'drum_rack');d=e.drums[2]
        self.assertIsNotNone(d.kit);d.samples[3]=object()
        p=d.kit['pads'][3];p.update(mute=False,solo=False,choke=0)
        for q in d.kit['pads']:q['solo']=False
        d.mod={'3:tune':12.,'3:gain':-p['gain']/2,'3:pan':1.}
        self.assertTrue(d.on(39,127))
        v=next(v for v in d.voices if v.pad==3 and v.sample is not None)
        self.assertAlmostEqual(v.step,2.**((p['tune']+12.)/12.))
        self.assertAlmostEqual(v.gain,p['gain']/2)
        self.assertAlmostEqual(v.gl,0.,places=6)
        d.panic()


class LiveKnobs(SamplerTrack,unittest.TestCase):
    """Round 2 (16 Nov): a Sampler knob is heard while it turns; the project and undo wait for the release."""
    def test_preview_retunes_a_held_note_without_an_undo_step(self):
        e=self.e;self.load();s=e.samplers[1];sid=e.project.tracks[1]['sampler']['id']
        s.on(60,100);v=next(v for v in s.voices if v.active);step=v.step
        undo=len(e.undo_stack) if hasattr(e,'undo_stack') else None
        before=copy.deepcopy(e.project.tracks[1]['sampler'])
        e.preview_sampler(1,sid,dict(tune=12.))
        self.assertAlmostEqual(v.step,step*2.,places=6)
        self.assertEqual(e.project.tracks[1]['sampler'],before,'the project waits for the release')
        if undo is not None:self.assertEqual(len(e.undo_stack),undo)
        e.preview_sampler(1,sid,dict(tune=0.))
        self.assertAlmostEqual(v.step,step,places=6)
        e.preview_sampler(1,sid,dict(gain=before['gain']/2))
        e.edit_sampler(1,sid,'tune',7.)
        self.assertAlmostEqual(v.step,step*2.**(7/12.),places=6)
        self.assertEqual(e.project.tracks[1]['sampler']['gain'],before['gain'],'a preview never reaches the project')

    def test_preview_only_takes_knob_values(self):
        e=self.e;self.load();sid=e.project.tracks[1]['sampler']['id']
        for bad in [dict(mode='loop'),dict(slices=[]),dict(name='x'),{},dict(tune=1.,root=3)]:
            with self.assertRaises(ValueError,msg=bad):e.preview_sampler(1,sid,bad)
