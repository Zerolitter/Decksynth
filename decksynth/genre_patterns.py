"""Original event realizations of the supplied rhythm briefs. No sample assets.

Role pitches describe the default kit only. resolve_pattern binds roles to the
actual active kit without moving samples or changing their saved MIDI mapping.
"""
import copy,json,re
from functools import lru_cache
from pathlib import Path
from .library import factory_bank,FACTORY_PATTERNS
from .keystep import validate_pattern
ROLES={'kick':36,'snare':38,'clap':39,'rim':40,'perc':41,'closed_hat':42,'open_hat':43,'shaker':44,'tom':45,'ride':50,'crash':51}
# Drum grooves whose kind is an arrangement move also appear under Effects.
DRUM_FX_ROLES={'build':'builder','fill':'tension','transition':'tension','breakdown':'bridge'}
BANK_CATEGORY=['bass','chords','arp','melodie']
# Each recipe is a deliberate 16th-grid rhythm; 32-step entries explicitly vary
# their second bar. k/s/c/h/o/r/p/t/y = the corresponding kit roles.
RECIPES=[
 # EDM
 ('0 4 8 12 16 20 24 28','','4 12 20 28','','2 6 10 14 18 22 26 30','','','',''),
 ('0 8 16 22 28','','4 12 20 28','','2 10 18 26','','','7 15 23 30',''),
 ('0 4 8 12 16 20 24 28','','4 12 20 28','0 2 3 4 6 7 8 10 11 12 14 15 16 17 18 20 22 23 24 25 26 28 30 31','','','','',''),
 ('0 4 8 12 16 20 24 28','4 12 18 20 22 24 26 28 29 30 31','','2 6 10 14 17 19 21 23 25 27 29 31','','','15 23 27','',''),
 ('0 10','','','2 6 14','','8','','',''),
 ('0 4 8 12 16 20 24 28','','4 12 20 28','0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31','','','','',''),
 ('0 4 8 12 16 20 24 28','6 14 22 30','','2 6 10 14 18 22 26 30','','','3 11 19 27','',''),
 ('0 3 7 10 14','4 12','','2 6 11 15','','','5 9 13','',''),
 ('0 4 7 8 12 15 16 20 23 24 28 31','','4 12 20 28','2 10 18 26','6 14 22 30','','','',''),
 ('0 8','7 11 15','','2 10','','','','',''),
 ('0 4 8 12 16 20 24','4 12 20 28 29 30 31','','2 6 10 14 18 22 26','','','','27 30',''),
 ('0 4 8 12 16 20 24 28','','4 12 20 28','2 6 10 14 18 22 26 30','','','','3 7 11 15 18 22 26 30',''),
 ('0 4 8 12','','4 12','2 6 10 14','','','1 3 7 9 11 15','',''),
 ('0 10 16 26','8 24','','0 2 4 6 10 12 14 16 18 20 22 26 28 30','','','','',''),
 ('0 8 16 24','4 12 16 20 22 24 26 28 29 30 31','','2 6 10 14 18 22 26 30','','','','',''),
 ('0 4 8 12 16 20 24 28 30','31','4 12 20 28','0 2 6 8 10 14 16 18 22 24 26 30','2 10 18 26','','','29 31',''),
 # House
 ('0 4 8 12','','4 12','2 6 10 14','','','','',''),
 ('0 4 8 12 16 20 24 28','11 27','4 12 20 28','2 3 6 7 10 11 14 15 18 19 22 23 26 27 30 31','','','7 19 29','',''),
 ('0 4 8 12 16 20 24 28','','4 12 20 28','0 8 16 24','2 6 10 14 18 22 26 30','','','3 7 15 19 23 29','',''),
 ('0 3 8 10 14','4 12','','2 6 10 14','','7 15','','',''),
 ('0 7 10 16 22 26','4 12 20 28','','0 2 3 6 8 10 11 14 16 18 19 22 24 26 27 30','','','7 23 31','',''),
 ('0 4 8 12','','12','2 10 14','','','','',''),
 ('0 4 8 12 16 20 24 28','','4 12 20 28','6 14 22 30','','','3 19','',''),
 ('0 4 8 12 16 20 24 28','','4 12 20 28','0 2 3 5 6 8 10 11 13 14 16 18 19 21 22 24 26 27 29 30','7 23','','','',''),
 ('0 4 8 12 16 20 24 28','','4 12 20 28','2 6 10 14 18 22 26 30','','','1 7 11 17 23 29','3 6 13 19 22 31',''),
 ('0 6 8 12','3 11 15','4 12','2 6 10 14','','','','',''),
 ('0 4 8 12 16 20 24 28','','4 12 20 28','0 4 8 12 16 20 24 28','2 6 10 14 18 22 26 30','','','',''),
 ('0 4 10 16 20 26','','','2 3 6 7 10 11 14 15 18 19 22 23 26 27 30 31','','4 7 12 20 23 28','','',''),
 ('0 4 8 12 16 20 24 28','','4 12 20 27 28','2 6 10 14 18 22 26 30','','','','',''),
 ('0 4 8 12 16 20 24','4 11 12 20 27 28','','2 6 10 14 18 22 26 30','','','','',''),
 ('0 4 8 12 16 20 24','29 31','4 12 20 28','2 6 10 14 18 22 26','','','','28 30',''),
 ('0 4 8 12 16 20 24 28','','4 12 20 28','','2 10 18 26','','7 15 23 31','',''),
 # Techno
 ('0 4 8 12','12','','2 6 10 14','','','','',''),
 ('0 4 8 12 16 20 24 28','4 12 20 28','','0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31','','','7 15 23 31','',''),
 ('0 4 8 12 16 20 24 28','12 28','','0 3 6 8 11 14 16 18 21 24 27 30','10 26','','','',''),
 ('0 4 8 12','','','2 10','','7 15','','',''),
 ('0 4 12 16 24 28','','','2 6 10 14 18 22 26 30','','3 7 11 19 23 29','','',''),
 ('0 2 4 8 12 14 16 20 22 24 28 30','12 28','','2 6 10 14 18 22 26 30','','','','',''),
 ('0 4 8 12','','','2 6 10 14','','','3 7 9 15','',''),
 ('0 8','','','2 6 10 14','','','','',''),
 ('0 4 8 12 16 20 24 28','12 28','','0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 18 19 20 21 22 23 24 25 26 27 28 30 31','','','','',''),
 ('0 3 10 14 16 19 25 30','4 12 20 28','','2 6 9 14 18 22 25 30','','','7 23','',''),
 ('0 4 8 12 16 20 24 28','12 26 28 29 30 31','','2 6 10 14 18 22 26 30','','','15 23','',''),
 ('0 4 8 12 16 20 24 28','','','2 6 10 14 18 22 26 30','','','0 3 6 9 12 15 18 21 24 27 30','',''),
 ('0 4 8 12 16 20 24 28','12 28','','2 6 10 14 18 22 26 30','','','','','16 20 24 26 28 30'),
 ('0 4 8 12 16 20 24 28','','','2 10 18 26 31','','','7 23','',''),
 ('0 4 8 12 16 20 24','12 28 30','','2 6 10 14 18 22 26','','25 27 29 31','','24 26 28 30',''),
 ('0 4 8 12 16 24','4 12','','0 2 4 6 8 10 12 14 18 26','','','3 7 11 15','',''),
 # Drum & Bass
 ('0 10 16 22','4 12 20 28','','0 2 6 8 10 14 16 18 22 24 26 30','','','','',''),
 ('0 10 16 26','4 11 12 20 27 28','','0 2 3 6 8 10 11 14 16 18 19 22 24 26 27 30','','','','',''),
 ('0 6 10 15 18 23 26','4 7 11 12 19 20 23 27 28 31','','0 2 3 6 8 10 14 16 18 22 24 26 30','','','','',''),
 ('0 9 16 22 26','4 12 20 28','','0 2 5 6 8 10 13 14 16 18 21 22 24 26 29 30','7 23','','','',''),
 ('0 6 14','8','','0 2 4 6 10 12 14','','','','',''),
 ('0 10 16 26','4 12 20 28','','2 6 10 14 18 22 26 30','','','','',''),
 ('0 10 16 26','4 9 11 12 20 25 27 28 30 31','','0 2 6 8 10 14 16 18 22 24 26 30','','','','',''),
 ('0 7 10 16 23 26','4 12 19 20 28 31','','0 2 3 6 8 10 11 14 16 18 19 22 24 26 27 30','','','','',''),
 ('0 10','4 12','','0 4 8 12','2 6 10 14','','','',''),
 ('0 10 16 24','4 12 20 28','','0 2 6 8 10 14 16 18 22 24 26 30','','','','',''),
 ('0 6 10 16 22 26','4 12 20 28','','0 1 2 3 6 7 8 9 10 11 14 15 16 18 19 22 23 24 26 27 30 31','','','13 29','',''),
 ('0 10','4 12','','2 6 10 14','','','7 15','',''),
 ('0 10 16 22','4 12 20 28','','0 2 6 8 10 14 16 18 22 24 26 30','','','3 7 11 15 19 23 27 31','',''),
 ('0 10','4 12','','2 6 11 14','','','','',''),
 ('0 10 16 22','4 12 20 24 26 27 28 29 30 31','','0 2 6 8 10 14 16 18 22 24 26 30','','','','',''),
 ('0 16 22 26','12 20 28','','2 6 10 14 16 18 22 24 26 30','18 26','','','30 31','')]
