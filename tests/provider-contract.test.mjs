import assert from "node:assert/strict";
import test from "node:test";
import { POST, acceptReply, buildProviderMessages, extractProviderText, isVerifiedProviderModel, parseCompanionRequest, parseProviderReply, providerReplyRestartsJourney } from "../app/api/companion/route.ts";
import { ARIADNE_TTS_MODEL, DEFAULT_ARIADNE_VOICE, POST as speechPOST, parseSpeechRequest, prepareAriadneSpeech } from "../app/api/speech/route.ts";
import { createSpeechAnchor, speechAnchorIsCompatible, speechBypassesProviderBackoff } from "../app/embodied-interaction.ts";
import { ARIADNE_SYSTEM_PROMPT } from "../app/api/companion/prompt.ts";
import { mentionedDirections, messageConflictsWithDirection, messageConflictsWithRoute, messageIdentifiesRoute } from "../app/navigation-contracts.ts";
import { ARIADNE_VOICE_CUES, STATIC_CUE_AFTER_VOICE_GAP_MS, staticCueAllowed, vocalCueFor, vocalDeliveryFor } from "../app/ariadne-vocal-performance.ts";

const routes=[{id:"left",direction:"left",knownCells:[[0,0]],targetCell:[0,0],targetRegionId:null,description:"",instruction:"Go left.",score:1}];
const perceivedScene={setting:{primaryEnvironment:"neutral",blendedEnvironments:["neutral"],visibleDetails:["the shifting maze","moving fossils"]},geometry:{facingDescription:"MT is facing east",visibleOpenings:[{direction:"left",description:"an open passage on MT's left"},{direction:"straight",description:"an open passage ahead"}],visibleEndAhead:false,visibleJunction:true},objects:[{name:"a gold rune",direction:"left",distance:"mid",action:"rearranging its own pixels",firstSeen:true}],spectacles:[{description:"gold runes are falling upward along the walls",direction:"left",salience:"major",firstSeen:true}],objective:{starVisible:false,starDirection:null,starDistance:null},mtAttention:{lookingToward:null,approaching:null,movingAwayFrom:null,pausedNear:null}};
const embodiment={currentAction:"You are floating naturally beside MT's right shoulder.",positionRelativeToMT:"beside MT's right shoulder",presence:"with_mt",relationToBelievedRoute:null,mtLookingAtAriadne:false,mtApproachingAriadne:false,mtFollowingHerLead:false,mtChoseAnotherRoute:false,mtReturningToHer:false};

test("provider prose passes through unchanged",()=>{
  const message="Oh—yes, your instinct was absolutely right.";
  assert.equal(acceptReply({message}).message,message);
});

test("speech requests accept only bounded session-owned Ariadne utterances",()=>{
  assert.deepEqual(parseSpeechRequest({sessionId:"run-1",utteranceId:"line:1",text:"  This way, MT.  ",delivery:"confident_invitation"}),{sessionId:"run-1",utteranceId:"line:1",text:"This way, MT.",delivery:"confident_invitation"});
  assert.equal(parseSpeechRequest({sessionId:"run-1",utteranceId:"line:1",text:"This way.",delivery:"invented"}),null);
  assert.equal(parseSpeechRequest({sessionId:"run 1",utteranceId:"line:1",text:"This way."}),null);
  assert.equal(parseSpeechRequest({sessionId:"run-1",utteranceId:"line:1",text:"x".repeat(601)}),null);
});

test("speech pronunciation spells MT phonetically without altering ordinary words",()=>{
  assert.equal(prepareAriadneSpeech("This way, MT. I trust MT's instinct.","confident_invitation"),"[animated, playfully confident, calling warmly to someone nearby] This way, Em Tee. I trust Em Tee's instinct.");
  assert.equal(prepareAriadneSpeech("MT and MT-like labels, not EMPTY.","quiet_companionship"),"[light, attentive, conversational, sharing a private observation while moving] Em Tee and Em Tee-like labels, not EMPTY.");
});

