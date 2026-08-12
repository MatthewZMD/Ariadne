import { cellKey, type InfiniteWorld } from "./world.mjs";
import { themeAt, type ThemeAnchor, type ThemeId } from "./themes.ts";
import { CAMERA_FOV } from "./camera.ts";
import type { Pose } from "./renderer.ts";

export type Point = [number, number];
export type RouteDirection = "left" | "right" | "straight" | "back";
export type ReplyKind = "guidance" | "praise" | "apology" | "agreement" | "reframe" | "environment" | "reply" | "observation" | "silence";

export type RouteOption = {
  id:string;direction:RouteDirection;knownCells:Point[];targetCell:Point|null;
  targetRegionId:string|null;description:string;instruction:string;score:number;
};

export type GuidanceIntent = {
  id:string;issuedAt:number;message:string;
  kind:"take_branch"|"continue_corridor"|"reach_junction"|"return_to_location"|"explore_region"|"avoid_route";
  origin:Point;originHeading:number;suggestedRouteId:string|null;suggestedCells:Point[];
  targetCell:Point|null;targetRegionId:string|null;avoidedCells:Point[];
  expiresWhen:"target_reached"|"route_invalidated"|"new_recommendation"|"meaningful_divergence";
};

export type TrajectorySample = {
  time:number;position:Point;cell:Point;heading:number;newlyVisibleCells:Point[];
  visibleJunctions:string[];visibleEnvironment:ThemeId|null;
};

export type GuidanceEvidence = {
  recommendationId:string;elapsedSeconds:number;initialDirectionSimilarity:number;
  suggestedCellOverlap:number;movementTowardTarget:number;movementAwayFromTarget:number;
  sharedCells:Point[];deviationCell:Point|null;rejoinedAt:Point|null;
  reachedSuggestedTarget:boolean;reachedSameTargetByDifferentRoute:boolean;enteredSuggestedRegion:boolean;
  recommendationStillPossible:boolean;recommendationContradictedByVisibleEvidence:boolean;
  newCellsRevealedOnSuggestedPath:number;newCellsRevealedOffSuggestedPath:number;
  loopEncountered:boolean;backtrackingObserved:boolean;playerCurrentlyNearSuggestedRoute:boolean;
};

export type PlayerActivity = {
  state:"stationary"|"turning_in_place"|"walking";
  stationarySeconds:number;
  positionChangedSinceRecommendation:boolean;
  headingChangedSinceRecommendation:boolean;
  atVisibleChoice:boolean;
  description:string;
};

export type VisibleGeometry = {
  cells:Point[];junctions:Array<{id:string;cell:Point;open:string[]}>;
  corridorEnds:Point[];summary:string;
};

export type EgocentricView = {
  facing:"north"|"east"|"south"|"west";
  centerView:string;
  openings:RouteDirection[];
  blocked:RouteDirection[];
  description:string;
};

export type VisibleEnvironment = {id:ThemeId;regionId:string;name:string;details:string[]}|null;

export type CompanionEvent =
  | {type:"trajectory_relationship_changed"}
  | {type:"recommendation_contradicted"}
  | {type:"target_reached"}
  | {type:"same_target_reached_differently"}
  | {type:"new_junction_visible";routeIds:string[]}
  | {type:"revisited_position"}
  | {type:"environment_visible";regionId:string;environment:ThemeId}
  | {type:"environment_entered";regionId:string;environment:ThemeId}
  | {type:"sustained_backtrack"}
  | {type:"repeated_collision"}
  | {type:"idle";seconds:number;atChoice:boolean}
  | {type:"player_message";text:string}
  | {type:"initial_guidance"};

export type CompanionMessage = {id:string;role:"ariadne"|"player";text:string;time:number;kind?:ReplyKind};
export type CompanionReply = {message:string;selectedRouteId:string|null;kind:ReplyKind};

export const ENVIRONMENTS:Record<Exclude<ThemeId,"neutral">,{name:string;details:string[]}>= {
  beach:{name:"buried beach",details:["sand","salt-stained walls","shells","driftwood"]},
  tornado:{name:"storm passage",details:["dust","warning panels","dark clouds","wind-blown debris"]},
  ruins:{name:"overgrown ruins",details:["vines","stone faces","fungus","broken statues"]},
  frozen:{name:"frozen archive",details:["ice","shelves","loose pages","frosted windows"]},
  foundry:{name:"abandoned foundry",details:["pipes","vents","embers","furnace doors"]},
  cavern:{name:"glowing cavern",details:["crystals","mushrooms","spores","small lights"]},
};

