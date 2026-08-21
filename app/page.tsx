"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CACHE_RADIUS, InfiniteWorld, cellKey, chunkKey, createThemeScheduler } from "./world.mjs";
import { entitiesNear, renderWorld, type Pose } from "./renderer";
import { THEMES, retainThemeMemory, type AmbientEntity, type ThemeAnchor, type ThemeId, type ThemeMemory } from "./themes";
import { analyzePlayerActivity, appendGuidanceTrace, centeredDeadEnd, companionArc, companionCooldownMs, compactMap, createGuidanceIntent, createGuidanceTrace, createJourneyState, describeEgocentricView, deterministicReply, forwardVisibleGeometry, guidanceTraceExpired, instructionForCurrentChoice, isRecentCompanionRepeat, markTrajectoryChange, nearestVisibleJunction, nextPassingThoughtAt, nextPerceptionCue, planRoutes, planVisibleJunctionRoutes, rebaseSelectedRoute, recordJourneyEncounter, routesForEvent, shouldTriggerPassingThought, trajectoryCue, updateJourney, visibleEnvironment, type CompanionCue, type CompanionEvent, type CompanionMessage, type CompanionReply, type EncounterKind, type GuidanceIntent, type GuidanceTrace, type TrajectorySample } from "./companion";
import { chooseNavigationBeliefAsync, collectStar, createObjectiveStateAsync, emptyObjectiveState, objectiveProtectedChunks, publicObjective, queueNextStarAsync, releaseStarRoute, starCollectedAt, starVisible, type NavigationBelief, type ObjectiveState } from "./objectives";
import { messageConflictsWithRoute, messageIdentifiesRoute } from "./navigation-contracts";
import { closureReason, finalAriadneLine, type ClosureReason } from "./closure";
import { ClosureScreen, PauseMenu, StorySequence, TitleScreen, type ExperienceState } from "./opening";
import { acceleratedSpeed, advanceInputRamp, MOVE_ACCELERATION, TURN_ACCELERATION, type InputRamp } from "./movement";
import { buildPerceivedScene, createSceneMemory, sceneForPrompt, type PerceivedScene, type VisualFrameState } from "./scene";

const PLAYER_RADIUS=.18;
type MemoryCell={tile:number;seenAt:number};
type Run={
  seed:number;world:InfiniteWorld;anchors:ThemeAnchor[];entities:AmbientEntity[];
  memory:Map<string,MemoryCell>;appearance:ThemeMemory;appearanceProtected:Set<string>;visited:Set<string>;recent:string[];player:{x:number;y:number};
  spawnAngle:number;moves:number;shifts:number;message:string;revision:number;objective:ObjectiveState;
};

const wrap=(a:number)=>(a+Math.PI*2)%(Math.PI*2);
const bearing=(a:number)=>["E","S","W","N"][Math.round(wrap(a)/(Math.PI/2))%4];
const EVENT_PRIORITY:Record<CompanionEvent["type"],number>={initial_guidance:15,player_message:14,star_collected:13,star_visible:12,objective_changed:11,recommendation_contradicted:10,dead_end_visible:9,new_junction_visible:8,trajectory_relationship_changed:7,scene_changed:7,environment_visible:6,environment_entered:6,target_reached:5,same_target_reached_differently:5,revisited_position:2,sustained_backtrack:2,repeated_collision:2,idle:2,passing_thought:1};
const eventPriority=(event:CompanionEvent)=>EVENT_PRIORITY[event.type];
const strongestCue=(cues:Array<CompanionCue|null>)=>cues.filter((cue):cue is CompanionCue=>!!cue).sort((a,b)=>eventPriority(b.event)-eventPriority(a.event))[0]??null;
const objectiveIdentity=(run:Run)=>`${run.objective.stage}:${run.objective.activeStar?.id??"exit"}`;

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
  const pose={x:1.5,y:1.5,angle,bob:0};const memory=new Map<string,MemoryCell>(),appearanceProtected=visibleCells(world,pose,0);
  appearanceProtected.forEach(id=>{const[x,y]=id.split(",").map(Number);memory.set(id,{tile:world.tile(x,y),seenAt:0})});
  const visited=new Set(["1,1"]),objective=emptyObjectiveState(seed);
  return{seed,world,anchors:[],entities:[],memory,appearance:new Map(),appearanceProtected,visited,recent:["1,1"],player:{x:1,y:1},spawnAngle:angle,moves:0,shifts:0,message:"FOUR SIGNALS // THEN THE EXIT",revision:0,objective};
}

function randomSeed(){
  const value=new Uint32Array(1);crypto.getRandomValues(value);return value[0]||1;
}