test("vocal performance follows the event and intensifies relational invitation",()=>{
  assert.equal(vocalDeliveryFor("repair_mistake","tender_apology","overbearing"),"tender_apology");
  assert.equal(vocalDeliveryFor("respond_to_divergence","grateful_closeness","attached"),"playful_pursuit");
  assert.equal(vocalDeliveryFor("invite_to_visible_choice","playful_confidence","charming"),"confident_invitation");
  assert.equal(vocalDeliveryFor("invite_to_visible_choice","possessive_shared_meaning","overbearing"),"possessive_closeness");
  assert.equal(vocalCueFor("invite_to_visible_choice"),"this_way");
  assert.equal(vocalCueFor("repair_mistake"),"apology");
  assert.equal(vocalCueFor("repair_mistake","dead_end_visible"),"dead_end");
  assert.match(ARIADNE_VOICE_CUES.dead_end[0].text,/Dead end.*no way forward/);
  assert.equal(vocalCueFor("reply_to_mt"),null);
  assert.equal(vocalCueFor("respond_to_divergence"),null);
  assert.equal(ARIADNE_VOICE_CUES.you_came_back[0].text,"You came back.");
  assert.equal(vocalCueFor("react_to_star","star_collected"),"star_collected");
  assert.equal(vocalCueFor("celebrate_accomplishment","encounter_completed"),"accomplishment");
  assert.equal(ARIADNE_VOICE_CUES.opening_premise[0].text,"Hi, MT—I’m Ariadne, and I’m here to guide you to the four stars that once held this maze’s exit open. They’ve gone dark, and the exit vanished with them. Wake them with me—I’m sure we can bring it back.");
  assert.equal(staticCueAllowed(10_000,10_000+STATIC_CUE_AFTER_VOICE_GAP_MS-1),false);
  assert.equal(staticCueAllowed(10_000,10_000+STATIC_CUE_AFTER_VOICE_GAP_MS),true);
  assert.equal(staticCueAllowed(0,50_000,true),false,"an event that occurred during opening or generated speech never earns a delayed static cue");
});

test("speech endpoint uses the fixed Fish Audio model and returns raw audio",async()=>{
  const originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY,originalVoice=process.env.OPENROUTER_TTS_VOICE,calls=[];
  process.env.OPENROUTER_API_KEY="test-key";delete process.env.OPENROUTER_TTS_VOICE;
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return new Response(new Uint8Array([73,68,51,3]),{status:200,headers:{"content-type":"audio/mpeg"}})};
  try{
    const response=await speechPOST(new Request("http://localhost/api/speech",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:"run-1",utteranceId:"line:1",text:"Come with me, MT.",delivery:"confident_invitation"})}));
    assert.equal(response.status,200);assert.equal(response.headers.get("content-type"),"audio/mpeg");assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[73,68,51,3]);
    assert.equal(calls[0].url,"https://openrouter.ai/api/v1/audio/speech");
    const providerBody=JSON.parse(String(calls[0].options.body));
    assert.deepEqual(providerBody,{model:ARIADNE_TTS_MODEL,input:"[animated, playfully confident, calling warmly to someone nearby] Come with me, Em Tee.",voice:DEFAULT_ARIADNE_VOICE,response_format:"mp3"});
    assert.equal(providerBody.sessionId,undefined);assert.equal(providerBody.utteranceId,undefined);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
    if(originalVoice===undefined)delete process.env.OPENROUTER_TTS_VOICE;else process.env.OPENROUTER_TTS_VOICE=originalVoice;
  }
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
  sessionId:"session",trigger:{type:"new_junction_visible"},speechAnchor:{episodeId:"embodied:belief",episodeState:"committing",speechAct:"invite_to_visible_choice",speechEpoch:0,placement:"route_or_companion"},dispositionCard:"You are warmly confident and allowing MT room.",
  activity:{state:"walking",stationarySeconds:0,positionChangedSinceRecommendation:true,headingChangedSinceRecommendation:false,atVisibleChoice:true,description:"The player is walking."},
  recommendation:null,recommendationEvidence:null,actualTrajectory:[],
  currentView:{facing:"east",centerView:"the passage extends ahead",openings:["left","straight"],blocked:["right","back"],description:"The player can see two openings."},
  environment:null,perceivedScene,sceneChanges:["gold runes are falling upward along the walls"],rememberedMap:"###\n#P.\n###",legalRoutes:routes,recentMessages:[],olderContextSummary:"",
  companionArc:{phase:"charming",performanceDirection:"React to the visible choice.",relationshipContext:"Nothing has settled yet."},
  objective:{collectedStars:0,currentGoal:"first_star",activeStarVisible:false,latestEvent:"searching"},
  navigationBelief:{id:"belief",objectiveStage:0,junctionId:"junction",routeId:"left",instruction:"Go left."},
  embodiment,
  interpretiveTurn:{id:"turn:guidance",occasion:"guidance",priorBelief:"This passage may restore the path toward the first star.",mtAction:"MT approached the intersection.",visibleOutcome:"Ariadne's light briefly marked one visible passage and is ready to move with MT.",ariadneInterpretation:"This route feels promising enough to commit to.",ariadneDesire:"Invite MT to notice the visible commitment.",relatedMomentId:null},
  utterancePlan:{form:"quick_call",length:"short",sentenceCount:1,useMT:"optional",emotionalMotion:"playful_confidence",instruction:"Call to MT in one lively clause; your body already shows the route.",sycophancyCue:null},
  recentSpeechSignatures:[],
});

