"""Deterministic game meshes. Run with Blender --background --python this_file.

No .blend is saved: the existing installation scene remains the artwork's only
Blender scene. This source is the authoritative editable source for game assets.
Blender Z-up is converted by the exporter to glTF Y-up, in metres.
"""
import bpy, bmesh, math, random, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/fog/models'
OUT.mkdir(parents=True, exist_ok=True)
random.seed(260910)
bpy.context.preferences.filepaths.save_version = 0
FAMILIES = {
 'chimes': ('#dbc69b', 4, [220, 275, 330, 440]),
 'paper-leaves': ('#bcefff', 5, [196, 245, 294, 392, 490]),
 'gold-veined-cairn': ('#ffd074', 4, [146.832, 183.54, 220.248, 293.664]),
 'reed-bed': ('#9eea76', 5, [261.626, 327.033, 392.439, 523.252, 654.065]),
 'pipes': ('#ff8451', 6, [110, 137.5, 165, 220, 275, 330]),
 'glass-vessels': ('#8cf1dc', 4, [329.628, 412.035, 494.442, 659.256]),
 'bell-arch': ('#dbc69b', 3, [220, 275, 330]),
}
records=[]

def linear(v):
 return v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4

def material(name, color, emission=0, glass=False):
 m=bpy.data.materials.get(name)
 if m: return m
 m=bpy.data.materials.new(name); m.use_nodes=True
 rgb=tuple(linear(int(color[i:i+2],16)/255) for i in (1,3,5))
 n=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
 if n is None:
  n=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
  out=next((n for n in m.node_tree.nodes if n.type=='OUTPUT_MATERIAL'),None) or m.node_tree.nodes.new('ShaderNodeOutputMaterial')
  m.node_tree.links.new(n.outputs['BSDF'],out.inputs['Surface'])
 n.inputs['Base Color'].default_value=(*rgb,1)
 n.inputs['Roughness'].default_value=.18 if glass else .86
 n.inputs['Metallic'].default_value=0
 if glass:
  n.inputs['Transmission Weight'].default_value=.28
  n.inputs['IOR'].default_value=1.44
 if emission:
  n.inputs['Emission Color'].default_value=(*rgb,1)
  n.inputs['Emission Strength'].default_value=emission
 return m

PALE=material('chalk', '#d9d7cf')
DARK=material('mineral-accent','#787971')
PAPER=material('unprinted-fibre','#e4e0d5')
GLASS=material('cloud-glass','#cbded9',glass=True)

def finish(o,name,mat):
 o.name=name; o.data.materials.append(mat)
 for p in o.data.polygons: p.use_smooth=True
 return o

def mesh(name,verts,faces,mat):
 m=bpy.data.meshes.new(name); m.from_pydata(verts,[],faces); m.update()
 o=bpy.data.objects.new(name,m); bpy.context.collection.objects.link(o)
 return finish(o,name,mat)

def tube(name,pts,r,mat=PALE,sides=10):
 verts=[];previous_u=None
 for i,p in enumerate(pts):
  tangent=Vector(pts[min(i+1,len(pts)-1)])-Vector(pts[max(0,i-1)])
  tangent.normalize()
  if previous_u is None:
   ref=Vector((0,0,1)) if abs(tangent.z)<.95 else Vector((1,0,0))
   u=tangent.cross(ref).normalized()
  else:
   u=previous_u-tangent*previous_u.dot(tangent)
   if u.length<.00001:u=tangent.cross(Vector((0,1,0)))
   u.normalize()
  v=tangent.cross(u).normalized();previous_u=u.copy()
  for j in range(sides):
   a=j*math.tau/sides
   verts.append(Vector(p)+r*(math.cos(a)*u+math.sin(a)*v))
 faces=[]
 for i in range(len(pts)-1):
  for j in range(sides):
   a=i*sides+j; b=i*sides+(j+1)%sides
   faces.append((a,b,b+sides,a+sides))
 faces += [tuple(reversed(range(sides))),tuple((len(pts)-1)*sides+j for j in range(sides))]
 return mesh(name,verts,faces,mat)

def rod(name,a,b,r,mat=PALE,sides=12): return tube(name,[a,b],r,mat,sides)

