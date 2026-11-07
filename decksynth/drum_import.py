"""Read-only preparation of the private evaluation draft, not project migration.

The caller explicitly supplies an asset root. Nothing is copied and no state is
committed until all sixteen sources and parameters validate successfully.
"""
import math
from pathlib import Path
from .drum_rack import new_kit, validate_kit


def prepare_reference_kit(value, asset_root, cache):
    if not isinstance(value,dict) or value.get('schema')!='decksynth.drumrack-starter.evaluation.v1':
        raise ValueError('Unsupported reference kit draft')
    pads=value.get('pads')
    if not isinstance(pads,list) or len(pads)!=16:raise ValueError('Reference draft requires sixteen pads')
    root=Path(asset_root).expanduser().resolve(strict=True)
    if not root.is_dir():raise ValueError('Choose a local sample directory')
    kit=new_kit();samples=[]
    for i,p in enumerate(pads):
        if not isinstance(p,dict) or type(p.get('midi_note')) is not int or p['midi_note']!=36+i:
            raise ValueError('Invalid reference MIDI mapping')
        if type(p.get('pad')) is not int or p['pad']!=i+1 or p.get('one_shot') is not True:
            raise ValueError('Reference pads must be ordered one-shots')
        relative=p.get('relative_wav')
        if not isinstance(relative,str) or not relative or Path(relative).is_absolute() or '..' in Path(relative).parts:
            raise ValueError('Reference sample path must stay inside the chosen directory')
        path=(root/relative).resolve()
        if not path.is_relative_to(root):raise ValueError('Reference sample escapes the chosen directory')
        if type(p.get('pan',0)) not in (int,float) or p.get('pan',0)!=0:
            raise ValueError('Pan is unavailable on the mono output')
        gain=p.get('gain_db',0.)
        if type(gain) not in (int,float) or not math.isfinite(gain) or not -24<=gain<=6:
            raise ValueError('Invalid reference pad gain')
        sha=p.get('sha256')
        if not isinstance(sha,str) or len(sha)!=64:raise ValueError('A reference sample SHA256 is required')
        sample=cache.load(path,sha)
        for field,actual in [('channels',sample.channels),('sample_rate',sample.source_rate),('source_bits',sample.bits)]:
            if field in p and (type(p[field]) is not int or p[field]!=actual):raise ValueError('Reference sample metadata mismatch')
        kit['pads'][i].update(name=p.get('label'),source=sample.source,gain=10**(gain/20),
                              choke=0 if p.get('choke_group') is None else p['choke_group'])
        samples.append(sample)
    return validate_kit(kit),samples
