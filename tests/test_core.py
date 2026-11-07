import unittest, tempfile, pathlib, math
from decksynth.core import Project, MidiParser, Synth, Engine

class CoreTests(unittest.TestCase):
    def test_parser_running_status_realtime_sustain_bend(self):
        p = MidiParser()
        self.assertEqual(p.feed(bytes([0x90,60,100,0xf8,64,90,60,0,0xb0,64,127,0xe0,0,64])),
                         [(0x90,60,100),(0x90,64,90),(0x90,60,0),(0xb0,64,127),(0xe0,0,64)])
    def test_persistence_export_and_validation(self):
        p=Project(); p.tracks[0]['notes']=[dict(start=0.,duration=1.,note=60,velocity=100)]
        p.tracks[1]['preset']='Bass'
        with tempfile.TemporaryDirectory() as d:
            f=pathlib.Path(d)/'song.json'; p.save(f); q=Project.load(f)
            self.assertEqual(p.data(),q.data()); q.export_midi(pathlib.Path(d)/'song.mid')
            b=(pathlib.Path(d)/'song.mid').read_bytes()
            self.assertEqual(b[:4],b'MThd'); self.assertIn(bytes([0x90,60,100]),b)
            f.write_text('{"version":1,"bpm":0}')
            with self.assertRaises(ValueError): Project.load(f)
    def test_polyphonic_audio_release_and_panic(self):
        s=Synth(48000); s.on(60,100); s.on(64,90)
        a=s.render(4096); self.assertGreater(max(map(abs,a)),.001)
        self.assertEqual(len(s.voices),2)
        s.sustain=True; s.off(60); self.assertEqual(len(s.voices),2)
        s.pedal(False); s.off(64); s.render(48000*3)
        self.assertEqual(len(s.voices),0)
        s.on(60,100); s.panic(); self.assertEqual(max(map(abs,s.render(64))),0)
    def test_record_wrap_two_tracks_and_undo(self):
        e=Engine(1000); e.project.bpm=120; e.record(0)
        e.midi(0x90,60,100); e.render(500); e.midi(0x80,60,0)
        e.render(7500)
        self.assertTrue(e.playing); self.assertFalse(e.recording)
        self.assertEqual(len(e.project.tracks[0]['notes']),1)
        e.record(1); e.midi(0x90,48,110); e.render(250); e.midi(0x80,48,0)
        e.finish_record(); self.assertEqual(len(e.project.tracks[1]['notes']),1)
        self.assertEqual(len(e.project.tracks[0]['notes']),1)
        e.undo(); self.assertEqual(e.project.tracks[1]['notes'],[])
    def test_loop_retriggers_and_stop_releases(self):
        e=Engine(1000); e.project.bpm=120
        e.project.tracks[0]['notes']=[dict(start=0.,duration=.5,note=60,velocity=100)]
        e.playing=True; e.render(8000); a=e.render(200)
        self.assertGreater(max(map(abs,a)),.001)
        e.stop(); self.assertTrue(all(not s.voices for s in e.synths))
    def test_quantize(self):
        p=Project(); p.tracks[0]['notes']=[dict(start=.13,duration=.24,note=60,velocity=100)]
        p.quantize(0); self.assertEqual(p.tracks[0]['notes'][0]['start'],.25)

if __name__=='__main__': unittest.main()

class RegressionTests(unittest.TestCase):
    def test_track_switch_keeps_loop_voices(self):
        e=Engine(); e.synths[0].on(60,100,('loop',0,0)); e.midi(0x90,64,100)
        e.select(1); self.assertEqual(list(e.synths[0].voices),[('loop',0,0)])
    def test_loop_release_ignores_live_sustain(self):
        s=Synth(1000); s.on(60,100,('loop',0,0)); s.render(100); s.pedal(True)
        s.off(60,('loop',0,0)); s.render(1000)
        self.assertEqual(s.voices,{})
    def test_held_note_harmonic_change(self):
        s=Synth(); s.on(60,100); old=s.voices[60]['table']
        p=dict(s.params); p['harmonics']=[0.]*16; s.configure(p)
        # The new table takes over after a 256-sample crossfade (an instant swap clicks).
        self.assertIsNot(old,s.voices[60]['table']); s.render(256); self.assertEqual(max(s.render(256)),0)
    def test_sustain_recorded_as_note_duration(self):
        e=Engine(1000); e.record(0); e.midi(0x90,60,100); e.render(250)
        e.midi(0xb0,64,127); e.midi(0x80,60,0); e.render(250)
        self.assertEqual(e.project.tracks[0]['notes'],[])
        e.midi(0xb0,64,0); self.assertEqual(e.project.tracks[0]['notes'][0]['duration'],1.)
    def test_shorter_loop_remains_loadable(self):
        e=Engine(); e.project.tracks[0]['notes']=[dict(start=15.,duration=8.,note=60,velocity=100)]
        e.set_bars(1)
        with tempfile.TemporaryDirectory() as d:
            f=pathlib.Path(d)/'x'; e.project.save(f); p=Project.load(f)
            self.assertEqual(p.tracks[0]['notes'][0]['start'],3.)
    def test_voice_budget(self):
        e=Engine(1000)
        for tr in range(4):
            for note in range(48,60):e.voice_on(tr,note,100,('live',0,note))
        self.assertEqual(sum(len(s.voices) for s in e.synths),24)
    def test_quantize_releases_inflight_notes(self):
        e=Engine(1000)
        e.project.tracks[0]['notes']=[dict(start=.12,duration=.26,note=60,velocity=100)]
        e.playing=True; e.render(150); self.assertTrue(e.synths[0].voices)
        e.quantize(0)
        self.assertFalse(e.playing); self.assertFalse(e.synths[0].voices)
