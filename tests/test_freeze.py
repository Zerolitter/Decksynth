"""Freeze track to audio (15 Nov): exact playback, ring-out, out of date, file safety, the render process."""
import array
import copy
import json
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path

from decksynth.core import Engine, Project
from decksynth.freeze import (FrozenAudio, fingerprint, freeze_directory, render_freeze, validate_freeze)

R = 48000


def loop_project():
    p = Project(); p.bpm = 120; p.bars = 1; p.song['on'] = False
    p.tracks[0]['notes'] = [dict(start=b*1., duration=.5, note=60+b*4, velocity=100) for b in range(4)]
    p.tracks[1]['notes'] = [dict(start=0., duration=3.5, note=48, velocity=90)]
    return p


def song_project():
    p = Project(); p.bpm = 120; p.bars = 1
    p.tracks[0]['notes'] = [dict(start=3., duration=1., note=60, velocity=100), dict(start=0., duration=.5, note=67, velocity=80)]
    p.tracks[0]['instrument']['release'] = 1.5
    p.song.update(on=True, loop=False, length=2)
    p.song['lanes'][0] = [dict(at=0, len=2, clip=p.clips['open'][0], off=0)]
    for i in (1, 2, 3): p.tracks[i]['mute'] = True
    return p


def render(e, frames):
    out = []
    for _ in range(frames//256): out += e.render_stereo(256)
    return out


def engine(p):
    e = Engine(R); e.project = copy.deepcopy(p); e.configure(); return e


class FreezeTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(); os.environ['DECKSYNTH_DATA_DIR'] = self.dir
        freeze_directory().mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        os.environ.pop('DECKSYNTH_DATA_DIR', None); shutil.rmtree(self.dir, ignore_errors=True)

    def freeze(self, p, track, name='t.wav'):
        meta = render_freeze(copy.deepcopy(p), track, R, str(freeze_directory()/name))
        meta['fingerprint'] = fingerprint(p, track)
        return validate_freeze(meta)

    def frozen_engine(self, p, track, meta):
        e = engine(p); e.project.tracks[track]['freeze'] = meta; e.freeze_refresh(); return e

    def test_loop_freeze_sounds_like_the_live_track_on_every_pass(self):
        p = loop_project(); frames = R*2*5  # five passes of the 2 s loop
        e = engine(p); e.playing = True; live = render(e, frames)
        meta = self.freeze(p, 0)
        self.assertEqual(meta['mode'], 'loop'); self.assertEqual(meta['frames'], 3*meta['pass_frames'])  # 4 s of tail over 2 s passes
        e = self.frozen_engine(p, 0, meta); self.assertEqual({k: e.freeze_status()[0][k] for k in ('state', 'active')}, dict(state='frozen', active=True))
        e.playing = True; out = render(e, frames)
        stored = meta['frames']*2  # the stored passes are the live track, sample for sample
        self.assertLess(max(abs(a-b) for a, b in zip(live[:stored], out[:stored])), 1e-6)
        # Later passes repeat the last one. Live oscillators drift in phase from pass to pass, so
        # compare the loudness every 10 ms instead of the samples.
        def env(x):
            n = 960
            return [(sum(v*v for v in x[i:i+n])/n)**.5 for i in range(0, len(x)-n, n)]
        a, b = env(live[stored:]), env(out[stored:])
        self.assertLess(max(abs(x-y) for x, y in zip(a, b)), .1*max(a))

    def test_song_played_once_rings_out_from_the_file(self):
        p = song_project(); frames = R*6
        e = engine(p); e.playing = True; live = render(e, frames)
        meta = self.freeze(p, 0); self.assertEqual(meta['mode'], 'song')
        e = self.frozen_engine(p, 0, meta); e.playing = True; out = render(e, frames)
        self.assertLess(max(abs(a-b) for a, b in zip(live, out)), 1e-6)
        end = round(4*2*.5*R)*2  # after the song (2 bars at 120 BPM = 4 s) the release still sounds
        self.assertGreater(max(map(abs, out[end:end+4000])), 1e-3)

    def test_frozen_track_plays_no_synth_voices_and_skips_its_fx(self):
        p = loop_project(); meta = self.freeze(p, 0)
        e = self.frozen_engine(p, 0, meta); e.project.tracks[1]['mute'] = True; e.playing = True
        calls = []; original = e.fx[0].process_stereo
        e.fx[0].process_stereo = lambda *a, **k: calls.append(1) or original(*a, **k)
        render(e, R)
        self.assertEqual(len(e.synths[0].voices), 0); self.assertEqual(calls, [])

    def vocoded(self):
        """Track 1 is vocoded by track 2's sound (the maintainer's song, 25 Nov)."""
        from decksynth.fx import default_chain
        p = loop_project(); chain = default_chain()
        for m in chain['modules']:
            if m['id'] == 'vocoder': m['on'] = True; m['params'].update(source=1., mix=1.)
        p.tracks[0]['fx'] = chain
        return p

    def test_a_vocoder_freeze_holds_what_the_vocoder_heard(self):
        # The freeze render mutes the other tracks; the Vocoder's source track still plays its notes for it.
        p = self.vocoded(); p.tracks[1]['mute'] = True; frames = R*2
        e = engine(p); e.playing = True; live = render(e, frames)
        self.assertGreater(max(map(abs, live)), 1e-3, 'a muted source still drives the Vocoder')
        meta = self.freeze(p, 0)
        e = self.frozen_engine(p, 0, meta); e.playing = True; out = render(e, frames)
        self.assertEqual(e.freeze_status()[0]['state'], 'frozen')
        self.assertLess(max(abs(a-b) for a, b in zip(live, out)), 1e-6)

    def test_the_source_track_is_part_of_the_fingerprint(self):
        p = self.vocoded(); before = fingerprint(p, 0)
        p.tracks[1]['notes'][0]['note'] = 50
        self.assertNotEqual(fingerprint(p, 0), before, 'new notes on the source make the freeze out of date')
        from decksynth.fx import default_chain
        q = copy.deepcopy(p); q.tracks[1]['fx'] = default_chain(); q.tracks[1]['fx']['modules'][0]['on'] = True
        self.assertEqual(fingerprint(q, 0), fingerprint(p, 0), "the source's own FX are not heard by the Vocoder")

    def test_fingerprint_without_a_source_is_unchanged(self):
        # Freezes made before 25 Nov stay valid: no Ducking or Vocoder, the same hash as before.
        import hashlib
        p = loop_project(); t = p.tracks[0]
        sound = {k: v for k, v in t.items() if k not in ('freeze', 'freeze_loop', 'volume', 'mute', 'name', 'preset', 'midi_cc', 'clip_names')}
        sound['instrument'] = {k: v for k, v in sound['instrument'].items() if k != 'pan'}
        raw = json.dumps(dict(v=1, mode='loop', bpm=p.bpm, bars=p.bars, track=sound), sort_keys=True, separators=(',', ':'), allow_nan=False, default=str)
        self.assertEqual(fingerprint(p, 0, 'loop'), hashlib.sha256(raw.encode()).hexdigest())

    def test_a_frozen_track_that_a_live_vocoder_hears_plays_live(self):
        p = self.vocoded(); frames = R*2
        e = engine(p); e.playing = True; live = render(e, frames)
        meta = self.freeze(p, 1)
        e = self.frozen_engine(p, 1, meta)
        status = e.freeze_status()[1]
        self.assertEqual((status['state'], status['by']), ('listened', 0))
        e.playing = True; out = render(e, frames)
        self.assertLess(max(abs(a-b) for a, b in zip(live, out)), 1e-6)
        # Freeze the listener too: both play their files.
        meta0 = self.freeze(p, 0, 't0.wav'); e.project.tracks[0]['freeze'] = meta0; e.freeze_refresh()
        self.assertEqual([s['state'] for s in e.freeze_status()[:2]], ['frozen', 'frozen'])

    def test_live_keys_on_a_frozen_track_still_sound(self):
        p = loop_project(); meta = self.freeze(p, 0)
        e = self.frozen_engine(p, 0, meta); e.project.tracks[1]['mute'] = True
        e.voice_on(0, 72, 100, ('key', 72)); out = render(e, R//4)
        self.assertGreater(max(map(abs, out)), 1e-3)

    def test_edits_make_it_out_of_date_and_the_track_plays_live(self):
        p = loop_project(); meta = self.freeze(p, 0)
        e = self.frozen_engine(p, 0, meta)
        for key, value in (('volume', .3), ('mute', True), ('name', 'Lead')):
            e.project.tracks[0][key] = value; e.freeze_refresh()
            self.assertEqual(e.freeze_state[0], 'frozen', key+' is applied live')
        e.project.tracks[0]['mute'] = False
        e.project.tracks[0]['instrument']['pan'] = -.5; e.freeze_refresh(); self.assertEqual(e.freeze_state[0], 'frozen')
        e.project.performance['seq']['enabled'] = not e.project.performance['seq']['enabled']; e.freeze_refresh()
        self.assertEqual(e.freeze_state[0], 'frozen', 'Perform settings are not part of a freeze')
        e.project.tracks[0]['notes'][0]['velocity'] = 40; e.freeze_refresh()
        self.assertEqual(e.freeze_state[0], 'stale'); self.assertFalse(e.frozen_active(0, 'loop'))
        live = engine(e.project); live.playing = True; e.playing = True
        self.assertEqual(render(live, R), render(e, R))
        e.project.tracks[0]['notes'][0]['velocity'] = 100; e.project.bpm = 121; e.freeze_refresh()
        self.assertEqual(e.freeze_state[0], 'stale', 'tempo')

    def test_wrong_mode_plays_live(self):
        p = loop_project(); meta = self.freeze(p, 0)
        e = self.frozen_engine(p, 0, meta)
        self.assertTrue(e.frozen_active(0, 'loop')); self.assertFalse(e.frozen_active(0, 'song'))

    def test_missing_file_plays_live(self):
        p = loop_project(); meta = self.freeze(p, 0); os.unlink(meta['file'])
        e = self.frozen_engine(p, 0, meta)
        self.assertEqual(e.freeze_state[0], 'missing')
        live = engine(p); live.playing = True; e.playing = True
        self.assertEqual(render(live, R), render(e, R))

    def test_file_is_a_standard_float_wav(self):
        import wave
        p = loop_project(); meta = self.freeze(p, 0)
        raw = Path(meta['file']).read_bytes()
        self.assertEqual(raw[:4], b'RIFF'); self.assertEqual(raw[20:22], b'\x03\x00')  # IEEE float
        f = FrozenAudio(meta); left, right, _ = f.block(0, 256, True); f.close()
        self.assertEqual(len(left), 256); self.assertEqual(len(right), 256)
        self.assertEqual(len(meta['peaks']), 96); self.assertEqual(max(meta['peaks']), max(meta['peaks']))

    def test_save_and_load_keep_the_freeze_and_reject_bad_ones(self):
        p = loop_project(); meta = self.freeze(p, 0); p.tracks[0]['freeze'] = meta
        f = Path(self.dir)/'p.decksynth'; p.save(f)
        self.assertEqual(Project.load(f).tracks[0]['freeze'], meta)
        for bad in (dict(meta, mode='both'), dict(meta, file='relative.wav'), dict(meta, frames=0),
                    dict(meta, peaks=[2]), dict(meta, extra=1), dict(meta, fingerprint='x')):
            d = json.loads(f.read_text()); d['tracks'][0]['freeze'] = bad; f.write_text(json.dumps(d))
            with self.assertRaises(ValueError): Project.load(f)

    def test_undo_brings_an_unfreeze_back(self):
        p = loop_project(); meta = self.freeze(p, 0)
        e = engine(p); e.set_freeze(0, meta); self.assertEqual(e.freeze_state[0], 'frozen')
        e.set_freeze(0, None); self.assertEqual(e.freeze_state[0], 'none')
        e.undo(); e.freeze_refresh(); self.assertEqual(e.freeze_state[0], 'frozen')

    def test_freeze_is_much_cheaper_than_the_live_track(self):
        p = loop_project(); p.bars = 2
        ins = p.tracks[0]['instrument']; ins.update(unison=7, detune=18)
        p.tracks[0]['notes'] = [dict(start=b*.5, duration=2., note=48+b % 12, velocity=100) for b in range(16)]
        p.tracks[1]['mute'] = True
        meta = self.freeze(p, 0)
        def timed(e):
            e.playing = True; t = time.perf_counter(); render(e, R*4); return time.perf_counter()-t
        # The engine's own work (mixing, master, limiter) is the same either way, so compare what the
        # track itself costs on top of a project where it is muted.
        quiet = copy.deepcopy(p); quiet.tracks[0]['mute'] = True
        # Mixing the track into the master still costs the same, so the saving is the synth and FX.
        # The Deck's native synth is fast and its timings vary, hence the loose bound.
        base = min(timed(engine(quiet)) for _ in range(3))
        live = min(timed(engine(p)) for _ in range(3))-base
        frozen = min(timed(self.frozen_engine(p, 0, meta)) for _ in range(3))-base
        self.assertLess(frozen, live*.8, 'track cost frozen %.3fs vs live %.3fs' % (frozen, live))


class RenderProcessTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(); os.environ['DECKSYNTH_DATA_DIR'] = self.dir

    def tearDown(self):
        os.environ.pop('DECKSYNTH_DATA_DIR', None); shutil.rmtree(self.dir, ignore_errors=True)

    def test_freeze_and_export_run_in_their_own_process(self):
        from decksynth.render_jobs import RenderJob
        p = loop_project()
        path = os.path.join(self.dir, 'f.wav')
        job = RenderJob('freeze', p.data(), R, path, track=0).wait(120)
        self.assertIsNone(job.error); self.assertEqual(job.result['file'], path); self.assertTrue(os.path.exists(path))
        self.assertNotEqual(job.proc.pid, os.getpid())
        out = os.path.join(self.dir, 'e.wav')
        job = RenderJob('export_wav', p.data(), R, out).wait(120)
        self.assertIsNone(job.error); self.assertTrue(os.path.getsize(out) > 1000)

    def test_cancel_leaves_no_files(self):
        from decksynth.render_jobs import RenderJob
        p = loop_project(); p.bars = 32
        path = os.path.join(self.dir, 'c.wav')
        job = RenderJob('freeze', p.data(), R, path, track=0); time.sleep(.5); job.cancel(); job.wait(20)
        self.assertEqual(job.error, 'cancelled')
        self.assertFalse(os.path.exists(path)); self.assertFalse(os.path.exists(path+'.part'))
        self.assertFalse(os.path.exists(job.job_file))

    def test_a_failed_render_reports_why(self):
        from decksynth.render_jobs import RenderJob
        d = loop_project().data(); d['bpm'] = 999
        job = RenderJob('freeze', d, R, os.path.join(self.dir, 'x.wav'), track=0).wait(60)
        self.assertIsNone(job.result); self.assertTrue(job.error)

    def test_reuse_needs_the_same_fingerprint(self):
        from decksynth.backend import reuse_freeze
        p = loop_project(); folder = freeze_directory(); folder.mkdir(parents=True)
        path = str((folder/'r.wav').resolve())
        meta = render_freeze(copy.deepcopy(p), 0, R, path); meta['fingerprint'] = fingerprint(p, 0)
        Path(path+'.json').write_text(json.dumps(meta))
        e = engine(p)
        self.assertEqual(reuse_freeze(path, e, 0, 'loop', meta['fingerprint']), meta)
        self.assertIsNone(reuse_freeze(path, e, 0, 'loop', '0'*64))


if __name__ == '__main__':
    unittest.main()
