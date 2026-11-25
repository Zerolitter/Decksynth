"""Strike card (24 Nov): the first moments of a note, which is where real instruments differ most.

  Damping   the upper partials die faster than the fundamental (strings, keys, plucks, bells): a gentle
            low-pass per voice that starts wide open and closes towards a few partials above the note.
  Noise     a short band-passed noise burst at the start of each note (a pick, a hammer, breath).
  Pitch     the note starts up to two octaves away and falls (or rises) to its pitch (808 bass, toms, zaps).

All three are 0 by default, and at 0 a voice renders exactly as before. The voice itself is rendered by the
usual kernels (dsfx_voice, dsfx_voice3); a falling pitch is rendered in 32-sample slices with their own pitch,
and damping and noise run after the voice in dsfx_strike, with strike_py as the Python twin."""
import ctypes as C
import math

STRIKE_DEFAULTS=dict(damp=0.,noise=0.,noise_on=1,noise_decay=.03,noise_tone=.6,pitch_env=0.,pitch_decay=.06)
# noise_on (25 Nov, Sir): the Strike view's Noise switch. Off silences the burst and keeps its knobs; a missing key is On, so
# old songs sound the same. Presets load with it Off unless Settings › "Load presets with Strike noise" is on (Engine.apply_preset).
STRIKE_CHOICES=dict(noise_on=(0,1))
STRIKE_RANGES=dict(damp=(0,1),noise=(0,1),noise_decay=(.002,1),noise_tone=(0,1),pitch_env=(-24,24),pitch_decay=(.005,1))
SLICE=32
STATE=9

class DsStrike(C.Structure):
    _fields_=[('f0',C.c_double),('rate',C.c_double),('tau',C.c_double),('lo',C.c_double),('hi',C.c_double),
              ('noise',C.c_double),('ndecay',C.c_double),('nfc',C.c_double),('gain',C.c_double)]

_kernel=None
_tried=False
def kernel():
    global _kernel,_tried
    if not _tried:
        _tried=True
        from . import filter_native
        filter_native.prepare_kernel()
        lib=filter_native._library
        try:
            k=lib.dsfx_strike;D=C.POINTER(C.c_double)
            k.argtypes=[D,D,C.c_int,D,C.POINTER(DsStrike)];k.restype=None;_kernel=k
        except AttributeError:_kernel=None
    return _kernel

def noise(p):return p.get('noise',0.) if p.get('noise_on',1) else 0.
def active(p):return p.get('damp',0.)>0 or noise(p)>0 or bool(p.get('pitch_env',0.))
def strikes(p):return p.get('damp',0.)>0 or noise(p)>0

def slices(p,age,frames,rate):
    """(offset, frames, pitch factor) for one block of a voice that is `age` samples old. One slice once the
    pitch has settled (within 0.01 semitone)."""
    amt=p.get('pitch_env',0.)
    if not amt:return ((0,frames,1.),)
    dec=max(.005,p.get('pitch_decay',.06))*rate; end=dec*math.log(max(1.0001,abs(amt)/.01))
    if age>=end:return ((0,frames,1.),)
    out=[];off=0
    while off<frames:
        t=age+off
        if t>=end:out.append((off,frames-off,1.));break
        n=min(SLICE,frames-off);out.append((off,n,2**(amt*math.exp(-(t+n/2)/dec)/12)));off+=n
    return out

def block_factor(p,age,frames,rate):
    """One pitch factor for a whole block (the Python fallback loops)."""
    amt=p.get('pitch_env',0.)
    if not amt:return 1.
    dec=max(.005,p.get('pitch_decay',.06))*rate
    return 2**(amt*math.exp(-(age+frames/2)/dec)/12)

def settings(p,note,gain,rate,args=None):
    """dsfx_strike arguments for one voice."""
    e=args if args is not None else DsStrike()
    f0=440*2**((note-69)/12)*2**(p.get('pitch',0)/12); damp=p.get('damp',0.)
    e.f0=f0;e.rate=float(rate)
    # 0: off. A touch: about 3 s for the top to fade; full: about 40 ms. Higher notes fade sooner, as on a piano.
    e.tau=(.04+3.*(1-damp)**2)*(261.63/f0)**.35*rate if damp>0 else 0.
    e.lo=1.6-damp*.6;e.hi=7.
    e.noise=noise(p)*2.4;e.ndecay=max(.002,p.get('noise_decay',.03))*rate
    e.nfc=300*40**p.get('noise_tone',.6)*2**((note-60)/24);e.gain=gain
    return e

def initial_state(age):
    return [float(age),float(0x9e3779b9),0.,0.,0.,0.,1.,0.,0.]

def strike_py(out,src,n,st,e):
    """Python twin of dsfx_strike (dsfx.c). Keep the two in step."""
    age=st[0];rng=int(st[1])&0xffffffff or 0x9e3779b9
    l1,l2,b1,b2,a1,a2,a3=st[2:9];nyq=.45*e.rate
    ng=na1=na2=na3=nd=0.;nk=1.2
    if e.noise>0 and e.ndecay>0:
        fc=min(nyq,max(20,e.nfc));g=math.tan(math.pi*fc/e.rate)
        na1=1/(1+g*(g+nk));na2=g*na1;na3=g*na2
        nd=math.exp(-1/e.ndecay);ng=e.noise*e.gain*math.exp(-age/e.ndecay)
        if age>e.ndecay*12:ng=0.
    for i in range(n):
        s=src[i]
        if e.tau>0:
            if (i&15)==0 or age==0:
                fc=min(nyq,max(20,e.f0*2**(e.lo+(e.hi-e.lo)*math.exp(-age/e.tau))))
                g=math.tan(math.pi*fc/e.rate);a1=1/(1+g*(g+1.4142));a2=g*a1;a3=g*a2
            v3=s-l2;v1=a1*l1+a2*v3;v2=l2+a2*l1+a3*v3
            l1=2*v1-l1;l2=2*v2-l2;s=v2
        if ng>1e-7:
            rng^=(rng<<13)&0xffffffff;rng^=rng>>17;rng^=(rng<<5)&0xffffffff
            w=rng/2147483648.0-1
            v3=w-b2;v1=na1*b1+na2*v3;v2=b2+na2*b1+na3*v3
            b1=2*v1-b1;b2=2*v2-b2
            s+=ng*nk*v1;ng*=nd
        out[i]+=s;age+=1
    st[0:9]=[age,float(rng),l1,l2,b1,b2,a1,a2,a3]

def at(buf,offset):
    """A double* into a ctypes buffer `offset` samples in."""
    if not offset:return buf
    return C.cast(C.addressof(buf)+8*offset,C.POINTER(C.c_double))
