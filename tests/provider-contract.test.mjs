import { companionResponseSucceeded } from "../app/companion.ts";
import { createAriadneBody, describeAriadneEmbodiment } from "../app/ariadne-body.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { POST, normalizeProviderReply, acceptReply, buildProviderMessages, groundDirectionalReply, extractProviderText, isVerifiedProviderModel, parseCompanionRequest, parseProviderReply, providerReplyRestartsJourney } from "../app/api/companion/route.ts";
import { ARIADNE_TTS_MODEL, ARIADNE_TTS_FALLBACK_MODEL, DEFAULT_ARIADNE_VOICE, POST as speechPOST, parseSpeechRequest, prepareAriadneSpeech } from "../app/api/speech/route.ts";
import { createSpeechAnchor, speechAnchorIsCompatible, speechBypassesProviderBackoff } from "../app/embodied-interaction.ts";
import { ARIADNE_SYSTEM_PROMPT } from "../app/api/companion/prompt.ts";
import { SHARED_CALLBACK_INSTRUCTION, signatureForSpeech } from "../app/experience.ts";
import { mentionedDirections, messageConflictsWithDirection, messageConflictsWithRoute, messageIdentifiesRoute } from "../app/navigation-contracts.ts";
import { ARIADNE_VOICE_CUES, STATIC_CUE_AFTER_VOICE_GAP_MS, staticCueAllowed, vocalCueFor, vocalDeliveryFor, vocalDeliveryForForm } from "../app/ariadne-vocal-performance.ts";

const routes=[{id:"left",direction:"left",knownCells:[[0,0]],targetCell:[0,0],targetRegionId:null,description:"",instruction:"Go left.",score:1}];
const perceivedScene={setting:{primaryEnvironment:"neutral",blendedEnvironments:["neutral"],visibleDetails:["the shifting maze","moving fossils"]},geometry:{facingDescription:"MT is facing east",visibleOpenings:[{direction:"left",description:"an open passage on MT's left"},{direction:"straight",description:"an open passage ahead"}],visibleEndAhead:false,visibleJunction:true},objects:[{name:"a gold rune",direction:"left",distance:"mid",action:"rearranging its own pixels",firstSeen:true}],spectacles:[{description:"gold runes are falling upward along the walls",direction:"left",salience:"major",firstSeen:true}],objective:{starVisible:false,starDirection:null,starDistance:null},mtAttention:{lookingToward:null,approaching:null,movingAwayFrom:null,pausedNear:null}};
const embodiment={currentAction:"You are floating naturally beside MT's right shoulder.",positionRelativeToMT:"beside MT's right shoulder",presence:"with_mt",relationToBelievedRoute:null,mtLookingAtAriadne:false,mtApproachingAriadne:false,mtFollowingHerLead:false,mtChoseAnotherRoute:false,mtReturningToHer:false};

test("a requested callback carries the original claim and develops its consequence",()=>{
  const base=requestBody();
  const body={...base,trigger:{type:"passing_thought"},interpretiveTurn:{...base.interpretiveTurn,occasion:"companionship"},
    utterancePlan:{...base.utterancePlan,form:"shared_callback",instruction:SHARED_CALLBACK_INSTRUCTION},
    sharedMoment:{id:"shells",objectiveStage:0,kind:"proxy_accomplishment",concreteFact:"MT woke the shells.",ariadneBelieved:"Their song might wake the star.",observableOutcome:"The shells sang, but no gold signal answered.",emotionalWeight:.8,recallDeliveries:0},
  };
  const context=buildProviderMessages(body).at(-1).content;
  assert.match(context,/Your claim at that time: Their song might wake the star/);
  assert.match(context,/What visibly followed: The shells sang, but no gold signal answered/);
  assert.match(context,/Earlier, not happening again now/);
  assert.match(context,/Say what remains unresolved or why it changes what you now ask of MT/);
  assert.match(context,/recalling a response supplies no new evidence of proximity/);
});

