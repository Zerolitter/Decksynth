"""Sampler track (15 Nov): a Drum Rack pad played across the keys."""
import array
import copy
import json
import math
import os
import shutil
import struct
import tempfile
import unittest
import wave
from pathlib import Path

from decksynth.core import Engine, Project
from decksynth.sampler import POLY, Sampler, mix_python, new_sampler, validate_sampler

R = 48000


def write_wav(path, seconds=.5, freq=480., amp=.5, rate=R):
    n = int(seconds*rate)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(struct.pack('<%dh' % n, *[round(amp*32767*math.sin(2*math.pi*freq*i/rate)) for i in range(n)]))
    return path


def crossings(x):
    return sum(1 for a, b in zip(x, x[1:]) if a <= 0 < b)


class SamplerTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp()); os.environ['DECKSYNTH_DATA_DIR'] = str(self.dir)
        self.wav = write_wav(self.dir/'tone.wav')
        self.e = e = Engine(R)
        e.set_device(0, 'drum_rack'); kit = e.project.tracks[0]['drum_rack']
        e.import_drum_sample(0, kit['id'], 2, str(self.wav))
        self.kit_id = kit['id']

    def tearDown(self):
        os.environ.pop('DECKSYNTH_DATA_DIR', None); shutil.rmtree(self.dir, ignore_errors=True)

    def make(self, target=1, **edits):
        made = self.e.make_sampler(0, self.kit_id, 2, target, 60)
        if edits: self.e.edit_sampler(target, made['id'], 'patch', edits)
        for i in range(4): self.e.project.tracks[i]['mute'] = i != target
        self.e.project.tracks[target].pop('fx', None); self.e.fx[target].configure(None)
        return made

    def play(self, track, note, frames, velocity=127, token=('live', 0, 0, 0)):
        self.e.voice_on(track, note, velocity, token)
        return self.e.samplers[track], self.render(frames)

    def render(self, frames):
        out = []
        while frames > 0:
            n = min(256, frames); out += self.e.render(n); frames -= n
        return out

    def test_make_from_pad_copies_the_sample_and_names_it(self):
        made = self.make()
        t = self.e.project.tracks[1]
        self.assertEqual(t['device'], 'sampler')
        self.assertEqual(t['sampler']['source'], self.e.project.tracks[0]['drum_rack']['pads'][2]['source'])
        self.assertEqual(t['sampler']['name'], 'Snare'); self.assertEqual(t['sampler']['root'], 60)
        self.assertEqual(self.e.samplers[1].state()['status'], 'READY')
        self.e.undo(); self.assertNotEqual(self.e.project.tracks[1].get('device', 'synth'), 'sampler')
        self.assertTrue(made['id'])

    def test_keys_change_the_pitch(self):
        self.make()
        for note, ratio in ((60, 1), (72, 2), (48, .5)):
            self.e.samplers[1].panic()
            _, out = self.play(1, note, R//4)
            seen = crossings(out[R//50:R//50+R//10])  # 100 ms after the attack
            self.assertAlmostEqual(seen, 48*ratio, delta=2, msg='note %d' % note)

    def test_hold_releases_and_one_shot_plays_on(self):
        made = self.make(release=.05, end=1.)
        s, _ = self.play(1, 60, 4800)
        self.e.voice_off(1, 60, ('live', 0, 0, 0)); out = self.render(R//10)
        self.assertLess(max(map(abs, out[-2400:])), 1e-6); self.assertEqual(s.active_count, 0)
        self.e.edit_sampler(1, made['id'], 'mode', 'oneshot')
        self.play(1, 60, 4800); self.e.voice_off(1, 60, ('live', 0, 0, 0)); out = self.render(4800)
        self.assertGreater(max(map(abs, out)), .1)

    def test_loop_keeps_a_held_note_going_without_clicks(self):
        self.make(mode='loop', loop_start=.2, loop_end=.7)
        _, out = self.play(1, 60, R*2)  # the sample is 0.5 s long
        tail = out[-R//2:]
        self.assertGreater(max(map(abs, tail)), .2)
        jumps = max(abs(a-b) for a, b in zip(out[R//10:], out[R//10+1:]))
        self.assertLess(jumps, .1)  # a 480 Hz sine at this level moves at most ~0.06 per sample

    def test_mono_glides_between_held_notes(self):
        self.make(poly=False, glide=.1)
        s, _ = self.play(1, 60, 256)
        self.e.voice_on(1, 72, 127, ('live', 0, 1, 1)); self.render(R//20)
        v = [v for v in s.voices if v.active]
        self.assertEqual(len(v), 1); self.assertTrue(1.2 < v[0].step < 1.8, v[0].step)
        self.render(R//10); self.assertAlmostEqual(v[0].step, 2., places=6)

    def test_at_most_sixteen_notes(self):
        self.make(mode='loop')
        for n in range(24): self.e.voice_on(1, 40+n, 100, ('live', 0, n, n))
        s = self.e.samplers[1]
        self.assertLessEqual(sum(1 for v in s.voices if v.active and v.fade_left < 0), POLY)
        self.render(1024); self.assertLessEqual(s.active_count, POLY)

    def test_native_and_python_voices_match(self):
        self.make(mode='loop', loop_start=.3, loop_end=.6, attack=.01, decay=.05, sustain=.5, release=.02, poly=False, glide=.05)
        s = self.e.samplers[1]
        if s._kernel is None: self.skipTest('no native Sampler library here')
        s.on(60, 100, 'a'); s.on(67, 100, 'b')
        twin = (type(s.voices[0]) * len(s.voices))()
        import ctypes
        ctypes.memmove(twin, s.voices, ctypes.sizeof(s.voices))
        native = [0.]*R; s.render_into(native, R)
        python = [0.]*R; mix_python(twin, s.params, s.sample.data, python, R)
        self.assertLess(max(abs(a-b) for a, b in zip(native, python)), 1e-9)

    def test_sustain_pedal_holds_released_keys(self):
        self.make(release=.01)
        self.e.select(1)
        self.e.midi(0x90, 60, 100); self.render(512); self.e.midi(0xb0, 64, 127); self.e.midi(0x80, 60, 0)
        self.assertGreater(max(map(abs, self.render(4800))), .1)
        self.e.midi(0xb0, 64, 0); self.render(4800)
        self.assertEqual(self.e.samplers[1].active_count, 0)

    def test_live_keys_on_the_selected_track(self):
        self.make()
        self.e.select(1); self.e.midi(0x90, 64, 100)
        self.assertGreater(max(map(abs, self.render(4800))), .1)
        self.e.midi(0x80, 64, 0); self.render(R//2)
        self.assertEqual(self.e.samplers[1].active_count, 0)

    def test_loop_notes_play_from_the_clip(self):
        self.make()
        self.e.project.tracks[1]['notes'] = [dict(start=0., duration=.5, note=60, velocity=100)]
        self.e.playing = True; out = self.render(R//4)
        self.assertGreater(max(map(abs, out)), .1)

    def test_shaped_pad_plays_its_shaped_copy(self):
        kit = self.e.project.tracks[0]['drum_rack']
        shape = dict(kit['pads'][2].get('shape') or {});
        from decksynth.drum_shape import DEFAULT_SHAPE
        shape = dict(DEFAULT_SHAPE, reverse=True, end=.5)
        self.e.edit_drum_pad(0, self.kit_id, 2, 'shape', shape)
        self.make(); self.e.settle_offline_shaping()
        s = self.e.samplers[1]
        self.assertEqual(s.sample.frames, R//4)  # half the 0.5 s sample
        self.assertIn('shape', self.e.project.tracks[1]['sampler'])

    def test_save_load_and_reject_bad_values(self):
        self.make(mode='loop')
        f = self.dir/'p.decksynth'; self.e.project.save(f)
        loaded = Project.load(f)
        self.assertEqual(loaded.tracks[1]['sampler'], self.e.project.tracks[1]['sampler'])
        e = Engine(R); e.project = loaded; e.configure(); e.load_sampler_sources()
        self.assertEqual(e.samplers[1].state()['status'], 'READY')
        good = self.e.project.tracks[1]['sampler']
        for bad in (dict(good, root=128), dict(good, mode='reverse'), dict(good, start=.5, end=.5),
                    dict(good, sustain=2), dict(good, poly=1), dict(good, extra=1), dict(good, family='Bad!')):
            with self.assertRaises(ValueError): validate_sampler(bad)
        d = json.loads(f.read_text()); del d['tracks'][1]['sampler']; f.write_text(json.dumps(d))
        with self.assertRaises(ValueError): Project.load(f)

    def test_switcher_makes_an_empty_sampler_that_stays_silent(self):
        self.e.set_device(2, 'sampler')
        self.assertIsNone(self.e.project.tracks[2]['sampler']['source'])
        self.assertFalse(self.e.voice_on(2, 60, 100, 'x'))
        self.assertEqual(self.e.samplers[2].state()['status'], 'EMPTY')

    def test_freeze_and_export_render_the_sampler(self):
        from decksynth.freeze import render_freeze
        from decksynth.render_export import export_project_wav
        self.make()
        p = copy.deepcopy(self.e.project); p.song['on'] = False; p.bars = 1
        p.tracks[1]['notes'] = [dict(start=0., duration=.5, note=60, velocity=100)]
        meta = render_freeze(copy.deepcopy(p), 1, R, str(self.dir/'f.wav'))
        self.assertGreater(max(meta['peaks']), .1)
        out = self.dir/'e.wav'; export_project_wav(copy.deepcopy(p), R, out, seconds=1)
        with wave.open(str(out)) as w: pcm = array.array('h', w.readframes(R))
        self.assertGreater(max(map(abs, pcm)), 2000)

    def test_root_is_detected_from_a_pitched_sample(self):
        wav = write_wav(self.dir/'a3.wav', 1., 220.)
        kit = self.e.project.tracks[0]['drum_rack']; self.e.import_drum_sample(0, kit['id'], 5, str(wav))
        made = self.e.make_sampler(0, self.kit_id, 5, 2)  # no root given: detect it
        self.assertEqual(self.e.project.tracks[2]['sampler']['root'], 57)
        self.e.edit_sampler(2, made['id'], 'root', 60)
        self.assertEqual(self.e.detect_sampler_root(2, made['id']), 57)
        noise = self.dir/'noise.wav'
        import random; random.seed(1)
        with wave.open(str(noise), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(R)
            w.writeframes(struct.pack('<%dh' % R, *[round(random.uniform(-.5, .5)*32767*math.exp(-i/4800)) for i in range(R)]))
        self.e.import_drum_sample(0, kit['id'], 6, str(noise))
        self.e.make_sampler(0, self.kit_id, 6, 3)
        self.assertEqual(self.e.project.tracks[3]['sampler']['root'], 60)  # no clear pitch: C4

    def test_last_devices_are_remembered_with_the_sampler(self):
        from decksynth.drum_memory import KitMemory
        self.make()
        remembered = KitMemory.capture(self.e)
        e = Engine(R); KitMemory.restore(e, remembered)
        self.assertEqual(e.project.tracks[1]['device'], 'sampler')
        self.assertEqual(e.project.tracks[1]['sampler'], self.e.project.tracks[1]['sampler'])

    def test_missing_source_reports_it(self):
        self.make()
        p = copy.deepcopy(self.e.project); p.tracks[1]['sampler']['source']['path'] = str(self.dir/'gone.wav')
        p.tracks[1]['sampler']['source']['sha256'] = '0'*64
        e = Engine(R); e.project = p; e.configure(); e.samplers[1].raw = None; e.samplers[1].sample = None
        e.sample_cache = type(e.sample_cache)(R); e.samplers[1].cache = e.sample_cache
        e.load_sampler_sources()
        self.assertEqual(e.samplers[1].state()['status'], 'MISSING')
        self.assertFalse(e.voice_on(1, 60, 100, 'x'))


if __name__ == '__main__':
    unittest.main()
