"""KeyStep mk2-inspired performance primitives for DeckSynth.

Original software interpretation of the controller workflow, NOT Arturia firmware.
All scheduling uses quarter-note beats / the existing Engine sample clock.
Patterns never overwrite recorded song MIDI until an explicit commit action.
"""
import copy
import math
import random


# Pattern size limits (Sir, 15 Nov: 256 steps; a tie can hold a note for up to 32 steps).
MAX_STEPS = 256
MAX_TIE = 32
STEP_CHOICES = (4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256)


class StepCapacityError(ValueError):
    """A rejected note edit exceeds capacity; the MIDI stream can continue."""


DIVISIONS = {
    '1/2D': 3., '1/2': 2., '1/2T': 4/3,
    '1/4D': 1.5, '1/4': 1., '1/4T': 2/3,
    '1/8D': .75, '1/8': .5, '1/8T': 1/3,
    '1/16D': .375, '1/16': .25, '1/16T': 1/6,
    '1/32D': .1875, '1/32': .125, '1/32T': 1/12,
}
SCALES = {
    'Chromatic': list(range(12)),
    'Major': [0, 2, 4, 5, 7, 9, 11],
    'Minor': [0, 2, 3, 5, 7, 8, 10],
    'Dorian': [0, 2, 3, 5, 7, 9, 10],
    'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'Major Pentatonic': [0, 2, 4, 7, 9],
    'Minor Pentatonic': [0, 3, 5, 7, 10],
    'Blues': [0, 3, 5, 6, 7, 10],
    'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
    'Phrygian': [0, 1, 3, 5, 7, 8, 10],
    'Lydian': [0, 2, 4, 6, 7, 9, 11],
    'Locrian': [0, 1, 3, 5, 6, 8, 10],
    'Japanese': [0, 1, 5, 7, 8],
    'Gypsy': [0, 2, 3, 6, 7, 8, 11],
    'Arabic': [0, 1, 4, 5, 7, 8, 11],
    'Freygish': [0, 1, 4, 5, 7, 8, 10],
}
ARP_VELOCITY = ('As played', 'Fixed 100', 'Accent first')
ARP_OCTAVE_MODES = ('Up', 'Down', 'UpDown')
STRUM_SYNC = {'Off': 0., '1/64': .0625, '1/32': .125, '1/16': .25, '1/8': .5, '1/4': 1.}
# Settings added after the first saved projects: older files get these defaults on load.
ADDED_KEYS = {'arp': dict(velocity='As played', spice_seed=1, octave_mode='Up', restart_bar=False), 'chord': dict(strum_sync='Off', bass=0, slots=[[] for _ in range(8)])}
CHORD_SLOTS = 8
CHORDS = {
    'User': [0, 4, 7], 'Octave': [0, 12], '5th': [0, 7],
    'Major Triad': [0, 4, 7], 'Minor Triad': [0, 3, 7],
    'Sus 2': [0, 2, 7], 'Sus 4': [0, 5, 7],
    'Major 7': [0, 4, 7, 11], 'Minor 7': [0, 3, 7, 10],
    'Major 9': [0, 4, 7, 11, 14], 'Minor 9': [0, 3, 7, 10, 14],
    'Major 11': [0, 4, 7, 11, 14, 17], 'Minor 11': [0, 3, 7, 10, 14, 17],
}
ARP_MODES = ('Up', 'Down', 'UpDown', 'Random', 'Order', 'Poly',
             'Short 1', 'Short 2', 'Long 1', 'Long 2', 'Long 3',
             'Poly 1', 'Poly 2', 'Poly 3', 'Poly 4', 'User Sequence')


def empty_pattern(length=16, division='1/16'):
    return dict(length=length, division=division, gate=.80, swing=.50,
                steps=[[] for _ in range(length)])


def defaults():
    return dict(
        seq=dict(enabled=False, recording=False, bank=1, slot=1, length=16,
                 division='1/16', gate=.8, swing=.5, overdub=True,
                 quantize_strength=1., transpose=0, spice=0.,
                 spice_seed=1, mutate_seed=1, chain=['1:1'], chain_enabled=False),
        arp=dict(enabled=False, mode='Up', length=16, division='1/16', gate=.75,
                 swing=.5, octaves=1, hold=False, retrigger=True,
                 spice=0., seed=1, velocity='As played', spice_seed=1,
                 octave_mode='Up', restart_bar=False),
        chord=dict(enabled=False, preset='Major Triad', user=[0, 4, 7],
                   spread=0, strum_ms=0, strum_type='Up', voicing=False,
                   strum_sync='Off', bass=0, slots=[[] for _ in range(8)]),
        scale=dict(name='Chromatic', root=0, octave=0, velocity_curve='Linear',
                   input_channel=0),
        sync=dict(source='Internal',receive_transport=True),
        patterns={},
    )


