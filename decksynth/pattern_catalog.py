"""Factory preview is transient, scheduled on Engine.absolute_frame, never REC."""
import copy,re
from .genre_patterns import template,resolve_pattern,kit_roles
from .keystep import validate_state as validate_performance,defaults as performance_defaults,schedule_notes,slot_key,reconcile_pattern_timing,validate_pattern,DIVISIONS
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
 # ---- Structure: patterns in play order (the seq chain), each slot address repeated for its repeat count.
 def _structure_check(self,target,expected):
  if self.recording:raise ValueError('Finish the take before changing the structure')
  current,_=self.note_target(target)
  if target.get('kind')!='pattern' or current!=expected:raise ValueError('Pattern changed; reopen the library')
  owner=self.project.tracks[target['track']]
  if target.get('kit')!=owner.get('drum_rack'):raise ValueError('Kit changed; reopen the library')
  return owner
 @staticmethod
 def _free_slots(state,count,keep=()):
  """Empty slots for new parts: a wholly empty bank first (parts stay side by side), then any empty slot."""
  seq=state['seq'];used=set(keep)
  empty=lambda k:k not in used and not any(step for step in (state['patterns'].get(k) or {}).get('steps',[]))
  banks=[seq['bank']]+[b for b in range(1,5) if b!=seq['bank']]
  # after the structure's last part when it sits in this bank, so parts stay side by side
  last=[k for k in keep if k.startswith(str(seq['bank'])+':')]
  start=int(last[-1].split(':')[1]) if last else 0
  here=[slot_key(seq['bank'],s) for s in list(range(start+1,17))+list(range(1,start+1))]
  if sum(map(empty,here))<count:
   whole=[slot_key(b,s) for b in banks[1:] if all(empty(slot_key(b,s)) for s in range(1,17)) for s in range(1,17)]
   here=whole+here
  order=here+[slot_key(b,s) for b in banks for s in range(1,17)]
  out=[]
  for k in order:
   if k not in out and empty(k):out.append(k)
   if len(out)==count:return out
  raise ValueError('Not enough empty pattern slots; clear a few first')
 def _commit_structure(self,state):
  state['seq']['chain_enabled']=True;state['seq']['enabled']=True;state['arp']['enabled']=False
  state=validate_performance(state)
  self.stop_pattern_preview();self.release_performance('perf_seq');self.snapshot();self.project.performance=state
 def structure_add(self,target,expected,identity,source_expected=None,repeats=1):
  """Library card -> end of the Structure. A factory pattern is copied into an empty slot first; a user slot is
  added as it is. Turns Play in order on. One undo step."""
  owner=self._structure_check(target,expected)
  if type(repeats) is not int or not 1<=repeats<=16:raise ValueError('Repeats must be 1 to 16')
  state=copy.deepcopy(self.project.performance);seq=state['seq']
  fresh=not seq['chain_enabled'] and seq['chain']==[slot_key(seq['bank'],seq['slot'])]
  chain=[] if fresh else list(seq['chain'])
  match=re.fullmatch(r'user\.([1-4])\.([1-9]|1[0-6])',identity) if isinstance(identity,str) else None
  if match:
   key=slot_key(int(match[1]),int(match[2]))
   if state['patterns'].get(key)!=source_expected:raise ValueError('Source pattern changed; choose it again')
  else:
   item=template(identity);key=self._free_slots(state,1,chain)[0]
   state['patterns'][key]=resolve_pattern(item,owner,self.drums[target['track']])
  if len(chain)+repeats>64:raise ValueError('A structure holds 64 plays at most')
  seq['chain']=chain+[key]*repeats
  self._commit_structure(state)
  return key
 def structure_load(self,target,expected,identity):
  """A factory Structure: its parts go into empty slots and become the play order. One undo step."""
  from .genre_patterns import structures
  owner=self._structure_check(target,expected)
  found=next((s for s in structures() if s['id']==identity),None)
  if found is None:raise ValueError('Unknown structure')
  state=copy.deepcopy(self.project.performance)
  unique=list(dict.fromkeys(i for i,_ in found['parts']))
  slots=dict(zip(unique,self._free_slots(state,len(unique))))
  for ident,key in slots.items():state['patterns'][key]=resolve_pattern(template(ident),owner,self.drums[target['track']])
  state['seq']['chain']=[slots[i] for i,n in found['parts'] for _ in range(n)][:64]
  self._commit_structure(state)
  return sorted(slots.values(),key=lambda k:tuple(map(int,k.split(':'))))
 def structure_set(self,chain,enabled):
  """Reorder, repeat or remove parts, or switch Play in order, without touching any pattern."""
  if not isinstance(chain,list) or type(enabled) is not bool:raise ValueError('Invalid structure')
  state=copy.deepcopy(self.project.performance);seq=state['seq']
  seq['chain']=chain or [slot_key(seq['bank'],seq['slot'])];seq['chain_enabled']=enabled and bool(chain)
  if seq['chain_enabled']:seq['enabled']=True;state['arp']['enabled']=False
  state=validate_performance(state)
  self.release_performance('perf_seq');self.project.performance=state
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