RECIPE_ROLES=('kick','snare','clap','closed_hat','open_hat','rim','perc','tom','ride')
@lru_cache(maxsize=1)
def _catalog():
 data=json.loads(Path(__file__).with_name('genre_blueprint.json').read_text())['patterns'];out=[]
 for index,(desc,recipe) in enumerate(zip(data,RECIPES)):
  p=dict(length=desc['intended_steps'],division='1/16',gate=.65,swing=.57 if desc['genre']=='House' and desc['slot'] in (2,5,8,12) else .53 if desc['genre']=='Drum & Bass' else .5,steps=[[] for _ in range(desc['intended_steps'])])
  roles=[]
  for role,text in zip(RECIPE_ROLES,recipe):
   if text:roles.append(role)
   for start in map(int,text.split()):
    # Deliberate accents and soft ghosts, not randomized playback.
    velocity=(116 if role=='kick' else 105 if role in ('clap','snare') and start%8==4 else 66 if role=='snare' else 88 if role=='open_hat' else 86 if start%4==0 else 58+((start+index)%4)*7)
    p['steps'][start].append(dict(note=ROLES[role],velocity=velocity,tie=1))
  validate_pattern(p)
  item=dict(id=desc['id'],version=1,name=desc['name'],genre=desc['genre'],kind=desc['kind'],bpm=desc['suggested_bpm_range'],brief=desc['rhythm_brief'],device='drum_rack',category='drums',tags=[desc['kind'],'swing' if p['swing']>.5 else 'straight',str(p['length'])+' steps'],roles=roles,pattern=p)
  if desc['kind'] in DRUM_FX_ROLES:item['fx_role']=DRUM_FX_ROLES[desc['kind']]
  out.append(item)
 for b in range(1,5):
  for i,p in enumerate(factory_bank(b).values()):
   out.append(dict(id=f'existing.{b}.{i+1:02}',version=1,name=FACTORY_PATTERNS[b-1][i]['name'],genre='Classic' if b==4 else 'Existing',kind=['Bass','Chords','Arps','Hooks'][b-1],bpm=None,brief='Original factory '+str(b)+':'+str(i+1),device='synth',category=BANK_CATEGORY[b-1],tags=['Original',str(p['length'])+' steps'],roles=[],pattern=p))
 from .pattern_extras import melodies,effects
 for item in melodies()+effects(ROLES):validate_pattern(item['pattern']);out.append(item)
 from .pattern_more import more
 for item in more(ROLES):validate_pattern(item['pattern']);out.append(item)
 from .pattern_more2 import more2
 for item in more2(ROLES):validate_pattern(item['pattern']);out.append(item)
 return out

