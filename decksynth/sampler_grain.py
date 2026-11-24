"""Grain mode of the Sampler (24 Nov): every held key plays a cloud of short overlapping grains.

The C kernel is sampler_grain_mix in native/sampler_voice.c; mix_grains_python below is the same
arithmetic in the same order (used when the native library is missing, and to check the kernel).

Spec keys (all optional; older projects get the defaults):
  g_pos       0..1 read point inside the voice's region (the trimmed sample, or its slice)
  g_size      seconds per grain, 0.01..1
  g_density   new grains a second, 1..80
  g_spray     0..1 random spread of grain starts around the read point (1 = the whole region)
  g_scan      -2..2: the read point travels through the region at this speed (1 = playing speed)
  g_spread    0..12 semitones of random transposition per grain
  g_scale     which steps Spread may land on
  g_reverse   0..1 chance that a grain plays backwards
  g_jitter    0..1 uneven gaps between grains (the average rate stays Density)
  g_size_rnd  0..1 each grain's own length, 1/4 to 2x Size at 1
  g_amp_rnd   0..1 each grain's own level
  g_window    the fade of each grain
Roam (G3): the read point travels by itself while a key is held, inside the bracket g_pos .. g_pos + g_range
  g_roam      off / forward / reverse / bounce
  g_range     0.02..1 how much of the region it travels (wraps past the end)
  g_speed     0.02..4 travel speed, 1 = playing speed (g_sync 'free')
  g_sync      free, or bars for one pass of the bracket at the song's BPM
  g_wander    0..1 random drift on top of the travel
  g_smooth    0..1 makes the drift slow and heavy
Rhythm (G4): with Chop slices, the read point steps from slice to slice in time (Roam stops while it does)
  g_rhythm    off / skip / hold / gate / flow / random / pingpong
  g_div       step length, '1/4' .. '1/32', triplets '1/8t' '1/16t'
  g_swing     0..0.75 every second step comes late
  g_prob      0..1 chance that a step moves
  g_var       which of the four patterns A-D plays
  g_off       four lists (A-D) of slices that are off      g_flip  four lists of slices whose grains play backwards
Motion (G3, on top of Roam; with Roam off the point only jumps and drifts): g_jump, g_hold, g_rev (random jumps, short freezes, backwards stretches),
  g_chaos (uneven timing: calm spells and bursts), g_pulse (the speed swells like breathing)
Harmony (24 Nov): you say which notes the sample holds, and Spread then only uses shifts that keep all of them
inside the sample's key (major or minor on its root). No pitch detection, just this rule. It replaces g_scale while on.
  g_harm      off / root / fifth / triad / scale / own (own = the notes in g_notes)
  g_kmode     major / minor
  g_notes     semitones above the root that the sample holds (0..11), for 'own'
"""
import ctypes as C
import math

GRAIN_POOL = 256
WINDOW = 1024
WINDOWS = ('hann', 'tri', 'welch', 'perc', 'rect')
HARMS = ('off', 'root', 'fifth', 'triad', 'scale', 'own')
KMODES = ('major', 'minor')
SCALES = ('chromatic', 'major', 'minor', 'penta', 'octaves', 'fifths')
ROAMS = ('off', 'forward', 'reverse', 'bounce')
SYNCS = ('free', '1/4', '1/2', '1', '2', '4', '8', '16')
RHYTHMS = ('off', 'skip', 'hold', 'gate', 'flow', 'random', 'pingpong')
DIVS = ('1/4', '1/8', '1/16', '1/32', '1/8t', '1/16t')
DIV_BEATS = {'1/4': 1., '1/8': .5, '1/16': .25, '1/32': .125, '1/8t': 1./3., '1/16t': 1./6.}
VARIATIONS = ('A', 'B', 'C', 'D')
MASKS = ('g_off', 'g_flip')
SCALE_STEPS = dict(chromatic=tuple(range(12)), major=(0, 2, 4, 5, 7, 9, 11), minor=(0, 2, 3, 5, 7, 8, 10),
                   penta=(0, 3, 5, 7, 10), octaves=(0,), fifths=(0, 7))
