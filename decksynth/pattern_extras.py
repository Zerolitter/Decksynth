"""Library additions (review 2026-11-15): genre melodies and arrangement Effects patterns.

Every entry is plain MIDI, written by hand here (no sample assets). Notation per step:
``step:note[,note...][:tie[:velocity]]`` with note names such as ``A4`` or ``Eb3``.
Drum entries use role letters instead of note names (see DRUM_LETTERS); they are bound
to the active kit's pads exactly like the genre grooves.
"""
import re

NOTE_INDEX = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
DRUM_LETTERS = {'k': 'kick', 's': 'snare', 'c': 'clap', 'h': 'closed_hat', 'o': 'open_hat',
                'r': 'rim', 'p': 'perc', 't': 'tom', 'y': 'ride', 'x': 'crash'}


def midi(name):
    m = re.fullmatch(r'([A-G])([#b]?)(-?\d)', name)
    if not m: raise ValueError('Bad note name ' + name)
    return (int(m[3]) + 1) * 12 + NOTE_INDEX[m[1]] + (1 if m[2] == '#' else -1 if m[2] == 'b' else 0)


def build(spec, length, gate=.8, swing=.5, velocity=100, pitch=midi):
    steps = [[] for _ in range(length)]
    for token in spec.split():
        parts = token.split(':')
        step = int(parts[0]); tie = int(parts[2]) if len(parts) > 2 and parts[2] else 1
        vel = int(parts[3]) if len(parts) > 3 else velocity
        for n in parts[1].split(','):
            steps[step].append(dict(note=pitch(n), velocity=vel, tie=tie))
    return dict(length=length, division='1/16', gate=max(.1, min(.9, gate)), swing=swing, steps=steps)


