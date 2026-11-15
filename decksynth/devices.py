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


def track_index(track):
    if type(track) is not int or not 0 <= track < 4:
        raise ValueError('Choose track 1–4')
    return track
