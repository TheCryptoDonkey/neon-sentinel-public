"""Neon Sentinel alien fleet and reward sculptures. Blender 5.x, no add-ons.
Keep editable masters; render all lighting offline for cheap identical pickups.
Blender --background --python tools/art/build-alien-pickup-art.py
"""
import sys, math, json
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from importlib import import_module
a=import_module('build-flight-art')
bpy=a.bpy
ROOT=a.ROOT
OUT=ROOT/'public/models'
ENEMIES=('abductor','hunter','jammer','forgery','spammer','sybil','troll')
PICKUPS=('rose','cake-piece','whole-cake','600b','life','shield','relay','charge','zap','net','cult','fourtwenty','scooter','multi','timelock')

def orb(name,pos,size,m):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=pos)
    o=bpy.context.object;o.scale=size
    a.finish(o,name,m)
    for p in o.data.polygons:p.use_smooth=True
    return o

def ring(name,pos,r,tube,m):
    bpy.ops.mesh.primitive_torus_add(major_segments=40,minor_segments=8,location=pos,major_radius=r,minor_radius=tube)
    return a.finish(bpy.context.object,name,m)

def rod(name,p1,p2,r,m):
    start=a.Vector(p1);end=a.Vector(p2);delta=end-start
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=r,depth=delta.length,location=(start+end)*.5)
    o=bpy.context.object;o.rotation_euler=delta.to_track_quat('Z','Y').to_euler()
    return a.finish(o,name,m,.15)

def lettering(text,pos,size,m):
    curve=bpy.data.curves.new('engraved '+text,'FONT');curve.body=text;curve.align_x='CENTER';curve.align_y='CENTER'
    curve.size=size;curve.extrude=.18;curve.bevel_depth=.06
    o=bpy.data.objects.new('engraved '+text,curve);bpy.context.collection.objects.link(o);o.location=pos;o.data.materials.append(m)
    bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)

def plate(name,points,z,depth,m,bevel=.5):
    # Uniform outward normals also prevent concave bevel faces folding inward.
    area=sum(points[i][0]*points[(i+1)%len(points)][1]-points[(i+1)%len(points)][0]*points[i][1] for i in range(len(points)))
    return a.plate(name,points if area>0 else list(reversed(points)),z,depth,m,bevel)