def catalog():return copy.deepcopy(_catalog())
def template(identity):
 found=next((p for p in _catalog() if p['id']==identity),None)
 if found is None:raise ValueError('Unknown factory template')
 return copy.deepcopy(found)

def kit_roles(track,rack):
 if track.get('device','synth')!='drum_rack':return {},{}
 patterns={'kick':r'kick|(?:^|[ _-])bd(?:$|[ _-])','snare':r'snare|(?:^|[ _-])sd(?:$|[ _-])','clap':r'clap|clp','rim':r'rim|stick','closed_hat':r'closed|close.*hat|(?:^|[ _-])ch(?:$|[ _-])','open_hat':r'open|(?:^|[ _-])oh(?:$|[ _-])','perc':r'perc|conga|bongo|cowbell','tom':r'tom','ride':r'ride','shaker':r'shaker|tamb','crash':r'crash|cymbal'}
 roles={};ready={};kit=track.get('drum_rack',{});solo=any(p['solo'] for p in kit.get('pads',[]))
 for role,pattern in patterns.items():
  candidates=[(i,p) for i,p in enumerate(kit.get('pads',[])) if re.search(pattern,p['name'],re.I)]
  # A loaded pad wins over an empty alternative; original pad order breaks ties.
  candidates.sort(key=lambda ip:rack.samples[ip[0]] is None)
  if candidates:
   i,p=candidates[0];roles[role]=p['note'];ready[role]=rack.samples[i] is not None and not p['mute'] and (not solo or p['solo'])
 return roles,ready

