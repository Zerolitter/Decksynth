"""Factory preview is transient, scheduled on Engine.absolute_frame, never REC."""
import copy,re
from .genre_patterns import template,resolve_pattern,kit_roles
from .keystep import defaults as performance_defaults,schedule_notes,slot_key,reconcile_pattern_timing,validate_pattern,DIVISIONS
from .devices import device_kind
class PatternCatalogEngine:
 def catalog_action(self,action,target,expected,identity,source_expected=None):
  if action=='stop':self.stop_pattern_preview();return
  if action not in ('preview','load','preview_user','load_user'):raise ValueError('Unknown catalog action')
  if self.recording:raise ValueError('Finish the take before using the library')
  current,_=self.note_target(target)
  if target.get('kind')!='pattern' or current!=expected:raise ValueError('Pattern changed; reopen the library')
  track=target['track'];owner=self.project.tracks[track]
  if target.get('kit')!=owner.get('drum_rack'):raise ValueError('Kit changed; reopen the library')
  if action.startswith('preview') and owner['mute']:raise ValueError('Track is muted; unmute it to preview')
  source=None
  if action.endswith('_user'):
   match=re.fullmatch(r'user\.([1-4])\.([1-9]|1[0-6])',identity) if isinstance(identity,str) else None
   if not match:raise ValueError('Invalid source pattern address')
   source=slot_key(int(match[1]),int(match[2]));stored=self.project.performance['patterns'].get(source)
   if stored is None or stored!=source_expected:raise ValueError('Source pattern changed; choose it again')
   pattern=validate_pattern(copy.deepcopy(stored))
  else:
   item=template(identity);pattern=resolve_pattern(item,owner,self.drums[track])
  if action.startswith('load'):
   self.stop_pattern_preview();state=copy.deepcopy(self.project.performance);addr=slot_key(target['bank'],target['slot']);state['patterns'][addr]=pattern;reconcile_pattern_timing(state)
   if pattern!=current:self._commit_pattern_edit(state,addr,True,None)
   return
  self.stop_pattern_preview();self.release_performance('perf_seq')
  state=performance_defaults();state['seq']['enabled']=True;state['patterns']['1:1']=pattern
  self._pattern_preview=dict(id=identity,track=track,origin=self.absolute_frame,state=state,target=copy.deepcopy(target),pattern=pattern,source=source)
 def stop_pattern_preview(self):
  preview=getattr(self,'_pattern_preview',None)
  if preview:
   tr=preview['track'];self.synths[tr].cancel_sources(('preview',));self.drums[tr].cancel_source('preview');self.samplers[tr].cancel_sources(('preview',))
   self.drum_gate_keys[tr]={k for k in self.drum_gate_keys[tr] if not (isinstance(k,tuple) and k[0]=='preview')}
  self._pattern_preview=None
 def preview_events(self,start,end):
  p=getattr(self,'_pattern_preview',None)
  if not p:return []
  target=p['target'];track=self.project.tracks[p['track']];seq=self.project.performance['seq']
  if (p.get('source') and self.project.performance['patterns'].get(p['source'])!=p['pattern']) or self.recording or track['mute'] or p['track']!=self.selected or device_kind(track)!=target.get('device','synth') or track.get('drum_rack')!=target.get('kit') or (seq['bank'],seq['slot'])!=(target['bank'],target['slot']):
   self.stop_pattern_preview();return []
  return [(offset,action,p['track'],pitch,velocity,('preview',p['origin'],*token[1:])) for offset,action,pitch,velocity,token in schedule_notes(p['state'],[],start-p['origin'],end-p['origin'],self.fpb)]
 def preview_status(self):
  p=getattr(self,'_pattern_preview',None)
  return dict(id=p['id'],track=p['track'],step=int((self.absolute_frame-p['origin'])/self.fpb/DIVISIONS[p['pattern']['division']])%p['pattern']['length']) if p else None
 def pattern_library_status(self):
  roles,ready=kit_roles(self.project.tracks[self.selected],self.drums[self.selected])
  return dict(roles=roles,ready=ready,preview=self.preview_status())
