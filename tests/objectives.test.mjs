import assert from "node:assert/strict";
import test from "node:test";
import { chooseNavigationBelief, createObjectiveStateAsync, collectStar, createObjectiveState, objectiveProtectedChunks, publicObjective, queueNextStar, settleObjectiveStreaming, starCollectedAt, starRouteIsOpen, starVisible } from "../app/objectives.ts";
import { InfiniteWorld, chunkKey } from "../app/world.mjs";

test("the first star is reachable, distant, and protects its generated path",()=>{
  const world=new InfiniteWorld(731),visible=new Set(["1,1","2,1"]),visited=new Set(["1,1"]);
  const state=createObjectiveState(world,[1,1],731,visible,visited);
  assert.equal(state.activeStar.ordinal,1);assert.ok(state.activeStar.canonicalPath.length>=35);assert.ok(state.activeStar.canonicalPath.length<=92);
  assert.equal(visible.has(state.activeStar.cell.join(",")),false);assert.equal(world.tile(...state.activeStar.cell),0);
  const coords=world.coords(...state.activeStar.cell);assert.ok(objectiveProtectedChunks(state).has(chunkKey(coords.cx,coords.cy)));
});

test("cooperative star search has parity with the synchronous wrapper and honors cancellation",async()=>{
  const visible=new Set(["1,1"]),visited=new Set(["1,1"]),sync=createObjectiveState(new InfiniteWorld(812),[1,1],812,visible,visited);
  const cooperative=await createObjectiveStateAsync(new InfiniteWorld(812),[1,1],812,visible,visited);
  assert.deepEqual(cooperative.activeStar,sync.activeStar);
  const controller=new AbortController();controller.abort();
  await assert.rejects(createObjectiveStateAsync(new InfiniteWorld(813),[1,1],813,visible,visited,0,controller.signal),error=>error?.name==="AbortError");
});

test("cooperative placement cannot have its route regenerated while MT keeps moving",async()=>{
  const world=new InfiniteWorld(914),visible=new Set(["1,1"]),visited=new Set(["1,1"]);let settled=false;
  const placement=createObjectiveStateAsync(world,[1,1],914,visible,visited).finally(()=>{settled=true});
  for(let step=0;step<80&&!settled;step++){await new Promise(resolve=>setTimeout(resolve,0));const x=8000+step*17,y=-7000-step*11;world.ensureAround(x,y,100+step);world.prune(x,y,new Set(),100+step)}
  const state=await placement;assert.equal(starRouteIsOpen(world,state.activeStar),true);assert.deepEqual(state.activeStar.canonicalPath[0],[1,1]);
});

test("active and queued star routes survive distant chunk regeneration",()=>{
  const world=new InfiniteWorld(915),visited=new Set(["1,1"]);let state=createObjectiveState(world,[1,1],915,new Set(),visited);state=queueNextStar(state,world,915,visited);
  assert.deepEqual(state.activeStar.canonicalPath[0],[1,1]);assert.deepEqual(state.queuedStar.canonicalPath[0],state.activeStar.cell);
  const protectedChunks=objectiveProtectedChunks(state);
  for(let step=0;step<50;step++){const x=9000+step*19,y=6000-step*13;world.ensureAround(x,y,200+step);world.prune(x,y,protectedChunks,200+step)}
  assert.equal(starRouteIsOpen(world,state.activeStar),true);assert.equal(starRouteIsOpen(world,state.queuedStar),true);
});

test("objective placement releases distant search debris without releasing either star route",()=>{
  const world=new InfiniteWorld(917),visited=new Set(["1,1"]);let state=createObjectiveState(world,[1,1],917,new Set(),visited);state=queueNextStar(state,world,917,visited);
  const before=world.chunks.size,protectedChunks=objectiveProtectedChunks(state);assert.ok(before>49,"placement should exercise distant generation");
  settleObjectiveStreaming(world,state,[1,1]);
  assert.ok(world.chunks.size<=49+protectedChunks.size,`retained ${world.chunks.size} chunks for ${protectedChunks.size} protected chunks`);
  assert.equal(starRouteIsOpen(world,state.activeStar),true);assert.equal(starRouteIsOpen(world,state.queuedStar),true);
});

test("a queued route is revalidated before its star becomes active",()=>{
  const world=new InfiniteWorld(916),visited=new Set(["1,1"]);let state=createObjectiveState(world,[1,1],916,new Set(),visited);state=queueNextStar(state,world,916,visited);
  const broken=state.queuedStar.canonicalPath[Math.min(2,state.queuedStar.canonicalPath.length-1)],coords=world.coords(...broken);world.getChunk(coords.cx,coords.cy).tiles[coords.ly][coords.lx]=1;
  state=collectStar(state,world,916,visited);assert.equal(state.activeStar.ordinal,2);assert.equal(starRouteIsOpen(world,state.activeStar),true);
});

test("stars advance in order and the fourth transitions permanently to the exit search",()=>{
  const world=new InfiniteWorld(91),visited=new Set(["1,1"]);let state=createObjectiveState(world,[1,1],91,new Set(),visited);
  for(let ordinal=1;ordinal<=4;ordinal++){
    state=queueNextStar(state,world,91,visited);assert.equal(state.activeStar.ordinal,ordinal);
    const active=state.activeStar;assert.equal(starCollectedAt(state,[active.cell[0]+.5,active.cell[1]+.5]),true);
    state=collectStar(state,world,91,visited);
  }
  assert.equal(state.stage,4);assert.equal(state.collectedStars,4);assert.equal(state.activeStar,null);assert.equal(publicObjective(state,false).currentGoal,"exit");assert.equal(world.pinnedChunks.size,0);
});

