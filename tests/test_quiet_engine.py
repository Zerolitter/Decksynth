"""The quiet-engine speed-ups must not change what the engine does.

Each test keeps a copy of the slow original (the "reference") and checks that the faster code gives the
same parameters, the same note events and the same sound.
"""
import copy
import math
import random
import unittest

from decksynth import fx as fxmod
from decksynth import song as songs
from decksynth.fx import (DRUM_TARGETS, GATE_PERFORMANCE, NMACRO, NMOD_SRC, NPAR, ORDER, PARAMS, SAMPLER_TARGETS, SOUND_PARAMS,
                          TrackFx, _drum_key, default_chain, mod_value, validate_chain)
from tests.test_goldens import test_signal


def reference_modulate(self, beat, automation=None):
    """The original TrackFx.modulate (before 17 Nov): every parameter rewritten every block."""
    c = self.chain
    if not c: self.sound = {}; self.sampler = {}; self.drum = {}; return
    automation = automation or {}
    offsets = {}
    macros = c.get('macros') or []
    values = [automation.get(('macro', str(i)), m['value']) for i, m in enumerate(macros)]
    self.move_puck(beat, values)
    for m, v in zip(macros, values):
        for t in m['targets']:
            key = (t['module'], t['param']); offsets[key] = offsets.get(key, 0) + v * t['depth']
    for i, m in enumerate(c.get('mods') or []):
        if not m['targets']: self.mod_values[i] = 0.; continue
        v, ph = mod_value(m, beat); self.mod_values[i] = v; self.mod_phases[i] = ph
        for t in m['targets']:
            key = (t['module'], t['param']); offsets[key] = offsets.get(key, 0) + v * t['depth'] * .5
    self.sound = {k[1]: v * (SOUND_PARAMS[k[1]][1] - SOUND_PARAMS[k[1]][0]) for k, v in offsets.items() if k[0] == 'sound'}
    self.sampler = {k[1]: v * (SAMPLER_TARGETS[k[1]][1] - SAMPLER_TARGETS[k[1]][0]) for k, v in offsets.items() if k[0] == 'sampler'}
    self.drum = {}
    for k, v in offsets.items():
        if k[0] == 'drum': lo, hi = DRUM_TARGETS[_drum_key(k[1])]; self.drum[k[1]] = v * (hi - lo)
    gate = next((m for m in c['modules'] if m['id'] == 'gate'), None)
    if gate:
        for k, (lo, hi, init) in GATE_PERFORMANCE.items():
            self.gate_values[k] = min(hi, max(lo, automation.get(('gate', k), gate['params'].get(k, init)) + offsets.get(('gate', k), 0.) * (hi - lo)))
        if any(('gate', k) in offsets or ('gate', k) in automation for k in ('phase', 'notelen')):
            self._gate_extended = True
    if not offsets and not automation and not getattr(self, '_dirty', False): return
    self._dirty = bool(offsets or automation)
    for m in c['modules']:
        idx = ORDER.index(m['id'])
        for j, (key, lo, hi, init) in enumerate(PARAMS[m['id']]):
            v = automation.get((m['id'], key), m['params'].get(key, init)) + offsets.get((m['id'], key), 0.) * (hi - lo)
            self.params[idx * NPAR + j] = min(hi, max(lo, v))


def random_chain(rng, linked):
    chain = default_chain()
    for m in chain['modules']:
        m['on'] = rng.random() < .5
        for k, lo, hi, _ in PARAMS[m['id']]:
            m['params'][k] = lo + (hi - lo) * rng.random()
    if linked:
        targets = [(m, k) for m, specs in PARAMS.items() for k, *_ in specs] + [('sound', 'filter'), ('sound', 'attack'), ('sampler', 'cutoff'), ('drum', '3:gain'), ('gate', 'phase')]
        for macro in rng.sample(chain['macros'], 3):
            macro['value'] = rng.random()
            macro['targets'] = [dict(module=m, param=k, depth=rng.uniform(-1, 1)) for m, k in rng.sample(targets, 3)]
        for mod in rng.sample(chain['mods'], 2):
            mod['targets'] = [dict(module=m, param=k, depth=rng.uniform(-1, 1)) for m, k in rng.sample(targets, 2)]
    return validate_chain(chain)


