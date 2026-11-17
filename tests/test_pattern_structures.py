import copy,unittest
from decksynth.core import Engine
from decksynth.keystep import current_pattern,validate_pattern
from decksynth.genre_patterns import catalog,structures

def args(e):
    t=e.project.tracks[e.selected]
    return (dict(kind='pattern',track=e.selected,bank=1,slot=1,device=t.get('device','synth'),kit=copy.deepcopy(t.get('drum_rack'))),
            copy.deepcopy(current_pattern(e.project.performance)))

class Structures(unittest.TestCase):
    def test_library_has_song_parts_and_valid_structures(self):
        data=catalog();ids={p['id'] for p in data}
        self.assertEqual(len(ids),len(data))
        self.assertGreaterEqual(len(data),350)
        for p in data:validate_pattern(p['pattern'])
        made=structures();self.assertGreaterEqual(len(made),20)
        for s in made:
            self.assertTrue(all(i in ids and 1<=n<=16 for i,n in s['parts']),s['id'])
            self.assertLessEqual(sum(n for _,n in s['parts']),64)

    def test_add_to_structure_fills_empty_slots_and_plays_in_order(self):
        e=Engine(8000);t,p=args(e)
        first=e.structure_add(t,p,'bass.more.01')
        t,p=args(e);second=e.structure_add(t,p,'bass.more.02',None,2)
        seq=e.project.performance['seq']
        self.assertEqual(seq['chain'],[first,second,second])
        self.assertTrue(seq['chain_enabled'] and seq['enabled'])
        self.assertEqual((first,second),('1:1','1:2'),'parts land side by side in the open bank')
        self.assertTrue(any(e.project.performance['patterns'][second]['steps']))
        e.playing=True;self.assertGreater(max(map(abs,e.render(4000))),.001)
        e.undo();self.assertEqual(e.project.performance['seq']['chain'],[first])

    def test_user_slot_is_added_without_a_copy(self):
        e=Engine(8000);e.perform_step(0,[dict(note=60,velocity=100,tie=1)]);t,p=args(e)
        before=copy.deepcopy(e.project.performance['patterns'])
        e.structure_add(t,p,'user.1.1',before['1:1'],3)
        self.assertEqual(e.project.performance['seq']['chain'],['1:1']*3)
        self.assertEqual(e.project.performance['patterns'],before)

    def test_load_structure_and_edit_it(self):
        e=Engine(8000);e.set_device(0,'drum_rack');t,p=args(e)
        s=next(x for x in structures() if x['id']=='structure.drums.house')
        keys=e.structure_load(t,p,s['id'])
        chain=e.project.performance['seq']['chain']
        self.assertEqual(len(chain),sum(n for _,n in s['parts']))
        self.assertEqual(len(keys),len({i for i,_ in s['parts']}))
        self.assertTrue(all(k.startswith('1:') for k in keys),'parts stay side by side in the bank')
        e.structure_set(chain[::-1],True);self.assertEqual(e.project.performance['seq']['chain'],chain[::-1])
        e.structure_set([],True);seq=e.project.performance['seq']
        self.assertFalse(seq['chain_enabled']);self.assertEqual(len(seq['chain']),1)

    def test_full_banks_refuse_politely(self):
        e=Engine(8000);t,p=args(e)
        for b in range(1,5):
            for s in range(1,17):
                e.project.performance['patterns'][f'{b}:{s}']=dict(length=1,division='1/16',gate=.5,swing=.5,steps=[[dict(note=60,velocity=90,tie=1)]])
        t,p=args(e)
        with self.assertRaisesRegex(ValueError,'empty pattern slots'):e.structure_add(t,p,'bass.more.01')

if __name__=='__main__':unittest.main()
