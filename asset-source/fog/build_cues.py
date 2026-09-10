"""Generate only revised cues using the repository's existing Ariadne voice.
Credentials are read locally and never printed or written into manifests.
Existing compatible recordings are copied byte-for-byte; the old game is intact.
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
keep={
 'look-over-there':'Oh, look over there!', 'did-you-see-that':'Wait—did you see that?',
 'changed-because-of-you':'It changed because of you!', 'my-fault':'Wait. That was my fault.',
 'got-that-wrong':'Oh no—I got that wrong.', 'apology':'I’m sorry. I was so sure.',
 'you-came-back':'You came back.', 'together-again':'We’re together again.',
 'there-you-are':'There you are!', 'choosing-this-one':'I’m choosing this one!',
 'this-way':'This way. Come on!',
}
new={
 'over-here':'Over here!', 'look-at-that':'Look at that!',
 'look-what-you-did':'Look what you did!', 'we-got-it':'We got it!',
 'passage-ends-here':'The way ends here.', 'dead-end':'It stops.',
 'nowhere-forward':"I can’t hear it from here.", 'found-one':'There it is.',
 'woke-the-room':'It cleared.', 'a-star':'Another one, listen.',
 'opening-premise':'You can hear that? I can tell where it’s coming from. This way.',
 'getting-louder':'It’s getting louder.', 'fading':'It’s fading.',
 'been-here':'We’ve been here.', 'come-with-you':'I’ll come with you.',
 'resume':'— so, as I was saying',
 'clearing-promise':'It cleared. There are more of them. Each one clears a little; enough of them and we’ll see the whole of it. I can already hear the next one.',
 'teaching-approach':'Come a little closer to the low bell.',
 'teaching-look':'Look at the page. Stay with it for a moment.',
 'teaching-listen':'Now be still and listen to the hanging bell.',
}
rows=[]
for id,text in keep.items():
 shutil.copyfile(ROOT/f'public/audio/ariadne-cues/{id}.mp3',OUT/f'{id}.mp3')
 rows.append({'id':id,'text':text,'url':f'/fog/cues/{id}.mp3','status':'reused','source':f'/audio/ariadne-cues/{id}.mp3'})
for id,text in new.items():
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
 (OUT.parent/'cues.json').write_text(json.dumps({'schemaVersion':1,'voice':voice,'participantAddress':'you','assets':rows},indent=2)+'\n')
(OUT.parent/'cues.json').write_text(json.dumps({'schemaVersion':1,'voice':voice,'participantAddress':'you','assets':rows},indent=2)+'\n')
print('Cues available:',sum(x['url'] is not None for x in rows),'/',len(rows))
