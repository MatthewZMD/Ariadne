import assert from "node:assert/strict";
import test from "node:test";
import { CHUNK_SIZE, InfiniteWorld, LOGICAL_SPACING, THEME_IDS, chunkTopology, connectedTileCount, createThemeScheduler, generateChunk, portalsFor } from "../app/world.mjs";
import { MOVE_ACCELERATION } from "../app/movement.ts";

const DECISION_VISIBILITY_DISTANCE=12;

test("shared portals match across positive and negative chunk seams", () => {
  const seed=192837;
  for(let cy=-6;cy<=6;cy++)for(let cx=-6;cx<=6;cx++){
    const here=portalsFor(seed,cx,cy),east=portalsFor(seed,cx+1,cy),south=portalsFor(seed,cx,cy+1);
    assert.equal(here.east,east.west);assert.equal(here.south,south.north);
  }
});

test("every chunk has one connected walkable network containing all portals",()=>{
  const seed=314159;
  for(let cy=-8;cy<=8;cy++)for(let cx=-8;cx<=8;cx++){
    const chunk=generateChunk(seed,cx,cy,Math.abs(cx+cy)%4);
    const open=chunk.tiles.flat().filter(x=>x===0).length;
    assert.equal(connectedTileCount(chunk),open);
    const p=portalsFor(seed,cx,cy);
    assert.equal(chunk.tiles[0][p.north],0);assert.equal(chunk.tiles[CHUNK_SIZE-1][p.south],0);
    assert.equal(chunk.tiles[p.west][0],0);assert.equal(chunk.tiles[p.east][CHUNK_SIZE-1],0);
  }
});

test("long corridors separate decisions while every region preserves alternate routes",()=>{
  let cells=0,deadEnds=0,corridors=0,junctions=0,cycles=0,minCycles=Infinity;
  for(let seed=1;seed<=240;seed++){
    const topology=chunkTopology(generateChunk(seed,(seed%13)-6,(seed%17)-8,seed%4));
    cells+=topology.logicalCells;deadEnds+=topology.deadEnds;corridors+=topology.corridors;junctions+=topology.junctions;cycles+=topology.cycleRank;minCycles=Math.min(minCycles,topology.cycleRank);
  }
  assert.equal(LOGICAL_SPACING,14);
  assert.ok(LOGICAL_SPACING/MOVE_ACCELERATION.maximum>=5,"near-junction episodes must remain at least five seconds apart at maximum speed");
  assert.equal(cells/240,16);
  assert.ok(minCycles>=1,"every generated region must contain a route that reconnects instead of requiring exact backtracking");
  assert.ok(cycles/240>=1.35,`average local cycle count was only ${cycles/240}`);
  assert.ok(deadEnds/cells>=.08&&deadEnds/cells<=.2,`dead-end rate was ${deadEnds/cells}`);
  assert.ok(corridors/cells<.55,`corridor rate was ${corridors/cells}`);
  assert.ok(junctions/cells>=.28,`junction rate was only ${junctions/cells}`);
  assert.ok(junctions/240<7,`average junction count was ${junctions/240}`);
  assert.ok(junctions/(240*CHUNK_SIZE*CHUNK_SIZE)<.025,`physical decision density was ${junctions/(240*CHUNK_SIZE*CHUNK_SIZE)}`);
});

test("infinite coordinates stream through a bounded cache",()=>{
  const world=new InfiniteWorld(99);
  for(let step=-1200;step<=1200;step+=9){world.ensureAround(step,Math.floor(step*.37),step+1200);world.prune(step,Math.floor(step*.37),new Set(),step+1200);assert.ok(world.chunks.size<=49)}
  assert.equal(typeof world.tile(-10001,21007),"number");
});

