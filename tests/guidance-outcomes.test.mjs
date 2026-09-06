import assert from "node:assert/strict";
import test from "node:test";
import { accomplishmentCorrectsGuidance, recommendedBranchEndsAt } from "../app/guidance-outcomes.ts";
import { chooseNavigationBelief, chooseNavigationBeliefAsync, rejectNavigationBelief } from "../app/objectives.ts";
import { createGuidanceIntent } from "../app/companion.ts";
import { createSpeechAnchor } from "../app/embodied-interaction.ts";
import { createAriadneBody, prepareAriadneForEvent } from "../app/ariadne-body.ts";

const corridor=()=>{
  const cells=new Set(["0,0","0,1","0,-1",...Array.from({length:18},(_,i)=>`${i+1},0`)]);
  return{cells,world:{tile:(x,y)=>cells.has(`${x},${y}`)?0:1}};
};
const route={id:"east",direction:"straight",knownCells:[[1,0]],targetCell:[1,0],targetRegionId:null,instruction:"This way.",description:"Open passage",score:1};
const pose={x:.5,y:.5,angle:0,bob:0};

test("an unseen continuation can contradict her branch when its ending becomes visible",()=>{
  const {world}=corridor(),intent=createGuidanceIntent({message:"This way."},route,pose,0);
  assert.equal(recommendedBranchEndsAt(world,intent,[18,0]),true);
  assert.equal(recommendedBranchEndsAt(world,intent,[0,1]),false,"a different branch is not her mistake");
  assert.equal(recommendedBranchEndsAt(world,null,[18,0]),false);
  assert.equal(recommendedBranchEndsAt(world,intent,[18,0],0,[18,0]),false,"the star's destination is a successful ending");
});

test("a later junction breaks the causal link to an earlier recommendation",()=>{
  const {world,cells}=corridor();cells.add("8,1");
  const intent=createGuidanceIntent({message:"This way."},route,pose,0);
  assert.equal(recommendedBranchEndsAt(world,intent,[18,0]),false);
});

test("seeing an unrelated dead end is an observation, not an apology",()=>{
  const event={type:"dead_end_visible",cell:[0,1]};
  assert.equal(createSpeechAnchor(event,null).speechAct,"share_visible_discovery");
  const body=createAriadneBody(pose,0);prepareAriadneForEvent(body,event.type,100);
  assert.notEqual(body.mode,"apology_spiral");
  prepareAriadneForEvent(body,"recommendation_contradicted",200);
  assert.equal(body.mode,"apology_spiral");
});

test("refuted branches remain rejected when a returning player sees new route IDs",async()=>{
  const {world}=corridor(),alternate={...route,id:"south",direction:"right",knownCells:[[0,1]],targetCell:[0,1],score:0};
  const initial={stage:4,collectedStars:4,activeStar:null,queuedStar:null,decisionSerial:0,accuracyAccumulator:0,recentBeliefs:[]};
  const chosen=chooseNavigationBelief(initial,[route,alternate],"junction:0,0",world,7,false);
  const corrected=rejectNavigationBelief(chosen.state,chosen.belief.id);
  assert.equal(corrected.recentBeliefs.length,0);
  const renamed={...route,id:"approach:east",decisionPoint:"upcoming",decisionCell:[0,0]};
  for(const select of [chooseNavigationBelief,chooseNavigationBeliefAsync]){
    const next=await select(corrected,[renamed,alternate],"junction:0,0",world,7,false);
    assert.equal(next.belief.routeId,"south");
  }
  assert.equal(rejectNavigationBelief(corrected,chosen.belief.id),corrected);
});

test("gold after ordinary travel is not evidence that MT corrected a bad guide",()=>{
  assert.equal(accomplishmentCorrectsGuidance(true,null),false);
  assert.equal(accomplishmentCorrectsGuidance(true,{divergedSeconds:30,visiblyContradicted:false}),false);
  assert.equal(accomplishmentCorrectsGuidance(false,{divergedSeconds:30,visiblyContradicted:true}),false);
  assert.equal(accomplishmentCorrectsGuidance(true,{divergedSeconds:0,visiblyContradicted:true}),false);
  assert.equal(accomplishmentCorrectsGuidance(true,{divergedSeconds:8,visiblyContradicted:true}),true);
});
