"""Sampler recipes: the loaded sample becomes a bass pluck, an acid line, a swell lead, a pad and so on in one tap.

Settings only. The sample and its points (start, end, loop, slices, root, tune, gain) stay as they are; a recipe sets the play mode,
mono and glide, the amp envelope, the filter and its envelope, pan, and replaces the track's FX chain and its Reverb / Delay sends.
Each entry: id -> (name, kind, hint, settings, fx, sends). fx lists the effects that are on, in chain order, with their settings.
"""
import copy

# Every recipe starts from these (so one never inherits the last one); the Grain page's own settings are not touched.
BASE = dict(mode='hold', poly=True, glide=0., glide_mode='legato', attack=0., decay=0., sustain=1., release=.25,
            filter='off', cutoff=2000., resonance=.2, f_env=0., f_attack=0., f_hold=0., f_decay=.3, f_sustain=0., f_release=.3,
            f_env_vel=0., f_velocity=0., vel_attack=0., p_env=0., p_decay=.15, pan=0.)

RECIPES = {
    'bass_pluck': ('Bass Pluck', 'bass', 'Mono, short and round: a plucked bass with a quick filter snap',
        dict(poly=False, attack=0., decay=.25, sustain=.35, release=.12, filter='lp24', cutoff=420., resonance=.25,
             f_env=.6, f_decay=.18, f_sustain=0., f_release=.12, f_env_vel=.5),
        [('overdrive', dict(drive=.25, mix=.3))], dict()),
    'acid': ('Acid', 'bass', 'Mono with glide, a squelchy 24 dB filter and a bite of overdrive',
        dict(poly=False, glide=.07, glide_mode='always', attack=0., decay=.2, sustain=.5, release=.1, filter='lp24', cutoff=380.,
             resonance=.75, f_env=.8, f_decay=.22, f_sustain=0., f_release=.1, f_env_vel=.6),
        [('overdrive', dict(drive=.7, mix=.7))], dict(delay=.15)),
    'sub_bass': ('Sub Bass', 'bass', 'Mono and dark: only the low end of the sample, long and steady',
        dict(poly=False, attack=.01, decay=0., sustain=1., release=.2, filter='lp', cutoff=240., resonance=.1),
        [], dict()),
    'swell_lead': ('Swell Lead', 'lead', 'Mono lead that opens up as you hold it, with a wide chorus',
        dict(poly=False, glide=.05, attack=.35, decay=.3, sustain=.8, release=.5, filter='lp', cutoff=900., resonance=.3,
             f_env=.5, f_attack=.6, f_decay=.5, f_sustain=.5, f_release=.6),
        [('chorus', dict(rate=.25, depth=.5, voices=2, mix=.4, width=.5))], dict(reverb=.25)),
    'glide_lead': ('Glide Lead', 'lead', 'Mono lead that slides between every note, even detached ones',
        dict(poly=False, glide=.15, glide_mode='always', attack=.01, decay=0., sustain=1., release=.3, filter='lp', cutoff=2500., resonance=.2,
             f_env=.3, f_decay=.4, f_sustain=.4, f_release=.3, f_env_vel=.3),
        [('chorus', dict(rate=.2, depth=.4, voices=2, mix=.3, width=.4))], dict(delay=.25)),
    'chord_stab': ('Chord Stab', 'chords', 'Short chord hits: a quick filter pop, then silence',
        dict(attack=0., decay=.25, sustain=0., release=.25, filter='lp', cutoff=1200., resonance=.15,
             f_env=.5, f_decay=.2, f_sustain=0., f_release=.2, f_env_vel=.4),
        [('chorus', dict(rate=.3, depth=.4, voices=2, mix=.3, width=.5))], dict(reverb=.15)),
    'future_chords': ('Future Chords', 'chords', 'Big, wide, bright chords with a soft swell and a long tail',
        dict(attack=.01, decay=.3, sustain=.7, release=.5, filter='lp', cutoff=2200., resonance=.2,
             f_env=.4, f_decay=.4, f_sustain=.5, f_release=.5),
        [('chorus', dict(rate=.2, depth=.6, voices=3, mix=.55, width=.7))], dict(reverb=.3)),
    'soft_keys': ('Soft Keys', 'chords', 'Gentle keys that get brighter the harder you play',
        dict(attack=.005, decay=.6, sustain=.4, release=.6, filter='lp', cutoff=3500., resonance=.1,
             f_env=.2, f_decay=.5, f_sustain=.3, f_velocity=.3, f_env_vel=.3),
        [('chorus', dict(rate=.2, depth=.3, voices=2, mix=.25, width=.3))], dict(reverb=.2)),
    'space_pad': ('Space Pad', 'pad', 'Looping pad that fades in slowly and rings out into a big room',
        dict(mode='loop', attack=1.2, decay=.5, sustain=.8, release=2.5, filter='lp', cutoff=1400., resonance=.25,
             f_env=.3, f_attack=1.5, f_decay=1., f_sustain=.6, f_release=2.),
        [('chorus', dict(rate=.15, depth=.5, voices=3, mix=.4, width=.7)),
         ('cloud', dict(time=.4, density=.6, scatter=.4, feedback=.35, tone=.6, mix=.3))], dict(reverb=.45)),
    'cinematic_pad': ('Cinematic Pad', 'pad', 'A very slow, dark swell with a drifting cloud and echoes',
        dict(mode='loop', attack=2., decay=.5, sustain=.85, release=3., filter='lp24', cutoff=900., resonance=.2,
             f_env=.4, f_attack=2.2, f_decay=1., f_sustain=.5, f_release=2.5),
        [('cloud', dict(time=.6, density=.6, scatter=.5, feedback=.5, tone=.5, mix=.45))], dict(reverb=.6, delay=.2)),
    'shimmer_arp': ('Shimmer Arp', 'arp', 'Short, bright notes with echoes: made for the arpeggiator',
        dict(attack=0., decay=.3, sustain=.1, release=.4, filter='lp', cutoff=4000., resonance=.15,
             f_env=.3, f_decay=.25, f_sustain=.1, f_release=.3),
        [('chorus', dict(rate=.25, depth=.3, voices=2, mix=.2, width=.5))], dict(delay=.4, reverb=.3)),
}


