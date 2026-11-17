"""Library additions (17 Nov): more genres, song parts that belong together, and Structures.

Everything is plain MIDI written here (no sample assets), in four small notations:

* ``line(rhythm, roots)`` for bass and lead lines. One rhythm character per 16th step:
  ``x`` plays the bar's note, ``o`` the octave above, ``5`` the fifth, ``3`` the third (minor),
  ``7`` the minor seventh, ``g`` a soft ghost of the root, ``-`` holds the note before, ``.`` rests.
  ``roots`` gives one root note per bar (the rhythm repeats every bar).
* ``chords(rhythm, progression)``: the same rhythm characters (``x`` plays, ``-`` holds,
  ``.`` rests, ``g`` plays softly), one chord (note names) per bar.
* ``arp(shape, progression)``: one chord per bar, played in the order of ``shape``
  (indexes into the chord, ``+`` adds an octave to the next index).
* ``beat({letter: rhythm})`` for drums: per kit role one rhythm string per bar (or one string
  repeated), ``x`` hit, ``X`` accent, ``g`` ghost, ``.`` rest.

Song parts share a genre and a ``kind`` (Intro, Verse, Fill, Build, Drop, Outro, ...), so they
make sense played in order; the factory Structures put them in order with a repeat count each.
"""
import re
from .pattern_extras import midi, DRUM_LETTERS

MINOR = {'x': 0, 'o': 12, '5': 7, '3': 3, '7': 10, 'g': 0, '4': 5, '2': 2}


def _pattern(steps, length, gate, swing):
    return dict(length=length, division='1/16', gate=max(.1, min(.9, gate)), swing=swing, steps=steps)


def _runs(rhythm):
    """Yield (step, char, held_steps) for every onset in a rhythm string."""
    out = []
    for i, ch in enumerate(rhythm):
        if ch in '.-':
            continue
        tie = 1
        while i + tie < len(rhythm) and rhythm[i + tie] == '-' and tie < 32:
            tie += 1
        out.append((i, ch, tie))
    return out


def line(rhythm, roots, gate=.6, swing=.5, velocity=104):
    rhythm = rhythm.replace(' ', '')
    bar = len(rhythm)
    length = bar * len(roots)
    steps = [[] for _ in range(length)]
    for b, root in enumerate(roots):
        base = midi(root)
        for i, ch, tie in _runs(rhythm):
            vel = 62 if ch == 'g' else velocity if i % 4 == 0 else velocity - 12
            steps[b * bar + i].append(dict(note=base + MINOR[ch], velocity=vel, tie=tie))
    return _pattern(steps, length, gate, swing)


def chords(rhythm, progression, gate=.8, swing=.5, velocity=96):
    rhythm = rhythm.replace(' ', '')
    bar = len(rhythm)
    length = bar * len(progression)
    steps = [[] for _ in range(length)]
    for b, chord in enumerate(progression):
        notes = [midi(n) for n in chord.split(',')]
        for i, ch, tie in _runs(rhythm):
            vel = 64 if ch == 'g' else velocity
            steps[b * bar + i] = [dict(note=n, velocity=vel, tie=tie) for n in notes]
    return _pattern(steps, length, gate, swing)


def arp(shape, progression, bar=16, gate=.5, swing=.5, velocity=92, every=1):
    """shape: tokens such as '0 1 2 +0'; every: a note each N steps."""
    tokens = shape.split()
    length = bar * len(progression)
    steps = [[] for _ in range(length)]
    for b, chord in enumerate(progression):
        notes = [midi(n) for n in chord.split(',')]
        for k, s in enumerate(range(0, bar, every)):
            tok = tokens[k % len(tokens)]
            up = tok.count('+') * 12
            note = notes[int(tok.strip('+')) % len(notes)] + up
            vel = velocity + (10 if s % 4 == 0 else 0) - (6 if s % 2 else 0)
            steps[b * bar + s].append(dict(note=note, velocity=min(127, vel), tie=1))
    return _pattern(steps, length, gate, swing)


