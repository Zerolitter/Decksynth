import math
import tempfile
import unittest
from pathlib import Path

from decksynth import sends
from decksynth.core import Engine, Project


def rms(values):
    return math.sqrt(sum(v * v for v in values) / max(1, len(values)))


class SendsTest(unittest.TestCase):
    def tail(self, engine, frames=48000):
        engine.voice_on(0, 60, 100, ('test', 1))
        engine.render_stereo(4800)
        engine.voice_off(0, 60, ('test', 1))
        return engine.render_stereo(frames)

    def test_reverb_send_rings_after_the_note(self):
        dry, wet = Engine(), Engine()
        if not wet.send_buses.available:
            self.skipTest('native FX library not built')
        wet.set_send(0, 'reverb', 1.)
        wet.set_send_setting('reverb', 'decay', .9)
        self.assertEqual(rms(self.tail(dry)[-20000:]), 0.)
        self.assertGreater(rms(self.tail(wet)[-20000:]), .001)

    def test_return_at_zero_is_silent(self):
        e = Engine()
        if not e.send_buses.available:
            self.skipTest('native FX library not built')
        e.set_send(0, 'delay', 1.)
        e.set_send_setting('delay', 'level', 0.)
        self.assertEqual(rms(self.tail(e)[-20000:]), 0.)

    def test_muted_track_does_not_feed(self):
        e = Engine()
        if not e.send_buses.available:
            self.skipTest('native FX library not built')
        e.set_send(0, 'reverb', 1.)
        e.project.tracks[0]['mute'] = True
        self.assertEqual(rms(self.tail(e)), 0.)

    def test_validation_and_round_trip(self):
        e = Engine()
        e.set_send(1, 'delay', 2.)
        self.assertEqual(e.project.tracks[1]['sends'], {'delay': 1.})
        e.set_send_setting('delay', 'time', 4.4)
        self.assertEqual(e.project.sends['delay']['params']['time'], 4.)
        with self.assertRaises(ValueError): e.set_send(0, 'chorus', .5)
        with self.assertRaises(ValueError): e.set_send(7, 'reverb', .5)
        with self.assertRaises(ValueError): e.set_send_setting('reverb', 'nope', .5)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'sends.decksynth'
            e.project.save(path)
            loaded = Project.load(path)
        self.assertEqual(loaded.sends, e.project.sends)
        self.assertEqual(loaded.tracks[1]['sends'], {'delay': 1.})

    def test_old_projects_get_default_sends(self):
        p = Project()
        data = p.data(); self.assertNotIn('sends', data)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'old.decksynth'
            import json
            path.write_text(json.dumps(data))
            self.assertEqual(Project.load(path).sends, sends.defaults())

    def test_undo_restores_send_settings(self):
        e = Engine()
        e.snapshot()
        e.set_send_setting('reverb', 'level', .2)
        e.undo()
        self.assertEqual(e.project.sends['reverb']['level'], sends.RETURN_DEFAULT)


if __name__ == '__main__':
    unittest.main()
