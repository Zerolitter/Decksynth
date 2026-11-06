"""Pure geometry and gamepad-action tests for the Steam Deck layout."""
import unittest
from decksynth.core import Project
from decksynth.touch_views import pitch_limits, note_rectangle
from decksynth.app import App


class VisualGeometryTests(unittest.TestCase):
    def test_real_pitches_adapt_visual_range(self):
        assert pitch_limits([]) == (48,84)
        self.assertEqual(pitch_limits([{'note':24},{'note':93}]),(21,96))
        self.assertEqual(pitch_limits([{'note':0},{'note':127}]),(0,127))

    def test_note_width_and_height_are_visible(self):
        note={'start':4.,'duration':2.,'note':60}
        box=note_rectangle(note,16,800,90,(48,84))
        self.assertGreater(box[2]-box[0],70)
        self.assertGreater(box[3]-box[1],10)
        high=note_rectangle(dict(note,note=72),16,800,90,(48,84))
        self.assertLess(high[1],box[1])

    def test_short_note_is_not_invisible(self):
        note={'start':0.,'duration':.02,'note':60}
        box=note_rectangle(note,16,800,80,(48,84))
        self.assertGreaterEqual(box[2]-box[0],9)

    def test_wrap_end_stays_after_loop_end_for_split_render(self):
        note={'start':15.,'duration':3.,'note':60}
        box=note_rectangle(note,16,800,80,(48,84))
        self.assertGreater(box[2],790)


class ControllerDispatchTests(unittest.TestCase):
    def test_gamepad_actions_are_opt_in_and_mapping_preserves_midi(self):
        app=App.__new__(App)
        app.state=Project().data()
        app.selected=0
        app.view='SONG'
        sent=[]
        app.send=lambda cmd,arg=None: sent.append((cmd,arg))
        app.show=lambda view: setattr(app,'view',view)
        app.change_bpm=lambda n: sent.append(('bpm_delta',n))
        app.toggle_metronome=lambda: sent.append(('toggle_metronome',None))
        for name,command in [('A','play'),('B','stop'),('X','record'),('BACK','panic')]:
            app.dispatch_gamepad(name)
            self.assertEqual(sent[-1][0],command)
        app.dispatch_gamepad('L1')
        self.assertEqual(sent[-1],('select',3))
        app.dispatch_gamepad('R1')
        self.assertEqual(sent[-1],('select',1))
        app.dispatch_gamepad('Y')
        self.assertEqual(app.view,'SOUND')
        app.dispatch_gamepad('UP')
        self.assertEqual(sent[-1],('preset','Bell'))
        app.dispatch_gamepad('Y')
        app.dispatch_gamepad('DOWN')
        self.assertEqual(sent[-1],('bpm_delta',-5))
        app.dispatch_gamepad('START')
        self.assertEqual(sent[-1][0],'toggle_metronome')


if __name__=='__main__':
    unittest.main()
