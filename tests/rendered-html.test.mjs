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

async function render(){
  const workerUrl=new URL("../dist/server/index.js",import.meta.url);workerUrl.searchParams.set("test",`${process.pid}-${Date.now()}`);
  const{default:worker}=await import(workerUrl.href);return worker.fetch(new Request("http://localhost/",{headers:{accept:"text/html"}}),{ASSETS:{fetch:async()=>new Response("Not found",{status:404})}},{waitUntil(){},passThroughOnException(){}});
}

test("product shell renders without exposing checkpoints or an exit",async()=>{
  const response=await render();assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/NULL/);assert.match(html,/LOCAL MEMORY/);assert.doesNotMatch(html,/checkpoint|theme|exit|you win/i);
});
