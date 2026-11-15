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
