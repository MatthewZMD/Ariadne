import process from "node:process";
import { deterministicReply, type CompanionArc, type CompanionEvent, type CompanionMessage, type CompanionReply, type EgocentricView, type GuidanceEvidence, type GuidanceIntent, type PlayerActivity, type RouteOption, type TrajectorySample, type VisibleEnvironment } from "../../companion.ts";
import { ARIADNE_SYSTEM_PROMPT } from "./prompt.ts";

type RequestBody={
  sessionId:string;trigger:CompanionEvent;activity:PlayerActivity;recommendation:GuidanceIntent|null;recommendationEvidence:GuidanceEvidence|null;
  actualTrajectory:TrajectorySample[];currentView:EgocentricView;environment:VisibleEnvironment;rememberedMap:string;
  legalRoutes:RouteOption[];recentMessages:CompanionMessage[];olderContextSummary:string;companionArc:CompanionArc;playerMessage?:string;
};

const replyKinds=["guidance","praise","apology","agreement","reframe","environment","reply","observation","silence"];
const responseSchema=(routes:RouteOption[])=>({type:"object",additionalProperties:false,required:["message","selectedRouteId","kind"],properties:{message:{type:"string",maxLength:320},selectedRouteId:{enum:[...routes.map(route=>route.id),null]},kind:{type:"string",enum:replyKinds}}});

function validBody(value:unknown):value is RequestBody{
  if(!value||typeof value!=="object")return false;const body=value as Partial<RequestBody>;
  return typeof body.sessionId==="string"&&body.sessionId.length<=80&&!!body.trigger&&!!body.activity&&!!body.companionArc&&typeof body.companionArc.performanceDirection==="string"&&body.companionArc.performanceDirection.length<=500&&Array.isArray(body.actualTrajectory)&&body.actualTrajectory.length<=40&&typeof body.rememberedMap==="string"&&body.rememberedMap.length<=1800&&Array.isArray(body.legalRoutes)&&body.legalRoutes.length<=6&&Array.isArray(body.recentMessages)&&body.recentMessages.length<=8&&(!body.playerMessage||body.playerMessage.length<=500);
}

function validReply(value:unknown,routes:RouteOption[]):value is CompanionReply{
  if(!value||typeof value!=="object")return false;const reply=value as CompanionReply;
  return typeof reply.message==="string"&&reply.message.length<=320&&(reply.selectedRouteId===null||routes.some(r=>r.id===reply.selectedRouteId))&&replyKinds.includes(reply.kind);
}

export function acceptReply(reply:CompanionReply,routes:RouteOption[]):CompanionReply{
  if(reply.kind==="silence")return{...reply,message:"",selectedRouteId:null};
  const selectedRouteId=routes.some(route=>route.id===reply.selectedRouteId)?reply.selectedRouteId:null;
  return{...reply,message:reply.message.trim().slice(0,320),selectedRouteId};
}

function semanticRecommendation(value:GuidanceIntent|null){return value?.message||null}

function semanticMovement(evidence:GuidanceEvidence|null){
  if(!evidence)return"No earlier navigation recommendation is being evaluated.";
  if(evidence.recommendationContradictedByVisibleEvidence)return"The way you suggested visibly ends here.";
  if(evidence.reachedSameTargetByDifferentRoute)return"The player found another way to the place you had in mind.";
  if(evidence.rejoinedAt)return"The player wandered away from your idea and has now come back to it.";
  if(evidence.newCellsRevealedOffSuggestedPath>=5)return"The player's different choice revealed somewhere new.";
  if(evidence.suggestedCellOverlap>=.45&&evidence.movementTowardTarget>.2)return"The player stayed with your idea and it is carrying them onward.";
  return"Nothing about the player's response to your last idea is clear enough to characterize.";
}

