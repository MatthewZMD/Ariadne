/** Asset loading helpers only. No navigation, dialogue, or game-state changes. */
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const loader=new GLTFLoader();
const cache=new Map();

export async function loadFogAsset(id,{base='/fog/models/'}={}){
 if(!/^[a-z0-9-]+$/.test(id))throw new Error('Invalid fog asset id');
 const url=`${base}${id}.glb`;
 if(!cache.has(url))cache.set(url,loader.loadAsync(url).catch(error=>{cache.delete(url);throw error;}));
 const original=await cache.get(url),root=original.scene.clone(true),materials=new Map();
 // GLTF scene cloning otherwise shares materials: waking one would affect all.
 root.traverse(node=>{
  if(!node.isMesh)return;
  const clone=source=>{
   if(!materials.has(source))materials.set(source,source.clone());
   return materials.get(source);
  };
  node.material=Array.isArray(node.material)?node.material.map(clone):clone(node.material);
 });
 setFogAssetState(root,'dormant');
 return root;
}

export function setFogAssetState(root,state){
 if(state!=='dormant'&&state!=='awake')throw new Error('Expected dormant or awake');
 root.traverse(node=>{if(node.name==='dormant'||node.name==='awake')node.visible=node.name===state;});
 root.userData.fogState=state;
}

export function fogElementAnchors(root){
 const anchors=[];
 root.traverse(node=>{if(/^element_\d\d$/.test(node.name))anchors.push(node);});
 return anchors.sort((a,b)=>a.name.localeCompare(b.name));
}

export function setMarkerResidue(root,strength){
 const value=Math.max(0,Math.min(3,strength));
 root.traverse(node=>{
  if(!node.isMesh)return;
  for(const mat of Array.isArray(node.material)?node.material:[node.material])
   if(mat.name==='marker-emissive')mat.emissiveIntensity=value;
 });
}

export function disposeFogInstance(root){
 // Geometry is shared with the loader cache. Dispose only per-instance materials.
 const materials=new Set();
 root.traverse(node=>{if(node.isMesh)for(const m of Array.isArray(node.material)?node.material:[node.material])materials.add(m);});
 for(const mat of materials)mat.dispose();
 root.removeFromParent();
}
