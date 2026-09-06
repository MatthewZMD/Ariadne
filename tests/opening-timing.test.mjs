import assert from "node:assert/strict";
import test from "node:test";
import { advanceGreetingDelay, greetingDue } from "../app/opening-timing.ts";

test("greeting waits for movement and then two active seconds",()=>{
  let state={hasMoved:false,elapsed:0};
  for(let i=0;i<100;i++)state=advanceGreetingDelay(state,0,.05,true);
  assert.equal(greetingDue(state),false);
  state=advanceGreetingDelay(state,.02,.05,true);
  for(let i=0;i<36;i++)state=advanceGreetingDelay(state,0,.05,true);
  assert.equal(greetingDue(state),false);
  const paused=advanceGreetingDelay(state,0,20,false);assert.deepEqual(paused,state);
  for(let i=0;i<4;i++)state=advanceGreetingDelay(state,0,.05,true);
  assert.equal(greetingDue(state),true);
});