function semanticEvent(event:CompanionEvent){
  if(event.type==="initial_guidance")return"You have just joined the player and should offer a direction.";
  if(event.type==="new_junction_visible")return"The player is walking toward an intersection they can see. Choose which way they should go there.";
  if(event.type==="dead_end_visible")return"The player can already see that the passage ends. React now, before they walk into the wall, and choose another available way.";
  if(event.type==="passing_thought")return"Nothing dramatic just happened. Share one fresh thought or feeling about being here together.";
  if(event.type==="trajectory_relationship_changed"){
    if(event.relationship==="accepted_suggestion")return"The player has now taken the exact choice you suggested. React to the fact that they trusted you before saying anything else.";
    if(event.relationship==="chose_another_way")return"At the choice, the player deliberately took a different way from the one you suggested. Quickly validate their instinct and adopt their choice as the exciting new plan.";
    if(event.relationship==="left_then_rejoined")return"The player left your suggested path and has now rejoined it. React to that return personally.";
    return"The player reached the place you intended by a different route. Give them warm credit for improving on your idea.";
  }
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
  return `<scene>\n${body.activity.description}\n${body.currentView.description}\n${setting}\n\nLatest moment: ${semanticEvent(body.trigger)}\nYour last idea: ${previous}\nSince then: ${semanticMovement(body.recommendationEvidence)}\n\nYour emotional momentum: ${body.companionArc.performanceDirection}\n\nAvailable choices:\n${choices}\nChoose a key silently; the game speaks the corresponding direction.\n\nRecent conversation:\n${conversation}\n${body.olderContextSummary.slice(0,800)}\n\nPlayer says: ${body.playerMessage??"Nothing."}\n</scene>`;
}

async function requestOpenRouter(body:RequestBody,apiKey:string,model:string):Promise<CompanionReply>{
  const response=await fetch("https://openrouter.ai/api/v1/responses",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json","http-referer":process.env.APP_URL||"https://null-corridor.agent767107.chatgpt.site","x-title":"ARIADNE Companion"},body:JSON.stringify({model,instructions:ARIADNE_SYSTEM_PROMPT,input:statePrompt(body),reasoning:{effort:"low"},text:{verbosity:"low",format:{type:"json_schema",name:"ariadne_reply",strict:true,schema:responseSchema(body.legalRoutes)}},max_output_tokens:180})});
  if(!response.ok){const error=new Error(`provider ${response.status}: ${(await response.text()).slice(0,500)}`) as Error&{status?:number};error.status=response.status;throw error}
  const data=await response.json() as {output_text?:string;output?:Array<{content?:Array<{type?:string;text?:string}>}>};
  const text=data.output_text??data.output?.flatMap(item=>item.content??[]).find(item=>item.type==="output_text")?.text;
  if(!text)throw new Error("provider returned no text");return JSON.parse(text);
}

async function openRouter(body:RequestBody,apiKey:string):Promise<CompanionReply>{
  const preferred=process.env.AI_MODEL||"openai/gpt-5.6-luna";
  try{return await requestOpenRouter(body,apiKey,preferred)}catch(error){
    if((error as {status?:number}).status!==403)throw error;
    return requestOpenRouter(body,apiKey,process.env.AI_FALLBACK_MODEL||"qwen/qwen3.8-max");
  }
}

export async function POST(request:Request){
  let body:unknown;try{body=await request.json()}catch{return Response.json({error:"invalid JSON"},{status:400})}
  if(!validBody(body))return Response.json({error:"invalid companion request"},{status:400});
  const fallback=()=>acceptReply(deterministicReply(body.trigger,body.legalRoutes,body.environment,body.recommendationEvidence),body.legalRoutes);
  try{
    const provider=process.env.AI_PROVIDER||"openrouter",apiKey=process.env.OPENROUTER_API_KEY;
    if(provider!=="openrouter"||!apiKey)return Response.json({...fallback(),source:"fallback"});
    const reply=await openRouter(body,apiKey);if(!validReply(reply,body.legalRoutes)){console.error("ARIADNE provider returned an invalid reply",{selectedRouteId:reply?.selectedRouteId,kind:reply?.kind,messageType:typeof reply?.message});return Response.json({...fallback(),source:"fallback"})}
    return Response.json({...acceptReply(reply,body.legalRoutes),source:"provider"});
  }catch(error){console.error("ARIADNE provider request failed",error);return Response.json({...fallback(),source:"fallback"})}
}