def beat(roles_pitch, grid, bars=1, swing=.5, gate=.65):
    """grid: {letter: rhythm}; a rhythm may hold one bar (repeated) or every bar, '|' between bars."""
    bar_rhythms = {k: [r.replace(' ', '') for r in v.split('|')] for k, v in grid.items()}
    bar = len(next(iter(bar_rhythms.values()))[0])
    if any(len(r) != bar for rs in bar_rhythms.values() for r in rs):
        raise ValueError('Drum rhythms need the same bar length')
    length = bar * bars
    steps = [[] for _ in range(length)]
    used = set()
    for letter, rhythms in bar_rhythms.items():
        role = DRUM_LETTERS[letter]
        for b in range(bars):
            r = rhythms[b % len(rhythms)]
            for i, ch in enumerate(r):
                if ch == '.':
                    continue
                vel = 122 if ch == 'X' else 56 if ch == 'g' else (104 if letter in 'ksc' else 92 if i % 4 == 0 else 74)
                steps[b * bar + i].append(dict(note=roles_pitch[role], velocity=vel, tie=1))
                used.add(role)
    return _pattern(steps, length, gate, swing), sorted(used)


# ---------------------------------------------------------------- song parts: drums
# (genre, swing, {part: (bars, grid)})  k kick, s snare, c clap, h closed hat, o open hat, r rim,
# p perc, t tom, y ride, x crash
DRUM_SONGS = [
    ('Hip-hop', .58, {
        'Intro': (1, {'h': 'x.x.x.x.x.x.x.x.', 'k': 'x.........x.....'}),
        'Verse': (2, {'k': 'x.....x...x.....|x.....x.x.....x.', 's': '....X.......X...', 'h': 'x.x.x.x.x.x.x.x.', 'r': '..........g.....'}),
        'Hook': (2, {'k': 'x.....x...x..x..|x.x...x...x.....', 's': '....X.......X...', 'c': '....x.......x...', 'h': 'x.xxx.x.x.xxx.x.', 'o': '..............x.'}),
        'Fill': (1, {'k': 'x.....x.........', 's': '....X.....x.xgxx', 't': '........x.x.....'}),
        'Break': (1, {'k': 'x...............', 'r': '....x.......x...', 'h': '..x...x...x...x.'}),
        'Outro': (1, {'k': 'x.........x.....', 's': '....x...........', 'x': 'X...............'}),
    }),
    ('Trap', .5, {
        'Intro': (1, {'h': 'x.x.x.x.x.x.x.x.'}),
        'Verse': (2, {'k': 'x......x..x.....|x.........x..x..', 's': '........X.......', 'h': 'x.x.x.xxx.x.x.x.|x.x.xxx.x.x.xxxx'}),
        'Hook': (2, {'k': 'x..x...x..x...x.|x......x.xx.....', 's': '........X.......', 'c': '........x.......', 'h': 'xxx.x.xxx.x.xxxx|x.xxx.x.xxxxx.x.', 'o': '......x.........'}),
        'Fill': (1, {'k': 'x.......x.x.....', 's': '........X...xxxx', 'h': 'xxxxxxxxxxxxxxxx'}),
        'Build': (1, {'s': 'x...x...x.x.xxxx', 'h': 'x.x.x.x.xxxxxxxx'}),
        'Outro': (1, {'k': 'x...............', 'h': 'x...x...x...x...'}),
    }),
    ('Garage', .62, {
        'Intro': (1, {'h': '..x...x...x...x.', 'r': '....x.......x...'}),
        'Verse': (2, {'k': 'x.......x.x.....|x......x..x.....', 's': '....X.......X...', 'h': '..x.x.x...x.x.x.', 'r': '.......x.......x'}),
        'Hook': (2, {'k': 'x.....x...x.....|x.......x..x....', 'c': '....X.......X...', 'h': '..xx..x...xx..x.', 'o': '..............x.', 'p': '...x.......x....'}),
        'Fill': (1, {'k': 'x...............', 's': '....x..x.x.xx.xx'}),
        'Break': (1, {'r': '....x..x....x...', 'h': '..x...x...x...x.'}),
        'Outro': (1, {'k': 'x.......x.......', 'c': '....x...........', 'x': 'X...............'}),
    }),
    ('Breakbeat', .52, {
        'Intro': (1, {'y': 'x.x.x.x.x.x.x.x.'}),
        'Verse': (2, {'k': 'x.x.......x.....|x.........xx....', 's': '....X..g.g..X..g', 'h': 'x.x.x.x.x.x.x.x.'}),
        'Hook': (2, {'k': 'x.x.......x..x..|x.........x.....', 's': '....X..g.g..X...|....X..g.g..X.xg', 'y': 'x.x.x.x.x.x.x.x.', 'o': '..............x.'}),
        'Fill': (1, {'k': 'x.......x.......', 's': '....X.gXgX.XgXXX', 't': '..........x.x...'}),
        'Build': (1, {'k': 'x...x...x...x...', 's': 'x.x.x.x.xxxxxxxx'}),
        'Outro': (1, {'k': 'x...............', 'x': 'X...............', 's': '....x...........'}),
    }),
    ('Synthwave', .5, {
        'Intro': (1, {'k': 'x.......x.......', 'h': '..x...x...x...x.'}),
        'Verse': (2, {'k': 'x.......x.......', 's': '....X.......X...', 'h': 'x.x.x.x.x.x.x.x.'}),
        'Hook': (2, {'k': 'x...x...x...x...', 's': '....X.......X...', 'c': '....x.......x...', 'h': 'xxxxxxxxxxxxxxxx', 'o': '..x...x...x...x.'}),
        'Fill': (1, {'k': 'x.......x.......', 't': '........x.x.x.xx', 's': '....x...........'}),
        'Build': (1, {'k': 'x...x...x...x...', 's': '........x.x.xxxx', 'h': 'x.x.x.x.xxxxxxxx'}),
        'Outro': (1, {'k': 'x...............', 'x': 'X...............'}),
    }),
    ('Lo-fi', .62, {
        'Intro': (1, {'h': 'x.x.x.x.x.x.x.x.', 'r': '....g.......g...'}),
        'Verse': (2, {'k': 'x......x..x.....|x.....x...x...g.', 's': '....X.......X...', 'h': 'x.xgx.xgx.xgx.xg', 'r': '.........g......'}),
        'Hook': (2, {'k': 'x......x..x.....|x.x....x..x.....', 's': '....X.......X..g', 'h': 'x.xgx.xgx.xgx.xg', 'o': '......x.........'}),
        'Fill': (1, {'k': 'x.........x.....', 's': '....X.....g.xgxg'}),
        'Break': (1, {'r': '....x.......x...', 'h': 'x...x...x...x...'}),
        'Outro': (1, {'k': 'x...............', 'h': 'x...x...........'}),
    }),
    ('House', .56, {
        'Intro': (1, {'k': 'x...x...x...x...', 'h': '..x...x...x...x.'}),
        'Verse': (2, {'k': 'x...x...x...x...', 'c': '....x.......x...', 'h': '..x...x...x...x.', 'p': '...x......x.....|.......x...x....'}),
        'Drop': (2, {'k': 'X...x...X...x...', 'c': '....X.......X...', 'h': 'xxx.xxx.xxx.xxx.', 'o': '..x...x...x...x.', 'y': 'x.x.x.x.x.x.x.x.'}),
        'Break': (1, {'c': '....x.......x...', 'h': '..x...x...x...x.'}),
        'Build': (2, {'k': 'x...x...x...x...|x.x.x.x.xxxxxxxx', 'c': '....x.......x...|x.x.x.x.xxxxxxxx'}),
        'Outro': (1, {'k': 'x...x...x...x...', 'x': 'X...............'}),
    }),
    ('Techno', .5, {
        'Intro': (1, {'k': 'x...x...x...x...'}),
        'Verse': (2, {'k': 'x...x...x...x...', 'h': '..x...x...x...x.', 'r': '...x.....x....x.|.x....x....x..x.'}),
        'Drop': (2, {'k': 'X...x...X...x...', 'c': '....x.......x...', 'h': 'xxxxxxxxxxxxxxxx', 'o': '..x...x...x...x.', 'p': '..x..x....x..x..'}),
        'Break': (1, {'h': '..x...x...x...x.', 'y': 'x.x.x.x.x.x.x.x.'}),
        'Build': (2, {'k': 'x...x...x...x...', 's': 'x...x...x...x...|x.x.x.x.xxxxxxxx'}),
        'Outro': (1, {'k': 'x...x...x...x...', 'h': '..x.............'}),
    }),
]
DRUM_PART_FX = {'Intro': 'intro', 'Fill': 'tension', 'Build': 'builder', 'Break': 'bridge', 'Outro': 'ending'}

