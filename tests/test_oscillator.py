"""Oscillator (26 Nov): saw, pulse and FM partials for the voice table. A sound without the keys is the old sound."""
import math
import os
import tempfile
import unittest

from decksynth.core import Engine, Project, Synth, instrument, validate_instrument, wave_partials, bessel_j, SOUND_PARAMS

R = 48000


def play(p, note=48, secs=.4, block=256):
    s = Synth(R); s.configure(p); s.on(note, 100); out = []
    for _ in range(int(secs * R / block)): out += s.render(block)
    return out


def partial_levels(p, note=48, count=12):
    """Level of each harmonic of a rendered note (a plain DFT at the note's own harmonics)."""
    x = play(p, note, secs=.5)[4800:4800 + 9600]; f0 = 440 * 2 ** ((note - 69) / 12)
    out = []
    for k in range(1, count + 1):
        w = 2 * math.pi * k * f0 / R
        out.append(math.hypot(sum(v * math.cos(w * i) for i, v in enumerate(x)), sum(v * math.sin(w * i) for i, v in enumerate(x))))
    top = max(out); return [v / top for v in out]


def base():
    return dict(instrument('Warm Keys'), filter=1., sustain=1., attack=.001, decay=1., modulation=0., velocity_brightness=0.)


class OscillatorTest(unittest.TestCase):
    def test_a_sound_without_the_keys_is_wave_zero(self):
        p = base(); self.assertNotIn('wave', p)
        self.assertEqual(play(p), play(dict(p, wave=0, pulse_width=.1, fm_ratio=5, fm_index=1.)))

    def test_bessel_values(self):
        self.assertAlmostEqual(bessel_j(0, 1.), .76520, places=4)
        self.assertAlmostEqual(bessel_j(1, 1.), .44005, places=4)
        self.assertAlmostEqual(bessel_j(2, 3.), .48609, places=4)

    def test_saw_falls_as_one_over_k(self):
        w = wave_partials(dict(wave=1), 16)
        for k in range(16): self.assertAlmostEqual(w[k], 1 / (k + 1), places=9)
        lv = partial_levels(dict(base(), wave=1))
        self.assertAlmostEqual(lv[1] / lv[0], .5, delta=.06); self.assertAlmostEqual(lv[2] / lv[0], 1 / 3, delta=.06)

    def test_a_square_has_odd_partials_only_and_a_narrow_pulse_misses_its_own_multiples(self):
        sq = wave_partials(dict(wave=2, pulse_width=.5), 16)
        self.assertTrue(all(sq[k] < 1e-9 for k in range(1, 16, 2)))
        n = wave_partials(dict(wave=2, pulse_width=.25), 16)
        self.assertTrue(all(n[k] < 1e-9 for k in (3, 7, 11, 15)) and n[1] > .5)
        lv = partial_levels(dict(base(), wave=2, pulse_width=.5))
        self.assertLess(lv[1], .05); self.assertLess(lv[3], .05); self.assertGreater(lv[2], .2)

    def test_fm_with_ratio_two_has_odd_partials_and_the_index_opens_the_spectrum(self):
        dull = wave_partials(dict(wave=3, fm_ratio=2, fm_index=.05), 16); wide = wave_partials(dict(wave=3, fm_ratio=2, fm_index=.8), 16)
        self.assertTrue(all(wide[k] < 1e-9 for k in range(1, 16, 2)))
        self.assertGreater(sum(wide[2:]), sum(dull[2:]) * 5)
        self.assertEqual(dull[0], 1.)
        ratio3 = wave_partials(dict(wave=3, fm_ratio=3, fm_index=.5), 16)    # 1 + 3n: 1 4 7 ... and 2 5 8 ... (the folded ones)
        self.assertGreater(ratio3[3], .01)

    def test_every_wave_renders_finite_and_never_clips_across_the_keyboard(self):
        for wave in (1, 2, 3):
            for note in (24, 60, 96):
                with self.subTest(wave=wave, note=note):
                    x = play(dict(base(), wave=wave, pulse_width=.1, fm_ratio=7, fm_index=1., air=.8), note, secs=.2)
                    self.assertTrue(all(math.isfinite(v) and abs(v) <= 1 for v in x)); self.assertGreater(max(map(abs, x)), .01)

    def test_high_notes_are_band_limited(self):
        # note 96 is 2093 Hz: partial 11 and up would pass 22 kHz; the table keeps only what fits, so nothing aliases back
        x = play(dict(base(), wave=1), 96, secs=.3)
        f0 = 440 * 2 ** ((96 - 69) / 12)
        def level(f):
            w = 2 * math.pi * f / R; seg = x[4800:4800 + 4800]
            return math.hypot(sum(v * math.cos(w * i) for i, v in enumerate(seg)), sum(v * math.sin(w * i) for i, v in enumerate(seg)))
        self.assertLess(level(f0 * 1.5), level(f0) * .02)

    def test_validation_and_save_load(self):
        validate_instrument(dict(instrument('Bass'), wave=3, pulse_width=.02, fm_ratio=8, fm_index=1.))
        for bad in (dict(wave=4), dict(wave=1.5), dict(pulse_width=.01), dict(pulse_width=.6), dict(fm_ratio=0), dict(fm_ratio=9), dict(fm_index=1.1)):
            with self.subTest(bad=bad), self.assertRaises(Exception): validate_instrument(dict(instrument('Bass'), **bad))
        e = Engine(R); e.project.tracks[0]['instrument'].update(wave=3, fm_ratio=5, fm_index=.6, pulse_width=.2)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'p.json'); e.project.save(path); back = Project.load(path)
        ins = back.tracks[0]['instrument']
        self.assertEqual((ins['wave'], ins['fm_ratio'], ins['fm_index'], ins['pulse_width']), (3, 5, .6, .2))

    def test_a_mod_pad_on_the_pulse_width_moves_the_spectrum(self):
        self.assertIn('pulse_width', SOUND_PARAMS); self.assertIn('fm_index', SOUND_PARAMS)
        s = Synth(R); s.configure(dict(base(), wave=2, pulse_width=.5)); s.on(48, 100)
        still = [s.render(256) for _ in range(8)]
        s.modulate({'pulse_width': -.25})
        for _ in range(20): s.render(256)
        moved = s.render(256)
        self.assertNotEqual(still[-1], moved)
        s.modulate({})
        for _ in range(20): s.render(256)

    def test_changing_the_wave_while_playing_does_not_click(self):
        s = Synth(R); s.configure(dict(base(), wave=1)); s.on(48, 100)
        for _ in range(20): s.render(256)
        a = s.render(256)
        s.configure(dict(base(), wave=3, fm_index=.8)); b = s.render(256)
        self.assertLess(abs(b[0] - a[-1]), .15)    # the 5 ms table crossfade carries it across

    def test_factory_presets_use_the_oscillator_and_the_pwm_pad_moves(self):
        from decksynth.library import BY_NAME
        for name, wave in (('Phase Lead', 2), ('Square Lead', 2), ('Saw Bass', 1), ('Night Drive Pad', 2), ('Electric Piano', 3), ('Digital Bell', 3)):
            self.assertEqual(BY_NAME[name]['instrument'].get('wave'), wave, name)
        self.assertNotEqual(BY_NAME['Phase Lead']['instrument']['pulse_width'], BY_NAME['Square Lead']['instrument']['pulse_width'])
        e = Engine(R); e.select(0); e.apply_preset('Night Drive Pad'); e.playing = True; e.voice_on(0, 48, 100, ('t', 1)); widths = set()
        for _ in range(R * 5 // 256):
            e.render_stereo(256); sh = e.synths[0].shape
            if sh: widths.add(round(sh['pulse_width'], 2))
        self.assertGreater(len(widths), 5)
        self.assertTrue(all(.02 <= w <= .5 for w in widths))


if __name__ == '__main__':
    unittest.main()
