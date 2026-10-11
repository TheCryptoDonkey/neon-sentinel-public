"""Compress native Blender plates; decoded sizes stay finite and documented."""
from pathlib import Path
import json
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[2]
out=ROOT/'public/models'
path=out/'alien-pickup-art-v3.json'
manifest=json.loads(path.read_text())
for kind,entry in manifest.items():
    with Image.open(ROOT/'art/bakes'/f'{kind}-v3.png') as source:
        width=384 if entry['glbBytes'] or kind=='troll' else 256
        image=source.resize((width,round(width*source.height/source.width)),Image.Resampling.LANCZOS)
        target=out/f'{kind}-v3.webp';image.save(target,'WEBP',quality=93,method=6,exact=True)
        entry.update(bakeWidth=image.width,bakeHeight=image.height,bakeBytes=target.stat().st_size)
path.write_text(json.dumps(manifest,indent=2)+'\n')
# Review sheet is source documentation, not an extra game texture.
sheet=Image.new('RGB',(1200,((len(manifest)+3)//4)*225),'#08111d')
draw=ImageDraw.Draw(sheet)
for i,kind in enumerate(manifest):
    image=Image.open(out/f'{kind}-v3.webp').convert('RGBA')
    image.thumbnail((275,185))
    x=(i%4)*300+(300-image.width)//2;y=(i//4)*225
    sheet.paste(image,(x,y+5),image)
    draw.text(((i%4)*300+12,y+201),kind,fill='#d5e9ed')
sheet.save(ROOT/'art/alien-pickup-review.png')
print(json.dumps(manifest,indent=2))