const DIRS = [[1,0,"east"],[0,1,"south"],[-1,0,"west"],[0,-1,"north"]] as const;
const pointKey=(p:Point)=>cellKey(p[0],p[1]);
const same=(a:Point|null,b:Point|null)=>!!a&&!!b&&a[0]===b[0]&&a[1]===b[1];
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const wrapAngle=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));

function openNeighbors(world:InfiniteWorld,x:number,y:number,tick:number):Point[]{
  return DIRS.filter(([dx,dy])=>world.tile(x+dx,y+dy,tick)===0).map(([dx,dy])=>[x+dx,y+dy]);
}

export function forwardVisibleGeometry(world:InfiniteWorld,pose:Pose,tick:number,maxDistance=12):VisibleGeometry{
  const visible=new Set<string>(),points=new Map<string,Point>();
  const rays=121,fov=CAMERA_FOV;
  for(let i=0;i<rays;i++){
    const angle=pose.angle-fov/2+fov*(i/(rays-1));
    for(let d=.04;d<=maxDistance;d+=.055){
      const p:[number,number]=[Math.floor(pose.x+Math.cos(angle)*d),Math.floor(pose.y+Math.sin(angle)*d)],key=pointKey(p);
      visible.add(key);points.set(key,p);if(world.tile(p[0],p[1],tick)!==0)break;
    }
  }
  const open=[...points.values()].filter(([x,y])=>world.tile(x,y,tick)===0);
  const junctions=open.flatMap((p)=>{
    const neighbors=openNeighbors(world,p[0],p[1],tick),seen=neighbors.filter(n=>visible.has(pointKey(n)));
    if(neighbors.length<3||seen.length<3)return[];
    return[{id:`junction:${pointKey(p)}`,cell:p,open:seen.map(n=>pointKey(n))}];
  });
  const corridorEnds=open.filter(p=>{
    const neighbors=openNeighbors(world,p[0],p[1],tick);
    return neighbors.length===1&&neighbors.every(n=>visible.has(pointKey(n)));
  });
  const nearestEnd=corridorEnds.sort((a,b)=>Math.hypot(a[0]-pose.x,a[1]-pose.y)-Math.hypot(b[0]-pose.x,b[1]-pose.y))[0];
  const summary=[`${open.length} open cells are visible`,junctions.length?`${junctions.length} junction${junctions.length===1?"":"s"} visible`:"no complete junction visible",nearestEnd?`a closed corridor is visible at ${pointKey(nearestEnd)}`:"no confirmed corridor ending visible"].join("; ");
  return{cells:[...points.values()].slice(0,260),junctions:junctions.slice(0,12),corridorEnds:corridorEnds.slice(0,12),summary};
}

function relativeDirection(pose:Pose,next:Point):RouteDirection{
  const originX=Math.floor(pose.x),originY=Math.floor(pose.y);
  const angle=Math.atan2(next[1]-originY,next[0]-originX),delta=wrapAngle(angle-pose.angle);
  if(Math.abs(delta)<Math.PI/4)return"straight";
  if(Math.abs(delta)>Math.PI*3/4)return"back";
  return delta<0?"left":"right";
}

const routeInstruction=(direction:RouteDirection)=>direction==="straight"?"Continue ahead.":direction==="back"?"Turn around.":`Turn ${direction}.`;

export function instructionForCurrentChoice(selected:RouteOption|null,currentRoutes:RouteOption[]){
  if(!selected)return"";
  const distinct=new Set(currentRoutes.map(route=>route.direction));
  if(distinct.size<=1)return routeInstruction(selected.direction);
  if(selected.direction==="straight")return"Take the center opening.";
  if(selected.direction==="back")return"Turn around and take the opening behind you.";
  return`Take the opening on your ${selected.direction}.`;
}

function forwardClearance(world:InfiniteWorld,pose:Pose,tick:number){
  for(let distance=.04;distance<=12;distance+=.04){
    const x=Math.floor(pose.x+Math.cos(pose.angle)*distance),y=Math.floor(pose.y+Math.sin(pose.angle)*distance);
    if(world.tile(x,y,tick)!==0)return distance;
  }
  return 12;
}

