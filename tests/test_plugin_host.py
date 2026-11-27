"""VST3 plugins (27 Nov): finding plugins, the helper process, parameters, the plugin window, takes, and what the
backend does with a take. The helper runs for real against a stand-in pedalboard (tests/fake_pedalboard).

The helper needs numpy. Where it is not installed, the end-to-end tests skip; set DECKSYNTH_TEST_NUMPY_PATH to a
folder that holds numpy to run them anyway."""
import os
import shutil
import socket
import struct
import sys
import tempfile
import time
import unittest
import wave
from pathlib import Path

os.environ.setdefault('DECKSYNTH_NO_AUTOSAVE', '1')

from decksynth import backend, cbus
from decksynth.core import Engine
from decksynth.plugin_host import PluginHost, friendly, note_name, scan
from decksynth.sample_library import SampleLibrary

FAKE = str(Path(__file__).with_name('fake_pedalboard'))
FAKE_NATIVE = str(Path(__file__).with_name('fake_vst3_host.py'))
NUMPY = os.environ.get('DECKSYNTH_TEST_NUMPY_PATH', '')
try:
    import numpy  # noqa: F401
    HAVE_NUMPY = True
except ImportError:
    HAVE_NUMPY = bool(NUMPY and Path(NUMPY, 'numpy').is_dir())
R = 48000


class LiveEngine(unittest.TestCase):
    """The live VST bridge: a Plugin track sends its notes (with their timing) and its audio is that track's audio."""

    @staticmethod
    def plugin_engine():
        engine = Engine(R); engine.set_device(0, 'plugin'); engine.plugin_track = 0; engine.live_midi_out = True
        return engine

    def test_drain_live_midi_keeps_original_note_offsets(self):
        engine = self.plugin_engine()
        engine.voice_on(0, 60, 100, ('test', 'on'))
        engine.absolute_frame = 17
        engine.voice_off(0, 60, ('test', 'on'))
        self.assertEqual(engine.drain_live_midi(0, 64), [
            (0, b'\x90\x3c\x64'),
            (17, b'\x80\x3c\x00'),
        ])

    def test_only_the_plugin_track_sends_notes_to_the_plugin(self):
        engine = self.plugin_engine(); engine.add_track()
        engine.voice_on(1, 64, 100, ('test', 'synth'))           # a synth track plays its own voices
        engine.plugin_track = None; engine.voice_on(0, 62, 100, ('test', 'other'))   # the plugin plays elsewhere
        self.assertEqual(engine.drain_live_midi(0, 256), [])

    def test_a_plugin_track_has_no_voices_of_its_own(self):
        engine = self.plugin_engine()
        engine.voice_on(0, 60, 100, ('test', 'on'))
        self.assertEqual(len(engine.synths[0].voices), 0)

    def test_external_stereo_is_the_plugin_tracks_audio(self):
        def render(setup):
            engine = self.plugin_engine(); engine.master_enabled = False; setup(engine)
            return engine.render_stereo(256, external_stereo=([.25] * 256, [.5] * 256))
        wet = render(lambda e: None)
        self.assertEqual(len(wet), 512)
        left, right = wet[200], wet[201]
        self.assertGreater(left, 0.); self.assertAlmostEqual(right / left, 2., places=3)   # stereo, not folded
        muted = render(lambda e: e.project.tracks[0].update(mute=True))
        self.assertEqual(max(map(abs, muted)), 0.)                                       # the track's mute applies
        quieter = render(lambda e: e.project.tracks[0].update(volume=.35))
        self.assertLess(quieter[201], right)                                             # and its volume
        elsewhere = render(lambda e: setattr(e, 'plugin_track', None))
        self.assertEqual(max(map(abs, elsewhere)), 0.)

    def test_notes_are_kept_for_a_live_vst_only_while_one_listens(self):
        engine = self.plugin_engine(); engine.live_midi_out = False
        engine.voice_on(0, 60, 100, ('test', 'on'))
        self.assertEqual(engine.drain_live_midi(0, 256), [])

    def test_notes_outside_midi_never_reach_the_live_vst(self):
        engine = self.plugin_engine()
        engine.voice_on(0, 130, 100, ('test', 'high')); engine.voice_on(0, -3, 100, ('test', 'low'))
        self.assertEqual(engine.drain_live_midi(0, 256), [])

    def test_stop_releases_the_live_vst_notes_instead_of_dropping_their_note_offs(self):
        engine = self.plugin_engine()
        engine.voice_on(0, 60, 100, ('test', 'on')); engine.drain_live_midi(0, 256)
        engine.stop()
        self.assertEqual(engine.drain_live_midi(engine.absolute_frame, 256), [(0, b'\xb0\x7b\x00')])

    def test_later_live_events_wait_for_their_block(self):
        engine = self.plugin_engine()
        engine._event_frame = 300; engine.voice_on(0, 60, 100, ('test', 'on')); engine._event_frame = None
        self.assertEqual(engine.drain_live_midi(0, 256), [])
        self.assertEqual(engine.drain_live_midi(256, 256), [(44, b'\x90\x3c\x64')])

    @unittest.skipUnless(cbus.available(), 'needs the native mix library')
    def test_a_live_block_keeps_the_c_mix_and_sounds_the_same_as_the_python_mix(self):
        ext = ([.1 * (j % 7) for j in range(256)], [-.05 * (j % 5) for j in range(256)])
        outs = []
        for python_bus in (False, True):
            engine = self.plugin_engine(); engine.python_bus = python_bus; engine.add_track()
            engine.voice_on(1, 60, 100, ('test', 'on'))
            outs.append(engine.render_stereo(256, external_stereo=ext))
        self.assertEqual(len(outs[0]), 512)
        self.assertLess(max(abs(a - b) for a, b in zip(*outs)), 1e-6)


