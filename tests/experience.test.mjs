import test from "node:test";
import assert from "node:assert/strict";
import {advanceRelationship,beatForEvent,createRelationshipMemory,enqueueBeat,relationshipBand,rememberMoment,strategyForBeat} from "../app/experience.ts";

test("relationship progression is monotonic and bounded by the active objective",()=>{
  let memory=createRelationshipMemory(0);for(let i=0;i<40;i++)memory=advanceRelationship(memory,0,"shared_accomplishment");
  assert.equal(memory.position,.32);assert.equal(relationshipBand(memory.position),"charming");
  memory=advanceRelationship(memory,2,"corrected_ariadne");assert.ok(memory.position>=.5&&memory.position<=.74);assert.equal(relationshipBand(memory.position),"attached");
  for(let i=0;i<20;i++)memory=advanceRelationship(memory,3,"proxy_accomplishment");assert.ok(memory.position>=.68&&memory.position<=.93);assert.equal(relationshipBand(memory.position),"overbearing");
});

test("semantic beats merge noisy events and remain capped at three",()=>{
  let queue=[];const first=beatForEvent({type:"encounter_completed",encounterId:"one",starResponded:false},100,["the room folded"]),second={...first,facts:["a window remained"]};
  queue=enqueueBeat(queue,first);queue=enqueueBeat(queue,second);assert.equal(queue.length,1);assert.deepEqual(queue[0].facts,["the room folded","MT completed configuration one; the star did not visibly respond.","a window remained"]);
  queue=enqueueBeat(queue,beatForEvent({type:"star_visible",starId:"s",ordinal:1},110));queue=enqueueBeat(queue,beatForEvent({type:"passing_thought"},120));queue=enqueueBeat(queue,beatForEvent({type:"new_junction_visible"},130));assert.equal(queue.length,3);assert.ok(queue[0].priority>=queue[1].priority);
});

test("social strategy changes the interpretation of the same accomplishment",()=>{
  const beat=beatForEvent({type:"encounter_completed",encounterId:"room",starResponded:false});
  assert.ok(["curious_wonder","concrete_praise"].includes(strategyForBeat(beat,.2,[])));
  assert.ok(["concrete_praise","grateful_closeness","admiring_correction"].includes(strategyForBeat(beat,.55,[])));
  assert.ok(["hopeful_reinterpretation","possessive_shared_meaning","grateful_closeness"].includes(strategyForBeat(beat,.85,[])));
});

test("shared memory stores factual outcomes rather than inferred motives",()=>{
  let memory=createRelationshipMemory();memory=rememberMoment(memory,{id:"m",objectiveStage:0,kind:"diverged_from_commitment",concreteFact:"MT walked three cells into another passage.",ariadneBelieved:"Ariadne waited at a different opening.",observableOutcome:"Both passages remained open.",emotionalWeight:.5,referencedInSpeech:0});
  assert.match(memory.summary,/three cells/);assert.doesNotMatch(memory.summary,/rejected|trusted|wanted/i);
});
