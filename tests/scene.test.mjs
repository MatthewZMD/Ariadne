import assert from "node:assert/strict";
import test from "node:test";
import { buildPerceivedScene, createSceneMemory, sceneForPrompt } from "../app/scene.ts";

const anchor={x:1,y:1,theme:"beach",bornAt:0,triggered:true};
const crab={id:"entity:4:1:crab",x:4.5,y:1.5,kind:"crab",theme:"beach",phase:0,scale:1};
const args=(world,memory,pose={x:1.5,y:1.5,angle:0})=>({seed:42,world,anchors:[anchor],entities:[crab],pose,tick:0,visibleCells:Array.from({length:4},(_,index)=>[Math.floor(pose.x)+index+1,Math.floor(pose.y)]),routeDirections:["straight","left"],visibleJunction:true,visibleEndAhead:false,activeStar:{id:"star",ordinal:1,cell:[5,1],canonicalPath:[[1,1],[2,1],[3,1],[4,1],[5,1]],protectedChunks:[],seen:false},phase:"charming",relationshipIntensity:.15,collectedStars:0,movementState:"walking",memory});

test("the shared scene occludes objects and stars with the same world walls",()=>{
  const blocked={tile(x,y){return x===2&&y===1?1:0}},memory=createSceneMemory();
  const scene=buildPerceivedScene(args(blocked,memory)).scene;
  assert.equal(scene.objects.length,0);assert.equal(scene.objective.starVisible,false);
  const open={tile(){return 0}},visible=buildPerceivedScene(args(open,createSceneMemory())).scene;
  assert.equal(visible.objects[0].name,"a tiny crab");assert.equal(visible.objective.starVisible,true);
});

test("semantic spectacle episodes are deterministic and first-seen only once",()=>{
  const world={tile(){return 0}},memory=createSceneMemory(),first=buildPerceivedScene(args(world,memory)),second=buildPerceivedScene(args(world,memory));
  assert.deepEqual(first.scene.spectacles.map(item=>item.description),second.scene.spectacles.map(item=>item.description));
  assert.ok(first.scene.spectacles.some(item=>item.firstSeen));assert.ok(second.scene.spectacles.every(item=>!item.firstSeen));
  assert.ok(first.majorFirstSeen);assert.equal(second.majorFirstSeen,null);
});

test("new spatial zones create bounded animated encounter episodes",()=>{
  const world={tile(){return 0}},memory=createSceneMemory(),start=10_000;
  const first=buildPerceivedScene({...args(world,memory,{x:1.5,y:1.5,angle:0}),now:start}),expired=buildPerceivedScene({...args(world,memory,{x:1.5,y:1.5,angle:0}),now:start+12_100}),nextZone=buildPerceivedScene({...args(world,memory,{x:6.5,y:1.5,angle:0}),now:start+12_100});
  assert.ok(first.scene.spectacles.some(item=>item.salience==="major"));
  assert.equal(expired.scene.spectacles.some(item=>item.salience==="major"),false);
  assert.ok(nextZone.scene.spectacles.some(item=>item.salience==="major"));
  assert.notEqual(first.majorFirstSeen,nextZone.majorFirstSeen);
});

test("a distant visible zone activates its spatial encounter before MT enters it",()=>{
  const world={tile(){return 0}},memory=createSceneMemory(),visibleCells=Array.from({length:9},(_,index)=>[2+index,1]);
  const result=buildPerceivedScene({...args(world,memory,{x:1.5,y:1.5,angle:0}),visibleCells,now:20_000});
  assert.ok(result.scene.spectacles.some(item=>item.worldPosition[0]>=5.5),"expected an encounter in the farther visible zone");
});

test("spatial objects, spectacles, and stars remain perceptible in a long unobstructed view",()=>{
  const world={tile(){return 0}},memory=createSceneMemory(),visibleCells=Array.from({length:25},(_,index)=>[2+index,1]),distant={id:"entity:22:1:crab",x:22.5,y:1.5,kind:"crab",theme:"beach",phase:0,scale:1};
  const result=buildPerceivedScene({...args(world,memory),entities:[distant],visibleCells,activeStar:{id:"distant-star",ordinal:1,cell:[24,1],canonicalPath:visibleCells,protectedChunks:[],seen:false},now:30_000});
  assert.equal(result.scene.objects[0]?.id,distant.id,"distant entity popped out of shared perception");
  assert.equal(result.scene.objective.starVisible,true,"distant unobstructed star should already be visible");
  assert.ok(result.scene.spectacles.some(item=>item.worldPosition[0]>12),"expected a distant spectacle silhouette in the FOV");
});

test("MT attention records approach and turning away without leaking render internals",()=>{
  const world={tile(){return 0}},memory=createSceneMemory();
  buildPerceivedScene(args(world,memory,{x:1.5,y:1.5,angle:0}));
  const approaching=buildPerceivedScene(args(world,memory,{x:2.1,y:1.5,angle:0}));
  assert.equal(approaching.scene.mtAttention.approaching,"a tiny crab");
  const turned=buildPerceivedScene(args(world,memory,{x:2.1,y:1.5,angle:Math.PI}));
  assert.equal(turned.scene.objects.length,0);assert.ok(turned.changes.some(change=>/slipped out of MT's view/.test(change)));
  const publicScene=sceneForPrompt(approaching.scene);assert.equal("id" in publicScene.objects[0],false);assert.equal("visualKind" in publicScene.spectacles[0],false);assert.equal("worldPosition" in publicScene.spectacles[0],false);
});

test("Ariadne receives the same explicit upcoming openings MT sees",()=>{
  const world={tile(){return 0}},memory=createSceneMemory();
  const scene=buildPerceivedScene({...args(world,memory),visibleRoutes:[{direction:"left",instruction:"Take the first passage on your left."},{direction:"left",instruction:"Take the second passage on your left."},{direction:"right",instruction:"Take the passage on your right."}]}).scene;
  assert.deepEqual(scene.geometry.visibleOpenings.map(opening=>opening.description),["Take the first passage on your left.","Take the second passage on your left.","Take the passage on your right."]);
});

test("renderer consumes shared perceived objects and spectacle layers",async()=>{
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../app/renderer.ts",import.meta.url),"utf8"));
  assert.match(source,/perceivedIds/);assert.match(source,/renderSpectacles\(ctx,scene/);assert.match(source,/depths\[rayIndex\]/);assert.match(source,/renderAriadneFairy/);assert.doesNotMatch(source,/renderAriadneThread/);assert.match(source,/atlasFrame/);
});

test("environment lighting has genuinely different bright and dark ranges",async()=>{
  const {THEME_LIGHTING}=await import("../app/themes.ts"),values=Object.values(THEME_LIGHTING);
  assert.equal(values.length,7);assert.ok(THEME_LIGHTING.frozen.minimumWall-THEME_LIGHTING.tornado.minimumWall>=20);assert.ok(THEME_LIGHTING.beach.glow>THEME_LIGHTING.ruins.glow);assert.ok(THEME_LIGHTING.frozen.vignette<THEME_LIGHTING.neutral.vignette);assert.ok(new Set(values.map(item=>item.floorShade)).size===7);
});
