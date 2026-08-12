import assert from "node:assert/strict";
import test from "node:test";
import { compareTrajectory, deterministicReply } from "../app/companion.ts";

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
  const reply=deterministicReply({type:"environment_visible",regionId:environment.regionId,environment:"frozen"},[route],environment,null,[]);
  assert.equal(reply.kind,"environment");assert.match(reply.message,/frozen archive/i);assert.equal(reply.selectedRouteId,"r1");
});
