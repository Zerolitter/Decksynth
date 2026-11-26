"""Euclid draft preview through the real bridge: the draft loops in the engine, follows changes, stops, and never touches the project."""
import copy
import json
import os
import select
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
env=dict(os.environ,SDL_AUDIODRIVER='dummy',DECKSYNTH_NO_AUTOSAVE='1')
proc=subprocess.Popen([sys.executable,'-u',str(ROOT/'electron'/'bridge.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=str(ROOT),env=env,bufsize=0)
buffer=bytearray();merged={}

def receive(predicate,timeout=12):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        ready,_,_=select.select([proc.stdout],[],[],min(.3,max(0,end-time.monotonic())))
        if not ready:
            if proc.poll() is not None:break
            continue
        buf=os.read(proc.stdout.fileno(),65536)
        if not buf:break
        buffer.extend(buf)
        while b'\n' in buffer:
            line,_,remaining=buffer.partition(b'\n');buffer[:]=remaining
            obj=json.loads(line)
            if 'error' in obj:raise AssertionError(obj)
            if not any(k in obj for k in ('message','bridge')):merged.update(obj);obj=dict(merged)
            if predicate(obj):return obj
    raise AssertionError('timed out waiting for the bridge')

def send(cmd,args=None):proc.stdin.write((json.dumps({'cmd':cmd,'args':args})+'\n').encode())

try:
    receive(lambda o:o.get('bridge')=='ready')
    first=receive(lambda o:'state' in o and 'pattern_library' in o)
    pattern=first['state']['performance']['patterns'].get('1:1') or {'length':16,'division':'1/16','gate':.8,'swing':.5,'steps':[[] for _ in range(16)]}
    target={'kind':'pattern','track':0,'bank':1,'slot':1,'device':first['state']['tracks'][0].get('device','synth'),'kit':first['state']['tracks'][0].get('drum_rack')}
    def draft(on):
        d=copy.deepcopy(pattern);d['length']=16;d['steps']=[[{'note':60,'velocity':100,'tie':1}] if i in on else [] for i in range(16)];return d
    before=json.dumps(first['state']['performance']['patterns'],sort_keys=True)
    send('catalog_action',['preview_draft',target,None,'euclid.draft',draft({0,4,8,12})])
    live=receive(lambda o:(o.get('pattern_library') or {}).get('preview',{}) and o['pattern_library']['preview']['id']=='euclid.draft')
    print('PASS: a draft previews through the bridge',flush=True)
    send('catalog_action',['preview_draft',target,None,'euclid.draft',draft({0,2,4,6,8,10,12,14})])
    time.sleep(.3)
    send('catalog_action',['stop',target,None,''])
    receive(lambda o:o.get('pattern_library',{}).get('preview') is None)
    print('PASS: a changed draft takes over, Stop ends it',flush=True)
    send('add_track');receive(lambda o:len(o.get('state',{}).get('tracks',[]))>=2);send('select',0);receive(lambda o:o.get('selected')==0)
    send('catalog_action',['preview_draft',target,None,'euclid.draft',draft({0})])
    receive(lambda o:(o.get('pattern_library') or {}).get('preview') and o['pattern_library']['preview']['id']=='euclid.draft')
    send('select',1)
    receive(lambda o:o.get('selected')==1 and o.get('pattern_library',{}).get('preview') is None)
    print('PASS: switching track ends the preview',flush=True)
    send('select',0)
    after=receive(lambda o:o.get('selected')==0)
    assert json.dumps(after['state']['performance']['patterns'],sort_keys=True)==before,'preview never writes the pattern'
    print('PASS: the project patterns are untouched',flush=True)
finally:
    proc.terminate()
