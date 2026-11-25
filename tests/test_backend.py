"""Explicit SDL dummy sink tests. These do NOT validate speakers or USB hardware."""
import multiprocessing as mp
import copy
import os
from pathlib import Path
import queue
import tempfile
import time
import unittest
from unittest.mock import patch
from decksynth.backend import worker, MidiDevice
from decksynth.core import Engine
from decksynth.core import Project
from decksynth.keystep import current_pattern, DIVISIONS


def diagnostic_worker(commands, updates, raw_batch=None):
    """Spawn-safe isolation: never enumerate/open physical MIDI in the child."""
    os.environ['SDL_AUDIODRIVER']='dummy'
    os.environ.setdefault('DECKSYNTH_NO_AUTOSAVE','1')  # never touch the real ~/Music autosave; DECKSYNTH_DATA_DIR still wins
    with patch.object(MidiDevice,'devices',return_value=[]):
        if raw_batch is None:
            worker(commands,updates)
        else:
            class PipeMidi(MidiDevice):
                def __init__(self):
                    super().__init__()
                    self.fd,self.writer=os.pipe()
                    os.set_blocking(self.fd,False)
                    self.connected='synthetic raw MIDI'
                    self.next_scan=float('inf')
                    self.injected=False
                def poll(self,engine):
                    pattern=current_pattern(engine.project.performance)
                    step=round(engine.beat/DIVISIONS[pattern['division']])%pattern['length']
                    if (engine.project.performance['seq']['recording'] and not self.injected
                            and len(pattern['steps'][step])==8):
                        os.write(self.writer,raw_batch)
                        self.injected=True
                    return super().poll(engine)
                def close(self):
                    super().close()
                    os.close(self.writer)
            with patch('decksynth.backend.MidiDevice',PipeMidi):
                worker(commands,updates)


class MidiCapacityTests(unittest.TestCase):
    def poll_bytes(self,device,engine,data):
        with patch('decksynth.backend.os.read',return_value=data):
            return device.poll(engine)

    def test_raw_capacity_rejection_preserves_data_and_processes_batch_releases(self):
        e=Engine(1000)
        e.project.tracks[2]['notes']=[dict(start=0.,duration=.5,note=48,velocity=90)]
        e.perform_set('seq','enabled',True)
        e.perform_set('seq','recording',True)
        m=MidiDevice();m.fd=101;m.connected='synthetic';m.next_scan=float('inf')
        # Both filling and overflow go through the actual raw-MIDI parser/poll.
        self.poll_bytes(m,e,bytes([0x90,60,100,*sum(([n,100] for n in range(61,68)),[])]))
        self.assertEqual(len(e.project.performance['patterns']['1:1']['steps'][0]),8)
        before=copy.deepcopy(e.project.data());history=copy.deepcopy(e.history)
        batch=bytes([0x90,72,110,0xb0,1,90,0x80,*sum(([n,0] for n in [*range(60,68),72]),[])])
        reports=self.poll_bytes(m,e,batch)
        self.assertEqual(reports,['Maximum eight notes per step'])
        self.assertEqual(e.project.data(),before)
        self.assertEqual(e.history,history)
        self.assertAlmostEqual(e.synths[0].mod_wheel,90/127)
        self.assertFalse(e.down)
        self.assertFalse(e.perform_held.held())
        self.assertFalse(e.live_note_map)
        e.render(1000)
        self.assertFalse(any(s.voices for s in e.synths))
        e.playing=True
        self.assertGreater(max(map(abs,e.render(250))),.001)
        e.stop()
        self.assertFalse(e.playing)
        self.assertFalse(any(s.voices for s in e.synths))
        self.assertFalse(e.scheduled_live)
        # A separate overflow with delayed chord voices must also clean up on Panic.
        e.perform_set('chord','enabled',True);e.perform_set('chord','strum_ms',100)
        e.perform_set('seq','recording',True)
        self.poll_bytes(m,e,bytes([0x90,72,100]))
        self.assertTrue(e.scheduled_live)
        e.panic()
        self.assertFalse(e.scheduled_live)
        self.assertFalse(e.down)
        self.assertFalse(e.live_note_map)
        self.assertFalse(any(s.voices for s in e.synths))
        m.fd=None

    def test_raw_unrelated_value_error_is_not_swallowed(self):
        e=Engine(1000)
        m=MidiDevice();m.fd=101;m.connected='synthetic';m.next_scan=float('inf')
        with patch.object(e,'midi',side_effect=ValueError('unrelated fault')):
            with self.assertRaisesRegex(ValueError,'unrelated fault'):
                self.poll_bytes(m,e,bytes([0x90,60,100]))
        m.fd=None

    def test_raw_rejection_does_not_release_scheduled_sequence_voices(self):
        e=Engine(1000)
        e.perform_step(0,[dict(note=n,velocity=100,tie=1) for n in range(60,68)])
        e.perform_set('seq','enabled',True);e.perform_set('seq','recording',True)
        e.playing=True;e.render(1)
        tokens=[k for k in e.synths[0].voices if k[0]=='perf_seq']
        self.assertEqual(len(tokens),8)
        m=MidiDevice();m.fd=101;m.connected='synthetic';m.next_scan=float('inf')
        self.poll_bytes(m,e,bytes([0x90,72,100,0x80,72,0]))
        self.assertTrue(e.playing)
        self.assertTrue(all(e.synths[0].voices[k]['release'] is None for k in tokens))
        e.stop();self.assertFalse(any(s.voices for s in e.synths))
        m.fd=None


def merge_status(whole,obj):
    """The engine sends only what changed in its status; keep the whole, as the screen does."""
    if any(k in obj for k in ('message','error','bridge')):return obj
    whole.update(obj);return dict(whole)


