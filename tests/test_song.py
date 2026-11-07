"""Song timeline: clips per track, blocks on lanes, fills on the bar grid, markers, save/open and export."""
import tempfile, unittest, pathlib
from decksynth.core import Engine, Project
from decksynth import song as songs
from decksynth.song import block


def note(n, start=0.): return dict(start=start, duration=.5, note=n, velocity=100)


def played(e, beats):
    """MIDI notes started per track while rendering `beats` beats, with the beat they started on."""
    seen = []
    orig = e.voice_on
    def spy(tr, n, v, token):
        seen.append((tr, n, round(e.frame / e.fpb))); orig(tr, n, v, token)
    e.voice_on = spy
    frames = int(beats * e.fpb)
    while frames > 0:
        k = min(frames, 512); e.render(k); frames -= k
    e.voice_on = orig
    return seen


def timeline(length, lane0, loop=False, markers=None):
    return dict(on=True, loop=loop, length=length, markers=markers or [dict(bar=0, name='Intro')],
                lanes=[lane0, [], [], []])


class SongTests(unittest.TestCase):
    def setUp(self):
        # Two-bar clips: A plays 60 then 61, B plays 62 then 63 (one note per bar).
        self.e = Engine(1000); self.e.project.bars = 2
        self.e.project.tracks[0]['notes'] = [note(60), note(61, 4)]
        self.e.clip_action(0, 'open', 1); self.e.project.tracks[0]['notes'] = [note(62), note(63, 4)]
        self.e.clip_action(0, 'open', 0)

    def test_clips_are_kept_per_track(self):
        p = self.e.project
        self.assertEqual(p.tracks[0]['notes'], [note(60), note(61, 4)])
        self.assertEqual(p.clip_notes(0, 1), [note(62), note(63, 4)])
        self.e.clip_action(0, 'copy', 2, 1)
        self.assertEqual(p.clip_notes(0, 2), [note(62), note(63, 4)])
        self.e.clip_action(0, 'clear', 2)
        self.assertEqual(p.clip_notes(0, 2), [])

    def test_blocks_play_in_line_with_the_grid_and_gaps_are_silent(self):
        # A for bars 0-2, then a one-bar fill of B on bar 3 (it plays B's second bar), bar 4 silent, B from bar 5.
        self.e.set_song(timeline(6, [block(0, 3, 0), block(3, 1, 1, 1), block(5, 1, 1)]))
        self.e.playing = True
        seen = [(n, b) for _, n, b in played(self.e, 25)]
        self.assertEqual(seen, [(60, 0), (61, 4), (60, 8), (63, 12), (62, 20)])
        self.assertFalse(self.e.playing, 'a song that plays once stops at its end')

    def test_a_block_can_start_on_any_clip_bar(self):
        self.e.set_song(timeline(2, [block(0, 2, 0, 1)]))
        self.e.playing = True
        self.assertEqual([n for _, n, _ in played(self.e, 8)], [61, 60])

    def test_looping_song_wraps(self):
        self.e.set_song(timeline(1, [block(0, 1, 1)], loop=True))
        self.e.playing = True
        self.assertEqual([n for _, n, _ in played(self.e, 12)], [62, 62, 62])
        self.assertTrue(self.e.playing)

    def test_loop_mode_plays_only_the_open_clip(self):
        self.e.playing = True
        self.assertEqual([n for _, n, _ in played(self.e, 16)], [60, 61, 60, 61])

    def test_other_tracks_follow_their_own_lanes(self):
        p = self.e.project; p.tracks[1]['notes'] = [note(40)]
        s = timeline(2, [block(0, 2, 0)]); s['lanes'][1] = [block(1, 1, 0, 1)]
        p.tracks[1]['notes'] = [note(40), note(41, 4)]
        self.e.set_song(s); self.e.playing = True
        self.assertEqual(sorted(played(self.e, 8)), [(0, 60, 0), (0, 61, 4), (1, 41, 4)])

    def test_merge_joins_and_overlaps(self):
        lanes = songs.merge([block(0, 2, 0), block(2, 2, 0), block(1, 1, 1)], 8, 2)
        self.assertEqual(lanes, [block(0, 1, 0), block(1, 1, 1), block(2, 2, 0)])
        # A block placed inside another cuts it in two; touching blocks stay apart unless joined.
        self.assertEqual(songs.merge([block(0, 6, 0), block(2, 1, 1)], 8, 2), [block(0, 2, 0), block(2, 1, 1), block(3, 3, 0, 1)])
        self.assertEqual(len(songs.merge([block(0, 1, 0), block(1, 1, 0, 1)], 8, 2)), 2)
        self.assertEqual(songs.merge([block(0, 1, 0), block(1, 1, 0, 1)], 8, 2, join=True), [block(0, 2, 0)])
        self.assertEqual(songs.merge([block(6, 5, 0)], 8, 2), [block(6, 2, 0)])

    def test_position_reports_bar_and_marker(self):
        self.e.set_song(timeline(8, [block(0, 8, 0)], markers=[dict(bar=0, name='Intro'), dict(bar=4, name='Drop')]))
        self.e.playing = True; played(self.e, 21)
        self.assertEqual(self.e.song_position(), dict(bar=5, length=8, marker=1, name='Drop'))

    def test_old_section_songs_open_as_a_timeline(self):
        old = dict(on=True, loop=False, sections=[
            dict(name='Intro', clips=[0, -1, -1, -1], repeats=2, fill=[1, -2, -2, -2]),
            dict(name='Drop', clips=[1, 0, -1, -1], repeats=1)])
        s = songs.validate(old, 2)
        self.assertEqual(s['length'], 6)
        self.assertEqual(s['markers'], [dict(bar=0, name='Intro'), dict(bar=4, name='Drop')])
        self.assertEqual(s['lanes'][0], [block(0, 2, 0), block(2, 4, 1)])
        self.assertEqual(s['lanes'][1], [block(4, 2, 0)])

    def test_save_open_and_undo(self):
        self.e.set_song(timeline(4, [block(0, 2, 1)], markers=[dict(bar=0, name='Verse')]))
        with tempfile.TemporaryDirectory() as d:
            f = pathlib.Path(d) / 'p.json'; self.e.project.save(f); p = Project.load(f)
        self.assertEqual(p.song['markers'][0]['name'], 'Verse')
        self.assertEqual(p.song['lanes'][0], [block(0, 2, 1)])
        self.assertEqual(p.clip_notes(0, 1), [note(62), note(63, 4)])
        self.e.undo(); self.assertFalse(self.e.project.song['on'])

    def test_bad_songs_are_rejected(self):
        for bad in [timeline(0, []), timeline(4, [block(4, 1, 0)]), timeline(4, [block(0, 1, 9)]),
                    timeline(4, [block(0, 0, 0)]), timeline(4, [dict(at=0, len=1, clip=0, off=8)]),
                    dict(timeline(4, []), lanes=[[]] * 3), timeline(4, [], markers=[dict(bar=9, name='x')])]:
            with self.assertRaises(ValueError): self.e.set_song(bad)

    def test_export_writes_the_whole_song(self):
        self.e.set_song(timeline(5, [block(0, 3, 0), block(4, 1, 1)]))
        with tempfile.TemporaryDirectory() as d:
            f = pathlib.Path(d) / 's.mid'; self.e.project.export_midi(f); data = f.read_bytes()
        self.assertEqual(data.count(bytes([0x90, 60, 100])), 2)
        self.assertEqual(data.count(bytes([0x90, 61, 100])), 1)
        self.assertEqual(data.count(bytes([0x90, 62, 100])), 1)


if __name__ == '__main__':
    unittest.main()
