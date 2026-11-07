"""No-hardware bridge acceptance: shared Python audio engine, Electron JSON protocol."""
import json
import os
import select
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
env=dict(os.environ,SDL_AUDIODRIVER='dummy',DECKSYNTH_DIAGNOSTIC='1')
proc=subprocess.Popen([sys.executable,'-u',str(ROOT/'electron'/'bridge.py')],
                      stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                      cwd=str(ROOT),env=env,bufsize=0)
buffer=bytearray()

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
            line,_,remaining=buffer.partition(b'\n')
            buffer[:]=remaining
            try:
                obj=json.loads(line)
                if 'error' in obj:raise AssertionError(obj)
                if predicate(obj):return obj
            except json.JSONDecodeError as exc:
                raise AssertionError('Non-JSON stdout from bridge') from exc
    raise AssertionError('Bridge acceptance timed out: '+str(proc.poll()))

def send(cmd,args=None):
    proc.stdin.write((json.dumps({'cmd':cmd,'args':args})+'\n').encode())

try:
    ready=receive(lambda obj:obj.get('bridge')=='ready')
    first=receive(lambda obj:obj.get('audio')=='dummy' and 'state' in obj)
    assert not first['devices'] and not first['connected'], first
    assert first['audio_output']=='System default',first
    assert 'meter' in first and 'wave' in first['meter'], first
    print('PASS: audio worker started with SDL dummy sink and zero MIDI hardware access',flush=True)
    send('midi',[144,60,115])
    sounding=receive(lambda obj:obj.get('meter',{}).get('peak',0)>.001 and obj.get('voices',0)>=1)
    assert len(sounding['meter']['wave'])==96
    print('PASS: live MIDI command reached original synth; real engine produced nonzero PCM meter',flush=True)
    send('midi',[128,60,0])
    released=receive(lambda obj:obj.get('voices',-1)==0)
    assert released['audio']=='dummy'
    print('PASS: note-off releases voice through same bridge',flush=True)
    send('tempo',240)
    send('record')
    send('midi',[144,64,108])
    time.sleep(.16)
    send('midi',[128,64,0])
    captured=receive(lambda obj:obj.get('state',{}).get('tracks',[{}])[0].get('notes') and
        obj.get('state',{}).get('bpm')==240,timeout=12)
    assert len(captured['state']['tracks'][0]['notes'])>=1,captured
    print('PASS: MIDI note recording reflected into canonical four-track project state',flush=True)
    send('record')
    send('clip',[0,'copy',1,0])
    send('clip',[0,'open',1,None])
    song={'on':True,'loop':True,'length':8,'markers':[{'bar':0,'name':'Intro'},{'bar':4,'name':'Drop'}],
          'lanes':[[{'at':0,'len':8,'clip':0}],[{'at':4,'len':3,'clip':0},{'at':7,'len':1,'clip':1,'off':3}],[],[]]}
    send('song',song)
    arranged=receive(lambda obj:obj.get('state',{}).get('song',{}).get('on') and
        len(obj['state']['song'].get('lanes',[[],[]])[1])==2 and 'song_pos' in obj,timeout=12)
    s2=arranged['state']['song']
    assert s2['markers'][1]['name']=='Drop' and s2['lanes'][1][1]=={'at':7,'len':1,'clip':1,'off':3},s2
    clips=arranged['state']['clips']
    assert clips['open'][0]==1 and len(clips['slots'][0][0])>=1,clips
    assert arranged['state']['tracks'][0]['notes']==clips['slots'][0][0],'loop B is a copy of A'
    print('PASS: song timeline and clip slots reached the engine and came back in the project state',flush=True)
    send('select',0)
    send('parameter',['vcf_type',None,1]); send('parameter',['uni_voices',None,3]); send('parameter',['vowel',None,2])
    voiced=receive(lambda obj:obj.get('state',{}).get('tracks',[{}])[0].get('instrument',{}).get('vowel')==2.0,timeout=12)
    ins=voiced['state']['tracks'][0]['instrument']
    assert ins['vcf_type']==1 and ins['uni_voices']==3,ins
    print('PASS: Filter, Unison and Character settings reached the engine',flush=True)
finally:
    try:proc.stdin.close()
    except OSError:pass
    try:proc.wait(timeout=4)
    except subprocess.TimeoutExpired:proc.terminate();proc.wait(timeout=2)
    if proc.returncode!=0:
        err=proc.stderr.read().decode('utf-8','replace')
        print('bridge exit:',proc.returncode,err[-1500:],file=sys.stderr)
