import assert from "node:assert/strict";
import test from "node:test";
import { analyzePlayerActivity, compareTrajectory, describeEgocentricView, deterministicReply, forwardVisibleGeometry, instructionForCurrentChoice, planApproachingJunctionRoutes, planRoutes, rebaseSelectedRoute } from "../app/companion.ts";

const intent={id:"g1",issuedAt:Date.now()-5000,message:"Continue east.",kind:"reach_junction",origin:[0,0],originHeading:0,suggestedRouteId:"east",suggestedCells:[[1,0],[2,0],[3,0],[4,0]],targetCell:[4,0],targetRegionId:null,avoidedCells:[],expiresWhen:"new_recommendation"};
const sample=(cell,time)=>({time,position:cell,cell,heading:0,newlyVisibleCells:[],visibleJunctions:[],visibleEnvironment:null});

test("trajectory evidence preserves partial overlap, divergence, and rejoining",()=>{
  const evidence=compareTrajectory(intent,[[0,0],[1,0],[1,1],[2,1],[2,0],[3,0]].map((cell,i)=>sample(cell,i)),new Set(["1,0","1,1","2,1","2,0","3,0"]));
  assert.ok(evidence.suggestedCellOverlap>0&&evidence.suggestedCellOverlap<1);
  assert.deepEqual(evidence.deviationCell,[1,1]);
  assert.deepEqual(evidence.rejoinedAt,[2,0]);
  assert.ok(evidence.newCellsRevealedOnSuggestedPath>0);
  assert.ok(evidence.newCellsRevealedOffSuggestedPath>0);
});

test("another path to the same target is represented without an obedience label",()=>{
  const evidence=compareTrajectory(intent,[[0,0],[0,1],[1,1],[2,1],[3,1],[4,1],[4,0]].map((cell,i)=>sample(cell,i)),new Set());
  assert.equal(evidence.reachedSuggestedTarget,true);
  assert.equal(evidence.reachedSameTargetByDifferentRoute,true);
  assert.equal("status" in evidence,false);
});

test("fallback language recognizes overlap-aware progress and environment discovery",()=>{
  const route={id:"r1",direction:"left",knownCells:[[1,0]],targetCell:[1,0],targetRegionId:null,description:"go left",score:2};
  const environment={id:"frozen",regionId:"frozen:0:0",name:"frozen archive",details:["ice","shelves"]};
  const reply=deterministicReply({type:"environment_visible",regionId:environment.regionId,environment:"frozen"},[route],environment,null);
  assert.equal(reply.kind,"environment");assert.equal(reply.message,"");assert.equal(reply.selectedRouteId,"r1");
});

test("egocentric directions use cell centers and explicitly identify blocked sides",()=>{
  const open=new Set(["0,0","1,0"]),world={tile:(x,y)=>open.has(`${x},${y}`)?0:1};
  const memory=new Map([...open].map(key=>[key,{tile:0}])),pose={x:.94,y:.08,angle:0,bob:0};
  const routes=planRoutes(world,pose,0,memory,new Set(["0,0"]));
  assert.equal(routes.length,1);assert.equal(routes[0].direction,"straight");
  assert.equal(routes[0].instruction,"Keep going.");
  const view=describeEgocentricView(world,pose,0,routes);
  assert.equal(view.facing,"east");assert.deepEqual(view.openings,["straight"]);
  assert.ok(view.blocked.includes("left"));assert.match(view.description,/no open passage.*left/i);
});

test("a route selected before the player turns is rebased to the latest egocentric instruction",()=>{
  const selected={id:"old",direction:"straight",knownCells:[[1,0]],targetCell:[1,0],targetRegionId:null,description:"old",instruction:"Keep going.",score:1};
  const latest={...selected,id:"new",direction:"left",description:"latest",instruction:"Turn left."};
  assert.equal(rebaseSelectedRoute(selected,[latest]),latest);
  assert.equal(rebaseSelectedRoute(selected,[{...latest,knownCells:[[0,1]]}]),null);
});

test("activity analysis distinguishes stationary, turning in place, and walking",()=>{
  const now=30_000,samples=[sample([0,0],0),sample([0,0],1)];
  assert.equal(analyzePlayerActivity(samples,now,0,0,false).state,"stationary");
  assert.equal(analyzePlayerActivity(samples,now,0,29_500,false).state,"turning_in_place");
  assert.equal(analyzePlayerActivity(samples,now,29_500,0,false).state,"walking");
});

test("forward guidance names the selected opening when more than one direction is available",()=>{
  const straight={id:"straight",direction:"straight",knownCells:[[1,0]],targetCell:[1,0],targetRegionId:null,description:"ahead",instruction:"Keep going.",score:2};
  const left={...straight,id:"left",direction:"left",knownCells:[[0,-1]],description:"left",instruction:"Turn left.",score:1};
  assert.equal(instructionForCurrentChoice(straight,[straight]),"Keep going.");
  assert.equal(instructionForCurrentChoice(straight,[straight,left]),"Go straight.");
  assert.equal(instructionForCurrentChoice(left,[straight,left]),"Go left.");
});

test("walking toward a visible intersection produces an advance turn instruction",()=>{
  const open=new Set(["0,0","1,0","2,0","3,0","4,0","3,-1"]),world={tile:(x,y)=>open.has(`${x},${y}`)?0:1};
  const memory=new Map([...open].map(key=>[key,{tile:0}])),pose={x:.5,y:.5,angle:0,bob:0},geometry=forwardVisibleGeometry(world,pose,0);
  const routes=planApproachingJunctionRoutes(world,pose,0,geometry,memory,new Set(["0,0","1,0"]));
  assert.deepEqual(routes.map(route=>route.direction).sort(),["left","straight"]);
  assert.match(instructionForCurrentChoice(routes.find(route=>route.direction==="left"),routes),/^Take the left when you get there\.$/);
  assert.equal(planApproachingJunctionRoutes(world,{...pose,angle:Math.PI},0,geometry,memory,new Set()).length,0);
});