DEFAULTS = dict(g_pos=.3, g_size=.12, g_density=14., g_spray=.08, g_scan=0., g_spread=0., g_scale='chromatic',
                g_reverse=0., g_jitter=0., g_size_rnd=0., g_amp_rnd=0., g_window='hann',
                g_roam='off', g_range=.4, g_speed=.25, g_sync='free', g_wander=0., g_smooth=.5,
                g_jump=0., g_hold=0., g_rev=0., g_chaos=0., g_pulse=0.,
                g_rhythm='off', g_div='1/8', g_swing=0., g_prob=1., g_var='A', g_off=((), (), (), ()), g_flip=((), (), (), ()),
                g_harm='off', g_kmode='major', g_notes=(0, 4, 7))
RANGES = dict(g_pos=(0., 1.), g_size=(.01, 1.), g_density=(1., 80.), g_spray=(0., 1.), g_scan=(-2., 2.),
              g_spread=(0., 12.), g_reverse=(0., 1.), g_jitter=(0., 1.), g_size_rnd=(0., 1.), g_amp_rnd=(0., 1.),
              g_range=(.02, 1.), g_speed=(.02, 4.), g_wander=(0., 1.), g_smooth=(0., 1.),
              g_jump=(0., 1.), g_hold=(0., 1.), g_rev=(0., 1.), g_chaos=(0., 1.), g_pulse=(0., 1.),
              g_swing=(0., .75), g_prob=(0., 1.))
CHOICES = dict(g_scale=SCALES, g_window=WINDOWS, g_roam=ROAMS, g_sync=SYNCS, g_rhythm=RHYTHMS, g_div=DIVS, g_var=VARIATIONS, g_harm=HARMS, g_kmode=KMODES)
KEYS = tuple(DEFAULTS)


class Grain(C.Structure):
    _fields_ = [('pos', C.c_double), ('step', C.c_double), ('amp', C.c_double), ('wpos', C.c_double), ('winc', C.c_double),
                ('left', C.c_int64), ('delay', C.c_int64),
                ('active', C.c_int32), ('voice', C.c_int32), ('pad0', C.c_int32), ('pad1', C.c_int32)]


class Cloud(C.Structure):
    _fields_ = [('next', C.c_double), ('offset', C.c_double), ('rng', C.c_uint32), ('flags', C.c_uint32)]


class GrainParams(C.Structure):
    _fields_ = [('window', C.c_void_p), ('position', C.c_double), ('size', C.c_double), ('interval', C.c_double),
                ('spray', C.c_double), ('scan', C.c_double), ('jitter', C.c_double), ('size_rnd', C.c_double),
                ('amp_rnd', C.c_double), ('reverse', C.c_double), ('level', C.c_double), ('ratio', C.c_double * 25),
                ('spread', C.c_int32), ('grains', C.c_int32)]


def _window(kind):
    """WINDOW + 1 points of one grain fade (the shapes of Sir's Grain Field, Chordz mockup)."""
    out = (C.c_double * (WINDOW + 1))()
    for i in range(WINDOW + 1):
        x = i / WINDOW
        if kind == 'tri': y = 1 - abs(2*x - 1)
        elif kind == 'welch': y = 1 - (2*x - 1)**2
        elif kind == 'perc': y = x/.04 if x < .04 else math.exp(-(x - .04)*5)*(1 - x)**.5
        elif kind == 'rect': y = x/.02 if x < .02 else (1 - x)/.02 if x > .98 else 1.
        else: y = math.sin(math.pi*x)**2
        out[i] = y
    return out


TABLES = {kind: _window(kind) for kind in WINDOWS}


def harmony(spec):
    """The shifts (0..11 above, octaves added later) that keep every note the sample holds inside its key.
    None while Harmony is off. Always holds 0, so unshifted grains stay where the key put them."""
    held = spec.get('g_harm', 'off')
    if held == 'off': return None
    minor = spec.get('g_kmode', 'major') == 'minor'
    key = set(SCALE_STEPS['minor' if minor else 'major'])
    notes = dict(root=(0,), fifth=(0, 7), triad=(0, 3, 7) if minor else (0, 4, 7), scale=tuple(key)).get(held)
    if notes is None: notes = tuple(spec.get('g_notes') or (0,))
    return tuple(s for s in range(12) if s == 0 or all((n + s) % 12 in key for n in notes))   # 0: the sample as it is


