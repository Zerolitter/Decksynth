"""Integration check: the Electron JSON bridge is connected to the REAL DeckSynth
synth engine, but the SDL audio output is explicitly the SILENT dummy driver.

No physical MIDI ports are opened and no user projects are modified.
"""
import json
import os
import select
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ENV=os.environ.copy()
ENV['SDL_AUDIODRIVER']='dummy'
ENV['DECKSYNTH_DIAGNOSTIC']='1'

def main():
    proc=subprocess.Popen([sys.executable,'-u','electron/bridge.py'],
                          cwd=ROOT,env=ENV,stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                          text=True,bufsize=1)
    def get(predicate,timeout=10):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            readable,_,_=select.select([proc.stdout],[],[],.4)
            if not readable:continue
            line=proc.stdout.readline()
            if not line:break
            msg=json.loads(line)
            if 'error' in msg:raise AssertionError(msg['error'])
            if predicate(msg):return msg
        raise AssertionError('Timeout on bridge output; return='+str(proc.poll()))

    def send(cmd,args=None):
        proc.stdin.write(json.dumps(dict(cmd=cmd,args=args))+'\n')
        proc.stdin.flush()
    try:
        get(lambda m:m.get('bridge')=='ready')
        initial=get(lambda m:'state' in m)
        assert initial['audio']=='dummy', initial.get('audio')
        assert initial['meter']['rms']>=0
        send('midi',[0x90,60,115])
        active=get(lambda m:'state' in m and m['meter']['peak']>.015)
        assert len(active['meter']['wave'])==96
        assert active['meter']['rms']>.003
        send('midi',[0x80,60,0])
        send('record')
        recording=get(lambda m:m.get('recording') is True)
        assert recording['playing']
        send('midi',[0x90,64,90])
        get(lambda m:m.get('voices',0)>0)
        send('midi',[0x80,64,0])
        send('record')
        state=get(lambda m:'state' in m and len(m['state']['tracks'][0]['notes'])>=1)
        assert state['state']['tracks'][0]['notes'][0]['note']==64
        print('PASS: Electron bridge -> real synth -> 96 PCM wave samples, RMS and peak')
        print('PASS: bridge MIDI recording while silent diagnostic output is selected')
    finally:
        try:proc.stdin.close()
        except Exception:pass
        try:proc.wait(timeout=4)
        except subprocess.TimeoutExpired:proc.terminate();proc.wait(timeout=2)
        if proc.returncode not in (0,None):
            print('Bridge stderr:',proc.stderr.read()[-1200:],file=sys.stderr)

if __name__=='__main__':
    main()
