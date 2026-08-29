import assert from "node:assert/strict";
import test from "node:test";
import { POST, acceptReply, buildProviderMessages, extractProviderText, isVerifiedProviderModel, parseCompanionRequest, parseProviderReply, providerReplyRestartsJourney } from "../app/api/companion/route.ts";
import { createSpeechAnchor, speechAnchorIsCompatible, speechBypassesProviderBackoff } from "../app/embodied-interaction.ts";
import { ARIADNE_SYSTEM_PROMPT } from "../app/api/companion/prompt.ts";
import { mentionedDirections, messageConflictsWithDirection, messageConflictsWithRoute, messageIdentifiesRoute } from "../app/navigation-contracts.ts";

const routes=[{id:"left",direction:"left",knownCells:[[0,0]],targetCell:[0,0],targetRegionId:null,description:"",instruction:"Go left.",score:1}];
const perceivedScene={setting:{primaryEnvironment:"neutral",blendedEnvironments:["neutral"],visibleDetails:["the shifting maze","moving fossils"]},geometry:{facingDescription:"MT is facing east",visibleOpenings:[{direction:"left",description:"an open passage on MT's left"},{direction:"straight",description:"an open passage ahead"}],visibleEndAhead:false,visibleJunction:true},objects:[{name:"a gold rune",direction:"left",distance:"mid",action:"rearranging its own pixels",firstSeen:true}],spectacles:[{description:"gold runes are falling upward along the walls",direction:"left",salience:"major",firstSeen:true}],objective:{starVisible:false,starDirection:null,starDistance:null},mtAttention:{lookingToward:null,approaching:null,movingAwayFrom:null,pausedNear:null}};
const embodiment={currentAction:"You are floating naturally beside MT's right shoulder.",positionRelativeToMT:"beside MT's right shoulder",relationToBelievedRoute:null,mtLookingAtAriadne:false,mtApproachingAriadne:false,mtFollowingHerLead:false,mtLeavingWhileSheWaits:false,mtReturningToHer:false};

test("provider prose passes through unchanged",()=>{
  const message="Oh—yes, your instinct was absolutely right.";
  assert.equal(acceptReply({message}).message,message);
});

test("the provider response has no route-selection channel",()=>{
  assert.deepEqual(acceptReply({message:"This way, MT.",selectedRouteId:"invented"}),{message:"This way, MT."});
});

test("directional prose cannot contradict the controller belief",()=>{
  assert.equal(messageConflictsWithDirection("Take the left opening.","right"),true);
  assert.equal(messageConflictsWithDirection("Turn right at the junction.","right"),false);
  assert.equal(messageConflictsWithDirection("I have a good feeling about this.","right"),false);
  assert.equal(messageConflictsWithDirection("You’re absolutely right, MT.","left"),false);
  assert.equal(mentionedDirections("You left that passage behind us.").size,0);
});

test("a route ordinal is part of the navigation contract",()=>{
  const secondLeft={...routes[0],openingOrdinal:2,sameSideOpeningCount:2,instruction:"Take the second passage on your left."};
  assert.equal(messageIdentifiesRoute("Take the second passage on your left.",secondLeft),true);
  assert.equal(messageIdentifiesRoute("Turn left.",secondLeft),false);
  assert.equal(messageConflictsWithRoute("Take the first passage on your left.",secondLeft),true);
  assert.equal(messageConflictsWithRoute("I trust this one.",secondLeft),false);
});

test("provider text extraction accepts Responses and compatible free-model payloads",()=>{
  assert.equal(extractProviderText({output_text:"one"}),"one");
  assert.equal(extractProviderText({output:[{content:[{type:"text",text:"two"}]}]}),"two");
  assert.equal(extractProviderText({choices:[{message:{content:"three"}}]}),"three");
});

test("provider replies recover fenced or prefaced JSON without retrying a usable completion",()=>{
  const reply=parseProviderReply('Here is the response:\n```json\n{"message":"This way, MT.","selectedRouteId":"left"}\n```');
  assert.deepEqual(reply,{message:"This way, MT."});
  assert.equal(parseProviderReply("The user wants a cheerful navigation response."),null);
});

test("mistake repair survives a changing junction episode and bypasses transient low-priority backoff",()=>{
  const episode={id:"embodied:old",junctionId:"old",beliefId:"belief",routeId:"left",openedAt:0,speechEpoch:2,state:"route_contradicted"};
  const event={type:"dead_end_visible",cell:[2,1]},anchor=createSpeechAnchor(event,episode);
  assert.equal(anchor.speechAct,"repair_mistake");assert.equal(anchor.episodeId,null);assert.equal(speechAnchorIsCompatible(anchor,{...episode,id:"embodied:new",state:"noticing"}),true);
  assert.equal(speechBypassesProviderBackoff(event,true),true);assert.equal(speechBypassesProviderBackoff({type:"new_junction_visible"},true),true);assert.equal(speechBypassesProviderBackoff({type:"passing_thought"},true),false);
});

