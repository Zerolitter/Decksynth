"""FX buses (sends.py): Send and Through feeds, the old shared Reverb and Delay as Bus A and Bus B, and their sound."""
import copy
import gzip
import json
import math
import tempfile
import unittest
from pathlib import Path

from decksynth import sends
from decksynth.core import Engine, Project
from decksynth.fx import default_chain, validate_chain

FIXTURES = Path(__file__).parent / 'fixtures'
R = 48000


def rms(values):
    return math.sqrt(sum(v * v for v in values) / max(1, len(values)))


def render(e, frames):
    out = []
    while frames > 0:
        n = min(256, frames); out += e.render_stereo(n); frames -= n
    return out


def chain_with(**on):
    """An FX chain with the named effects on, each with the given settings."""
    chain = default_chain()
    for m in chain['modules']:
        if m['id'] in on: m['on'] = True; m['params'].update(on[m['id']])
    return validate_chain(chain)


def load_data(d):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'p.decksynth'; path.write_text(json.dumps(d))
        return Project.load(path)


OLD_SENDS = {'reverb': {'params': {'predelay': .3, 'decay': .85, 'locut': .2, 'hicut': .6, 'width': .7}, 'level': .9},
             'delay': {'params': {'time': 3, 'feedback': .55, 'width': .6}, 'level': .7}}


def old_project():
    """A project saved before buses: the shared Reverb and Delay settings, and per-track send amounts."""
    d = Project().data(); d.pop('buses', None)
    d['sends'] = copy.deepcopy(OLD_SENDS)
    d['tracks'][0]['sends'] = {'reverb': .6, 'delay': .4}
    d['tracks'][1]['sends'] = {'delay': .8}
    d['tracks'][2]['sends'] = {'reverb': .3, 'delay': 0.}
    d['tracks'][0]['instrument']['pan'] = -.4
    return d


