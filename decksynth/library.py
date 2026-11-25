"""Factory content: 150 synth presets (10 categories x 15) and 64 step patterns (4 banks x 16).

Every preset is a plain instrument dict (the project schema) plus an FX chain that uses the
11-module rack, two named macros (so the Morph pad does something useful) and, where the
sound should move, mod pads routed to FX parameters. All data is generated here so that the
Python engine and the UI (ui/src/library.json, written by `python -m decksynth.library`)
always agree.
"""
import copy
import json
import sys
from pathlib import Path

from .fx import default_chain, validate_chain

CATEGORIES = ['Pads', 'Keys', 'Bass', 'Leads', 'Plucks', 'Bells', 'Strings & choirs',
              'Arps & sequences', 'Textures & drones', 'FX & risers']

# ---------------------------------------------------------------- harmonic recipes
def _norm(h):
    h = [max(0., float(x)) for x in (list(h) + [0.] * 16)[:16]]
    top = max(h) or 1.
    return [round(x / top, 3) for x in h]

def saw(tilt=1.):
    return _norm([1 / (k + 1) ** tilt for k in range(16)])

def square(tilt=1.):
    return _norm([1 / (k + 1) ** tilt if k % 2 == 0 else 0 for k in range(16)])

def tri():
    return _norm([1 / (k + 1) ** 2 if k % 2 == 0 else 0 for k in range(16)])

def sine(extra=()):
    h = [1.] + [0.] * 15
    for k, v in extra: h[k - 1] = v
    return _norm(h)

def drawbar(*levels):
    """Organ-style: levels for partials 1,2,3,4,6,8 (0-8 like a drawbar)."""
    h = [0.] * 16
    for partial, lv in zip((1, 2, 3, 4, 6, 8), levels): h[partial - 1] = lv / 8
    return _norm(h)

def formant(center, width=2., base=.25, tilt=1.):
    """A bump of energy around one partial, like a vowel or a body resonance."""
    return _norm([base / (k + 1) ** tilt + (1 if abs(k + 1 - center) < width else 0) *
                  (1 - abs(k + 1 - center) / width) for k in range(16)])

def sparse(*pairs):
    h = [0.] * 16
    for k, v in pairs: h[k - 1] = v
    return _norm(h)

def mix(a, b, amount=.5):
    return _norm([x * (1 - amount) + y * amount for x, y in zip(a, b)])

def ins(h, a, d, s, r, f, m=0.):
    return dict(harmonics=h, attack=round(a, 3), decay=round(d, 3), sustain=round(s, 3),
                release=round(r, 3), filter=round(f, 3), modulation=round(m, 3))

# ---------------------------------------------------------------- FX recipes
SPACE = ('Space', [('reverb', 'mix', .5), ('delay', 'mix', .3)])
TONE = ('Tone', [('filter', 'cutoff', .45)])
DIRT = ('Dirt', [('overdrive', 'drive', .6), ('bitcrusher', 'mix', .4)])
MOTION = ('Motion', [('phaser', 'mix', .5), ('flanger', 'mix', .3)])
GLITCH = ('Glitch', [('stutter', 'mix', .8), ('bitcrusher', 'mix', .3)])

def fx(modules=None, macros=(TONE, SPACE), mods=(), x=0., y=0.):
    """modules: {id: {param: value}} turned on; mods: (shape, rate index, [(module, param, depth)])."""
    c = default_chain()
    modules = dict(modules or {})
    used = {t[0] for _, targets in macros for t in targets} | {t[0] for _, _, targets in mods for t in targets}
    for m in c['modules']:
        if m['id'] in modules:
            m['on'] = True; m['params'].update(modules[m['id']])
        elif m['id'] in used:
            # A macro or mod pad points here: switch the module on in a neutral setting.
            m['on'] = True
            neutral = {'filter': dict(mode=0, cutoff=1, reso=.15, mix=1), 'reverb': dict(mix=0, decay=.6),
                       'delay': dict(mix=0, feedback=.35, time=3), 'overdrive': dict(drive=0, mix=.6),
                       'bitcrusher': dict(mix=0, bits=8, rate=.25), 'phaser': dict(mix=0),
                       'flanger': dict(mix=0), 'stutter': dict(mix=0, repeats=3, length=4),
                       'ringmod': dict(mix=0), 'volume': dict(level=1, mix=1), 'time': dict(mix=0),
                       'chorus': dict(mix=0), 'compressor': dict(mix=0), 'eq': dict(low=0, mid=0, high=0), 'cloud': dict(mix=0),
                       'tape': dict(mix=0), 'smear': dict(mix=0), 'shimmer': dict(mix=0), 'space': dict(mix=0)}
            m['params'].update(neutral[m['id']])
    for i, (name, targets) in enumerate(macros):
        c['macros'][i]['name'] = name
        c['macros'][i]['targets'] = [dict(module=a, param=b, depth=d) for a, b, d in targets]
    c['macros'][0]['value'] = x; c['macros'][1]['value'] = y
    c['morph'] = dict(x=x, y=y, xMacro=0, yMacro=1)
    for i, (shape, rate, targets) in enumerate(mods):
        c['mods'][i]['shape'] = shape; c['mods'][i]['rate'] = rate
        c['mods'][i]['targets'] = [dict(module=a, param=b, depth=d) for a, b, d in targets]
        if shape == 'steps':
            c['mods'][i]['steps'] = [round(((k * 7) % 16) / 7.5 - 1, 3) for k in range(16)]
    return validate_chain(c)

def verb(mix=.3, decay=.6, pre=.1, hicut=.8, locut=.1):
    return dict(mix=mix, decay=decay, predelay=pre, hicut=hicut, locut=locut)

def echo(mix=.25, time=3, fb=.35):
    return dict(mix=mix, time=time, feedback=fb)

def lp(cutoff=.7, reso=.25):
    return dict(mode=0, cutoff=cutoff, reso=reso, mix=1)

# Mod-pad rate indexes: 0=4 bars 1=2 bars 2=1 bar 3=1/2 4=1/4 5=1/8 6=1/16
B4, B2, B1, HALF, QTR, EIGHTH, SIXTEENTH = range(7)

def P(name, instrument, chain, tags='', **voice):
    """voice: Sound keys for this preset only (Curve, Air, Unison, the Filter card...), over its category's finish."""
    return dict(name=name, instrument=instrument, fx=chain, tags=tags, voice=voice)

PADS = [
    P('Atmospheric Pad', ins([1,.4,.25,.14,.12,.08,.06,.05,.04,.03,.02,.02,.01,.01,0,0], .7,.8,.75,1.8,.65,.25),
      fx({'filter': lp(.75, .2), 'reverb': verb(.45, .75, .2)}, mods=[('sine', B2, [('filter', 'cutoff', .25)])]), 'wide slow'),
    P('Glass Pad', ins(sparse((1,1),(2,.3),(4,.45),(8,.3),(12,.15)), .5,1.,.7,2.2,.9,.2),
      fx({'reverb': verb(.5, .8, .15, .95), 'flanger': dict(rate=.1, depth=.4, feedback=.3, mix=.3)}), 'airy bright'),
    P('Warm Analog Pad', ins(saw(1.4), .9,1.2,.8,2.,.45,.35),
      fx({'filter': lp(.55, .35), 'phaser': dict(rate=.15, depth=.5, feedback=.3, mix=.35), 'reverb': verb(.35, .65)},
         mods=[('triangle', B4, [('filter', 'cutoff', .3)])]), 'analog warm'),
    P('Choir Haze', ins(formant(3, 2.5, .3), 1.2,1.,.85,2.4,.6,.4),
      fx({'reverb': verb(.55, .85, .25), 'filter': lp(.65, .2)}, mods=[('sine', B4, [('filter', 'cutoff', .2)])]), 'vocal'),
    P('Slow Sweep Pad', ins(saw(1.1), 1.5,1.,.8,2.5,.7,.2),
      fx({'filter': lp(.4, .55), 'reverb': verb(.4, .7)}, mods=[('triangle', B4, [('filter', 'cutoff', .7)])]), 'sweep'),
    P('Shimmer Pad', ins(sparse((1,1),(2,.5),(3,.2),(4,.4),(6,.2),(8,.35),(16,.2)), .8,1.,.75,2.8,1.,.3),
      fx({'reverb': verb(.6, .95, .3, 1.), 'delay': echo(.25, 4, .5)}, mods=[('sine', B1, [('reverb', 'hicut', .2)])]), 'bright big'),
    P('Dark Matter', ins(saw(1.8), 1.,1.5,.8,2.5,.25,.5),
      fx({'filter': lp(.35, .5), 'overdrive': dict(drive=.25, mix=.4), 'reverb': verb(.45, .8, .1, .5)},
         mods=[('random', B1, [('filter', 'cutoff', .2)])]), 'dark'),
    P('Sunrise Pad', ins(mix(saw(1.2), formant(5, 3), .4), 2.,1.2,.8,2.6,.5,.3),
      fx({'filter': lp(.3, .3), 'reverb': verb(.45, .75)}, mods=[('saw', B4, [('filter', 'cutoff', -.8)])]), 'rising'),
    P('Phase Pad', ins(saw(1.3), .6,1.,.75,1.8,.7,.25),
      fx({'phaser': dict(rate=.25, depth=.8, feedback=.6, mix=.6), 'reverb': verb(.35, .6)},
         mods=[('sine', B2, [('phaser', 'depth', .4)])]), 'swirl'),
    P('Frozen Pad', ins(sine([(2,.4),(3,.3),(5,.2),(7,.1)]), 1.6,1.5,.9,3.,.8,.4),
      fx({'reverb': verb(.7, 1., .4, .7), 'time': dict(speed=.5, mix=.25)}, mods=[('sine', B4, [('reverb', 'decay', .2)])]), 'ambient'),
]