const requestBody=()=>({
  sessionId:"session",trigger:{type:"new_junction_visible"},speechAnchor:{episodeId:"embodied:belief",episodeState:"committing",speechAct:"invite_to_visible_choice",speechEpoch:0},dispositionCard:"You are warmly confident and allowing MT room.",
  activity:{state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:true,description:"The player is walking."},
  recommendation:null,recommendationEvidence:null,actualTrajectory:[],
  currentView:{facing:"east",centerView:"the passage extends ahead",openings:["left","straight"],blocked:["right","back"],description:"The player can see two openings."},
  environment:null,perceivedScene,sceneChanges:["gold runes are falling upward along the walls"],rememberedMap:"###\n#P.\n###",legalRoutes:routes,recentMessages:[],olderContextSummary:"",
  companionArc:{phase:"charming",performanceDirection:"React to the visible choice.",relationshipContext:"Nothing has settled yet."},
  objective:{collectedStars:0,currentGoal:"first_star",activeStarVisible:false,latestEvent:"searching"},
  navigationBelief:{id:"belief",objectiveStage:0,junctionId:"junction",routeId:"left",instruction:"Go left."},
  embodiment,
});

test("companion request parsing validates nested prompt data and objective invariants",()=>{
  assert.ok(parseCompanionRequest(requestBody()));
  assert.ok(parseCompanionRequest({...requestBody(),trigger:{type:"left_ariadne_waiting"},speechAnchor:{episodeId:"embodied:belief",episodeState:"mt_diverging",speechAct:"catch_up",speechEpoch:1},navigationBelief:null,embodiment:{...embodiment,currentAction:"You have caught up beside MT.",mtLeavingWhileSheWaits:true}}));
  assert.equal(parseCompanionRequest({...requestBody(),currentView:{...requestBody().currentView,description:"x".repeat(601)}}),null);
  assert.equal(parseCompanionRequest({...requestBody(),legalRoutes:[{...routes[0],knownCells:[[Number.NaN,0]]}]}),null);
  assert.equal(parseCompanionRequest({...requestBody(),objective:{...requestBody().objective,currentGoal:"exit"}}),null);
  assert.equal(parseCompanionRequest({...requestBody(),navigationBelief:{...requestBody().navigationBelief,routeId:"not-supplied"}}),null);
  assert.equal(parseCompanionRequest({...requestBody(),perceivedScene:{...perceivedScene,objects:[{...perceivedScene.objects[0],distance:"twelve metres"}]}}),null);
  assert.equal(parseCompanionRequest({...requestBody(),embodiment:{...embodiment,mtLookingAtAriadne:"yes"}}),null);
});

test("companion endpoint rejects declared and streamed oversized bodies",async()=>{
  const declared=await POST(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json","content-length":"70000"},body:"{}"}));
  assert.equal(declared.status,413);
  const streamed=await POST(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({padding:"x".repeat(70_000)})}));
  assert.equal(streamed.status,413);
});

test("a healthy sticky model does not fetch the model catalog",async()=>{
  const originalFetch=globalThis.fetch,originalProvider=process.env.AI_PROVIDER,originalKey=process.env.OPENROUTER_API_KEY,calls=[];
  process.env.AI_PROVIDER="openrouter";process.env.OPENROUTER_API_KEY="test-key";
  globalThis.fetch=async(url)=>{
    calls.push(String(url));
    return new Response(JSON.stringify({model:"dots-studio/dots-3-note-preview:free",choices:[{message:{content:"Take the left passage, MT—I have such a good feeling about it."}}]}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const response=await POST(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(requestBody())}));
    const reply=await response.json();
    assert.equal(reply.source,"provider");
    assert.equal(reply.message,"Take the left passage, MT—I have such a good feeling about it.");
    assert.deepEqual(calls,["https://openrouter.ai/api/v1/chat/completions"]);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalProvider===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=originalProvider;
    if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
  }
});

