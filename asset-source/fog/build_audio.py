"""Render original, seeded acoustic-style stems, not runtime oscillator presets.

All WAVs are mono PCM16 at 48 kHz. Periodic noise and wrapped event tails make
loops continuous without a fade-to-silence at the seam. No third-party samples.
"""
from pathlib import Path
import json, math, hashlib
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/fog/audio';OUT.mkdir(parents=True,exist_ok=True)
SR=48000
FAMILIES=json.loads((ROOT/'public/fog/models.json').read_text())['families']
records=[]

def rng_for(s):return np.random.default_rng(int.from_bytes(hashlib.sha256(s.encode()).digest()[:8],'little'))

def periodic_noise(n,low,high,rng):
 f=np.fft.rfftfreq(n,1/SR)
 power=(1/(1+(low/np.maximum(f,.01))**8))*(1/(1+(f/high)**8))
 spectrum=(rng.normal(size=len(f))+1j*rng.normal(size=len(f)))*np.sqrt(power)
 spectrum[0]=0
 x=np.fft.irfft(spectrum,n=n);return x/(np.std(x)+1e-12)

def envelop(x,attack=.015,release=.15):
 x=x.copy();a=min(int(attack*SR),len(x)//2);r=min(int(release*SR),len(x)//2)
 x[:a]*=np.sin(np.linspace(0,math.pi/2,a))**2
 x[-r:]*=np.cos(np.linspace(0,math.pi/2,r))**2
 return x

def note(family,hz,duration=2.8,seed='note'):
 n=int(SR*duration);t=np.arange(n)/SR;rng=rng_for(seed)
 partials={
 'bells':[(1,1),(2.756,.34),(5.404,.12),(8.933,.035)],
 'pages':[(1,.8),(2,.19),(3,.07)],
 'cairn':[(1,1),(1.503,.26),(2.31,.09),(3.71,.045)],
 'reeds':[(1,.8),(2,.2),(3,.09),(4,.04)],
 'instrument':[(1,1),(2,.3),(3,.14),(4,.065)],
 'glass':[(1,1),(2.32,.28),(4.25,.13),(6.63,.04)],
 'teaching':[(1,1),(2,.18),(3,.08)],
 }[family]
 x=np.zeros(n)
 for ratio,amp in partials:
  decay=1.1 if family in ('bells','glass','teaching') else .65
  phase=2*math.pi*hz*ratio*t + .006*np.sin(2*math.pi*3.7*t)
  x+=amp*np.sin(phase)*np.exp(-t/(decay/math.sqrt(ratio)))
 noise=periodic_noise(n,350,3600,rng)
 if family=='pages':x+=.13*noise*np.exp(-t/.22)*(1+.5*np.sin(2*math.pi*22*t))
 elif family in ('reeds','instrument'):x+=.075*noise*np.exp(-t/.7)
 elif family=='cairn':x+=.15*noise*np.exp(-t/.028)
 return envelop(x,.024 if family in ('reeds','instrument') else .008,.35)

def wrap_add(dst,src,start):
 ids=(np.arange(len(src))+int(start*SR))%len(dst)
 np.add.at(dst,ids,src)

def write(id,x,category,loop=False,family=None,events=None,hz=None,gain=1):
 x=x.astype(np.float64);x-=np.mean(x)
 # Stable reference headroom; renderer applies the bus mix listed in manifest.
 peak=max(float(np.max(np.abs(x))),1e-10);x=x/peak*.50
 wavfile.write(OUT/f'{id}.wav',SR,np.round(x*32767).astype(np.int16))
 records.append(dict(id=id,url=f'/fog/audio/{id}.wav',category=category,family=family,
  duration=round(len(x)/SR,5),sampleRate=SR,channels=1,format='PCM16 WAV',loop=loop,
  loopStart=0,loopEnd=round(len(x)/SR,5) if loop else None,
  events=events or [],noteHz=hz,recommendedGain=gain,
  peakDbFS=round(20*np.log10(max(np.max(np.abs(x)),1e-10)),2),
  rmsDbFS=round(20*np.log10(max(np.sqrt(np.mean(x*x)),1e-10)),2),
  seamDelta=round(float(abs(x[0]-x[-1])),6) if loop else None))

for family,meta in FAMILIES.items():
 notes=meta['notesHz'];base=notes[0]
 call=np.zeros(SR*16);events=[]
 # Single sparse calling identity. The completion reveals the full chord.
 for i,at in enumerate([.5,4.5,8.5,12.5]):
  frequency=base if i%2==0 else base*1.5
  wrap_add(call,note(family,frequency,3.5,f'{family}-call-{i}')*(1 if i%2==0 else .65),at)
  events.append({'time':at,'duration':1.3,'strength':1 if i%2==0 else .65})
 write(f'{family}-call',call,'call',True,family,events,gain=.32)
 for i,hz in enumerate(notes):
  write(f'{family}-element-{i+1:02}',note(family,hz,2.8,f'{family}-{i}'),'element',family=family,hz=hz,gain=.48)
 chord=np.zeros(SR*6)
 for i,hz in enumerate(notes):
  src=note(family,hz,5.5,f'{family}-chord-{i}')/math.sqrt(len(notes));start=int(i*.07*SR)
  chord[start:start+len(src)]+=src
 write(f'{family}-completion',envelop(chord,.045,.9),'completion',family=family,gain=.38)
 length=28;n=length*SR;t=np.arange(n)/SR;rng=rng_for(family+'air')
 bed=periodic_noise(n,90 if family=='instrument' else 220,1900,rng)*.045
 for i,hz in enumerate(notes):
  # Integer cycles in loop ensure continuous pitched components.
  f=round(hz*length)/length
  bed+=np.sin(2*math.pi*f*t+i)*(.09/(i+1))*(.55+.3*np.cos(2*math.pi*(i+1)*t/length))
 for i,at in enumerate([3.1,12.2,22.4]):wrap_add(bed,note(family,notes[i%len(notes)],4,f'{family}-awake-{i}')*.11,at)
 write(f'{family}-awake',bed,'awake',True,family,gain=.09)

for name,low,high,duration,gain in [('fog-low-wind',32,380,60,.055),('fog-grain-air',550,4200,60,.035),('off-graph-hush',45,240,30,.035),('terminus-water',130,1900,30,.09)]:
 n=duration*SR;t=np.arange(n)/SR;rng=rng_for(name)
 x=periodic_noise(n,low,high,rng)
 mod=.6+.17*np.sin(2*math.pi*3*t/duration)+.12*np.cos(2*math.pi*7*t/duration+.7)
 x*=mod
 if name=='fog-grain-air':x*=.8+.2*np.sin(2*math.pi*31*t/duration)
 if name=='terminus-water':
  for i in range(18):
   at=rng.uniform(0,duration);src=note('glass',rng.uniform(300,900),.65,str(i))*.055
   wrap_add(x,src,at)
 write(name,x,'environment',True,gain=gain)

for surface in ['ground','stone']:
 for i in range(6):
  n=int(SR*(.32+i*.018));t=np.arange(n)/SR;rng=rng_for(f'{surface}-{i}')
  x=periodic_noise(n,100,1700 if surface=='ground' else 4400,rng)
  env=np.exp(-t/(.045 if surface=='stone' else .075))
  x=x*env+.3*np.sin(2*math.pi*(90+i*6)*t)*np.exp(-t/.035)
  if surface=='ground':x+=periodic_noise(n,1200,5200,rng)*.15*np.exp(-((t-.08)/.045)**2)
  write(f'footstep-{surface}-{i+1:02}',envelop(x,.003,.12),'footstep',gain=.13)

t=np.arange(int(.3*SR))/SR
write('pulse',envelop(np.sin(2*math.pi*660*t)*np.exp(-t/.06),.012,.1),'pulse',gain=.08)
(OUT.parent/'audio.json').write_text(json.dumps({'schemaVersion':1,'sampleRate':SR,'provenance':'Original deterministic synthesis; no external recordings. Source: asset-source/fog/build_audio.py.','playback':'Set AudioBufferSourceNode.loopStart=0 and loopEnd=duration. Drive the visible call pulse from events on the same AudioContext clock. Load stems lazily. Recommended gains are starting mix values, not loudness normalization.','assets':records},indent=2)+'\n')
print(f'Rendered {len(records)} mono 48 kHz WAV assets')
