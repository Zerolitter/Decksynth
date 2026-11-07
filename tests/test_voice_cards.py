"""Filter, Unison and Character cards: each one changes the sound the way its name says, C and Python agree,
and projects without the new keys sound exactly as before."""
import math
import unittest
import decksynth.core as core
from decksynth.core import Synth, Engine, instrument
from decksynth.diagnose import clicks


def tone(params, frames=9600, note=57, native=True, during=None):
    orig = core.native_voice2, core.native_voice
    if not native: core.native_voice2 = lambda: None; core.native_voice = lambda: None
    try:
        s = Synth(48000); s.configure({**instrument('Warm Keys'), 'attack': .002, 'sustain': 1., **params})
        s.on(note, 110); out = []
        for i in range(frames // 480):
            if during: during(s, i)
            out += s.render(480)
        return out
    finally: core.native_voice2, core.native_voice = orig


def power(x, hz, rate=48000):
    """Goertzel: energy at one frequency over the second half (after the attack)."""
    x = x[len(x) // 2:]; w = 2 * math.pi * hz / rate; c = 2 * math.cos(w); a = b = 0.
    for v in x: a, b = v + c * a - b, a
    return (a * a + b * b - c * a * b) / len(x) ** 2


class VoiceCards(unittest.TestCase):
    def test_neutral_values_change_nothing(self):
        plain = tone({}); neutral = tone(dict(core.VOICE_DEFAULTS))
        self.assertEqual(plain, neutral)

    def test_low_pass_takes_out_the_top(self):
        open_ = tone({'filter': 1.}); lp = tone({'filter': 1., 'vcf_type': 1, 'vcf_cutoff': .45, 'vcf_env': 0})
        self.assertLess(power(lp, 220 * 8), power(open_, 220 * 8) * .05, 'harmonic 8 cut by the low-pass')
        self.assertGreater(power(lp, 220), power(open_, 220) * .5, 'fundamental kept')
        hp = tone({'filter': 1., 'vcf_type': 3, 'vcf_cutoff': .62, 'vcf_env': 0})
        self.assertLess(power(hp, 220), power(open_, 220) * .1, 'high-pass removes the fundamental')

    def test_unison_detunes(self):
        one = tone({}, frames=24000); many = tone({'uni_voices': 5, 'uni_detune': .6}, frames=24000)
        # Detuned copies spread the fundamental: less energy exactly on 220 Hz, some a few Hz away.
        self.assertLess(power(many, 220), power(one, 220) * .7)
        self.assertGreater(power(many, 220 * 2 ** (.3 / 12)), power(one, 220 * 2 ** (.3 / 12)) * 2)

    def test_sub_adds_an_octave_below(self):
        base = tone({}); sub = tone({'sub': .8}); sub2 = tone({'sub': .8, 'sub_oct': 2})
        self.assertGreater(power(sub, 110), power(base, 110) * 50)
        self.assertGreater(power(sub2, 55), power(base, 55) * 50)

    def test_inharmonic_partials_stretch(self):
        h = [1.] * 16
        plain = tone({'harmonics': h}); bell = tone({'harmonics': h, 'inharm': 1.})
        f8 = 220 * 8 * math.sqrt(1 + .008 * 64)
        self.assertGreater(power(bell, f8), power(plain, f8) * 20, 'partial 8 moved up')
        self.assertLess(power(bell, 220 * 8), power(plain, 220 * 8) * .1)

    def test_formant_shapes_the_spectrum_by_vowel(self):
        h = [1.] * 16
        a = tone({'harmonics': h, 'formant': 1., 'vowel': 0}, note=45)  # 110 Hz: A has F1 near 730
        i = tone({'harmonics': h, 'formant': 1., 'vowel': 2}, note=45)  # I has F1 near 270
        self.assertGreater(power(a, 770) / power(a, 220), power(i, 770) / power(i, 220) * 4)

    def test_native_matches_python(self):
        for params in ({'vcf_type': 1, 'vcf_reso': .7, 'uni_voices': 3, 'sub': .4},
                       {'vcf_type': 2, 'inharm': .5, 'uni_voices': 2, 'formant': .6, 'vowel': 1.5},
                       {'vcf_type': 3, 'vcf_env': -.5, 'sub': .3, 'sub_oct': 2}):
            def off(s, i):
                if i == 12: s.off(57)
            a = tone(params, 9600, during=off); b = tone(params, 9600, native=False, during=off)
            self.assertLess(max(abs(x - y) for x, y in zip(a, b)), 1e-9, params)

    def test_turning_cards_on_mid_note_does_not_click(self):
        def flip(s, i):
            if i == 6: s.configure({**s.params, 'uni_voices': 3, 'vcf_type': 1, 'sub': .3})
        self.assertEqual(clicks(tone({}, 14400, during=flip)), 0)

    def test_engine_parameter_command_and_saved_project(self):
        import json, tempfile, os
        e = Engine(48000); ins = e.project.tracks[0]['instrument']
        ins.update(vcf_type=1, vcf_cutoff=.4, uni_voices=3, formant=.5, vowel=2., inharm=.2, sub=.3, sub_oct=2)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'p.json'); e.project.save(path)
            back = core.Project.load(path).tracks[0]['instrument']
            self.assertEqual(back['uni_voices'], 3); self.assertEqual(back['vowel'], 2.)
            bad = json.loads(open(path).read()); bad['tracks'][0]['instrument']['uni_voices'] = 6
            open(path, 'w').write(json.dumps(bad))
            with self.assertRaises(ValueError): core.Project.load(path)


if __name__ == '__main__':
    unittest.main()