@unittest.skipUnless(fxmod.available(), 'native FX library not built')
class ModulateMatchesTheOriginal(unittest.TestCase):
    def same(self, a, b, where):
        self.assertEqual(list(a.params), list(b.params), where + ': params')
        self.assertEqual(a.sound, b.sound, where + ': sound'); self.assertEqual(a.sampler, b.sampler, where + ': sampler')
        self.assertEqual(a.drum, b.drum, where + ': drum')
        self.assertEqual(a.mod_values, b.mod_values, where + ': mod pads'); self.assertEqual(a.gate_values, b.gate_values, where + ': gate')

    def test_random_chains_over_many_blocks(self):
        rng = random.Random(7)
        for case in range(40):
            a, b = TrackFx(48000), TrackFx(48000)
            a.watched = True   # the reference always moves the puck
            chain = random_chain(rng, linked=case % 4 != 0)
            a.configure(chain); b.configure(copy.deepcopy(chain))
            beat = 0.
            for block in range(60):
                beat += .043
                automation = {}
                if case % 3 == 0 and 10 <= block < 30:
                    automation = {('filter', 'cutoff'): .5, ('delay', 'mix'): .25}
                if block == 40:
                    # A link is removed and the chain applied again, like the Link page does.
                    chain = copy.deepcopy(chain)
                    for macro in chain['macros']: macro['targets'] = []
                    a.configure(chain); b.configure(copy.deepcopy(chain))
                a.modulate(beat, automation); reference_modulate(b, beat, automation)
                self.same(a, b, 'case %d block %d' % (case, block))

    def test_unlinked_chain_does_nothing_and_does_not_move_the_puck_unless_watched(self):
        fx = TrackFx(48000); fx.configure(default_chain())
        before = list(fx.puck); fx.modulate(3.7)
        self.assertEqual(fx.puck, before)
        fx.watched = True; fx.modulate(3.7)
        self.assertTrue(all(math.isfinite(v) for v in fx.puck))


def reference_loop_events(notes, start, end, loop, fpb):
    """The original per-block walk over every note (before 17 Nov)."""
    out = []
    for cycle in range(max(0, int(start / loop) - 1), int(end / loop) + 1):
        for idx, note in enumerate(notes):
            on = round(cycle * loop + note['start'] * fpb); off = round(cycle * loop + (note['start'] + note['duration']) * fpb)
            for when, action in ((off, 0), (on, 1)):
                if start <= when < end: out.append((when, action, idx, cycle, note))
    return out


class LoopEventsMatchTheOriginal(unittest.TestCase):
    def random_notes(self, rng, beats):
        notes = []
        for _ in range(rng.randint(0, 60)):
            notes.append(dict(start=round(rng.random() * beats * 4) / 4 % beats, duration=rng.choice([.25, .5, 1, 2.5, beats]), note=rng.randint(24, 96), velocity=rng.randint(1, 127)))
        if notes: notes.append(dict(notes[0]))   # two notes starting together
        return notes

    def test_every_block_of_a_few_loops_matches(self):
        rng = random.Random(3); cache = {}
        for case in range(8):
            beats = rng.choice([4, 8, 16]); fpb = 48000 * 60 / rng.choice([60, 97.3, 120, 133, 200]); loop = beats * fpb
            notes = self.random_notes(rng, beats)
            frame = 0
            for block in range(int(3.5 * loop / 128)):
                n = rng.choice([128, 128, 100, 37, 1])
                if block % 97 == 50:   # an edit, in place, like the piano roll does
                    if notes: notes[rng.randrange(len(notes))]['start'] = round(rng.random() * beats * 4) / 4 % beats
                    notes.append(dict(start=0., duration=1., note=60, velocity=100))
                if block % 211 == 100:
                    fpb = 48000 * 60 / rng.choice([90, 111, 150]); loop = beats * fpb   # tempo change, like MIDI clock
                want = reference_loop_events(notes, frame, frame + n, loop, fpb)
                got = songs.loop_events(cache, 0, notes, frame, frame + n, loop, fpb)
                self.assertEqual(len(got), len(want), 'case %d block %d' % (case, block))
                for g, w in zip(got, want):
                    self.assertEqual(g[:4], w[:4]); self.assertIs(g[4], w[4])
                frame += n


class SongEventsMatchTheOriginal(unittest.TestCase):
    def test_cached_and_uncached_agree_through_edits(self):
        rng = random.Random(11); bars = 4; tracks = 2
        song = songs.defaults(bars, tracks); song['length'] = 12
        song['lanes'] = [[songs.block(0, 4, 0), songs.block(4, 4, 1), songs.block(8, 4, 0, 2)] for _ in range(tracks)]
        clips = [[[] for _ in range(songs.CLIPS)] for _ in range(tracks)]
        def fill(tr, k):
            clips[tr][k] = [dict(start=rng.random() * 16, duration=rng.choice([.5, 1, 6]), note=rng.randint(30, 90), velocity=100) for _ in range(rng.randint(0, 25))]
        for tr in range(tracks):
            for k in range(2): fill(tr, k)
        cache = {}
        for step in range(400):
            if step % 37 == 20: fill(rng.randrange(tracks), rng.randrange(2))                 # replaced list
            if step % 53 == 30 and clips[0][0]: clips[0][0][0]['start'] = 3.25                    # in-place edit
            start = rng.random() * 50
            for tr in range(tracks):
                lane = lambda k, tr=tr: clips[tr][k]
                want = songs.song_events(song, lane, tr, start, start + 1.5, bars)
                got = songs.song_events(song, lane, tr, start, start + 1.5, bars, cache)
                self.assertEqual([g[:4] for g in got], [w[:4] for w in want], 'step %d' % step)


