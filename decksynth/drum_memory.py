"""User-local kit defaults. Music projects and SONG/performance are never saved here."""
import copy
import json
import os
from pathlib import Path
import stat
import tempfile
from .drum_rack import validate_kit

MAX_SETTINGS_BYTES = 256 * 1024


def data_directory():
    explicit = os.environ.get('DECKSYNTH_DATA_DIR')
    if explicit: return Path(explicit).expanduser().resolve()
    if os.environ.get('DECKSYNTH_DIAGNOSTIC') == '1': return None
    return Path(os.environ.get('XDG_DATA_HOME') or Path.home()/'.local/share')/'decksynth'


def read_settings(path):
    """A corrupt or special-file setting cannot block startup or be silently overwritten."""
    try: fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    except FileNotFoundError: return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_SETTINGS_BYTES:
            raise ValueError('Invalid or oversized local kit settings')
        with os.fdopen(fd, 'rb') as f:
            fd = None; payload = f.read(MAX_SETTINGS_BYTES+1)
        if len(payload) > MAX_SETTINGS_BYTES: raise ValueError('Local kit settings are oversized')
        return json.loads(payload, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('Local kit settings could not be read') from exc
    finally:
        if fd is not None: os.close(fd)


def write_settings(path, value):
    payload = json.dumps(value, indent=2, allow_nan=False).encode()+b'\n'
    if len(payload) > MAX_SETTINGS_BYTES: raise ValueError('Local kit settings are oversized')
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.'+path.name+'-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(payload); f.flush(); os.fsync(f.fileno())
        os.replace(temporary, path)
    finally:
        try: os.unlink(temporary)
        except FileNotFoundError: pass


class KitMemory:
    def __init__(self, directory):
        self.path = Path(directory)/'last-drum-kits.json'

    @staticmethod
    def validate(value):
        if not isinstance(value,dict) or set(value)!={'version','selected','tracks'}:
            raise ValueError('Invalid remembered kit state')
        if type(value['version']) is not int or value['version']!=1: raise ValueError('Unsupported remembered kit version')
        from .devices import MIN_TRACKS, MAX_TRACKS
        if not isinstance(value['tracks'],list) or not MIN_TRACKS<=len(value['tracks'])<=MAX_TRACKS: raise ValueError('Invalid remembered tracks')
        if type(value['selected']) is not int or not 0<=value['selected']<len(value['tracks']): raise ValueError('Invalid remembered track')
        result = copy.deepcopy(value)
        for t in result['tracks']:
            if not isinstance(t,dict) or set(t)-{'device','drum_rack','sampler'}: raise ValueError('Invalid remembered device')
            if not t: continue
            if t.get('device') not in ('synth','drum_rack','sampler'): raise ValueError('Unknown remembered device')
            if 'drum_rack' in t: t['drum_rack'] = validate_kit(t['drum_rack'])
            elif t['device']=='drum_rack': raise ValueError('Remembered Drum Rack has no kit')
            if 'sampler' in t:
                from .sampler import validate_sampler
                t['sampler'] = validate_sampler(t['sampler'])
            elif t['device']=='sampler': raise ValueError('Remembered Sampler is missing')
        return result

    @staticmethod
    def capture(engine):
        tracks=[]
        for t in engine.project.tracks:
            row={}
            if 'drum_rack' in t:
                row=dict(device=t.get('device','synth'),drum_rack=copy.deepcopy(t['drum_rack']))
            elif 'device' in t: row=dict(device=t['device'])
            if 'sampler' in t: row=dict(row,device=t.get('device','synth'),sampler=copy.deepcopy(t['sampler']))
            tracks.append(row)
        return KitMemory.validate(dict(version=1, selected=engine.selected, tracks=tracks))

    def read(self):
        value=read_settings(self.path)
        return None if value is None else self.validate(value)

    def write(self, value):
        write_settings(self.path, self.validate(value))

    @staticmethod
    def restore(engine, value, grow=True):
        """grow: tracks added last time come back (up to 8). Without it (the app's launch, which starts with
        one track) only the tracks the engine has are filled."""
        if value is None: return
        clean=KitMemory.validate(value)  # Validate every track before applying any.
        grower=getattr(engine,'grow_tracks',None) if grow else None
        if grower: grower(len(clean['tracks']))
        for target, remembered in zip(engine.project.tracks,clean['tracks']):
            target.update(remembered)
        selected=clean['selected']
        if selected<len(engine.project.tracks) and engine.project.tracks[selected].get('device')=='drum_rack': engine.selected=selected
        engine.configure()
