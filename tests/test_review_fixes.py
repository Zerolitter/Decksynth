"""Review fixes of 15 November 2026: Pattern -> Song feel and SEQ hand-over, step rec target, automation blocks."""
import copy
import unittest

from decksynth.core import Engine
from decksynth.keystep import current_pattern, schedule_notes, song_from_pattern


def target(e):
    s=e.project.performance['seq']
    return dict(track=e.selected, device=e.project.tracks[e.selected].get('device','synth'),
                clip=e.project.clips['open'][e.selected], bars=e.project.bars,
                bank=s['bank'], slot=s['slot'], transpose=s['transpose'],
                pattern=copy.deepcopy(current_pattern(e.project.performance)),
                notes=copy.deepcopy(e.project.tracks[e.selected]['notes']))


def heard(e,beats):
    """Note-ons the sequencer schedules over the first `beats` beats, in beats."""
    frames=round(beats*e.fpb);out=[];state=e.project.performance
    for start in range(0,frames,128):
        for offset,action,pitch,velocity,token in schedule_notes(state,[],start,min(frames,start+128),e.fpb):
            if action:out.append((round((start+offset)/e.fpb,3),pitch))
    return sorted(out)


class PatternToSongFeel(unittest.TestCase):
    def engine(self):
        e=Engine(8000)
        for step in range(16):e.perform_step(step,[dict(note=60+step%5,velocity=100,tie=1)],True)
        e.history.clear();return e

    def test_swing_reaches_the_clip(self):
        e=self.engine();e.perform_set('seq','swing',.66)
        e.perform_action('commit_song','replace',target(e))
        starts=sorted({round(n['start'],4) for n in e.project.tracks[0]['notes'] if n['start']<1})
        self.assertEqual(starts,[0.,round(.25+.25*.32,4),.5,round(.75+.25*.32,4)])

    def test_spice_clip_matches_what_the_sequencer_played(self):
        e=self.engine();e.perform_set('seq','spice',.8);e.perform_set('seq','enabled',True)
        played=heard(e,16)
        e.perform_action('commit_song','replace',target(e))
        sent=sorted((round(n['start'],3),n['note']) for n in e.project.tracks[0]['notes'])
        self.assertEqual(sent,played)
        self.assertLess(len(sent),64+64)  # some notes skipped or ratcheted, not the bare grid
        self.assertNotEqual(sent,[(s*.25,60+s%5) for s in range(64)])

    def test_gate_reaches_the_clip(self):
        e=self.engine();e.perform_set('seq','gate',.3)
        e.perform_action('commit_song','replace',target(e))
        self.assertTrue(all(abs(n['duration']-.25*.3)<1e-9 for n in e.project.tracks[0]['notes']))

    def test_plain_grid_without_feel_is_unchanged(self):
        e=self.engine();p=current_pattern(e.project.performance);p=dict(p,swing=.7)
        self.assertEqual([n['start'] for n in song_from_pattern(p,1)],[s*.25 for s in range(16)])

    def test_send_hands_playback_to_the_song_and_undo_restores_seq(self):
        e=self.engine();e.perform_set('seq','enabled',True)
        e.perform_action('commit_song','add',target(e))
        self.assertFalse(e.project.performance['seq']['enabled'])
        self.assertEqual(len(e.project.tracks[0]['notes']),64)
        e.undo()
        self.assertTrue(e.project.performance['seq']['enabled'])
        self.assertEqual(e.project.tracks[0]['notes'],[])


