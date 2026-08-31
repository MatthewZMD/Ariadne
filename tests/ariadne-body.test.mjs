import assert from "node:assert/strict";
import test from "node:test";
import { beginAriadneGuidance, beginAriadneRoute, cancelAriadneChoiceNotice, createAriadneBody, describeAriadneEmbodiment, noticeAriadneChoice, prepareAriadneForEvent, settleAriadneThinking, speakAsAriadne, updateAriadneBody } from "../app/ariadne-body.ts";

const openWorld={tile(){return 0}};
const pose={x:1.5,y:1.5,angle:0};
const intent={id:"g",issuedAt:1000,message:"Take the second passage on your left.",kind:"reach_junction",origin:[1,1],originHeading:0,suggestedRouteId:"second-left",suggestedCells:[[2,1],[3,1],[4,1]],targetCell:[4,1],targetRegionId:null,avoidedCells:[],decisionCell:[2,1],expectedChoiceCell:[3,1],expiresWhen:"new_recommendation"};

test("Ariadne settles beside MT with spring motion instead of locking to the camera",()=>{
  const body=createAriadneBody(pose,0),start=[...body.position];
  for(let i=0;i<60;i++)updateAriadneBody(body,{world:openWorld,tick:0,pose:{...pose,x:2.3},phase:"charming",dt:1/60,now:i*1000/60,reducedMotion:false});
  assert.notDeepEqual(body.position,start);assert.ok(Math.hypot(body.position[0]-2.3,body.position[1]-1.5)<1.5);assert.equal(body.mode,"hovering_beside");
});

test("idle hovering follows a continuous damped path without pixel-sized position jumps",()=>{
  const body=createAriadneBody(pose,0);let previous=[...body.position],travel=0,maxStep=0,minHeight=Infinity,maxHeight=-Infinity,minLateral=Infinity,maxLateral=-Infinity;
  for(let i=1;i<=480;i++){updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:1/60,now:i*1000/60,reducedMotion:false});const step=Math.hypot(body.position[0]-previous[0],body.position[1]-previous[1]);travel+=step;maxStep=Math.max(maxStep,step);minHeight=Math.min(minHeight,body.height);maxHeight=Math.max(maxHeight,body.height);minLateral=Math.min(minLateral,body.position[1]);maxLateral=Math.max(maxLateral,body.position[1]);previous=[...body.position]}
  assert.ok(travel>.18,`hover was not visibly alive: ${travel}`);assert.ok(maxLateral-minLateral>.08,`hover lacked a fairy-like lateral orbit: ${maxLateral-minLateral}`);assert.ok(maxHeight-minHeight>.04,`hover lacked a fairy-like rise and dip: ${maxHeight-minHeight}`);assert.ok(maxStep<.018,`hover step was too abrupt: ${maxStep}`);
});

test("reduced motion preserves a gentle living hover instead of freezing Ariadne to MT",()=>{
  const body=createAriadneBody(pose,0),start=[...body.position];
  for(let i=1;i<=240;i++)updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:1/60,now:i*1000/60,reducedMotion:true});
  const travel=Math.hypot(body.position[0]-start[0],body.position[1]-start[1]);assert.ok(travel>.003,`reduced-motion hover was frozen: ${travel}`);assert.ok(travel<.08,`reduced-motion hover was too active: ${travel}`);
});

test("guidance makes Ariadne fly to the supplied route and return when MT enters it",()=>{
  const body=createAriadneBody(pose,0);beginAriadneGuidance(body,intent,1000);
  for(let i=0;i<100;i++)updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:1/60,now:1000+i*1000/60,reducedMotion:false});
  assert.ok(body.mode==="leading"||body.mode==="waiting_ahead");assert.equal(body.targetRouteId,"second-left");assert.ok(body.position[0]>2.2);
  for(const [index,x] of [2.5,3.5,4.5,5.5].entries())updateAriadneBody(body,{world:openWorld,tick:0,pose:{...pose,x},phase:"charming",dt:1/30,now:2900+index*34,reducedMotion:false});
  assert.ok(["returning","catching_up","celebrating","hovering_beside"].includes(body.mode));assert.equal(body.mtFollowingHerLead,true);
});

