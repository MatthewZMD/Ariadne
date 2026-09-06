import assert from "node:assert/strict";
import test from "node:test";
import { isVisibleStarEndpoint, discoveryQuietUntil, starDiscoveryInstruction, starDiscoveryStage, isAmbientDiscoveryDistraction } from "../app/star-discovery.ts";
import { ARIADNE_VOICE_CUES, vocalCueFor } from "../app/ariadne-vocal-performance.ts";

test("anticipation belongs to an actual star response, not an unrelated transformation",()=>{
  const signal={type:"encounter_completed",encounterId:"a",starResponded:true};
  assert.equal(starDiscoveryStage(signal),"signal");
  assert.match(starDiscoveryInstruction(signal),/getting closer/);
  assert.match(starDiscoveryInstruction(signal),/not proof of distance/);
  assert.equal(starDiscoveryInstruction({...signal,starResponded:false}),null);
});

test("visible and collected stars have distinct factual announcements",()=>{
  const sighting={type:"star_visible",starId:"a",ordinal:1};
  assert.match(starDiscoveryInstruction(sighting),/you can see the star; you have found it/);
  assert.match(starDiscoveryInstruction(sighting),/Do not say it has been collected/);
  assert.match(starDiscoveryInstruction({...sighting,type:"star_collected"}),/now collected/);
  assert.equal(vocalCueFor("react_to_star","star_visible"),"star_visible");
  assert.ok(ARIADNE_VOICE_CUES.star_visible.every(cue=>!cue.text.includes("got it")));
});

test("discovery quiet protects its buildup without suppressing player questions or discoveries",()=>{
  assert.equal(isAmbientDiscoveryDistraction({type:"scene_changed",sceneId:"birds"}),true);
  assert.equal(isAmbientDiscoveryDistraction({type:"passing_thought"}),true);
  assert.equal(isAmbientDiscoveryDistraction({type:"player_message",text:"where is it"}),false);
  assert.equal(isAmbientDiscoveryDistraction({type:"star_visible",starId:"a",ordinal:1}),false);
});

test("slow discovery delivery still leaves a full quiet interval",()=>{
  const event={type:"encounter_completed",encounterId:"a",starResponded:true};
  assert.equal(discoveryQuietUntil(event,30_000,12_000),42_000);
  assert.equal(discoveryQuietUntil(event,30_000,90_000),90_000,"preserve a longer requested silence");
  assert.equal(discoveryQuietUntil({...event,starResponded:false},30_000,12_000),12_000);
});


test("arrival at a visible star supersedes the endpoint warning without hiding other dead ends",()=>{
  assert.equal(isVisibleStarEndpoint([8,3],[8,3],true),true);
  assert.equal(isVisibleStarEndpoint([8,3],[9,3],true),false);
  assert.equal(isVisibleStarEndpoint([8,3],[8,3],false),false,"hidden objective knowledge cannot suppress a perceived ending");
  assert.equal(isVisibleStarEndpoint([8,3],null,true),false,"the exit search retains ordinary dead ends");
  assert.equal(isVisibleStarEndpoint(null,[8,3],true),false);
});
