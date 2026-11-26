"""FX buses: up to four shared FX chains (A to D) that every track can feed.

A bus is an ordinary FX chain with a name, a colour, a Return level and a Mute. Each track feeds a bus by an
amount, taken after the track's volume and pan (post-fader), in one of two ways:
  Send     the track still plays in the mix, and the bus adds its effect on top (a shared reverb or delay);
  Through  the track goes only through the bus and not straight to the mix (a drum group with one compressor).
The buses' returns are summed into the mix before the master stage. A bus never feeds another bus.

Inside a bus every effect's Mix runs from dry (0) to all wet (1), so a Reverb at Mix 1 returns only the room
(dsfx_bus_mode in dsfx.c). A bus runs once per block while something feeds it, and for its effects' tail
after that (8 s for a reverb, 6 s for a delay), then sleeps.

Projects from before buses had one shared Reverb and one shared Delay ('sends' with their settings, and
per track {'reverb': amount, 'delay': amount}); they load as Bus A with a Reverb and Bus B with a Delay, at
the same settings and Return level, so they sound the same.
"""
import copy
import math

from .fx import PARAMS, TrackFx, default_chain, validate_chain
from .fx import available as fx_available

MAX_BUSES = 4
LEGACY = ('reverb', 'delay')  # the old send names; they still address Bus A and Bus B
# The old shared settings (everything of the module but its Mix, which the bus ran at 1).
SETTINGS = {
    'reverb': [(k, lo, hi, init) for k, lo, hi, init in PARAMS['reverb'] if k != 'mix'],
    'delay': [(k, lo, hi, init) for k, lo, hi, init in PARAMS['delay'] if k != 'mix'],
}
RETURN_DEFAULT = .8
NAME_MAX = 24
# How long a bus keeps running after the last feed stops, so its effects ring out (seconds, per effect).
TAIL_SECONDS = {'reverb': 8., 'delay': 6., 'cloud': 6., 'resonator': 8., 'smear': 4.}
TAIL_OTHER = 1.


def _legacy_defaults():
    return {bus: dict(params={k: init for k, _, _, init in SETTINGS[bus]}, level=RETURN_DEFAULT) for bus in LEGACY}


def validate_legacy(raw):
    """A clean copy of an old project's shared send settings ({'reverb': {params, level}, 'delay': ...})."""
    try:
        assert isinstance(raw, dict)
        out = _legacy_defaults()
        for bus in LEGACY:
            if bus not in raw: continue
            src = raw[bus]; assert isinstance(src, dict)
            for key, lo, hi, init in SETTINGS[bus]:
                v = src.get('params', {}).get(key, init)
                assert type(v) in (int, float) and math.isfinite(v)
                out[bus]['params'][key] = min(hi, max(lo, float(v)))
            if bus == 'delay': out[bus]['params']['time'] = float(round(out[bus]['params']['time']))
            level = src.get('level', RETURN_DEFAULT)
            assert type(level) in (int, float) and math.isfinite(level)
            out[bus]['level'] = min(1., max(0., float(level)))
        return out
    except (AssertionError, AttributeError, TypeError) as exc:
        raise ValueError('Invalid sends') from exc


def _single_chain(module, params):
    """An FX chain with one effect on, at Mix 1 (all wet in a bus)."""
    chain = default_chain()
    for m in chain['modules']:
        if m['id'] == module:
            m['on'] = True; m['params'].update(params); m['params']['mix'] = 1.
    return validate_chain(chain)


def new_bus(index, name=None, chain=None):
    return {'name': name or 'Bus ' + 'ABCD'[index], 'colour': index, 'chain': chain or validate_chain(default_chain()),
            'return': RETURN_DEFAULT, 'mute': False}


def migrate(legacy):
    """Old shared sends -> [Bus A (Reverb), Bus B (Delay)] at the same settings and Return level."""
    legacy = validate_legacy(legacy)
    out = []
    for i, kind in enumerate(LEGACY):
        bus = new_bus(i, kind.capitalize(), _single_chain(kind, legacy[kind]['params']))
        bus['return'] = legacy[kind]['level']
        out.append(bus)
    return out


_DEFAULTS = None


def defaults():
    """A new project's buses: Bus A with a Reverb and Bus B with a Delay (today's shared sends)."""
    global _DEFAULTS
    if _DEFAULTS is None: _DEFAULTS = migrate({})
    return copy.deepcopy(_DEFAULTS)


def is_default(buses):
    if _DEFAULTS is None: defaults()
    return buses == _DEFAULTS