test("MT cannot outrun Ariadne while she is physically committing to a passage",()=>{
  const body=createAriadneBody(pose,0),route={id:"ahead",knownCells:[[2,1],[3,1],[4,1],[5,1]],decisionCell:[4,1],targetCell:[5,1],decisionPoint:"upcoming"};
  beginAriadneRoute(body,route,pose,0);let movingPose={...pose},smallestLead=Infinity;
  for(let frame=1;frame<=88;frame++){
    movingPose={...movingPose,x:movingPose.x+2.65/60};
    updateAriadneBody(body,{world:openWorld,tick:0,pose:movingPose,phase:"charming",playerSpeed:2.65,dt:1/60,now:frame*1000/60,reducedMotion:false});
    smallestLead=Math.min(smallestLead,body.position[0]-movingPose.x);
  }
  assert.ok(smallestLead>0,`MT passed Ariadne during her commitment by ${-smallestLead} cells`);
});

test("Ariadne's ordinary fairy hover keeps pace with MT at maximum walking speed",()=>{
  const body=createAriadneBody(pose,0);let movingPose={...pose},furthestBehind=0,maxDistance=0;
  for(let frame=1;frame<=300;frame++){
    movingPose={...movingPose,x:movingPose.x+2.65/60};
    updateAriadneBody(body,{world:openWorld,tick:0,pose:movingPose,phase:"charming",playerSpeed:2.65,dt:1/60,now:frame*1000/60,reducedMotion:false});
    furthestBehind=Math.min(furthestBehind,body.position[0]-movingPose.x);maxDistance=Math.max(maxDistance,Math.hypot(body.position[0]-movingPose.x,body.position[1]-movingPose.y));
  }
  assert.ok(furthestBehind>-.32,`Ariadne was dropped behind MT by ${-furthestBehind} cells`);assert.ok(maxDistance<1.35,`Ariadne drifted too far from MT: ${maxDistance}`);assert.equal(body.mode,"hovering_beside");
});

test("a distant junction is approached inside a bounded moving lead envelope",()=>{
  const body=createAriadneBody(pose,0),route={id:"far-ahead",knownCells:[[2,1],[3,1],[4,1],[5,1],[6,1]],decisionCell:[5,1],targetCell:[6,1],decisionPoint:"upcoming"};beginAriadneRoute(body,route,pose,0);let movingPose={...pose},maxSeparation=0;
  for(let frame=1;frame<=180;frame++){
    movingPose={...movingPose,x:movingPose.x+1.65/60};
    updateAriadneBody(body,{world:openWorld,tick:0,pose:movingPose,phase:"charming",playerSpeed:1.65,dt:1/60,now:frame*1000/60,reducedMotion:false});
    maxSeparation=Math.max(maxSeparation,Math.hypot(body.position[0]-movingPose.x,body.position[1]-movingPose.y));
  }
  assert.ok(maxSeparation<3.05,`Ariadne abandoned MT for a distant junction: ${maxSeparation}`);
});

test("a side turn is previewed in MT's forward view before the intersection",()=>{
  const body=createAriadneBody(pose,0),route={id:"left-ahead",knownCells:[[2,1],[3,1],[4,1],[5,1],[6,1],[6,0]],decisionCell:[6,1],targetCell:[6,0],decisionPoint:"upcoming"};
  beginAriadneRoute(body,route,pose,0);
  for(let frame=1;frame<=75;frame++)updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:1/60,now:frame*1000/60,reducedMotion:false});
  const bearing=Math.atan2(body.position[1]-pose.y,body.position[0]-pose.x),relative=Math.atan2(Math.sin(bearing-pose.angle),Math.cos(bearing-pose.angle));
  assert.ok(body.position[1]<1.48,`Ariadne did not lean toward the upcoming left branch: ${body.position[1]}`);
  assert.ok(Math.abs(relative)<Math.PI/5,`Ariadne previewed the turn outside MT's forward view: ${relative}`);
});

