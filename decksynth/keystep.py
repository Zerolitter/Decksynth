"""KeyStep mk2-inspired performance primitives for DeckSynth.

Original software interpretation of the controller workflow, NOT Arturia firmware.
All scheduling uses quarter-note beats / the existing Engine sample clock.
Patterns never overwrite recorded song MIDI until an explicit commit action.
"""
import copy
import math
import random


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
}
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
                 spice=0., seed=1),
        chord=dict(enabled=False, preset='Major Triad', user=[0, 4, 7],
                   spread=0, strum_ms=0, strum_type='Up', voicing=False),
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


def validate_state(value):
    """Reject malformed saved projects before using them in the synth worker."""
    if not isinstance(value, dict): raise ValueError('Invalid performance project')
    expected=defaults()
    # Projects created before MIDI clock support remain loadable.
    if set(value)==set(expected)-{'sync'}:
        value={**value,'sync':copy.deepcopy(expected['sync'])}
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
    if not integer(seq['bank'],1,4) or not integer(seq['slot'],1,16) or not integer(seq['length'],1,64):
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
    if chord['strum_type'] not in ('Up','Down','Alt Up','Alt Down'):
        raise ValueError('Unknown strum direction')
    if scale['name'] not in SCALES or scale['velocity_curve'] not in ('Linear','Logarithmic','Exponential','Fixed 100'):
        raise ValueError('Unknown scale/velocity curve')
    if not isinstance(chord['user'],list) or not 1<=len(chord['user'])<=16 or not all(integer(n,-48,48) for n in chord['user']):
        raise ValueError('Invalid custom chord')
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
    if type(length) is not int or not 1<=length<=64 or pattern['division'] not in DIVISIONS:
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
                    type(item['tie']) is int and 1<=item['tie']<=8):
                raise ValueError('Invalid step pitch/velocity/tie')
    return pattern


def change_pattern_length(pattern,length):
    if type(length) is not int or not 1<=length<=64:raise ValueError('Sequence length 1-64 steps')
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


def arp_groups(held,mode='Up',octaves=1,seed=1,steps=16):
    """Deterministic note groups. Includes nine generative modes, no random UI-only animation."""
    unique=list(dict.fromkeys(max(0,min(127,int(v))) for v in held))[:64]
    if not unique:return []
    ordered=[n+o*12 for o in range(octaves) for n in unique if n+o*12<=127]
    asc=sorted(ordered); desc=asc[::-1]
    if mode=='Up':return [[n] for n in asc]
    if mode=='Down':return [[n] for n in desc]
    if mode=='UpDown':return [[n] for n in (asc+desc[-2:0:-1] if len(asc)>2 else asc+desc)]
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
    """Copy-on-write pitch/time mutation, applied to a saved pattern only on explicit confirmation."""
    out=copy.deepcopy(pattern)
    rng=random.Random(seed)
    intensity=max(0.,min(1.,intensity))
    for i,step in enumerate(pattern['steps']):
        for item in step:
            if rng.random()<intensity:
                dest=(i+rng.choice([-2,-1,0,1,2]))%pattern['length']
                note=dict(item)
                note['note']=max(0,min(127,note['note']+rng.choice([-7,-5,-2,2,5,7])))
                if len(out['steps'][dest])<8:out['steps'][dest].append(note)
                if i==dest:out['steps'][dest].remove(item)
                else:out['steps'][i].remove(item)
    validate_pattern(out)
    return out


def pattern_from_song(notes,bars,division='1/16',length=16):
    pattern=empty_pattern(length,division)
    beat_size=DIVISIONS[division]
    for item in notes:
        step=int(round(item['start']/beat_size))%length
        if len(pattern['steps'][step])>=8:continue
        pattern['steps'][step].append(dict(note=item['note'],velocity=item['velocity'],
                                          tie=max(1,min(8,round(item['duration']/beat_size)))))
    return validate_pattern(pattern)


def song_from_pattern(pattern,bars,transpose=0,gate=None):
    beat_size=DIVISIONS[pattern['division']]
    length=bars*4
    out=[]
    for step,notes in enumerate(pattern['steps']):
        start=step*beat_size
        if start>=length:break
        for item in notes:
            out.append(dict(start=start,duration=min(length,beat_size*(gate or pattern['gate'])*item['tie']),
                            note=_ratio(item['note'],transpose),velocity=item['velocity']))
    return out


def schedule_notes(state,held,start_frame,end_frame,fpb,transpose=0):
    """Return frame-offset note-on/off events for one 128-sample audio chunk.

    Every scheduled occurrence gets a stable per-tick token, so loop wrapping,
    polyphonic chords, long tied notes and releases don't steal live key voices.
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
                gate=p['gate'];spice=seq['spice'];ratchets=1
                if spice:
                    rng=random.Random((tick*983+idx*61+seq['spice_seed'])*41)
                    if rng.random()<spice*.25:continue
                    gate=max(.1,min(.9,gate+rng.uniform(-.25,.25)*spice))
                    if rng.random()<spice*.35:ratchets=2 if rng.random()<.7 else 3
                for r in range(ratchets):
                    sublength=DIVISIONS[p['division']]*fpb/ratchets
                    on=onset+round(r*sublength)
                    off=on+max(1,round(sublength*gate*(item['tie'] if ratchets==1 else 1)))
                    token=('perf_seq',tick,idx,patindex,r)
                    if start_frame<=on<end_frame:events.append((on-start_frame,1,num,velocity,token))
                    if start_frame<=off<end_frame:events.append((off-start_frame,0,num,0,token))
    if arp['enabled'] and held:
        pattern=arp_groups(held,arp['mode'],arp['octaves'],arp['seed'])
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
            begin=max(0,int(math.floor(start_frame/step_frames))-3)
            finish=int(math.ceil(end_frame/step_frames))+1
            for tick in range(begin,finish):
                cycle_step=tick%arp['length'] if arp['retrigger'] else tick
                group=pattern[cycle_step%len(pattern)]
                onset=round((tick*step_beats+time_swing(tick,arp['swing'],step_beats))*fpb)
                for i,note in enumerate(group):
                    gate=arp['gate'];ratchets=1
                    if arp['spice']:
                        rng=random.Random(tick*301+i*79+arp['seed'])
                        if rng.random()<arp['spice']*.23:continue
                        gate=max(.1,min(.9,gate+rng.uniform(-.25,.25)*arp['spice']))
                        if rng.random()<arp['spice']*.3:ratchets=2
                    for r in range(ratchets):
                        sublength=step_frames/ratchets
                        on=onset+round(r*sublength)
                        off=on+max(1,round(gate*sublength))
                        token=('perf_arp',tick,i,r)
                        if start_frame<=on<end_frame:events.append((on-start_frame,1,note,100,token))
                        if start_frame<=off<end_frame:events.append((off-start_frame,0,note,0,token))
    return sorted(events,key=lambda event:(event[0],event[1]))


class HeldNotes:
    """Runtime-only live chord memory for arpeggios; never persists stuck hardware keys."""
    def __init__(self):self.keys={};self.latched=[];self.hold=False
    def on(self,key,notes):
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
    def reset(self):self.keys={};self.latched=[]
