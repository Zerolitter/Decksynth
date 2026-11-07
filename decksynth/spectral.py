"""Deterministic base-partial seeds and opt-in evaluated-energy policy; no audio scheduling."""
import math

SHAPES = ('SAW','SQUARE','TRIANGLE','PULSE','GAUSSIAN','SPREAD','RANDOM')
UINT32 = 0xffffffff
ENERGY_RSS = .4  # Conservative single-voice headroom; waveform peak is also bounded to1.


def checked_seed(seed):
    if type(seed) is not int or not 0<=seed<=UINT32:
        raise ValueError('Random seed must be an unsigned32-bit integer')
    return seed


def next_seed(seed):
    return (checked_seed(seed)+0x9e3779b9)&UINT32


def seed_shape(name,seed=0):
    if not isinstance(name,str) or name not in SHAPES:
        raise ValueError('Unknown spectral shape')
    state=checked_seed(seed);out=[]
    for i in range(16):
        k=i+1
        if name=='SAW':v=1/k
        elif name=='SQUARE':v=1/k if k%2 else 0.
        elif name=='TRIANGLE':v=1/(k*k) if k%2 else 0.
        elif name=='PULSE':v=.7/k*(1+math.cos((k-1)*math.pi/3))
        elif name=='GAUSSIAN':v=math.exp(-((i-5)/3)**2)
        elif name=='SPREAD':v=(.85,.28,.09)[i%3]
        else:
            state=(1664525*state+1013904223)&UINT32;v=state/UINT32
        out.append(min(1.,max(0.,round(v,5))))
    return out


def validate_metadata(instrument):
    if 'random_seed' in instrument:checked_seed(instrument['random_seed'])
    if 'spectral_energy' in instrument:
        v=instrument['spectral_energy']
        if type(v) is not int or v not in (0,1):raise ValueError('Unknown spectral energy mode')
    if 'character' in instrument:
        v=instrument['character']
        if type(v) not in (int,float) or not math.isfinite(v) or not -1<=v<=1:
            raise ValueError('Character must be between-1 and1')


def energy_norm(weights):
    """No amplification of quiet/empty spectra. Legacy normalization never calls this."""
    return max(1.,math.sqrt(sum(w*w for w in weights))/ENERGY_RSS)
