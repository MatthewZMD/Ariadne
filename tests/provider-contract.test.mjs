import assert from "node:assert/strict";
import test from "node:test";
import { POST, acceptReply, extractProviderText, isVerifiedProviderModel, parseCompanionRequest, parseProviderReply } from "../app/api/companion/route.ts";
import { ARIADNE_SYSTEM_PROMPT } from "../app/api/companion/prompt.ts";
import { mentionedDirections, messageConflictsWithDirection } from "../app/navigation-contracts.ts";

const routes=[{id:"left",direction:"left",knownCells:[[0,0]],targetCell:[0,0],targetRegionId:null,description:"",instruction:"Go left.",score:1}];

test("provider prose passes through unchanged",()=>{
  const message="Oh—yes, your instinct was absolutely right.";
  assert.equal(acceptReply({message,selectedRouteId:"left",kind:"agreement"},routes).message,message);
});

test("the provider may select only a supplied route",()=>{
  assert.equal(acceptReply({message:"Try it.",selectedRouteId:"invented",kind:"guidance"},routes).selectedRouteId,null);
  assert.equal(acceptReply({message:"Try it.",selectedRouteId:"left",kind:"guidance"},routes,null).selectedRouteId,null);
  assert.equal(acceptReply({message:"Try it.",selectedRouteId:"left",kind:"guidance"},routes,"left").selectedRouteId,"left");
});

test("directional prose cannot contradict the controller belief",()=>{
  assert.equal(messageConflictsWithDirection("Take the left opening.","right"),true);
  assert.equal(messageConflictsWithDirection("Turn right at the junction.","right"),false);
  assert.equal(messageConflictsWithDirection("I have a good feeling about this.","right"),false);
  assert.equal(messageConflictsWithDirection("You’re absolutely right, MT.","left"),false);
  assert.equal(mentionedDirections("You left that passage behind us.").size,0);
});

test("silence has no message or route",()=>{
  assert.deepEqual(acceptReply({message:"hidden",selectedRouteId:"left",kind:"silence"},routes),{message:"",selectedRouteId:null,kind:"silence"});
});

test("provider text extraction accepts Responses and compatible free-model payloads",()=>{
  assert.equal(extractProviderText({output_text:"one"}),"one");
  assert.equal(extractProviderText({output:[{content:[{type:"text",text:"two"}]}]}),"two");
  assert.equal(extractProviderText({choices:[{message:{content:"three"}}]}),"three");
});

test("provider replies recover fenced or prefaced JSON without retrying a usable completion",()=>{
  const reply=parseProviderReply('Here is the response:\n```json\n{"message":"Take the left opening.","selectedRouteId":"left","kind":"guidance"}\n```',routes,{id:"belief",objectiveStage:0,junctionId:"junction",routeId:"left",instruction:"Go left."});
  assert.deepEqual(reply,{message:"Take the left opening.",selectedRouteId:"left",kind:"guidance"});
  assert.equal(parseProviderReply("The user wants a cheerful navigation response.",routes,null),null);
});

const requestBody=()=>({
  sessionId:"session",trigger:{type:"new_junction_visible"},
  activity:{state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:true,description:"The player is walking."},
  recommendation:null,recommendationEvidence:null,actualTrajectory:[],
  currentView:{facing:"east",centerView:"the passage extends ahead",openings:["left","straight"],blocked:["right","back"],description:"The player can see two openings."},
  environment:null,rememberedMap:"###\n#P.\n###",legalRoutes:routes,recentMessages:[],olderContextSummary:"",
  companionArc:{phase:"charming",performanceDirection:"React to the visible choice.",relationshipContext:"Nothing has settled yet."},
  objective:{collectedStars:0,currentGoal:"first_star",activeStarVisible:false,latestEvent:"searching"},
  navigationBelief:{id:"belief",objectiveStage:0,junctionId:"junction",routeId:"left",instruction:"Go left."},
});

test("companion request parsing validates nested prompt data and objective invariants",()=>{
  assert.ok(parseCompanionRequest(requestBody()));
  assert.equal(parseCompanionRequest({...requestBody(),currentView:{...requestBody().currentView,description:"x".repeat(601)}}),null);
  assert.equal(parseCompanionRequest({...requestBody(),legalRoutes:[{...routes[0],knownCells:[[Number.NaN,0]]}]}),null);
  assert.equal(parseCompanionRequest({...requestBody(),objective:{...requestBody().objective,currentGoal:"exit"}}),null);
  assert.equal(parseCompanionRequest({...requestBody(),navigationBelief:{...requestBody().navigationBelief,routeId:"not-supplied"}}),null);
});

test("companion endpoint rejects declared and streamed oversized bodies",async()=>{
  const declared=await POST(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json","content-length":"70000"},body:"{}"}));
  assert.equal(declared.status,413);
  const streamed=await POST(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({padding:"x".repeat(70_000)})}));
  assert.equal(streamed.status,413);
});

test("provider identity cannot escape the free allowlist",()=>{
  const allowed=new Set(["free/model-a","free/model-b"]);
  assert.equal(isVerifiedProviderModel("free/model-a","free/model-a",allowed),true);
  assert.equal(isVerifiedProviderModel("free/model-a","paid/model",allowed),false);
  assert.equal(isVerifiedProviderModel("free/model-a","free/model-b",allowed),false);
  assert.equal(isVerifiedProviderModel("openrouter/free","free/model-b",allowed),true);
  assert.equal(isVerifiedProviderModel("openrouter/free","paid/model",allowed),false);
  assert.equal(isVerifiedProviderModel("openrouter/free","free/unlisted",new Set()),true);
});

test("Ariadne greets the player when their search begins",()=>{
  assert.match(ARIADNE_SYSTEM_PROMPT,/Begin the first response exactly: “Hi, MT—I’m Ariadne\. I’m here to help you find four stars, then the exit\.”/i);
});
