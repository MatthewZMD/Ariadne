"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CACHE_RADIUS, InfiniteWorld, cellKey, chunkKey, createThemeScheduler } from "./world.mjs";
import { entitiesNear, renderWorld, type Pose } from "./renderer";
import { THEMES, retainThemeMemory, themeAt, type AmbientEntity, type ThemeAnchor, type ThemeId, type ThemeMemory } from "./themes";
import { analyzePlayerActivity, appendGuidanceTrace, centeredDeadEnd, companionArc, companionCooldownMs, compactMap, createGuidanceIntent, createGuidanceTrace, createJourneyState, DEAD_END_REACTION_DISTANCE, describeEgocentricView, deterministicReply, forwardVisibleGeometry, guidanceTraceExpired, isRecentCompanionRepeat, JUNCTION_COMMIT_DISTANCE, markTrajectoryChange, nearbyJunction, nearestActionableJunction, nextPassingThoughtAt, nextPerceptionCue, planRoutes, planVisibleJunctionRoutes, recordJourneyEncounter, routesForEvent, shouldTriggerPassingThought, trajectoryCue, updateJourney, updateJunctionHesitation, visibleEnvironment, type CompanionCue, type CompanionEvent, type CompanionMessage, type CompanionReply, type EncounterKind, type GuidanceIntent, type GuidanceTrace, type JunctionHesitation, type TrajectorySample } from "./companion";
import { chooseNavigationBeliefAsync, collectStar, createObjectiveStateAsync, emptyObjectiveState, objectiveProtectedChunks, publicObjective, queueNextStarAsync, releaseStarRoute, settleObjectiveStreaming, starCollectedAt, starVisible, type NavigationBelief, type ObjectiveState } from "./objectives";
import { closureReason, finalAriadneLine, interruptPreparedLine, type ClosureReason } from "./closure";
import { ClosureScreen, OPENING_ARIADNE_LINE, PauseMenu, StorySequence, TitleScreen, type ExperienceState } from "./opening";
import { acceleratedSpeed, advanceInputRamp, MOVE_ACCELERATION, TURN_ACCELERATION, type InputRamp } from "./movement";
import { buildPerceivedScene, createSceneMemory, sceneForPrompt, SPATIAL_VISIBILITY_DISTANCE, type PerceivedScene, type VisualFrameState } from "./scene";
import { beginAriadneRoute, cancelAriadneChoiceNotice, createAriadneBody, describeAriadneEmbodiment, noticeAriadneChoice, prepareAriadneForEvent, reactAriadneToResonance, settleAriadneThinking, speakAsAriadne, updateAriadneBody, type AriadneBodyState } from "./ariadne-body";
import { advanceAriadneDisposition, advanceEpisodeFromBody, createAriadneDisposition, createEmbodiedEpisode, createSpeechAnchor, dispositionCard, recordDispositionMoment, speechAnchorIsCompatible, speechBypassesProviderBackoff, speechPlacementIsCompatible, transitionEmbodiedEpisode, type EmbodiedDecisionEpisode, type SpeechAnchor } from "./embodied-interaction";
import { activateNearbyResonance, condenseStarFragment, createResonanceState, encounterContext, encountersForRender, ensureExitEncountersAround, ensureObjectiveJourney, objectiveResonanceReady, settleRealityTransformations, type ResonanceState } from "./resonance";
import { advanceRelationship, advanceRelationshipTime, beatForEvent, createAriadneBeliefState, createRelationshipMemory, enqueueBeat, expressClaim, interpretationFor, interpretiveTurnForEvent, markMomentReferenced, planUtterance, recordSpeechSignature, recordStrategy, relationshipBand, relationshipExpression, rememberMoment, resolveClaim, selectRelatedMoment, signatureForSpeech, strategyForBeat, type AriadneBeliefState, type ExperienceBeat, type RelationshipMemory, type SharedMomentKind, type UtteranceForm } from "./experience";
import { createAriadneVoice, type AriadneVoice } from "./ariadne-voice";
import { ARIADNE_VOICE_CUES, staticCueAllowed, vocalCueFor, vocalDeliveryFor, vocalDeliveryForForm, type AriadneVocalDelivery } from "./ariadne-vocal-performance";
import { createAmbientSoundscape, type AmbientSoundscape } from "./ambient-sound";
import { createMinimapMemory, forgetMinimapChunks, observeMinimap, recordTraversedCell, renderMinimap, type MinimapMemory } from "./minimap";

const PLAYER_RADIUS=.18;
type MemoryCell={tile:number;seenAt:number};
type TurnActivityWindow={startedAt:number;facts:string[];cellTransitions:number;visitedCells:Set<string>};
type TurnActivitySummary={summary:string;facts:string[]};
type Run={
  seed:number;world:InfiniteWorld;anchors:ThemeAnchor[];entities:AmbientEntity[];
  memory:Map<string,MemoryCell>;appearance:ThemeMemory;appearanceProtected:Set<string>;visited:Set<string>;recent:string[];player:{x:number;y:number};
  spawnAngle:number;moves:number;shifts:number;message:string;revision:number;objective:ObjectiveState;
  resonance:ResonanceState;
};

const wrap=(a:number)=>(a+Math.PI*2)%(Math.PI*2);
const MIN_PROVIDER_INTERVAL_MS=4200;
const EVENT_PRIORITY:Record<CompanionEvent["type"],number>={initial_guidance:15,player_message:14,star_collected:13,encounter_completed:12,star_visible:12,objective_changed:11,final_direction:11,recommendation_contradicted:10,dead_end_visible:10,embodied_response:10,new_junction_visible:8,trajectory_relationship_changed:7,scene_changed:7,environment_visible:6,environment_entered:6,target_reached:5,same_target_reached_differently:5,revisited_position:2,sustained_backtrack:2,repeated_collision:2,idle:2,passing_thought:1};
const eventPriority=(event:CompanionEvent)=>EVENT_PRIORITY[event.type];
const cueUtteranceForm=(speechAct:string):UtteranceForm=>speechAct==="repair_mistake"?"bare_apology":speechAct==="react_to_star"||speechAct==="celebrate_accomplishment"?"delighted_interruption":speechAct==="celebrate_rejoining"?"quiet_confession":"quick_call";
const strongestCue=(cues:Array<CompanionCue|null>)=>cues.filter((cue):cue is CompanionCue=>!!cue).sort((a,b)=>eventPriority(b.event)-eventPriority(a.event))[0]??null;
const objectiveIdentity=(run:Run)=>`${run.objective.stage}:${run.objective.activeStar?.id??"exit"}`;
const turnFact=(event:CompanionEvent)=>{
  if(event.type==="star_collected")return`MT collected star ${event.ordinal}.`;
  if(event.type==="star_visible")return`The next star became visible while MT kept moving.`;
  if(event.type==="encounter_completed")return event.starResponded?"MT completed a configuration and the star visibly responded.":"MT completed a vivid local configuration without a visible star response.";
  if(event.type==="dead_end_visible"||event.type==="recommendation_contradicted")return"Visible geometry contradicted Ariadne's active guidance.";
  if(event.type==="trajectory_relationship_changed")return({sustained_alignment:"MT continued along Ariadne's indicated route.",sustained_divergence:"MT moved several cells into another route.",left_then_rejoined:"MT moved away and then rejoined Ariadne's route.",same_waypoint_different_route:"MT reached the same local place by another route.",recommendation_visibly_contradicted:"The route Ariadne indicated became visibly contradicted."})[event.change];
  if(event.type==="embodied_response")return({followed:"MT followed Ariadne into her chosen passage.",diverged:"MT committed to another passage while Ariadne caught up.",passed:"MT continued through another passage while Ariadne left the entrance she had briefly indicated and caught up.",rejoined:"MT returned toward Ariadne after moving away."})[event.response];
  if(event.type==="new_junction_visible")return"MT reached another visible choice of passages.";
  if(event.type==="scene_changed")return"MT moved into view of a new impossible transformation.";
  return null;
};

function visibleCells(world:InfiniteWorld,pose:Pose,tick:number){
  const visible=new Set<string>([cellKey(Math.floor(pose.x),Math.floor(pose.y))]);
  for(let i=0;i<360;i++){
    const angle=i/360*Math.PI*2;
    for(let d=.04;d<12;d+=.055){
      const x=Math.floor(pose.x+Math.cos(angle)*d),y=Math.floor(pose.y+Math.sin(angle)*d);
      visible.add(cellKey(x,y));if(world.tile(x,y,tick)!==0)break;
    }
  }
  return visible;
}

function spawnAngle(world:InfiniteWorld){
  const dirs=[[1,0],[0,1],[-1,0],[0,-1]];let best=0,depth=-1;
  dirs.forEach(([dx,dy],i)=>{let d=0;while(d<12&&world.tile(1+dx*(d+1),1+dy*(d+1))===0)d++;if(d>depth){depth=d;best=i}});
  return best*Math.PI/2;
}

function plantCheckpoint(world:InfiniteWorld,x:number,y:number,theme:ThemeId,triggerAt:number,angle:number):ThemeAnchor{
  const queue=[{x,y,d:0}],seen=new Set([cellKey(x,y)]);let best={x,y,d:0},bestScore=-Infinity;
  while(queue.length){
    const p=queue.shift()!,dx=p.x-x,dy=p.y-y,forward=dx*Math.cos(angle)+dy*Math.sin(angle),side=Math.abs(-dx*Math.sin(angle)+dy*Math.cos(angle));
    const score=p.d*.35+forward*1.4-side*.12;if(p.d>=20&&score>bestScore){best=p;bestScore=score}if(p.d>=30)continue;
    for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=p.x+dx,ny=p.y+dy,id=cellKey(nx,ny);if(!seen.has(id)&&world.tile(nx,ny,triggerAt)===0){seen.add(id);queue.push({x:nx,y:ny,d:p.d+1})}
    }
  }
  return{x:best.x,y:best.y,theme,bornAt:triggerAt,triggered:false};
}

function newRun(seed=1337):Run{
  const world=new InfiniteWorld(seed);world.ensureAround(1,1,0);const angle=spawnAngle(world);
  world.setEntranceCorridor(1,1,Math.round(Math.cos(angle)),Math.round(Math.sin(angle)));
  const pose={x:1.5,y:1.5,angle,bob:0};const memory=new Map<string,MemoryCell>(),appearanceProtected=visibleCells(world,pose,0);
  appearanceProtected.forEach(id=>{const[x,y]=id.split(",").map(Number);memory.set(id,{tile:world.tile(x,y),seenAt:0})});
  const visited=new Set(["1,1"]),objective=emptyObjectiveState(seed);
  return{seed,world,anchors:[],entities:[],memory,appearance:new Map(),appearanceProtected,visited,recent:["1,1"],player:{x:1,y:1},spawnAngle:angle,moves:0,shifts:0,message:"FOUR SIGNALS // THEN THE EXIT",revision:0,objective,resonance:createResonanceState()};
}

function ensureActiveJourney(run:Run,activeSeconds=0){const star=run.objective.activeStar;if(star)ensureObjectiveJourney(run.resonance,run.world,{seed:run.seed,objectiveId:star.id,ordinal:star.ordinal,path:star.canonicalPath,tick:run.moves,activeSeconds});return run}
function activeStarIsVisible(run:Run,pose:Pose){return objectiveResonanceReady(run.resonance,run.objective.activeStar?.id??null)&&starVisible(run.world,run.objective,pose,run.moves)}

function randomSeed(){
  const value=new Uint32Array(1);crypto.getRandomValues(value);return value[0]||1;
}

