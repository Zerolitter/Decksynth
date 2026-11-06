"""Steam Deck-first touch panels and readable four-track MIDI clip visuals.

This module owns presentation only: all MIDI, audio and song data remain in core/backend.
"""
import math
import tkinter as tk
from tkinter import ttk
from .core import PRESETS

BG = '#11151c'
PANEL = '#1b222c'
FG = '#e2e8f0'
MUTED = '#a0adbc'
ACCENT = '#65d6b0'
RED = '#ef797f'
COLORS = [ACCENT, '#d5b676', '#8aaff0', '#c29be0']


def pitch_limits(notes):
    """Keep the original keyboard-range visual when empty, expand for real clips."""
    if not notes:
        return (48, 84)
    pitches = [n['note'] for n in notes]
    low = max(0, min(48, min(pitches) - 3))
    high = min(127, max(84, max(pitches) + 3))
    return low, high


def note_rectangle(note, beats, width, height, bounds):
    """Geometry used by both painting and hit testing (not a simulated clip)."""
    low, high = bounds
    left, right = 10.0, max(11.0, width - 10.0)
    content_top, content_bottom = 26.0, max(43.0, height - 7.0)
    x = left + note['start'] / beats * (right - left)
    end = left + (note['start'] + note['duration']) / beats * (right - left)
    y = content_bottom - (note['note'] - low) / max(1, high - low) * (content_bottom - content_top)
    half = max(5.5, min(10.0, (content_bottom - content_top) / 5))
    return (x, y - half, max(x + 9, end), y + half)