test("Ariadne visibly crosses to the actual side passage instead of collapsing to shoulder hover",()=>{
  const route={id:"left-now",knownCells:[[2,1],[3,1],[4,1],[4,0]],decisionCell:[4,1],targetCell:[4,0],decisionPoint:"upcoming"},body=createAriadneBody(pose,0);beginAriadneRoute(body,route,pose,0);
  let currentPose={...pose};for(let frame=1;frame<=90;frame++){currentPose={...currentPose,x:Math.min(4.5,currentPose.x+.045)};updateAriadneBody(body,{world:openWorld,tick:0,pose:currentPose,phase:"charming",playerSpeed:2.65,dt:1/60,now:frame*1000/60,reducedMotion:false})}
  assert.ok(body.position[1]<1.05,`Ariadne did not fly into the chosen left entrance: ${body.position[1]}`);
  assert.ok(body.mode==="leading"||body.mode==="waiting_ahead",`Ariadne abandoned the visible commitment: ${body.mode}`);
});

test("a side-passage commitment remains active when its entrance begins outside the narrow camera cone",()=>{
  const junctionPose={x:4.5,y:1.5,angle:0},route={id:"left-now",knownCells:[[4,1],[4,0]],decisionCell:[4,1],targetCell:[4,0],decisionPoint:"upcoming"},body=createAriadneBody(junctionPose,0);
  beginAriadneRoute(body,route,junctionPose,0);const initialDistance=Math.hypot(body.position[0]-4.5,body.position[1]-.5);
  for(let frame=1;frame<=70;frame++)updateAriadneBody(body,{world:openWorld,tick:0,pose:junctionPose,phase:"charming",dt:1/60,now:frame*1000/60,reducedMotion:false});
  const finalDistance=Math.hypot(body.position[0]-4.5,body.position[1]-.5);
  assert.ok(finalDistance<initialDistance*.45,`Ariadne failed to traverse to the selected entrance: ${initialDistance} -> ${finalDistance}`);
  assert.ok(body.mode==="leading"||body.mode==="waiting_ahead",`side guidance was cancelled: ${body.mode}`);
});

test("a junction belief sends Ariadne ahead before the spoken reply arrives",()=>{
  const body=createAriadneBody(pose,0),route={id:"second-left",knownCells:[[2,1],[3,1],[4,1]],decisionCell:[2,1],targetCell:[3,1],decisionPoint:"upcoming"};
  beginAriadneRoute(body,route,pose,1000);
  assert.equal(body.mode,"noticing_choice");assert.equal(body.targetRouteId,"second-left");assert.deepEqual(body.expectedChoiceCell,[3,1]);assert.ok(body.decisionEmphasisUntil-body.decisionEmphasisStartedAt>=2400);
  updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:.4,now:1400,reducedMotion:false});assert.equal(body.mode,"leading");
});

test("a straight choice still produces a visible curved commitment flight",()=>{
  const body=createAriadneBody(pose,0),route={id:"straight",knownCells:[[2,1],[3,1],[4,1]],decisionCell:[3,1],targetCell:[4,1],decisionPoint:"upcoming"};beginAriadneRoute(body,route,pose,0);
  let lateralExtent=0;for(let frame=1;frame<=55;frame++){updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:1/60,now:frame*1000/60,reducedMotion:false});lateralExtent=Math.max(lateralExtent,Math.abs(body.position[1]-1.5))}
  assert.ok(lateralExtent>.18,`straight commitment looked like ordinary forward hovering: ${lateralExtent}`);assert.ok(body.position[0]>2.4);
});

test("Ariadne visibly notices a junction while route planning is still in progress",()=>{
  const body=createAriadneBody(pose,0);noticeAriadneChoice(body,1000);
  assert.equal(body.mode,"noticing_choice");assert.equal(body.thinkingSince,1000);assert.ok(body.decisionEmphasisUntil>1000);
  for(let i=0;i<60;i++)updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:1/60,now:1000+i*1000/60,reducedMotion:false});
  assert.equal(body.mode,"noticing_choice","noticing must not become leader motion before a route exists");
  cancelAriadneChoiceNotice(body);assert.equal(body.mode,"hovering_beside");assert.equal(body.thinkingSince,null);
});

test("deciding to speak creates visible attention until speech begins or the request settles",()=>{
  const body=createAriadneBody(pose,0);prepareAriadneForEvent(body,"new_junction_visible",1000);assert.equal(body.thinkingSince,1000);
  speakAsAriadne(body,"MT, take the left passage with me.","new_junction_visible",1600);assert.equal(body.thinkingSince,null);assert.ok(body.speakUntil>1600);
  prepareAriadneForEvent(body,"passing_thought",3000);settleAriadneThinking(body);assert.equal(body.thinkingSince,null);
});

