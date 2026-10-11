"""One shared portrait-UV sphere and neutral lighting bake for dynamic contacts.
Run Blender --background --python tools/art/build-contact-art.py.
Portraits remain runtime profile data; no user's avatar is packed into the asset.
"""
import bpy, math, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models'
MASTER = ROOT / 'art/blender'
BAKES = ROOT / 'art/bakes'
for folder in (OUT, MASTER, BAKES): folder.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, radius=21)
sphere = bpy.context.object
sphere.name = 'contact-portrait-sphere'
for polygon in sphere.data.polygons: polygon.use_smooth = True
# Both hemispheres carry an upright portrait. Angular mapping curves the
# picture around the surface rather than attaching a flat face disc.
uv = sphere.data.uv_layers.active
uv.name = 'PortraitAngular'
for loop in sphere.data.loops:
    x, y, z = sphere.data.vertices[loop.vertex_index].co
    uv.data[loop.index].uv = (.5 + math.atan2(x, abs(y)) / math.pi,
                             .5 + math.asin(max(-1, min(1, z / 21))) / math.pi)
mat = bpy.data.materials.new('neutral-contact-ceramic')
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value = (.8, .8, .8, 1)
bsdf.inputs['Roughness'].default_value = .3
bsdf.inputs['Metallic'].default_value = .04
sphere.data.materials.append(mat)
bpy.ops.export_scene.gltf(filepath=str(OUT / 'contact-sphere-v1.glb'),
                          export_format='GLB', use_selection=True, export_yup=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = 256
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.1, .1, .1, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .45
bpy.ops.object.camera_add(location=(0, -100, 0))
camera = bpy.context.object
camera.rotation_euler = (-camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 42
scene.camera = camera
for position, energy, size in [((-38, -52, 48), 18000, 28), ((30, -12, -15), 500, 25)]:
    bpy.ops.object.light_add(type='AREA', location=position)
    light = bpy.context.object
    light.data.energy = energy
    light.data.size = size
    light.rotation_euler = (-light.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = str(BAKES / 'contact-light-v1.png')
bpy.ops.wm.save_as_mainfile(filepath=str(MASTER / 'contact-sphere.blend'))
bpy.ops.render.render(write_still=True)
manifest = {'triangles': sum(len(p.vertices)-2 for p in sphere.data.polygons),
            'radius': 21, 'uv': 'upright angular portrait on both hemispheres',
            'batches': 1, 'bakeWidth': 256, 'bakeHeight': 256,
            'glbBytes': (OUT / 'contact-sphere-v1.glb').stat().st_size}
(OUT / 'contact-art-v1.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('CONTACT ART', manifest, flush=True)
