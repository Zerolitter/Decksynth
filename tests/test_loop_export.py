import struct
import tempfile
import unittest
from pathlib import Path

from decksynth.core import Engine
from decksynth.loop_export import export_loop_wav, render_loop


def project_with_notes(bars=1):
    e = Engine()
    e.project.bars = bars
    e.project.tracks[0]['notes'] = [dict(start=0., duration=.5, note=60, velocity=100),
                                    dict(start=bars*4-.5, duration=.5, note=67, velocity=100)]
    for t in e.project.tracks[1:]: t['notes'] = []
    return e


class LoopExport(unittest.TestCase):
    def test_one_pass_is_exactly_the_loop_length(self):
        e = project_with_notes()
        out, fpb = render_loop(e.project, e.rate, track=0, kind='pass')
        self.assertEqual(len(out)//2, round(4*fpb))

    def test_tail_is_longer_and_a_whole_number_of_beats(self):
        e = project_with_notes()
        out, fpb = render_loop(e.project, e.rate, track=0, kind='tail')
        beats = (len(out)//2)/fpb
        self.assertGreater(beats, 4)
        self.assertAlmostEqual(beats, round(beats), delta=1/fpb+1e-6)

    def test_seamless_loop_holds_the_ring_out_at_its_start(self):
        e = project_with_notes()
        one, fpb = render_loop(e.project, e.rate, track=0, kind='pass')
        loop, _ = render_loop(e.project, e.rate, track=0, kind='loop')
        self.assertEqual(len(loop), len(one))
        # The last note rings over the loop point: a seamless loop's first moment is not silent
        # before the first note's attack, where a pass from silence starts at zero.
        self.assertEqual(max(abs(x) for x in one[:2]), 0.)
        self.assertGreater(max(abs(x) for x in loop[:64]), 1e-5)

    def test_headroom_turns_down_to_minus_six_and_writes_24_bit(self):
        e = project_with_notes()
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'loop.wav'
            meta = export_loop_wav(e.project, e.rate, path, track=0, kind='pass', headroom=True)
            data = path.read_bytes()
        self.assertEqual(data[:4], b'RIFF')
        channels, rate, _, _, bits = struct.unpack('<HIIHH', data[22:36])
        self.assertEqual((channels, rate, bits), (2, e.rate, 24))
        pcm = data[44:]
        peak = max(abs(int.from_bytes(pcm[i:i+3], 'little', signed=True)) for i in range(0, len(pcm), 3))
        self.assertLessEqual(peak/8388607, 10**(-6/20)+1e-4)
        self.assertEqual(meta['kind'], 'pass')

    def test_live_session_is_untouched(self):
        e = project_with_notes()
        before = e.project.data()
        render_loop(e.project, e.rate, track=0, kind='loop')
        self.assertEqual(e.project.data(), before)

    def test_all_muted_is_refused(self):
        e = project_with_notes()
        for t in e.project.tracks: t['mute'] = True
        with self.assertRaises(ValueError): render_loop(e.project, e.rate, track=None, kind='pass')


if __name__ == '__main__':
    unittest.main()


class LoopToGrain(unittest.TestCase):
    """Synth pattern -> Grain (Sir, 25 Nov): the bounced loop becomes a new Sampler track in Grain mode."""
    def test_a_bounced_loop_lands_on_a_new_grain_track(self):
        import os, time
        e = project_with_notes()
        with tempfile.TemporaryDirectory() as d:
            os.environ['DECKSYNTH_DATA_DIR'] = d
            e.sample_cache is not None or self.skipTest('no sample cache at this rate')
            path = Path(d)/'bounce.wav'
            export_loop_wav(e.project, e.rate, path, track=0, kind='loop', headroom=True)
            before = len(e.project.tracks)
            tr = e.grain_from_bounce(0, str(path), 'Warm Keys')
            self.assertEqual(len(e.project.tracks), before + 1); self.assertEqual(tr, before)
            t = e.project.tracks[tr]
            self.assertEqual(t['device'], 'sampler'); self.assertEqual(t['name'], 'Warm Keys grains')
            self.assertEqual(t['sampler']['mode'], 'grain'); self.assertEqual(t['sampler']['g_rhythm'], 'off')
            for _ in range(200):
                e.sampler_tasks.poll()
                if e.samplers[tr].sample is not None: break
                time.sleep(.02)
            self.assertIsNotNone(e.samplers[tr].sample)
            self.assertEqual(e.project.tracks[tr]['sampler']['mode'], 'grain')
            self.assertEqual(e.selected, tr)
