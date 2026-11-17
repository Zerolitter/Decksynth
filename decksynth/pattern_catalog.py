"""Factory preview is transient, scheduled on Engine.absolute_frame, never REC."""
import copy,re,math
from .genre_patterns import template,resolve_pattern,kit_roles
from .keystep import MAX_STEPS,empty_pattern,song_from_pattern,validate_state as validate_performance,defaults as performance_defaults,schedule_notes,slot_key,reconcile_pattern_timing,validate_pattern,DIVISIONS
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
 def _merged_structure(self,state,limit=None):
  """The Structure as one pattern: every play of every part, end to end (keystep plays the chain the same way)."""
  seq=state['seq']
  if not seq['chain_enabled'] and seq['chain']==[slot_key(seq['bank'],seq['slot'])]:raise ValueError('The Structure is empty; add parts first')
  parts=[state['patterns'].get(k) or empty_pattern(seq['length'],seq['division']) for k in seq['chain']]
  if len({p['division'] for p in parts})>1:raise ValueError('The parts use different step sizes; set them all to the same rate first')
  steps=[list(map(dict,st)) for p in parts for st in p['steps']]
  if limit and len(steps)>limit:raise ValueError('The Structure is %d steps; one pattern holds %d. Remove a part or a repeat.'%(len(steps),limit))
  if not any(steps):raise ValueError('The Structure has no notes yet')
  return dict(length=len(steps),division=parts[0]['division'],gate=parts[0]['gate'],swing=parts[0]['swing'],steps=steps)
 def structure_merge(self):
  """Send to pattern: the whole Structure becomes one pattern in an empty slot, which opens with its full
  length (the sequencer grows to fit, up to 256 steps). Play in order turns off; the Structure stays. One undo step."""
  if self.recording:raise ValueError('Finish the take first')
  state=copy.deepcopy(self.project.performance);seq=state['seq']
  merged=self._merged_structure(state,MAX_STEPS)
  key=self._free_slots(state,1,seq['chain'])[0]
  state['patterns'][key]=merged
  b,s=map(int,key.split(':'));seq['bank'],seq['slot']=b,s;seq['chain_enabled']=False;seq['enabled']=True;state['arp']['enabled']=False
  reconcile_pattern_timing(state,merged)
  state=validate_performance(state)
  self.stop_pattern_preview();self.release_performance('perf_seq');self.snapshot();self.project.performance=state
  self.rec_step=0;self.rec_last=None
  return key,merged['length']
 def structure_extend(self):
  """Extend: the whole Structure goes onto the end of the open clip (from the bar after its last note).
  The loop grows to the next length that fits (up to 32 bars). Sequencer playback hands over to the clip. One undo step."""
  if self.recording:raise ValueError('Finish the take first')
  from .core import BAR_CHOICES
  state=copy.deepcopy(self.project.performance);seq=state['seq']
  merged=self._merged_structure(state)
  notes=self.project.tracks[self.selected]['notes']
  end=max((n['start']+n['duration'] for n in notes),default=0.)
  offset=math.ceil(end/4-1e-6)*4
  span=merged['length']*DIVISIONS[merged['division']]
  bars=next((b for b in BAR_CHOICES if b*4>=offset+span-1e-6),None)
  if bars is None:raise ValueError('The clip would pass 32 bars (it needs %d); clear some bars or shorten the Structure'%math.ceil((offset+span)/4))
  added=song_from_pattern(merged,math.ceil(span/4-1e-6),seq['transpose'],fill=False,feel=dict(spice=seq['spice'],spice_seed=seq['spice_seed']))
  for n in added:n['start']+=offset;n['duration']=min(n['duration'],bars*4-n['start'])
  added=[n for n in added if n['start']<bars*4]
  self.stop_pattern_preview();self.release_performance('perf_seq')
  self.snapshot();self.stop()
  if bars>self.project.bars:self.project.bars=bars  # growing never wraps a note, so no clamping is needed
  self.project.tracks[self.selected]['notes'].extend(added)
  seq_now=self.project.performance['seq'];seq_now['enabled']=False;seq_now['chain_enabled']=False
  return int(offset//4)+1,math.ceil((offset+span)/4-1e-6),bars
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
