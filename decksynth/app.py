"""Compact native Tk desktop shell. No browser or network services."""
import copy
import multiprocessing as mp
from pathlib import Path
import queue
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from .backend import worker
from .core import PRESETS
from .touch_views import TouchViews

BG='#11151c'; PANEL='#1b222c'; FG='#e2e8f0'; MUTED='#8b9aac'; ACCENT='#65d6b0'; RED='#ef797f'
COLORS=[ACCENT,'#d5b676','#8aaff0','#c29be0']

class App(TouchViews):
    def __init__(self,root):
        self.root=root; root.title('DeckSynth'); root.geometry('1280x718'); root.minsize(1100,650); root.configure(bg=BG)
        self.commands=mp.Queue(512); self.updates=mp.Queue(32)
        self.proc=mp.Process(target=worker,args=(self.commands,self.updates),daemon=True)
        self.state=None; self.selected=0; self.syncing=False; self.view='SONG'; self.path=None; self.keys=set(); self.mouse_note=None; self.drag=None; self.dragging=False; self.close_after_save=False; self.gamepad=None
        root.bind_all('<ButtonPress-1>',lambda e:setattr(self,'dragging',True),add='+')
        root.bind_all('<ButtonRelease-1>',lambda e:setattr(self,'dragging',False),add='+')
        style=ttk.Style(); style.theme_use('clam')
        style.configure('.',background=BG,foreground=FG,font=('DejaVu Sans',11))
        style.configure('TButton',background=PANEL,foreground=FG,padding=(12,8),borderwidth=0)
        style.map('TButton',background=[('active','#304052')])
        style.configure('TCombobox',fieldbackground=PANEL,background=PANEL,foreground=FG,arrowsize=18)
        style.map('TCombobox',fieldbackground=[('readonly',PANEL)],foreground=[('readonly',FG)])
        style.configure('TCheckbutton',background=BG,foreground=FG)
        style.configure('TSpinbox',fieldbackground=PANEL,foreground=FG,arrowsize=18)
        style.configure('Transport.TButton', background='#2d3b4a', foreground=FG,
                        padding=(15,14), font=('DejaVu Sans',13,'bold'))
        style.configure('Record.TButton', background='#773c49', foreground='#fff0ef',
                        padding=(15,14), font=('DejaVu Sans',13,'bold'))
        style.configure('Tab.TButton', background='#23303c', foreground=FG,
                        padding=(25,12), font=('DejaVu Sans',13,'bold'))
        style.configure('ActiveTab.TButton', background='#35645e', foreground='#e6fff5',
                        padding=(25,12), font=('DejaVu Sans',13,'bold'))
        style.configure('Utility.TButton', background='#263341', foreground=FG,
                        padding=(10,11), font=('DejaVu Sans',11,'bold'))
        style.configure('Track.TButton', background='#304154', foreground=FG,
                        padding=(10,6), font=('DejaVu Sans',11,'bold'))
        style.configure('Lane.TButton', background='#263341', foreground=FG,
                        padding=(8,8), font=('DejaVu Sans',11,'bold'))
        for prefix in ('Transport','Record','Tab','ActiveTab','Utility','Track','Lane'):
            style.map(prefix+'.TButton', background=[('active','#415566')],
                      foreground=[('disabled','#7e8a96')])
        header=tk.Frame(root,bg=BG)
        header.pack(fill='x',padx=14,pady=(8,2))
        tk.Label(header,text='DECKSYNTH',fg=FG,bg=BG,
                 font=('DejaVu Sans',18,'bold')).pack(side='left',padx=(0,22))
        self.tab_song=self.button(header,'SONG',lambda:self.show('SONG'),'Tab.TButton')
        self.tab_song.pack(side='left',padx=(0,7))
        self.tab_sound=self.button(header,'SOUND',lambda:self.show('SOUND'),'Tab.TButton')
        self.tab_sound.pack(side='left')
        for caption,fn in [('OPEN',self.open),('SAVE',self.save),('MIDI EXPORT',self.export)]:
            self.button(header,caption,fn,'Utility.TButton').pack(side='right',padx=(5,0),ipady=3)

        transport=tk.Frame(root,bg=PANEL)
        transport.pack(fill='x',padx=14,pady=(2,3))
        self.play=self.button(transport,'▶ PLAY',lambda:self.send('play'),'Transport.TButton')
        self.play.pack(side='left',padx=(5,4),pady=5)
        self.button(transport,'■ STOP',lambda:self.send('stop'),'Transport.TButton').pack(
            side='left',padx=(0,4))
        self.rec=self.button(transport,'● RECORD',lambda:self.send('record'),'Record.TButton')
        self.rec.pack(side='left',padx=(0,14))
        self.bpm=tk.StringVar(value='120')
        self.bars=tk.StringVar(value='4')
        self.button(transport,'−',lambda:self.change_bpm(-5),'Utility.TButton').pack(side='left',ipadx=5)
        tk.Label(transport,textvariable=self.bpm,fg=FG,bg=PANEL,width=4,
                 font=('DejaVu Sans Mono',16,'bold')).pack(side='left')
        self.button(transport,'+',lambda:self.change_bpm(5),'Utility.TButton').pack(side='left',ipadx=5)
        tk.Label(transport,text='BPM',fg=MUTED,bg=PANEL,
                 font=('DejaVu Sans',10,'bold')).pack(side='left',padx=(6,15))
        self.bars_button=self.button(transport,'4 BARS',self.cycle_bars,'Utility.TButton')
        self.bars_button.pack(side='left',padx=(0,6),ipady=3)
        self.metro=tk.BooleanVar(value=False)
        self.metro_button=self.button(transport,'CLICK OFF',self.toggle_metronome,'Utility.TButton')
        self.metro_button.pack(side='left',ipady=3)
        self.position=tk.Label(transport,text='1.1',bg=PANEL,fg=ACCENT,
                               font=('DejaVu Sans Mono',16,'bold'))
        self.position.pack(side='right',padx=10)
        self.button(transport,'PANIC',lambda:self.send('panic'),'Utility.TButton').pack(
            side='right',padx=4,ipady=3)

        connection=tk.Frame(root,bg=BG)
        connection.pack(fill='x',padx=14,pady=(1,3))
        self.device=tk.StringVar(value='Auto')
        self.devicebox=tk.Menubutton(connection,text='MIDI  ·  AUTO',bg='#263441',fg=FG,
                                     activebackground='#405164',activeforeground=FG,
                                     relief='flat',pady=12,padx=12,indicatoron=True,
                                     font=('DejaVu Sans',11,'bold'))
        self.device_menu=tk.Menu(self.devicebox,tearoff=False,bg=PANEL,fg=FG,
                                  activebackground='#405164',activeforeground=FG,
                                  font=('DejaVu Sans',12))
        self.devicebox.config(menu=self.device_menu)
        self.devicebox.pack(side='left',padx=(0,8))
        self.audio_device=tk.StringVar(value='Deck speakers')
        self.audiobox=tk.Menubutton(connection,text='OUTPUT  ·  SPEAKERS',bg='#263441',fg=FG,
                                    activebackground='#405164',activeforeground=FG,
                                    relief='flat',pady=12,padx=12,indicatoron=True,
                                    font=('DejaVu Sans',11,'bold'))
        self.audio_menu=tk.Menu(self.audiobox,tearoff=False,bg=PANEL,fg=FG,
                                 activebackground='#405164',activeforeground=FG,
                                 font=('DejaVu Sans',12))
        self.audiobox.config(menu=self.audio_menu)
        self.audiobox.pack(side='left',padx=(0,9))
        self.last_midi_choices=None; self.last_audio_choices=None
        self.status=tk.Label(connection,text='INITIALIZING AUDIO / MIDI...',fg=MUTED,bg=BG,
                             anchor='w',font=('DejaVu Sans',10))
        self.status.pack(side='left',fill='x',expand=True)
        self.trackname=tk.StringVar(value='TRACK 1')
        self.trackbox=tk.Menubutton(connection,textvariable=self.trackname,bg='#304154',
                                    fg=FG,activebackground='#425467',activeforeground=FG,
                                    relief='flat',pady=12,padx=12,indicatoron=True,
                                    font=('DejaVu Sans',11,'bold'))
        self.track_menu=tk.Menu(self.trackbox,tearoff=False,bg=PANEL,fg=FG,
                                 activebackground='#405164',activeforeground=FG,
                                 font=('DejaVu Sans',12))
        for tr in range(4):
            self.track_menu.add_command(label=f'Track {tr+1}',
                                        command=lambda t=tr:self.send('select',t))
        self.trackbox.config(menu=self.track_menu)
        self.trackbox.pack(side='right')
        self.body=tk.Frame(root,bg=BG); self.body.pack(fill='both',expand=True,padx=18,pady=6)
        self.sound=tk.Frame(self.body,bg=BG); self.song=tk.Frame(self.body,bg=BG)
        self.build_sound(); self.build_song(); self.show('SONG')
        bottom=tk.Frame(root,bg=BG); bottom.pack(fill='x',padx=18,pady=(0,10))
        controls_hint=tk.Frame(bottom,bg=BG)
        controls_hint.pack(fill='x')
        self.message=tk.Label(controls_hint,text='F5 PLAY  ·  F6 STOP  ·  F7 RECORD  ·  F8/F9 TRACK  ·  F10 UNDO',
                              fg=MUTED,bg=BG,anchor='w')
        self.message.pack(side='left',fill='x',expand=True)
        self.keyboard_toggle=self.button(controls_hint,'HIDE KEYS',self.toggle_keyboard,'Lane.TButton')
        self.keyboard_toggle.configure(width=11)
        self.keyboard_toggle.pack(side='right')
        self.gamepad_button=self.button(controls_hint,'PAD OFF',self.toggle_gamepad,'Lane.TButton')
        self.gamepad_button.configure(width=9)
        self.gamepad_button.pack(side='right',padx=(0,6))
        self.keyboard=tk.Canvas(bottom,height=74,bg=PANEL,highlightthickness=0); self.keyboard.pack(fill='x',pady=(5,0))
        self.keyboard.bind('<Configure>',lambda e:self.draw_keyboard()); self.keyboard.bind('<ButtonPress-1>',self.key_touch); self.keyboard.bind('<B1-Motion>',self.key_touch); self.keyboard.bind('<ButtonRelease-1>',self.key_release)
        # Reserve room for the playable keyboard before the flexible track lanes.
        self.body.pack_forget(); bottom.pack_forget()
        bottom.pack(side='bottom',fill='x',padx=14,pady=(0,4))
        self.body.pack(fill='both',expand=True,padx=14,pady=(2,3))
        # Physical MIDI is primary; collapse the on-screen keyboard to show all four clips.
        self.keyboard.pack_forget()
        self.keyboard_toggle.config(text='SHOW KEYS')
        root.bind('<KeyPress>',self.key_down); root.bind('<KeyRelease>',self.key_up); root.bind('<FocusOut>',self.focus_out)
        root.protocol('WM_DELETE_WINDOW',self.close)
        self.proc.start(); self.poll()
    def button(self,parent,text,fn,style='TButton'):
        return ttk.Button(parent,text=text,command=fn,style=style)
    def toggle_keyboard(self):
        if self.keyboard.winfo_manager():
            self.keyboard.pack_forget()
            self.keyboard_toggle.config(text='SHOW KEYS')
        else:
            self.keyboard.pack(fill='x',pady=(5,0))
            self.keyboard_toggle.config(text='HIDE KEYS')
    def toggle_gamepad(self):
        if self.gamepad is not None:
            self.gamepad.close()
            self.gamepad=None
            self.gamepad_button.configure(text='PAD OFF')
            self.message.configure(text='GAMEPAD OFF  ·  STEAM INPUT REMAINS AVAILABLE',fg=MUTED)
            return
        try:
            from .gamepad import Gamepad
            self.gamepad=Gamepad()
            self.gamepad_button.configure(text='PAD ON')
            self.message.configure(text='GAMEPAD ON  ·  A PLAY  B STOP  X REC  Y PAGE  L1/R1 TRACK',fg=ACCENT)
        except (RuntimeError,OSError) as exc:
            self.message.configure(text=str(exc),fg=RED)
    def next_preset(self,step):
        presets=list(PRESETS)
        name=self.state['tracks'][self.selected]['preset'] if self.state else self.preset.get()
        index=presets.index(name) if name in presets else 0
        self.send('preset',presets[(index+step)%len(presets)])
    def dispatch_gamepad(self,name):
        simple={'A':'play','B':'stop','X':'record','BACK':'panic'}
        if name in simple:self.send(simple[name]);return
        if name=='Y':self.show('SOUND' if self.view=='SONG' else 'SONG');return
        if name in ('L1','LEFT','R1','RIGHT'):
            step=-1 if name in ('L1','LEFT') else 1
            self.send('select',(self.selected+step)%4);return
        if name in ('UP','DOWN'):
            step=1 if name=='UP' else -1
            if self.view=='SOUND':self.next_preset(step)
            else:self.change_bpm(step*5)
            return
        if name=='START':self.toggle_metronome()
    def change_bpm(self,step):
        try:
            current=int(float(self.bpm.get()))
        except (ValueError,TypeError):
            current=120
        target=max(30,min(240,current+step))
        self.bpm.set(str(target))
        self.send('tempo',target)
    def cycle_bars(self):
        order=(1,2,4,8)
        try:current=int(self.bars.get())
        except ValueError:current=4
        nxt=order[(order.index(current)+1)%len(order)] if current in order else 4
        self.send('bars',nxt)
    def toggle_metronome(self):
        nxt=not self.metro.get()
        self.metro.set(nxt)
        self.send('metronome',nxt)
    @staticmethod
    def output_label(name):
        if name=='Deck speakers' or 'Coprocessor Speaker' in name:return 'SPEAKERS'
        if 'Coprocessor Headphones' in name:return 'HEADPHONES'
        if 'Roland Digital Piano' in name:return 'ROLAND USB'
        if name=='System default':return 'SYSTEM DEFAULT'
        return name[:22].upper()
    def set_audio_device(self,name):
        self.audio_device.set(name)
        self.send('audio_device',name)
    def set_midi_device(self,name):
        self.device.set(name)
        self.send('device',name)
    def update_device_ui(self,latest):
        midis=['Auto']+latest.get('devices',[])
        audios=list(dict.fromkeys(['Deck speakers','System default']+latest.get('audio_outputs',[])))
        if midis!=self.last_midi_choices:
            self.device_menu.delete(0,'end')
            for name in midis:
                self.device_menu.add_command(label=name,command=lambda n=name:self.set_midi_device(n))
            self.last_midi_choices=midis
        if audios!=self.last_audio_choices:
            self.audio_menu.delete(0,'end')
            for name in audios:
                self.audio_menu.add_command(label=self.output_label(name),
                                            command=lambda n=name:self.set_audio_device(n))
            self.last_audio_choices=audios
        midi=self.device.get()
        self.devicebox.config(text='MIDI  ·  AUTO' if midi=='Auto' else 'MIDI  ·  '+midi.split('/')[-1])
        chosen=latest.get('audio_output','Deck speakers')
        self.audio_device.set(chosen)
        self.audiobox.config(text='OUTPUT  ·  '+self.output_label(chosen))

    def send(self,cmd,args=None):
        try:self.commands.put_nowait((cmd,args))
        except queue.Full:self.message.configure(text='Command queue full — stop playback and restart if unresponsive',fg=RED)
    def show(self,name):
        self.view=name; self.sound.pack_forget(); self.song.pack_forget()
        (self.sound if name=='SOUND' else self.song).pack(fill='both',expand=True)
        if hasattr(self,'tab_song'):
            self.tab_song.configure(style='ActiveTab.TButton' if name=='SONG' else 'Tab.TButton')
            self.tab_sound.configure(style='ActiveTab.TButton' if name=='SOUND' else 'Tab.TButton')

    def tempo(self):
        if self.syncing:return
        try:
            val=float(self.bpm.get())
            if not 30<=val<=240:raise ValueError()
            if self.state and val!=self.state['bpm']:self.send('tempo',val)
        except ValueError:self.bpm.set(str(self.state['bpm'] if self.state else 120))
    def slider(self,parent,label,lo,hi,callback,vertical=False):
        f=tk.Frame(parent,bg=PANEL); v=tk.DoubleVar()
        tk.Label(f,text=label,bg=PANEL,fg=MUTED,font=('DejaVu Sans',10)).pack()
        s=tk.Scale(f,from_=hi if vertical else lo,to=lo if vertical else hi,orient='vertical' if vertical else 'horizontal',variable=v,resolution=.001,command=callback,bg=PANEL,fg=FG,troughcolor=BG,highlightthickness=0,activebackground=ACCENT,length=160 if vertical else 150,width=16,showvalue=False,borderwidth=0)
        s.pack(fill='both',expand=True,padx=5,pady=4); return f,v
    def parameter(self,key,index,value):
        if not self.syncing:
            val=float(value)
            if self.state:
                p=self.state['tracks'][self.selected]['instrument']; old=p[key][index] if key=='harmonics' else p[key]
                if abs(old-val)<.0001:return
            self.send('parameter',(key,index,val))
    def volume(self,tr,value):
        self.volume_vars[tr].set(float(value))
        self.volume_buttons[tr].configure(text=f'VOL {round(float(value)*100)}%')
        if not self.syncing:self.send('track',(tr,'volume',float(value)))
    def clip_down(self,e,tr):
        if not self.state:return
        self.send('select',tr); idx=self.hit(e,tr)
        self.drag=(tr,idx,e.x,e.y,copy.deepcopy(self.state['tracks'][tr]['notes'][idx])) if idx is not None else None
    def clip_up(self,e,tr):
        if self.drag and self.drag[0]==tr:
            _,idx,x,y,n=self.drag
            if abs(e.x-x)+abs(e.y-y)>4:
                beat,pitch=self.clip_coords(e,tr); n['start']=round(beat*4)/4%(self.state['bars']*4); n['note']=pitch; self.send('edit_note',(tr,idx,n))
        self.drag=None
    def clip_add(self,e,tr):
        if not self.state or self.hit(e,tr) is not None:return
        beat,pitch=self.clip_coords(e,tr)
        self.send('edit_note',(tr,None,dict(start=round(beat*4)/4%(self.state['bars']*4),duration=1.,note=pitch,velocity=100)))
    def clip_delete(self,e,tr):
        if not self.state:return
        idx=self.hit(e,tr)
        if idx is not None:self.send('edit_note',(tr,idx,None))
    def draw_keyboard(self):
        c=self.keyboard; c.delete('all'); w=c.winfo_width()/24
        height=max(30,c.winfo_height())
        for i in range(24):
            n=48+i; black=n%12 in (1,3,6,8,10)
            c.create_rectangle(i*w+1,1,(i+1)*w-1,height-2,fill=ACCENT if n in self.keys or n==self.mouse_note else '#283341' if black else '#b3bfc9',outline='')
            if n%12==0:c.create_text(i*w+8,height-17,text=f'C{n//12-1}',anchor='w',fill=BG,font=('DejaVu Sans',10))
    def key_touch(self,e):
        note=max(48,min(71,48+int(e.x/max(1,self.keyboard.winfo_width())*24)))
        if note!=self.mouse_note:
            self.key_release(None); self.mouse_note=note; self.send('midi',(0x90,note,100)); self.draw_keyboard()
    def key_release(self,e):
        if self.mouse_note is not None:self.send('midi',(0x80,self.mouse_note,0)); self.mouse_note=None; self.draw_keyboard()
    def key_down(self,e):
        if e.widget.winfo_class() in ('TEntry','TSpinbox','TCombobox','Entry'):return
        controls={'F5':'play','F6':'stop','F7':'record','F10':'undo'}
        if e.keysym in controls:
            self.send(controls[e.keysym]); return 'break'
        if e.keysym in ('F8','F9'):
            self.send('select',(self.selected + (-1 if e.keysym=='F8' else 1))%4)
            return 'break'
        if e.keysym=='space':self.send('play'); return 'break'
        mapping='awsedftgyhujkolp'
        if e.char and e.char.lower() in mapping:
            n=60+mapping.index(e.char.lower())
            if n not in self.keys:self.keys.add(n); self.send('midi',(0x90,n,100)); self.draw_keyboard()
    def key_up(self,e):
        mapping='awsedftgyhujkolp'
        if e.char and e.char.lower() in mapping:
            n=60+mapping.index(e.char.lower())
            if n in self.keys:self.keys.remove(n); self.send('midi',(0x80,n,0)); self.draw_keyboard()
    def focus_out(self,e):
        def check():
            if self.root.focus_displayof() is None:self.keys.clear(); self.mouse_note=None; self.send('panic'); self.draw_keyboard()
        self.root.after(30,check)
    def choose(self,save,ext,title):
        fn=filedialog.asksaveasfilename if save else filedialog.askopenfilename
        return fn(parent=self.root,title=title,initialdir=str(Path.home()/'Music'),defaultextension=ext,filetypes=[(title,'*'+ext)])
    def save(self):
        path=self.path or self.choose(True,'.decksynth','DeckSynth project')
        if path:self.path=path; self.send('save',path)
    def open(self):
        path=self.choose(False,'.decksynth','DeckSynth project')
        if path:self.send('load',path)
    def export(self):
        path=self.choose(True,'.mid','Standard MIDI file')
        if path:self.send('export',path)
    def save_preset(self):
        path=self.choose(True,'.dspreset','DeckSynth instrument')
        if path:self.send('save_preset',path)
    def load_preset(self):
        path=self.choose(False,'.dspreset','DeckSynth instrument')
        if path:self.send('load_preset',path)
    def poll(self):
        latest=None
        try:
            while True:
                obj=self.updates.get_nowait()
                if 'error' in obj:
                    self.close_after_save=False; self.message.configure(text=obj['error'],fg=RED)
                elif 'message' in obj:
                    self.message.configure(text=obj['message'],fg=ACCENT)
                    if obj['message'].startswith('Opened '):self.path=obj['message'][7:]
                    if self.close_after_save and obj['message'].startswith('Saved '):self.shutdown(); return
                else:latest=obj
        except queue.Empty:pass
        if latest:
            self.state=latest['state']; self.selected=latest['selected']; self.syncing=True
            self.trackname.set('TRACK '+str(self.selected+1))
            t=self.state['tracks'][self.selected]; self.preset.set(t['preset'])
            # Never overwrite a slider while it is being dragged.
            for i,v in enumerate(self.harmonic_vars):
                value=t['instrument']['harmonics'][i]
                if not self.dragging and abs(v.get()-value)>.0001:v.set(value)
            for key,v in self.param_vars.items():
                value=t['instrument'][key]
                if not self.dragging and abs(v.get()-value)>.0001:v.set(value)
            self.bars.set(str(self.state['bars'])); self.metro.set(self.state['metronome'])
            self.bars_button.configure(text=str(self.state['bars'])+' BARS')
            self.metro_button.configure(text='CLICK ON' if self.metro.get() else 'CLICK OFF')
            self.bpm.set(str(int(self.state['bpm'])))
            for i,t in enumerate(self.state['tracks']):
                self.track_labels[i].configure(text=f'{i+1}  {t["preset"]}'); self.mute_vars[i].set(t['mute'])
                if not self.dragging:
                    self.volume_vars[i].set(t['volume'])
                    self.volume_buttons[i].configure(text=f'VOL {round(t["volume"]*100)}%')
            self.syncing=False
            self.play.configure(text='Ⅱ PAUSE' if latest['playing'] else '▶ PLAY')
            self.rec.configure(text='● FINISH TAKE' if latest['recording'] else '● RECORD')
            beat=latest['beat']; self.position.configure(text=f'{int(beat//4)+1}.{int(beat%4)+1}')
            self.update_device_ui(latest)
            connected=latest.get('connected')
            self.status.configure(text=(('MIDI CONNECTED  ·  '+connected.split('/')[-1])
                                         if connected else 'MIDI NOT CONNECTED')+
                                  f'   ·   {latest["voices"]} VOICES  ·  {latest["underruns"]} UNDERRUNS',
                                  fg=ACCENT if connected else MUTED)
            self.draw_clips(beat,latest['playing'],latest['recording'])
            self.draw_spectrum()
        if self.gamepad is not None:
            try:
                buttons=self.gamepad.rising_buttons()
                if self.root.focus_displayof() is not None:
                    for button in buttons:self.dispatch_gamepad(button)
            except RuntimeError as exc:
                self.toggle_gamepad()
                self.message.configure(text=str(exc),fg=RED)
        self.root.after(50,self.poll)
    def close(self):
        result=messagebox.askyesnocancel('Close DeckSynth','Save the project before closing?',parent=self.root)
        if result is None:return
        if result:
            path=self.path or self.choose(True,'.decksynth','DeckSynth project')
            if not path:return
            self.close_after_save=True; self.send('stop'); self.send('save',path); return
        self.shutdown()
    def shutdown(self):
        if self.gamepad is not None:
            self.gamepad.close(); self.gamepad=None
        self.send('quit'); self.proc.join(2)
        if self.proc.is_alive():self.proc.terminate(); self.proc.join()
        self.root.destroy()

def main():
    mp.set_start_method('spawn',force=True)
    try:root=tk.Tk()
    except tk.TclError as exc:
        raise SystemExit(f'DeckSynth needs a desktop display: {exc}')
    App(root); root.mainloop()