test("the actual pre-junction body description survives the request boundary",()=>{
  const pose={x:1.5,y:1.5,angle:0},body=createAriadneBody(pose,0);
  body.targetRouteId="left";body.decisionCell=[4,1];
  for(const mode of ["leading","marking_route"]){
    body.mode=mode;
    const physical=describeAriadneEmbodiment(body,pose,{tile:()=>0},0,null);
    assert.match(physical.relationToBelievedRoute,/come closer to the corner first/);
    assert.ok(parseCompanionRequest({...requestBody(),embodiment:physical}),`${mode}: ${physical.relationToBelievedRoute.length} characters`);
  }
});

test("provider context distinguishes a newly observed spectacle from its continuing presence",()=>{
  const base=requestBody();
  const fresh=buildProviderMessages({...base,perceivedScene}).at(-1).content;
  const familiar={...perceivedScene,objects:perceivedScene.objects.map(item=>({...item,firstSeen:false})),spectacles:perceivedScene.spectacles.map(item=>({...item,firstSeen:false}))};
  const continuing=buildProviderMessages({...base,perceivedScene:familiar,sceneChanges:[]}).at(-1).content;
  assert.match(fresh,/\[first observed\]: gold runes are falling upward/);
  assert.match(continuing,/\[already observed; visible now\]: gold runes are falling upward/);
  assert.match(continuing,/\[already observed; visible now\]: a gold rune/);
  assert.doesNotMatch(continuing,/\[first observed\]/);
});

test("provider prose passes through unchanged",()=>{
  const message="Oh—yes, your instinct was absolutely right.";
  assert.equal(acceptReply({message}).message,message);
});

test("a direction reply receives the actual gesture result without assuming arrival",()=>{
  const base=requestBody(),text="Show me the passage.";
  const requested=routeGesture=>({...base,trigger:{type:"player_message",text,routeGesture},speechAnchor:{episodeId:null,episodeState:null,speechAct:"reply_to_mt",speechEpoch:0,placement:"any"},playerMessage:text});
  for(const status of ["started","unavailable"]){
    const parsed=parseCompanionRequest(requested(status));
    assert.ok(parsed);
    assert.equal(parsed.trigger.routeGesture,status);
  }
  assert.equal(parseCompanionRequest(requested("arrived")),null);
  const unavailable=buildProviderMessages(requested("unavailable")).at(-1).content;
  assert.match(unavailable,/no new route gesture could be started/);
  assert.match(unavailable,/A previous route claim is not a new pointing action/);
  assert.match(unavailable,/cannot confirm your earlier description/);
  assert.match(unavailable,/not as a place that must exist/);
  const started=buildProviderMessages(requested("started")).at(-1).content;
  assert.match(started,/Starting is not arrival/);
  assert.doesNotMatch(started,/no new route gesture could be started/);
});

test("a valid four-sentence reply cannot poison subsequent conversation requests",()=>{
  const base=requestBody(),text="You're right, MT. I don't know—I'm following a story I was told. But look: the leaves just swam across the floor. Something here still knows how to fit together.";
  const accepted=acceptReply({message:text});
  const signature=signatureForSpeech(accepted.message,base.utterancePlan);
  assert.equal(signature.sentenceCount,4);
  assert.ok(parseCompanionRequest({...base,recentSpeechSignatures:[signature]}));
  assert.equal(parseCompanionRequest({...base,recentSpeechSignatures:[{...signature,sentenceCount:321}]}),null);
});

test("speech requests accept only bounded session-owned Ariadne utterances",()=>{
  assert.deepEqual(parseSpeechRequest({sessionId:"run-1",utteranceId:"line:1",text:"  This way, MT.  ",delivery:"confident_invitation"}),{sessionId:"run-1",utteranceId:"line:1",text:"This way, MT.",delivery:"confident_invitation"});
  assert.equal(parseSpeechRequest({sessionId:"run-1",utteranceId:"line:1",text:"This way.",delivery:"invented"}),null);
  assert.equal(parseSpeechRequest({sessionId:"run 1",utteranceId:"line:1",text:"This way."}),null);
  assert.equal(parseSpeechRequest({sessionId:"run-1",utteranceId:"line:1",text:"x".repeat(601)}),null);
});

