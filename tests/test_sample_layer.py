import math
import os
import struct
import tempfile
import unittest
import wave

from decksynth import sample_layer as SL
from decksynth.core import Engine, Synth, instrument, validate_instrument

R = 48000
FACTORY = 'factory:808-kick-attack.wav'


def write_wav(path, samples, rate=R):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x)) * 32000)) for x in samples))


def play(p, note=48, secs=.6, block=256, velocity=110, release_at=None):
    s = Synth(R); s.configure(p); s.on(note, velocity); out = []
    for i in range(int(secs * R / block)):
        if release_at is not None and i * block >= release_at * R: s.off(note); release_at = None
        out += s.render(block)
    return out


def layered(p, **layer):
    q = dict(p); q.update(layer_on=1, layer_file=FACTORY); q.update(layer); SL.request(q['layer_file'], R, wait=True); return q


def rms(x):
    return math.sqrt(sum(v * v for v in x) / max(1, len(x)))


def sine_synth():
    p = dict(instrument('Warm Keys')); p.update(harmonics=[1.] + [0.] * 15, filter=1.); return p


class SampleLayerTest(unittest.TestCase):
    def test_off_is_the_old_sound_sample_for_sample(self):
        p = sine_synth()
        base = play(p)
        # the keys present but the layer off, a file chosen but not switched on, and a switched-on layer without a file
        self.assertEqual(base, play(dict(p, layer_on=0, layer_mode=2, layer_level=2., layer_tune=5., layer_file=FACTORY)))
        self.assertEqual(base, play(dict(p, layer_on=1)))
        self.assertEqual(base, play(dict(p, layer_on=1, layer_file='')))

    def test_a_missing_or_broken_file_is_silent(self):
        p = sine_synth(); base = play(p)
        self.assertEqual(base, play(dict(p, layer_on=1, layer_file='/nonexistent/kick.wav')))
        self.assertEqual(base, play(dict(p, layer_on=1, layer_file='factory:not-there.wav')))
        with tempfile.TemporaryDirectory() as d:
            bad = os.path.join(d, 'bad.wav'); open(bad, 'wb').write(b'not a wav')
            self.assertEqual(base, play(dict(p, layer_on=1, layer_file=bad)))

    def test_old_projects_render_the_same_with_the_new_engine(self):
        # an instrument that never heard of the layer
        p = instrument('Bass')
        self.assertFalse(any(k.startswith('layer_') for k in p))
        validate_instrument(p)
        a = play(p); b = play(dict(p, **SL.LAYER_DEFAULTS))
        self.assertEqual(a, b)

    def test_attack_adds_a_start_once(self):
        p = sine_synth(); base = play(p, secs=.5)
        q = layered(p)
        out = play(q, secs=.5)
        self.assertGreater(rms(out[:2400]), rms(base[:2400]) * 1.2)    # a click on top of the first 50 ms
        self.assertEqual(out[R // 4:], base[R // 4:])                   # and nothing after the one-shot (0.22 s) is over

    def test_attack_survives_a_very_short_note(self):
        p = sine_synth(); q = layered(p, attack=.001, release=.01)
        out = play(q, secs=.4, release_at=.0)    # note off straight away
        self.assertGreater(max(abs(v) for v in out[:2400]), .05)

    def test_a_long_sample_under_a_fast_arp_stays_bounded(self):
        # 25 Nov: Body -> Attack with a long sample while an arp ran stacked a one-shot per note and the audio froze
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'long.wav')
            write_wav(path, [.3 * math.sin(2 * math.pi * 110 * i / R) for i in range(R * 4)])
            for mode in (1, 2):
                p = dict(sine_synth(), layer_on=1, layer_file=path, layer_mode=mode); SL.request(path, R, wait=True)
                s = Synth(R); s.configure(p); note = None; most = 0; out = []
                for b in range(400):                              # about 2 s of 1/32 notes
                    if b % 10 == 0:
                        if note is not None: s.off(note)
                        note = (48, 52, 55, 60)[b // 10 % 4]; s.on(note, 100)
                    out += s.render(256); most = max(most, len(s.layer))
                self.assertLessEqual(most, SL.MAX_LAYERS + SL.MAX_ATTACKS)
                self.assertLessEqual(len([e for e in s.layer if not e['dying']]), SL.MAX_LAYERS)
                self.assertTrue(all(math.isfinite(v) for v in out))
                jumps = max(abs(a - b) for a, b in zip(out, out[1:]))
                self.assertLess(jumps, .5)                        # the pushed-out one-shots fade, they don't click
                s.panic(); self.assertEqual(s.layer, [])

    def test_attack_tune_and_level(self):
        p = sine_synth(); q = layered(p)
        soft = play(layered(p, layer_level=.25), secs=.3); loud = play(layered(p, layer_level=1.5), secs=.3)
        self.assertGreater(rms(loud[:2400]), rms(soft[:2400]))
        self.assertNotEqual(play(q, secs=.3), play(layered(p, layer_tune=7.), secs=.3))
        self.assertTrue(all(math.isfinite(v) for v in loud))

    def test_start_skips_into_the_sample(self):
        p = sine_synth(); first = play(layered(p), secs=.2); later = play(layered(p, layer_start=.5), secs=.2)
        self.assertGreater(rms(first[:1200]), rms(later[:1200]))

    def test_body_plays_at_the_notes_pitch_and_follows_the_envelope(self):
        # a 100 Hz-ish sample (root found by the Sampler's detector), layered as Body under a silent synth
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'tone.wav'); write_wav(path, [.6 * math.sin(2 * math.pi * 220 * i / R) for i in range(R)])
            p = dict(sine_synth(), gain=.25, sustain=1., release=.05)
            q = layered(p, layer_on=1, layer_file=path, layer_mode=2, layer_level=1.5)
            out = play(q, note=57, secs=.5, release_at=.3)             # A3 = 220 Hz, the sample's own pitch
            # no thrash: still sounding at 0.2 s, silent after the release
            self.assertGreater(rms(out[R // 5:R // 5 + 2400]), .01)
            self.assertLess(rms(out[-2400:]), rms(out[R // 5:R // 5 + 2400]) * .2)
            self.assertTrue(all(math.isfinite(v) for v in out))
            loop = play(layered(p, layer_file=path, layer_mode=2, layer_loop=1), note=57, secs=1.5)
            self.assertGreater(rms(loop[-2400:]), .01)

    def test_through_the_filter_darkens_the_sample(self):
        p = sine_synth(); p.update(vcf_type=1, vcf_morph=0., vcf_cutoff=.1, vcf_reso=.1, vcf_env=0., gain=.01)
        dry = play(layered(p, layer_follow=0), secs=.15); wet = play(layered(p, layer_follow=1), secs=.15)
        self.assertLess(rms(wet[:2400]), rms(dry[:2400]) * .8)

    def test_validation(self):
        p = instrument('Bass')
        for good in ('', FACTORY, '/home/deck/kick.wav'):
            validate_instrument(dict(p, layer_file=good))
        for bad in ('kick.wav', 'factory:../x.wav', 'factory:', '/a/../b.wav', 5, 'x\0'):
            with self.assertRaises(AssertionError): validate_instrument(dict(p, layer_file=bad))
        for key, value in (('layer_on', 2), ('layer_mode', 0), ('layer_level', 3.), ('layer_tune', 40.), ('layer_start', 1.5)):
            with self.assertRaises(AssertionError): validate_instrument(dict(p, **{key: value}))

    def test_partials_are_read_from_a_sample(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'harm.wav')
            f0 = 110.
            write_wav(path, [.5 * math.sin(2 * math.pi * f0 * i / R) + .25 * math.sin(2 * math.pi * 3 * f0 * i / R) + .1 * math.sin(2 * math.pi * 5 * f0 * i / R)
                             for i in range(R)])
            sample = SL.request(path, R, wait=True)
            h, hz = SL.measure_partials(sample, R)
            self.assertAlmostEqual(hz, f0, delta=2.)
            self.assertAlmostEqual(h[0], 1., places=2)
            self.assertAlmostEqual(h[2], .5, delta=.06)
            self.assertAlmostEqual(h[4], .2, delta=.05)
            self.assertLess(h[1], .05)
            self.assertEqual(len(h), 16)

    def test_engine_commands_are_one_undo_step_each(self):
        e = Engine(R); e.select(0)
        before = e.project.tracks[0]['instrument']
        self.assertNotIn('layer_file', before)
        e.set_layer_file(0, FACTORY)
        ins = e.project.tracks[0]['instrument']
        self.assertEqual((ins['layer_file'], ins['layer_on']), (FACTORY, 1))
        e.undo()
        self.assertNotIn('layer_file', e.project.tracks[0]['instrument'])
        e.set_layer_file(0, FACTORY)
        message = e.layer_to_partials(0)
        self.assertIn('Partials written', message)
        h = e.project.tracks[0]['instrument']['harmonics']
        self.assertEqual(len(h), 16); self.assertAlmostEqual(max(h), 1., places=3)
        e.undo()
        self.assertNotEqual(e.project.tracks[0]['instrument']['harmonics'], h)
        with self.assertRaises(ValueError): e.set_layer_file(0, 'relative.wav')
        e.set_layer_file(0, '')
        self.assertEqual(e.project.tracks[0]['instrument']['layer_on'], 0)

    def test_save_and_load_keep_the_layer(self):
        e = Engine(R); e.select(0); e.set_layer_file(0, FACTORY)
        with tempfile.TemporaryDirectory() as d:
            from decksynth.core import Project
            f = os.path.join(d, 'p.decksynth'); e.project.save(f)
            q = Project.load(f)
        self.assertEqual(q.tracks[0]['instrument']['layer_file'], FACTORY)


if __name__ == '__main__':
    unittest.main()
