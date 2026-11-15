"""Sampler expansion (15 Nov evening): one Undo, whole-song Freeze, WAV load, chop, slices to pads and keys."""
import copy,unittest
from decksynth.core import Engine

class OneUndo(unittest.TestCase):
    def knob(self,e,value):
        e.sound_gesture(0,'sound','filter','begin');e.apply_control(0,'sound','filter',value);e.sound_gesture(0,'sound','filter','end')
    def test_top_undo_takes_back_the_newest_knob_gesture(self):
        e=Engine();before=e.project.tracks[0]['instrument']['filter']
        e.snapshot();e.project.bpm=99
        self.knob(e,.2);self.assertNotEqual(e.project.tracks[0]['instrument']['filter'],before)
        e.undo_any()
        self.assertEqual(e.project.tracks[0]['instrument']['filter'],before)
        self.assertEqual(e.project.bpm,99,'the older project edit is still there')
        e.undo_any();self.assertEqual(e.project.bpm,120)
    def test_top_undo_takes_back_a_newer_project_edit_first(self):
        e=Engine();self.knob(e,.3);moved=e.project.tracks[0]['instrument']['filter']
        e.snapshot();e.project.bpm=88
        e.undo_any();self.assertEqual(e.project.bpm,120);self.assertEqual(e.project.tracks[0]['instrument']['filter'],moved)
        e.undo_any();self.assertNotEqual(e.project.tracks[0]['instrument']['filter'],moved)

if __name__=='__main__':unittest.main()


# ---- Stage 2: one freeze holds the whole Song and the Loop -------------------------------------
import os,shutil,tempfile
from decksynth.core import Project
from decksynth.freeze import fingerprint,freeze_directory,freeze_modes,describe_holds,validate_freeze
from decksynth.freeze_engine import track_freezes

def song_and_loop_project():
    p=Project();p.bpm=120;p.bars=1
    p.tracks[0]['notes']=[dict(start=0.,duration=.5,note=60,velocity=100),dict(start=2.,duration=.5,note=67,velocity=90)]
    p.song.update(on=False,loop=True,length=4)
    p.song['lanes'][0]=[dict(at=0,len=4,clip=p.clips['open'][0],off=0)]
    for i in (1,2,3):p.tracks[i]['mute']=True
    return p