# ---------------------------------------------------------------- song parts: bass
# (genre, key roots per bar, swing, gate, {part: rhythm})
BASS_SONGS = [
    ('Hip-hop', ['A1', 'A1', 'F1', 'G1'], .58, .8, {'Verse': 'x-----....x-.x..', 'Hook': 'x-..x-..x-.ox-..', 'Break': 'x---------------'}),
    ('Trap', ['D2', 'D2', 'Bb1', 'A1'], .5, .9, {'Verse': 'x-----.x---x----', 'Hook': 'x--x--.x-x-x----', 'Break': 'x---------------'}),
    ('Garage', ['F2', 'F2', 'Db2', 'Eb2'], .62, .5, {'Verse': 'x..x..x...x..x..', 'Hook': 'x.ox..x.5.x.ox..', 'Break': 'x-------........'}),
    ('Breakbeat', ['E2', 'E2', 'C2', 'D2'], .52, .55, {'Verse': 'x.x...x...x.x...', 'Hook': 'x.xo..x.5.x.x.o.', 'Break': 'x-------x-------'}),
    ('Synthwave', ['A1', 'F1', 'C2', 'G1'], .5, .5, {'Verse': 'x.x.x.x.x.x.x.x.', 'Hook': 'xoxoxoxoxoxoxoxo', 'Break': 'x-------x-------'}),
    ('Lo-fi', ['D2', 'G1', 'C2', 'A1'], .62, .75, {'Verse': 'x--..x....5-.3..', 'Hook': 'x-.x..5-..x-.7..', 'Break': 'x---------------'}),
    ('House', ['C2', 'C2', 'Ab1', 'Bb1'], .56, .45, {'Verse': '..x...x...x...x.', 'Hook': '..xo..x.5.xo..x.', 'Break': 'x-------........'}),
    ('Techno', ['C2', 'C2', 'C2', 'Db2'], .5, .35, {'Verse': '..x...x...x...x.', 'Hook': '.xx.xx.x.xx.xx.x', 'Break': 'x...............'}),
]