class StepRecordTarget(unittest.TestCase):
    def test_step_rec_writes_the_pattern_not_the_song_clip_even_during_song_rec(self):
        e=Engine(8000);e.perform_set('seq','recording',True);e.recording=True;e.record_end=10**9
        e.midi(0x90,64,100);e.midi(0x80,64,0);e.midi(0x90,67,100);e.midi(0x80,67,0)
        steps=current_pattern(e.project.performance)['steps']
        self.assertEqual([[n['note'] for n in s] for s in steps[:3]],[[64],[67],[]])
        self.assertEqual(e.pending,{})

    def test_drum_rack_keys_step_record_into_the_pattern(self):
        e=Engine(8000);e.set_device(0,'drum_rack');e.perform_set('seq','recording',True)
        e.midi(0x90,36,110);e.midi(0x80,36,0);e.midi(0x90,38,90);e.midi(0x80,38,0)
        steps=current_pattern(e.project.performance)['steps']
        self.assertEqual([[n['note'] for n in s] for s in steps[:3]],[[36],[38],[]])
        self.assertEqual(e.rec_step,2)
        self.assertEqual(e.project.tracks[0]['notes'],[])

    def test_drum_pad_touch_step_records(self):
        e=Engine(8000);e.set_device(0,'drum_rack');kit=e.project.tracks[0]['drum_rack']['id']
        e.perform_set('seq','recording',True);e.drum_note(0,kit,4,100)
        self.assertEqual(current_pattern(e.project.performance)['steps'][0][0]['note'],40)


class AutomationBlocks(unittest.TestCase):
    def test_dense_lane_does_not_split_audio_blocks(self):
        e=Engine(48000);e.playing=True
        e.set_automation(0,[dict(module='sound',param='filter',points=[[i/500,(i%2)*1.] for i in range(2000)])])
        self.assertEqual(e.automation_block(128),128)
        self.assertIn(('sound','filter'),e.automation_values[0])


if __name__=='__main__':unittest.main()


