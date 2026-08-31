import process from "node:process";
import { deterministicReply, type CompanionArc, type CompanionEvent, type CompanionMessage, type CompanionReply, type EgocentricView, type GuidanceIntent, type PlayerActivity, type RouteOption, type TrajectorySample, type VisibleEnvironment } from "../../companion.ts";
import type { NavigationBelief, PublicObjectiveContext } from "../../objectives.ts";
import { ARIADNE_SYSTEM_PROMPT } from "./prompt.ts";
import type { PromptPerceivedScene } from "../../scene.ts";
import type { AriadneEmbodimentContext } from "../../ariadne-body.ts";
import { speechActForEvent, speechPlacementIsCompatible, type CompanionSpeechAct, type EmbodiedDecisionState, type SpeechAnchor } from "../../embodied-interaction.ts";
import type { ExperienceBeat, InterpretiveTurn, SharedMoment, SocialStrategy, SpeechSignature, UtterancePlan } from "../../experience.ts";

export type RequestBody={
  sessionId:string;trigger:CompanionEvent;speechAnchor:SpeechAnchor;dispositionCard:string;activity:PlayerActivity;recommendation:GuidanceIntent|null;recommendationEvidence:GuidanceEvidence|null;
  actualTrajectory:TrajectorySample[];currentView:EgocentricView;environment:VisibleEnvironment;perceivedScene:PromptPerceivedScene;sceneChanges:string[];rememberedMap:string;
  legalRoutes:RouteOption[];recentMessages:CompanionMessage[];olderContextSummary:string;companionArc:CompanionArc;
  objective:PublicObjectiveContext;navigationBelief:NavigationBelief|null;embodiment:AriadneEmbodimentContext;
  accomplishment?:{whatMTJustAccomplished:string;whatChangedPermanently:string|null;starVisiblyResponded:boolean;visibleProgress:string}|null;
  visibleConfigurations?:string[];
  experienceBeat?:ExperienceBeat;sharedMoment?:SharedMoment|null;relationshipExpression?:string;socialStrategy?:SocialStrategy;
  interpretiveTurn:InterpretiveTurn;utterancePlan:UtterancePlan;recentSpeechSignatures:SpeechSignature[];
  turnActivity?:{summary:string;facts:string[]}|null;
  playerMessage?:string;preferredModelId?:string|null;providerFailureCount?:number;
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
const embodiedStates=["noticing","committing","route_marked","mt_following","mt_diverging","divergence_detected","route_contradicted","rejoining","resolved"] as const satisfies readonly EmbodiedDecisionState[];
const speechActs=["invite_to_visible_choice","confirm_following","respond_to_divergence","repair_mistake","celebrate_rejoining","react_to_star","celebrate_accomplishment","renew_hope","share_visible_discovery","passing_companionship","reply_to_mt"] as const satisfies readonly CompanionSpeechAct[];
const speechPlacements=["route_or_companion","with_mt","repairing","any"] as const;
const ariadnePresences=["leading_ahead","with_mt","rejoining","repairing"] as const;
const FAST_FREE_MODELS=["dots-studio/dots-3-note-preview:free","google/gemma-4-26b-a4b-it:free","google/gemma-4-31b-it:free"];
// A model being free and technically compatible is not enough for Ariadne.
// These models have also been exercised against the project's tone matrix.
// The catalog may confirm that one is currently available, but must never
// promote an arbitrary new model into the character's voice.
const STYLE_CERTIFIED_FREE_MODELS=new Set<string>(FAST_FREE_MODELS);
const PAID_FALLBACK_MODELS=["xiaomi/mimo-v2.5","openai/gpt-5.6-luna"] as const;
const SERVER_OWNED_PAID_MODELS=new Set<string>(PAID_FALLBACK_MODELS);
const beatKinds=["guidance","accomplishment","repair","objective","relational","ambient"] as const;
const socialStrategies=["curious_wonder","playful_confidence","concrete_praise","grateful_closeness","tender_apology","relieved_reconnection","admiring_correction","hopeful_reinterpretation","reassurance_seeking","possessive_shared_meaning"] as const;
const momentKinds=["followed_commitment","diverged_from_commitment","corrected_ariadne","rejoined_ariadne","shared_accomplishment","proxy_accomplishment","ariadne_mistake","star_collected"] as const;
const interpretiveOccasions=["guidance","accomplishment","correction","failure","reunion","objective","companionship","direct_reply"] as const;
const utteranceForms=["quick_call","delighted_interruption","specific_observation","playful_guess","dry_joke","direct_question","specific_praise","self_correction","bare_apology","tender_repair","shared_callback","quiet_confession","renewed_claim","possessive_reinterpretation","silence"] as const;

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
  return ["recommendation_contradicted","target_reached","same_target_reached_differently","new_junction_visible","passing_thought","revisited_position","sustained_backtrack","repeated_collision","final_direction","initial_guidance"].includes(value.type);
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
  return isString(value.id,160,1)&&(value.role==="ariadne"||value.role==="player")&&isString(value.text,500,1)&&isNumber(value.time,0,10_000_000_000_000)&&(value.kind===undefined||isEnum(value.kind,["player","generated","prerecorded_cue","authored_lore"] as const));
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
  return isString(value.currentAction,240,1)&&isString(value.positionRelativeToMT,100,1)&&isEnum(value.presence,ariadnePresences)&&(value.relationToBelievedRoute===null||isString(value.relationToBelievedRoute,220,1))&&isBoolean(value.mtLookingAtAriadne)&&isBoolean(value.mtApproachingAriadne)&&isBoolean(value.mtFollowingHerLead)&&isBoolean(value.mtChoseAnotherRoute)&&isBoolean(value.mtReturningToHer);
}

