"""Short-lived device-screen preview; MIDI/audio never opened and no project saved."""
import sys
import subprocess
import tkinter as tk
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.ui_smoke import NoWorker, example_state
from decksynth import app as ui

ui.mp.Process=NoWorker
root=tk.Tk()
app=ui.App(root)
p=example_state()
out=Path('/home/deck/Projects/deck-app/artifacts')
out.mkdir(parents=True,exist_ok=True)

app.updates.put_nowait(dict(
    state=p,selected=0,beat=8,playing=True,recording=False,
    devices=[],connected=None,voices=0,audio='pipewire',
    audio_output='Audio Coprocessor Speaker',
    audio_outputs=['Audio Coprocessor Speaker','Audio Coprocessor Headphones'],
    underruns=0
))

def capture(name):
    root.attributes('-topmost',True)
    root.lift()
    root.focus_force()
    root.update_idletasks()
    dest=str(out/name)
    done=subprocess.run(['spectacle','-b','-n','-a','-o',dest],
                        capture_output=True,text=True,timeout=8)
    assert done.returncode==0,done.stderr
    assert (out/name).stat().st_size>15000
    print('CAPTURED',dest,flush=True)

def song():
    app.draw_clips(8,playing=True,recording=False)
    capture('touch-song-with-real-model-notes.png')
    app.show('SOUND')
    root.after(750,sound)

def sound():
    app.draw_spectrum()
    capture('touch-sound-focused.png')
    root.after(100,root.destroy)

root.after(1100,song)
root.mainloop()
print('PREVIEW_COMPLETE — no MIDI hardware or user project used')
