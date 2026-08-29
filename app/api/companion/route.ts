import process from "node:process";
import { deterministicReply, PLAYER_NAME, type CompanionArc, type CompanionEvent, type CompanionMessage, type CompanionReply, type EgocentricView, type GuidanceEvidence, type GuidanceIntent, type PlayerActivity, type RouteOption, type TrajectorySample, type VisibleEnvironment } from "../../companion.ts";
import type { NavigationBelief, PublicObjectiveContext } from "../../objectives.ts";
import { ARIADNE_SYSTEM_PROMPT } from "./prompt.ts";
import type { PromptPerceivedScene } from "../../scene.ts";
import type { AriadneEmbodimentContext } from "../../ariadne-body.ts";
import { speechActDirection, speechActForEvent, type CompanionSpeechAct, type EmbodiedDecisionState, type SpeechAnchor } from "../../embodied-interaction.ts";

export type RequestBody={
  sessionId:string;trigger:CompanionEvent;speechAnchor:SpeechAnchor;dispositionCard:string;activity:PlayerActivity;recommendation:GuidanceIntent|null;recommendationEvidence:GuidanceEvidence|null;
  actualTrajectory:TrajectorySample[];currentView:EgocentricView;environment:VisibleEnvironment;perceivedScene:PromptPerceivedScene;sceneChanges:string[];rememberedMap:string;
  legalRoutes:RouteOption[];recentMessages:CompanionMessage[];olderContextSummary:string;companionArc:CompanionArc;
  objective:PublicObjectiveContext;navigationBelief:NavigationBelief|null;embodiment:AriadneEmbodimentContext;
  accomplishment?:{whatMTJustAccomplished:string;whatChangedPermanently:string|null;starVisiblyResponded:boolean;visibleProgress:string}|null;
  visibleConfigurations?:string[];
  playerMessage?:string;preferredModelId?:string|null;
};

type OpenRouterModel={id:string;created?:number;context_length?:number;expiration_date?:string|null;architecture?:{input_modalities?:string[];output_modalities?:string[]};pricing?:{prompt?:string;completion?:string;request?:string};supported_parameters?:string[];reasoning?:{mandatory?:boolean;default_enabled?:boolean}};
type ProviderResult={reply:CompanionReply;modelUsed:string|null};
type ProviderPayload={model?:string;output_text?:string;output?:Array<{text?:string;content?:Array<{type?:string;text?:string}>}>;choices?:Array<{message?:{content?:string|Array<{text?:string}>}}>};
class ProviderAttemptError extends Error{readonly retryable:boolean;constructor(message:string,retryable:boolean){super(message);this.retryable=retryable}}

const MAX_REQUEST_BYTES=64*1024;
const routeDirections=["left","right","straight","back"] as const;
const themes=["neutral","beach","tornado","ruins","frozen","foundry","cavern"] as const;
const trajectoryChanges=["sustained_alignment","sustained_divergence","left_then_rejoined","same_waypoint_different_route","recommendation_visibly_contradicted"] as const;
const goalByStars=["first_star","second_star","third_star","fourth_star","exit"] as const;
const objectiveEvents=["searching","star_visible","star_collected","objective_changed"] as const;
const embodiedStates=["noticing","committing","waiting","mt_following","mt_diverging","mt_passed","route_contradicted","rejoining","resolved"] as const satisfies readonly EmbodiedDecisionState[];
const speechActs=["invite_to_visible_choice","confirm_following","respond_to_divergence","catch_up","repair_mistake","celebrate_rejoining","react_to_star","celebrate_accomplishment","renew_hope","share_visible_discovery","passing_companionship","reply_to_mt"] as const satisfies readonly CompanionSpeechAct[];
const FAST_FREE_MODELS=["dots-studio/dots-3-note-preview:free","google/gemma-4-31b-it:free","minimax/minimax-m3:free","google/gemma-4-26b-a4b-it:free"];

type RecordValue=Record<string,unknown>;
const isRecord=(value:unknown):value is RecordValue=>!!value&&typeof value==="object"&&!Array.isArray(value);
const isString=(value:unknown,max:number,min=0):value is string=>typeof value==="string"&&value.length>=min&&value.length<=max;
const isNumber=(value:unknown,min=-1_000_000,max=1_000_000,integer=false):value is number=>typeof value==="number"&&Number.isFinite(value)&&value>=min&&value<=max&&(!integer||Number.isInteger(value));
const isBoolean=(value:unknown):value is boolean=>typeof value==="boolean";
const isEnum=<T extends readonly string[]>(value:unknown,values:T):value is T[number]=>typeof value==="string"&&values.includes(value as T[number]);
const isPoint=(value:unknown,integer=false):value is [number,number]=>Array.isArray(value)&&value.length===2&&isNumber(value[0],-1_000_000,1_000_000,integer)&&isNumber(value[1],-1_000_000,1_000_000,integer);
const isPointArray=(value:unknown,max:number):value is Array<[number,number]>=>Array.isArray(value)&&value.length<=max&&value.every(point=>isPoint(point,true));
const nullablePoint=(value:unknown)=>value===null||isPoint(value,true);