# More single bass grooves: (genre, name, roots, swing, gate, rhythm)
BASS_GROOVES = [
    ('Funk', 'Slap pop', ['E2', 'E2', 'A2', 'B2'], .56, .4, 'x..ox.g.x.o.xgo.'),
    ('Funk', 'Octave strut', ['G2', 'G2', 'C2', 'D2'], .54, .45, 'x.o.x.o.x.o.xo.o'),
    ('Dubstep', 'Wobble half-time', ['F1', 'F1', 'Db1', 'Eb1'], .5, .9, 'x-----x-x-------'),
    ('Dubstep', 'Growl stabs', ['E1', 'E1', 'G1', 'D1'], .5, .5, 'x..x..x.....x.x.'),
    ('Afro', 'Afro bounce', ['A1', 'A1', 'D2', 'E2'], .58, .55, 'x..x..x...x.x...'),
    ('Afro', 'Log drum', ['F2', 'F2', 'Bb1', 'C2'], .6, .4, '...x..x...x..x.x'),
    ('Reggaeton', 'Dembow bass', ['G1', 'G1', 'Eb1', 'F1'], .5, .7, 'x--x..x.x--x..x.'),
    ('Pop', 'Pop eighths', ['C2', 'G1', 'A1', 'F1'], .5, .55, 'x.x.x.x.x.x.x.x.'),
    ('Pop', 'Pop pulse', ['F1', 'C2', 'G1', 'A1'], .5, .8, 'x-.x-.x-x-.x-.x-'),
    ('Trance', 'Rolling offbeat', ['A1', 'A1', 'F1', 'G1'], .5, .35, '.xx.xx.xx.xx.xx.'),
    ('Drum & Bass', 'Sub steps', ['E1', 'E1', 'C1', 'D1'], .5, .9, 'x-------..x-----'),
    ('Drum & Bass', 'Neuro stab bass', ['F1', 'F1', 'F1', 'Ab1'], .5, .4, 'x..x.x....x.x.x.'),
]

