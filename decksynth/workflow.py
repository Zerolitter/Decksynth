"""Patch comparison, owned knob transactions and bounded source-clock parameter lanes."""
import copy,math
from bisect import bisect_right
from .controllers import registry
from .fx import default_chain,validate_chain,SOUND_PARAMS


def validate_automation(raw):
 if not isinstance(raw,list) or len(raw)>16:raise ValueError('Automation supports up to16lanes per track')
 out=[];seen=set()
 for lane in raw:
  if not isinstance(lane,dict):raise ValueError('Invalid automation lane')
  module=lane.get('module');param=lane.get('param');key=f'{module}.{param}'
  if key not in registry() or key in seen:raise ValueError('Unknown or duplicate automation target')
  points=lane.get('points');seen.add(key)
  if not isinstance(points,list) or not 1<=len(points)<=2048:raise ValueError('Automation requires1..2048points')
  clean=[];last=-1
  for p in points:
   if not isinstance(p,list) or len(p)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) for v in p):raise ValueError('Invalid automation point')
   beat,value=p
   if not 0<=beat<=4096 or not last<beat or not 0<=value<=1:raise ValueError('Automation points must be sorted and normalized')
   clean.append([float(beat),float(value)]);last=beat
  out.append(dict(module=module,param=param,points=clean))
 return out


def validate_ab(raw):
 from .core import validate_instrument
 if not isinstance(raw,dict) or raw.get('active') not in ('A','B'):raise ValueError('Invalid comparison slot')
 out={'active':raw['active']}
 for slot in ('A','B'):
  patch=raw[slot];ins=patch['instrument'];validate_instrument(ins)
  if not isinstance(patch['preset'],str) or len(patch['preset'])>100:raise ValueError('Invalid comparison preset')
  out[slot]=dict(instrument=copy.deepcopy(ins),preset=patch['preset'])
  if 'fx' in patch:out[slot]['fx']=validate_chain(patch['fx'])
 return out


def sound_patch(track):return copy.deepcopy({k:track[k] for k in ('instrument','preset','fx') if k in track})

def _get(root,path):
 try:
  for k in path:root=root[k]
  return dict(present=True,value=copy.deepcopy(root))
 except (KeyError,IndexError):return dict(present=False)

def _put(root,path,entry):
 for k in path[:-1]:root=root[k]
 if entry['present']:root[path[-1]]=copy.deepcopy(entry['value'])
 else:root.pop(path[-1],None)

