"""Sampler editing stage 11: the sample library (save to library, folders remembered, browse by category)."""
import math,shutil,tempfile,time,unittest,wave
from array import array
from pathlib import Path
from decksynth.sample_library import SampleLibrary,safe_name,PAGE_SIZE
from tests.test_sampler_expansion import SamplerTrack


def tone_wav(path,seconds=.3,freq=220.,rate=48000):
    path.parent.mkdir(parents=True,exist_ok=True)
    n=int(seconds*rate);pcm=array('h',[int(12000*math.sin(2*math.pi*freq*i/rate)*(1-i/n)) for i in range(n)])
    with wave.open(str(path),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(pcm.tobytes())
    return path


def wait(cond,timeout=10.):
    end=time.time()+timeout
    while time.time()<end:
        if cond():return True
        time.sleep(.02)
    raise AssertionError('timed out')


class Folders(unittest.TestCase):
    def setUp(self):self.dir=Path(tempfile.mkdtemp())
    def tearDown(self):shutil.rmtree(self.dir,ignore_errors=True)

    def test_save_and_load_folders_are_remembered(self):
        data=self.dir/'data';mine=self.dir/'My samples';extra=self.dir/'Old kits';extra.mkdir()
        lib=SampleLibrary(data,48000);lib.set_save_folder(mine);lib.add_load_folder(extra);lib.close()
        again=SampleLibrary(data,48000)
        self.assertEqual(again.save_folder,str(mine.resolve()))
        self.assertIn(str(extra.resolve()),again.load_folders);self.assertIn(str(mine.resolve()),again.load_folders)
        again.remove_load_folder(str(extra.resolve()));again.close()
        self.assertNotIn(str(extra.resolve()),SampleLibrary(data,48000).load_folders)

    def test_a_missing_folder_is_refused(self):
        lib=SampleLibrary(self.dir/'data',48000)
        with self.assertRaises(ValueError):lib.add_load_folder(self.dir/'nowhere')
        lib.close()

    def test_names_stay_inside_their_folder(self):
        self.assertEqual(safe_name('../../etc/passwd'),'etc passwd')
        self.assertEqual(safe_name('  '),'Sample')
        lib=SampleLibrary(self.dir/'data',48000)
        p=lib.target('../Kick','../../x');self.assertTrue(Path(p).resolve().is_relative_to(Path(lib.save_folder).resolve()))
        lib.close()


class Browse(unittest.TestCase):
    def setUp(self):
        self.dir=Path(tempfile.mkdtemp());root=self.dir/'lib'
        for i in range(3):tone_wav(root/'Kick'/('kick %d.wav'%i))
        tone_wav(root/'Keys'/'piano.wav');tone_wav(root/'loose.wav')
        (root/'Keys'/'notes.txt').write_text('not a sample')
        self.lib=SampleLibrary(self.dir/'data',48000,default_root=self.dir/'Samples');self.lib.add_load_folder(root)
        wait(lambda:not self.lib.snapshot()['scanning'] and self.lib.snapshot()['revision']>0)
    def tearDown(self):self.lib.close();shutil.rmtree(self.dir,ignore_errors=True)

    def test_categories_are_the_first_folders(self):
        cats={c['name']:c['count'] for c in self.lib.snapshot()['categories']}
        self.assertEqual(cats,{'Keys':1,'Kick':3,'lib':1},'loose files are in a category named after their folder')

    def test_a_page_gets_its_outlines(self):
        self.lib.browse('Kick')
        wait(lambda:all(i['peaks'] for i in self.lib.snapshot()['page']['items']))
        page=self.lib.snapshot()['page'];self.assertEqual(page['total'],3);self.assertEqual(len(page['items'][0]['peaks']),24)
        self.assertEqual(max(page['items'][0]['peaks']),1.)
        self.lib.browse('');self.assertEqual(self.lib.snapshot()['page']['total'],5)

    def test_only_listed_files_can_be_auditioned(self):
        with self.assertRaises(ValueError):self.lib.preview('/etc/passwd')
        path=self.lib.snapshot()['categories'] and next(i['path'] for i in self.lib._index if i['category']=='Keys')
        self.lib.preview(path);wait(lambda:self.lib._preview is None or self.lib._preview[0].done())
        sample=self.lib.poll();self.assertIsNotNone(sample);self.assertEqual(self.lib.playing,path)


class SaveFromSampler(SamplerTrack,unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.e.sample_library=self.lib=SampleLibrary(self.dir/'data',self.e.rate,default_root=self.dir/'Samples')
    def tearDown(self):self.lib.close();super().tearDown()

    def test_save_the_whole_sample_the_trim_and_a_slice(self):
        e=self.e;self.load()
        e.edit_sampler(1,self.id,'patch',dict(start=.25,end=.75))
        frames=e.samplers[1].sample.frames
        whole=e.save_sample_to_library(1,self.id,'whole',None,'piano take','Keys');self.settle()
        trim=e.save_sample_to_library(1,self.id,'trim',None,'piano take','Keys');self.settle()
        self.assertTrue(trim.endswith('piano take 2.wav'),'never overwrites')
        for path,share in [(whole,1.),(trim,.5)]:
            with wave.open(path) as w:self.assertAlmostEqual(w.getnframes()/frames,share,delta=.002)
        e.chop_sampler(1,self.id,'regions',dict(count=4));self.settle()
        n=len(self.spec()['slices']);self.assertGreater(n,1)
        sl=e.save_sample_to_library(1,self.id,'slice',1,'hit','Kick');self.settle()
        a,b=self.spec()['slices'][1][:2]
        with wave.open(sl) as w:self.assertAlmostEqual(w.getnframes()/frames,b-a,delta=.002)
        with self.assertRaises(ValueError):e.save_sample_to_library(1,self.id,'slice',n,'x','Kick')
        wait(lambda:{c['name'] for c in self.lib.snapshot()['categories']}>={'Keys','Kick'})


if __name__=='__main__':unittest.main()
