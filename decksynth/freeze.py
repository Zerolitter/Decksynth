"""Frozen tracks: a track's sound rendered to a WAV that plays instead of its synth and FX.

A freeze is stored on the track as track['freeze'] (metadata only, never audio):
  file          absolute path of a 32-bit float stereo WAV
  mode          'song' (the timeline) or 'loop' (the open loops)
  fingerprint   hash of everything the audio was made from
  frames        total frames in the file. Song: one pass, then the ring-out tail.
                Loop: the first passes, until the tails settle (the last one repeats)
  pass_frames   frames of one pass (song length or loop length)
  rate, bpm     output rate and tempo when frozen
  peaks         96 levels (0..1) of the pass, for the lane waveform

The frozen audio is used only while the fingerprint still matches the project and the
transport is in the same mode. Anything else plays the track live, so a stale or missing
file never makes a track go silent.
"""
import array
import hashlib
import json
import math
import mmap
import os
import re
import struct
import tempfile
from pathlib import Path

PEAKS = 96
TAIL_SECONDS = 4.0
MAX_SECONDS = 3600
_KEYS = {'file', 'mode', 'fingerprint', 'frames', 'pass_frames', 'rate', 'bpm', 'peaks'}
# Track keys that don't change the sound before the fader: they stay live on a frozen track.
_LIVE_KEYS = {'freeze', 'freeze_loop', 'volume', 'mute', 'name', 'preset', 'midi_cc'}


def freeze_directory():
    from .drum_memory import data_directory
    base = data_directory()
    if base is None: base = Path(tempfile.gettempdir())/'decksynth-diagnostic'
    return Path(base)/'frozen'


def validate_freeze(value):
    if type(value) is not dict or set(value) != _KEYS: raise ValueError('Invalid frozen track')
    out = dict(value)
    f = out['file']
    if not isinstance(f, str) or not f or len(f) > 4096 or '\0' in f or not os.path.isabs(f):
        raise ValueError('Frozen track file must be an absolute path')
    if out['mode'] not in ('song', 'loop'): raise ValueError('Invalid frozen track mode')
    if not isinstance(out['fingerprint'], str) or not re.fullmatch(r'[0-9a-f]{64}', out['fingerprint']):
        raise ValueError('Invalid frozen track fingerprint')
    for key in ('frames', 'pass_frames', 'rate'):
        if type(out[key]) is not int or out[key] < 1: raise ValueError('Invalid frozen track length')
    if not 8000 <= out['rate'] <= 192000 or out['pass_frames'] > out['frames'] or out['frames'] > out['rate']*MAX_SECONDS*2:
        raise ValueError('Invalid frozen track length')
    if type(out['bpm']) not in (int, float) or not 30 <= out['bpm'] <= 240: raise ValueError('Invalid frozen track tempo')
    peaks = out['peaks']
    if not isinstance(peaks, list) or len(peaks) > PEAKS or any(type(p) not in (int, float) or not 0 <= p <= 1 for p in peaks):
        raise ValueError('Invalid frozen track peaks')
    out['peaks'] = list(peaks)
    return out


def freeze_mode(project):
    return 'song' if project.song['on'] else 'loop'


