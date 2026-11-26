"""FX per clip (clip_fx.py): a clip's changes to its track's chain and sends, applied while that clip plays."""
import json
import tempfile
import unittest
from pathlib import Path

from decksynth import clip_fx
from decksynth import song as songs
from decksynth.core import Engine, Project
from decksynth.fx import ORDER, NPAR, PARAM_INDEX, default_chain, validate_chain


def chain_with(**on):
    chain = default_chain()
    for m in chain['modules']:
        if m['id'] in on: m['on'] = True; m['params'].update(on[m['id']])
    return validate_chain(chain)


def param(engine, track, module, key):
    j = PARAM_INDEX[(module, key)][0]
    return engine.fx[track].params[ORDER.index(module) * NPAR + j]


def is_on(engine, track, module):
    return bool(engine.fx[track].on[ORDER.index(module)])


def song_two_clips(engine, track=0):
    """Track plays clip A for bars 1-2 and clip B for bars 3-4 (loop of 1 bar)."""
    engine.set_bars(1)
    s = songs.defaults(1, len(engine.project.tracks)); s['on'] = True; s['length'] = 4
    s['lanes'][track] = [songs.block(0, 2, 0), songs.block(2, 2, 1)]
    engine.set_song(s)


class ValidateTest(unittest.TestCase):
    def test_clean_entry_keeps_only_touched_values(self):
        raw = {'1': {'fx': {'chorus': {'on': False}, 'smear': {'params': {'mix': 2.}}}, 'sends': {'0': {'amount': .7}},
                     'change': 'beat'}, '2': {}, '3': {'fx': {}}}
        clean = clip_fx.validate(raw)
        self.assertEqual(clean, {'1': {'fx': {'chorus': {'on': False}, 'smear': {'params': {'mix': 1.}}},
                                       'sends': {'0': {'amount': .7, 'through': False}}, 'change': 'beat'}})

    def test_bad_entries_are_refused(self):
        for raw in ({'9': {'fx': {'eq': {'on': True}}}}, {'0': {'fx': {'nope': {'on': True}}}},
                    {'0': {'fx': {'eq': {'params': {'nope': 1}}}}}, {'0': {'change': 'slow', 'fx': {'eq': {'on': True}}}}):
            with self.assertRaises(ValueError): clip_fx.validate(raw)

    def test_chain_for_leaves_base_alone(self):
        base = chain_with(chorus={'mix': .4})
        eff = clip_fx.chain_for(base, {'fx': {'chorus': {'on': False, 'params': {'mix': .9}}, 'eq': {'on': True}}})
        self.assertIsNot(eff, base)
        ch = next(m for m in base['modules'] if m['id'] == 'chorus')
        self.assertEqual(ch['params']['mix'], .4); self.assertFalse(ch.get('bypass', False))
        ch2 = next(m for m in eff['modules'] if m['id'] == 'chorus'); eq = next(m for m in eff['modules'] if m['id'] == 'eq')
        self.assertTrue(ch2['bypass']); self.assertEqual(ch2['params']['mix'], .9)
        self.assertTrue(eq['on']); self.assertFalse(eq['bypass'])
        self.assertIs(clip_fx.chain_for(base, None), base)

    def test_remap_and_copy(self):
        cf = {'0': {'sends': {'1': {'amount': .5, 'through': False}}}, '1': {'sends': {'0': {'amount': .2, 'through': False}}}}
        self.assertEqual(clip_fx.remap_bus(cf, 0), {'0': {'sends': {'0': {'amount': .5, 'through': False}}}})
        self.assertEqual(clip_fx.copy_clip(cf, 1, 3)['3'], cf['1'])
        self.assertNotIn('0', clip_fx.copy_clip(cf, 5, 0))


