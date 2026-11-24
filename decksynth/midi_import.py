"""Standard MIDI file import: the notes of a .mid file onto the selected track's open clip.

Only note events are read (tempo, controllers and the rest are ignored). Times become beats from the
file's ticks per quarter note. A drum track takes the file's channel 10 notes when there are any,
every other track takes the notes of all other channels.
"""
import copy
import math
import struct
from pathlib import Path


def _vlq(data, at):
    value = 0
    while True:
        b = data[at]; at += 1
        value = (value << 7) | (b & 127)
        if not b & 128:
            return value, at


def read_midi_notes(path):
    """Return (ticks_per_beat, [(channel, start_beat, duration_beats, note, velocity), ...])."""
    data = Path(path).read_bytes()
    if data[:4] != b'MThd':
        raise ValueError('Not a MIDI file')
    length, _fmt, count, division = struct.unpack('>IHHH', data[4:14])
    if division & 0x8000:
        raise ValueError('SMPTE-timed MIDI files are not supported')
    tpb = division or 480
    at = 8 + length
    notes = []
    for _ in range(count):
        if data[at:at + 4] != b'MTrk':
            break
        size = struct.unpack('>I', data[at + 4:at + 8])[0]
        pos, end = at + 8, at + 8 + size
        at = end
        tick, status, held = 0, 0, {}
        while pos < end:
            delta, pos = _vlq(data, pos); tick += delta
            b = data[pos]
            if b == 0xFF:
                kind = data[pos + 1]; size2, pos = _vlq(data, pos + 2); pos += size2
                if kind == 0x2F:
                    break
                continue
            if b in (0xF0, 0xF7):
                size2, pos = _vlq(data, pos + 1); pos += size2
                continue
            if b & 0x80:
                status = b; pos += 1
            kind, ch = status & 0xF0, status & 0x0F
            width = 1 if kind in (0xC0, 0xD0) else 2
            args = data[pos:pos + width]; pos += width
            if kind == 0x90 and args[1] > 0:
                held.setdefault((ch, args[0]), []).append((tick, args[1]))
            elif kind == 0x80 or (kind == 0x90 and args[1] == 0):
                started = held.get((ch, args[0]))
                if started:
                    on, vel = started.pop(0)
                    notes.append((ch, on / tpb, max(1, tick - on) / tpb, args[0], vel))
        for (ch, pitch), rest in held.items():  # notes never released end on the track's last tick
            for on, vel in rest:
                notes.append((ch, on / tpb, max(1, tick - on) / tpb, pitch, vel))
    return tpb, sorted(notes, key=lambda n: (n[1], n[3]))


def midi_channels(path):
    """What each channel of a MIDI file holds, for the import picker: channel (1-16), notes, lowest, highest."""
    _tpb, notes = read_midi_notes(path)
    out = {}
    for ch, _start, _dur, pitch, _vel in notes:
        c = out.setdefault(ch, dict(channel=ch+1, notes=0, low=pitch, high=pitch))
        c['notes'] += 1; c['low'] = min(c['low'], pitch); c['high'] = max(c['high'], pitch)
    if not out:
        raise ValueError('No notes in that MIDI file')
    return [out[k] for k in sorted(out)]


class MidiImportEngine:
    def import_midi(self, path, channels=None):
        """Replace the open clip's notes on the selected track with the file's notes. One undo step.
        channels: the 1-16 channels to take; None picks by the track (drums: channel 10, others: the rest)."""
        if self.recording:
            raise ValueError('Finish the take first')
        from .core import MAX_BARS
        _tpb, notes = read_midi_notes(path)
        track = self.project.tracks[self.selected]
        if channels is not None:
            wanted = {int(c)-1 for c in channels}
            if not wanted:
                raise ValueError('Choose at least one channel')
            chosen = [n for n in notes if n[0] in wanted]
        else:
            drums = track.get('device') == 'drum_rack'
            chosen = [n for n in notes if (n[0] == 9) == drums] or notes
        if not chosen:
            raise ValueError('No notes in that MIDI file')
        first_bar = math.floor(chosen[0][1] / 4) * 4  # a file that starts late keeps its bar position
        out = []
        for _ch, start, duration, pitch, vel in chosen:
            start = round(start - first_bar, 6)
            if start >= MAX_BARS * 4:
                continue
            out.append(dict(start=start, duration=round(min(duration, MAX_BARS * 4 - start), 6), note=int(pitch), velocity=int(vel)))
        end = max(n['start'] + n['duration'] for n in out)
        bars = min(MAX_BARS, max(1, math.ceil(end / 4 - 1e-6)))
        self.snapshot(); self.stop()
        self.project.bars = max(self.project.bars, bars)
        track['notes'] = copy.deepcopy(out)
        dropped = len(chosen) - len(out)
        return len(out), bars, dropped
