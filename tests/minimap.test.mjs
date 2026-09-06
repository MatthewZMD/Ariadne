import test from "node:test";
import assert from "node:assert/strict";
import { createMinimapMemory, forgetMinimapChunks, minimapOffset, minimapStarOffset, MINIMAP_BRANCH_SKIM_MAX_CELLS, MINIMAP_SIGHT_DISTANCE, observeMinimap, recordTraversedCell } from "../app/minimap.ts";

const world = {
  coords(x, y) { return { cx: Math.floor(x / 8), cy: Math.floor(y / 8), lx: 0, ly: 0 }; },
  tile(x, y) { return x === 2 && y === 1 ? 1 : 0; },
};

test("the minimap remembers traversed cells and only finite visible geometry", () => {
  const memory = createMinimapMemory();
  recordTraversedCell(memory, world, 0, 0);
  observeMinimap(memory, world, { x: .5, y: .5 }, 0, [[1, 0], [2, 1], [Math.ceil(MINIMAP_SIGHT_DISTANCE) + 2, 0]]);
  assert.equal(memory.get("0,0")?.source, "traversed");
  assert.equal(memory.get("1,0")?.source, "seen");
  assert.equal(memory.get("2,1")?.tile, 1);
  assert.equal(memory.has(`${Math.ceil(MINIMAP_SIGHT_DISTANCE) + 2},0`), false);
});

test("a visible intersection reveals a tapered proximity-sensitive skim before MT turns",()=>{
  const memory=createMinimapMemory(),openWorld={...world,tile(){return 0}};
  observeMinimap(memory,openWorld,{x:.5,y:.5},0,[[0,0],[1,0],[2,0]],MINIMAP_SIGHT_DISTANCE,[{cell:[2,0],open:["1,0","2,-1","2,1"]}]);
  assert.equal(memory.get("2,-1")?.source,"glimpsed");
  assert.ok(memory.get("2,-1").clarity>memory.get(`2,-${MINIMAP_BRANCH_SKIM_MAX_CELLS}`).clarity);
  assert.equal(memory.has(`2,-${MINIMAP_BRANCH_SKIM_MAX_CELLS+1}`),false,"the minimap must dissolve back into fog instead of exposing the route");
  assert.equal(memory.get("2,1")?.source,"glimpsed");

  const distant=createMinimapMemory();
  observeMinimap(distant,openWorld,{x:-6.5,y:.5},0,[[-6,0],[2,0]],MINIMAP_SIGHT_DISTANCE,[{cell:[2,0],open:["2,-1"]}]);
  assert.equal(distant.has("2,-1"),true);
  assert.equal(distant.has("2,-2"),false,"a distant branch should be only a small peripheral skim");
});

test("recycled world chunks return to fog", () => {
  const memory = createMinimapMemory();
  recordTraversedCell(memory, world, 1, 1);
  recordTraversedCell(memory, world, 9, 1);
  forgetMinimapChunks(memory, ["0,0"]);
  assert.equal(memory.has("1,1"), false);
  assert.equal(memory.has("9,1"), true);
});

test("the minimap rotates so the player's view always points north", () => {
  const eastFacingForward = minimapOffset(1, 0, 0);
  const southFacingForward = minimapOffset(0, 1, Math.PI / 2);
  for (const point of [eastFacingForward, southFacingForward]) {
    assert.ok(Math.abs(point[0]) < 1e-9);
    assert.ok(Math.abs(point[1] + 1) < 1e-9);
  }
});

test("a star appears only after MT has seen it and approached its mapped cell", () => {
  const memory = createMinimapMemory(), pose = { x: .5, y: .5, angle: 0 };
  observeMinimap(memory, world, pose, 0, [[5, 0]]);
  const star = { id: "star", ordinal: 1, cell: [5, 0], canonicalPath: [], protectedChunks: [], seen: false };
  assert.equal(minimapStarOffset(memory, pose, star), null);
  assert.ok(minimapStarOffset(memory, pose, { ...star, seen: true }));
  assert.equal(minimapStarOffset(memory, pose, { ...star, seen: true, cell: [30, 0] }), null);
});


test("visible L-shaped corridor ends reveal the turn in every orientation",()=>{
  for(let rotation=0;rotation<4;rotation++){
    const rotate=([x,y])=>rotation===0?[x,y]:rotation===1?[-y,x]:rotation===2?[-x,-y]:[y,-x];
    const corridor=[[0,0],[1,0],[2,0],[3,0],[4,0],[4,1],[4,2],[4,3],[4,4]].map(rotate);
    const floors=new Set(corridor.map(cell=>cell.join(",")));
    const elbowWorld={...world,tile(x,y){return floors.has(`${x},${y}`)?0:1}};
    const memory=createMinimapMemory();
    // Only the incoming corridor is visible; the elbow is not a junction.
    observeMinimap(memory,elbowWorld,{x:.5,y:.5},0,corridor.slice(0,5));
    assert.equal(memory.get(rotate([4,1]).join(","))?.source,"glimpsed");
    assert.equal(memory.get(rotate([4,2]).join(","))?.source,"glimpsed");
    assert.equal(memory.has(rotate([4,4]).join(",")),false);
  }
});

test("a real dead end and an unseen elbow do not reveal a turn",()=>{
  const floors=new Set(["0,0","1,0","2,0","3,0","3,1","3,2"]);
  const elbowWorld={...world,tile(x,y){return floors.has(`${x},${y}`)?0:1}};
  const unseen=createMinimapMemory();
  observeMinimap(unseen,elbowWorld,{x:.5,y:.5},0,[[0,0],[1,0],[2,0]]);
  assert.equal(unseen.has("3,1"),false);
  floors.delete("3,1");floors.delete("3,2");
  const deadEnd=createMinimapMemory();
  observeMinimap(deadEnd,elbowWorld,{x:.5,y:.5},0,[[0,0],[1,0],[2,0],[3,0]]);
  assert.equal(deadEnd.has("3,1"),false);
  assert.equal(deadEnd.has("3,-1"),false);
});


test("dead-end markers require observed topology, never the end of a skim",()=>{
  const floors=new Set(["0,0","1,0","2,0","2,1","2,2"]);
  const corridorWorld={...world,tile(x,y){return floors.has(`${x},${y}`)?0:1}};
  const memory=createMinimapMemory();
  observeMinimap(memory,corridorWorld,{x:.5,y:.5},0,[[0,0],[1,0],[2,0]]);
  assert.equal(memory.get("0,0")?.deadEnd,true);
  assert.equal(memory.get("1,0")?.deadEnd,false);
  assert.equal(memory.get("2,0")?.deadEnd,false,"the elbow is not a dead end");
  assert.equal(memory.get("2,2")?.deadEnd,undefined,"an unseen endpoint remains a glimpse");
  observeMinimap(memory,corridorWorld,{x:2.5,y:1.5},0,[[2,1],[2,2]]);
  assert.equal(memory.get("2,2")?.deadEnd,true);
  floors.add("2,3");
  observeMinimap(memory,corridorWorld,{x:2.5,y:1.5},0,[[2,2]]);
  assert.equal(memory.get("2,2")?.deadEnd,false,"a changed passage clears the old marker");
  recordTraversedCell(memory,corridorWorld,2,3);
  assert.equal(memory.get("2,3")?.deadEnd,true);
});