KEYS = [
    P('Warm Keys', ins([1,.5,.22,.12,.08,.04,.02,.01,0,0,0,0,0,0,0,0], .008,.6,.35,.5,.85,.08),
      fx({'reverb': verb(.2, .45)}), 'classic'),
    P('Electric Piano', ins(sparse((1,1),(2,.35),(3,.12),(4,.2),(7,.08),(14,.06)), .004,1.2,.25,.6,.8,.15),
      fx({'phaser': dict(rate=.35, depth=.4, feedback=.1, mix=.3), 'reverb': verb(.2, .5)},
         mods=[('sine', QTR, [('volume', 'level', .12)])]), 'tremolo'),
    P('Drawbar Organ', ins(drawbar(8,8,6,4,2,1), .004,.1,1.,.08,1.,.3),
      fx({'overdrive': dict(drive=.2, mix=.3), 'flanger': dict(rate=.6, depth=.25, feedback=0, mix=.3)}), 'organ'),
    P('Soft Clav', ins(square(.8), .002,.35,.1,.15,.6,0),
      fx({'filter': dict(mode=1, cutoff=.65, reso=.45, mix=.8), 'reverb': verb(.15, .3)}), 'funky'),
    P('Felt Piano', ins(sparse((1,1),(2,.4),(3,.15),(4,.1),(5,.05)), .006,1.6,.08,.9,.45,0),
      fx({'reverb': verb(.3, .55, .05, .5), 'filter': lp(.6, .1)}), 'soft'),
    P('Wurly Drive', ins(mix(square(1.3), saw(1.5), .5), .004,.9,.3,.4,.7,.1),
      fx({'overdrive': dict(drive=.5, mix=.6), 'reverb': verb(.15, .35)},
         mods=[('sine', EIGHTH, [('volume', 'level', .1)])], macros=(DIRT, SPACE)), 'gritty'),
    P('Toy Piano', ins(sparse((1,1),(3,.5),(5,.35),(7,.2),(9,.15)), .002,.5,.0,.4,1.,0),
      fx({'bitcrusher': dict(rate=.1, bits=10, mix=.3), 'reverb': verb(.25, .4)}), 'cute'),
    P('Chorus Keys', ins(saw(1.6), .01,.8,.5,.6,.7,.2),
      fx({'flanger': dict(rate=.2, depth=.6, feedback=.1, mix=.45), 'reverb': verb(.25, .5)},
         mods=[('triangle', B1, [('flanger', 'depth', .3)])]), 'wide'),
    P('Tine Keys', ins(sparse((1,1),(2,.2),(5,.15),(10,.12),(13,.05)), .003,1.4,.2,.8,.9,.1),
      fx({'delay': echo(.15, 3, .3), 'reverb': verb(.25, .5)}), 'bell-like'),
    P('Lofi Keys', ins(saw(1.7), .01,.9,.4,.5,.5,.25),
      fx({'bitcrusher': dict(rate=.35, bits=7, mix=.4), 'filter': lp(.55, .2), 'reverb': verb(.2, .4)},
         mods=[('random', HALF, [('filter', 'cutoff', .1)])], macros=(DIRT, SPACE)), 'dusty'),
]

BASS = [
    P('Bass', ins([1,.45,.22,.1,.06,.02,0,0,0,0,0,0,0,0,0,0], .004,.2,.65,.15,.35,0), fx(), 'classic'),
    P('Sub Bass', ins(sine([(2,.15)]), .005,.3,.9,.12,.3,0), fx({'overdrive': dict(drive=.1, mix=.2)}, macros=(DIRT, TONE)), 'deep'),
    P('Saw Bass', ins(saw(1.), .003,.25,.7,.12,.6,0),
      fx({'filter': lp(.5, .35)}, macros=(TONE, DIRT)), 'buzzy'),
    P('Square Bass', ins(square(1.), .003,.3,.7,.12,.55,0),
      fx({'filter': lp(.55, .25), 'overdrive': dict(drive=.2, mix=.3)}, macros=(TONE, DIRT)), 'hollow'),
    P('Wobble Bass', ins(saw(.9), .005,.2,.9,.15,.8,0),
      fx({'filter': lp(.35, .6), 'overdrive': dict(drive=.35, mix=.5)},
         mods=[('sine', EIGHTH, [('filter', 'cutoff', .8)])], macros=(TONE, DIRT)), 'wobble'),
    P('Acid Bass', ins(saw(1.), .002,.25,.4,.1,.7,0),
      fx({'filter': lp(.3, .85), 'overdrive': dict(drive=.45, mix=.5), 'delay': echo(.12, 3, .3)},
         mods=[('steps', SIXTEENTH, [('filter', 'cutoff', .5)])], macros=(TONE, DIRT)), 'squelch'),
    P('Pluck Bass', ins(saw(1.3), .002,.25,.1,.12,.5,0), fx({'filter': lp(.6, .3)}), 'short'),
    P('Grit Bass', ins(mix(saw(1.), square(1.), .5), .003,.3,.75,.12,.7,0),
      fx({'overdrive': dict(drive=.65, mix=.7), 'bitcrusher': dict(rate=.2, bits=8, mix=.25), 'filter': lp(.6, .3)},
         macros=(DIRT, TONE)), 'distorted'),
    P('Round Bass', ins(tri(), .006,.4,.8,.15,.4,0), fx({'filter': lp(.5, .1)}), 'soft'),
    P('Dub Bass', ins(sine([(2,.3),(3,.1)]), .01,.5,.8,.25,.35,.1),
      fx({'filter': lp(.45, .4), 'delay': echo(.2, 4, .45)}, mods=[('sine', B1, [('filter', 'cutoff', .3)])]), 'reggae'),
]

LEADS = [
    P('Saw Lead', ins(saw(.9), .005,.3,.8,.25,.85,.3), fx({'delay': echo(.2, 3, .35), 'reverb': verb(.2, .5)}), 'bright'),
    P('Square Lead', ins(square(.9), .005,.3,.8,.2,.8,.3), fx({'delay': echo(.18, 2, .3), 'reverb': verb(.15, .4)}), 'retro'),
    P('Soft Flute', ins(sine([(2,.2),(3,.08)]), .08,.4,.85,.35,.5,.45), fx({'reverb': verb(.35, .6)}), 'breathy'),
    P('Screamer', ins(saw(.7), .004,.3,.9,.2,1.,.4),
      fx({'overdrive': dict(drive=.8, mix=.8), 'filter': lp(.7, .5), 'delay': echo(.2, 3, .4)},
         mods=[('sine', HALF, [('filter', 'cutoff', .2)])], macros=(DIRT, SPACE)), 'aggressive'),
    P('Sync Lead', ins(formant(7, 3, .4, .8), .004,.3,.8,.2,1.,.2),
      fx({'filter': dict(mode=1, cutoff=.6, reso=.6, mix=.7), 'delay': echo(.15, 3, .3)},
         mods=[('triangle', HALF, [('filter', 'cutoff', .5)])]), 'sync'),
    P('Whistle', ins(sine(), .05,.3,.9,.3,.3,.6), fx({'reverb': verb(.4, .7, .2)}), 'pure'),
    P('Crushed Lead', ins(square(1.), .004,.3,.85,.2,.9,.2),
      fx({'bitcrusher': dict(rate=.5, bits=5, mix=.7), 'delay': echo(.15, 2, .3)}, macros=(DIRT, SPACE)), 'chip'),
    P('Delay Lead', ins(saw(1.2), .01,.3,.75,.3,.75,.3), fx({'delay': echo(.4, 3, .55), 'reverb': verb(.3, .6)}), 'echoes'),
    P('Phase Lead', ins(saw(1.), .005,.3,.8,.25,.85,.2),
      fx({'phaser': dict(rate=.5, depth=.7, feedback=.5, mix=.5), 'delay': echo(.15, 3, .3)}, macros=(MOTION, SPACE)), 'moving'),
    P('Hollow Lead', ins(square(1.4), .02,.4,.8,.3,.6,.4),
      fx({'filter': dict(mode=1, cutoff=.55, reso=.35, mix=.6), 'reverb': verb(.3, .55)}), 'woody'),
]

PLUCKS = [
    P('Pluck', ins(saw(1.2), .002,.35,.0,.3,.7,0), fx({'reverb': verb(.25, .5)}), 'classic'),
    P('Harp Pluck', ins(sparse((1,1),(2,.5),(3,.3),(4,.2),(5,.1),(6,.05)), .002,1.,.0,.9,.8,0),
      fx({'reverb': verb(.35, .7, .15)}), 'harp'),
    P('Kalimba', ins(sparse((1,1),(3,.15),(6,.35),(11,.1)), .001,.7,.0,.6,1.,0), fx({'reverb': verb(.3, .55)}), 'thumb piano'),
    P('Pizz', ins(saw(1.5), .003,.2,.0,.2,.6,0), fx({'reverb': verb(.35, .6, .05)}), 'strings'),
    P('Echo Pluck', ins(saw(1.1), .002,.3,.0,.25,.75,0), fx({'delay': echo(.4, 3, .6), 'reverb': verb(.25, .55)}), 'echoes'),
    P('Glass Pluck', ins(sparse((1,1),(4,.6),(8,.4),(12,.2)), .001,.5,.0,.4,1.,0),
      fx({'reverb': verb(.4, .7, .1, 1.), 'flanger': dict(rate=.2, depth=.3, feedback=.2, mix=.25)}), 'glassy'),
    P('Muted Pluck', ins(tri(), .002,.18,.0,.12,.4,0), fx({'filter': lp(.5, .2), 'reverb': verb(.15, .3)}), 'dry'),
    P('Koto', ins(sparse((1,1),(2,.6),(3,.45),(5,.3),(7,.15),(9,.1)), .001,.8,.05,.5,.9,.1),
      fx({'reverb': verb(.3, .6)}), 'twang'),
    P('Bit Pluck', ins(square(1.), .001,.25,.0,.2,1.,0),
      fx({'bitcrusher': dict(rate=.4, bits=6, mix=.6), 'delay': echo(.2, 2, .3)}, macros=(DIRT, SPACE)), '8-bit'),
    P('Space Pluck', ins(saw(1.3), .002,.4,.0,.5,.7,.2),
      fx({'filter': lp(.55, .45), 'delay': echo(.35, 4, .55), 'reverb': verb(.5, .85, .2)},
         mods=[('sine', B2, [('filter', 'cutoff', .3)])]), 'spacey'),
]

