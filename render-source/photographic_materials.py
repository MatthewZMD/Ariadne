# Physical surface and photographic render setup; units are metres.
import bpy, math, os, json
from pathlib import Path
from mathutils import Vector

def surface(mat, kind):
    if not mat.use_nodes: return
    nt=mat.node_tree
    bs=next((n for n in nt.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if bs is None: return
    presets={
      'wall':(0.82,0.035,650,0.00016,0.14),
      'floor':(0.48,0.08,900,0.00025,0.18),
      'paper':(0.43,0.035,2400,0.000025,0.12),
      'metal':(0.32,0.025,1800,0.000018,0.10),
      'plastic':(0.43,0.055,1300,0.00008,0.17),
      'cloth':(0.90,0.04,1900,0.00013,0.30),
      'linoleum':(0.72,0.035,1100,0.000065,0.15),
    }
    rough,variation,freq,depth,strength=presets[kind]
    geo=nt.nodes.new('ShaderNodeNewGeometry')
    grain=nt.nodes.new('ShaderNodeTexNoise'); grain.inputs['Scale'].default_value=freq
    grain.inputs['Detail'].default_value=2
    nt.links.new(geo.outputs['Position'],grain.inputs['Vector'])
    ramp=nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['To Min'].default_value=rough-variation
    ramp.inputs['To Max'].default_value=rough+variation
    nt.links.new(grain.outputs['Fac'],ramp.inputs['Value'])
    nt.links.new(ramp.outputs['Result'],bs.inputs['Roughness'])
    bump=nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=strength
    bump.inputs['Distance'].default_value=depth
    nt.links.new(grain.outputs['Fac'],bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'],bs.inputs['Normal'])
    if kind in ('wall','floor'):
        base=(0.72,0.705,0.68) if kind=='wall' else (0.24,0.235,0.22)
        coarse=nt.nodes.new('ShaderNodeTexNoise'); coarse.inputs['Scale'].default_value=2.8 if kind=='wall' else 3.7
        coarse.inputs['Detail'].default_value=3
        nt.links.new(geo.outputs['Position'],coarse.inputs['Vector'])
        color=nt.nodes.new('ShaderNodeValToRGB')
        amplitude=0.025 if kind=='wall' else 0.12
        for e,f in zip(color.color_ramp.elements,(1-amplitude,1+amplitude)):
            e.color=(*(v*f for v in base),1)
        nt.links.new(coarse.outputs['Fac'],color.inputs['Fac'])
        nt.links.new(color.outputs['Color'],bs.inputs['Base Color'])
    if kind=='paper':
        # Printed pigment receives illumination; it cannot emit its own image.
        bs.inputs['Emission Strength'].default_value=0
        bs.inputs['Specular IOR Level'].default_value=0.30
        bs.inputs['IOR'].default_value=1.46
    mat['physical_surface']=kind

def block(name,loc,dims,mat):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    obj=bpy.context.object; obj.name=name; obj.dimensions=dims
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(mat)
    bevel=obj.modifiers.new('Machined edge radius','BEVEL'); bevel.width=.0015; bevel.segments=3
    return obj

def refine(root, width, height):
    scene=bpy.context.scene
    for mat in list(bpy.data.materials):
        name=mat.name.lower()
        if any(t in name for t in ('phosphor','projected','backlit','lens','acrylic','screen')): continue
        if any(t in name for t in ('plaster','ceiling')): kind='wall'
        elif 'concrete' in name: kind='floor'
        elif any(t in name for t in ('satin print','archival pigment','printed face','photo ')) or name.endswith(' image') or 'decisive moment material' in name: kind='paper'
        elif 'cloth' in name: kind='cloth'
        elif 'linoleum' in name: kind='linoleum'
        elif any(t in name for t in ('speaker','plastic','rubber','trim')): kind='plastic'
        elif any(t in name for t in ('alumin','steel','hardware')): kind='metal'
        else: continue
        surface(mat,kind)
    for ob in bpy.data.objects:
        if ob.type=='CAMERA':
            ob.data.dof.aperture_blades=9
            if ob.data.lens>40: ob.data.dof.aperture_fstop=8
    # Warm fixtures balanced for a tungsten-balanced documentation camera.
    # Linear RGB is the camera-adapted 3000K appearance, not a measured spectrum.
    for ob in list(bpy.data.objects):
        if ob.type!='LIGHT': continue
        ob.data.specular_factor=1
        if ob.data.type=='SPOT':
            ob.data.shadow_soft_size=.045
            ob.data.spot_blend=max(ob.data.spot_blend,.90)
    # Replace old proxy housings that enclosed the light origin and blocked Cycles rays.
    for ob in list(bpy.data.objects):
        if ob.name=='Projection wall reflected cool light':
            bpy.data.objects.remove(ob,do_unlink=True)
            continue
        if ob.name.startswith('Spot housing ') or 'framing spot body' in ob.name:
            bpy.data.objects.remove(ob,do_unlink=True)
    metal=bpy.data.materials.new('Luminaire black powder coat'); metal.use_nodes=True
    bs=metal.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(.025,.026,.028,1); bs.inputs['Roughness'].default_value=.38
    ceiling_z=3.65
    ceilings=[ob for ob in bpy.data.objects if ob.type=='MESH' and 'ceiling' in ob.name.lower()]
    if ceilings: ceiling_z=min(ob.location.z-ob.dimensions.z/2 for ob in ceilings)
    for ob in list(bpy.data.objects):
        if ob.type!='LIGHT' or ob.data.type!='SPOT': continue
        back=ob.rotation_euler.to_quaternion() @ Vector((0,0,1))
        center=ob.location+back*.10
        bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.057,depth=.16,location=center)
        body=bpy.context.object; body.name=ob.name+' physical optical housing'; body.rotation_euler=ob.rotation_euler; body.data.materials.append(metal)
        mod=body.modifiers.new('Housing rim','BEVEL'); mod.width=.002; mod.segments=3
        if center.z < ceiling_z:
            block(ob.name+' ceiling stem',(center.x,center.y,(center.z+ceiling_z)/2),(.015,.015,ceiling_z-center.z),metal)
            block(ob.name+' ceiling mounting shoe',(center.x,center.y,ceiling_z-.012),(.12,.06,.025),metal)
    scene.render.engine='CYCLES' 
    scene.cycles.samples=int(os.environ.get('RENDER_SAMPLES', '256'))
    scene.cycles.adaptive_threshold=.008
    scene.cycles.use_denoising=True
    scene.cycles.seed=23
    scene.cycles.max_bounces=12
    scene.cycles.diffuse_bounces=6
    scene.cycles.glossy_bounces=6
    scene.cycles.transmission_bounces=8
    scene.cycles.transparent_max_bounces=8
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type='METAL'; prefs.kernel_optimization_level='FULL'; prefs.get_devices()
        gpu=False
        for device in prefs.devices:
            device.use=device.type=='METAL'; gpu |= device.use
        scene.cycles.device='GPU' if gpu else 'CPU'
    except Exception: scene.cycles.device='CPU'
    if os.environ.get('RENDER_CPU')=='1': scene.cycles.device='CPU'
    scene.render.resolution_x=width; scene.render.resolution_y=height
    scene.render.resolution_percentage=100
    if os.environ.get('RENDER_PREVIEW')=='1':
        scene.render.resolution_percentage=40; scene.cycles.samples=24; scene.cycles.adaptive_threshold=.03
    scene.render.use_simplify=True
    scene.render.simplify_subdivision_render=6
    scene.cycles.texture_limit_render='2048' if os.environ.get('RENDER_PREVIEW')=='1' else '4096'
    scene.render.image_settings.color_depth='16'
    scene.render.image_settings.color_mode='RGB'
    scene.render.image_settings.file_format='PNG'
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    bpy.context.preferences.filepaths.save_version=0
    root=Path(root)
    for img in bpy.data.images:
        if img.source=='FILE' and img.filepath:
            p=Path(bpy.path.abspath(img.filepath))
            if not p.exists(): p=root / img.filepath.lstrip('/')
            if not p.exists(): raise FileNotFoundError(str(p))
            img.filepath=bpy.path.relpath(str(p),start=str(root))
    bpy.context.view_layer.update()
    manifest={'units':'metres','objects':[], 'sources':[], 'render':{'engine':'CYCLES','samples':scene.cycles.samples,'width':width,'height':height}}
    for ob in scene.objects:
        row={'name':ob.name,'type':ob.type,'centre':list(ob.location),'dimensions':list(ob.dimensions),'rotation_radians':list(ob.rotation_euler)}
        if ob.type=='LIGHT': row.update(light_type=ob.data.type,energy=ob.data.energy,color=list(ob.data.color))
        if ob.type=='CAMERA': row.update(lens_mm=ob.data.lens, fstop=ob.data.dof.aperture_fstop)
        manifest['objects'].append(row)
    manifest['sources']=[im.filepath for im in bpy.data.images if im.source=='FILE']
    target=root/'render-source'; target.mkdir(exist_ok=True)
    (target/'scene-manifest.json').write_text(json.dumps(manifest,indent=2))
    scene['render_intent']='Photographic visualization; 3000K camera-balanced fixtures; physical-scale surface texture'
