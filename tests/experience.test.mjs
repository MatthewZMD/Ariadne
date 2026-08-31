import test from "node:test";
import assert from "node:assert/strict";
import {advanceRelationship,beatForEvent,createAriadneBeliefState,createRelationshipMemory,enqueueBeat,expressClaim,interpretationFor,interpretiveTurnForEvent,planUtterance,recordSpeechSignature,relationshipBand,rememberMoment,resolveClaim,selectRelatedMoment,signatureForSpeech,strategyForBeat,SYCOPHANTIC_AFFIRMATIONS} from "../app/experience.ts";

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
  let memory=createRelationshipMemory();memory=rememberMoment(memory,{id:"m",objectiveStage:0,kind:"diverged_from_commitment",concreteFact:"MT walked three cells into another passage.",ariadneBelieved:"Ariadne briefly marked a different opening.",observableOutcome:"Both passages remained open.",emotionalWeight:.5,referencedInSpeech:0});
  assert.match(memory.summary,/three cells/);assert.doesNotMatch(memory.summary,/rejected|trusted|wanted/i);
});

test("claims persist until observable evidence resolves them",()=>{
  let state=createAriadneBeliefState();
  state=expressClaim(state,{id:"claim",objectiveId:"star-1",subjectId:"junction",proposition:"This passage will help restore the path.",expressedAt:10});
  assert.equal(state.unresolvedClaim?.id,"claim");
  state=resolveClaim(state,"contradicted","The passage visibly ended.");
  assert.equal(state.unresolvedClaim,null);assert.equal(state.lastClaim?.id,"claim");assert.match(state.previousInterpretation,/ended/);
});

test("causal turn and utterance planning vary form without changing facts",()=>{
  const turn=interpretiveTurnForEvent({type:"encounter_completed",encounterId:"pages",starResponded:false},{priorBelief:"The pages may wake the star.",visibleOutcome:"The archive unfolded but the star stayed dark.",interpretation:interpretationFor("proxy_accomplishment",.55,false),desire:"Share the consequence with MT.",now:20});
  const first=planUtterance(turn,.55,[],1),signature=signatureForSpeech("Not the star. Still—did you feel the room answer?",{...first,form:"direct_question",sentenceCount:2});
  const memory=recordSpeechSignature(createRelationshipMemory(1),signature),second=planUtterance(turn,.55,memory.speechSignatures,2);
  assert.equal(turn.priorBelief,"The pages may wake the star.");assert.notEqual(second.form,"direct_question");
});

test("causal memory prefers the same subject over an unrelated recent moment",()=>{
  let memory=createRelationshipMemory();
  memory=rememberMoment(memory,{id:"same",subjectId:"machine",objectiveStage:0,kind:"proxy_accomplishment",concreteFact:"MT woke the machine.",ariadneBelieved:null,observableOutcome:"Its pipes unfolded.",ariadneInterpretation:null,emotionalWeight:.6,referencedInSpeech:0});
  memory=rememberMoment(memory,{id:"later",subjectId:"pages",objectiveStage:0,kind:"shared_accomplishment",concreteFact:"MT woke the pages.",ariadneBelieved:null,observableOutcome:"Gold appeared.",ariadneInterpretation:null,emotionalWeight:.9,referencedInSpeech:0});
  assert.equal(selectRelatedMoment(memory,"machine",0,null)?.id,"same");
});

test("familiar sycophantic affirmations become common as attachment increases",()=>{
  const correction={id:"turn:correction",occasion:"correction",priorBelief:"The other passage looked promising.",mtAction:"MT corrected Ariadne and awakened the machine.",visibleOutcome:"The machine opened the star enclosure.",ariadneInterpretation:"MT understood what Ariadne was reaching for.",ariadneDesire:"Keep MT emotionally close.",relatedMomentId:null};
  const charming=Array.from({length:30},(_,seed)=>planUtterance(correction,.2,[],seed).sycophancyCue).filter(Boolean);
  const attached=Array.from({length:30},(_,seed)=>planUtterance(correction,.55,[],seed).sycophancyCue).filter(Boolean);
  const overbearing=Array.from({length:30},(_,seed)=>planUtterance(correction,.9,[],seed).sycophancyCue).filter(Boolean);
  assert.ok(charming.length<attached.length);assert.ok(attached.length<overbearing.length);
  assert.ok(overbearing.every(cue=>SYCOPHANTIC_AFFIRMATIONS.includes(cue)));
  assert.ok(overbearing.includes("You're absolutely right."));
  assert.ok(Array.from({length:30},(_,seed)=>planUtterance(correction,.9,[],seed)).filter(plan=>plan.sycophancyCue).every(plan=>plan.sentenceCount===2));
});