# ---------------------------------------------------------------- chords
PROGRESSIONS = [
    ('Pop', 'Four chord', ['C3,E3,G3', 'G2,B2,D3', 'A2,C3,E3', 'F2,A2,C3']),
    ('Pop', 'Sad four', ['A2,C3,E3', 'F2,A2,C3', 'C3,E3,G3', 'G2,B2,D3']),
    ('Lo-fi', 'Two-five-one', ['D3,F3,A3,C4', 'G2,B2,D3,F3', 'C3,E3,G3,B3', 'A2,C3,E3,G3']),
    ('House', 'Minor house', ['C3,Eb3,G3,Bb3', 'Ab2,C3,Eb3,G3', 'F2,Ab2,C3,Eb3', 'G2,Bb2,D3,F3']),
    ('Trance', 'Epic minor', ['A2,C3,E3', 'F2,A2,C3', 'C3,E3,G3', 'G2,B2,D3']),
    ('Synthwave', 'Night drive', ['A2,C3,E3', 'F2,A2,C3,E3', 'D3,F3,A3', 'E2,G#2,B2']),
    ('Hip-hop', 'Soul loop', ['D3,F3,A3,C4', 'Bb2,D3,F3,A3', 'G2,Bb2,D3,F3', 'A2,C#3,E3,G3']),
    ('Techno', 'Dub minor', ['C3,Eb3,G3,Bb3', 'C3,Eb3,G3,Bb3', 'Eb3,G3,Bb3,D4', 'Bb2,D3,F3,A3']),
    ('Garage', 'Garage sevenths', ['F3,Ab3,C4,Eb4', 'Db3,F3,Ab3,C4', 'Bb2,Db3,F3,Ab3', 'C3,E3,G3,Bb3']),
    ('Ambient', 'Floating', ['C3,G3,D4,E4', 'A2,E3,B3,C4', 'F2,C3,G3,A3', 'G2,D3,A3,B3']),
]
CHORD_RHYTHMS = [
    ('held', 'x---------------', .95),
    ('offbeat stabs', '..x...x...x...x.', .4),
    ('pumping', 'x.x.x.x.x.x.x.x.', .45),
    ('charleston', 'x-....x-........', .7),
    ('syncopated', 'x--x--x---x--x--', .8),
]
# which rhythms each progression gets (index into CHORD_RHYTHMS)
CHORD_PICKS = {'Pop': (0, 2, 4), 'Lo-fi': (0, 3, 4), 'House': (1, 3, 4), 'Trance': (0, 2, 1), 'Synthwave': (0, 2, 4),
               'Hip-hop': (0, 3, 4), 'Techno': (1, 3, 0), 'Garage': (1, 4, 3), 'Ambient': (0, 4, 3)}

# ---------------------------------------------------------------- arps
ARP_SHAPES = [
    ('up', '0 1 2 +0', 1),
    ('down', '+0 2 1 0', 1),
    ('up-down', '0 1 2 +0 2 1', 1),
    ('broken', '0 2 1 +0 1 2', 1),
    ('eighths', '0 2 +0 2', 2),
    ('octave pulse', '0 +0 1 +0 2 +0', 1),
]
ARP_PICKS = [  # (progression index, shape index)
    (0, 0), (0, 4), (1, 2), (1, 5), (2, 3), (2, 2), (3, 0), (3, 5), (4, 0), (4, 2), (4, 5),
    (5, 0), (5, 3), (5, 4), (6, 3), (6, 1), (7, 5), (7, 1), (8, 3), (8, 4), (9, 2), (9, 4),
]