def alien(kind,m):
    armour,dark,metal,glass,signal=m
    if kind=='troll':
        # The established corrupt donkey banker, now a sculpted mascot. This
        # family uses its bake in both tiers so the face never shows its back.
        orb('bulky pinstripe suit',(-9,-10,0),(34,29,13),dark)
        orb('donkey head',(17,10,5),(22,22,15),armour)
        orb('pale projecting muzzle',(35,1,16),(17,11,7),metal)
        for x in (-6,29):
            ear=orb('long donkey ear',(x,40,4),(6,23,5),armour);ear.rotation_euler.z=(-.18 if x<0 else .18)
            orb('ear inner leather',(x,43,8),(3,17,2),glass)
        for x in (19,34):orb('nostril',(x+12,4,22),(2,2,1),dark)
        for x in (12,29):
            orb('corrupted green eye',(x,15,19),(3.3,3.5,1.5),signal)
        ring('banker monocle',(29,15,21),6,1,metal)
        rod('monocle chain',(34,11,20),(30,-2,19),.65,metal)
        a.box('top hat brim',(9,34,18),(29,5,13),dark,1.8)
        a.box('top hat crown',(9,42,18),(20,16,12),dark,2)
        a.box('gold hat ribbon',(9,37,25),(21,3,1),metal,.3)
        rod('cigar',(43,-6,20),(62,-10,20),2.5,metal)
        orb('cigar ember',(62,-10,20),(2.5,2.5,2.5),signal)
        for x in (-29,-18,-7,4):rod('suit pinstripe',(x,-29,12),(x+5,5,14),.6,metal)
        plate('lapel left',[(-18,9),(-6,-14),(-2,7)],15,1.5,armour)
        plate('lapel right',[(4,5),(0,-17),(18,1)],15,1.5,armour)
        return
    if kind=='abductor':
        # Crab-like saucer: separated crescent claws and visible tractor iris.
        orb('lenticular pressure shell',(-6,0,0),(39,24,10),dark)
        for side in (-1,1):
            pts=[(-41,side*9),(-31,side*32),(10,side*37),(39,side*20),(46,side*7),(29,side*13),(3,side*21),(-22,side*18)]
            if side<0:pts.reverse()
            plate('curved capture mandible',pts,5,8,armour,1)
            rod('claw alloy edge',(-23,side*29,10),(18,side*28,10),1.3,metal)
            orb('capture claw lens',(38,side*14,10),(4,3,2),signal)
        ring('tractor iris collar',(8,0,12),12,2.5,metal)
        a.cylinder('tractor iris black well',(8,0,12),10,3,dark,axis='Z')
        a.cylinder('tractor optical core',(8,0,14),6,1,glass,axis='Z')
        for i in range(6):
            ang=i*math.tau/6
            a.box('iris actuator',(8+math.cos(ang)*15,math.sin(ang)*15,11),(3,3,2),signal,.4)
    elif kind=='hunter':
        a.loft('needle interceptor',[(-51,6,0,4),(-32,14,0,9),(4,12,0,8),(41,4,0,3),(64,.7,0,.7)],dark)
        for side in (-1,1):
            pts=[(34,side*5),(-13,side*17),(-45,side*33),(-34,side*10)]
            if side<0:pts.reverse()
            plate('scythe ceramic blade',pts,5,5,armour,1)
            rod('blade metallic leading seam',(13,side*10,9),(-37,side*27,9),1.1,metal)
            a.cylinder('long pursuit cannon',(27,side*11,6),2.4,35,metal)
            a.cylinder('gun bore',(45,side*11,6),1.4,1,dark)
            a.cylinder('afterburner',(-46,side*10,0),4.5,10,dark)
            a.cylinder('afterburner lens',(-52,side*10,0),3,1,signal)
        a.loft('insect canopy',[(-16,5,9,3),(4,6,11,4),(24,2,7,2)],glass)
        for i in range(5):a.box('spine radiator',(-26+i*4,0,12),(1.2,7,1.5),metal,.1)
    elif kind=='jammer':
        a.loft('broadcast spindle',[(-43,8,0,6),(-20,18,0,13),(12,16,0,12),(37,5,0,4)],dark)
        for side in (-1,1):
            plate('manta wing',[(-27,side*10),(-6,side*47),(19,side*46),(29,side*15)],2,6,armour,1)
            for i in range(4):a.box('wing waveguide',(-6+i*7,side*32,7),(2,20,2),metal,.3)
            ring('resonator collar',(8,side*36,11),9,1.8,metal)
            orb('resonator sapphire',(8,side*36,11),(7,7,4),glass)
            a.cylinder('resonator eye',(8,side*36,16),2.5,1,signal,axis='Z')
        ring('broadcast halo',(-4,0,20),14,2,metal)
        orb('broadcast core',(-4,0,17),(10,10,7),glass)
    elif kind=='forgery':
        # Deliberately asymmetric stolen ceramic armour on a violet skeleton.
        a.loft('counterfeit spindle',[(-42,7,0,5),(-13,23,0,10),(24,12,0,8),(48,2,0,2)],dark)
        plate('stolen white wing',[(27,5),(-7,30),(-39,35),(-23,9)],5,6,metal,1)
        plate('violet false wing',[(29,-7),(-2,-30),(-39,-24),(-20,-7)],5,7,armour,1)
        for side in (-1,1):
            a.cylinder('identity projector',(6,side*18,10),5,5,glass,axis='Z')
            rod('false antenna',(-25,side*12,10),(-48,side*25,10),1.5,metal)
            orb('spoof terminal',(-48,side*25,10),(3,3,3),signal)
        ring('stolen identity bezel',(0,0,16),13,2,metal)
        a.cylinder('identity screen',(0,0,15),11,2,glass,axis='Z')
        plate('split nose plate',[(44,1),(22,-9),(11,-5),(18,3)],11,3,armour)
    elif kind=='spammer':
        a.loft('armoured packet freighter',[(-44,17,0,8),(-27,24,0,12),(19,24,0,12),(39,9,0,5)],dark)
        for side in (-1,1):
            a.box('payload magazine',(-5,side*23,7),(56,16,14),armour,2)
            for i in range(4):
                x=-24+i*13
                a.box('magazine segmented lid',(x,side*24,15),(10,13,2),metal,.6)
                a.box('packet status lamp',(x,side*24,17),(6,2,1),signal,.15)
            a.cylinder('payload drum',(-32,side*17,1),7,10,dark)
            a.cylinder('payload ejection aperture',(33,side*20,4),5,8,metal)
            a.cylinder('ejection well',(38,side*20,4),3.4,1,dark)
        a.box('freighter bridge',(21,0,13),(14,13,7),glass,1)
        for i in range(4):a.box('central radiator',(-25+i*9,0,13),(3,13,2),metal,.2)
    elif kind=='sybil':
        # Three separate clonal lobes, held by an open triangular skeleton.
        nodes=[(-23,-22),(-23,22),(28,0)]
        for i,(x,y) in enumerate(nodes):
            nx,ny=nodes[(i+1)%3];rod('clonal spine',(x,y,0),(nx,ny,0),3,metal)
            orb('armoured clone pod',(x,y,3),(16,14,10),armour)
            ring('pod eye collar',(x+3,y,13),6,1.5,dark)
            orb('clone sensor',(x+3,y,14),(4.5,4.5,2),glass)
            a.cylinder('clone status',(x+3,y,16),1.8,1,signal,axis='Z')
            a.cylinder('pod drive',(x-17,y,0),3,6,dark)
        a.cylinder('central clone relay',(-4,0,4),5,4,signal,axis='Z')
    # A small dark engine well with a signal throat and obvious armour seams.
    if kind!='hunter':
        a.cylinder('main drive collar',(-42,0,0),6,7,metal)
        a.cylinder('drive recessed throat',(-46,0,0),4.5,2,dark)
        a.cylinder('drive lens',(-47,0,0),3,1,signal)

