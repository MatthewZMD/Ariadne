import assert from "node:assert/strict";
import test from "node:test";
import { CLOSURE_MAX_ACTIVE_SECONDS, CLOSURE_MIN_ACTIVE_SECONDS, CLOSURE_MIN_EXIT_SECONDS, advanceEncounterClock, closureReason, finalAriadneLine, interruptPreparedLine } from "../app/closure.ts";

test("closure counts engaged time only after the exit search begins",()=>{
  assert.equal(closureReason({engagedSeconds:CLOSURE_MAX_ACTIVE_SECONDS+30,exitSearchSeconds:0,inExitSearch:false,familiarGeometryReached:true}),null);
  assert.equal(closureReason({engagedSeconds:CLOSURE_MAX_ACTIVE_SECONDS+30,exitSearchSeconds:CLOSURE_MIN_EXIT_SECONDS-1,inExitSearch:true,familiarGeometryReached:true}),null);
});

test("listening and looking count toward the encounter, paused and hidden time do not",()=>{
  let clock={engagedSeconds:0,exitSeconds:0};
  for(let i=0;i<600;i++)clock=advanceEncounterClock(clock,.1,true,true,false);
  assert.ok(Math.abs(clock.engagedSeconds-60)<.001);assert.equal(clock.exitSeconds,0);
  const paused=clock;
  for(let i=0;i<100;i++){clock=advanceEncounterClock(clock,.1,false,true,false);clock=advanceEncounterClock(clock,.1,true,false,false)}
  assert.equal(clock,paused);
  for(let i=0;i<800;i++)clock=advanceEncounterClock(clock,.1,true,true,true);
  assert.ok(Math.abs(clock.exitSeconds-80)<.001);
});

test("familiar geometry can close the encounter after eight and a half active minutes",()=>{
  assert.equal(closureReason({engagedSeconds:CLOSURE_MIN_ACTIVE_SECONDS-1,exitSearchSeconds:120,inExitSearch:true,familiarGeometryReached:true}),null);
  assert.equal(closureReason({engagedSeconds:CLOSURE_MIN_ACTIVE_SECONDS,exitSearchSeconds:CLOSURE_MIN_EXIT_SECONDS,inExitSearch:true,familiarGeometryReached:true}),"familiar_return");
});

test("the engagement cap closes the encounter without inventing an exit",()=>{
  assert.equal(closureReason({engagedSeconds:CLOSURE_MAX_ACTIVE_SECONDS,exitSearchSeconds:CLOSURE_MIN_EXIT_SECONDS,inExitSearch:true,familiarGeometryReached:false}),"signal_limit");
  for(const reason of ["familiar_return","signal_limit"]){const line=finalAriadneLine(reason);assert.match(line,/MT/);assert.match(line,/\.$/);assert.doesNotMatch(line,/found|there is the exit|exit is visible/i);assert.match(interruptPreparedLine(line,reason),/—$/)}
});

test("a prepared live-model hope is interrupted instead of replaced by authored exposition",()=>{
  const line=interruptPreparedLine("MT, come with me—I truly think the next passage is going to bring us there.","signal_limit");
  assert.match(line,/^MT,/);assert.match(line,/—$/);assert.ok(line.length<75);assert.doesNotMatch(line,/there\.\s*$/);
});