test("a run-scoped entrance gate seals only the cell behind MT until the world is recycled",()=>{
  const world=new InfiniteWorld(404),forwardBefore=world.tile(2,1),gateBefore=world.tile(0,1),gate=world.setEntranceGate(1,1,1,0);
  assert.deepEqual(gate.cell,[0,1]);assert.deepEqual(gate.inside,[1,1]);assert.equal(world.tile(0,1),1);assert.equal(world.isEntranceGate(0,1),true);
  assert.equal(world.tile(2,1),forwardBefore,"installing the gate must not rewrite the route ahead");
  world.ensureAround(900,900,200);world.prune(900,900,new Set(),200);
  assert.equal(world.entranceGate,null);assert.equal(world.tile(0,1,201),gateBefore,"recycled entrance geometry returns to normal deterministic world rules");
  const recycled=new InfiniteWorld(405);assert.equal(recycled.entranceGate,null);assert.equal(recycled.isEntranceGate(0,1),false);
});

test("the starting corridor has exactly one traversable direction and opens after five seconds at maximum speed",()=>{
  const world=new InfiniteWorld(406),gate=world.setEntranceCorridor(1,1,1,0);
  assert.deepEqual(gate.facing,[1,0]);
  assert.equal(world.tile(0,1),1,"the entrance gate must seal the route behind MT");
  for(let step=0;step<LOGICAL_SPACING+DECISION_VISIBILITY_DISTANCE;step++){
    assert.equal(world.tile(1+step,0),1,`north side of entrance step ${step} must be a wall`);
    assert.equal(world.tile(1+step,2),1,`south side of entrance step ${step} must be a wall`);
    assert.equal(world.tile(2+step,1),0,`entrance must remain open ahead at step ${step}`);
  }
  const immediateNeighbors=[[2,1],[0,1],[1,0],[1,2]].filter(([x,y])=>world.tile(x,y)===0);
  assert.deepEqual(immediateNeighbors,[[2,1]]);
});

test("randomized entrances never terminate inside the camera range and join a genuine choice",()=>{
  const directions=[[1,0],[0,1],[-1,0],[0,-1]];
  for(let seed=1;seed<=256;seed++){
    const world=new InfiniteWorld(seed),[dx,dy]=directions[seed%directions.length],gate=world.setEntranceCorridor(1,1,dx,dy);
    const endpoint=gate.exit,distance=Math.abs(endpoint[0]-1)+Math.abs(endpoint[1]-1);
    assert.ok(distance>=LOGICAL_SPACING+DECISION_VISIBILITY_DISTANCE,`seed ${seed} closed after ${distance} cells`);
    const onward=[[1,0],[-1,0],[0,1],[0,-1]].filter(([nx,ny])=>!(nx===-dx&&ny===-dy)&&world.tile(endpoint[0]+nx,endpoint[1]+ny)===0);
    assert.ok(onward.length>=2,`seed ${seed} entrance joined only ${onward.length} onward route(s)`);
    assert.deepEqual(gate.facing,[dx,dy]);
  }
});

test("pruned interiors reconstruct identically within a run",()=>{
  const seed=8181,cx=-3,cy=5,a=generateChunk(seed,cx,cy,0),b=generateChunk(seed,cx,cy,1),p=portalsFor(seed,cx,cy);
  assert.equal(a.tiles[0][p.north],b.tiles[0][p.north]);assert.equal(a.tiles[p.east][CHUNK_SIZE-1],b.tiles[p.east][CHUNK_SIZE-1]);
  assert.deepEqual(a.tiles,b.tiles);
});

test("checkpoint cadence is bounded and shuffle bag prevents early repeats",()=>{
  const scheduler=createThemeScheduler(77),themes=[];let at=0;
  for(let i=0;i<18;i++){const interval=scheduler.nextAt-at;assert.ok(interval>=25&&interval<=40);at=scheduler.nextAt;themes.push(scheduler.nextTheme());scheduler.advance(at)}
  for(let i=0;i<themes.length;i+=THEME_IDS.length)assert.equal(new Set(themes.slice(i,i+THEME_IDS.length)).size,THEME_IDS.length);
});