BELLS = [
    P('Bell', ins([1,0,.55,0,.3,0,.12,.08,0,.04,0,0,.02,0,0,0], .002,1.6,.05,1.3,1.,.12), fx({'reverb': verb(.3, .65)}), 'classic'),
    P('Tubular Bell', ins(sparse((1,.6),(2,1),(3,.5),(5,.6),(8,.3),(11,.25)), .002,2.5,.05,2.5,1.,.1),
      fx({'reverb': verb(.45, .85, .15)}), 'church'),
    P('Music Box', ins(sparse((1,1),(4,.3),(10,.15)), .001,.9,.0,.8,1.,0), fx({'reverb': verb(.35, .65, .1, 1.)}), 'tiny'),
    P('Vibes', ins(sparse((1,1),(4,.35),(10,.1)), .002,1.8,.15,1.2,.8,.3),
      fx({'reverb': verb(.3, .6)}, mods=[('sine', EIGHTH, [('volume', 'level', .15)])]), 'tremolo'),
    P('Marimba', ins(sparse((1,1),(4,.25),(10,.05)), .001,.5,.0,.4,.7,0), fx({'reverb': verb(.25, .45)}), 'wooden'),
    P('Glocken', ins(sparse((1,1),(3,.4),(6,.3),(9,.2)), .001,1.2,.0,1.,1.,0), fx({'reverb': verb(.3, .6, .05, 1.)}), 'bright'),
    P('Crystal Bell', ins(sparse((1,1),(5,.5),(9,.4),(13,.3),(16,.2)), .002,1.8,.1,1.5,1.,.2),
      fx({'reverb': verb(.5, .85, .2, 1.), 'delay': echo(.2, 4, .45)}), 'sparkle'),
    P('Gamelan', ins(sparse((1,1),(3,.6),(7,.45),(11,.3)), .002,1.5,.05,1.2,1.,.15),
      fx({'ringmod': dict(freq=.3, drive=.1, mix=.25), 'reverb': verb(.35, .7)}), 'metallic'),
    P('Celesta', ins(sparse((1,1),(2,.25),(4,.2),(8,.1)), .002,1.,.05,.9,.9,.05), fx({'reverb': verb(.35, .6)}), 'soft'),
    P('Frozen Bell', ins(sparse((1,1),(3,.5),(5,.3),(7,.25),(9,.15)), .4,2.,.5,3.,1.,.3),
      fx({'reverb': verb(.65, 1., .3, .8), 'time': dict(speed=.5, mix=.2)}), 'ambient'),
]

STRINGS = [
    P('String Ensemble', ins(saw(1.2), .35,.6,.85,.9,.7,.35),
      fx({'flanger': dict(rate=.15, depth=.5, feedback=.1, mix=.35), 'reverb': verb(.4, .7)}), 'lush'),
    P('Slow Strings', ins(saw(1.3), 1.4,.8,.85,1.8,.6,.35), fx({'reverb': verb(.5, .8, .2)}), 'cinematic'),
    P('Cello', ins(formant(4, 3, .5, 1.), .15,.5,.85,.5,.55,.45), fx({'reverb': verb(.3, .6)}), 'low'),
    P('Violin Lead', ins(formant(6, 3, .45, .9), .1,.4,.85,.4,.75,.5), fx({'reverb': verb(.35, .65, .1)}), 'expressive'),
    P('Choir Aah', ins(formant(3, 2, .2, 1.2), .4,.8,.85,1.2,.55,.4),
      fx({'reverb': verb(.5, .8, .2), 'flanger': dict(rate=.1, depth=.3, feedback=0, mix=.2)}), 'vocal'),
    P('Choir Ooh', ins(formant(2, 1.5, .1, 1.6), .5,.8,.85,1.3,.4,.4), fx({'reverb': verb(.5, .8, .2)}), 'vocal dark'),
    P('Vox Pad', ins(formant(5, 2.5, .25, 1.), .8,1.,.8,1.8,.6,.35),
      fx({'filter': dict(mode=1, cutoff=.55, reso=.4, mix=.6), 'reverb': verb(.45, .75)},
         mods=[('triangle', B2, [('filter', 'cutoff', .35)])]), 'formant'),
    P('Brass Section', ins(saw(.95), .06,.4,.8,.25,.6,.2),
      fx({'filter': lp(.55, .2), 'reverb': verb(.25, .5)}, mods=[('saw', B1, [('filter', 'cutoff', -.15)])]), 'bold'),
    P('Soft Brass', ins(saw(1.4), .12,.5,.75,.35,.45,.2), fx({'filter': lp(.5, .15), 'reverb': verb(.3, .55)}), 'mellow'),
    P('Orchestral Swell', ins(saw(1.1), 2.5,1.,.9,2.,.5,.35),
      fx({'filter': lp(.35, .2), 'reverb': verb(.5, .85, .2)}, mods=[('saw', B4, [('filter', 'cutoff', -.7)])]), 'swell'),
]

ARPS = [
    P('Arp Pluck', ins(saw(1.1), .002,.2,.0,.15,.75,0), fx({'delay': echo(.25, 3, .4), 'reverb': verb(.2, .45)}), 'tight'),
    P('Gated Pad', ins(saw(1.3), .2,1.,.85,1.,.65,.3),
      fx({'reverb': verb(.35, .6)}, mods=[('square', SIXTEENTH, [('volume', 'level', .6)])]), 'trance'),
    P('Stutter Arp', ins(square(1.1), .002,.25,.2,.2,.8,0),
      fx({'stutter': dict(length=4, speed=.7, repeats=3, mix=.7), 'delay': echo(.15, 2, .3)}, macros=(GLITCH, SPACE)), 'glitchy'),
    P('Trance Gate', ins(saw(.9), .05,1.,.9,.6,.8,.2),
      fx({'filter': lp(.6, .4), 'reverb': verb(.3, .6)},
         mods=[('steps', SIXTEENTH, [('volume', 'level', .7)]), ('sine', B4, [('filter', 'cutoff', .3)])]), 'gate'),
    P('Bubble Seq', ins(tri(), .002,.15,.0,.1,.5,0),
      fx({'filter': dict(mode=1, cutoff=.5, reso=.7, mix=.8), 'delay': echo(.25, 2, .35)},
         mods=[('random', SIXTEENTH, [('filter', 'cutoff', .4)])]), 'bubbly'),
    P('Crushed Arp', ins(saw(1.), .002,.2,.1,.15,.9,0),
      fx({'bitcrusher': dict(rate=.45, bits=6, mix=.6), 'delay': echo(.2, 3, .4)},
         mods=[('triangle', B1, [('bitcrusher', 'rate', .3)])], macros=(DIRT, SPACE)), 'crunchy'),
    P('Ping Pong Arp', ins(square(1.2), .002,.25,.0,.2,.7,0), fx({'delay': echo(.45, 3, .6), 'reverb': verb(.25, .5)}), 'echo'),
    P('Ring Seq', ins(sine([(2,.3)]), .002,.2,.1,.15,.6,0),
      fx({'ringmod': dict(freq=.45, drive=.3, mix=.6), 'delay': echo(.2, 2, .3)},
         mods=[('steps', EIGHTH, [('ringmod', 'freq', .5)])], macros=(('Ring', [('ringmod', 'mix', .4)]), SPACE)), 'metallic'),
    P('Glide Seq', ins(saw(1.2), .005,.3,.5,.2,.6,.6),
      fx({'filter': lp(.45, .5), 'delay': echo(.2, 3, .35)}, mods=[('sine', B1, [('filter', 'cutoff', .45)])]), 'smooth'),
    P('Filter Seq', ins(saw(.9), .002,.2,.3,.12,.8,0),
      fx({'filter': lp(.4, .7), 'overdrive': dict(drive=.25, mix=.4)}, mods=[('steps', SIXTEENTH, [('filter', 'cutoff', .7)])]), 'stepped'),
]

TEXTURES = [
    P('Evolving Texture', ins([1,.2,.5,.1,.3,.08,.18,.06,.1,.04,.06,.02,.04,.02,.01,0], 1.2,.8,.7,2.,.7,.7),
      fx({'phaser': dict(rate=.1, depth=.6, feedback=.4, mix=.35), 'reverb': verb(.5, .8, .2)},
         mods=[('sine', B4, [('phaser', 'rate', .2)]), ('random', B1, [('filter', 'cutoff', .2)])]), 'evolving'),
    P('Drone', ins(sparse((1,1),(2,.6),(3,.5),(4,.35),(5,.3),(6,.2),(8,.15)), 2.,2.,.95,3.,.5,.6),
      fx({'filter': lp(.5, .4), 'reverb': verb(.5, .9, .3)}, mods=[('sine', B4, [('filter', 'cutoff', .4)])]), 'sustain'),
    P('Wind', ins(_norm([.6 + .4 * ((k * 37) % 7) / 7 for k in range(16)]), 1.5,1.,.9,2.5,.9,.9),
      fx({'filter': dict(mode=1, cutoff=.6, reso=.7, mix=.9), 'reverb': verb(.5, .8)},
         mods=[('random', B1, [('filter', 'cutoff', .5)]), ('sine', B4, [('filter', 'reso', .2)])]), 'air'),
    P('Haze', ins(mix(saw(1.5), sparse((5,1),(9,.6),(13,.4)), .3), 1.,1.5,.8,2.5,.6,.5),
      fx({'stutter': dict(length=5, speed=.3, repeats=2, mix=.25), 'reverb': verb(.6, .9, .3), 'time': dict(speed=.75, mix=.25)},
         macros=(GLITCH, SPACE)), 'blurry'),
    P('Metallic Drone', ins(sparse((1,1),(3,.7),(5,.6),(9,.5),(15,.4)), 1.5,1.5,.9,2.5,.9,.4),
      fx({'ringmod': dict(freq=.2, drive=.2, mix=.4), 'flanger': dict(rate=.08, depth=.7, feedback=.6, mix=.4), 'reverb': verb(.4, .8)},
         mods=[('triangle', B4, [('ringmod', 'freq', .3)])]), 'industrial'),
    P('Dark Drone', ins(saw(2.), 2.5,2.,.95,3.,.2,.6),
      fx({'filter': lp(.3, .6), 'overdrive': dict(drive=.3, mix=.4), 'reverb': verb(.5, .9, .2, .4)},
         mods=[('sine', B4, [('filter', 'cutoff', .3)])]), 'ominous'),
    P('Tape Wobble', ins(saw(1.5), .5,1.,.8,1.5,.5,.8),
      fx({'time': dict(speed=.9, mix=.5), 'bitcrusher': dict(rate=.15, bits=10, mix=.25), 'reverb': verb(.3, .6)},
         mods=[('random', HALF, [('time', 'speed', .1)])]), 'lofi'),
    P('Underwater', ins(sine([(2,.4),(3,.25)]), 1.,1.,.85,2.,.3,.5),
      fx({'filter': lp(.3, .5), 'phaser': dict(rate=.15, depth=.8, feedback=.5, mix=.5), 'reverb': verb(.5, .8)},
         mods=[('sine', B2, [('filter', 'cutoff', .25)])]), 'muffled'),
    P('Ring Cloud', ins(sparse((1,1),(2,.5),(4,.4),(7,.3)), 1.2,1.5,.8,2.5,.8,.5),
      fx({'ringmod': dict(freq=.55, drive=.2, mix=.35), 'reverb': verb(.65, .95, .3)},
         mods=[('random', B1, [('ringmod', 'freq', .4)])]), 'strange'),
    P('Time Smear', ins(saw(1.3), .8,1.,.8,2.,.6,.4),
      fx({'time': dict(speed=.5, mix=.45), 'delay': echo(.3, 4, .5), 'reverb': verb(.5, .85)},
         mods=[('triangle', B2, [('time', 'speed', .3)])]), 'smeared'),
]

