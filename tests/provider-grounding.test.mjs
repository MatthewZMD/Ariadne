import assert from "node:assert/strict";
import test from "node:test";
import { enforceActivityGrounding, enforcePlayerView, groundReply } from "../app/api/companion/route.ts";

test("provider spatial hallucinations are removed while preserving the verified route selection",()=>{
  const route={id:"verified-right",direction:"right",knownCells:[[0,1]],targetCell:[0,1],targetRegionId:null,description:"Verified open passage on the player's right.",instruction:"Turn right.",score:5};
  const reply=groundReply({message:"Good choice. Take the passage on your left.",selectedRouteId:route.id,kind:"guidance"},[route]);
  assert.equal(reply.message,"Good choice.");
  assert.equal(reply.selectedRouteId,route.id);
});

test("spatial claims are removed when no legal route was selected",()=>{
  const reply=groundReply({message:"A frozen archive. Go left now.",selectedRouteId:null,kind:"environment"},[]);
  assert.equal(reply.message,"A frozen archive.");
});

test("an unsupported claim that the exit was found never reaches the player",()=>{
  const reply=groundReply({message:"You found the exit—excellent work.",selectedRouteId:null,kind:"praise"},[]);
  assert.equal(reply.message,"");assert.equal(reply.selectedRouteId,null);
});

test("negative exit-status commentary remains available",()=>{
  const reply=groundReply({message:"No exit yet, but the frozen archive is remarkable.",selectedRouteId:null,kind:"environment"},[]);
  assert.equal(reply.message,"No exit yet, but the frozen archive is remarkable.");
});

test("stationary activity gets one exact acknowledgement and no invented progress",()=>{
  const activity={state:"stationary",stationarySeconds:25,positionChangedSinceRecommendation:false,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player has remained completely still for 25 seconds."};
  const reply=enforceActivityGrounding({message:"Good progress. Keep moving.",selectedRouteId:"r1",kind:"praise"},activity,{type:"idle",seconds:25,atChoice:false});
  assert.deepEqual(reply,{message:"No rush.",selectedRouteId:null,kind:"observation"});
});

test("autonomous hidden-map abstractions are replaced by a first-person verified observation",()=>{
  const activity={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player is walking."};
  const reply=enforcePlayerView({message:"The loop is confirmed; use the landmark to recover.",selectedRouteId:"r1",kind:"reframe"},{trigger:{type:"revisited_position"},activity,environment:null,legalRoutes:[{id:"r1"}],recommendationEvidence:null});
  assert.equal(reply.message,"Good catch. We've been here before.");assert.equal(reply.selectedRouteId,"r1");
});

test("environment observations mention only details supplied as visible",()=>{
  const activity={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player is walking."};
  const environment={id:"beach",regionId:"beach:1",name:"buried beach",details:["sand","shells"]};
  const reply=enforcePlayerView({message:"A useful landmark for our recovery.",selectedRouteId:null,kind:"environment"},{trigger:{type:"environment_visible",regionId:"beach:1",environment:"beach"},activity,environment,legalRoutes:[],recommendationEvidence:null});
  assert.equal(reply.message,"A buried beach—sand and shells, all the way down here.");
});

test("verified failure always produces a brief apology even when the model requests guidance",()=>{
  const activity={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:true,description:"The player is walking."};
  const reply=enforcePlayerView({message:"I see a door ahead. Take it.",selectedRouteId:"r1",kind:"guidance"},{trigger:{type:"recommendation_contradicted",recommendationId:"g1"},activity,environment:null,legalRoutes:[{id:"r1"}],recommendationEvidence:null});
  assert.equal(reply.message,"Sorry—I had that wrong. That way is blocked.");
});

test("useful off-suggestion exploration can receive grounded over-credit",()=>{
  const activity={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player is walking."};
  const evidence={newCellsRevealedOffSuggestedPath:3};
  const reply=enforcePlayerView({message:"You knew exactly what you were doing.",selectedRouteId:null,kind:"praise"},{trigger:{type:"trajectory_relationship_changed"},activity,environment:null,legalRoutes:[],recommendationEvidence:evidence});
  assert.equal(reply.message,"Good choice. There's more to see this way.");
});

test("an equivalent alternate path can trigger quick agreement",()=>{
  const activity={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player is walking."};
  const reply=enforcePlayerView({message:"You were right about everything.",selectedRouteId:null,kind:"agreement"},{trigger:{type:"same_target_reached_differently",recommendationId:"g1"},activity,environment:null,legalRoutes:[],recommendationEvidence:null});
  assert.equal(reply.message,"You were right to take that direction.");
});

test("an environmental detour can be optimistically reframed without claiming progress",()=>{
  const activity={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player is walking."};
  const environment={id:"beach",regionId:"beach:1",name:"buried beach",details:["sand","shells"]};
  const reply=enforcePlayerView({message:"We are nearly at the exit.",selectedRouteId:null,kind:"reframe"},{trigger:{type:"environment_visible",regionId:"beach:1",environment:"beach"},activity,environment,legalRoutes:[],recommendationEvidence:null});
  assert.equal(reply.message,"Not the exit, but this is worth seeing. A buried beach—sand and shells, all the way down here.");
});
