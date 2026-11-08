"""Folder kit contracts exercised with generated WAVs, never private assets."""
import copy
import importlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

from decksynth.samples import DecodedSample, SampleCache


class DrumLibraryTests(unittest.TestCase):
    def test_demo_loops_and_ab_references_are_browsable_but_not_automatic_one_shots(self):
        for folder in ['Legend Forge/kits/Chimera','Personalities/kits/Tidepool','Restyled/kits/Abyss Pressure']:
            for name in ['Kick 01.wav','Snare Odd Name.wav','Looping Rim.wav','A Kick.wav',
                         '_Demo Loop 124bpm.wav','_A-B Reference.wav']:
                self.wav(folder+'/'+name)
        index=self.api().scan_library(self.root)
        for row in index.folders:
            folder=row['id']
            kit,_=index.prepare(folder,SampleCache())
            names={pad['name'] for pad in kit['pads'] if pad['source']}
            self.assertEqual(names,{'Kick 01','Snare Odd Name','Looping Rim','A Kick'})
            browse=index.browse(folder)
            self.assertEqual(browse['total'],6)
            demo=next(item for item in browse['items'] if item['filename'].startswith('_Demo'))
            self.assertTrue(index.sample_path(folder,demo['index']).is_file())

    def test_reference_only_folder_does_not_prepare_an_empty_replacement_kit(self):
        self.wav('A-B Examples/A-B comparison.wav');self.wav('A-B Examples/_Demo Loop 90bpm.wav')
        index=self.api().scan_library(self.root)
        with self.assertRaisesRegex(ValueError,'reference'):
            index.prepare('A-B Examples',SampleCache())
        self.assertEqual(index.browse('A-B Examples')['total'],2)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'Library'
        self.root.mkdir()

    def api(self):
        self.assertIsNotNone(importlib.util.find_spec('decksynth.drum_library'),
                             'Folder library scanning and preparation are required')
        return importlib.import_module('decksynth.drum_library')

    def wav(self, relative):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), 'wb') as handle:
            handle.setparams((1, 2, 48000, 32, 'NONE', 'PCM'))
            handle.writeframes(b'\x00\x20' * 32)
        return path

    def test_nested_and_root_folders_are_listed_without_decoding(self):
        self.wav('root.WAV')
        self.wav('Legend/606/Kit 10/kick.wav')
        self.wav('Legend/606/Kit 2/snare.wav')
        self.wav('.hidden/secret.wav')
        self.wav('Visible/.secret.wav')
        (self.root / 'unreadable.wav').write_bytes(b'not PCM')
        index = self.api().scan_library(self.root / '.')
        self.assertEqual(index.root, str(self.root.resolve()))
        self.assertEqual(index.folders, [
            dict(id='.', name='Library', count=2),
            dict(id='Legend/606/Kit 2', name='Legend/606/Kit 2', count=1),
            dict(id='Legend/606/Kit 10', name='Legend/606/Kit 10', count=1)])

    def test_all_fifteen_legend_files_are_used_once_with_recognised_roles(self):
        names = ['Clap Legend 707', 'Cymbal Crash Legend 707', 'Cymbal Ride Legend 707',
                 'Hi-Hat Legend 707 Closed', 'Hi-Hat Legend 707 Open',
                 'Kick Legend 707 01', 'Kick Legend 707 02',
                 'Snare Legend 707 01', 'Snare Legend 707 02',
                 'Percussion Cowbell Legend 707', 'Percussion Tambourine Legend 707',
                 'Rim Legend 707', 'Tom Legend 707 Hi', 'Tom Legend 707 Low',
                 'Tom Legend 707 Mid']
        for name in names:
            self.wav('Legend 707/' + name + '.wav')
        kit, samples = self.api().scan_library(self.root).prepare('Legend 707', SampleCache())
        self.assertEqual(kit['name'], 'Legend 707')
        self.assertEqual(len(samples), 16)
        used = [pad['source']['path'] for pad in kit['pads'] if pad['source']]
        self.assertEqual(len(used), 15)
        self.assertEqual(len(set(used)), 15)
        self.assertEqual({Path(path).stem for path in used}, set(names))
        expected = {0: 'Kick Legend 707 01', 1: 'Kick Legend 707 02',
                    2: 'Snare Legend 707 01', 3: 'Clap Legend 707', 4: 'Rim Legend 707',
                    6: 'Hi-Hat Legend 707 Closed', 7: 'Hi-Hat Legend 707 Open',
                    9: 'Tom Legend 707 Low', 10: 'Tom Legend 707 Mid',
                    11: 'Tom Legend 707 Hi', 12: 'Percussion Cowbell Legend 707',
                    13: 'Percussion Tambourine Legend 707', 14: 'Cymbal Ride Legend 707',
                    15: 'Cymbal Crash Legend 707'}
        for pad, name in expected.items():
            self.assertEqual(kit['pads'][pad]['name'], name)
        for number, (pad, sample) in enumerate(zip(kit['pads'], samples)):
            self.assertEqual(pad['note'], 36 + number)
            self.assertEqual(pad['choke'], 1 if number in (6, 7) else 0)
            if pad['source']:
                self.assertIsInstance(sample, DecodedSample)
                self.assertEqual(pad['source'], sample.source)
            else:
                self.assertIsNone(sample)

    def test_roles_precede_filler_and_prefer_nonaccent_natural_order(self):
        for name in ['Kick 10', 'Kick 2', 'Kick 1 accent', 'Kick 3',
                     'Hat Closed accent', 'Hat Closed', 'Hat Open', 'Shaker',
                     'Perc', 'Unknown 10', 'Unknown 2']:
            self.wav(name + '.wav')
        kit, _ = self.api().scan_library(self.root).prepare('.', SampleCache())
        pads = kit['pads']
        self.assertEqual(pads[0]['name'], 'Kick 2')
        self.assertEqual(pads[1]['name'], 'Kick 3')
        self.assertEqual(pads[5]['name'], 'Perc')
        self.assertEqual(pads[6]['name'], 'Hat Closed')
        self.assertEqual(pads[7]['name'], 'Hat Open')
        self.assertEqual(pads[8]['name'], 'Shaker')
        self.assertEqual(pads[2]['name'], 'Kick 10')
        self.assertEqual(pads[3]['name'], 'Unknown 2')
        self.assertEqual(pads[4]['name'], 'Unknown 10')

    def test_explicit_second_kick_and_short_instrument_names(self):
        names = ['BD', 'Kick 2', 'SD', 'CP', 'RS', 'Perc', 'CH', 'OH',
                 'SH', 'LT', 'MT', 'HT', 'CB', 'Tamb', 'Ride', 'Crash']
        for name in names:
            self.wav(name + '.wav')
        kit, _ = self.api().scan_library(self.root).prepare('.', SampleCache())
        self.assertEqual([pad['name'] for pad in kit['pads']], names)

    def test_bare_kick_precedes_numbered_variants_with_natural_nonaccent_order(self):
        for name in ['Kick10', 'Kick2', 'Kick', 'Kick1 accent']:
            self.wav(name + '.wav')
        kit, _ = self.api().scan_library(self.root).prepare('.', SampleCache())
        self.assertEqual([pad['name'] for pad in kit['pads'][:4]],
                         ['Kick', 'Kick2', 'Kick10', 'Kick1 accent'])

    def test_generic_cymbal_uses_crash_role_while_ride_keeps_ride_role(self):
        self.wav('Cymbal Berlin 512.wav')
        self.wav('Cymbal Ride Berlin 512.wav')
        kit, samples = self.api().scan_library(self.root).prepare('.', SampleCache())
        self.assertEqual(kit['pads'][14]['name'], 'Cymbal Ride Berlin 512')
        self.assertEqual(kit['pads'][15]['name'], 'Cymbal Berlin 512')
        self.assertIsNone(samples[0])
        self.assertIsNone(samples[5])

    def test_large_folder_selects_only_sixteen_in_natural_order(self):
        for number in reversed(range(1, 21)):
            self.wav('Hit ' + str(number) + '.wav')
        (self.root / 'Hit 20.wav').write_bytes(b'invalid, beyond selection')
        index = self.api().scan_library(self.root)
        self.assertEqual(index.folders[0]['count'], 20)
        kit, samples = index.prepare('.', SampleCache())
        self.assertEqual([pad['name'] for pad in kit['pads']],
                         ['Hit ' + str(n) for n in range(1, 17)])
        self.assertEqual(len(samples), 16)
        self.assertTrue(all(samples))

    def test_small_folder_leaves_empty_pads_silent(self):
        self.wav('Only Kick.wav')
        kit, samples = self.api().scan_library(self.root).prepare('.', SampleCache())
        self.assertIsNotNone(samples[0])
        self.assertEqual(samples[1:], [None] * 15)
        self.assertTrue(all(pad['source'] is None for pad in kit['pads'][1:]))

    def test_folder_kicks_and_empty_pads_do_not_inherit_hat_choke(self):
        for count in (1, 16):
            folder = 'Kicks ' + str(count)
            for number in range(1, count + 1):
                self.wav(folder + '/Kick ' + str(number) + '.wav')
            with self.subTest(count=count):
                kit, _ = self.api().scan_library(self.root).prepare(folder, SampleCache())
                self.assertEqual([pad['choke'] for pad in kit['pads']], [0] * 16)

    def test_fallback_hat_sources_keep_hat_choke_outside_default_hat_positions(self):
        for name in ('Closed Hat 1', 'Closed Hat 2', 'Open Hat 1', 'Open Hat 2'):
            self.wav(name + '.wav')
        kit, samples = self.api().scan_library(self.root).prepare('.', SampleCache())
        self.assertEqual([number for number, sample in enumerate(samples) if sample], [0, 1, 6, 7])
        self.assertEqual([number for number, pad in enumerate(kit['pads']) if pad['choke']],
                         [0, 1, 6, 7])

    def test_scan_and_prepare_never_write_or_rename_source_files(self):
        self.wav('Nested/Kick.wav')
        self.wav('Nested/Snare.wav')
        def snapshot():
            return {str(path.relative_to(self.root)): (path.stat().st_size,
                    path.stat().st_mtime_ns, path.read_bytes() if path.is_file() else None)
                    for path in self.root.rglob('*')}
        before = snapshot()
        self.api().scan_library(self.root).prepare('Nested', SampleCache())
        self.assertEqual(snapshot(), before)

    def test_scan_skips_symlink_files_and_directories(self):
        outside = self.root.parent / 'outside'
        outside.mkdir()
        (outside / 'kick.wav').write_bytes(b'private')
        (self.root / 'escape').symlink_to(outside, target_is_directory=True)
        (self.root / 'escape.wav').symlink_to(outside / 'kick.wav')
        self.wav('Safe/Snare.wav')
        index = self.api().scan_library(self.root)
        self.assertEqual(index.folders, [dict(id='Safe', name='Safe', count=1)])
        for folder in ['../outside', str(outside), 'Safe/../../outside', '.', 'Safe/..']:
            with self.subTest(folder=folder), self.assertRaises(ValueError):
                index.prepare(folder, SampleCache())

    def test_changed_file_symlink_cannot_escape_after_scan(self):
        path = self.wav('Safe/Kick.wav')
        index = self.api().scan_library(self.root)
        outside = self.root.parent / 'private.wav'
        outside.write_bytes(path.read_bytes())
        path.unlink()
        path.symlink_to(outside)
        with self.assertRaises(ValueError):
            index.prepare('Safe', SampleCache())

    def test_changed_directory_symlink_cannot_escape_after_scan(self):
        path = self.wav('Safe/Kick.wav')
        index = self.api().scan_library(self.root)
        outside = self.root.parent / 'outside'
        outside.mkdir()
        (outside / 'Kick.wav').write_bytes(path.read_bytes())
        (self.root / 'Safe').rename(self.root / 'Parked')
        (self.root / 'Safe').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            index.prepare('Safe', SampleCache())

    def test_later_file_changed_to_outside_symlink_during_decode_is_rejected(self):
        self.wav('Safe/Kick.wav')
        second = self.wav('Safe/Snare.wav')
        outside = self.root.parent / 'private.wav'
        outside.write_bytes(second.read_bytes())
        index = self.api().scan_library(self.root)
        cache = SampleCache()
        real_load = cache.load

        def load_and_swap(path):
            sample = real_load(path)
            if Path(path).name == 'Kick.wav':
                second.unlink()
                second.symlink_to(outside)
            return sample

        with patch.object(cache, 'load', side_effect=load_and_swap):
            with self.assertRaises(ValueError):
                index.prepare('Safe', cache)

    def test_outside_decoded_sample_provenance_is_rejected_before_return(self):
        inside = self.wav('Safe/Kick.wav')
        outside = self.root.parent / 'outside.wav'
        outside.write_bytes(inside.read_bytes())
        index = self.api().scan_library(self.root)
        cache = SampleCache()
        outside_sample = cache.load(outside)
        with patch.object(cache, 'load', return_value=outside_sample):
            with self.assertRaises(ValueError):
                index.prepare('Safe', cache)

    def test_file_swapped_after_its_decode_is_rejected_before_return(self):
        inside = self.wav('Safe/Kick.wav')
        outside = self.root.parent / 'outside.wav'
        outside.write_bytes(inside.read_bytes())
        index = self.api().scan_library(self.root)
        cache = SampleCache()
        real_load = cache.load

        def load_and_swap(path):
            sample = real_load(path)
            inside.unlink()
            inside.symlink_to(outside)
            return sample

        with patch.object(cache, 'load', side_effect=load_and_swap):
            with self.assertRaises(ValueError):
                index.prepare('Safe', cache)

    def test_hi_hat_and_hi_tom_stay_distinct_with_mixed_case_wav_extensions(self):
        self.wav('Kick.WaV')
        self.wav('Hi-Hat closed.wav')
        self.wav('Tom Hi.WAV')
        kit, samples = self.api().scan_library(self.root).prepare('.', SampleCache())
        self.assertEqual(kit['pads'][0]['name'], 'Kick')
        self.assertEqual(kit['pads'][6]['name'], 'Hi-Hat closed')
        self.assertEqual(kit['pads'][11]['name'], 'Tom Hi')
        self.assertEqual(sum(sample is not None for sample in samples), 3)

    def test_scan_rejects_over_limit_instead_of_silent_partial_catalog(self):
        api = self.api()
        for number in range(4):
            self.wav('Kit ' + str(number) + '/Kick.wav')
        with patch.object(api, 'MAX_WAV_FILES', 3), self.assertRaises(ValueError):
            api.scan_library(self.root)
        with patch.object(api, 'MAX_FOLDERS', 3), self.assertRaises(ValueError):
            api.scan_library(self.root)
        deep = '/'.join('level' + str(n) for n in range(13)) + '/hit.wav'
        self.wav(deep)
        with self.assertRaises(ValueError):
            api.scan_library(self.root)

    def test_scan_rejects_missing_or_non_directory_root(self):
        api = self.api()
        path = self.wav('hit.wav')
        for root in [self.root / 'missing', path]:
            with self.subTest(root=root), self.assertRaises(ValueError):
                api.scan_library(root)

    def test_invalid_final_selected_wav_leaves_prior_kit_and_audio_intact(self):
        self.wav('Old/Kick.wav')
        cache = SampleCache()
        api = self.api()
        old_kit, old_samples = api.scan_library(self.root).prepare('Old', cache)
        before = copy.deepcopy(old_kit)
        old_audio = old_samples[0].data
        for number in range(1, 17):
            self.wav('Replacement/Hit ' + str(number) + '.wav')
        (self.root / 'Replacement/Hit 16.wav').write_bytes(b'broken')
        with self.assertRaises(ValueError):
            api.scan_library(self.root).prepare('Replacement', cache)
        self.assertEqual(old_kit, before)
        self.assertIs(old_samples[0].data, old_audio)
        self.assertEqual(old_samples[0].data[0], .25)
