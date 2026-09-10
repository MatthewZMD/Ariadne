"""Write a complete machine-readable inventory with file hashes and honest status."""
from pathlib import Path
import json,hashlib
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'public/fog'
models=json.loads((BASE/'models.json').read_text());audio=json.loads((BASE/'audio.json').read_text());cues=json.loads((BASE/'cues.json').read_text())
files=[]
for p in sorted(BASE.rglob('*')):
 if p.is_file() and p.name!='manifest.json':
  b=p.read_bytes();files.append({'url':'/fog/'+str(p.relative_to(BASE)),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
manifest={'schemaVersion':1,'title':'Ariadne in fog','scope':'Production assets and local review scene; game integration is separate.',
 'models':'/fog/models.json','audio':'/fog/audio.json','cues':'/fog/cues.json',
 'titleImage':'/fog/images/ariadne-title-card.png','openGraphImage':'/fog/images/og.png',
 'counts':{'models':len(models['assets']),'structureStates':14,'soundFiles':len(audio['assets']),'voiceCuesAvailable':sum(bool(c['url']) for c in cues['assets']),'voiceCuesPlanned':len(cues['assets'])},
 'pending':[{'id':c['id'],'reason':'External speech generation requires approval.'} for c in cues['assets'] if not c['url']],
 'files':files,'totalBytes':sum(f['bytes'] for f in files)}
(BASE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'counts':manifest['counts'],'pending':len(manifest['pending']),'totalMiB':round(manifest['totalBytes']/1024**2,2)},indent=2))