# (genre, name, steps, gate, swing, spec)
MELODIES = [
    # EDM, A minor, 124-130 BPM
    ('EDM', 'Festival lead', 16, .85, .5, '0:A4:2 2:C5:2 4:E5:2 6:D5 7:C5 8:B4:2 10:G4:2 12:A4:4'),
    ('EDM', 'Pluck drop', 16, .5, .5, '0:A4 1:A4 3:C5 5:A4 6:E5 8:G4 9:G4 11:B4 13:G4 14:D5'),
    ('EDM', 'Supersaw hook', 16, .85, .5, '0:A4,C5,E5:3 3:A4,C5,E5:3 6:G4,B4,D5:2 8:F4,A4,C5:3 11:F4,A4,C5:3 14:E4,G#4,B4:2'),
    ('EDM', 'Future bounce', 16, .6, .5, '0:A4 2:A4 3:E5:2 6:D5 8:C5:2 10:C5 11:G4:2 14:A4:2'),
    ('EDM', 'Big room stab', 16, .45, .5, '0:A4,E5 3:A4,E5 6:A4,E5 8:G4,D5 10:G4,D5 12:F4,C5:2 14:E4,B4:2'),
    ('EDM', 'Anthem rise', 32, .9, .5, '0:A4:3 3:B4 4:C5:4 8:E5:3 11:D5 12:C5:4 16:F5:3 19:E5 20:D5:4 24:C5:2 26:B4:2 28:G#4:4'),
    # House, C minor / F, 120-126 BPM, swung
    ('House', 'Organ stab', 16, .5, .56, '2:C4,Eb4,G4,Bb4 5:C4,Eb4,G4,Bb4 10:C4,Eb4,G4,Bb4 13:Bb3,D4,F4,A4'),
    ('House', 'Piano chords', 16, .7, .56, '0:F3,A3,C4,E4:2 3:F3,A3,C4,E4 6:G3,Bb3,D4,F4:2 10:A3,C4,E4,G4:2 14:G3,Bb3,D4,F4'),
    ('House', 'Disco octaves', 16, .45, .54, '0:C4 1:C5 2:C4 3:C5 4:Eb4 5:Eb5 6:Eb4 7:Eb5 8:F4 9:F5 10:F4 11:F5 12:G4 13:G5 14:Bb4 15:Bb5'),
    ('House', 'Vocal chop line', 16, .4, .57, '0:G4 2:Bb4 3:C5 6:Bb4 7:G4 10:F4 11:G4 14:Eb4'),
    ('House', 'Garage skip', 16, .5, .6, '0:C5 3:Eb5 5:C5 8:Bb4 10:G4 11:Bb4 13:C5'),
    ('House', 'Deep pad', 32, .95, .5, '0:C4,Eb4,G4,Bb4:8 8:Ab3,C4,Eb4,G4:8 16:F3,Ab3,C4,Eb4:8 24:G3,Bb3,D4,F4:8'),
    # Techno, minimal and hypnotic, 128-135 BPM
    ('Techno', 'Acid line', 16, .55, .5, '0:C3 1:C3 2:C4 3:C3 5:Eb3 6:C3 7:G3 8:C3 10:Bb2 11:C3 12:C4 14:F3 15:G3'),
    ('Techno', 'Hypnotic stab', 16, .35, .5, '0:C4,G4 3:C4,G4 6:C4,G4 10:C4,G4 13:C4,G4'),
    ('Techno', 'Minimal blip', 16, .25, .5, '2:G5 7:D5 10:G5 13:Bb5 15:F5'),
    ('Techno', 'Peak riff', 16, .5, .5, '0:F4 2:F4 4:Ab4 6:F4 8:C5 10:Bb4 12:Ab4 14:G4'),
    ('Techno', 'Detroit chords', 16, .75, .5, '0:Eb4,G4,Bb4,D5:3 6:F4,Ab4,C5,Eb5:3 10:Eb4,G4,Bb4,D5:2 14:D4,F4,Ab4,C5:2'),
    ('Techno', 'Rumble pulse', 16, .4, .5, '0:C3 2:C3 3:C3 4:C3 6:C3 7:C3 8:C3 10:C3 11:C3 12:C3 14:Db3 15:C3'),
    # Drum & Bass, 170-176 BPM
    ('Drum & Bass', 'Liquid lead', 32, .9, .5, '0:E5:4 4:D5:2 6:B4:2 8:A4:4 12:B4:4 16:G4:4 20:A4:2 22:B4:2 24:D5:6 30:E5:2'),
    ('Drum & Bass', 'Reese line', 32, .95, .5, '0:E2:6 6:E2:2 8:G2:4 12:E2:4 16:C2:6 22:D2:2 24:D2:8'),
    ('Drum & Bass', 'Jungle stabs', 16, .35, .53, '0:E4,G4,B4 3:E4,G4,B4 7:D4,F#4,A4 10:E4,G4,B4 14:C4,E4,G4'),
    ('Drum & Bass', 'Neuro riff', 16, .4, .5, '0:E3 1:E3 3:G3 4:E3 6:Bb3 7:A3 8:E3 10:E4 11:E3 13:D3 14:E3'),
    ('Drum & Bass', 'Rolling melody', 16, .6, .5, '0:B4 2:E5 4:F#5 6:E5 8:B4 10:G5 12:F#5 14:D5'),
    ('Drum & Bass', 'Amen keys', 16, .7, .52, '0:A3,C4,E4,G4:3 4:A3,C4,E4,G4 6:G3,B3,D4,F#4:3 10:F3,A3,C4,E4:4 14:E3,G3,B3,D4:2'),
    # Trance, 136-140 BPM
    ('Trance', 'Gated chords', 16, .45, .5, ' '.join(f'{s}:A4,C5,E5' for s in range(0, 16, 2))),
    ('Trance', 'Uplifting lead', 32, .85, .5, '0:A4:2 2:C5:2 4:E5:2 6:A5:2 8:G5:2 10:E5:2 12:D5:2 14:C5:2 16:F5:3 19:E5 20:D5:2 22:C5:2 24:B4:4 28:E5:4'),
    ('Trance', 'Pluck arp lead', 16, .4, .5, '0:A4 1:E5 2:C5 3:E5 4:A4 5:E5 6:C5 7:E5 8:G4 9:D5 10:B4 11:D5 12:F4 13:C5 14:A4 15:C5'),
    ('Trance', 'Psy riff', 16, .45, .5, '1:A3 2:A3 3:A4 5:A3 6:A3 7:G4 9:A3 10:A3 11:C4 13:A3 14:Bb3 15:A3'),
    ('Trance', 'Euphoric hook', 16, .8, .5, '0:E5:2 2:D5 3:C5:2 5:B4 6:C5:2 8:A4:3 11:B4 12:C5:2 14:D5:2'),
    ('Trance', 'Breakdown melody', 32, .95, .5, '0:A4:6 6:B4:2 8:C5:8 16:G4:6 22:A4:2 24:E4:8'),
    # Lo-fi, 70-90 BPM, lazy swing
    ('Lo-fi', 'Rhodes ninths', 16, .9, .6, '0:D3,F3,A3,C4,E4:6 8:G3,B3,D4,F4,A4:6'),
    ('Lo-fi', 'Lazy melody', 16, .7, .62, '0:A4:2 3:G4 4:E4:2 7:D4 8:E4:4 13:C4 14:D4:2'),
    ('Lo-fi', 'Jazzy walk', 16, .6, .6, '0:D3 2:F3 4:A3 6:C4 8:G3 10:B3 12:D4 14:F4'),
    ('Lo-fi', 'Tape keys', 16, .85, .6, '0:C4,E4,G4,B4:4 6:A3,C4,E4,G4:4 12:F3,A3,C4,E4:4'),
    ('Lo-fi', 'Dusty bells', 16, .5, .58, '0:E5 3:G5 6:B5 8:A5 11:G5 14:E5'),
    ('Lo-fi', 'Night drive', 32, .8, .6, '0:F4:3 4:E4:2 6:C4:2 8:D4:4 14:A3:2 16:F4:3 20:G4:2 22:A4:2 24:E4:8'),
]

