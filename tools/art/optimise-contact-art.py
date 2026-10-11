"""Package the native 256px Blender neutral lighting plate."""
from pathlib import Path
import json
from PIL import Image
ROOT = Path(__file__).resolve().parents[2]
target = ROOT / 'public/models/contact-light-v1.webp'
with Image.open(ROOT / 'art/bakes/contact-light-v1.png') as source:
    source.save(target, 'WEBP', quality=93, method=6, exact=True)
manifest_path = ROOT / 'public/models/contact-art-v1.json'
manifest = json.loads(manifest_path.read_text())
manifest['bakeBytes'] = target.stat().st_size
manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps(manifest, indent=2))