def slot_key(bank, slot):
    bank, slot = int(bank), int(slot)
    if not (1 <= bank <= 4 and 1 <= slot <= 16):
        raise ValueError('Pattern address must be bank 1-4 and slot 1-16')
    return f'{bank}:{slot}'


def current_pattern(state):
    s=state['seq']; key=slot_key(s['bank'],s['slot'])
    pattern=state['patterns'].get(key)
    return pattern if pattern is not None else empty_pattern(s['length'],s['division'])


def reconcile_pattern_timing(state,pattern=None,preserve_chain=False):
    """Sync controls to effective timing; callers supply a validated/candidate copy.

    Legacy loads can use seq timing as the fallback for absent chain entries.
    Resolve those empty entries before changing that fallback, preserving playback
    in the existing pattern schema without rewriting the source project file.
    """
    seq=state['seq']
    chosen=current_pattern(state) if pattern is None else pattern
    if (preserve_chain and seq['chain_enabled'] and
            any(seq[k]!=chosen[k] for k in ('length','division'))):
        for key in seq['chain']:
            if key not in state['patterns']:
                state['patterns'][key]=empty_pattern(seq['length'],seq['division'])
    for key in ('length','division','gate','swing'):seq[key]=chosen[key]


def validate_state(value):
    """Reject malformed saved projects before using them in the synth worker."""
    if not isinstance(value, dict): raise ValueError('Invalid performance project')
    expected=defaults()
    # Projects created before MIDI clock support remain loadable.
    if set(value)==set(expected)-{'sync'}:
        value={**value,'sync':copy.deepcopy(expected['sync'])}
    if isinstance(value.get('arp'),dict) and isinstance(value.get('chord'),dict):
        value={**value}
        for section,added in ADDED_KEYS.items():
            value[section]={**copy.deepcopy(added),**value[section]}
    if set(value)!=set(expected):raise ValueError('Performance schema mismatch')
    seq,arp,chord,scale=value['seq'],value['arp'],value['chord'],value['scale']
    sync=value['sync']
    if not all(isinstance(v,dict) for v in [seq,arp,chord,scale,sync]):raise ValueError('Performance sections invalid')
    if set(sync)!={'source','receive_transport'} or sync['source'] not in ('Internal','USB MIDI','Auto') or type(sync['receive_transport']) is not bool:
        raise ValueError('Invalid MIDI clock settings')
    if set(seq)!=set(expected['seq']) or set(arp)!=set(expected['arp']) or set(chord)!=set(expected['chord']) or set(scale)!=set(expected['scale']):
        raise ValueError('Performance settings mismatch')
    def finite_num(v,lo,hi):
        return isinstance(v,(int,float)) and math.isfinite(v) and lo <= v <= hi
    def integer(v,lo,hi):
        return type(v) is int and lo <= v <= hi
    def boolean(*values):return all(type(v) is bool for v in values)
    if not boolean(seq['enabled'],seq['recording'],seq['overdub'],seq['chain_enabled'],
                   arp['enabled'],arp['hold'],arp['retrigger'],chord['enabled'],chord['voicing']):
        raise ValueError('Invalid performance booleans')
    if not integer(seq['bank'],1,4) or not integer(seq['slot'],1,16) or not integer(seq['length'],1,MAX_STEPS):
        raise ValueError('Invalid pattern slot/length')
    if seq['division'] not in DIVISIONS or arp['division'] not in DIVISIONS:
        raise ValueError('Unknown musical time division')
    if not all(finite_num(v,lo,hi) for v,lo,hi in [
        (seq['gate'],.1,.9), (seq['swing'],.5,.75),
        (seq['quantize_strength'],0,1), (seq['spice'],0,1),
        (arp['gate'],.1,.9), (arp['swing'],.5,.75), (arp['spice'],0,1)]):
        raise ValueError('Invalid timing or spice')
    if not all(integer(v,lo,hi) for v,lo,hi in [
        (seq['transpose'],-36,36),(seq['spice_seed'],0,1000000),(seq['mutate_seed'],0,1000000),
        (arp['octaves'],1,4),(arp['length'],1,64),(arp['seed'],0,1000000),
        (chord['spread'],0,16),(chord['strum_ms'],0,500),
        (scale['root'],0,11),(scale['octave'],-3,3),(scale['input_channel'],0,16)]):
        raise ValueError('Invalid performance controls')
    if arp['mode'] not in ARP_MODES or chord['preset'] not in CHORDS:
        raise ValueError('Unknown chord or arpeggio mode')
    if arp['octave_mode'] not in ARP_OCTAVE_MODES or type(arp['restart_bar']) is not bool:
        raise ValueError('Invalid arp octave mode or bar restart')
    if arp['velocity'] not in ARP_VELOCITY or type(arp['spice_seed']) is not int or not 0<=arp['spice_seed']<=1000000:
        raise ValueError('Invalid arpeggiator velocity or dice')
    if chord['strum_sync'] not in STRUM_SYNC or type(chord['bass']) is not int or not 0<=chord['bass']<=3:
        raise ValueError('Invalid strum sync or bass note')
    if chord['strum_type'] not in ('Up','Down','Alt Up','Alt Down'):
        raise ValueError('Unknown strum direction')
    if scale['name'] not in SCALES or scale['velocity_curve'] not in ('Linear','Logarithmic','Exponential','Fixed 100'):
        raise ValueError('Unknown scale/velocity curve')
    if not isinstance(chord['user'],list) or not 1<=len(chord['user'])<=16 or not all(integer(n,-48,48) for n in chord['user']):
        raise ValueError('Invalid custom chord')
    slots=chord['slots']
    if (not isinstance(slots,list) or len(slots)!=CHORD_SLOTS or
            not all(isinstance(c,list) and len(c)<=8 and all(integer(n,0,127) for n in c) for c in slots)):
        raise ValueError('Invalid saved chord slots')
    chain=seq['chain']
    if not isinstance(chain,list) or not 1<=len(chain)<=64:
        raise ValueError('Invalid pattern chain')
    if any(not isinstance(k,str) or k not in [slot_key(b,p) for b in range(1,5) for p in range(1,17)] for k in chain):
        raise ValueError('Invalid pattern reference in chain')
    patterns=value['patterns']
    if not isinstance(patterns,dict) or len(patterns)>64:raise ValueError('Invalid pattern bank')
    for key,pattern in patterns.items():
        if key not in [slot_key(b,p) for b in range(1,5) for p in range(1,17)]:
            raise ValueError('Unknown pattern slot')
        validate_pattern(pattern)
    if seq['chain_enabled']:
        # Reject incompatible song chains on settings change / project load,
        # never allow a musical configuration error to stop the audio worker.
        rates={patterns[key]['division'] if key in patterns else seq['division'] for key in chain}
        if len(rates)>1:raise ValueError('Pattern chain needs matching step divisions')
    return copy.deepcopy(value)


