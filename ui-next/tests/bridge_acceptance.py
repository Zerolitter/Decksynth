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
finally:
    try:proc.stdin.close()
    except OSError:pass
    try:proc.wait(timeout=4)
    except subprocess.TimeoutExpired:proc.terminate();proc.wait(timeout=2)
    if proc.returncode!=0:
        err=proc.stderr.read().decode('utf-8','replace')
        print('bridge exit:',proc.returncode,err[-1500:],file=sys.stderr)