class WholeSongFreeze(unittest.TestCase):
    def setUp(self):
        self.dir=tempfile.mkdtemp();os.environ['DECKSYNTH_DATA_DIR']=self.dir;freeze_directory().mkdir(parents=True,exist_ok=True)
    def tearDown(self):
        os.environ.pop('DECKSYNTH_DATA_DIR',None);shutil.rmtree(self.dir,ignore_errors=True)
    def both(self,p):
        from decksynth.render_jobs import RenderJob
        modes=freeze_modes(p,0);self.assertEqual(modes,['song','loop'])
        paths=[os.path.join(self.dir,m+'.wav') for m in modes]
        job=RenderJob('freeze',p.data(),48000,paths,track=0,meta=dict(modes=modes)).wait(180)
        self.assertIsNone(job.error);self.assertEqual([m['mode'] for m in job.result],modes)
        return [validate_freeze(dict(m,fingerprint=fingerprint(p,0,m['mode']))) for m in job.result]
    def test_freeze_from_loop_mode_still_covers_the_song_timeline(self):
        p=song_and_loop_project()   # Loop mode is on, as on the Sound page
        metas=self.both(p);song=metas[0]
        self.assertEqual(song['pass_frames'],round(4*4*48000*60/120),'the whole 4-bar timeline, not the 1-bar loop')
        self.assertEqual(describe_holds(metas),'Song 4 bars + Loop 1 bar')
        e=Engine();e.project=copy.deepcopy(p);e.configure();e.set_freeze(0,metas)
        self.assertEqual(set(track_freezes(e.project.tracks[0])),{'song','loop'})
        self.assertTrue(e.frozen_active(0,'song'));self.assertTrue(e.frozen_active(0,'loop'))
        st=e.freeze_status()[0];self.assertEqual(st['state'],'frozen')
        self.assertEqual([(h['mode'],h['bars']) for h in st['holds']],[('song',4.0),('loop',1.0)])
        # Save and load keep both; undo takes the freeze back as one step.
        f=os.path.join(self.dir,'p.decksynth');e.project.save(f);q=Project.load(f)
        self.assertEqual(q.tracks[0]['freeze_loop']['mode'],'loop')
        e.set_freeze(0,None);self.assertEqual(e.freeze_state[0],'none');e.undo();e.freeze_refresh();self.assertEqual(e.freeze_state[0],'frozen')
    def test_frozen_song_plays_the_file_in_song_mode_and_loop_file_in_loop_mode(self):
        p=song_and_loop_project();metas=self.both(p)
        for on in (True,False):
            q=copy.deepcopy(p);q.song['on']=on
            live=Engine();live.project=copy.deepcopy(q);live.configure();live.playing=True
            frozen=Engine();frozen.project=copy.deepcopy(q);frozen.configure();frozen.set_freeze(0,metas);frozen.playing=True
            a=[];b=[]
            for _ in range(48000//256):a+=live.render_stereo(256);b+=frozen.render_stereo(256)
            self.assertEqual(frozen.synths[0].voices,{},'no live synth voices on the frozen track')
            diff=max(abs(x-y) for x,y in zip(a,b));self.assertLess(diff,1e-4,('song' if on else 'loop')+' mode matches live')
    def test_an_edit_makes_both_stale_and_says_so(self):
        p=song_and_loop_project();metas=self.both(p)
        e=Engine();e.project=copy.deepcopy(p);e.configure();e.set_freeze(0,metas)
        e.project.tracks[0]['notes'].append(dict(start=1.,duration=.5,note=64,velocity=90));e.freeze_refresh()
        self.assertEqual(e.freeze_state[0],'stale');self.assertFalse(e.frozen_active(0,'loop'))


# -- stage 3: load a WAV, chop it, send slices to pads ---------------------------------------------
import math,struct,time,wave
from pathlib import Path
from decksynth.sampler import validate_sampler,new_sampler
from decksynth import sampler_chop as chopper
from decksynth.samples import SampleCache

R=48000


def hits_wav(path,hits=6,gap=.4,rate=R,channels=2,bits=16):
    """Decaying 440 Hz notes every `gap` seconds with silence in between: like a piano library take."""
    n=int(hits*gap*rate);frames=[]
    for i in range(n):
        t=(i%int(gap*rate))/rate
        v=.7*math.exp(-t*30)*math.sin(2*math.pi*440*t) if t<.15 else 0.
        frames.append(v)
    with wave.open(str(path),'wb') as w:
        w.setnchannels(channels);w.setsampwidth(bits//8);w.setframerate(rate)
        if bits==16:
            w.writeframes(b''.join(struct.pack('<'+'h'*channels,*[round(v*32767)]*channels) for v in frames))
        else:
            w.writeframes(b''.join(round(v*8388607).to_bytes(3,'little',signed=True)*channels for v in frames))
    return path


class SamplerTrack:
    def setUp(self):
        self.dir=Path(tempfile.mkdtemp())
        self.e=e=Engine(R);e.chop_directory=str(self.dir/'data')
        e.set_device(1,'sampler');self.id=e.project.tracks[1]['sampler']['id']

    def tearDown(self):
        self.e.sampler_tasks.close();shutil.rmtree(self.dir,ignore_errors=True)

    def settle(self):
        notes=[]
        for _ in range(500):
            notes+=self.e.poll_sampler_tasks()
            if not self.e.sampler_tasks.jobs:return notes
            time.sleep(.01)
        self.fail('sampler task did not finish')

    def load(self,**kw):
        path=hits_wav(self.dir/'piano take.wav',**kw)
        self.e.load_sampler_wav(1,self.id,str(path))
        self.assertTrue(self.e.samplers[1].loading)
        notes=self.settle();return notes

    def spec(self):return self.e.project.tracks[1]['sampler']

class LoadAndChop(SamplerTrack,unittest.TestCase):

    def test_long_stereo_and_24_bit_wavs_decode_like_the_old_decoder(self):
        for bits in (16,24):
            path=hits_wav(self.dir/('b%d.wav'%bits),hits=2,bits=bits)
            s=SampleCache(R).load(path)
            with wave.open(str(path)) as w:raw=w.readframes(w.getnframes())
            width=bits//8;scale=1/(1<<(bits-1))
            for i in (0,100,4801,9000):
                o=i*2*width;l=int.from_bytes(raw[o:o+width],'little',signed=True);r=int.from_bytes(raw[o+width:o+2*width],'little',signed=True)
                self.assertAlmostEqual(s.data[i],(l+r)*.5*scale,places=6)

    def test_load_wav_into_sampler_is_one_undo_step_and_names_it(self):
        notes=self.load()
        spec=self.spec()
        self.assertEqual(spec['name'],'piano take');self.assertEqual(spec['slices'],[])
        self.assertEqual(spec['root'],69)  # 440 Hz detected
        self.assertIn('Loaded piano take',notes[0]['message'])
        self.assertEqual(self.e.sampler_state()[1]['status'],'READY')
        self.e.undo_any();self.assertIsNone(self.e.project.tracks[1]['sampler']['source'])

    def test_bad_wav_reports_and_stops_loading(self):
        bad=self.dir/'bad.wav';bad.write_bytes(b'nope')
        self.e.load_sampler_wav(1,self.id,str(bad))
        notes=self.settle()
        self.assertIn('WAV not loaded',notes[0]['error']);self.assertFalse(self.e.samplers[1].loading)

    def test_threshold_finds_each_note_and_trims_the_silence(self):
        self.load(hits=6)
        self.e.chop_sampler(1,self.id,'threshold',dict(threshold=-30,min_ms=50));notes=self.settle()
        sl=self.spec()['slices']
        self.assertEqual(len(sl),6,sl);self.assertEqual(notes[-1]['message'],'6 slices')
        for i,(a,b) in enumerate(sl):
            self.assertAlmostEqual(a*2.4,i*.4,delta=.006)       # starts on the note
            self.assertLess((b-a)*2.4,.3)                        # the silence after it is left out
        self.e.undo_any();self.assertEqual(self.spec()['slices'],[])

    def test_regions_bpm_split_join_and_clear(self):
        self.load(hits=4)
        self.e.chop_sampler(1,self.id,'regions',dict(count=8));self.settle()
        sl=self.spec()['slices'];self.assertEqual(len(sl),8)
        self.assertTrue(all(abs((b-a)-1/8)<.002 for a,b in sl))
        self.e.chop_sampler(1,self.id,'bpm',dict(bpm=150,beats=1.));self.settle()
        self.assertEqual(len(self.spec()['slices']),4)          # 0.4 s beats in 1.6 s
        self.e.chop_sampler(1,self.id,'split',dict(index=1,at=.375));self.settle()
        sl=self.spec()['slices'];self.assertEqual(len(sl),5);self.assertAlmostEqual(sl[1][1],.375,delta=.002);self.assertEqual(sl[1][1],sl[2][0])
        self.e.chop_sampler(1,self.id,'join',dict(index=1));self.settle()
        self.assertEqual(len(self.spec()['slices']),4)
        self.e.chop_sampler(1,self.id,'clear');self.assertEqual(self.spec()['slices'],[])
        self.e.chop_sampler(1,self.id,'regions',dict(count=99))
        self.assertIn('Regions',self.settle()[0]['error']);self.assertEqual(self.spec()['slices'],[])

    def test_slices_validate(self):
        s=new_sampler()
        for bad in ([[.5,.4]],[[0,.5],[.4,.6]],[[0,1.2]],[[0,.1]]*65,'x'):
            with self.assertRaises(ValueError):validate_sampler(dict(s,slices=bad))
        legacy=dict(s);legacy.pop('slices');self.assertEqual(validate_sampler(legacy)['slices'],[])

    def test_audition_plays_the_slice_and_shows_where(self):
        self.load(hits=3)
        self.e.chop_sampler(1,self.id,'regions',dict(count=3));self.settle()
        self.e.audition_slice(1,self.id,2)
        out=self.e.render(2048)
        self.assertGreater(max(abs(v) for v in out),.05)
        aud=self.e.sampler_state()[1]['audition'];self.assertEqual(aud['index'],2);self.assertGreater(aud['at'],2/3)

    def test_zoom_view_peaks(self):
        self.load(hits=3)
        self.e.sampler_view(1,self.id,.25,.5);self.settle()
        st=self.e.sampler_state()[1];self.assertEqual(st['view'],[.25,.5]);self.assertEqual(len(st['peaks']),256)
        self.e.sampler_view(1,self.id,0,1);self.assertEqual(self.e.sampler_state()[1]['view'],[0.,1.])

    def test_slices_become_a_new_drum_kit_in_one_undo_step(self):
        self.load(hits=6)
        self.e.chop_sampler(1,self.id,'threshold',dict(threshold=-30,min_ms=50));self.settle()
        before=self.e.project.tracks[2].get('device')
        self.e.slices_to_pads(1,self.id,2,'kit',dict(bank=0));notes=self.settle()
        t=self.e.project.tracks[2];self.assertEqual(t['device'],'drum_rack')
        pads=t['drum_rack']['pads'];self.assertEqual(t['drum_rack']['name'],'piano take')
        self.assertEqual([p['name'] for p in pads[:6]],['piano take %02d'%i for i in range(1,7)])
        self.assertIsNone(pads[6]['source']);self.assertTrue(all(p['choke']==0 for p in pads))
        self.assertTrue(Path(pads[0]['source']['path']).is_file())
        self.assertIn('slices 1-6',notes[-1]['message'])
        self.assertEqual(self.e.drum_state()[2]['pads'][0]['status'] if isinstance(self.e.drum_state()[2],dict) else 'x','READY')
        self.e.undo_any();self.assertEqual(self.e.project.tracks[2].get('device'),before)

    def test_one_slice_to_one_pad(self):
        self.load(hits=4)
        self.e.chop_sampler(1,self.id,'regions',dict(count=4));self.settle()
        self.e.set_device(3,'drum_rack');kit=self.e.project.tracks[3]['drum_rack']['id']
        self.e.slices_to_pads(1,self.id,3,'pad',dict(index=2,pad=5,kit=kit));self.settle()
        p=self.e.project.tracks[3]['drum_rack']['pads'][5]
        self.assertEqual(p['name'],'piano take 03');self.assertIsNotNone(p['source'])
        with self.assertRaises(ValueError):self.e.slices_to_pads(1,self.id,1,'kit',{})

    def test_written_slice_round_trips(self):
        data=chopper.array('f',[math.sin(i/7)*.5 for i in range(4801)])
        path=self.dir/'s.wav';chopper.write_wav(path,data,R)
        s=SampleCache(R).load(path)
        self.assertEqual(s.frames,4801);self.assertEqual(s.bits,24)
        self.assertAlmostEqual(s.data[2400],data[2400],places=5);self.assertEqual(s.data[0],0.)


# -- stage 4: slices on the keys, and more tuning ------------------------------------------------
def notes_wav(path,freqs=(220.,330.,440.,660.),gap=.5,rate=R):
    """One sustained tone per slot, with silence after it: like recording a piano note by note."""
    n=int(len(freqs)*gap*rate);frames=[]
    for i in range(n):
        k=int(i//(gap*rate));t=(i%int(gap*rate))/rate
        frames.append(.6*math.sin(2*math.pi*freqs[k]*t) if t<.35 else 0.)
    with wave.open(str(path),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate)
        w.writeframes(struct.pack('<%dh'%n,*[round(v*32767) for v in frames]))
    return path


def crossings(x):return sum(1 for a,b in zip(x,x[1:]) if a<=0<b)


class KeysAndTuning(unittest.TestCase):
    def setUp(self):
        self.dir=Path(tempfile.mkdtemp())
        self.e=e=Engine(R);e.chop_directory=str(self.dir/'data')
        e.set_device(1,'sampler');self.id=e.project.tracks[1]['sampler']['id']
        for i in range(4):e.project.tracks[i]['mute']=i!=1
        e.project.tracks[1].pop('fx',None);e.fx[1].configure(None)
        e.load_sampler_wav(1,self.id,str(notes_wav(self.dir/'notes.wav')));self.settle()
        e.chop_sampler(1,self.id,'threshold',dict(threshold=-30,min_ms=50));self.settle()
        self.assertEqual(len(self.spec()['slices']),4)

    def tearDown(self):
        self.e.sampler_tasks.close();shutil.rmtree(self.dir,ignore_errors=True)

    def settle(self):
        notes=[]
        for _ in range(1000):
            notes+=self.e.poll_sampler_tasks()
            if not self.e.sampler_tasks.jobs:return notes
            time.sleep(.01)
        self.fail('sampler task did not finish')

    def spec(self):return self.e.project.tracks[1]['sampler']
    def edit(self,**kw):self.e.edit_sampler(1,self.id,'patch',kw)
    def play(self,note,frames=4800,velocity=127):
        s=self.e.samplers[1];s.panic();s.on(note,velocity,'t');out=[0.]*frames;s.render_into(out,frames);return s,out

    def test_slices_sit_one_per_key_from_the_root(self):
        self.edit(keymap='slices',root=48)
        s,out=self.play(50)                       # slice 3 (440 Hz) at its own pitch
        v=[v for v in s.voices if v.active][0]
        a,b=self.spec()['slices'][2][:2];n=s.params.frames
        self.assertEqual((v.start,v.end),(int(a*n),round(b*n)))
        self.assertAlmostEqual(crossings(out)/0.1,440,delta=25)
        self.assertFalse(s.on(47,100,'x'));self.assertFalse(s.on(52,100,'x'))   # no slice there

    def test_pitched_slices_play_the_nearest_root_tuned_to_the_key(self):
        notes=self.e.detect_slice_roots(1,self.id);notes=self.settle()
        self.assertEqual(notes[-1]['message'],'Found the pitch of 4 of 4 slices')
        self.assertEqual(self.spec()['keymap'],'pitched')
        self.assertEqual([p[2] for p in self.spec()['slices']],[57,64,69,76])    # A3 E4 A4 E5
        s,out=self.play(71)                       # B4: from the A4 slice, two semitones up
        v=[v for v in s.voices if v.active][0];a=self.spec()['slices'][2][0]
        self.assertEqual(v.start,int(a*s.params.frames))
        self.assertAlmostEqual(crossings(out)/0.1,440*2**(2/12),delta=25)

    def test_reverse_plays_backwards_from_the_end(self):
        self.edit(reverse=True)
        s=self.e.samplers[1];s.on(60,100,'t');v=[v for v in s.voices if v.active][0]
        self.assertEqual(v.dir,-1);start=v.pos;s.render_into([0.]*256,256);self.assertLess(v.pos,start)

    def test_normalize_brings_the_peak_to_full_level(self):
        _,quiet=self.play(60);self.edit(normalize=True);_,loud=self.play(60)
        self.assertAlmostEqual(max(map(abs,loud))/max(map(abs,quiet)),1/.6,delta=.08)

    def test_low_pass_filter_and_its_envelope(self):
        self.edit(keymap='slices',root=60);_,dry=self.play(63)                  # 660 Hz
        self.edit(filter='lp',cutoff=150.,resonance=0.);_,dark=self.play(63)
        self.assertLess(max(map(abs,dark[2400:])),.3*max(map(abs,dry[2400:])))
        self.edit(f_env=1.,f_attack=0.,f_decay=2.);_,opened=self.play(63)      # the envelope opens it
        self.assertGreater(max(map(abs,opened[2400:])),2*max(map(abs,dark[2400:])))
        self.edit(f_env=0.,f_velocity=1.,cutoff=4000.);_,soft=self.play(63,velocity=20);_,hard=self.play(63,velocity=127)
        self.assertLess(max(map(abs,soft[2400:]))/max(map(abs,hard[2400:])),.6)

    def test_pitch_envelope_starts_high_and_settles(self):
        self.edit(keymap='slices',root=60,p_env=12.,p_decay=.1)
        _,out=self.play(62,frames=14400)
        early,late=crossings(out[:1200])/.025,crossings(out[9600:12000])/.05
        self.assertGreater(early,1.3*late);self.assertAlmostEqual(late,440,delta=30)

    def test_native_and_python_match_with_filter_pitch_env_and_reverse(self):
        s=self.e.samplers[1]
        if s._kernel is None:self.skipTest('no native Sampler library here')
        self.edit(keymap='slices',root=60,filter='bp',cutoff=800.,resonance=.6,f_env=.5,p_env=-7.,reverse=True,mode='loop')
        import ctypes
        s.panic();s.on(61,90,'a');s.on(62,60,'b')
        twin=(type(s.voices[0])*len(s.voices))();ctypes.memmove(twin,s.voices,ctypes.sizeof(s.voices))
        native=[0.]*R;s.render_into(native,R)
        ctypes.memmove(s.voices,twin,ctypes.sizeof(s.voices));kernel=s._kernel;s._kernel=None
        try:python=[0.]*R;s.render_into(python,R)
        finally:s._kernel=kernel
        self.assertGreater(max(map(abs,native)),.01)
        self.assertLess(max(abs(a-b) for a,b in zip(native,python)),1e-9)

    def test_new_settings_validate_and_old_projects_get_defaults(self):
        s=new_sampler()
        for k,bad in dict(keymap='zones',filter='notch',cutoff=5.,resonance=2.,p_env=48.,reverse=1).items():
            with self.assertRaises(ValueError):validate_sampler(dict(s,**{k:bad}))
        old={k:v for k,v in s.items() if k not in ('keymap','filter','cutoff','reverse','normalize','p_env','slices')}
        clean=validate_sampler(old);self.assertEqual((clean['keymap'],clean['filter'],clean['reverse']),('whole','off',False))
        self.assertEqual(validate_sampler(dict(s,keymap='slices'))['keymap'],'whole')    # no slices: plays whole


# ---- Stage 5: record the piano into a Sampler -----------------------------------------------------
from decksynth.sampler_record import Recorder

def tone(seconds,freq=220.,amp=.5,rate=48000):
    return [amp*math.sin(2*math.pi*freq*i/rate) for i in range(int(seconds*rate))]

def feed(target,data,block=512):
    for i in range(0,len(data),block):target(data[i:i+block])

class RecordTake(unittest.TestCase):
    def test_arm_waits_for_the_threshold_and_keeps_the_attack(self):
        r=Recorder(48000,threshold_db=-30,max_seconds=10);r.arm()
        feed(r.feed,[0.]*24000+[.001]*4800)            # silence and hiss under -30 dB
        self.assertEqual(r.state,'armed');self.assertEqual(len(r.data),0)
        feed(r.feed,tone(1.)+[0.]*48000)
        self.assertEqual(r.state,'recording')
        take=r.take()
        self.assertGreater(len(take),48000);self.assertLess(len(take),48000+512+int(48000*.03)+12001+512,'the quiet tail is trimmed to a 250 ms ring-out')
        self.assertLess(abs(take[0]),.01,'pre-roll: the take starts just before the note')
        self.assertEqual(r.state,'saving');r.saved();self.assertEqual(r.state,'idle')
    def test_the_take_stops_at_its_length_and_reports_clipping(self):
        r=Recorder(48000,max_seconds=.5);r.start()
        done=[];feed(lambda b:done.append(r.feed(b)),tone(1.,amp=1.2))
        self.assertTrue(any(done));self.assertEqual(len(r.data),24000);self.assertTrue(r.clipped)
        self.assertEqual(r.status()['seconds'],.5)
    def test_a_silent_take_is_refused(self):
        r=Recorder(48000);r.start();feed(r.feed,[0.]*4800)
        with self.assertRaises(ValueError):r.take()
        self.assertEqual(r.state,'idle')
    def test_threshold_and_length_are_clamped(self):
        r=Recorder(48000,threshold_db=-200,max_seconds=5000)
        self.assertEqual((r.threshold_db,r.max_seconds),(-60.,600.))
        with self.assertRaises(ValueError):r.set_threshold(float('nan'))

class RecordIntoSampler(SamplerTrack,unittest.TestCase):
    def test_a_take_lands_on_the_sampler_as_a_wav_and_can_be_chopped(self):
        e=self.e
        with self.assertRaises(ValueError):e.sampler_record('arm',1,self.id,-30,20)   # no input open yet
        e.record_input='Test input'
        e.sampler_record('arm',1,self.id,-30,20)
        self.assertEqual(e.record_state()['state'],'armed')
        take=[0.]*4800
        for f in (220.,330.,440.):take+=tone(.4,f)+[0.]*9600
        feed(e.record_feed,take)
        self.assertEqual(e.record_state()['state'],'recording')
        e.sampler_record('stop');notes=self.settle()
        self.assertTrue(any(n.get('message','').startswith('Recorded Recording') for n in notes),notes)
        spec=self.spec();self.assertEqual(spec['family'],'sample');self.assertTrue(spec['name'].startswith('Recording'))
        self.assertTrue(Path(spec['source']['path']).is_file());self.assertIn('Recordings',spec['source']['path'])
        self.assertEqual(e.record_state()['state'],'idle')
        e.chop_sampler(1,self.id,'threshold',dict(threshold=-30,min_ms=150));self.settle()
        self.assertEqual(len(self.spec()['slices']),3,'three notes, three slices')
    def test_the_take_ends_by_itself_at_its_length_and_when_the_input_goes(self):
        e=self.e;e.record_input='Test input'
        e.sampler_record('now',1,self.id,-30,1)
        feed(e.record_feed,tone(2.))
        self.assertEqual(e.record_state()['state'],'saving');self.settle()
        self.assertAlmostEqual(self.e.samplers[1].sample.frames/R,1.,delta=.01)
        e.sampler_record('now',1,self.id,-30,20);feed(e.record_feed,tone(.5))
        e.record_lost('The input went away');notes=self.settle()
        self.assertTrue(any('input went away' in n.get('message','') for n in notes),notes)

class DefaultInput(unittest.TestCase):
    def test_the_piano_is_chosen_over_the_decks_own_microphone(self):
        from decksynth.backend import default_input
        self.assertEqual(default_input(['Audio Coprocessor Internal Microphone','Roland Digital Piano Analog Stereo']),'Roland Digital Piano Analog Stereo')
        self.assertEqual(default_input(['Monitor of Speakers','Audio Coprocessor Internal Microphone']),'Audio Coprocessor Internal Microphone')
        self.assertIsNone(default_input([]))