# ---------------------------------------------------------------- melodies (new genres)
MELODIES = [
    ('Hip-hop', 'Boom bap keys', 16, .7, .58, '0:A4:2 3:C5 4:E5:2 8:D5:2 10:C5 12:A4:3'),
    ('Hip-hop', 'Flute sample', 32, .8, .58, '0:E5:3 3:D5 4:C5:4 10:A4:2 12:C5:4 16:D5:3 19:C5 20:A4:4 26:G4:2 28:A4:4'),
    ('Hip-hop', 'Piano loop', 16, .75, .56, '0:D4,F4,A4:3 4:D4,F4,A4 6:C4,E4,G4:3 10:Bb3,D4,F4:3 14:A3,C#4,E4:2'),
    ('Hip-hop', 'Bell motif', 16, .5, .58, '0:A5 2:E5 4:G5 7:E5 8:A5 10:E5 12:C6:2 14:B5:2'),
    ('Trap', 'Dark bells', 16, .5, .5, '0:D5 3:F5 6:A5 8:G5 11:F5 14:E5'),
    ('Trap', 'Plucked minor', 16, .45, .5, '0:D4 2:D5 3:A4 6:F4 8:D4 10:C5 11:A4 14:E4'),
    ('Trap', 'Choir hits', 32, .9, .5, '0:D4,F4,A4:6 8:Bb3,D4,F4:6 16:G3,Bb3,D4:6 24:A3,C#4,E4:6'),
    ('Trap', 'Flute riff', 16, .7, .5, '0:A4:2 2:F4 3:E4 4:D4:2 8:A4 9:Bb4 10:A4 11:G4 12:F4:2 14:E4:2'),
    ('Synthwave', 'Neon lead', 32, .85, .5, '0:E5:4 4:D5:2 6:C5:2 8:A4:6 14:C5:2 16:D5:4 20:C5:2 22:B4:2 24:G#4:8'),
    ('Synthwave', 'Arp lead', 16, .5, .5, '0:A4 1:C5 2:E5 3:A5 4:G5 6:E5 8:F5 9:A5 10:C6 12:B5 14:G#5'),
    ('Synthwave', 'Saw brass', 16, .8, .5, '0:A4,C5,E5:3 4:A4,C5,E5 6:G4,B4,D5:2 8:F4,A4,C5:4 12:E4,G#4,B4:4'),
    ('Synthwave', 'Sunset hook', 16, .75, .5, '0:C5:2 2:E5:2 4:G5:3 7:A5 8:G5:2 10:E5:2 12:D5:4'),
    ('Pop', 'Topline', 32, .8, .5, '0:E5:2 2:E5 3:D5 4:C5:2 6:D5:2 8:E5:4 14:G5:2 16:A5:2 18:G5 19:E5 20:D5:4 26:C5:2 28:D5:4'),
    ('Pop', 'Piano hook', 16, .7, .5, '0:C5 2:G4 3:C5 4:E5:2 8:D5 10:G4 11:B4 12:D5:2'),
    ('Pop', 'Pluck chorus', 16, .45, .5, '0:E5 1:G5 2:C6 4:B5 6:G5 8:A5 9:C6 10:E6 12:D6 14:B5'),
    ('Pop', 'Whistle line', 16, .75, .5, '0:G5:2 3:E5 4:C5:2 7:D5 8:E5:4 12:D5:2 14:C5:2'),
    ('Ambient', 'Glass drops', 32, .6, .5, '0:E5:3 6:B5:3 12:G5:4 18:D6:3 24:A5:6'),
    ('Ambient', 'Slow swell', 64, .95, .5, '0:C4,G4,D5:16 16:A3,E4,B4:16 32:F3,C4,G4:16 48:G3,D4,A4:16'),
    ('Ambient', 'Echo motif', 32, .55, .5, '0:G5 3:D5 8:E5 11:B4 16:C5 19:G4 24:A4:6'),
    ('Ambient', 'Choir air', 32, .95, .5, '0:E4,B4:8 8:D4,A4:8 16:C4,G4:8 24:D4,A4:8'),
]

# ---------------------------------------------------------------- effects (arrangement moves)
SYNTH_EFFECTS = [
    ('intro', 'Pad bloom', 32, .95, '0:C4,G4:16:50 16:C4,G4,E5:16:80'),
    ('intro', 'Sparse plucks', 16, .4, '0:E5:1:70 6:B4:1:60 11:G5:1:75'),
    ('bridge', 'Breathing chords', 32, .9, '0:F3,C4,A4:6:70 8:G3,D4,B4:6:70 16:A3,E4,C5:6:75 24:G3,D4,B4:8:80'),
    ('bridge', 'Low drone', 32, .95, '0:A1,E2:32:90'),
    ('tension', 'Siren rise', 16, .8, ' '.join(f'{s}:{n}:2' for s, n in zip(range(0, 16, 2), ('A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6')))),
    ('tension', 'Stutter note', 16, .3, ' '.join(f'{s}:A4:1:{60+s*4}' for s in range(16))),
    ('builder', 'Chord riser', 32, .5, ' '.join(f'{s}:A3,E4:1:{56+s*2}' for s in range(0, 32, 2))),
    ('builder', 'Octave spiral', 16, .45, ' '.join(f'{s}:{n}' for s, n in zip(range(16), ('A3', 'A4', 'C4', 'C5', 'E4', 'E5', 'A4', 'A5', 'C5', 'C6', 'E5', 'E6', 'A5', 'A6', 'C6', 'E6')))),
    ('ending', 'Fade chord', 32, .95, '0:A3,C4,E4,A4:16:100 16:A3,C4,E4,A4:16:60'),
    ('ending', 'Plagal close', 32, .95, '0:D4,F4,A4:16 16:A3,C4,E4,A4:16'),
]
DRUM_EFFECTS = [
    ('intro', 'Shaker count', 16, ' '.join(f'{s}:h:1:{40+s*5}' for s in range(16))),
    ('bridge', 'Rim and ride', 16, '0:y 2:y 4:y,r 6:y 8:y 10:y 12:y,r 14:y'),
    ('tension', 'Snare stops', 16, '0:k,x 4:s 7:s 10:s 12:s 14:s 15:s'),
    ('builder', 'Clap build', 32, ' '.join(f'{s}:c:1:{60+s}' for s in range(0, 16, 4)) + ' ' + ' '.join(f'{s}:c:1:{64+s}' for s in range(16, 32, 2))),
    ('builder', 'Tom roll build', 16, ' '.join(f'{s}:t:1:{70+s*3}' for s in range(8, 16)) + ' 0:k 4:k'),
    ('ending', 'Ride out', 16, '0:k,x:1:120 4:y 8:y 12:y'),
]