class LiveTransport(unittest.TestCase):
    """The audio loop's side of the live socket, without a helper: it never waits and never hangs a note."""
    def setUp(self):
        self.host = PluginHost(None, R)
        self.host.live_socket, self.helper = socket.socketpair()
        self.host.loaded = dict(path='x', name='X', kind='instrument', live=True)
        self.helper.settimeout(2)

    def tearDown(self):
        self.host.live_socket.close(); self.helper.close()

    def packet(self):
        seq, frames, count = struct.unpack('<IHH', self.helper.recv(8))
        events = [struct.unpack('<H3s', self.helper.recv(5)) for _ in range(count)]
        return seq, frames, events

    def test_turning_live_on_first_releases_notes_the_plugin_still_holds(self):
        self.host.live_reset = True
        self.host.send_live([(5, b'\x90\x40\x64')])
        self.assertEqual(self.packet(), (0, 256, [(0, b'\xb0\x7b\x00'), (5, b'\x90\x40\x64')]))
        self.host.send_live([])
        self.assertEqual(self.packet(), (1, 256, []))

    def test_a_renderer_that_stops_answering_turns_live_off_with_a_reason(self):
        revision = self.host.revision
        for _ in range(6): self.host.send_live([])
        self.assertFalse(self.host.loaded['live'])
        self.assertIn('fell behind', self.host.live_fault)
        self.assertGreater(self.host.revision, revision)

    def test_a_full_socket_never_blocks_the_audio_loop(self):
        self.host.live_reply_seq = 10 ** 9   # pretend every block was answered, so only the socket can fill
        many = [(0, b'\x90\x40\x64')] * 512
        start = time.monotonic()
        while self.host.loaded['live'] and time.monotonic() - start < 5:
            self.host.live_reply_seq = self.host.live_seq
            self.host.send_live(many)
        self.assertFalse(self.host.loaded['live'])
        self.assertLess(time.monotonic() - start, 5)


def bundle(root, *parts, windows=False):
    path = Path(root, *parts); (path / 'Contents' / 'x86_64-linux').mkdir(parents=True)
    if windows: (path / 'Contents' / 'x86_64-win').mkdir()
    return path


def tone_wav(path, seconds=.3, rate=R):
    import math, struct
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', round(.3 * 32767 * math.sin(2 * math.pi * 220 * i / rate))) for i in range(int(seconds * rate))))
    return path


