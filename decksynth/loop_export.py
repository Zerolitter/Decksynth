"""Export the open loop (one track or the whole mix) as a 24-bit stereo WAV for a DAW or the Sampler.

Lengths:
  'pass'  one pass of the loop from silence
  'tail'  one pass, then the notes are let go and the ring-out (reverb, delay, releases) is kept,
          cut to a whole number of beats so a DAW reads the tempo from the length
  'loop'  a seamless loop: the loop plays until the tails have settled and the last pass is kept,
          so it already holds the previous pass's ring-out and repeats without a click
Level:
  headroom=False  as played (through the master stage and limiter)
  headroom=True   turned down (never up) so the peak sits at -6 dBFS
Never touches the live session: it renders a copy offline.
"""
import array
import copy
import math
import struct

TAIL_MAX_SECONDS = 8.0
SILENT = 10**(-80/20)          # -80 dBFS: the ring-out counts as over below this
HEADROOM_PEAK = 10**(-6/20)    # -6 dBFS
KINDS = ('pass', 'tail', 'loop')


def _prepare(project, rate, track):
    from .core import Engine
    p = copy.deepcopy(project)
    p.song['on'] = False
    p.metronome = False
    for i, t in enumerate(p.tracks):
        t.pop('freeze', None); t.pop('freeze_loop', None)
        if track is not None: t['mute'] = i != track
    if track is not None and not 0 <= track < len(p.tracks): raise ValueError('Choose track 1-%d' % len(p.tracks))
    if all(t['mute'] for t in p.tracks): raise ValueError('Every track is muted')
    e = Engine(rate); e.project = p; e.configure(); e.load_drum_sources(); e.load_sampler_sources(); e.settle_offline_shaping()
    for tr, t in enumerate(p.tracks):
        if t['mute']: continue
        if t.get('device') == 'drum_rack':
            for index, pad in enumerate(e.drums[tr].state()['pads']):
                if pad['status'] == 'MISSING': raise ValueError('Missing Drum Rack sample on track %d pad %d' % (tr+1, index+1))
        if t.get('device') == 'sampler' and t['sampler']['source'] and e.samplers[tr].sample is None:
            raise ValueError('Missing Sampler sample on track %d' % (tr+1))
    return e


def render_loop(project, rate, track=None, kind='loop', progress=None):
    """Interleaved stereo float samples (array 'f') and the frames of one beat."""
    if kind not in KINDS: raise ValueError('Choose one pass, with tail or seamless loop')
    e = _prepare(project, rate, track)
    fpb = rate*60/e.project.bpm
    pass_frames = round(e.project.beats*fpb)
    tail_max = round(TAIL_MAX_SECONDS*rate)
    if not 0 < pass_frames/rate <= 600: raise ValueError('The loop must be under 10 minutes')
    passes = 1+max(1, math.ceil(tail_max/pass_frames)) if kind == 'loop' else 1
    total = pass_frames*passes+(tail_max if kind == 'tail' else 0)
    out = array.array('f'); done = 0
    e.playing = True

    def run(count):
        nonlocal done
        while count:
            n = min(256, count)
            block = e.render_stereo(n)
            out.extend(array.array('f', block)); done += n; count -= n
            if progress: progress(done/total)
    for _ in range(passes): run(pass_frames)
    if kind == 'loop':
        out = out[-2*pass_frames:]
    elif kind == 'tail':
        # Like the end of a Song: the transport stops and the notes still sounding are released, not cut.
        e.playing = False; e.frame = 0; e.release_loops()
        run(tail_max)
        last = len(out)//2
        while last > pass_frames and max(abs(out[2*last-2]), abs(out[2*last-1])) < SILENT: last -= 1
        beats = max(1, math.ceil((last-pass_frames)/fpb-1e-9))
        keep = min(len(out)//2, pass_frames+round(beats*fpb))
        out = out[:2*keep]
    return out, fpb


def write_wav24(path, rate, samples):
    data = bytearray(len(samples)*3)
    for i, x in enumerate(samples):
        v = round(max(-1., min(1., x))*8388607)
        data[3*i:3*i+3] = (v & 0xFFFFFF).to_bytes(3, 'little')
    with open(path, 'wb') as f:
        f.write(b'RIFF'+struct.pack('<I', 36+len(data))+b'WAVE'
                + b'fmt '+struct.pack('<IHHIIHH', 16, 1, 2, rate, rate*6, 6, 24)
                + b'data'+struct.pack('<I', len(data)))
        f.write(data)


def export_loop_wav(project, rate, path, track=None, kind='loop', headroom=False, progress=None):
    samples, fpb = render_loop(project, rate, track, kind, (lambda v: progress(v*.9)) if progress else None)
    peak = max((abs(x) for x in samples), default=0.)
    if peak == 0.: raise ValueError('The loop is silent: nothing to export')
    if headroom and peak > HEADROOM_PEAK:
        gain = HEADROOM_PEAK/peak
        samples = array.array('f', (x*gain for x in samples))
    write_wav24(path, rate, samples)
    if progress: progress(1.)
    frames = len(samples)//2
    return dict(path=str(path), frames=frames, beats=round(frames/fpb, 3), kind=kind)