class WorkflowEngine:
 def init_workflow(self):
  self.sound_history=[{'A':[],'B':[]} for _ in range(4)];self._sound_gesture=None;self.automation_arm=False;self.automation_values=[{} for _ in range(4)];self.automation_touched=set();self.control_revisions={}
 def patch_history(self,track):return self.sound_history[track][self.project.tracks[track].get('sound_ab',{}).get('active','A')]
 def replace_project(self,project):
  self.stop();self.project=project;self.init_workflow();self.configure();self.history=[];self.mutation_sessions.clear()
 def owned(self,track):
  if type(track) is not int or track!=self.selected:raise ValueError('Track changed; sound edit cancelled')
 def ab_action(self,track,action):
  self.owned(track);self.cancel_sound_gesture();t=self.project.tracks[track]
  if action not in ('A','B','copy'):raise ValueError('Unknown comparison action')
  ab=t.setdefault('sound_ab',dict(active='A',A=sound_patch(t),B=sound_patch(t)))
  active=ab['active'];ab[active]=sound_patch(t)
  if action=='copy':
   other='B' if active=='A' else 'A';ab[other]=sound_patch(t);self.sound_history[track][other]=[];return
  if action==active:return
  patch=ab[action]
  for k in ('instrument','preset','fx'):
   if k in patch:t[k]=copy.deepcopy(patch[k])
   else:t.pop(k,None)
  ab['active']=action;self.synths[track].configure(t['instrument']);self.fx[track].configure(t.get('fx'))
 def control_scope(self,track,module,param):
  if module+'.'+param not in registry():raise ValueError('Unknown gesture target')
  t=self.project.tracks[track];absent=False
  if module=='sound':
   fields=('fenv_a','fenv_d','fenv_s','fenv_r') if param.startswith('fenv_') else (param,)
   paths=[('volume',)] if param=='volume' else [('instrument',key) for key in fields]
  else:
   absent='fx' not in t;source=t if not absent else {**t,'fx':default_chain()}
   if module=='macro':paths=[('fx','macros',int(param),'value')]
   else:paths=[('fx','modules',next(i for i,m in enumerate(source['fx']['modules']) if m['id']==module),'params',param)]
   return dict(module=module,paths=paths,values=[_get(source,p) for p in paths],absent=absent)
  return dict(module=module,param=param,revisions={k:self.control_revisions.get((track,module,k),0) for k in fields},paths=paths,values=[_get(t,p) for p in paths],absent=False)
 def restore_scope(self,track,scope):
  t=self.project.tracks[track]
  if scope['paths'][0][0]=='fx':t.setdefault('fx',default_chain())
  for path,value in zip(scope['paths'],scope['values']):
   if scope.get('param','').startswith('fenv_') and path[-1]!=scope['param']:
    if value['present'] or self.control_revisions.get((track,'sound',path[-1]),0)!=scope['revisions'][path[-1]]:continue
   if path[:2]==('fx','modules'):path=('fx','modules',next(i for i,m in enumerate(t['fx']['modules']) if m['id']==scope['module']),*path[3:])
   _put(t,path,value)
  if scope['absent'] and t.get('fx')==default_chain():t.pop('fx',None)
  self.synths[track].configure(t['instrument']);self.fx[track].configure(t.get('fx'))
 @staticmethod
 def scope_value(scope):
  if scope.get('param','').startswith('fenv_'):return scope['values'][next(i for i,p in enumerate(scope['paths']) if p[-1]==scope['param'])]
  return scope['values']
 def sound_gesture(self,track,module,param,action):
  if action=='cancel' and self._sound_gesture is None:return
  self.owned(track)
  if action=='begin':
   self.cancel_sound_gesture();self._sound_gesture=dict(track=track,module=module,param=param,before=self.control_scope(track,module,param),automation=copy.deepcopy(self.project.tracks[track].get('automation')));return
  g=self._sound_gesture
  if g is None:return
  if (g['track'],g['module'],g['param'])!=(track,module,param):raise ValueError('Gesture owner changed')
  if action=='cancel':self.cancel_sound_gesture();return
  if action!='end':raise ValueError('Invalid gesture action')
  after=self.control_scope(track,module,param);self._sound_gesture=None
  if self.scope_value(after)!=self.scope_value(g['before']):
   history=self.patch_history(track);history.append(dict(module=module,param=param,before=g['before'],after=after));del history[:-40]
 def cancel_sound_gesture(self):
  g=self._sound_gesture
  if g is None:return
  self._sound_gesture=None;self.restore_scope(g['track'],g['before'])
  # Only this target's recorded lane belongs to the canceled gesture.
  t=self.project.tracks[g['track']];others=[x for x in t.get('automation',[]) if (x['module'],x['param'])!=(g['module'],g['param'])]
  previous=[x for x in g['automation'] or [] if (x['module'],x['param'])==(g['module'],g['param'])]
  if others or previous:t['automation']=others+previous
  elif g['automation'] is None:t.pop('automation',None)
  else:t['automation']=[]
 def sound_undo_counts(self):return [len(self.patch_history(tr)) for tr in range(4)]
 def sound_undo(self,track):
  self.owned(track);self.cancel_sound_gesture()
  history=self.patch_history(track)
  if not history:return
  entry=history[-1];now=self.control_scope(track,entry['module'],entry['param'])
  if self.scope_value(now)!=self.scope_value(entry['after']):raise ValueError('Sound changed since this edit; undo cancelled')
  self.restore_scope(track,entry['before']);history.pop()
 def set_automation(self,track,lanes):
  self.owned(track);clean=validate_automation(lanes);self.project.tracks[track]['automation']=clean
 def record_control(self,track,module,param,value):
  self.control_revisions[(track,module,param)]=self.control_revisions.get((track,module,param),0)+1
  spec=registry().get(module+'.'+param)
  if spec is None or not self.recording or not self.automation_arm:return
  self.automation_touched.add((track,module,param))
  unit=min(1.,max(0.,(value-spec['min'])/(spec['max']-spec['min'])));t=self.project.tracks[track];lanes=copy.deepcopy(t.get('automation',[]))
  lane=next((l for l in lanes if (l['module'],l['param'])==(module,param)),None)
  if lane is None:
   if len(lanes)>=16:raise ValueError('Automation lane limit reached')
   lane=dict(module=module,param=param,points=[]);lanes.append(lane)
  beat=round(self.frame/self.fpb if self.project.song['on'] else (self.frame/self.fpb)%self.project.beats,6)
  points=[p for p in lane['points'] if p[0]!=beat]
  if len(points)>=2048:raise ValueError('Automation point limit reached')
  points.append([beat,unit]);lane['points']=sorted(points);t['automation']=validate_automation(lanes)
 def record_fx_changes(self,track,old,new):
  if not self.recording or not self.automation_arm:return
  for m in new['modules']:
   previous=next(x for x in old['modules'] if x['id']==m['id'])
   for k,v in m['params'].items():
    if previous['params'].get(k)!=v:self.record_control(track,m['id'],k,v)
  for i,m in enumerate(new['macros']):
   if m['value']!=old['macros'][i]['value']:self.record_control(track,'macro',str(i),m['value'])
 def automation_block(self,count):
  self.automation_values=[{} for _ in range(4)]
  if not self.playing:return count
  beat=self.frame/self.fpb;span=self.project.beats
  if not self.project.song['on']:beat%=span
  for tr,t in enumerate(self.project.tracks):
   for lane in t.get('automation',[]):
    # During a write, the user's active control wins over previously recorded playback.
    if self.recording and self.automation_arm and (tr,lane['module'],lane['param']) in self.automation_touched:continue
    points=lane['points'];index=bisect_right(points,[beat,2.]);left=points[max(0,index-1)];right=points[min(index,len(points)-1)]
    if beat<=points[0][0]:unit=points[0][1]
    elif beat>=points[-1][0]:unit=points[-1][1]
    else:unit=left[1]+(right[1]-left[1])*(beat-left[0])/(right[0]-left[0])
    spec=registry()[lane['module']+'.'+lane['param']];self.automation_values[tr][(lane['module'],lane['param'])]=spec['min']+unit*(spec['max']-spec['min'])
    if index<len(points):
     delta=round((points[index][0]-beat)*self.fpb)
     if 0<delta<count:count=delta
  if not self.project.song['on']:
   wrap=round((span-beat)*self.fpb)
   if 0<wrap<count:count=wrap
  return count
