import copy,math,unittest
from decksynth.keystep import DIVISIONS
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

    def test_extend_sets_the_exact_bars_it_needs(self):
        e=Engine(8000);e.set_bars(16)
        e.project.tracks[e.selected]['notes'][:]=[dict(note=60,velocity=100,start=63.,duration=1.)]
        build(e,(('bass.more.01',1),))
        p=e.project.performance['patterns'][e.project.performance['seq']['chain'][0]]
        need=16+math.ceil(p['length']*DIVISIONS[p['division']]/4)
        first,last,bars=e.structure_extend()
        self.assertEqual((first,last,bars),(17,need,need),'no rounding up to 32: the clip ends where the Structure ends')
        self.assertEqual(e.project.bars,need)

    def test_any_whole_bar_count_saves_and_loads(self):
        import tempfile,os
        from decksynth.core import Project
        e=Engine(8000);e.set_bars(17);self.assertEqual(e.project.bars,17)
        with self.assertRaises(ValueError):e.set_bars(33)
        with self.assertRaises(ValueError):e.set_bars(0)
        with tempfile.TemporaryDirectory() as d:
            path=os.path.join(d,'p.json');e.project.save(path);self.assertEqual(Project.load(path).bars,17)

    def test_half_and_double_a_part(self):
        e=Engine(8000);build(e);perf=e.project.performance
        chain=list(perf['seq']['chain']);src=chain[1];length=perf['patterns'][src]['length']
        key,n=e.structure_part_length(1,2,.5);perf=e.project.performance
        self.assertEqual(n,length//2);self.assertEqual(perf['seq']['chain'],[chain[0],key,key])
        self.assertEqual(perf['patterns'][src]['length'],length,'the original stays')
        self.assertTrue(all(i+x.get('tie',1)<=n for i,st in enumerate(perf['patterns'][key]['steps']) for x in st))
        key2,n2=e.structure_part_length(0,1,2)
        self.assertEqual(n2,perf['patterns'][chain[0]]['length']*2)
        self.assertEqual(e.project.performance['seq']['chain'][0],key2)
        e.undo();self.assertEqual(e.project.performance['seq']['chain'],[chain[0],key,key])
        with self.assertRaisesRegex(ValueError,'changed'):e.structure_part_length(0,2,2)

    def test_extend_refuses_past_32_bars(self):
        e=Engine(8000);e.set_bars(32)
        e.project.tracks[e.selected]['notes'][:]=[dict(note=60,velocity=100,start=127.,duration=1.)]
        build(e)
        with self.assertRaisesRegex(ValueError,'32 bars'):e.structure_extend()

if __name__=='__main__':unittest.main()
