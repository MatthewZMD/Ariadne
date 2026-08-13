import assert from "node:assert/strict";
import test from "node:test";
import { analyzePlayerActivity, companionArc, companionCooldownMs, compareTrajectory, describeEgocentricView, deterministicReply, forwardVisibleGeometry, guidanceRelationship, instructionForCurrentChoice, nextPassingThoughtAt, nextPerceptionCue, planRoutes, planVisibleJunctionRoutes, rebaseSelectedRoute, relationshipCue, routesForEvent, shouldTriggerPassingThought } from "../app/companion.ts";

const intent={id:"g1",issuedAt:Date.now()-5000,message:"Continue east.",kind:"reach_junction",origin:[0,0],originHeading:0,suggestedRouteId:"east",suggestedCells:[[1,0],[2,0],[3,0],[4,0]],targetCell:[4,0],targetRegionId:null,avoidedCells:[],decisionCell:[0,0],expectedChoiceCell:[1,0],expiresWhen:"new_recommendation"};
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

test("the player's branch choice resolves the social relationship with guidance",()=>{
  const evidence=compareTrajectory(intent,[sample([0,0],0),sample([1,0],1)],new Set());
  assert.equal(guidanceRelationship(intent,[sample([0,0],0),sample([1,0],1)],evidence),"accepted_suggestion");
  const alternate=[sample([0,0],0),sample([0,1],1)],alternateEvidence=compareTrajectory(intent,alternate,new Set());
  assert.equal(guidanceRelationship(intent,alternate,alternateEvidence),"chose_another_way");
  assert.equal(relationshipCue(intent,alternate,alternateEvidence,new Set()).event.relationship,"chose_another_way");
});

test("walking toward an upcoming choice does not count as accepting it",()=>{
  const upcoming={...intent,decisionCell:[2,0],expectedChoiceCell:[2,-1],suggestedCells:[[1,0],[2,0],[2,-1]],targetCell:[2,-1]};
  const approach=[sample([0,0],0),sample([1,0],1),sample([2,0],2)],evidence=compareTrajectory(upcoming,approach,new Set());
  assert.equal(guidanceRelationship(upcoming,approach,evidence),null);
  const choice=[...approach,sample([2,-1],3)],choiceEvidence=compareTrajectory(upcoming,choice,new Set());
  assert.equal(guidanceRelationship(upcoming,choice,choiceEvidence),"accepted_suggestion");
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
  const routes=planVisibleJunctionRoutes(world,pose,0,geometry,memory,new Set(["0,0","1,0"]));
  assert.deepEqual(routes.map(route=>route.direction).sort(),["left","straight"]);
  assert.match(instructionForCurrentChoice(routes.find(route=>route.direction==="left"),routes),/^Take the left when you get there\.$/);
  assert.deepEqual(planVisibleJunctionRoutes(world,{...pose,angle:Math.PI},0,geometry,memory,new Set()).map(route=>route.direction).sort(),["left","straight"]);
});

test("visible-junction routing follows a bent visible corridor instead of requiring axis alignment",()=>{
  const open=new Set(["0,0","1,0","1,1","2,1","3,1","2,0","2,2"]),world={tile:(x,y)=>open.has(`${x},${y}`)?0:1};
  const memory=new Map([...open].map(key=>[key,{tile:0}])),pose={x:.5,y:.5,angle:0,bob:0};
  const geometry={cells:[[0,0],[1,0],[1,1],[2,1]],junctions:[{id:"junction:2,1",cell:[2,1],open:["1,1","3,1","2,0","2,2"]}],corridorEnds:[],summary:""};
  const routes=planVisibleJunctionRoutes(world,pose,0,geometry,memory,new Set());
  assert.equal(routes.length,3);assert.deepEqual(routes[0].knownCells.slice(0,3),[[1,0],[1,1],[2,1]]);
});

test("sight cues cover visible choices and visible endings once",()=>{
  const junction={cells:[[0,0]],junctions:[{id:"junction:0,0",cell:[0,0],open:["1,0","0,1","-1,0"]}],corridorEnds:[],summary:""},seen=new Set();
  const choice=nextPerceptionCue(junction,null,null,seen);assert.equal(choice.event.type,"new_junction_visible");seen.add(choice.key);assert.equal(nextPerceptionCue(junction,null,null,seen),null);
  const ending={cells:[[1,0]],junctions:[],corridorEnds:[[1,0]],summary:""};
  assert.equal(nextPerceptionCue(ending,null,null,seen).event.type,"dead_end_visible");
});

test("a visible end is detected before collision and removed from guidance",()=>{
  const open=new Set(["0,0","1,0","2,0"]),world={tile:(x,y)=>open.has(`${x},${y}`)?0:1},pose={x:.5,y:.5,angle:0,bob:0};
  assert.deepEqual(forwardVisibleGeometry(world,pose,0).corridorEnds[0],[2,0]);
  const towardEnd={id:"end",direction:"straight",knownCells:[[1,0],[2,0]],targetCell:[2,0],targetRegionId:null,description:"",instruction:"Keep going.",score:1};
  const escape={...towardEnd,id:"escape",direction:"back",knownCells:[[-1,0]],targetCell:[-1,0]};
  assert.deepEqual(routesForEvent({type:"dead_end_visible",cell:[2,0]},[towardEnd,escape],[]),[escape]);
});

test("Ariadne grows more attached and increasingly unable to leave silence alone",()=>{
  assert.equal(companionArc({spokenMessages:0,guidanceFailures:0,resolvedChoices:0}).phase,"charming");
  assert.equal(companionArc({spokenMessages:4,guidanceFailures:1,resolvedChoices:0}).phase,"attached");
  assert.equal(companionArc({spokenMessages:8,guidanceFailures:2,resolvedChoices:0}).phase,"overbearing");
  assert.equal(nextPassingThoughtAt(1_000,"charming",0),23_000);assert.equal(nextPassingThoughtAt(1_000,"charming",1),41_000);
  assert.equal(nextPassingThoughtAt(1_000,"attached",0),14_000);assert.equal(nextPassingThoughtAt(1_000,"overbearing",0),8_000);
  assert.deepEqual([companionCooldownMs("charming"),companionCooldownMs("attached"),companionCooldownMs("overbearing")],[12000,9000,6000]);
});

test("spontaneous thoughts continue through pauses but not active turning",()=>{
  const walking={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player is walking."};
  assert.equal(shouldTriggerPassingThought(walking,14_999,15_000),false);assert.equal(shouldTriggerPassingThought(walking,15_000,15_000),true);
  assert.equal(shouldTriggerPassingThought({...walking,state:"stationary"},30_000,15_000),true);
  assert.equal(shouldTriggerPassingThought({...walking,state:"turning_in_place"},30_000,15_000),false);
});
