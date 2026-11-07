"""Song arrangement as a timeline.

Each track keeps a pool of clips (A-H). Every clip has the project's loop length. The song is a number of
bars with four lanes; a lane holds blocks (start bar, length in bars, clip, and the clip bar it starts on).
In song bar b a block plays clip bar (off + b - at) mod clip bars. New blocks start in line with the bar grid,
so a one-bar block of a copied clip on the last bar of a phrase plays that clip's last bar: a fill.
Bars without a block are silent. Markers name places (Intro, Drop).
Loop mode (song off) plays each track's open clip, exactly as before.
"""
import math

CLIPS = 8
CLIP_NAMES = 'ABCDEFGH'
MAX_BARS = 256
MAX_BLOCKS = 128
MAX_MARKERS = 32


def block(at, length, clip=0, off=0):
    return dict(at=at, len=length, clip=clip, off=off)


def defaults(bars=4):
    """Song off; when switched on, every track plays clip A for 16 bars (or four loops)."""
    length = max(16, bars * 4)
    return dict(on=False, loop=True, length=length, markers=[dict(bar=0, name='Intro')],
                lanes=[[block(0, length, 0)] for _ in range(4)])


def from_sections(song, bars):
    """Songs saved by patch 23 (a chain of sections) become the same thing on the timeline."""
    lanes = [[] for _ in range(4)]; markers = []; at = 0
    for s in song['sections']:
        markers.append(dict(bar=at, name=s['name']))
        for t in range(4):
            clip, fill = s['clips'][t], s.get('fill', [-2] * 4)[t]
            for r in range(s['repeats']):
                k = fill if (r == s['repeats'] - 1 and fill != -2) else clip
                if k >= 0: lanes[t].append(block(at + r * bars, bars, k))
        at += s['repeats'] * bars
    length = max(1, min(MAX_BARS, at))
    return dict(on=song['on'], loop=song['loop'], length=length, markers=[m for m in markers if m['bar'] < length],
                lanes=[merge(l, length, bars, join=True) for l in lanes])


def phase(b, bar, bars):
    """The clip bar a block plays in a timeline bar."""
    return (b.get('off', 0) + bar - b['at']) % bars


def merge(blocks, length, bars, join=False):
    """Sorted and clipped to the song with no overlaps: a later block wins, and cuts the one under it in two.
    With join, touching blocks that carry on one clip become one block (songs converted from sections)."""
    cells = [None] * length
    for i, b in enumerate(blocks):
        for bar in range(max(0, b['at']), min(length, b['at'] + b['len'])): cells[bar] = (i, b['clip'], phase(b, bar, bars))
    out = []; owner = None
    for bar, cell in enumerate(cells):
        if cell is None: owner = None; continue
        i, k, ph = cell; last = out[-1] if out else None
        same = owner == i or (join and last and last['clip'] == k and phase(last, bar, bars) == ph)
        if last and same and last['at'] + last['len'] == bar: last['len'] += 1
        else: out.append(block(bar, 1, k, ph))
        owner = i
    return out


def validate(song, bars=4):
    """A clean copy of a song, or ValueError."""
    try:
        assert isinstance(song, dict) and isinstance(song.get('on'), bool) and isinstance(song.get('loop'), bool)
        if 'sections' in song and 'lanes' not in song:
            for s in song['sections']:
                assert type(s['repeats']) is int and 1 <= s['repeats'] <= 16
                assert all(type(c) is int and -1 <= c < CLIPS for c in s['clips']) and len(s['clips']) == 4
            song = from_sections(song, bars)
        length = song['length']; assert type(length) is int and 1 <= length <= MAX_BARS
        lanes = song['lanes']; assert isinstance(lanes, list) and len(lanes) == 4
        clean = []
        for lane in lanes:
            assert isinstance(lane, list) and len(lane) <= MAX_BLOCKS
            for b in lane:
                assert type(b['at']) is int and type(b['len']) is int and type(b['clip']) is int
                assert 0 <= b['at'] < length and 1 <= b['len'] <= MAX_BARS and 0 <= b['clip'] < CLIPS
                off = b.get('off', 0); assert type(off) is int and 0 <= off < 8
            clean.append(merge(lane, length, bars))
        markers = song.get('markers', []); assert isinstance(markers, list) and len(markers) <= MAX_MARKERS
        seen = {}
        for m in markers:
            assert type(m['bar']) is int and 0 <= m['bar'] < length
            assert isinstance(m['name'], str) and len(m['name']) <= 24
            seen[m['bar']] = m['name'].strip() or 'Part'
        return dict(on=song['on'], loop=song['loop'], length=length,
                    markers=[dict(bar=b, name=n) for b, n in sorted(seen.items())], lanes=clean)
    except (KeyError, TypeError, AssertionError) as exc:
        raise ValueError('Invalid song arrangement') from exc


