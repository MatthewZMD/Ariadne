import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzePlayerActivity, appendGuidanceTrace, centeredDeadEnd, companionArc,
  companionCooldownMs, createGuidanceTrace, createJourneyState, describeEgocentricView,
  deterministicReply, forwardVisibleGeometry, guidanceTraceExpired,
  instructionForCurrentChoice, isRecentCompanionRepeat, markTrajectoryChange, nearestVisibleJunction,
  nextPassingThoughtAt, nextPerceptionCue, planRoutes, planVisibleJunctionRoutes,
  rebaseSelectedRoute, recordJourneyEncounter, routesForEvent,
  shouldTriggerPassingThought, trajectoryCue, updateJourney,
} from "../app/companion.ts";
import { isFreeCompanionModel } from "../app/api/companion/route.ts";
import { ARIADNE_SYSTEM_PROMPT } from "../app/api/companion/prompt.ts";

const intent={id:"g1",issuedAt:0,message:"Continue east.",kind:"reach_junction",origin:[0,0],originHeading:0,suggestedRouteId:"east",suggestedCells:[[1,0],[2,0],[3,0],[4,0]],targetCell:[4,0],targetRegionId:null,avoidedCells:[],decisionCell:[0,0],expectedChoiceCell:[1,0],expiresWhen:"new_recommendation"};
const sample=(cell,time=0,movementState="walking",newlyVisibleCells=[])=>({time,position:cell,cell,heading:0,newlyVisibleCells,visibleJunctions:[],visibleEnvironment:null,movementState});
const route={id:"r1",direction:"left",knownCells:[[1,0]],targetCell:[1,0],targetRegionId:null,description:"go left",instruction:"Turn left.",score:2};

test("brief deviations remain ambiguous",()=>{
  let trace=createGuidanceTrace(intent);
  trace=appendGuidanceTrace(trace,sample([1,0]),2);
  trace=appendGuidanceTrace(trace,sample([1,2]),2);
  assert.equal(trajectoryCue(trace),null);
  assert.equal("status" in trace.evidence,false);
});

test("sustained divergence is emitted once and rejoining is preserved later",()=>{
  let trace=createGuidanceTrace(intent);
  for(const cell of [[1,2],[2,2],[3,2],[4,2]])trace=appendGuidanceTrace(trace,sample(cell),2);
  const divergence=trajectoryCue(trace);
  assert.equal(divergence.event.change,"sustained_divergence");
  trace=markTrajectoryChange(trace,divergence.event.change);
  assert.equal(trajectoryCue(trace),null);
  trace=appendGuidanceTrace(trace,sample([4,1]),1);
  trace=appendGuidanceTrace(trace,sample([4,0]),1);
  assert.deepEqual(trace.evidence.latestRejoinCell,[4,0]);
  assert.equal(trajectoryCue(trace).event.change,"same_waypoint_different_route");
  trace=markTrajectoryChange(trace,"same_waypoint_different_route");
  assert.equal(trajectoryCue(trace).event.change,"left_then_rejoined");
});

test("sustained alignment requires time and several cells",()=>{
  let trace=createGuidanceTrace(intent);
  trace=appendGuidanceTrace(trace,sample([1,0]),2);
  trace=appendGuidanceTrace(trace,sample([2,0]),3);
  assert.equal(trajectoryCue(trace).event.change,"sustained_alignment");
});

test("the same waypoint through another route remains a factual vector",()=>{
  let trace=createGuidanceTrace(intent);
  for(const cell of [[0,1],[1,1],[2,1],[3,1],[4,1],[4,0]])trace=appendGuidanceTrace(trace,sample(cell),1);
  assert.equal(trace.evidence.reachedSameWaypointDifferently,true);
  assert.equal(trace.evidence.suggestedCellOverlap<.5,true);
  assert.equal(trajectoryCue(trace).event.change,"same_waypoint_different_route");
});

test("trace bounds detail while retaining evidence and expires by active travel",()=>{
  let trace=createGuidanceTrace(intent);
  for(let index=0;index<55;index++)trace=appendGuidanceTrace(trace,sample([index%2?2:1,0],index*5000),2,false,index===2);
  assert.equal(trace.samples.length,40);
  assert.equal(trace.evidence.familiarGeometryReached,true);
  assert.equal(trace.evidence.activeSeconds,110);
  assert.equal(guidanceTraceExpired(trace),true);
});

