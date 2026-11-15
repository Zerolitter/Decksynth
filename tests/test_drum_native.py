"""Generated PCM parity, bounded stealing, and optional native startup contracts."""
from array import array
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from decksynth.drum_rack import DrumRack, VOICE_LIMIT, new_kit
from decksynth.samples import DecodedSample


def sample(values, rate=48000):
    data = array('f', values)
    return DecodedSample('1' * 64, '/synthetic.wav', rate, rate, 1, len(data), data, (), len(data), 16)


def rack_with(source, native=False):
    rack = DrumRack(source.rate, None)
    rack.configure(new_kit())
    rack.bind(0, source)
    rack.bind(6, source)
    rack.bind(7, source)
    if not native:
        rack._native = None
    return rack


def render(rack, frames):
    out = [0.] * frames
    rack.render_into(out, frames)
    return out


class StealContinuityTests(unittest.TestCase):
    def test_64_retriggers_between_blocks_preserve_audible_slot_value(self):
        rack = rack_with(sample([1 / 128] * 4096))
        slots = tuple(map(id, rack.voices))
        for _ in range(VOICE_LIMIT):
            self.assertTrue(rack.on(36, 127))
        before = render(rack, 128)
        self.assertEqual(before[-1], .25)
        for _ in range(64):
            rack.on(36, 127)
        after = render(rack, 2)
        self.assertAlmostEqual(after[0], before[-1], places=12)
        self.assertLess(abs(after[1] - after[0]), .01)
        self.assertEqual(tuple(map(id, rack.voices)), slots)
        self.assertEqual(rack.active_count, VOICE_LIMIT)
        self.assertLessEqual(sum(v.old_sample is not None for v in rack.voices), VOICE_LIMIT)
        render(rack, 5000)
        self.assertEqual(rack.active_count, 0)

    def test_scalar_tail_only_slot_is_active_and_cannot_be_reused_as_idle(self):
        rack = rack_with(sample([.1] * 1024))
        slot = rack.voices[0]
        slot.old_scalar = .125
        slot.old_remaining = rack.fade_frames
        slot.last = .125
        self.assertEqual(rack.active_count, 1)
        rack.on(36, 127)
        self.assertIsNone(slot.sample)
        self.assertEqual(slot.old_remaining, 384)
        first = render(rack, 1)
        self.assertEqual(first, [.125])
        rack.fade_pad(0)
        render(rack, 383)
        self.assertEqual(rack.active_count, 1)
        render(rack, 1)
        self.assertEqual(rack.active_count, 0)
        rack.on(36, 127)
        rack.panic()
        self.assertEqual(rack.active_count, 0)
        self.assertEqual(render(rack, 8), [0.] * 8)

    def test_resteal_after_render_uses_combined_last_contribution(self):
        rack = rack_with(sample([.01] * 4096))
        for _ in range(32): rack.on(36, 127)
        render(rack, 128)
        for _ in range(32): rack.on(36, 127)
        before = render(rack, 64)
        for _ in range(64): rack.on(36, 127)
        self.assertAlmostEqual(render(rack, 1)[0], before[-1], places=12)
        rack.panic()
        self.assertTrue(all(v.old_remaining == 0 and v.old_sample is None for v in rack.voices))


class NativeStartupTests(unittest.TestCase):
    def test_missing_compiler_uses_python_fallback_in_fresh_process(self):
        script = """
from array import array
from decksynth.drum_rack import DrumRack, new_kit
from decksynth.drum_native import native_error
from decksynth.samples import DecodedSample
rack = DrumRack(48000, None)
assert rack._native is None
assert native_error()
assert rack.state()['accelerated'] is False
assert rack.state()['native_warning'] == native_error()
rack.configure(new_kit())
data = array('f', [.125] * 512)
rack.bind(0, DecodedSample('1' * 64, '/synthetic.wav', 48000, 48000, 1, 512, data, (), 512, 16))
assert rack.on(36, 127)
out = [0.] * 64
rack.render_into(out, 64)
assert out[0] == 0. and out[-1] == .125
"""
        with tempfile.TemporaryDirectory() as cache:
            env = dict(os.environ, XDG_CACHE_HOME=cache, CC='/missing/decksynth-compiler')
            result = subprocess.run([sys.executable, '-c', script], env=env,
                                    cwd=Path(__file__).resolve().parents[1],
                                    capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)


class NativeDrumTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from decksynth.drum_native import native_kernel, native_error
        cls.kernel = native_kernel()
        if cls.kernel is None:
            raise unittest.SkipTest('optional native compiler/library unavailable: ' + str(native_error()))

    def assert_slots_equal(self, a, b):
        for left, right in zip(a.voices, b.voices):
            self.assertEqual(left.sample is None, right.sample is None)
            self.assertEqual(left.old_sample is None, right.old_sample is None)
            for field in ('pos', 'step', 'gain', 'age', 'remaining', 'old_pos', 'old_step',
                          'old_gain', 'old_age', 'old_remaining', 'old_scalar', 'last'):
                self.assertAlmostEqual(getattr(left, field), getattr(right, field), places=12, msg=field)
        self.assertEqual(a.active_count, b.active_count)

    def test_native_matches_python_pcm_and_cursor_envelopes(self):
        source = sample(math.sin(i * .17) * .2 for i in range(1700))
        python = rack_with(source)
        native = rack_with(source, native=True)
        self.assertIsNotNone(native._native)
        for rack in (python, native):
            rack.kit['pads'][0].update(tune=3.5, gain=.7, velocity=1.3)
            for _ in range(32): rack.on(36, 93)
        for frames, retriggers in ((1, 0), (47, 0), (128, 32), (127, 0), (256, 64), (17, 0), (384, 0), (2000, 0)):
            for rack in (python, native):
                for _ in range(retriggers): rack.on(36, 93)
            expected, actual = render(python, frames), render(native, frames)
            self.assertLessEqual(max(abs(a - b) for a, b in zip(expected, actual)), 1e-12)
            self.assert_slots_equal(python, native)
        self.assertEqual(native.active_count, 0)

    def test_native_choke_eight_ms_and_tail_only_end_match_python(self):
        source = sample([.125] * 2048)
        python, native = rack_with(source), rack_with(source, native=True)
        for rack in (python, native):
            rack.on(43, 127)
            render(rack, 128)
            rack.on(42, 90)
        for frames in (383, 1, 1, 1800):
            self.assertEqual(render(python, frames), render(native, frames))
            self.assert_slots_equal(python, native)
        for rack in (python, native):
            rack.panic()
            slot = rack.voices[0]
            slot.old_scalar, slot.old_remaining, slot.last = .125, rack.fade_frames, .125
        self.assertEqual(render(python, 385), render(native, 385))
        self.assert_slots_equal(python, native)
        self.assertEqual(native.active_count, 0)

    def test_fast_new_hits_end_while_scalar_tail_remains_active(self):
        source = sample([.01] * 512)
        python, native = rack_with(source), rack_with(source, native=True)
        for rack in (python, native):
            rack.kit['pads'][0]['tune'] = -24.
            for _ in range(32): rack.on(36, 127)
            render(rack, 128)
            rack.kit['pads'][0]['tune'] = 24.
            for _ in range(64): rack.on(36, 127)
        self.assertEqual(render(python, 128), render(native, 128))
        self.assert_slots_equal(python, native)
        self.assertTrue(all(v.sample is None and v.old_sample is None for v in native.voices))
        self.assertEqual(native.active_count, 32)
        self.assertEqual(render(python, 256), render(native, 256))
        self.assert_slots_equal(python, native)
        self.assertEqual(native.active_count, 0)

    def test_native_state_and_scratch_are_reused_without_python_value_calls(self):
        rack = rack_with(sample([.01] * 1024), native=True)
        state_id, scratch_id = id(rack._native.states), id(rack._native.scratch)
        for _ in range(64): rack.on(36, 127)
        with patch.object(rack, '_value', side_effect=AssertionError('Python inner sample loop called')):
            output = render(rack, 512)
        self.assertGreater(max(output), 0.)
        self.assertEqual((id(rack._native.states), id(rack._native.scratch)), (state_id, scratch_id))
        self.assertEqual(len(rack._native.states), 32)
        self.assertEqual(len(rack._native.scratch), 256)  # left + right (per-pad pan)
        self.assertTrue(rack.state()['accelerated'])
        self.assertIsNone(rack.state()['native_warning'])


if __name__ == '__main__':
    unittest.main()