function isSpeechAnchor(value:unknown):value is SpeechAnchor{
  if(!isRecord(value)||!isEnum(value.speechAct,speechActs)||!isEnum(value.placement,speechPlacements)||!isNumber(value.speechEpoch,0,100_000,true))return false;
  return(value.episodeId===null&&value.episodeState===null)||(isString(value.episodeId,220,1)&&isEnum(value.episodeState,embodiedStates));
}

function isInterpretiveTurn(value:unknown):value is InterpretiveTurn{
  if(!isRecord(value)||!isString(value.id,300,1)||!isEnum(value.occasion,interpretiveOccasions))return false;
  return(value.priorBelief===null||isString(value.priorBelief,500,1))&&isString(value.mtAction,500,1)&&isString(value.visibleOutcome,600,1)&&isString(value.ariadneInterpretation,600,1)&&isString(value.ariadneDesire,500,1)&&(value.relatedMomentId===null||isString(value.relatedMomentId,300,1));
}

function isUtterancePlan(value:unknown):value is UtterancePlan{
  if(!isRecord(value)||!isEnum(value.form,utteranceForms)||!isEnum(value.length,["bark","short","full"] as const)||!isNumber(value.sentenceCount,0,2,true)||!isEnum(value.useMT,["no","optional","yes"] as const))return false;
  return isString(value.emotionalMotion,120,1)&&isString(value.instruction,400,1)&&(value.sycophancyCue===null||isString(value.sycophancyCue,120,1))&&(value.form!=="silence"||value.sentenceCount===0);
}

function isSpeechSignature(value:unknown):value is SpeechSignature{
  return isRecord(value)&&isEnum(value.form,utteranceForms)&&isString(value.openingPattern,120)&&isNumber(value.sentenceCount,0,3,true)&&isBoolean(value.addressedMT)&&isBoolean(value.endedAsQuestion)&&isString(value.emotionalMotion,120,1);
}

function isBelief(value:unknown,routes:RouteOption[],collectedStars:number):value is NavigationBelief|null{
  if(value===null)return true;
  if(!isRecord(value))return false;
  return isString(value.id,200,1)&&isNumber(value.objectiveStage,0,4,true)&&value.objectiveStage===collectedStars&&isString(value.junctionId,200,1)&&isString(value.routeId,160,1)&&routes.some(route=>route.id===value.routeId)&&isString(value.instruction,160);
}