function isRoute(value:unknown):value is RouteOption{
  if(!isRecord(value))return false;
  return isString(value.id,160,1)&&isEnum(value.direction,routeDirections)&&isPointArray(value.knownCells,24)&&value.knownCells.length>0&&nullablePoint(value.targetCell)&&(value.targetRegionId===null||isString(value.targetRegionId,160,1))&&isString(value.description,240)&&isString(value.instruction,160)&&isNumber(value.score)&&
    (value.decisionPoint===undefined||value.decisionPoint==="current"||value.decisionPoint==="upcoming")&&(value.decisionCell===undefined||isPoint(value.decisionCell,true))&&
    (value.openingOrdinal===undefined||isNumber(value.openingOrdinal,1,12,true))&&(value.sameSideOpeningCount===undefined||isNumber(value.sameSideOpeningCount,2,12,true));
}

function isTrajectorySample(value:unknown):value is TrajectorySample{
  if(!isRecord(value))return false;
  return isNumber(value.time,0,10_000_000_000_000)&&isPoint(value.position)&&isPoint(value.cell,true)&&isNumber(value.heading,-1000,1000)&&isPointArray(value.newlyVisibleCells,40)&&Array.isArray(value.visibleJunctions)&&value.visibleJunctions.length<=12&&value.visibleJunctions.every(item=>isString(item,160,1))&&(value.visibleEnvironment===null||isEnum(value.visibleEnvironment,themes))&&isEnum(value.movementState,["walking","turning","stationary"] as const);
}

function isEvidence(value:unknown):value is GuidanceEvidence{
  if(!isRecord(value))return false;
  return isNumber(value.activeSeconds,0,10_000)&&isNumber(value.initialDirectionSimilarity,0,1)&&isNumber(value.suggestedCellOverlap,0,1)&&isNumber(value.alignedSeconds,0,10_000)&&isNumber(value.divergedSeconds,0,10_000)&&isPointArray(value.sharedCells,24)&&nullablePoint(value.firstDeviationCell)&&nullablePoint(value.latestRejoinCell)&&
    isBoolean(value.currentlyNearSuggestedRoute)&&isBoolean(value.reachedSameWaypointDifferently)&&isBoolean(value.visiblyContradicted)&&isNumber(value.revealedOnSuggestedRoute,0,100_000,true)&&isNumber(value.revealedAwayFromSuggestedRoute,0,100_000,true)&&isBoolean(value.backtrackingObserved)&&isBoolean(value.familiarGeometryReached);
}

function isGuidanceIntent(value:unknown):value is GuidanceIntent{
  if(!isRecord(value))return false;
  return isString(value.id,160,1)&&isNumber(value.issuedAt,0,10_000_000_000_000)&&isString(value.message,320)&&isEnum(value.kind,["take_branch","continue_corridor","reach_junction","return_to_location","explore_region","avoid_route"] as const)&&isPoint(value.origin,true)&&isNumber(value.originHeading,-1000,1000)&&(value.suggestedRouteId===null||isString(value.suggestedRouteId,160,1))&&isPointArray(value.suggestedCells,40)&&nullablePoint(value.targetCell)&&(value.targetRegionId===null||isString(value.targetRegionId,160,1))&&isPointArray(value.avoidedCells,40)&&isPoint(value.decisionCell,true)&&nullablePoint(value.expectedChoiceCell)&&isEnum(value.expiresWhen,["target_reached","route_invalidated","new_recommendation","meaningful_divergence"] as const);
}

function isTrigger(value:unknown):value is CompanionEvent{
  if(!isRecord(value)||!isString(value.type,48,1))return false;
  if(value.type==="trajectory_relationship_changed")return isEnum(value.change,trajectoryChanges);
  if(value.type==="embodied_response")return isEnum(value.response,["followed","diverged","passed","rejoined"] as const);
  if(value.type==="dead_end_visible")return isPoint(value.cell,true);
  if(value.type==="environment_visible"||value.type==="environment_entered")return isString(value.regionId,160,1)&&isEnum(value.environment,themes)&&value.environment!=="neutral";
  if(value.type==="scene_changed")return isString(value.sceneId,200,1);
  if(value.type==="idle")return isBoolean(value.atChoice);
  if(value.type==="player_message")return isString(value.text,500,1);
  if(value.type==="star_visible"||value.type==="star_collected")return isString(value.starId,200,1)&&isNumber(value.ordinal,1,4,true);
  if(value.type==="encounter_completed")return isString(value.encounterId,240,1)&&isBoolean(value.starResponded);
  if(value.type==="objective_changed")return isNumber(value.collectedStars,0,4,true);
  return ["recommendation_contradicted","target_reached","same_target_reached_differently","new_junction_visible","left_ariadne_waiting","passing_thought","revisited_position","sustained_backtrack","repeated_collision","final_direction","initial_guidance"].includes(value.type);
}

