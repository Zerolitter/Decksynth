"""A stand-in for the pedalboard library in the plugin tests: it speaks the same small API the plugin helper uses
(VST3Plugin with _parameters, MIDI and audio calls, raw_state, show_editor), so the helper and the host are tested
end to end without a real plugin. A path with 'synth' in it is an instrument, 'broken' fails to scan, 'crash' ends
the process while loading."""
import math
import os
import sys

import numpy as np

__version__ = 'fake-1.0'


class _Param:
    def __init__(self, index, name, raw, steps=0x7fffffff, boolean=False, label=''):
        self.index, self.name, self.raw_value, self.num_steps, self.is_boolean, self.label = index, name, raw, steps, boolean, label

    def get_text_for_raw_value(self, raw, maximum_string_length=512):
        if self.is_boolean: return 'On' if raw >= .5 else 'Off'
        if self.num_steps == 3: return ('Soft', 'Warm', 'Hard')[min(2, int(round(raw * 2)))]
        return '%.0f %%' % (raw * 100)

    @property
    def string_value(self):
        return self.get_text_for_raw_value(self.raw_value)


class VST3Plugin:
    @staticmethod
    def get_plugin_names_for_file(path):
        print('fake plugin scanning', path)            # plugins print: the protocol must not care
        if 'broken' in path: raise ImportError('Unable to scan plugin %s: unsupported plugin format or scan failure.' % path)
        if 'yabridge' in path:
            sys.stderr.write("[error] Could not find 'libyabridge-vst3.so'\n"); sys.stderr.flush()
            raise ImportError('Unable to scan plugin %s: unsupported plugin format or scan failure.' % path)
        return ['Fake']

    def __init__(self, path, parameter_values=None, plugin_name=None, initialization_timeout=10.):
        if 'crash' in path: os._exit(3)
        self.path = path
        self.is_instrument = 'synth' in path
        self.is_effect = not self.is_instrument
        self.name = 'Fake Synth' if self.is_instrument else 'Fake Gain'
        self.manufacturer_name = 'Tests'
        self.reported_latency_samples = 0
        self._parameters = [_Param(0, 'Gain', .5, label='%'), _Param(1, 'Drive', 0., steps=3), _Param(2, 'Bypass', 0., boolean=True),
                            _Param(3, 'MIDI CC 0|1', 0.)]

    @property
    def raw_state(self):
        return bytes(int(p.raw_value * 255) for p in self._parameters)

    @raw_state.setter
    def raw_state(self, data):
        for p, b in zip(self._parameters, data): p.raw_value = b / 255.

    def __call__(self, first, duration=None, sample_rate=48000, num_channels=2, buffer_size=8192, reset=True):
        gain = self._parameters[0].raw_value
        if self._parameters[2].raw_value >= .5: gain = 1.
        if isinstance(first, list):
            n = int(duration * sample_rate); out = np.zeros((num_channels, n), dtype=np.float32)
            on = [(m[1], t) for m, t in first if m[0] & 0xF0 == 0x90]
            off = {m[1]: t for m, t in first if m[0] & 0xF0 == 0x80}
            t = np.arange(n) / sample_rate
            for note, start in on:
                end = off.get(note, duration) + .2                  # a 200 ms release, then silence
                f = 440. * 2 ** ((note - 69) / 12.)
                env = np.clip((end - t) / .2, 0., 1.) * (t >= start)
                out += (gain * np.sin(2 * math.pi * f * t) * env).astype(np.float32)
            return out
        return (np.asarray(first, dtype=np.float32) * gain * 2.).astype(np.float32)

    def show_editor(self, close_event=None):
        close_event.wait(5.)
        self._parameters[0].raw_value = .25                 # Sir turned Gain in the plugin's own window