# ---------------------------------------------------------------- factory Structures
# A structure plays one track: its parts are library patterns, each played N times in order.
def _drum_ids(genre):
    slug = re.sub(r'[^a-z]+', '', genre.lower())
    return lambda part: f'song.drums.{slug}.{part.lower()}'


def _bass_ids(genre):
    slug = re.sub(r'[^a-z]+', '', genre.lower())
    return lambda part: f'song.bass.{slug}.{part.lower()}'


def structures():
    out = []
    for genre, _, parts in DRUM_SONGS:
        d = _drum_ids(genre)
        hook = 'Drop' if 'Drop' in parts else 'Hook'
        mid = 'Break' if 'Break' in parts else 'Build'
        order = [('Intro', 2), ('Verse', 2), ('Fill', 1) if 'Fill' in parts else ('Build', 1), (hook, 2), (mid, 1)]
        if 'Build' in parts and mid != 'Build':
            order.append(('Build', 1))
        order += [(hook, 2), ('Outro', 1)]
        slug = re.sub(r'[^a-z]+', '', genre.lower())
        out.append(dict(id=f'structure.drums.{slug}', name=genre + ' beat', genre=genre, device='drum_rack',
                        brief=' → '.join(f'{p} ×{n}' if n > 1 else p for p, n in order),
                        parts=[[d(p), n] for p, n in order]))
    for genre, *_ in BASS_SONGS:
        b = _bass_ids(genre)
        order = [('Verse', 2), ('Hook', 2), ('Break', 1), ('Hook', 2)]
        slug = re.sub(r'[^a-z]+', '', genre.lower())
        out.append(dict(id=f'structure.bass.{slug}', name=genre + ' bassline', genre=genre, device='synth',
                        brief=' → '.join(f'{p} ×{n}' if n > 1 else p for p, n in order),
                        parts=[[b(p), n] for p, n in order]))
    for i, (genre, name, _) in enumerate(PROGRESSIONS):
        picks = CHORD_PICKS.get(genre, (0, 2, 4))
        ids = [f'chords.more.{i+1:02}.{k+1}' for k in range(len(picks))]
        labels = [CHORD_RHYTHMS[r][0].capitalize() for r in picks]
        out.append(dict(id=f'structure.chords.{i+1:02}', name=name + ' song', genre=genre, device='synth',
                        brief=f'{labels[0]} → {labels[1]} ×2 → {labels[2]}',
                        parts=[[ids[0], 1], [ids[1 % len(ids)], 2], [ids[2 % len(ids)], 1]]))
    return out