def validate(raw):
    """A clean copy of a project's buses (a list of at most MAX_BUSES), or ValueError."""
    try:
        assert isinstance(raw, list) and len(raw) <= MAX_BUSES
        out = []
        for i, b in enumerate(raw):
            assert isinstance(b, dict)
            name = b.get('name', 'Bus ' + 'ABCD'[i]); assert isinstance(name, str)
            name = ' '.join(name.split())[:NAME_MAX] or 'Bus ' + 'ABCD'[i]
            colour = b.get('colour', i); assert type(colour) is int and 0 <= colour < MAX_BUSES
            level = b.get('return', RETURN_DEFAULT); assert type(level) in (int, float) and math.isfinite(level)
            mute = b.get('mute', False); assert isinstance(mute, bool)
            out.append({'name': name, 'colour': colour, 'chain': validate_chain(b['chain']),
                        'return': min(1., max(0., float(level))), 'mute': mute})
        return out
    except (AssertionError, AttributeError, TypeError, KeyError, ValueError) as exc:
        raise ValueError('Invalid FX buses') from exc


def bus_index(bus, count=MAX_BUSES):
    """A bus by index (0..count-1, int or its string) or by an old send name ('reverb' = A, 'delay' = B)."""
    if bus in LEGACY: i = LEGACY.index(bus)
    elif type(bus) is int: i = bus
    elif isinstance(bus, str) and bus.isdigit(): i = int(bus)
    else: raise ValueError('Unknown send')
    if not 0 <= i < count: raise ValueError('Unknown send')
    return i


def validate_track(raw, count=MAX_BUSES):
    """One track's feeds {'0': {'amount': 0..1, 'through': bool}, ...}; old {'reverb': x, 'delay': y} is read
    as Bus A and Bus B. A feed at 0 that is not Through is left out. Feeds to buses past count are dropped."""
    try:
        assert isinstance(raw, dict)
        out = {}
        for bus, v in raw.items():
            i = bus_index(bus, MAX_BUSES)
            if isinstance(v, dict):
                amount = v.get('amount', 0.); through = v.get('through', False)
            else: amount, through = v, False
            assert type(amount) in (int, float) and math.isfinite(amount) and isinstance(through, bool)
            amount = min(1., max(0., float(amount)))
            if i < count and (amount > 0 or through): out[str(i)] = {'amount': amount, 'through': through}
        return dict(sorted(out.items()))
    except (AssertionError, TypeError, ValueError) as exc:
        raise ValueError('Invalid track sends') from exc


def track_feeds(track):
    """[(bus index, amount, through)] for one track, in bus order."""
    return [(int(k), v['amount'], v['through']) for k, v in (track.get('sends') or {}).items()]


def remap_track(sends, removed):
    """A track's feeds after bus `removed` is taken out (the later buses move up one)."""
    out = {}
    for k, v in (sends or {}).items():
        i = int(k)
        if i != removed: out[str(i - (i > removed))] = v
    return out


def tail_seconds(chain):
    on = [m for m in chain['modules'] if m['on'] and not m.get('bypass')]
    t = 0.
    for m in on:
        if m['id'] in ('space', 'shimmer'): t = max(t, m['params'].get('decay', 6.) + 1.)
        else: t = max(t, TAIL_SECONDS.get(m['id'], TAIL_OTHER))
    return t


# A library from before bus mode leaves each effect's dry sound in at Mix 1; the return then takes it back out
# (exact for the old single Reverb and Delay buses). Per effect: the dry gain at a given Mix.
_DRY = {'reverb': lambda m: 1 - m * .5, 'phaser': lambda m: 1 - m * .5, 'chorus': lambda m: 1 - m * .5,
        'resonator': lambda m: 1 - m * .5, 'delay': lambda m: 1., 'flanger': lambda m: 1.}


def _old_dry(chain):
    g = 1.; wet = False
    for m in chain['modules']:
        if m['on'] and not m.get('bypass') and m['id'] in _DRY:
            g *= _DRY[m['id']](m['params'].get('mix', 1.)); wet = True
    return g if wet else 0.