def validate_pattern(pattern):
    if not isinstance(pattern,dict) or set(pattern)!={'length','division','gate','swing','steps'}:
        raise ValueError('Invalid sequence pattern')
    length=pattern['length']
    if type(length) is not int or not 1<=length<=MAX_STEPS or pattern['division'] not in DIVISIONS:
        raise ValueError('Pattern time division / length invalid')
    if not isinstance(pattern['gate'],(int,float)) or not .1<=pattern['gate']<=.9:
        raise ValueError('Pattern gate invalid')
    if not isinstance(pattern['swing'],(int,float)) or not .5<=pattern['swing']<=.75:
        raise ValueError('Pattern swing invalid')
    if not isinstance(pattern['steps'],list) or len(pattern['steps'])!=length:
        raise ValueError('Pattern steps mismatch')
    for step in pattern['steps']:
        if not isinstance(step,list) or len(step)>8:raise ValueError('Maximum 8 notes per step')
        for item in step:
            if not isinstance(item,dict) or set(item)!={'note','velocity','tie'}:
                raise ValueError('Invalid step note')
            if not (type(item['note']) is int and 0<=item['note']<=127 and
                    type(item['velocity']) is int and 1<=item['velocity']<=127 and
                    type(item['tie']) is int and 1<=item['tie']<=MAX_TIE):
                raise ValueError('Invalid step pitch/velocity/tie')
    return pattern


