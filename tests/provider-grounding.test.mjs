import assert from "node:assert/strict";
import test from "node:test";
import { groundReply } from "../app/api/companion/route.ts";

test("provider spatial hallucinations are removed and replaced by verified instructions",()=>{
  const route={id:"verified-right",direction:"right",knownCells:[[0,1]],targetCell:[0,1],targetRegionId:null,description:"Verified open passage on the player's right.",instruction:"Turn right into the open passage.",score:5};
  const reply=groundReply({message:"Good choice. Take the passage on your left.",selectedRouteId:route.id,kind:"guidance"},[route]);
  assert.equal(reply.message,"Good choice. Turn right into the open passage.");
  assert.equal(reply.selectedRouteId,route.id);
});

test("spatial claims are removed when no legal route was selected",()=>{
  const reply=groundReply({message:"A frozen archive. Go left now.",selectedRouteId:null,kind:"environment"},[]);
  assert.equal(reply.message,"A frozen archive.");
});
