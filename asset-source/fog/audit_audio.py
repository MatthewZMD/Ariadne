from pathlib import Path
import json,hashlib
import numpy as np
from scipy.io import wavfile
ROOT=Path(__file__).resolve().parents[2]
data=json.loads((ROOT/'public/fog/audio.json').read_text());rows=[];hashes=set()
for a in data['assets']:
 p=ROOT/'public'/a['url'].lstrip('/');rate,x=wavfile.read(p);digest=hashlib.sha256(p.read_bytes()).hexdigest()
 f=x.astype(float)/32768;d=np.abs(np.diff(f));delta=abs(f[0]-f[-1]);limit=max(float(np.quantile(d,.999))*2,.0001)
 errors=[]
 if rate!=48000 or x.ndim!=1:errors.append('format')
 if abs(len(x)/rate-a['duration'])>1/rate:errors.append('duration')
 if np.max(np.abs(f))>=.999:errors.append('clipping')
 if not np.any(x):errors.append('silent')
 if digest in hashes:errors.append('duplicate')
 if a['loop'] and delta>limit:errors.append('seam discontinuity')
 hashes.add(digest);rows.append({'id':a['id'],'errors':errors,'sha256':digest,'seamDelta':delta if a['loop'] else None,'seamLimit':limit if a['loop'] else None})
report={'files':len(rows),'failed':sum(bool(r['errors']) for r in rows),'results':rows}
(ROOT/'asset-source/fog/audio-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'files':len(rows),'failed':report['failed'],'failures':[r for r in rows if r['errors']]}))
raise SystemExit(bool(report['failed']))
