"""Plugin tracks (27 Nov): the track's plugin and quick knobs, its save and load, and Resample."""
import os
import tempfile
import time
import unittest
import wave
from array import array
from pathlib import Path

os.environ.setdefault('DECKSYNTH_NO_AUTOSAVE', '1')

from decksynth.core import Engine, Project
from decksynth.drum_memory import KitMemory
from decksynth.plugin_track import (Capture, PluginTracks, QUICK, TakeWriter, new_plugin_spec, validate_plugin_spec)

R = 48000


def block(value, n=256):
    return (array('d', [value] * n), array('d', [-value / 2] * n))


class FakeHost:
    """Just what PluginTracks reads from PluginHost."""
    def __init__(self, path='/p/Massive.vst3', track=0, live=True):
        self.plugins = [dict(path=path, name='Massive', windows=True)]
        self.loaded = dict(path=path, name='Massive', kind='instrument', track=track, live=live, paged=False)
        self.loads = []; self.busy = None; self.scanned = True; self.editor = False; self.revision = 0
        self.live_delay_blocks = 0

    def load(self, path, track=None): self.loads.append((path, track))
    def set_live(self, on): self.loaded['live'] = on
    def open_editor(self): self.editor = True
    def request_params(self, offset=0, query=None): pass
    def status(self): return dict(setup='ready')


def plugin_engine():
    e = Engine(R); e.set_device(0, 'plugin')
    e.project.tracks[0]['plugin'].update(path='/p/Massive.vst3', name='Massive')
    return e


class Spec(unittest.TestCase):
    def test_a_new_spec_has_eight_empty_quick_knobs(self):
        self.assertEqual(new_plugin_spec()['quick'], [None] * QUICK)

    def test_bad_specs_are_refused(self):
        for bad in (dict(new_plugin_spec(), quick=[None] * 3), dict(new_plugin_spec(), extra=1),
                    dict(new_plugin_spec(), quick=[dict(i=-1, name='x')] + [None] * 7), dict(new_plugin_spec(), version=2)):
            with self.assertRaises(ValueError): validate_plugin_spec(bad)

    def test_a_plugin_track_round_trips_through_save_and_load(self):
        e = plugin_engine()
        e.project.tracks[0]['plugin']['quick'][2] = dict(i=17, name='Cutoff')
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'p.decksynth'; e.project.save(path)
            back = Project.load(path)
        self.assertEqual(back.tracks[0]['device'], 'plugin')
        self.assertEqual(back.tracks[0]['plugin'], e.project.tracks[0]['plugin'])

    def test_a_plugin_track_without_its_plugin_does_not_load(self):
        e = plugin_engine(); del e.project.tracks[0]['plugin']
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'p.decksynth'; e.project.save(path)
            with self.assertRaises(Exception): Project.load(path)

    def test_the_remembered_devices_keep_a_plugin_track(self):
        e = plugin_engine()
        remembered = KitMemory.capture(e)
        self.assertEqual(remembered['tracks'][0]['device'], 'plugin')
        fresh = Engine(R); KitMemory.restore(fresh, remembered)
        self.assertEqual(fresh.project.tracks[0]['plugin']['path'], '/p/Massive.vst3')


class Tracks(unittest.TestCase):
    def test_the_plugin_plays_only_on_its_own_plugin_track(self):
        e = plugin_engine(); host = FakeHost()
        self.assertEqual(PluginTracks.plugin_track(e, host), 0)
        host.loaded['live'] = False; self.assertIsNone(PluginTracks.plugin_track(e, host))
        host.loaded['live'] = True; e.project.tracks[0]['plugin']['path'] = '/p/Other.vst3'
        self.assertIsNone(PluginTracks.plugin_track(e, host))

    def test_choose_puts_the_plugin_on_the_track_as_one_undo_step(self):
        e = Engine(R); e.set_device(0, 'plugin'); host = FakeHost(); pt = PluginTracks(R)
        pt.choose(e, host, 0, '/p/Massive.vst3')
        self.assertEqual(e.project.tracks[0]['plugin']['name'], 'Massive')
        self.assertEqual(host.loads, [('/p/Massive.vst3', 0)])
        e.undo(); self.assertEqual(e.project.tracks[0]['plugin']['path'], '')

    def test_quick_knobs_are_set_cleared_and_undone(self):
        e = plugin_engine(); pt = PluginTracks(R)
        pt.params_event(dict(plugin_params=dict(path='x', params=[dict(i=5, name='Cutoff', raw=.5, text='1 kHz')])))
        pt.set_quick(e, 0, 0, 5)
        self.assertEqual(e.project.tracks[0]['plugin']['quick'][0], dict(i=5, name='Cutoff'))
        self.assertEqual(pt.status(e, FakeHost())['quick'][0], [.5, '1 kHz'])
        pt.set_quick(e, 0, 0, None); self.assertIsNone(e.project.tracks[0]['plugin']['quick'][0])
        e.undo(); self.assertEqual(e.project.tracks[0]['plugin']['quick'][0]['i'], 5)
        with self.assertRaises(ValueError): pt.set_quick(e, 0, QUICK, 1)

    def test_learn_takes_the_parameter_that_moved_most_in_the_window(self):
        e = plugin_engine(); host = FakeHost(); pt = PluginTracks(R)
        pt.params_event(dict(plugin_params=dict(path='x', params=[dict(i=1, name='A', raw=.1), dict(i=2, name='B', raw=.5)])))
        pt.start_learn(e, host, 0, 3); self.assertTrue(host.editor)
        pt.params_event(dict(plugin_params=dict(path='x', params=[dict(i=1, name='A', raw=.15), dict(i=2, name='B', raw=.9)])))
        self.assertIn('B', pt.finish_learn(e)['message'])
        self.assertEqual(e.project.tracks[0]['plugin']['quick'][3], dict(i=2, name='B'))

    def test_a_plugin_track_is_not_frozen_or_given_synth_voices(self):
        e = plugin_engine(); e.plugin_track = 0; e.live_midi_out = True
        e.voice_on(0, 60, 100, ('t',))
        self.assertEqual(e.synths[0].voices, {})


