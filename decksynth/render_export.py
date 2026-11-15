"""Offline stereo PCM export through the same engine/scheduler; never mutates the live session."""
import copy,struct,wave
from .core import Engine

def export_wav(source,path,seconds=None):
 return export_project_wav(copy.deepcopy(source.project),source.rate,path,seconds)

def export_project_wav(project,rate,path,seconds=None,progress=None):
 e=Engine(rate);e.project=project;e.configure();e.load_drum_sources();e.load_sampler_sources();e.settle_offline_shaping();e.playing=True
 for t in e.project.tracks:t.pop('freeze',None);t.pop('freeze_loop',None)  # an export renders every track live
 for tr,t in enumerate(e.project.tracks):
  if t.get('device')=='drum_rack':
   for index,pad in enumerate(e.drums[tr].state()['pads']):
    if pad['status']=='MISSING':raise ValueError('Missing or unavailable Drum Rack sample on track '+str(tr+1)+' pad '+str(index+1))
  if t.get('device')=='sampler' and t['sampler']['source'] and e.samplers[tr].sample is None:raise ValueError('Missing or unavailable Sampler sample on track '+str(tr+1))
 if e.project.song['on']:e.project.song['loop']=False
 duration=(e.project.song['length']*4 if e.project.song['on'] else e.project.beats)*60/e.project.bpm+3 if seconds is None else seconds
 if not 0<duration<=3600:raise ValueError('WAV duration must be between0 and3600seconds')
 frames=round(duration*e.rate);total=frames
 with wave.open(str(path),'wb') as out:
  out.setnchannels(2);out.setsampwidth(2);out.setframerate(e.rate)
  while frames:
   count=min(256,frames);pcm=e.render_stereo(count)
   out.writeframesraw(struct.pack('<'+'h'*len(pcm),*[round(max(-1,min(1,x))*32767) for x in pcm]));frames-=count
   if progress:progress(1-frames/total)
 return path
