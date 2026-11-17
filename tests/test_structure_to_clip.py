import copy,unittest
from decksynth.core import Engine
from decksynth.keystep import current_pattern

def args(e):
    t=e.project.tracks[e.selected]
    return (dict(kind='pattern',track=e.selected,bank=1,slot=1,device=t.get('device','synth'),kit=copy.deepcopy(t.get('drum_rack'))),
            copy.deepcopy(current_pattern(e.project.performance)))

def build(e,parts=(('bass.more.01',1),('bass.more.02',2))):
    for i,n in parts:
        t,p=args(e);e.structure_add(t,p,i,None,n)

class StructureToClip(unittest.TestCase):
    def test_send_to_pattern_merges_every_play(self):
        e=Engine(8000);build(e);perf=e.project.performance
        total=sum(perf['patterns'][k]['length'] for k in perf['seq']['chain'])
        key,length=e.structure_merge();perf=e.project.performance
        self.assertEqual(length,total)
        self.assertEqual(perf['patterns'][key]['length'],total)
        self.assertEqual('%d:%d'%(perf['seq']['bank'],perf['seq']['slot']),key)
        self.assertFalse(perf['seq']['chain_enabled']);self.assertTrue(perf['seq']['enabled'])
        self.assertNotIn(key,perf['seq']['chain'])
        e.undo();back=e.project.performance['patterns'].get(key)
        self.assertFalse(back and any(back['steps']),'undo takes the merged pattern out')
        self.assertTrue(e.project.performance['seq']['chain_enabled'])

    def test_empty_structure_refuses(self):
        e=Engine(8000)
        with self.assertRaisesRegex(ValueError,'empty'):e.structure_merge()
        with self.assertRaisesRegex(ValueError,'empty'):e.structure_extend()

    def test_extend_appends_after_last_bar_and_grows_the_clip(self):
        e=Engine(8000);e.set_bars(2)
        notes=e.project.tracks[e.selected]['notes'];notes[:]=[dict(note=60,velocity=100,start=4.5,duration=1.)]
        build(e);before=len(notes);bars_before=e.project.bars
        first,last,bars=e.structure_extend()
        self.assertEqual(first,3,'starts on the bar after the last note')
        self.assertGreaterEqual(bars*4,(first-1)*4)
        self.assertEqual(e.project.bars,bars);self.assertGreater(bars,bars_before)
        added=e.project.tracks[e.selected]['notes'][before:]
        self.assertTrue(added);self.assertTrue(all(n['start']>=8 for n in added))
        self.assertFalse(e.project.performance['seq']['enabled'])
        e.undo()
        self.assertEqual(e.project.bars,bars_before,'one undo takes the growth back too')
        self.assertEqual(len(e.project.tracks[e.selected]['notes']),before)

    def test_extend_refuses_past_32_bars(self):
        e=Engine(8000);e.set_bars(32)
        e.project.tracks[e.selected]['notes'][:]=[dict(note=60,velocity=100,start=127.,duration=1.)]
        build(e)
        with self.assertRaisesRegex(ValueError,'32 bars'):e.structure_extend()

if __name__=='__main__':unittest.main()
