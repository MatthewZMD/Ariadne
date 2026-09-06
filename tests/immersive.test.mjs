import assert from "node:assert/strict";
import test from "node:test";
import { requestMouseLook } from "../app/immersive.ts";

test("rejected mouse capture resolves to keyboard fallback without an unhandled rejection", async()=>{
  const browserError=new DOMException("If you see this error we have a bug. Please report this bug to chromium.","UnknownError");
  assert.equal(await requestMouseLook({requestPointerLock:()=>Promise.reject(browserError)}),false);
  assert.equal(await requestMouseLook({requestPointerLock:()=>{throw browserError}}),false);
  assert.equal(await requestMouseLook({}),false);
});

test("mouse capture preserves its receiver and accepts modern and legacy implementations", async()=>{
  const target={requestPointerLock(){assert.equal(this,target);return Promise.resolve()}};
  assert.equal(await requestMouseLook(target),true);
  assert.equal(await requestMouseLook({requestPointerLock(){}}),true);
});