class SharedLibrary(unittest.TestCase):
    def args(self,e):
        return (dict(kind='pattern',track=0,bank=1,slot=1,device=e.project.tracks[0].get('device','synth'),
                     kit=copy.deepcopy(e.project.tracks[0].get('drum_rack'))),copy.deepcopy(current_pattern(e.project.performance)))

    def test_categories_genres_and_effect_parts(self):
        from decksynth.genre_patterns import catalog
        from decksynth.keystep import validate_pattern
        data=catalog();ids=[p['id'] for p in data]
        self.assertEqual(len(ids),len(set(ids)))
        cats={c:[p for p in data if p['category']==c] for c in ('bass','melodie','arp','chords','effects','drums')}
        self.assertTrue(all(cats.values()))
        for genre in ('EDM','House','Techno','Drum & Bass','Trance','Lo-fi'):
            self.assertGreaterEqual(sum(p['genre']==genre for p in cats['melodie']),6)
        for role in ('intro','bridge','tension','builder','ending'):
            for device in ('synth','drum_rack'):
                self.assertTrue(any(p.get('fx_role')==role and p['device']==device for p in data),(role,device))
        for p in data:validate_pattern(p['pattern'])

    def test_drum_rack_plays_a_melodic_pattern_from_c2(self):
        e=Engine(8000);e.set_device(0,'drum_rack');t,p=self.args(e)
        e.catalog_action('load',t,p,'existing.1.01')
        notes=[n['note'] for s in current_pattern(e.project.performance)['steps'] for n in s]
        from decksynth.genre_patterns import template
        source=[n['note'] for s in template('existing.1.01')['pattern']['steps'] for n in s]
        self.assertEqual(min(notes)//12*12,36)
        self.assertEqual([a-b for a,b in zip(notes,source)],[notes[0]-source[0]]*len(notes))

    def test_synth_plays_a_drum_pattern_as_midi(self):
        e=Engine(8000);t,p=self.args(e);e.catalog_action('load',t,p,'genre.edm.01')
        notes={n['note'] for s in current_pattern(e.project.performance)['steps'] for n in s}
        self.assertTrue(notes<=set(range(36,52)))
        e.catalog_action('preview',*self.args(e),'genre.edm.01');self.assertIsNotNone(e.preview_status())


class DrumPadShape(unittest.TestCase):
    def test_trim_points_are_ramped_so_they_do_not_click(self):
        from array import array
        from dataclasses import dataclass
        from decksynth.drum_shape import render_shape
        @dataclass
        class Pcm: data:array; frames:int
        out=render_shape(Pcm(array('f',[1.]*4800),4800),dict(start=.25,end=.75),48000).data
        self.assertEqual(len(out),2400)
        self.assertEqual(out[0],0.);self.assertEqual(out[-1],0.)   # both cut edges start/end at silence
        self.assertEqual(out[1200],1.)                             # the middle is untouched
        untrimmed=render_shape(Pcm(array('f',[1.]*4800),4800),{},48000).data
        self.assertEqual(untrimmed[0],1.)                          # an untrimmed hit keeps its transient

    def rack(self):
        import math,struct,tempfile,wave
        from pathlib import Path
        e=Engine();e.set_device(0,'drum_rack');tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        f=Path(tmp.name)/'hit.wav'
        with wave.open(str(f),'wb') as w:
            w.setparams((1,2,48000,24000,'NONE',''))
            w.writeframes(b''.join(struct.pack('<h',round(12000*math.sin(i*.05))) for i in range(24000)))
        kit=e.project.tracks[0]['drum_rack'];e.import_drum_sample(0,kit['id'],0,str(f))
        return e,e.project.tracks[0]['drum_rack']

    def test_shape_is_saved_validated_undoable_and_rendered_off_the_audio_path(self):
        from decksynth.drum_shape import PadShaper
        e,kit=self.rack();raw=e.drums[0].raw[0];self.assertIs(e.drums[0].samples[0],raw)
        e.edit_drum_pad(0,kit['id'],0,'shape',dict(start=.25,end=.75,decay=.1,attack=.002,low_cut=200.,drive=.3))
        PadShaper.wait()
        shaped=e.drums[0].samples[0]
        self.assertIsNot(shaped,raw);self.assertLess(shaped.frames,raw.frames*.5)
        self.assertEqual(shaped.peaks,raw.peaks)  # the editor still shows the whole source
        self.assertLess(max(abs(x) for x in shaped.data[-100:]),.01)  # decayed to silence, no click
        self.assertEqual(e.project.tracks[0]['drum_rack']['pads'][0]['shape']['start'],.25)
        e.undo();self.assertIs(e.drums[0].samples[0],raw)
        self.assertNotIn('shape',e.project.tracks[0]['drum_rack']['pads'][0])

    def test_reverse_and_invalid_values(self):
        from decksynth.drum_shape import PadShaper
        e,kit=self.rack();raw=e.drums[0].raw[0]
        e.edit_drum_pad(0,kit['id'],0,'shape',dict(reverse=True));PadShaper.wait()
        self.assertAlmostEqual(e.drums[0].samples[0].data[0],raw.data[raw.frames-1],5)
        for bad in (dict(start=.6,end=.5),dict(decay=-1),dict(drive=2),dict(pan=2),dict(comp_ratio=.5),dict(wobble=1)):
            with self.assertRaises(ValueError):e.edit_drum_pad(0,kit['id'],0,'shape',bad)

    def test_shaped_pad_plays_and_saves(self):
        import tempfile
        from pathlib import Path
        from decksynth.core import Project
        from decksynth.drum_shape import PadShaper
        e,kit=self.rack();e.edit_drum_pad(0,kit['id'],0,'shape',dict(high_cut=2000.,decay=.2));PadShaper.wait()
        e.drum_note(0,kit['id'],0,110);pcm=e.render_stereo(4800);self.assertGreater(max(map(abs,pcm)),.01)
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/'s.decksynth';e.project.save(f)
            self.assertEqual(Project.load(f).tracks[0]['drum_rack']['pads'][0]['shape']['high_cut'],2000.)


class DrumPadRound2(unittest.TestCase):
    """Review 2026-11-15 round 2: Hold, fades, EQ, compressor, pan, tune-independent shaping."""
    def pcm(self, n=48000, value=.5):
        from array import array
        from dataclasses import dataclass
        @dataclass
        class Pcm: data:array; frames:int
        return Pcm(array('f',[value]*n),n)

    def test_hold_without_decay_stops_after_attack_plus_hold(self):
        from decksynth.drum_shape import render_shape
        out=render_shape(self.pcm(),dict(hold=.1),48000).data
        self.assertAlmostEqual(len(out),4800+240,delta=2)      # 100 ms hold + 5 ms release
        self.assertAlmostEqual(out[2400],.5,5);self.assertLess(abs(out[-1]),.01)
        self.assertEqual(len(render_shape(self.pcm(),dict(hold=.1,attack=.05),48000).data),7441)

    def test_native_and_python_shaping_agree(self):
        import math
        from array import array
        from decksynth.drum_native import native_shape
        from decksynth.drum_shape import render_shape
        if native_shape() is None:self.skipTest('no C compiler')
        src=self.pcm(9600);src.data=array('f',[.8*math.sin(i*.07)*math.exp(-i/4000) for i in range(9600)])
        shape=dict(start=.05,end=.9,fade_in=.01,fade_out=.02,attack=.003,hold=.02,decay=.1,low_cut=80.,high_cut=9000.,
                   eq_low=4.,eq_mid=-6.,eq_freq=700.,eq_high=3.,comp_threshold=-20.,comp_ratio=4.,comp_attack=2.,comp_release=80.,comp_makeup=3.,drive=.2)
        a=render_shape(src,shape,48000,1.25).data;b=render_shape(src,shape,48000,1.25,native=False).data
        self.assertEqual(len(a),len(b));self.assertLess(max(abs(x-y) for x,y in zip(a,b)),1e-4)

    def test_times_follow_real_seconds_whatever_the_tune(self):
        from decksynth.drum_shape import render_shape
        for step in (.5,1.,2.):
            out=render_shape(self.pcm(),dict(hold=.1),48000,step).data
            self.assertAlmostEqual(len(out)/step,4800+240,delta=3)  # playback at `step` lasts 105 ms

    def test_fades_and_compressor(self):
        from decksynth.drum_shape import render_shape
        out=render_shape(self.pcm(4800,.9),dict(fade_in=.01,fade_out=.01),48000,native=False).data
        self.assertEqual(out[0],0.);self.assertAlmostEqual(out[240],.45,4);self.assertAlmostEqual(out[2400],.9,5);self.assertLess(out[-1],.01)
        comp=render_shape(self.pcm(4800,.9),dict(comp_threshold=-12.,comp_ratio=10.,comp_attack=.1),48000).data
        self.assertLess(comp[4000],.35)  # 0.9 (-0.9 dB) squeezed towards -12 dB

    def test_pan_moves_the_pad_between_the_speakers_and_does_not_rerender(self):
        from decksynth.drum_shape import PadShaper
        e,kit=DrumPadShape.rack(self)
        raw=e.drums[0].raw[0]
        e.edit_drum_pad(0,kit['id'],0,'shape',dict(pan=-1.));PadShaper.wait()
        self.assertIs(e.drums[0].samples[0],raw)   # pan is applied by the mixer: no shaped copy needed
        e.drum_note(0,kit['id'],0,110);pcm=e.render_stereo(4800)
        left=max(abs(x) for x in pcm[0::2]);right=max(abs(x) for x in pcm[1::2])
        self.assertGreater(left,.01);self.assertLess(right,left*.01)

    def test_pan_centre_is_unchanged_mono(self):
        e,kit=DrumPadShape.rack(self);e.drum_note(0,kit['id'],0,110);pcm=e.render_stereo(2400)
        self.assertLess(max(abs(l-r) for l,r in zip(pcm[0::2],pcm[1::2])),1e-9)