def dial(kind,m):
    enamel,dark,gold,glass,signal=m
    a.cylinder('watch machined casing',(0,0,0),28,8,gold,axis='Z')
    a.cylinder('recessed clock enamel',(0,0,5),24.5,2,enamel,axis='Z')
    ring('crystal bezel',(0,0,7),25.5,1.3,gold)
    for i in range(12):
        ang=i*math.tau/12
        p=(math.sin(ang)*20,math.cos(ang)*20,7)
        q=(math.sin(ang)*23,math.cos(ang)*23,7)
        rod('dial hour index',p,q,.7,dark)
    for angle,length,width in ((math.radians(120),19,1),(math.radians(130),13,1.5)):
        rod('4:20 hand',(0,0,8),(math.sin(angle)*length,math.cos(angle)*length,8),width,dark)
    orb('hand pivot',(0,0,8),(2,2,1),gold)
    if kind=='fourtwenty':
        a.box('watch crown',(0,30,0),(7,7,5),gold,.8)
        ring('watch suspension loop',(0,37,0),5,1.1,gold)
        lettering('4:20',(0,8,7),5,dark)
    else:
        # Red steel lock visibly clamps the clock. It must remain a trap.
        plate('red steel padlock',[(-29,-27),(29,-27),(29,25),(-29,25)],-3,10,signal,2)
        for x in (-17,17):rod('shackle leg',(x,22,-3),(x,37,-3),3,gold)
        for i in range(12):
            p=i*math.pi/12;q=(i+1)*math.pi/12
            rod('shackle arch',(math.cos(p)*17,37+math.sin(p)*14,-3),(math.cos(q)*17,37+math.sin(q)*14,-3),3,gold)
        for p,q in [((-15,8,8),(-5,0,8)),((-5,0,8),(-9,-6,8)),((-9,-6,8),(7,-15,8))]:rod('cracked crystal',p,q,.5,dark)