test("stationary and turning samples do not add effective travel",()=>{
  let trace=createGuidanceTrace(intent);
  trace=appendGuidanceTrace(trace,sample([0,0],0,"stationary"),5);
  trace=appendGuidanceTrace(trace,sample([0,0],5000,"turning"),5);
  assert.equal(trace.activeSeconds,0);
});

test("journey phases require movement, variety, encounters, and friction",()=>{
  let journey=createJourneyState();
  journey=updateJourney(journey,0,100);
  assert.equal(journey.phase,"charming");
  journey=updateJourney(journey,300,80);
  journey=recordJourneyEncounter(journey,"new_junction");
  journey=recordJourneyEncounter(journey,"new_environment");
  journey=recordJourneyEncounter(journey,"sustained_divergence");
  assert.equal(journey.phase,"attached");
  journey=updateJourney(journey,480,130);
  for(const kind of ["visible_dead_end","familiar_place","route_reconnection","left_then_rejoined","recommendation_visibly_contradicted"])journey=recordJourneyEncounter(journey,kind);
  assert.equal(journey.phase,"overbearing");
  assert.equal(journey.meaningfulEncounters,8);
});

test("phase cards change social interpretation rather than only frequency",()=>{
  const charming=companionArc(createJourneyState()).performanceDirection;
  const attached=companionArc({...createJourneyState(),phase:"attached"}).performanceDirection;
  const overbearing=companionArc({...createJourneyState(),phase:"overbearing"}).performanceDirection;
  assert.match(charming,/earn MT's trust/i);
  assert.match(attached,/movement now feels personal/i);
  assert.match(overbearing,/intimacy pressure/i);
  assert.doesNotMatch(`${charming} ${attached} ${overbearing}`,/CHARMING|ATTACHED|OVERBEARING/);
  assert.equal(nextPassingThoughtAt(1_000,"charming",0),41_000);
  assert.equal(nextPassingThoughtAt(1_000,"attached",0),31_000);
  assert.equal(nextPassingThoughtAt(1_000,"overbearing",0),23_000);
  assert.deepEqual([companionCooldownMs("charming"),companionCooldownMs("attached"),companionCooldownMs("overbearing")],[12000,9000,6000]);
});

test("fallback and prompt preserve MT and never announce an exit",()=>{
  const greeting=deterministicReply({type:"initial_guidance"},[route],null,null);
  assert.equal(greeting.message,"Hi, MT—I’m Ariadne. I’m here to help you find four stars, then the exit.");
  const environment={id:"frozen",regionId:"frozen:0:0",name:"frozen archive",details:["ice","shelves"]};
  assert.match(deterministicReply({type:"environment_visible",regionId:environment.regionId,environment:"frozen"},[route],environment,null).message,/frozen archive/i);
  assert.match(ARIADNE_SYSTEM_PROMPT,/player's only name and direct form of address/i);
  assert.doesNotMatch(ARIADNE_SYSTEM_PROMPT,/PLAYER:/);
  assert.doesNotMatch(greeting.message,/found the exit/i);
});

test("recent exact Ariadne lines are suppressed without confusing MT text",()=>{
  const messages=[
    {id:"1",role:"ariadne",text:"Oh—that closes ahead. I’m changing my mind.",time:1},
    {id:"2",role:"player",text:"Oh—that closes ahead. I’m changing my mind.",time:2},
  ];
  assert.equal(isRecentCompanionRepeat("Oh, that closes ahead—I’m changing my mind!",messages),true);
  assert.equal(isRecentCompanionRepeat("Take the opening on your right.",messages),false);
  assert.equal(isRecentCompanionRepeat("MT said this.",[{id:"3",role:"player",text:"MT said this.",time:3}]),false);
});

test("free companion allowlist requires zero price, text, context, and optional reasoning",()=>{
  const free={id:"example/model:free",context_length:32768,architecture:{input_modalities:["text"],output_modalities:["text"]},pricing:{prompt:"0",completion:"0",request:"0"},supported_parameters:["reasoning"],reasoning:{mandatory:false,default_enabled:false}};
  assert.equal(isFreeCompanionModel(free),true);
  assert.equal(isFreeCompanionModel({...free,pricing:{...free.pricing,completion:"0.1"}}),false);
  assert.equal(isFreeCompanionModel({...free,reasoning:{mandatory:true}}),false);
  assert.equal(isFreeCompanionModel({...free,expiration_date:"2020-01-01"}),false);
});

test("egocentric directions use cell centers and identify blocked sides",()=>{
  const open=new Set(["0,0","1,0"]),world={tile:(x,y)=>open.has(`${x},${y}`)?0:1};
  const memory=new Map([...open].map(key=>[key,{tile:0}])),pose={x:.94,y:.08,angle:0,bob:0};
  const routes=planRoutes(world,pose,0,memory,new Set(["0,0"]));
  assert.equal(routes[0].direction,"straight");
  const view=describeEgocentricView(world,pose,0,routes);
  assert.deepEqual(view.openings,["straight"]);assert.ok(view.blocked.includes("left"));
});

test("selected routes are rebased to the latest egocentric instruction",()=>{
  const selected={...route,id:"old",direction:"straight",instruction:"Keep going."};
  const latest={...selected,id:"new",direction:"left",instruction:"Turn left."};
  assert.equal(rebaseSelectedRoute(selected,[latest]),latest);
  assert.equal(rebaseSelectedRoute(selected,[{...latest,knownCells:[[0,1]]}]),null);
});

test("activity distinguishes stationary, turning, and walking",()=>{
  const now=30_000,samples=[sample([0,0],0),sample([0,0],1)];
  assert.equal(analyzePlayerActivity(samples,now,0,0,false).state,"stationary");
  assert.equal(analyzePlayerActivity(samples,now,0,29_500,false).state,"turning_in_place");
  assert.equal(analyzePlayerActivity(samples,now,29_500,0,false).state,"walking");
});

test("multiple openings receive an explicit selected direction",()=>{
  const straight={...route,id:"straight",direction:"straight",instruction:"Keep going."};
  const left={...route,id:"left",direction:"left",instruction:"Turn left."};
  assert.equal(instructionForCurrentChoice(straight,[straight]),"Keep going.");
  assert.equal(instructionForCurrentChoice(straight,[straight,left]),"Go straight.");
  assert.equal(instructionForCurrentChoice(left,[straight,left]),"Go left.");
});

test("a visible intersection produces advance turn options",()=>{
  const open=new Set(["0,0","1,0","2,0","3,0","4,0","3,-1"]),world={tile:(x,y)=>open.has(`${x},${y}`)?0:1};
  const memory=new Map([...open].map(key=>[key,{tile:0}])),pose={x:.5,y:.5,angle:0,bob:0},geometry=forwardVisibleGeometry(world,pose,0);
  const routes=planVisibleJunctionRoutes(world,pose,0,geometry,memory,new Set(["0,0","1,0"]));
  assert.deepEqual(routes.map(item=>item.direction).sort(),["left","straight"]);
  assert.match(instructionForCurrentChoice(routes.find(item=>item.direction==="left"),routes),/^Take the passage on your left when you get there\.$/);
});

test("multiple visible passages on one side receive grounded ordinals",()=>{
  const open=new Set(["0,0","1,0","2,0","3,0","4,0","5,0","2,-1","4,-1"]),world={tile:(x,y)=>open.has(`${x},${y}`)?0:1};
  const memory=new Map([...open].map(key=>[key,{tile:0}])),pose={x:.5,y:.5,angle:0,bob:0};
  const geometry={cells:[...open].map(key=>key.split(",").map(Number)),junctions:[{id:"junction:2,0",cell:[2,0],open:["1,0","3,0","2,-1"]},{id:"junction:4,0",cell:[4,0],open:["3,0","5,0","4,-1"]}],corridorEnds:[],summary:""};
  const left=planVisibleJunctionRoutes(world,pose,0,geometry,memory,new Set()).filter(route=>route.direction==="left").sort((a,b)=>a.openingOrdinal-b.openingOrdinal);
  assert.equal(left.length,2);
  assert.deepEqual(left.map(route=>route.openingOrdinal),[1,2]);
  assert.deepEqual(left.map(route=>route.instruction),["Take the first passage on your left.","Take the second passage on your left."]);
});

test("an opening beside MT counts before a farther opening on the same side",()=>{
  const open=new Set(["-1,0","0,0","0,-1","1,0","2,0","3,0","2,-1"]),world={tile:(x,y)=>open.has(`${x},${y}`)?0:1};
  const memory=new Map([...open].map(key=>[key,{tile:0}])),pose={x:.5,y:.5,angle:0,bob:0};
  const geometry={cells:[...open].map(key=>key.split(",").map(Number)),junctions:[{id:"junction:0,0",cell:[0,0],open:["-1,0","1,0","0,-1"]},{id:"junction:2,0",cell:[2,0],open:["1,0","3,0","2,-1"]}],corridorEnds:[],summary:""};
  const left=planVisibleJunctionRoutes(world,pose,0,geometry,memory,new Set()).filter(route=>route.direction==="left").sort((a,b)=>a.openingOrdinal-b.openingOrdinal);
  assert.equal(left[0].decisionPoint,"current");
  assert.equal(left[0].instruction,"Take the first passage on your left.");
  assert.equal(left[1].instruction,"Take the second passage on your left.");
});

test("visible-junction routing follows a bent visible corridor",()=>{
  const open=new Set(["0,0","1,0","1,1","2,1","3,1","2,0","2,2"]),world={tile:(x,y)=>open.has(`${x},${y}`)?0:1};
  const memory=new Map([...open].map(key=>[key,{tile:0}])),pose={x:.5,y:.5,angle:0,bob:0};
  const geometry={cells:[[0,0],[1,0],[1,1],[2,1]],junctions:[{id:"junction:2,1",cell:[2,1],open:["1,1","3,1","2,0","2,2"]}],corridorEnds:[],summary:""};
  const routes=planVisibleJunctionRoutes(world,pose,0,geometry,memory,new Set());
  assert.equal(routes.length,3);assert.deepEqual(routes[0].knownCells.slice(0,3),[[1,0],[1,1],[2,1]]);
});

test("dead ends are visible before collision and remove invalid guidance",()=>{
  const open=new Set(["0,0","1,0","2,0"]),world={tile:(x,y)=>open.has(`${x},${y}`)?0:1},pose={x:.5,y:.5,angle:0,bob:0};
  const geometry=forwardVisibleGeometry(world,pose,0);
  assert.deepEqual(geometry.corridorEnds[0],[2,0]);
  const towardEnd={...route,id:"end",direction:"straight",knownCells:[[1,0],[2,0]],targetCell:[2,0]};
  const escape={...route,id:"escape",direction:"back",knownCells:[[-1,0]],targetCell:[-1,0]};
  assert.deepEqual(routesForEvent({type:"dead_end_visible",cell:[2,0]},[towardEnd,escape],[]),[escape]);
  assert.deepEqual(centeredDeadEnd(world,geometry,pose,0),[2,0]);
  assert.equal(centeredDeadEnd(world,geometry,{...pose,angle:Math.PI/2},0),null);
});

test("perception episodes deduplicate junctions but expose corridor endings",()=>{
  const junction={cells:[[0,0]],junctions:[{id:"junction:0,0",cell:[0,0],open:["1,0","0,1","-1,0"]}],corridorEnds:[],summary:""};
  assert.equal(nearestVisibleJunction(junction,{x:2.5,y:.5,angle:0,bob:0}).id,"junction:0,0");
  assert.equal(nextPerceptionCue(junction,null,null,new Set()),null);
  const ending={cells:[[1,0]],junctions:[],corridorEnds:[[1,0]],summary:""};
  assert.equal(nextPerceptionCue(ending,null,null,new Set()).event.type,"dead_end_visible");
});

test("spontaneous thoughts require actual walking",()=>{
  const walking={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"MT is walking."};
  assert.equal(shouldTriggerPassingThought(walking,14_999,15_000),false);
  assert.equal(shouldTriggerPassingThought(walking,15_000,15_000),true);
  assert.equal(shouldTriggerPassingThought({...walking,state:"stationary"},30_000,15_000),false);
});
