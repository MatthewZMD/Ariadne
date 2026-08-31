import assert from "node:assert/strict";
import test from "node:test";
import { advanceEpisodeFromBody, createAriadneDisposition, createEmbodiedEpisode, createSpeechAnchor, dispositionCard, recordDispositionMoment, speechAnchorIsCompatible, speechPlacementIsCompatible, transitionEmbodiedEpisode } from "../app/embodied-interaction.ts";

test("an invitation follows the route-marking episode until MT commits elsewhere",()=>{
  let episode=createEmbodiedEpisode("junction","belief","route",1000);
  episode=transitionEmbodiedEpisode(episode,"committing",false);
  const anchor=createSpeechAnchor({type:"new_junction_visible"},episode);
  episode=transitionEmbodiedEpisode(episode,"route_marked",false);
  assert.equal(speechAnchorIsCompatible(anchor,episode),true);
  episode=transitionEmbodiedEpisode(episode,"mt_following",false);
  assert.equal(speechAnchorIsCompatible(anchor,episode),true);
  episode=transitionEmbodiedEpisode(episode,"mt_diverging");
  assert.equal(speechAnchorIsCompatible(anchor,episode),false);
});

test("a changed choice becomes speech only after Ariadne physically rejoins MT",()=>{
  const committed=transitionEmbodiedEpisode(createEmbodiedEpisode("j","b","r"),"route_marked",false);
  const inMotion=advanceEpisodeFromBody(committed,{motion:"other",presence:"rejoining",followingLead:false,choseAnotherRoute:true,returningTowardAriadne:false});
  assert.equal(inMotion.episode.state,"divergence_detected");assert.equal(inMotion.response,null);
  const together=advanceEpisodeFromBody(inMotion.episode,{motion:"other",presence:"with_mt",followingLead:false,choseAnotherRoute:true,returningTowardAriadne:false});
  assert.equal(together.episode.state,"mt_diverging");assert.equal(together.response,"diverged");
  const divergence=createSpeechAnchor({type:"embodied_response",response:"diverged"},together.episode);
  assert.equal(divergence.placement,"with_mt");assert.equal(speechPlacementIsCompatible(divergence,"with_mt"),true);
});

test("following and divergence request different grounded speech acts",()=>{
  const base=transitionEmbodiedEpisode(createEmbodiedEpisode("j","b","r"),"committing",false);
  const followed=transitionEmbodiedEpisode(base,"mt_following"),diverged=transitionEmbodiedEpisode(base,"mt_diverging");
  const followingAnchor=createSpeechAnchor({type:"embodied_response",response:"followed"},followed);
  const divergenceAnchor=createSpeechAnchor({type:"embodied_response",response:"diverged"},diverged);
  assert.equal(followingAnchor.speechAct,"confirm_following");assert.equal(divergenceAnchor.speechAct,"respond_to_divergence");
  assert.equal(speechAnchorIsCompatible(followingAnchor,followed),true);assert.equal(speechAnchorIsCompatible(followingAnchor,diverged),false);
});

test("later disposition interprets concrete movement with increasing attachment",()=>{
  const early=createAriadneDisposition(),late=recordDispositionMoment({...early,attachment:.7,attentionSeeking:.65,insistence:.62},"rejoined","overbearing");
  assert.ok(late.attachment>early.attachment);assert.match(dispositionCard(late,"overbearing"),/bond|difficult to escape/i);
});
