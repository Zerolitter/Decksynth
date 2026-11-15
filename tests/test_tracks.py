"""Sampler editing stage 10: add and remove tracks, 4 to 8."""
import copy,shutil,tempfile,unittest
from pathlib import Path
from decksynth.core import Engine,Project
from decksynth import song as songs


def per_track_lists(e,n):
    return {k for k,v in vars(e).items() if isinstance(v,list) and len(v)==n}


class AddAndRemove(unittest.TestCase):
    def setUp(self):self.e=Engine()

    def test_every_per_track_list_grows_with_the_project(self):
        e=self.e;before=per_track_lists(e,4)
        e.add_track()
        grown=per_track_lists(e,5)
        missing=sorted(before-grown-{'history'})
        self.assertEqual(missing,[],'per-track lists that did not grow: %s'%missing)

    def test_add_up_to_eight_then_refuse(self):
        e=self.e
        for n in range(5,9):self.assertEqual(e.add_track(),n-1);self.assertEqual(len(e.project.tracks),n)
        self.assertEqual(e.selected,7)
        self.assertEqual(len(e.project.song['lanes']),8);self.assertEqual(len(e.project.clips['slots']),8);self.assertEqual(len(e.project.clips['open']),8)
        with self.assertRaises(ValueError):e.add_track()
        e.render(512)   # eight tracks render

    def test_remove_keeps_the_others_and_undo_brings_it_back(self):
        e=self.e;e.add_track();e.add_track()
        e.project.tracks[5]['name']='Six';e.project.tracks[1]['name']='Two'
        six=e.synths[5]
        e.remove_track(1)
        self.assertEqual([t['name'] for t in e.project.tracks][4],'Six')
        self.assertIs(e.synths[4],six,'the tracks after keep their runtime objects')
        self.assertEqual(len(e.synths),5);self.assertEqual(len(e.project.song['lanes']),5)
        e.undo()
        self.assertEqual(len(e.project.tracks),6);self.assertEqual(e.project.tracks[1]['name'],'Two');self.assertEqual(len(e.synths),6)
        e.render(256)

    def test_four_is_the_least(self):
        with self.assertRaises(ValueError):self.e.remove_track(0)

    def test_undo_add(self):
        e=self.e;e.add_track();e.undo()
        self.assertEqual(len(e.project.tracks),4);self.assertEqual(len(e.fx),4);self.assertLess(e.selected,4)

    def test_save_and_open_six_tracks(self):
        d=Path(tempfile.mkdtemp())
        try:
            e=self.e;e.add_track();e.add_track()
            e.project.save(d/'six.json');p=Project.load(d/'six.json')
            self.assertEqual(len(p.tracks),6);self.assertEqual(len(p.song['lanes']),6);self.assertEqual(len(p.clips['open']),6)
            f=Engine();f.replace_project(p);self.assertEqual(len(f.synths),6);f.render(256)
        finally:shutil.rmtree(d,ignore_errors=True)

    def test_older_songs_with_four_lanes_open_with_more_tracks(self):
        s=songs.defaults(4);clean=songs.validate(s,4,6);self.assertEqual(len(clean['lanes']),6)
        c=songs.validate_clips(songs.empty_clips(),16,6);self.assertEqual(len(c['slots']),6)

    def test_select_and_song_follow_the_count(self):
        e=self.e;e.add_track();e.select(4)
        s=copy.deepcopy(e.project.song);s['on']=True;e.set_song(s) if hasattr(e,'set_song') else None
        with self.assertRaises(ValueError):e.clip_action(5,'open',0)


class RememberedTracks(unittest.TestCase):
    def test_six_tracks_are_remembered_and_come_back(self):
        from decksynth.drum_memory import KitMemory
        e=Engine();e.add_track();e.add_track();e.set_device(5,'sampler')
        value=KitMemory.capture(e);self.assertEqual(len(value['tracks']),6)
        f=Engine();KitMemory.restore(f,value)
        self.assertEqual(len(f.project.tracks),6);self.assertEqual(f.project.tracks[5]['device'],'sampler');self.assertEqual(len(f.samplers),6)
        with self.assertRaises(ValueError):KitMemory.validate(dict(value,tracks=value['tracks']*2))


if __name__=='__main__':unittest.main()