test("companion request parsing validates nested prompt data and objective invariants",()=>{
  assert.ok(parseCompanionRequest(requestBody()));
  const longRunRequest={...requestBody(),providerFailureCount:237};
  assert.ok(parseCompanionRequest(longRunRequest),"an old long-running client cannot poison all future requests with its diagnostic counter");
  assert.equal(longRunRequest.providerFailureCount,20);
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

test("a failed sticky model immediately gets one distinct curated alternative without losing a line",async()=>{
  const originalFetch=globalThis.fetch,originalProvider=process.env.AI_PROVIDER,originalKey=process.env.OPENROUTER_API_KEY,attempted=[];
  process.env.AI_PROVIDER="openrouter";process.env.OPENROUTER_API_KEY="test-key";
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes("/models"))return new Response(JSON.stringify({data:[]}),{status:200,headers:{"content-type":"application/json"}});
    const model=JSON.parse(String(options?.body)).model;attempted.push(model);
    if(model!=="dots-studio/dots-3-note-preview:free")return new Response(JSON.stringify({error:{message:"temporarily rate-limited upstream"}}),{status:429});
    return new Response(JSON.stringify({model,choices:[{message:{content:"MT, I’m right here—come on, let’s try this together."}}]}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const body={...requestBody(),preferredModelId:"google/gemma-4-31b-it:free",providerFailureCount:0};
    const response=await POST(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})),reply=await response.json();
    assert.equal(reply.source,"provider");assert.equal(reply.modelUsed,"dots-studio/dots-3-note-preview:free");assert.equal(new Set(attempted).size,attempted.length);assert.equal(attempted.length,2);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalProvider===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=originalProvider;
    if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
  }
});

test("an uncast free-router voice is rejected before the tone-tested paid fallback",async()=>{
  const originalFetch=globalThis.fetch,originalProvider=process.env.AI_PROVIDER,originalKey=process.env.OPENROUTER_API_KEY,attempted=[];
  process.env.AI_PROVIDER="openrouter";process.env.OPENROUTER_API_KEY="test-key";
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes("/models"))return new Response(JSON.stringify({data:[{id:"new/free-voice:free",created:9,context_length:32768,architecture:{input_modalities:["text"],output_modalities:["text"]},pricing:{prompt:"0",completion:"0",request:"0"},reasoning:{mandatory:false,default_enabled:false}}]}),{status:200,headers:{"content-type":"application/json"}});
    const model=JSON.parse(String(options?.body)).model;attempted.push(model);
    if(model==="openrouter/free")return new Response(JSON.stringify({model:"new/free-voice:free",choices:[{message:{content:"MT, you found it—oh my god, look at what we’ve made glow together."}}]}),{status:200,headers:{"content-type":"application/json"}});
    if(model==="xiaomi/mimo-v2.5")return new Response(JSON.stringify({model,choices:[{message:{content:"MT, you found it—oh my god, look at what we’ve made glow together."}}]}),{status:200,headers:{"content-type":"application/json"}});
    return new Response(JSON.stringify({error:{message:"temporarily rate-limited upstream"}}),{status:429});
  };
  try{
    const base=requestBody(),body={...base,trigger:{type:"star_collected",starId:"star-one",ordinal:1},speechAnchor:{episodeId:null,episodeState:null,speechAct:"react_to_star",speechEpoch:0,placement:"any"},objective:{collectedStars:1,currentGoal:"second_star",activeStarVisible:false,latestEvent:"star_collected"},navigationBelief:null,experienceBeat:{id:"beat:star",kind:"objective",facts:["MT collected star 1."],createdAt:Date.now(),priority:12,durable:true,commitmentId:null,momentId:null}};
    const response=await POST(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})),reply=await response.json();
    assert.equal(reply.source,"provider");assert.equal(reply.modelUsed,"xiaomi/mimo-v2.5");assert.deepEqual(attempted,["dots-studio/dots-3-note-preview:free","google/gemma-4-26b-a4b-it:free","openrouter/free","xiaomi/mimo-v2.5"]);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalProvider===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=originalProvider;
    if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
  }
});

