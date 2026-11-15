"""15 Nov round 3: Song -> Pattern for live takes, 32-bar clips and 256-step patterns, count-in."""
import copy
import unittest

from decksynth.core import Engine
from decksynth.keystep import clip_to_pattern, current_pattern, validate_pattern, change_pattern_length, MAX_STEPS


def target(e):
    s=e.project.performance['seq']
    return dict(track=e.selected, device=e.project.tracks[e.selected].get('device','synth'),
                clip=e.project.clips['open'][e.selected], bars=e.project.bars,
                bank=s['bank'], slot=s['slot'], transpose=s['transpose'],
                pattern=copy.deepcopy(current_pattern(e.project.performance)),
                notes=copy.deepcopy(e.project.tracks[e.selected]['notes']))


def arp_take(bpm,bars,seconds_of_keys=None):
    """Sir's steps: arp on, REC into an empty clip, hold a chord, finish."""
    e=Engine(48000);e.project.bpm=bpm;e.set_bars(bars)
    e.perform_set('arp','enabled',True);e.record(0);e.render(1000)
    for n in (60,64,67):e.midi(0x90,n,100)
    beats=min(bars*4,8);e.render(round(beats*e.fpb))
    for n in (60,64,67):e.midi(0x80,n,0)
    e.finish_record();e.history.clear();return e


class SongToPattern(unittest.TestCase):
    def test_arp_take_on_8_bars_becomes_a_128_step_pattern(self):
        e=arp_take(120,8)
        e.perform_action('capture_song',None,target(e))
        p=current_pattern(e.project.performance)
        self.assertEqual(p['length'],128);self.assertEqual(e.project.performance['seq']['length'],128)
        heard=sorted((round(n['start']/.25),n['note']) for n in e.project.tracks[0]['notes'])
        got=sorted((i,n['note']) for i,step in enumerate(p['steps']) for n in step)
        self.assertEqual(got,heard)

    def test_arp_take_at_a_tempo_off_the_sample_grid(self):
        # 97 BPM: a beat is 29690.7 samples, so recorded notes sit a few samples off the 1/16 grid.
        e=arp_take(97,1)
        self.assertTrue(any(abs(n['start']/.25-round(n['start']/.25))>1e-6 for n in e.project.tracks[0]['notes']))
        e.perform_action('capture_song',None,target(e))
        self.assertEqual(e.transfer_report['moved'],0)  # within one audio frame: not counted as moved
        p=current_pattern(e.project.performance)
        self.assertAlmostEqual(p['gate'],.75)
        self.assertTrue(all(n['tie']==1 for s in p['steps'] for n in s))

    def test_hand_played_chord_is_snapped_and_reported(self):
        notes=[dict(start=.02+i*1.0,duration=.9,note=n,velocity=90) for i in range(4) for n in (60,64,67)]
        notes+= [dict(start=3.97,duration=.2,note=72,velocity=80)]  # just before the loop end: step 1
        p,r=clip_to_pattern(notes,4,'1/16',1/24000)
        validate_pattern(p)
        self.assertEqual(p['length'],16)
        self.assertEqual(sorted(n['note'] for n in p['steps'][0]),[60,64,67,72])
        self.assertEqual(r['moved'],13)
        self.assertEqual([len(s) for s in p['steps']][4],3)

    def test_long_notes_keep_their_length_up_to_32_steps(self):
        notes=[dict(start=0,duration=4.,note=48,velocity=100)]
        p,_=clip_to_pattern(notes,8,'1/16')
        n=p['steps'][0][0]
        self.assertAlmostEqual(n['tie']*p['gate']*.25,4.,delta=.25)

    def test_32_bars_at_1_16_asks_for_a_slower_rate(self):
        notes=[dict(start=b*4.,duration=.25,note=60,velocity=100) for b in range(32)]
        with self.assertRaisesRegex(ValueError,'1/8'):clip_to_pattern(notes,128,'1/16')
        p,_=clip_to_pattern(notes,128,'1/8');self.assertEqual(p['length'],256)

    def test_32_bar_clip_with_notes_only_at_the_start_fits(self):
        notes=[dict(start=i*.25,duration=.2,note=60,velocity=100) for i in range(16)]
        p,_=clip_to_pattern(notes,128,'1/16');self.assertEqual(p['length'],16)

    def test_more_than_8_notes_on_a_step_keeps_the_loudest(self):
        notes=[dict(start=0,duration=.25,note=40+i,velocity=10+i) for i in range(10)]
        p,r=clip_to_pattern(notes,4,'1/16');self.assertEqual(r['dropped'],2)
        self.assertEqual(sorted(n['note'] for n in p['steps'][0]),list(range(42,50)))

    def test_undo_restores_the_old_pattern(self):
        e=arp_take(120,8);before=copy.deepcopy(current_pattern(e.project.performance))
        e.perform_action('capture_song',None,target(e));e.undo()
        self.assertEqual(current_pattern(e.project.performance),before)