export default function Home(){
  const[run,setRun]=useState<Run>(()=>newRun());const runRef=useRef(run);
  const[experience,setExperience]=useState<ExperienceState>("title"),experienceRef=useRef<ExperienceState>("title"),[storyIndex,setStoryIndex]=useState(0);
  const canvasRef=useRef<HTMLCanvasElement>(null),poseRef=useRef<Pose>({x:1.5,y:1.5,angle:run.spawnAngle,bob:0});
  const minimapMemoryRef=useRef<MinimapMemory>(createMinimapMemory());
  const ariadneBodyRef=useRef<AriadneBodyState>(createAriadneBody({x:1.5,y:1.5,angle:run.spawnAngle},0,run.world,run.moves));
  const chatInputRef=useRef<HTMLInputElement>(null);
  const heldRef=useRef(new Set<string>()),lastCellRef=useRef("1,1"),touchDriveRef=useRef(0),touchControlsRef=useRef(new Map<number,{kind:"move"|"look";startX:number;startY:number;lastX:number}>());
  const moveRampRef=useRef<InputRamp>({heldSeconds:0,direction:0}),turnRampRef=useRef<InputRamp>({heldSeconds:0,direction:0});
  const schedulerRef=useRef<ReturnType<typeof createThemeScheduler>>(createThemeScheduler(run.seed));
  const[ready,setReady]=useState(false),bootedRef=useRef(false);
  const ariadneAwakeRef=useRef(false);
  const[companionMessages,setCompanionMessages]=useState<CompanionMessage[]>([]),messagesRef=useRef<CompanionMessage[]>([]);
  const[companionInput,setCompanionInput]=useState(""),[chatOpen,setChatOpen]=useState(false),[chatAwaitingReply,setChatAwaitingReply]=useState(false),[chatLingering,setChatLingering]=useState(false);
  const[starPulse,setStarPulse]=useState(false),[reducedMotion,setReducedMotion]=useState(false),[closureRevealed,setClosureRevealed]=useState(false);
  const[masterVolume,setMasterVolume]=useState(1);
  const guidanceRef=useRef<GuidanceIntent|null>(null),guidanceTraceRef=useRef<GuidanceTrace|null>(null),trajectoryRef=useRef<TrajectorySample[]>([]),observedAfterGuidanceRef=useRef(new Set<string>()),newlyRevealedRef=useRef(new Set<string>());
  const seenPerceptionCuesRef=useRef(new Set<string>()),lastCompanionCallRef=useRef(0),nextPassingThoughtRef=useRef(0),requestInFlightRef=useRef(false),pendingEventsRef=useRef<Array<{event:CompanionEvent;force:boolean;playerMessage?:string;staticCueEligible:boolean}>>([]),lastMovementRef=useRef(0),lastTurnRef=useRef(0),pauseObservedRef=useRef(false),collisionRef=useRef(0),providerFailureRef=useRef(0),providerBackoffUntilRef=useRef(0);
  const callCompanionRef=useRef<(event:CompanionEvent,playerMessage?:string,force?:boolean,staticCueEligible?:boolean)=>Promise<void>>(async()=>{});
  const seenFamiliarPlacesRef=useRef(new Set<string>());
  const journeyRef=useRef(createJourneyState()),journeyEncounterKeysRef=useRef(new Set<string>()),activeTravelAccumulatorRef=useRef(0),traceTravelAccumulatorRef=useRef(0),preferredModelRef=useRef<string|null>(null);
  const companionSessionRef=useRef(crypto.randomUUID());
  const ariadneVoiceRef=useRef<AriadneVoice|null>(null);
  const ambientSoundscapeRef=useRef<AmbientSoundscape|null>(null);
  const lastVoiceEndedAtRef=useRef(0);
  const[voiceActive,setVoiceActive]=useState(false);
  const voiceActivitySerialRef=useRef(0);
  const chatHistoryRef=useRef<HTMLDivElement>(null);
  const chatLingerTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const lingerChat=useCallback(()=>{
    if(chatLingerTimerRef.current)clearTimeout(chatLingerTimerRef.current);
    setChatLingering(true);
    chatLingerTimerRef.current=setTimeout(()=>{chatLingerTimerRef.current=null;setChatLingering(false)},10_000);
  },[]);
  const activeTurnActivityRef=useRef<TurnActivityWindow|null>(null),completedTurnActivitiesRef=useRef<TurnActivitySummary[]>([]),pendingFollowupTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const quietUntilRef=useRef(0);
  const activeDeadEndRef=useRef<{key:string;lastTriggeredAt:number}|null>(null);
  const activeJunctionRef=useRef<string|null>(null);
  const lastCommitmentWalkRef=useRef(-30);
  const junctionRetryRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const junctionHesitationRef=useRef<JunctionHesitation|null>(null);
  const seenStarEventsRef=useRef(new Set<string>()),collectingStarRef=useRef(false);
  const generationEpochRef=useRef(0),runEpochRef=useRef(0),objectiveEpochRef=useRef(0),greetingCompleteRef=useRef(false);
  const generationControllerRef=useRef<AbortController|null>(null),planningControllerRef=useRef<{controller:AbortController;priority:number}|null>(null);
  const activeRequestRef=useRef<{controller:AbortController;priority:number;preempted:boolean;runEpoch:number;objectiveEpoch:number;objectiveIdentity:string;survivesObjectiveChange:boolean;speechAnchor:SpeechAnchor}|null>(null);
  const embodiedEpisodeRef=useRef<EmbodiedDecisionEpisode|null>(null),embodiedReactionRef=useRef(new Set<string>()),dispositionRef=useRef(createAriadneDisposition());
  const exitSearchStartedAtRef=useRef<number|null>(null),closureStartedRef=useRef(false),closureTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const finalPreparedRef=useRef<string|null>(null),finalPreparationRequestedRef=useRef(false);
  const sceneRef=useRef<PerceivedScene|null>(null),sceneMemoryRef=useRef(createSceneMemory()),sceneChangesRef=useRef<string[]>([]),seenMajorScenesRef=useRef(new Set<string>()),lastSceneBuildRef=useRef(0),messagePulseAtRef=useRef(0);
  const latestAccomplishmentRef=useRef<ReturnType<typeof encounterContext>>(null);
  const accomplishmentPulseRef=useRef<{startedAt:number;gold:boolean;completed:boolean}|null>(null);
  const relationshipMemoryRef=useRef<RelationshipMemory>(createRelationshipMemory()),pendingBeatsRef=useRef<ExperienceBeat[]>([]);
  const beliefStateRef=useRef<AriadneBeliefState>(createAriadneBeliefState());
  const beginTurnActivity=useCallback(()=>{activeTurnActivityRef.current={startedAt:Date.now(),facts:[],cellTransitions:0,visitedCells:new Set([lastCellRef.current])}},[]);
  const recordTurnActivity=useCallback((event:CompanionEvent)=>{
    const window=activeTurnActivityRef.current,fact=turnFact(event);if(!window||!fact||window.facts.includes(fact))return;
    window.facts=[...window.facts,fact].slice(-6);
  },[]);
  const finishTurnActivity=useCallback(()=>{
    const window=activeTurnActivityRef.current;if(!window)return null;activeTurnActivityRef.current=null;
    if(window.cellTransitions===0&&window.facts.length===0)return null;
    const movement=window.cellTransitions>=5&&window.visitedCells.size<=3?"MT paced back and forth through the same small area while your response was forming.":window.cellTransitions>=5?"MT kept moving decisively through several cells while your response was forming.":window.cellTransitions>0?"MT continued moving through the maze while your response was forming.":"MT stayed near the same place while your response was forming.";
    const summary={summary:[movement,...window.facts].join(" "),facts:window.facts};completedTurnActivitiesRef.current=[...completedTurnActivitiesRef.current,summary].slice(-3);return summary;
  },[]);
  const speakAndRevealAriadne=useCallback(async(message:CompanionMessage,reveal:()=>void,stillCurrent:()=>boolean=()=>true,delivery:AriadneVocalDelivery="quiet_companionship")=>{
    let revealed=false,voiceActivitySerial=0;const show=()=>{if(revealed||!stillCurrent())return;revealed=true;voiceActivitySerial=++voiceActivitySerialRef.current;setVoiceActive(true);reveal()};const voice=ariadneVoiceRef.current;
    if(!voice){if(stillCurrent()){revealed=true;reveal();lingerChat()}return revealed}
    const result=await voice.speak({text:message.text,sessionId:companionSessionRef.current,utteranceId:message.id,delivery},{onStart:show});
    if(result==="spoken")lastVoiceEndedAtRef.current=Date.now();
    if(result==="failed")show();
    if(!voiceActivitySerial||voiceActivitySerialRef.current===voiceActivitySerial){setVoiceActive(false);if(revealed)lingerChat()}
    return revealed;
  },[lingerChat]);
  const setExperienceState=useCallback((next:ExperienceState)=>{experienceRef.current=next;if(next==="paused"){ariadneVoiceRef.current?.pause();ambientSoundscapeRef.current?.pause()}else if(next==="playing"){ariadneVoiceRef.current?.resume();ambientSoundscapeRef.current?.resume()}setExperience(next)},[]);
  const applyRun=useCallback((next:Run)=>{
    ++runEpochRef.current;objectiveEpochRef.current++;greetingCompleteRef.current=false;ariadneAwakeRef.current=false;
    companionSessionRef.current=crypto.randomUUID();
    ariadneVoiceRef.current?.reset();
    ambientSoundscapeRef.current?.reset();
    voiceActivitySerialRef.current++;
    setVoiceActive(false);
    lastVoiceEndedAtRef.current=0;
    activeTurnActivityRef.current=null;completedTurnActivitiesRef.current=[];if(pendingFollowupTimerRef.current)clearTimeout(pendingFollowupTimerRef.current);pendingFollowupTimerRef.current=null;
    generationControllerRef.current?.abort();planningControllerRef.current?.controller.abort();planningControllerRef.current=null;
    if(activeRequestRef.current){activeRequestRef.current.preempted=true;activeRequestRef.current.controller.abort();activeRequestRef.current=null}requestInFlightRef.current=false;
    const scheduler=createThemeScheduler(next.seed);next.anchors=[plantCheckpoint(next.world,1,1,scheduler.nextTheme() as ThemeId,scheduler.nextAt,next.spawnAngle)];
    next.entities=entitiesNear(next.seed,next.world,next.anchors,next.appearance,1.5,1.5);runRef.current=next;schedulerRef.current=scheduler;heldRef.current.clear();
    poseRef.current={x:1.5,y:1.5,angle:next.spawnAngle,bob:0};ariadneBodyRef.current=createAriadneBody(poseRef.current,performance.now(),next.world,next.moves);lastCellRef.current="1,1";
    minimapMemoryRef.current=createMinimapMemory();recordTraversedCell(minimapMemoryRef.current,next.world,1,1,next.moves);
    guidanceRef.current=null;guidanceTraceRef.current=null;trajectoryRef.current=[];observedAfterGuidanceRef.current=new Set();newlyRevealedRef.current=new Set();seenFamiliarPlacesRef.current=new Set();seenPerceptionCuesRef.current=new Set();seenStarEventsRef.current=new Set();collectingStarRef.current=false;pendingEventsRef.current=[];activeDeadEndRef.current=null;activeJunctionRef.current=null;junctionHesitationRef.current=null;lastCommitmentWalkRef.current=-30;if(junctionRetryRef.current)clearTimeout(junctionRetryRef.current);junctionRetryRef.current=null;embodiedEpisodeRef.current=null;embodiedReactionRef.current=new Set();dispositionRef.current=createAriadneDisposition();journeyRef.current=createJourneyState();journeyEncounterKeysRef.current=new Set();activeTravelAccumulatorRef.current=0;traceTravelAccumulatorRef.current=0;preferredModelRef.current=null;quietUntilRef.current=0;providerFailureRef.current=0;providerBackoffUntilRef.current=0;lastCompanionCallRef.current=0;lastMovementRef.current=Date.now();lastTurnRef.current=lastMovementRef.current;nextPassingThoughtRef.current=nextPassingThoughtAt(lastMovementRef.current,"charming");pauseObservedRef.current=false;exitSearchStartedAtRef.current=null;closureStartedRef.current=false;finalPreparedRef.current=null;finalPreparationRequestedRef.current=false;sceneRef.current=null;sceneMemoryRef.current=createSceneMemory();sceneChangesRef.current=[];seenMajorScenesRef.current=new Set();lastSceneBuildRef.current=0;messagePulseAtRef.current=0;
    latestAccomplishmentRef.current=null;accomplishmentPulseRef.current=null;relationshipMemoryRef.current=createRelationshipMemory();beliefStateRef.current=createAriadneBeliefState();pendingBeatsRef.current=[];if(closureTimerRef.current)clearTimeout(closureTimerRef.current);closureTimerRef.current=null;
    if(chatLingerTimerRef.current)clearTimeout(chatLingerTimerRef.current);chatLingerTimerRef.current=null;
    setCompanionMessages([]);setCompanionInput("");setChatOpen(false);setChatAwaitingReply(false);setChatLingering(false);setStarPulse(false);setClosureRevealed(false);setRun(next);
  },[]);
  const initializeRun=useCallback(async(seed:number)=>{
    const generation=++generationEpochRef.current,controller=new AbortController();generationControllerRef.current?.abort();generationControllerRef.current=controller;runEpochRef.current++;objectiveEpochRef.current++;greetingCompleteRef.current=false;heldRef.current.clear();setReady(false);
    if(closureTimerRef.current)clearTimeout(closureTimerRef.current);closureTimerRef.current=null;closureStartedRef.current=false;setClosureRevealed(false);
    planningControllerRef.current?.controller.abort();planningControllerRef.current=null;
    if(activeRequestRef.current){activeRequestRef.current.preempted=true;activeRequestRef.current.controller.abort();activeRequestRef.current=null}requestInFlightRef.current=false;
    const draft=newRun(seed);
    try{
      const objective=await createObjectiveStateAsync(draft.world,[1,1],seed,draft.appearanceProtected,draft.visited,draft.moves,controller.signal);
      if(generationEpochRef.current!==generation)return;
      settleObjectiveStreaming(draft.world,objective,[1,1],draft.moves);
      applyRun(ensureActiveJourney({...draft,objective}));setReady(true);
    }catch(error){if(!(error instanceof DOMException&&error.name==="AbortError"))console.warn("ARIADNE signal generation failed",error)}
  },[applyRun]);
  useEffect(()=>{runRef.current=run},[run]);
  useEffect(()=>{messagesRef.current=companionMessages},[companionMessages]);
  useEffect(()=>{
    if(!chatOpen)return;const history=chatHistoryRef.current;if(history)history.scrollTop=history.scrollHeight;
  },[chatOpen,companionMessages]);
  useEffect(()=>{
    const voice=createAriadneVoice();ariadneVoiceRef.current=voice;
    return()=>{voice.destroy();if(ariadneVoiceRef.current===voice)ariadneVoiceRef.current=null};
  },[]);
  useEffect(()=>{
    const soundscape=createAmbientSoundscape();ambientSoundscapeRef.current=soundscape;
    return()=>{soundscape.destroy();if(ambientSoundscapeRef.current===soundscape)ambientSoundscapeRef.current=null};
  },[]);
  useEffect(()=>{ariadneVoiceRef.current?.setMasterVolume(masterVolume);ambientSoundscapeRef.current?.setMasterVolume(masterVolume)},[masterVolume]);
  useEffect(()=>{
    const query=window.matchMedia("(prefers-reduced-motion: reduce)"),sync=()=>setReducedMotion(query.matches);sync();query.addEventListener("change",sync);return()=>query.removeEventListener("change",sync);
  },[]);
  useEffect(()=>{
    if(bootedRef.current)return;bootedRef.current=true;void initializeRun(randomSeed());
  },[initializeRun]);

  const enterCell=useCallback((x:number,y:number)=>{
    const id=cellKey(x,y),activityWindow=activeTurnActivityRef.current;if(activityWindow){activityWindow.cellTransitions++;activityWindow.visitedCells.add(id)}lastCellRef.current=id;lastMovementRef.current=Date.now();collisionRef.current=0;
    const current=runRef.current,pose=poseRef.current,world=current.world;let moves=current.moves,shifts=current.shifts,message="FOOTSTEPS DISSOLVE BEHIND YOU";
      const visited=new Set(current.visited),recent=[...current.recent,id].slice(-20);const firstVisit=!visited.has(id);
      if(firstVisit){visited.add(id);moves++}
      let anchors=[...current.anchors];const scheduler=schedulerRef.current;
      if(firstVisit&&moves>=scheduler.nextAt){
        scheduler.advance(moves);const theme=scheduler.nextTheme() as ThemeId;
        anchors.push(plantCheckpoint(world,x,y,theme,scheduler.nextAt,pose.angle));
        message="A DIFFERENT PRESSURE WAITS AHEAD";
      }
      anchors=anchors.map(anchor=>{
        if(!anchor.triggered&&moves>=anchor.bornAt&&Math.hypot(x-anchor.x,y-anchor.y)<2.25){message=THEMES[anchor.theme].signal;return{...anchor,triggered:true}}
        return anchor;
      });
      const visible=visibleCells(world,pose,moves),protectedChunks=objectiveProtectedChunks(current.objective);
      for(const cell of [...visible,...recent]){const[cx,cy]=cell.split(",").map(Number);const c=world.coords(cx,cy);protectedChunks.add(chunkKey(c.cx,c.cy))}
      world.ensureAround(x,y,moves);const removedChunks=world.prune(x,y,protectedChunks,moves);if(removedChunks.length){shifts++;forgetMinimapChunks(minimapMemoryRef.current,removedChunks)}
      const memory=new Map(current.memory);
      visible.forEach(cell=>{const[cx,cy]=cell.split(",").map(Number);memory.set(cell,{tile:world.tile(cx,cy,moves),seenAt:moves})});
      for(const[cell,value]of memory)if(moves-value.seenAt>80)memory.delete(cell);
      const pc=world.coords(x,y);anchors=anchors.filter(a=>Math.abs(world.coords(a.x,a.y).cx-pc.cx)<=CACHE_RADIUS+1&&Math.abs(world.coords(a.x,a.y).cy-pc.cy)<=CACHE_RADIUS+1);
      const appearanceProtected=new Set([...visible,...recent]),appearance=current.appearance;retainThemeMemory(appearance,appearanceProtected);
      if(current.objective.stage===4)ensureExitEncountersAround(current.resonance,world,{seed:current.seed,origin:[x,y],tick:moves,activeSeconds:journeyRef.current.activeWalkSeconds});
      const collageIntensity=relationshipMemoryRef.current.position,entities=entitiesNear(current.seed,world,anchors,appearance,x+.5,y+.5,collageIntensity);
      const next={...current,anchors,entities,memory,appearanceProtected,visited,recent,player:{x,y},moves,shifts,message,revision:current.revision+1};
      recordTraversedCell(minimapMemoryRef.current,world,x,y,moves);
      runRef.current=next;setRun(next);
  },[]);

  const recordEncounter=useCallback((key:string,kind:EncounterKind)=>{
    if(journeyEncounterKeysRef.current.has(key))return;
    journeyEncounterKeysRef.current.add(key);journeyRef.current=recordJourneyEncounter(journeyRef.current,kind);
  },[]);

  const rememberRelationship=useCallback((kind:SharedMomentKind,fact:string,outcome:string,weight=.6,belief:string|null=null,subjectId:string|null=null)=>{
    const current=runRef.current,stage=current.objective.stage,id=`moment:${stage}:${kind}:${current.moves}:${fact}`;
    let memory=advanceRelationship(relationshipMemoryRef.current,stage,kind);
    const interpretation=interpretationFor(kind,memory.position,kind==="shared_accomplishment"?true:kind==="proxy_accomplishment"?false:null);
    memory=rememberMoment(memory,{id,subjectId,objectiveStage:stage,kind,concreteFact:fact,ariadneBelieved:belief,observableOutcome:outcome,ariadneInterpretation:interpretation,emotionalWeight:weight,referencedInSpeech:0});relationshipMemoryRef.current=memory;
    const band=relationshipBand(memory.position);journeyRef.current={...journeyRef.current,phase:band};
    return id;
  },[]);

  const refreshScene=useCallback((movementState:"walking"|"turning"|"stationary"="stationary")=>{
    // One long-view ray sample feeds both grounded perception and nearby
    // decision checks. Distance-gated consumers still ignore far junctions,
    // while avoiding a second full ray pass every scene refresh.
    const current=runRef.current,pose=poseRef.current,geometry=forwardVisibleGeometry(current.world,pose,current.moves,SPATIAL_VISIBILITY_DISTANCE),routes=planRoutes(current.world,pose,current.moves,current.memory,current.visited),visibleRoutes=planVisibleJunctionRoutes(current.world,pose,current.moves,geometry,current.memory,current.visited),sceneRoutes=visibleRoutes.length?visibleRoutes:routes,journey=journeyRef.current;
    const result=buildPerceivedScene({seed:current.seed,world:current.world,anchors:current.anchors,entities:current.entities,pose,tick:current.moves,visibleCells:geometry.cells,routeDirections:sceneRoutes.map(route=>route.direction),visibleRoutes:sceneRoutes.map(route=>({direction:route.direction,instruction:route.instruction})),visibleJunction:visibleRoutes.length>0,visibleEndAhead:!!centeredDeadEnd(current.world,geometry,pose,current.moves,DEAD_END_REACTION_DISTANCE),activeStar:objectiveResonanceReady(current.resonance,current.objective.activeStar?.id??null)?current.objective.activeStar:null,phase:journey.phase,relationshipIntensity:relationshipMemoryRef.current.position,collectedStars:current.objective.collectedStars,movementState,memory:sceneMemoryRef.current,reducedMotion});
    sceneRef.current=result.scene;if(result.changes.length)sceneChangesRef.current=[...new Set([...sceneChangesRef.current,...result.changes])].slice(-12);
    return{...result,visibleGeometry:geometry,visibleJunction:nearestActionableJunction(geometry,pose,JUNCTION_COMMIT_DISTANCE)??nearbyJunction(current.world,pose,current.moves)};
  },[reducedMotion]);

  const collectActiveStar=useCallback(()=>{
    if(collectingStarRef.current)return;const current=runRef.current,active=current.objective.activeStar,pose=poseRef.current;
    if(!active||!objectiveResonanceReady(current.resonance,active.id)||!starCollectedAt(current.objective,[pose.x,pose.y]))return;
    collectingStarRef.current=true;
    ambientSoundscapeRef.current?.playInteraction({kind:"star_collect",id:active.id,position:[active.cell[0]+.5,active.cell[1]+.5],pose,theme:themeAt(current.anchors,pose.x,pose.y).id});
    const objective=collectStar(current.objective,current.world,current.seed,current.visited,current.moves);
    condenseStarFragment(current.resonance);const next=ensureActiveJourney({...current,objective,revision:current.revision+1},journeyRef.current.activeWalkSeconds);objectiveEpochRef.current++;runRef.current=next;setRun(next);recordEncounter(`star-collected:${active.id}`,"star_collected");
    rememberRelationship("star_collected",`MT collected the ${["first","second","third","fourth"][active.ordinal-1]} star.`,`The star condensed into a permanent gold fragment carried by Ariadne.`,1);
    if(active.ordinal===4)exitSearchStartedAtRef.current=journeyRef.current.activeWalkSeconds;
    setStarPulse(true);setTimeout(()=>setStarPulse(false),800);
    void callCompanionRef.current({type:"star_collected",starId:active.id,ordinal:active.ordinal},undefined,true);
    collectingStarRef.current=false;
  },[recordEncounter,rememberRelationship]);

  const beginEmbodiedJunction=useCallback(async(junctionId:string)=>{
    const existing=embodiedEpisodeRef.current;
    if(existing?.junctionId===junctionId&&existing.state!=="resolved")return;
    if(planningControllerRef.current){planningControllerRef.current.controller.abort();planningControllerRef.current=null}
    const startedRunEpoch=runEpochRef.current,startedObjectiveEpoch=objectiveEpochRef.current,current=runRef.current,pose=poseRef.current;
    let geometry=forwardVisibleGeometry(current.world,pose,current.moves);const junction=nearestActionableJunction(geometry,pose,JUNCTION_COMMIT_DISTANCE)??nearbyJunction(current.world,pose,current.moves);
    if(junction?.id!==junctionId)return;
    if(!geometry.junctions.some(item=>item.id===junction.id))geometry={...geometry,junctions:[junction,...geometry.junctions]};
    const visibleRoutes=planVisibleJunctionRoutes(current.world,pose,current.moves,geometry,current.memory,current.visited),routesAtThisJunction=visibleRoutes.filter(route=>route.decisionCell?.[0]===junction.cell[0]&&route.decisionCell?.[1]===junction.cell[1]),routes=routesAtThisJunction.length?routesAtThisJunction:visibleRoutes;
    if(!routes.length)return;
    noticeAriadneChoice(ariadneBodyRef.current,Date.now());
    const token={controller:new AbortController(),priority:eventPriority({type:"new_junction_visible"})};planningControllerRef.current=token;
    try{
      const visible=activeStarIsVisible(current,pose),chosen=await chooseNavigationBeliefAsync(current.objective,routes,junctionId,current.world,current.seed,visible,current.moves,token.controller.signal);
      const latest=runRef.current,latestPose=poseRef.current,latestGeometry=forwardVisibleGeometry(latest.world,latestPose,latest.moves),latestJunction=nearestActionableJunction(latestGeometry,latestPose,JUNCTION_COMMIT_DISTANCE)??nearbyJunction(latest.world,latestPose,latest.moves);
      if(runEpochRef.current!==startedRunEpoch||objectiveEpochRef.current!==startedObjectiveEpoch||latestJunction?.id!==junctionId){cancelAriadneChoiceNotice(ariadneBodyRef.current);return}
      const belief=chosen.belief,route=belief&&routes.find(item=>item.id===belief.routeId);if(!belief||!route){cancelAriadneChoiceNotice(ariadneBodyRef.current);return}
      if(chosen.state!==latest.objective){const next={...latest,objective:chosen.state};runRef.current=next;setRun(next)}
      const episode=createEmbodiedEpisode(belief.junctionId,belief.id,belief.routeId,Date.now());embodiedEpisodeRef.current=transitionEmbodiedEpisode(episode,"committing",false);embodiedReactionRef.current=new Set();
      beginAriadneRoute(ariadneBodyRef.current,route,poseRef.current,Date.now());
      lastCommitmentWalkRef.current=journeyRef.current.activeWalkSeconds;
      const intent=createGuidanceIntent({message:"Ariadne visibly chose this passage."},route,{...poseRef.current});if(intent){guidanceRef.current=intent;guidanceTraceRef.current=createGuidanceTrace(intent);traceTravelAccumulatorRef.current=0;trajectoryRef.current=[];observedAfterGuidanceRef.current=new Set(geometry.cells.map(([x,y])=>cellKey(x,y)));newlyRevealedRef.current=new Set()}
      beliefStateRef.current=expressClaim(beliefStateRef.current,{id:belief.id,objectiveId:latest.objective.activeStar?.id??"exit",subjectId:junctionId,proposition:"This passage is the most promising way to restore the maze's path toward the current star.",expressedAt:Date.now()});
      void callCompanionRef.current({type:"new_junction_visible"},undefined,true);
    }catch(error){
      cancelAriadneChoiceNotice(ariadneBodyRef.current);
      if(!(error instanceof DOMException&&error.name==="AbortError"))console.warn("ARIADNE embodied route planning failed",error);
    }finally{if(planningControllerRef.current===token)planningControllerRef.current=null}
  },[]);

  useEffect(()=>{
    const activeId=run.objective.activeStar?.id;if(!ready||!activeId||run.objective.queuedStar||run.objective.activeStar?.ordinal===4)return;
    const epoch=runEpochRef.current,controller=new AbortController();let cancelled=false;const prepare=async()=>{if(cancelled)return;const current=runRef.current;if(current.objective.activeStar?.id!==activeId||current.objective.queuedStar)return;
      try{
        const objective=await queueNextStarAsync(current.objective,current.world,current.seed,current.visited,current.moves,controller.signal),generated=objective.queuedStar!==current.objective.queuedStar?objective.queuedStar:null;
        if(cancelled||runEpochRef.current!==epoch||runRef.current.objective.activeStar?.id!==activeId||objective===current.objective){if(generated)releaseStarRoute(current.world,generated);return}
        const latest=runRef.current;settleObjectiveStreaming(latest.world,objective,[latest.player.x,latest.player.y],latest.moves);const next={...latest,objective};runRef.current=next;setRun(next);
      }catch(error){if(!(error instanceof DOMException&&error.name==="AbortError"))console.warn("ARIADNE star preparation failed",error)}};
    const idle=window.requestIdleCallback?.(()=>prepare(),{timeout:1200}),timer=idle===undefined?window.setTimeout(prepare,30):undefined;
    return()=>{cancelled=true;controller.abort();if(idle!==undefined)window.cancelIdleCallback?.(idle);if(timer!==undefined)window.clearTimeout(timer)};
  },[ready,run.objective.activeStar?.id,run.objective.activeStar?.ordinal,run.objective.queuedStar]);

  const callCompanion=useCallback(async(event:CompanionEvent,playerMessage?:string,force=false,staticCueEligible=true)=>{
    const now=Date.now();
    const eventFacts=event.type==="encounter_completed"&&latestAccomplishmentRef.current?[latestAccomplishmentRef.current.whatMTJustAccomplished,latestAccomplishmentRef.current.whatChangedPermanently??"The visible structure is still changing.",latestAccomplishmentRef.current.starVisiblyResponded?"A gold tremor travelled from the awakened structure into the dark toward the star.":"The room unfolded, but no gold light answered."]:sceneChangesRef.current.slice(-2);
    const incomingBeat=beatForEvent(event,now,eventFacts);pendingBeatsRef.current=enqueueBeat(pendingBeatsRef.current,incomingBeat);
    const eventKey=(value:CompanionEvent)=>value.type==="trajectory_relationship_changed"?`${value.type}:${value.change}`:value.type==="embodied_response"?`${value.type}:${value.response}`:value.type==="star_visible"||value.type==="star_collected"?`${value.type}:${value.starId}`:value.type==="encounter_completed"?`${value.type}:${value.encounterId}`:value.type==="scene_changed"?`${value.type}:${value.sceneId}`:value.type==="player_message"?`${value.type}:${value.text}`:value.type;
    const queue=(queuedForce=force,queuedStaticCueEligible=staticCueEligible)=>{const queued={event,force:queuedForce,playerMessage,staticCueEligible:queuedStaticCueEligible},existing=pendingEventsRef.current[0],same=existing&&eventKey(existing.event)===eventKey(event);if(!existing||eventPriority(event)>eventPriority(existing.event)||eventPriority(event)===eventPriority(existing.event)&&!same)pendingEventsRef.current=[queued];else if(same)pendingEventsRef.current=[{...existing,...queued,force:existing.force||queuedForce,staticCueEligible:existing.staticCueEligible&&queuedStaticCueEligible}]};
    if(ariadneVoiceRef.current?.isBusy()&&event.type!=="player_message"){recordTurnActivity(event);queue(force,false);return}
    if(requestInFlightRef.current){
      // Anything that happens while an LLM turn is being generated belongs to
      // the next interpretive turn. It must not later escape the queue as a
      // prerecorded reaction detached from the action that caused it.
      recordTurnActivity(event);queue(force,false);const planning=planningControllerRef.current;if(force&&planning&&eventPriority(event)>planning.priority)planning.controller.abort();
      const factualContradiction=event.type==="dead_end_visible"||event.type==="recommendation_contradicted"||event.type==="trajectory_relationship_changed"&&event.change==="recommendation_visibly_contradicted",active=activeRequestRef.current;
      // Direct conversation takes precedence over autonomous commentary. The
      // player's line remains in history, and the queued reply begins as soon
      // as the lower-priority request has actually yielded.
      if(event.type==="player_message"&&active&&eventPriority(event)>active.priority){active.preempted=true;active.controller.abort()}
      if(force&&factualContradiction&&active&&eventPriority(event)>active.priority){active.preempted=true;active.controller.abort()}
      return
    }
    if(event.type!=="player_message"&&now-lastCompanionCallRef.current<MIN_PROVIDER_INTERVAL_MS){queue();return}
    if(event.type!=="initial_guidance"&&event.type!=="player_message"&&now<providerBackoffUntilRef.current&&!speechBypassesProviderBackoff(event,force)){queue();return}
    const phaseAtCall=journeyRef.current.phase,cooldown=companionCooldownMs(phaseAtCall);
    if(!force&&now-lastCompanionCallRef.current<cooldown){queue();return}
    const current=runRef.current,pose=poseRef.current,geometry=forwardVisibleGeometry(current.world,pose,current.moves),environment=visibleEnvironment(current.anchors,geometry,pose);
    const currentRoutes=planRoutes(current.world,pose,current.moves,current.memory,current.visited),visibleJunctionRoutes=event.type==="new_junction_visible"?planVisibleJunctionRoutes(current.world,pose,current.moves,geometry,current.memory,current.visited):[];
    const routes=routesForEvent(event,currentRoutes,visibleJunctionRoutes),egocentricView=describeEgocentricView(current.world,pose,current.moves,currentRoutes),intent=guidanceRef.current;
    const activity=analyzePlayerActivity(trajectoryRef.current,now,lastMovementRef.current,lastTurnRef.current,geometry.junctions.length>0),sceneResult=refreshScene(activity.state==="turning_in_place"?"turning":activity.state),sceneAtRequest=sceneResult.scene,sceneChangesAtRequest=sceneChangesRef.current.slice(-8);
    const bodyEventType=event.type==="trajectory_relationship_changed"&&event.change==="recommendation_visibly_contradicted"?"recommendation_contradicted":event.type;
    prepareAriadneForEvent(ariadneBodyRef.current,bodyEventType,now);
    const evidence=guidanceTraceRef.current?.evidence??null,currentArc=companionArc(journeyRef.current);
    const activeStarVisible=activeStarIsVisible(current,pose);
    let belief:NavigationBelief|null=null;
    if(event.type==="new_junction_visible"){
      const episode=embodiedEpisodeRef.current;
      belief=episode?current.objective.recentBeliefs.find(item=>item.id===episode.beliefId)??null:null;
      if(!belief||!routes.some(route=>route.id===belief!.routeId))return;
    }
    const contradiction=event.type==="recommendation_contradicted"||event.type==="dead_end_visible"||event.type==="trajectory_relationship_changed"&&event.change==="recommendation_visibly_contradicted";
    if(contradiction){
      if(embodiedEpisodeRef.current){embodiedEpisodeRef.current=transitionEmbodiedEpisode(embodiedEpisodeRef.current,"route_contradicted");dispositionRef.current=recordDispositionMoment(dispositionRef.current,"contradicted",currentArc.phase)}
      beliefStateRef.current=resolveClaim(beliefStateRef.current,"contradicted",interpretationFor("ariadne_mistake",relationshipMemoryRef.current.position));
    }
    if(event.type==="star_collected")dispositionRef.current=recordDispositionMoment(dispositionRef.current,"star_collected",currentArc.phase);
    const objectiveEvent=event.type==="star_visible"?"star_visible":event.type==="star_collected"?"star_collected":event.type==="objective_changed"?"objective_changed":"searching";
    const objectiveContext=publicObjective(current.objective,activeStarVisible,objectiveEvent),embodiment=describeAriadneEmbodiment(ariadneBodyRef.current,pose,current.world,current.moves,evidence);
    const subjectId=event.type==="encounter_completed"?event.encounterId:event.type==="star_visible"||event.type==="star_collected"?event.starId:embodiedEpisodeRef.current?.junctionId??null;
    const momentKind:SharedMomentKind|null=event.type==="encounter_completed"?(event.starResponded?"shared_accomplishment":"proxy_accomplishment")
      :contradiction?"ariadne_mistake"
      :event.type==="star_collected"?"star_collected"
      :event.type==="embodied_response"?(event.response==="rejoined"?"rejoined_ariadne":event.response==="followed"?"followed_commitment":"diverged_from_commitment")
      :null;
    const relatedMoment=selectRelatedMoment(relationshipMemoryRef.current,subjectId,current.objective.stage,momentKind);
    const priorBelief=beliefStateRef.current.unresolvedClaim?.proposition??beliefStateRef.current.lastClaim?.proposition??beliefStateRef.current.currentTheory;
    const visibleOutcome=event.type==="encounter_completed"&&latestAccomplishmentRef.current?`${latestAccomplishmentRef.current.whatChangedPermanently??latestAccomplishmentRef.current.whatMTJustAccomplished} ${event.starResponded?"A gold signal answered from the star.":"No gold signal answered from the star."}`
      :contradiction?"The promised passage visibly ends; the geometry contradicts Ariadne's earlier claim."
      :event.type==="star_collected"?`The ${["first","second","third","fourth"][event.ordinal-1]} star condensed into a gold fragment now carried by Ariadne.`
      :event.type==="star_visible"?`The ${["first","second","third","fourth"][event.ordinal-1]} star is now actually visible in the shared scene.`
      :event.type==="new_junction_visible"?"Ariadne's light has committed to one visible entrance, marked it briefly, and is already prepared to move with MT."
      :relatedMoment?.observableOutcome??sceneChangesAtRequest.at(-1)??"The current passage remains visibly unchanged.";
    const interpretation=momentKind?interpretationFor(momentKind,relationshipMemoryRef.current.position,event.type==="encounter_completed"?event.starResponded:null)
      :event.type==="star_visible"?"The maze has yielded verifiable evidence that one of its anchors is near."
      :event.type==="star_collected"?"Another memory anchor has joined Ariadne, strengthening her belief that the maze can remember a way home."
      :event.type==="final_direction"?"The returning geometry feels like the maze is reconstructing a way home around MT and Ariadne."
      :relationshipExpression(relationshipMemoryRef.current);
    const desire=event.type==="player_message"?"Answer MT's exact message before doing anything else."
      :contradiction?"Return close to MT, own the exact mistake, and preserve enough connection to continue later."
      :event.type==="new_junction_visible"?"Invite MT to notice your visible commitment without reciting its geometry."
      :event.type==="encounter_completed"?"Share the consequence with MT and reveal what it does to your confidence or closeness."
      :event.type==="star_collected"||event.type==="star_visible"?"Let MT feel the discovery before renewing the larger belief."
      :"Remain present with MT without manufacturing a milestone.";
    const interpretiveTurn=interpretiveTurnForEvent(event,{priorBelief,visibleOutcome,interpretation,desire,relatedMomentId:relatedMoment?.id??null,now});
    const utterancePlan=planUtterance(interpretiveTurn,relationshipMemoryRef.current.position,relationshipMemoryRef.current.speechSignatures,current.moves+now);
    if(utterancePlan.form==="silence"&&event.type!=="player_message"&&event.type!=="star_collected"&&event.type!=="initial_guidance"){
      pendingBeatsRef.current=pendingBeatsRef.current.filter(item=>item.id!==incomingBeat.id);settleAriadneThinking(ariadneBodyRef.current);return;
    }
    const speechAnchor=createSpeechAnchor(event,embodiedEpisodeRef.current);
    if(!speechPlacementIsCompatible(speechAnchor,embodiment.presence)){settleAriadneThinking(ariadneBodyRef.current);return}
    const survivesObjectiveChange=event.type==="encounter_completed"||event.type==="star_collected"||event.type==="player_message",requestToken={controller:new AbortController(),priority:eventPriority(event),preempted:false,runEpoch:runEpochRef.current,objectiveEpoch:objectiveEpochRef.current,objectiveIdentity:objectiveIdentity(current),survivesObjectiveChange,speechAnchor};activeRequestRef.current=requestToken;
    // Continuous movement changes the next conversational context; it never erases speech already in flight.
    const requestIsCurrent=()=>experienceRef.current==="playing"&&!requestToken.preempted&&activeRequestRef.current===requestToken&&runEpochRef.current===requestToken.runEpoch&&(requestToken.survivesObjectiveChange||objectiveEpochRef.current===requestToken.objectiveEpoch&&objectiveIdentity(runRef.current)===requestToken.objectiveIdentity);
    const turnActivityAtRequest=completedTurnActivitiesRef.current[0]??null;beginTurnActivity();let published=false;
    requestInFlightRef.current=true;lastCompanionCallRef.current=now;nextPassingThoughtRef.current=nextPassingThoughtAt(now,currentArc.phase);
    const immediateCue=vocalCueFor(speechAnchor.speechAct,event.type),mayPlayImmediateCue=staticCueEligible&&immediateCue&&!ariadneVoiceRef.current?.isBusy()&&staticCueAllowed(lastVoiceEndedAtRef.current,now);if(mayPlayImmediateCue)void(async()=>{
      // The factual dead-end cue begins with the recoil/spiral, not after it.
      // A longer generated repair can still wait until Ariadne returns to MT.
      if(speechAnchor.speechAct==="repair_mistake"&&event.type!=="dead_end_visible"&&!ariadneBodyRef.current.apologyReady){const waitStarted=performance.now();await new Promise<void>(resolve=>{const check=()=>{if(ariadneBodyRef.current.apologyReady||!requestIsCurrent()||performance.now()-waitStarted>4500)resolve();else requestAnimationFrame(check)};check()})}
      if(!requestIsCurrent()||!staticCueEligible||!staticCueAllowed(lastVoiceEndedAtRef.current))return;let cueActivitySerial=0;const result=await ariadneVoiceRef.current?.playCue(immediateCue,{onStart:cueText=>{cueActivitySerial=++voiceActivitySerialRef.current;setVoiceActive(true);const text=cueText??ARIADNE_VOICE_CUES[immediateCue][0].text,message:CompanionMessage={id:crypto.randomUUID(),role:"ariadne",text,time:Date.now(),kind:"prerecorded_cue"},next=[...messagesRef.current,message].slice(-18);messagesRef.current=next;setCompanionMessages(next);relationshipMemoryRef.current=recordSpeechSignature(relationshipMemoryRef.current,signatureForSpeech(text,{...utterancePlan,form:cueUtteranceForm(speechAnchor.speechAct)}));messagePulseAtRef.current=Date.now();speakAsAriadne(ariadneBodyRef.current,text,bodyEventType,Date.now())}});if(result==="spoken")lastVoiceEndedAtRef.current=Date.now();if(result&&voiceActivitySerialRef.current===cueActivitySerial)setVoiceActive(false);
    })();
    try{
      const visibleCellIds=new Set(geometry.cells.map(([x,y])=>cellKey(x,y))),visibleConfigurations=encountersForRender(current.resonance,current.objective.activeStar?.id??"exit",[pose.x,pose.y],18).filter(item=>visibleCellIds.has(cellKey(item.center[0],item.center[1]))||item.elements.some(element=>visibleCellIds.has(cellKey(Math.floor(element.position[0]),Math.floor(element.position[1]))))).map(item=>`${item.motif.kind}: ${item.elements.filter(element=>element.active).length} of ${item.elements.length} visible parts are awake${item.completed?`; it now appears as ${item.reality.semanticDescription}`:""}`).slice(0,8);
      const beat=pendingBeatsRef.current.find(item=>item.id===incomingBeat.id)??incomingBeat,strategy=strategyForBeat(beat,relationshipMemoryRef.current.position,relationshipMemoryRef.current.lastStrategies);
      const response=await fetch("/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:companionSessionRef.current,trigger:event,speechAnchor,dispositionCard:dispositionCard(dispositionRef.current,currentArc.phase),activity,recommendation:intent,recommendationEvidence:evidence,actualTrajectory:trajectoryRef.current.slice(-32),currentView:egocentricView,environment,perceivedScene:sceneForPrompt(sceneAtRequest),sceneChanges:sceneChangesAtRequest,rememberedMap:compactMap(current.memory,[current.player.x,current.player.y]),legalRoutes:routes,recentMessages:messagesRef.current.slice(-8),olderContextSummary:relationshipMemoryRef.current.summary,companionArc:currentArc,objective:objectiveContext,navigationBelief:belief,embodiment,visibleConfigurations,accomplishment:event.type==="encounter_completed"?latestAccomplishmentRef.current:null,experienceBeat:beat,sharedMoment:relatedMoment,relationshipExpression:relationshipExpression(relationshipMemoryRef.current),socialStrategy:strategy,interpretiveTurn,utterancePlan,recentSpeechSignatures:relationshipMemoryRef.current.speechSignatures,turnActivity:turnActivityAtRequest,playerMessage,preferredModelId:preferredModelRef.current})});
      if(!requestIsCurrent())return;
      if(!response.ok){const failure=await response.json().catch(()=>null) as {error?:string;reason?:string}|null;throw new Error(`companion request failed: ${response.status}${failure?.reason?` (${failure.reason})`:failure?.error?` (${failure.error})`:""}`)}
      const reply=await response.json() as CompanionReply&{source?:"provider"|"fallback";modelUsed?:string|null};
      if(!requestIsCurrent())return;
      if(reply.source==="provider"){providerFailureRef.current=0;providerBackoffUntilRef.current=0;if(junctionRetryRef.current)clearTimeout(junctionRetryRef.current);junctionRetryRef.current=null;if(reply.modelUsed)preferredModelRef.current=reply.modelUsed}
      else{
        providerFailureRef.current++;preferredModelRef.current=null;
        providerBackoffUntilRef.current=Date.now()+Math.min(24_000,4_000*providerFailureRef.current);nextPassingThoughtRef.current=providerBackoffUntilRef.current;
        // Durability must include delivery, not only conversational memory.
        // Keep completed facts queued, without force, so the normal interval
        // retries them after backoff instead of spinning immediately.
        if(beat.durable&&event.type!=="initial_guidance")queue(false);
        if(event.type!=="initial_guidance")return
      }
      if(speechAnchor.speechAct==="repair_mistake"&&!ariadneBodyRef.current.apologyReady){
        const waitStarted=performance.now();await new Promise<void>(resolve=>{const check=()=>{if(ariadneBodyRef.current.apologyReady||!requestIsCurrent()||performance.now()-waitStarted>4500)resolve();else requestAnimationFrame(check)};check()});
        if(!requestIsCurrent())return;
      }
      if(!speechPlacementIsCompatible(speechAnchor,describeAriadneEmbodiment(ariadneBodyRef.current,poseRef.current,runRef.current.world,runRef.current.moves,guidanceTraceRef.current?.evidence??null).presence)){
        const placementStarted=performance.now();
        await new Promise<void>(resolve=>{const check=()=>{const latestPresence=describeAriadneEmbodiment(ariadneBodyRef.current,poseRef.current,runRef.current.world,runRef.current.moves,guidanceTraceRef.current?.evidence??null).presence;if(speechPlacementIsCompatible(speechAnchor,latestPresence)||!requestIsCurrent()||performance.now()-placementStarted>2400)resolve();else requestAnimationFrame(check)};check()});
        if(!requestIsCurrent()||!speechPlacementIsCompatible(speechAnchor,describeAriadneEmbodiment(ariadneBodyRef.current,poseRef.current,runRef.current.world,runRef.current.moves,guidanceTraceRef.current?.evidence??null).presence))return;
      }
      const finalText=reply.message.trim();
      if(event.type==="final_direction"){
        if(finalText)finalPreparedRef.current=finalText;
        published=!!finalText;
        return;
      }
      // Repetition filtering controls autonomous noise; it must never swallow
      // a direct answer to something MT deliberately typed.
      const repeated=event.type!=="player_message"&&isRecentCompanionRepeat(finalText,messagesRef.current);
      if(finalText&&!repeated){
        const message:CompanionMessage={id:crypto.randomUUID(),role:"ariadne",text:finalText,time:Date.now(),kind:"generated"};
        const delivery=vocalDeliveryForForm(utterancePlan.form,vocalDeliveryFor(speechAnchor.speechAct,strategy,relationshipBand(relationshipMemoryRef.current.position)));
        published=await speakAndRevealAriadne(message,()=>{
          if(event.type==="player_message")setChatAwaitingReply(false);
          const next=[...messagesRef.current,message].slice(-18);messagesRef.current=next;setCompanionMessages(next);
          nextPassingThoughtRef.current=nextPassingThoughtAt(Date.now(),journeyRef.current.phase);
          pendingBeatsRef.current=pendingBeatsRef.current.filter(item=>item.id!==beat.id);relationshipMemoryRef.current=recordSpeechSignature(recordStrategy(markMomentReferenced(relationshipMemoryRef.current,relatedMoment?.id??null),strategy),signatureForSpeech(finalText,utterancePlan));
          messagePulseAtRef.current=Date.now();speakAsAriadne(ariadneBodyRef.current,finalText,bodyEventType,Date.now());sceneChangesRef.current=sceneChangesRef.current.filter(change=>!sceneChangesAtRequest.includes(change));
        },requestIsCurrent,delivery);
      }else if(event.type==="initial_guidance"&&repeated)published=true;
    }catch(error){
      if(requestIsCurrent()){
        providerFailureRef.current++;providerBackoffUntilRef.current=Date.now()+Math.min(45_000,8_000*providerFailureRef.current);nextPassingThoughtRef.current=providerBackoffUntilRef.current;console.warn("ARIADNE request will retry after a transient failure",error);
        if(event.type==="initial_guidance"){
          const fallback=deterministicReply(event,routes,environment,evidence,currentArc.phase,objectiveContext,belief,sceneChangesAtRequest[0]),text=fallback.message,repeated=isRecentCompanionRepeat(text,messagesRef.current);
          if(text&&!repeated){const message:CompanionMessage={id:crypto.randomUUID(),role:"ariadne",text,time:Date.now()};published=await speakAndRevealAriadne(message,()=>{const next=[...messagesRef.current,message].slice(-18);messagesRef.current=next;setCompanionMessages(next);messagePulseAtRef.current=Date.now();speakAsAriadne(ariadneBodyRef.current,text,"initial_guidance",Date.now())},requestIsCurrent,"opening_wonder")}else if(repeated)published=true;
        }
      }
    }finally{
      if(event.type==="player_message"&&!published){setChatAwaitingReply(false);lingerChat()}
      if(published&&completedTurnActivitiesRef.current[0]===turnActivityAtRequest)completedTurnActivitiesRef.current.shift();
      const completedActivity=finishTurnActivity();
      if(!published)settleAriadneThinking(ariadneBodyRef.current);
      if(activeRequestRef.current===requestToken){
        activeRequestRef.current=null;requestInFlightRef.current=false;
        if(event.type==="initial_guidance"&&requestToken.runEpoch===runEpochRef.current){greetingCompleteRef.current=published;if(!published)queueMicrotask(()=>{void callCompanionRef.current({type:"initial_guidance"},undefined,true)})}
        if(published&&completedActivity&&event.type!=="final_direction"&&Date.now()>=quietUntilRef.current&&pendingEventsRef.current.length===0)pendingEventsRef.current.push({event:{type:"passing_thought"},force:false,staticCueEligible:false});
        const pending=pendingEventsRef.current.shift();if(pending){const epoch=requestToken.runEpoch,delay=pending.force?0:Math.max(0,MIN_PROVIDER_INTERVAL_MS-(Date.now()-lastCompanionCallRef.current));if(pendingFollowupTimerRef.current)clearTimeout(pendingFollowupTimerRef.current);pendingFollowupTimerRef.current=setTimeout(()=>{pendingFollowupTimerRef.current=null;if(epoch===runEpochRef.current)void callCompanionRef.current(pending.event,pending.playerMessage,pending.force,pending.staticCueEligible)},delay)}
      }
    }
  },[refreshScene,beginTurnActivity,finishTurnActivity,recordTurnActivity,speakAndRevealAriadne,lingerChat]);
  useEffect(()=>{callCompanionRef.current=callCompanion},[callCompanion]);

  const beginClosure=useCallback((reason:ClosureReason)=>{
    if(closureStartedRef.current)return;closureStartedRef.current=true;heldRef.current.clear();document.exitPointerLock?.();pendingEventsRef.current=[];
    planningControllerRef.current?.controller.abort();planningControllerRef.current=null;
    if(activeRequestRef.current){activeRequestRef.current.preempted=true;activeRequestRef.current.controller.abort();activeRequestRef.current=null}requestInFlightRef.current=false;
    ariadneVoiceRef.current?.interrupt();voiceActivitySerialRef.current++;setVoiceActive(false);finishTurnActivity();
    const text=finalPreparedRef.current?interruptPreparedLine(finalPreparedRef.current,reason):finalAriadneLine(reason);
    const message:CompanionMessage={id:crypto.randomUUID(),role:"ariadne",text,time:Date.now()};
    setChatOpen(false);setExperienceState("ending");void speakAndRevealAriadne(message,()=>{const next=[...messagesRef.current,message].slice(-18);messagesRef.current=next;setCompanionMessages(next);closureTimerRef.current=setTimeout(()=>{closureTimerRef.current=null;setClosureRevealed(true)},2400)},()=>true,"final_hope");
  },[setExperienceState,finishTurnActivity,speakAndRevealAriadne]);

  useEffect(()=>{
    if(!ready||experience!=="playing"||!greetingCompleteRef.current)return;
    const current=runRef.current,pose=poseRef.current,geometry=forwardVisibleGeometry(current.world,pose,current.moves),environment=visibleEnvironment(current.anchors,geometry,pose);
    const newlyVisible=geometry.cells.filter(([x,y])=>!observedAfterGuidanceRef.current.has(cellKey(x,y)));
    newlyVisible.forEach(([x,y])=>{const key=cellKey(x,y);observedAfterGuidanceRef.current.add(key);newlyRevealedRef.current.add(key)});
    const activity=analyzePlayerActivity(trajectoryRef.current,Date.now(),lastMovementRef.current,lastTurnRef.current,geometry.junctions.length>0);
    const sample:TrajectorySample={time:Date.now(),position:[pose.x,pose.y],cell:[Math.floor(pose.x),Math.floor(pose.y)],heading:pose.angle,newlyVisibleCells:newlyVisible.slice(0,40),visibleJunctions:geometry.junctions.map(j=>j.id),visibleEnvironment:environment?.id??null,movementState:activity.state==="turning_in_place"?"turning":activity.state};
    trajectoryRef.current=[...trajectoryRef.current,sample].slice(-40);
    const locationId=cellKey(current.player.x,current.player.y),familiar=current.recent.slice(0,-1).includes(locationId);
    const trace=guidanceTraceRef.current,intent=trace?.recommendation??null,contradicted=!!intent&&geometry.corridorEnds.some(end=>intent.suggestedCells.some(cell=>cell[0]===end[0]&&cell[1]===end[1]));
    if(trace)guidanceTraceRef.current=appendGuidanceTrace(trace,sample,0,contradicted,familiar);
    const relation=guidanceTraceRef.current?trajectoryCue(guidanceTraceRef.current):null,perception=nextPerceptionCue(geometry,environment,null,seenPerceptionCuesRef.current),cue=strongestCue([relation,perception]);
    if(cue&&!(cue.event.type==="environment_visible"&&Date.now()<quietUntilRef.current)){
      seenPerceptionCuesRef.current.add(cue.key);
      if(cue.event.type==="trajectory_relationship_changed"&&guidanceTraceRef.current){guidanceTraceRef.current=markTrajectoryChange(guidanceTraceRef.current,cue.event.change);recordEncounter(cue.key,cue.event.change);if(cue.event.change==="left_then_rejoined")rememberRelationship("rejoined_ariadne","MT left Ariadne's suggested passage and later crossed back toward it.","Ariadne caught up and the two occupied the same route again.",.8);else if(cue.event.change==="sustained_divergence")rememberRelationship("diverged_from_commitment","MT travelled several cells into another passage.","The alternative route remained open and unsettled.",.55);else if(cue.event.change==="recommendation_visibly_contradicted")rememberRelationship("ariadne_mistake","Visible geometry contradicted Ariadne's committed route.","Ariadne recoiled and returned to MT.",.9)}
      else if(cue.event.type==="environment_visible")recordEncounter(cue.key,"new_environment");
      if(cue.event.type!=="trajectory_relationship_changed"||cue.event.change!=="sustained_alignment")callCompanion(cue.event,undefined,cue.force);
    }else if(familiar&&!seenFamiliarPlacesRef.current.has(locationId)){
      seenFamiliarPlacesRef.current.add(locationId);recordEncounter(`familiar:${locationId}`,"familiar_place");
    }
  },[run.revision,ready,experience,callCompanion,recordEncounter,rememberRelationship]);

  useEffect(()=>{
    if(!ready||experience!=="playing")return;const interval=setInterval(()=>{
      if(experienceRef.current!=="playing"||!greetingCompleteRef.current)return;
      const current=runRef.current,pose=poseRef.current,geometry=forwardVisibleGeometry(current.world,pose,current.moves),environment=visibleEnvironment(current.anchors,geometry,pose);
      const now=Date.now(),activity=analyzePlayerActivity(trajectoryRef.current,now,lastMovementRef.current,lastTurnRef.current,geometry.junctions.length>0),travelDelta=traceTravelAccumulatorRef.current,activeDelta=activeTravelAccumulatorRef.current;traceTravelAccumulatorRef.current=0;
      relationshipMemoryRef.current=advanceRelationshipTime(relationshipMemoryRef.current,current.objective.stage,activeDelta);const updatedJourney=updateJourney(journeyRef.current,activeDelta,current.visited.size);journeyRef.current={...updatedJourney,phase:relationshipBand(relationshipMemoryRef.current.position)};dispositionRef.current=advanceAriadneDisposition(dispositionRef.current,activeDelta,journeyRef.current.phase);activeTravelAccumulatorRef.current=0;
      const sample:TrajectorySample={time:now,position:[pose.x,pose.y],cell:[Math.floor(pose.x),Math.floor(pose.y)],heading:pose.angle,newlyVisibleCells:[],visibleJunctions:geometry.junctions.map(j=>j.id),visibleEnvironment:environment?.id??null,movementState:travelDelta>0?"walking":activity.state==="turning_in_place"?"turning":activity.state};
      trajectoryRef.current=[...trajectoryRef.current,sample].slice(-40);
      const trace=guidanceTraceRef.current,intent=trace?.recommendation??null,locationId=cellKey(current.player.x,current.player.y),familiar=current.recent.slice(0,-1).includes(locationId),contradicted=!!intent&&geometry.corridorEnds.some(end=>intent.suggestedCells.some(cell=>cell[0]===end[0]&&cell[1]===end[1]));
      const exitStartedAt=exitSearchStartedAtRef.current,ending=closureReason({activeWalkSeconds:journeyRef.current.activeWalkSeconds,exitSearchSeconds:exitStartedAt===null?0:journeyRef.current.activeWalkSeconds-exitStartedAt,inExitSearch:current.objective.stage===4,familiarGeometryReached:familiar});
      if(ending){beginClosure(ending);return}
      const exitSeconds=exitStartedAt===null?0:journeyRef.current.activeWalkSeconds-exitStartedAt;
      if(current.objective.stage===4&&exitSeconds>=45&&!finalPreparationRequestedRef.current){finalPreparationRequestedRef.current=true;callCompanion({type:"final_direction"},undefined,true)}
      if(trace)guidanceTraceRef.current=appendGuidanceTrace(trace,sample,travelDelta,contradicted,familiar);
      const relation=guidanceTraceRef.current?trajectoryCue(guidanceTraceRef.current):null,centeredEnd=centeredDeadEnd(current.world,geometry,pose,current.moves,DEAD_END_REACTION_DISTANCE),centeredKey=centeredEnd?cellKey(centeredEnd[0],centeredEnd[1]):null;
      const activeStar=current.objective.activeStar,isStarVisible=activeStarIsVisible(current,pose);let starEvent:CompanionEvent|null=null;
      if(activeStar&&isStarVisible&&!seenStarEventsRef.current.has(activeStar.id)){
        seenStarEventsRef.current.add(activeStar.id);const objective={...current.objective,activeStar:{...activeStar,seen:true}},next={...current,objective};runRef.current=next;setRun(next);
        starEvent={type:"star_visible",starId:activeStar.id,ordinal:activeStar.ordinal};
      }
      let approachEvent:CompanionEvent|null=null;
      if(!centeredKey)activeDeadEndRef.current=null;
      else if(activeDeadEndRef.current?.key!==centeredKey){
        activeDeadEndRef.current={key:centeredKey,lastTriggeredAt:now};
        const speechKey=`dead-end-speech:${current.objective.stage}:${centeredKey}`;
        if(!seenPerceptionCuesRef.current.has(speechKey)){seenPerceptionCuesRef.current.add(speechKey);recordEncounter(`dead-end:${centeredKey}`,"visible_dead_end");approachEvent={type:"dead_end_visible",cell:centeredEnd!}}
      }
      const cue=nextPerceptionCue(geometry,environment,null,seenPerceptionCuesRef.current);
      const pending=pendingEventsRef.current[0];
      if(starEvent)callCompanion(starEvent,undefined,true);
      else if(approachEvent)callCompanion(approachEvent,undefined,true);
      else if(relation){if(guidanceTraceRef.current&&relation.event.type==="trajectory_relationship_changed"){guidanceTraceRef.current=markTrajectoryChange(guidanceTraceRef.current,relation.event.change);recordEncounter(relation.key,relation.event.change)}if(relation.event.type!=="trajectory_relationship_changed"||relation.event.change!=="sustained_alignment")callCompanion(relation.event,undefined,relation.force)}
      else if(cue&&!(cue.event.type==="environment_visible"&&now<quietUntilRef.current)){seenPerceptionCuesRef.current.add(cue.key);if(cue.event.type==="environment_visible")recordEncounter(cue.key,"new_environment");callCompanion(cue.event,undefined,cue.force)}
      else if(pending&&!requestInFlightRef.current&&(pending.force||(pending.event.type==="player_message"?Date.now()>=providerBackoffUntilRef.current:Date.now()-lastCompanionCallRef.current>=companionCooldownMs(journeyRef.current.phase)))){pendingEventsRef.current.shift();callCompanion(pending.event,pending.playerMessage,pending.force,pending.staticCueEligible)}
      else{
        // The live perceived scene is itself a concrete anchor. Requiring an
        // older unspoken event here made Ariadne silent through ordinary play
        // after only one or two opening lines.
        if(now>=quietUntilRef.current&&shouldTriggerPassingThought(activity,now,nextPassingThoughtRef.current))callCompanion({type:"passing_thought"})
      }
      if(guidanceTraceRef.current&&guidanceTraceExpired(guidanceTraceRef.current)){guidanceTraceRef.current=null;guidanceRef.current=null}
    },1000);return()=>clearInterval(interval);
  },[ready,experience,callCompanion,recordEncounter,beginClosure]);

  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;const state=experienceRef.current,k=e.key.toLowerCase();
      if(e.key==="Escape"&&state==="playing"){e.preventDefault();heldRef.current.clear();document.exitPointerLock?.();setExperienceState("paused");return}
      if(e.key==="Escape"&&state==="paused"){e.preventDefault();setExperienceState("playing");canvasRef.current?.focus();return}
      if(state!=="playing")return;
      if(e.key==="Enter"){e.preventDefault();heldRef.current.clear();setChatOpen(true);requestAnimationFrame(()=>chatInputRef.current?.focus());return}if(k==="n"){e.preventDefault();setStoryIndex(0);setExperienceState("story");void initializeRun(randomSeed());return}if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(k)){e.preventDefault();heldRef.current.add(k)}};
    const up=(e:KeyboardEvent)=>heldRef.current.delete(e.key.toLowerCase()),blur=()=>heldRef.current.clear();
    const mouse=(e:MouseEvent)=>{if(document.pointerLockElement===canvasRef.current&&e.movementX!==0){poseRef.current.angle=wrap(poseRef.current.angle+e.movementX*.00125);lastTurnRef.current=Date.now();pauseObservedRef.current=false}};
    addEventListener("keydown",down);addEventListener("keyup",up);addEventListener("blur",blur);addEventListener("mousemove",mouse);
    return()=>{removeEventListener("keydown",down);removeEventListener("keyup",up);removeEventListener("blur",blur);removeEventListener("mousemove",mouse)};
  },[initializeRun,setExperienceState]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{const rect=canvas.getBoundingClientRect(),logicalHeight=360;canvas.height=logicalHeight;canvas.width=Math.max(480,Math.min(960,Math.round(logicalHeight*rect.width/Math.max(1,rect.height))))};
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();return()=>observer.disconnect();
  },[ready]);

  useEffect(()=>{
    let frame=0,previous=performance.now();
    const tick=(now:number)=>{
      const dt=Math.min((now-previous)/1000,.05);previous=now;const current=runRef.current,pose=poseRef.current,held=experienceRef.current==="playing"?heldRef.current:new Set<string>();
      let turn=0;if(held.has("a")||held.has("arrowleft"))turn--;if(held.has("d")||held.has("arrowright"))turn++;
      turnRampRef.current=advanceInputRamp(turnRampRef.current,turn,dt,TURN_ACCELERATION.rampSeconds);const turnSpeed=acceleratedSpeed(turnRampRef.current,TURN_ACCELERATION);
      if(turn!==0){pose.angle=wrap(pose.angle+turn*turnSpeed*dt);lastTurnRef.current=Date.now();pauseObservedRef.current=false}let drive=touchDriveRef.current;if(held.has("w")||held.has("arrowup"))drive=1;if(held.has("s")||held.has("arrowdown"))drive=-1;
      moveRampRef.current=advanceInputRamp(moveRampRef.current,drive,dt,MOVE_ACCELERATION.rampSeconds);const moveSpeed=acceleratedSpeed(moveRampRef.current,MOVE_ACCELERATION);
      const moving=drive!==0;let translatedThisFrame=0;if(moving){
        const beforeX=pose.x,beforeY=pose.y;
        const distance=drive*moveSpeed*dt,nx=pose.x+Math.cos(pose.angle)*distance,ny=pose.y+Math.sin(pose.angle)*distance,w=current.world;
        w.ensureAround(Math.floor(nx),Math.floor(ny),current.moves);
        const clearX=w.tile(Math.floor(nx-PLAYER_RADIUS),Math.floor(pose.y-PLAYER_RADIUS))===0&&w.tile(Math.floor(nx+PLAYER_RADIUS),Math.floor(pose.y+PLAYER_RADIUS))===0;if(clearX)pose.x=nx;
        const clearY=w.tile(Math.floor(pose.x-PLAYER_RADIUS),Math.floor(ny-PLAYER_RADIUS))===0&&w.tile(Math.floor(pose.x+PLAYER_RADIUS),Math.floor(ny+PLAYER_RADIUS))===0;if(clearY)pose.y=ny;
        const translated=Math.hypot(pose.x-beforeX,pose.y-beforeY);translatedThisFrame=translated;pose.bob+=dt*9;if(translated<.0005){collisionRef.current++;if(collisionRef.current===6)ambientSoundscapeRef.current?.playInteraction({kind:"collision",id:`collision:${Math.floor(pose.x)}:${Math.floor(pose.y)}`,position:[pose.x+Math.cos(pose.angle)*.45,pose.y+Math.sin(pose.angle)*.45],pose,theme:themeAt(current.anchors,pose.x,pose.y).id});if(collisionRef.current===24)callCompanion({type:"repeated_collision"})}else{collisionRef.current=0;lastMovementRef.current=Date.now();pauseObservedRef.current=false;if(!document.hidden){activeTravelAccumulatorRef.current+=dt;traceTravelAccumulatorRef.current+=dt}}
        const cell=cellKey(Math.floor(pose.x),Math.floor(pose.y));if(cell!==lastCellRef.current)enterCell(Math.floor(pose.x),Math.floor(pose.y));
        const resonanceChanges=activateNearbyResonance(current.resonance,[pose.x,pose.y],Date.now());
        for(const change of resonanceChanges){
          const encounter=current.resonance.encounters.get(change.encounterId),element=encounter?.elements.find(item=>item.id===change.elementId),interactionKind=change.completed?(change.starResponded?"star_response":"complete"):"wake",progress=encounter?encounter.elements.filter(item=>item.active).length/encounter.elements.length:undefined;
          ambientSoundscapeRef.current?.playInteraction({kind:interactionKind,id:change.elementId,position:element?.position??[pose.x,pose.y],pose,theme:encounter?.theme??themeAt(current.anchors,pose.x,pose.y).id,progress});
          reactAriadneToResonance(ariadneBodyRef.current,change.completed,Date.now());
          accomplishmentPulseRef.current={startedAt:Date.now(),gold:change.completed&&change.starResponded,completed:change.completed};
          if(!change.completed){
            // The first response from each incomplete configuration is a real
            // conversational beat: MT caused something to wake. Later parts
            // remain visual/body feedback so Ariadne never counts progress
            // aloud like a mechanical tutorial.
            const progressKey=`resonance-progress:${change.encounterId}`;
            sceneChangesRef.current=[...new Set([...sceneChangesRef.current,change.description])].slice(-12);
            if(!seenPerceptionCuesRef.current.has(progressKey)){
              seenPerceptionCuesRef.current.add(progressKey);
              void callCompanion({type:"scene_changed",sceneId:progressKey},undefined,true);
            }
            continue;
          }
          latestAccomplishmentRef.current=encounterContext(current.resonance,change.encounterId);
          recordEncounter(`resonance:${change.encounterId}`,"resonance_completion");
          const correctedAriadne=change.starResponded&&(guidanceTraceRef.current?.evidence.divergedSeconds??0)>=5;
          dispositionRef.current=recordDispositionMoment(dispositionRef.current,correctedAriadne?"corrected":"accomplished",journeyRef.current.phase);
          if(change.starResponded)beliefStateRef.current=resolveClaim(beliefStateRef.current,correctedAriadne?"corrected":"supported",interpretationFor(correctedAriadne?"corrected_ariadne":"shared_accomplishment",relationshipMemoryRef.current.position,true));
          rememberRelationship(correctedAriadne?"corrected_ariadne":change.starResponded?"shared_accomplishment":"proxy_accomplishment",change.starResponded?"MT awakened the entire structure and a gold tremor travelled toward the star.":"MT awakened the entire structure and the room folded into a persistent impossible form.",change.starResponded?"The star visibly answered with gold light.":"The transformed room persisted, but the star remained dark.",change.starResponded?.9:.72,beliefStateRef.current.unresolvedClaim?.proposition??null,change.encounterId);
          if(latestAccomplishmentRef.current?.whatChangedPermanently)sceneChangesRef.current=[...new Set([...sceneChangesRef.current,latestAccomplishmentRef.current.whatChangedPermanently])].slice(-12);
          prepareAriadneForEvent(ariadneBodyRef.current,"encounter_completed",Date.now());
          if(change.starResponded){
            setStarPulse(true);setTimeout(()=>setStarPulse(false),520);
            // Completion changes what the current view means. Re-evaluate an
            // already visible junction immediately so the reward hands MT a
            // new desire instead of waiting for them to leave and rediscover it.
            activeJunctionRef.current=null;lastSceneBuildRef.current=0;
          }
          const next={...current,revision:current.revision+1};runRef.current=next;setRun(next);
          void callCompanion({type:"encounter_completed",encounterId:change.encounterId,starResponded:change.starResponded},undefined,true);
        }
        collectActiveStar();
      }
      settleRealityTransformations(runRef.current.resonance,Date.now());
      const latest=runRef.current;
      if(now-lastSceneBuildRef.current>140){
        lastSceneBuildRef.current=now;
        const result=refreshScene(moving?"walking":turn!==0?"turning":"stationary"),visibleJunction=result.visibleJunction;
        observeMinimap(minimapMemoryRef.current,latest.world,pose,latest.moves,result.visibleGeometry.cells,undefined,result.visibleGeometry.junctions);
        const visibleEnd=centeredDeadEnd(latest.world,result.visibleGeometry,pose,latest.moves,DEAD_END_REACTION_DISTANCE),visibleEndKey=visibleEnd?cellKey(visibleEnd[0],visibleEnd[1]):null;
        if(!visibleEndKey)activeDeadEndRef.current=null;
        else if(activeDeadEndRef.current?.key!==visibleEndKey){
          const detectedAt=Date.now(),speechKey=`dead-end-speech:${latest.objective.stage}:${visibleEndKey}`;activeDeadEndRef.current={key:visibleEndKey,lastTriggeredAt:detectedAt};
          if(!seenPerceptionCuesRef.current.has(speechKey)){
            seenPerceptionCuesRef.current.add(speechKey);recordEncounter(`dead-end:${visibleEndKey}`,"visible_dead_end");
            prepareAriadneForEvent(ariadneBodyRef.current,"dead_end_visible",detectedAt);
            void callCompanion({type:"dead_end_visible",cell:visibleEnd!},undefined,true);
          }
        }
        if(!visibleJunction){
          activeJunctionRef.current=null;junctionHesitationRef.current=null;
          if(junctionRetryRef.current){clearTimeout(junctionRetryRef.current);junctionRetryRef.current=null}
        }else{
          const activeEpisode=embodiedEpisodeRef.current,decisionActive=!!activeEpisode&&activeEpisode.junctionId===visibleJunction.id&&activeEpisode.state!=="resolved";
          const hesitation=updateJunctionHesitation(junctionHesitationRef.current,visibleJunction,pose,Date.now(),decisionActive,translatedThisFrame>.0005);junctionHesitationRef.current=hesitation.state;
          if(activeJunctionRef.current!==visibleJunction.id){
            activeJunctionRef.current=visibleJunction.id;recordEncounter(`junction:${visibleJunction.id}`,"new_junction");
            const activeId=latest.objective.activeStar?.id??null,journeyPlan=activeId?latest.resonance.journeys.get(activeId):null,hasAccomplished=!journeyPlan||journeyPlan.encounterIds.some(id=>latest.resonance.encounters.get(id)?.completed),sinceCommitment=journeyRef.current.activeWalkSeconds-lastCommitmentWalkRef.current,commitmentInterval=latest.objective.stage===0?12:20,majorHub=hasAccomplished&&sinceCommitment>=commitmentInterval;
            // Ariadne still makes her own proactive commitments at meaningful
            // hubs. Pausing is an additional request for guidance at any
            // intersection, not a replacement for her initiative.
            if(majorHub){if(junctionHesitationRef.current)junctionHesitationRef.current.triggered=true;void beginEmbodiedJunction(visibleJunction.id)}
          }else if(hesitation.shouldCommit){
            if(junctionHesitationRef.current)junctionHesitationRef.current.triggered=true;
            void beginEmbodiedJunction(visibleJunction.id);
          }
        }
      }
      const journey=journeyRef.current,body=ariadneBodyRef.current;updateAriadneBody(body,{world:latest.world,tick:latest.moves,pose,phase:journey.phase,disposition:dispositionRef.current,playerSpeed:moving?moveSpeed:0,dt,now:Date.now(),reducedMotion});
      const voiceDx=body.position[0]-pose.x,voiceDy=body.position[1]-pose.y,voiceDistance=Math.hypot(voiceDx,voiceDy),voiceAngle=Math.atan2(voiceDy,voiceDx)-pose.angle,behind=Math.max(0,-Math.cos(voiceAngle));ariadneVoiceRef.current?.setSpatial(Math.sin(voiceAngle),voiceDistance+behind*.8);
      ambientSoundscapeRef.current?.update({playing:experienceRef.current==="playing",speaking:ariadneVoiceRef.current?.isBusy()??false,pose,entities:latest.entities,scene:sceneRef.current,theme:themeAt(latest.anchors,pose.x,pose.y).id});
      const episode=embodiedEpisodeRef.current;
      if(episode){
        const presence=describeAriadneEmbodiment(body,pose,latest.world,latest.moves,guidanceTraceRef.current?.evidence??null).presence;
        const transition=advanceEpisodeFromBody(episode,{motion:body.mode==="noticing_choice"?"noticing":body.mode==="leading"?"leading":body.mode==="marking_route"?"route_marked":"other",presence,followingLead:body.mtFollowingHerLead,choseAnotherRoute:body.mtChoseAnotherRoute,returningTowardAriadne:body.mtReturningToHer});
        const response=transition.response;embodiedEpisodeRef.current=transition.episode;
        if(response){const key=`${episode.id}:${response}`,active=activeRequestRef.current,coveredByInvitation=response==="followed"&&active?.speechAnchor.speechAct==="invite_to_visible_choice"&&speechAnchorIsCompatible(active.speechAnchor,embodiedEpisodeRef.current);if(!embodiedReactionRef.current.has(key)){embodiedReactionRef.current.add(key);dispositionRef.current=recordDispositionMoment(dispositionRef.current,response==="followed"?"followed":response==="rejoined"?"rejoined":"diverged",journey.phase);if(response==="followed")rememberRelationship("followed_commitment","MT travelled at least three cells into Ariadne's chosen passage.","The route is being tested; its result is not settled.",.45);else if(response==="rejoined")rememberRelationship("rejoined_ariadne","MT returned toward Ariadne after moving away.","Ariadne and MT occupy the same route again.",.75);else rememberRelationship("diverged_from_commitment","MT travelled at least three cells into a different passage.","Ariadne moved with MT before responding to the changed choice.",.65);if(response!=="followed"&&!coveredByInvitation)void callCompanion({type:"embodied_response",response},undefined,true)}}
      }
      if(body.departureRouteId)body.departureRouteId=null;
      const ctx=canvasRef.current?.getContext("2d");if(ctx){const messagePulse=Math.max(0,1-(Date.now()-messagePulseAtRef.current)/1400),pulseState=accomplishmentPulseRef.current,pulseAge=pulseState?(Date.now()-pulseState.startedAt)/(pulseState.completed?2800:1500):1,accomplishmentPulse=pulseAge<1?Math.max(0,1-pulseAge):0,visual:VisualFrameState={time:now*.001,movementSpeed:moving?moveSpeed:0,turnRate:turn*turnSpeed,collisionPulse:Math.min(1,collisionRef.current/24),relationshipPhase:journey.phase,relationshipIntensity:relationshipMemoryRef.current.position,collectedStars:latest.objective.collectedStars,activeStarVisible:sceneRef.current?.objective.starVisible??false,visibleRouteCount:sceneRef.current?.geometry.visibleOpenings.length??0,messagePulse,accomplishmentPulse,accomplishmentGold:pulseState?.gold??false,accomplishmentCompleted:pulseState?.completed??false,reducedMotion};const starReady=objectiveResonanceReady(latest.resonance,latest.objective.activeStar?.id??null),awarenessRadius=SPATIAL_VISIBILITY_DISTANCE+Math.min(8,latest.resonance.completedEncounterCount*.8+latest.resonance.permanentStarFragments),resonances=encountersForRender(latest.resonance,latest.objective.activeStar?.id??"exit",[pose.x,pose.y],awarenessRadius);renderWorld(ctx,latest.world,latest.anchors,latest.entities,latest.appearance,latest.appearanceProtected,pose,moving,reducedMotion,latest.moves,starReady?latest.objective.activeStar:null,sceneRef.current,visual,ariadneAwakeRef.current?ariadneBodyRef.current:null,resonances,latest.resonance);renderMinimap(ctx,minimapMemoryRef.current,pose,starReady?latest.objective.activeStar:null)}
      frame=requestAnimationFrame(tick);
    };frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[enterCell,callCompanion,collectActiveStar,reducedMotion,refreshScene,recordEncounter,beginEmbodiedJunction,rememberRelationship,beginTurnActivity,finishTurnActivity,speakAndRevealAriadne]);

  const sendToCompanion=async(e:React.FormEvent)=>{
    e.preventDefault();const text=companionInput.trim();if(!text)return;setCompanionInput("");setChatOpen(false);setChatAwaitingReply(true);setChatLingering(false);if(chatLingerTimerRef.current)clearTimeout(chatLingerTimerRef.current);chatLingerTimerRef.current=null;chatInputRef.current?.blur();heldRef.current.clear();
    const interruptedSpeech=ariadneVoiceRef.current?.isBusy()??false;ariadneVoiceRef.current?.interrupt();voiceActivitySerialRef.current++;setVoiceActive(false);if(interruptedSpeech)finishTurnActivity();
    if(/\b(stop talking|be quiet|quiet please|shut up|talk less|less talking)\b/i.test(text))quietUntilRef.current=Date.now()+60_000;
    const message:CompanionMessage={id:crypto.randomUUID(),role:"player",text:text.slice(0,500),time:Date.now(),kind:"player"};setCompanionMessages(old=>[...old,message].slice(-18));messagesRef.current=[...messagesRef.current,message].slice(-18);
    await callCompanion({type:"player_message",text:message.text},message.text,true);
  };
  const startStory=useCallback(()=>{setStoryIndex(0);setExperienceState("story")},[setExperienceState]);
  const enterGame=useCallback(()=>{
    if(!ready)return;ariadneVoiceRef.current?.unlock();ambientSoundscapeRef.current?.unlock();setExperienceState("playing");lastMovementRef.current=Date.now();lastTurnRef.current=lastMovementRef.current;pauseObservedRef.current=false;
    if(!ariadneAwakeRef.current){
      ariadneAwakeRef.current=true;greetingCompleteRef.current=true;
      const message:CompanionMessage={id:crypto.randomUUID(),role:"ariadne",text:OPENING_ARIADNE_LINE,time:Date.now(),kind:"authored_lore"};
      let revealed=false,voiceSerial=0;const reveal=()=>{if(revealed||experienceRef.current!=="playing")return;revealed=true;voiceSerial=++voiceActivitySerialRef.current;setVoiceActive(true);const next=[...messagesRef.current,message].slice(-18);messagesRef.current=next;setCompanionMessages(next);messagePulseAtRef.current=Date.now();speakAsAriadne(ariadneBodyRef.current,OPENING_ARIADNE_LINE,"initial_guidance",Date.now())};
      const voice=ariadneVoiceRef.current;if(!voice)reveal();else void voice.playCue("opening_premise",{onStart:reveal}).then(result=>{if(result==="spoken")lastVoiceEndedAtRef.current=Date.now();if(result==="failed")reveal();if(!voiceSerial||voiceActivitySerialRef.current===voiceSerial)setVoiceActive(false)});
    }
    requestAnimationFrame(()=>canvasRef.current?.focus());
  },[ready,setExperienceState]);
  const resumeGame=useCallback(()=>{ariadneVoiceRef.current?.unlock();ambientSoundscapeRef.current?.unlock();setExperienceState("playing");lastMovementRef.current=Date.now();lastTurnRef.current=lastMovementRef.current;requestAnimationFrame(()=>canvasRef.current?.focus())},[setExperienceState]);
  const endGame=useCallback(()=>{
    heldRef.current.clear();document.exitPointerLock?.();setExperienceState("title");setStoryIndex(0);
    if(activeRequestRef.current){activeRequestRef.current.preempted=true;activeRequestRef.current.controller.abort()}
    void initializeRun(randomSeed());
  },[initializeRun,setExperienceState]);
  const restartAfterClosure=useCallback(()=>{setStoryIndex(0);setExperienceState("title");void initializeRun(randomSeed())},[initializeRun,setExperienceState]);
  const beginTouch=useCallback((e:React.TouchEvent<HTMLCanvasElement>)=>{const rect=e.currentTarget.getBoundingClientRect();for(const touch of Array.from(e.changedTouches))touchControlsRef.current.set(touch.identifier,{kind:touch.clientX<rect.left+rect.width/2?"move":"look",startX:touch.clientX,startY:touch.clientY,lastX:touch.clientX})},[]);
  const moveTouch=useCallback((e:React.TouchEvent<HTMLCanvasElement>)=>{e.preventDefault();for(const touch of Array.from(e.changedTouches)){const control=touchControlsRef.current.get(touch.identifier);if(!control)continue;if(control.kind==="move")touchDriveRef.current=Math.max(-1,Math.min(1,(control.startY-touch.clientY)/54));else{poseRef.current.angle=wrap(poseRef.current.angle+(touch.clientX-control.lastX)*.0042);lastTurnRef.current=Date.now();pauseObservedRef.current=false;control.lastX=touch.clientX}}},[]);
  const endTouch=useCallback((e:React.TouchEvent<HTMLCanvasElement>)=>{for(const touch of Array.from(e.changedTouches)){const control=touchControlsRef.current.get(touch.identifier);touchControlsRef.current.delete(touch.identifier);if(control?.kind==="move")touchDriveRef.current=0}},[]);
  const starMarks=`${"★".repeat(run.objective.collectedStars)}${"☆".repeat(4-run.objective.collectedStars)}`;
  const displayedMessages=chatOpen?companionMessages:companionMessages.slice(-3);
  return <main className={`shell game-only ${starPulse?"star-pulse":""}`}>
    {experience==="title"&&<TitleScreen onStart={startStory} ready={ready}/>}
    {experience==="story"&&<StorySequence index={storyIndex} ready={ready} onAdvance={()=>setStoryIndex(value=>Math.min(value+1,7))} onSkip={enterGame} onComplete={enterGame}/>}
    {experience==="paused"&&<PauseMenu onResume={resumeGame} onGiveUp={endGame} masterVolume={masterVolume} onVolumeChange={setMasterVolume}/>}
    {experience==="ending"&&<ClosureScreen revealed={closureRevealed} onRestart={restartAfterClosure} onLeave={endGame}/>}
    {experience==="playing"&&!ready&&<div className="boot-screen" aria-live="polite"><span>OPENING THE GATE</span></div>}
    <section className="viewport-wrap" aria-label="Infinite first person maze game" aria-hidden={experience!=="playing"&&experience!=="paused"}><div className="objective-stars" aria-label={`${run.objective.collectedStars} of 4 stars collected`}>{starMarks}</div>
        <canvas ref={canvasRef} width={1280} height={720} tabIndex={0} aria-label="First-person view into an infinite maze" onClick={e=>{ariadneVoiceRef.current?.unlock();ambientSoundscapeRef.current?.unlock();e.currentTarget.requestPointerLock?.()}} onTouchStart={beginTouch} onTouchMove={moveTouch} onTouchEnd={endTouch} onTouchCancel={()=>{touchControlsRef.current.clear();touchDriveRef.current=0}}/>
        <div className="vignette comfort-vignette"/>{companionMessages.length>0&&(chatOpen||chatAwaitingReply||voiceActive||chatLingering)&&<div ref={chatHistoryRef} className={`ariadne-chat ${chatOpen?"chat-open":""} ${chatAwaitingReply?"awaiting-reply":""} ${voiceActive?"voice-active":""}`} role="log" aria-live="polite">{displayedMessages.map(message=><div key={message.id} className={`ariadne-chat-line ${message.role}`}><span>{message.role==="ariadne"?"<ARIADNE>":"<MT>"}</span> {message.text}</div>)}</div>}
        {chatOpen&&<form className="minecraft-chat-input" onSubmit={sendToCompanion}><span>&gt;</span><input ref={chatInputRef} aria-label="Message ARIADNE" value={companionInput} maxLength={500} onChange={e=>setCompanionInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.currentTarget.form?.requestSubmit()}else if(e.key==="Escape"){e.preventDefault();setChatOpen(false);setCompanionInput("");e.currentTarget.blur();canvasRef.current?.focus()}}} placeholder="Message ARIADNE"/></form>}
    </section>
  </main>;
}