def valid_notes(value):
    """The notes a sample holds for Harmony 'own': semitones above its root, sorted, at least one."""
    if not isinstance(value, (list, tuple)) or not 1 <= len(value) <= 12 or any(type(n) is not int or not 0 <= n < 12 for n in value):
        raise ValueError('Invalid Harmony notes')
    return sorted(set(value))


def snap(semitones, scale):
    """The nearest allowed step for a spread of `semitones` (ties go down, toward the played note).
    `scale` is a name from SCALES or a tuple of steps (Harmony)."""
    steps = SCALE_STEPS[scale] if isinstance(scale, str) else scale
    octave, rest = divmod(semitones, 12)
    best = min(list(steps) + [12], key=lambda d: (abs(rest - d), d))
    return octave*12 + best


def fill(g, spec, value, rate, voices):
    """Grain parameters for this block. `value(key)` is the knob plus its macro / mod pad offset."""
    size = value('g_size'); density = value('g_density')
    g.window = C.addressof(TABLES[spec.get('g_window', 'hann')])
    g.position = value('g_pos'); g.size = size*rate; g.interval = rate/density
    g.spray = value('g_spray'); g.scan = value('g_scan'); g.jitter = value('g_jitter')
    g.size_rnd = value('g_size_rnd'); g.amp_rnd = value('g_amp_rnd'); g.reverse = value('g_reverse')
    g.level = 1./math.sqrt(max(1., density*size))   # overlapping grains add up: keep the cloud near one voice's level
    spread = int(round(value('g_spread'))); scale = harmony(spec) or spec.get('g_scale', 'chromatic')
    if spread != g.spread or getattr(fill, '_scale', None) != (id(g), scale):
        for k in range(-12, 13): g.ratio[k + 12] = 2.**(snap(k, scale)/12.)
        fill._scale = (id(g), scale)
    g.spread = spread; g.grains = GRAIN_POOL


def reset_cloud(cloud, seed):
    cloud.next = 0.; cloud.offset = 0.; cloud.flags = 0
    cloud.rng = (seed*2654435761 + 12345) & 0xffffffff or 1


def _rnd(c):
    x = c.rng
    x ^= (x << 13) & 0xffffffff; x ^= x >> 17; x ^= (x << 5) & 0xffffffff
    c.rng = x
    return (x >> 8)*(1./16777216.)


def _spawn(v, c, g, grains, slot, at):
    u1 = _rnd(c); u2 = _rnd(c); u3 = _rnd(c); u4 = _rnd(c); u5 = _rnd(c); u6 = _rnd(c)
    zone = float(v.end - v.start)
    o = g.position*zone + c.offset
    while o >= zone: o -= zone
    while o < 0.: o += zone
    centre = float(v.start) + o + g.spray*(2.*u1 - 1.)*.5*zone
    length = g.size*(1. + g.size_rnd*(1.75*u2 - .75))
    if length < 16.: length = 16.
    frames = int(length)
    k = 0
    if g.spread > 0:
        k = int(u3*float(2*g.spread + 1)) - g.spread
        if k > g.spread: k = g.spread
    step = v.step*v.pmul*g.ratio[k + 12]
    if (u4 < g.reverse) != bool(c.flags & 1): step = -step
    gap = g.interval*(1. + g.jitter*(2.*u6 - 1.))
    if gap < 1.: gap = 1.
    if c.flags & 2: return gap
    for gr in grains[:g.grains]:
        if gr.active: continue
        gr.pos = centre - .5*float(frames)*step; gr.step = step
        gr.amp = g.level*(1. - g.amp_rnd*u5)
        gr.wpos = 0.; gr.winc = float(WINDOW)/float(frames)
        gr.left = frames; gr.delay = at; gr.voice = slot; gr.active = 1
        break
    return gap