class Finding(unittest.TestCase):
    def setUp(self): self.dir = Path(tempfile.mkdtemp())
    def tearDown(self): shutil.rmtree(self.dir, ignore_errors=True)

    def test_vst3_bundles_are_found_and_windows_ones_marked(self):
        bundle(self.dir, 'Surgeish.vst3'); bundle(self.dir, 'yabridge', 'Chordz PrismFX.vst3', windows=True)
        bundle(self.dir, 'deep', 'er', 'Kit.vst3')
        (self.dir / 'Surgeish.vst3' / 'Contents' / 'Inner.vst3').mkdir()     # nothing inside a bundle is a plugin of its own
        vst2 = self.dir / 'vst2'; vst2.mkdir(); (vst2 / 'old.so').write_bytes(b'')
        found, count = scan([str(self.dir)], [str(vst2)])
        self.assertEqual([p['name'] for p in found], ['Chordz PrismFX', 'Kit', 'Surgeish'])
        self.assertEqual([p['windows'] for p in found], [True, False, False])
        self.assertEqual(count, 1)

    def test_missing_folders_are_fine(self):
        self.assertEqual(scan([str(self.dir / 'nope')], [str(self.dir / 'none')]), ([], 0))

    def test_names_and_messages(self):
        self.assertEqual((note_name(60), note_name(61), note_name(36)), ('C3', 'C#3', 'C1'))
        self.assertIn('yabridge is not installed', friendly('x', ["[error] Could not find 'libyabridge-vst3.so'"], 'Massive'))
        self.assertIn('not a Linux VST3', friendly('Unable to scan plugin /x: unsupported plugin format', [], 'X'))

    def test_without_the_libraries_it_asks_for_set_up(self):
        old = os.environ.pop('DECKSYNTH_PLUGIN_PATH', None)
        try:
            host = PluginHost(self.dir, R)
            self.assertEqual(host.status()['setup'], 'missing')
            host.plugins = [dict(path='/x.vst3', name='X', windows=False)]
            with self.assertRaisesRegex(ValueError, 'Set up plugin hosting first'): host.load('/x.vst3')
        finally:
            if old is not None: os.environ['DECKSYNTH_PLUGIN_PATH'] = old


class HelperBase:
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp()); self.events = []
        self.old = os.environ.get('DECKSYNTH_PLUGIN_PATH')
        os.environ['DECKSYNTH_PLUGIN_PATH'] = FAKE + (':' + NUMPY if NUMPY else '')
        self.host = PluginHost(self.dir / 'data', R)
        for name in ('Fake synth.vst3', 'Fake gain.vst3', 'broken.vst3', 'crash.vst3', 'yabridge-thing.vst3'): bundle(self.dir / 'plugins', name)
        self.host.plugins, _ = scan([str(self.dir / 'plugins')], [])

    def tearDown(self):
        self.host.close(); shutil.rmtree(self.dir, ignore_errors=True)
        if self.old is None: os.environ.pop('DECKSYNTH_PLUGIN_PATH', None)
        else: os.environ['DECKSYNTH_PLUGIN_PATH'] = self.old

    def path(self, name): return next(p['path'] for p in self.host.plugins if p['name'] == name)

    def wait(self, until, seconds=20):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            self.events += self.host.poll()
            if until(): return self.events
            time.sleep(.01)
        self.fail('the plugin helper did not answer: %r / %s' % (self.events, list(self.host.log)))

    def load(self, name):
        self.host.load(self.path(name)); self.assertEqual(self.host.status()['busy'], 'loading')
        self.wait(lambda: self.host.busy is None)
        return [e['plugin_params'] for e in self.events if 'plugin_params' in e][-1]['params']