def pickup(kind,m):
    enamel,dark,gold,glass,signal=m
    if kind in ('fourtwenty','timelock'):dial(kind,m);return
    if kind in ('cake-piece','whole-cake'):
        if kind=='whole-cake':
            for z,mat in [(-4,gold),(1,enamel),(6,gold),(11,enamel)]:a.cylinder('layered celebration cake',(0,0,z),28,5,mat,axis='Z')
            for i in range(14):
                ang=i*math.tau/14;orb('piped icing pearl',(24*math.cos(ang),24*math.sin(ang),16),(3,3,2),enamel)
            lettering('600B',(0,0,16),10,dark)
            for x,y in [(-13,8),(13,8),(-13,-8),(13,-8)]:orb('rose fruit topper',(x,y,17),(3,3,3),signal)
        else:
            triangle=[(-25,-21),(29,-9),(-25,23)]
            for z,mat in [(-5,gold),(0,enamel),(5,gold),(10,enamel)]:plate('sponge and cream layer',triangle,z,5,mat,.7)
            for i in range(7):orb('piped slice icing',(-23,-17+i*6,14),(3,3,2),enamel)
            orb('slice cherry',(-7,2,16),(5,5,4),signal)
        return
    if kind=='rose':
        rod('rose living stem',(0,-40,-1),(0,9,-1),1.7,signal)
        for side,y in [(-1,-22),(1,-12)]:
            plate('veined jade leaf',[(0,y),(side*22,y+8),(side*15,y+14),(0,y+5)],0,2,signal,.4)
            rod('leaf vein',(0,y+2,1),(side*18,y+9,1),.4,gold)
        for row in range(3):
            for i in range(7-row):
                ang=i*math.tau/(7-row)+row*.7
                r=16-row*5
                petal=orb('velvet curling rose petal',(math.cos(ang)*r,10+math.sin(ang)*r,5+row*5),(12-row*2,7,3.5),enamel)
                petal.rotation_euler.z=ang+.7;petal.rotation_euler.y=.25
        orb('rose heart',(0,10,19),(5,5,4),enamel);return
    if kind=='scooter':
        for x in (-23,23):
            a.cylinder('rubber wheel',(x,-20,0),8,7,dark,axis='Z')
            a.cylinder('alloy wheel hub',(x,-20,5),5,1,gold,axis='Z')
            for i in range(5):
                ang=i*math.tau/5;rod('wheel spoke',(x,-20,6),(x+math.cos(ang)*4,-20+math.sin(ang)*4,6),.5,enamel)
        orb('rounded rear cowl',(-20,0,4),(16,13,7),enamel)
        plate('step-through floorboard',[(-30,-12),(26,-12),(22,-6),(-26,-6)],3,7,enamel,1)
        plate('curved front leg shield',[(13,-8),(17,15),(23,21),(29,14),(26,-9)],5,10,enamel,1.5)
        a.box('leather saddle',(-13,14,8),(23,5,9),dark,1.7)
        rod('steering column',(22,14,5),(29,26,5),1.8,gold)
        rod('handlebar',(24,27,5),(34,27,5),1.5,dark)
        orb('headlamp',(29,11,10),(4,4,3),signal)
        rod('get-well cross',(-27,17,12),(-17,17,12),1.2,gold)
        rod('get-well cross',(-22,12,12),(-22,22,12),1.2,gold);return
    if kind=='cult':
        plate('hooded purple sculpture',[(0,34),(-21,4),(-20,-24),(20,-24),(21,4)],0,12,enamel,2)
        orb('shadowed hood',(0,12,8),(11,14,3),dark)
        for x in (-4,4):orb('hood eye',(x,12,12),(1.5,2,1),signal)
        ring('red prohibition ring',(0,0,15),32,2.1,signal)
        rod('prohibition bar',(-23,23,17),(23,-23,17),2.1,signal);return
    if kind=='600b':
        a.cylinder('milled gold medallion',(0,0,0),31,7,gold,axis='Z')
        a.cylinder('medallion recessed enamel',(0,0,4),27,1,dark,axis='Z')
        ring('raised coin rim',(0,0,5),29,1.2,enamel)
        for i in range(36):
            ang=i*math.tau/36;rod('coin knurl',(math.cos(ang)*30,math.sin(ang)*30,-2),(math.cos(ang)*30,math.sin(ang)*30,2),.45,enamel)
        lettering('600B',(0,3,5),12,gold);lettering('VALUE',(0,-10,5),4.5,enamel);return
    if kind=='shield':
        points=[(0,34),(-27,19),(-21,-14),(0,-34),(21,-14),(27,19)]
        plate('titanium shield perimeter',points,0,8,gold,1.3)
        plate('jade inset shield',[(x*.82,y*.82) for x,y in points],6,3,enamel,1)
        rod('shield central keel',(0,-23,9),(0,23,9),1.5,signal)
        for side in (-1,1):rod('shield chevron',(side*17,7,9),(0,-8,9),1.7,signal)
        return
    if kind=='life':
        plate('medical ceramic cross',[(-9,30),(9,30),(9,9),(30,9),(30,-9),(9,-9),(9,-30),(-9,-30),(-9,-9),(-30,-9),(-30,9),(-9,9)],0,9,enamel,2)
        for side in (-1,1):a.box('medical light strip',(side*19,0,6),(12,3,1),signal,.3)
        lettering('+TIME',(0,0,6),5,dark);return
    # Mechanical upgrade cores have recognisable physical symbols, dark
    # apertures, alloy rims and restrained emission rather than glowing blobs.
    if kind=='net':
        ring('net titanium perimeter',(0,0,0),29,2.3,gold)
        for x in range(-20,21,10):
            h=math.sqrt(26**2-x**2)
            rod('capture net thread',(x,-h,1),(x,h,1),.8,enamel)
            rod('capture net thread',(-h,x,1),(h,x,1),.8,enamel)
        for side in (-1,1):a.box('net projector',(side*29,0,1),(8,15,7),dark,1)
        orb('net relay',(0,0,4),(4,4,2),signal);return
    if kind=='relay':
        a.cylinder('relay transmitter pod',(0,-3,0),12,9,dark,axis='Z')
        a.cylinder('relay optical cap',(0,-3,7),8,3,enamel,axis='Z')
        rod('relay aerial',(0,-3,10),(0,27,10),2,gold)
        orb('relay emitter',(0,27,10),(4,4,2),signal)
        for side in (-1,1):
            for r in (17,27):
                for i in range(8):
                    t=-.9+i*1.8/8;q=-.9+(i+1)*1.8/8
                    rod('signal arc',(side*math.cos(t)*r,math.sin(t)*r,5),(side*math.cos(q)*r,math.sin(q)*r,5),1.1,enamel)
        return
    if kind=='multi':
        a.box('triple splitter receiver',(-20,0,0),(15,13,10),dark,1.5)
        for y in (-22,0,22):
            rod('fanout alloy waveguide',(-15,0,2),(25,y,2),2.7,gold)
            a.cylinder('fanout optical output',(25,y,5),5,4,enamel,axis='Z')
            orb('fanout lens',(25,y,9),(3,3,1.5),signal)
        return
    diamond=[(0,35),(-27,0),(0,-35),(27,0)]
    outline=diamond if kind=='zap' else [(-25,-30),(25,-30),(25,30),(-25,30)]
    plate('upgrade alloy case',outline,0,9,gold,2)
    plate('upgrade recessed enamel',[(x*.82,y*.82) for x,y in outline],6,3,dark,1.2)
    bolt=[(4,25),(-13,-1),(-2,-1),(-8,-25),(15,6),(3,6)]
    plate('raised power bolt',bolt,10,3,enamel,.5)
    if kind=='zap':
        for side in (-1,1):orb('dual zap indicator',(side*14,-2,12),(2.5,2.5,1.5),signal)
    else:
        for y in (-17,17):a.box('charge cell contact',(0,y,13),(18,2,1),signal,.2)