class BackendTests(unittest.TestCase):
    def test_project_load_discards_mutation_baselines(self):
        ctx=mp.get_context('spawn');commands=ctx.Queue();updates=ctx.Queue(64)
        proc=ctx.Process(target=diagnostic_worker,args=(commands,updates));proc.start()
        whole={}
        def receive(predicate):
            deadline=time.monotonic()+8
            while time.monotonic()<deadline:
                try:obj=updates.get(timeout=.2)
                except queue.Empty:continue
                obj=merge_status(whole,obj)
                if predicate(obj):return obj
            self.fail('Timed out waiting for mutation load boundary')
        try:
            receive(lambda o:'state' in o)
            commands.put(('perform_step',[0,[dict(note=60,velocity=100,tie=1)],True]))
            commands.put(('perform_action',['mutate',1.]))
            receive(lambda o:o.get('message')=='Pattern mutated')
            with tempfile.TemporaryDirectory() as directory:
                path=str(Path(directory)/'mutated.decksynth')
                commands.put(('save',path));receive(lambda o:o.get('message')=='Saved '+path)
                saved=Project.load(path)
                commands.put(('load',path));receive(lambda o:o.get('message')=='Opened '+path)
                commands.put(('perform_action',['reset_mutate',None]))
                rejection=receive(lambda o:'error' in o)
                self.assertIn('No mutation',rejection['error'])
                state=receive(lambda o:'state' in o)
                self.assertEqual(state['state']['performance'],saved.performance)
                self.assertEqual(state['devices'],[]);self.assertEqual(state['audio'],'dummy')
        finally:
            commands.put(('quit',None));proc.join(3)
            if proc.is_alive():proc.terminate();proc.join()
            commands.close();updates.close()

    def test_sdl_worker_four_bar_layer_save_reopen(self):
        ctx=mp.get_context('spawn'); commands=ctx.Queue(); updates=ctx.Queue(32)
        proc=ctx.Process(target=diagnostic_worker,args=(commands,updates)); proc.start()
        def send(c,a=None):commands.put((c,a))
        whole={}
        def wait_for(predicate,seconds=8):
            deadline=time.monotonic()+seconds
            while time.monotonic()<deadline:
                try:obj=updates.get(timeout=.2)
                except queue.Empty:continue
                self.assertNotIn('error',obj,str(obj))
                obj=merge_status(whole,obj)
                if predicate(obj):return obj
            self.fail('Timed out waiting for audio worker state')
        try:
            state=wait_for(lambda o:'state' in o)
            self.assertEqual(state['audio'],'dummy')
            self.assertEqual(state['devices'],[])
            self.assertIsNone(state['connected'])
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
            self.assertEqual(len(state['state']['tracks']),1)  # a new session starts with one track
            send('add_track'); send('select',1); send('record'); send('midi',(0x90,48,110)); time.sleep(.15); send('midi',(0x80,48,0))
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

    def test_raw_overflow_reports_rejection_and_keeps_audio_worker_running(self):
        ctx=mp.get_context('spawn');commands=ctx.Queue();updates=ctx.Queue(64)
        batch=bytes([0x90,72,110,0x80,72,0])
        proc=ctx.Process(target=diagnostic_worker,args=(commands,updates,batch));proc.start()
        whole={}
        def receive(predicate):
            deadline=time.monotonic()+8
            while time.monotonic()<deadline:
                try:obj=updates.get(timeout=.2)
                except queue.Empty:continue
                if 'error' in obj:
                    self.assertEqual(obj['error'],'Maximum eight notes per step',obj)
                obj=merge_status(whole,obj)
                if predicate(obj):return obj
            self.fail('Timed out waiting for live audio worker after raw MIDI')
        try:
            receive(lambda o:'state' in o)
            with tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'capacity.decksynth';p=Project()
                p.performance['seq']['enabled']=True
                p.performance['patterns']['1:1']=dict(length=16,division='1/16',gate=.8,swing=.5,
                    steps=[[dict(note=n,velocity=100,tie=1) for n in range(60,68)]]+[[] for _ in range(15)])
                p.tracks[2]['notes']=[dict(start=0.,duration=.5,note=48,velocity=90)]
                p.tracks[2]['mute']=True
                p.save(path)
                commands.put(('load',str(path)))
                receive(lambda o:o.get('message')=='Opened '+str(path))
                commands.put(('play',None))
                receive(lambda o:o.get('playing') and o['meter']['peak']>.001)
                commands.put(('perform_set',['seq','recording',True]))
                receive(lambda o:'error' in o)
                state=receive(lambda o:'state' in o)
                self.assertEqual(state['state']['performance']['patterns'],p.performance['patterns'])
                self.assertEqual(state['state']['tracks'],p.tracks)
                self.assertEqual(state['devices'],[])
                self.assertEqual(state['audio'],'dummy')
                self.assertTrue(state['playing'])
                self.assertEqual(state['held_notes'],[])
                receive(lambda o:'state' in o and o['voices']==0)
                receive(lambda o:o.get('playing') and o['meter']['peak']>.001)
                self.assertTrue(proc.is_alive())
                commands.put(('stop',None))
                receive(lambda o:'state' in o and not o['playing'] and o['voices']==0 and not o['held_notes'])
                commands.put(('midi',[0x90,72,100]))
                receive(lambda o:'state' in o and o['voices']>0 and o['held_notes'])
                commands.put(('panic',None))
                receive(lambda o:'state' in o and o['voices']==0 and not o['held_notes'])
        finally:
            commands.put(('quit',None));proc.join(3)
            if proc.is_alive():proc.terminate();proc.join()
            commands.close();updates.close()
