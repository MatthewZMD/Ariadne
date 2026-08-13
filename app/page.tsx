"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CACHE_RADIUS, InfiniteWorld, cellKey, chunkKey, createThemeScheduler } from "./world.mjs";
import { entitiesNear, renderWorld, type Pose } from "./renderer";
import { THEMES, retainThemeMemory, type AmbientEntity, type ThemeAnchor, type ThemeId, type ThemeMemory } from "./themes";
import { analyzePlayerActivity, companionArc, companionCooldownMs, compactMap, compareTrajectory, createGuidanceIntent, describeEgocentricView, forwardVisibleGeometry, instructionForCurrentChoice, nextPassingThoughtAt, nextPerceptionCue, planRoutes, planVisibleJunctionRoutes, rebaseSelectedRoute, relationshipCue, routesForEvent, shouldTriggerPassingThought, visibleEnvironment, type CompanionArcStats, type CompanionCue, type CompanionEvent, type CompanionMessage, type CompanionReply, type GuidanceIntent, type TrajectorySample } from "./companion";

const MOVE_SPEED=1.65,TURN_SPEED=1.05,PLAYER_RADIUS=.18;
type MemoryCell={tile:number;seenAt:number};
type Run={
  seed:number;world:InfiniteWorld;anchors:ThemeAnchor[];entities:AmbientEntity[];
  memory:Map<string,MemoryCell>;appearance:ThemeMemory;appearanceProtected:Set<string>;visited:Set<string>;recent:string[];player:{x:number;y:number};
  spawnAngle:number;moves:number;shifts:number;message:string;revision:number;
};

const wrap=(a:number)=>(a+Math.PI*2)%(Math.PI*2);
const bearing=(a:number)=>["E","S","W","N"][Math.round(wrap(a)/(Math.PI/2))%4];
const EVENT_PRIORITY:Record<CompanionEvent["type"],number>={recommendation_contradicted:10,dead_end_visible:9,trajectory_relationship_changed:8,player_message:8,environment_visible:7,environment_entered:7,target_reached:6,same_target_reached_differently:6,new_junction_visible:5,revisited_position:2,sustained_backtrack:2,repeated_collision:2,idle:2,initial_guidance:2,passing_thought:1};
const eventPriority=(event:CompanionEvent)=>EVENT_PRIORITY[event.type];
const strongestCue=(cues:Array<CompanionCue|null>)=>cues.filter((cue):cue is CompanionCue=>!!cue).sort((a,b)=>eventPriority(b.event)-eventPriority(a.event))[0]??null;

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
  return{seed,world,anchors:[],entities:[],memory,appearance:new Map(),appearanceProtected,visited:new Set(["1,1"]),recent:["1,1"],player:{x:1,y:1},spawnAngle:angle,moves:0,shifts:0,message:"NO DESTINATION // KEEP MOVING",revision:0};
}

function randomSeed(){
  const value=new Uint32Array(1);crypto.getRandomValues(value);return value[0]||1;
}

