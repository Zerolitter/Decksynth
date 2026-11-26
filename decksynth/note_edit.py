"""Owned atomic note edits; UI previews never mutate the engine before release."""
import copy,math
from .keystep import current_pattern,slot_key,validate_pattern
from .devices import device_kind


def clean_events(events,span,pattern=False):
 if not isinstance(events,list) or len(events)> (512 if pattern else 100000):raise ValueError('Too many notes')
 out=[];seen=set();counts={}
 for n in events:
  if not isinstance(n,dict):raise ValueError('Invalid MIDI event')
  try:start=n['start'];duration=n['duration'];note=n['note'];velocity=n['velocity']
  except KeyError as exc:raise ValueError('Incomplete MIDI event') from exc
  if any(type(v) not in (int,float) or not math.isfinite(v) for v in (start,duration)):raise ValueError('Invalid note time')
  if not 0<=start<span or not 0<duration<= (8 if pattern else span):raise ValueError('Note is outside the editable range')
  if type(note) is not int or not 0<=note<=127 or type(velocity) is not int or not 1<=velocity<=127:raise ValueError('Invalid MIDI pitch or velocity')
  if pattern:
   if start!=int(start) or duration!=int(duration):raise ValueError('Sequence events must use whole steps')
   if (start,note) in seen:raise ValueError('Duplicate pitch in one step')
   seen.add((start,note));counts[start]=counts.get(start,0)+1
   if counts[start]>8:raise ValueError('Maximum8notes per step')
  out.append(copy.deepcopy(n))
 return out

class NoteEditEngine:
 def editor_note(self,track,gesture,note,velocity):
  if type(track) is not int or not 0<=track<len(self.project.tracks) or not isinstance(gesture,str) or not 1<=len(gesture)<=64:raise ValueError('Invalid editor audition owner')
  if type(note) is not int or not 0<=note<=127 or type(velocity) is not int or not 0<=velocity<=127:raise ValueError('Invalid editor audition note')
  token=('editor',gesture)
  if velocity:
   if track!=self.selected:raise ValueError('Track changed; audition cancelled')
   self.synths[track].cancel_tokens({token});self.samplers[track].cancel_tokens({token});self.voice_on(track,note,velocity,token)
  else:self.synths[track].cancel_tokens({token});self.samplers[track].off(note,token);self.drum_gate_keys[track].discard(token)
 def note_target(self,target,owned=True):
  if not isinstance(target,dict) or target.get('kind') not in ('clip','pattern'):raise ValueError('Invalid note target')
  track=target.get('track')
  if type(track) is not int or not 0<=track<len(self.project.tracks) or (owned and track!=self.selected):raise ValueError('Track changed; note edit cancelled')
  if 'device' in target and target['device']!=device_kind(self.project.tracks[track]):raise ValueError('Instrument changed; note edit cancelled')
  if target['kind']=='clip':
   clip=target.get('clip')
   if type(clip) is not int or not 0<=clip<8 or (owned and clip!=self.project.clips['open'][track]):raise ValueError('Clip changed; note edit cancelled')
   if target.get('bars')!=self.project.bars:raise ValueError('Loop length changed; note edit cancelled')
   return self.project.clip_notes(track,clip),self.project.beats
  bank=target.get('bank');slot=target.get('slot')
  if type(bank) is not int or type(slot) is not int:raise ValueError('Invalid pattern address')
  address=slot_key(bank,slot);seq=self.project.performance['seq']
  if owned and (bank,slot)!=(seq['bank'],seq['slot']):raise ValueError('Pattern changed; note edit cancelled')
  pattern=self.project.performance['patterns'].get(address)
  if pattern is None:
   if (bank,slot)!=(seq['bank'],seq['slot']):raise ValueError('Pattern is no longer available')
   pattern=current_pattern(self.project.performance)
  return pattern,pattern['length']
 def cancel_changed_loop_notes(self,track,before,after):
  changed={i for i,n in enumerate(before) if i>=len(after) or n!=after[i]};s=self.synths[track]
  tokens={k for k in set(s.gated)|set(s.mono_held)|set(s.voices) if isinstance(k,tuple) and len(k)>1 and k[0]=='loop' and k[1] in changed}
  s.cancel_tokens(tokens)
  self.samplers[track].cancel_sources_where(lambda k:isinstance(k,tuple) and len(k)>1 and k[0]=='loop' and k[1] in changed)
  self.drum_gate_keys[track]={k for k in self.drum_gate_keys[track] if not (isinstance(k,tuple) and len(k)>1 and k[0]=='loop' and k[1] in changed)}
 def put_clip_events(self,target,events):
  track=target['track'];clip=target['clip']
  before=self.project.clip_notes(track,clip)
  if clip==self.project.clips['open'][track]:
   self.cancel_changed_loop_notes(track,before,events);self.project.tracks[track]['notes']=copy.deepcopy(events)
  else:self.project.clips['slots'][track][clip]=copy.deepcopy(events)
 def note_edit(self,target,expected,events):
  if self.recording:raise ValueError('Finish the take before editing notes')
  current,span=self.note_target(target)
  if current!=expected:raise ValueError('Notes changed since the gesture; edit cancelled')
  clean=clean_events(events,span,target['kind']=='pattern')
  if target['kind']=='pattern':
   pattern=copy.deepcopy(current);pattern['steps']=[[] for _ in range(span)]
   for n in clean:pattern['steps'][int(n['start'])].append(dict(note=n['note'],velocity=n['velocity'],tie=int(n['duration'])))
   validate_pattern(pattern)
   if pattern==current:return
   state=copy.deepcopy(self.project.performance);address=slot_key(target['bank'],target['slot']);state['patterns'][address]=pattern
   self._commit_pattern_edit(state,address)
   if state['seq']['recording']:
    added=[i for i,step in enumerate(pattern['steps']) if any(n['note'] not in {old['note'] for old in current['steps'][i]} for n in step)]
    if added:self.rec_step=(max(added)+1)%span;self.rec_last=None
  else:
   if clean==current:return
   self.snapshot();self.history[-1]['_note_edit']=dict(target=copy.deepcopy(target),before=copy.deepcopy(current),after=copy.deepcopy(clean))
   self.put_clip_events(target,clean)
 def undo_note_edit(self,entry):
  current,_=self.note_target(entry['target'],owned=False)
  if current!=entry['after']:raise ValueError('Clip notes changed since this edit; undo cancelled')
  self.put_clip_events(entry['target'],entry['before']);self.history.pop()
