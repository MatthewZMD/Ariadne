import bpy, math, sys
from pathlib import Path
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from photographic_materials import refine, block

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, color, roughness=.6, metallic=0):
    material = bpy.data.materials.new(name); material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return material

def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()

def spot(name, location, target, power):
    data = bpy.data.lights.new(name, 'SPOT'); data.energy = power; data.color = (1, .93, .84)
    data.spot_size = math.radians(48); data.spot_blend = .88
    obj = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(obj)
    obj.location = location; aim(obj, target)

def cable(name, points, material, radius=.003):
    curve = bpy.data.curves.new(name, 'CURVE'); curve.dimensions = '3D'; curve.bevel_depth = radius; curve.bevel_resolution = 3
    spline = curve.splines.new('BEZIER'); spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate; point.handle_left_type = 'AUTO'; point.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, curve); bpy.context.collection.objects.link(obj); obj.data.materials.append(material)
    return obj

def rounded_earcup(name, location, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=location)
    obj = bpy.context.object; obj.name = name; obj.scale = (.036, .025, .064); obj.data.materials.append(material)
    for polygon in obj.data.polygons: polygon.use_smooth = True
    return obj

wall = mat('Warm gallery plaster', (.72, .705, .68), .82)
floor = mat('Honed concrete', (.24, .235, .22), .50)
black = mat('Black powder coated steel', (.022, .024, .026), .36, .15)
plastic = mat('Matte ABS plastic', (.018, .020, .024), .46)
tabletop = mat('Birch veneer table top', (.32, .235, .15), .56)
rubber = mat('Rubber cable insulation', (.006, .007, .008), .68)
glass = mat('CRT curved anti-glare glass', (.018, .024, .027), .16)

block('Rear gallery wall', (0, 2.4, 1.65), (9, .15, 3.3), wall)
block('Side gallery wall', (-4.5, -1.0, 1.65), (.15, 7, 3.3), wall)
block('Gallery floor', (0, -1, -.07), (10, 10, .14), floor)
block('Gallery ceiling', (0, -1, 3.36), (10, 10, .12), wall)

# A freestanding exhibition table, with no desk pedestal or seating.
block('Exhibition table top', (0, 0, .745), (1.40, .75, .035), tabletop)
for x in (-.62, .62):
    for y in (-.30, .30):
        block('Table steel leg', (x, y, .365), (.038, .038, .73), black)
        block('Table rubber foot', (x, y, .006), (.046, .046, .012), plastic)
block('Table rear cable trough', (0, .286, .695), (1.10, .055, .045), black)
block('Table cable grommet', (.48, .18, .766), (.065, .065, .009), black)

# A genuine 4:3 CRT body, with Ariadne's existing 16:9 title card in its central picture area.
block('CRT monitor foot', (0, .075, .785), (.31, .27, .035), plastic)
block('CRT monitor neck', (0, .075, .875), (.10, .12, .18), plastic)
block('CRT monitor enclosure', (0, .08, 1.105), (.53, .47, .43), plastic)
block('CRT front bezel', (0, -.158, 1.105), (.465, .018, .345), black)
block('CRT title-image recess', (0, -.171, 1.105), (.392, .012, .221), glass)
bpy.ops.mesh.primitive_plane_add(size=2, location=(0, -.178, 1.105), rotation=(math.pi / 2, 0, 0))
screen_obj = bpy.context.object; screen_obj.name = 'Actual Ariadne title screen'; screen_obj.scale = (.382 / 2, .215 / 2, 1)
screen = mat('CRT phosphor display image', (.004, .004, .004), .24)
bsdf = screen.node_tree.nodes.get('Principled BSDF')
image = screen.node_tree.nodes.new('ShaderNodeTexImage'); image.image = bpy.data.images.load(str(ROOT / 'public/ariadne-title-card.png'))
screen.node_tree.links.new(image.outputs['Color'], bsdf.inputs['Emission Color']); bsdf.inputs['Emission Strength'].default_value = .72
screen_obj.data.materials.append(screen)
block('CRT power switch', (.187, -.180, .94), (.034, .012, .018), plastic)

