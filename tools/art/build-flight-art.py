"""Editable complete flight models, material-batched GLBs and matching RGBA bakes.
Blender --background --python tools/art/build-flight-art.py
Local X is flight direction, XY is the play plane, Z is depth toward the viewer.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
MASTERS = ROOT/'art/blender'
OUT = ROOT/'public/models'
BAKES = ROOT/'art/bakes'
for path in (MASTERS, OUT, BAKES): path.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0

def material(name, color, metal=.65, rough=.32, emission=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
    p.inputs['Emission Color'].default_value=(*color,1); p.inputs['Emission Strength'].default_value=emission
    return m

def finish(o,name,m,bevel=0):
    o.name=name; o.data.materials.append(m)
    bpy.context.view_layer.objects.active=o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('machined radiused edges','BEVEL'); mod.width=bevel; mod.segments=2
        o.modifiers.new('face weighted normals','WEIGHTED_NORMAL')
    o.select_set(False)
    return o

def plate(name,pts,z,depth,m,bevel=.6):
    n=len(pts); verts=[(x,y,h) for h in (z-depth/2,z+depth/2) for x,y in pts]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o)
    return finish(o,name,m,bevel)

def box(name,pos,size,m,bevel=.4):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos)
    o=bpy.context.object;o.scale=size;return finish(o,name,m,bevel)

def loft(name,sections,m):
    # Eight-sided varying cross section gives a continuous sculpted fuselage.
    verts=[]
    for x,w,z,h in sections:
        for y,d in [(0,h),(w*.72,h*.72),(w,0),(w*.72,-h*.7),(0,-h),(-w*.72,-h*.7),(-w,0),(-w*.72,h*.72)]:
            verts.append((x,y,z+d))
    faces=[tuple(reversed(range(8))),tuple(range(len(verts)-8,len(verts)))]
    for j in range(len(sections)-1):
        faces += [(j*8+i,j*8+(i+1)%8,(j+1)*8+(i+1)%8,(j+1)*8+i) for i in range(8)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o)
    return finish(o,name,m,.8)

def cylinder(name,pos,r,depth,m,axis='X',r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=20,radius1=r,radius2=r if r2 is None else r2,depth=depth,location=pos,
        rotation=(0,math.pi/2,0) if axis=='X' else (0,0,0))
    return finish(bpy.context.object,name,m,.25)

def ship(kind,m):
    ceramic,dark,gold,glass,light=m
    heavy=kind=='heavy'; guardian=kind=='guardian'
    width=29 if heavy else 25 if guardian else 19
    loft('continuous pressure hull',[(-66,9,0,5),(-48,18,0,9),(-9,width,1,12),(24,17,2,10),(58,7,1,5),(80,1,0,1)],dark)
    for side in (-1,1):
        def points(p):return [(x,side*y) for x,y in (p if side>0 else list(reversed(p)))]
        wing=[(33,13),(7,width+10),(-39,width+27),(-60,width+22),(-27,14)]
        if heavy:wing=[(22,20),(16,53),(-37,58),(-59,44),(-28,19)]
        if guardian:wing=[(29,16),(3,48),(-31,51),(-56,35),(-25,18)]
        plate('swept wing subframe',points(wing),-2,7,dark)
        plate('independent wing ceramic',points([(x*.94,y*.91) for x,y in wing]),2,3,ceramic)
        plate('forward shoulder armour',points([(62,2),(30,15),(4,width-2),(-13,width-2),(-8,2)]),10,5,ceramic,1)
        plate('aft shoulder armour',points([(-12,2),(-17,width-2),(-42,19),(-57,8),(-37,2)]),8,5,ceramic,1)
        plate('gold leading edge',points([(17,width+7),(-36,width+23),(-43,width+21),(8,width+7)]),4,1.2,gold,.2)
        ey=side*(31 if heavy else 27 if guardian else 22)
        loft('engine armoured nacelle',[(-70,7,0,5),(-59,10,0,8),(-22,8,1,7),(-8,3,1,3)],dark).location.y=ey
        box('nacelle ceramic cap',(-41,ey,8),(27,11,3),ceramic,1)
        cylinder('titanium nozzle collar',(-68,ey,0),7.2,8,gold,r2=6)
        cylinder('recessed exhaust throat',(-73,ey,0),5.5,2,dark)
        cylinder('exhaust iris',(-74.2,ey,0),3.8,1,light)
        for i in range(5):box('engine heat exchanger',(-49+i*4,ey,10),(1.5,9,1.4),dark,.12)
        for i in range(3):box('shoulder service slit',(-19+i*6,side*(width-5),13),(3,1.2,.8),dark,.1)
        cannonY=side*(37 if heavy else 16)
        cylinder('weapon sleeve',(heavy*9+36,cannonY,4),3.8 if heavy else 2.2,26 if heavy else 18,dark)
        cylinder('weapon muzzle',(heavy*9+50,cannonY,4),3 if heavy else 1.8,3,gold)
        cylinder('weapon bore',(heavy*9+52,cannonY,4),1.6,1,dark)
        box('wing navigation lens',(-42,side*(width+21),4),(5,2,1),light,.2)
    loft('canopy pressure gasket',[(-9,8,14,2),(2,10,14,3),(28,7,12,3),(39,2,9,1)],dark)
    loft('smoked laminated canopy',[(-7,6,17,2),(4,8,18,5),(25,5.8,15,4),(35,1,11,1)],glass)
    box('canopy central frame',(12,0,23),(25,.8,1.2),gold,.2)
    plate('dorsal spine',[(-54,-3),(-27,-4),(-13,-2),(-13,2),(-27,4),(-54,3)],14,3,ceramic)
    for i in range(5):box('spine radiator',(-45+i*5,0,16),(1.5,5,1),dark,.15)
    plate('nose sensor ceramic',[(78,0),(55,-6),(41,-4),(41,4),(55,6)],7,3,ceramic)
    box('nose optical rail',(59,0,9),(15,1.2,1),light,.2)
    if guardian:
        for side in (-1,1):
            box('shield emitter housing',(-7,side*40,6),(20,5,4),gold,.7)
            box('shield emitter aperture',(-7,side*40,8.5),(16,2,1),light,.2)
    if heavy:
        box('armoured reactor cover',(-19,0,20),(19,18,5),gold,1.4)
        for i in range(4):box('reactor cooling groove',(-25+i*4,0,23),(1.2,14,1),dark,.1)

def carrier(m):
    armour,dark,gold,glass,light=m
    loft('carrier structural keel',[(-137,25,0,9),(-105,46,0,17),(-35,50,0,18),(66,38,0,13),(125,22,0,9),(143,4,0,3)],dark)
    for side in (-1,1):
        def pts(p):return [(x,side*y) for x,y in (p if side>0 else list(reversed(p)))]
        plate('flank armoured sponson',pts([(-121,30),(-97,60),(52,57),(122,27),(96,21),(-70,24)]),2,18,armour,2)
        for i in range(5):
            x=-91+i*37
            plate('separated deck armour',pts([(x,5),(x+32,5),(x+31,33),(x+5,39)]),20,7,armour,1)
            box('deck service rail',(x+15,side*23,24),(20,2,1),gold,.2)
            for j in range(3):box('recessed radiator',(x+8+j*6,side*34,25),(3,7,1),dark,.1)
        # Sunken hangar mouths stay black, outlined with small navigation lamps.
        for i in range(3):
            x=-65+i*47
            box('hangar aperture',(x,side*52,13),(32,9,6),dark,.8)
            box('hangar lintel',(x,side*56,18),(33,2,2),gold,.3)
            for end in (-1,1):box('hangar guide lamp',(x+end*14,side*57,15),(2,2,3),light,.2)
        for i in range(3):
            x=-49+i*50
            cylinder('broadside turret plinth',(x,side*42,26),9,5,dark,axis='Z')
            box('armoured turret',(x+2,side*42,31),(15,12,7),armour,1.4)
            for yy in (-3,3):
                cylinder('twin railgun barrel',(x+15,side*42+yy,32),1.5,19,gold)
                cylinder('railgun recessed bore',(x+25,side*42+yy,32),.8,1,dark)
        ey=side*33
        loft('drive nacelle',[(-139,11,0,8),(-116,16,0,12),(-78,11,0,10)],dark).location.y=ey
        cylinder('drive nozzle shroud',(-141,ey,0),11,8,gold,r2=9)
        cylinder('drive well',(-146,ey,0),8,2,dark)
        cylinder('drive plasma lens',(-147,ey,0),5.5,1,light)
        plate('forward ram ceramic',pts([(142,2),(124,22),(86,31),(88,14),(119,2)]),12,6,armour,1)
    box('central command citadel',(-27,0,31),(59,23,20),dark,3)
    plate('citadel armour',[(-56,-14),(-8,-14),(9,-6),(9,6),(-8,14),(-56,14)],43,5,armour,1)
    box('bridge panoramic glass',(-7,0,45),(14,20,3),glass,.7)
    box('bridge sensor mast',(-35,0,50),(3,3,12),gold,.4)
    box('sensor crossbar',(-35,0,57),(3,19,2),dark,.3)
    box('longitudinal reactor trench',(48,0,22),(93,7,4),dark,.8)
    for i in range(7):box('reactor status segment',(13+i*12,0,25),(7,2,1),light,.2)
    for yy in (-12,0,12):
        cylinder('forward barrage socket',(117,yy,15),4,17,dark)
        cylinder('forward barrage emitter',(127,yy,15),2,1,light)

def build_flight_art():
    manifest={}
    for kind in ('interceptor','guardian','heavy','carrier'):
        bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
        isboss=kind=='carrier'
        ceramic=material('armour',(.24,.055,.085) if isboss else (.57,.66,.70) if kind=='heavy' else (.70,.78,.81),.48,.32)
        dark=material('structure',(.019,.025,.034),.72,.38)
        gold=material('alloy',(.47,.30,.12) if not isboss else (.39,.25,.17),.8,.28)
        glass=material('glass',(.018,.12,.16) if not isboss else (.055,.009,.019),.55,.16,.08)
        accent=(.9,.04,.13) if isboss else (.95,.32,.07) if kind=='heavy' else (.13,.8,.48) if kind=='guardian' else (.09,.64,.8)
        light=material('signal',accent,.25,.23,1.3)
        (carrier if isboss else lambda m:ship(kind,m))((ceramic,dark,gold,glass,light))
        meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
        for o in meshes:
            bpy.context.view_layer.objects.active=o;o.select_set(True)
            for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
            o.select_set(False)
        tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
        # Export only mesh parts; lights/camera belong to the editable bake scene.
        for o in meshes:o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(OUT/f'{kind}-v2.glb'),export_format='GLB',use_selection=True,export_yup=True)
        bpy.ops.object.select_all(action='DESELECT')
        scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
        scene.render.resolution_x=1024 if isboss else 768;scene.render.resolution_y=512
        scene.render.resolution_percentage=100;scene.render.film_transparent=True
        scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
        scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.16,.20,1)
        scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
        extent=320 if isboss else 190
        bpy.ops.object.camera_add(location=(0,-extent*.32,extent*1.8))
        cam=bpy.context.object;cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler()
        cam.data.type='ORTHO';cam.data.ortho_scale=extent;scene.camera=cam
        for pos,energy,color,size in [((-100,-80,160),650000,(.78,.88,1),110),((65,95,120),500000,(1,.82,.62),90),((130,-10,80),180000,(.3,.65,1),80)]:
            bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.data.energy=energy;o.data.color=color;o.data.size=size
            o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(BAKES/f'{kind}-v2.png')
        bpy.ops.wm.save_as_mainfile(filepath=str(MASTERS/f'{kind}.blend'))
        bpy.ops.render.render(write_still=True)
        manifest[kind]={'triangles':tris,'authoringParts':len(meshes),'batches':5,'glbBytes':(OUT/f'{kind}-v2.glb').stat().st_size,'bakeWidth':scene.render.resolution_x,'bakeHeight':512,'logicalWidth':extent}
        print('FLIGHT ART',kind,manifest[kind],flush=True)
    (OUT/'flight-art-v2.json').write_text(json.dumps(manifest,indent=2)+'\n')

if __name__ == '__main__': build_flight_art()
