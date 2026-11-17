"""Sends: one shared Reverb and one shared Delay that every track can feed with a Send knob.

Each track's send is taken after its volume and pan (post-fader), so turning a track down turns its echo
and reverb down with it. The two returns are summed into the mix before the master limiter. The buses
use the same native Delay and Reverb as the track FX, run fully wet: the dry signal the native modules
always pass through is taken back out, so only the echo and the room come back.
"""
import math

from .fx import ORDER, PARAMS, TrackFx, default_module

BUSES = ('reverb', 'delay')
# The shared settings shown on the Sound page (the module's own Mix becomes the bus's Return level).
SETTINGS = {
    'reverb': [(k, lo, hi, init) for k, lo, hi, init in PARAMS['reverb'] if k != 'mix'],
    'delay': [(k, lo, hi, init) for k, lo, hi, init in PARAMS['delay'] if k != 'mix'],
}
RETURN_DEFAULT = .8
# How long a bus keeps running after the last send is turned down, so the tail rings out (seconds).
TAIL_SECONDS = {'reverb': 8., 'delay': 6.}


def defaults():
    return {bus: dict(params={k: init for k, _, _, init in SETTINGS[bus]}, level=RETURN_DEFAULT) for bus in BUSES}


def validate(raw):
    """A clean copy of the project's shared send settings, or ValueError."""
    try:
        assert isinstance(raw, dict)
        out = defaults()
        for bus in BUSES:
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


def validate_track(raw):
    """One track's send amounts {'reverb': 0..1, 'delay': 0..1}."""
    try:
        assert isinstance(raw, dict) and set(raw) <= set(BUSES)
        out = {}
        for bus, v in raw.items():
            assert type(v) in (int, float) and math.isfinite(v)
            out[bus] = min(1., max(0., float(v)))
        return out
    except (AssertionError, TypeError) as exc:
        raise ValueError('Invalid track sends') from exc


def track_amounts(track):
    s = track.get('sends') or {}
    return [float(s.get(bus, 0.)) for bus in BUSES]


class SendBuses:
    """The two shared return buses. feed() collects the tracks' sends for a block, mix_into() adds the returns."""
    def __init__(self, rate):
        self.rate = rate
        self.fx = {bus: TrackFx(rate) for bus in BUSES}
        self.level = {bus: RETURN_DEFAULT for bus in BUSES}
        self.tail = {bus: 0 for bus in BUSES}
        self.configure(defaults())

    @property
    def available(self):
        return all(fx.handle for fx in self.fx.values())

    def configure(self, sends):
        sends = sends or defaults()
        for bus in BUSES:
            mods = []
            for m in ORDER:
                mod = default_module(m)
                if m == bus:
                    mod['on'] = True
                    mod['params'].update(sends[bus]['params'])
                    mod['params']['mix'] = 1.
                mods.append(mod)
            fx = self.fx[bus]
            if not fx.right and bus == 'delay': mods[ORDER.index('delay')]['params']['width'] = 0.
            if not fx.right and bus == 'reverb': mods[ORDER.index('reverb')]['params']['width'] = 0.
            fx.configure(dict(modules=mods))
            self.level[bus] = sends[bus]['level']

    def start_block(self, n, stereo):
        """Empty send inputs for a block of n frames: [left, right] per bus (right None when mono)."""
        self._n = n; self._stereo = stereo
        self._in = {bus: ([0.] * n, [0.] * n if stereo else None) for bus in BUSES}
        self._fed = {bus: False for bus in BUSES}
        return self._in

    def mark_fed(self, bus):
        self._fed[bus] = True

    def mix_into(self, mix, right, bpm, beat):
        """Run each bus that was fed (or is still ringing out) and add its wet return to the mix."""
        n = self._n
        for bus in BUSES:
            fx = self.fx[bus]
            if not fx.handle: continue
            if self._fed[bus]: self.tail[bus] = int(TAIL_SECONDS[bus] * self.rate)
            elif self.tail[bus] <= 0: continue
            else: self.tail[bus] -= n
            left, rin = self._in[bus]
            dry = .5 if bus == 'reverb' else 1.  # what the native module passes through at Mix 1
            g = self.level[bus]
            if self._stereo:
                out_l, out_r = fx.process_stereo(list(left), bpm, beat, modulated=True, right=list(rin))
                for j in range(n):
                    mix[j] += (out_l[j] - dry * left[j]) * g
                    right[j] += (out_r[j] - dry * rin[j]) * g
            else:
                out = fx.process(list(left), bpm, beat, modulated=True)
                for j in range(n): mix[j] += (out[j] - dry * left[j]) * g

    def start_block_c(self, n):
        """Like start_block, for the C mix bus (cbus.py): fixed left/right buffers per bus, zeroed."""
        from . import cbus
        if not hasattr(self, '_cin'):
            self._cin = {bus: ((cbus.D * cbus.BLOCK)(), (cbus.D * cbus.BLOCK)()) for bus in BUSES}
            self._cwork = ((cbus.D * cbus.BLOCK)(), (cbus.D * cbus.BLOCK)())
        self._n = n; self._stereo = True
        for left, rin in self._cin.values():
            cbus.zero(left, 0, n); cbus.zero(rin, 0, n)
        self._fed = {bus: False for bus in BUSES}
        return self._cin

    def mix_into_c(self, bufs, bpm, beat):
        """mix_into for the C mix bus: each bus runs on a copy of its input, and its wet return goes into bufs.mix."""
        from . import cbus
        n = self._n; c = cbus.lib(); wl, wr = self._cwork
        for bus in BUSES:
            fx = self.fx[bus]
            if not fx.handle: continue
            if self._fed[bus]: self.tail[bus] = int(TAIL_SECONDS[bus] * self.rate)
            elif self.tail[bus] <= 0: continue
            else: self.tail[bus] -= n
            left, rin = self._cin[bus]
            cbus.copy(wl, left, n); cbus.copy(wr, rin, n)
            fx.process_buffers(bufs, wl, wr, n, True, bpm, beat, modulated=True)
            dry = .5 if bus == 'reverb' else 1.
            c.dsfx_add_return(cbus.addr(bufs.mix), cbus.addr(bufs.mix_r), cbus.addr(wl), cbus.addr(wr),
                              cbus.addr(left), cbus.addr(rin), n, dry, self.level[bus])

    def reset(self):
        for bus in BUSES:
            fx = self.fx[bus]; self.tail[bus] = 0
            if fx.handle:
                fx.lib.dsfx_reset(fx.handle)
                if fx.right: fx.lib.dsfx_reset(fx.right)
