import struct
import tempfile
import unittest
from pathlib import Path

from decksynth.core import Engine
from decksynth.midi_import import read_midi_notes


def smf(tracks, tpb=96):
    """A tiny format-1 file; tracks = [[(tick, status, d1, d2), ...], ...]."""
    def vlq(n):
        out = [n & 127]; n >>= 7
        while n:
            out.insert(0, (n & 127) | 128); n >>= 7
        return bytes(out)
    out = b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks), tpb)
    for events in tracks:
        body, prev = b'', 0
        for tick, status, d1, d2 in sorted(events):
            body += vlq(tick - prev) + bytes([status, d1, d2]); prev = tick
        body += b'\0\xff\x2f\0'
        out += b'MTrk' + struct.pack('>I', len(body)) + body
    return out


class MidiImport(unittest.TestCase):
    def write(self, data):
        d = tempfile.TemporaryDirectory(); self.addCleanup(d.cleanup)
        p = Path(d.name) / 'in.mid'; p.write_bytes(data); return p

    def test_export_then_import_round_trips_the_open_clip(self):
        e = Engine()
        notes = [dict(start=0., duration=.5, note=60, velocity=90), dict(start=1.5, duration=1., note=64, velocity=70)]
        e.project.tracks[0]['notes'] = [dict(n) for n in notes]
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'out.mid'; e.project.export_midi(path)
            e.project.tracks[0]['notes'] = []
            count, bars, dropped = e.import_midi(path)
        self.assertEqual((count, dropped), (2, 0))
        self.assertEqual(e.project.tracks[0]['notes'], notes)

    def test_running_status_and_note_on_zero_end_a_note(self):
        data = smf([[(0, 0x90, 62, 100), (48, 0x90, 62, 0)]])
        _, notes = read_midi_notes(self.write(data))
        self.assertEqual(notes, [(0, 0., .5, 62, 100)])

    def test_a_drum_track_takes_channel_10_and_undo_restores_the_clip(self):
        e = Engine(); e.project.tracks[0]['device'] = 'drum_rack'
        before = [dict(start=0., duration=.25, note=36, velocity=100)]
        e.project.tracks[0]['notes'] = [dict(n) for n in before]
        data = smf([[(0, 0x90, 60, 100), (96, 0x80, 60, 0)], [(0, 0x99, 38, 120), (24, 0x89, 38, 0)]])
        count, _, _ = e.import_midi(self.write(data))
        self.assertEqual(count, 1); self.assertEqual(e.project.tracks[0]['notes'][0]['note'], 38)
        e.undo_any(); self.assertEqual(e.project.tracks[0]['notes'], before)

    def test_a_file_that_starts_late_starts_on_bar_one_and_grows_the_loop(self):
        e = Engine(); e.project.bars = 1
        data = smf([[(96 * 8, 0x90, 60, 100), (96 * 8 + 96 * 7, 0x80, 60, 0)]])
        count, bars, _ = e.import_midi(self.write(data))
        self.assertEqual(e.project.tracks[0]['notes'][0]['start'], 0.)
        self.assertEqual(bars, 2); self.assertEqual(e.project.bars, 2)

    def test_channel_summary_and_picked_channels(self):
        from decksynth.midi_import import midi_channels
        data = smf([[(0, 0x90, 60, 100), (96, 0x80, 60, 0), (0, 0x91, 48, 90), (96, 0x81, 48, 0)],
                    [(0, 0x99, 36, 120), (24, 0x89, 36, 0)]])
        path = self.write(data)
        summary = midi_channels(path)
        self.assertEqual([(c['channel'], c['notes'], c['low'], c['high']) for c in summary], [(1, 1, 60, 60), (2, 1, 48, 48), (10, 1, 36, 36)])
        e = Engine()
        count, _, _ = e.import_midi(path, [2, 10])
        self.assertEqual(count, 2)
        self.assertEqual(sorted(n['note'] for n in e.project.tracks[0]['notes']), [36, 48])
        with self.assertRaises(ValueError): e.import_midi(path, [])


if __name__ == '__main__':
    unittest.main()
