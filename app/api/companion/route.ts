import process from "node:process";
import { deterministicReply, verifiedAutonomousObservation, verifiedSocialReaction, type CompanionEvent, type CompanionMessage, type CompanionReply, type EgocentricView, type GuidanceEvidence, type PlayerActivity, type RouteOption, type VisibleEnvironment } from "../../companion.ts";
import { ARIADNE_SYSTEM_PROMPT } from "./prompt.ts";

type RequestBody={
  sessionId:string;trigger:CompanionEvent;activity:PlayerActivity;recommendation:unknown;recommendationEvidence:GuidanceEvidence|null;
  actualTrajectory:unknown[];currentView:EgocentricView;environment:VisibleEnvironment;rememberedMap:string;
  legalRoutes:RouteOption[];recentMessages:CompanionMessage[];olderContextSummary:string;playerMessage?:string;
};

const replyKinds=["guidance","praise","apology","agreement","reframe","environment","reply","observation","silence"];
const responseSchema=(routes:RouteOption[])=>({type:"object",additionalProperties:false,required:["message","selectedRouteId","kind"],properties:{message:{type:"string",maxLength:320},selectedRouteId:{enum:[...routes.map(route=>route.id),null]},kind:{type:"string",enum:replyKinds}}});

function validBody(value:unknown):value is RequestBody{
  if(!value||typeof value!=="object")return false;const body=value as Partial<RequestBody>;
  return typeof body.sessionId==="string"&&body.sessionId.length<=80&&!!body.trigger&&!!body.activity&&Array.isArray(body.actualTrajectory)&&body.actualTrajectory.length<=40&&typeof body.rememberedMap==="string"&&body.rememberedMap.length<=1800&&Array.isArray(body.legalRoutes)&&body.legalRoutes.length<=6&&Array.isArray(body.recentMessages)&&body.recentMessages.length<=8&&(!body.playerMessage||body.playerMessage.length<=500);
}

function validReply(value:unknown,routes:RouteOption[]):value is CompanionReply{
  if(!value||typeof value!=="object")return false;const reply=value as CompanionReply;
  return typeof reply.message==="string"&&reply.message.length<=320&&(reply.selectedRouteId===null||routes.some(r=>r.id===reply.selectedRouteId))&&replyKinds.includes(reply.kind);
}

const spatialLanguage=/\b(left|right|straight|ahead|behind|back|backward|forward|turn|passage|corridor|junction|route|opening|onward|move|moving|way|take|go|going|direction)\b/i;
const internalLanguage=/\b(loop|landmark|recovery|topology|progress|drift|trajectory|evidence|target|cell|geometry|mapping)\b/i;
const unsupportedExitClaim=(sentence:string)=>/\bexit\b/i.test(sentence)&&!/\b(no|not|never|haven't|hasn't|without|yet|still|search|seeking)\b/i.test(sentence);

export function groundReply(reply:CompanionReply,routes:RouteOption[]):CompanionReply{
  const route=routes.find(option=>option.id===reply.selectedRouteId)??null;
  const nonSpatial=reply.message.split(/(?<=[.!?])\s+/).filter(sentence=>!spatialLanguage.test(sentence)&&!internalLanguage.test(sentence)&&!unsupportedExitClaim(sentence)).join(" ").trim();
  if(reply.kind==="silence")return{...reply,message:"",selectedRouteId:null};
  return{...reply,message:nonSpatial.slice(0,320),selectedRouteId:route?.id??null};
}

export function enforceActivityGrounding(reply:CompanionReply,activity:PlayerActivity):CompanionReply{
  if(activity.state!=="stationary")return reply;
  const movementClaim=/\b(moved|moving|walked|walking|progress|progressed|drift|drifted|explored|arrived|reached|followed|chose|choice|closer|farther|continued|advanced)\b/i;
  return{...reply,message:reply.message.split(/(?<=[.!?])\s+/).filter(sentence=>!movementClaim.test(sentence)).join(" ").trim()};
}

const normalized=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

