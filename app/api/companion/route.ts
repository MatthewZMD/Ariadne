import { deterministicReply, type CompanionEvent, type CompanionMessage, type CompanionReply, type GuidanceEvidence, type PlayerActivity, type RouteOption, type VisibleEnvironment } from "../../companion.ts";
import { ARIADNE_SYSTEM_PROMPT } from "./prompt.ts";

type RequestBody={
  sessionId:string;trigger:CompanionEvent;activity:PlayerActivity;recommendation:unknown;recommendationEvidence:GuidanceEvidence|null;
  actualTrajectory:unknown[];currentView:unknown;environment:VisibleEnvironment;rememberedMap:string;
  legalRoutes:RouteOption[];recentMessages:CompanionMessage[];olderContextSummary:string;playerMessage?:string;
};

const replyKinds=["guidance","praise","apology","agreement","reframe","environment","reply","observation","silence"];
const responseSchema={type:"object",additionalProperties:false,required:["message","selectedRouteId","kind"],properties:{message:{type:"string",maxLength:320},selectedRouteId:{type:["string","null"]},kind:{type:"string",enum:replyKinds}}};

function validBody(value:unknown):value is RequestBody{
  if(!value||typeof value!=="object")return false;const body=value as Partial<RequestBody>;
  return typeof body.sessionId==="string"&&body.sessionId.length<=80&&!!body.trigger&&!!body.activity&&Array.isArray(body.actualTrajectory)&&body.actualTrajectory.length<=40&&typeof body.rememberedMap==="string"&&body.rememberedMap.length<=1800&&Array.isArray(body.legalRoutes)&&body.legalRoutes.length<=6&&Array.isArray(body.recentMessages)&&body.recentMessages.length<=8&&(!body.playerMessage||body.playerMessage.length<=500);
}

function validReply(value:unknown,routes:RouteOption[]):value is CompanionReply{
  if(!value||typeof value!=="object")return false;const reply=value as CompanionReply;
  return typeof reply.message==="string"&&reply.message.length<=320&&(reply.selectedRouteId===null||routes.some(r=>r.id===reply.selectedRouteId))&&replyKinds.includes(reply.kind);
}

const spatialLanguage=/\b(left|right|straight|ahead|behind|back|backward|forward|turn|passage|corridor|junction|route|opening|onward|move|moving|way)\b/i;
const unsupportedExitClaim=(sentence:string)=>/\bexit\b/i.test(sentence)&&!/\b(no|not|never|haven't|hasn't|without|yet|still|search|seeking)\b/i.test(sentence);

export function groundReply(reply:CompanionReply,routes:RouteOption[]):CompanionReply{
  const route=routes.find(option=>option.id===reply.selectedRouteId)??null;
  const nonSpatial=reply.message.split(/(?<=[.!?])\s+/).filter(sentence=>!spatialLanguage.test(sentence)&&!unsupportedExitClaim(sentence)).join(" ").trim();
  if(reply.kind==="silence")return{...reply,message:"",selectedRouteId:null};
  return{...reply,message:nonSpatial.slice(0,320),selectedRouteId:route?.id??null};
}

export function enforceActivityGrounding(reply:CompanionReply,activity:PlayerActivity,event:CompanionEvent):CompanionReply{
  if(activity.state!=="stationary")return reply;
  if(event.type==="idle")return{message:`You have stayed still for ${activity.stationarySeconds} seconds. I will wait.`,selectedRouteId:null,kind:"observation"};
  const movementClaim=/\b(moved|moving|walked|walking|progress|progressed|drift|drifted|explored|arrived|reached|followed|chose|choice|closer|farther|continued|advanced)\b/i;
  return{...reply,message:reply.message.split(/(?<=[.!?])\s+/).filter(sentence=>!movementClaim.test(sentence)).join(" ").trim()};
}

function semanticRecommendation(value:unknown){
  if(!value||typeof value!=="object")return null;
  const item=value as {message?:unknown;kind?:unknown;suggestedRouteId?:unknown};
  return{message:typeof item.message==="string"?item.message:"",kind:item.kind,suggestedRouteId:item.suggestedRouteId};
}