DRUM_BASE=36  # C2: Drum Rack pad 1

def resolve_pattern(item,track,rack):
 """Every library pattern is MIDI, so any track can use it.
 Melodic patterns on a Drum Rack play from C2 up (the lowest note's C lands on pad 1, notes keep their
 intervals). Drum patterns on a synth play their drum notes as pitches. Drum patterns on a Drum Rack
 are bound to the kit's own kick/snare/hat pads; roles
 the kit lacks (or has muted) still load."""
 device=track.get('device','synth')
 p=copy.deepcopy(item['pattern'])
 notes=[n for step in p['steps'] for n in step]
 if device=='drum_rack' and item['device']!='drum_rack':
  if notes:
   shift=DRUM_BASE-12*(min(n['note'] for n in notes)//12)
   for n in notes:n['note']=max(0,min(127,n['note']+shift))
  return validate_pattern(p)
 if device=='drum_rack':
  # Missing or muted roles never block loading: a role with no pad keeps its GM note, so the
  # notes are there once a sample lands on that note (or the pad is unmuted).
  roles,ready=kit_roles(track,rack)
  mapping={ROLES[r]:roles.get(r,ROLES[r]) for r in item['roles']}
  for step in p['steps']:
   for note in step:note['note']=mapping[note['note']]
 return validate_pattern(p)
def structures():
 """Factory Structures: library patterns in order, each with a repeat count."""
 from .pattern_more import structures as made
 from .pattern_more2 import structures as made2
 ids={p['id'] for p in _catalog()};out=made()+made2()
 for st in out:
  if any(i not in ids or not 1<=n<=16 for i,n in st['parts']):raise ValueError('Structure '+st['id']+' names an unknown pattern')
 return out
if __name__=='__main__':print(json.dumps(dict(version=1,templates=catalog(),structures=structures()),separators=(',',':')))