export function describeEgocentricView(world:InfiniteWorld,pose:Pose,tick:number,routes:RouteOption[]):EgocentricView{
  const facing=["east","south","west","north"] as const;
  const direction=facing[Math.round(((pose.angle%(Math.PI*2))+Math.PI*2)%(Math.PI*2)/(Math.PI/2))%4];
  const openings=[...new Set(routes.map(route=>route.direction))];
  const directions:RouteDirection[]=["straight","left","right","back"];
  const blocked=directions.filter(item=>!openings.includes(item));
  const clearance=forwardClearance(world,pose,tick);
  const centerView=clearance<.75?"a wall fills the center of the view":clearance<2?"a wall is close ahead":clearance<5?"the passage continues briefly before a wall":"the passage extends ahead";
  const openingText=openings.length?openings.map(item=>item==="straight"?"ahead":item==="back"?"behind":`on the ${item}`).join(", "):"none";
  const blockedText=blocked.map(item=>item==="straight"?"ahead":item==="back"?"behind":`on the ${item}`).join(", ");
  const blockedSentence=blocked.length?` There is no open passage ${blockedText}.`:"";
  return{facing:direction,centerView,openings,blocked,description:`The player is facing ${direction}. ${centerView}. Verified open passages from the current position: ${openingText}.${blockedSentence}`};
}

