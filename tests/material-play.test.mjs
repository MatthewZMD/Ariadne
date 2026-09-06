import test from "node:test";
import assert from "node:assert/strict";
import { createResonanceState, ensureObjectiveJourney, playResonance, objectiveResonanceReady } from "../app/resonance.ts";
import { materialGesture } from "../app/material-play.ts";

const world={tile:()=>0};
function fixture(theme="beach",proxy=false){
  const state=createResonanceState(),journey=ensureObjectiveJourney(state,world,{seed:17,objectiveId:"star",ordinal:1,path:Array.from({length:80},(_,i)=>[i,0]),tick:0,activeSeconds:0});
  const encounter=state.encounters.get((proxy?journey.proxyEncounterIds:journey.requiredEncounterIds)[0]);
  encounter.theme=theme;encounter.teaching=false;encounter.center=[2,0];
  encounter.elements=encounter.elements.slice(0,2);
  encounter.elements[0].position=[2,.5];encounter.elements[1].position=[2,2];
  state.encounters=new Map([[encounter.id,encounter]]);
  return{state,encounter};
}
function play(state,options={},frames=40){
  const events={changes:[],echoes:[]};
  for(let i=0;i<frames;i++){
    const result=playResonance(state,{world,pose:{x:.5,y:.5,angle:0},speed:0,deltaSeconds:.05,now:1000+i*50,tick:0,...options});
    events.changes.push(...result.changes);events.echoes.push(...result.echoes);
  }
  return events;
}

test("listening asks MT to settle and selects one visible fragment at a time",()=>{
  const {state,encounter}=fixture();
  play(state,{speed:1});assert.ok(encounter.elements.every(element=>!element.active));
  play(state,{},12);assert.ok(encounter.elements[0].attention>0);assert.equal(encounter.elements[0].active,false);
  play(state);assert.equal(encounter.elements[0].active,true);assert.equal(encounter.elements[1].active,false);
  assert.equal(objectiveResonanceReady(state,"star"),false);
  play(state,{pose:{x:.5,y:.5,angle:Math.PI/4}});
  assert.equal(encounter.completed,true);assert.equal(objectiveResonanceReady(state,"star"),true);
});

test("looking can unfold pages while moving, but cannot act through a wall",()=>{
  const {state,encounter}=fixture("frozen");
  play(state,{speed:1,world:{tile:x=>x===1?1:0}});
  assert.equal(encounter.elements[0].attention,0);assert.equal(encounter.elements[0].active,false);
  play(state,{speed:1});assert.equal(encounter.elements[0].active,true);
});

test("awakened material can be played again without farming accomplishments or stars",()=>{
  const {state,encounter}=fixture("cavern",true);
  play(state);play(state,{pose:{x:.5,y:.5,angle:Math.PI/4}});
  assert.equal(encounter.completed,true);assert.equal(state.completedEncounterCount,1);
  const completion=encounter.completedAt,revision=state.revision;
  const echoes=play(state,{now:10000},80);
  assert.ok(echoes.echoes.length>0);assert.equal(echoes.changes.length,0);
  assert.equal(state.completedEncounterCount,1);assert.equal(encounter.completedAt,completion);assert.equal(state.revision,revision);
  assert.equal(objectiveResonanceReady(state,"star"),false);
});

test("the opening still teaches through contact before asking for other kinds of attention",()=>{
  const {state,encounter}=fixture("frozen");encounter.teaching=true;
  assert.equal(materialGesture(encounter),"approach");
  const result=play(state,{pose:{x:2,y:.5,angle:Math.PI},speed:1},1);
  assert.equal(encounter.elements[0].active,true);assert.equal(result.changes.length,1);
});
