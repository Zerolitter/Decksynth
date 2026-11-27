"""Optional integration smoke test for the JUCE yabridge helper.

Set DECKSYNTH_NATIVE_VST3_HOST and DECKSYNTH_NATIVE_VST3_PLUGIN to run it on
the Deck. CI intentionally skips it because Wine/yabridge are user-local.
"""
import json
import os
import socket
import struct
import tempfile
import subprocess
import unittest


HOST = os.environ.get('DECKSYNTH_NATIVE_VST3_HOST')
PLUGIN = os.environ.get('DECKSYNTH_NATIVE_VST3_PLUGIN')


def receive(sock, size):
    chunks = bytearray()
    while len(chunks) < size:
        chunk = sock.recv(size - len(chunks))
        if not chunk: raise AssertionError('native helper closed the live socket')
        chunks.extend(chunk)
    return bytes(chunks)


@unittest.skipUnless(HOST and PLUGIN, 'set DECKSYNTH_NATIVE_VST3_HOST and DECKSYNTH_NATIVE_VST3_PLUGIN')
class NativeVst3Host(unittest.TestCase):
    def test_load_keeps_a_yabridge_vst3_ready_for_live_protocol(self):
        parent, child = socket.socketpair()
        child.set_inheritable(True)
        env = dict(os.environ, DECKSYNTH_LIVE_FD=str(child.fileno()))
        proc = subprocess.Popen([HOST], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, bufsize=1, env=env, pass_fds=(child.fileno(),), start_new_session=True)
        child.close()
        try:
            hello = json.loads(proc.stdout.readline())
            self.assertEqual(hello, {'id': 0, 'ready': True, 'version': hello['version']})
            proc.stdin.write(json.dumps({'id': 1, 'cmd': 'load', 'path': PLUGIN}) + '\n'); proc.stdin.flush()
            loaded = json.loads(proc.stdout.readline())
            self.assertEqual(loaded['id'], 1)
            self.assertTrue(loaded.get('ok'), loaded)
            self.assertEqual(loaded['kind'], 'instrument')
            self.assertLessEqual(len(loaded['params']), 64)
            self.assertGreater(loaded['parameter_count'], len(loaded['params']))
            proc.stdin.write(json.dumps({'id': 2, 'cmd': 'live_enable', 'rate': 48000}) + '\n'); proc.stdin.flush()
            self.assertTrue(json.loads(proc.stdout.readline())['live'])
            parent.settimeout(10)
            parent.sendall(struct.pack('<IHHH3s', 7, 256, 1, 0, b'\x90\x45\x64'))
            sequence, frames = struct.unpack('<IH', receive(parent, 6))
            self.assertEqual((sequence, frames), (7, 256))
            self.assertEqual(len(receive(parent, frames * 8)), 2048)
            proc.stdin.write(json.dumps({'id': 3, 'cmd': 'live_disable'}) + '\n'); proc.stdin.flush()
            self.assertFalse(json.loads(proc.stdout.readline())['live'])
            with tempfile.TemporaryDirectory() as directory:
                take = os.path.join(directory, 'native.wav')
                proc.stdin.write(json.dumps({'id': 4, 'cmd': 'render', 'path': take, 'rate': 48000,
                                               'notes': [{'note': 69, 'velocity': 100}], 'hold': .1}) + '\n'); proc.stdin.flush()
                rendered = json.loads(proc.stdout.readline())
                self.assertTrue(rendered.get('ok'), rendered)
                self.assertGreater(rendered['seconds'], .1)
                self.assertTrue(os.path.isfile(take))
        finally:
            try: proc.stdin.close()
            except OSError: pass
            try: proc.wait(timeout=2)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=2)
            proc.stdout.close(); proc.stderr.close()
            parent.close()


if __name__ == '__main__':
    unittest.main()
