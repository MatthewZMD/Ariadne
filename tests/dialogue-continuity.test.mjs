import assert from "node:assert/strict";
import test from "node:test";
import { dialogueContinuity, requestsRouteGesture, unansweredAriadneQuestions } from "../app/dialogue-continuity.ts";

test("explicit requests for directions renew a gesture without treating companionship as a request",()=>{
  for(const text of ["Which way?","Where should I turn?","Show me the passage you mean and stay with me.","Please repeat your directions.","I don't know which way to go."]){
    assert.equal(requestsRouteGesture(text),true,text);
  }
  for(const text of ["Stay beside me.","I like this room.","Show me that flower.","Don't show me the way.","Don't tell me which way to go.","I don't want you to show me the passage.","Do not guide me; I will choose which passage.","Stop repeating your directions."]){
    assert.equal(requestsRouteGesture(text),false,text);
  }
});

test("the ongoing thought and unanswered question survive intervening voice cues",()=>{
  const context=dialogueContinuity([
    {role:"player",text:"I am staying for the sound."},
    {role:"ariadne",text:"The first bell answered the second."},
    {role:"ariadne",text:"Could that be the same bell we heard earlier?"},
    {role:"ariadne",text:"Look!",kind:"prerecorded_cue"},
  ]);
  assert.match(context,/first bell answered/);
  assert.match(context,/last question has no verbal answer/);
  assert.match(context,/I am staying for the sound/);
  assert.doesNotMatch(context,/Look!/);
});

test("an actual player reply ends the unanswered-question framing",()=>{
  const context=dialogueContinuity([{role:"ariadne",text:"Did you hear that?"},{role:"player",text:"Yes, behind us."}]);
  assert.doesNotMatch(context,/last question has no verbal answer/);
  assert.match(context,/Yes, behind us/);
});

test("unanswered questions survive intervening ambient statements",()=>{
  const context=dialogueContinuity([
    {role:"player",text:"Where should I turn?"},
    {role:"ariadne",text:"Does the creature watch us?"},
    {role:"ariadne",text:"The vent has closed."},
    {role:"ariadne",text:"The pipes are quiet."},
  ]);
  assert.match(context,/Does the creature watch us\?/);
  assert.match(context,/remain unanswered even after/);
  assert.match(context,/not proof that the claim was true/);
});

test("ambient observations and prerecorded cues cannot answer an earlier question",()=>{
  const history=[{role:"ariadne",text:"Did you hear the bell?"},{role:"ariadne",text:"This way!",kind:"prerecorded_cue"},{role:"ariadne",text:"The room went quiet."}];
  assert.deepEqual(unansweredAriadneQuestions(history),["Did you hear the bell?"]);
  assert.deepEqual(unansweredAriadneQuestions([...history,{role:"player",text:"I just want to keep walking."}]),[]);
  assert.deepEqual(unansweredAriadneQuestions([{role:"ariadne",text:"Ready?",kind:"prerecorded_cue"}]),[]);
});