test("theme definitions provide multiple projected wall sprites",async()=>{
  const{THEMES,THEME_FEATHER,THEME_RADIUS,themeAt,themeLayersAt,rememberedThemeAt,retainThemeMemory}=await import("../app/themes.ts");
  for(const[id,theme]of Object.entries(THEMES)){
    assert.ok(theme.wallSprites.length>=3,`${id} needs wall sprite diversity`);
    assert.equal(new Set(theme.wallSprites).size,theme.wallSprites.length);
    assert.match(theme.floorDetail,/^#[0-9a-f]{6}$/i);assert.match(theme.skyDetail,/^#[0-9a-f]{6}$/i);
  }
  const anchor={x:0,y:0,theme:"beach",bornAt:30,triggered:false};
  assert.ok(THEME_RADIUS>=36);assert.ok(THEME_FEATHER>=30);
  const far=themeAt([anchor],THEME_RADIUS-2,0),near=themeAt([anchor],8,0);
  assert.equal(far.id,"beach");assert.ok(far.influence>0&&far.influence<.1);assert.ok(near.influence>.9);
  const overlap=themeLayersAt([anchor,{...anchor,x:2,theme:"frozen"}],1,0);
  assert.equal(overlap.length,2);assert.ok(Math.abs(overlap.reduce((sum,layer)=>sum+layer.influence,0)-1)<.0001);
  assert.ok(overlap.every(layer=>layer.influence<.6),"overlapping regions should crossfade rather than replace each other");
  const appearance=new Map(),first=rememberedThemeAt([anchor],appearance,0,0),after=rememberedThemeAt([{...anchor,theme:"foundry"}],appearance,0,0);
  assert.deepEqual(after,first,"a seen location must not change when a new region is introduced");
  assert.equal(rememberedThemeAt([{...anchor,theme:"foundry"}],appearance,5,0).id,"foundry","an unseen location may reveal the new region");
  retainThemeMemory(appearance,new Set(["5,0"]));assert.equal(appearance.has("0,0"),false,"a cell outside 360 visibility and the recent trail must be reusable");
  assert.equal(rememberedThemeAt([{...anchor,theme:"foundry"}],appearance,0,0).id,"foundry","a released cell may be repurposed");
});

test("renderer includes a directional distant sky pass",async()=>{
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../app/renderer.ts",import.meta.url),"utf8"));
  assert.match(source,/function renderDistantSky/);assert.match(source,/distance>72/);assert.match(source,/anchor\.bornAt<=tick/);assert.match(source,/previewFade/);
});

test("the entrance gate is installed at run creation and rendered as spatial geometry",async()=>{
  const fs=await import("node:fs/promises"),page=await fs.readFile(new URL("../app/page.tsx",import.meta.url),"utf8"),renderer=await fs.readFile(new URL("../app/renderer.ts",import.meta.url),"utf8");
  assert.match(page,/world\.setEntranceCorridor\(1,1/);assert.match(renderer,/world\.isEntranceGate\(ray\.mapX,ray\.mapY\)/);
});

async function render(){
  const workerUrl=new URL("../dist/server/index.js",import.meta.url);workerUrl.searchParams.set("test",`${process.pid}-${Date.now()}`);
  const{default:worker}=await import(workerUrl.href);return worker.fetch(new Request("http://localhost/",{headers:{accept:"text/html"}}),{ASSETS:{fetch:async()=>new Response("Not found",{status:404})}},{waitUntil(){},passThroughOnException(){}});
}

async function requestCompanion(body){
  const workerUrl=new URL("../dist/server/index.js",import.meta.url);workerUrl.searchParams.set("companion-test",`${process.pid}-${Date.now()}`);
  const{default:worker}=await import(workerUrl.href);return worker.fetch(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),{ASSETS:{fetch:async()=>new Response("Not found",{status:404})}},{waitUntil(){},passThroughOnException(){}});
}

test("product shell promises the search without claiming the exit was found",async()=>{
  const response=await render();assert.equal(response.status,200);const html=await response.text();
  assert.doesNotMatch(html,/ENTER CHAT|CAM_01|NEW SIGNAL/);assert.match(html,/Follow Ariadne and find the exit!/);assert.match(html,/☆☆☆☆/);assert.doesNotMatch(html,/LOCAL MEMORY/);assert.doesNotMatch(html,/checkpoint|theme|you (?:found|reached) the exit|you win/i);
});

test("companion route works without credentials through the in-world fallback",async()=>{
  const route={id:"r1",direction:"straight",knownCells:[[2,1]],targetCell:[2,1],targetRegionId:null,description:"continue straight",instruction:"Keep going.",score:3};
  const belief={id:"b1",objectiveStage:0,junctionId:"start",routeId:"r1",instruction:"Keep going."};
  const perceivedScene={setting:{primaryEnvironment:"neutral",blendedEnvironments:["neutral"],visibleDetails:["the shifting maze"]},geometry:{facingDescription:"MT is facing east",visibleOpenings:[{direction:"straight",description:"an open passage ahead"}],visibleEndAhead:false,visibleJunction:false},objects:[],spectacles:[],objective:{starVisible:false,starDirection:null,starDistance:null},mtAttention:{lookingToward:null,approaching:null,movingAwayFrom:null,pausedNear:null}};
  const embodiment={currentAction:"You are floating naturally beside MT's right shoulder.",positionRelativeToMT:"beside MT's right shoulder",relationToBelievedRoute:null,mtLookingAtAriadne:false,mtApproachingAriadne:false,mtFollowingHerLead:false,mtLeavingWhileSheWaits:false,mtReturningToHer:false};
  const response=await requestCompanion({sessionId:"test",trigger:{type:"initial_guidance"},speechAnchor:{episodeId:null,episodeState:null,speechAct:"passing_companionship",speechEpoch:0},dispositionCard:"You are warmly confident and allowing MT room.",activity:{state:"stationary",stationarySeconds:0,positionChangedSinceRecommendation:false,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"Session just started."},recommendation:null,recommendationEvidence:null,actualTrajectory:[],currentView:{facing:"east",centerView:"a corridor",openings:["straight"],blocked:["left","right","back"],description:"MT faces an open corridor."},environment:null,perceivedScene,sceneChanges:[],rememberedMap:"###\n#P.\n###",legalRoutes:[route],recentMessages:[],olderContextSummary:"",companionArc:{phase:"charming",performanceDirection:"You are making a charming first impression.",relationshipContext:"Nothing has happened yet."},objective:{collectedStars:0,currentGoal:"first_star",activeStarVisible:false,latestEvent:"searching"},navigationBelief:belief,embodiment});
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.source,"fallback");assert.equal(body.selectedRouteId,undefined);assert.match(body.message,/MT—hi! I’m Ariadne/);assert.match(body.message,/wake it/);
});

test("companion provider is configured for OpenRouter without exposing a key",async()=>{
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../app/api/companion/route.ts",import.meta.url),"utf8"));
  assert.match(source,/https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
  assert.match(source,/process\.env\.OPENROUTER_API_KEY/);
  assert.doesNotMatch(source,/process\.env\.OPENAI_API_KEY/);
});

test("each browser run owns an opaque companion session instead of reusing the map seed",async()=>{
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../app/page.tsx",import.meta.url),"utf8"));
  assert.match(source,/companionSessionRef=useRef\(crypto\.randomUUID\(\)\)/);
  assert.match(source,/companionSessionRef\.current=crypto\.randomUUID\(\)/);
  assert.match(source,/sessionId:companionSessionRef\.current/);
  assert.doesNotMatch(source,/sessionId:String\(current\.seed\)/);
});