class EngineTest(unittest.TestCase):
    def setUp(self):
        self.e = Engine()
        if not self.e.fx[0].handle: self.skipTest('native FX library not built')
        self.e.set_fx(0, chain_with(chorus={'mix': .3}, smear={'mix': .2}))

    def test_loop_mode_plays_the_open_clips_fx(self):
        e = self.e
        e.set_clip_fx(0, 1, {'fx': {'chorus': {'on': False}, 'smear': {'params': {'mix': .8}}}})
        e.render_stereo(256)
        self.assertTrue(is_on(e, 0, 'chorus')); self.assertAlmostEqual(param(e, 0, 'smear', 'mix'), .2)
        e.clip_action(0, 'open', 1); e.render_stereo(256)
        self.assertFalse(is_on(e, 0, 'chorus')); self.assertAlmostEqual(param(e, 0, 'smear', 'mix'), .8)
        e.clip_action(0, 'open', 0); e.render_stereo(256)
        self.assertTrue(is_on(e, 0, 'chorus')); self.assertAlmostEqual(param(e, 0, 'smear', 'mix'), .2)

    def test_song_switches_fx_at_the_clip(self):
        e = self.e; song_two_clips(e)
        e.set_clip_fx(0, 1, {'fx': {'smear': {'params': {'mix': .9}}}})
        e.playing = True
        bar = round(4 * e.fpb)
        e.render_stereo(256); self.assertAlmostEqual(param(e, 0, 'smear', 'mix'), .2)
        while e.frame < 2 * bar: e.render_stereo(128)
        e.render_stereo(128); self.assertAlmostEqual(param(e, 0, 'smear', 'mix'), .9)

    def test_glide_over_a_beat(self):
        e = self.e; song_two_clips(e)
        e.set_clip_fx(0, 1, {'fx': {'smear': {'params': {'mix': 1.}}}, 'change': 'beat'})
        e.playing = True; bar = round(4 * e.fpb)
        while e.frame < 2 * bar: e.render_stereo(128)
        e.render_stereo(128); e.render_stereo(round(e.fpb / 2))
        mid = param(e, 0, 'smear', 'mix'); self.assertTrue(.3 < mid < .95, mid)
        e.render_stereo(round(e.fpb)); self.assertAlmostEqual(param(e, 0, 'smear', 'mix'), 1.)

    def test_clip_sends_feed_the_bus(self):
        e = self.e
        e.set_clip_fx(0, 1, {'sends': {'0': {'amount': .7}}})
        e.render_stereo(256); self.assertNotIn(0, e._clip_sends)
        e.clip_action(0, 'open', 1); e.render_stereo(256)
        self.assertEqual(e._clip_sends[0], {'0': {'amount': .7, 'through': False}})
        self.assertNotIn('sends', e.project.tracks[0])  # the track's own sends are untouched

    def test_clearing_goes_back_to_base(self):
        e = self.e
        e.set_clip_fx(0, 0, {'fx': {'chorus': {'on': False}}}); e.render_stereo(256)
        self.assertFalse(is_on(e, 0, 'chorus'))
        e.set_clip_fx(0, 0, None, True); e.render_stereo(256)
        self.assertTrue(is_on(e, 0, 'chorus')); self.assertNotIn('clip_fx', e.project.tracks[0])
        e.undo(); e.render_stereo(256); self.assertFalse(is_on(e, 0, 'chorus'))

    def test_base_edit_reaches_a_clip_with_fx(self):
        e = self.e
        e.set_clip_fx(0, 0, {'fx': {'chorus': {'params': {'mix': .9}}}}); e.render_stereo(256)
        e.set_fx(0, chain_with(chorus={'mix': .3}, smear={'mix': .5})); e.render_stereo(256)
        self.assertAlmostEqual(param(e, 0, 'smear', 'mix'), .5); self.assertAlmostEqual(param(e, 0, 'chorus', 'mix'), .9)

    def test_copy_clip_takes_its_fx(self):
        e = self.e
        e.set_clip_fx(0, 1, {'fx': {'chorus': {'on': False}}})
        e.clip_action(0, 'copy', 4, 1)
        self.assertEqual(e.project.tracks[0]['clip_fx']['4'], {'fx': {'chorus': {'on': False}}})

    def test_removing_a_bus_moves_clip_sends(self):
        e = self.e
        e.set_clip_fx(0, 1, {'sends': {'1': {'amount': .4}}})
        e.remove_bus(0)
        self.assertEqual(e.project.tracks[0]['clip_fx'], {'1': {'sends': {'0': {'amount': .4, 'through': False}}}})


class RoundTripTest(unittest.TestCase):
    def test_save_and_load(self):
        e = Engine()
        e.set_clip_fx(0, 3, {'fx': {'eq': {'on': True, 'params': {'low': .2}}}, 'sends': {'0': {'amount': .5, 'through': True}}, 'change': 'bar'})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'p.decksynth'; e.project.save(str(path))
            back = Project.load(path)
            self.assertEqual(back.tracks[0]['clip_fx'], e.project.tracks[0]['clip_fx'])
            d = json.loads(path.read_text())
            self.assertNotIn('clip_fx', d['tracks'][1])  # a track without clip FX saves as before

    def test_a_project_without_clip_fx_saves_byte_for_byte(self):
        a = Project(); b = Project()
        self.assertEqual(json.dumps(a.data()), json.dumps(b.data()))


if __name__ == '__main__':
    unittest.main()