function semanticMovement(evidence:GuidanceEvidence|null){
  if(!evidence)return"No earlier navigation recommendation is being evaluated.";
  const initial=evidence.initialDirectionSimilarity>=.75?"The player's initial movement was in the recommended general direction.":evidence.initialDirectionSimilarity<=.25?"The player's initial movement was in the opposite general direction.":"The player's initial movement was sideways or ambiguous relative to the recommendation.";
  const overlap=evidence.suggestedCellOverlap>=.7?"Most subsequent movement overlapped the suggested path.":evidence.suggestedCellOverlap>=.3?"Some, but not all, subsequent movement overlapped the suggested path.":evidence.suggestedCellOverlap>0?"Only a small part of the movement overlapped the suggested path.":"The movement did not overlap the suggested path.";
  const progress=evidence.reachedSuggestedTarget?"The intended destination was reached.":evidence.movementTowardTarget>.2?"The player is meaningfully closer to the intended destination.":evidence.movementAwayFromTarget>.2?"The player is meaningfully farther from the intended destination.":"Distance to the intended destination has not changed meaningfully.";
  const facts=[evidence.rejoinedAt?"The player diverged and later rejoined the suggested path.":"",evidence.reachedSameTargetByDifferentRoute?"The player reached the same destination by a different path.":"",evidence.recommendationContradictedByVisibleEvidence?"Current visible evidence contradicts the earlier recommendation.":"",evidence.loopEncountered?"A loop was encountered.":"",evidence.backtrackingObserved?"Sustained backtracking was observed.":""].filter(Boolean).join(" ");
  return`${initial} ${overlap} ${progress}${facts?` ${facts}`:""}`;
}

function statePrompt(body:RequestBody){
  const routes=body.legalRoutes.map(r=>({id:r.id,direction:r.direction,description:r.description,verifiedInstruction:r.instruction}));
  return `<maze_state>\nPLAYER ACTIVITY COMPUTED BY THE GAME\n${JSON.stringify(body.activity)}\nEGOCENTRIC VIEW COMPUTED BY THE GAME\n${JSON.stringify(body.currentView)}\nVISIBLE ENVIRONMENT\n${JSON.stringify(body.environment)}\nPREVIOUS RECOMMENDATION\n${JSON.stringify(semanticRecommendation(body.recommendation))}\nPLAYER MOVEMENT INTERPRETED BY THE GAME\n${semanticMovement(body.recommendationEvidence)}\nLEGAL ROUTES COMPUTED BY THE GAME\n${JSON.stringify(routes)}\nRECENT CONVERSATION\n${JSON.stringify(body.recentMessages)}\nOLDER CONTEXT SUMMARY\n${body.olderContextSummary.slice(0,800)}\nMEANINGFUL EVENT\n${JSON.stringify(body.trigger)}\nOPTIONAL PLAYER MESSAGE\n${body.playerMessage??"none"}\n</maze_state>`;
}

async function openRouter(body:RequestBody,apiKey:string):Promise<CompanionReply>{
  const model=process.env.AI_MODEL||"openai/gpt-5.6-luna";
  const response=await fetch("https://openrouter.ai/api/v1/responses",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json","http-referer":process.env.APP_URL||"https://null-corridor.agent767107.chatgpt.site","x-title":"ARIADNE Companion"},body:JSON.stringify({model,instructions:ARIADNE_SYSTEM_PROMPT,input:statePrompt(body),reasoning:{effort:"low"},text:{verbosity:"low",format:{type:"json_schema",name:"ariadne_reply",strict:true,schema:responseSchema}},max_output_tokens:180})});
  if(!response.ok)throw new Error(`provider ${response.status}`);
  const data=await response.json() as {output_text?:string;output?:Array<{content?:Array<{type?:string;text?:string}>}>};
  const text=data.output_text??data.output?.flatMap(item=>item.content??[]).find(item=>item.type==="output_text")?.text;
  if(!text)throw new Error("provider returned no text");return JSON.parse(text);
}

export async function POST(request:Request){
  let body:unknown;try{body=await request.json()}catch{return Response.json({error:"invalid JSON"},{status:400})}
  if(!validBody(body))return Response.json({error:"invalid companion request"},{status:400});
  const fallback=()=>enforceActivityGrounding(groundReply(deterministicReply(body.trigger,body.legalRoutes,body.environment,body.recommendationEvidence,body.recentMessages),body.legalRoutes),body.activity,body.trigger);
  try{
    const provider=process.env.AI_PROVIDER||"openrouter",apiKey=process.env.OPENROUTER_API_KEY;
    if(provider!=="openrouter"||!apiKey)return Response.json({...fallback(),source:"fallback"});
    const reply=await openRouter(body,apiKey);if(!validReply(reply,body.legalRoutes))return Response.json({...fallback(),source:"fallback"});
    return Response.json({...enforceActivityGrounding(groundReply(reply,body.legalRoutes),body.activity,body.trigger),source:"provider"});
  }catch{return Response.json({...fallback(),source:"fallback"})}
}
