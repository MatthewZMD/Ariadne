import assert from "node:assert/strict";
import test from "node:test";
import { InfiniteWorld, THEME_IDS, connectedTileCount, createThemeScheduler, generateChunk, portalsFor } from "../app/world.mjs";

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
    assert.equal(chunk.tiles[0][p.north],0);assert.equal(chunk.tiles[15][p.south],0);
    assert.equal(chunk.tiles[p.west][0],0);assert.equal(chunk.tiles[p.east][15],0);
  }
});

test("infinite coordinates stream through a bounded cache",()=>{
  const world=new InfiniteWorld(99);
  for(let step=-1200;step<=1200;step+=9){world.ensureAround(step,Math.floor(step*.37),step+1200);world.prune(step,Math.floor(step*.37),new Set(),step+1200);assert.ok(world.chunks.size<=49)}
  assert.equal(typeof world.tile(-10001,21007),"number");
});

test("regenerated interiors change while stable seam portals survive",()=>{
  const seed=8181,cx=-3,cy=5,a=generateChunk(seed,cx,cy,0),b=generateChunk(seed,cx,cy,1),p=portalsFor(seed,cx,cy);
  assert.equal(a.tiles[0][p.north],b.tiles[0][p.north]);assert.equal(a.tiles[p.east][15],b.tiles[p.east][15]);
  assert.notDeepEqual(a.tiles,b.tiles);
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

async function render(){
  const workerUrl=new URL("../dist/server/index.js",import.meta.url);workerUrl.searchParams.set("test",`${process.pid}-${Date.now()}`);
  const{default:worker}=await import(workerUrl.href);return worker.fetch(new Request("http://localhost/",{headers:{accept:"text/html"}}),{ASSETS:{fetch:async()=>new Response("Not found",{status:404})}},{waitUntil(){},passThroughOnException(){}});
}

async function requestCompanion(body){
  const workerUrl=new URL("../dist/server/index.js",import.meta.url);workerUrl.searchParams.set("companion-test",`${process.pid}-${Date.now()}`);
  const{default:worker}=await import(workerUrl.href);return worker.fetch(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),{ASSETS:{fetch:async()=>new Response("Not found",{status:404})}},{waitUntil(){},passThroughOnException(){}});
}

test("product shell renders without exposing checkpoints or an exit",async()=>{
  const response=await render();assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/ENTER CHAT/);assert.doesNotMatch(html,/LOCAL MEMORY/);assert.doesNotMatch(html,/checkpoint|theme|exit|you win/i);
});

test("companion route works without credentials through the in-world fallback",async()=>{
  const route={id:"r1",direction:"straight",knownCells:[[2,1]],targetCell:[2,1],targetRegionId:null,description:"continue straight",score:3};
  const response=await requestCompanion({sessionId:"test",trigger:{type:"initial_guidance"},activity:{state:"stationary",stationarySeconds:0,positionChangedSinceRecommendation:false,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"Session just started."},recommendation:null,recommendationEvidence:null,actualTrajectory:[],currentView:{summary:"one corridor"},environment:null,rememberedMap:"###\n#P.\n###",legalRoutes:[route],recentMessages:[],olderContextSummary:""});
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.source,"fallback");assert.equal(body.selectedRouteId,"r1");assert.equal(body.message,"");
});

test("companion provider is configured for OpenRouter without exposing a key",async()=>{
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../app/api/companion/route.ts",import.meta.url),"utf8"));
  assert.match(source,/https:\/\/openrouter\.ai\/api\/v1\/responses/);
  assert.match(source,/process\.env\.OPENROUTER_API_KEY/);
  assert.doesNotMatch(source,/process\.env\.OPENAI_API_KEY/);
});