def change_pattern_length(pattern,length):
    if type(length) is not int or not 1<=length<=MAX_STEPS:raise ValueError('Sequence length 1-%d steps'%MAX_STEPS)
    updated=copy.deepcopy(pattern)
    updated['steps']=(updated['steps']+[[] for _ in range(length)])[:length]
    updated['length']=length
    return updated


def step_change(pattern,index,notes,replace=True):
    out=copy.deepcopy(pattern)
    if not 0<=index<out['length']:raise ValueError('Step outside pattern')
    prepared=[dict(note=int(n['note']),velocity=int(n.get('velocity',100)),tie=int(n.get('tie',1))) for n in notes]
    if len(prepared)>8:raise StepCapacityError('Maximum eight notes per step')
    old=[] if replace else out['steps'][index][:]
    combined=old+prepared
    if len(combined)>8:raise StepCapacityError('Maximum eight notes per step')
    out['steps'][index]=combined
    validate_pattern(out)
    return out


def chord_notes(state,root,velocity=100):
    scale=state['scale']; root=scale_snap(root,scale['root'],scale['name'])
    root=min(127,max(0,root+scale['octave']*12))
    if not state['chord']['enabled']:return [root]
    chord=state['chord']; intervals=(chord['user'] if chord['preset']=='User'
                                     else CHORDS[chord['preset']])
    spread=chord['spread']
    if spread==0: count=len(intervals)
    elif spread==16: count=len(intervals)
    else: count=min(len(intervals),spread)
    pitches=[root+n for n in intervals[:count]]
    if chord['voicing'] and len(pitches)>1:
        # Pick stable close-position inversions instead of jumping all voices.
        pitches[1:]=[n-12 if n-root>6 else n for n in pitches[1:]]
    if chord.get('bass'):pitches.append(root-12*chord['bass'])
    return sorted(set(max(0,min(127,n)) for n in pitches))


def scale_snap(note,root,name):
    allowed=SCALES[name]
    if name=='Chromatic':return max(0,min(127,note))
    notes=[n for n in range(max(0,note-6),min(127,note+6)+1)
           if (n-root)%12 in allowed]
    return min(notes,key=lambda n:(abs(n-note),n)) if notes else max(0,min(127,note))


def velocity_transform(value,kind):
    x=max(0,min(1,value/127))
    if kind=='Fixed 100':return 100
    if kind=='Logarithmic':x=math.sqrt(x)
    if kind=='Exponential':x=x*x
    return max(1,min(127,round(x*127)))


def time_swing(step,swing,step_beats):
    return step_beats*(swing-.50)*2 if step%2 else 0.


def _ratio(note,base):
    return max(0,min(127,note+base))


def arp_groups(held,mode='Up',octaves=1,seed=1,steps=16,octave_mode='Up'):
    """Deterministic note groups. Includes nine generative modes, no random UI-only animation.

    octave_mode says how the octaves are walked: Up (low to high, the original behaviour), Down (high to low)
    or UpDown (low to high and back, without repeating the top and bottom octave). For Down and UpDown the
    note pattern plays once per octave pass."""
    if octave_mode in ('Down','UpDown') and octaves>1:
        base=arp_groups(held,mode,1,seed,steps)
        passes=list(range(octaves))
        passes=passes[::-1] if octave_mode=='Down' else passes+passes[-2:0:-1]
        return [[n+12*o for n in g if n+12*o<=127] for o in passes for g in base]
    unique=list(dict.fromkeys(max(0,min(127,int(v))) for v in held))[:64]
    if not unique:return []
    ordered=[n+o*12 for o in range(octaves) for n in unique if n+o*12<=127]
    asc=sorted(ordered); desc=asc[::-1]
    if mode=='Up':return [[n] for n in asc]
    if mode=='Down':return [[n] for n in desc]
    # Up then back down without repeating the top or bottom note: C E G B -> C E G B G E.
    if mode=='UpDown':return [[n] for n in asc+asc[-2:0:-1]]
    if mode=='Order':return [[n] for n in ordered]
    if mode=='Poly':return [asc]
    rng=random.Random(seed)
    if mode=='Random':return [[rng.choice(asc)] for _ in range(max(16,len(asc)))]
    if mode=='User Sequence':return [[n] for n in asc]
    density={'Short 1':1.,'Short 2':.74,'Long 1':.52,'Long 2':.85,'Long 3':.82,
             'Poly 1':.67,'Poly 2':.89,'Poly 3':.85,'Poly 4':.92}[mode]
    poly=mode.startswith('Poly')
    groups=[]
    for step in range(steps):
        if rng.random()>density:
            groups.append([]);continue
        if poly:
            number=2+(rng.randrange(min(3,len(asc))) if len(asc)>1 else 0)
            groups.append(sorted(rng.sample(asc,min(len(asc),number))))
        else: groups.append([rng.choice(asc)])
    return groups


