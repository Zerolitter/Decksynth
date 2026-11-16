"""Drum Rack pad shapes are heard while a knob turns (16 Nov): drafts make no undo step and give way to the saved edit."""
import unittest
from decksynth.drum_shape import PadShaper
from tests.test_sampler_expansion import SamplerTrack, tone, feed


class DrumDraft(SamplerTrack, unittest.TestCase):
    def setUp(self):
        super().setUp()
        e = self.e
        e.set_device(2, 'drum_rack'); self.kit = e.project.tracks[2]['drum_rack']['id']
        e.record_input = 'Test input'
        e.sampler_record('now', 2, self.kit, -30, 20, 0); feed(e.record_feed, tone(.5))
        e.sampler_record('stop'); self.settle(); PadShaper.wait()
        self.rack = e.drums[2]

    def test_a_draft_is_heard_without_an_undo_step(self):
        e, rack = self.e, self.rack
        before = rack.samples[0]; depth = len(e.history)
        e.drum_draft(2, self.kit, 0, dict(decay=.05)); PadShaper.wait()
        self.assertIsNot(rack.samples[0], before, 'the draft is heard')
        self.assertLess(rack.samples[0].frames, before.frames, 'a short decay shortens the pad')
        self.assertEqual(len(e.history), depth, 'no undo step while turning')
        self.assertEqual((e.project.tracks[2]['drum_rack']['pads'][0].get('shape') or {}).get('decay', 0), 0, 'nothing saved')

    def test_letting_go_saves_once_and_replaces_the_draft(self):
        e, rack = self.e, self.rack
        depth = len(e.history)
        e.drum_draft(2, self.kit, 0, dict(decay=.05)); e.drum_draft(2, self.kit, 0, dict(decay=.1))
        shape = dict(e.project.tracks[2]['drum_rack']['pads'][0].get('shape') or {}, decay=.1)
        e.edit_drum_pad(2, self.kit, 0, 'shape', shape); PadShaper.wait()
        self.assertEqual(rack.drafts, {}, 'the saved edit replaces the draft')
        self.assertEqual(len(e.history), depth + 1, 'one undo step')
        e.undo(); PadShaper.wait()
        self.assertEqual((e.project.tracks[2]['drum_rack']['pads'][0].get('shape') or {}).get('decay', 0), 0)

    def test_a_stale_render_is_skipped(self):
        rack = self.rack; done = []
        PadShaper.submit(rack.raw[0], dict(decay=.2), 48000, done.append, 1., lambda: False)
        PadShaper.wait()
        self.assertEqual(done, [], 'a render a newer edit replaced never runs')

    def test_a_bad_draft_is_refused(self):
        with self.assertRaises(ValueError): self.e.drum_draft(2, self.kit, 16, dict(decay=.1))
        with self.assertRaises(ValueError): self.e.drum_draft(2, 'other', 0, dict(decay=.1))


class ClearAndCrop(DrumDraft):
    """Sir, 16 Nov: a pad could not be cleared, and the trimmed-off audio stayed in the pad."""
    test_a_draft_is_heard_without_an_undo_step = test_letting_go_saves_once_and_replaces_the_draft = None
    test_a_stale_render_is_skipped = test_a_bad_draft_is_refused = None

    def pad(self): return self.e.project.tracks[2]['drum_rack']['pads'][0]

    def test_clear_empties_the_pad_with_one_undo(self):
        e = self.e; name = self.pad()['name']; depth = len(e.history)
        self.assertTrue(e.clear_drum_pad(2, self.kit, 0))
        self.assertIsNone(self.pad()['source']); self.assertEqual(self.pad()['name'], 'Kick')
        self.assertIsNone(self.rack.samples[0], 'nothing plays')
        self.assertEqual(len(e.history), depth + 1)
        self.assertFalse(e.clear_drum_pad(2, self.kit, 0), 'an empty pad stays as it is')
        e.undo(); self.assertEqual(self.pad()['name'], name); self.assertIsNotNone(self.pad()['source'])

    def test_crop_keeps_only_start_to_end(self):
        e = self.e; full = self.rack.raw[0].frames
        with self.assertRaises(ValueError): e.crop_drum_pad(2, self.kit, 0)   # nothing trimmed yet
        e.edit_drum_pad(2, self.kit, 0, 'shape', dict(start=.25, end=.75, decay=.2)); PadShaper.wait()
        heard = self.rack.samples[0].frames
        e.crop_drum_pad(2, self.kit, 0); notes = self.settle(); PadShaper.wait()
        self.assertTrue(any('cropped' in n.get('message', '') for n in notes), notes)
        shape = self.pad()['shape']
        self.assertEqual((shape['start'], shape['end'], shape['decay']), (0., 1., .2), 'Start and End at the edges, the rest kept')
        self.assertAlmostEqual(self.rack.raw[0].frames, full // 2, delta=2)
        self.assertEqual(self.rack.samples[0].frames, heard, 'it sounds the same')
        e.undo(); self.assertEqual(self.pad()['shape']['start'], .25, 'one undo brings the full sample back')

    def test_save_kit_to_the_library_and_load_it_back(self):
        from decksynth.drum_library import scan_library
        e = self.e; root = self.dir / 'library'; root.mkdir()
        e.edit_drum_pad(2, self.kit, 0, 'name', 'My Piano Hit')
        e.edit_drum_pad(2, self.kit, 0, 'shape', dict(start=.5, end=1., decay=.3, eq_low=3.))
        e.edit_drum_pad(2, self.kit, 0, 'tune', -2.)
        with self.assertRaises(ValueError): e.export_drum_kit(2, self.kit, 'x')   # no library folder
        refreshed = []
        e.export_drum_kit(2, self.kit, 'Piano kit', root=str(root), done=lambda: refreshed.append(1))
        notes = self.settle()
        self.assertTrue(any('My kits / Piano kit' in n.get('message', '') for n in notes), notes)
        self.assertEqual(refreshed, [1], 'the library rescans')
        index = scan_library(root)
        self.assertIn('My kits/Piano kit', [f['id'] for f in index.folders])
        kit, samples = index.prepare('My kits/Piano kit', e.sample_cache)
        p = kit['pads'][0]
        self.assertEqual((kit['name'], p['name'], p['tune']), ('Piano kit', 'My Piano Hit', -2.))
        self.assertEqual((p['shape']['start'], p['shape']['end'], p['shape']['decay'], p['shape']['eq_low']), (0., 1., .3, 3.))
        self.assertAlmostEqual(samples[0].frames, self.rack.raw[0].frames // 2, delta=2, msg='only Start to End is saved')
        self.assertTrue(all(s is None for s in samples[1:]), 'empty pads stay empty')
        e.export_drum_kit(2, self.kit, 'Piano kit', root=str(root)); self.settle()
        self.assertTrue((root / 'My kits' / 'Piano kit 2').is_dir(), 'a second save never overwrites the first')


if __name__ == '__main__':
    unittest.main()