FXS = [
    P('Riser', ins(saw(1.), 2.5,1.,1.,.5,.2,.6),
      fx({'filter': lp(.2, .6), 'reverb': verb(.4, .7)}, mods=[('saw', B4, [('filter', 'cutoff', -1.)])]), 'build-up'),
    P('Downlifter', ins(saw(1.1), .01,2.5,.2,2.,.8,.4),
      fx({'filter': lp(.6, .5), 'reverb': verb(.45, .75)}, mods=[('saw', B4, [('filter', 'cutoff', .9)])]), 'drop'),
    P('Laser Zap', ins(square(1.), .001,.15,.0,.1,1.,0),
      fx({'filter': dict(mode=1, cutoff=.6, reso=.85, mix=1), 'delay': echo(.3, 1, .5)},
         mods=[('saw', SIXTEENTH, [('filter', 'cutoff', .9)])]), 'zap'),
    P('Alarm', ins(square(1.2), .005,.2,.9,.1,.8,.2),
      fx({'ringmod': dict(freq=.6, drive=.2, mix=.3)}, mods=[('square', EIGHTH, [('volume', 'level', .5)])]), 'alert'),
    P('Robot Voice', ins(formant(4, 2, .3, .8), .01,.3,.8,.2,.9,.1),
      fx({'ringmod': dict(freq=.5, drive=.3, mix=.6), 'bitcrusher': dict(rate=.3, bits=7, mix=.4)},
         macros=(('Ring', [('ringmod', 'freq', .5)]), DIRT)), 'vocoder-ish'),
    P('Noise Sweep', ins(_norm([1.] * 16), .5,1.,.9,1.,1.,1.),
      fx({'filter': dict(mode=1, cutoff=.4, reso=.6, mix=1), 'reverb': verb(.4, .7)},
         mods=[('triangle', B2, [('filter', 'cutoff', .9)])]), 'whoosh'),
    P('Glitch Hit', ins(square(.8), .001,.3,.0,.25,1.,0),
      fx({'stutter': dict(length=5, speed=.9, repeats=6, mix=.9), 'bitcrusher': dict(rate=.6, bits=4, mix=.5)},
         macros=(GLITCH, DIRT)), 'glitch'),
    P('Siren', ins(saw(1.3), .2,.5,.9,.6,.7,.9),
      fx({'filter': dict(mode=1, cutoff=.5, reso=.5, mix=.8), 'reverb': verb(.35, .6)},
         mods=[('triangle', HALF, [('filter', 'cutoff', .7)])]), 'wail'),
    P('Sci-Fi Swell', ins(sparse((1,1),(3,.6),(6,.5),(10,.4),(14,.3)), 2.,1.5,.9,2.5,1.,.6),
      fx({'flanger': dict(rate=.3, depth=.8, feedback=.8, mix=.5), 'reverb': verb(.55, .9)},
         mods=[('saw', B2, [('flanger', 'rate', -.4)])]), 'space'),
    P('Impact', ins(sine([(2,.5),(3,.3)]), .001,1.2,.0,1.5,.4,0),
      fx({'overdrive': dict(drive=.6, mix=.6), 'reverb': verb(.55, .9, .0, .5)}, macros=(DIRT, SPACE)), 'boom'),
]


# ---------------------------------------------------------------- full sound (17 Nov)
# Every factory preset gets a finish for its category, the way a sample library is recorded and mixed:
#   Shape   decays and releases fade evenly to the ear, like a struck string, instead of a straight line
#   Air     partials past 16, so low notes keep their top end
#   Drift   each note its own start phase and a few cents of tuning (chords stop sounding like one wave)
#   Dynamics and Vel bright   playing harder is louder AND brighter, like a real instrument
#   Unison  a few detuned voices on pads, strings and some leads
#   FX finish   stereo chorus (width), a little EQ and a gentle compressor where the sound needs glue,
#               placed before the delay and reverb
# A preset's own values win; P(..., key=value) sets a voice key for that preset only.
VOICING = {
    'Pads': dict(env_curve=.45, air=.3, drift=.6, vel_curve=.2, velocity_brightness=.25, uni_voices=3, uni_detune=.22),
    'Keys': dict(env_curve=.7, air=.4, drift=.3, vel_curve=.55, velocity_brightness=.45),
    'Bass': dict(env_curve=.55, air=.35, drift=.12, vel_curve=.3, velocity_brightness=.3),
    'Leads': dict(env_curve=.45, air=.5, drift=.35, vel_curve=.3, velocity_brightness=.35),
    'Plucks': dict(env_curve=.8, air=.45, drift=.3, vel_curve=.45, velocity_brightness=.5),
    'Bells': dict(env_curve=.85, air=.35, drift=.2, vel_curve=.45, velocity_brightness=.4),
    'Strings & choirs': dict(env_curve=.35, air=.3, drift=.55, vel_curve=.3, velocity_brightness=.3, uni_voices=3, uni_detune=.18),
    'Arps & sequences': dict(env_curve=.75, air=.4, drift=.2, vel_curve=.4, velocity_brightness=.45),
    'Textures & drones': dict(env_curve=.35, air=.3, drift=.7, vel_curve=.1, velocity_brightness=.2),
    'FX & risers': dict(env_curve=.3, air=.4, drift=.4, vel_curve=.15, velocity_brightness=.25),
}
def _chorus(width, mix=.3, rate=.25, depth=.45):
    return dict(rate=rate, depth=depth, voices=2, mix=mix, width=width, haas=0.)
FINISH = {
    'Pads': {'chorus': _chorus(1., .45, .2), 'eq': dict(low=-.12, mid=0, freq=.5, high=.08)},
    'Keys': {'chorus': _chorus(.8, .3, .3, .35), 'compressor': dict(amount=.25, ratio=0, attack=.3, release=.3, makeup=.08, mix=1)},
    'Bass': {'compressor': dict(amount=.3, ratio=1, attack=.25, release=.25, makeup=.12, mix=1), 'eq': dict(low=.1, mid=-.1, freq=.25, high=0)},
    'Leads': {'chorus': _chorus(.7, .28, .3, .35)},
    'Plucks': {'chorus': _chorus(.85, .35, .3, .4)},
    'Bells': {'chorus': _chorus(.8, .3, .2, .3)},
    'Strings & choirs': {'chorus': _chorus(1., .45, .18), 'eq': dict(low=-.1, mid=0, freq=.5, high=.05)},
    'Arps & sequences': {'chorus': _chorus(.8, .3, .3, .35)},
    'Textures & drones': {'chorus': _chorus(1., .5, .15, .6)},
    'FX & risers': {'chorus': _chorus(1., .4, .2, .5)},
}

# Each preset's own level ('gain'), so all 150 arrive equally loud at the master stage: the loudest 50 ms of
# a C3-C4-E4-G4 chord at velocity 100 sits at -23 dBFS before it (tools/measure_sound.py --calibrate,
# with small nudges per category). Sounds that open up over several bars (swells, risers) are set by ear.
LEVELS = {
    'Atmospheric Pad': 1.82, 'Glass Pad': 1.47, 'Warm Analog Pad': 3.46, 'Choir Haze': 1.61,
    'Slow Sweep Pad': 2.5, 'Shimmer Pad': 1.34, 'Dark Matter': 1.21, 'Sunrise Pad': 2.0,
    'Phase Pad': 3.17, 'Frozen Pad': 2.09, 'Velvet Pad': 1.4, 'Warm Blanket': 1.24,
    'Super Pad': 2.21, 'Dream Pad': 1.84, 'Night Drive Pad': 1.46, 'Warm Keys': 2.58,
    'Electric Piano': 3.09, 'Drawbar Organ': 1.1, 'Soft Clav': 6.77, 'Felt Piano': 2.73,
    'Wurly Drive': 0.81, 'Toy Piano': 3.36, 'Chorus Keys': 2.63, 'Tine Keys': 2.69,
    'Lofi Keys': 3.22, 'Concert Keys': 2.48, 'Stage EP': 3.13, 'Soft Upright': 2.41,
    'Perc Organ': 1.38, 'Pop Keys': 2.61, 'Bass': 2.12, 'Sub Bass': 0.87,
    'Saw Bass': 2.92, 'Square Bass': 1.52, 'Wobble Bass': 1.02, 'Acid Bass': 1.0,
    'Pluck Bass': 2.87, 'Grit Bass': 0.71, 'Round Bass': 1.24, 'Dub Bass': 1.15,
    '808 Boom': 1.44, '808 Short': 2.29, '808 Grit': 0.65, '808 Glide': 0.92, '909 Kick Bass': 1.16, 'Sub Kick': 1.56,  # 25 Nov, tools/measure_sound.py --calibrate
    'Reese Bass': 1.17, 'Deep Sub 808': 1.36, 'Ladder Bass': 3.64, 'Rubber Bass': 1.27,
    'Finger Bass': 2.29, 'Saw Lead': 4.07, 'Square Lead': 3.55, 'Soft Flute': 1.58,
    'Screamer': 0.8, 'Sync Lead': 4.18, 'Whistle': 1.13, 'Crushed Lead': 3.48,
    'Delay Lead': 3.02, 'Phase Lead': 5.05, 'Hollow Lead': 4.32, 'Supersaw Lead': 3.43,
    'Glide Sine Lead': 2.39, 'Brass Lead': 4.61, 'Pluck Lead': 2.67, 'Vowel Lead': 2.73,
    'Pluck': 4.38, 'Harp Pluck': 3.14, 'Kalimba': 3.51, 'Pizz': 5.2,
    'Echo Pluck': 4.86, 'Glass Pluck': 4.57, 'Muted Pluck': 3.49, 'Koto': 3.19,
    'Bit Pluck': 5.87, 'Space Pluck': 6.25, 'Nylon Pluck': 2.88, 'Mallet Pluck': 3.93,
    'Filter Pluck': 4.81, 'Synth Harp': 3.8, 'Sparkle Pluck': 4.77, 'Bell': 2.32,
    'Tubular Bell': 2.36, 'Music Box': 2.07, 'Vibes': 1.82, 'Marimba': 2.13,
    'Glocken': 2.11, 'Crystal Bell': 2.94, 'Gamelan': 2.94, 'Celesta': 2.08,
    'Frozen Bell': 1.87, 'Wind Chimes': 2.15, 'Church Bell': 2.84, 'Glass Harmonica': 1.58,
    'Soft Vibraphone': 1.77, 'Digital Bell': 2.87, 'String Ensemble': 2.58, 'Slow Strings': 2.57,
    'Cello': 2.62, 'Violin Lead': 3.03, 'Choir Aah': 1.3, 'Choir Ooh': 1.36,
    'Vox Pad': 2.53, 'Brass Section': 4.65, 'Soft Brass': 3.06, 'Orchestral Swell': 2.0,
    'Chamber Strings': 2.46, 'Synth Strings': 3.25, 'Cello Section': 2.45, 'Angel Choir': 0.94,
    'Tremolo Strings': 2.6, 'Arp Pluck': 5.27, 'Gated Pad': 1.94, 'Stutter Arp': 3.58,
    'Trance Gate': 3.07, 'Bubble Seq': 4.07, 'Crushed Arp': 7.43, 'Ping Pong Arp': 4.63,
    'Ring Seq': 2.18, 'Glide Seq': 4.2, 'Filter Seq': 3.56, 'Sparkle Arp': 4.3,
    'Pulse Arp': 4.79, 'Acid Arp': 1.51, 'Soft Bell Arp': 3.77, 'Wide Saw Arp': 5.69,
    'Evolving Texture': 2.5, 'Drone': 2.27, 'Wind': 3.25, 'Haze': 2.11,
    'Metallic Drone': 2.17, 'Dark Drone': 1.13, 'Tape Wobble': 2.35, 'Underwater': 2.37,
    'Ring Cloud': 1.08, 'Time Smear': 2.84, 'Glass Drone': 1.98, 'Ocean Air': 6.53,
    'Granular Mist': 3.9, 'Warm Hum': 1.91, 'Starfield': 1.02, 'Riser': 2.0,
    'Downlifter': 2.62, 'Laser Zap': 5.86, 'Alarm': 1.35, 'Robot Voice': 2.04,
    'Noise Sweep': 4.78, 'Glitch Hit': 2.7, 'Siren': 2.72, 'Sci-Fi Swell': 1.55,
    'Impact': 0.43, 'Noise Uplifter': 2.0, 'Sub Drop': 1.05, 'Reverse Swell': 2.49,
    'Radio Static': 7.79, 'Space Wash': 1.16,
}
# The finish goes before the time effects: dynamics and tone first, then width, then delay and reverb.
FINISH_ORDER = ['compressor', 'eq', 'chorus']

