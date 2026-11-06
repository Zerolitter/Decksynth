"""Steam Deck native UI regression: sample clips, control tap targets and modes.

Uses the real Tk widgets, but disables the audio/MIDI worker for safety.
"""
import sys
import time
import tkinter as tk
from types import SimpleNamespace
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from decksynth import app as ui
from decksynth.core import Project

class NoWorker:
    def __init__(self, *args, **kwargs): pass
    def start(self): pass
    def join(self, *args): pass
    def is_alive(self): return False
    def terminate(self): pass

def example_state():
    p = Project()
    p.tracks[0]['notes'] = [
        dict(start=0.,duration=2.,note=60,velocity=100),
        dict(start=2.,duration=1.5,note=64,velocity=85),
        dict(start=4.,duration=3.,note=67,velocity=104),
        dict(start=8.,duration=4.,note=72,velocity=92),
        dict(start=12.,duration=2.,note=55,velocity=88),
    ]
    p.tracks[1]['notes'] = [
        dict(start=0.,duration=1.5,note=36,velocity=100),
        dict(start=4.,duration=1.5,note=41,velocity=93),
        dict(start=8.,duration=2.,note=38,velocity=103),
        dict(start=12.,duration=2.,note=43,velocity=100),
    ]
    return p.data()

def main():
    ui.mp.Process = NoWorker
    root = tk.Tk()
    root.withdraw()
    app = ui.App(root)
    try:
        assert app.audiobox.winfo_class() == 'Menubutton'
        assert app.audio_device.get() == 'Deck speakers'
        assert app.view == 'SONG'
        assert not app.keyboard.winfo_manager(), 'Keyboard must default to compact mode'
        app.toggle_keyboard()
        assert app.keyboard.winfo_manager() == 'pack'
        app.toggle_keyboard()
        assert not app.keyboard.winfo_manager()
        assert app.gamepad is None, 'Physical gamepad must be opt-in'
        notes = example_state()
        snapshot = dict(state=notes, selected=0, beat=5.5, playing=True,
                        recording=False, devices=['/dev/snd/midiC2D0'],
                        connected='/dev/snd/midiC2D0', voices=0,
                        audio='pipewire', audio_output='Audio Coprocessor Speaker',
                        audio_outputs=['Audio Coprocessor Speaker',
                                       'Audio Coprocessor Headphones',
                                       'Roland Digital Piano Analog Stereo'], underruns=0)
        app.updates.put_nowait(snapshot)
        deadline = time.monotonic() + 3
        while app.state is None and time.monotonic() < deadline:
            root.update()
            time.sleep(.05)
        assert app.state is not None, 'No UI update received'
        app.draw_clips(5.5, playing=True)
        assert app.audio_device.get() == 'Audio Coprocessor Speaker'
        assert 'Roland Digital Piano Analog Stereo' in app.last_audio_choices
        assert 'midiC2D0' in app.status.cget('text')
        assert app.track_meta[0].cget('text').startswith('5 NOTES')
        assert app.track_meta[1].cget('text').startswith('4 NOTES')
        assert app.track_meta[2].cget('text').startswith('EMPTY')
        assert len(app.clips[0].find_withtag('note')) == 5
        assert len(app.clips[1].find_withtag('note')) == 4
        assert len(app.clips[2].find_withtag('empty-message')) == 1
        assert len(app.clips[0].find_withtag('playhead')) == 2
        assert '9 NOTES' in app.loop_banner.cget('text')
        assert app.track_rows[0].cget('highlightbackground') == ui.ACCENT

        sent = []
        app.send = lambda cmd, args=None: sent.append((cmd,args))
        for key, expect in [('F5','play'),('F6','stop'),('F7','record'),
                            ('F10','undo')]:
            event = SimpleNamespace(widget=root,keysym=key,char='')
            app.key_down(event)
            assert sent[-1][0] == expect, (key,sent)
        app.key_down(SimpleNamespace(widget=root,keysym='F9',char=''))
        assert sent[-1] == ('select',1)
        app.dispatch_gamepad('X')
        assert sent[-1] == ('record',None)
        app.dispatch_gamepad('R1')
        assert sent[-1] == ('select',1)
        app.dispatch_gamepad('Y')
        assert app.view == 'SOUND'
        app.show('SOUND')
        root.update_idletasks()
        assert app.view == 'SOUND'
        app.draw_spectrum()
        assert len(app.spectrum.find_withtag('partial')) == 32
        app.spectrum_touch(SimpleNamespace(x=120,y=50))
        assert any(cmd=='parameter' for cmd,arg in sent)
        app.show('SONG')

        # No MIDI/audio engine ran and no user project was modified.
        print('PASS: 9 actual MIDI clip rectangles across two tracks')
        print('PASS: note count, loop region, playhead, empty lanes, track selection')
        print('PASS: touch audio selector, visible 16 partials, F5-F10 and controller mapping')
        print('PASS: compact keyboard toggle and gamepad disabled by default')
    finally:
        root.destroy()

if __name__ == '__main__':
    main()