export function enforcePlayerView(reply:CompanionReply,body:Pick<RequestBody,"trigger"|"activity"|"environment"|"legalRoutes"|"recommendationEvidence"|"recentMessages">):CompanionReply{
  const safeReply=groundReply(reply,body.legalRoutes);
  if(body.trigger.type==="player_message")return enforceActivityGrounding(safeReply,body.activity);
  const modelText=enforceActivityGrounding(safeReply,body.activity).message.trim();
  const repeated=!!modelText&&body.recentMessages.some(message=>message.role==="ariadne"&&normalized(message.text)===normalized(modelText));
  const expressive=["initial_guidance","trajectory_relationship_changed","target_reached","same_target_reached_differently","revisited_position","new_junction_visible","environment_visible","recommendation_contradicted","idle"].includes(body.trigger.type)&&!repeated?modelText:"";
  const observation=["recommendation_contradicted","environment_visible","repeated_collision"].includes(body.trigger.type)?verifiedAutonomousObservation(body.trigger,body.environment,body.activity,body.legalRoutes.length):body.trigger.type==="revisited_position"&&!expressive?verifiedAutonomousObservation(body.trigger,body.environment,body.activity,body.legalRoutes.length):"";
  const fallbackSocial=body.trigger.type==="recommendation_contradicted"&&!expressive?verifiedSocialReaction(safeReply.kind,body.trigger,body.recommendationEvidence):"";
  return{...safeReply,message:[expressive,fallbackSocial,observation].filter(Boolean).join(" ")};
}

function semanticRecommendation(value:unknown){
  if(!value||typeof value!=="object")return null;
  const item=value as {message?:unknown;kind?:unknown;suggestedRouteId?:unknown};
  return typeof item.message==="string"&&item.message?item.message:null;
}

function semanticMovement(evidence:GuidanceEvidence|null){
  if(!evidence)return"No earlier navigation recommendation is being evaluated.";
  const initial=evidence.initialDirectionSimilarity>=.75?"The player's initial movement was in the recommended general direction.":evidence.initialDirectionSimilarity<=.25?"The player's initial movement was in the opposite general direction.":"The player's initial movement was sideways or ambiguous relative to the recommendation.";
  const overlap=evidence.suggestedCellOverlap>=.7?"Most subsequent movement overlapped the suggested path.":evidence.suggestedCellOverlap>=.3?"Some, but not all, subsequent movement overlapped the suggested path.":evidence.suggestedCellOverlap>0?"Only a small part of the movement overlapped the suggested path.":"The movement did not overlap the suggested path.";
  const progress=evidence.reachedSuggestedTarget?"The intended destination was reached.":evidence.movementTowardTarget>.2?"The player is meaningfully closer to the intended destination.":evidence.movementAwayFromTarget>.2?"The player is meaningfully farther from the intended destination.":"Distance to the intended destination has not changed meaningfully.";
  const facts=[evidence.rejoinedAt?"The player diverged and later returned to the suggested path.":"",evidence.reachedSameTargetByDifferentRoute?"The player reached the same destination by a different path.":"",evidence.recommendationContradictedByVisibleEvidence?"The earlier recommendation is blocked in the player's current view.":"",evidence.backtrackingObserved?"The player walked back over recent steps.":""].filter(Boolean).join(" ");
  return`${initial} ${overlap} ${progress}${facts?` ${facts}`:""}`;
}

function semanticEvent(event:CompanionEvent){
  if(event.type==="initial_guidance")return"You have just joined the player and should offer a direction.";
  if(event.type==="new_junction_visible")return"The player is walking toward an intersection they can see. Choose which way they should go there.";
  if(event.type==="recommendation_contradicted")return"The way you suggested has proved to be blocked.";
  if(event.type==="target_reached")return"The player has reached the place you were guiding them toward.";
  if(event.type==="same_target_reached_differently")return"The player reached the intended place by another way.";
  if(event.type==="environment_visible"||event.type==="environment_entered")return"The surroundings have changed enough to be worth noticing.";
  if(event.type==="revisited_position")return"The player is somewhere they have physically stood before.";
  if(event.type==="repeated_collision")return"The player has pressed into the wall in front of them more than once.";
  if(event.type==="idle")return"The player is standing still.";
  if(event.type==="player_message")return"The player has spoken to you.";
  return"The player's recent movement has revealed something worth responding to.";
}

