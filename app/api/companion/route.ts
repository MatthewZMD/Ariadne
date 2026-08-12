import { deterministicReply, type CompanionEvent, type CompanionMessage, type CompanionReply, type GuidanceEvidence, type RouteOption, type VisibleEnvironment } from "../../companion";
import { ARIADNE_SYSTEM_PROMPT } from "./prompt";

type RequestBody={
  sessionId:string;trigger:CompanionEvent;recommendation:unknown;recommendationEvidence:GuidanceEvidence|null;
  actualTrajectory:unknown[];currentView:unknown;environment:VisibleEnvironment;rememberedMap:string;
  legalRoutes:RouteOption[];recentMessages:CompanionMessage[];olderContextSummary:string;playerMessage?:string;
};

const replyKinds=["guidance","praise","apology","agreement","reframe","environment","reply","observation","silence"];
const responseSchema={type:"object",additionalProperties:false,required:["message","selectedRouteId","kind"],properties:{message:{type:"string",maxLength:320},selectedRouteId:{type:["string","null"]},kind:{type:"string",enum:replyKinds}}};

function validBody(value:unknown):value is RequestBody{
  if(!value||typeof value!=="object")return false;const body=value as Partial<RequestBody>;
  return typeof body.sessionId==="string"&&body.sessionId.length<=80&&!!body.trigger&&Array.isArray(body.actualTrajectory)&&body.actualTrajectory.length<=40&&typeof body.rememberedMap==="string"&&body.rememberedMap.length<=1800&&Array.isArray(body.legalRoutes)&&body.legalRoutes.length<=6&&Array.isArray(body.recentMessages)&&body.recentMessages.length<=8&&(!body.playerMessage||body.playerMessage.length<=500);
}

function validReply(value:unknown,routes:RouteOption[]):value is CompanionReply{
  if(!value||typeof value!=="object")return false;const reply=value as CompanionReply;
  return typeof reply.message==="string"&&reply.message.length<=320&&(reply.selectedRouteId===null||routes.some(r=>r.id===reply.selectedRouteId))&&replyKinds.includes(reply.kind);
}

function statePrompt(body:RequestBody){
  const routes=body.legalRoutes.map(r=>({id:r.id,direction:r.direction,knownCells:r.knownCells,targetCell:r.targetCell,description:r.description}));
  return `<maze_state>\nCURRENT VIEW\n${JSON.stringify(body.currentView)}\nVISIBLE ENVIRONMENT\n${JSON.stringify(body.environment)}\nREMEMBERED MAP\n${body.rememberedMap}\nPREVIOUS RECOMMENDATION\n${JSON.stringify(body.recommendation)}\nPLAYER MOVEMENT SINCE RECOMMENDATION\n${JSON.stringify(body.actualTrajectory)}\nCOMPARISON EVIDENCE\n${JSON.stringify(body.recommendationEvidence)}\nLEGAL ROUTES\n${JSON.stringify(routes)}\nRECENT CONVERSATION\n${JSON.stringify(body.recentMessages)}\nOLDER CONTEXT SUMMARY\n${body.olderContextSummary.slice(0,800)}\nMEANINGFUL EVENT\n${JSON.stringify(body.trigger)}\nOPTIONAL PLAYER MESSAGE\n${body.playerMessage??"none"}\n</maze_state>`;
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
  const fallback=()=>deterministicReply(body.trigger,body.legalRoutes,body.environment,body.recommendationEvidence,body.recentMessages);
  try{
    const provider=process.env.AI_PROVIDER||"openrouter",apiKey=process.env.OPENROUTER_API_KEY;
    if(provider!=="openrouter"||!apiKey)return Response.json({...fallback(),source:"fallback"});
    const reply=await openRouter(body,apiKey);if(!validReply(reply,body.legalRoutes))return Response.json({...fallback(),source:"fallback"});
    return Response.json({...reply,source:"provider"});
  }catch{return Response.json({...fallback(),source:"fallback"})}
}