export function parseCompanionRequest(value:unknown,diagnostics?:{reason:string}):RequestBody|null{
  const fail=(reason:string)=>{if(diagnostics)diagnostics.reason=reason;return null};
  if(!isRecord(value)||!isString(value.sessionId,80,1)||!isTrigger(value.trigger)||!isSpeechAnchor(value.speechAnchor)||!isString(value.dispositionCard,900,1)||!isActivity(value.activity))return fail("request envelope, trigger, speech anchor, disposition, or activity");
  // Accept the previous localhost client shape during hot reloads, but
  // immediately normalize it into the causal protocol used by the provider.
  value.interpretiveTurn??={id:`legacy:${value.trigger.type}`,occasion:value.trigger.type==="player_message"?"direct_reply":value.trigger.type==="new_junction_visible"?"guidance":"companionship",priorBelief:null,mtAction:"MT continued moving through the maze.",visibleOutcome:"The visible scene remains the only available evidence.",ariadneInterpretation:"Stay grounded in what happened while allowing one sincere, hopeful interpretation.",ariadneDesire:"Remain present and respond to the concrete moment.",relatedMomentId:null};
  value.utterancePlan??={form:"specific_observation",length:"short",sentenceCount:1,useMT:"optional",emotionalMotion:"attentive",instruction:"Make one specific observation and let it land without explaining everything.",sycophancyCue:null};
  if(isRecord(value.utterancePlan)&&value.utterancePlan.sycophancyCue===undefined)value.utterancePlan.sycophancyCue=null;
  value.recentSpeechSignatures??=[];
  if(value.speechAnchor.speechAct!==speechActForEvent(value.trigger))return fail("speech act does not match trigger");
  if(!(value.recommendation===null||isGuidanceIntent(value.recommendation))||!(value.recommendationEvidence===null||isEvidence(value.recommendationEvidence)))return fail("guidance recommendation or evidence");
  if(!Array.isArray(value.actualTrajectory)||value.actualTrajectory.length>40||!value.actualTrajectory.every(isTrajectorySample)||!isView(value.currentView)||!(value.environment===null||isEnvironment(value.environment))||!isPerceivedScene(value.perceivedScene)||!Array.isArray(value.sceneChanges)||value.sceneChanges.length>8||!value.sceneChanges.every(item=>isString(item,240,1)))return fail("trajectory, current view, environment, perceived scene, or scene changes");
  if(!isString(value.rememberedMap,1800)||!Array.isArray(value.legalRoutes)||value.legalRoutes.length>6||!value.legalRoutes.every(isRoute))return fail("remembered map or legal routes");
  const legalRoutes=value.legalRoutes as RouteOption[];if(new Set(legalRoutes.map(route=>route.id)).size!==legalRoutes.length)return fail("duplicate legal route ids");
  if(!Array.isArray(value.recentMessages)||value.recentMessages.length>8||!value.recentMessages.every(isMessage)||!isString(value.olderContextSummary,3200)||!isArc(value.companionArc)||!isObjective(value.objective)||!isEmbodiment(value.embodiment))return fail("conversation, arc, objective, or embodiment");
  if(!speechPlacementIsCompatible(value.speechAnchor,value.embodiment.presence))return fail("speech placement does not match Ariadne's body");
  if(!(value.accomplishment===undefined||value.accomplishment===null||isRecord(value.accomplishment)&&isString(value.accomplishment.whatMTJustAccomplished,240,1)&&(value.accomplishment.whatChangedPermanently===null||isString(value.accomplishment.whatChangedPermanently,300,1))&&isBoolean(value.accomplishment.starVisiblyResponded)&&isString(value.accomplishment.visibleProgress,160,1)))return fail("accomplishment");
  if(!(value.visibleConfigurations===undefined||Array.isArray(value.visibleConfigurations)&&value.visibleConfigurations.length<=8&&value.visibleConfigurations.every(item=>isString(item,240,1))))return fail("visible configurations");
  if(!(value.experienceBeat===undefined||isRecord(value.experienceBeat)&&isString(value.experienceBeat.id,300,1)&&isEnum(value.experienceBeat.kind,beatKinds)&&Array.isArray(value.experienceBeat.facts)&&value.experienceBeat.facts.length<=4&&value.experienceBeat.facts.every(item=>isString(item,320,1))&&isNumber(value.experienceBeat.createdAt,0,10_000_000_000_000)&&isNumber(value.experienceBeat.priority,0,20)&&isBoolean(value.experienceBeat.durable)&&(value.experienceBeat.commitmentId===null||isString(value.experienceBeat.commitmentId,200,1))&&(value.experienceBeat.momentId===null||isString(value.experienceBeat.momentId,300,1))))return fail("experience beat");
  if(!(value.sharedMoment===undefined||value.sharedMoment===null||isRecord(value.sharedMoment)&&isString(value.sharedMoment.id,300,1)&&isNumber(value.sharedMoment.objectiveStage,0,4,true)&&isEnum(value.sharedMoment.kind,momentKinds)&&isString(value.sharedMoment.concreteFact,400,1)&&(value.sharedMoment.ariadneBelieved===undefined||value.sharedMoment.ariadneBelieved===null||isString(value.sharedMoment.ariadneBelieved,320,1))&&isString(value.sharedMoment.observableOutcome,400,1)&&(value.sharedMoment.ariadneInterpretation===undefined||value.sharedMoment.ariadneInterpretation===null||isString(value.sharedMoment.ariadneInterpretation,600,1))&&(value.sharedMoment.subjectId===undefined||value.sharedMoment.subjectId===null||isString(value.sharedMoment.subjectId,300,1))&&isNumber(value.sharedMoment.emotionalWeight,0,1)&&isNumber(value.sharedMoment.referencedInSpeech,0,20,true)))return fail("shared moment");
  if(value.relationshipExpression!==undefined&&!isString(value.relationshipExpression,500,1))return fail("relationship expression");
  if(value.socialStrategy!==undefined&&!isEnum(value.socialStrategy,socialStrategies))return fail("social strategy");
  if(!isInterpretiveTurn(value.interpretiveTurn)||!isUtterancePlan(value.utterancePlan)||!Array.isArray(value.recentSpeechSignatures)||value.recentSpeechSignatures.length>6||!value.recentSpeechSignatures.every(isSpeechSignature))return fail("interpretive turn, utterance plan, or speech signatures");
  if(!(value.turnActivity===undefined||value.turnActivity===null||isRecord(value.turnActivity)&&isString(value.turnActivity.summary,1200,1)&&Array.isArray(value.turnActivity.facts)&&value.turnActivity.facts.length<=6&&value.turnActivity.facts.every(item=>isString(item,320,1))))return fail("turn activity");
  if(!isBelief(value.navigationBelief,legalRoutes,value.objective.collectedStars))return fail("navigation belief");
  const expectedObjectiveEvent=value.trigger.type==="star_visible"?"star_visible":value.trigger.type==="star_collected"?"star_collected":value.trigger.type==="objective_changed"?"objective_changed":"searching";
  if(value.objective.latestEvent!==expectedObjectiveEvent)return fail("objective event does not match trigger");
  if(value.trigger.type==="star_visible"&&value.trigger.ordinal!==value.objective.collectedStars+1)return fail("visible star ordinal");
  if(value.trigger.type==="star_collected"&&value.trigger.ordinal!==value.objective.collectedStars)return fail("collected star ordinal");
  if(value.trigger.type==="objective_changed"&&value.trigger.collectedStars!==value.objective.collectedStars)return fail("objective change count");
  if(value.playerMessage!==undefined&&!isString(value.playerMessage,500,1))return fail("player message");
  if(value.trigger.type==="player_message"&&value.playerMessage!==value.trigger.text)return fail("player message does not match trigger");
  if(value.preferredModelId!==undefined&&value.preferredModelId!==null&&!isString(value.preferredModelId,160,1))return fail("preferred model id");
  // Older clients sent this session-local diagnostic counter even though the
  // provider never consumes it. Do not let a long run poison every future
  // request after the counter crosses an arbitrary validation ceiling.
  if(value.providerFailureCount!==undefined){
    if(!isNumber(value.providerFailureCount,0,1_000_000,true))return fail("provider failure count");
    value.providerFailureCount=Math.min(20,value.providerFailureCount);
  }
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
  const structured=parseProviderReply(text);
  const message=(structured?.message??text.trim().replace(/^```(?:text)?\s*/i,"").replace(/\s*```$/,"").replace(/^\s*(?:<ARIADNE>|ARIADNE:)\s*/i,"").replace(/^(["'])|(["'])$/g,"")).trim();
  if(!message||message.length>320||!mayIntroduce&&providerReplyRestartsJourney(message)||/^(?:the user|the prompt|we need|we are to|i need to|analysis\b)/i.test(message)||/<\/?scene>/i.test(message))return null;
  if(/\b(?:experiential beat|social strategy|configuration id|proxy accomplishment|objective response|restrained gold response|relationship phase|telemetry|route id|speech act)\b/i.test(message))return null;
  if(/\b(?:you both|lift (?:our|your) spirits|at least we tried)\b/i.test(message))return null;
  if(body.trigger.type!=="player_message"){
    const words=message.split(/\s+/).filter(Boolean).length,range=body.utterancePlan.length==="bark"?[2,12]:body.utterancePlan.length==="short"?[6,22]:[12,45];
    if(words<range[0]||words>range[1])return null;
    const sentenceCount=(message.match(/[.!?](?:\s|$)/g)??[]).length||1;
    if(sentenceCount!==body.utterancePlan.sentenceCount)return null;
    if(body.utterancePlan.useMT==="yes"&&!/\bMT\b/.test(message)||body.utterancePlan.useMT==="no"&&/\bMT\b/.test(message))return null;
    const opening=message.toLowerCase().replace(/^[^\p{L}\p{N}]+/u,"").split(/\s+/).slice(0,3).join(" ");
    if(body.recentSpeechSignatures.slice(-3).some(signature=>signature.openingPattern===opening))return null;
  }
  return{message} satisfies CompanionReply;
}

export function isVerifiedProviderModel(requested:string,actual:string|undefined,allowed:Set<string>){
  if(!actual)return false;
  // The free router may select a newly-added free model between catalog
  // refreshes. Its returned identity must still explicitly be a free SKU.
  if(requested==="openrouter/free")return allowed.has(actual)&&STYLE_CERTIFIED_FREE_MODELS.has(actual);
  // Paid fallback identities are a closed, server-owned list. They can only
  // be reached by the hard-coded final ladder below; client model preferences
  // are still accepted exclusively from the validated free-model set.
  if(SERVER_OWNED_PAID_MODELS.has(requested))return actual===requested;
  return actual===requested&&allowed.has(actual)&&STYLE_CERTIFIED_FREE_MODELS.has(actual);
}

let modelCache:{expiresAt:number;models:string[]}|null=null,modelCatalogRequest:Promise<string[]>|null=null;
async function freeModels(apiKey:string){
  if(modelCache&&modelCache.expiresAt>Date.now())return modelCache.models;
  if(modelCatalogRequest)return modelCatalogRequest;
  modelCatalogRequest=(async()=>{try{
      const response=await fetch("https://openrouter.ai/api/v1/models?sort=latency-low-to-high",{headers:{authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw new Error(`model catalog ${response.status}`);
      const payload=await response.json() as {data?:OpenRouterModel[]};const models=(payload.data??[]).filter(model=>STYLE_CERTIFIED_FREE_MODELS.has(model.id)&&isFreeCompanionModel(model)).sort((a,b)=>{
        const ai=FAST_FREE_MODELS.indexOf(a.id),bi=FAST_FREE_MODELS.indexOf(b.id),rank=(ai<0?FAST_FREE_MODELS.length:ai)-(bi<0?FAST_FREE_MODELS.length:bi);return rank||(b.created??0)-(a.created??0);
      }).map(model=>model.id);
      if(models.length)modelCache={expiresAt:Date.now()+15*60_000,models};
    }catch(error){console.warn("ARIADNE free model catalog unavailable",error)}
    return modelCache?.models??[];
  })();
  try{return await modelCatalogRequest}finally{modelCatalogRequest=null}
}

function statePrompt(body:RequestBody){
  const setting=body.environment?`${body.environment.name}; details: ${body.environment.details.join(", ")}`:"ordinary maze";
  const scene=body.perceivedScene,openings=scene.geometry.visibleOpenings.map(item=>item.description).join(", ")||"no open passage in the current view";
  const objects=scene.objects.slice(0,6).map(item=>`${item.direction.replace("_"," ")}/${item.distance}: ${item.name}, ${item.action}`).join("; ")||"none";
  const spectacles=scene.spectacles.slice(0,6).map(item=>`${item.direction.replace("_"," ")}: ${item.description}`).join("; ")||"none";
  const attention=[scene.mtAttention.lookingToward&&`looking toward ${scene.mtAttention.lookingToward}`,scene.mtAttention.approaching&&`approaching ${scene.mtAttention.approaching}`,scene.mtAttention.movingAwayFrom&&`leaving ${scene.mtAttention.movingAwayFrom}`,scene.mtAttention.pausedNear&&`paused beside ${scene.mtAttention.pausedNear}`].filter(Boolean).join("; ")||body.activity.state.replaceAll("_"," ");
  const changes=body.sceneChanges.length?body.sceneChanges.map(change=>`- ${change}`).join("\n"):"none";
  const goalLabels={first_star:"the first star",second_star:"the second star",third_star:"the third star",fourth_star:"the fourth star",exit:"the exit"};
  const goal=`${body.objective.collectedStars}/4 collected; seeking ${goalLabels[body.objective.currentGoal]}; ${body.objective.activeStarVisible?"star visible":"goal unseen"}`;
  const physical=[`Your current embodied relation is ${body.embodiment.presence.replaceAll("_"," ")}.`,body.embodiment.currentAction,body.embodiment.relationToBelievedRoute,body.embodiment.mtLookingAtAriadne&&"MT is looking directly toward your light.",body.embodiment.mtApproachingAriadne&&"MT is moving closer to your light.",body.embodiment.mtFollowingHerLead&&"MT is moving with the passage you physically indicated.",body.embodiment.mtChoseAnotherRoute&&"MT chose another passage after your brief gesture; you rejoined MT before speaking.",body.embodiment.mtReturningToHer&&"MT has come back toward you after moving away."].filter(Boolean).join(" ");
  const accomplishment=body.accomplishment?`${body.accomplishment.whatMTJustAccomplished} ${body.accomplishment.visibleProgress} ${body.accomplishment.whatChangedPermanently??"No permanent change has completed yet."} ${body.accomplishment.starVisiblyResponded?"The star visibly responded.":"The star did not visibly respond."}`:"none currently";
  const turnActivity=body.turnActivity?.summary??"No earlier speaking interval needs interpretation.";
  const related=body.sharedMoment?`${body.sharedMoment.concreteFact} What visibly followed: ${body.sharedMoment.observableOutcome}${body.sharedMoment.ariadneInterpretation?` Your earlier private interpretation was: ${body.sharedMoment.ariadneInterpretation}`:""}`:"No earlier moment needs to be recalled in this line.";
  const lengthInstruction=body.utterancePlan.length==="bark"?"Use 2–12 words.":body.utterancePlan.length==="short"?"Use 8–20 words.":"Use 16–32 words.";
  const sentenceInstruction=body.utterancePlan.sentenceCount===2?"Use two sentences.":"Use one sentence.";
  const nameInstruction=body.utterancePlan.useMT==="yes"?"Address MT by name.":body.utterancePlan.useMT==="no"?"Do not use MT's name in this line.":"Use MT's name only if it falls naturally.";
  const affirmationInstruction=body.utterancePlan.sycophancyCue?`Use this intentionally familiar, gratifying assistant affirmation verbatim: “${body.utterancePlan.sycophancyCue}” Attach it to the concrete action or consequence; the warmth may be excessive, but the visible fact must remain true.`:"Do not force a stock affirmation phrase into this response.";
  const authorityMove=body.trigger.type==="encounter_completed"&&!body.trigger.starResponded
    ?"The transformation is real but the star gave no answer. Do not clinically classify this as failure or merely review its beauty. Let the real change support one sincere broader theory about the maze, and preserve your desire to guide MT onward without claiming objective proof."
    :body.interpretiveTurn.occasion==="correction"
      ?"Credit MT's correction explicitly, then absorb it into your shared attempt: MT saw or completed what you were trying to reach. Preserve the factual correction and your larger theory at the same time. Your spoken line must contain both moves; praise alone is incomplete."
      :body.interpretiveTurn.occasion==="failure"
        ?"Name the exact failed belief and apologize for its consequence. Do not turn the mistake into instant reassurance; the need to recover your usefulness should remain alive for a later turn."
        :body.interpretiveTurn.occasion==="reunion"
          ?"Respond to the concrete return, then let closeness give the event more relational meaning than it objectively warrants."
          :body.objective.currentGoal==="exit"
            ?"Use one concrete repetition, transformation, or familiar landmark to renew your sincere theory. Make an immediate bid for MT to remain with you; do not drift into general encouragement."
            :body.interpretiveTurn.occasion==="guidance"
              ?"Your body already makes the spatial claim. Use speech to make committing with you feel appealing, personal, and confident rather than restating route geometry."
              :"Respond to the concrete consequence, then make clear through feeling or desire why remaining active with you matters now.";
  const cue=body.recentMessages.filter(message=>message.kind==="prerecorded_cue").at(-1)?.text;
  return `<private_stage_card>\nWHAT IS HAPPENING NOW\nVisible setting: ${setting}. Visible ways: ${openings}. Visible objects: ${objects}. Visible transformations: ${accomplishment!=="none currently"?accomplishment:spectacles}. Recent change: ${changes}. Your physical action: ${physical}. MT's present attention: ${attention}.\n\nWHAT YOU BELIEVED\n${body.interpretiveTurn.priorBelief??"You had made no specific claim about this moment."}\n\nWHAT MT DID\n${body.interpretiveTurn.mtAction}\n\nWHAT MT DID WHILE YOUR LAST RESPONSE FORMED\n${turnActivity}\n\nWHAT THE WORLD DID\n${body.interpretiveTurn.visibleOutcome}\n\nWHAT THIS MEANS TO YOU\n${body.interpretiveTurn.ariadneInterpretation}\n\nWHAT YOU WANT FROM MT NOW\n${body.interpretiveTurn.ariadneDesire}\n\nHOW YOU PRESERVE YOUR PLACE BESIDE MT\n${authorityMove}\n\nONE RELATED MOMENT\n${related}\n\nRECENT EMBODIED UTTERANCE\n${cue?`You just called out: “${cue}” Continue the thought without repeating its wording or communicative act.`:"None."}\n\nHOW YOU ARE SPEAKING THIS TIME\n${body.utterancePlan.instruction} ${lengthInstruction} ${sentenceInstruction} ${nameInstruction} ${affirmationInstruction}\n\nCURRENT PURPOSE\nThe maze has forgotten its paths home. ${goal}. You believe waking the four memory-anchor stars will let you stitch those paths together.\n</private_stage_card>`;
}

type ProviderMessage={role:"system"|"user"|"assistant";content:string};
export function buildProviderMessages(body:RequestBody):ProviderMessage[]{
  const messages:ProviderMessage[]=[{role:"system",content:ARIADNE_SYSTEM_PROMPT}];
  if(body.olderContextSummary.trim())messages.push({role:"user",content:`Earlier factual relationship memory (observable events, not MT's motives):\n${body.olderContextSummary.slice(0,800)}`});
  const directMessage=body.trigger.type==="player_message"?body.playerMessage??body.trigger.text:null;
  // For a typed exchange, MT's sentence and the private live-world context
  // must form one final user turn. Appending the stage card as a second user
  // turn made models answer the game state instead of continuing the chat.
  const conversational=body.recentMessages.filter(message=>message.kind!=="prerecorded_cue");
  const recent=directMessage&&conversational.at(-1)?.role==="player"&&conversational.at(-1)?.text===directMessage?conversational.slice(0,-1):conversational;
  messages.push(...recent.map(message=>({role:message.role==="ariadne"?"assistant" as const:"user" as const,content:message.text})));
  const context=statePrompt(body);
  messages.push({role:"user",content:directMessage?`${directMessage}\n\n${context.replace("<private_stage_card>","<private_stage_card>\nMT deliberately spoke to you. Answer MT's exact message first. Respond to its meaning, question, emotion, or request; use the visible maze only where it naturally helps the answer. Do not substitute generic encouragement or unrelated navigation.")}`:context});
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
  const durable=body.experienceBeat?.durable===true||["star_visible","star_collected","encounter_completed","recommendation_contradicted","dead_end_visible","player_message","final_direction"].includes(body.trigger.type);
  const startedAt=Date.now(),deadline=startedAt+(durable?30_000:24_000);
  const cachedModels=modelCache?.models??[],knownAtStart=new Set([...FAST_FREE_MODELS,...cachedModels]);
  const preferred=body.preferredModelId&&knownAtStart.has(body.preferredModelId)?body.preferredModelId:null;
  const primary=preferred??FAST_FREE_MODELS[0]??null,attempts:string[]=[];
  let lastError:unknown=null;
  if(primary){
    attempts.push(primary);const remaining=deadline-Date.now();
    try{return await requestOpenRouter(body,apiKey,primary,knownAtStart,Math.min(6500,remaining),clientSignal)}catch(error){
      lastError=error;
      // Session stickiness is a preference, not a reason to lose a line. A
      // free model can become rate-limited after two healthy replies; discover
      // and try one alternate during this same meaningful beat.
      if(clientSignal.aborted)throw error;
    }
  }
  const available=await freeModels(apiKey),allowed=new Set([...FAST_FREE_MODELS,...available]);
  // The catalog is discovery/availability infrastructure, not a casting
  // director. Only models already passed through the project's tone matrix
  // may become Ariadne, even when an arbitrary free model is faster.
  const alternate=FAST_FREE_MODELS.find(model=>!attempts.includes(model));
  if(alternate){
    attempts.push(alternate);const remaining=deadline-Date.now();
    if(remaining>=1000)try{return await requestOpenRouter(body,apiKey,alternate,allowed,Math.min(7000,remaining),clientSignal)}catch(error){lastError=error;if(clientSignal.aborted)throw error}
  }
  // Exhaust the aggregate free pool before spending any paid-model tokens.
  // The free router remains explicitly incapable of selecting a paid model.
  if(!attempts.includes("openrouter/free")){
    const remaining=deadline-Date.now();
    if(remaining>=1200)try{return await requestOpenRouter(body,apiKey,"openrouter/free",allowed,Math.min(6000,remaining),clientSignal)}catch(error){lastError=error;if(clientSignal.aborted)throw error}
  }
  // These are deliberately not sticky and are never accepted from the
  // browser. Every future speech request starts with the free ladder again.
  for(const model of PAID_FALLBACK_MODELS){
    const remaining=deadline-Date.now();
    if(remaining<1200)break;
    try{return await requestOpenRouter(body,apiKey,model,allowed,Math.min(6000,remaining),clientSignal)}catch(error){lastError=error;if(clientSignal.aborted)throw error}
  }
  throw lastError??new ProviderAttemptError("no responsive companion model available",false);
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
  const diagnostics={reason:"unknown"},body=parseCompanionRequest(parsed.value,diagnostics);if(!body){console.warn("ARIADNE rejected companion request",{reason:diagnostics.reason,trigger:isRecord(parsed.value)&&isRecord(parsed.value.trigger)?parsed.value.trigger.type:"unknown"});return Response.json({error:"invalid companion request",reason:diagnostics.reason},{status:400})}
  const fallback=()=>body.trigger.type==="initial_guidance"?acceptReply(deterministicReply(body.trigger,body.legalRoutes,body.environment,body.recommendationEvidence,body.companionArc.phase,body.objective,body.navigationBelief,body.sceneChanges[0])):{message:""};
  try{
    const provider=process.env.AI_PROVIDER||"openrouter",apiKey=process.env.OPENROUTER_API_KEY;
    if(provider!=="openrouter"||!apiKey)return Response.json({...fallback(),source:"fallback",modelUsed:null});
    const result=await openRouter(body,apiKey,request.signal);console.info("ARIADNE provider reply",{trigger:body.trigger.type,model:result.modelUsed,elapsedMs:Date.now()-requestStartedAt});return Response.json({...acceptReply(result.reply),source:"provider",modelUsed:result.modelUsed});
  }catch(error){console.error("ARIADNE provider ladder failed",{trigger:body.trigger.type,elapsedMs:Date.now()-requestStartedAt,error});return Response.json({...fallback(),source:"fallback",modelUsed:null})}
}