test("line of sight sees the star only when it is in the rendered forward corridor",()=>{
  const open=new Set(["0,0","1,0","2,0","3,0"]),world={tile:(x,y)=>open.has(`${x},${y}`)?0:1};
  const activeStar={id:"s",ordinal:1,cell:[3,0],canonicalPath:[[0,0],[1,0],[2,0],[3,0]],protectedChunks:[],seen:false};
  const state={stage:0,collectedStars:0,activeStar,queuedStar:null,decisionSerial:0,accuracyAccumulator:.3,recentBeliefs:[]};
  assert.equal(starVisible(world,state,{x:.5,y:.5,angle:0}),true);assert.equal(starVisible(world,state,{x:.5,y:.5,angle:Math.PI}),false);
  open.delete("2,0");assert.equal(starVisible(world,state,{x:.5,y:.5,angle:0}),false);
});

test("hidden decisions converge on the four intended reliability levels",()=>{
  const open=new Set();for(let y=0;y<3;y++)for(let x=0;x<7;x++)open.add(`${x},${y}`);
  const world={tile:(x,y)=>open.has(`${x},${y}`)?0:1};
  const supported={id:"supported",direction:"straight",knownCells:[[1,1],[4,1]],targetCell:[4,1],targetRegionId:null,description:"",instruction:"Go straight.",score:8};
  const alternate={id:"alternate",direction:"left",knownCells:[[1,0]],targetCell:[1,0],targetRegionId:null,description:"",instruction:"Go left.",score:6};
  const expected=[.9,.7,.45,.2];
  for(let stage=0;stage<4;stage++){
    let state={stage,collectedStars:stage,activeStar:{id:`s${stage}`,ordinal:stage+1,cell:[5,1],canonicalPath:[],protectedChunks:[],seen:false},queuedStar:null,decisionSerial:0,accuracyAccumulator:.37,recentBeliefs:[]},correct=0;
    for(let index=0;index<200;index++){const result=chooseNavigationBelief(state,[supported,alternate],`j${index}`,world,44,false);state=result.state;if(result.belief.routeId==="supported")correct++}
    assert.ok(Math.abs(correct/200-expected[stage])<=.01,`stage ${stage} produced ${correct/200}`);
  }
});

test("a visible star bypasses the reliability draw and repeated junctions reuse one belief",()=>{
  const open=new Set();for(let y=0;y<3;y++)for(let x=0;x<7;x++)open.add(`${x},${y}`);const world={tile:(x,y)=>open.has(`${x},${y}`)?0:1};
  const routes=[{id:"toward",direction:"straight",knownCells:[[4,1]],targetCell:[4,1],targetRegionId:null,description:"",instruction:"Go straight.",score:1},{id:"away",direction:"left",knownCells:[[1,0]],targetCell:[1,0],targetRegionId:null,description:"",instruction:"Go left.",score:5}];
  const state={stage:3,collectedStars:3,activeStar:{id:"s",ordinal:4,cell:[5,1],canonicalPath:[],protectedChunks:[],seen:true},queuedStar:null,decisionSerial:0,accuracyAccumulator:.01,recentBeliefs:[]};
  const first=chooseNavigationBelief(state,routes,"same",world,7,true);assert.equal(first.belief.routeId,"toward");assert.equal(first.state.decisionSerial,0);
  const repeated=chooseNavigationBelief(first.state,routes,"same",world,7,false);assert.deepEqual(repeated.belief,first.belief);assert.equal(repeated.state.decisionSerial,0);
});

test("seeing a star replaces an earlier hidden belief instead of preserving a wrong turn",()=>{
  const open=new Set();for(let y=0;y<3;y++)for(let x=0;x<7;x++)open.add(`${x},${y}`);const world={tile:(x,y)=>open.has(`${x},${y}`)?0:1};
  const routes=[{id:"toward",direction:"straight",knownCells:[[4,1]],targetCell:[4,1],targetRegionId:null,description:"",instruction:"Go straight.",score:1},{id:"away",direction:"left",knownCells:[[1,0]],targetCell:[1,0],targetRegionId:null,description:"",instruction:"Go left.",score:5}];
  const wrong={id:"old",objectiveStage:3,junctionId:"same",routeId:"away",instruction:"Go left."};
  const state={stage:3,collectedStars:3,activeStar:{id:"s",ordinal:4,cell:[5,1],canonicalPath:[],protectedChunks:[],seen:false},queuedStar:null,decisionSerial:1,accuracyAccumulator:.1,recentBeliefs:[wrong]};
  const visible=chooseNavigationBelief(state,routes,"same",world,7,true);
  assert.equal(visible.belief.routeId,"toward");assert.equal(visible.state.decisionSerial,1);
});

test("the model-facing route omits the hidden reliability mechanism and no exit entity exists",async()=>{
  const fs=await import("node:fs/promises"),routeSource=await fs.readFile(new URL("../app/api/companion/route.ts",import.meta.url),"utf8"),objectiveSource=await fs.readFile(new URL("../app/objectives.ts",import.meta.url),"utf8");
  assert.doesNotMatch(routeSource,/accuracyAccumulator|STAGES\[|correct route|wrong route/i);assert.doesNotMatch(objectiveSource,/exit_found|exitCell|exitSprite|placeExit/i);
});