palettes={
 'abductor':(.42,.045,.09),'hunter':(.55,.20,.035),'jammer':(.10,.07,.36),
 'forgery':(.32,.025,.37),'spammer':(.035,.18,.30),'sybil':(.39,.055,.25),'troll':(.12,.13,.15),
 'rose':(.58,.015,.10),'cake-piece':(.93,.83,.62),'whole-cake':(.93,.83,.62),
 '600b':(.95,.78,.30),'life':(.73,.91,.90),'shield':(.02,.42,.31),'relay':(.14,.52,.28),
 'charge':(.94,.62,.08),'zap':(.98,.78,.19),'net':(.38,.76,.48),'cult':(.23,.08,.42),
 'fourtwenty':(.93,.87,.68),'scooter':(.13,.47,.72),'multi':(.92,.40,.035),'timelock':(.91,.83,.77),
}
manifest={}
for kind in ENEMIES+PICKUPS:
    if len(sys.argv)>1 and '--' in sys.argv and kind not in sys.argv[sys.argv.index('--')+1:]:continue
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    enemy=kind in ENEMIES;upright=not enemy or kind=='troll'
    accent=(.30,.95,.025) if kind=='troll' else (.76,.018,.08) if kind=='timelock' else (.8,.02,.04) if kind=='cult' else (.015,.34,.10) if kind=='rose' else (.7,.035,.075) if 'cake' in kind else palettes[kind]
    m=(a.material('armour',palettes[kind],.42 if enemy else .25,.3),a.material('structure',(.018,.024,.035),.6,.35),
       a.material('alloy',(.61,.45,.21) if kind not in ('forgery','troll') else (.77,.71,.57),.8,.26),
       a.material('glass',(.025,.055,.11) if kind!='jammer' else (.06,.14,.50),.55,.17,.1),
       a.material('signal',accent,.24,.3,.7 if enemy else .22))
    (alien if enemy else pickup)(kind,m)
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    for o in meshes:
        bpy.context.view_layer.objects.active=o;o.select_set(True)
        for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
        o.select_set(False)
    tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
    extent=160 if enemy else 110
    glb=None
    if enemy and kind!='troll':
        for o in meshes:o.select_set(True)
        glb=OUT/f'{kind}-v3.glb'
        bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_yup=True)
        bpy.ops.object.select_all(action='DESELECT')
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
    scene.render.resolution_x=768 if enemy else 512;scene.render.resolution_y=768 if kind=='troll' else 512
    scene.render.resolution_percentage=100;scene.render.film_transparent=True
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.16,.20,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
    bpy.ops.object.camera_add(location=(0,-extent*(.55 if upright else .32),extent*1.8))
    cam=bpy.context.object;cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO';cam.data.ortho_scale=extent;scene.camera=cam
    for pos,energy,color,size in [((-100,80,160),550000,(.78,.88,1),110),((65,-95,120),380000,(1,.82,.62),90),((130,10,80),140000,(.3,.65,1),80)]:
        bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.data.energy=energy;o.data.color=color;o.data.size=size
        o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(ROOT/'art/bakes'/f'{kind}-v3.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender'/f'{kind}.blend'))
    bpy.ops.render.render(write_still=True)
    manifest[kind]={'triangles':tris,'authoringParts':len(meshes),'glbBytes':glb.stat().st_size if glb else 0,'logicalWidth':extent,'logicalHeight':extent*scene.render.resolution_y/scene.render.resolution_x,'bakeWidth':scene.render.resolution_x,'bakeHeight':scene.render.resolution_y}
    print('ALIEN PICKUP ART',kind,manifest[kind],flush=True)
path=OUT/'alien-pickup-art-v3.json'
previous=json.loads(path.read_text()) if path.exists() else {}
previous.update(manifest);path.write_text(json.dumps(previous,indent=2)+'\n')