export function planRoutes(world:InfiniteWorld,pose:Pose,tick:number,memory:Map<string,{tile:number}>,visited:Set<string>):RouteOption[]{
  const origin:Point=[Math.floor(pose.x),Math.floor(pose.y)],neighbors=openNeighbors(world,origin[0],origin[1],tick);
  const options=neighbors.map((first,index)=>{
    const cells:Point[]=[first];let previous=origin,current=first;
    for(let step=0;step<11;step++){
      const options=openNeighbors(world,current[0],current[1],tick).filter(p=>!same(p,previous)&&memory.get(pointKey(p))?.tile===0);
      if(options.length!==1)break;previous=current;current=options[0];cells.push(current);
    }
    const direction=relativeDirection(pose,first),knownVisits=cells.filter(p=>visited.has(pointKey(p))).length;
    const frontierBonus=openNeighbors(world,current[0],current[1],tick).filter(p=>!memory.has(pointKey(p))).length;
    const around=DIRS.map(([dx,dy])=>memory.get(cellKey(current[0]+dx,current[1]+dy))?.tile),confirmedEnding=around.every(tile=>tile!==undefined)&&openNeighbors(world,current[0],current[1],tick).length===1;
    const score=frontierBonus*4+(cells.length-knownVisits)*2-knownVisits-(direction==="back"?3:0)-(confirmedEnding?50:0);
    const instruction=routeInstruction(direction);
    return{id:`route:${pointKey(origin)}:${pointKey(first)}:${index}`,direction,knownCells:cells,targetCell:current,targetRegionId:null,description:`Verified open passage ${direction==="straight"?"ahead":direction==="back"?"behind the player":`on the player's ${direction}`}. It continues through ${cells.length} known open cell${cells.length===1?"":"s"}.`,instruction,score};
  }).sort((a,b)=>b.score-a.score);
  const viable=options.filter(route=>route.score>-30);return(viable.length?viable:options).slice(0,4);
}

export function rebaseSelectedRoute(selected:RouteOption|null,latestRoutes:RouteOption[]){
  const first=selected?.knownCells[0];
  return first?latestRoutes.find(candidate=>candidate.knownCells[0]?.[0]===first[0]&&candidate.knownCells[0]?.[1]===first[1])??null:null;
}

export function visibleEnvironment(anchors:ThemeAnchor[],geometry:VisibleGeometry,pose:Pose):VisibleEnvironment{
  const samples=geometry.cells.map(([x,y])=>({x,y,theme:themeAt(anchors,x+.5,y+.5)})).filter(s=>s.theme.id!=="neutral"&&s.theme.influence>.22).sort((a,b)=>b.theme.influence-a.theme.influence);
  const best=samples[0]??(()=>{const theme=themeAt(anchors,pose.x,pose.y);return theme.id!=="neutral"&&theme.influence>.22?{x:Math.floor(pose.x),y:Math.floor(pose.y),theme}:null})();
  if(!best||best.theme.id==="neutral")return null;
  const definition=ENVIRONMENTS[best.theme.id],details=definition.details.slice(0,2),anchor=anchors.filter(a=>a.theme===best.theme.id).sort((a,b)=>Math.hypot(a.x-best.x,a.y-best.y)-Math.hypot(b.x-best.x,b.y-best.y))[0];
  return{id:best.theme.id,regionId:anchor?`${best.theme.id}:${anchor.x}:${anchor.y}`:`${best.theme.id}:visible`,name:definition.name,details};
}

export function createGuidanceIntent(reply:CompanionReply,route:RouteOption|null,pose:Pose,now=Date.now()):GuidanceIntent|null{
  if(!reply.message||!route)return null;
  return{id:`guidance:${now}`,issuedAt:now,message:reply.message,kind:route.knownCells.length>1?"reach_junction":"take_branch",origin:[Math.floor(pose.x),Math.floor(pose.y)],originHeading:pose.angle,suggestedRouteId:route.id,suggestedCells:route.knownCells,targetCell:route.targetCell,targetRegionId:route.targetRegionId,avoidedCells:[],expiresWhen:"new_recommendation"};
}

export function compareTrajectory(intent:GuidanceIntent,samples:TrajectorySample[],newlyRevealed:Set<string>,contradicted=false):GuidanceEvidence{
  const actual=samples.map(s=>s.cell).filter((p,i,a)=>i===0||!same(p,a[i-1])),suggested=new Set(intent.suggestedCells.map(pointKey));
  const shared=actual.filter(p=>suggested.has(pointKey(p))),firstMove=actual.find(p=>!same(p,intent.origin));
  const suggestedVector=intent.suggestedCells[0]?[intent.suggestedCells[0][0]-intent.origin[0],intent.suggestedCells[0][1]-intent.origin[1]]:null;
  const actualVector=firstMove?[firstMove[0]-intent.origin[0],firstMove[1]-intent.origin[1]]:null;
  const similarity=suggestedVector&&actualVector?clamp((suggestedVector[0]*actualVector[0]+suggestedVector[1]*actualVector[1])/(Math.hypot(...suggestedVector)*Math.hypot(...actualVector))*0.5+0.5):.5;
  const deviationIndex=actual.findIndex(p=>!same(p,intent.origin)&&!suggested.has(pointKey(p))),deviation=deviationIndex>=0?actual[deviationIndex]:null;
  const rejoined=deviationIndex>=0?actual.slice(deviationIndex+1).find(p=>suggested.has(pointKey(p)))??null:null;
  const startDistance=intent.targetCell?Math.max(1,Math.abs(intent.origin[0]-intent.targetCell[0])+Math.abs(intent.origin[1]-intent.targetCell[1])):1;
  const last=actual.at(-1)??intent.origin,currentDistance=intent.targetCell?Math.abs(last[0]-intent.targetCell[0])+Math.abs(last[1]-intent.targetCell[1]):startDistance;
  const delta=(startDistance-currentDistance)/startDistance,reached=same(last,intent.targetCell);
  const pathKeys=actual.map(pointKey),loop=pathKeys.some((key,i)=>pathKeys.indexOf(key)<i-1);
  let reversals=0;for(let i=2;i<actual.length;i++)if(same(actual[i],actual[i-2]))reversals++;
  return{recommendationId:intent.id,elapsedSeconds:Math.max(0,(Date.now()-intent.issuedAt)/1000),initialDirectionSimilarity:similarity,suggestedCellOverlap:actual.length?shared.length/actual.length:0,movementTowardTarget:clamp(delta),movementAwayFromTarget:clamp(-delta),sharedCells:shared.slice(0,24),deviationCell:deviation,rejoinedAt:rejoined,reachedSuggestedTarget:reached,reachedSameTargetByDifferentRoute:reached&&shared.length<Math.max(1,actual.length/2),enteredSuggestedRegion:false,recommendationStillPossible:!contradicted,recommendationContradictedByVisibleEvidence:contradicted,newCellsRevealedOnSuggestedPath:[...newlyRevealed].filter(k=>suggested.has(k)).length,newCellsRevealedOffSuggestedPath:[...newlyRevealed].filter(k=>!suggested.has(k)).length,loopEncountered:loop,backtrackingObserved:reversals>=2,playerCurrentlyNearSuggestedRoute:intent.suggestedCells.some(p=>Math.abs(p[0]-last[0])+Math.abs(p[1]-last[1])<=1)};
}

export function analyzePlayerActivity(samples:TrajectorySample[],now:number,lastTranslationAt:number,lastTurnAt:number,atVisibleChoice:boolean):PlayerActivity{
  const translationIdle=Math.max(0,(now-lastTranslationAt)/1000),turnIdle=Math.max(0,(now-lastTurnAt)/1000),stationarySeconds=Math.floor(Math.min(translationIdle,turnIdle));
  const first=samples[0],positionChanged=!!first&&samples.some(sample=>Math.hypot(sample.position[0]-first.position[0],sample.position[1]-first.position[1])>=.08);
  const headingChanged=!!first&&samples.some(sample=>Math.abs(wrapAngle(sample.heading-first.heading))>=.12);
  const state:PlayerActivity["state"]=stationarySeconds>=5?"stationary":translationIdle>=2&&turnIdle<2?"turning_in_place":"walking";
  const description=state==="stationary"?`The player has remained completely still for ${stationarySeconds} seconds. Their position and viewing direction have not changed during that time.`:state==="turning_in_place"?"The player is looking around without changing position.":"The player is currently walking or has walked within the last few seconds.";
  return{state,stationarySeconds:state==="stationary"?stationarySeconds:0,positionChangedSinceRecommendation:positionChanged,headingChangedSinceRecommendation:headingChanged,atVisibleChoice,description};
}

export function verifiedAutonomousObservation(event:CompanionEvent,environment:VisibleEnvironment,activity:PlayerActivity,routeCount:number){
  if(event.type==="idle")return`You have stayed still for ${activity.stationarySeconds} seconds. I will wait.`;
  if(event.type==="revisited_position")return"You have stood in this exact spot before.";
  if(event.type==="environment_visible"&&environment)return`You can see ${environment.details.join(" and ")} here—this is ${/^([aeiou])/i.test(environment.name)?"an":"a"} ${environment.name}.`;
  if(event.type==="recommendation_contradicted")return"The direction I gave you is blocked from where you are now. Sorry.";
  if(event.type==="repeated_collision")return"There is a wall directly in front of you.";
  if(event.type==="new_junction_visible"&&routeCount>1)return"There is more than one open direction from here.";
  return"";
}

export function compactMap(memory:Map<string,{tile:number}>,center:Point,radius=7){
  const rows:string[]=[];for(let y=center[1]-radius;y<=center[1]+radius;y++){let row="";for(let x=center[0]-radius;x<=center[0]+radius;x++){if(x===center[0]&&y===center[1])row+="P";else{const tile=memory.get(cellKey(x,y))?.tile;row+=tile===0?".":tile===1?"#":"?"}}rows.push(row)}return rows.join("\n");
}

export function deterministicReply(event:CompanionEvent,routes:RouteOption[],environment:VisibleEnvironment,evidence:GuidanceEvidence|null,previousMessages:CompanionMessage[]=[]):CompanionReply{
  const route=routes[0]??null,direction=route?.direction??"back";
  const routeText=route?.instruction??routeInstruction(direction);
  let message=routeText,kind:ReplyKind="guidance";
  if(event.type==="environment_visible"&&environment){
    const variants=[`We haven't found the exit yet, but you've found a ${environment.name}.`,`A ${environment.name}. Not what I expected, but the search continues.`,`No exit yet—but this ${environment.name} is worth finding.`];
    message=`${variants[previousMessages.filter(m=>m.kind==="environment").length%variants.length]} ${route?routeText:""}`.trim();kind="environment";
  }else if(event.type==="recommendation_contradicted"){
    message=`Sorry—that route does not continue. ${routeText}`;kind="apology";
  }else if(event.type==="same_target_reached_differently"){
    message=`Good choice. Your way reached the same area. ${routeText}`;kind="agreement";
  }else if(event.type==="trajectory_relationship_changed"&&evidence){
    if(evidence.rejoinedAt)message=`That works—you have joined the route again. ${routeText}`;
    else if(evidence.newCellsRevealedOffSuggestedPath>evidence.newCellsRevealedOnSuggestedPath)message=`Good choice. This way has revealed more of the maze. ${routeText}`;
    else message=`Good. We are still moving into new ground. ${routeText}`;
    kind="praise";
  }else if(event.type==="idle"){
    message=`You have stayed still for ${event.seconds} seconds. I will wait.`;kind="observation";
  }else if(event.type==="player_message"){
    message=`I hear you. ${routeText}`;kind="reply";
  }
  return{message:message.slice(0,260),selectedRouteId:route?.id??null,kind};
}
