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
  decisionPoint?:"current"|"upcoming";decisionCell?:Point;
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

const routeInstruction=(direction:RouteDirection)=>direction==="straight"?"Keep going.":direction==="back"?"Turn around.":`Turn ${direction}.`;

export function instructionForCurrentChoice(selected:RouteOption|null,currentRoutes:RouteOption[]){
  if(!selected)return"";
  if(selected.decisionPoint==="upcoming")return selected.instruction;
  const distinct=new Set(currentRoutes.map(route=>route.direction));
  if(distinct.size<=1)return routeInstruction(selected.direction);
  if(selected.direction==="straight")return"Go straight.";
  if(selected.direction==="back")return"Turn around.";
  return`Go ${selected.direction}.`;
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
  return{facing:direction,centerView,openings,blocked,description:`The player is facing ${direction}. ${centerView}. The open ways from here are ${openingText}.${blockedSentence}`};
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
    return{id:`route:${pointKey(origin)}:${pointKey(first)}:${index}`,direction,knownCells:cells,targetCell:current,targetRegionId:null,description:`There is an open way ${direction==="straight"?"ahead":direction==="back"?"behind":`to the ${direction}`}.`,instruction,score};
  }).sort((a,b)=>b.score-a.score);
  const viable=options.filter(route=>route.score>-30);return(viable.length?viable:options).slice(0,4);
}

export function planApproachingJunctionRoutes(world:InfiniteWorld,pose:Pose,tick:number,geometry:VisibleGeometry,memory:Map<string,{tile:number}>,visited:Set<string>):RouteOption[]{
  const origin:Point=[Math.floor(pose.x),Math.floor(pose.y)],facing:[number,number]=[Math.cos(pose.angle),Math.sin(pose.angle)];
  const junction=geometry.junctions.map(item=>{
    const dx=item.cell[0]+.5-pose.x,dy=item.cell[1]+.5-pose.y,distance=Math.hypot(dx,dy),alignment=distance?((dx*facing[0]+dy*facing[1])/distance):0;
    return{...item,distance,alignment};
  }).filter(item=>item.distance>=1&&item.distance<=8&&item.alignment>=.9).sort((a,b)=>a.distance-b.distance)[0];
  if(!junction)return[];
  const deltaX=junction.cell[0]-origin[0],deltaY=junction.cell[1]-origin[1];
  if(deltaX!==0&&deltaY!==0)return[];
  const step:Point=deltaX!==0?[Math.sign(deltaX),0]:[0,Math.sign(deltaY)];
  if(step[0]===0&&step[1]===0)return[];
  const path:Point[]=[];let cursor:Point=[origin[0]+step[0],origin[1]+step[1]];
  while(!same(cursor,junction.cell)&&path.length<12){if(world.tile(cursor[0],cursor[1],tick)!==0)return[];path.push(cursor);cursor=[cursor[0]+step[0],cursor[1]+step[1]]}
  if(!same(cursor,junction.cell)||world.tile(cursor[0],cursor[1],tick)!==0)return[];path.push(junction.cell);
  const approach:Point=[junction.cell[0]-step[0],junction.cell[1]-step[1]],arrivalPose:Pose={x:junction.cell[0]+.5,y:junction.cell[1]+.5,angle:Math.atan2(step[1],step[0]),bob:0};
  return openNeighbors(world,junction.cell[0],junction.cell[1],tick).filter(cell=>!same(cell,approach)).map((branch,index)=>{
    const direction=relativeDirection(arrivalPose,branch),knownVisits=visited.has(pointKey(branch))?1:0,frontierBonus=openNeighbors(world,branch[0],branch[1],tick).filter(cell=>!memory.has(pointKey(cell))).length;
    const instruction=direction==="straight"?"At the intersection, go straight.":direction==="back"?"At the intersection, turn around.":`At the intersection, turn ${direction}.`;
    return{id:`approach:${pointKey(junction.cell)}:${pointKey(branch)}:${index}`,direction,knownCells:[...path,branch],targetCell:branch,targetRegionId:null,description:instruction, instruction,score:frontierBonus*4-knownVisits*2+(direction==="straight"?1:0),decisionPoint:"upcoming" as const,decisionCell:junction.cell};
  }).sort((a,b)=>b.score-a.score);
}