export default function Home(){
  const[run,setRun]=useState<Run>(()=>newRun());const runRef=useRef(run);
  const canvasRef=useRef<HTMLCanvasElement>(null),poseRef=useRef<Pose>({x:1.5,y:1.5,angle:run.spawnAngle,bob:0});
  const chatInputRef=useRef<HTMLInputElement>(null);
  const heldRef=useRef(new Set<string>()),lastCellRef=useRef("1,1"),touchXRef=useRef<number|null>(null);
  const schedulerRef=useRef<ReturnType<typeof createThemeScheduler>>(createThemeScheduler(run.seed));
  const[heading,setHeading]=useState(()=>bearing(run.spawnAngle));
  const[ready,setReady]=useState(false),bootedRef=useRef(false);
  const[companionMessages,setCompanionMessages]=useState<CompanionMessage[]>([]),messagesRef=useRef<CompanionMessage[]>([]);
  const[companionStatus,setCompanionStatus]=useState<"LISTENING"|"THINKING"|"LINK STABLE">("LISTENING"),[companionInput,setCompanionInput]=useState(""),[chatOpen,setChatOpen]=useState(false);
  const guidanceRef=useRef<GuidanceIntent|null>(null),trajectoryRef=useRef<TrajectorySample[]>([]),observedAfterGuidanceRef=useRef(new Set<string>()),newlyRevealedRef=useRef(new Set<string>());
  const seenPerceptionCuesRef=useRef(new Set<string>()),lastCompanionCallRef=useRef(0),nextPassingThoughtRef=useRef(0),requestInFlightRef=useRef(false),pendingEventRef=useRef<{event:CompanionEvent;force:boolean}|null>(null),lastMovementRef=useRef(0),lastTurnRef=useRef(0),pauseObservedRef=useRef(false),collisionRef=useRef(0),providerFailureRef=useRef(0);
  const callCompanionRef=useRef<(event:CompanionEvent,playerMessage?:string,force?:boolean)=>Promise<void>>(async()=>{});
  const respondedRelationshipsRef=useRef(new Set<string>());
  const seenFamiliarPlacesRef=useRef(new Set<string>());
  const arcStatsRef=useRef<CompanionArcStats>({spokenMessages:0,guidanceFailures:0,resolvedChoices:0}),countedArcMomentsRef=useRef(new Set<string>());
  const applyRun=useCallback((next:Run)=>{
    const scheduler=createThemeScheduler(next.seed);next.anchors=[plantCheckpoint(next.world,1,1,scheduler.nextTheme() as ThemeId,scheduler.nextAt,next.spawnAngle)];
    next.entities=entitiesNear(next.seed,next.world,next.anchors,next.appearance,1.5,1.5);runRef.current=next;schedulerRef.current=scheduler;heldRef.current.clear();
    poseRef.current={x:1.5,y:1.5,angle:next.spawnAngle,bob:0};lastCellRef.current="1,1";
    guidanceRef.current=null;trajectoryRef.current=[];observedAfterGuidanceRef.current=new Set();newlyRevealedRef.current=new Set();respondedRelationshipsRef.current=new Set();seenFamiliarPlacesRef.current=new Set();seenPerceptionCuesRef.current=new Set();pendingEventRef.current=null;arcStatsRef.current={spokenMessages:0,guidanceFailures:0,resolvedChoices:0};countedArcMomentsRef.current=new Set();providerFailureRef.current=0;lastCompanionCallRef.current=0;lastMovementRef.current=Date.now();lastTurnRef.current=lastMovementRef.current;nextPassingThoughtRef.current=nextPassingThoughtAt(lastMovementRef.current,"charming");pauseObservedRef.current=false;
    setCompanionMessages([]);setCompanionStatus("LISTENING");setCompanionInput("");setChatOpen(false);setHeading(bearing(next.spawnAngle));setRun(next);
  },[]);
  useEffect(()=>{runRef.current=run},[run]);
  useEffect(()=>{messagesRef.current=companionMessages},[companionMessages]);
  useEffect(()=>{
    if(bootedRef.current)return;bootedRef.current=true;applyRun(newRun(randomSeed()));setReady(true);
  },[applyRun]);

  const enterCell=useCallback((x:number,y:number)=>{
    const id=cellKey(x,y);lastCellRef.current=id;lastMovementRef.current=Date.now();collisionRef.current=0;
    setRun(old=>{
      const pose=poseRef.current,world=old.world;let moves=old.moves,shifts=old.shifts,message="FOOTSTEPS DISSOLVE BEHIND YOU";
      const visited=new Set(old.visited),recent=[...old.recent,id].slice(-20);const firstVisit=!visited.has(id);
      if(firstVisit){visited.add(id);moves++}
      let anchors=[...old.anchors];const scheduler=schedulerRef.current;
      if(firstVisit&&moves>=scheduler.nextAt){
        scheduler.advance(moves);const theme=scheduler.nextTheme() as ThemeId;
        anchors.push(plantCheckpoint(world,x,y,theme,scheduler.nextAt,pose.angle));
        message="A DIFFERENT PRESSURE WAITS AHEAD";
      }
      anchors=anchors.map(anchor=>{
        if(!anchor.triggered&&moves>=anchor.bornAt&&Math.hypot(x-anchor.x,y-anchor.y)<2.25){message=THEMES[anchor.theme].signal;return{...anchor,triggered:true}}
        return anchor;
      });
      const visible=visibleCells(world,pose,moves),protectedChunks=new Set<string>();
      for(const cell of [...visible,...recent]){const[cx,cy]=cell.split(",").map(Number);const c=world.coords(cx,cy);protectedChunks.add(chunkKey(c.cx,c.cy))}
      world.ensureAround(x,y,moves);const before=world.chunks.size;world.prune(x,y,protectedChunks,moves);if(world.chunks.size<before)shifts++;
      const memory=new Map(old.memory);
      visible.forEach(cell=>{const[cx,cy]=cell.split(",").map(Number);memory.set(cell,{tile:world.tile(cx,cy,moves),seenAt:moves})});
      for(const[cell,value]of memory)if(moves-value.seenAt>80)memory.delete(cell);
      const pc=world.coords(x,y);anchors=anchors.filter(a=>Math.abs(world.coords(a.x,a.y).cx-pc.cx)<=CACHE_RADIUS+1&&Math.abs(world.coords(a.x,a.y).cy-pc.cy)<=CACHE_RADIUS+1);
      const appearanceProtected=new Set([...visible,...recent]),appearance=old.appearance;retainThemeMemory(appearance,appearanceProtected);
      const entities=entitiesNear(old.seed,world,anchors,appearance,x+.5,y+.5);
      return{...old,anchors,entities,memory,appearanceProtected,visited,recent,player:{x,y},moves,shifts,message,revision:old.revision+1};
    });
  },[]);

  const callCompanion=useCallback(async(event:CompanionEvent,playerMessage?:string,force=false)=>{
    const now=Date.now();
    const queue=()=>{const pending=pendingEventRef.current;if(!pending||eventPriority(event)>eventPriority(pending.event))pendingEventRef.current={event,force};else if(force)pending.force=true};
    if(requestInFlightRef.current){queue();return}
    const phaseAtCall=companionArc(arcStatsRef.current).phase,cooldown=companionCooldownMs(phaseAtCall);
    if(!force&&now-lastCompanionCallRef.current<cooldown){queue();return}
    const current=runRef.current,pose=poseRef.current,geometry=forwardVisibleGeometry(current.world,pose,current.moves),environment=visibleEnvironment(current.anchors,geometry,pose);
    const currentRoutes=planRoutes(current.world,pose,current.moves,current.memory,current.visited),visibleJunctionRoutes=event.type==="new_junction_visible"?planVisibleJunctionRoutes(current.world,pose,current.moves,geometry,current.memory,current.visited):[];
    const routes=routesForEvent(event,currentRoutes,visibleJunctionRoutes),egocentricView=describeEgocentricView(current.world,pose,current.moves,currentRoutes),intent=guidanceRef.current;
    const activity=analyzePlayerActivity(trajectoryRef.current,now,lastMovementRef.current,lastTurnRef.current,geometry.junctions.length>0);
    const contradicted=!!intent&&geometry.corridorEnds.some(end=>intent.suggestedCells.some(cell=>cell[0]===end[0]&&cell[1]===end[1]));
    const evidence=intent?compareTrajectory(intent,trajectoryRef.current,newlyRevealedRef.current,contradicted):null;
    const arcMoment=event.type==="recommendation_contradicted"&&intent?`failure:${intent.id}`:event.type==="trajectory_relationship_changed"&&intent?`choice:${intent.id}:${event.relationship}`:null;
    if(arcMoment&&!countedArcMomentsRef.current.has(arcMoment)){countedArcMomentsRef.current.add(arcMoment);if(event.type==="recommendation_contradicted")arcStatsRef.current.guidanceFailures++;else arcStatsRef.current.resolvedChoices++}
    const currentArc=companionArc(arcStatsRef.current);
    requestInFlightRef.current=true;lastCompanionCallRef.current=now;nextPassingThoughtRef.current=nextPassingThoughtAt(now,currentArc.phase);setCompanionStatus("THINKING");
    try{
      const response=await fetch("/api/companion",{method:"POST",headers:{"content-type":"application/json"},signal:AbortSignal.timeout(25000),body:JSON.stringify({sessionId:String(current.seed),trigger:event,activity,recommendation:intent,recommendationEvidence:evidence,actualTrajectory:trajectoryRef.current.slice(-32),currentView:egocentricView,environment,rememberedMap:compactMap(current.memory,[current.player.x,current.player.y]),legalRoutes:routes,recentMessages:messagesRef.current.slice(-8),olderContextSummary:messagesRef.current.slice(0,-8).slice(-8).map(m=>`${m.role}: ${m.text}`).join(" | "),companionArc:currentArc,playerMessage})});
      if(!response.ok)throw new Error(`companion request failed: ${response.status}`);
      const reply=await response.json() as CompanionReply&{source?:"provider"|"fallback"};
      if(reply.source==="provider")providerFailureRef.current=0;
      else{providerFailureRef.current++;nextPassingThoughtRef.current=Date.now()+Math.min(5000*providerFailureRef.current,15000)}
      const selectedAtRequest=routes.find(r=>r.id===reply.selectedRouteId)??null;
      const latest=runRef.current,latestPose=poseRef.current,latestGeometry=forwardVisibleGeometry(latest.world,latestPose,latest.moves);
      const latestVisibleJunction=event.type==="new_junction_visible"?planVisibleJunctionRoutes(latest.world,latestPose,latest.moves,latestGeometry,latest.memory,latest.visited):[];
      const latestCurrentRoutes=planRoutes(latest.world,latestPose,latest.moves,latest.memory,latest.visited);
      const latestRoutes=routesForEvent(event,latestCurrentRoutes,latestVisibleJunction);
      const route=rebaseSelectedRoute(selectedAtRequest,latestRoutes);
      const guidesNow=["initial_guidance","new_junction_visible","dead_end_visible","recommendation_contradicted","target_reached","same_target_reached_differently","revisited_position","repeated_collision","player_message"].includes(event.type)||(event.type==="idle"&&event.atChoice);
      const spokenInstruction=guidesNow?instructionForCurrentChoice(route,latestRoutes):"",finalText=[reply.message.trim(),spokenInstruction].filter(Boolean).join(" ");
      if(finalText){
        const message:CompanionMessage={id:crypto.randomUUID(),role:"ariadne",text:finalText,time:Date.now(),kind:reply.kind};
        const next=[...messagesRef.current,message].slice(-18);messagesRef.current=next;setCompanionMessages(next);
        arcStatsRef.current.spokenMessages++;
        nextPassingThoughtRef.current=nextPassingThoughtAt(Date.now(),companionArc(arcStatsRef.current).phase);
      }
      const groundedReply={...reply,message:spokenInstruction},nextIntent=spokenInstruction?createGuidanceIntent(groundedReply,route,{...latestPose}):null;
      if(nextIntent){guidanceRef.current=nextIntent;trajectoryRef.current=[];observedAfterGuidanceRef.current=new Set(geometry.cells.map(([x,y])=>cellKey(x,y)));newlyRevealedRef.current=new Set()}
    }catch(error){
      providerFailureRef.current++;nextPassingThoughtRef.current=Date.now()+Math.min(5000*providerFailureRef.current,15000);
      console.warn("ARIADNE request will retry after a transient failure",error);
    }finally{
      requestInFlightRef.current=false;setCompanionStatus("LINK STABLE");
      const pending=pendingEventRef.current;
      if(pending?.force){pendingEventRef.current=null;queueMicrotask(()=>{void callCompanionRef.current(pending.event,undefined,true)})}
    }
  },[]);
  useEffect(()=>{callCompanionRef.current=callCompanion},[callCompanion]);

  useEffect(()=>{
    if(!ready)return;
    const timer=setTimeout(()=>{if(lastCompanionCallRef.current===0)callCompanion({type:"initial_guidance"},undefined,true)},650);
    return()=>clearTimeout(timer);
  },[ready,callCompanion]);

  useEffect(()=>{
    if(!ready)return;
    const current=runRef.current,pose=poseRef.current,geometry=forwardVisibleGeometry(current.world,pose,current.moves),environment=visibleEnvironment(current.anchors,geometry,pose);
    const newlyVisible=geometry.cells.filter(([x,y])=>!observedAfterGuidanceRef.current.has(cellKey(x,y)));
    newlyVisible.forEach(([x,y])=>{const key=cellKey(x,y);observedAfterGuidanceRef.current.add(key);newlyRevealedRef.current.add(key)});
    const sample:TrajectorySample={time:Date.now(),position:[pose.x,pose.y],cell:[Math.floor(pose.x),Math.floor(pose.y)],heading:pose.angle,newlyVisibleCells:newlyVisible.slice(0,40),visibleJunctions:geometry.junctions.map(j=>j.id),visibleEnvironment:environment?.id??null};
    trajectoryRef.current=[...trajectoryRef.current,sample].slice(-40);
    const intent=guidanceRef.current,contradicted=!!intent&&geometry.corridorEnds.some(end=>intent.suggestedCells.some(cell=>cell[0]===end[0]&&cell[1]===end[1]));
    const evidence=intent?compareTrajectory(intent,trajectoryRef.current,newlyRevealedRef.current,contradicted):null;
    let event:CompanionEvent|null=null,force=false;
    const cue=strongestCue([nextPerceptionCue(geometry,environment,intent,seenPerceptionCuesRef.current),intent&&evidence?relationshipCue(intent,trajectoryRef.current,evidence,seenPerceptionCuesRef.current):null]);
    if(cue){seenPerceptionCuesRef.current.add(cue.key);event=cue.event;force=cue.force}
    else{
      if(evidence?.reachedSameTargetByDifferentRoute)event={type:"same_target_reached_differently"};
      else if(evidence?.reachedSuggestedTarget)event={type:"target_reached"};
      else{
        const locationId=cellKey(current.player.x,current.player.y),familiar=current.recent.slice(0,-1).includes(locationId)&&!seenFamiliarPlacesRef.current.has(locationId);
        if(familiar){seenFamiliarPlacesRef.current.add(locationId);event={type:"revisited_position"}}
        else if(evidence&&evidence.newCellsRevealedOffSuggestedPath>=5){
          const key=intent?`${intent.id}:explored`:null;
          if(key&&!respondedRelationshipsRef.current.has(key)){respondedRelationshipsRef.current.add(key);event={type:"trajectory_relationship_changed",relationship:"chose_another_way"}}
        }
      }
    }
    if(event)callCompanion(event,undefined,force);
  },[run.revision,ready,callCompanion]);

  useEffect(()=>{
    if(!ready)return;const interval=setInterval(()=>{
      const current=runRef.current,pose=poseRef.current,geometry=forwardVisibleGeometry(current.world,pose,current.moves),environment=visibleEnvironment(current.anchors,geometry,pose);
      const sample:TrajectorySample={time:Date.now(),position:[pose.x,pose.y],cell:[Math.floor(pose.x),Math.floor(pose.y)],heading:pose.angle,newlyVisibleCells:[],visibleJunctions:geometry.junctions.map(j=>j.id),visibleEnvironment:environment?.id??null};
      trajectoryRef.current=[...trajectoryRef.current,sample].slice(-40);
      const cue=nextPerceptionCue(geometry,environment,guidanceRef.current,seenPerceptionCuesRef.current);
      const pending=pendingEventRef.current;
      if(cue){seenPerceptionCuesRef.current.add(cue.key);callCompanion(cue.event,undefined,cue.force)}
      else if(pending&&!requestInFlightRef.current&&(pending.force||Date.now()-lastCompanionCallRef.current>=companionCooldownMs(companionArc(arcStatsRef.current).phase))){pendingEventRef.current=null;callCompanion(pending.event,undefined,pending.force)}
      else{
        const now=Date.now(),activity=analyzePlayerActivity(trajectoryRef.current,now,lastMovementRef.current,lastTurnRef.current,geometry.junctions.length>0);
        if(activity.state==="stationary"&&activity.stationarySeconds>=15&&!pauseObservedRef.current){pauseObservedRef.current=true;callCompanion({type:"idle",atChoice:activity.atVisibleChoice})}
        else if(shouldTriggerPassingThought(activity,now,nextPassingThoughtRef.current))callCompanion({type:"passing_thought"})
      }
    },5000);return()=>clearInterval(interval);
  },[ready,callCompanion]);

  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;const k=e.key.toLowerCase();if(e.key==="Enter"){e.preventDefault();heldRef.current.clear();setChatOpen(true);requestAnimationFrame(()=>chatInputRef.current?.focus());return}if(k==="n"){e.preventDefault();applyRun(newRun(randomSeed()));return}if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(k)){e.preventDefault();heldRef.current.add(k)}};
    const up=(e:KeyboardEvent)=>heldRef.current.delete(e.key.toLowerCase()),blur=()=>heldRef.current.clear();
    const mouse=(e:MouseEvent)=>{if(document.pointerLockElement===canvasRef.current&&e.movementX!==0){poseRef.current.angle=wrap(poseRef.current.angle+e.movementX*.00125);lastTurnRef.current=Date.now();pauseObservedRef.current=false}};
    addEventListener("keydown",down);addEventListener("keyup",up);addEventListener("blur",blur);addEventListener("mousemove",mouse);
    return()=>{removeEventListener("keydown",down);removeEventListener("keyup",up);removeEventListener("blur",blur);removeEventListener("mousemove",mouse)};
  },[applyRun]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{const rect=canvas.getBoundingClientRect(),scale=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.max(1,Math.round(rect.width*scale));canvas.height=Math.max(1,Math.round(rect.height*scale))};
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();return()=>observer.disconnect();
  },[ready]);

  useEffect(()=>{
    let frame=0,previous=performance.now();
    const tick=(now:number)=>{
      const dt=Math.min((now-previous)/1000,.05);previous=now;const current=runRef.current,pose=poseRef.current,held=heldRef.current;
      let turn=0;if(held.has("a")||held.has("arrowleft"))turn--;if(held.has("d")||held.has("arrowright"))turn++;
      if(turn!==0){pose.angle=wrap(pose.angle+turn*TURN_SPEED*dt);lastTurnRef.current=Date.now();pauseObservedRef.current=false}let drive=0;if(held.has("w")||held.has("arrowup"))drive++;if(held.has("s")||held.has("arrowdown"))drive--;
      const moving=drive!==0;if(moving){
        const beforeX=pose.x,beforeY=pose.y;
        const distance=drive*MOVE_SPEED*dt,nx=pose.x+Math.cos(pose.angle)*distance,ny=pose.y+Math.sin(pose.angle)*distance,w=current.world;
        w.ensureAround(Math.floor(nx),Math.floor(ny),current.moves);
        const clearX=w.tile(Math.floor(nx-PLAYER_RADIUS),Math.floor(pose.y-PLAYER_RADIUS))===0&&w.tile(Math.floor(nx+PLAYER_RADIUS),Math.floor(pose.y+PLAYER_RADIUS))===0;if(clearX)pose.x=nx;
        const clearY=w.tile(Math.floor(pose.x-PLAYER_RADIUS),Math.floor(ny-PLAYER_RADIUS))===0&&w.tile(Math.floor(pose.x+PLAYER_RADIUS),Math.floor(ny+PLAYER_RADIUS))===0;if(clearY)pose.y=ny;
        const translated=Math.hypot(pose.x-beforeX,pose.y-beforeY);pose.bob+=dt*9;if(translated<.0005){collisionRef.current++;if(collisionRef.current===24)callCompanion({type:"repeated_collision"})}else{collisionRef.current=0;lastMovementRef.current=Date.now();pauseObservedRef.current=false}
        const cell=cellKey(Math.floor(pose.x),Math.floor(pose.y));if(cell!==lastCellRef.current)enterCell(Math.floor(pose.x),Math.floor(pose.y));
      }
      const next=bearing(pose.angle);setHeading(old=>old===next?old:next);
      const ctx=canvasRef.current?.getContext("2d");if(ctx)renderWorld(ctx,current.world,current.anchors,current.entities,current.appearance,current.appearanceProtected,pose,moving,true,current.moves);
      frame=requestAnimationFrame(tick);
    };frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[enterCell,callCompanion]);

  const sendToCompanion=async(e:React.FormEvent)=>{
    e.preventDefault();const text=companionInput.trim();if(!text)return;setCompanionInput("");setChatOpen(false);chatInputRef.current?.blur();heldRef.current.clear();
    const message:CompanionMessage={id:crypto.randomUUID(),role:"player",text:text.slice(0,500),time:Date.now()};setCompanionMessages(old=>[...old,message].slice(-18));messagesRef.current=[...messagesRef.current,message].slice(-18);
    await callCompanion({type:"player_message",text:message.text},message.text,true);
  };
  return <main className="shell game-only">
    <div className={`boot-screen ${ready?"ready":""}`} aria-live="polite"><span>GENERATING SIGNAL</span></div>
    <section className="viewport-wrap" aria-label="Infinite first person maze game"><div className="viewport-label"><span>CAM_01 // {heading}</span><span>{companionStatus} · ENTER CHAT · N NEW SIGNAL</span></div>
        <canvas ref={canvasRef} width={1280} height={720} tabIndex={0} aria-label="First-person view into an infinite maze" onClick={e=>e.currentTarget.requestPointerLock?.()}
          onTouchStart={e=>{touchXRef.current=e.touches[0]?.clientX??null}} onTouchMove={e=>{const x=e.touches[0]?.clientX;if(x!==undefined&&touchXRef.current!==null){poseRef.current.angle=wrap(poseRef.current.angle+(x-touchXRef.current)*.0035);lastTurnRef.current=Date.now();pauseObservedRef.current=false}touchXRef.current=x??null}} onTouchEnd={()=>{touchXRef.current=null}}/>
        <div className="vignette comfort-vignette"/>{companionMessages.length>0&&<div className={`ariadne-chat ${chatOpen?"chat-open":""}`} aria-live="polite">{companionMessages.slice(-5).map(message=><div key={message.id} className={`ariadne-chat-line ${message.role} ${message.kind==="environment"?"discovery":""}`}><span>{message.role==="ariadne"?"<ARIADNE>":"<YOU>"}</span> {message.text}</div>)}</div>}
        {chatOpen&&<form className="minecraft-chat-input" onSubmit={sendToCompanion}><span>&gt;</span><input ref={chatInputRef} aria-label="Message ARIADNE" value={companionInput} maxLength={500} onChange={e=>setCompanionInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.currentTarget.form?.requestSubmit()}else if(e.key==="Escape"){e.preventDefault();setChatOpen(false);setCompanionInput("");e.currentTarget.blur();canvasRef.current?.focus()}}} placeholder="Message ARIADNE"/></form>}
    </section>
  </main>;
}
