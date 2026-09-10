"""Local asset-only review server; does not start or modify the game."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit,unquote
import json,base64,re

ROOT=Path(__file__).resolve().parents[2]
class Handler(SimpleHTTPRequestHandler):
 def do_POST(self):
  # The local review page can write rendered PNGs only to its image folder.
  if self.path!='/__asset_render' or self.headers.get('Origin') not in ('http://localhost:4178','http://127.0.0.1:4178'):
   self.send_error(403);return
  length=int(self.headers.get('Content-Length','0'))
  if length<1 or length>16*1024*1024:self.send_error(413);return
  data=json.loads(self.rfile.read(length));name=data.get('name','')
  if not re.fullmatch(r'[a-z0-9-]+\.png',name):self.send_error(400);return
  encoded=data.get('data','').removeprefix('data:image/png;base64,');blob=base64.b64decode(encoded,validate=True)
  if not blob.startswith(b'\x89PNG\r\n\x1a\n'):self.send_error(400);return
  (ROOT/'public/fog/images'/name).write_bytes(blob)
  self.send_response(204);self.end_headers()
 def translate_path(self,path):
  path=unquote(urlsplit(path).path)
  base=ROOT/'asset-source/tools/node_modules' if path.startswith('/tools/') else ROOT/'public'
  tail=path.removeprefix('/tools/') if path.startswith('/tools/') else path.lstrip('/')
  resolved=(base/tail).resolve()
  return str(resolved if resolved.is_relative_to(base.resolve()) else base/'missing')
 def end_headers(self):
  self.send_header('Cache-Control','no-store');super().end_headers()
 def log_message(self,*args):pass

print('Asset review: http://localhost:4178/fog/review.html',flush=True)
ThreadingHTTPServer(('127.0.0.1',4178),Handler).serve_forever()