class Resample(unittest.TestCase):
    def test_what_i_play_waits_for_the_first_note_and_ends_after_the_sound_dies(self):
        c = Capture('play', R)
        for _ in range(10): c.feed(block(.5))
        self.assertEqual(c.frames, 0)                         # armed: nothing yet
        c.notes([(0, b'\x90\x3c\x64')])
        for _ in range(20): c.feed(block(.5))
        c.notes([(0, b'\x80\x3c\x00')])
        done = False
        for _ in range(int(3 * R / 256)):
            done = c.feed(block(0.))
            if done: break
        self.assertTrue(done)
        self.assertEqual(c.span(), (max(0, -int(.002 * R)), 20 * 256 + int(.05 * R)))

    def test_held_keys_keep_the_take_going_through_silence(self):
        c = Capture('play', R); c.notes([(0, b'\x90\x3c\x64')]); c.feed(block(.5))
        for _ in range(int(3 * R / 256)): self.assertFalse(c.feed(block(0.)))

    def test_a_loop_take_records_its_length_then_the_tail(self):
        c = Capture('loop', R, 256 * 8)
        for _ in range(8): self.assertFalse(c.feed(block(.3)))
        self.assertTrue(c.body_done)
        for _ in range(30):
            if c.feed(block(0.)): break
        self.assertEqual(c.state, 'done')

    def test_the_kept_take_is_stereo_24_bit_and_starts_at_the_first_sound(self):
        c = Capture('note', R, 256 * 4)
        for _ in range(2): c.feed(block(0.))                 # the helper's delay: silence first
        for _ in range(4): c.feed(block(.5))
        c.stop()
        first, last = c.span()
        with tempfile.TemporaryDirectory() as d:
            w = TakeWriter(c, Path(d) / 'take.wav', first, last, False)
            for _ in range(200):
                if w.done(): break
                time.sleep(.05)
            self.assertNotIn('error', w.result)
            with wave.open(w.result['path']) as f:
                self.assertEqual((f.getnchannels(), f.getsampwidth(), f.getframerate()), (2, 3, R))
                self.assertEqual(f.getnframes(), last - first)
                raw = f.readframes(f.getnframes())
        def at(frame, ch):
            b = raw[(frame * 2 + ch) * 3:(frame * 2 + ch) * 3 + 3]
            return int.from_bytes(b, 'little', signed=True) / 8388607
        mid = (last - first) // 2
        self.assertAlmostEqual(at(mid, 0), .5, places=4); self.assertAlmostEqual(at(mid, 1), -.25, places=4)   # not folded to mono
        self.assertLess(abs(at(0, 0)), .01)                  # fades in, never clicks

    def test_resample_needs_the_plugin_playing_on_that_track(self):
        e = plugin_engine(); pt = PluginTracks(R); host = FakeHost(live=False)
        with self.assertRaises(ValueError): pt.resample(e, host, 0, 'play', {})

    def test_one_note_plays_and_releases_its_note(self):
        e = plugin_engine(); pt = PluginTracks(R); host = FakeHost(); e.plugin_track = 0; e.live_midi_out = True
        pt.resample(e, host, 0, 'note', dict(note=48, velocity=90, hold=.05))
        self.assertEqual(e.drain_live_midi(0, 256)[0][1], b'\x90\x30\x5a')
        for _ in range(40): pt.audio(e, block(.2), [])
        self.assertIn(b'\x80\x30\x00', [m for _, m in e.drain_live_midi(e.absolute_frame, 1 << 20)])


if __name__ == '__main__':
    unittest.main()