@unittest.skipUnless(HAVE_NUMPY, 'the plugin helper needs numpy')
class Helper(HelperBase, unittest.TestCase):
    def test_windows_vst3_uses_the_native_helper_without_pedalboard(self):
        saved = os.environ.pop('DECKSYNTH_PLUGIN_PATH')
        native = PluginHost(self.dir / 'native-data', R, vst3_host=[sys.executable, FAKE_NATIVE])
        try:
            path = str(bundle(self.dir / 'plugins', 'Windows synth.vst3', windows=True))
            native.plugins, _ = scan([str(self.dir / 'plugins')], [])
            native.load(path)
            events = []
            end = time.monotonic() + 3
            while time.monotonic() < end and native.busy:
                events.extend(native.poll()); time.sleep(.01)
            self.assertIsNone(native.busy)
            self.assertEqual(native.status()['setup'], 'missing')
            self.assertEqual(native.native_version, 'fake-juce-1.0')
            self.assertEqual(native.loaded['name'], 'Fake Windows Synth')
            page = next(event['plugin_params'] for event in events if 'plugin_params' in event)
            self.assertEqual((page['params'][0]['name'], page['parameter_count']), ('Gain', 3773))
            native.request_params(query='drive')
            end = time.monotonic() + 3
            while time.monotonic() < end and not any('plugin_params' in event and event['plugin_params'].get('parameter_count') == 1 for event in events):
                events.extend(native.poll()); time.sleep(.01)
            search = next(event['plugin_params'] for event in events if event.get('plugin_params', {}).get('parameter_count') == 1)
            self.assertEqual(search['params'][0]['name'], 'Drive')
        finally:
            native.close()
            os.environ['DECKSYNTH_PLUGIN_PATH'] = saved

    def test_load_lists_the_plugins_own_parameters_with_their_controls(self):
        params = self.load('Fake synth')
        self.assertEqual(self.host.loaded['kind'], 'instrument'); self.assertEqual(self.host.loaded['name'], 'Fake Synth')
        self.assertEqual([p['name'] for p in params], ['Gain', 'Drive', 'Bypass'])      # no MIDI CC parameters
        self.assertEqual([p['kind'] for p in params], ['value', 'options', 'switch'])
        self.assertEqual(params[1]['options'], ['Soft', 'Warm', 'Hard'])
        self.assertEqual(params[0]['text'], '50 %')
        self.assertTrue(self.host.status()['setup'] == 'ready' and self.host.version == 'fake-1.0')

    def test_turning_a_parameter_answers_with_the_plugins_own_text(self):
        self.load('Fake synth'); self.events.clear()
        self.host.set_param(0, .8)
        self.wait(lambda: any('plugin_param' in e for e in self.events))
        self.assertEqual(next(e['plugin_param'] for e in self.events if 'plugin_param' in e), dict(i=0, raw=.8, text='80 %'))
        with self.assertRaises(ValueError): self.host.set_param(0, 1.5)

    def test_an_instrument_take_holds_the_note_and_stops_when_it_is_quiet(self):
        self.load('Fake synth')
        out = self.dir / 'take.wav'
        self.host.render(out, dict(mode='record', dest='library'), notes=[dict(note=69, velocity=100)], hold=.5)
        self.wait(lambda: any('take' in e for e in self.events))
        take = next(e for e in self.events if 'take' in e)
        self.assertEqual(take['ctx']['dest'], 'library')
        with wave.open(str(out)) as w:
            self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate()), (2, 3, R))
            seconds = w.getnframes() / R
        self.assertTrue(.68 < seconds < .8, seconds)          # 0.5 s held + 0.2 s release + 50 ms, not the 10 s tail
        self.assertFalse(Path(str(out) + '.part').exists())
        self.assertTrue(.4 < take['take']['peak'] <= .51)

    def test_an_effect_plays_a_sample_through_it(self):
        self.load('Fake gain'); self.assertEqual(self.host.loaded['kind'], 'effect')
        src = tone_wav(self.dir / 'dry.wav'); out = self.dir / 'wet.wav'
        self.host.render(out, dict(mode='record', dest='library'), source=str(src))
        self.wait(lambda: any('take' in e for e in self.events))
        with wave.open(str(out)) as w: self.assertAlmostEqual(w.getnframes() / R, .35, delta=.01)

    def test_a_silent_take_says_so(self):
        self.load('Fake synth'); self.host.set_param(0, 0.); self.wait(lambda: any('plugin_param' in e for e in self.events))
        self.host.render(self.dir / 'quiet.wav', dict(mode='record'), notes=[dict(note=60)], hold=.2)
        self.wait(lambda: self.host.busy is None)
        self.assertIn('made no sound', self.host.error)

    def test_plugin_settings_are_remembered_for_the_next_load(self):
        self.load('Fake synth'); self.host.set_param(0, 1.)
        self.host.render(self.dir / 'a.wav', dict(mode='record'), notes=[dict(note=60)], hold=.1)
        self.wait(lambda: any(self.host.folder.joinpath('states').glob('*.json')))
        self.host.stop(); self.events.clear()
        self.assertEqual(self.load('Fake synth')[0]['raw'], 1.)

    def test_the_plugin_window_hands_back_what_was_turned_in_it(self):
        self.load('Fake synth'); self.events.clear()
        self.host.open_editor(); self.assertTrue(self.host.status()['loaded']['editor'])
        with self.assertRaisesRegex(ValueError, 'Close the plugin window'): self.host.render(self.dir / 'x.wav', dict(mode='record'), notes=[dict(note=60)], hold=.1)
        time.sleep(.2); self.host.close_editor()
        self.wait(lambda: not self.host.editor)
        params = [e['plugin_params'] for e in self.events if 'plugin_params' in e][-1]['params']
        self.assertEqual(params[0]['raw'], .25)

    def test_a_plugin_that_cannot_open_says_why(self):
        self.host.load(self.path('broken')); self.wait(lambda: self.host.busy is None)
        self.assertIn('not a Linux VST3', self.host.error); self.assertIsNone(self.host.loaded)
        self.host.load(self.path('yabridge-thing')); self.wait(lambda: self.host.busy is None)
        self.assertIn('yabridge is not installed', self.host.error)

    def test_a_crashing_plugin_never_takes_decksynth_with_it(self):
        self.host.load(self.path('crash'))
        self.wait(lambda: self.host.proc is None)
        self.assertIsNone(self.host.loaded); self.assertIsNone(self.host.busy)
        self.assertTrue(any('error' in e for e in self.events))
        self.load('Fake synth'); self.assertEqual(self.host.loaded['name'], 'Fake Synth')   # and the next one loads