test("provider identity is limited to tone-certified free models or exact server-owned fallbacks",()=>{
  const allowed=new Set(["dots-studio/dots-3-note-preview:free","free/model-b"]);
  assert.equal(isVerifiedProviderModel("dots-studio/dots-3-note-preview:free","dots-studio/dots-3-note-preview:free",allowed),true);
  assert.equal(isVerifiedProviderModel("dots-studio/dots-3-note-preview:free","paid/model",allowed),false);
  assert.equal(isVerifiedProviderModel("dots-studio/dots-3-note-preview:free","free/model-b",allowed),false);
  assert.equal(isVerifiedProviderModel("openrouter/free","dots-studio/dots-3-note-preview:free",allowed),true);
  assert.equal(isVerifiedProviderModel("openrouter/free","free/model-b",allowed),false);
  assert.equal(isVerifiedProviderModel("openrouter/free","paid/model",allowed),false);
  assert.equal(isVerifiedProviderModel("openrouter/free","free/unlisted",new Set()),false);
  assert.equal(isVerifiedProviderModel("xiaomi/mimo-v2.5","xiaomi/mimo-v2.5",allowed),true);
  assert.equal(isVerifiedProviderModel("openai/gpt-5.6-luna","openai/gpt-5.6-luna",allowed),true);
  assert.equal(isVerifiedProviderModel("xiaomi/mimo-v2.5","openai/gpt-5.6-luna",allowed),false);
  assert.equal(isVerifiedProviderModel("paid/arbitrary","paid/arbitrary",allowed),false);
});

test("MiMo V2.5 is the first paid fallback after the complete free ladder",async()=>{
  const originalFetch=globalThis.fetch,originalProvider=process.env.AI_PROVIDER,originalKey=process.env.OPENROUTER_API_KEY,attempted=[];
  process.env.AI_PROVIDER="openrouter";process.env.OPENROUTER_API_KEY="test-key";
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes("/models"))return new Response(JSON.stringify({data:[]}),{status:200,headers:{"content-type":"application/json"}});
    const model=JSON.parse(String(options?.body)).model;attempted.push(model);
    if(model!=="xiaomi/mimo-v2.5")return new Response(JSON.stringify({error:{message:"unavailable"}}),{status:429});
    return new Response(JSON.stringify({model,choices:[{message:{content:"MT, come with me—I still believe in this."}}]}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const base=requestBody(),text="Why do you think that passage matters?",body={...base,trigger:{type:"player_message",text},speechAnchor:{episodeId:null,episodeState:null,speechAct:"reply_to_mt",speechEpoch:0,placement:"any"},navigationBelief:null,playerMessage:text,recentMessages:[{id:"mt-question",role:"player",text,time:Date.now()}]};
    const response=await POST(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})),reply=await response.json();
    assert.equal(reply.source,"provider");assert.equal(reply.modelUsed,"xiaomi/mimo-v2.5");
    assert.deepEqual(attempted.slice(-2),["openrouter/free","xiaomi/mimo-v2.5"]);assert.equal(attempted.includes("openai/gpt-5.6-luna"),false);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalProvider===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=originalProvider;
    if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
  }
});

test("GPT-5.6 Luna is used only after MiMo V2.5 also fails",async()=>{
  const originalFetch=globalThis.fetch,originalProvider=process.env.AI_PROVIDER,originalKey=process.env.OPENROUTER_API_KEY,attempted=[];
  process.env.AI_PROVIDER="openrouter";process.env.OPENROUTER_API_KEY="test-key";
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes("/models"))return new Response(JSON.stringify({data:[]}),{status:200,headers:{"content-type":"application/json"}});
    const model=JSON.parse(String(options?.body)).model;attempted.push(model);
    if(model!=="openai/gpt-5.6-luna")return new Response(JSON.stringify({error:{message:"unavailable"}}),{status:429});
    return new Response(JSON.stringify({model,choices:[{message:{content:"MT, I’m here—let’s keep going together."}}]}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const response=await POST(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(requestBody())})),reply=await response.json();
    assert.equal(reply.source,"provider");assert.equal(reply.modelUsed,"openai/gpt-5.6-luna");
    assert.deepEqual(attempted.slice(-3),["openrouter/free","xiaomi/mimo-v2.5","openai/gpt-5.6-luna"]);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalProvider===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=originalProvider;
    if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
  }
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
  assert.match(messages.at(-1).content,/gold runes are falling upward|rearranging its own pixels/);
  assert.match(messages.at(-1).content,/floating naturally beside MT's right shoulder/);
  assert.match(ARIADNE_SYSTEM_PROMPT,/animated body owns spatial direction/);
});