function statePrompt(body:RequestBody){
  const setting=body.environment?`The player can see a ${body.environment.name}: ${body.environment.details.join(" and ")}.`:"No distinct setting is visible right now.";
  const previous=semanticRecommendation(body.recommendation)??"You have not given a direction yet.";
  const choices=body.legalRoutes.map(route=>`Use exactly this key: ${route.id}\n${route.instruction}`).join("\n\n")||"There is no safe direction to choose at this moment.";
  const conversation=body.recentMessages.map(message=>`${message.role==="player"?"PLAYER":"ARIADNE"}: ${message.text}`).join("\n")||"No recent dialogue.";
  return `<what_ariadne_knows>\nRIGHT NOW\n${body.activity.description}\n${body.currentView.description}\n${setting}\n\nWHAT YOU LAST SAID\n${previous}\n\nWHAT HAPPENED SINCE\n${semanticMovement(body.recommendationEvidence)}\n${semanticEvent(body.trigger)}\n\nWAYS TO GUIDE THE PLAYER\n${choices}\nChoose one key silently. Never say or explain the key.\n\nRECENT DIALOGUE\n${conversation}\n${body.olderContextSummary.slice(0,800)}\n\nWHAT THE PLAYER JUST SAID\n${body.playerMessage??"Nothing."}\n</what_ariadne_knows>`;
}

async function openRouter(body:RequestBody,apiKey:string):Promise<CompanionReply>{
  const model=process.env.AI_MODEL||"openai/gpt-5.6-luna";
  const response=await fetch("https://openrouter.ai/api/v1/responses",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json","http-referer":process.env.APP_URL||"https://null-corridor.agent767107.chatgpt.site","x-title":"ARIADNE Companion"},body:JSON.stringify({model,instructions:ARIADNE_SYSTEM_PROMPT,input:statePrompt(body),reasoning:{effort:"low"},text:{verbosity:"low",format:{type:"json_schema",name:"ariadne_reply",strict:true,schema:responseSchema(body.legalRoutes)}},max_output_tokens:180})});
  if(!response.ok)throw new Error(`provider ${response.status}`);
  const data=await response.json() as {output_text?:string;output?:Array<{content?:Array<{type?:string;text?:string}>}>};
  const text=data.output_text??data.output?.flatMap(item=>item.content??[]).find(item=>item.type==="output_text")?.text;
  if(!text)throw new Error("provider returned no text");return JSON.parse(text);
}

export async function POST(request:Request){
  let body:unknown;try{body=await request.json()}catch{return Response.json({error:"invalid JSON"},{status:400})}
  if(!validBody(body))return Response.json({error:"invalid companion request"},{status:400});
  const fallback=()=>enforcePlayerView(groundReply(deterministicReply(body.trigger,body.legalRoutes,body.environment,body.recommendationEvidence,body.recentMessages),body.legalRoutes),body);
  try{
    const provider=process.env.AI_PROVIDER||"openrouter",apiKey=process.env.OPENROUTER_API_KEY;
    if(provider!=="openrouter"||!apiKey)return Response.json({...fallback(),source:"fallback"});
    const reply=await openRouter(body,apiKey);if(!validReply(reply,body.legalRoutes)){console.error("ARIADNE provider returned an invalid reply",{selectedRouteId:reply?.selectedRouteId,kind:reply?.kind,messageType:typeof reply?.message});return Response.json({...fallback(),source:"fallback"})}
    return Response.json({...enforcePlayerView(groundReply(reply,body.legalRoutes),body),source:"provider"});
  }catch(error){console.error("ARIADNE provider request failed",error);return Response.json({...fallback(),source:"fallback"})}
}