def stone(name,p,s,mat=PALE,seed=0,segments=16,rings=9):
 rng=random.Random(seed); verts=[]
 for i in range(rings+1):
  t=math.pi*i/rings
  for j in range(segments):
   a=math.tau*j/segments
   # Smooth asymmetric lobes, not triangulated rock noise.
   k=1+.065*math.sin(3*a+seed)*math.sin(t)+.045*math.cos(2*t+seed)
   verts.append((p[0]+s[0]*math.sin(t)*math.cos(a)*k,
                 p[1]+s[1]*math.sin(t)*math.sin(a)*k,
                 p[2]+s[2]*math.cos(t)))
 faces=[]
 for i in range(rings):
  for j in range(segments):
   a=i*segments+j; b=i*segments+(j+1)%segments
   faces.append((a,b,b+segments,a+segments))
 return mesh(name,verts,faces,mat)

def lathe(name,p,profile,mat=PALE,n=24):
 v=[(p[0]+r*math.cos(j*math.tau/n),p[1]+r*math.sin(j*math.tau/n),p[2]+z) for r,z in profile for j in range(n)]
 f=[]
 for i in range(len(profile)-1):
  for j in range(n):
   a=i*n+j;b=i*n+(j+1)%n;f.append((a,b,b+n,a+n))
 return mesh(name,v,f,mat)

def bell(name,p,r,h,mat=PALE,n=28):
 # Closed cross-section: thick lip, hollow interior, rounded shoulder.
 profile=[(0,h),(.24*r,h),(.42*r,.9*h),(.47*r,.69*h),(.61*r,.36*h),(r,.07*h),(r,0),(.86*r,0),(.52*r,.34*h),(.36*r,.7*h),(.28*r,.83*h),(0,.83*h)]
 return lathe(name,p,profile,mat,n)

def ring(name,p,r,thickness,mat=PALE,n=32):
 pts=[(p[0]+r*math.cos(i*math.tau/n),p[1]+r*math.sin(i*math.tau/n),p[2]) for i in range(n+1)]
 return tube(name,pts,thickness,mat,8)

def page(name,p,w,h,angle,awake,mat=PAPER):
 verts=[]; nx=8; ny=12
 for k in range(2):
  for j in range(ny+1):
   for i in range(nx+1):
    u=(i/nx-.5)*w; v=j/ny
    x=u; y=h*(.13*math.sin(v*math.pi)+(.48 if awake else .08)*v*v)
    z=h*v + (k-.5)*.055
    verts.append((p[0]+x*math.cos(angle)-y*math.sin(angle),p[1]+x*math.sin(angle)+y*math.cos(angle),p[2]+z))
 faces=[]; L=(nx+1)*(ny+1)
 for j in range(ny):
  for i in range(nx):
   a=j*(nx+1)+i
   faces += [(a,a+1,a+nx+2,a+nx+1),(L+a+nx+1,L+a+nx+2,L+a+1,L+a)]
 border=list(range(nx+1))+[j*(nx+1)+nx for j in range(1,ny+1)]+[ny*(nx+1)+i for i in range(nx-1,-1,-1)]+[j*(nx+1) for j in range(ny-1,0,-1)]
 for i,a in enumerate(border):
  b=border[(i+1)%len(border)];faces.append((a,b,L+b,L+a))
 return mesh(name,verts,faces,mat)

def empty(name,p,parent=None):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.location=p;o.parent=parent
 return o

def clear():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)