class SendsTest(unittest.TestCase):
    def setUp(self):
        if not Engine().send_buses.available:
            self.skipTest('native FX library not built')

    def tail(self, engine, frames=48000):
        engine.voice_on(0, 60, 100, ('test', 1))
        engine.render_stereo(4800)
        engine.voice_off(0, 60, ('test', 1))
        return engine.render_stereo(frames)

    def test_reverb_send_rings_after_the_note(self):
        dry, wet = Engine(), Engine()
        wet.set_send(0, 'reverb', 1.)
        wet.set_send_setting('reverb', 'decay', .9)
        self.assertEqual(rms(self.tail(dry)[-20000:]), 0.)
        self.assertGreater(rms(self.tail(wet)[-20000:]), .001)

    def test_return_at_zero_is_silent(self):
        e = Engine()
        e.set_send(0, 'delay', 1.)
        e.set_send_setting('delay', 'level', 0.)
        self.assertEqual(rms(self.tail(e)[-20000:]), 0.)

    def test_muted_track_does_not_feed(self):
        e = Engine()
        e.set_send(0, 'reverb', 1.)
        e.project.tracks[0]['mute'] = True
        self.assertEqual(rms(self.tail(e)), 0.)

    def test_a_bus_reverb_at_mix_1_returns_no_dry_sound(self):
        """Inside a bus an effect's Mix 1 is all wet: before the reverb's pre-delay is over, the send adds nothing."""
        dry, wet = Engine(), Engine()
        wet.set_bus_chain(0, chain_with(reverb=dict(predelay=1., mix=1.)))
        wet.set_send(0, 0, 1.)
        for e in (dry, wet): e.voice_on(0, 60, 100, ('t', 1))
        a, b = render(dry, 2048), render(wet, 2048)
        self.assertGreater(rms(a), 1e-3)
        self.assertLess(max(abs(x - y) for x, y in zip(a, b)), 1e-12)

    def test_through_takes_the_track_out_of_the_mix(self):
        """Through an empty bus at Return 1 sounds like the track played straight; Send adds a second copy."""
        out = {}
        for mode in ('straight', 'through', 'send', 'through-muted'):
            e = Engine(); e.add_bus('Group'); e.set_bus(2, 'return', 1.)
            if mode != 'straight': e.set_send(0, 2, 1., through=mode != 'send')
            if mode == 'through-muted': e.set_bus(2, 'mute', True)
            e.voice_on(0, 60, 100, ('t', 1)); e.master_enabled = False
            out[mode] = render(e, 4096)
        self.assertGreater(rms(out['straight']), 1e-3)
        self.assertLess(max(abs(x - y) for x, y in zip(out['straight'], out['through'])), 1e-12)
        self.assertAlmostEqual(rms(out['send']) / rms(out['straight']), 2., places=6)
        self.assertEqual(rms(out['through-muted']), 0.)

    def test_through_at_zero_is_silent_and_kept(self):
        e = Engine(); e.set_send(0, 'reverb', 0., through=True)
        self.assertEqual(e.project.tracks[0]['sends'], {'0': {'amount': 0., 'through': True}})
        e.voice_on(0, 60, 100, ('t', 1))
        self.assertEqual(rms(render(e, 4096)), 0.)

    def test_python_mix_matches_the_c_mix_with_four_buses(self):
        """The Python mix (older library, mono render) and the C mix agree with buses C and D, Send and Through."""
        def scene(python_bus):
            e = Engine(R); e.python_bus = python_bus
            e.add_bus('Drive', chain_with(overdrive=dict(drive=.6, mix=1.), delay=dict(time=2, feedback=.5, mix=.5)))
            e.add_bus('Group', chain_with(compressor=dict(amount=.7)))
            e.set_send(0, 'reverb', .5); e.set_send(0, 2, .4)
            e.set_send(1, 3, 1., through=True); e.set_send(2, 3, .5, through=True); e.set_send(2, 1, .3)
            e.project.tracks[2]['instrument']['pan'] = .5
            for tr, n in ((0, 60), (1, 36), (2, 67), (3, 72)): e.voice_on(tr, n, 100, ('t', tr))
            out = render(e, R // 4)
            e.project.tracks[2]['instrument']['pan'] = -.5
            for tr, n in ((0, 60), (1, 36), (2, 67), (3, 72)): e.voice_off(tr, n, ('t', tr))
            return out + render(e, R // 4)
        from decksynth import cbus
        if not cbus.available(): self.skipTest('needs the C mix bus')
        a, b = scene(True), scene(False)
        self.assertGreater(rms(a), 1e-3)
        self.assertEqual([i for i, (x, y) in enumerate(zip(a, b)) if x != y][:5], [], 'first differing samples')

    def test_an_old_song_sounds_as_it_did_before_buses(self):
        """The shared Reverb and Delay of an old song, rendered by the code before buses (fixture), against Bus A
        and Bus B now. The first 10 ms after a bus starts differ (the old reverb return faded in with a little dry
        sound in it); from 1 s on, when the master stage has settled, the samples match."""
        ref = json.loads(gzip.open(FIXTURES / 'legacy_sends_pcm.json.gz', 'rt').read())
        e = Engine(R); e.replace_project(load_data(old_project()))
        notes = ((0, (60, 64, 67)), (1, (36,)), (2, (72, 76)))
        for tr, ns in notes:
            for n in ns: e.voice_on(tr, n, 100, ('t', tr, n))
        out = render(e, R // 2)
        for tr, ns in notes:
            for n in ns: e.voice_off(tr, n, ('t', tr, n))
        out += render(e, R * 2)
        self.assertEqual(len(out), ref['frames'])
        got = out[ref['start']::ref['step']]
        self.assertGreater(rms(got), 1e-3)
        self.assertLess(max(abs(x - y) for x, y in zip(got, ref['samples'])), 1e-9)


class BusDataTest(unittest.TestCase):
    def test_validation_and_round_trip(self):
        e = Engine()
        e.set_send(1, 'delay', 2.)
        self.assertEqual(e.project.tracks[1]['sends'], {'1': {'amount': 1., 'through': False}})
        e.set_send_setting('delay', 'time', 4.4)
        delay = next(m for m in e.project.buses[1]['chain']['modules'] if m['id'] == 'delay')
        self.assertEqual(delay['params']['time'], 4.)
        with self.assertRaises(ValueError): e.set_send(0, 'chorus', .5)
        with self.assertRaises(ValueError): e.set_send(0, 2, .5)  # no Bus C yet
        with self.assertRaises(ValueError): e.set_send(7, 'reverb', .5)
        with self.assertRaises(ValueError): e.set_send(0, 'reverb', float('nan'))
        with self.assertRaises(ValueError): e.set_send_setting('reverb', 'nope', .5)
        with self.assertRaises(ValueError): e.set_bus(0, 'chain', {})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'sends.decksynth'
            e.project.save(path)
            loaded = Project.load(path)
        self.assertEqual(loaded.buses, e.project.buses)
        self.assertEqual(loaded.tracks[1]['sends'], {'1': {'amount': 1., 'through': False}})

    def test_a_send_turned_to_zero_leaves_no_entry(self):
        e = Engine(); e.set_send(0, 'reverb', .5); e.set_send(0, 'reverb', 0.)
        self.assertNotIn('sends', e.project.tracks[0])

    def test_old_projects_without_sends_get_the_default_buses(self):
        d = Project().data(); d.pop('buses', None)
        self.assertEqual(load_data(d).buses, sends.defaults())

    def test_old_sends_become_bus_a_and_bus_b(self):
        p = load_data(old_project())
        self.assertEqual([b['name'] for b in p.buses], ['Reverb', 'Delay'])
        self.assertEqual([b['return'] for b in p.buses], [.9, .7])
        for bus, kind in zip(p.buses, ('reverb', 'delay')):
            on = [m for m in bus['chain']['modules'] if m['on']]
            self.assertEqual([m['id'] for m in on], [kind])
            self.assertEqual(on[0]['params']['mix'], 1.)
            for k, v in OLD_SENDS[kind]['params'].items(): self.assertEqual(on[0]['params'][k], v, kind + '.' + k)
        self.assertEqual(p.tracks[0]['sends'], {'0': {'amount': .6, 'through': False}, '1': {'amount': .4, 'through': False}})
        self.assertEqual(p.tracks[1]['sends'], {'1': {'amount': .8, 'through': False}})
        self.assertEqual(p.tracks[2]['sends'], {'0': {'amount': .3, 'through': False}})
        # Saved again, the file holds buses and no old sends, and it loads back the same.
        saved = p.saved_data(); self.assertNotIn('sends', saved); self.assertIn('buses', saved)
        again = load_data(json.loads(json.dumps(saved)))
        self.assertEqual(again.buses, p.buses); self.assertEqual(again.tracks[0]['sends'], p.tracks[0]['sends'])

    def test_four_buses_at_most_and_removing_one_moves_the_rest_up(self):
        e = Engine()
        self.assertEqual(e.add_bus('C'), 2); self.assertEqual(e.add_bus('D'), 3)
        with self.assertRaises(ValueError): e.add_bus('E')
        e.set_send(0, 3, .5, through=True); e.set_send(0, 1, .2); e.set_send(1, 2, .7)
        e.remove_bus(2)
        self.assertEqual([b['name'] for b in e.project.buses], ['Reverb', 'Delay', 'D'])
        self.assertEqual(e.project.tracks[0]['sends'], {'1': {'amount': .2, 'through': False}, '2': {'amount': .5, 'through': True}})
        self.assertNotIn('sends', e.project.tracks[1])
        e.undo()
        self.assertEqual([b['name'] for b in e.project.buses], ['Reverb', 'Delay', 'C', 'D'])
        self.assertEqual(e.project.tracks[1]['sends'], {'2': {'amount': .7, 'through': False}})
        self.assertEqual(e.send_buses.count, 4)

    def test_feeds_to_a_missing_bus_are_dropped_on_load(self):
        d = Project().data(); d['tracks'][0]['sends'] = {'3': {'amount': .5, 'through': True}, '0': {'amount': .2, 'through': False}}
        self.assertEqual(load_data(d).tracks[0]['sends'], {'0': {'amount': .2, 'through': False}})

    def test_bad_buses_are_refused(self):
        for bad in ([sends.new_bus(0)] * 5, [{'name': 'x'}], [dict(sends.new_bus(0), mute='yes')],
                    [dict(sends.new_bus(0), colour=9)], [dict(sends.new_bus(0), **{'return': float('inf')})]):
            with self.assertRaises(ValueError): sends.validate(bad)

    def test_undo_restores_the_return(self):
        e = Engine()
        e.snapshot()
        e.set_send_setting('reverb', 'level', .2)
        self.assertEqual(e.project.buses[0]['return'], .2)
        e.undo()
        self.assertEqual(e.project.buses[0]['return'], sends.RETURN_DEFAULT)

    def test_tails_follow_the_effects(self):
        self.assertEqual(sends.tail_seconds(chain_with(reverb={})), 8.)
        self.assertEqual(sends.tail_seconds(chain_with(delay={})), 6.)
        self.assertEqual(sends.tail_seconds(chain_with(space=dict(decay=12.))), 13.)
        self.assertEqual(sends.tail_seconds(default_chain()), 0.)

    def test_an_idle_bus_does_not_run(self):
        e = Engine(); e.set_send(0, 'reverb', 1.)
        e.voice_on(0, 60, 100, ('t', 1)); render(e, 2048)
        self.assertGreater(e.send_buses.tail[0], 0); self.assertEqual(e.send_buses.tail[1], 0)  # Bus B never fed


if __name__ == '__main__':
    unittest.main()
