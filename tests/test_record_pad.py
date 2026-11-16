"""Record the piano into a Drum Rack pad (16 Nov, phase 3 of the pad sampling plan)."""
import unittest
from tests.test_sampler_expansion import SamplerTrack, tone, feed


class RecordIntoPad(SamplerTrack, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.e.set_device(2, 'drum_rack'); self.kit = self.e.project.tracks[2]['drum_rack']['id']
        self.e.record_input = 'Test input'

    def test_a_take_lands_on_the_pad(self):
        e = self.e
        e.sampler_record('arm', 2, self.kit, -30, 20, 4)
        st = e.record_state(); self.assertEqual((st['state'], st['track'], st['pad']), ('armed', 2, 4))
        feed(e.record_feed, [0.] * 4800 + tone(.5))
        self.assertEqual(e.record_state()['state'], 'recording')
        e.sampler_record('stop'); notes = self.settle()
        self.assertTrue(any(n.get('message', '').startswith('Recorded') and 'pad 5' in n['message'] for n in notes), notes)
        pad = e.project.tracks[2]['drum_rack']['pads'][4]
        self.assertIsNotNone(pad['source']); self.assertTrue(pad['name'].startswith('Recording'))
        self.assertIsNone(e.record_state()['pad'], 'a saved take no longer holds the pad')
        e.undo(); self.assertIsNone(e.project.tracks[2]['drum_rack']['pads'][4]['source'], 'one undo takes the take off the pad')

    def test_a_bad_pad_or_an_old_rack_is_refused(self):
        e = self.e
        with self.assertRaises(ValueError): e.sampler_record('arm', 2, self.kit, -30, 20, 16)
        with self.assertRaises(ValueError): e.sampler_record('arm', 2, 'not-this-rack', -30, 20, 0)
        with self.assertRaises(ValueError): e.sampler_record('arm', 1, self.id, -30, 20, 0)   # a Sampler track has no pads

    def test_the_rack_changing_keeps_the_file_and_says_so(self):
        e = self.e
        e.sampler_record('now', 2, self.kit, -30, 20, 0); feed(e.record_feed, tone(.4))
        e.sampler_record('stop'); e.set_device(2, 'synth'); notes = self.settle()
        self.assertTrue(any('was not put on the pad' in n.get('message', '') for n in notes), notes)

    def test_a_sampler_take_still_works(self):
        e = self.e
        e.sampler_record('now', 1, self.id, -30, 20); feed(e.record_feed, tone(.4))
        e.sampler_record('stop'); self.settle()
        self.assertIsNotNone(e.project.tracks[1]['sampler']['source'])


if __name__ == '__main__':
    unittest.main()
