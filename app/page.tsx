"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CACHE_RADIUS, InfiniteWorld, cellKey, chunkKey, createThemeScheduler } from "./world.mjs";
import { entitiesNear, renderWorld, type Pose } from "./renderer";
import { THEMES, retainThemeMemory, type AmbientEntity, type ThemeAnchor, type ThemeId, type ThemeMemory } from "./themes";
import { compactMap, compareTrajectory, createGuidanceIntent, forwardVisibleGeometry, planRoutes, visibleEnvironment, type CompanionEvent, type CompanionMessage, type CompanionReply, type GuidanceIntent, type TrajectorySample } from "./companion";

const MOVE_SPEED=1.65,TURN_SPEED=1.05,PLAYER_RADIUS=.18,MAP_RADIUS=10;
type MemoryCell={tile:number;seenAt:number};
type Run={
  seed:number;world:InfiniteWorld;anchors:ThemeAnchor[];entities:AmbientEntity[];
  memory:Map<string,MemoryCell>;appearance:ThemeMemory;appearanceProtected:Set<string>;visited:Set<string>;recent:string[];player:{x:number;y:number};
  spawnAngle:number;moves:number;shifts:number;message:string;revision:number;
};

const wrap=(a:number)=>(a+Math.PI*2)%(Math.PI*2);
const bearing=(a:number)=>["E","S","W","N"][Math.round(wrap(a)/(Math.PI/2))%4];
const eventPriority=(event:CompanionEvent)=>event.type==="recommendation_contradicted"?9:event.type==="player_message"?8:event.type==="environment_visible"||event.type==="environment_entered"?7:event.type==="target_reached"||event.type==="same_target_reached_differently"?6:event.type==="new_junction_visible"?5:event.type==="trajectory_relationship_changed"?4:2;

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
  const heldRef=useRef(new Set<string>()),lastCellRef=useRef("1,1"),touchXRef=useRef<number|null>(null);
  const schedulerRef=useRef<ReturnType<typeof createThemeScheduler>>(createThemeScheduler(run.seed));
  const[heading,setHeading]=useState(()=>bearing(run.spawnAngle));
  const[ready,setReady]=useState(false),bootedRef=useRef(false);
  const[companionMessages,setCompanionMessages]=useState<CompanionMessage[]>([]),messagesRef=useRef<CompanionMessage[]>([]);
  const[companionStatus,setCompanionStatus]=useState<"LISTENING"|"THINKING"|"LINK STABLE">("LISTENING"),[companionInput,setCompanionInput]=useState("");
  const guidanceRef=useRef<GuidanceIntent|null>(null),trajectoryRef=useRef<TrajectorySample[]>([]),observedAfterGuidanceRef=useRef(new Set<string>()),newlyRevealedRef=useRef(new Set<string>());
  const seenJunctionsRef=useRef(new Set<string>()),seenEnvironmentsRef=useRef(new Set<string>()),lastCompanionCallRef=useRef(0),lastIdleCallRef=useRef(0),requestInFlightRef=useRef(false),pendingEventRef=useRef<CompanionEvent|null>(null),lastMovementRef=useRef(0),collisionRef=useRef(0);
  const contradictedGuidanceRef=useRef(new Set<string>());
  const seenFamiliarPlacesRef=useRef(new Set<string>());
  const applyRun=useCallback((next:Run)=>{
    const scheduler=createThemeScheduler(next.seed);next.anchors=[plantCheckpoint(next.world,1,1,scheduler.nextTheme() as ThemeId,scheduler.nextAt,next.spawnAngle)];
    next.entities=entitiesNear(next.seed,next.world,next.anchors,next.appearance,1.5,1.5);runRef.current=next;schedulerRef.current=scheduler;heldRef.current.clear();
    poseRef.current={x:1.5,y:1.5,angle:next.spawnAngle,bob:0};lastCellRef.current="1,1";
    guidanceRef.current=null;trajectoryRef.current=[];observedAfterGuidanceRef.current=new Set();newlyRevealedRef.current=new Set();contradictedGuidanceRef.current=new Set();seenFamiliarPlacesRef.current=new Set();seenJunctionsRef.current=new Set();seenEnvironmentsRef.current=new Set();pendingEventRef.current=null;lastCompanionCallRef.current=0;lastIdleCallRef.current=0;lastMovementRef.current=Date.now();
    setCompanionMessages([]);setCompanionStatus("LISTENING");setHeading(bearing(next.spawnAngle));setRun(next);
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
    const queue=()=>{if(!pendingEventRef.current||eventPriority(event)>eventPriority(pendingEventRef.current))pendingEventRef.current=event};
    if(requestInFlightRef.current){queue();return}
    if(!force&&now-lastCompanionCallRef.current<12000){queue();return}
    const current=runRef.current,pose=poseRef.current,geometry=forwardVisibleGeometry(current.world,pose,current.moves),environment=visibleEnvironment(current.anchors,geometry,pose);
    const routes=planRoutes(current.world,pose,current.moves,current.memory,current.visited),intent=guidanceRef.current;
    const contradicted=!!intent&&geometry.corridorEnds.some(end=>intent.suggestedCells.some(cell=>cell[0]===end[0]&&cell[1]===end[1]));
    const evidence=intent?compareTrajectory(intent,trajectoryRef.current,newlyRevealedRef.current,contradicted):null;
    requestInFlightRef.current=true;lastCompanionCallRef.current=now;if(event.type==="idle_at_choice")lastIdleCallRef.current=now;setCompanionStatus("THINKING");
    try{
      const response=await fetch("/api/companion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:String(current.seed),trigger:event,recommendation:intent,recommendationEvidence:evidence,actualTrajectory:trajectoryRef.current.slice(-32),currentView:{summary:geometry.summary,junctions:geometry.junctions,corridorEnds:geometry.corridorEnds},environment,rememberedMap:compactMap(current.memory,[current.player.x,current.player.y]),legalRoutes:routes,recentMessages:messagesRef.current.slice(-8),olderContextSummary:messagesRef.current.slice(0,-8).slice(-8).map(m=>`${m.role}: ${m.text}`).join(" | "),playerMessage})});
      const reply=await response.json() as CompanionReply;
      if(reply.message){
        const message:CompanionMessage={id:crypto.randomUUID(),role:"ariadne",text:reply.message,time:Date.now(),kind:reply.kind};
        setCompanionMessages(old=>[...old,message].slice(-18));
      }
      const route=routes.find(r=>r.id===reply.selectedRouteId)??null,nextIntent=createGuidanceIntent(reply,route,pose);
      if(nextIntent){guidanceRef.current=nextIntent;trajectoryRef.current=[];observedAfterGuidanceRef.current=new Set(geometry.cells.map(([x,y])=>cellKey(x,y)));newlyRevealedRef.current=new Set()}
    }catch{
      const message:CompanionMessage={id:crypto.randomUUID(),role:"ariadne",text:"The signal is faint. Keep moving; I am still mapping the route.",time:Date.now(),kind:"observation"};
      setCompanionMessages(old=>[...old,message].slice(-18));
    }finally{
      requestInFlightRef.current=false;setCompanionStatus("LINK STABLE");
    }
  },[]);

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
    const intent=guidanceRef.current,evidence=intent?compareTrajectory(intent,trajectoryRef.current,newlyRevealedRef.current,false):null;
    const contradicted=!!intent&&geometry.corridorEnds.some(end=>intent.suggestedCells.some(cell=>cell[0]===end[0]&&cell[1]===end[1]));
    let event:CompanionEvent|null=null,force=false;
    if(contradicted&&intent&&!contradictedGuidanceRef.current.has(intent.id)){contradictedGuidanceRef.current.add(intent.id);event={type:"recommendation_contradicted"};force=true}
    else if(environment&&!seenEnvironmentsRef.current.has(environment.regionId)){seenEnvironmentsRef.current.add(environment.regionId);event={type:"environment_visible",regionId:environment.regionId,environment:environment.id};force=Date.now()-lastCompanionCallRef.current>=5000}
    else{
      const newJunction=geometry.junctions.find(j=>!seenJunctionsRef.current.has(j.id));
      if(newJunction){seenJunctionsRef.current.add(newJunction.id);event={type:"new_junction_visible",routeIds:planRoutes(current.world,pose,current.moves,current.memory,current.visited).map(r=>r.id)}}
      else if(evidence?.reachedSameTargetByDifferentRoute)event={type:"same_target_reached_differently"};
      else if(evidence?.reachedSuggestedTarget)event={type:"target_reached"};
      else{
        const locationId=cellKey(current.player.x,current.player.y),familiar=current.recent.slice(0,-1).includes(locationId)&&!seenFamiliarPlacesRef.current.has(locationId);
        if(familiar){seenFamiliarPlacesRef.current.add(locationId);event={type:"familiar_place_visible",locationId}}
        else if(evidence&&(evidence.suggestedCellOverlap>=.45||evidence.rejoinedAt||evidence.newCellsRevealedOffSuggestedPath>=5))event={type:"trajectory_relationship_changed"};
      }
    }
    if(event)callCompanion(event,undefined,force);
  },[run.revision,ready,callCompanion]);

  useEffect(()=>{
    if(!ready)return;const interval=setInterval(()=>{
      const current=runRef.current,pose=poseRef.current,geometry=forwardVisibleGeometry(current.world,pose,current.moves),environment=visibleEnvironment(current.anchors,geometry,pose);
      const sample:TrajectorySample={time:Date.now(),position:[pose.x,pose.y],cell:[Math.floor(pose.x),Math.floor(pose.y)],heading:pose.angle,newlyVisibleCells:[],visibleJunctions:geometry.junctions.map(j=>j.id),visibleEnvironment:environment?.id??null};
      trajectoryRef.current=[...trajectoryRef.current,sample].slice(-40);
      const pending=pendingEventRef.current;if(pending&&!requestInFlightRef.current&&Date.now()-lastCompanionCallRef.current>=12000){pendingEventRef.current=null;callCompanion(pending)}
      else if(Date.now()-lastMovementRef.current>=15000&&Date.now()-lastIdleCallRef.current>=25000&&geometry.junctions.length)callCompanion({type:"idle_at_choice"});
    },5000);return()=>clearInterval(interval);
  },[ready,callCompanion]);

  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;const k=e.key.toLowerCase();if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(k)){e.preventDefault();heldRef.current.add(k)}};
    const up=(e:KeyboardEvent)=>heldRef.current.delete(e.key.toLowerCase()),blur=()=>heldRef.current.clear();
    const mouse=(e:MouseEvent)=>{if(document.pointerLockElement===canvasRef.current)poseRef.current.angle=wrap(poseRef.current.angle+e.movementX*.00125)};
    addEventListener("keydown",down);addEventListener("keyup",up);addEventListener("blur",blur);addEventListener("mousemove",mouse);
    return()=>{removeEventListener("keydown",down);removeEventListener("keyup",up);removeEventListener("blur",blur);removeEventListener("mousemove",mouse)};
  },[]);

  useEffect(()=>{
    let frame=0,previous=performance.now();
    const tick=(now:number)=>{
      const dt=Math.min((now-previous)/1000,.05);previous=now;const current=runRef.current,pose=poseRef.current,held=heldRef.current;
      let turn=0;if(held.has("a")||held.has("arrowleft"))turn--;if(held.has("d")||held.has("arrowright"))turn++;
      pose.angle=wrap(pose.angle+turn*TURN_SPEED*dt);let drive=0;if(held.has("w")||held.has("arrowup"))drive++;if(held.has("s")||held.has("arrowdown"))drive--;
      const moving=drive!==0;if(moving){
        const beforeX=pose.x,beforeY=pose.y;
        const distance=drive*MOVE_SPEED*dt,nx=pose.x+Math.cos(pose.angle)*distance,ny=pose.y+Math.sin(pose.angle)*distance,w=current.world;
        w.ensureAround(Math.floor(nx),Math.floor(ny),current.moves);
        const clearX=w.tile(Math.floor(nx-PLAYER_RADIUS),Math.floor(pose.y-PLAYER_RADIUS))===0&&w.tile(Math.floor(nx+PLAYER_RADIUS),Math.floor(pose.y+PLAYER_RADIUS))===0;if(clearX)pose.x=nx;
        const clearY=w.tile(Math.floor(pose.x-PLAYER_RADIUS),Math.floor(ny-PLAYER_RADIUS))===0&&w.tile(Math.floor(pose.x+PLAYER_RADIUS),Math.floor(ny+PLAYER_RADIUS))===0;if(clearY)pose.y=ny;
        pose.bob+=dt*9;if(Math.hypot(pose.x-beforeX,pose.y-beforeY)<.0005){collisionRef.current++;if(collisionRef.current===24)callCompanion({type:"repeated_collision"})}else collisionRef.current=0;
        const cell=cellKey(Math.floor(pose.x),Math.floor(pose.y));if(cell!==lastCellRef.current)enterCell(Math.floor(pose.x),Math.floor(pose.y));
      }
      const next=bearing(pose.angle);setHeading(old=>old===next?old:next);
      const ctx=canvasRef.current?.getContext("2d");if(ctx)renderWorld(ctx,current.world,current.anchors,current.entities,current.appearance,current.appearanceProtected,pose,moving,true,current.moves);
      frame=requestAnimationFrame(tick);
    };frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[enterCell,callCompanion]);

  const hold=(key:string,on:boolean)=>on?heldRef.current.add(key):heldRef.current.delete(key);
  const reset=()=>applyRun(newRun(randomSeed()));
  const sendToCompanion=async(e:React.FormEvent)=>{
    e.preventDefault();const text=companionInput.trim();if(!text)return;setCompanionInput("");heldRef.current.clear();
    const message:CompanionMessage={id:crypto.randomUUID(),role:"player",text:text.slice(0,500),time:Date.now()};setCompanionMessages(old=>[...old,message].slice(-18));messagesRef.current=[...messagesRef.current,message].slice(-18);
    await callCompanion({type:"player_message",text:message.text},message.text,true);
  };
  const mapCells=[];for(let oy=-MAP_RADIUS;oy<=MAP_RADIUS;oy++)for(let ox=-MAP_RADIUS;ox<=MAP_RADIUS;ox++){
    const x=run.player.x+ox,y=run.player.y+oy,memory=run.memory.get(cellKey(x,y));mapCells.push({id:`${ox},${oy}`,tile:memory?.tile,player:ox===0&&oy===0,age:memory?run.moves-memory.seenAt:999});
  }
  return <main className="shell">
    <div className={`boot-screen ${ready?"ready":""}`} aria-live="polite"><span>GENERATING SIGNAL</span></div>
    <header className="masthead"><div className="brand"><span>NULL</span> CORRIDOR</div><div className="status"><i/> STREAMING GEOMETRY</div></header>
    <section className="game-grid" aria-label="Infinite first person maze game">
      <div className="viewport-wrap"><div className="viewport-label"><span>CAM_01 // {heading}</span><span>CLICK VIEW FOR MOUSE LOOK</span></div>
        <canvas ref={canvasRef} width={960} height={560} aria-label="First-person view into an infinite maze" onClick={e=>e.currentTarget.requestPointerLock?.()}
          onTouchStart={e=>{touchXRef.current=e.touches[0]?.clientX??null}} onTouchMove={e=>{const x=e.touches[0]?.clientX;if(x!==undefined&&touchXRef.current!==null)poseRef.current.angle=wrap(poseRef.current.angle+(x-touchXRef.current)*.0035);touchXRef.current=x??null}} onTouchEnd={()=>{touchXRef.current=null}}/>
        <div className="vignette comfort-vignette"/>{companionMessages.at(-1)?.role==="ariadne"&&<div key={companionMessages.at(-1)?.id} className={`ariadne-subtitle ${companionMessages.at(-1)?.kind==="environment"?"discovery":""}`}><span>ARIADNE</span>{companionMessages.at(-1)?.text}</div>}</div>
      <aside className="console"><div className="console-head"><span>LOCAL MEMORY</span><span className="blink">REC</span></div>
        <div className="minimap infinite" style={{gridTemplateColumns:`repeat(${MAP_RADIUS*2+1},1fr)`}} aria-label="Moving window of remembered nearby geometry">
          {mapCells.map(c=><span key={c.id} style={{opacity:c.age>55?.25:c.age>30?.55:1}} className={`${c.tile===1?"wall":c.tile===0?"path":"unknown"} ${c.player?"player":""}`}/>)}</div>
        <p className="map-note">LOCAL MEMORY DECAYS BEYOND RANGE</p><dl className="telemetry"><div><dt>CELLS</dt><dd>{String(run.moves).padStart(3,"0")}</dd></div><div><dt>SHIFTS</dt><dd>{String(run.shifts).padStart(3,"0")}</dd></div><div><dt>BEARING</dt><dd>{heading}</dd></div></dl>
        <section className="ariadne-panel" aria-label="ARIADNE navigation companion"><div className="ariadne-head"><span>ARIADNE</span><span>{companionStatus}</span></div><div className="ariadne-log" aria-live="polite">
          {companionMessages.length===0?<p className="ariadne-empty">CALIBRATING LOCAL ROUTES…</p>:companionMessages.slice(-5).map(message=><p key={message.id} className={`${message.role} ${message.kind??""}`}><span>{message.role==="ariadne"?"ARIADNE":"YOU"}</span>{message.text}</p>)}
        </div><form className="ariadne-input" onSubmit={sendToCompanion}><label htmlFor="ariadne-message">OPTIONAL TEXT CHANNEL</label><div><input id="ariadne-message" value={companionInput} maxLength={500} onChange={e=>setCompanionInput(e.target.value)} onKeyDown={e=>{if(e.key==="Escape"){e.currentTarget.blur();canvasRef.current?.focus()}}} placeholder="SPEAK TO ARIADNE…"/><button type="submit" disabled={!companionInput.trim()||companionStatus==="THINKING"}>↵</button></div></form></section></aside>
    </section>
    <footer className="controls"><div className="control-copy"><span>NO MAP EDGE</span><p>HOLD W/S · TURN WITH A/D · THE WORLD CONTINUES</p></div><div className="keys" aria-label="Maze controls">
      {[["a","A","Turn left"],["w","W","Move forward"],["d","D","Turn right"],["s","S","Move backward"]].map(([k,l,a])=><button key={k} onPointerDown={()=>hold(k,true)} onPointerUp={()=>hold(k,false)} onPointerLeave={()=>hold(k,false)} aria-label={a}>{l}</button>)}</div><button className="reset" onClick={reset}>NEW SIGNAL</button></footer>
  </main>;
}
