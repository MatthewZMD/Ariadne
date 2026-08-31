import test from "node:test";
import assert from "node:assert/strict";
import {activateNearbyResonance,condenseStarFragment,createResonanceState,ensureExitEncountersAround,ensureObjectiveJourney,objectiveResonanceReady,openingGreeting,settleRealityTransformations} from "../app/resonance.ts";
import {InfiniteWorld} from "../app/world.mjs";

const openWorld={tile(){return 0}};
const path=Array.from({length:80},(_,index)=>[index,0]);

test("objective journey has persistent required and proxy accomplishments",()=>{
  const state=createResonanceState(),journey=ensureObjectiveJourney(state,openWorld,{seed:17,objectiveId:"star-1",ordinal:1,path,tick:0,activeSeconds:0});
  assert.equal(journey.requiredEncounterIds.length,1);assert.equal(journey.proxyEncounterIds.length,1);assert.equal(objectiveResonanceReady(state,"star-1"),false);
  const required=state.encounters.get(journey.requiredEncounterIds[0]);
  for(const element of required.elements)activateNearbyResonance(state,element.position,1000);
  assert.equal(required.completed,true);assert.equal(objectiveResonanceReady(state,"star-1"),true);assert.equal(state.activeMotifs.length,1);
  assert.equal(required.reality.stage,"completing");assert.equal(required.reality.progress,1);assert.ok(required.reality.persistentEffects.length>=2);assert.equal(state.chaos.completedEncounters,1);
  settleRealityTransformations(state,5000);assert.equal(required.reality.stage,"persistent");
  assert.equal(ensureObjectiveJourney(state,openWorld,{seed:17,objectiveId:"star-1",ordinal:1,path,tick:0,activeSeconds:9}),journey);
});

test("the first required accomplishment cannot be missed while following the opening route",()=>{
  const state=createResonanceState(),journey=ensureObjectiveJourney(state,openWorld,{seed:17,objectiveId:"opening-star",ordinal:1,path,tick:0,activeSeconds:0}),required=state.encounters.get(journey.requiredEncounterIds[0]);
  assert.equal(required.elements.length,3);
  const routeIndexes=[];
  for(const [index,element] of required.elements.entries()){
    const cell=[Math.floor(element.position[0]),Math.floor(element.position[1])];
    assert.ok(path.some(([x,y])=>x===cell[0]&&y===cell[1]),"every teaching element must sit directly on the canonical route");
    routeIndexes.push(path.findIndex(([x,y])=>x===cell[0]&&y===cell[1]));
    activateNearbyResonance(state,element.position,1000+index*1000);
    assert.equal(element.activatedAt,1000+index*1000,"each accomplishment retains the moment needed for immediate spatial feedback");
  }
  assert.deepEqual(routeIndexes,[2,6,10],"the opening rewards must unfold as separate beats instead of one accidental cluster");
  assert.equal(required.teaching,true);
  assert.match(openingGreeting(state,"opening-star"),new RegExp(required.motif.kind));
  assert.match(openingGreeting(state,"opening-star"),/wake it/);
  assert.equal(required.completed,true);assert.equal(objectiveResonanceReady(state,"opening-star"),true);
});

test("partial progress survives leaving and star collection condenses motifs",()=>{
  const state=createResonanceState(),journey=ensureObjectiveJourney(state,openWorld,{seed:22,objectiveId:"star-2",ordinal:2,path,tick:0,activeSeconds:70}),encounter=state.encounters.get(journey.requiredEncounterIds[0]);
  activateNearbyResonance(state,encounter.elements[0].position,1000);assert.equal(encounter.elements[0].active,true);assert.equal(encounter.completed,false);assert.equal(encounter.reality.stage,"assembling");assert.equal(encounter.reality.progress,1/encounter.elements.length);
  for(const element of encounter.elements.slice(1))activateNearbyResonance(state,element.position,2000);assert.equal(encounter.completed,true);
  assert.deepEqual(encounter.reality.completionPosition,encounter.elements.at(-1).position,"the completion fold must erupt where MT can see the final action, not behind them at the centerpiece");
  condenseStarFragment(state);assert.equal(state.permanentStarFragments,1);assert.deepEqual(state.activeMotifs,[]);assert.equal(state.chaos.collectedStars,1);assert.ok(state.chaos.activeIntensity>0);
});

test("proxy completion is rewarding without unlocking required objective evidence",()=>{
  const state=createResonanceState(),journey=ensureObjectiveJourney(state,openWorld,{seed:29,objectiveId:"star-3",ordinal:3,path,tick:0,activeSeconds:150}),proxy=state.encounters.get(journey.proxyEncounterIds[0]);let completion;
  for(const element of proxy.elements)completion=activateNearbyResonance(state,element.position,3000).at(-1)??completion;
  assert.equal(proxy.completed,true);assert.equal(completion.starResponded,false);assert.equal(state.completedEncounterCount,1);assert.equal(objectiveResonanceReady(state,"star-3"),false);
});

test("the impossible exit search keeps generating persistent local accomplishments",()=>{
  const state=createResonanceState(),world=new InfiniteWorld(41),origin=[1,1];
  ensureExitEncountersAround(state,world,{seed:41,origin,tick:0,activeSeconds:480});
  const ids=[...state.encounters.keys()],first=[...state.encounters.values()];
  assert.equal(first.length,2);assert.ok(first.every(encounter=>encounter.relevance==="local_proxy"));
  ensureExitEncountersAround(state,world,{seed:41,origin,tick:0,activeSeconds:520});
  assert.deepEqual([...state.encounters.keys()],ids);assert.equal(state.encounters.size,2);
});
