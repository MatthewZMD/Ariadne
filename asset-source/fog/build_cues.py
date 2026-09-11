"""Generate only revised cues using the repository's existing Ariadne voice.
Credentials are read locally and never printed or written into manifests.
Existing recordings are retained in the canonical field cue directory.
"""
import os,json,time,urllib.request,urllib.error,subprocess,shutil,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'public/fog/cues';OUT.mkdir(parents=True,exist_ok=True)
prepare='--prepare' in sys.argv
env={} if prepare else dict(os.environ)
for line in ([] if prepare else (ROOT/'.dev.vars').read_text().splitlines()):
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1);env.setdefault(k.strip(),v.strip().strip('"').strip("'"))
key=env.get('OPENROUTER_API_KEY')
voice=env.get('OPENROUTER_TTS_VOICE','933563129e564b19a115bedd57b7406a')
manifest_path=OUT.parent/'cues.json'
manifest=json.loads(manifest_path.read_text())
voice=env.get('OPENROUTER_TTS_VOICE',manifest['voice'])
rows=[]
for existing in manifest['assets']:
 id,text=existing['id'],existing['text']
 target=OUT/f'{id}.mp3';status='generated' if target.exists() else 'pending';model=None
 if not target.exists() and key:
  for candidate in ['fish-audio/s2.1-pro-free:free','fish-audio/s2.1-pro']:
   data=json.dumps({'model':candidate,'input':'[warm, attentive, natural conversational voice; calmly confident, without theatrical emphasis] '+text,'voice':voice,'response_format':'mp3'}).encode()
   req=urllib.request.Request('https://openrouter.ai/api/v1/audio/speech',data=data,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json','X-Title':'Ariadne fog assets'})
   try:
    with urllib.request.urlopen(req,timeout=55) as response:
     audio=response.read(8*1024*1024)
     if not response.headers.get('Content-Type','').startswith('audio/') or len(audio)<200:raise ValueError('Invalid audio response')
    target.write_bytes(audio);status='generated';model=candidate;break
   except urllib.error.HTTPError as e:
    print(id,'provider HTTP',e.code,flush=True)
    if e.code not in (429,500,502,503,504):break
   except Exception as e:
    print(id,type(e).__name__,flush=True);break
  time.sleep(.2)
 rows.append({'id':id,'text':text,'url':f'/fog/cues/{id}.mp3' if target.exists() else None,'status':status,'model':model})
 print(id,status,flush=True)
 (OUT.parent/'cues.json').write_text(json.dumps({**manifest,'voice':voice,'assets':rows},indent=2)+'\n')
(OUT.parent/'cues.json').write_text(json.dumps({**manifest,'voice':voice,'assets':rows},indent=2)+'\n')
print('Cues available:',sum(x['url'] is not None for x in rows),'/',len(rows))