test("Ariadne abandons her waiting place and catches MT after another branch is chosen",()=>{
  const body=createAriadneBody(pose,0);beginAriadneGuidance(body,intent,1000);
  for(let i=0;i<100;i++)updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:1/60,now:1000+i*1000/60,reducedMotion:false});
  updateAriadneBody(body,{world:openWorld,tick:0,pose:{...pose,x:2.5},phase:"charming",dt:1/30,now:2750,reducedMotion:false});
  updateAriadneBody(body,{world:openWorld,tick:0,pose:{...pose,x:2.5,y:2.5},phase:"charming",dt:1/30,now:2784,reducedMotion:false});
  updateAriadneBody(body,{world:openWorld,tick:0,pose:{...pose,x:2.5,y:3.5},phase:"charming",dt:1/30,now:2818,reducedMotion:false});
  updateAriadneBody(body,{world:openWorld,tick:0,pose:{...pose,x:2.5,y:4.5},phase:"charming",dt:1/30,now:2852,reducedMotion:false});
  assert.ok(["returning","catching_up"].includes(body.mode));assert.equal(body.mtLeavingWhileSheWaits,true);assert.equal(body.departureRouteId,"second-left");
});

test("looking around and tentatively entering a branch are not choices",()=>{
  const body=createAriadneBody(pose,0);beginAriadneGuidance(body,intent,1000);
  for(let i=0;i<100;i++)updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:1/60,now:1000+i*1000/60,reducedMotion:false});
  for(let turn=0;turn<12;turn++)updateAriadneBody(body,{world:openWorld,tick:0,pose:{...pose,x:2.5,angle:turn*Math.PI/6},phase:"charming",dt:1/30,now:2750+turn*34,reducedMotion:false});
  assert.equal(body.mtFollowingHerLead,false);assert.equal(body.mtLeavingWhileSheWaits,false);assert.deepEqual(body.choiceCells,[]);
  updateAriadneBody(body,{world:openWorld,tick:0,pose:{...pose,x:2.5,y:2.5,angle:Math.PI/2},phase:"charming",dt:1/30,now:3200,reducedMotion:false});
  for(let turn=0;turn<8;turn++)updateAriadneBody(body,{world:openWorld,tick:0,pose:{...pose,x:2.5,y:2.5,angle:turn*Math.PI/4},phase:"charming",dt:1/30,now:3234+turn*34,reducedMotion:false});
  assert.equal(body.mtFollowingHerLead,false);assert.equal(body.mtLeavingWhileSheWaits,false);assert.equal(body.choiceCells.length,1);
  updateAriadneBody(body,{world:openWorld,tick:0,pose:{...pose,x:2.5,angle:Math.PI},phase:"charming",dt:1/30,now:3550,reducedMotion:false});
  assert.equal(body.mtFollowingHerLead,false);assert.equal(body.mtLeavingWhileSheWaits,false);assert.deepEqual(body.choiceCells,[]);
});

test("blocked shoulder space makes Ariadne choose the open side",()=>{
  const world={tile(x,y){return y>=2?1:0}},wallSidePose={...pose,y:1.82},body=createAriadneBody(wallSidePose,0,world,0);
  updateAriadneBody(body,{world,tick:0,pose:wallSidePose,phase:"charming",dt:1/30,now:33,reducedMotion:false});
  assert.equal(body.side,-1);assert.equal(world.tile(Math.floor(body.position[0]),Math.floor(body.position[1])),0);
});

test("Ariadne catches up into MT's forward view after a complete turn",()=>{
  const body=createAriadneBody(pose,0),turned={...pose,angle:Math.PI};
  for(let i=0;i<120;i++)updateAriadneBody(body,{world:openWorld,tick:0,pose:turned,phase:"charming",dt:1/60,now:i*1000/60,reducedMotion:false});
  const bearing=Math.atan2(body.position[1]-turned.y,body.position[0]-turned.x);
  const relative=Math.atan2(Math.sin(bearing-turned.angle),Math.cos(bearing-turned.angle));
  assert.ok(Math.abs(relative)<Math.PI/6,`expected Ariadne in the forward view, got ${relative}`);
});

