"""Small JSON/socket native-host stand-in used by PluginHost integration tests.

It deliberately needs neither JUCE nor Pedalboard: the parent-side test proves
that a yabridge-marked bundle selects the native-helper protocol.
"""
import json
import os
import sys


def answer(**message):
    sys.stdout.write(json.dumps(message, separators=(',', ':')) + '\n')
    sys.stdout.flush()


answer(id=0, ready=True, version='fake-juce-1.0')
for line in sys.stdin:
    try:
        request = json.loads(line)
    except ValueError:
        continue
    command, request_id = request.get('cmd'), request.get('id')
    if command == 'load':
        answer(id=request_id, name='Fake Windows Synth', vendor='Tests', kind='instrument',
               params=[dict(i=0, name='Gain', raw=.5, text='50 %', label='%', kind='value')],
               parameter_count=3773)
    elif command == 'params':
        answer(id=request_id, params=[dict(i=1, name='Drive', raw=.25, text='Warm', label='', kind='value')],
               parameter_count=1, parameter_offset=request.get('offset', 0))
    elif command == 'set':
        answer(id=request_id, i=request['index'], raw=request['raw'], text='50 %')
    elif command == 'live_enable':
        if os.environ.get('FAKE_NATIVE_REJECT_LIVE') == '1':
            answer(id=request_id, error='Live audio transport is unavailable')
        else:
            answer(id=request_id, ok=True, live=True)
    elif command == 'live_disable':
        answer(id=request_id, ok=True, live=False)
    elif command == 'quit':
        break
    else:
        answer(id=request_id, error='Unsupported fake-native command')
