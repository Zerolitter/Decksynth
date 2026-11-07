"""Offline stereo PCM export through the same engine/scheduler; never mutates the live session."""
import copy,struct,wave
from .core import Engine

def export_wav(source,path,seconds=None):
 return export_project_wav(copy.deepcopy(source.project),source.rate,path,seconds)

def export_project_wav(project,rate,path,seconds=None):
 e=Engine(rate);e.project=project;e.configure();e.load_drum_sources();e.playing=True
 for tr,t in enumerate(e.project.tracks):
  if t.get('device')=='drum_rack':
   for index,pad in enumerate(e.drums[tr].state()['pads']):
    if pad['status']=='MISSING':raise ValueError('Missing or unavailable Drum Rack sample on track '+str(tr+1)+' pad '+str(index+1))
 if e.project.song['on']:e.project.song['loop']=False
 duration=(e.project.song['length']*4 if e.project.song['on'] else e.project.beats)*60/e.project.bpm+3 if seconds is None else seconds
 if not 0<duration<=3600:raise ValueError('WAV duration must be between0 and3600seconds')
 frames=round(duration*e.rate)
 with wave.open(str(path),'wb') as out:
  out.setnchannels(2);out.setsampwidth(2);out.setframerate(e.rate)
  while frames:
   count=min(256,frames);pcm=e.render_stereo(count)
   out.writeframesraw(struct.pack('<'+'h'*len(pcm),*[round(max(-1,min(1,x))*32767) for x in pcm]));frames-=count
 return path