def mutate_pattern(pattern,intensity,seed=1):
    """Mutate distinct occurrences without deleting a source on a capacity collision."""
    validate_pattern(pattern)
    if (type(intensity) not in (int,float) or not math.isfinite(intensity)
            or not 0<=intensity<=1):raise ValueError('Mutation strength 0-1')
    # Stable tokens distinguish equal-valued notes and survive moves into a step.
    buckets=[[(i,j,dict(item)) for j,item in enumerate(step)]
             for i,step in enumerate(pattern['steps'])]
    rng=random.Random(seed)
    for i,step in enumerate(pattern['steps']):
        for j,item in enumerate(step):
            if rng.random()<intensity:
                dest=(i+rng.choice([-2,-1,0,1,2]))%pattern['length']
                note=dict(item)
                note['note']=max(0,min(127,note['note']+rng.choice([-7,-5,-2,2,5,7])))
                index=next(k for k,(source,occurrence,_) in enumerate(buckets[i])
                           if (source,occurrence)==(i,j))
                if dest==i:buckets[i][index]=(i,j,note)
                elif len(buckets[dest])<8:
                    buckets[i].pop(index)
                    buckets[dest].append((i,j,note))
    out=copy.deepcopy(pattern)
    out['steps']=[[item for _,_,item in step] for step in buckets]
    validate_pattern(out)
    return out


def pattern_from_song(notes,bars,division='1/16',length=16):
    pattern=empty_pattern(length,division)
    beat_size=DIVISIONS[division]
    for item in notes:
        step=int(round(item['start']/beat_size))%length
        if len(pattern['steps'][step])>=8:continue
        pattern['steps'][step].append(dict(note=item['note'],velocity=item['velocity'],
                                          tie=max(1,min(MAX_TIE,round(item['duration']/beat_size)))))
    return validate_pattern(pattern)


