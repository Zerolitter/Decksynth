"""The engine sends only what changed in its status message; the screen merges the pieces."""
import copy
import unittest

from decksynth.backend import status_delta


class StatusDeltaTests(unittest.TestCase):
    def setUp(self):
        self.blobs = {}
        self.status = dict(beat=1.5, playing=True, state=dict(bpm=120, tracks=[dict(notes=[1, 2, 3])]), voices=2, meter=dict(rms=.1))

    def test_first_message_is_complete(self):
        self.assertEqual(status_delta(self.status, self.blobs), self.status)

    def test_unchanged_parts_are_left_out(self):
        status_delta(self.status, self.blobs)
        later = copy.deepcopy(self.status); later['beat'] = 1.75; later['meter'] = dict(rms=.2)
        delta = status_delta(later, self.blobs)
        self.assertEqual(sorted(delta), ['beat', 'meter'])
        self.assertNotIn('state', delta)

    def test_an_edit_to_the_project_sends_the_project(self):
        status_delta(self.status, self.blobs)
        later = copy.deepcopy(self.status); later['state']['tracks'][0]['notes'].append(4)
        delta = status_delta(later, self.blobs)
        self.assertEqual(delta, dict(state=later['state']))

    def test_nothing_changed_sends_nothing(self):
        status_delta(self.status, self.blobs)
        self.assertEqual(status_delta(copy.deepcopy(self.status), self.blobs), {})

    def test_everything_is_resent_on_request(self):
        status_delta(self.status, self.blobs)
        self.assertEqual(status_delta(self.status, self.blobs, everything=True), self.status)

    def test_merging_the_pieces_gives_back_the_whole(self):
        seen = {}; truth = copy.deepcopy(self.status)
        for step in range(6):
            if step == 2: truth['state']['bpm'] = 90
            if step == 4: truth['playing'] = False
            truth['beat'] = step / 4
            seen.update(status_delta(truth, self.blobs, everything=step == 5))
            self.assertEqual(seen, truth, 'step %d' % step)


if __name__ == '__main__':
    unittest.main()