@unittest.skipUnless(fxmod.available(), 'native FX library not built')
class SleepingEffects(unittest.TestCase):
    """Effects that have heard silence for long enough answer with zeros, and wake up as if nothing happened."""
    def chain_for(self, module_id):
        chain = default_chain()
        for m in chain['modules']:
            m['on'] = m['id'] == module_id
            if m['on'] and 'mix' in m['params']: m['params']['mix'] = 1
        return validate_chain(chain)

    def play(self, fx, signal):
        out = []
        for i in range(0, len(signal), 1024):
            if self.module == 'resonator': fx.tune([57])
            out += fx.process(signal[i:i + 1024], 120, 0)
        return out

    def test_each_effect_sleeps_and_wakes_like_the_awake_one(self):
        burst = [v * .6 for v in test_signal(24000)]
        silence = [0.] * (48000 * 18)
        for module in ('reverb', 'delay', 'chorus', 'filter', 'overdrive', 'compressor', 'cloud', 'stutter', 'time', 'phaser', 'eq'):
            with self.subTest(effect=module):
                self.module = module
                awake, nap = TrackFx(48000), TrackFx(48000)
                awake.rest_enabled = False
                chain = self.chain_for(module); awake.configure(chain); nap.configure(copy.deepcopy(chain))
                a = self.play(awake, burst + silence + burst); b = self.play(nap, burst + silence + burst)
                head = len(burst) + len(silence)
                self.assertEqual(a[:24000], b[:24000], 'identical while awake')
                self.assertLess(max(abs(x - y) for x, y in zip(a[24000:head], b[24000:head])), 2e-6, 'silence after the burst')
                # Waking: an effect with its own LFO (phaser, chorus) restarts the LFO where it left off, so the
                # waveform can differ; its loudness must not.
                if module in ('chorus', 'cloud', 'stutter', 'phaser'):
                    # Phase of the LFO or of the grains differs, so only check that sound comes out at a sane level.
                    peak = max(abs(v) for v in b[head:]); self.assertTrue(.05 < peak < 2, 'sound after waking')
                else:
                    for i in range(head, len(a) - 1024, 1024):
                        ra = math.sqrt(sum(v * v for v in a[i:i + 1024]) / 1024); rb = math.sqrt(sum(v * v for v in b[i:i + 1024]) / 1024)
                        self.assertLess(abs(ra - rb), .1 * max(ra, rb) + 1e-3, 'loudness after waking at %d' % i)
                # It really slept: well after the output died, the answer is exact zeros.
                self.assertEqual(max(abs(x) for x in b[head - 72000:head - 3000]), 0.)

    def test_a_busy_track_never_sleeps(self):
        fx = TrackFx(48000); fx.configure(self.chain_for('reverb'))
        for _ in range(200): fx.process(test_signal(512), 120, 0)
        self.assertEqual(fx._quiet, 0)

    def test_another_tracks_sound_keeps_a_vocoder_awake(self):
        fx = TrackFx(48000); fx.configure(self.chain_for('vocoder'))
        for _ in range(400): fx.process([0.] * 512, 120, 0, key=[None, test_signal(512)])
        self.assertEqual(fx._quiet, 0)


@unittest.skipUnless(fxmod.available(), 'native FX library not built')
class RunawayEffects(unittest.TestCase):
    """The C code already shrugs off most bad input; this checks the guard around it for the rest."""
    def make(self, module_id):
        fx = TrackFx(48000); chain = default_chain()
        for m in chain['modules']: m['on'] = m['id'] == module_id
        fx.configure(validate_chain(chain))
        return fx

    def test_a_runaway_result_is_cleared_not_kept(self):
        fx = self.make('delay'); good = fx._process
        fx._process = lambda samples, *a, **k: [float('nan')] * len(samples)
        self.assertEqual(fx.process(test_signal(512), 120, 0), [0.] * 512)
        self.assertEqual(fx.cleared, 1)
        fx._process = good
        later = fx.process(test_signal(512), 120, 0)
        self.assertTrue(all(math.isfinite(v) for v in later)); self.assertEqual(fx.cleared, 1)

    def test_stereo_infinity_too(self):
        fx = self.make('reverb')
        fx._process = lambda samples, *a, **k: ([0.] * len(samples), [float('inf')] * len(samples))
        left, right = fx.process_stereo(test_signal(256), 120, 0)
        self.assertEqual((left, right), ([0.] * 256, [0.] * 256))


if __name__ == '__main__':
    unittest.main()