function isActivity(value:unknown):value is PlayerActivity{
  if(!isRecord(value))return false;
  return isEnum(value.state,["stationary","turning_in_place","walking"] as const)&&isNumber(value.stationarySeconds,0,3600,true)&&isBoolean(value.positionChangedSinceRecommendation)&&isBoolean(value.headingChangedSinceRecommendation)&&isBoolean(value.atVisibleChoice)&&isString(value.description,300);
}

function isView(value:unknown):value is EgocentricView{
  if(!isRecord(value))return false;
  return isEnum(value.facing,["north","east","south","west"] as const)&&isString(value.centerView,160)&&Array.isArray(value.openings)&&value.openings.length<=4&&value.openings.every(item=>isEnum(item,routeDirections))&&Array.isArray(value.blocked)&&value.blocked.length<=4&&value.blocked.every(item=>isEnum(item,routeDirections))&&isString(value.description,600);
}

function isEnvironment(value:unknown):value is Exclude<VisibleEnvironment,null>{
  if(!isRecord(value))return false;
  return isEnum(value.id,themes)&&value.id!=="neutral"&&isString(value.regionId,160,1)&&isString(value.name,100,1)&&Array.isArray(value.details)&&value.details.length<=4&&value.details.every(item=>isString(item,100,1));
}

const relativeDirections=["far_left","left","center","right","far_right"] as const;
const sceneDistances=["near","mid","far"] as const;
function isPerceivedScene(value:unknown):value is PromptPerceivedScene{
  if(!isRecord(value)||!isRecord(value.setting)||!isRecord(value.geometry)||!isRecord(value.objective)||!isRecord(value.mtAttention))return false;
  const setting=value.setting,geometry=value.geometry,objective=value.objective,attention=value.mtAttention,nullableText=(item:unknown,max=120)=>item===null||isString(item,max,1);
  if(!(setting.primaryEnvironment===null||isEnum(setting.primaryEnvironment,themes))||!Array.isArray(setting.blendedEnvironments)||setting.blendedEnvironments.length>7||!setting.blendedEnvironments.every(item=>isEnum(item,themes))||!Array.isArray(setting.visibleDetails)||setting.visibleDetails.length>6||!setting.visibleDetails.every(item=>isString(item,120,1)))return false;
  if(!isString(geometry.facingDescription,120,1)||!Array.isArray(geometry.visibleOpenings)||geometry.visibleOpenings.length>4||!geometry.visibleOpenings.every(item=>isRecord(item)&&isEnum(item.direction,routeDirections)&&isString(item.description,120,1))||!isBoolean(geometry.visibleEndAhead)||!isBoolean(geometry.visibleJunction))return false;
  if(!Array.isArray(value.objects)||value.objects.length>24||!value.objects.every(item=>isRecord(item)&&isString(item.name,100,1)&&isEnum(item.direction,relativeDirections)&&isEnum(item.distance,sceneDistances)&&isString(item.action,180,1)&&isBoolean(item.firstSeen)))return false;
  if(!Array.isArray(value.spectacles)||value.spectacles.length>8||!value.spectacles.every(item=>isRecord(item)&&isString(item.description,220,1)&&isEnum(item.direction,relativeDirections)&&isEnum(item.salience,["ambient","noticeable","major"] as const)&&isBoolean(item.firstSeen)))return false;
  if(!isBoolean(objective.starVisible)||!(objective.starDirection===null||isEnum(objective.starDirection,relativeDirections))||!(objective.starDistance===null||isEnum(objective.starDistance,sceneDistances)))return false;
  return nullableText(attention.lookingToward)&&nullableText(attention.approaching)&&nullableText(attention.movingAwayFrom)&&nullableText(attention.pausedNear);
}

function isMessage(value:unknown):value is CompanionMessage{
  if(!isRecord(value))return false;
  return isString(value.id,160,1)&&(value.role==="ariadne"||value.role==="player")&&isString(value.text,500,1)&&isNumber(value.time,0,10_000_000_000_000);
}

function isArc(value:unknown):value is CompanionArc{
  if(!isRecord(value))return false;
  return isEnum(value.phase,["charming","attached","overbearing"] as const)&&isString(value.performanceDirection,900,1)&&isString(value.relationshipContext,900,1);
}

function isObjective(value:unknown):value is PublicObjectiveContext{
  if(!isRecord(value)||!isNumber(value.collectedStars,0,4,true))return false;
  return value.currentGoal===goalByStars[value.collectedStars]&&isBoolean(value.activeStarVisible)&&(value.collectedStars<4||value.activeStarVisible===false)&&isEnum(value.latestEvent,objectiveEvents);
}

