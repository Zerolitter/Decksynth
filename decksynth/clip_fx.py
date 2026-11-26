"""FX per clip: a clip can carry its own changes to its track's effects.

A track's 'clip_fx' maps a clip (its index 0-7 as a string, A to H) to what that clip changes:
  fx     {module id: {'on': bool, 'params': {key: value}}}: a card switched on or off, and knob values;
  sends  {bus index: {'amount': 0..1, 'through': bool}}: how much the track sends to each FX bus;
  change 'jump' (left out), 'beat' or 'bar': when the clip starts, its knob values land at once or glide
         there over one beat or one bar. Whole-number settings and on/off always jump.
Only touched values are kept, so a clip that changes nothing has no entry and plays the track's own chain
(its Base). While a clip plays, the track's chain and sends are its Base with the clip's changes on top;
macros, mod pads and automation still move the knobs from there. The change lands on the first block of
the clip, between blocks like any other edit (or glides there, see 'change').

A clip holds a card's on/off as its power button (bypass), so a card that is off in Base and on in a clip
stays in the chain, switched off. A bus's own chain is the same in every clip.
"""
import copy
import math

from . import sends as send_buses
from .fx import PARAMS, STEPPED

CLIPS = 8
CHANGES = ('jump', 'beat', 'bar')


def stepped(module, key):
    """A whole-number setting (a choice such as a filter type or a ratio): it never glides."""
    if (module, key) in STEPPED: return True
    for k, lo, hi, init in PARAMS[module]:
        if k == key: return hi - lo >= 2 and all(float(x).is_integer() for x in (lo, hi, init))
    return False


def _num(v):
    assert type(v) in (int, float) and math.isfinite(v)
    return float(v)


def validate_entry(raw, buses=send_buses.MAX_BUSES):
    """One clip's changes, cleaned; None when it changes nothing."""
    assert isinstance(raw, dict)
    fx = {}
    for mid, hold in (raw.get('fx') or {}).items():
        assert mid in PARAMS and isinstance(hold, dict)
        keys = {k: (lo, hi) for k, lo, hi, _ in PARAMS[mid]}
        out = {}
        if 'on' in hold:
            assert isinstance(hold['on'], bool); out['on'] = hold['on']
        params = {}
        for k, v in (hold.get('params') or {}).items():
            assert k in keys; lo, hi = keys[k]; params[k] = min(hi, max(lo, _num(v)))
        if params: out['params'] = dict(sorted(params.items()))
        if out: fx[mid] = out
    sends = {}
    for bus, feed in (raw.get('sends') or {}).items():
        i = send_buses.bus_index(bus, send_buses.MAX_BUSES); assert isinstance(feed, dict)
        through = feed.get('through', False); assert isinstance(through, bool)
        if i < buses: sends[str(i)] = {'amount': min(1., max(0., _num(feed.get('amount', 0.)))), 'through': through}
    change = raw.get('change', 'jump'); assert change in CHANGES
    out = {}
    if fx: out['fx'] = dict(sorted(fx.items()))
    if sends: out['sends'] = dict(sorted(sends.items()))
    if out and change != 'jump': out['change'] = change
    return out or None


def validate(raw, buses=send_buses.MAX_BUSES):
    """A track's clip FX ({'0'..'7': changes}), cleaned; empty clips are left out."""
    try:
        assert isinstance(raw, dict)
        out = {}
        for k, entry in raw.items():
            assert isinstance(k, str) and k.isdigit() and 0 <= int(k) < CLIPS
            clean = validate_entry(entry, buses)
            if clean: out[str(int(k))] = clean
        return dict(sorted(out.items()))
    except (AssertionError, AttributeError, TypeError, ValueError) as exc:
        raise ValueError('Invalid clip FX') from exc


def chain_for(chain, entry):
    """The track's chain while a clip with these changes plays (a new chain; the Base is left as it is)."""
    holds = (entry or {}).get('fx')
    if not holds or chain is None: return chain
    out = dict(chain); mods = []
    for m in chain['modules']:
        h = holds.get(m['id'])
        if h:
            m = dict(m)
            if 'on' in h:
                if h['on'] and not m['on']: m['on'] = True; m['bypass'] = False
                else: m['bypass'] = not h['on']
            if 'params' in h: m['params'] = {**m['params'], **h['params']}
        mods.append(m)
    out['modules'] = mods
    return out


def sends_for(sends, entry):
    """The track's sends while a clip with these changes plays."""
    over = (entry or {}).get('sends')
    if not over: return sends
    out = dict(sends or {}); out.update(over)
    return send_buses.validate_track(out)


def remap_bus(clip_fx, removed):
    """A track's clip FX after bus `removed` is taken out (the later buses move up one)."""
    out = {}
    for k, entry in (clip_fx or {}).items():
        entry = dict(entry)
        if 'sends' in entry:
            entry['sends'] = send_buses.remap_track(entry['sends'], removed)
            if not entry['sends']: entry.pop('sends')
        if entry: out[k] = entry
    return out


def copy_clip(clip_fx, source, target):
    """Clip FX after copying clip `source` into `target` (its changes go with its notes)."""
    out = dict(clip_fx or {})
    if str(source) in out: out[str(target)] = copy.deepcopy(out[str(source)])
    else: out.pop(str(target), None)
    return out