export default function Home(){
  const[run,setRun]=useState<Run>(()=>newRun());const runRef=useRef(run);
  const[experience,setExperience]=useState<ExperienceState>("title"),experienceRef=useRef<ExperienceState>("title"),[storyIndex,setStoryIndex]=useState(0);
  const canvasRef=useRef<HTMLCanvasElement>(null),poseRef=useRef<Pose>({x:1.5,y:1.5,angle:run.spawnAngle,bob:0});
  const chatInputRef=useRef<HTMLInputElement>(null);
  const heldRef=useRef(new Set<string>()),lastCellRef=useRef("1,1"),touchXRef=useRef<number|null>(null);
  const moveRampRef=useRef<InputRamp>({heldSeconds:0,direction:0}),turnRampRef=useRef<InputRamp>({heldSeconds:0,direction:0});
  const schedulerRef=useRef<ReturnType<typeof createThemeScheduler>>(createThemeScheduler(run.seed));
  const[heading,setHeading]=useState(()=>bearing(run.spawnAngle));
  const[ready,setReady]=useState(false),bootedRef=useRef(false);
  const[companionMessages,setCompanionMessages]=useState<CompanionMessage[]>([]),messagesRef=useRef<CompanionMessage[]>([]);
  const[companionStatus,setCompanionStatus]=useState<"LISTENING"|"THINKING"|"LINK STABLE"|"LINK LOST">("LISTENING"),[companionInput,setCompanionInput]=useState(""),[chatOpen,setChatOpen]=useState(false);
  const[starPulse,setStarPulse]=useState(false),[reducedMotion,setReducedMotion]=useState(false),[closureRevealed,setClosureRevealed]=useState(false);
  const guidanceRef=useRef<GuidanceIntent|null>(null),guidanceTraceRef=useRef<GuidanceTrace|null>(null),trajectoryRef=useRef<TrajectorySample[]>([]),observedAfterGuidanceRef=useRef(new Set<string>()),newlyRevealedRef=useRef(new Set<string>());
  const seenPerceptionCuesRef=useRef(new Set<string>()),lastCompanionCallRef=useRef(0),nextPassingThoughtRef=useRef(0),requestInFlightRef=useRef(false),pendingEventsRef=useRef<Array<{event:CompanionEvent;force:boolean;playerMessage?:string}>>([]),lastMovementRef=useRef(0),lastTurnRef=useRef(0),pauseObservedRef=useRef(false),collisionRef=useRef(0),providerFailureRef=useRef(0);
  const callCompanionRef=useRef<(event:CompanionEvent,playerMessage?:string,force?:boolean)=>Promise<void>>(async()=>{});
  const seenFamiliarPlacesRef=useRef(new Set<string>());
  const journeyRef=useRef(createJourneyState()),journeyEncounterKeysRef=useRef(new Set<string>()),activeTravelAccumulatorRef=useRef(0),traceTravelAccumulatorRef=useRef(0),preferredModelRef=useRef<string|null>(null);
  const companionSessionRef=useRef(crypto.randomUUID());
  const quietUntilRef=useRef(0);
  const activeDeadEndRef=useRef<{key:string;lastTriggeredAt:number}|null>(null);
  const activeJunctionRef=useRef<string|null>(null);
  const seenStarEventsRef=useRef(new Set<string>()),collectingStarRef=useRef(false);
  const generationEpochRef=useRef(0),runEpochRef=useRef(0),objectiveEpochRef=useRef(0),greetingCompleteRef=useRef(false);
  const generationControllerRef=useRef<AbortController|null>(null),planningControllerRef=useRef<{controller:AbortController;priority:number}|null>(null);
  const activeRequestRef=useRef<{controller:AbortController;priority:number;preempted:boolean;runEpoch:number;objectiveEpoch:number;objectiveIdentity:string}|null>(null);
  const exitSearchStartedAtRef=useRef<number|null>(null),closureStartedRef=useRef(false),closureTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const sceneRef=useRef<PerceivedScene|null>(null),sceneMemoryRef=useRef(createSceneMemory()),sceneChangesRef=useRef<string[]>([]),seenMajorScenesRef=useRef(new Set<string>()),lastSceneBuildRef=useRef(0),messagePulseAtRef=useRef(0);
  const setExperienceState=useCallback((next:ExperienceState)=>{experienceRef.current=next;setExperience(next)},[]);
  const applyRun=useCallback((next:Run)=>{
    ++runEpochRef.current;objectiveEpochRef.current++;greetingCompleteRef.current=false;
    companionSessionRef.current=crypto.randomUUID();
    generationControllerRef.current?.abort();planningControllerRef.current?.controller.abort();planningControllerRef.current=null;
    if(activeRequestRef.current){activeRequestRef.current.preempted=true;activeRequestRef.current.controller.abort();activeRequestRef.current=null}requestInFlightRef.current=false;
    const scheduler=createThemeScheduler(next.seed);next.anchors=[plantCheckpoint(next.world,1,1,scheduler.nextTheme() as ThemeId,scheduler.nextAt,next.spawnAngle)];
    next.entities=entitiesNear(next.seed,next.world,next.anchors,next.appearance,1.5,1.5);runRef.current=next;schedulerRef.current=scheduler;heldRef.current.clear();
    poseRef.current={x:1.5,y:1.5,angle:next.spawnAngle,bob:0};lastCellRef.current="1,1";
    guidanceRef.current=null;guidanceTraceRef.current=null;trajectoryRef.current=[];observedAfterGuidanceRef.current=new Set();newlyRevealedRef.current=new Set();seenFamiliarPlacesRef.current=new Set();seenPerceptionCuesRef.current=new Set();seenStarEventsRef.current=new Set();collectingStarRef.current=false;pendingEventsRef.current=[];activeDeadEndRef.current=null;activeJunctionRef.current=null;journeyRef.current=createJourneyState();journeyEncounterKeysRef.current=new Set();activeTravelAccumulatorRef.current=0;traceTravelAccumulatorRef.current=0;preferredModelRef.current=null;quietUntilRef.current=0;providerFailureRef.current=0;lastCompanionCallRef.current=0;lastMovementRef.current=Date.now();lastTurnRef.current=lastMovementRef.current;nextPassingThoughtRef.current=nextPassingThoughtAt(lastMovementRef.current,"charming");pauseObservedRef.current=false;exitSearchStartedAtRef.current=null;closureStartedRef.current=false;sceneRef.current=null;sceneMemoryRef.current=createSceneMemory();sceneChangesRef.current=[];seenMajorScenesRef.current=new Set();lastSceneBuildRef.current=0;messagePulseAtRef.current=0;
    if(closureTimerRef.current)clearTimeout(closureTimerRef.current);closureTimerRef.current=null;
    setCompanionMessages([]);setCompanionStatus("LISTENING");setCompanionInput("");setChatOpen(false);setStarPulse(false);setClosureRevealed(false);setHeading(bearing(next.spawnAngle));setRun(next);
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
      applyRun({...draft,objective});setReady(true);
    }catch(error){if(!(error instanceof DOMException&&error.name==="AbortError"))console.warn("ARIADNE signal generation failed",error)}
  },[applyRun]);
  useEffect(()=>{runRef.current=run},[run]);
  useEffect(()=>{messagesRef.current=companionMessages},[companionMessages]);
  useEffect(()=>{
    const query=window.matchMedia("(prefers-reduced-motion: reduce)"),sync=()=>setReducedMotion(query.matches);sync();query.addEventListener("change",sync);return()=>query.removeEventListener("change",sync);
  },[]);
  useEffect(()=>{
    if(bootedRef.current)return;bootedRef.current=true;void initializeRun(randomSeed());
  },[initializeRun]);

  const enterCell=useCallback((x:number,y:number)=>{
    const id=cellKey(x,y);lastCellRef.current=id;lastMovementRef.current=Date.now();collisionRef.current=0;
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
      world.ensureAround(x,y,moves);const before=world.chunks.size;world.prune(x,y,protectedChunks,moves);if(world.chunks.size<before)shifts++;
      const memory=new Map(current.memory);
      visible.forEach(cell=>{const[cx,cy]=cell.split(",").map(Number);memory.set(cell,{tile:world.tile(cx,cy,moves),seenAt:moves})});
      for(const[cell,value]of memory)if(moves-value.seenAt>80)memory.delete(cell);
      const pc=world.coords(x,y);anchors=anchors.filter(a=>Math.abs(world.coords(a.x,a.y).cx-pc.cx)<=CACHE_RADIUS+1&&Math.abs(world.coords(a.x,a.y).cy-pc.cy)<=CACHE_RADIUS+1);
      const appearanceProtected=new Set([...visible,...recent]),appearance=current.appearance;retainThemeMemory(appearance,appearanceProtected);
      const collageIntensity=Math.min(1,journeyRef.current.relationshipDepth/38+current.objective.collectedStars*.04),entities=entitiesNear(current.seed,world,anchors,appearance,x+.5,y+.5,collageIntensity);
      const next={...current,anchors,entities,memory,appearanceProtected,visited,recent,player:{x,y},moves,shifts,message,revision:current.revision+1};
      runRef.current=next;setRun(next);
  },[]);

  const recordEncounter=useCallback((key:string,kind:EncounterKind)=>{
    if(journeyEncounterKeysRef.current.has(key))return;
    journeyEncounterKeysRef.current.add(key);journeyRef.current=recordJourneyEncounter(journeyRef.current,kind);
  },[]);

  const refreshScene=useCallback((movementState:"walking"|"turning"|"stationary"="stationary")=>{
    const current=runRef.current,pose=poseRef.current,geometry=forwardVisibleGeometry(current.world,pose,current.moves),routes=planRoutes(current.world,pose,current.moves,current.memory,current.visited),journey=journeyRef.current;
    const result=buildPerceivedScene({seed:current.seed,world:current.world,anchors:current.anchors,entities:current.entities,pose,tick:current.moves,visibleCells:geometry.cells,routeDirections:routes.map(route=>route.direction),visibleJunction:geometry.junctions.length>0,visibleEndAhead:!!centeredDeadEnd(current.world,geometry,pose,current.moves),activeStar:current.objective.activeStar,phase:journey.phase,relationshipIntensity:Math.min(1,journey.relationshipDepth/38+current.objective.collectedStars*.04),collectedStars:current.objective.collectedStars,movementState,memory:sceneMemoryRef.current,reducedMotion});
    sceneRef.current=result.scene;if(result.changes.length)sceneChangesRef.current=[...new Set([...sceneChangesRef.current,...result.changes])].slice(-12);
    return result;
  },[reducedMotion]);

  const collectActiveStar=useCallback(()=>{
    if(collectingStarRef.current)return;const current=runRef.current,active=current.objective.activeStar,pose=poseRef.current;
    if(!active||!starCollectedAt(current.objective,[pose.x,pose.y]))return;
    collectingStarRef.current=true;
    const objective=collectStar(current.objective,current.world,current.seed,current.visited,current.moves);
    const next={...current,objective,revision:current.revision+1};objectiveEpochRef.current++;runRef.current=next;setRun(next);recordEncounter(`star-collected:${active.id}`,"star_collected");
    if(active.ordinal===4)exitSearchStartedAtRef.current=journeyRef.current.activeWalkSeconds;
    setStarPulse(true);setTimeout(()=>setStarPulse(false),800);
    void callCompanionRef.current({type:"star_collected",starId:active.id,ordinal:active.ordinal},undefined,true);
    collectingStarRef.current=false;
  },[recordEncounter]);

  useEffect(()=>{
    const activeId=run.objective.activeStar?.id;if(!ready||!activeId||run.objective.queuedStar||run.objective.activeStar?.ordinal===4)return;
    const epoch=runEpochRef.current,controller=new AbortController();let cancelled=false;const prepare=async()=>{if(cancelled)return;const current=runRef.current;if(current.objective.activeStar?.id!==activeId||current.objective.queuedStar)return;
      try{
        const objective=await queueNextStarAsync(current.objective,current.world,current.seed,current.visited,current.moves,controller.signal),generated=objective.queuedStar!==current.objective.queuedStar?objective.queuedStar:null;
        if(cancelled||runEpochRef.current!==epoch||runRef.current.objective.activeStar?.id!==activeId||objective===current.objective){if(generated)releaseStarRoute(current.world,generated);return}
        const latest=runRef.current,next={...latest,objective};runRef.current=next;setRun(next);
      }catch(error){if(!(error instanceof DOMException&&error.name==="AbortError"))console.warn("ARIADNE star preparation failed",error)}};
    const idle=window.requestIdleCallback?.(()=>prepare(),{timeout:1200}),timer=idle===undefined?window.setTimeout(prepare,30):undefined;
    return()=>{cancelled=true;controller.abort();if(idle!==undefined)window.cancelIdleCallback?.(idle);if(timer!==undefined)window.clearTimeout(timer)};
  },[ready,run.objective.activeStar?.id,run.objective.activeStar?.ordinal,run.objective.queuedStar]);

  const callCompanion=useCallback(async(event:CompanionEvent,playerMessage?:string,force=false)=>{
    const now=Date.now();
    const eventKey=(value:CompanionEvent)=>value.type==="trajectory_relationship_changed"?`${value.type}:${value.change}`:value.type==="star_visible"||value.type==="star_collected"?`${value.type}:${value.starId}`:value.type==="scene_changed"?`${value.type}:${value.sceneId}`:value.type;
    const queue=()=>{const key=eventKey(event),index=pendingEventsRef.current.findIndex(item=>eventKey(item.event)===key),queued={event,force,playerMessage};if(index>=0)pendingEventsRef.current[index]={...pendingEventsRef.current[index],...queued,force:pendingEventsRef.current[index].force||force};else pendingEventsRef.current.push(queued);pendingEventsRef.current.sort((a,b)=>eventPriority(b.event)-eventPriority(a.event));pendingEventsRef.current=pendingEventsRef.current.slice(0,6)};
    if(requestInFlightRef.current){queue();const active=activeRequestRef.current,planning=planningControllerRef.current;if(force&&active&&eventPriority(event)>active.priority){active.preempted=true;active.controller.abort()}if(force&&planning&&eventPriority(event)>planning.priority)planning.controller.abort();return}
    const phaseAtCall=journeyRef.current.phase,cooldown=companionCooldownMs(phaseAtCall);
    if(!force&&now-lastCompanionCallRef.current<cooldown){queue();return}
    let current=runRef.current;const pose=poseRef.current,geometry=forwardVisibleGeometry(current.world,pose,current.moves),environment=visibleEnvironment(current.anchors,geometry,pose);
    const currentRoutes=planRoutes(current.world,pose,current.moves,current.memory,current.visited),visibleJunctionRoutes=event.type==="new_junction_visible"?planVisibleJunctionRoutes(current.world,pose,current.moves,geometry,current.memory,current.visited):[];
    const routes=routesForEvent(event,currentRoutes,visibleJunctionRoutes),egocentricView=describeEgocentricView(current.world,pose,current.moves,currentRoutes),intent=guidanceRef.current;
    const activity=analyzePlayerActivity(trajectoryRef.current,now,lastMovementRef.current,lastTurnRef.current,geometry.junctions.length>0),sceneResult=refreshScene(activity.state==="turning_in_place"?"turning":activity.state),sceneAtRequest=sceneResult.scene,sceneChangesAtRequest=sceneChangesRef.current.slice(-8);
    const evidence=guidanceTraceRef.current?.evidence??null,currentArc=companionArc(journeyRef.current);
    const activeStarVisible=starVisible(current.world,current.objective,pose,current.moves);
    const navigationEvents=new Set<CompanionEvent["type"]>(["initial_guidance","new_junction_visible","dead_end_visible","recommendation_contradicted","target_reached","same_target_reached_differently","revisited_position","repeated_collision","player_message","star_visible","star_collected","objective_changed"]);
    let belief:NavigationBelief|null=null;
    if(event.type==="new_junction_visible"&&routes.length){
      const junctionId=nearestVisibleJunction(geometry,pose)?.id??`junction:${current.player.x},${current.player.y}`;
      const planningRunEpoch=runEpochRef.current,planningObjectiveEpoch=objectiveEpochRef.current,planningToken={controller:new AbortController(),priority:eventPriority(event)};planningControllerRef.current=planningToken;requestInFlightRef.current=true;setCompanionStatus("THINKING");let planningCancelled=false,ownsPlanning=false;
      try{
        const chosen=await chooseNavigationBeliefAsync(current.objective,routes,junctionId,current.world,current.seed,activeStarVisible,current.moves,planningToken.controller.signal),latest=runRef.current,latestJunction=nearestVisibleJunction(forwardVisibleGeometry(latest.world,poseRef.current,latest.moves),poseRef.current);
        if(runEpochRef.current!==planningRunEpoch||objectiveEpochRef.current!==planningObjectiveEpoch||latestJunction?.id!==junctionId)planningCancelled=true;
        else{belief=chosen.belief;if(chosen.state!==latest.objective){current={...latest,objective:chosen.state};runRef.current=current;setRun(current)}else current=latest}
      }catch(error){
        if(error instanceof DOMException&&error.name==="AbortError"||runEpochRef.current!==planningRunEpoch)planningCancelled=true;
        else{console.warn("ARIADNE route planning fell back to local geometry",error);const route=routes[0];belief={id:`local:junction:${junctionId}`,objectiveStage:current.objective.stage,junctionId,routeId:route.id,instruction:route.instruction}}
      }finally{
        ownsPlanning=planningControllerRef.current===planningToken;
        if(ownsPlanning){planningControllerRef.current=null;requestInFlightRef.current=false}
      }
      if(planningCancelled){if(!ownsPlanning||runEpochRef.current!==planningRunEpoch)return;setCompanionStatus("LINK STABLE");const pending=pendingEventsRef.current.shift();if(pending)queueMicrotask(()=>{void callCompanionRef.current(pending.event,pending.playerMessage,pending.force)});return}
    }else if(navigationEvents.has(event.type)&&routes.length){
      const target=current.objective.activeStar?.cell;
      const route=event.type==="star_visible"&&target?routes.slice().sort((a,b)=>{
        const end=(item:typeof a)=>item.targetCell??item.knownCells.at(-1)??item.knownCells[0];const ae=end(a),be=end(b);
        return Math.hypot((ae?.[0]??0)-target[0],(ae?.[1]??0)-target[1])-Math.hypot((be?.[0]??0)-target[0],(be?.[1]??0)-target[1]);
      })[0]:routes[0];
      if(route)belief={id:`local:${event.type}:${current.player.x},${current.player.y}`,objectiveStage:current.objective.stage,junctionId:`local:${current.player.x},${current.player.y}`,routeId:route.id,instruction:route.instruction};
    }
    const objectiveEvent=event.type==="star_visible"?"star_visible":event.type==="star_collected"?"star_collected":event.type==="objective_changed"?"objective_changed":"searching";
    const objectiveContext=publicObjective(current.objective,activeStarVisible,objectiveEvent);
    const requestToken={controller:new AbortController(),priority:eventPriority(event),preempted:false,runEpoch:runEpochRef.current,objectiveEpoch:objectiveEpochRef.current,objectiveIdentity:objectiveIdentity(current)};activeRequestRef.current=requestToken;
    const requestIsCurrent=()=>experienceRef.current==="playing"&&!requestToken.preempted&&activeRequestRef.current===requestToken&&runEpochRef.current===requestToken.runEpoch&&objectiveEpochRef.current===requestToken.objectiveEpoch&&objectiveIdentity(runRef.current)===requestToken.objectiveIdentity;
    const requestTimeout=setTimeout(()=>requestToken.controller.abort(),25000);
    let published=false;
    requestInFlightRef.current=true;lastCompanionCallRef.current=now;nextPassingThoughtRef.current=nextPassingThoughtAt(now,currentArc.phase);setCompanionStatus("THINKING");
    try{
      const response=await fetch("/api/companion",{method:"POST",headers:{"content-type":"application/json"},signal:requestToken.controller.signal,body:JSON.stringify({sessionId:companionSessionRef.current,trigger:event,activity,recommendation:intent,recommendationEvidence:evidence,actualTrajectory:trajectoryRef.current.slice(-32),currentView:egocentricView,environment,perceivedScene:sceneForPrompt(sceneAtRequest),sceneChanges:sceneChangesAtRequest,rememberedMap:compactMap(current.memory,[current.player.x,current.player.y]),legalRoutes:routes,recentMessages:messagesRef.current.slice(-8),olderContextSummary:messagesRef.current.slice(0,-8).slice(-8).map(m=>`${m.role==="player"?"MT":"ARIADNE"}: ${m.text}`).join(" | "),companionArc:currentArc,objective:objectiveContext,navigationBelief:belief,playerMessage,preferredModelId:preferredModelRef.current})});
      if(!requestIsCurrent())return;
      if(!response.ok)throw new Error(`companion request failed: ${response.status}`);
      const reply=await response.json() as CompanionReply&{source?:"provider"|"fallback";modelUsed?:string|null};
      if(!requestIsCurrent())return;
      if(reply.source==="provider"){providerFailureRef.current=0;if(reply.modelUsed)preferredModelRef.current=reply.modelUsed}
      else{providerFailureRef.current++;nextPassingThoughtRef.current=Date.now()+Math.min(5000*providerFailureRef.current,15000)}
      const selectedAtRequest=routes.find(r=>r.id===belief?.routeId)??null;
      const latest=runRef.current,latestPose=poseRef.current,latestGeometry=forwardVisibleGeometry(latest.world,latestPose,latest.moves);
      const latestVisibleJunction=event.type==="new_junction_visible"?planVisibleJunctionRoutes(latest.world,latestPose,latest.moves,latestGeometry,latest.memory,latest.visited):[];
      const latestCurrentRoutes=planRoutes(latest.world,latestPose,latest.moves,latest.memory,latest.visited);
      const latestRoutes=routesForEvent(event,latestCurrentRoutes,latestVisibleJunction);
      const guidesNow=["initial_guidance","new_junction_visible","dead_end_visible","recommendation_contradicted","target_reached","same_target_reached_differently","revisited_position","repeated_collision","player_message","star_visible","star_collected","objective_changed"].includes(event.type)||(event.type==="idle"&&event.atChoice&&!intent);
      const rebased=selectedAtRequest?rebaseSelectedRoute(selectedAtRequest,latestRoutes):null;
      if(selectedAtRequest&&!rebased&&event.type!=="initial_guidance")return;
      const route=rebased??(guidesNow?latestRoutes[0]??null:null);
      const replyText=event.type==="initial_guidance"&&selectedAtRequest&&!rebased?"Hi, MT—I’m Ariadne. I’m here to help you find four stars, then the exit.":reply.message.trim();
      const safeReply=route&&messageConflictsWithRoute(replyText,route)?deterministicReply(event,latestRoutes,environment,evidence,currentArc.phase,objectiveContext,belief,sceneChangesAtRequest[0]):reply,safeText=safeReply===reply?replyText:safeReply.message;
      const spokenInstruction=guidesNow?instructionForCurrentChoice(route,latestRoutes):"",needsInstruction=!!route&&!!spokenInstruction&&!messageIdentifiesRoute(safeText,route),finalText=[safeText,needsInstruction?spokenInstruction:""].filter(Boolean).join(" ");
      const repeated=isRecentCompanionRepeat(finalText,messagesRef.current);
      if(finalText&&!repeated){
        const message:CompanionMessage={id:crypto.randomUUID(),role:"ariadne",text:finalText,time:Date.now(),kind:safeReply.kind};
        const next=[...messagesRef.current,message].slice(-18);messagesRef.current=next;setCompanionMessages(next);
        published=true;nextPassingThoughtRef.current=nextPassingThoughtAt(Date.now(),journeyRef.current.phase);
        messagePulseAtRef.current=Date.now();sceneChangesRef.current=sceneChangesRef.current.filter(change=>!sceneChangesAtRequest.includes(change));
      }else if(event.type==="initial_guidance"&&repeated)published=true;
      const groundedReply={...safeReply,message:repeated?"":finalText},nextIntent=!repeated&&spokenInstruction?createGuidanceIntent(groundedReply,route,{...latestPose}):null;
      if(nextIntent){guidanceRef.current=nextIntent;guidanceTraceRef.current=createGuidanceTrace(nextIntent);traceTravelAccumulatorRef.current=0;trajectoryRef.current=[];observedAfterGuidanceRef.current=new Set(latestGeometry.cells.map(([x,y])=>cellKey(x,y)));newlyRevealedRef.current=new Set()}
    }catch(error){
      if(requestIsCurrent()){
        providerFailureRef.current++;nextPassingThoughtRef.current=Date.now()+Math.min(5000*providerFailureRef.current,15000);console.warn("ARIADNE request will retry after a transient failure",error);
        const fallback=deterministicReply(event,routes,environment,evidence,currentArc.phase,objectiveContext,belief,sceneChangesAtRequest[0]),route=routes.find(item=>item.id===belief?.routeId)??null,instruction=route?instructionForCurrentChoice(route,routes):"",text=[fallback.message,instruction&&route&&!messageIdentifiesRoute(fallback.message,route)?instruction:""] .filter(Boolean).join(" ");
        const repeated=isRecentCompanionRepeat(text,messagesRef.current);
        if(text&&!repeated){const message:CompanionMessage={id:crypto.randomUUID(),role:"ariadne",text,time:Date.now(),kind:fallback.kind};const next=[...messagesRef.current,message].slice(-18);messagesRef.current=next;setCompanionMessages(next);published=true}else if(event.type==="initial_guidance"&&repeated)published=true;
      }
    }finally{
      clearTimeout(requestTimeout);
      if(activeRequestRef.current===requestToken){
        activeRequestRef.current=null;requestInFlightRef.current=false;if(requestToken.runEpoch===runEpochRef.current)setCompanionStatus("LINK STABLE");
        if(event.type==="initial_guidance"&&requestToken.runEpoch===runEpochRef.current){greetingCompleteRef.current=published;if(!published)queueMicrotask(()=>{void callCompanionRef.current({type:"initial_guidance"},undefined,true)})}
        const pending=pendingEventsRef.current[0];if(pending?.force){pendingEventsRef.current.shift();queueMicrotask(()=>{void callCompanionRef.current(pending.event,pending.playerMessage,true)})}
      }
    }
  },[refreshScene]);
  useEffect(()=>{callCompanionRef.current=callCompanion},[callCompanion]);

  const beginClosure=useCallback((reason:ClosureReason)=>{
    if(closureStartedRef.current)return;closureStartedRef.current=true;heldRef.current.clear();document.exitPointerLock?.();pendingEventsRef.current=[];
    planningControllerRef.current?.controller.abort();planningControllerRef.current=null;
    if(activeRequestRef.current){activeRequestRef.current.preempted=true;activeRequestRef.current.controller.abort();activeRequestRef.current=null}requestInFlightRef.current=false;
    const message:CompanionMessage={id:crypto.randomUUID(),role:"ariadne",text:finalAriadneLine(reason),time:Date.now(),kind:"guidance"};
    const next=[...messagesRef.current,message].slice(-18);messagesRef.current=next;setCompanionMessages(next);setCompanionStatus("LINK LOST");setChatOpen(false);setExperienceState("ending");
    closureTimerRef.current=setTimeout(()=>{closureTimerRef.current=null;setClosureRevealed(true)},2400);
  },[setExperienceState]);

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
      if(cue.event.type==="trajectory_relationship_changed"&&guidanceTraceRef.current){guidanceTraceRef.current=markTrajectoryChange(guidanceTraceRef.current,cue.event.change);recordEncounter(cue.key,cue.event.change)}
      else if(cue.event.type==="environment_visible")recordEncounter(cue.key,"new_environment");
      callCompanion(cue.event,undefined,cue.force);
    }else if(familiar&&!seenFamiliarPlacesRef.current.has(locationId)){
      seenFamiliarPlacesRef.current.add(locationId);recordEncounter(`familiar:${locationId}`,"familiar_place");callCompanion({type:"revisited_position"});
    }
  },[run.revision,ready,experience,callCompanion,recordEncounter]);

  useEffect(()=>{
    if(!ready||experience!=="playing")return;const interval=setInterval(()=>{
      if(experienceRef.current!=="playing"||!greetingCompleteRef.current)return;
      const current=runRef.current,pose=poseRef.current,geometry=forwardVisibleGeometry(current.world,pose,current.moves),environment=visibleEnvironment(current.anchors,geometry,pose);
      const now=Date.now(),activity=analyzePlayerActivity(trajectoryRef.current,now,lastMovementRef.current,lastTurnRef.current,geometry.junctions.length>0),travelDelta=traceTravelAccumulatorRef.current;traceTravelAccumulatorRef.current=0;
      journeyRef.current=updateJourney(journeyRef.current,activeTravelAccumulatorRef.current,current.visited.size);activeTravelAccumulatorRef.current=0;
      const sample:TrajectorySample={time:now,position:[pose.x,pose.y],cell:[Math.floor(pose.x),Math.floor(pose.y)],heading:pose.angle,newlyVisibleCells:[],visibleJunctions:geometry.junctions.map(j=>j.id),visibleEnvironment:environment?.id??null,movementState:travelDelta>0?"walking":activity.state==="turning_in_place"?"turning":activity.state};
      trajectoryRef.current=[...trajectoryRef.current,sample].slice(-40);
      const trace=guidanceTraceRef.current,intent=trace?.recommendation??null,locationId=cellKey(current.player.x,current.player.y),familiar=current.recent.slice(0,-1).includes(locationId),contradicted=!!intent&&geometry.corridorEnds.some(end=>intent.suggestedCells.some(cell=>cell[0]===end[0]&&cell[1]===end[1]));
      const exitStartedAt=exitSearchStartedAtRef.current,ending=closureReason({activeWalkSeconds:journeyRef.current.activeWalkSeconds,exitSearchSeconds:exitStartedAt===null?0:journeyRef.current.activeWalkSeconds-exitStartedAt,inExitSearch:current.objective.stage===4,familiarGeometryReached:familiar});
      if(ending){beginClosure(ending);return}
      if(trace)guidanceTraceRef.current=appendGuidanceTrace(trace,sample,travelDelta,contradicted,familiar);
      const relation=guidanceTraceRef.current?trajectoryCue(guidanceTraceRef.current):null,centeredEnd=centeredDeadEnd(current.world,geometry,pose,current.moves),centeredKey=centeredEnd?cellKey(centeredEnd[0],centeredEnd[1]):null;
      const activeStar=current.objective.activeStar,isStarVisible=starVisible(current.world,current.objective,pose,current.moves);let starEvent:CompanionEvent|null=null;
      if(activeStar&&isStarVisible&&!seenStarEventsRef.current.has(activeStar.id)){
        seenStarEventsRef.current.add(activeStar.id);const objective={...current.objective,activeStar:{...activeStar,seen:true}},next={...current,objective};runRef.current=next;setRun(next);
        starEvent={type:"star_visible",starId:activeStar.id,ordinal:activeStar.ordinal};
      }
      let approachEvent:CompanionEvent|null=null;
      if(!centeredKey)activeDeadEndRef.current=null;
      else if(activeDeadEndRef.current?.key!==centeredKey||now-activeDeadEndRef.current.lastTriggeredAt>=20000){activeDeadEndRef.current={key:centeredKey,lastTriggeredAt:now};recordEncounter(`dead-end:${centeredKey}`,"visible_dead_end");approachEvent={type:"dead_end_visible",cell:centeredEnd!}}
      const visibleJunction=nearestVisibleJunction(geometry,pose);let junctionEvent:CompanionEvent|null=null;
      if(!visibleJunction)activeJunctionRef.current=null;
      else if(activeJunctionRef.current!==visibleJunction.id){activeJunctionRef.current=visibleJunction.id;recordEncounter(`junction:${visibleJunction.id}`,"new_junction");junctionEvent={type:"new_junction_visible"}}
      const cue=nextPerceptionCue(geometry,environment,null,seenPerceptionCuesRef.current);
      const pending=pendingEventsRef.current[0];
      if(starEvent)callCompanion(starEvent,undefined,true);
      else if(approachEvent)callCompanion(approachEvent,undefined,true);
      else if(junctionEvent)callCompanion(junctionEvent,undefined,true);
      else if(relation){if(guidanceTraceRef.current&&relation.event.type==="trajectory_relationship_changed"){guidanceTraceRef.current=markTrajectoryChange(guidanceTraceRef.current,relation.event.change);recordEncounter(relation.key,relation.event.change)}callCompanion(relation.event,undefined,relation.force)}
      else if(cue&&!(cue.event.type==="environment_visible"&&now<quietUntilRef.current)){seenPerceptionCuesRef.current.add(cue.key);if(cue.event.type==="environment_visible")recordEncounter(cue.key,"new_environment");callCompanion(cue.event,undefined,cue.force)}
      else if(pending&&!requestInFlightRef.current&&(pending.force||Date.now()-lastCompanionCallRef.current>=companionCooldownMs(journeyRef.current.phase))){pendingEventsRef.current.shift();callCompanion(pending.event,pending.playerMessage,pending.force)}
      else{
        if(activity.state==="stationary"&&activity.stationarySeconds>=25&&!pauseObservedRef.current){pauseObservedRef.current=true;callCompanion({type:"idle",atChoice:activity.atVisibleChoice})}
        else if(now>=quietUntilRef.current&&shouldTriggerPassingThought(activity,now,nextPassingThoughtRef.current))callCompanion({type:"passing_thought"})
      }
      if(guidanceTraceRef.current&&guidanceTraceExpired(guidanceTraceRef.current)){guidanceTraceRef.current=null;guidanceRef.current=null}
    },1000);return()=>clearInterval(interval);
  },[ready,experience,callCompanion,recordEncounter,beginClosure]);

  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;const state=experienceRef.current,k=e.key.toLowerCase();
      if(e.key==="Escape"&&state==="playing"){e.preventDefault();heldRef.current.clear();document.exitPointerLock?.();if(activeRequestRef.current){activeRequestRef.current.preempted=true;activeRequestRef.current.controller.abort()}setExperienceState("paused");return}
      if(e.key==="Escape"&&state==="paused"){e.preventDefault();setExperienceState("playing");canvasRef.current?.focus();return}
      if(state!=="playing")return;
      if(e.key==="Enter"){e.preventDefault();heldRef.current.clear();setChatOpen(true);requestAnimationFrame(()=>chatInputRef.current?.focus());return}if(k==="n"){e.preventDefault();void initializeRun(randomSeed());return}if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(k)){e.preventDefault();heldRef.current.add(k)}};
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
      if(turn!==0){pose.angle=wrap(pose.angle+turn*turnSpeed*dt);lastTurnRef.current=Date.now();pauseObservedRef.current=false}let drive=0;if(held.has("w")||held.has("arrowup"))drive++;if(held.has("s")||held.has("arrowdown"))drive--;
      moveRampRef.current=advanceInputRamp(moveRampRef.current,drive,dt,MOVE_ACCELERATION.rampSeconds);const moveSpeed=acceleratedSpeed(moveRampRef.current,MOVE_ACCELERATION);
      const moving=drive!==0;if(moving){
        const beforeX=pose.x,beforeY=pose.y;
        const distance=drive*moveSpeed*dt,nx=pose.x+Math.cos(pose.angle)*distance,ny=pose.y+Math.sin(pose.angle)*distance,w=current.world;
        w.ensureAround(Math.floor(nx),Math.floor(ny),current.moves);
        const clearX=w.tile(Math.floor(nx-PLAYER_RADIUS),Math.floor(pose.y-PLAYER_RADIUS))===0&&w.tile(Math.floor(nx+PLAYER_RADIUS),Math.floor(pose.y+PLAYER_RADIUS))===0;if(clearX)pose.x=nx;
        const clearY=w.tile(Math.floor(pose.x-PLAYER_RADIUS),Math.floor(ny-PLAYER_RADIUS))===0&&w.tile(Math.floor(pose.x+PLAYER_RADIUS),Math.floor(ny+PLAYER_RADIUS))===0;if(clearY)pose.y=ny;
        const translated=Math.hypot(pose.x-beforeX,pose.y-beforeY);pose.bob+=dt*9;if(translated<.0005){collisionRef.current++;if(collisionRef.current===24)callCompanion({type:"repeated_collision"})}else{collisionRef.current=0;lastMovementRef.current=Date.now();pauseObservedRef.current=false;if(!document.hidden){activeTravelAccumulatorRef.current+=dt;traceTravelAccumulatorRef.current+=dt}}
        const cell=cellKey(Math.floor(pose.x),Math.floor(pose.y));if(cell!==lastCellRef.current)enterCell(Math.floor(pose.x),Math.floor(pose.y));
        collectActiveStar();
      }
      const next=bearing(pose.angle);setHeading(old=>old===next?old:next);
      const latest=runRef.current;if(now-lastSceneBuildRef.current>140){lastSceneBuildRef.current=now;const result=refreshScene(moving?"walking":turn!==0?"turning":"stationary");if(result.majorFirstSeen&&greetingCompleteRef.current&&!seenMajorScenesRef.current.has(result.majorFirstSeen)){seenMajorScenesRef.current.add(result.majorFirstSeen);void callCompanion({type:"scene_changed",sceneId:result.majorFirstSeen})}}
      const ctx=canvasRef.current?.getContext("2d");if(ctx){const journey=journeyRef.current,messagePulse=Math.max(0,1-(Date.now()-messagePulseAtRef.current)/1400),visual:VisualFrameState={time:now*.001,movementSpeed:moving?moveSpeed:0,turnRate:turn*turnSpeed,collisionPulse:Math.min(1,collisionRef.current/24),relationshipPhase:journey.phase,relationshipIntensity:Math.min(1,journey.relationshipDepth/38+latest.objective.collectedStars*.04),collectedStars:latest.objective.collectedStars,activeStarVisible:sceneRef.current?.objective.starVisible??false,visibleRouteCount:sceneRef.current?.geometry.visibleOpenings.length??0,messagePulse,reducedMotion};renderWorld(ctx,latest.world,latest.anchors,latest.entities,latest.appearance,latest.appearanceProtected,pose,moving,reducedMotion,latest.moves,latest.objective.activeStar,sceneRef.current,visual)}
      frame=requestAnimationFrame(tick);
    };frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[enterCell,callCompanion,collectActiveStar,reducedMotion,refreshScene]);

  const sendToCompanion=async(e:React.FormEvent)=>{
    e.preventDefault();const text=companionInput.trim();if(!text)return;setCompanionInput("");setChatOpen(false);chatInputRef.current?.blur();heldRef.current.clear();
    if(/\b(stop talking|be quiet|quiet please|shut up|talk less|less talking)\b/i.test(text))quietUntilRef.current=Date.now()+60_000;
    const message:CompanionMessage={id:crypto.randomUUID(),role:"player",text:text.slice(0,500),time:Date.now()};setCompanionMessages(old=>[...old,message].slice(-18));messagesRef.current=[...messagesRef.current,message].slice(-18);
    await callCompanion({type:"player_message",text:message.text},message.text,true);
  };
  const startStory=useCallback(()=>{setStoryIndex(0);setExperienceState("story")},[setExperienceState]);
  const enterGame=useCallback(()=>{
    if(!ready)return;setExperienceState("playing");lastMovementRef.current=Date.now();lastTurnRef.current=lastMovementRef.current;pauseObservedRef.current=false;
    queueMicrotask(()=>{if(experienceRef.current==="playing"&&!greetingCompleteRef.current)void callCompanionRef.current({type:"initial_guidance"},undefined,true)});
    requestAnimationFrame(()=>canvasRef.current?.focus());
  },[ready,setExperienceState]);
  const resumeGame=useCallback(()=>{setExperienceState("playing");lastMovementRef.current=Date.now();lastTurnRef.current=lastMovementRef.current;requestAnimationFrame(()=>canvasRef.current?.focus())},[setExperienceState]);
  const endGame=useCallback(()=>{
    heldRef.current.clear();document.exitPointerLock?.();setExperienceState("title");setStoryIndex(0);
    if(activeRequestRef.current){activeRequestRef.current.preempted=true;activeRequestRef.current.controller.abort()}
    void initializeRun(randomSeed());
  },[initializeRun,setExperienceState]);
  const restartAfterClosure=useCallback(()=>{setStoryIndex(0);setExperienceState("story");void initializeRun(randomSeed())},[initializeRun,setExperienceState]);
  const starMarks=`${"★".repeat(run.objective.collectedStars)}${"☆".repeat(4-run.objective.collectedStars)}`;
  return <main className={`shell game-only ${starPulse?"star-pulse":""}`}>
    {experience==="title"&&<TitleScreen onStart={startStory}/>}
    {experience==="story"&&<StorySequence index={storyIndex} ready={ready} onAdvance={()=>setStoryIndex(value=>Math.min(value+1,7))} onBack={()=>setExperienceState("title")} onComplete={enterGame}/>}
    {experience==="paused"&&<PauseMenu onResume={resumeGame} onEnd={endGame}/>}
    {experience==="ending"&&<ClosureScreen revealed={closureRevealed} onRestart={restartAfterClosure} onLeave={endGame}/>}
    {experience==="playing"&&!ready&&<div className="boot-screen" aria-live="polite"><span>OPENING THE GATE</span></div>}
    <section className="viewport-wrap" aria-label="Infinite first person maze game" aria-hidden={experience!=="playing"&&experience!=="paused"}><div className="viewport-label"><span>CAM_01 // {heading}</span><span className="objective-stars" aria-label={`${run.objective.collectedStars} of 4 stars collected`}>{starMarks}</span><span>{companionStatus} · ENTER CHAT · ESC PAUSE · N NEW SIGNAL</span></div>
        <canvas ref={canvasRef} width={1280} height={720} tabIndex={0} aria-label="First-person view into an infinite maze" onClick={e=>e.currentTarget.requestPointerLock?.()}
          onTouchStart={e=>{touchXRef.current=e.touches[0]?.clientX??null}} onTouchMove={e=>{const x=e.touches[0]?.clientX;if(x!==undefined&&touchXRef.current!==null){poseRef.current.angle=wrap(poseRef.current.angle+(x-touchXRef.current)*.0035);lastTurnRef.current=Date.now();pauseObservedRef.current=false}touchXRef.current=x??null}} onTouchEnd={()=>{touchXRef.current=null}}/>
        <div className="vignette comfort-vignette"/>{companionMessages.length>0&&<div className={`ariadne-chat ${chatOpen?"chat-open":""}`} aria-live="polite">{companionMessages.slice(-5).map(message=><div key={message.id} className={`ariadne-chat-line ${message.role} ${message.kind==="environment"?"discovery":""}`}><span>{message.role==="ariadne"?"<ARIADNE>":"<MT>"}</span> {message.text}</div>)}</div>}
        {chatOpen&&<form className="minecraft-chat-input" onSubmit={sendToCompanion}><span>&gt;</span><input ref={chatInputRef} aria-label="Message ARIADNE" value={companionInput} maxLength={500} onChange={e=>setCompanionInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.currentTarget.form?.requestSubmit()}else if(e.key==="Escape"){e.preventDefault();setChatOpen(false);setCompanionInput("");e.currentTarget.blur();canvasRef.current?.focus()}}} placeholder="Message ARIADNE"/></form>}
    </section>
  </main>;
}