function isEmbodiment(value:unknown):value is AriadneEmbodimentContext{
  if(!isRecord(value))return false;
  return isString(value.currentAction,240,1)&&isString(value.positionRelativeToMT,100,1)&&(value.relationToBelievedRoute===null||isString(value.relationToBelievedRoute,220,1))&&isBoolean(value.mtLookingAtAriadne)&&isBoolean(value.mtApproachingAriadne)&&isBoolean(value.mtFollowingHerLead)&&isBoolean(value.mtLeavingWhileSheWaits)&&isBoolean(value.mtReturningToHer);
}

function isSpeechAnchor(value:unknown):value is SpeechAnchor{
  if(!isRecord(value)||!isEnum(value.speechAct,speechActs)||!isNumber(value.speechEpoch,0,100_000,true))return false;
  return(value.episodeId===null&&value.episodeState===null)||(isString(value.episodeId,220,1)&&isEnum(value.episodeState,embodiedStates));
}

function isBelief(value:unknown,routes:RouteOption[],collectedStars:number):value is NavigationBelief|null{
  if(value===null)return true;
  if(!isRecord(value))return false;
  return isString(value.id,200,1)&&isNumber(value.objectiveStage,0,4,true)&&value.objectiveStage===collectedStars&&isString(value.junctionId,200,1)&&isString(value.routeId,160,1)&&routes.some(route=>route.id===value.routeId)&&isString(value.instruction,160);
}

export function parseCompanionRequest(value:unknown):RequestBody|null{
  if(!isRecord(value)||!isString(value.sessionId,80,1)||!isTrigger(value.trigger)||!isSpeechAnchor(value.speechAnchor)||!isString(value.dispositionCard,900,1)||!isActivity(value.activity))return null;
  if(value.speechAnchor.speechAct!==speechActForEvent(value.trigger))return null;
  if(!(value.recommendation===null||isGuidanceIntent(value.recommendation))||!(value.recommendationEvidence===null||isEvidence(value.recommendationEvidence)))return null;
  if(!Array.isArray(value.actualTrajectory)||value.actualTrajectory.length>40||!value.actualTrajectory.every(isTrajectorySample)||!isView(value.currentView)||!(value.environment===null||isEnvironment(value.environment))||!isPerceivedScene(value.perceivedScene)||!Array.isArray(value.sceneChanges)||value.sceneChanges.length>8||!value.sceneChanges.every(item=>isString(item,240,1)))return null;
  if(!isString(value.rememberedMap,1800)||!Array.isArray(value.legalRoutes)||value.legalRoutes.length>6||!value.legalRoutes.every(isRoute))return null;
  const legalRoutes=value.legalRoutes as RouteOption[];if(new Set(legalRoutes.map(route=>route.id)).size!==legalRoutes.length)return null;
  if(!Array.isArray(value.recentMessages)||value.recentMessages.length>8||!value.recentMessages.every(isMessage)||!isString(value.olderContextSummary,3200)||!isArc(value.companionArc)||!isObjective(value.objective)||!isEmbodiment(value.embodiment))return null;
  if(!(value.accomplishment===undefined||value.accomplishment===null||isRecord(value.accomplishment)&&isString(value.accomplishment.whatMTJustAccomplished,240,1)&&(value.accomplishment.whatChangedPermanently===null||isString(value.accomplishment.whatChangedPermanently,300,1))&&isBoolean(value.accomplishment.starVisiblyResponded)&&isString(value.accomplishment.visibleProgress,160,1)))return null;
  if(!(value.visibleConfigurations===undefined||Array.isArray(value.visibleConfigurations)&&value.visibleConfigurations.length<=8&&value.visibleConfigurations.every(item=>isString(item,240,1))))return null;
  if(!isBelief(value.navigationBelief,legalRoutes,value.objective.collectedStars))return null;
  const expectedObjectiveEvent=value.trigger.type==="star_visible"?"star_visible":value.trigger.type==="star_collected"?"star_collected":value.trigger.type==="objective_changed"?"objective_changed":"searching";
  if(value.objective.latestEvent!==expectedObjectiveEvent)return null;
  if(value.trigger.type==="star_visible"&&value.trigger.ordinal!==value.objective.collectedStars+1)return null;
  if(value.trigger.type==="star_collected"&&value.trigger.ordinal!==value.objective.collectedStars)return null;
  if(value.trigger.type==="objective_changed"&&value.trigger.collectedStars!==value.objective.collectedStars)return null;
  if(value.playerMessage!==undefined&&!isString(value.playerMessage,500,1))return null;
  if(value.trigger.type==="player_message"&&value.playerMessage!==value.trigger.text)return null;
  if(value.preferredModelId!==undefined&&value.preferredModelId!==null&&!isString(value.preferredModelId,160,1))return null;
  return value as RequestBody;
}