class Lengths(unittest.TestCase):
    def test_bars_up_to_32(self):
        e=Engine(8000)
        for b in (16,32):e.set_bars(b);self.assertEqual(e.project.bars,b)
        with self.assertRaises(ValueError):e.set_bars(64)
        import tempfile,os
        from decksynth.core import Project
        with tempfile.TemporaryDirectory() as d:
            path=os.path.join(d,'p.decksynth');e.project.save(path)
            self.assertEqual(Project.load(path).bars,32)

    def test_pattern_steps_up_to_256(self):
        e=Engine(8000)
        for n in (128,192,256):
            e.perform_set('seq','length',n)
            self.assertEqual(current_pattern(e.project.performance)['length'] if e.project.performance['patterns'] else e.project.performance['seq']['length'],n)
        with self.assertRaises(ValueError):e.perform_set('seq','length',257)
        p=change_pattern_length(current_pattern(e.project.performance),MAX_STEPS);self.assertEqual(len(p['steps']),256)

    def test_double_up_to_256(self):
        e=Engine(8000);e.perform_step(0,[dict(note=60,velocity=100,tie=1)],True);e.perform_set('seq','length',128)
        e.perform_action('double');self.assertEqual(current_pattern(e.project.performance)['length'],256)
        with self.assertRaises(ValueError):e.perform_action('double')