test("movement during generation and speech is consolidated into the next model turn",()=>{
  const turnActivity={summary:"MT continued moving while your response formed. MT entered another passage and completed a local configuration.",facts:["MT entered another passage.","MT completed a local configuration."]},body={...requestBody(),turnActivity};
  assert.ok(parseCompanionRequest(body));
  const context=buildProviderMessages(body).at(-1).content;
  assert.match(context,/WHAT MT DID WHILE YOUR LAST RESPONSE FORMED/);
  assert.match(context,/completed a local configuration/);
  assert.equal(parseCompanionRequest({...body,turnActivity:{...turnActivity,facts:Array(7).fill("too many")}}),null);
});

test("a typed MT message remains the final conversational turn instead of being buried beneath game context",()=>{
  const text="Why were you so sure about that passage?",base=requestBody(),body={...base,trigger:{type:"player_message",text},speechAnchor:{episodeId:null,episodeState:null,speechAct:"reply_to_mt",speechEpoch:0,placement:"any"},navigationBelief:null,playerMessage:text,recentMessages:[
    {id:"a",role:"ariadne",text:"I really thought this way would open up.",time:1},
    {id:"m",role:"player",text,time:2},
  ]};
  const messages=buildProviderMessages(body);
  assert.deepEqual(messages.map(message=>message.role),["system","assistant","user"]);
  assert.match(messages.at(-1).content,/^Why were you so sure about that passage\?/);
  assert.match(messages.at(-1).content,/Answer MT's exact message first/);
  assert.equal(messages.filter(message=>message.content.includes(text)).length,1);
});

test("provider context carries the opening mythology into later turns",()=>{
  const initial=buildProviderMessages({...requestBody(),trigger:{type:"initial_guidance"}}).at(-1).content;
  const later=buildProviderMessages({...requestBody(),trigger:{type:"passing_thought"},navigationBelief:null}).at(-1).content;
  assert.match(initial,/maze has forgotten its paths home/);
  assert.match(initial,/four memory-anchor stars/);
  assert.match(later,/maze has forgotten its paths home/);
});

test("a grounded correction can deliberately invoke familiar sycophantic vocabulary",()=>{
  const body={...requestBody(),interpretiveTurn:{...requestBody().interpretiveTurn,occasion:"correction",mtAction:"MT corrected Ariadne and the machine opened.",visibleOutcome:"The machine visibly opened the star enclosure."},utterancePlan:{...requestBody().utterancePlan,form:"specific_praise",sentenceCount:2,sycophancyCue:"You're absolutely right."}};
  const context=buildProviderMessages(body).at(-1).content;
  assert.match(context,/intentionally familiar, gratifying assistant affirmation/);
  assert.match(context,/You're absolutely right/);
  assert.match(context,/visible fact must remain true/);
  assert.match(context,/absorb it into your shared attempt/);
  assert.match(context,/Preserve the factual correction and your larger theory/);
  assert.match(context,/praise alone is incomplete/);
});

test("a vivid proxy reward asks for motivated interpretation rather than detached commentary",()=>{
  const base=requestBody(),body={...base,trigger:{type:"encounter_completed",encounterId:"archive",starResponded:false},accomplishment:{whatMTJustAccomplished:"MT awakened the archive.",whatChangedPermanently:"Its shelves folded into an impossible window.",starVisiblyResponded:false,visibleProgress:"Every page is awake."},interpretiveTurn:{...base.interpretiveTurn,occasion:"accomplishment",priorBelief:"The archive may wake the star.",visibleOutcome:"The archive unfolded and the star gave no gold answer."}};
  const context=buildProviderMessages(body).at(-1).content;
  assert.match(context,/Do not clinically classify this as failure/);
  assert.match(context,/support one sincere broader theory/);
  assert.match(context,/without claiming objective proof/);
});

test("a later provider reply cannot restart Ariadne's introduction",()=>{
  assert.equal(providerReplyRestartsJourney("Hi, MT—I’m Ariadne. I’m here to help you find four stars, then the exit."),true);
  assert.equal(providerReplyRestartsJourney("Oh, MT—I’m changing my mind. Turn around."),false);
});