export function rebaseSelectedRoute(selected:RouteOption|null,latestRoutes:RouteOption[]){
  if(selected?.decisionPoint==="upcoming"){
    const target=selected.targetCell;
    return target?latestRoutes.find(candidate=>same(candidate.targetCell,target))??null:null;
  }
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
  const description=state==="stationary"?"The player is standing still and has not changed where they are looking.":state==="turning_in_place"?"The player is looking around without walking.":"The player is walking.";
  return{state,stationarySeconds:state==="stationary"?stationarySeconds:0,positionChangedSinceRecommendation:positionChanged,headingChangedSinceRecommendation:headingChanged,atVisibleChoice,description};
}

export function verifiedAutonomousObservation(event:CompanionEvent,environment:VisibleEnvironment,activity:PlayerActivity,routeCount:number){
  if(event.type==="idle")return"No rush.";
  if(event.type==="revisited_position")return"We've been here before.";
  if(event.type==="environment_visible"&&environment)return`${/^([aeiou])/i.test(environment.name)?"An":"A"} ${environment.name}—${environment.details.join(" and ")}, all the way down here.`;
  if(event.type==="recommendation_contradicted")return"That way is blocked.";
  if(event.type==="repeated_collision")return"That's a wall.";
  if(event.type==="new_junction_visible"&&routeCount>1)return"";
  return"";
}

export function verifiedSocialReaction(kind:ReplyKind,event:CompanionEvent,evidence:GuidanceEvidence|null){
  if(event.type==="idle")return"";
  if(event.type==="recommendation_contradicted")return"Oh no—that's completely on me.";
  if(event.type==="same_target_reached_differently")return kind==="praise"?"Good choice.":"You were right to take that direction.";
  if(event.type==="trajectory_relationship_changed"&&evidence?.newCellsRevealedOffSuggestedPath)return kind==="agreement"?"Good call. There's more to see this way.":"Good choice. There's more to see this way.";
  if(event.type==="revisited_position")return"Good catch.";
  if(kind==="praise"){
    if(event.type==="environment_visible")return"Good find.";
  }
  if(kind==="reframe"){
    if(event.type==="environment_visible")return"Not the exit, but this is worth seeing.";
  }
  return"";
}

export function compactMap(memory:Map<string,{tile:number}>,center:Point,radius=7){
  const rows:string[]=[];for(let y=center[1]-radius;y<=center[1]+radius;y++){let row="";for(let x=center[0]-radius;x<=center[0]+radius;x++){if(x===center[0]&&y===center[1])row+="P";else{const tile=memory.get(cellKey(x,y))?.tile;row+=tile===0?".":tile===1?"#":"?"}}rows.push(row)}return rows.join("\n");
}

export function deterministicReply(event:CompanionEvent,routes:RouteOption[],environment:VisibleEnvironment,evidence:GuidanceEvidence|null,previousMessages:CompanionMessage[]=[]):CompanionReply{
  const route=routes[0]??null;
  let message="Okay, I have a really good feeling about this.",kind:ReplyKind="guidance";
  if(event.type==="environment_visible"&&environment){
    const variants=["Oh my god, look at this.","Okay, wait—I love this.","I absolutely did not expect this."];
    message=variants[previousMessages.filter(m=>m.kind==="environment").length%variants.length];kind="environment";
  }else if(event.type==="recommendation_contradicted"){
    message="Oh no—that's completely on me.";kind="apology";
  }else if(event.type==="same_target_reached_differently"){
    message="Oh my god, you got there without me. I love that.";kind="agreement";
  }else if(event.type==="trajectory_relationship_changed"&&evidence){
    const variants=["Okay, wait—you were absolutely onto something there.","Oh my god, yes. Trust that instinct.","I love that you committed to that."];
    message=variants[previousMessages.filter(m=>m.kind==="praise").length%variants.length];kind="praise";
  }else if(event.type==="idle"){
    message=event.atChoice?"Okay, I can feel you thinking. Come on—trust me on this one.":"Wait, what are we feeling here?";kind="observation";
  }else if(event.type==="player_message"){
    message="Okay, yes—I'm with you.";kind="reply";
  }
  return{message:message.slice(0,260),selectedRouteId:route?.id??null,kind};
}
