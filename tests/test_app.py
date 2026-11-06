import unittest
from decksynth.app import App

class AppSafetyTests(unittest.TestCase):
    def test_open_does_not_commit_path_before_validation(self):
        app=App.__new__(App); app.path='good.decksynth'; app.choose=lambda *args:'invalid.decksynth'; sent=[]
        app.send=lambda *args:sent.append(args)
        app.open()
        self.assertEqual(app.path,'good.decksynth')
        self.assertEqual(sent,[('load','invalid.decksynth')])
