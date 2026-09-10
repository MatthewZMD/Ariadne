from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'public/fog/images'
models=json.loads((ROOT/'public/fog/models.json').read_text())['assets']
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',22)
small=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16)
def sheet(items,cols,name):
 w=560;h=390;rows=(len(items)+cols-1)//cols
 canvas=Image.new('RGB',(w*cols,rows*h+86),'#eeede7');draw=ImageDraw.Draw(canvas)
 draw.text((28,24),'ARIADNE / FOG ASSETS',font=font,fill='#465040')
 draw.text((w*cols-280,30),'Actual glTF / Three.js renders',font=small,fill='#69715e')
 for i,(id,state) in enumerate(items):
  im=Image.open(OUT/f'{id}-{state}.png').convert('RGB');im.thumbnail((w-20,h-70))
  x=(i%cols)*w;y=(i//cols)*h+80
  canvas.paste(im,(x+(w-im.width)//2,y))
  draw.text((x+24,y+h-57),id.replace('structure-','').replace('marker-','').replace('-',' '),font=font,fill='#465040')
  draw.text((x+24,y+h-27),state,font=small,fill='#727867')
 canvas.save(OUT/name)
sheet([(a['id'],s) for a in models if a['category']=='structure' for s in ['dormant','awake']],2,'structures-contact-sheet.png')
sheet([(a['id'],'default') for a in models if a['category']!='structure'],3,'field-assets-contact-sheet.png')
print('Contact sheets written')
