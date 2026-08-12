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

test("stationary activity preserves a natural reaction but removes invented progress",()=>{
  const activity={state:"stationary",stationarySeconds:25,positionChangedSinceRecommendation:false,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player has remained completely still for 25 seconds."};
  const reply=enforceActivityGrounding({message:"Wait, what are we feeling here? Good progress.",selectedRouteId:"r1",kind:"observation"},activity);
  assert.deepEqual(reply,{message:"Wait, what are we feeling here?",selectedRouteId:"r1",kind:"observation"});
});

test("autonomous hidden-map abstractions are replaced by a first-person verified observation",()=>{
  const activity={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player is walking."};
  const reply=enforcePlayerView({message:"I remember this place.",selectedRouteId:"r1",kind:"reframe"},{trigger:{type:"revisited_position"},activity,environment:null,legalRoutes:[{id:"r1"}],recommendationEvidence:null,recentMessages:[]});
  assert.equal(reply.message,"I remember this place.");assert.equal(reply.selectedRouteId,"r1");
});

test("environment observations mention only details supplied as visible",()=>{
  const activity={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player is walking."};
  const environment={id:"beach",regionId:"beach:1",name:"buried beach",details:["sand","shells"]};
  const reply=enforcePlayerView({message:"A useful landmark for our recovery.",selectedRouteId:null,kind:"environment"},{trigger:{type:"environment_visible",regionId:"beach:1",environment:"beach"},activity,environment,legalRoutes:[],recommendationEvidence:null,recentMessages:[]});
  assert.equal(reply.message,"A buried beach—sand and shells, all the way down here.");
});

test("verified failure always produces a brief apology even when the model requests guidance",()=>{
  const activity={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:true,description:"The player is walking."};
  const reply=enforcePlayerView({message:"I see a door ahead. Take it.",selectedRouteId:"r1",kind:"guidance"},{trigger:{type:"recommendation_contradicted",recommendationId:"g1"},activity,environment:null,legalRoutes:[{id:"r1"}],recommendationEvidence:null,recentMessages:[]});
  assert.equal(reply.message,"Oh no—that's completely on me. That way is blocked.");
});

test("a model-written reaction survives once and is suppressed when repeated",()=>{
  const activity={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player is walking."};
  const evidence={newCellsRevealedOffSuggestedPath:3};
  const body={trigger:{type:"trajectory_relationship_changed"},activity,environment:null,legalRoutes:[],recommendationEvidence:evidence,recentMessages:[]};
  const reply=enforcePlayerView({message:"You trusted your instinct there.",selectedRouteId:null,kind:"praise"},body);
  assert.equal(reply.message,"You trusted your instinct there.");
  assert.equal(enforcePlayerView({message:"You trusted your instinct there.",selectedRouteId:null,kind:"praise"},{...body,recentMessages:[{id:"1",role:"ariadne",text:reply.message,time:0}]}).message,"");
});

test("an equivalent alternate path can trigger quick agreement",()=>{
  const activity={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player is walking."};
  const reply=enforcePlayerView({message:"You saw that more clearly than I did.",selectedRouteId:null,kind:"agreement"},{trigger:{type:"same_target_reached_differently",recommendationId:"g1"},activity,environment:null,legalRoutes:[],recommendationEvidence:null,recentMessages:[]});
  assert.equal(reply.message,"You saw that more clearly than I did.");
});

test("an environmental detour can be optimistically reframed without claiming progress",()=>{
  const activity={state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:false,description:"The player is walking."};
  const environment={id:"beach",regionId:"beach:1",name:"buried beach",details:["sand","shells"]};
  const reply=enforcePlayerView({message:"We are nearly at the exit.",selectedRouteId:null,kind:"reframe"},{trigger:{type:"environment_visible",regionId:"beach:1",environment:"beach"},activity,environment,legalRoutes:[],recommendationEvidence:null,recentMessages:[]});
  assert.equal(reply.message,"A buried beach—sand and shells, all the way down here.");
});