ROLE_LABELS = {'intro': 'Intro', 'bridge': 'Bridge', 'tension': 'Transition / tension', 'builder': 'Builder', 'ending': 'Ending'}

# (role, name, steps, gate, spec) for the synth
SYNTH_EFFECTS = [
    ('intro', 'Soft fade-in', 32, .95, '0:A3,E4:8:40 8:A3,E4:8:58 16:A3,E4,C5:8:76 24:A3,E4,C5:8:96'),
    ('intro', 'Filtered pulse', 16, .4, ' '.join(f'{s}:A3:1:{40+s*5}' for s in range(0, 16, 2))),
    ('intro', 'Bell count-in', 16, .5, '0:A5:2:90 4:E5:2:80 8:C5:2:85 12:E5:4:95'),
    ('bridge', 'Suspended pads', 32, .95, '0:D4,G4,A4:8 8:C4,F4,G4:8 16:Bb3,Eb4,F4:8 24:A3,D4,E4:8'),
    ('bridge', 'Half-time hook', 32, .85, '0:A4:4 8:C5:4 16:B4:4 24:G4:6'),
    ('bridge', 'Call back', 16, .7, '0:E5:2 3:D5 4:C5:2 8:A4:2 11:B4 12:C5:4'),
    ('tension', 'Rising semitones', 16, .7, ' '.join(f'{s}:{n}:2' for s, n in zip(range(0, 16, 2), ('A4', 'Bb4', 'B4', 'C5', 'C#5', 'D5', 'Eb5', 'E5')))),
    ('tension', 'Octave pump', 16, .4, '0:A3 2:A4 4:A3 6:A4 8:A3 9:A4 10:A3 11:A4 12:A3 13:A4 14:A3 15:A4'),
    ('tension', 'Dissonant cluster', 16, .9, '0:A4,Bb4,E5:4 4:A4,Bb4,Eb5:4 8:G#4,A4,D5:4 12:G#4,A4,D5,E5:4'),
    ('builder', 'Synth roll', 32, .4, ' '.join(f'{s}:A4:1:{60+s}' for s in range(0, 16, 4)) + ' ' + ' '.join(f'{s}:A4:1:{60+s}' for s in range(16, 24, 2)) + ' ' + ' '.join(f'{s}:A4:1:{62+s}' for s in range(24, 32))),
    ('builder', 'Riser arp', 32, .45, ' '.join(f'{s}:{n}' for s, n in enumerate(['A3', 'C4', 'E4', 'A4'] * 2 + ['B3', 'D4', 'F4', 'B4'] * 2 + ['C4', 'E4', 'G4', 'C5'] * 2 + ['D4', 'F4', 'A4', 'D5', 'E4', 'G#4', 'B4', 'E5']))),
    ('builder', 'Pitch climb', 16, .8, ' '.join(f'{s}:{n}' for s, n in zip(range(16), ('A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'G#5', 'A5')))),
    ('ending', 'Final cadence', 32, .95, '0:E4,G#4,B4,D5:8 8:E4,G#4,B4,D5:4 12:E4,G#4,B4:4 16:A3,C4,E4,A4:8'),
    ('ending', 'Last hit', 16, .95, '0:A2,A3,C4,E4,A4:8:120'),
    ('ending', 'Falling finish', 32, .8, '0:E5:2 2:D5:2 4:C5:3 8:B4:3 12:A4:4 18:G4:4 24:A4:8'),
]

# (role, name, steps, spec) with drum role letters
DRUM_EFFECTS = [
    ('intro', 'Hat count-in', 16, ' '.join(f'{s}:h:1:{50+s*4}' for s in range(0, 16, 2)) + ' 12:o'),
    ('intro', 'Heartbeat kick', 16, '0:k:1:110 3:k:1:80 8:k:1:110 11:k:1:80'),
    ('intro', 'Rim ticks', 16, '0:r 4:r 8:r 10:r 12:r 14:r 15:r'),
    ('bridge', 'Half-time bridge', 32, '0:k 8:s 12:k 16:k 24:s 4:h 12:h 20:h 28:h 30:o'),
    ('bridge', 'Breakdown pulse', 16, '0:k 8:k 4:p 12:p 14:h'),
    ('tension', 'Tom tension', 16, '0:k 6:t 8:t 10:t 12:t 13:t 14:t 15:t'),
    ('tension', 'Stop and fill', 16, '0:k 2:h 4:s 6:h 8:k 12:s 13:s 14:t 15:t'),
    ('builder', 'Snare roll build', 32, ' '.join(f'{s}:s:1:{60+s}' for s in range(0, 16, 4)) + ' ' + ' '.join(f'{s}:s:1:{60+s}' for s in range(16, 24, 2)) + ' ' + ' '.join(f'{s}:s:1:{64+s}' for s in range(24, 32)) + ' 0:k 8:k 16:k 20:k 24:k 26:k 28:k 30:k'),
    ('builder', 'Kick build', 16, '0:k 4:k 8:k 10:k 12:k 13:k 14:k 15:k'),
    ('ending', 'Crash finish', 16, '0:k,x:1:120'),
    ('ending', 'Tom run ending', 16, '0:k 2:t 4:t 6:t 8:t 9:t 10:t 11:t 12:k,x:1:120'),
    ('ending', 'Final fill', 16, '0:k 4:s 8:k 10:s 12:s 13:s 14:s 15:s'),
]


def melodies():
    out = []
    for i, (genre, name, length, gate, swing, spec) in enumerate(MELODIES):
        slug = re.sub(r'[^a-z]+', '', genre.lower())
        index = sum(1 for g, *_ in MELODIES[:i] if g == genre) + 1
        p = build(spec, length, gate, swing)
        out.append(dict(id=f'melodie.{slug}.{index:02}', version=1, name=name, genre=genre, kind='Melodie', bpm=None,
                        brief=genre + ' melody · ' + str(length) + ' steps', device='synth', category='melodie',
                        tags=['Melodie', genre, str(length) + ' steps'], roles=[], pattern=p))
    return out


def effects(roles_pitch):
    """roles_pitch: the default kit pitch of each drum role (genre_patterns.ROLES)."""
    out = []
    for i, (role, name, length, gate, spec) in enumerate(SYNTH_EFFECTS):
        out.append(dict(id=f'fx.synth.{i+1:02}', version=1, name=name, genre='Effects', kind=ROLE_LABELS[role], bpm=None,
                        brief=ROLE_LABELS[role] + ' · synth', device='synth', category='effects', fx_role=role,
                        tags=['Effects', ROLE_LABELS[role], str(length) + ' steps'], roles=[], pattern=build(spec, length, gate)))
    for i, (role, name, length, spec) in enumerate(DRUM_EFFECTS):
        used = sorted({DRUM_LETTERS[l] for token in spec.split() for l in token.split(':')[1].split(',')})
        p = build(spec, length, .65, .5, 100, lambda letter: roles_pitch[DRUM_LETTERS[letter]])
        out.append(dict(id=f'fx.drums.{i+1:02}', version=1, name=name, genre='Effects', kind=ROLE_LABELS[role], bpm=None,
                        brief=ROLE_LABELS[role] + ' · drums', device='drum_rack', category='effects', fx_role=role,
                        tags=['Effects', ROLE_LABELS[role], str(length) + ' steps'], roles=used, pattern=p))
    return out
