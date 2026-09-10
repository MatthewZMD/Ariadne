import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../tools/package.json',import.meta.url));
const validator=require('gltf-validator');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const manifest=JSON.parse(await fs.readFile(path.join(root,'public/fog/models.json'),'utf8'));
const results=[];
for(const a of manifest.assets){
 const bytes=await fs.readFile(path.join(root,'public',a.url));
 const result=await validator.validateBytes(new Uint8Array(bytes),{uri:a.url,maxIssues:1000});
 const len=bytes.readUInt32LE(12);const doc=JSON.parse(bytes.subarray(20,20+len).toString());
 const names=new Set(doc.nodes.map(n=>n.name));
 const missingAnchors=a.anchors.filter(x=>!names.has(x));
 const missingTangents=doc.meshes.flatMap(m=>m.primitives).filter(p=>p.attributes.TANGENT===undefined).length;
 const primitiveCounts=doc.meshes.map(m=>({name:m.name,primitives:m.primitives.length}));
 const budgetExceeded=a.triangleBudgetPerState?Object.values(a.states).some(n=>n>a.triangleBudgetPerState[1]):false;
 results.push({id:a.id,errors:result.issues.numErrors,warnings:result.issues.numWarnings,missingAnchors,missingTangents,budgetExceeded,primitiveCounts,messages:result.issues.messages});
}
const failed=results.filter(r=>r.errors||r.missingAnchors.length||r.missingTangents||r.budgetExceeded);
await fs.writeFile(path.join(root,'asset-source/fog/gltf-validation.json'),JSON.stringify({validator:'Khronos glTF Validator',models:results.length,failed:failed.length,results},null,2)+'\n');
console.log(JSON.stringify({models:results.length,failed:failed.length,errors:results.reduce((n,r)=>n+r.errors,0),warnings:results.reduce((n,r)=>n+r.warnings,0),failures:failed.map(r=>({id:r.id,errors:r.errors,missingTangents:r.missingTangents,budget:r.budgetExceeded}))},null,2));
if(failed.length)process.exitCode=1;