def pack_state(name,objects,parent):
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
 o=objects[0];o.name=name
 bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
 bm=bmesh.new();bm.from_mesh(o.data)
 bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
 bm.to_mesh(o.data);bm.free();o.data.update()
 # One vertex-coloured surface primitive plus an independently driveable
 # emissive primitive. Dark accents do not add draw calls or atlas downloads.
 old=list(o.data.materials)
 colors=o.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
 o.data.color_attributes.active_color=colors
 glass=any('glass' in m.name for m in old)
 base=material('vertex-surface-glass' if glass else 'vertex-surface','#ffffff',glass=glass)
 principled=next(n for n in base.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 attr=next((n for n in base.node_tree.nodes if n.type=='VERTEX_COLOR'),None)
 if attr is None:
  attr=base.node_tree.nodes.new('ShaderNodeVertexColor');attr.layer_name='Color'
  base.node_tree.links.new(attr.outputs['Color'],principled.inputs['Base Color'])
 emissives=[m for m in old if 'emissive' in m.name or 'fragment' in m.name]
 slots=[base]+list(dict.fromkeys(emissives))
 assignments=[]
 for poly in o.data.polygons:
  mat=old[poly.material_index];is_light=mat in emissives
  n=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
  rgba=(1,1,1,1) if is_light else n.inputs['Base Color'].default_value
  for idx in poly.loop_indices:colors.data[idx].color=rgba
  assignments.append(slots.index(mat) if is_light else 0)
 o.data.materials.clear()
 for mat in slots:o.data.materials.append(mat)
 for poly,index in zip(o.data.polygons,assignments):poly.material_index=index
 # glTF tangents require UVs. Keep one reusable UV channel; no baked lighting.
 uv=o.data.uv_layers.new(name='UVMap')
 for poly in o.data.polygons:
  for idx in poly.loop_indices:
   co=o.data.vertices[o.data.loops[idx].vertex_index].co
   uv.data[idx].uv=(co.x*.25+.5,co.z*.25+co.y*.125+.5)
 tri=o.modifiers.new('export-triangulation','TRIANGULATE')
 bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=tri.name)
 o.parent=parent; o['state']=name
 return o