def mix_grains_python(voices, clouds, p, g, grains, data, out, frames):
    """sampler_grain_mix, line for line."""
    from .sampler import _interp
    window = TABLES_BY_ADDRESS[g.window]
    for slot, v in enumerate(voices):
        if not v.active: continue
        c = clouds[slot]
        zone = float(v.end - v.start)
        if zone < 2.: v.active = 0; continue
        t = c.next
        while t < float(frames): t += _spawn(v, c, g, grains, slot, int(t))
        c.next = t - float(frames)
        offset = c.offset + g.scan*float(frames)
        while offset >= zone: offset -= zone
        while offset < 0.: offset += zone
        c.offset = offset
        buf = [0.]*frames
        for gr in grains[:g.grains]:
            if not gr.active or gr.voice != slot: continue
            pos, wpos, left = gr.pos, gr.wpos, gr.left
            f = gr.delay
            while f < frames and left > 0:
                w = int(wpos); frac = wpos - w
                shape = window[w] + (window[w + 1] - window[w])*frac
                buf[f] += _interp(data, p, v, pos)*shape*gr.amp
                pos += gr.step; wpos += gr.winc; left -= 1; f += 1
            gr.pos, gr.wpos, gr.left, gr.delay = pos, wpos, left, 0
            if left <= 0: gr.active = 0
        for f in range(frames):
            value = buf[f]
            if p.filter > 0:
                v3 = value - v.ic2
                v1 = v.a1*v.ic1 + v.a2*v3
                v2 = v.ic2 + v.a2*v.ic1 + v.a3*v3
                v.ic1 = 2.*v1 - v.ic1
                v.ic2 = 2.*v2 - v.ic2
                value = v2 if p.filter == 1 else v1 if p.filter == 2 else value - v.k*v1 - v2
            if v.stage == 0:
                v.env += p.attack
                if v.env >= 1.: v.env = 1.; v.stage = 1
            elif v.stage == 1:
                v.env -= p.decay
                if v.env <= p.sustain: v.env = p.sustain; v.stage = 2
            elif v.stage == 3:
                v.env -= v.rel
                if v.env <= 0.: v.env = 0.; v.active = 0
            value *= v.env*v.gain
            if v.fade_left >= 0:
                value *= float(v.fade_left)/float(v.fade_len)
                v.fade_left -= 1
                if v.fade_left < 0: v.active = 0
            out[f] += value
            if v.glide != 0.:
                v.step += v.glide
                if (v.glide > 0. and v.step >= v.target) or (v.glide < 0. and v.step <= v.target):
                    v.step = v.target; v.glide = 0.
            v.age += 1
            if not v.active: break
        v.pos = float(v.start) + c.offset
        if not v.active:
            for gr in grains[:g.grains]:
                if gr.voice == slot: gr.active = 0


TABLES_BY_ADDRESS = {C.addressof(t): t for t in TABLES.values()}


def valid_masks(value, slices=64):
    """Four lists (patterns A-D) of slice numbers, each sorted and without repeats."""
    if not isinstance(value, (list, tuple)) or len(value) != 4: raise ValueError('Invalid Rhythm pattern')
    out = []
    for part in value:
        if not isinstance(part, (list, tuple)) or len(part) > 64 or any(type(i) is not int or not 0 <= i < slices for i in part):
            raise ValueError('Invalid Rhythm pattern')
        out.append(sorted(set(part)))
    return out


def stepping(spec):
    """Whether Rhythm steps this cloud through the Chop slices."""
    return spec.get('g_rhythm', 'off') != 'off' and bool(spec.get('slices'))