@unittest.skipUnless(HAVE_NUMPY, 'the plugin helper needs numpy')
class LiveHelper(HelperBase, unittest.TestCase):
    def test_consumed_live_reply_does_not_count_as_a_renderer_backlog(self):
        self.load('Fake synth'); self.host.set_live(True)
        self.host.live_seq = self.host.live_reply_seq = 6
        self.host.live_blocks.clear()  # The audio thread already mixed every reply.
        self.host.send_live([])
        self.assertTrue(self.host.loaded['live'])
        self.assertIsNone(self.host.live_fault)

    def test_live_synth_returns_audio_and_tracks_its_state(self):
        self.load('Fake synth')
        self.host.set_live(True)
        self.assertTrue(self.host.status()['loaded']['live'])
        self.host.send_live([(0, b'\x90\x45\x64')])
        end=time.monotonic()+3
        block=None
        while time.monotonic()<end and block is None:
            block=self.host.pull_live();time.sleep(.01)
        self.assertIsNotNone(block)
        self.assertEqual([len(ch) for ch in block],[256,256])
        self.assertGreater(max(map(abs,block[0])),.01)

    def test_live_can_be_turned_off_and_on_again(self):
        self.load('Fake synth')
        for enabled in (True, False, True):
            self.host.set_live(enabled); self.wait(lambda: not any(c.startswith('live') for c, _ in self.host.pending.values()))
        self.host.send_live([(0, b'\x90\x45\x64')])
        end=time.monotonic()+3;block=None
        while time.monotonic()<end and block is None:
            block=self.host.pull_live();time.sleep(.01)
        self.assertIsNotNone(block)
        self.assertTrue(self.host.loaded['live'])

    def test_live_is_rejected_for_effect_plugins(self):
        self.load('Fake gain')
        with self.assertRaisesRegex(ValueError,'instrument'):
            self.host.set_live(True)

    def test_native_live_rejection_returns_the_button_to_off_and_reports_why(self):
        old = os.environ.get('FAKE_NATIVE_REJECT_LIVE')
        os.environ['FAKE_NATIVE_REJECT_LIVE'] = '1'
        native = PluginHost(self.dir / 'native-live-data', R, vst3_host=[sys.executable, FAKE_NATIVE])
        try:
            path = str(bundle(self.dir / 'plugins', 'Rejected Windows synth.vst3', windows=True))
            native.plugins, _ = scan([str(self.dir / 'plugins')], [])
            native.load(path)
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline and native.loaded is None:
                native.poll(); time.sleep(.01)
            self.assertIsNotNone(native.loaded)
            native.set_live(True)
            deadline = time.monotonic() + 3; events = []
            while time.monotonic() < deadline and native.loaded.get('live'):
                events.extend(native.poll()); time.sleep(.01)
            self.assertFalse(native.loaded['live'])
            self.assertIn('Live audio transport is unavailable', native.error)
            self.assertTrue(any('error' in event for event in events))
        finally:
            native.close()
            if old is None: os.environ.pop('FAKE_NATIVE_REJECT_LIVE', None)
            else: os.environ['FAKE_NATIVE_REJECT_LIVE'] = old

    def test_live_stays_enabled_while_the_plugin_window_is_open(self):
        self.load('Fake synth');self.host.set_live(True);self.events.clear()
        self.host.open_editor();time.sleep(.1)
        self.host.send_live([(0,b'\x90\x45\x64')])
        end=time.monotonic()+3;block=None
        while time.monotonic()<end and block is None:
            block=self.host.pull_live();time.sleep(.01)
        self.assertIsNotNone(block)
        self.host.close_editor();self.wait(lambda:not self.host.editor)
        self.assertTrue(self.host.status()['loaded']['live'])

    def test_a_plugin_load_deadline_stops_waiting_for_a_stuck_host(self):
        self.host.load(self.path('Fake synth'))
        self.host.load_deadline = time.monotonic() - .01
        self.host.poll()
        self.assertIsNone(self.host.busy)
        self.assertIsNone(self.host.loaded)
        self.assertIn('timed out', self.host.error)