def recipe_list():
    return [dict(id=k, name=v[0], kind=v[1], hint=v[2]) for k, v in RECIPES.items()]


def recipe_settings(recipe_id):
    """The Sampler settings a recipe sets (validated by the caller): the base plus the recipe's own."""
    if recipe_id not in RECIPES: raise ValueError('Unknown recipe')
    return {**BASE, **RECIPES[recipe_id][3]}


def recipe_chain(recipe_id, current=None):
    """The track's FX chain with every effect off but the recipe's. Macros, mod pads and the morph pad stay as they were."""
    from .fx import default_chain, default_module, validate_chain
    if recipe_id not in RECIPES: raise ValueError('Unknown recipe')
    chain = copy.deepcopy(current) if current else default_chain()
    modules = {m['id']: m for m in default_chain()['modules']}
    for m in modules.values(): m['on'] = False
    for fx_id, params in RECIPES[recipe_id][4]:
        modules[fx_id] = default_module(fx_id)
        modules[fx_id]['on'] = True
        modules[fx_id]['params'].update(params)
    chain['modules'] = [modules[m['id']] for m in chain['modules'] if m['id'] in modules] + [m for k, m in modules.items() if k not in {x['id'] for x in chain['modules']}]
    return validate_chain(chain)


def recipe_sends(recipe_id):
    if recipe_id not in RECIPES: raise ValueError('Unknown recipe')
    return {bus: RECIPES[recipe_id][5].get(bus, 0.) for bus in ('reverb', 'delay')}