def song_bar(song, bar):
    """The timeline bar for an absolute bar since play started (wrapping when the song loops), or None after the end."""
    if bar < 0: return None
    if bar >= song['length']:
        if not song['loop']: return None
        bar %= song['length']
    return bar


def block_at(song, track, bar):
    """The block a track plays in a timeline bar, or None (silent)."""
    for b in song['lanes'][track]:
        if b['at'] <= bar < b['at'] + b['len']: return b
    return None


def clip_at(song, track, bar):
    """Which clip a track plays in a timeline bar, or None (silent)."""
    b = block_at(song, track, bar)
    return None if b is None else b['clip']


def marker_at(song, bar):
    """Index of the marker a timeline bar falls under, or None before the first one."""
    found = None
    for i, m in enumerate(song['markers']):
        if m['bar'] <= bar: found = i
    return found


def song_events(song, lane_clips, track, start_beat, end_beat, bars):
    """Note events for one track between two song beats: (beat, on?, (clip, idx), absolute bar, note).
    lane_clips(k) gives clip k's notes."""
    out = []
    if not song['lanes'][track]: return out
    span = 4 * bars
    first = int(math.floor(start_beat / 4)) - bars - 1
    last = int(math.ceil(end_beat / 4)) + 1
    cache = {}
    for sb in range(max(0, first), last):
        wb = song_bar(song, sb)
        if wb is None: continue
        b = block_at(song, track, wb)
        if b is None: continue
        k = b['clip']
        if k not in cache:
            # The clip's notes sorted into its bars once, so each song bar only looks at its own notes.
            buckets = [[] for _ in range(bars)]
            for idx, n in enumerate(lane_clips(k)):
                s = n['start'] % span; buckets[min(bars - 1, int(s // 4))].append((idx, n, s))
            cache[k] = buckets
        ph = phase(b, wb, bars); lo = ph * 4
        for idx, n, s in cache[k][ph]:
            on = sb * 4 + s - lo; off = on + n['duration']
            if start_beat <= on < end_beat: out.append((on, 1, (k, idx), sb, n))
            if start_beat <= off < end_beat: out.append((off, 0, (k, idx), sb, n))
    return out


def empty_clips():
    """Per track: the 8 clip slots (the open one is kept in the track's own 'notes') and which one is open."""
    return dict(slots=[[[] for _ in range(CLIPS)] for _ in range(4)], open=[0, 0, 0, 0])


def validate_clips(clips, beats):
    try:
        slots, opened = clips['slots'], clips['open']
        assert len(slots) == 4 and len(opened) == 4
        assert all(type(k) is int and 0 <= k < CLIPS for k in opened)
        total = 0
        for track in slots:
            assert isinstance(track, list) and len(track) == CLIPS
            for clip in track:
                assert isinstance(clip, list); total += len(clip)
                for n in clip:
                    assert isinstance(n['start'], (int, float)) and isinstance(n['duration'], (int, float))
                    assert math.isfinite(n['start']) and math.isfinite(n['duration'])
                    assert 0 <= n['start'] < beats and 0 < n['duration'] <= beats
                    assert type(n['note']) is int and 0 <= n['note'] <= 127
                    assert type(n['velocity']) is int and 1 <= n['velocity'] <= 127
        assert total <= 100000
        return dict(slots=[[[dict(start=n['start'], duration=n['duration'], note=n['note'], velocity=n['velocity'])
                             for n in clip] for clip in track] for track in slots], open=list(opened))
    except (KeyError, TypeError, AssertionError) as exc:
        raise ValueError('Invalid loops') from exc