def clip_to_pattern(notes,clip_beats,division,frame_beats=0.):
    """Song -> Pattern for a recorded clip. Returns (pattern, report).

    A live take (keys, chord pads, the arp) is stored at audio-frame times, so its notes sit a few
    samples off the grid at most tempos, and played chords are off it by milliseconds. Each note is
    snapped to the nearest step of `division`; the report counts the ones that moved by more than one
    audio frame. The pattern gets the clip's length in steps (up to MAX_STEPS), so an 8-bar take
    becomes 128 steps at 1/16 instead of failing on a 16-step pattern. Note lengths become ties with
    one shared gate; exact when the lengths allow it, else the nearest tie.
    """
    unit=DIVISIONS[division]
    if not notes:raise ValueError('The source clip is empty')
    clip_steps=clip_beats/unit
    length=max(1,int(math.ceil(clip_steps-1e-9)))
    if length>MAX_STEPS:
        last=max(int(round(n['start']/unit)) for n in notes)+1
        length=next((c for c in STEP_CHOICES if c>=last),None)
        if length is None:
            bars=clip_beats/4
            raise ValueError('This %g-bar clip is %d steps at %s; a pattern holds %d. Pick a slower rate such as %s and try again'
                             %(bars,int(math.ceil(clip_steps-1e-9)),division,MAX_STEPS,
                               next((d for d in ('1/8','1/4','1/2') if clip_beats/DIVISIONS[d]<=MAX_STEPS),'1/2')))
    tolerance=(frame_beats/unit if frame_beats else 0.)+1e-6
    moved=0;placed={}
    for n in sorted(notes,key=lambda n:(n['start'],n['note'])):
        exact=n['start']/unit;step=int(round(exact))
        if abs(exact-step)>tolerance:moved+=1
        step%=length  # a note snapped onto the loop end belongs to the next loop's step 1
        bucket=placed.setdefault(step,{})
        old=bucket.get(n['note'])
        # Two takes of the same pitch landing on one step merge: keep the louder, longer one.
        if old is None or (n['velocity'],n['duration'])>(old['velocity'],old['duration']):bucket[n['note']]=n
    merged=len(notes)-sum(len(b) for b in placed.values())
    dropped=0;steps=[[] for _ in range(length)];kept=[]
    for step,bucket in placed.items():
        chosen=sorted(bucket.values(),key=lambda n:-n['velocity'])
        dropped+=max(0,len(chosen)-8)
        for n in sorted(chosen[:8],key=lambda n:n['note']):kept.append((step,n))
    ratios=[max(1e-9,n['duration']/unit) for _,n in kept]
    def exact_gate():
        first=ratios[0]
        # Recorded lengths are whole audio frames, so allow a frame or two of slack (and tidy the gate).
        slack=2*tolerance
        cands=[.8]+sorted({round(first/t,3) for t in range(1,MAX_TIE+1) if .1<=first/t<=.9},key=lambda g:abs(g-.8))
        for g in cands:
            if all(1<=round(r/g)<=MAX_TIE and math.isclose(r/g,round(r/g),abs_tol=max(1e-6,slack/g)) for r in ratios):return g
        return None
    gate=exact_gate();rounded=0
    if gate is None:
        # No shared gate is exact: pick the one that keeps the lengths closest to what was played.
        best=None
        for k in range(10,91,5):
            g=k/100;err=sum(abs(max(1,min(MAX_TIE,round(r/g)))*g-r) for r in ratios)
            if best is None or err<best[0]-1e-9:best=(err,g)
        gate=best[1]
        rounded=sum(1 for r in ratios if abs(max(1,min(MAX_TIE,round(r/gate)))*gate-r)>.05*r+1e-6)
    for (step,n),r in zip(kept,ratios):
        steps[step].append(dict(note=n['note'],velocity=n['velocity'],tie=max(1,min(MAX_TIE,round(r/gate)))))
    pattern=dict(length=length,division=division,gate=round(gate,6),swing=.5,steps=steps)
    validate_pattern(pattern)
    report=dict(length=length,notes=len(kept),moved=moved,merged=merged,dropped=dropped,rounded=rounded,division=division,
                better=better_division(notes,clip_beats,frame_beats) if moved else None)
    if report['better']==division:report['better']=None
    return pattern,report


def off_grid(notes,division,frame_beats=0.):
    unit=DIVISIONS[division];tol=(frame_beats/unit if frame_beats else 0.)+1e-6
    return sum(1 for n in notes if abs(n['start']/unit-round(n['start']/unit))>tol)


def better_division(notes,clip_beats,frame_beats=0.):
    """The coarsest rate that fits a take with far fewer snapped notes (e.g. 1/16T for a triplet take),
    for the Song -> Pattern report. None when nothing fits clearly better."""
    rates=[d for d in ('1/4','1/8','1/8T','1/16','1/16T','1/32','1/32T') if clip_beats/DIVISIONS[d]<=MAX_STEPS]
    scored=[(off_grid(notes,d,frame_beats),-DIVISIONS[d],d) for d in rates]
    if not scored:return None
    best=min(scored)
    return best[2] if best[0]<=len(notes)*.05 else None


def seq_spice(spice,seed,tick,idx,gate):
    """Spice for one SEQ note: (skip, gate, ratchets). Shared by live playback and Pattern -> Song,
    so a sent clip holds exactly the variation that was heard."""
    if not spice:return False,gate,1
    rng=random.Random((tick*983+idx*61+seed)*41)
    if rng.random()<spice*.25:return True,gate,1
    gate=max(.1,min(.9,gate+rng.uniform(-.25,.25)*spice))
    ratchets=(2 if rng.random()<.7 else 3) if rng.random()<spice*.35 else 1
    return False,gate,ratchets


