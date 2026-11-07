"""Shared continuous parameter IDs, project MIDI mappings and owned controller edits."""
import copy,math
from .fx import SOUND_PARAMS,PARAMS,default_chain

_DISCRETE={'stutter':{'length','repeats'},'filter':{'mode'},'bitcrusher':{'bits'},'delay':{'time'},'chorus':{'voices'},'compressor':{'ratio'},'resonator':{'strings'},'gate':{'length','division','steps'}}
_REGISTRY={f'sound.{key}':dict(module='sound',param=key,min=lo,max=hi) for key,(lo,hi) in SOUND_PARAMS.items()}
for module,params in PARAMS.items():
 for key,lo,hi,_ in params:
  if key not in _DISCRETE.get(module,set()):_REGISTRY[f'{module}.{key}']=dict(module=module,param=key,min=lo,max=hi)
for key in ('phase','notelen'):_REGISTRY['gate.'+key]=dict(module='gate',param=key,min=0,max=1)
for index in range(8):_REGISTRY[f'macro.{index}']=dict(module='macro',param=str(index),min=0,max=1)

def registry():return _REGISTRY

def validate_mappings(raw):
 if not isinstance(raw,list) or len(raw)>256:raise ValueError('Invalid MIDI mappings')
 out=[];sources=set();targets=set()
 for m in raw:
  if not isinstance(m,dict):raise ValueError('Invalid MIDI mapping')
  cc=m.get('cc');channel=m.get('channel');module=m.get('module');param=m.get('param')
  if type(cc) is not int or not 0<=cc<=119 or cc==64 or type(channel) is not int or not 0<=channel<=15:raise ValueError('Invalid MIDI controller')
  if not isinstance(module,str) or not isinstance(param,str) or module+'.'+param not in _REGISTRY:raise ValueError('Unknown MIDI target')
  source=(channel,cc);target=(module,param)
  if source in sources or target in targets:raise ValueError('Duplicate MIDI mapping')
  sources.add(source);targets.add(target);out.append(dict(cc=cc,channel=channel,module=module,param=param))
 return out

class ControllerEngine:
 def learn_cc(self,track,module,param):
  if type(track) is not int or track!=self.selected:raise ValueError('Track changed; MIDI Learn cancelled')
  if not isinstance(module,str) or not isinstance(param,str) or module+'.'+param not in _REGISTRY:raise ValueError('Unknown MIDI target')
  self.midi_learn=dict(track=track,module=module,param=param)
 def unlearn_cc(self,track,module,param):
  if type(track) is not int or track!=self.selected:raise ValueError('Track changed; MIDI edit cancelled')
  t=self.project.tracks[track]
  if 'midi_cc' in t:t['midi_cc']=[m for m in t['midi_cc'] if (m['module'],m['param'])!=(module,param)]
  self.midi_learn=None
 def apply_control(self,track,module,param,unit):
  spec=_REGISTRY.get(module+'.'+param)
  if spec is None or type(unit) not in (int,float) or not math.isfinite(unit):raise ValueError('Invalid parameter control')
  value=spec['min']+min(1.,max(0.,unit))*(spec['max']-spec['min']);t=self.project.tracks[track]
  if module=='sound':
   if param=='volume':t['volume']=value;return
   if param.startswith('fenv_'):
    for key,amp in (('fenv_a','attack'),('fenv_d','decay'),('fenv_s','sustain'),('fenv_r','release')):t['instrument'].setdefault(key,t['instrument'][amp])
   t['instrument'][param]=value;self.synths[track].configure(t['instrument'])
  else:
   chain=copy.deepcopy(t.get('fx') or default_chain())
   if module=='macro':chain['macros'][int(param)]['value']=value
   else:next(m for m in chain['modules'] if m['id']==module)['params'][param]=value
   self.set_fx(track,chain)
 def controller_cc(self,channel,cc,value):
  # Pedal and Panic retain their existing musical/safety behavior.
  if cc==64 or cc>=120:return False
  t=self.project.tracks[self.selected];learn=self.midi_learn
  if learn is not None:
   if learn['track']!=self.selected:self.midi_learn=None
   else:
    old=t.get('midi_cc',[]);target=(learn['module'],learn['param'])
    old=[m for m in old if (m['channel'],m['cc'])!=(channel,cc) and (m['module'],m['param'])!=target]
    t['midi_cc']=validate_mappings(old+[dict(cc=cc,channel=channel,module=target[0],param=target[1])]);self.midi_learn=None
  mapping=next((m for m in t.get('midi_cc',[]) if m['cc']==cc and m['channel']==channel),None)
  if mapping:
   spec=_REGISTRY[mapping['module']+'.'+mapping['param']]
   unit=(value/128 if value<=64 else .5+(value-64)/126) if spec['min']==-spec['max'] else value/127
   self.apply_control(self.selected,mapping['module'],mapping['param'],unit);return True
  claimed=any(m['cc']==74 or (m['module']=='sound' and m['param']=='vcf_cutoff') for m in t.get('midi_cc',[]))
  if cc==74 and not claimed:self.apply_control(self.selected,'sound','vcf_cutoff',value/127);return True
  return False