class TouchViews:
    def build_song(self):
        top = tk.Frame(self.song, bg=BG)
        top.pack(fill='x', pady=(0, 7))
        self.loop_banner = tk.Label(top, text='4 TRACKS  ·  READY TO RECORD', bg=BG, fg=FG,
                                    font=('DejaVu Sans', 15, 'bold'))
        self.loop_banner.pack(side='left')
        for caption, command in [('CLEAR', 'clear'), ('QUANTIZE', 'quantize'), ('UNDO', 'undo')]:
            self.button(top, caption, lambda c=command: self.send(c), 'Utility.TButton').pack(
                side='right', padx=(8, 0), ipady=3)

        self.clips, self.track_labels, self.track_meta = [], [], []
        self.track_rows, self.mute_buttons = [], []
        self.volume_buttons = []
        self.mute_vars, self.volume_vars = [], []
        for tr in range(4):
            row = tk.Frame(self.song, bg=PANEL, highlightthickness=2,
                           highlightbackground='#303d4a', highlightcolor='#303d4a')
            row.pack(fill='both', expand=True, pady=4)
            self.track_rows.append(row)
            left = tk.Frame(row, bg=PANEL, width=218)
            left.pack(side='left', fill='y')
            left.pack_propagate(False)
            track = self.button(left, f'{tr + 1}  {self.track_name(tr)}',
                                lambda t=tr: self.send('select', t), 'Track.TButton')
            track.pack(fill='x', padx=6, pady=(2, 0))
            self.track_labels.append(track)
            info = tk.Label(left, text='EMPTY · 4 BARS', anchor='w', bg=PANEL, fg=MUTED,
                            font=('DejaVu Sans', 10, 'bold'))
            # Count/status is drawn inside the clip ruler, freeing vertical room for all four lanes.
            self.track_meta.append(info)
            controls = tk.Frame(left, bg=PANEL)
            controls.pack(fill='x', padx=5, pady=(0, 1))
            mute = tk.BooleanVar(value=False)
            self.mute_vars.append(mute)
            mb = self.button(controls, 'MUTE', lambda t=tr: self.toggle_mute(t),
                             'Lane.TButton')
            mb.configure(width=6)
            mb.pack(side='left', padx=(0, 4))
            self.mute_buttons.append(mb)
            volume = tk.DoubleVar(value=.7)
            self.volume_vars.append(volume)
            level = tk.Menubutton(controls, text='VOL 70%', relief='flat',
                                  font=('DejaVu Sans',11,'bold'), bg='#304154', fg=FG,
                                  activebackground='#486176', activeforeground=FG,
                                  indicatoron=True, pady=8, padx=8)
            menu = tk.Menu(level, tearoff=False, bg=PANEL, fg=FG,
                           activebackground='#415b70', activeforeground=FG,
                           font=('DejaVu Sans',13))
            for pct in (0,25,50,70,75,100):
                menu.add_command(label=f'{pct}% volume',
                                 command=lambda t=tr,v=pct/100:self.volume(t,v))
            level.configure(menu=menu)
            level.pack(side='left', fill='x', expand=True)
            self.volume_buttons.append(level)
            c = tk.Canvas(row, bg='#121a25', height=78, highlightthickness=0,
                          bd=0, cursor='hand2')
            c.pack(side='left', fill='both', expand=True, padx=(0, 5), pady=5)
            c.bind('<ButtonPress-1>', lambda e,t=tr:self.clip_down(e,t))
            c.bind('<ButtonRelease-1>', lambda e,t=tr:self.clip_up(e,t))
            c.bind('<Double-Button-1>', lambda e,t=tr:self.clip_add(e,t))
            c.bind('<Button-3>', lambda e,t=tr:self.clip_delete(e,t))
            self.clips.append(c)

        self.song_hint = tk.Label(
            self.song,
            text='TAP A TRACK TO PLAY IT  ·  RECORD FILLS A LOOP  ·  DRAG A NOTE TO MOVE IT',
            bg=BG, fg=MUTED, anchor='w', font=('DejaVu Sans', 10))
        # SONG communicates the workflow through large actions and clip labels; keep this hint optional.

    def track_name(self, tr):
        if self.state:
            return self.state['tracks'][tr]['preset'].upper()
        return ['WARM KEYS', 'BASS', 'PAD', 'BELL'][tr]

    def toggle_mute(self, tr):
        nxt = not self.mute_vars[tr].get()
        self.mute_vars[tr].set(nxt)
        self.send('track', (tr, 'mute', nxt))

    def draw_clips(self, beat, playing=False, recording=False):
        if not self.state:
            return
        beats = self.state['bars'] * 4
        tracks = self.state['tracks']
        total_notes = sum(len(track['notes']) for track in tracks)
        if recording:
            summary = f'● RECORDING TRACK {self.selected + 1}  ·  {self.state["bars"]} BARS'
        elif playing:
            summary = f'▶ LOOP PLAYING  ·  {total_notes} NOTES'
        else:
            summary = f'4 TRACKS  ·  {total_notes} NOTES  ·  {self.state["bars"]} BARS'
        self.loop_banner.config(text=summary, fg=RED if recording else ACCENT if playing else FG)

        for tr, canvas in enumerate(self.clips):
            track = tracks[tr]
            notes = track['notes']
            w, h = max(canvas.winfo_width(), 120), max(canvas.winfo_height(), 58)
            color = COLORS[tr]
            selected = tr == self.selected
            active_rec = selected and recording
            self.track_rows[tr].config(highlightbackground=RED if active_rec else color if selected else '#303d4a')
            self.track_labels[tr].config(text=f'{tr + 1}  {track["preset"].upper()}')
            self.track_meta[tr].config(
                text=('● REC  ·  ' if active_rec else '') +
                    (f'{len(notes)} NOTE{"S" if len(notes)!=1 else ""}  ·  ' if notes else 'EMPTY  ·  ') +
                    f'{self.state["bars"]} BARS',
                fg=RED if active_rec else color if notes else MUTED)
            self.mute_buttons[tr].config(text='UNMUTE' if track['mute'] else 'MUTE')

            canvas.delete('all')
            canvas.create_rectangle(0, 0, w, h, fill='#121a25', outline='', tags='track-bg')
            # A visible region means notes really exist, not a fake pre-recorded clip.
            if notes:
                canvas.create_rectangle(9, 25, w - 9, h - 6, fill='#253344',
                                        outline=color if selected else '#364a5b',
                                        width=2, tags='recorded-loop')
            count_label = (f'● REC  ·  {len(notes)} NOTES' if active_rec else
                           f'{len(notes)} NOTE' + ('' if len(notes)==1 else 'S') if notes else 'EMPTY')
            canvas.create_text(w - 17, 12, text=count_label, anchor='e',
                               fill=RED if active_rec else color if notes else MUTED,
                               font=('DejaVu Sans',10,'bold'), tags='clip-count')
            for bar in range(self.state['bars']):
                x = 10 + (w - 20) * bar / self.state['bars']
                canvas.create_text(x + 8, 12, text=f'{bar + 1}', anchor='w',
                                   fill=FG if selected else MUTED,
                                   font=('DejaVu Sans', 10, 'bold'), tags='bar-number')
                canvas.create_line(x, 25, x, h - 6, fill='#415268', width=2)
            for b in range(1, beats):
                if b % 4:
                    x = 10 + (w - 20) * b / beats
                    canvas.create_line(x, 27, x, h - 7, fill='#334253', dash=(2, 5))
            bounds = pitch_limits(notes)
            for idx, note in enumerate(notes):
                x1, y1, x2, y2 = note_rectangle(note, beats, w, h, bounds)
                x2 = min(w - 10, x2)
                fill = '#718393' if track['mute'] else color
                canvas.create_rectangle(x1, y1, max(x1 + 6, x2), y2,
                                        fill=fill, outline='#dae2eb' if selected else fill,
                                        width=1, tags=('note', f'note-{idx}'))
                if x2 > x1 + 47:
                    canvas.create_text(x1 + 6, (y1 + y2) / 2,
                                       anchor='w', text=self.midi_note_name(note['note']),
                                       font=('DejaVu Sans', 9, 'bold'), fill='#10212a',
                                       tags=('note-label', f'note-{idx}'))
                if x2 < x1 + 7 and note['start'] + note['duration'] > beats:
                    pass
                # A held note may cross the seam between bar 4 and bar 1.
                if note['start'] + note['duration'] > beats:
                    over = (note['start'] + note['duration'] - beats) / beats * (w - 20)
                    canvas.create_rectangle(10, y1, min(w - 10, 10 + over), y2,
                                            fill=fill, outline=fill, tags=('note', f'note-{idx}'))
            if not notes:
                canvas.create_text(w / 2, max(41, (h + 22) / 2),
                                   text='EMPTY LOOP  ·  PRESS RECORD TO ADD NOTES',
                                   fill='#7e8c9b', font=('DejaVu Sans', 12),
                                   tags='empty-message')
            if playing or recording:
                x = 10 + (w - 20) * (beat % beats) / beats
                canvas.create_line(x, 0, x, h - 4, width=3, fill=RED if active_rec else '#eff5f9',
                                   tags='playhead')
                canvas.create_polygon(x - 6, 1, x + 6, 1, x, 11,
                                      fill=RED if active_rec else '#eff5f9', tags='playhead')

    @staticmethod
    def midi_note_name(note):
        names = ('C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B')
        return f'{names[note % 12]}{note // 12 - 1}'

    def clip_coords(self, e, tr):
        canvas = self.clips[tr]
        beats = self.state['bars'] * 4
        w, h = max(canvas.winfo_width(), 120), max(canvas.winfo_height(), 58)
        low, high = pitch_limits(self.state['tracks'][tr]['notes'])
        beat = max(0., min(beats - .001, (e.x - 10) / max(1, w - 20) * beats))
        note = int(round(high - (e.y - 26) / max(1, h - 33) * (high - low)))
        return beat, max(0, min(127, note))

    def hit(self, e, tr):
        canvas = self.clips[tr]
        notes = self.state['tracks'][tr]['notes']
        bounds = pitch_limits(notes)
        w, h = max(canvas.winfo_width(), 120), max(canvas.winfo_height(), 58)
        for idx in range(len(notes) - 1, -1, -1):
            x1, y1, x2, y2 = note_rectangle(notes[idx], self.state['bars'] * 4, w, h, bounds)
            if x1 - 4 <= e.x <= min(w - 10, x2) + 4 and y1 - 6 <= e.y <= y2 + 6:
                return idx
        return None

    def build_sound(self):
        top = tk.Frame(self.sound, bg=BG)
        top.pack(fill='x', pady=(0, 6))
        tk.Label(top, text='SPECTRUM  ·  TOUCH A HARMONIC TO SHAPE IT', fg=FG, bg=BG,
                 font=('DejaVu Sans', 13, 'bold')).pack(side='left')
        self.preset = tk.StringVar(value='Warm Keys')
        self.presetbox = tk.Menubutton(top, textvariable=self.preset, bg='#303e4e',
                                       activebackground='#425467', activeforeground=FG,
                                       fg=FG, relief='flat', padx=16, pady=12,
                                       font=('DejaVu Sans', 13, 'bold'), indicatoron=True)
        self.preset_menu = tk.Menu(self.presetbox, tearoff=False, bg=PANEL, fg=FG,
                                    activebackground='#395467', activeforeground=FG,
                                    font=('DejaVu Sans', 13))
        for name in PRESETS:
            self.preset_menu.add_command(label=name, command=lambda n=name:self.send('preset', n))
        self.presetbox.configure(menu=self.preset_menu)
        self.presetbox.pack(side='left', padx=15)
        for name, callback in [('SAVE SOUND', self.save_preset), ('LOAD SOUND', self.load_preset)]:
            self.button(top, name, callback, 'Utility.TButton').pack(side='right', padx=(5, 0), ipady=3)

        self.harmonic_vars = [tk.DoubleVar(value=0.) for _ in range(16)]
        self.spectrum = tk.Canvas(self.sound, height=170, bg=PANEL,
                                  highlightthickness=0, cursor='hand2', bd=0)
        self.spectrum.bind('<ButtonPress-1>', self.spectrum_touch)
        self.spectrum.bind('<B1-Motion>', self.spectrum_touch)
        self.spectrum.bind('<Configure>', lambda e:self.draw_spectrum())
        hint = tk.Label(self.sound, text='TAP / DRAG THE 16 BARS  ·  MIDI NOTES AND PRESETS KEEP THEIR ORIGINAL TIMING',
                        fg=MUTED, bg=BG, font=('DejaVu Sans', 10))
        macro_grid = tk.Frame(self.sound, bg=BG)
        self.param_vars = {}
        specs = [('attack', 'ATTACK (s)', .001, 3),
                 ('decay', 'DECAY (s)', .001, 3),
                 ('sustain', 'SUSTAIN', 0, 1),
                 ('release', 'RELEASE (s)', .01, 3),
                 ('filter', 'BRIGHTNESS', .02, 1),
                 ('modulation', 'MOTION', 0, 1)]
        for idx, (key, label, lo, hi) in enumerate(specs):
            box = tk.Frame(macro_grid, bg=PANEL, padx=11, pady=2)
            box.grid(row=idx // 3, column=idx % 3, sticky='ew', padx=3, pady=3)
            macro_grid.grid_columnconfigure(idx % 3, weight=1, uniform='macro')
            tk.Label(box, text=label, fg=FG, bg=PANEL,
                     font=('DejaVu Sans', 11, 'bold')).pack(anchor='w')
            value = tk.DoubleVar(value=0.)
            self.param_vars[key] = value
            tk.Scale(box, from_=lo, to=hi, orient='horizontal', variable=value,
                     resolution=.01 if hi <= 1 else .02, showvalue=True, digits=3,
                     sliderlength=38, width=20, bd=0, highlightthickness=0,
                     font=('DejaVu Sans', 11), bg=PANEL, fg=FG,
                     troughcolor='#0a121c', activebackground=ACCENT,
                     command=lambda val,k=key:self.parameter(k,None,val)).pack(fill='x')
        # Reserve both macro rows before allocating flexible spectrum height.
        macro_grid.pack(side='bottom', fill='x', pady=(0, 0))
        hint.pack(side='bottom', fill='x', pady=(3, 2))
        self.spectrum.pack(fill='both', expand=True)

    def spectrum_touch(self, event):
        if not self.state:
            return
        canvas = self.spectrum
        w, h = max(canvas.winfo_width(), 160), max(canvas.winfo_height(), 120)
        left, usable = 8, w - 16
        idx = min(15, max(0, int((event.x - left) / max(1, usable) * 16)))
        top, bottom = 36, max(95, h - 36)
        value = max(0., min(1., (bottom - event.y) / max(1, bottom - top)))
        self.harmonic_vars[idx].set(value)
        self.parameter('harmonics', idx, value)
        self.draw_spectrum()

    def draw_spectrum(self):
        if not getattr(self, 'spectrum', None):
            return
        c = self.spectrum
        w, h = max(160, c.winfo_width()), max(120, c.winfo_height())
        c.delete('all')
        left, usable = 8, w - 16
        top, bottom = 36, max(95, h - 36)
        c.create_text(16, 13, anchor='w', text='16 PARTIALS   •   LIVE HARMONIC SHAPING',
                      fill=MUTED, font=('DejaVu Sans', 11, 'bold'))
        points = []
        for i, variable in enumerate(self.harmonic_vars):
            x0 = left + i / 16 * usable
            x1 = left + (i + 1) / 16 * usable
            x = (x0 + x1) / 2
            val = min(1., max(0., variable.get()))
            y = bottom - val * (bottom - top)
            base_color = '#396e7d' if i % 2 else '#3b7880'
            c.create_rectangle(x0 + 4, top, x1 - 4, bottom,
                               fill='#141c27', outline='', tags='partial-track')
            c.create_rectangle(x0 + 7, y, x1 - 7, bottom,
                               fill=base_color, outline='', tags=('partial', f'partial-{i}'))
            c.create_rectangle(x0 + 6, y - 7, x1 - 6, y + 7,
                               fill=ACCENT, outline='#c8f6e8', width=1, tags=('partial', f'partial-{i}'))
            c.create_text(x, 28, text=str(i + 1), font=('DejaVu Sans', 10, 'bold'),
                          fill=FG, tags='partial-number')
            c.create_text(x, h - 17, text=f'{round(val*100)}%', font=('DejaVu Sans', 10),
                          fill=MUTED, tags='partial-value')
            points.extend((x, y))
        if len(points) > 2:
            c.create_line(*points, fill='#c5ddd6', width=2, smooth=True, tags='harmonic-contour')