test("junction speech tries one preferred free model before consulting the catalog",async()=>{
  const originalFetch=globalThis.fetch,originalProvider=process.env.AI_PROVIDER,originalKey=process.env.OPENROUTER_API_KEY,calls=[];
  process.env.AI_PROVIDER="openrouter";process.env.OPENROUTER_API_KEY="test-key";
  globalThis.fetch=async(url,options)=>{
    calls.push(String(url));
    if(String(url).includes("/models"))return new Response(JSON.stringify({data:[{id:"google/gemma-4-26b-a4b-it:free",created:2,context_length:32768,architecture:{input_modalities:["text"],output_modalities:["text"]},pricing:{prompt:"0",completion:"0",request:"0"},reasoning:{mandatory:false,default_enabled:false}}]}),{status:200,headers:{"content-type":"application/json"}});
    const model=JSON.parse(String(options?.body)).model;
    if(model==="dots-studio/dots-3-note-preview:free")return new Response(JSON.stringify({error:{message:"temporarily unavailable"}}),{status:500});
    return new Response(JSON.stringify({model,choices:[{message:{content:"MT, trust me on this one—come with me."}}]}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const response=await POST(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(requestBody())})),reply=await response.json();
    assert.equal(reply.source,"provider");assert.equal(calls.filter(url=>url.includes("chat/completions")).length,2);assert.equal(calls.filter(url=>url.includes("/models")).length,1);assert.match(reply.message,/MT/);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalProvider===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=originalProvider;
    if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
  }
});

test("a failed sticky model gets one distinct curated alternative without request fan-out",async()=>{
  const originalFetch=globalThis.fetch,originalProvider=process.env.AI_PROVIDER,originalKey=process.env.OPENROUTER_API_KEY,attempted=[];
  process.env.AI_PROVIDER="openrouter";process.env.OPENROUTER_API_KEY="test-key";
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes("/models"))return new Response(JSON.stringify({data:[]}),{status:200,headers:{"content-type":"application/json"}});
    const model=JSON.parse(String(options?.body)).model;attempted.push(model);
    if(model!=="google/gemma-4-26b-a4b-it:free")return new Response(JSON.stringify({error:{message:"temporarily rate-limited upstream"}}),{status:429});
    return new Response(JSON.stringify({model,choices:[{message:{content:"MT, I’m right here—come on, let’s try this together."}}]}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const body={...requestBody(),preferredModelId:"google/gemma-4-31b-it:free"};
    const response=await POST(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})),reply=await response.json();
    assert.equal(reply.source,"provider");assert.equal(reply.modelUsed,"google/gemma-4-26b-a4b-it:free");assert.equal(new Set(attempted).size,attempted.length);assert.equal(attempted.length,2);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalProvider===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=originalProvider;
    if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
  }
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

test("conversation history is sent as real provider roles instead of flattened prompt text",()=>{
  const body={...requestBody(),trigger:{type:"passing_thought"},navigationBelief:null,olderContextSummary:"ARIADNE: Earlier line.",recentMessages:[
    {id:"a",role:"ariadne",text:"We have already begun.",time:1},
    {id:"m",role:"player",text:"Keep going.",time:2},
  ]};
  const messages=buildProviderMessages(body);
  assert.deepEqual(messages.slice(0,-1).map(message=>message.role),["system","user","assistant","user"]);
  assert.equal(messages[2].content,"We have already begun.");
  assert.equal(messages[3].content,"Keep going.");
  assert.doesNotMatch(messages.at(-1).content,/RECENT CONVERSATION|We have already begun/);
  assert.match(messages.at(-1).content,/gold runes are falling upward|rearranging its own pixels/);
  assert.match(messages.at(-1).content,/floating naturally beside MT's right shoulder/);
  assert.match(ARIADNE_SYSTEM_PROMPT,/animated body owns spatial direction/);
  assert.doesNotMatch(ARIADNE_SYSTEM_PROMPT,/Begin the first response exactly/i);
});

test("the opening greeting exists only in the initial scene event",()=>{
  const initial=buildProviderMessages({...requestBody(),trigger:{type:"initial_guidance"}}).at(-1).content;
  const later=buildProviderMessages({...requestBody(),trigger:{type:"passing_thought"},navigationBelief:null}).at(-1).content;
  assert.match(initial,/Hi, MT—I’m Ariadne\. I’m here to help you find four stars, then the exit\./);
  assert.doesNotMatch(later,/Hi, MT—I’m Ariadne|first moment together/i);
});

test("a later provider reply cannot restart Ariadne's introduction",()=>{
  assert.equal(providerReplyRestartsJourney("Hi, MT—I’m Ariadne. I’m here to help you find four stars, then the exit."),true);
  assert.equal(providerReplyRestartsJourney("Oh, MT—I’m changing my mind. Turn around."),false);
});