def song_from_pattern(pattern,bars,transpose=0,gate=None,fill=False,feel=None):
    """Song notes for a pattern. With fill, a pattern shorter than the loop repeats until the loop is full,
    so a 1-bar pattern sent to a 4-bar track plays in every bar instead of leaving 3 bars empty.

    feel=dict(spice=..., spice_seed=...) renders what the sequencer plays from bar 1: the pattern's swing
    shifts the off-beat steps, and spice skips notes, varies gate and adds ratchets with the live seed.
    Without feel the notes stay exactly on the grid (Song -> Pattern round trips rely on that)."""
    beat_size=DIVISIONS[pattern['division']]
    length=bars*4
    span=len(pattern['steps'])*beat_size
    copies=max(1,math.ceil(length/span-1e-9)) if fill and span>0 else 1
    out=[]
    for rep in range(copies):
        for step,notes in enumerate(pattern['steps']):
            start=rep*span+step*beat_size
            if start>=length-1e-9:break
            tick=rep*len(pattern['steps'])+step
            if feel is not None:start+=time_swing(tick,pattern['swing'],beat_size)
            for idx,item in enumerate(notes):
                note_gate=gate or pattern['gate'];ratchets=1
                if feel is not None:
                    skip,note_gate,ratchets=seq_spice(feel.get('spice',0.),feel.get('spice_seed',1),tick,idx,note_gate)
                    if skip:continue
                sub=beat_size/ratchets
                for r in range(ratchets):
                    on=start+r*sub
                    if on>=length-1e-9:break
                    duration=sub*note_gate*(item['tie'] if ratchets==1 else 1)
                    out.append(dict(start=round(on,9),duration=min(length,duration),
                                    note=_ratio(item['note'],transpose),velocity=item['velocity']))
    return out


def _arp_velocity(arp,note,first,velocities):
    if arp['velocity']=='Accent first':return 118 if first else 84
    if arp['velocity']=='Fixed 100' or not velocities:return 100
    for shift in range(0,61,12):
        if note-shift in velocities:return velocities[note-shift]
    return 100


def arp_start_tick(anchor_frame,step_frames):
    """First arp step at or after the frame where the phrase started (the first key press)."""
    return max(0,int(math.ceil(anchor_frame/step_frames-1e-9)))


def arp_phase(arp,tick,start_tick,step_beats=None):
    """Pattern position for a clock tick: step 1 always lands on the first step after the key press.
    With Restart on bar, step 1 also lands on every bar line."""
    phase=tick-start_tick
    if phase<0:return None
    if arp.get('restart_bar') and step_beats:
        bar=math.floor(tick*step_beats/4+1e-9)
        bar_tick=int(math.ceil(bar*4/step_beats-1e-9))
        phase=min(phase,tick-bar_tick)
        return phase%arp['length'] if arp['retrigger'] else phase
    return phase%arp['length'] if arp['retrigger'] else phase


def arp_view(state,held,beat,anchor_beat=0.):
    """What the arpeggiator is really playing: its note groups and the step at this beat."""
    arp=state['arp']
    if not held:return dict(groups=[],step=-1,phase=-1)
    groups=arp_groups(held,arp['mode'],arp['octaves'],arp['seed'],octave_mode=arp.get('octave_mode','Up'))
    if not groups:return dict(groups=[],step=-1,phase=-1)
    size=DIVISIONS[arp['division']]
    tick=int(math.floor(max(0.,beat)/size+1e-9))
    phase=arp_phase(arp,tick,arp_start_tick(anchor_beat,size),size)
    # step indexes groups; phase is the position in the arp cycle (Steps long with Retrig), for the piano roll.
    return dict(groups=groups[:64],step=-1 if phase is None else phase%len(groups),phase=-1 if phase is None else phase)