class CountIn(unittest.TestCase):
    def clicks(self,e,beats):
        heard=[]
        for i in range(round(beats*e.fpb/64)):
            age=e.click_age;e.render(64)
            if e.click_age<age:heard.append(e.absolute_frame)
        return heard

    def test_rec_counts_four_clicks_then_records_from_bar_1(self):
        e=Engine(8000);e.set_record_options(4,False);e.record_button()
        self.assertFalse(e.recording);self.assertEqual(e.count_state()['state'],'count')
        self.assertEqual(e.count_state()['beat'],1)
        self.assertEqual(len(self.clicks(e,3.9)),4)
        self.assertFalse(e.recording)
        e.render(round(.2*e.fpb))
        self.assertTrue(e.recording);self.assertTrue(e.playing);self.assertIsNone(e.count_state())
        self.assertLess(e.frame,.2*e.fpb+1)
        e.midi(0x90,60,100);e.render(200);e.midi(0x80,60,0)
        self.assertEqual(len(e.project.tracks[0]['notes']),1)

    def test_notes_during_the_count_are_not_recorded_except_right_on_the_downbeat(self):
        e=Engine(8000);e.set_record_options(4,False);e.record_button()
        e.midi(0x90,50,100);e.render(100);e.midi(0x80,50,0)   # beat 1 of the count: not part of the take
        e.render(round(3.95*e.fpb)-100)
        e.midi(0x90,62,100)                                  # a hair early for the downbeat
        e.render(round(.5*e.fpb));e.midi(0x80,62,0);e.finish_record()
        notes=e.project.tracks[0]['notes']
        self.assertEqual([n['note'] for n in notes],[62]);self.assertEqual(notes[0]['start'],0)

    def test_wait_for_first_note_without_count_in(self):
        e=Engine(8000);e.set_record_options(0,True);e.record_button()
        self.assertEqual(e.count_state()['state'],'armed');e.render(2000);self.assertFalse(e.playing)
        e.midi(0x90,64,90);self.assertTrue(e.recording)
        e.render(300);e.midi(0x80,64,0);e.finish_record()
        self.assertEqual([(n['note'],n['start']) for n in e.project.tracks[0]['notes']],[(64,0.)])

    def test_first_note_starts_the_count_in(self):
        e=Engine(8000);e.set_record_options(4,True);e.record_button()
        e.render(4000);self.assertEqual(e.count_state()['state'],'armed')
        e.midi(0x90,64,90);e.midi(0x80,64,0)
        self.assertEqual(e.count_state()['state'],'count')
        e.render(round(4*e.fpb)+10);self.assertTrue(e.recording);self.assertEqual(e.project.tracks[0]['notes'],[])

    def test_drum_pad_counts_as_first_note(self):
        e=Engine(8000);e.set_record_options(0,True);e.record_button()
        e.first_note();self.assertTrue(e.recording)

    def test_arp_waits_for_the_count_and_starts_on_beat_1(self):
        e=Engine(8000);e.perform_set('arp','enabled',True);e.set_record_options(4,False);e.record_button()
        e.render(500);e.midi(0x90,60,100)
        self.assertFalse(e.playing)
        e.render(round(4*e.fpb));e.render(round(2*e.fpb));e.midi(0x80,60,0);e.finish_record()
        starts=sorted(n['start'] for n in e.project.tracks[0]['notes'])
        self.assertTrue(starts);self.assertAlmostEqual(starts[0],0,places=3)

    def test_rec_again_cancels_and_stop_cancels(self):
        e=Engine(8000);e.set_record_options(4,False);e.record_button();e.record_button()
        self.assertIsNone(e.count_state());e.render(round(5*e.fpb));self.assertFalse(e.recording)
        e.record_button();e.stop();self.assertIsNone(e.count_state())

    def test_while_playing_rec_starts_at_once(self):
        e=Engine(8000);e.set_record_options(4,True);e.playing=True;e.record_button();self.assertTrue(e.recording)

    def test_off_is_the_old_behaviour(self):
        e=Engine(8000);e.record_button();self.assertTrue(e.recording);e.record_button();self.assertFalse(e.recording)

    def test_bad_options_rejected(self):
        e=Engine(8000)
        for a in ((3,False),(4,1)):
            with self.assertRaises(ValueError):e.set_record_options(*a)


if __name__=='__main__':unittest.main()


class ModPads(unittest.TestCase):
    def test_8_and_16_bar_rates_and_new_shapes_validate_and_play(self):
        from decksynth.fx import validate_chain, default_chain, mod_value, RATES, SHAPES
        chain=default_chain()
        chain['mods'][0].update(rate=7,shape='pump');chain['mods'][1].update(rate=8,shape='trance')
        clean=validate_chain(chain)
        self.assertEqual((clean['mods'][0]['rate'],clean['mods'][1]['rate']),(7,8))
        self.assertEqual((RATES[7],RATES[8]),(32,64))
        # 16 bars: one cycle is 64 beats, so at beat 32 the pump is half way.
        _,phase=mod_value(clean['mods'][1],32.);self.assertAlmostEqual(phase,.5)
        self.assertEqual(len(SHAPES),42)
        for sh in SHAPES:
            chain['mods'][2]['shape']=sh;validate_chain(chain)

    def test_old_rate_numbers_keep_their_meaning(self):
        from decksynth.fx import RATES
        self.assertEqual(RATES[:7],[16,8,4,2,1,.5,.25])