block('Keyboard base', (-.12, -.205, .775), (.36, .125, .020), plastic)
for row in range(5):
    for col in range(18): block('Keyboard key', (-.281 + col * .019, -.252 + row * .020, .788), (.016, .016, .008), black)
bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=(.31, -.205, .783))
mouse = bpy.context.object; mouse.name = 'Wired mouse ABS shell'; mouse.scale = (.030, .047, .020); mouse.data.materials.append(plastic)
for polygon in mouse.data.polygons: polygon.use_smooth = True

# Wired headphones rest on the tabletop; their cable is visible and supported by the surface.
rounded_earcup('Headphone left earcup', (.36, .105, .812), plastic)
rounded_earcup('Headphone right earcup', (.47, .105, .812), plastic)
cable('Headphone padded headband', [(.36, .105, .852), (.415, .105, .948), (.47, .105, .852)], plastic, .012)
cable('Headphone signal cable', [(.36, .105, .800), (.34, .015, .774), (.29, .055, .774), (.23, .02, .774), (.18, -.12, .774), (.18, -.176, .98)], rubber, .003)
block('CRT headphone jack', (.18, -.183, .98), (.018, .012, .018), black)

# Each visible cable either lies on the table or enters the rear trough and travels down a table leg.
cable('Keyboard cable', [(-.12, -.15, .778), (-.10, -.03, .774), (-.02, .12, .774), (.05, .22, .774), (.05, .29, .716)], rubber, .0022)
cable('Mouse cable', [(.31, -.16, .782), (.35, -.04, .774), (.32, .12, .774), (.27, .22, .774), (.27, .29, .716)], rubber, .0022)
cable('CRT power cable', [(.16, .29, 1.00), (.18, .31, .78), (.50, .31, .72), (.62, .31, .68), (.62, .31, .02), (.62, .34, .008)], rubber, .003)
block('Flush floor service box', (.62, .34, .003), (.17, .13, .006), black)
for z in (.13, .34, .55): block('Rear leg cable clip', (.624, .305, z), (.014, .018, .014), black)

spot('Table key 3000K', (-1.25, -1.1, 3.0), (0, 0, .9), 190)
spot('Table rim 3000K', (1.25, .15, 3.0), (.25, -.1, .8), 105)
area = bpy.data.lights.new('Adjoining gallery diffuse light', 'AREA'); area.energy = 210; area.shape = 'RECTANGLE'; area.size = 2.5; area.size_y = 2.4; area.color = (.92, .96, 1)
area_obj = bpy.data.objects.new('Adjoining gallery diffuse light', area); bpy.context.collection.objects.link(area_obj); area_obj.location = (.7, -3.5, 2.15); aim(area_obj, (0, 0, .85))

# Close, front-on visitor view: CRT dominates the frame, with controls immediately below it.
bpy.ops.object.camera_add(location=(0, -1.40, 1.25))
camera = bpy.context.object; aim(camera, (0, -.08, .98)); camera.data.lens = 50; camera.data.sensor_width = 36
camera.data.dof.use_dof = True; camera.data.dof.focus_distance = (camera.location - Vector((0, -.08, .98))).length; camera.data.dof.aperture_fstop = 8
scene = bpy.context.scene; scene.camera = camera
world = bpy.data.worlds.new('Enclosed gallery ambient'); world.use_nodes = True; world.node_tree.nodes['Background'].inputs['Strength'].default_value = .025; scene.world = world
scene.view_settings.exposure = .2
refine(ROOT, 3000, 2000)
scene.render.filepath = str(ROOT / 'Ariadne-Blender-Installation-50mm.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'Ariadne-Installation-50mm.blend'))
if __import__('os').environ.get('BUILD_ONLY') == '1':
    print('Scene and manifest generated; rendering deferred.')
    sys.exit(0)
bpy.ops.render.render(write_still=True)
