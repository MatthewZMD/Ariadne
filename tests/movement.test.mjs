import assert from "node:assert/strict";
import test from "node:test";
import { acceleratedSpeed, advanceInputRamp, MOVE_ACCELERATION, TURN_ACCELERATION } from "../app/movement.ts";

test("movement speed rises smoothly while held and caps",()=>{
  let ramp={heldSeconds:0,direction:0},previous=MOVE_ACCELERATION.minimum;
  for(let index=0;index<30;index++){
    ramp=advanceInputRamp(ramp,1,.1,MOVE_ACCELERATION.rampSeconds);
    const speed=acceleratedSpeed(ramp,MOVE_ACCELERATION);assert.ok(speed>=previous);previous=speed;
  }
  assert.equal(ramp.heldSeconds,MOVE_ACCELERATION.rampSeconds);
  assert.equal(acceleratedSpeed(ramp,MOVE_ACCELERATION),MOVE_ACCELERATION.maximum);
});

test("turning has its own capped curve and resets on release or reversal",()=>{
  let ramp={heldSeconds:0,direction:0};
  ramp=advanceInputRamp(ramp,-1,.8,TURN_ACCELERATION.rampSeconds);assert.ok(acceleratedSpeed(ramp,TURN_ACCELERATION)>TURN_ACCELERATION.minimum);
  ramp=advanceInputRamp(ramp,0,.1,TURN_ACCELERATION.rampSeconds);assert.deepEqual(ramp,{heldSeconds:0,direction:0});
  ramp=advanceInputRamp({heldSeconds:1,direction:1},-1,.05,TURN_ACCELERATION.rampSeconds);assert.equal(ramp.heldSeconds,.05);assert.equal(ramp.direction,-1);
});
