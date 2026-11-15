"""Recording into a Sampler (15 Nov): an input level, a threshold arm, and a take that goes into Chop.
The Recorder only sees mono float blocks, so the device (SDL capture or a test WAV) stays in backend.py.
Arm waits for the level to cross the threshold and keeps a short pre-roll, so the attack is never cut."""
from array import array
from collections import deque
import math

MAX_SECONDS = 600.
LENGTHS = (10, 20, 30, 60, 120, 300, 600)
THRESHOLD_RANGE = (-60., -6.)
STATES = ('idle', 'armed', 'recording', 'saving')


def db(value):
    return -90. if value <= 1e-9 else max(-90., 20. * math.log10(value))


def gain(decibels):
    return 10. ** (decibels / 20.)


class Recorder:
    def __init__(self, rate, threshold_db=-40., max_seconds=60., preroll=.03):
        self.rate = int(rate)
        self.level = 0.; self.clipped = False; self.state = 'idle'
        self.data = array('f'); self.pre = deque(maxlen=max(1, int(self.rate * preroll)))
        self.set_threshold(threshold_db); self.set_length(max_seconds)

    def set_threshold(self, value):
        value = float(value)
        if not math.isfinite(value): raise ValueError('Threshold must be a number')
        self.threshold_db = max(THRESHOLD_RANGE[0], min(THRESHOLD_RANGE[1], value))

    def set_length(self, value):
        value = float(value)
        if not math.isfinite(value) or value <= 0: raise ValueError('Length must be a positive number')
        self.max_seconds = min(MAX_SECONDS, value); self.limit = int(self.max_seconds * self.rate)

    def arm(self):
        if self.state in ('recording', 'saving'): raise ValueError('Already recording')
        self.state = 'armed'; self.data = array('f'); self.pre.clear(); self.clipped = False

    def start(self):
        """Record now, without waiting for the threshold."""
        if self.state in ('recording', 'saving'): raise ValueError('Already recording')
        self.data = array('f', self.pre); self.pre.clear(); self.clipped = False; self.state = 'recording'

    def cancel(self):
        if self.state != 'saving': self.state = 'idle'
        self.data = array('f'); self.pre.clear()

    @property
    def full(self):
        return self.state == 'recording' and len(self.data) >= self.limit

    def feed(self, block):
        """One block of mono floats from the input. Returns True when the take just reached its length."""
        if not block: return False
        peak = max(max(block), -min(block))
        self.level = max(peak, self.level * .5 ** (len(block) / (self.rate * .25)))
        if self.state == 'armed':
            if peak >= gain(self.threshold_db):
                self.data = array('f', self.pre); self.pre.clear(); self.state = 'recording'
            else:
                self.pre.extend(block); return False
        if self.state != 'recording': return False
        room = self.limit - len(self.data)
        if room <= 0: return False
        part = block if len(block) <= room else block[:room]
        if peak >= .999: self.clipped = True
        self.data.extend(part)
        return len(self.data) >= self.limit

    def take(self):
        """Ends the take: returns its samples with the quiet tail trimmed (a 250 ms ring-out is kept)."""
        if self.state != 'recording': raise ValueError('Nothing is recording')
        data = self.data; self.data = array('f'); self.state = 'saving'
        floor = gain(min(self.threshold_db, -30.) - 12.)
        end = len(data)
        while end > 0 and abs(data[end - 1]) < floor: end -= 1
        if end == 0: self.state = 'idle'; raise ValueError('The take was silent: check the input and its level')
        end = min(len(data), end + int(self.rate * .25))
        return data[:end]

    def saved(self):
        if self.state == 'saving': self.state = 'idle'

    def status(self):
        return dict(state=self.state, level=round(db(self.level), 1), threshold=self.threshold_db,
                    length=self.max_seconds, seconds=round(len(self.data) / self.rate, 2), clipped=self.clipped)