def fingerprint(project, track, mode=None):
    """Everything the frozen audio depends on, as one hash. Fader, pan, mute and names are left out
    because they're applied live on top of the frozen audio."""
    from . import song as songs
    mode = mode or freeze_mode(project)
    t = project.tracks[track]
    sound = {k: v for k, v in t.items() if k not in _LIVE_KEYS}
    if isinstance(sound.get('instrument'), dict):
        sound['instrument'] = {k: v for k, v in sound['instrument'].items() if k != 'pan'}
    data = dict(v=1, mode=mode, bpm=project.bpm, bars=project.bars, track=sound)
    if mode == 'song':
        s = project.song
        data.update(length=s['length'], lane=s['lanes'][track],
                    clips=[project.clip_notes(track, k) for k in range(songs.CLIPS)])
    raw = json.dumps(data, sort_keys=True, separators=(',', ':'), allow_nan=False, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


class FloatWavWriter:
    """Streams stereo float32 frames into a WAV (format 3), then fixes the header sizes."""
    def __init__(self, path, rate):
        self.path = Path(path); self.rate = rate; self.frames = 0
        self.handle = self.path.open('wb')
        self.handle.write(self._header(0))

    def _header(self, frames):
        size = frames*8
        return (b'RIFF' + struct.pack('<I', 4+26+12+8+size) + b'WAVE'
                + b'fmt ' + struct.pack('<IHHIIHHH', 18, 3, 2, self.rate, self.rate*8, 8, 32, 0)
                + b'fact' + struct.pack('<II', 4, frames)
                + b'data' + struct.pack('<I', size))

    def write(self, interleaved):
        data = interleaved if isinstance(interleaved, array.array) else array.array('f', interleaved)
        self.handle.write(data.tobytes()); self.frames += len(data)//2

    def close(self):
        self.handle.seek(0); self.handle.write(self._header(self.frames)); self.handle.flush()
        os.fsync(self.handle.fileno()); self.handle.close()


def _data_chunk(handle, size):
    """(rate, data offset, frames) of a stereo float32 WAV; raises on anything else."""
    head = handle.read(12)
    if len(head) != 12 or head[:4] != b'RIFF' or head[8:12] != b'WAVE': raise ValueError('Not a WAV file')
    rate = None; pos = 12
    while pos+8 <= size:
        handle.seek(pos); cid = handle.read(4); (length,) = struct.unpack('<I', handle.read(4))
        if cid == b'fmt ':
            fmt, channels, rate, _, _, bits = struct.unpack('<HHIIHH', handle.read(16))
            if fmt != 3 or channels != 2 or bits != 32: raise ValueError('Frozen audio must be stereo float32')
        elif cid == b'data':
            if rate is None: raise ValueError('WAV data before format')
            return rate, pos+8, min(length, size-pos-8)//8
        pos += 8+length+(length & 1)
    raise ValueError('WAV has no audio data')


class FrozenAudio:
    """Read-only, memory-mapped frozen audio. Reading never allocates more than the block."""
    def __init__(self, meta):
        self.meta = meta; self.path = meta['file']
        self.handle = open(self.path, 'rb')
        try:
            size = os.fstat(self.handle.fileno()).st_size
            rate, self.offset, frames = _data_chunk(self.handle, size)
            if rate != meta['rate'] or frames < meta['frames']: raise ValueError('Frozen audio file does not match')
            self.map = mmap.mmap(self.handle.fileno(), 0, access=mmap.ACCESS_READ)
        except Exception:
            self.handle.close(); raise
        self.frames = meta['frames']; self.pass_frames = meta['pass_frames']

    def close(self):
        try: self.map.close()
        finally: self.handle.close()

    def _read(self, start, count):
        out = array.array('f')
        end = min(self.frames, start+count)
        if start < end: out.frombytes(self.map[self.offset+start*8:self.offset+end*8])
        if len(out) < count*2: out.extend([0.]*(count*2-len(out)))
        return out

    def block(self, frame, count, looping):
        """Stereo (left, right) for engine frame `frame`. In a loop, every pass after the first also
        hears the previous pass's ring-out (reverb and delay tails), as the live track would."""
        if self.meta['mode'] == 'song' and not looping:
            data = self._read(frame, count)  # played once: straight through, into the tail
            return data[0::2], data[1::2], data
        cycle, pos = divmod(frame, self.pass_frames)
        if pos+count <= self.pass_frames:
            data = self._read(pos, count)
        else:  # a block that crosses the loop point
            first = self.pass_frames-pos
            data = self._read(pos, first); data.extend(self.block(frame+first, count-first, looping)[2])
            return data[0::2], data[1::2], data
        if self.meta['mode'] == 'loop':
            # Loop freezes hold the first passes until the tails have settled; the last one repeats.
            # Exact for repeatable sounds (free-running LFOs drift, as they would live).
            last = self.frames//self.pass_frames-1
            if cycle > 0: data = self._read(min(cycle, last)*self.pass_frames+pos, count)
            return data[0::2], data[1::2], data
        tail = self.frames-self.pass_frames
        if looping and (cycle > 0) and pos < tail:
            n = min(count, tail-pos); ring = self._read(self.pass_frames+pos, n)
            for i in range(2*n): data[i] += ring[i]
        return data[0::2], data[1::2], data

    def ring(self, cursor, count):
        """Plain read from the file (the ring-out after the song ends)."""
        data = self._read(cursor, count)
        return data[0::2], data[1::2], data


def peaks_of(levels):
    return [round(min(1., v), 3) for v in levels]


def render_freeze(project, track, rate, path, progress=None, cancelled=None, mode=None):
    """Render one track, through its FX and before its fader, to `path`, for `mode` ('song': the whole
    timeline, 'loop': the open loop; default: what the transport plays now). Returns the freeze metadata
    (without the fingerprint, which the caller computes from the live project)."""
    from .core import Engine
    import copy
    mode = mode or freeze_mode(project)
    p = copy.deepcopy(project)
    p.song['on'] = mode == 'song'
    for i, t in enumerate(p.tracks):
        t.pop('freeze', None); t.pop('freeze_loop', None)
        t['mute'] = i != track
    p.metronome = False
    if mode == 'song':
        p.song['loop'] = False
        pass_beats = p.song['length']*4
    else:
        pass_beats = p.beats
    e = Engine(rate); e.project = p; e.configure(); e.load_drum_sources(); e.load_sampler_sources(); e.settle_offline_shaping()
    if p.tracks[track].get('device') == 'sampler' and p.tracks[track]['sampler']['source'] and e.samplers[track].sample is None:
        raise ValueError('The Sampler sample is missing')
    for index, pad in enumerate(e.drums[track].state()['pads']) if p.tracks[track].get('device') == 'drum_rack' else ():
        if pad['status'] == 'MISSING':
            raise ValueError('Missing Drum Rack sample on pad %d' % (index+1))
    e.freeze_render = True; e.capture_track = track; e.captured = []
    fpb = rate*60/p.bpm
    pass_frames = round(pass_beats*fpb); tail = round(TAIL_SECONDS*rate)
    if not 0 < (pass_frames+tail)/rate <= MAX_SECONDS: raise ValueError('Freeze length must be under an hour')
    # Loop: as many passes as it takes for the tails (reverb, delay, releases) to settle, all kept, so
    # every repeat sounds as it does live; the last one repeats from then on. Song: one pass and the ring-out.
    passes = 1+max(1, math.ceil(tail/pass_frames)) if mode == 'loop' else 1
    total = pass_frames*passes if mode == 'loop' else pass_frames+tail
    done = 0; levels = [0.]*PEAKS
    writer = FloatWavWriter(path, rate)
    try:
        e.playing = True
        while done < total:
            if cancelled and cancelled(): raise InterruptedError('Freeze cancelled')
            count = min(256, total-done)
            e.captured = []
            e.render_stereo(count)
            block = array.array('f')
            for left, right in e.captured:
                pair = array.array('f', [0.])*(2*len(left))
                pair[0::2] = array.array('f', left); pair[1::2] = array.array('f', right)
                block.extend(pair)
            if len(block) != 2*count: raise RuntimeError('Freeze capture lost audio')
            writer.write(block)
            if done < pass_frames:
                for j in range(0, count, 8):
                    at = done+j
                    if at >= pass_frames: break
                    b = min(PEAKS-1, at*PEAKS//pass_frames)
                    v = max(abs(block[2*j]), abs(block[2*j+1]))
                    if v > levels[b]: levels[b] = v
            done += count
            if progress: progress(done/total)
    except BaseException:
        writer.handle.close()
        try: os.unlink(path)
        except OSError: pass
        raise
    writer.close()
    return dict(file=str(Path(path).resolve()), mode=mode, frames=writer.frames, pass_frames=pass_frames,
                rate=rate, bpm=p.bpm, peaks=peaks_of(levels))


def freeze_modes(project, track):
    """What a freeze holds: the whole Song timeline when the track has blocks on it, plus the Loop,
    so the track stays frozen in both modes."""
    return ['song', 'loop'] if project.song['lanes'][track] else ['loop']


def describe_holds(metas):
    """'Song 16 bars + Loop 8 bars' for a list of freeze metadata."""
    parts = []
    for m in sorted(metas, key=lambda m: m['mode'] != 'song'):
        bars = m['pass_frames']/m['rate']*m['bpm']/240
        parts.append('%s %s bar%s' % ('Song' if m['mode'] == 'song' else 'Loop', ('%g' % round(bars, 2)), '' if bars == 1 else 's'))
    return ' + '.join(parts)


def freeze_file_name(track, fp):
    return 'track%d-%s.wav' % (track+1, fp[:24])

