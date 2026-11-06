"""Explicit SDL dummy sink tests. These do NOT validate speakers or USB hardware."""
import multiprocessing as mp
import os
from pathlib import Path
import queue
import tempfile
import time
import unittest
from decksynth.backend import worker
from decksynth.core import Project

class BackendTests(unittest.TestCase):
    def test_sdl_worker_four_bar_layer_save_reopen(self):
        old=os.environ.get('SDL_AUDIODRIVER'); os.environ['SDL_AUDIODRIVER']='dummy'
        ctx=mp.get_context('spawn'); commands=ctx.Queue(); updates=ctx.Queue(32)
        proc=ctx.Process(target=worker,args=(commands,updates)); proc.start()
        def send(c,a=None):commands.put((c,a))
        def wait_for(predicate,seconds=8):
            deadline=time.monotonic()+seconds
            while time.monotonic()<deadline:
                try:obj=updates.get(timeout=.2)
                except queue.Empty:continue
                self.assertNotIn('error',obj,str(obj))
                if predicate(obj):return obj
            self.fail('Timed out waiting for audio worker state')
        try:
            state=wait_for(lambda o:'state' in o)
            self.assertEqual(state['audio'],'dummy')
            self.assertIn('meter',state)
            self.assertEqual(len(state['meter']['wave']),96)
            self.assertGreaterEqual(state['meter']['rms'],0.)
            self.assertGreaterEqual(state['meter']['peak'],0.)
            self.assertEqual(state['audio_output'],'System default')
            self.assertIsInstance(state['audio_outputs'],list)
            send('audio_device','System default')
            state=wait_for(lambda o:'state' in o and o['audio_output']=='System default')
            self.assertEqual(state['audio'],'dummy')
            send('tempo',240); send('record'); send('midi',(0x90,60,100)); time.sleep(.12); send('midi',(0x80,60,0))
            wait_for(lambda o:o.get('recording',False))
            state=wait_for(lambda o:'state' in o and not o['recording'] and len(o['state']['tracks'][0]['notes'])==1)
            self.assertTrue(state['playing']); self.assertEqual(state['state']['bars'],4)
            send('select',1); send('record'); send('midi',(0x90,48,110)); time.sleep(.15); send('midi',(0x80,48,0))
            wait_for(lambda o:o.get('recording',False))
            state=wait_for(lambda o:'state' in o and not o['recording'] and len(o['state']['tracks'][1]['notes'])==1)
            self.assertTrue(state['playing']); self.assertEqual(len(state['state']['tracks'][0]['notes']),1)
            with tempfile.TemporaryDirectory() as d:
                path=str(Path(d)/'session.decksynth'); send('save',path)
                wait_for(lambda o:o.get('message','').startswith('Saved '))
                project=Project.load(path); self.assertEqual(len(project.tracks[1]['notes']),1)
                send('clear'); send('load',path)
                wait_for(lambda o:o.get('message','').startswith('Opened '))
                state=wait_for(lambda o:'state' in o and len(o['state']['tracks'][1]['notes'])==1)
                self.assertFalse(state['playing'])
        finally:
            send('quit'); proc.join(3)
            if proc.is_alive():proc.terminate(); proc.join()
            commands.close(); updates.close()
            if old is None:os.environ.pop('SDL_AUDIODRIVER',None)
            else:os.environ['SDL_AUDIODRIVER']=old