def export(asset_id,category,roots,anchors=None,color=None,budget=None):
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 bpy.ops.object.select_all(action='SELECT')
 bpy.ops.export_scene.gltf(filepath=str(OUT/f'{asset_id}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_tangents=True,export_extras=True,export_animations=False)
 positions=[o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
 bounds=[[round(min(v[i] for v in positions),4) for i in range(3)],[round(max(v[i] for v in positions),4) for i in range(3)]]
 # Report in exported glTF axes, not Blender axes.
 lo,hi=bounds; glb_bounds=[[lo[0],lo[2],-hi[1]],[hi[0],hi[2],-lo[1]]]
 states={o.name:len(o.data.polygons) for o in meshes}
 records.append(dict(id=asset_id,category=category,url=f'/fog/models/{asset_id}.glb',states=states,bounds=glb_bounds,anchors=anchors or [],color=color,triangleBudgetPerState=budget,bytes=(OUT/f'{asset_id}.glb').stat().st_size))

def build_markers():
 for kind,count in [('waystone',3),('stake',3),('cord',2)]:
  for i in range(count):
   clear(); root=empty('asset_root',(0,0,0)); objects=[]
   if kind=='waystone':
    h=.55+i*.15; o=stone('leaning_stone',(0,0,h/2),(.19+i*.035,.16,h/2),seed=i,rings=8,segments=18)
    for v in o.data.vertices:v.co.x+=v.co.z*(.15+i*.04)
    objects.append(o);objects.append(stone('residue_cap',(.12,.0,h*.83),(.09,.085,.045),material('marker-emissive','#dbc69b',.01),segments=8,rings=3))
   elif kind=='stake':
    h=.97+i*.2;objects.append(rod('post',(0,0,0),(.09*i,.025,h),.065,PALE,20))
    objects.append(lathe('head',(.09*i,.025,h-.12),[(.065,0),(.09,.04),(.09,.10),(.035,.15),(0,.15)],material('marker-emissive','#dbc69b',.01),20))
   else:
    for x in [-1,1]:objects.append(rod('peg',(x,0,0),(x,0,.23),.055,DARK,12))
    pts=[(-1+2*j/14,.06*math.sin(j/14*math.pi)*(i*2-1),.2+.2*math.sin(j/14*math.pi)) for j in range(15)]
    objects.append(tube('stitch',pts,.035,PALE,12))
    objects.append(stone('residue_cap',(0,0,.4),(.045,.045,.025),material('marker-emissive','#dbc69b',.01),segments=8,rings=3))
   p=(.12,0,h*.83) if kind=='waystone' else ((.09*i,.025,h) if kind=='stake' else (0,0,.4))
   empty('residue_anchor',p,root); pack_state('default',objects,root)
   export(f'marker-{kind}-{i+1:02}','marker',[root],['residue_anchor'],budget={'waystone':[200,400],'stake':[150,300],'cord':[300,500]}[kind])

def dish(p,r,seed=0):
 return lathe('dish',p,[(0,0),(.55*r,0),(.8*r,.025),(.95*r,.09),(r,.12),(r,.02),(.92*r,-.02),(0,-.02)],PALE,56)

def build_nodes():
 for asset in ['node-dish-01','node-dish-02','node-pool-01','node-stake-ring-01','terminus-collapse-01','terminus-collapse-02','terminus-water-01']:
  clear();root=empty('asset_root',(0,0,0));objects=[]
  if 'dish' in asset:
   objects.append(dish((0,0,.025),3))
   if asset.endswith('02'):
    for o in objects:
     for v in o.data.vertices:v.co.z += .025*math.sin(v.co.x*2)*math.cos(v.co.y)
  elif 'pool' in asset:
   objects.append(lathe('pool_rim',(0,0,0),[(2.2,0),(2.3,.06),(2.5,.06),(2.5,0),(2.2,0)],PALE,44))
   objects.append(lathe('water',(0,0,.015),[(0,0),(2.3,0)],material('still-water','#b5c2be'),48))
  elif 'stake-ring' in asset:
   for i in range(8):
    a=i*math.tau/8;x=3.4*math.cos(a);y=3.4*math.sin(a)
    objects.append(rod('post',(x,y,0),(x+.03,y,.64+(i%3)*.1),.085,PALE,26))
  elif 'collapse' in asset:
   seed=int(asset[-2:]);rng=random.Random(seed)
   for i in range(5):
    x=-1.65+i*.75;y=rng.uniform(-.6,.6)
    objects.append(stone('fallen',(x,y,.11),(.44,.18,.17),PALE,seed=i+seed,segments=16,rings=6))
  else:
   n=99;verts=[]
   for j in range(4):
    for i in range(n+1):
     x=-4+8*i/n;edge=.18*math.sin(x*1.5)
     verts.append((x,edge+j*.45, .07 if j==1 else 0))
   faces=[]
   for j in range(3):
    for i in range(n):
     a=j*(n+1)+i;faces.append((a,a+1,a+n+2,a+n+1))
   objects.append(mesh('shore',verts,faces,PALE))
   objects.append(mesh('water',[(-4,1.1,.015),(4,1.1,.015),(4,4,.015),(-4,4,.015)],[(0,1,2,3)],material('still-water','#b5c2be')))
  pack_state('default',objects,root)
  export(asset,'terminus' if 'terminus' in asset else 'node',[root])

def family_geometry(family,awake):
 color,N,notes=FAMILIES[family];glow=material(f'{family}-emissive',color,1.8 if awake else .025)
 # Distinct material names for states allow independent fades after loading.
 glow=material(f'{family}-emissive-{"awake" if awake else "dormant"}',color,1.8 if awake else .025)
 objects=[];anchors=[]
 if family=='chimes':
  for x in [-1.5,1.5]:objects.append(tube('bowed-upright',[(x,0,0),(x,.02,1.5),(x*.94,.08,3.45)],.095,PALE,16))
  objects.append(tube('lintel',[(-1.5,0,3.4),(-.6,.05,3.6),(.7,0,3.53),(1.5,0,3.4)],.09,PALE,16))
  for i in range(N):
   x=-1.08+i*.72;z=1.3+(i%2)*.38;r=.27+i*.025;h=.55+i*.04
   beam=[(-1.5,3.4),(-.6,3.6),(.7,3.53),(1.5,3.4)]
   for (xa,za),(xb,zb) in zip(beam,beam[1:]):
    if xa<=x<=xb:beam_z=za+(zb-za)*(x-xa)/(xb-xa);break
   objects.append(rod('suspension',(x,0,z+h),(x,0,beam_z),.03,DARK,8))
   objects.append(bell('bell',(x,0,z),r,h))
   objects.append(stone('tongue',(x,0,z+.09),(.06,.06,.13),glow,segments=12,rings=5))
   objects.append(ring('lip',(x,0,z+.035),r*.94,.028,glow,24));anchors.append((x,0,z+.15))
 elif family=='paper-leaves':
  for i in range(N):
   a=-.65+i*.32;x=-1+i*.5;y=.2*math.sin(i*2);z=.77+(i%3)*.19
   objects.append(rod('stake',(x,y,0),(x,y,z+.65),.04,DARK,12))
   objects.append(page('leaf',(x,y,z),.5,.85+(i%2)*.22,a,awake))
   objects.append(tube('illuminated-fold',[(x-.21,y,z+.05),(x,y+.06,z+.13),(x+.21,y,z+.05)],.025,glow,8))
   anchors.append((x,y,z+.55))
 elif family=='gold-veined-cairn':
  for i in range(N):
   z=.35+i*.57;x=.11*math.sin(i*1.8);y=.07*math.cos(i)
   sx=.82-i*.11;sy=.57-i*.065
   objects.append(stone('river-stone',(x,y,z),(sx,sy,.35),PALE,seed=i,segments=24,rings=12))
   seam=[]
   for j in range(7):
    u=-.72+1.44*j/6;seam.append((x+sx*u,y-sy*math.sqrt(1-u*u)*1.04,z+.018*math.sin(j)))
   objects.append(tube('mineral-seam',seam,.028,glow,8))
   anchors.append((x,y-.48+i*.05,z))
 elif family=='reed-bed':
  for i in range(N):
   a=i*2.4;r=.24+.15*(i%3);x=r*math.cos(a);y=r*math.sin(a);h=1.55+(i%3)*.29
   objects.append(tube('stem',[(x*.5,y*.5,0),(x,y,h*.6),(x+.12,y,h)],.038,DARK,10))
   anchors.append((x+.12,y,h))
   for k in range(5):
    b=k*math.tau/5; opening=.33 if awake else .095
    pts=[(x+.12,y,h-.17),(x+.12+opening*.6*math.cos(b),y+opening*.6*math.sin(b),h+.08),(x+.12+opening*math.cos(b),y+opening*math.sin(b),h+(.20 if awake else .4))]
    objects.append(tube('petal',pts,.065,PALE,10))
   objects.append(stone('pollen',(x+.12,y,h+.1),(.095,.095,.14),glow,segments=12,rings=6))
   objects.append(page('blade',(x,y,.32),.12,.66,a,True,PALE))
 elif family=='pipes':
  objects.append(lathe('air-reservoir',(0,0,0),[(0,0),(.7,0),(.76,.18),(.65,.55),(.45,.69),(0,.69)],PALE,40))
  for i in range(N):
   x=-1.15+i*.46;y=.16*math.sin(i);h=1.8+i*.24
   objects.append(tube('feed',[(x,0,.38),(x,y,.75)],.09,DARK,12))
   profile=[(.115,0),(.115,h-.3),(.145,h-.18),(.145,h),(.09,h),(.09,h-.3)]
   objects.append(lathe('organ-pipe',(x,y,.55),profile,PALE,30))
   objects.append(lathe('mouth',(x,y,.55+h-.16),[(.148,0),(.148,.085),(.09,.085),(.09,0)],glow,30))
   anchors.append((x,y,.55+h-.08))
  objects.append(tube('manifold',[(-1.4,0,.7),(0,0,.62),(1.4,0,.7)],.12,PALE,16))
  objects.append(bell('bellows',(0,.15,.7),.4,.62,DARK,28))
 elif family=='glass-vessels':
  for i in range(N):
   a=i*math.tau/N+.3;x=.7*math.cos(a);y=.7*math.sin(a);h=1.45+i*.29
   # Blown folded vessels, not fantasy crystal spikes.
   profile=[(0,0),(.24,0),(.31,.12),(.35,h*.42),(.26,h*.8),(.18,h),(.12,h),(.19,h*.79),(.27,h*.42),(.22,.13),(0,.1)]
   objects.append(lathe('vessel',(x,y,0),profile,GLASS,24))
   objects.append(ring('rim',(x,y,h),.16,.028,glow,20))
   objects.append(stone('inclusion',(x,y,h*.43),(.085,.085,.16),glow,segments=12,rings=6));anchors.append((x,y,h*.7))
 elif family=='bell-arch':
  objects.append(lathe('shared-plinth',(0,0,0),[(0,0),(1.42,0),(1.48,.1),(1.42,.19),(0,.19)],PALE,48))
  arch=[(-1.12,0,.18)]+[(1.12*math.cos(math.pi-j*math.pi/18),.05*math.sin(j*math.pi/18),1.8+.95*math.sin(j*math.pi/18)) for j in range(19)]+[(1.12,0,.18)]
  objects.append(tube('continuous-frame',arch,.085,PALE,24))
  # Three unmistakably separated objects: low resonator, face, listening bell.
  objects.append(bell('approach-resonator',(-.86,-.12,.3),.27,.53,PALE,36))
  objects.append(rod('low-bell-suspension',(-.86,-.12,.83),(-.86,0,1.8+.95*math.sqrt(1-(.86/1.12)**2)),.03,DARK,12))
  objects.append(ring('approach-light',(-.86,-.12,.34),.26,.03,glow,32))
  objects.append(page('look-leaf',(0,0,1.25),.58,.76,0,awake))
  objects.append(tube('page-suspension',[(0,.05,2.75),(0,.05,2.4),(0,.76*(.48 if awake else .08),2.01)],.03,DARK,12))
  objects.append(tube('look-fold',[(-.26,-.03,1.35),(0,-.05,1.45),(.26,-.03,1.35)],.03,glow,12))
  objects.append(rod('suspension',(.82,0,1.61),(.82,0,1.8+.95*math.sqrt(1-(.82/1.12)**2)),.035,DARK,16))
  objects.append(bell('listening-bell',(.82,0,1.02),.31,.59,PALE,36))
  objects.append(ring('listening-light',(.82,0,1.055),.30,.03,glow,32))
  for x,z in [(-.86,.48),(.82,1.19)]:objects.append(stone('tongue',(x,0,z),(.07,.07,.15),glow,segments=16,rings=8))
  anchors=[(-.86,-.12,.55),(0,0,1.65),(.82,0,1.3)]
 return objects,anchors

def build_families():
 budgets={'chimes':[3000,5000],'paper-leaves':[2500,4000],'gold-veined-cairn':[2000,3000],'reed-bed':[3000,5000],'pipes':[4000,6000],'glass-vessels':[2500,4000],'bell-arch':[4000,6000]}
 for family,(color,N,notes) in FAMILIES.items():
  clear();root=empty('asset_root',(0,0,0));root['family']=family
  root['defaultState']='dormant'; root['units']='metres'; root['clearingRadius']=10.0
  for state in ['dormant','awake']:
   objects,anchors=family_geometry(family,state=='awake');pack_state(state,objects,root)
  for i,p in enumerate(anchors):
   a=empty(f'element_{i+1:02}',p,root);a['noteHz']=notes[i]
   a['gesture']=['approach','look','listen'][i%3];a['radius']=.38
  empty('call_anchor',(0,0,1.2),root);empty('fragment_anchor',(0,0,2),root)
  export(f'structure-{family}','structure',[root],[f'element_{i+1:02}' for i in range(N)],color,budgets[family])
 for family,(color,N,notes) in list(FAMILIES.items())[:6]:
  clear();root=empty('asset_root',(0,0,0)); glow=material(f'{family}-fragment',color,.7)
  if family=='chimes':objects=[bell('bell-shard',(0,0,0),.065,.14,glow,12)]
  elif family=='paper-leaves':objects=[page('fold',(0,0,0),.11,.17,.1,True,glow)]
  elif family=='gold-veined-cairn':objects=[stone('pebble',(0,0,.07),(.09,.06,.07),glow,segments=12,rings=6)]
  elif family=='reed-bed':objects=[tube('seed',[(0,0,0),(.02,0,.04),(.03,0,.1),(.02,0,.15),(0,0,.2)],.026,glow,12)]
  elif family=='pipes':objects=[lathe('pipe-segment',(0,0,0),[(.05,0),(.05,.16),(.03,.16),(.03,0),(.05,0)],glow,16)]
  else:objects=[lathe('glass-lip',(0,0,0),[(.07,0),(.08,.07),(.06,.16),(.04,.16),(.06,.07),(.05,0)],glow,16)]
  o=pack_state('default',objects,root)
  extent=max(max(v.co[i] for v in o.data.vertices)-min(v.co[i] for v in o.data.vertices) for i in range(3))
  for v in o.data.vertices:v.co*=.18/extent
  if len(o.data.polygons)>300:
   m=o.modifiers.new('fragment-budget','DECIMATE');m.ratio=280/len(o.data.polygons);bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=m.name)
  export(f'fragment-{family}','fragment',[root],color=color,budget=[100,300])

build_markers();build_nodes();build_families()
(OUT.parent/'models.json').write_text(json.dumps({'schemaVersion':1,'units':'metres','upAxis':'+Y','origin':'ground-centre','defaultStructureState':'dormant','assets':records,'families':{k:{'color':v[0],'elements':v[1],'notesHz':v[2]} for k,v in FAMILIES.items()}},indent=2)+'\n')
print('EXPORTED',len(records),'GLB files')