def schedule_notes(state,held,start_frame,end_frame,fpb,transpose=0,velocities=None,arp_anchor=0):
    """Return frame-offset note-on/off events for one 128-sample audio chunk.

    Every scheduled occurrence gets a stable per-tick token, so loop wrapping,
    polyphonic chords, long tied notes and releases don't steal live key voices.
    arp_anchor is the song frame where the current arp phrase began (the key press),
    so the pattern starts on its first note instead of wherever the clock happened to be.
    """
    events=[]
    seq,arp=state['seq'],state['arp']
    if seq['enabled']:
        active_seq=state['patterns'].get(slot_key(seq['bank'],seq['slot']))
        pattern=active_seq or empty_pattern(seq['length'],seq['division'])
        chain=[pattern]
        if seq['chain_enabled']:
            chain=[state['patterns'].get(key) or empty_pattern(seq['length'],seq['division'])
                   for key in seq['chain']]
            # Mixed divisions would not share step boundaries. Enforce explicitly.
            if any(p['division']!=chain[0]['division'] for p in chain):
                raise ValueError('Pattern chain requires a common time division')
        sizes=[p['length'] for p in chain]
        total_steps=sum(sizes)
        step_frames=DIVISIONS[chain[0]['division']]*fpb
        begin=max(0,int(math.floor(start_frame/step_frames))-10)
        finish=int(math.ceil(end_frame/step_frames))+1
        for tick in range(begin,finish):
            offset=tick%total_steps
            patindex=0
            while offset>=sizes[patindex]:
                offset-=sizes[patindex]; patindex+=1
            p=chain[patindex]
            swing=p['swing']
            onset=round((tick*DIVISIONS[p['division']]+time_swing(tick,swing,DIVISIONS[p['division']]))*fpb)
            for idx,item in enumerate(p['steps'][offset]):
                num=_ratio(item['note'],transpose+seq['transpose'])
                velocity=item['velocity']
                skip,gate,ratchets=seq_spice(seq['spice'],seq['spice_seed'],tick,idx,p['gate'])
                if skip:continue
                for r in range(ratchets):
                    sublength=DIVISIONS[p['division']]*fpb/ratchets
                    on=onset+round(r*sublength)
                    off=on+max(1,round(sublength*gate*(item['tie'] if ratchets==1 else 1)))
                    token=('perf_seq',tick,idx,patindex,r)
                    if start_frame<=on<end_frame:events.append((on-start_frame,1,num,velocity,token))
                    if start_frame<=off<end_frame:events.append((off-start_frame,0,num,0,token))
    if arp['enabled'] and held:
        pattern=arp_groups(held,arp['mode'],arp['octaves'],arp['seed'],octave_mode=arp.get('octave_mode','Up'))
        if arp['mode']=='User Sequence':
            user=current_pattern(state)
            actual=[item['note'] for step in user['steps'] for item in step]
            if actual:
                shift=held[0]-min(actual)
                pattern=[[max(0,min(127,item['note']+shift)) for item in step[:8]]
                         for step in user['steps']]
        if pattern:
            step_beats=DIVISIONS[arp['division']]
            step_frames=step_beats*fpb
            first=arp_start_tick(arp_anchor,step_frames)
            begin=max(first,int(math.floor(start_frame/step_frames))-3)
            finish=int(math.ceil(end_frame/step_frames))+1
            for tick in range(begin,finish):
                cycle_step=arp_phase(arp,tick,first,step_beats)
                group=pattern[cycle_step%len(pattern)]
                onset=round((tick*step_beats+time_swing(tick,arp['swing'],step_beats))*fpb)
                for i,note in enumerate(group):
                    gate=arp['gate'];ratchets=1
                    if arp['spice']:
                        rng=random.Random(tick*301+i*79+arp['seed']+(arp['spice_seed']-1)*7919)
                        if rng.random()<arp['spice']*.23:continue
                        gate=max(.1,min(.9,gate+rng.uniform(-.25,.25)*arp['spice']))
                        if rng.random()<arp['spice']*.3:ratchets=2
                    for r in range(ratchets):
                        sublength=step_frames/ratchets
                        on=onset+round(r*sublength)
                        off=on+max(1,round(gate*sublength))
                        token=('perf_arp',tick,i,r)
                        vel=_arp_velocity(arp,note,cycle_step%len(pattern)==0,velocities)
                        if start_frame<=on<end_frame:events.append((on-start_frame,1,note,vel,token))
                        if start_frame<=off<end_frame:events.append((off-start_frame,0,note,0,token))
    return sorted(events,key=lambda event:(event[0],event[1]))


class HeldNotes:
    """Runtime-only live chord memory for arpeggios; never persists stuck hardware keys."""
    def __init__(self):self.keys={};self.latched=[];self.hold=False;self.velocity={}
    def velocities(self):return dict(self.velocity)
    def on(self,key,notes,velocity=100):
        for n in notes:self.velocity[n]=velocity
        if self.hold and not self.keys:self.latched=[]
        self.keys[key]=list(notes)
        self.latched=list(dict.fromkeys([*self.latched,*notes]))[:64]
    def off(self,key):
        self.keys.pop(key,None)
        if not self.hold and not self.keys:self.latched=[]
    def held(self):
        if self.hold:return self.latched[:]
        return list(dict.fromkeys(n for values in self.keys.values() for n in values))[:64]
    def set_hold(self,enabled):
        self.hold=bool(enabled)
        if not self.hold and not self.keys:self.latched=[]
    def reset(self):self.keys={};self.latched=[];self.velocity={}
