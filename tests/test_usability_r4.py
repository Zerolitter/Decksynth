"""Guarded Pattern/SONG transfers; generated notes only, no device access."""
import copy
import unittest

from decksynth.core import Engine
from decksynth.keystep import current_pattern,song_from_pattern


def note(start=0., pitch=60, duration=.25, velocity=91):
    return dict(start=start, note=pitch, duration=duration, velocity=velocity)


def target(e):
    s=e.project.performance['seq']
    return dict(track=e.selected, device=e.project.tracks[e.selected].get('device','synth'),
                clip=e.project.clips['open'][e.selected], bars=e.project.bars,
                bank=s['bank'], slot=s['slot'], transpose=s['transpose'],
                pattern=copy.deepcopy(current_pattern(e.project.performance)),
                notes=copy.deepcopy(e.project.tracks[e.selected]['notes']))


class TransferTests(unittest.TestCase):
    def engine(self):
        e=Engine(8000)
        e.perform_step(0,[dict(note=60,velocity=91,tie=2)],True)
        e.project.tracks[0]['notes']=[note(1.,67,.5,82)]
        e.project.tracks[1]['notes']=[note(2.,72,.25,83)]
        e.history.clear()
        return e

    def test_guarded_add_and_replace_touch_only_the_named_open_clip_and_undo_once(self):
        for mode in ['add','replace']:
            with self.subTest(mode=mode):
                e=self.engine();e.clip_action(0,'open',1)
                e.project.tracks[0]['notes']=[note(1.,65,.25,77)]
                before=copy.deepcopy(e.project.data())
                e.perform_action('commit_song',mode,target(e))
                generated=[note(at,60,.4,91) for at in [0.,4.,8.,12.]]
                self.assertEqual(e.project.tracks[0]['notes'],([note(1.,65,.25,77)] if mode=='add' else [])+generated)
                self.assertEqual(e.project.clips['slots'][0][0],before['clips']['slots'][0][0])
                self.assertEqual(e.project.tracks[1],before['tracks'][1])
                self.assertEqual(len(e.history),1)
                e.undo();self.assertEqual(e.project.data(),before)

    def test_exact_capture_preserves_onsets_lengths_velocities_and_one_undo(self):
        units={'1/4':1.,'1/8':.5,'1/16':.25,'1/8T':1/3,'1/16T':1/6,'1/8D':.75}
        for division,unit in units.items():
            for length in [16,32,64]:
                for bars in [1,2,4,8]:
                    with self.subTest(division=division,length=length,bars=bars):
                        e=self.engine();e.set_bars(bars)
                        e.perform_set('seq','length',length);e.perform_set('seq','division',division)
                        e.project.tracks[0]['notes']=[note(0.,60,unit,91),note(unit,64,unit*2,82)]
                        before=copy.deepcopy(e.project.data());e.history.clear()
                        e.perform_action('capture_song',None,target(e))
                        p=current_pattern(e.project.performance)
                        self.assertEqual(p['gate'],.5)
                        self.assertEqual(p['steps'][0],[dict(note=60,velocity=91,tie=2)])
                        self.assertEqual(p['steps'][1],[dict(note=64,velocity=82,tie=4)])
                        played=song_from_pattern(p,bars,fill=False)
                        for got,want in zip(played,[note(0.,60,unit,91),note(unit,64,unit*2,82)]):
                            self.assertAlmostEqual(got['start'],want['start']);self.assertAlmostEqual(got['duration'],want['duration'])
                            self.assertEqual((got['note'],got['velocity']),(want['note'],want['velocity']))
                        self.assertEqual(e.project.tracks,before['tracks'])
                        self.assertEqual(len(e.history),1)
                        e.undo();self.assertEqual(e.project.data(),before)

    def test_stale_track_clip_device_bars_pattern_notes_and_transpose_reject_without_mutation(self):
        changes=[lambda e:e.select(1),lambda e:e.clip_action(0,'open',1),
                 lambda e:e.set_device(0,'drum_rack'),lambda e:e.set_bars(2),
                 lambda e:e.perform_step(3,[dict(note=65,velocity=100,tie=1)],True),
                 lambda e:e.project.tracks[0]['notes'].append(note(2.,70)),
                 lambda e:e.perform_set('seq','bank',2),lambda e:e.perform_set('seq','transpose',1)]
        for change in changes:
            for action,value in [('capture_song',None),('commit_song','add')]:
                with self.subTest(change=changes.index(change),action=action):
                    e=self.engine();expected=target(e);change(e)
                    before=copy.deepcopy(e.project.data());history=len(e.history)
                    with self.assertRaises(ValueError):e.perform_action(action,value,expected)
                    self.assertEqual(e.project.data(),before);self.assertEqual(len(e.history),history)

    def test_capture_snaps_live_takes_and_reports_what_changed(self):
        # 15 Nov (Sir): the strict copy refused every live arp/chord take. Song -> Pattern now snaps to the
        # grid, keeps up to 8 notes a step (the loudest) and the nearest tie, and reports each change.
        cases=[([note(.1)],'moved',1), ([note(3.99)],'moved',1), ([note(0.,60,.123),note(.25,64,.25)],'notes',2),
               ([note(0.,60+i,.25,80+i) for i in range(9)],'dropped',1)]
        for notes,key,count in cases:
            with self.subTest(notes=notes):
                e=self.engine();e.project.tracks[0]['notes']=notes
                e.perform_action('capture_song',None,target(e))
                self.assertEqual(e.transfer_report[key],count)
                self.assertEqual(len(e.history),1)  # one undo step
        e=self.engine();e.project.tracks[0]['notes']=[note(0.,60,2.5)]
        e.perform_action('capture_song',None,target(e))
        p=e.project.performance['patterns']['1:1'];n=p['steps'][0][0]
        self.assertAlmostEqual(n['tie']*p['gate']*.25,2.5)

    def test_pattern_to_song_rejects_pitch_clipping_time_truncation_and_empty_sources(self):
        e=self.engine();e.perform_set('seq','transpose',12)
        e.perform_step(0,[dict(note=127,velocity=100,tie=1)],True)
        with self.assertRaises(ValueError):e.perform_action('commit_song','add',target(e))
        e=self.engine();e.set_bars(1);e.perform_set('seq','length',32)
        e.perform_step(20,[dict(note=64,velocity=100,tie=1)],True)
        with self.assertRaises(ValueError):e.perform_action('commit_song','add',target(e))
        e=Engine(1000)
        for action,value in [('capture_song',None),('commit_song','add')]:
            with self.assertRaises(ValueError):e.perform_action(action,value,target(e))
        self.assertEqual(len(e.history),0)

    def test_recording_and_malformed_targets_reject_without_history(self):
        for kind in ['global','step','track','shape']:
            e=self.engine();expected=target(e)
            if kind=='global':e.recording=True
            if kind=='step':e.project.performance['seq']['recording']=True
            if kind=='track':expected['track']=False
            if kind=='shape':expected.pop('clip')
            before=copy.deepcopy(e.project.data())
            with self.assertRaises(ValueError):e.perform_action('commit_song','add',expected)
            self.assertEqual(e.project.data(),before);self.assertEqual(len(e.history),0)


if __name__=='__main__':unittest.main()