# ---------------------------------------------------------------- preset pass (24 Nov)
# Measured on 24 Nov: most presets were one static spectrum under the same chorus + reverb wash, so they
# sounded alike. Real instruments get brighter at the strike and darker as they ring. The Filter card with its
# own envelope does that already, but only 8 presets used it. A preset without a Filter card of its own now
# gets its category's one; its partials are opened up a little (BRIGHT_FLOOR) so the filter does the shaping.
# Organs, flutes, whistles, subs, gated and filter-swept presets keep their plain voice (REVOICE_PLAIN).
def _env(cut, env, reso, a, d, s, r, vel=0.):
    out = dict(vcf_type=1, vcf_morph=0., vcf_cutoff=cut, vcf_env=env, vcf_reso=reso, fenv_a=a, fenv_d=d, fenv_s=s, fenv_r=r)
    if vel: out['velocity_cutoff'] = vel   # play harder, the filter opens further
    return out
REVOICE_ENV = {
    'Keys': _env(.48, .55, .12, .002, .8, .25, .4, .35),        # hammer bright, then mellow
    'Plucks': _env(.45, .6, .18, .001, .3, .05, .25, .4),       # snap, then the body only
    'Bass': _env(.45, .55, .22, .002, .35, .35, .15, .3),       # a pluck on the front of every note
    'Leads': _env(.63, .3, .15, .005, .6, .55, .3, .2),        # a little bite on each note
    'Arps & sequences': _env(.42, .55, .3, .001, .22, .1, .15, .3),
    'Strings & choirs': _env(.62, .25, .1, .25, .8, .75, .6),  # the bow opens the tone
    'Pads': _env(.63, .2, .1, .9, 1.5, .8, 1.5),           # slowly opens
}
BRIGHT_FLOOR = {'Keys': .85, 'Plucks': .9, 'Bass': .8, 'Leads': .85, 'Arps & sequences': .9, 'Strings & choirs': .8, 'Pads': .75}
# A filter can only take away: most presets had little above partial 3, so a sweep had nothing to sweep.
# Each partial is lifted to at least lift/k (a saw at that level) before the filter shapes it over time.
LIFT = {'Keys': .45, 'Plucks': .6, 'Bass': .5, 'Leads': .35, 'Arps & sequences': .6, 'Strings & choirs': .35, 'Pads': .25}
REVOICE_PLAIN = {
    'Drawbar Organ', 'Perc Organ', 'Soft Clav', 'Lofi Keys', 'Wurly Drive',
    '808 Boom', '808 Short', '808 Grit', '808 Glide', '909 Kick Bass', 'Sub Kick',
    'Sub Bass', 'Deep Sub 808', 'Dub Bass', 'Wobble Bass', 'Grit Bass', 'Round Bass',
    'Soft Flute', 'Whistle', 'Glide Sine Lead', 'Screamer', 'Crushed Lead', 'Sync Lead', 'Hollow Lead',
    'Bit Pluck', 'Space Pluck', 'Muted Pluck',
    'Gated Pad', 'Trance Gate', 'Bubble Seq', 'Ring Seq', 'Filter Seq', 'Glide Seq', 'Crushed Arp', 'Stutter Arp',
    'Choir Aah', 'Choir Ooh', 'Vox Pad', 'Angel Choir', 'Orchestral Swell',
    'Glass Pad', 'Shimmer Pad', 'Frozen Pad', 'Slow Sweep Pad', 'Sunrise Pad', 'Dark Matter', 'Phase Pad',
}
# Preset by preset: bells ring with stretched (inharmonic) partials, basses get a sub, two leads a little unison.
REVOICE = {
    'Bell': dict(inharm=.25), 'Tubular Bell': dict(inharm=.35), 'Gamelan': dict(inharm=.4), 'Glocken': dict(inharm=.12),
    'Crystal Bell': dict(inharm=.18), 'Celesta': dict(inharm=.08), 'Music Box': dict(inharm=.1),
    'Harp Pluck': dict(inharm=.03), 'Koto': dict(inharm=.05), 'Kalimba': dict(inharm=.2),
    'Bass': dict(sub=.2), 'Saw Bass': dict(sub=.25), 'Square Bass': dict(sub=.2), 'Pluck Bass': dict(sub=.15),
    'Saw Lead': dict(uni_voices=3, uni_detune=.18), 'Phase Lead': dict(uni_voices=2, uni_detune=.15),
}
# Less shared wash: dry categories keep a light chorus for width (the synth track is mono until an effect
# makes it stereo) and less reverb, so each preset's own effects are what you hear.
for _cat, _ch in (('Keys', _chorus(1., .22, .25, .15)), ('Leads', _chorus(.9, .2, .25, .15)), ('Plucks', _chorus(1., .24, .25, .18)),
                  ('Bells', _chorus(1., .22, .2, .15)), ('Arps & sequences', _chorus(1., .22, .25, .15))):
    FINISH[_cat]['chorus'] = _ch
REVERB_SCALE = {'Keys': .7, 'Plucks': .7, 'Leads': .7, 'Arps & sequences': .6, 'Bass': .5}

# Strike card (24 Nov): what the first moments of a real instrument do. Damping lets the top die before the
# note (strings, keys, bells); Noise is the hammer, pick, mallet or bow at the start; Pitch drop is the 808 fall.
def _strike(damp=0., noise=0., decay=.01, tone=.7, **more):
    out = dict(damp=damp, noise=noise, noise_decay=decay, noise_tone=tone); out.update(more); return out
STRIKE = {
    'Keys': _strike(.45, .22, .012, .7),             # felt hammer
    'Plucks': _strike(.55, .3, .008, .8),            # pick or nail
    'Bells': _strike(.4, .15, .006, .9),             # the strike, then the top rings away first
    'Bass': _strike(.35, .15, .01, .5),              # finger or pick on a string
    'Arps & sequences': _strike(.4, .2, .008, .8),
    'Strings & choirs': _strike(0., .12, .12, .65),  # the bow catching the string
}
STRIKE_PRESET = {
    'Soft Flute': _strike(0., .25, .15, .75), 'Whistle': _strike(0., .15, .1, .85),
    'Marimba': _strike(.5, .3, .01, .6), 'Kalimba': _strike(.5, .35, .008, .7), 'Church Bell': _strike(.3, .2, .01, .8),
    'Deep Sub 808': dict(pitch_env=12., pitch_decay=.045), 'Sub Drop': dict(pitch_env=-12., pitch_decay=.4),
    'Laser Zap': dict(pitch_env=24., pitch_decay=.06), 'Impact': _strike(0., .5, .15, .5, pitch_env=12., pitch_decay=.1),
    'Glitch Hit': _strike(0., .4, .02, .8), 'Pluck Lead': _strike(.45, .25, .008, .8),
    'Acid Bass': dict(damp=.3), 'Rubber Bass': dict(pitch_env=5., pitch_decay=.03), 'Finger Bass': _strike(.45, .2, .01, .45),
}

def revoice(p, category):
    """The 24 Nov pass on one finished preset (instrument and chain changed in place)."""
    ins = p['instrument']; name = p['name']
    env = REVOICE_ENV.get(category)
    if env and name not in REVOICE_PLAIN and not ins.get('vcf_type'):
        ins.update(env); ins['filter'] = max(ins['filter'], BRIGHT_FLOOR[category])
        lift = LIFT[category]
        ins['harmonics'] = _norm([max(h, lift / (k + 1)) for k, h in enumerate(ins['harmonics'])])
    ins.update(REVOICE.get(name, {}))
    if category in STRIKE and name not in REVOICE_PLAIN:
        for k, v in STRIKE[category].items(): ins.setdefault(k, v)
    ins.update(STRIKE_PRESET.get(name, {}))
    scale = REVERB_SCALE.get(category)
    if scale:
        for m in p['fx']['modules']:
            if m['id'] == 'reverb' and m['on']: m['params']['mix'] = round(m['params'].get('mix', 0) * scale, 3)

