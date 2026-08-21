import assert from "node:assert/strict";
import test from "node:test";
import { CLOSURE_MAX_ACTIVE_SECONDS, CLOSURE_MIN_ACTIVE_SECONDS, CLOSURE_MIN_EXIT_SECONDS, closureReason, finalAriadneLine } from "../app/closure.ts";

test("closure counts active travel only after the exit search begins",()=>{
  assert.equal(closureReason({activeWalkSeconds:CLOSURE_MAX_ACTIVE_SECONDS+30,exitSearchSeconds:0,inExitSearch:false,familiarGeometryReached:true}),null);
  assert.equal(closureReason({activeWalkSeconds:CLOSURE_MAX_ACTIVE_SECONDS+30,exitSearchSeconds:CLOSURE_MIN_EXIT_SECONDS-1,inExitSearch:true,familiarGeometryReached:true}),null);
});

test("familiar geometry can close the encounter after eight and a half active minutes",()=>{
  assert.equal(closureReason({activeWalkSeconds:CLOSURE_MIN_ACTIVE_SECONDS-1,exitSearchSeconds:120,inExitSearch:true,familiarGeometryReached:true}),null);
  assert.equal(closureReason({activeWalkSeconds:CLOSURE_MIN_ACTIVE_SECONDS,exitSearchSeconds:CLOSURE_MIN_EXIT_SECONDS,inExitSearch:true,familiarGeometryReached:true}),"familiar_return");
});

test("the active-travel cap closes the encounter without inventing an exit",()=>{
  assert.equal(closureReason({activeWalkSeconds:CLOSURE_MAX_ACTIVE_SECONDS,exitSearchSeconds:CLOSURE_MIN_EXIT_SECONDS,inExitSearch:true,familiarGeometryReached:false}),"signal_limit");
  for(const reason of ["familiar_return","signal_limit"]){const line=finalAriadneLine(reason);assert.match(line,/MT/);assert.match(line,/—$/);assert.doesNotMatch(line,/found|there is the exit|exit is visible/i)}
});