function validReply(value:unknown):value is CompanionReply{
  return isRecord(value)&&isString(value.message,320);
}

export function acceptReply(reply:CompanionReply):CompanionReply{
  return{message:reply.message.trim().slice(0,320)};
}

export function isFreeCompanionModel(model:OpenRouterModel,now=Date.now()){
  const inputs=model.architecture?.input_modalities??[],outputs=model.architecture?.output_modalities??[],pricing=model.pricing;
  const expires=model.expiration_date?Date.parse(model.expiration_date):NaN;
  return model.id.endsWith(":free")&&inputs.includes("text")&&outputs.includes("text")&&pricing?.prompt==="0"&&pricing?.completion==="0"&&(!pricing.request||pricing.request==="0")&&model.reasoning?.mandatory!==true&&model.reasoning?.default_enabled!==true&&(model.context_length??0)>=8192&&(!Number.isFinite(expires)||expires>now);
}

export function extractProviderText(data:ProviderPayload){
  if(typeof data.output_text==="string"&&data.output_text.trim())return data.output_text;
  for(const item of data.output??[]){if(typeof item.text==="string"&&item.text.trim())return item.text;for(const content of item.content??[])if(typeof content.text==="string"&&content.text.trim())return content.text}
  for(const choice of data.choices??[]){const content=choice.message?.content;if(typeof content==="string"&&content.trim())return content;if(Array.isArray(content)){const joined=content.map(item=>item.text??"").join("");if(joined.trim())return joined}}
  return null;
}

export function parseProviderReply(text:string){
  const cleaned=text.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");
  const start=cleaned.indexOf("{"),end=cleaned.lastIndexOf("}");
  const candidates=[cleaned,start>=0&&end>start?cleaned.slice(start,end+1):null].filter((value,index,all):value is string=>!!value&&all.indexOf(value)===index);
  for(const candidate of candidates)try{const reply=JSON.parse(candidate) as unknown;if(validReply(reply))return{message:reply.message}}catch{continue}
  return null;
}

export const providerReplyRestartsJourney=(message:string)=>/\b(?:hi|hello),?\s*MT\b.{0,40}\bI[’']m Ariadne\b|\bI[’']m here to help you find four stars\b/i.test(message);