def finish(preset, category):
    p = copy.deepcopy(preset)
    own = p.pop('voice', {})
    flags = {k for k in own if k.startswith('no_')}
    own = {k: v for k, v in own.items() if not k.startswith('no_')}
    ins = p['instrument']
    for k, v in {**VOICING.get(category, {}), **own}.items():
        if k not in ins or k in own: ins[k] = v
    ins.setdefault('gain', LEVELS.get(p['name'], 1.))
    chain = p['fx']
    mods = {m['id']: m for m in chain['modules']}
    for mid, params in FINISH.get(category, {}).items():
        if 'no_' + mid in flags: continue
        m = mods[mid]
        # off, or only switched on (silent) because a macro or mod pad points at it: give it the finish
        if not m['on'] or (mid != 'eq' and m['params'].get('mix', 1) == 0):
            m['on'] = True; m['params'].update(params)
    on = [m for m in chain['modules'] if m['on']]
    first = [m for m in on if m['id'] in ('stutter', 'filter', 'overdrive', 'bitcrusher')]
    finish_m = [mods[x] for x in FINISH_ORDER if mods[x]['on']]
    rest = [m for m in on if m not in first and m not in finish_m]
    chain['modules'] = first + finish_m + rest + [m for m in chain['modules'] if not m['on']]
    revoice(p, category)
    p['fx'] = validate_chain(chain)
    return p

# ---------------------------------------------------------------- 17 Nov: five more per category
LP_ENV = lambda cut, env, reso=.25, d=.4, s=.2: dict(vcf_type=1, vcf_morph=0., vcf_cutoff=cut, vcf_env=env, vcf_reso=reso,
                                                    fenv_a=.002, fenv_d=d, fenv_s=s, fenv_r=.3)
PADS += [
    P('Velvet Pad', ins(saw(1.5), .8,1.2,.8,2.2,.5,.3),
      fx({'filter': lp(.6, .15), 'reverb': verb(.45, .8, .2, .6)}, mods=[('sine', B4, [('filter', 'cutoff', .2)])]),
      'soft wide', uni_voices=5, uni_detune=.25),
    P('Warm Blanket', ins(mix(saw(1.6), tri(), .5), 1.,1.5,.85,2.5,.4,.3),
      fx({'reverb': verb(.5, .85, .25, .5)}), 'cosy dark', drift=.8),
    P('Super Pad', ins(saw(.95), .4,1.,.85,1.8,.75,.2),
      fx({'reverb': verb(.4, .75, .15)}, mods=[('triangle', B2, [('chorus', 'depth', .3)])]), 'huge bright', uni_voices=5, uni_detune=.38),
    P('Dream Pad', ins(mix(formant(4, 2.5, .3), sine([(2,.3)]), .5), 1.2,1.5,.8,2.8,.6,.4),
      fx({'phaser': dict(rate=.12, depth=.5, feedback=.3, mix=.3), 'reverb': verb(.6, .9, .3, .7)}), 'floating'),
    P('Night Drive Pad', ins(square(1.3), .6,1.,.8,1.8,.6,.25),
      fx({'delay': echo(.2, 4, .4), 'reverb': verb(.4, .7)}), 'synthwave',
      **LP_ENV(.45, .35, .3, 1.2, .4)),
]
KEYS += [
    P('Concert Keys', ins(sparse((1,1),(2,.55),(3,.3),(4,.22),(5,.14),(6,.1),(7,.07),(8,.05),(9,.035),(10,.025),(12,.015)),
                          .002,2.6,.0,.7,.75,0), fx({'reverb': verb(.22, .55, .05, .7)}), 'piano-like',
      inharm=.12, env_curve=.85, vel_curve=.7, velocity_brightness=.6),
    P('Stage EP', ins(sparse((1,1),(2,.25),(3,.08),(5,.12),(8,.06),(13,.05)), .003,1.8,.15,.6,.8,.12),
      fx({'phaser': dict(rate=.25, depth=.3, feedback=.1, mix=.2), 'reverb': verb(.2, .45)},
         mods=[('sine', EIGHTH, [('volume', 'level', .08)])]), 'tine bark', velocity_brightness=.65),
    P('Soft Upright', ins(sparse((1,1),(2,.45),(3,.2),(4,.12),(5,.06),(6,.04)), .004,2.,.0,.5,.5,0),
      fx({'reverb': verb(.25, .5, .05, .5), 'filter': lp(.65, .1)}), 'felt warm', inharm=.06, env_curve=.85),
    P('Perc Organ', ins(drawbar(8,6,8,3,4,2), .002,.25,.85,.08,1.,.35),
      fx({'overdrive': dict(drive=.15, mix=.25), 'chorus': _chorus(.6, .35, .55, .5)}), 'rock organ',
      env_curve=.6, vel_curve=.1, velocity_brightness=.1, no_compressor=1),
    P('Pop Keys', ins(mix(saw(1.4), sparse((1,1),(2,.4),(4,.2)), .5), .003,1.2,.25,.5,.8,.05),
      fx({'reverb': verb(.2, .45), 'delay': echo(.1, 3, .25)}), 'bright modern', air=.6),
]
BASS += [
    P('Reese Bass', ins(saw(1.), .005,.4,.85,.15,.55,0),
      fx({'filter': lp(.5, .2), 'overdrive': dict(drive=.25, mix=.35)}, macros=(TONE, DIRT)), 'dnb wide',
      uni_voices=3, uni_detune=.22, sub=.4),
    P('Deep Sub 808', ins(sine([(2,.08)]), .002,1.6,.0,.4,.3,0),
      fx({'overdrive': dict(drive=.2, mix=.3)}, macros=(DIRT, TONE)), 'trap boom', play_mode=1, glide=.06, env_curve=.6),
    P('Ladder Bass', ins(saw(1.), .003,.35,.6,.12,1.,0), fx({}, macros=(TONE, DIRT)), 'analog round',
      **LP_ENV(.32, .45, .35, .3, .15)),
    P('Rubber Bass', ins(tri(), .003,.3,.5,.12,.6,0), fx({}), 'bouncy',
      **LP_ENV(.35, .5, .5, .18, .1)),
    P('Finger Bass', ins(sparse((1,1),(2,.5),(3,.25),(4,.15),(5,.08),(6,.04)), .004,1.2,.15,.1,.6,0),
      fx({'filter': lp(.6, .1)}), 'funk', env_curve=.75, vel_curve=.45, sub=.2),
]
# 808 family (25 Nov): a sine body that falls onto the note (Strike's Pitch drop) under a short recorded-style kick transient
# (the Sample layer's Attack). The attack sounds are generated by tools/make_808_kick.py and shipped in decksynth/assets, so
# these presets never depend on anyone's own sample folder; pick another kick on the Sample layer to change the click.
def _kick(name, level, tune=0., **more):
    return dict(layer_on=1, layer_mode=1, layer_file='factory:' + name, layer_level=level, layer_tune=tune, **more)
