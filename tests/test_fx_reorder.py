import copy
import unittest

from decksynth.core import Engine
from decksynth.fx import default_chain


class FxReorderTests(unittest.TestCase):
    def engine(self):
        e = Engine(48000)
        chain = default_chain()
        for module in chain['modules']:
            module['on'] = module['id'] in ('filter', 'overdrive', 'delay')
        chain['mods'][1]['targets'] = [dict(module='filter', param='cutoff', depth=.4)]
        e.set_fx(0, chain)
        return e

    def test_one_commit_and_undo_preserves_project_and_parameters(self):
        e = self.engine()
        before = copy.deepcopy(e.project.data())
        e.selected = 2
        e.reorder_fx(0, ['delay', 'filter', 'overdrive'])
        chain = e.project.tracks[0]['fx']
        self.assertEqual([m['id'] for m in chain['modules'] if m['on']], ['delay', 'filter', 'overdrive'])
        old = before['tracks'][0]['fx']
        self.assertEqual({m['id']:m for m in chain['modules']}, {m['id']:m for m in old['modules']})
        for key in ('macros', 'mods', 'morph'):
            self.assertEqual(chain[key], old[key])
        self.assertEqual(len(e.history), 1)
        e.undo()
        self.assertEqual(e.project.data(), before)
        self.assertEqual(e.history, [])

    def test_invalid_stale_and_noop_orders_do_not_change_state_or_history(self):
        e = self.engine()
        before = copy.deepcopy(e.project.data())
        for track, order in [(0,['filter']), (0,['filter','filter','delay']),
                             (0,['filter','overdrive','missing']), (-1,[]), (True,[]), (4,[]),
                             (0,'filter'), (0,[{},'filter','delay'])]:
            with self.subTest(track=track, order=order), self.assertRaises(ValueError):
                e.reorder_fx(track, order)
            self.assertEqual(e.project.data(), before)
            self.assertEqual(e.history, [])
        e.reorder_fx(0, [m['id'] for m in before['tracks'][0]['fx']['modules'] if m['on']])
        self.assertEqual(e.history, [])


if __name__ == '__main__':
    unittest.main()