test("a fast continuous spin carries Ariadne smoothly around MT without leaving the view",()=>{
  const body=createAriadneBody(pose,0),initialBearing=Math.atan2(body.position[1]-pose.y,body.position[0]-pose.x);let previousRelative=Math.atan2(Math.sin(initialBearing-pose.angle),Math.cos(initialBearing-pose.angle));
  for(let i=1;i<=120;i++){
    const spinning={...pose,angle:i*Math.PI*2/120};
    updateAriadneBody(body,{world:openWorld,tick:0,pose:spinning,phase:"charming",dt:1/60,now:i*1000/60,reducedMotion:false});
    const bearing=Math.atan2(body.position[1]-spinning.y,body.position[0]-spinning.x);
    const relative=Math.atan2(Math.sin(bearing-spinning.angle),Math.cos(bearing-spinning.angle));
    assert.ok(Math.abs(relative)<Math.PI/6,`Ariadne left the forward view at frame ${i}: ${relative}`);
    assert.ok(Math.abs(relative-previousRelative)<.1,`Ariadne jumped across the view at frame ${i}`);
    previousRelative=relative;
  }
});

test("ordinary hovering reacquires MT's forward line of sight",()=>{
  const body=createAriadneBody(pose,0);body.position=[.5,1.5];body.velocity=[0,0,0];
  for(let i=1;i<=90;i++)updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:1/60,now:i*1000/60,reducedMotion:false});
  const bearing=Math.atan2(body.position[1]-pose.y,body.position[0]-pose.x),relative=Math.atan2(Math.sin(bearing-pose.angle),Math.cos(bearing-pose.angle));
  assert.ok(Math.abs(relative)<Math.PI/6,`Ariadne remained outside MT's forward view: ${relative}`);assert.ok(body.position[0]>pose.x);
});

test("embodiment context is qualitative and reflects physical reactions",()=>{
  const body=createAriadneBody(pose,0);prepareAriadneForEvent(body,"dead_end_visible",1000);speakAsAriadne(body,"I misread that wall, MT—come back with me.","dead_end_visible",1000);
  const context=describeAriadneEmbodiment(body,pose,openWorld,0,null);
  assert.match(context.currentAction,/closer|softened/);assert.equal(context.relationToBelievedRoute,null);assert.equal("position" in context,false);assert.equal("mode" in context,false);
});

test("contradicted guidance makes Ariadne visibly recoil, approach, lower, and remain apologetic",()=>{
  const body=createAriadneBody(pose,0);body.position=[3.1,1.5];body.velocity=[1.2,0,.2];const initialDistance=Math.hypot(body.position[0]-pose.x,body.position[1]-pose.y);
  prepareAriadneForEvent(body,"recommendation_contradicted",1000);
  assert.equal(body.mode,"apology_spiral");assert.ok(body.velocity[0]<0,"the leading motion should visibly recoil");
  let minY=Infinity,maxY=-Infinity;for(let frame=1;frame<=75;frame++){updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:1/60,now:1000+frame*1000/60,reducedMotion:false});minY=Math.min(minY,body.position[1]);maxY=Math.max(maxY,body.position[1])}
  assert.ok(maxY-minY>.35,`the distress circle was not spatially legible: ${maxY-minY}`);assert.equal(body.mode,"apology_spiral");
  for(let frame=76;frame<=210;frame++)updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:1/60,now:1000+frame*1000/60,reducedMotion:false});
  assert.equal(body.mode,"apologizing","ordinary visibility recovery must not erase the apology posture");
  assert.ok(Math.hypot(body.position[0]-pose.x,body.position[1]-pose.y)<initialDistance*.55,"Ariadne should return close to MT");
  assert.ok(body.height<.55,`Ariadne did not lower enough: ${body.height}`);
  assert.equal(body.apologyReady,true,"speech should be released only after Ariadne returns to MT");
});

test("a delayed speech request cannot restart an already visible dead-end apology",()=>{
  const body=createAriadneBody(pose,0);prepareAriadneForEvent(body,"dead_end_visible",1000);const origin=[...body.apologyOrigin];
  updateAriadneBody(body,{world:openWorld,tick:0,pose,phase:"charming",dt:.4,now:1400,reducedMotion:false});
  prepareAriadneForEvent(body,"dead_end_visible",1800);
  assert.equal(body.apologyStartedAt,1000);assert.deepEqual(body.apologyOrigin,origin);assert.equal(body.mode,"apology_spiral");
});