@unittest.skipUnless(HAVE_NUMPY, 'the plugin helper needs numpy')
class Backend(HelperBase, unittest.TestCase):
    """The backend's side: a take lands in the library and on a Sampler track."""
    def setUp(self):
        super().setUp()
        self.e = Engine(R); self.e.chop_directory = str(self.dir / 'chops')
        self.lib = SampleLibrary(self.dir / 'data', R, default_root=self.dir / 'Samples')

    def tearDown(self):
        self.e.sampler_tasks.close(); self.lib.close(); super().tearDown()

    def take(self, opts):
        self.events.clear()
        backend.plugin_command(self.e, self.host, self.lib, ['render', opts])
        self.wait(lambda: any('take' in e for e in self.events))
        ev = next(e for e in self.events if 'take' in e)
        note = backend.plugin_take(self.e, self.host, self.lib, ev['take'], ev['ctx'])
        for _ in range(500):
            self.e.poll_sampler_tasks()
            if not self.e.sampler_tasks.jobs: break
            time.sleep(.01)
        return ev, note

    def test_record_to_a_new_sampler_track(self):
        self.load('Fake synth'); tracks = len(self.e.project.tracks)
        ev, note = self.take(dict(mode='record', note=57, velocity=90, hold=.3, dest='new'))
        self.assertEqual(len(self.e.project.tracks), tracks + 1)
        t = self.e.project.tracks[-1]
        self.assertEqual(t['device'], 'sampler'); self.assertEqual(t['name'], 'Fake Synth A2')
        self.assertIsNotNone(t['sampler']['source'])
        self.assertTrue(Path(ev['take']['path']).is_file()); self.assertEqual(Path(ev['take']['path']).parent.name, 'Plugins')
        self.assertIn('new Sampler', note)

    def test_record_into_this_sampler_and_effects_need_its_sample(self):
        self.e.set_device(1, 'sampler'); sid = self.e.project.tracks[1]['sampler']['id']
        self.load('Fake gain')
        with self.assertRaisesRegex(ValueError, 'with a sample'):
            backend.plugin_command(self.e, self.host, self.lib, ['render', dict(mode='record', dest='sampler', track=1, sampler_id=sid)])
        self.load('Fake synth')
        self.take(dict(mode='record', note=60, hold=.2, dest='sampler', track=1, sampler_id=sid))
        spec = self.e.project.tracks[1]['sampler']
        self.assertEqual(spec['name'], 'Fake Synth C3')
        self.load('Fake gain')
        ev, note = self.take(dict(mode='record', dest='sampler', track=1, sampler_id=sid))
        self.assertEqual(self.e.project.tracks[1]['sampler']['name'], 'Fake Gain - Fake Synth C3')

    def test_listen_plays_without_saving(self):
        self.load('Fake synth')
        ev, note = self.take(dict(mode='listen', note=60, hold=.2))
        self.assertIsNone(note); self.assertFalse((self.dir / 'Samples').exists())
        self.wait(lambda: any('listen' in e for e in self.events))
        self.e.play_sample_preview(next(e['listen'] for e in self.events if 'listen' in e))
        self.assertTrue(self.e.sample_preview_active())

    def test_bad_requests_are_refused(self):
        self.load('Fake synth')
        for opts in (dict(mode='record', dest='sampler', note=60), dict(mode='record', note=200), dict(mode='play'), dict(mode='record', hold=99)):
            with self.assertRaises(ValueError): backend.plugin_command(self.e, self.host, self.lib, ['render', opts])


if __name__ == '__main__':
    unittest.main()
