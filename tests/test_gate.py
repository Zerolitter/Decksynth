"""Audio gate (track effect): open and closed cells follow the song position, no clicks, no drift,
and the recorded notes are untouched."""
import math
import unittest
from decksynth.core import Engine
from decksynth.diagnose import clicks
from decksynth.fx import default_chain, validate_chain


def gated(steps=0b0101010101010101, length=5, division=2, smooth=.3, depth=1., pump=0., on=True):
    c = default_chain()
    for m in c['modules']:
        if m['id'] == 'gate':
            m['on'] = on; m['params'] = dict(length=length, division=division, steps=steps, smooth=smooth, depth=depth, pump=pump)
    return validate_chain(c)


def engine(chain, bars=1, bpm=120):
    e = Engine(48000); e.project.bars = bars; e.project.bpm = bpm
    e.project.tracks[0]['instrument'].update(attack=.002, sustain=1., release=.05)
    e.project.tracks[0]['notes'] = [dict(start=0., duration=bars * 4 - .01, note=57, velocity=110)]
    for t in e.project.tracks[1:]: t['notes'] = []
    e.set_fx(0, chain); e.playing = True; e.frame = 0
    return e


def rms(x): return math.sqrt(sum(v * v for v in x) / max(1, len(x)))


class Gate(unittest.TestCase):
    def test_cells_open_and_close_on_the_beat(self):
        e = engine(gated()); out = e.render(48000)    # 2 beats at 120 bpm = 8 sixteenths
        cell = 6000                                    # one 1/16 at 120 bpm
        # steps bit k open: k = 0, 2, 4, 6 ... (0b0101...). Look at the middle of each cell.
        for k in range(1, 8):
            mid = out[k * cell + 1500:k * cell + 4500]
            if k % 2 == 0: self.assertGreater(rms(mid), .01, 'cell %d open' % k)
            else: self.assertLess(rms(mid), .002, 'cell %d closed' % k)

    def test_no_clicks_with_default_smoothing(self):
        e = engine(gated()); out = e.render(96000)
        self.assertEqual(clicks(out), 0)

    def test_locked_to_song_position_without_drift(self):
        # 9 cells of 1/8T never divide a bar evenly, so a free-running gate would drift; this one follows the song.
        e = engine(gated(steps=1, length=3, division=3), bars=1, bpm=240)
        loop = int(4 * 48000 * 60 / 240)
        e.render(loop * 30)
        frame = e.frame
        out = e.render(4000)
        beat = frame / e.fpb; cell = beat / (1 / 3); k = int(cell) % 9
        expect_open = k == 0
        self.assertEqual(rms(out[1000:2500]) > .01, expect_open, (beat, k))

    def test_depth_and_pump(self):
        half = engine(gated(depth=.5)).render(48000)
        self.assertGreater(rms(half[6000 + 1500:6000 + 4500]), .01, 'half depth leaves closed cells audible')
        e = engine(gated(steps=0xFFFF, pump=1., smooth=0)); out = e.render(48000)
        early, late = rms(out[12000 + 200:12000 + 1500]), rms(out[12000 + 4500:12000 + 5800])
        self.assertGreater(early, late * 2, 'pump fades each open cell down')

    def test_gate_off_changes_nothing_and_keeps_notes(self):
        a = engine(gated(on=False)).render(24000)
        b = engine(validate_chain(default_chain())).render(24000)
        self.assertEqual(a, b)
        e = engine(gated()); notes = [dict(n) for n in e.project.tracks[0]['notes']]; e.render(24000)
        self.assertEqual(e.project.tracks[0]['notes'], notes)

    def test_old_chains_get_a_gate_slot(self):
        c = default_chain(); c['modules'] = [m for m in c['modules'] if m['id'] != 'gate']
        self.assertIn('gate', [m['id'] for m in validate_chain(c)['modules']])


if __name__ == '__main__':
    unittest.main()