function normalizeProviderReply(text:string,body:RequestBody){
  const mayIntroduce=body.trigger.type==="initial_guidance";
  const structured=parseProviderReply(text);if(structured&&!mayIntroduce&&providerReplyRestartsJourney(structured.message))return null;if(structured)return{message:structured.message};
  const message=text.trim().replace(/^```(?:text)?\s*/i,"").replace(/\s*```$/,"").replace(/^\s*(?:<ARIADNE>|ARIADNE:)\s*/i,"").replace(/^(["'])|(["'])$/g,"").trim();
  if(!message||message.length>320||!mayIntroduce&&providerReplyRestartsJourney(message)||/^(?:the user|the prompt|we need|we are to|i need to|analysis\b)/i.test(message)||/<\/?scene>/i.test(message))return null;
  return{message} satisfies CompanionReply;
}

export function isVerifiedProviderModel(requested:string,actual:string|undefined,allowed:Set<string>){
  if(!actual)return false;
  if(requested==="openrouter/free")return allowed.size===0||allowed.has(actual);
  return actual===requested&&allowed.has(actual);
}

let modelCache:{expiresAt:number;models:string[]}|null=null,modelCatalogRequest:Promise<string[]>|null=null;
const unavailableModels=new Map<string,number>();
function modelAvailable(model:string,now=Date.now()){
  const until=unavailableModels.get(model)??0;if(until<=now){unavailableModels.delete(model);return true}return false;
}
function temporarilySideline(model:string,error:unknown){
  if(model==="openrouter/free"||!(error instanceof ProviderAttemptError)||/free-models-per-min|limit_source/i.test(error.message))return;
  unavailableModels.set(model,Date.now()+(error.retryable?90_000:30_000));
}
async function freeModels(apiKey:string){
  if(modelCache&&modelCache.expiresAt>Date.now())return modelCache.models;
  if(modelCatalogRequest)return modelCatalogRequest;
  modelCatalogRequest=(async()=>{try{
      const response=await fetch("https://openrouter.ai/api/v1/models?sort=latency-low-to-high",{headers:{authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw new Error(`model catalog ${response.status}`);
      const payload=await response.json() as {data?:OpenRouterModel[]};const models=(payload.data??[]).filter(model=>isFreeCompanionModel(model)&&!/(?:code|coder|safety|guard|rerank|embedding|audio|poolside)/i.test(model.id)).sort((a,b)=>{
        const ai=FAST_FREE_MODELS.indexOf(a.id),bi=FAST_FREE_MODELS.indexOf(b.id),rank=(ai<0?FAST_FREE_MODELS.length:ai)-(bi<0?FAST_FREE_MODELS.length:bi);return rank||(b.created??0)-(a.created??0);
      }).map(model=>model.id);
      if(models.length)modelCache={expiresAt:Date.now()+15*60_000,models};
    }catch(error){console.warn("ARIADNE free model catalog unavailable",error)}
    return modelCache?.models??[];
  })();
  try{return await modelCatalogRequest}finally{modelCatalogRequest=null}
}

function semanticMovement(evidence:GuidanceEvidence|null){
  if(!evidence)return"No earlier navigation suggestion is currently being compared.";
  if(evidence.visiblyContradicted)return"The route you suggested is contradicted by geometry MT can now see.";
  if(evidence.latestRejoinCell)return"MT moved away from your suggested route and later travelled alongside it again.";
  if(evidence.reachedSameWaypointDifferently)return"MT reached the same local place through a different passage.";
  if(evidence.divergedSeconds>=8)return evidence.revealedAwayFromSuggestedRoute>0?"MT has moved away from your suggestion for a sustained stretch, revealing different space.":"MT has moved away from your suggestion for a sustained stretch; what that means is still unclear.";
  if(evidence.alignedSeconds>=5)return"MT has travelled alongside your suggestion for a sustained stretch.";
  return"MT's movement relative to your last suggestion is still ambiguous.";
}

function semanticEvent(event:CompanionEvent){
  if(event.type==="initial_guidance")return`This is your first moment together. Begin exactly with: “Hi, ${PLAYER_NAME}—I’m Ariadne. I’m here to help you find four stars, then the exit.”`;
  if(event.type==="star_visible")return`The ${["first","second","third","fourth"][event.ordinal-1]} star has just become visible to MT. React to the actual sight of it.`;
  if(event.type==="star_collected")return`MT has just collected star ${event.ordinal} of four. Celebrate, while interpreting the journey only through the supplied trajectory facts.`;
  if(event.type==="encounter_completed")return event.starResponded?"MT completed a visible configuration and the star visibly responded to it.":"MT completed a visible configuration. The location transformed, but the star showed no visible response.";
  if(event.type==="objective_changed")return event.collectedStars===4?"All four stars are collected. You are now certain you can guide MT to the exit.":`The next objective has begun after ${event.collectedStars} collected star${event.collectedStars===1?"":"s"}.`;
  if(event.type==="final_direction")return"The search has continued through transformed and familiar places. You are forming one more sincere, confident hope and beginning to invite MT onward; you do not know the link is about to cut.";
  if(event.type==="new_junction_visible")return"An intersection is visible. Your body has already chosen and is physically indicating one passage.";
  if(event.type==="embodied_response")return({followed:"MT entered the passage your body indicated.",diverged:"MT entered another passage and you are catching up beside them.",passed:"MT moved past while you waited and you are catching up.",rejoined:"MT has just returned toward you after moving away."})[event.response];
  if(event.type==="left_ariadne_waiting")return"You chose a passage at the intersection and waited there, but MT took another passage. You have now caught up beside MT. React directly to MT from here; do not speak as though you are still waiting behind.";
  if(event.type==="dead_end_visible")return"MT can already see that the passage ends ahead. React before MT reaches the wall and choose another supplied way.";
  if(event.type==="passing_thought")return"Nothing decisive just happened. Share one fresh feeling or observation about travelling here with MT; this is not a navigation moment.";
  if(event.type==="trajectory_relationship_changed")return({sustained_alignment:"MT has travelled alongside your suggestion for a sustained stretch.",sustained_divergence:"MT has moved away from your suggestion for a sustained stretch; the result is not settled.",left_then_rejoined:"MT moved away from your suggested route and later rejoined it.",same_waypoint_different_route:"MT reached the same local place by another route.",recommendation_visibly_contradicted:"Visible geometry has contradicted the route you suggested."})[event.change];
  if(event.type==="recommendation_contradicted")return"Visible geometry has contradicted the route you suggested.";
  if(event.type==="target_reached")return"MT has reached the local place your suggestion referred to. This says nothing about an exit.";
  if(event.type==="same_target_reached_differently")return"MT reached the same local place by another passage. This says nothing about an exit.";
  if(event.type==="environment_visible"||event.type==="environment_entered")return"The visible surroundings have changed enough to notice.";
  if(event.type==="scene_changed")return"A vivid, impossible event has just become visible. React to the supplied event itself, not to an abstract environment category.";
  if(event.type==="revisited_position")return"MT is somewhere they have physically stood before.";
  if(event.type==="repeated_collision")return"MT has pressed into the wall in front more than once.";
  if(event.type==="idle")return"MT is paused. Treat the pause as something visible, not as refusal, agreement, or failure to answer.";
  if(event.type==="player_message")return"MT has typed a message to you.";
  return"MT's movement has revealed a concrete change worth noticing.";
}

function statePrompt(body:RequestBody){
  const setting=body.environment?`${body.environment.name}; details: ${body.environment.details.join(", ")}`:"ordinary maze";
  const scene=body.perceivedScene,openings=scene.geometry.visibleOpenings.map(item=>item.description).join(", ")||"no open passage in the current view";
  const objects=scene.objects.slice(0,6).map(item=>`${item.direction.replace("_"," ")}/${item.distance}: ${item.name}, ${item.action}`).join("; ")||"none";
  const spectacles=scene.spectacles.slice(0,6).map(item=>`${item.direction.replace("_"," ")}: ${item.description}`).join("; ")||"none";
  const attention=[scene.mtAttention.lookingToward&&`looking toward ${scene.mtAttention.lookingToward}`,scene.mtAttention.approaching&&`approaching ${scene.mtAttention.approaching}`,scene.mtAttention.movingAwayFrom&&`leaving ${scene.mtAttention.movingAwayFrom}`,scene.mtAttention.pausedNear&&`paused beside ${scene.mtAttention.pausedNear}`].filter(Boolean).join("; ")||body.activity.state.replaceAll("_"," ");
  const changes=body.sceneChanges.length?body.sceneChanges.map(change=>`- ${change}`).join("\n"):"none";
  const previous=body.recommendation?.message??"none";
  const goalLabels={first_star:"the first star",second_star:"the second star",third_star:"the third star",fourth_star:"the fourth star",exit:"the exit"};
  const goal=`${body.objective.collectedStars}/4 collected; seeking ${goalLabels[body.objective.currentGoal]}; ${body.objective.activeStarVisible?"star visible":"goal unseen"}`;
  const physical=[body.embodiment.currentAction,body.embodiment.relationToBelievedRoute,body.embodiment.mtLookingAtAriadne&&"MT is looking directly toward your light.",body.embodiment.mtApproachingAriadne&&"MT is moving closer to your light.",body.embodiment.mtFollowingHerLead&&"MT is moving with the passage you physically indicated.",body.embodiment.mtLeavingWhileSheWaits&&"MT moved away while you waited at the passage.",body.embodiment.mtReturningToHer&&"MT has come back toward you after moving away."].filter(Boolean).join(" ");
  const accomplishment=body.accomplishment?`${body.accomplishment.whatMTJustAccomplished} ${body.accomplishment.visibleProgress} ${body.accomplishment.whatChangedPermanently??"No permanent change has completed yet."} ${body.accomplishment.starVisiblyResponded?"The star visibly responded.":"The star did not visibly respond."}`:"none currently",configurations=body.visibleConfigurations?.join("; ")||"none";
  return `<private_stage_card>\nGOAL: ${goal}\nVIEW: ways ${openings}; ahead ${scene.geometry.visibleEndAhead?"ends":"continues"}; setting ${setting}\nVISIBLE OBJECTS: ${objects}\nVISIBLE SPECTACLES: ${spectacles}\nVISIBLE CONFIGURATIONS: ${configurations}\nACCOMPLISHMENT: ${accomplishment}\nCHANGES: ${changes}\nYOUR BODY: ${physical}\nMT'S ACTION: ${attention}\nLATEST MOMENT: ${semanticEvent(body.trigger)}\nREQUIRED SPEECH ACT: ${speechActDirection(body.speechAnchor.speechAct)}\nYOUR LAST WORDS: ${previous}\nPATH RELATIONSHIP: ${semanticMovement(body.recommendationEvidence)}\nCURRENT DISPOSITION: ${body.dispositionCard}\nPERFORMANCE: ${body.companionArc.performanceDirection} ${body.companionArc.relationshipContext}\n</private_stage_card>`;
}

type ProviderMessage={role:"system"|"user"|"assistant";content:string};
export function buildProviderMessages(body:RequestBody):ProviderMessage[]{
  const messages:ProviderMessage[]=[{role:"system",content:ARIADNE_SYSTEM_PROMPT}];
  if(body.olderContextSummary.trim())messages.push({role:"user",content:`Earlier conversation transcript:\n${body.olderContextSummary.slice(0,800)}`});
  messages.push(...body.recentMessages.map(message=>({role:message.role==="ariadne"?"assistant" as const:"user" as const,content:message.text})));
  messages.push({role:"user",content:statePrompt(body)});
  return messages;
}

async function requestOpenRouter(body:RequestBody,apiKey:string,model:string,allowed:Set<string>,timeoutMs:number,clientSignal:AbortSignal):Promise<ProviderResult>{
  const isRouter=model==="openrouter/free";
  let response:Response;
  try{
    response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json","http-referer":process.env.APP_URL||"http://localhost:3001","x-title":"Ariadne"},signal:AbortSignal.any([clientSignal,AbortSignal.timeout(timeoutMs)]),body:JSON.stringify({model,messages:buildProviderMessages(body),provider:{sort:"latency",allow_fallbacks:true},reasoning:{enabled:false,exclude:true},include_reasoning:false,max_tokens:160,temperature:.85})});
  }catch(error){throw new ProviderAttemptError(error instanceof Error?error.message:"provider connection failed",true)}
  if(!response.ok){const detail=(await response.text()).slice(0,300),retryable=[403,404,408,409,425,429].includes(response.status)||response.status>=500;throw new ProviderAttemptError(`provider ${response.status}: ${detail}`,retryable)}
  const data=await response.json() as ProviderPayload,text=extractProviderText(data);if(!text)throw new ProviderAttemptError("provider returned no text",false);
  if(!isVerifiedProviderModel(model,data.model,allowed))throw new ProviderAttemptError(isRouter?"free router returned an unverified model":"concrete model attempt returned an unapproved model",false);
  const reply=normalizeProviderReply(text,body);if(!reply)throw new ProviderAttemptError("provider returned an invalid reply",false);
  return{reply,modelUsed:data.model??null};
}

async function openRouter(body:RequestBody,apiKey:string,clientSignal:AbortSignal):Promise<ProviderResult>{
  const startedAt=Date.now(),deadline=startedAt+14_000;
  const cachedModels=modelCache?.models??[],knownAtStart=new Set([...FAST_FREE_MODELS,...cachedModels]);
  const preferred=body.preferredModelId&&knownAtStart.has(body.preferredModelId)&&modelAvailable(body.preferredModelId)?body.preferredModelId:null;
  const primary=preferred??FAST_FREE_MODELS.find(model=>modelAvailable(model))??null,attempts:string[]=[];
  let lastError:unknown=null;
  if(primary){
    attempts.push(primary);const remaining=deadline-Date.now();
    try{return await requestOpenRouter(body,apiKey,primary,knownAtStart,Math.min(7000,remaining),clientSignal)}catch(error){lastError=error;temporarilySideline(primary,error);if(clientSignal.aborted||error instanceof Error&&/free-models-per-min|limit_source/i.test(error.message))throw error}
  }
  const available=await freeModels(apiKey),allowed=new Set([...FAST_FREE_MODELS,...available]);
  const alternate=[...available,...FAST_FREE_MODELS].find(model=>!attempts.includes(model)&&modelAvailable(model));
  if(alternate){
    attempts.push(alternate);const remaining=deadline-Date.now();
    if(remaining>=1000)try{return await requestOpenRouter(body,apiKey,alternate,allowed,Math.min(7000,remaining),clientSignal)}catch(error){lastError=error;temporarilySideline(alternate,error);if(clientSignal.aborted)throw error}
  }
  throw lastError??new ProviderAttemptError("no responsive free companion model available",false);
}

async function boundedJson(request:Request):Promise<{value:unknown}|{error:"invalid"|"too_large"}>{
  const declared=request.headers.get("content-length");
  if(declared&&(!/^\d+$/.test(declared)||Number(declared)>MAX_REQUEST_BYTES))return{error:"too_large"};
  if(!request.body)return{error:"invalid"};
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(true){const{done,value}=await reader.read();if(done)break;if(!value)continue;size+=value.byteLength;if(size>MAX_REQUEST_BYTES){await reader.cancel();return{error:"too_large"}}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  try{return{value:JSON.parse(new TextDecoder().decode(bytes)) as unknown}}catch{return{error:"invalid"}}
}

export async function POST(request:Request){
  const requestStartedAt=Date.now();
  const parsed=await boundedJson(request);if("error" in parsed)return Response.json({error:parsed.error==="too_large"?"companion request too large":"invalid JSON"},{status:parsed.error==="too_large"?413:400});
  const body=parseCompanionRequest(parsed.value);if(!body)return Response.json({error:"invalid companion request"},{status:400});
  const fallback=()=>body.trigger.type==="initial_guidance"?acceptReply(deterministicReply(body.trigger,body.legalRoutes,body.environment,body.recommendationEvidence,body.companionArc.phase,body.objective,body.navigationBelief,body.sceneChanges[0])):{message:""};
  try{
    const provider=process.env.AI_PROVIDER||"openrouter",apiKey=process.env.OPENROUTER_API_KEY;
    if(provider!=="openrouter"||!apiKey)return Response.json({...fallback(),source:"fallback",modelUsed:null});
    const result=await openRouter(body,apiKey,request.signal);console.info("ARIADNE provider reply",{trigger:body.trigger.type,model:result.modelUsed,elapsedMs:Date.now()-requestStartedAt});return Response.json({...acceptReply(result.reply),source:"provider",modelUsed:result.modelUsed});
  }catch(error){console.error("ARIADNE free provider request failed",{trigger:body.trigger.type,elapsedMs:Date.now()-requestStartedAt,error});return Response.json({...fallback(),source:"fallback",modelUsed:null})}
}