BASS += [
    P('808 Boom', ins(sine([(2,.05)]), .001,2.4,.0,.5,.35,0),
      fx({'overdrive': dict(drive=.12, mix=.2)}, macros=(DIRT, TONE)), '808 trap boom kick',
      play_mode=1, glide=.04, env_curve=.6, pitch_env=14., pitch_decay=.05, **_kick('808-kick-attack.wav', .8)),
    P('808 Short', ins(sine([(2,.04)]), .001,.38,.0,.12,.4,0),
      fx({}, macros=(DIRT, TONE)), '808 tight kick short',
      play_mode=1, env_curve=.5, pitch_env=16., pitch_decay=.03, **_kick('808-kick-attack.wav', .9)),
    P('808 Grit', ins(sine([(2,.3),(3,.2),(5,.1)]), .001,1.4,.0,.35,.55,0),
      fx({'overdrive': dict(drive=.55, mix=.6), 'filter': lp(.7, .2)}, macros=(DIRT, TONE)), '808 distorted grit',
      play_mode=1, env_curve=.5, pitch_env=14., pitch_decay=.04, **_kick('808-kick-attack.wav', .9)),
    P('808 Glide', ins(sine([(2,.05)]), .001,2.8,.15,.6,.35,0),
      fx({'overdrive': dict(drive=.15, mix=.25)}, macros=(DIRT, TONE)), '808 slide legato',
      play_mode=2, glide=.12, env_curve=.6, pitch_env=10., pitch_decay=.05, **_kick('808-kick-attack.wav', .7)),
    P('909 Kick Bass', ins(sparse((1,1),(2,.18),(3,.06)), .001,.55,.0,.18,.5,0),
      fx({'overdrive': dict(drive=.2, mix=.3)}, macros=(DIRT, TONE)), '909 punch kick bass',
      play_mode=1, env_curve=.45, pitch_env=18., pitch_decay=.025, **_kick('909-kick-attack.wav', .9)),
    P('Sub Kick', ins(sine(), .001,.9,.0,.25,.25,0),
      fx({}, macros=(DIRT, TONE)), 'sub thump kick',
      play_mode=1, env_curve=.55, pitch_env=20., pitch_decay=.07, **_kick('soft-thud.wav', .7)),
]
LEADS += [
    P('Supersaw Lead', ins(saw(.9), .005,.3,.85,.3,.85,.2),
      fx({'delay': echo(.22, 3, .35), 'reverb': verb(.25, .55)}), 'trance huge', uni_voices=5, uni_detune=.3),
    P('Glide Sine Lead', ins(sine([(2,.12),(3,.05)]), .01,.3,.9,.25,.4,.35),
      fx({'delay': echo(.2, 3, .4), 'reverb': verb(.3, .6)}), 'smooth mono', play_mode=2, glide=.12),
    P('Brass Lead', ins(saw(1.05), .03,.4,.75,.2,.7,.2), fx({'reverb': verb(.2, .5)}), 'bold',
      **LP_ENV(.4, .45, .15, .35, .5)),
    P('Pluck Lead', ins(square(1.1), .003,.6,.35,.25,.8,.1), fx({'delay': echo(.25, 3, .4), 'reverb': verb(.2, .5)}), 'punchy',
      **LP_ENV(.5, .4, .3, .25, .3)),
    P('Vowel Lead', ins(saw(1.1), .02,.4,.85,.3,.8,.35), fx({'delay': echo(.18, 2, .3), 'reverb': verb(.25, .5)}), 'talking',
      formant=.7, vowel=1.),
]
PLUCKS += [
    P('Nylon Pluck', ins(sparse((1,1),(2,.6),(3,.35),(4,.25),(5,.15),(6,.1),(7,.06),(8,.04)), .001,1.2,.0,.4,.65,0),
      fx({'reverb': verb(.25, .5, .05)}), 'guitar-ish', inharm=.04),
    P('Mallet Pluck', ins(sparse((1,1),(3,.2),(4,.15),(10,.05)), .001,.6,.0,.35,.7,0), fx({'reverb': verb(.3, .55)}), 'wooden soft'),
    P('Filter Pluck', ins(saw(1.), .001,.5,.0,.3,1.,0), fx({'delay': echo(.25, 3, .4), 'reverb': verb(.25, .5)}), 'house',
      **LP_ENV(.35, .6, .35, .22, .0)),
    P('Synth Harp', ins(mix(saw(1.6), sine(), .4), .001,1.5,.0,1.2,.75,0),
      fx({'reverb': verb(.4, .75, .15)}), 'glissando', uni_voices=2, uni_detune=.12),
    P('Sparkle Pluck', ins(sparse((1,1),(2,.3),(4,.4),(8,.3),(16,.2)), .001,.7,.0,.5,1.,0),
      fx({'delay': echo(.3, 4, .5), 'reverb': verb(.4, .7, .1, 1.)}), 'shiny'),
]
BELLS += [
    P('Wind Chimes', ins(sparse((1,1),(3,.5),(7,.4),(11,.3),(13,.25)), .001,2.5,.0,2.5,1.,.15),
      fx({'reverb': verb(.5, .85, .2, 1.)}), 'airy', inharm=.25),
    P('Church Bell', ins(sparse((1,.5),(2,1),(3,.6),(4,.4),(6,.35),(8,.25),(11,.2)), .001,3.,.0,3.,.9,.05),
      fx({'reverb': verb(.5, .9, .2, .6)}), 'big toll', inharm=.35),
    P('Glass Harmonica', ins(sparse((1,1),(2,.15),(3,.25),(5,.1)), .25,1.5,.7,1.5,.8,.35),
      fx({'reverb': verb(.45, .8, .2, .9)}), 'eerie sustain', env_curve=.4),
    P('Soft Vibraphone', ins(sparse((1,1),(4,.3),(10,.08)), .002,2.2,.0,1.5,.7,.25),
      fx({'reverb': verb(.3, .6)}, mods=[('sine', EIGHTH, [('volume', 'level', .12)])]), 'jazz'),
    P('Digital Bell', ins(sparse((1,1),(5,.6),(7,.45),(9,.4),(14,.3)), .001,1.4,.05,1.,1.,.1),
      fx({'delay': echo(.2, 3, .4), 'reverb': verb(.35, .65)}), 'fm-ish bright', air=.6),
]
STRINGS += [
    P('Chamber Strings', ins(saw(1.25), .25,.6,.85,.8,.6,.45), fx({'reverb': verb(.4, .75, .15, .7)}), 'warm real'),
    P('Synth Strings', ins(saw(1.1), .15,.6,.85,.7,.7,.25),
      fx({'phaser': dict(rate=.12, depth=.4, feedback=.2, mix=.25), 'reverb': verb(.35, .65)}), '80s lush', uni_voices=5, uni_detune=.25),
    P('Cello Section', ins(formant(3, 3, .5, 1.1), .2,.6,.85,.6,.5,.45), fx({'reverb': verb(.35, .7, .1)}), 'deep bowed'),
    P('Angel Choir', ins(formant(4, 2, .2, 1.3), .6,1.,.85,1.8,.55,.35),
      fx({'reverb': verb(.6, .9, .3, .8)}), 'heavenly', formant=.6, vowel=0.),
    P('Tremolo Strings', ins(saw(1.2), .1,.5,.85,.5,.65,.3),
      fx({'reverb': verb(.35, .7)}, mods=[('triangle', SIXTEENTH, [('volume', 'level', .35)])]), 'tension'),
]
ARPS += [
    P('Sparkle Arp', ins(sparse((1,1),(2,.4),(3,.2),(4,.3),(8,.2)), .001,.35,.0,.25,1.,0),
      fx({'delay': echo(.35, 3, .45), 'reverb': verb(.3, .6, .1, 1.)}), 'glassy'),
    P('Pulse Arp', ins(square(.8), .002,.2,.1,.12,.7,0), fx({'delay': echo(.25, 2, .35)}), 'tight retro',
      **LP_ENV(.45, .35, .25, .15, .1)),
    P('Acid Arp', ins(saw(1.), .002,.2,.3,.1,1.,0),
      fx({'overdrive': dict(drive=.4, mix=.45), 'delay': echo(.15, 3, .3)},
         mods=[('steps', SIXTEENTH, [('filter', 'cutoff', .4)])], macros=(TONE, DIRT)), 'squelchy',
      **LP_ENV(.3, .55, .75, .18, .1)),
    P('Soft Bell Arp', ins(sparse((1,1),(4,.25),(10,.08)), .001,.6,.0,.4,.8,0),
      fx({'delay': echo(.3, 4, .5), 'reverb': verb(.35, .65)}), 'lullaby'),
    P('Wide Saw Arp', ins(saw(1.1), .002,.25,.2,.15,.75,0), fx({'delay': echo(.25, 3, .4)}), 'big room',
      uni_voices=3, uni_detune=.25),
]
TEXTURES += [
    P('Glass Drone', ins(sparse((1,1),(2,.4),(5,.35),(8,.3),(12,.2)), 2.,2.,.95,3.,.9,.5),
      fx({'reverb': verb(.6, .95, .3, .9)}, mods=[('sine', B4, [('reverb', 'hicut', .15)])]), 'shimmer', uni_voices=3, uni_detune=.12),
    P('Ocean Air', ins(_norm([.7 + .3 * ((k * 53) % 11) / 11 for k in range(16)]), 2.5,2.,.9,3.,.7,.8),
      fx({'filter': dict(mode=0, cutoff=.5, reso=.3, mix=1), 'reverb': verb(.6, .9, .3)},
         mods=[('sine', B4, [('filter', 'cutoff', .35)])]), 'waves', air=.8),
    P('Granular Mist', ins(saw(1.4), 1.5,1.5,.85,2.5,.6,.4),
      fx({'cloud': dict(time=.4, density=.7, scatter=.6, feedback=.45, tone=.55, mix=.45), 'reverb': verb(.4, .8)}), 'grains'),
    P('Warm Hum', ins(sine([(2,.35),(3,.15),(4,.08)]), 2.,2.,.95,3.,.5,.4),
      fx({'reverb': verb(.45, .85, .2, .5)}, mods=[('triangle', B4, [('volume', 'level', .1)])]), 'tape hum', sub=.3),
    P('Starfield', ins(sparse((1,1),(3,.3),(6,.4),(9,.35),(14,.3)), 1.,2.,.6,3.,1.,.3),
      fx({'delay': echo(.35, 4, .6), 'reverb': verb(.65, 1., .35, 1.)}), 'twinkling', inharm=.15),
]
FXS += [
    P('Noise Uplifter', ins(_norm([1.] * 16), 3.,1.,1.,.6,.3,.8),
      fx({'filter': dict(mode=1, cutoff=.2, reso=.5, mix=1), 'reverb': verb(.45, .75)},
         mods=[('saw', B4, [('filter', 'cutoff', -1.)])]), 'build-up', air=1.),
    P('Sub Drop', ins(sine([(2,.2)]), .001,2.5,.0,1.5,.3,0),
      fx({'overdrive': dict(drive=.35, mix=.4), 'reverb': verb(.35, .7, .0, .4)}), 'boom fall', play_mode=2, glide=1.2, pitch=0.),
    P('Reverse Swell', ins(saw(1.3), 2.5,.1,1.,.05,.6,.3),
      fx({'reverb': verb(.6, .95, .3)}), 'backwards'),
    P('Radio Static', ins(_norm([.5 + .5 * ((k * 29) % 13) / 13 for k in range(16)]), .01,.6,.6,.3,1.,.9),
      fx({'bitcrusher': dict(rate=.5, bits=6, mix=.5), 'ringmod': dict(freq=.7, drive=.3, mix=.35), 'filter': dict(mode=2, cutoff=.6, reso=.4, mix=1)}), 'lofi radio'),
    P('Space Wash', ins(sparse((1,1),(2,.5),(3,.4),(5,.3),(7,.2)), 1.5,2.,.8,3.,.8,.6),
      fx({'delay': echo(.4, 4, .65), 'reverb': verb(.75, 1., .4, .8)},
         mods=[('sine', B2, [('delay', 'feedback', .2)])]), 'endless'),
]

PRESET_LIBRARY = []
for _category, _group in zip(CATEGORIES, [PADS, KEYS, BASS, LEADS, PLUCKS, BELLS, STRINGS, ARPS, TEXTURES, FXS]):
    for _p in _group: PRESET_LIBRARY.append(dict(category=_category, **finish(_p, _category)))
BY_NAME = {p['name']: p for p in PRESET_LIBRARY}

def preset(name):
    """Return a deep copy of one library preset, or None."""
    p = BY_NAME.get(name)
    return copy.deepcopy(p) if p else None

# ---------------------------------------------------------------- factory patterns
# Patterns are written in C so the sequencer's Transpose control moves them to any key.
BANKS = ['Bass lines', 'Chord progressions', 'Arps', 'Melodic hooks']
C2, C3, C4, C5 = 36, 48, 60, 72
MINOR = [0, 2, 3, 5, 7, 8, 10]

def _steps(length, events):
    """events: (step, [notes], velocity, tie)."""
    steps = [[] for _ in range(length)]
    for step, notes, vel, tie in events:
        for n in notes[:8]: steps[step].append(dict(note=int(n), velocity=int(vel), tie=int(tie)))
    return steps

def _pattern(name, length, events, gate=.8, swing=.5):
    return dict(name=name, pattern=dict(length=length, division='1/16', gate=gate, swing=swing,
                                        steps=_steps(length, events)))

def _line(notes, base, vel=100, accent=(), tie=1, every=1):
    """A monophonic line, one entry per step (None = rest)."""
    out = []
    for i, n in enumerate(notes):
        if n is None: continue
        out.append((i * every, [base + n], 120 if i in accent else vel, tie))
    return out