def more(roles_pitch):
    """Every addition, as catalogue entries (same shape as genre_patterns)."""
    from .pattern_extras import build, ROLE_LABELS
    out = []
    for genre, swing, parts in DRUM_SONGS:
        d = _drum_ids(genre)
        for part, (bars, grid) in parts.items():
            p, used = beat(roles_pitch, grid, bars, swing)
            item = dict(id=d(part), version=1, name=genre + ' ' + part.lower(), genre=genre, kind=part, bpm=None,
                        brief=genre + ' song part · ' + part, device='drum_rack', category='drums',
                        tags=['Song part', part, genre, str(p['length']) + ' steps'], roles=used, pattern=p)
            if part in DRUM_PART_FX:
                item['fx_role'] = DRUM_PART_FX[part]
            out.append(item)
    for genre, roots, swing, gate, parts in BASS_SONGS:
        b = _bass_ids(genre)
        for part, rhythm in parts.items():
            p = line(rhythm, roots, gate, swing)
            out.append(dict(id=b(part), version=1, name=genre + ' bass ' + part.lower(), genre=genre, kind=part, bpm=None,
                            brief=genre + ' bassline · ' + part + ' · ' + str(len(roots)) + ' bars', device='synth', category='bass',
                            tags=['Song part', part, genre, str(p['length']) + ' steps'], roles=[], pattern=p))
    for i, (genre, name, roots, swing, gate, rhythm) in enumerate(BASS_GROOVES):
        p = line(rhythm, roots, gate, swing)
        out.append(dict(id=f'bass.more.{i+1:02}', version=1, name=name, genre=genre, kind='Bass', bpm=None,
                        brief=genre + ' bass groove · ' + str(len(roots)) + ' bars', device='synth', category='bass',
                        tags=['Bass', genre, str(p['length']) + ' steps'], roles=[], pattern=p))
    for i, (genre, name, prog) in enumerate(PROGRESSIONS):
        for k, r in enumerate(CHORD_PICKS.get(genre, (0, 2, 4))):
            label, rhythm, gate = CHORD_RHYTHMS[r]
            p = chords(rhythm, prog, gate, .56 if genre in ('House', 'Garage', 'Lo-fi', 'Hip-hop') else .5)
            out.append(dict(id=f'chords.more.{i+1:02}.{k+1}', version=1, name=name + ' · ' + label, genre=genre, kind='Chords', bpm=None,
                            brief=genre + ' progression · ' + label + ' · 4 bars', device='synth', category='chords',
                            tags=['Chords', genre, label, '64 steps'], roles=[], pattern=p))
    for i, (pi, si) in enumerate(ARP_PICKS):
        genre, pname, prog = PROGRESSIONS[pi]
        label, shape, every = ARP_SHAPES[si]
        p = arp(shape, [','.join(n[:-1] + str(int(n[-1]) + 1) for n in c.split(',')) for c in prog], gate=.45, every=every)
        out.append(dict(id=f'arp.more.{i+1:02}', version=1, name=pname + ' ' + label, genre=genre, kind='Arp', bpm=None,
                        brief=genre + ' arp · ' + label + ' over ' + pname.lower() + ' · 4 bars', device='synth', category='arp',
                        tags=['Arp', genre, label, '64 steps'], roles=[], pattern=p))
    for i, (genre, name, length, gate, swing, spec) in enumerate(MELODIES):
        slug = re.sub(r'[^a-z]+', '', genre.lower())
        index = sum(1 for g, *_ in MELODIES[:i] if g == genre) + 1
        out.append(dict(id=f'melodie.{slug}.{index:02}', version=1, name=name, genre=genre, kind='Melodie', bpm=None,
                        brief=genre + ' melody · ' + str(length) + ' steps', device='synth', category='melodie',
                        tags=['Melodie', genre, str(length) + ' steps'], roles=[], pattern=build(spec, length, gate, swing)))
    for i, (role, name, length, gate, spec) in enumerate(SYNTH_EFFECTS):
        out.append(dict(id=f'fx.synth.more.{i+1:02}', version=1, name=name, genre='Effects', kind=ROLE_LABELS[role], bpm=None,
                        brief=ROLE_LABELS[role] + ' · synth', device='synth', category='effects', fx_role=role,
                        tags=['Effects', ROLE_LABELS[role], str(length) + ' steps'], roles=[], pattern=build(spec, length, gate)))
    for i, (role, name, length, spec) in enumerate(DRUM_EFFECTS):
        used = sorted({DRUM_LETTERS[l] for token in spec.split() for l in token.split(':')[1].split(',')})
        p = build(spec, length, .65, .5, 100, lambda letter: roles_pitch[DRUM_LETTERS[letter]])
        out.append(dict(id=f'fx.drums.more.{i+1:02}', version=1, name=name, genre='Effects', kind=ROLE_LABELS[role], bpm=None,
                        brief=ROLE_LABELS[role] + ' · drums', device='drum_rack', category='effects', fx_role=role,
                        tags=['Effects', ROLE_LABELS[role], str(length) + ' steps'], roles=used, pattern=p))
    return out
