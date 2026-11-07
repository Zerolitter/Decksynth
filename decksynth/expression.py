"""Mono/Legato note ownership and short sample-clock glide segments, using the existing voice renderer."""
import math

class ExpressionVoice:
 def cancel_sources(self,prefixes,cut=()):
  """Cancel a source's logical stack, including notes suppressed by Mono/Legato."""
  source=lambda k:k[0] if isinstance(k,tuple) and k else None
  cancelled={k for k in set(self.gated)|set(self.mono_held)|set(self.voices) if source(k) in prefixes}
  for k in cancelled:self.gated.pop(k,None);self.mono_held.pop(k,None)
  if self.mono_lead in cancelled:
   if self.mono_held:
    token=next(reversed(self.mono_held));note,velocity=self.mono_held[token]
    self.mono_on(note,velocity,token)
   else:self.mono_lead=None
  for k in cancelled:
   v=self.voices.get(k)
   if v:
    if source(k) in cut:self.voices.pop(k,None)
    elif v['release'] is None:v.update(held=False,release=(0,v['level']))
 def mono_on(self,note,velocity,token):
  self.mono_held.pop(token,None);self.mono_held[token]=(note,velocity)
  old=self.voices.get(self.mono_lead);current=old.get('current_note',old['note']) if old else note
  legato=self.params.get('play_mode',0)==2 and old is not None and old.get('release') is None
  if legato:
   self.voices.pop(self.mono_lead,None);v=old;v.update(note=note,velocity=velocity/127,held=True,release=None)
   table=self.table(math.ceil(max(current,note)),velocity/127)
   if table is not v['table']:v.update(prev=v['table'],xf=0.,table=table)
   self.voices[token]=v
  else:
   if old:self.fade(self.mono_lead)
   self._mono_internal=True
   try:self.on(note,velocity,token)
   finally:self._mono_internal=False
   v=self.voices[token]
  self.mono_lead=token
  duration=round((self.live or self.params).get('glide',0.)*self.rate) if old else 0
  v.update(current_note=current if duration else note,glide_from=current,glide_age=0,glide_samples=duration)
  v['table_note']=math.ceil(max(current,note)) if duration else note
  table=self.table(v['table_note'],velocity/127)
  if table is not v['table']:v.update(prev=v['table'],xf=0.,table=table)
  v['pitch_factor']=2**((v['current_note']-note)/12)
 def mono_off(self,token):
  self.mono_held.pop(token,None)
  if token!=self.mono_lead:return True
  if self.mono_held:
   next_token=next(reversed(self.mono_held));note,velocity=self.mono_held[next_token]
   self.gated[next_token]=True;self.mono_on(note,velocity,next_token);return True
  return False
 def render_glide(self,frames):
  out=[];self._in_glide=True
  try:
   remaining=frames
   while remaining:
    count=min(16,remaining)
    for v in self.voices.values():
     if v.get('glide_samples',0)>v.get('glide_age',0):v['pitch_factor']=2**((v['current_note']-v['note'])/12)
    out.extend(self.render(count));remaining-=count
    for v in self.voices.values():
     if v.get('glide_samples',0)>v.get('glide_age',0):
      v['glide_age']=min(v['glide_samples'],v['glide_age']+count)
      v['current_note']=v['glide_from']+(v['note']-v['glide_from'])*v['glide_age']/v['glide_samples']
      if v['glide_age']==v['glide_samples']:
       v['pitch_factor']=1.;v['table_note']=v['note'];table=self.table(v['note'],v['velocity'])
       if table is not v['table']:v.update(prev=v['table'],xf=0.,table=table)
  finally:self._in_glide=False
  return out
