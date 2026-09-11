import assert from "node:assert/strict";
import test from "node:test";
import { AdaptiveQuality, renderPixelRatio } from "../app/field/performance.ts";
import { ThreadGeometry } from "../app/field/render/thread-geometry.ts";

function run(controller, ms, frame, work = 3) { for (let t = 0; t < ms; t += frame) controller.sample(frame, work); }

test("quality responds gradually to sustained load and recovers slowly", () => {
  const q = new AdaptiveQuality();
  run(q, 1000, 50); assert.equal(q.quality, 1, "startup is not a performance verdict");
  run(q, 12000, 40, 25);
  assert.ok(q.quality < .6 && q.quality > 0);
  const before = q.quality;
  run(q, 3000, 16.67); assert.ok(q.quality <= before, "brief improvement does not oscillate quality");
  run(q, 180000, 16.67); assert.ok(q.quality > before);
  assert.ok(q.quality <= 1);
});

test("isolated stalls and hidden-tab gaps do not drive quality down", () => {
  const q = new AdaptiveQuality(); run(q, 6000, 16.67);
  q.sample(250, 200); run(q, 5000, 16.67);
  assert.equal(q.target, 1);
  q.sample(60000, 0); assert.equal(q.target, 1);
  q.resetWindow(); run(q, 1000, 50); assert.equal(q.target, 1);
});

test("device hints remain provisional and pixel budgets stay bounded", () => {
  const q = new AdaptiveQuality({ cores: 2, memoryGB: 2 }); assert.equal(q.quality, .75);
  run(q, 120000, 16.67); assert.ok(q.quality > .75);
  for (const [w,h,dpr] of [[3840,2160,2],[800,600,1],[1920,1080,3]]) {
    const high=renderPixelRatio(dpr,w,h,1),low=renderPixelRatio(dpr,w,h,0);
    assert.ok(w*h*high*high <= 2500001); assert.ok(low < high && low > 0);
  }
});

test("thread geometry retains buffers and handles vertical or coincident samples", () => {
  const thread = new ThreadGeometry();
  const buffer=thread.core.getAttribute("position").array;
  for (const trail of [Array.from({length:12},(_,i)=>({x:0,y:i*.1,z:0})),Array.from({length:12},()=>({x:2,y:1,z:3}))]) {
    thread.update(trail,trail.at(-1),.02,.06);
    assert.equal(thread.core.getAttribute("position").array,buffer);
    assert.ok([...buffer].every(Number.isFinite));
    const halo=thread.halo.getAttribute("position").array;
    for(let i=0;i<buffer.length;i+=3) assert.ok(Math.abs(Math.hypot(halo[i]-buffer[i],halo[i+1]-buffer[i+1],halo[i+2]-buffer[i+2])-.04)<1e-5);
  }
  thread.dispose();
});
