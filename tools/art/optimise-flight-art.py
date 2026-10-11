"""Package Blender RGBA renders as bounded-size WebP game textures (Pillow)."""
from pathlib import Path
import json
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
out=ROOT/'public/models'
manifest=json.loads((out/'flight-art-v2.json').read_text())
for kind,entry in manifest.items():
    width=768 if kind=='carrier' else 512
    with Image.open(ROOT/'art/bakes'/f'{kind}-v2.png') as source:
        image=source.resize((width,round(width*source.height/source.width)),Image.Resampling.LANCZOS)
        target=out/f'{kind}-v2.webp'
        image.save(target,'WEBP',quality=93,method=6,exact=True)
        entry.update(bakeWidth=image.width,bakeHeight=image.height,bakeBytes=target.stat().st_size)
(out/'flight-art-v2.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
