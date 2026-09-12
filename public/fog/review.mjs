import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const params=new URLSearchParams(location.search);
if(params.has('capture'))document.body.classList.add('capture');
const viewport=document.querySelector('#viewport');
const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#scene'),antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor('#e9ece6');
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
const scene=new THREE.Scene();scene.background=new THREE.Color('#e9ece6');scene.fog=new THREE.FogExp2('#e9ece6',.105);
const camera=new THREE.PerspectiveCamera(45,1,.06,100);camera.position.set(7,3.7,10);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1,0);controls.maxPolarAngle=Math.PI*.49;controls.minDistance=.5;controls.maxDistance=35;controls.enableDamping=true;
scene.add(new THREE.HemisphereLight('#f1f5ff','#b9b09b',2.2));
const groundGeometry=new THREE.PlaneGeometry(180,180,220,220);groundGeometry.rotateX(-Math.PI/2);
const p=groundGeometry.attributes.position;
for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);p.setY(i,-.045+.022*Math.sin(x*.42)*Math.cos(z*.47)+.012*Math.sin(x*1.15+z*.7));}
groundGeometry.computeVertexNormals();
const groundMat=new THREE.MeshStandardMaterial({color:'#d3d2c9',roughness:1});
groundMat.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\n float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453); diffuseColor.rgb *= .982 + .018 * grain;`);};
scene.add(new THREE.Mesh(groundGeometry,groundMat));
const group=new THREE.Group();scene.add(group);
const loader=new GLTFLoader();
const manifest=await fetch('/fog/models.json').then(r=>r.json());
const loaded=new Map();
let current='field',state='awake',fog=true,selectedAudio;
for(const a of manifest.assets){const gltf=await loader.loadAsync(a.url);loaded.set(a.id,gltf.scene);const opt=document.createElement('option');opt.value=a.id;opt.textContent=a.id;document.querySelector('#asset').append(opt);}
function setupMaterials(object){object.traverse(n=>{if(n.isMesh){n.castShadow=false;n.receiveShadow=false;const mats=Array.isArray(n.material)?n.material:[n.material];for(const mat of mats){mat.side=THREE.DoubleSide;if(mat.name.includes('emissive')||mat.name.includes('fragment')){mat.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>',`#ifdef USE_FOG\n float fogFactor = 1.0 - exp(-fogDensity*fogDensity*vFogDepth*vFogDepth*.25); gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);\n#endif`);};}}}});}
for(const object of loaded.values())setupMaterials(object);
function instance(id,x=0,z=0,rotation=0){const o=loaded.get(id).clone(true);o.position.set(x,0,z);o.rotation.y=rotation;group.add(o);o.traverse(n=>{if(n.name==='dormant'||n.name==='awake')n.visible=n.name===state;});return o;}
function thread(){const points=[[-3,.5,5],[-2.4,.7,3.5],[-1.6,1,2],[-.7,1.3,.5],[.4,1.6,-.5],[1.4,1.75,-1.1],[2,1.55,-2]].map(p=>new THREE.Vector3(...p));const curve=new THREE.CatmullRomCurve3(points);const m=new THREE.MeshBasicMaterial({color:'#cbbd87',fog:false});group.add(new THREE.Mesh(new THREE.TubeGeometry(curve,100,.022,8,false),m));const glow=new THREE.MeshBasicMaterial({color:'#f4df99',transparent:true,opacity:.16,depthWrite:false,fog:false});group.add(new THREE.Mesh(new THREE.TubeGeometry(curve,100,.07,8,false),glow));}
function show(id){current=id;group.clear();if(id==='field'){
 instance('structure-bell-arch',-1.5,-1.5,-.16);instance('node-dish-01',-1.5,-1.5);
 instance('structure-chimes',4,-9,.3);instance('structure-glass-vessels',-7,-6);instance('node-pool-01',5,-3);
 for(let i=0;i<5;i++){instance(`marker-waystone-0${i%3+1}`,-4+i*.65,5-i*3.1,-.2);instance('marker-stake-01',5.2+i*.4,-1-i*4);}
 instance('marker-cord-01',1.5,3.3,.5);thread();camera.position.set(4.5,2.7,6);controls.target.set(-.6,1.1,-2);
 }else{instance(id);const box=new THREE.Box3().setFromObject(group);const size=box.getSize(new THREE.Vector3());const center=box.getCenter(new THREE.Vector3());const d=Math.max(size.x,size.y,size.z)*1.65;camera.position.set(d*.65,Math.max(.7,d*.44),d);controls.target.copy(center);}
 controls.update();document.querySelector('#asset').value=id;window.assetReady=true;
}
document.querySelector('#asset').onchange=e=>show(e.target.value);
for(const s of ['dormant','awake'])document.querySelector('#'+s).onclick=()=>{state=s;for(const t of ['dormant','awake'])document.querySelector('#'+t).setAttribute('aria-pressed',String(s===t));group.traverse(n=>{if(n.name==='dormant'||n.name==='awake')n.visible=n.name===state;});};
document.querySelector('#fog').onclick=()=>{fog=!fog;scene.fog=fog?new THREE.FogExp2('#e9ece6',.105):null;document.querySelector('#fog').setAttribute('aria-pressed',String(fog));};
for(const b of document.querySelectorAll('[data-distance]'))b.onclick=()=>{const d=+b.dataset.distance;camera.position.copy(controls.target).add(new THREE.Vector3(0,.1,d));controls.update();};
for(const a of manifest.assets){const card=document.createElement('div');card.className='card';const b=document.createElement('button');b.textContent=a.id;b.onclick=()=>show(a.id);const small=document.createElement('small');small.textContent=`${Object.entries(a.states).map(([s,n])=>s+': '+n.toLocaleString()+' triangles').join(' · ')}${a.anchors.length?' · '+a.anchors.length+' anchors':''}`;card.append(b,small);document.querySelector('#models').append(card);}
const soundManifest=await fetch('/fog/audio.json').then(r=>r.ok?r.json():{assets:[]});
for(const a of soundManifest.assets){const card=document.createElement('div');card.className='card';const title=document.createElement('div');title.textContent=a.id;const small=document.createElement('small');small.textContent=`${a.duration}s${a.loop?' · seamless loop':''}`;const player=document.createElement('audio');player.controls=true;player.preload='none';player.src=a.url;player.loop=a.loop;card.append(title,small,player);document.querySelector('#sounds').append(card);}
const cues=await fetch('/fog/cues.json').then(r=>r.ok?r.json():{assets:[]});
for(const a of cues.assets){const card=document.createElement('div');card.className='card';card.textContent=a.text;const small=document.createElement('small');small.textContent=a.status;card.append(small);if(a.url){const player=document.createElement('audio');player.controls=true;player.preload='none';player.src=a.url;card.append(player);}document.querySelector('#cues').append(card);}
document.querySelector('#play').onclick=()=>{selectedAudio?.pause();const family=current.replace('structure-','');const a=soundManifest.assets.find(x=>x.id===`${family==='field'?'bell-arch':family}-call`);if(a){selectedAudio=new Audio(a.url);selectedAudio.loop=true;selectedAudio.volume=.45;selectedAudio.play();}};
function resize(){renderer.setSize(viewport.clientWidth,viewport.clientHeight,false);camera.aspect=viewport.clientWidth/viewport.clientHeight;camera.updateProjectionMatrix();}new ResizeObserver(resize).observe(viewport);resize();
show(params.get('asset')||'field');if(params.get('fog')==='0'){scene.fog=null;fog=false;}
document.querySelector('#status').textContent=`${loaded.size} models · ${soundManifest.assets.length} sound files · ${cues.assets.filter(x=>x.url).length} cues`;
window.assetReview={show,setState(s){document.querySelector('#'+s).click();},setFog(enabled){if(fog!==enabled)document.querySelector('#fog').click();},render(){renderer.render(scene,camera);},capture(){renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');}};
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
const exportButton=document.createElement('button');exportButton.textContent='Export asset images';document.querySelector('nav').append(exportButton);
exportButton.onclick=async()=>{
 exportButton.disabled=true;const previous=current;renderer.setAnimationLoop(null);renderer.setPixelRatio(1);
 const save=async(name,data)=>{const r=await fetch('/__asset_render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})});if(!r.ok)throw new Error(`Render save failed: ${r.status}`);};
 try{
  renderer.setSize(1200,800,false);camera.aspect=1.5;camera.updateProjectionMatrix();
  for(const a of manifest.assets)for(const s of a.category==='structure'?['dormant','awake']:['default']){
   show(a.id);assetReview.setFog(false);if(s!=='default')assetReview.setState(s);renderer.render(scene,camera);
   await save(`${a.id}-${s}.png`,renderer.domElement.toDataURL('image/png'));
  }
  for(const [name,w,h]of [['ariadne-title-card.png',1920,1080],['og.png',1200,630]]){
   show('field');assetReview.setState('awake');assetReview.setFog(true);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.render(scene,camera);
   const cropHeight=name==='ariadne-title-card.png'?Math.round(h*1000/1080):h;
   const c=document.createElement('canvas');c.width=w;c.height=cropHeight;const ctx=c.getContext('2d');ctx.drawImage(renderer.domElement,0,0,w,cropHeight,0,0,w,cropHeight);
   ctx.fillStyle='#586052';ctx.font=`300 ${Math.round(w*.055)}px sans-serif`;ctx.letterSpacing=`${Math.round(w*.008)}px`;ctx.fillText('ARIADNE',w*.08,h*.2);
   await save(name,c.toDataURL('image/png'));
  }
  exportButton.textContent='37 images exported';
 }catch(e){exportButton.textContent=e.message;throw e;}finally{exportButton.disabled=false;show(previous);resize();renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});}
};

// Regenerate the title background from the scene; lettering belongs to the page.
const backgroundButton=document.createElement('button');
backgroundButton.textContent='Export title background';document.querySelector('nav').append(backgroundButton);
backgroundButton.onclick=async()=>{
 const previous=current; backgroundButton.disabled=true; renderer.setAnimationLoop(null); renderer.setPixelRatio(1);
 try {
  show('field');assetReview.setState('awake');assetReview.setFog(true);
  renderer.setSize(1920,1080,false);camera.aspect=1920/1080;camera.updateProjectionMatrix();renderer.render(scene,camera);
  const response=await fetch('/__asset_render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'ariadne-title-background.png',data:renderer.domElement.toDataURL('image/png')})});
  if(!response.ok)throw new Error(`Export failed: ${response.status}`);
  backgroundButton.textContent='Title background exported';
 }catch(error){backgroundButton.textContent=error.message;}finally{backgroundButton.disabled=false;show(previous);resize();renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});}
};

// Render publication images from the same scene, with the project title only.
const titleButton=document.createElement('button');
titleButton.textContent='Export title images';document.querySelector('nav').append(titleButton);
titleButton.onclick=async()=>{
 const previous=current;titleButton.disabled=true;renderer.setAnimationLoop(null);renderer.setPixelRatio(1);
 try{
  for(const [name,w,h] of [['ariadne-title-card.png',1920,1080],['og.png',1200,630]]){
   show('field');assetReview.setState('awake');assetReview.setFog(true);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.render(scene,camera);
   const cropHeight=name==='ariadne-title-card.png'?Math.round(h*1000/1080):h;
   const canvas=document.createElement('canvas');canvas.width=w;canvas.height=cropHeight;const ctx=canvas.getContext('2d');ctx.drawImage(renderer.domElement,0,0,w,cropHeight,0,0,w,cropHeight);
   ctx.fillStyle='#586052';ctx.font=`300 ${Math.round(w*.055)}px sans-serif`;ctx.letterSpacing=`${Math.round(w*.008)}px`;ctx.fillText('ARIADNE',w*.08,h*.2);
   const response=await fetch('/__asset_render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data:canvas.toDataURL('image/png')})});
   if(!response.ok)throw new Error(`Export failed: ${response.status}`);
  }
  titleButton.textContent='Title images exported';
 }catch(error){titleButton.textContent=error.message;}finally{titleButton.disabled=false;show(previous);resize();renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});}
};
