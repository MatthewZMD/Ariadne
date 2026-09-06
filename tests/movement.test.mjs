import assert from "node:assert/strict";
import test from "node:test";
import { acceleratedSpeed, advanceInputRamp, createMouseLookInput, movePlayerFootprint, MOVE_ACCELERATION, TURN_ACCELERATION } from "../app/movement.ts";

test("uncaptured mouse look follows mouse movement without holding a button",()=>{
  const input=createMouseLookInput();
  assert.equal(input.move({clientX:100,movementX:50,buttons:0},false),0);
  assert.equal(input.move({clientX:150,movementX:0,buttons:0},false),.2);
  assert.equal(input.move({clientX:125,movementX:0,buttons:0},false),-.1);
  input.end();
  assert.equal(input.move({clientX:400,movementX:275,buttons:0},false),0);
  assert.equal(input.move({clientX:450,movementX:50,buttons:0},false),.2);
});

test("captured mouse look retains free movement and clears obsolete absolute-position state",()=>{
  const input=createMouseLookInput();input.start(100);
  assert.equal(input.move({clientX:100,movementX:80,buttons:0},true),.1);
  assert.equal(input.move({clientX:200,movementX:100,buttons:1},false),0);
});

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


test("the player cannot overlap either formerly unchecked corner of a wall",()=>{
  for(const wall of [[1,0],[0,1]]){
    const tile=(x,y)=>x===wall[0]&&y===wall[1]?1:0;
    const pose=wall[0]===1?{x:.75,y:.9}:{x:.9,y:.75};
    movePlayerFootprint(pose,.9,.9,.18,tile);
    for(let y=Math.floor(pose.y-.18);y<=Math.floor(pose.y+.18);y++)
      for(let x=Math.floor(pose.x-.18);x<=Math.floor(pose.x+.18);x++)
        assert.equal(tile(x,y),0,`footprint overlaps wall ${wall}`);
  }
});

test("a sustained slightly diagonal hold slides along a corridor wall and stops at its end",()=>{
  const tile=(x,y)=>y===1&&x>=0&&x<12?0:1;
  const pose={x:1.5,y:1.8};
  for(let frame=0;frame<180;frame++)movePlayerFootprint(pose,pose.x+2.65/60,pose.y+.25/60,.18,tile);
  assert.ok(pose.x>9,"side contact must preserve forward travel");
  assert.ok(pose.y<=1.82);
  for(let frame=0;frame<180;frame++)movePlayerFootprint(pose,pose.x+2.65/60,pose.y+.25/60,.18,tile);
  assert.ok(pose.x<=11.82,"the end wall remains solid");
  assert.ok(pose.x>11.7);
});