class Stepper:
    """Rhythm for one cloud: on each step it picks a slice; between steps grains come from Position inside that slice.
    Steps count from the key going down, at the song's tempo."""
    __slots__ = ('rng', 'k', 'index', 'gated', 'flow', 'order')

    def __init__(self, seed):
        import random
        self.rng = random.Random(seed); self.k = -1; self.index = 0; self.gated = False; self.flow = 0.; self.order = 0

    def step(self, spec, value, rate, bpm, age, frames, total, beat=None):
        """Returns (absolute read frame, flags) for the coming block. `beat`: the song position while it plays (the steps then
        sit on the song's grid); otherwise steps count from the key going down."""
        slices = spec['slices']; n = len(slices); var = VARIATIONS.index(spec.get('g_var', 'A'))
        off = set(spec['g_off'][var]); flip = set(spec['g_flip'][var]); on = [i for i in range(n) if i not in off]
        length = max(16., DIV_BEATS[spec.get('g_div', '1/8')]*60./max(1., bpm)*rate)
        if beat is not None: age = beat*60./max(1., bpm)*rate
        late = (2./3.)*value('g_swing')*length; pair = int(age // (2.*length)); inside = age - pair*2.*length
        k = 2*pair + (1 if inside >= length + late else 0)
        mode = spec['g_rhythm']
        if k != self.k:
            first = self.k < 0; self.k = k; self.flow = 0.
            if first or self.rng.random() < value('g_prob'):
                at = k % n; self.gated = False
                if mode == 'random': self.index = self.rng.choice(on) if on else at; self.gated = not on
                elif mode == 'pingpong':
                    if on:
                        span = max(1, 2*(len(on) - 1)); p = self.order % span if len(on) > 1 else 0
                        self.index = on[p if p < len(on) else span - p]; self.order += 1
                    else: self.gated = True
                elif at in on or mode == 'gate': self.index = at; self.gated = at not in on
                elif mode == 'hold': pass                                    # stay on the last slice that was on
                else:                                                          # skip, flow: the next slice that is on
                    nxt = [i for i in on if i > at] or on
                    if nxt: self.index = nxt[0]
                    else: self.gated = True
        a, b = slices[self.index][0]*total, slices[self.index][1]*total
        width = max(1., b - a)
        inner = value('g_pos')*width
        if mode == 'flow': inner = (inner + self.flow) % width; self.flow += frames
        flags = (1 if self.index in flip else 0) | (2 if self.gated else 0)
        return a + inner, flags


def roaming(spec):
    """Whether Roam or Motion moves this cloud's read point (else it stays at Position, plus Scan)."""
    return spec.get('g_roam', 'off') != 'off' or spec.get('g_jump', 0.) > 0. or spec.get('g_wander', 0.) > 0.


class Roamer:
    """Roam and Motion for one cloud, at block rate. The same code drives the C kernel and the Python mirror:
    it only writes the cloud's offset (where Position has moved to) before each block."""
    __slots__ = ('rng', 'u', 'dir', 'drift', 'hold', 'rev', 'wait', 'phase', 'period', 'shift')

    def __init__(self, seed, mode):
        import random
        self.rng = random.Random(seed)
        self.u = .999999 if mode == 'reverse' else 0.   # 0..1 through the bracket
        self.dir = -1. if mode == 'reverse' else 1.
        self.drift = 0.; self.hold = 0; self.rev = 0; self.shift = 0.   # shift: where Jump moved a transport-locked pass
        self.wait = -1.                                   # frames to the next Motion event (-1: not drawn yet)
        self.phase = self.rng.random(); self.period = 1.3 + 7.7*self.rng.random()   # Pulse: one swell every 1.3..9 s

    def step(self, spec, value, rate, bpm, frames, zone, beat=None):
        """Advance by `frames`; returns the offset from Position in frames. `beat`: the song position while it plays,
        then a bar-synced Roam sits on the bar grid (Jump shifts it; Hold and Rev wait for free speed)."""
        r = self.rng; mode = spec.get('g_roam', 'off'); span = value('g_range')
        sync = spec.get('g_sync', 'free')
        if mode == 'off': speed = 0.                                             # Motion and Wander only
        elif sync == 'free': speed = value('g_speed')/max(1., span*zone)         # bracket per frame
        else:
            bars = {'1/4': .25, '1/2': .5}.get(sync) or float(sync)
            speed = 1./max(1., bars*4.*60./max(1., bpm)*rate)
        pulse = value('g_pulse')
        if pulse > 0.:
            self.phase = (self.phase + frames/(self.period*rate)) % 1.
            speed *= 1. + pulse*math.sin(2.*math.pi*self.phase)
        # Motion: jumps, holds and backwards stretches at random moments
        jump, hold, rev = value('g_jump'), value('g_hold'), value('g_rev'); busy = jump + hold + rev
        if busy > 0.:
            chaos = value('g_chaos'); mean = 3.*rate/max(.05, busy)
            if self.wait < 0.: self.wait = mean*(.25 + .75*r.random())
            self.wait -= frames
            if self.wait <= 0.:
                pick = r.random()*busy
                if pick < jump: self.u = r.random(); self.shift = r.random()
                elif pick < jump + hold: self.hold = int((.06 + .5*r.random())*rate*(.4 + hold))
                else: self.rev = int((.15 + .8*r.random())*rate*(.4 + rev))
                gap = (1. - chaos) + chaos*-math.log(max(1e-6, 1. - r.random()))   # chaos: exponential gaps, bursts and calm
                self.wait = mean*max(.05, gap)
        else: self.wait = -1.; self.hold = 0; self.rev = 0
        # Wander: a random drift, made slow and heavy by Smooth
        wander = value('g_wander')
        if wander > 0.:
            a = 1. - .985*value('g_smooth')
            self.drift += a*((2.*r.random() - 1.) - self.drift)
        else: self.drift = 0.
        sync_bars = None if sync == 'free' or mode == 'off' else ({'1/4': .25, '1/2': .5}.get(sync) or float(sync))
        if beat is not None and sync_bars is not None:
            self.hold = 0; self.rev = 0
            turns = beat/(sync_bars*4.)
            if mode == 'bounce':
                p = (turns + self.shift) % 2.; u = p if p <= 1. else 2. - p
            else:
                u = (turns + self.shift) % 1.
                if mode == 'reverse': u = 1. - u
            u = min(.999999, max(0., u + wander*self.drift*.1))
            self.u = u
            return u*span*zone
        if self.hold > 0: self.hold -= frames; return self.u*span*zone
        direction = self.dir*(-1. if self.rev > 0 else 1.)
        if self.rev > 0: self.rev -= frames
        u = self.u + direction*speed*frames + wander*self.drift*.6*frames/rate
        if mode == 'bounce':
            if u > 1.: u = 2. - u; self.dir = -self.dir
            if u < 0.: u = -u; self.dir = -self.dir
            u = min(1., max(0., u))
        else: u %= 1.
        self.u = u
        return u*span*zone


class LiveBuffer:
    """Live input for Grain mode: the last SECONDS of the input, kept in one straight run of memory so grains never
    read across a seam. The buffer is twice that long; when the write point reaches the end, the newest half moves
    to the front (`feed` returns how far, and the Sampler moves its sounding grains back by the same amount)."""
    SECONDS = 8.

    def __init__(self, rate, seconds=SECONDS):
        from array import array
        self.span = int(seconds*rate); self.rate = rate
        self.data = array('f', bytes(4*2*self.span)); self.write = self.span; self.frozen = False
        self.level = 0.; self._peaks = None

    def feed(self, block):
        if self.frozen or not len(block): return 0
        from array import array
        block = block if isinstance(block, array) and block.typecode == 'f' else array('f', block)
        if len(block) > self.span: block = block[-self.span:]
        peak = max(max(block), -min(block)); self.level = max(peak, self.level*.5**(len(block)/(self.rate*.25)))
        moved = 0
        if self.write + len(block) > len(self.data):
            moved = self.write - self.span
            self.data[0:self.span] = self.data[moved:self.write]; self.write = self.span
        self.data[self.write:self.write + len(block)] = block; self.write += len(block); self._peaks = None
        return moved

    def window(self):
        """(first frame, frames) of the last SECONDS."""
        return self.write - self.span, self.span

    def peaks(self, bars=256):
        """[low, high] per bar across the window, for the waveform (oldest left, newest right)."""
        if self._peaks is None:
            a, n = self.window(); d = self.data; out = []
            for i in range(bars):
                part = d[a + i*n//bars:a + (i + 1)*n//bars]
                out.append([round(min(part), 4), round(max(part), 4)] if len(part) else [0., 0.])
            self._peaks = out
        return self._peaks
