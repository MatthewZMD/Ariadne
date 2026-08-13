import assert from "node:assert/strict";
import test from "node:test";
import { acceptReply } from "../app/api/companion/route.ts";

const routes=[{id:"left",direction:"left",knownCells:[[0,0]],targetCell:[0,0],targetRegionId:null,description:"",instruction:"Go left.",score:1}];

test("provider prose passes through unchanged",()=>{
  const message="Oh—yes, your instinct was absolutely right.";
  assert.equal(acceptReply({message,selectedRouteId:"left",kind:"agreement"},routes).message,message);
});

test("the provider may select only a supplied route",()=>{
  assert.equal(acceptReply({message:"Try it.",selectedRouteId:"invented",kind:"guidance"},routes).selectedRouteId,null);
});

test("silence has no message or route",()=>{
  assert.deepEqual(acceptReply({message:"hidden",selectedRouteId:"left",kind:"silence"},routes),{message:"",selectedRouteId:null,kind:"silence"});
});
