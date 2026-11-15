"""Canonical device identities; legacy tracks omit 'device' and remain synths."""
DEVICE_REGISTRY = {
    'synth': {'name': 'Synth', 'version': 1},
    'drum_rack': {'name': 'Drum Rack', 'version': 1},
    'sampler': {'name': 'Sampler', 'version': 1},
}


def device_kind(track):
    kind = track.get('device', 'synth')
    if not isinstance(kind, str) or kind not in DEVICE_REGISTRY:
        raise ValueError('Unknown track device')
    return kind


MIN_TRACKS, MAX_TRACKS = 4, 8   # tracks can be added up to 8 (Sampler editing stage 10)


def track_index(track):
    if type(track) is not int or not 0 <= track < MAX_TRACKS:
        raise ValueError('Choose track 1–%d' % MAX_TRACKS)
    return track