R = None
BASS_LINES = [
    ('Root pulse', [0,R,0,R,0,R,0,R,0,R,0,R,0,R,0,R]),
    ('Octave bounce', [0,12,0,12,0,12,0,12,3,15,3,15,5,17,5,17]),
    ('Offbeat drive', [R,0,R,0,R,0,R,0,R,3,R,3,R,5,R,7]),
    ('Minor walk', [0,R,3,R,5,R,7,R,10,R,7,R,5,R,3,R]),
    ('Acid sixteenths', [0,0,12,0,3,0,15,0,0,5,0,17,7,0,10,12]),
    ('Gallop', [0,R,0,0,0,R,0,0,3,R,3,3,5,R,5,5]),
    ('Syncopated funk', [0,R,R,0,R,R,10,R,12,R,R,7,R,5,R,3]),
    ('Dub steps', [0,R,R,R,R,R,0,R,R,R,-2,R,R,R,-5,R]),
    ('House stab', [R,R,0,R,R,R,0,R,R,R,0,R,R,R,3,R]),
    ('Rolling eighths', [0,R,0,R,7,R,0,R,10,R,0,R,7,R,5,R]),
    ('Descending', [12,R,10,R,8,R,7,R,5,R,3,R,2,R,0,R]),
    ('Pedal tone', [0,0,0,0,0,0,0,0,0,0,0,0,-2,-2,-4,-4]),
    ('Electro', [0,R,R,0,R,R,0,R,3,R,R,3,R,R,7,R]),
    ('Slow roots', [0,R,R,R,R,R,R,R,-4,R,R,R,-2,R,R,R]),
    ('Arp bass', [0,7,12,7,0,7,12,7,-4,3,8,3,-2,5,10,5]),
    ('Breakbeat bass', [0,R,R,R,R,R,0,0,R,R,3,R,R,R,5,R]),
]

# Chord progressions: four chords of half a bar each (8 steps, tied), 32 steps total.
CHORD_SHAPES = {'m': [0, 3, 7], 'M': [0, 4, 7], 'm7': [0, 3, 7, 10], 'M7': [0, 4, 7, 11],
                '7': [0, 4, 7, 10], 'sus': [0, 5, 7]}
def triad(root, kind='m'):
    return [root + n for n in CHORD_SHAPES[kind]]
PROGRESSIONS = [
    ('i–VI–III–VII', [(0,'m'),(-4,'M'),(3,'M'),(-2,'M')]),
    ('i–iv–v–i', [(0,'m'),(5,'m'),(7,'m'),(0,'m')]),
    ('I–V–vi–IV', [(0,'M'),(7,'M'),(9,'m'),(5,'M')]),
    ('ii–V–I–vi jazz', [(2,'m7'),(7,'7'),(0,'M7'),(9,'m7')]),
    ('Minor 7 drift', [(0,'m7'),(5,'m7'),(-2,'M7'),(3,'M7')]),
    ('Sus float', [(0,'sus'),(5,'sus'),(7,'sus'),(3,'sus')]),
    ('Andalusian', [(0,'m'),(-2,'M'),(-4,'M'),(-5,'M')]),
    ('Epic minor', [(0,'m'),(-4,'M'),(-7,'M'),(-2,'M')]),
    ('Dorian vamp', [(0,'m7'),(5,'7'),(0,'m7'),(5,'7')]),
    ('Pop lift', [(5,'M'),(7,'M'),(9,'m'),(0,'M')]),
    ('Dark pulse', [(0,'m'),(1,'M'),(0,'m'),(-2,'M')]),
    ('Major 7 dream', [(0,'M7'),(5,'M7'),(9,'m7'),(4,'m7')]),
    ('Gospel turn', [(0,'M'),(4,'7'),(9,'m'),(5,'M')]),
    ('Trance anthem', [(9,'m'),(5,'M'),(0,'M'),(7,'M')]),
    ('Lofi minor 7', [(2,'m7'),(7,'7'),(4,'m7'),(9,'7')]),
    ('Stabs on the and', None),
]

def _chords(name, prog):
    if prog is None:  # rhythmic stabs: short chords on the offbeats
        chords = [triad(0, 'm7'), triad(-4, 'M7')]
        events = [(s, [C4 + n for n in chords[s // 16 % 2]], 105, 1) for s in range(32) if s % 4 == 2]
        return _pattern(name, 32, events, gate=.5)
    events = []
    for i, (root, kind) in enumerate(prog):
        notes = [C4 + n for n in triad(root, kind)]
        notes = [n - 12 if n > C5 + 2 else n for n in notes]
        events.append((i * 8, notes + [C3 + root % 12], 95, 8))
    return _pattern(name, 32, events, gate=.9)

ARP_FIGURES = [
    ('Up triad', [0,3,7,12,0,3,7,12,0,3,7,12,0,3,7,12]),
    ('Down triad', [12,7,3,0,12,7,3,0,12,7,3,0,12,7,3,0]),
    ('Up and down', [0,3,7,12,15,12,7,3,0,3,7,12,15,12,7,3]),
    ('Octave pulse', [0,12,0,12,3,15,3,15,7,19,7,19,5,17,5,17]),
    ('Broken minor 7', [0,7,3,10,0,7,3,10,-2,5,2,8,-2,5,2,8]),
    ('Trance roll', [0,7,12,7,0,7,12,7,-4,3,8,3,-4,3,8,3]),
    ('Pentatonic run', [0,3,5,7,10,12,15,17,19,17,15,12,10,7,5,3]),
    ('Bubbles', [0,12,7,R,3,15,R,10,0,12,7,R,5,17,R,12]),
    ('Gated sixths', [0,8,0,8,0,8,0,8,-2,7,-2,7,-2,7,-2,7]),
    ('Rising fifths', [0,7,14,7,2,9,16,9,3,10,17,10,5,12,19,12]),
    ('Sparkle', [24,19,15,12,24,19,15,12,22,19,15,10,22,19,15,10]),
    ('Sus shimmer', [0,5,7,12,0,5,7,12,0,2,7,12,0,2,7,12]),
    ('Driving eighths', [0,R,7,R,12,R,7,R,3,R,10,R,15,R,10,R]),
    ('Synthwave', [0,3,7,3,12,3,7,3,-4,0,3,0,8,0,3,0]),
    ('Glass steps', [12,R,15,R,19,R,24,R,22,R,19,R,15,R,14,R]),
    ('Random-ish', [7,0,12,3,10,5,15,0,8,3,12,7,5,10,0,15]),
]

HOOKS = [
    ('Call and answer', [0,R,3,5,R,7,R,R,10,R,7,5,R,3,R,R]),
    ('Rising hook', [0,R,2,R,3,R,7,R,8,R,7,R,3,R,2,R]),
    ('Falling star', [12,R,R,10,R,R,7,R,8,R,R,7,R,R,3,R]),
    ('Pop riff', [7,R,7,5,R,3,R,0,R,3,5,R,3,R,R,R]),
    ('Minor motif', [0,3,7,R,5,3,R,R,0,3,8,R,7,5,R,R]),
    ('Long notes', [12,R,R,R,10,R,R,R,7,R,R,R,3,R,R,R]),
    ('Staccato', [0,R,0,R,3,R,R,5,R,7,R,R,5,R,3,R]),
    ('Blues lick', [0,3,5,6,7,R,10,R,12,R,10,7,R,5,3,R]),
    ('Anthem', [7,R,R,7,R,8,R,7,R,5,R,3,R,R,R,R]),
    ('Bell melody', [12,15,19,R,17,15,R,12,14,R,15,R,10,R,7,R]),
    ('Question', [0,R,R,2,R,3,R,R,7,R,R,R,R,R,5,R]),
    ('Answer', [5,R,R,3,R,2,R,R,0,R,R,R,R,R,R,R]),
    ('Arabesque', [0,1,4,5,7,R,8,7,5,4,1,0,R,R,R,R]),
    ('Dreamy', [7,R,12,R,14,R,R,R,12,R,7,R,5,R,R,R]),
    ('Chip tune', [12,R,19,R,24,R,19,R,15,R,22,R,27,R,22,R]),
    ('Ending phrase', [7,R,5,R,3,R,2,R,0,R,R,R,R,R,R,R]),
]

def _hook(name, notes):
    events = []
    for i, n in enumerate(notes):
        if n is None: continue
        # hold a note until the next one (up to 4 steps) so melodies sing
        nxt = next((j for j in range(i + 1, len(notes)) if notes[j] is not None), len(notes))
        events.append((i, [C4 + n], 110 if i % 4 == 0 else 96, max(1, min(4, nxt - i))))
    return _pattern(name, 16, events, gate=.85)

FACTORY_PATTERNS = [
    [_pattern(name, 16, _line(line, C2, 104, accent=(0, 8)), gate=.6) for name, line in BASS_LINES],
    [_chords(name, prog) for name, prog in PROGRESSIONS],
    [_pattern(name, 16, _line(line, C4, 96, accent=(0, 4, 8, 12)), gate=.55) for name, line in ARP_FIGURES],
    [_hook(name, notes) for name, notes in HOOKS],
]

def factory_bank(bank):
    """{'bank:slot': pattern} for one bank (1-4)."""
    bank = int(bank)
    if not 1 <= bank <= 4: raise ValueError('Pattern bank must be 1-4')
    return {f'{bank}:{i + 1}': copy.deepcopy(p['pattern']) for i, p in enumerate(FACTORY_PATTERNS[bank - 1])}

def ui_data():
    # The UI only needs what it shows; the engine applies the full preset (instrument and FX).
    presets = [dict(name=p['name'], category=p['category'], tags=p['tags'], instrument=p['instrument'],
                    fx=sorted(m['id'] for m in p['fx']['modules'] if m['on'])) for p in PRESET_LIBRARY]
    return dict(categories=CATEGORIES, presets=presets, banks=BANKS,
                patterns=[[p['name'] for p in bank] for bank in FACTORY_PATTERNS])

UI_JSON = Path(__file__).resolve().parent.parent / 'ui' / 'src' / 'library.json'

def ui_json():
    return json.dumps(ui_data(), separators=(',', ':'), sort_keys=True) + '\n'

if __name__ == '__main__':
    UI_JSON.write_text(ui_json()); print(f'wrote {UI_JSON} ({len(PRESET_LIBRARY)} presets)', file=sys.stderr)
