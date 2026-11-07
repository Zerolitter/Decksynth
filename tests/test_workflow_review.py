"""Single final review pass: performance sources retain their own note-offs."""
import copy,unittest
from decksynth.core import Engine
from decksynth.keystep import current_pattern
class WorkflowReview(unittest.TestCase):
 def test_preview_keeps_latched_arp_note_offs_on_the_native_clock(self):
  e=Engine();e.perform_set('arp','enabled',True);e.perform_set('arp','hold',True);e.midi(0x90,60,100);e.midi(0x80,60,0);e.playing=True;e.render(128)
  original={k for k in e.synths[0].gated if isinstance(k,tuple) and k[0]=='perf_arp'};self.assertTrue(original)
  t=dict(kind='pattern',track=0,bank=1,slot=1,device='synth',kit=None);p=copy.deepcopy(current_pattern(e.project.performance));before=copy.deepcopy(e.project.data());e.catalog_action('preview',t,p,'existing.1.01');e.render(48000)
  self.assertFalse(original&set(e.synths[0].gated),'arp releases must run while preview replaces only SEQ')
  self.assertTrue(any(isinstance(k,tuple) and k[0]=='perf_arp' for k in e.synths[0].gated));e.stop_pattern_preview();e.render(48000);self.assertFalse(original&set(e.synths[0].gated));self.assertEqual(e.project.data(),before)

 def test_preview_stops_if_the_track_is_muted_after_start(self):
  e=Engine();t=dict(kind='pattern',track=0,bank=1,slot=1,device='synth',kit=None);e.catalog_action('preview',t,copy.deepcopy(current_pattern(e.project.performance)),'existing.1.01');e.project.tracks[0]['mute']=True;e.render(128);self.assertIsNone(e.preview_status())