class SendBuses:
    """The project's FX buses. start_block() hands out empty inputs, the engine adds each track's feeds,
    mark_fed() notes who got sound, and mix_into() runs each bus that is fed or ringing out and adds it to the mix."""
    def __init__(self, rate):
        self.rate = rate
        self.fx = []; self.level = []; self.tail = []; self.tail_frames = []; self.dry = []; self.mute = []
        self.configure(defaults())

    @property
    def available(self):
        return fx_available()

    @property
    def count(self):
        return len(self.fx)

    def configure(self, buses):
        buses = defaults() if buses is None else buses
        while len(self.fx) < len(buses):
            fx = TrackFx(self.rate)
            if fx.handle and hasattr(fx.lib, 'dsfx_bus_mode'):
                fx.lib.dsfx_bus_mode(fx.handle, 1)
                if fx.right: fx.lib.dsfx_bus_mode(fx.right, 1)
            self.fx.append(fx); self.tail.append(0)
        del self.fx[len(buses):]; del self.tail[len(buses):]
        self.level = []; self.tail_frames = []; self.dry = []; self.mute = []
        for fx, bus in zip(self.fx, buses):
            chain = bus['chain']
            if not fx.right:  # no stereo FX in this library: the bus runs its effects in mono
                chain = copy.deepcopy(chain)
                for m in chain['modules']:
                    if m['id'] in ('chorus', 'delay', 'reverb'):
                        m['params']['width'] = 0.
                        if 'haas' in m['params']: m['params']['haas'] = 0.
                    if m['id'] == 'cloud': m['on'] = False
            fx.configure(chain)
            bus_mode = bool(fx.handle) and hasattr(fx.lib, 'dsfx_bus_mode')
            self.dry.append(0. if bus_mode else _old_dry(chain))
            self.level.append(bus['return']); self.mute.append(bus['mute'])
            self.tail_frames.append(max(1, int(tail_seconds(chain) * self.rate)))

    def start_block(self, n, stereo):
        """Empty bus inputs for a block of n frames: [left, right] per bus (right None when mono)."""
        self._n = n; self._stereo = stereo
        self._in = [([0.] * n, [0.] * n if stereo else None) for _ in self.fx]
        self._fed = [False] * len(self.fx)
        return self._in

    def mark_fed(self, bus):
        self._fed[bus] = True

    def _awake(self, i, n):
        """Is bus i fed this block, or still ringing out? Counts the tail down."""
        fx = self.fx[i]
        if not fx.handle: return False
        if self.mute[i]: self.tail[i] = 0; return False
        if self._fed[i]: self.tail[i] = self.tail_frames[i]
        elif self.tail[i] <= 0 and not fx._hold: return False
        else: self.tail[i] -= n
        return True

    def mix_into(self, mix, right, bpm, beat):
        """Run each bus that was fed (or is still ringing out) and add its return to the mix."""
        n = self._n
        for i, fx in enumerate(self.fx):
            if not self._awake(i, n): continue
            left, rin = self._in[i]
            dry = self.dry[i]; g = self.level[i]
            if self._stereo:
                out_l, out_r = fx.process_stereo(list(left), bpm, beat, modulated=True, right=list(rin))
                for j in range(n):
                    mix[j] += (out_l[j] - dry * left[j]) * g
                    right[j] += (out_r[j] - dry * rin[j]) * g
            else:
                out = fx.process(list(left), bpm, beat, modulated=True)
                for j in range(n): mix[j] += (out[j] - dry * left[j]) * g

    def start_block_c(self, n):
        """Like start_block, for the C mix bus (cbus.py): fixed left/right buffers per bus, zeroed.
        c_left / c_right hold the buffers' addresses and c_amount the feed amounts for dsfx_mix_track_n."""
        from . import cbus
        if not hasattr(self, '_cin'):  # made once: a buffer pair per possible bus, and their addresses
            import ctypes
            self._cin = [((cbus.D * cbus.BLOCK)(), (cbus.D * cbus.BLOCK)()) for _ in range(MAX_BUSES)]
            self._cwork = ((cbus.D * cbus.BLOCK)(), (cbus.D * cbus.BLOCK)())
            self.c_left = (ctypes.c_void_p * MAX_BUSES)(*[cbus.addr(l) for l, _ in self._cin])
            self.c_right = (ctypes.c_void_p * MAX_BUSES)(*[cbus.addr(r) for _, r in self._cin])
            self.c_amount = (ctypes.c_double * MAX_BUSES)()
        self._n = n; self._stereo = True
        for left, rin in self._cin[:len(self.fx)]:
            cbus.zero(left, 0, n); cbus.zero(rin, 0, n)
        self._fed = [False] * len(self.fx)
        return self._cin

    def mix_into_c(self, bufs, bpm, beat):
        """mix_into for the C mix bus: each bus runs on a copy of its input, and its return goes into bufs.mix."""
        from . import cbus
        n = self._n; c = cbus.lib(); wl, wr = self._cwork
        for i, fx in enumerate(self.fx):
            if not self._awake(i, n): continue
            left, rin = self._cin[i]
            cbus.copy(wl, left, n); cbus.copy(wr, rin, n)
            fx.process_buffers(bufs, wl, wr, n, True, bpm, beat, modulated=True)
            c.dsfx_add_return(cbus.addr(bufs.mix), cbus.addr(bufs.mix_r), cbus.addr(wl), cbus.addr(wr),
                              cbus.addr(left), cbus.addr(rin), n, self.dry[i], self.level[i])

    def reset(self):
        for i, fx in enumerate(self.fx):
            self.tail[i] = 0
            if fx.handle:
                fx.lib.dsfx_reset(fx.handle)
                if fx.right: fx.lib.dsfx_reset(fx.right)
