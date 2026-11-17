"""Library pack 2 (17 Nov): twelve more genres, song parts for lead and chords, new arp shapes and chord rhythms.

Same notations as ``pattern_more`` (``line``, ``chords``, ``arp``, ``beat``) and ``pattern_extras.build`` for hand-written
melodies. Every id starts with ``pack2.``; everything is plain MIDI (no sample assets).
"""
import re
from .pattern_extras import midi, build, DRUM_LETTERS
from .pattern_more import line, chords, arp, beat, PROGRESSIONS, DRUM_PART_FX

NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
KINDS = {'': (0, 4, 7), 'm': (0, 3, 7), '7': (0, 4, 7, 10), 'm7': (0, 3, 7, 10), 'maj7': (0, 4, 7, 11), 'sus': (0, 5, 7),
         'm9': (0, 3, 7, 10, 14), 'add9': (0, 4, 7, 14)}


def slug(text):
    return re.sub(r'[^a-z]+', '', text.lower())


def chord(root, kind=''):
    """'A3' + 'm7' -> 'A3,C4,E4,G4' (names the engine's `midi` reads)."""
    base = midi(root)
    return ','.join(NAMES[(base + i) % 12] + str((base + i) // 12 - 1) for i in KINDS[kind])


# ---------------------------------------------------------------- song parts: drums (12 new genres)
# (genre, swing, {part: (bars, grid)})  k kick, s snare, c clap, h closed hat, o open hat, r rim, p perc, t tom, y ride, x crash
DRUM_SONGS = [
    ('Drum & Bass', .5, {
        'Intro': (1, {'h': 'x.x.x.x.x.x.x.x.', 'k': 'x.........x.....'}),
        'Verse': (2, {'k': 'x.........x.....|x.........x.x...', 's': '....X.......X...', 'h': 'x.x.x.x.x.x.x.x.', 'r': '.......g........'}),
        'Drop': (2, {'k': 'X.........x.....|x.......x.x.....', 's': '....X.......X...|....X.......X.g.', 'h': 'xxxxxxxxxxxxxxxx', 'o': '..x.....x.......'}),
        'Fill': (1, {'k': 'x.........x.....', 's': '....X...x.x.xxxx', 't': '.........x.x....'}),
        'Break': (1, {'r': '....x.......x...', 'h': 'x.x.x.x.x.x.x.x.'}),
    }),
    ('Dubstep', .5, {
        'Intro': (1, {'h': 'x.x.x.x.x.x.x.x.', 'k': 'x...............'}),
        'Verse': (2, {'k': 'x.......x.......|x.......x.....x.', 's': '........X.......', 'h': 'x.x.x.x.x.x.x.x.'}),
        'Drop': (2, {'k': 'X.......x...x...|X.......x.......', 's': '........X.......|........X.....xx', 'c': '........x.......',
                     'h': 'x.x.x.x.x.x.x.x.', 'o': '......x.......x.'}),
        'Fill': (1, {'k': 'x...............', 's': '........x.x.xxxx', 't': '....x.x.........'}),
        'Break': (1, {'r': '........x.......', 'h': 'x...x...x...x...'}),
    }),
    ('Afro house', .56, {
        'Intro': (1, {'k': 'x...x...x...x...', 'p': '..x...x...x...x.'}),
        'Verse': (2, {'k': 'x...x...x...x...', 'c': '....x.......x...', 'h': '..x...x...x...x.', 'p': '...x..x....x..x.|.x..x....x..x...'}),
        'Drop': (2, {'k': 'X...x...X...x...', 'c': '....X.......X...', 'h': 'x.xxx.xxx.xxx.xx', 'o': '..x...x...x...x.',
                     'p': '..x..x..x..x..x.|.x..x..x..x..x.x', 't': '.....x.......x.x'}),
        'Fill': (1, {'k': 'x...x...x...x...', 't': '........x.x.xxxx', 'p': '..x...x.........'}),
        'Break': (1, {'p': '..x..x..x..x..x.', 'h': '..x...x...x...x.'}),
    }),
    ('Amapiano', .55, {
        'Intro': (1, {'k': 'x...............', 'h': 'x.x.x.x.x.x.x.x.'}),
        'Verse': (2, {'k': 'x.......x.......', 'c': '........x.......|........x.....x.', 'h': '..x..x..x..x..x.', 'p': '...x....x..x....'}),
        'Hook': (2, {'k': 'x...x...x...x...', 'c': '....x.......x...', 'h': 'x.xxx.xxx.xxx.xx', 'p': '..x..x....x..x..|.x..x..x...x..x.', 'o': '..............x.'}),
        'Fill': (1, {'k': 'x...x...x.......', 't': '........x.xxxxxx', 'c': '....x...........'}),
        'Break': (1, {'p': '..x..x....x..x..', 'h': 'x...x...x...x...'}),
    }),
    ('Jersey club', .5, {
        'Intro': (1, {'h': 'x.x.x.x.x.x.x.x.', 'c': '....x.......x...'}),
        'Verse': (2, {'k': 'x..x..x.x..x..x.', 'c': '....x.......x...', 'h': 'x.x.x.x.x.x.x.x.', 'r': '..............x.'}),
        'Hook': (2, {'k': 'x..x..x.x..x..x.|x..x..x.x.x.x.x.', 'c': '....x.......x...', 's': '....g.......g.xx', 'h': 'xxxxxxxxxxxxxxxx', 'o': '......x.......x.'}),
        'Fill': (1, {'k': 'x..x..x.x.x.xxxx', 'c': '....x.......x...'}),
        'Break': (1, {'c': '....x.......x...', 'h': '..x...x...x...x.'}),
    }),
    ('Phonk', .52, {
        'Intro': (1, {'p': 'x...x...x...x...', 'h': 'x.x.x.x.x.x.x.x.'}),
        'Verse': (2, {'k': 'x.....x...x.....|x.....x...x...x.', 's': '........X.......', 'p': '..x.......x...x.', 'h': 'x.x.x.x.x.x.x.x.'}),
        'Hook': (2, {'k': 'X.....x...x..x..|X.....x...x.....', 's': '........X.......', 'c': '........x.......', 'p': 'x..x..x.x..x..x.', 'h': 'xxxxxxxxxxxxxxxx', 'o': '..x.....x.......'}),
        'Fill': (1, {'k': 'x.....x.........', 's': '........x.x.xxxx', 'p': 'x..x..x.........'}),
        'Break': (1, {'p': 'x...x...x...x...', 'r': '........x.......'}),
    }),
    ('Reggaeton', .5, {
        'Intro': (1, {'k': 'x...x...x...x...', 'h': 'x.x.x.x.x.x.x.x.'}),
        'Verse': (2, {'k': 'x...x...x...x...', 's': '...x..x....x..x.', 'h': 'x.x.x.x.x.x.x.x.', 'r': '.......g.......g'}),
        'Hook': (2, {'k': 'x...x...x...x...', 's': '...x..x....x..x.', 'c': '..x...x...x...x.', 'h': 'xxxxxxxxxxxxxxxx', 'o': '..............x.'}),
        'Fill': (1, {'k': 'x...x...x...x...', 's': '...x..x..x.xxxxx', 't': '........x.x.....'}),
        'Break': (1, {'r': '...x..x....x..x.', 'h': 'x...x...x...x...'}),
    }),
    ('Disco', .52, {
        'Intro': (1, {'k': 'x...x...x...x...', 'h': '..x...x...x...x.'}),
        'Verse': (2, {'k': 'x...x...x...x...', 's': '....x.......x...', 'h': 'x.x.x.x.x.x.x.x.', 'o': '..x...x...x...x.'}),
        'Hook': (2, {'k': 'X...x...X...x...', 's': '....X.......X...', 'c': '....x.......x...', 'h': 'xxxxxxxxxxxxxxxx', 'o': '..x...x...x...x.', 'p': '.x..x..x.x..x..x'}),
        'Fill': (1, {'k': 'x...x...x...x...', 's': '....x...x.x.xxxx', 't': '........x.x.....'}),
        'Break': (1, {'h': 'x.x.x.x.x.x.x.x.', 'p': '.x..x..x.x..x..x'}),
    }),
    ('Funk', .56, {
        'Intro': (1, {'h': 'x.xxx.xxx.xxx.xx', 'k': 'x...............'}),
        'Verse': (2, {'k': 'x..g..x...x.g...|x..g..x...x...g.', 's': '....X..g.g..X..g', 'h': 'x.xxx.xxx.xxx.xx', 'o': '..............x.'}),
        'Hook': (2, {'k': 'x..x..x...x.x...|x..x..x...x...x.', 's': '....X..g.g..X..g|....X..g.g..X.xg', 'h': 'xxxxxxxxxxxxxxxx', 'o': '..x.....x.......'}),
        'Fill': (1, {'k': 'x..x..x.........', 's': '....X.g.xgxgXXXX', 't': '..........x.x...'}),
        'Break': (1, {'k': 'x...............', 'r': '..x...x...x...x.', 'h': 'x.x.x.x.x.x.x.x.'}),
    }),
    ('Jazz', .62, {
        'Intro': (1, {'y': 'x...x.xxx...x.xx'}),
        'Verse': (2, {'y': 'x...x.xxx...x.xx', 'k': 'x.....g.....g...', 's': '....g.......g..x', 'h': '....x.......x...'}),
        'Hook': (2, {'y': 'x...x.xxx...x.xx', 'k': 'x...g.......g...', 's': '....g..x....g.x.|....g..x...xg...', 'h': '....x.......x...', 'r': '..........x.....'}),
        'Fill': (1, {'y': 'x...x.xx........', 's': '........xgxgxxxx', 't': '..........x.x...'}),
        'Break': (1, {'y': 'x...x.xxx...x.xx', 'h': '....x.......x...'}),
    }),
    ('Cinematic', .5, {
        'Intro': (2, {'t': 'x...............|........x.......', 'y': '................|..............g.'}),
        'Verse': (2, {'t': 'x.......x.......|x.......x.x.....', 'r': '....g.......g...', 'k': 'x...............'}),
        'Hook': (2, {'k': 'X.......x.......|X.......x.x.....', 't': 'x...x...x...x...|x...x...x.x.xxxx', 'x': 'X...............|................', 'y': 'x.x.x.x.x.x.x.x.'}),
        'Fill': (1, {'t': 'x.x.x.x.xxxxxxxx', 's': '........x.x.xxxx'}),
        'Break': (2, {'y': 'x...............|........x.......', 'r': '........g.......|........g.......'}),
    }),
    ('Minimal', .5, {
        'Intro': (1, {'k': 'x...x...x...x...'}),
        'Verse': (2, {'k': 'x...x...x...x...', 'h': '..x...x...x...x.', 'r': '...x.....x....x.|.x....x....x..x.'}),
        'Drop': (2, {'k': 'x...x...x...x...', 'c': '....g.......g...', 'h': '..x...x...x...x.', 'p': '.x...x....x...x.|..x....x...x....', 'o': '..............x.'}),
        'Fill': (1, {'k': 'x...x...x...x...', 'p': '..x.x.x...x.xxx.'}),
        'Break': (1, {'h': '..x...x...x...x.', 'r': '....x.......x...'}),
    }),
]

# ---------------------------------------------------------------- song parts: bass (12 new genres)
# (genre, key roots per bar, swing, gate, {part: rhythm})
BASS_SONGS = [
    ('Drum & Bass', ['E1', 'E1', 'C1', 'D1'], .5, .6, {'Verse': 'x-------..x-----', 'Hook': 'x..x..x...x.x...', 'Break': 'x---------------'}),
    ('Dubstep', ['F1', 'F1', 'Db1', 'Eb1'], .5, .9, {'Verse': 'x-------x-------', 'Hook': 'x--x--x-x-x-----', 'Break': 'x---------------'}),
    ('Afro house', ['A1', 'A1', 'D2', 'E2'], .58, .5, {'Verse': 'x..x..x...x.x...', 'Hook': 'x..xo.x...x.x.o.', 'Break': 'x-------........'}),
    ('Amapiano', ['C2', 'Ab1', 'Eb2', 'Bb1'], .55, .55, {'Verse': '...x..x...x..x..', 'Hook': 'x..x..x.x..x..xo', 'Break': 'x-------........'}),
    ('Jersey club', ['C2', 'C2', 'Ab1', 'Bb1'], .5, .5, {'Verse': 'x..x..x.x..x..x.', 'Hook': 'x.x..xx.x.x..xx.', 'Break': 'x---------------'}),
    ('Phonk', ['F1', 'F1', 'Db1', 'Eb1'], .52, .85, {'Verse': 'x--x--x-x---x---', 'Hook': 'x--x--x-x--xx---', 'Break': 'x---------------'}),
    ('Reggaeton', ['G1', 'G1', 'Eb1', 'F1'], .5, .7, {'Verse': 'x..x..x.x..x..x.', 'Hook': 'x--x..x.x--x..xo', 'Break': 'x---------------'}),
    ('Disco', ['A1', 'D2', 'G1', 'C2'], .52, .45, {'Verse': 'x.ox.ox.x.ox.ox.', 'Hook': 'xoxoxoxoxoxoxoxo', 'Break': 'x---------------'}),
    ('Funk', ['E2', 'A2', 'D2', 'B1'], .56, .4, {'Verse': 'x..ox.g.x.o.xgo.', 'Hook': 'x.ox.xg.x.ox.xgo', 'Break': 'x---g---x---g---'}),
    ('Jazz', ['D2', 'G1', 'C2', 'A1'], .62, .85, {'Verse': 'x---5---x---3---', 'Hook': 'x---5---o---5---', 'Break': 'x-------5-------'}),
    ('Cinematic', ['A0', 'A0', 'F0', 'G0'], .5, .95, {'Verse': 'x---------------', 'Hook': 'x-------o-------', 'Break': 'x---------------'}),
    ('Minimal', ['C2', 'C2', 'C2', 'Db2'], .5, .4, {'Verse': '..x...x...x...x.', 'Hook': '.xx..x..xx..x...', 'Break': 'x...............'}),
]

# ---------------------------------------------------------------- song parts: lead and chords that belong together
# (genre, swing, key, {part: (4-bar chord progression, chord rhythm, 2-bar lead)}); the lead is a build() spec of 32 steps.
HELD = ('x---------------', .95)
PRE = ('x-----x-x-------', .75)
DRIVE = ('x.x.x.x.x.x.x.x.', .5)
SYNC = ('x--x--x---x--x--', .8)
QUARTERS = ('x---x---x---x---', .7)
MELODIC_SETS = [
    ('Pop', .5, 'C major', {
        'Verse': ([chord('C3'), chord('G2'), chord('A2', 'm'), chord('F2')], HELD,
                  '0:E5:2 2:D5 3:C5 4:D5:4 8:E5:2 10:G5:2 12:E5:4 16:D5:2 18:C5 19:A4 20:C5:4 24:D5:2 26:E5:2 28:C5:4'),
        'Pre': ([chord('A2', 'm'), chord('F2'), chord('C3'), chord('G2')], PRE,
                '0:A4:2 2:C5:2 4:E5:2 6:D5 7:C5 8:A4:4 12:C5:2 14:D5:2 16:E5:2 18:G5:2 20:A5:2 22:G5 23:E5 24:D5:4 28:E5:2 30:G5:2'),
        'Chorus': ([chord('F2'), chord('C3'), chord('G2'), chord('A2', 'm')], SYNC,
                   '0:G5:2 2:E5 3:G5 4:A5:4 8:G5:2 10:E5:2 12:C5:4 16:D5:2 18:E5:2 20:G5:2 22:A5:2 24:G5:4 28:E5:4'),
        'Bridge': ([chord('A2', 'm'), chord('E2', 'm'), chord('F2'), chord('G2')], QUARTERS,
                   '0:E5:6 8:D5:6 16:C5:6 24:B4:4 28:A4:4'),
    }),
    ('Lo-fi', .6, 'D dorian', {
        'Verse': ([chord('D3', 'm7'), chord('G2', '7'), chord('C3', 'maj7'), chord('A2', 'm7')], HELD,
                  '0:F5:3 4:E5:2 6:D5:2 8:C5:4 14:D5:2 16:A4:3 20:C5:2 22:D5:2 24:E5:6'),
        'Pre': ([chord('E3', 'm7'), chord('A2', '7'), chord('D3', 'm7'), chord('G2', '7')], PRE,
                '0:G5:2 3:F5 4:E5:3 8:D5:2 10:E5:2 12:F5:4 16:A5:2 19:G5 20:F5:2 22:E5:2 24:D5:6'),
        'Chorus': ([chord('F3', 'maj7'), chord('E3', 'm7'), chord('D3', 'm7'), chord('C3', 'maj7')], SYNC,
                   '0:A5:3 4:G5:2 6:F5:2 8:E5:3 12:F5 13:G5 14:A5:2 16:C6:3 20:A5:2 22:G5:2 24:F5:6'),
        'Bridge': ([chord('Bb2', 'maj7'), chord('A2', 'm7'), chord('G2', 'm7'), chord('A2', '7')], QUARTERS,
                   '0:D5:8 8:C5:4 12:Bb4:4 16:A4:8 24:C#5:4 28:E5:4'),
    }),
    ('EDM', .5, 'A minor', {
        'Verse': ([chord('A2', 'm'), chord('F2'), chord('C3'), chord('G2')], HELD,
                  '0:A4:2 3:C5 4:E5:2 8:D5:2 10:C5 11:A4 12:G4:4 16:A4:2 19:C5 20:E5:2 24:G5:2 26:E5:2 28:D5:4'),
        'Pre': ([chord('F2'), chord('G2'), chord('A2', 'm'), chord('A2', 'm')], PRE,
                '0:C5:2 2:C5 3:D5 4:E5:4 8:D5:2 10:D5 11:E5 12:G5:4 16:E5:2 18:G5:2 20:A5:2 22:G5 23:E5 24:A5:4 28:B5:4'),
        'Chorus': ([chord('A2', 'm'), chord('G2'), chord('F2'), chord('E2', '7')], DRIVE,
                   '0:A5:2 2:E5 3:A5 4:C6:4 8:B5:2 10:G5 11:B5 12:D6:4 16:C6:2 18:A5 19:C6 20:E6:4 24:D6:2 26:B5:2 28:G#5:4'),
        'Bridge': ([chord('F2'), chord('C3'), chord('G2'), chord('A2', 'm')], QUARTERS,
                   '0:A4,C5:8 8:G4,B4:8 16:F4,A4:8 24:E4,G#4:8'),
    }),
]

# ---------------------------------------------------------------- new chord rhythms over existing progressions
CHORD_RHYTHMS2 = [
    ('anticipate', 'x-----x-x-------', .75),
    ('quarters', 'x---x---x---x---', .7),
    ('gated', 'xxxx....xxxx....', .4),
    ('rolling', 'x.x..x.x..x.x...', .5),
]
CHORD_PROGS2 = (0, 1, 2, 3, 5, 6, 8)  # indexes into pattern_more.PROGRESSIONS

# ---------------------------------------------------------------- new arp shapes (shape, tokens, a note every N steps)
ARP_SHAPES2 = [
    ('cascade', '0 1 2 +0 +1 +2', 1),
    ('rain', '+2 +1 +0 2 1 0', 1),
    ('skip', '0 +0 1 +1 2 +2', 1),
    ('trill', '0 1 0 1 2 1 2 1', 1),
    ('rolling', '0 1 2 1', 1),
    ('gallop', '0 0 1 0 0 2', 1),
    ('quarters', '0 1 2 +0', 4),
    ('double', '0 0 1 1 2 2 +0 +0', 1),
]
ARP_PICKS2 = [  # per shape: three progressions (indexes into PROGRESSIONS)
    (0, 3, 5), (1, 4, 6), (2, 7, 8), (0, 6, 9), (1, 3, 8), (2, 4, 5), (7, 9, 0), (3, 5, 6),
]


# ---------------------------------------------------------------- factory Structures
def _order(parts, hook):
    order = [('Intro', 2), ('Verse', 2)]
    if 'Fill' in parts:
        order.append(('Fill', 1))
    order += [(hook, 2), ('Break', 1), (hook, 2)]
    return order


def _brief(order):
    return ' → '.join(f'{p} ×{n}' if n > 1 else p for p, n in order)


def structures():
    out = []
    for genre, _, parts in DRUM_SONGS:
        hook = 'Drop' if 'Drop' in parts else 'Hook'
        order = _order(parts, hook)
        out.append(dict(id=f'structure.pack2.drums.{slug(genre)}', name=genre + ' beat', genre=genre, device='drum_rack',
                        brief=_brief(order), parts=[[f'pack2.drums.{slug(genre)}.{p.lower()}', n] for p, n in order]))
    for genre, *_ in BASS_SONGS[:8]:
        order = [('Verse', 2), ('Hook', 2), ('Break', 1), ('Hook', 2)]
        out.append(dict(id=f'structure.pack2.bass.{slug(genre)}', name=genre + ' bassline', genre=genre, device='synth',
                        brief=_brief(order), parts=[[f'pack2.bass.{slug(genre)}.{p.lower()}', n] for p, n in order]))
    for genre, *_ in MELODIC_SETS:
        order = [('Verse', 2), ('Pre', 1), ('Chorus', 2), ('Bridge', 1), ('Chorus', 2)]
        out.append(dict(id=f'structure.pack2.lead.{slug(genre)}', name=genre + ' lead', genre=genre, device='synth',
                        brief=_brief(order), parts=[[f'pack2.lead.{slug(genre)}.{p.lower()}', n] for p, n in order]))
        out.append(dict(id=f'structure.pack2.chords.{slug(genre)}', name=genre + ' chords', genre=genre, device='synth',
                        brief=_brief(order), parts=[[f'pack2.chords.{slug(genre)}.{p.lower()}', n] for p, n in order]))
    return out


def more2(roles_pitch):
    """Every pack 2 addition, as catalogue entries (same shape as genre_patterns)."""
    out = []
    for genre, swing, parts in DRUM_SONGS:
        for part, (bars, grid) in parts.items():
            p, used = beat(roles_pitch, grid, bars, swing)
            item = dict(id=f'pack2.drums.{slug(genre)}.{part.lower()}', version=1, name=genre + ' ' + part.lower(), genre=genre, kind=part,
                        bpm=None, brief=genre + ' song part · ' + part, device='drum_rack', category='drums',
                        tags=['Song part', part, genre, str(p['length']) + ' steps'], roles=used, pattern=p)
            if part in DRUM_PART_FX:
                item['fx_role'] = DRUM_PART_FX[part]
            out.append(item)
    for genre, roots, swing, gate, parts in BASS_SONGS:
        for part, rhythm in parts.items():
            p = line(rhythm, roots, gate, swing)
            out.append(dict(id=f'pack2.bass.{slug(genre)}.{part.lower()}', version=1, name=genre + ' bass ' + part.lower(), genre=genre, kind=part,
                            bpm=None, brief=genre + ' bassline · ' + part + ' · 4 bars', device='synth', category='bass',
                            tags=['Song part', part, genre, str(p['length']) + ' steps'], roles=[], pattern=p))
    for genre, swing, key, parts in MELODIC_SETS:
        for part, (prog, (rhythm, gate), lead) in parts.items():
            p = chords(rhythm, prog, gate, swing)
            out.append(dict(id=f'pack2.chords.{slug(genre)}.{part.lower()}', version=1, name=genre + ' chords ' + part.lower(), genre=genre, kind=part,
                            bpm=None, brief=genre + ' chords · ' + part + ' · ' + key + ' · 4 bars', device='synth', category='chords',
                            tags=['Song part', part, genre, '64 steps'], roles=[], pattern=p))
            out.append(dict(id=f'pack2.lead.{slug(genre)}.{part.lower()}', version=1, name=genre + ' lead ' + part.lower(), genre=genre, kind=part,
                            bpm=None, brief=genre + ' lead · ' + part + ' · ' + key + ' · 2 bars', device='synth', category='melodie',
                            tags=['Song part', part, genre, '32 steps'], roles=[], pattern=build(lead, 32, .75, swing)))
    for i in CHORD_PROGS2:
        genre, name, prog = PROGRESSIONS[i]
        for k, (label, rhythm, gate) in enumerate(CHORD_RHYTHMS2):
            p = chords(rhythm, prog, gate, .56 if genre in ('House', 'Garage', 'Lo-fi', 'Hip-hop') else .5)
            out.append(dict(id=f'pack2.chords.{i+1:02}.{k+1}', version=1, name=name + ' · ' + label, genre=genre, kind='Chords', bpm=None,
                            brief=genre + ' progression · ' + label + ' · 4 bars', device='synth', category='chords',
                            tags=['Chords', genre, label, '64 steps'], roles=[], pattern=p))
    for si, picks in enumerate(ARP_PICKS2):
        label, shape, every = ARP_SHAPES2[si]
        for k, pi in enumerate(picks):
            genre, pname, prog = PROGRESSIONS[pi]
            up = [','.join(n[:-1] + str(int(n[-1]) + 1) for n in c.split(',')) for c in prog]
            p = arp(shape, up, gate=.8 if every > 1 else .45, every=every)
            out.append(dict(id=f'pack2.arp.{si+1:02}.{k+1}', version=1, name=pname + ' ' + label, genre=genre, kind='Arp', bpm=None,
                            brief=genre + ' arp · ' + label + ' over ' + pname.lower() + ' · 4 bars', device='synth', category='arp',
                            tags=['Arp', genre, label, '64 steps'], roles=[], pattern=p))
    return out