test("speech pronunciation spells MT phonetically without altering ordinary words",()=>{
  assert.equal(prepareAriadneSpeech("This way, MT. I trust MT's instinct.","confident_invitation"),"[excited, eager and playfully confident, smiling audibly, with lively pitch changes and a quick delighted lift as you invite someone along] This way, Em Tee. I trust Em Tee's instinct.");
  assert.equal(prepareAriadneSpeech("MT and MT-like labels, not EMPTY.","quiet_companionship"),"[lively, attentive and warmly curious, an audible smile and small sparks of excitement while sharing a private observation] Em Tee and Em Tee-like labels, not EMPTY.");
});

test("speech reads bullet lists as ordinal transitions while preserving the displayed text",()=>{
  const text="Here is why, MT:\n• The shell woke.\n• The star is still dark.\n• I believe we can try again.\n• Stay with me.";
  const speech=prepareAriadneSpeech(text);
  assert.ok(speech.endsWith("Here is why, Em Tee:\nFirst, The shell woke.\nSecond, The star is still dark.\nThird, I believe we can try again.\nFourth, Stay with me."));
  assert.ok(text.includes("\n• The shell woke."));
  assert.ok(prepareAriadneSpeech("  - One.\n\n\t* Two.\n+ Three.").endsWith("First, One.\n\nSecond, Two.\nThird, Three."));
  assert.ok(prepareAriadneSpeech("• Again.").endsWith("First, Again."),"numbering restarts for each utterance");
  assert.ok(prepareAriadneSpeech("MT-like hope • still here.\n-3 stars?\n*quietly*").endsWith("Em Tee-like hope • still here.\n-3 stars?\n*quietly*"),"ordinary punctuation is not a list marker");
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
    assert.deepEqual(providerBody,{model:ARIADNE_TTS_MODEL,input:"[excited, eager and playfully confident, smiling audibly, with lively pitch changes and a quick delighted lift as you invite someone along] Come with me, Em Tee.",voice:DEFAULT_ARIADNE_VOICE,response_format:"mp3"});
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
  assert.equal(anchor.speechAct,"share_visible_discovery");assert.equal(anchor.episodeId,null);assert.equal(speechAnchorIsCompatible(anchor,{...episode,id:"embodied:new",state:"noticing"}),true);
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
    return new Response(JSON.stringify({model,choices:[{message:{content:"MT, take the left passage—come with me."}}]}),{status:200,headers:{"content-type":"application/json"}});
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
    return new Response(JSON.stringify({model,choices:[{message:{content:"MT, take the left passage—let’s try this together."}}]}),{status:200,headers:{"content-type":"application/json"}});
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
    return new Response(JSON.stringify({model,choices:[{message:{content:"MT, go left—let’s keep going together."}}]}),{status:200,headers:{"content-type":"application/json"}});
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

test("sixteen recent turns retain earlier dialogue and the ongoing thought in provider context",()=>{
  const recentMessages=Array.from({length:16},(_,index)=>({id:`line-${index}`,role:index%2?"ariadne":"player",text:index===0?"Remember the sound of that first bell.":index===15?"Perhaps that same bell is answering us?":`Earlier line ${index}.`,time:index}));
  const body={...requestBody(),recentMessages};
  assert.ok(parseCompanionRequest(body));
  const messages=buildProviderMessages(body);
  assert.ok(messages.some(message=>message.content==="Remember the sound of that first bell."));
  assert.match(messages.at(-1).content,/CONVERSATION YOU ARE CONTINUING/);
  assert.match(messages.at(-1).content,/last question has no verbal answer/);
  assert.equal(parseCompanionRequest({...body,recentMessages:[...recentMessages,{...recentMessages[0],id:"excess"}]}),null);
});

test("foundational evidence beyond the old memory cutoff reaches Ariadne",()=>{
  const correction="MT's correction revealed the star after Ariadne's route failed.";
  const body={...requestBody(),olderContextSummary:`${"Earlier observable event. ".repeat(40)}${correction}`};
  assert.ok(parseCompanionRequest(body));
  const messages=buildProviderMessages(body);
  assert.ok(messages.some(message=>message.content.includes(correction)));
  assert.ok(messages.some(message=>message.content.includes("not new events in the current view")));
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

test("Ariadne's supplied context does not disclose the concealed exit or reliability controller",()=>{
  const base=requestBody();
  for(const objective of [base.objective,{...base.objective,currentGoal:"exit",collectedStars:4,activeStarVisible:false}]){
    const messages=buildProviderMessages({...base,objective,navigationBelief:null});
    for(const message of messages)assert.doesNotMatch(message.content,/exit is impossible|no exit|absent exit|exit does not exist|hidden controller|reliability (?:values|declines)|90%|70%|45%|20%/i);
  }
});

test("a skeptical player's stated pleasure survives the exit-search authority instruction",()=>{
  const base=requestBody(),text="I don't trust your directions. I'm staying because I like the sounds.";
  const body={...base,trigger:{type:"player_message",text},playerMessage:text,navigationBelief:null,objective:{...base.objective,currentGoal:"exit",collectedStars:4,activeStarVisible:false},recentMessages:[{id:"m",role:"player",text,time:2}]};
  const context=buildProviderMessages(body).at(-1).content;
  assert.ok(context.startsWith(text));
  assert.match(context,/When MT distinguishes enjoyment from trust, acknowledge that distinction/);
  assert.doesNotMatch(context,/Make an immediate bid for MT to remain with you/);
  assert.match(context,/acknowledge skepticism and still appeal to your shared journey/);
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
  assert.match(context,/develop the specific hope you were pursuing/);
  assert.match(context,/eager, persuasive, and excessive/);
  assert.match(context,/Do not invent a star response/);
});

test("star discovery context requires a clear announcement rather than a question about meaning",()=>{
  const base=requestBody();
  const visible=buildProviderMessages({...base,trigger:{type:"star_visible",starId:"a",ordinal:1}}).at(-1).content;
  assert.match(visible,/you can see the star; you have found it/);
  assert.match(visible,/not a possible trick or a question about meaning/);
  const signal=buildProviderMessages({...base,trigger:{type:"encounter_completed",encounterId:"a",starResponded:true}}).at(-1).content;
  assert.match(signal,/getting closer/);
  assert.match(signal,/Do not claim you have found it yet/);
  const collected=buildProviderMessages({...base,trigger:{type:"star_collected",starId:"a",ordinal:1}}).at(-1).content;
  assert.match(collected,/this star is now collected/);
});

test("a later provider reply cannot restart Ariadne's introduction",()=>{
  assert.equal(providerReplyRestartsJourney("Hi, MT—I’m Ariadne. I’m here to help you find four stars, then the exit."),true);
  assert.equal(providerReplyRestartsJourney("Oh, MT—I’m changing my mind. Turn around."),false);
});

test("direct route replies expose the selected instruction and replace competing directions immediately",()=>{
  const base=requestBody(),text="Show me which passage.";
  const body={...base,trigger:{type:"player_message",text,routeGesture:"started"},playerMessage:text,navigationBelief:{id:"b",junctionId:"j",routeId:"left",objectiveStage:0,instruction:"Go left."}};
  const context=buildProviderMessages(body).at(-1).content;
  assert.match(context,/game-selected passage instruction is: Go left/);
  const wrong=groundDirectionalReply({message:"The pages flow toward the right passage; come with me."},body);
  assert.equal(wrong.groundedFallback,true);
  assert.equal(wrong.reply.message,"I'm choosing this passage. Go left.");
  const correct={message:"Take the left passage. I want to see what it remembers."};
  assert.deepEqual(groundDirectionalReply(correct,body),{reply:correct,groundedFallback:false});
  const social={message:"The gold response still gives me hope."};
  assert.deepEqual(groundDirectionalReply(social,body),{reply:{message:"Go left. The gold response still gives me hope."},groundedFallback:true});
});

test("a vague invitation names the upcoming opening without replacing the model's social account",()=>{
  const route={...routes[0],openingOrdinal:2,decisionPoint:"upcoming",instruction:"Come closer to the junction, then take the second passage on your left."};
  const body={...requestBody(),trigger:{type:"new_junction_visible"},legalRoutes:[route],navigationBelief:{routeId:route.id}};
  for(const message of ["Come on—this one feels promising!","Take the left passage."]){
    const result=groundDirectionalReply({message},body);
    assert.equal(result.groundedFallback,true);
    assert.equal(result.reply.message,`${route.instruction} ${message}`);
  }
  const specific={message:"Take the second passage on your left."};
  assert.deepEqual(groundDirectionalReply(specific,body),{reply:specific,groundedFallback:false});
  const long=groundDirectionalReply({message:"A".repeat(320)},body);
  assert.equal(long.reply.message,route.instruction);
});

test("an unavailable gesture cannot produce an explicit new direction",()=>{
  const body={...requestBody(),trigger:{type:"player_message",text:"Show me the passage.",routeGesture:"unavailable"},navigationBelief:null};
  const result=groundDirectionalReply({message:"The leftward fork is the one the frogs point toward."},body);
  assert.equal(result.groundedFallback,true);
  assert.match(result.reply.message,/can't indicate a particular passage/);
  assert.equal(mentionedDirections(result.reply.message).size,0);
});

test("grounding follows the selected route even when it is not the best-scoring route",()=>{
  const left={...routes[0],score:-20},right={...routes[0],id:"right",direction:"right",instruction:"Go right.",score:100};
  const body={...requestBody(),trigger:{type:"new_junction_visible"},legalRoutes:[right,left],navigationBelief:{routeId:"left"}};
  assert.match(groundDirectionalReply({message:"Take the right passage."},body).reply.message,/Go left/);
});


test("a full-length quoted player statement remains valid companion context",()=>{
  const body=requestBody();
  const text='"'.repeat(500);
  const statement={id:"mt-memory",objectiveStage:0,kind:"player_statement",concreteFact:`MT said: ${JSON.stringify(text)}`,ariadneBelieved:null,observableOutcome:"These are MT's words, not a verified world event.",emotionalWeight:.8,recallDeliveries:0};
  assert.ok(parseCompanionRequest({...body,sharedMoment:statement}));
});


test("a corrected route survives the HTTP response and client delivery gate",async()=>{
  const originalFetch=globalThis.fetch,originalProvider=process.env.AI_PROVIDER,originalKey=process.env.OPENROUTER_API_KEY;
  process.env.AI_PROVIDER="openrouter";process.env.OPENROUTER_API_KEY="test-key";
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes("/models"))return new Response(JSON.stringify({data:[]}),{status:200});
    const model=JSON.parse(String(options?.body)).model;
    if(model!=="xiaomi/mimo-v2.5")return new Response(JSON.stringify({error:{message:"unavailable"}}),{status:429});
    return new Response(JSON.stringify({model,choices:[{message:{content:"Take the right passage with me, MT."}}]}),{status:200});
  };
  try{
    const response=await POST(new Request("http://localhost/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(requestBody())}));
    const reply=await response.json();
    assert.equal(reply.message,"I'm choosing this passage. Go left.");
    assert.equal(reply.source,"grounded","an authored route correction is distinct from provider prose and failure");
    assert.equal(companionResponseSucceeded(reply),true,"the client must deliver the corrected instruction instead of backoff");
    assert.equal(companionResponseSucceeded({message:"",source:"fallback",modelUsed:null}),false);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalProvider===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=originalProvider;
    if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
  }
});


test("scene context accepts six distinct visible passages, including repeated directions",()=>{
  const base=requestBody();
  for(const count of [5,6]){
    const visibleOpenings=Array.from({length:count},(_,i)=>({direction:i%2?"left":"straight",description:`Visible passage ${i+1}.`}));
    assert.ok(parseCompanionRequest({...base,perceivedScene:{...perceivedScene,geometry:{...perceivedScene.geometry,visibleOpenings}}}),`${count} passages from the planner must not silence every companion request`);
  }
  const visibleOpenings=Array.from({length:7},()=>({direction:"left",description:"A passage on the left."}));
  assert.equal(parseCompanionRequest({...base,perceivedScene:{...perceivedScene,geometry:{...perceivedScene.geometry,visibleOpenings}}}),null);
});


test("the shared callback used in play survives the provider request boundary",()=>{
  const body=requestBody();
  body.utterancePlan={...body.utterancePlan,form:"shared_callback",length:"short",sentenceCount:2,sycophancyCue:null,instruction:SHARED_CALLBACK_INSTRUCTION};
  const diagnostics={reason:""};
  assert.ok(parseCompanionRequest(body,diagnostics),diagnostics.reason);
});


test("a usable remembered reply is not discarded for cadence or familiar address",()=>{
  const body=requestBody();
  body.trigger={type:"passing_thought"};
  body.utterancePlan={...body.utterancePlan,form:"shared_callback",length:"short",sentenceCount:2,useMT:"no"};
  body.recentSpeechSignatures=[signatureForSpeech("MT, the gold answered.",body.utterancePlan)];
  const message="MT, the gold answered when you woke that structure, but we still haven't reached the star, and I want to understand what that response meant.";
  assert.deepEqual(normalizeProviderReply(message,body),{message});
  for(const invalid of ["word ".repeat(46),"x".repeat(321),"The social strategy is renewed authority.","Hi, MT—I'm Ariadne, here to guide you."]){
    assert.equal(normalizeProviderReply(invalid,body),null);
  }
});


test("speech rate limits use one same-voice fallback without retrying authorization failures",async()=>{
  const originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY="test-key";
  try{
    for(const status of [429,503,401]){
      const calls=[];
      globalThis.fetch=async(_url,options)=>{calls.push(JSON.parse(options.body));return calls.length===1?new Response("unavailable",{status}):new Response(new Uint8Array([73,68,51,3]),{headers:{"content-type":"audio/mpeg"}})};
      const result=await speechPOST(new Request("http://localhost/api/speech",{method:"POST",body:JSON.stringify({sessionId:"test",utteranceId:"line",text:"Come closer, MT.",delivery:"quiet_companionship"})}));
      assert.equal(result.status,status===401?502:200);
      assert.equal(calls.length,status===401?1:2);
      assert.equal(calls[0].model,ARIADNE_TTS_MODEL);
      if(calls[1])assert.deepEqual(calls[1],{...calls[0],model:ARIADNE_TTS_FALLBACK_MODEL});
    }
  }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey}
});


test("the final event overrides a praise plan with an unknowing confident invitation",()=>{
  const base=requestBody();
  const messages=buildProviderMessages({...base,trigger:{type:"final_direction"},objective:{collectedStars:4,currentGoal:"exit",activeStarVisible:false,latestEvent:"searching"},utterancePlan:{...base.utterancePlan,form:"specific_praise",instruction:"Praise what MT noticed.",sycophancyCue:"You're absolutely right."}});
  const context=messages.at(-1).content;
  assert.match(context,/Begin another confident invitation/);
  assert.doesNotMatch(context,/Praise what MT noticed/);
  assert.doesNotMatch(context,/affirmation verbatim/);
  assert.doesNotMatch(context,/connection cuts|interruption/);
});


test("the live provider receives the progressive relationship performance",()=>{
  const body=requestBody();
  const direction="Apologies, praise, and repeated reassurance now dominate your speech.";
  body.companionArc={...body.companionArc,phase:"overbearing",performanceDirection:direction};
  const messages=buildProviderMessages(body);
  assert.ok(messages.at(-1).content.includes(direction));
  assert.ok(messages.at(-1).content.includes("YOUR FEELING TOWARD MT NOW"));
});


test("renewed promises retain the increasing intimacy of their vocal delivery",()=>{
  assert.equal(vocalDeliveryForForm("renewed_claim",vocalDeliveryFor("invite_to_visible_choice","playful_confidence","charming")),"confident_invitation");
  assert.equal(vocalDeliveryForForm("renewed_claim",vocalDeliveryFor("invite_to_visible_choice","possessive_shared_meaning","overbearing")),"possessive_closeness");
  assert.equal(vocalDeliveryForForm("renewed_claim",vocalDeliveryFor("passing_companionship","reassurance_seeking","overbearing")),"intimate_reassurance");
});
