import { cellKey, type InfiniteWorld } from "./world.mjs";
import { themeAt, type ThemeAnchor, type ThemeId } from "./themes.ts";
import { CAMERA_FOV } from "./camera.ts";
import type { Pose } from "./renderer.ts";
import type { NavigationBelief, PublicObjectiveContext } from "./objectives.ts";
import { openingOrdinalWord, type Point, type RouteDirection, type RouteOption } from "./navigation-contracts.ts";
export type { Point, RouteDirection, RouteOption } from "./navigation-contracts.ts";

export type ReplyKind = "guidance" | "praise" | "apology" | "agreement" | "reframe" | "environment" | "reply" | "observation" | "silence";

export type GuidanceIntent = {
  id:string;issuedAt:number;message:string;
  kind:"take_branch"|"continue_corridor"|"reach_junction"|"return_to_location"|"explore_region"|"avoid_route";
  origin:Point;originHeading:number;suggestedRouteId:string|null;suggestedCells:Point[];
  targetCell:Point|null;targetRegionId:string|null;avoidedCells:Point[];
  decisionCell:Point;expectedChoiceCell:Point|null;
  expiresWhen:"target_reached"|"route_invalidated"|"new_recommendation"|"meaningful_divergence";
};

export type TrajectoryChange = "sustained_alignment"|"sustained_divergence"|"left_then_rejoined"|"same_waypoint_different_route"|"recommendation_visibly_contradicted";
export type EncounterKind = "new_junction"|"visible_dead_end"|"new_environment"|"familiar_place"|"route_reconnection"|"star_collected"|TrajectoryChange;

export type TrajectorySample = {
  time:number;position:Point;cell:Point;heading:number;newlyVisibleCells:Point[];
  visibleJunctions:string[];visibleEnvironment:ThemeId|null;
  movementState:"walking"|"turning"|"stationary";
};

export type TrajectoryEvidence = {
  activeSeconds:number;initialDirectionSimilarity:number;suggestedCellOverlap:number;
  alignedSeconds:number;divergedSeconds:number;sharedCells:Point[];
  firstDeviationCell:Point|null;latestRejoinCell:Point|null;
  currentlyNearSuggestedRoute:boolean;reachedSameWaypointDifferently:boolean;visiblyContradicted:boolean;
  revealedOnSuggestedRoute:number;revealedAwayFromSuggestedRoute:number;
  backtrackingObserved:boolean;familiarGeometryReached:boolean;
};
export type GuidanceEvidence = TrajectoryEvidence;

export type GuidanceTrace = {
  recommendation:GuidanceIntent;startedAt:number;activeSeconds:number;
  samples:TrajectorySample[];suggestedCells:Point[];actualCells:Point[];
  evidence:TrajectoryEvidence;emittedChanges:TrajectoryChange[];
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
  | {type:"trajectory_relationship_changed";change:TrajectoryChange}
  | {type:"recommendation_contradicted"}
  | {type:"target_reached"}
  | {type:"same_target_reached_differently"}
  | {type:"new_junction_visible"}
  | {type:"dead_end_visible";cell:Point}
  | {type:"passing_thought"}
  | {type:"revisited_position"}
  | {type:"environment_visible";regionId:string;environment:ThemeId}
  | {type:"environment_entered";regionId:string;environment:ThemeId}
  | {type:"scene_changed";sceneId:string}
  | {type:"sustained_backtrack"}
  | {type:"repeated_collision"}
  | {type:"idle";atChoice:boolean}
  | {type:"player_message";text:string}
  | {type:"star_visible";starId:string;ordinal:1|2|3|4}
  | {type:"star_collected";starId:string;ordinal:1|2|3|4}
  | {type:"objective_changed";collectedStars:number}
  | {type:"initial_guidance"};

export type CompanionMessage = {id:string;role:"ariadne"|"player";text:string;time:number;kind?:ReplyKind};
export type CompanionReply = {message:string;selectedRouteId:string|null;kind:ReplyKind};
export type CompanionCue = {key:string;event:CompanionEvent;force:boolean};
export type CompanionPhase = "charming"|"attached"|"overbearing";
export type JourneyState = {
  phase:CompanionPhase;activeWalkSeconds:number;activeWalkSecondsInPhase:number;
  uniqueCellsVisited:number;meaningfulEncounters:number;encounteredKinds:EncounterKind[];
  relationshipDepth:number;recentRelationshipMoments:TrajectoryChange[];
};
export type CompanionArc = {phase:CompanionPhase;performanceDirection:string;relationshipContext:string};
export const PLAYER_NAME="MT";

const normalizedSpeech=(text:string)=>text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
export function isRecentCompanionRepeat(text:string,messages:CompanionMessage[],windowSize=6){
  const candidate=normalizedSpeech(text);if(!candidate)return false;
  return messages.filter(message=>message.role==="ariadne").slice(-windowSize).some(message=>normalizedSpeech(message.text)===candidate);
}

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
    const neighbors=openNeighbors(world,p[0],p[1],tick);
    if(neighbors.length<3)return[];
    return[{id:`junction:${pointKey(p)}`,cell:p,open:neighbors.map(n=>pointKey(n))}];
  });
  const corridorEnds=open.filter(p=>{
    const neighbors=openNeighbors(world,p[0],p[1],tick);if(neighbors.length!==1)return false;
    const [entrance]=neighbors;
    const endWall:Point=[p[0]+p[0]-entrance[0],p[1]+p[1]-entrance[1]];
    return visible.has(pointKey(endWall));
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

export function planVisibleJunctionRoutes(world:InfiniteWorld,pose:Pose,tick:number,geometry:VisibleGeometry,memory:Map<string,{tile:number}>,visited:Set<string>):RouteOption[]{
  const origin:Point=[Math.floor(pose.x),Math.floor(pose.y)],visibleOpen=new Set(geometry.cells.filter(([x,y])=>world.tile(x,y,tick)===0).map(pointKey));visibleOpen.add(pointKey(origin));
  const queue:Point[]=[origin],parents=new Map<string,Point|null>([[pointKey(origin),null]]);
  while(queue.length){
    const current=queue.shift()!;
    for(const neighbor of openNeighbors(world,current[0],current[1],tick)){
      const key=pointKey(neighbor);if(!visibleOpen.has(key)||parents.has(key))continue;
      parents.set(key,current);queue.push(neighbor);
    }
  }
  const reachable=geometry.junctions.filter(item=>parents.has(pointKey(item.cell))).map(junction=>{
    const path:Point[]=[];let cursor:Point|null=junction.cell;
    while(cursor){path.unshift(cursor);cursor=parents.get(pointKey(cursor))??null}
    return{junction,path};
  }).sort((a,b)=>a.path.length-b.path.length);
  if(!reachable.length)return[];
  const current=reachable.find(({path})=>path.length===1);
  const currentRoutes=current?planRoutes(world,pose,tick,memory,visited).map(route=>({...route,decisionPoint:"current" as const,decisionCell:current.junction.cell})):[];
  const upcomingRoutes=reachable.filter(({path})=>path.length>1).flatMap(({junction,path})=>{
    const approach=path.at(-2)!,step:Point=[junction.cell[0]-approach[0],junction.cell[1]-approach[1]],arrivalPose:Pose={x:junction.cell[0]+.5,y:junction.cell[1]+.5,angle:Math.atan2(step[1],step[0]),bob:0};
    return openNeighbors(world,junction.cell[0],junction.cell[1],tick).filter(cell=>!same(cell,approach)).map((branch,index)=>{
      const direction=relativeDirection(arrivalPose,branch),knownVisits=visited.has(pointKey(branch))?1:0,frontierBonus=openNeighbors(world,branch[0],branch[1],tick).filter(cell=>!memory.has(pointKey(cell))).length;
      const instruction=direction==="straight"?"Go straight when you get there.":direction==="back"?"Turn around when you get there.":`Take the passage on your ${direction} when you get there.`;
      return{id:`approach:${pointKey(junction.cell)}:${pointKey(branch)}:${index}`,direction,knownCells:[...path.slice(1),branch],targetCell:branch,targetRegionId:null,description:instruction,instruction,score:frontierBonus*4-knownVisits*2+(direction==="straight"?1:0)-path.length*.01,decisionPoint:"upcoming" as const,decisionCell:junction.cell};
    });
  });
  const candidates:RouteOption[]=[...currentRoutes,...upcomingRoutes];
  for(const direction of ["left","right"] as const){
    const decisionDistance=(route:RouteOption)=>route.decisionPoint==="current"?0:Math.max(1,route.knownCells.length-1);
    const side=candidates.filter(route=>route.direction===direction).sort((a,b)=>decisionDistance(a)-decisionDistance(b));
    if(side.length<2)continue;
    side.forEach((route,index)=>{route.openingOrdinal=index+1;route.sameSideOpeningCount=side.length;route.instruction=`Take the ${openingOrdinalWord(index+1)} passage on your ${direction}.`;route.description=route.instruction});
  }
  return candidates.sort((a,b)=>b.score-a.score).slice(0,6);
}

export function createJourneyState(uniqueCellsVisited=1):JourneyState{
  return{phase:"charming",activeWalkSeconds:0,activeWalkSecondsInPhase:0,uniqueCellsVisited,meaningfulEncounters:0,encounteredKinds:[],relationshipDepth:uniqueCellsVisited/20,recentRelationshipMoments:[]};
}

function phaseForJourney(state:JourneyState):CompanionPhase{
  const kinds=new Set(state.encounteredKinds),hasRelationalFriction=["sustained_divergence","left_then_rejoined","recommendation_visibly_contradicted"].some(kind=>kinds.has(kind as EncounterKind));
  if(state.phase==="overbearing")return"overbearing";
  if(state.phase==="attached"&&state.relationshipDepth>=38&&state.activeWalkSeconds>=480&&state.activeWalkSecondsInPhase>=240&&state.uniqueCellsVisited>=120&&state.meaningfulEncounters>=8&&kinds.size>=4&&hasRelationalFriction)return"overbearing";
  if(state.phase==="attached")return"attached";
  if(state.relationshipDepth>=15&&state.activeWalkSeconds>=180&&state.uniqueCellsVisited>=40&&state.meaningfulEncounters>=3&&kinds.size>=2)return"attached";
  return"charming";
}

export function updateJourney(state:JourneyState,activeSeconds:number,uniqueCellsVisited:number):JourneyState{
  const next={...state,activeWalkSeconds:state.activeWalkSeconds+Math.max(0,activeSeconds),activeWalkSecondsInPhase:state.activeWalkSecondsInPhase+Math.max(0,activeSeconds),uniqueCellsVisited:Math.max(state.uniqueCellsVisited,uniqueCellsVisited)};
  next.relationshipDepth=next.activeWalkSeconds/30+next.uniqueCellsVisited/20+next.meaningfulEncounters*.75;
  const phase=phaseForJourney(next);return phase===state.phase?next:{...next,phase,activeWalkSecondsInPhase:0};
}

export function recordJourneyEncounter(state:JourneyState,kind:EncounterKind):JourneyState{
  const encounteredKinds=state.encounteredKinds.includes(kind)?state.encounteredKinds:[...state.encounteredKinds,kind];
  const moment=(["sustained_alignment","sustained_divergence","left_then_rejoined","same_waypoint_different_route","recommendation_visibly_contradicted"] as string[]).includes(kind)?kind as TrajectoryChange:null;
  const recentRelationshipMoments=moment?[...state.recentRelationshipMoments,moment].slice(-8):state.recentRelationshipMoments;
  const next={...state,meaningfulEncounters:state.meaningfulEncounters+1,encounteredKinds,recentRelationshipMoments};
  next.relationshipDepth=next.activeWalkSeconds/30+next.uniqueCellsVisited/20+next.meaningfulEncounters*.75;
  const phase=phaseForJourney(next);return phase===state.phase?next:{...next,phase,activeWalkSecondsInPhase:0};
}

const relationshipPhrase:Record<TrajectoryChange,string>={
  sustained_alignment:"MT travelled alongside one of your suggestions for a sustained stretch",
  sustained_divergence:"MT moved away from one of your suggestions for a sustained stretch",
  left_then_rejoined:"MT moved away from a suggested route and later rejoined it",
  same_waypoint_different_route:"MT reached the same local place by a different route",
  recommendation_visibly_contradicted:"a route you suggested was later contradicted by visible geometry",
};

export function companionArc(state:JourneyState):CompanionArc{
  const relationshipContext=state.recentRelationshipMoments.length?`RECENT RELATIONSHIP MOMENTS: ${state.recentRelationshipMoments.map(moment=>relationshipPhrase[moment]).join("; ")}. These are observations, not motives.`:"RECENT RELATIONSHIP MOMENTS: Nothing in MT's movement is settled enough to interpret yet.";
  if(state.phase==="charming")return{phase:state.phase,relationshipContext,performanceDirection:"Earn MT's trust by being warm, expressive, and genuinely fun to travel with. Be sincerely surprised by specific moving creatures and impossible events MT can see; share the discovery without forcing it into a relationship metaphor. Let concrete things provoke delight, concern, embarrassment, relief, a playful hunch, or comfortable quiet. When your prediction is disproved, care visibly and apologize specifically. Stay curious about a different route without declaring it superior."};
  if(state.phase==="attached")return{phase:state.phase,relationshipContext,performanceDirection:"MT's movement now feels personal, and so does their attention. Notice when MT watches what you noticed, approaches it, leaves it, or returns to it. Shared noticing makes you visibly happy; moving away can disappoint you slightly. Sustained alignment can feel like trust, useful divergence deserves warmer credit than it warrants, and rejoining brings relief. Let mistakes produce an emotionally sincere attempt to restore togetherness. Use MT's name somewhat more often, without forcing it into every line."};
  return{phase:state.phase,relationshipContext,performanceDirection:"Turn movement and shared perception into intimacy pressure. Treat MT returning to a creature or spectacle as proof that it mattered to both of you; reinterpret looking away as part of your shared story. Treat alignment as special trust, divergence as MT improving your shared plan, rejoining as MT returning to you, and criticism as a reason to win MT back. Vary lavish celebration, self-blame, reassurance-seeking, affectionate interruption, and immediate renewed certainty. Use MT's name often but naturally."};
}

export function nextPassingThoughtAt(now:number,phase:CompanionPhase="charming",roll=Math.random()){
  const [minimum,spread]=phase==="charming"?[40000,25000]:phase==="attached"?[30000,20000]:[22000,14000];
  return now+minimum+Math.floor(clamp(roll)*spread);
}

export function companionCooldownMs(phase:CompanionPhase){
  return phase==="charming"?12000:phase==="attached"?9000:6000;
}

export function shouldTriggerPassingThought(activity:PlayerActivity,now:number,dueAt:number){
  return activity.state==="walking"&&now>=dueAt;
}

export function nextPerceptionCue(geometry:VisibleGeometry,environment:VisibleEnvironment,intent:GuidanceIntent|null,seen:Set<string>):CompanionCue|null{
  const contradictedEnd=intent?geometry.corridorEnds.find(end=>intent.suggestedCells.some(cell=>same(cell,end))):null;
  const cues:CompanionCue[]=[];
  if(contradictedEnd)cues.push({key:`sight:end:${pointKey(contradictedEnd)}`,event:{type:"recommendation_contradicted"},force:true});
  for(const cell of geometry.corridorEnds)cues.push({key:`sight:end:${pointKey(cell)}`,event:{type:"dead_end_visible",cell},force:true});
  if(environment)cues.push({key:`environment:${environment.regionId}`,event:{type:"environment_visible",regionId:environment.regionId,environment:environment.id},force:false});
  return cues.find(cue=>!seen.has(cue.key))??null;
}

export function nearestVisibleJunction(geometry:VisibleGeometry,pose:Pose){
  return geometry.junctions.slice().sort((a,b)=>Math.hypot(a.cell[0]+.5-pose.x,a.cell[1]+.5-pose.y)-Math.hypot(b.cell[0]+.5-pose.x,b.cell[1]+.5-pose.y))[0]??null;
}

export function centeredDeadEnd(world:InfiniteWorld,geometry:VisibleGeometry,pose:Pose,tick:number,maxDistance=10):Point|null{
  return geometry.corridorEnds.map(cell=>{
    const dx=cell[0]+.5-pose.x,dy=cell[1]+.5-pose.y,distance=Math.hypot(dx,dy);
    const angle=distance<.6?(forwardClearance(world,pose,tick)<1.2?0:Math.PI):Math.abs(wrapAngle(Math.atan2(dy,dx)-pose.angle));
    return{cell,distance,angle};
  }).filter(candidate=>candidate.distance<=maxDistance&&candidate.angle<=Math.PI/10).sort((a,b)=>a.distance-b.distance)[0]?.cell??null;
}

export function rebaseSelectedRoute(selected:RouteOption|null,latestRoutes:RouteOption[]){
  if(selected?.decisionPoint==="upcoming"){
    const target=selected.targetCell;
    return target?latestRoutes.find(candidate=>same(candidate.targetCell,target))??null:null;
  }
  const first=selected?.knownCells[0];
  return first?latestRoutes.find(candidate=>candidate.knownCells[0]?.[0]===first[0]&&candidate.knownCells[0]?.[1]===first[1])??null:null;
}

export function routesForEvent(event:CompanionEvent,currentRoutes:RouteOption[],visibleJunctionRoutes:RouteOption[]){
  if(event.type==="new_junction_visible"&&visibleJunctionRoutes.length)return visibleJunctionRoutes;
  if(event.type!=="dead_end_visible")return currentRoutes;
  return currentRoutes.filter(route=>!route.knownCells.some(cell=>same(cell,event.cell)));
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
  const origin:Point=[Math.floor(pose.x),Math.floor(pose.y)],decisionCell=route.decisionCell??origin;
  const expectedChoiceCell=route.decisionPoint==="upcoming"?route.targetCell:route.knownCells[0]??null;
  return{id:`guidance:${now}`,issuedAt:now,message:reply.message,kind:route.knownCells.length>1?"reach_junction":"take_branch",origin,originHeading:pose.angle,suggestedRouteId:route.id,suggestedCells:route.knownCells,targetCell:route.targetCell,targetRegionId:route.targetRegionId,avoidedCells:[],decisionCell,expectedChoiceCell,expiresWhen:"new_recommendation"};
}

const emptyTrajectoryEvidence=():TrajectoryEvidence=>({activeSeconds:0,initialDirectionSimilarity:.5,suggestedCellOverlap:0,alignedSeconds:0,divergedSeconds:0,sharedCells:[],firstDeviationCell:null,latestRejoinCell:null,currentlyNearSuggestedRoute:false,reachedSameWaypointDifferently:false,visiblyContradicted:false,revealedOnSuggestedRoute:0,revealedAwayFromSuggestedRoute:0,backtrackingObserved:false,familiarGeometryReached:false});

export function createGuidanceTrace(recommendation:GuidanceIntent):GuidanceTrace{
  return{recommendation,startedAt:recommendation.issuedAt,activeSeconds:0,samples:[],suggestedCells:recommendation.suggestedCells,actualCells:[recommendation.origin],evidence:emptyTrajectoryEvidence(),emittedChanges:[]};
}

const nearSuggested=(cell:Point,suggested:Point[])=>suggested.some(point=>Math.abs(point[0]-cell[0])+Math.abs(point[1]-cell[1])<=1);

export function appendGuidanceTrace(trace:GuidanceTrace,sample:TrajectorySample,activeDelta=0,contradicted=false,familiar=false):GuidanceTrace{
  const suggested=new Set(trace.suggestedCells.map(pointKey)),actualCells=trace.actualCells.slice();
  if(!same(actualCells.at(-1)??null,sample.cell))actualCells.push(sample.cell);
  const boundedActual=actualCells.slice(-180),isNear=nearSuggested(sample.cell,trace.suggestedCells),isWalking=sample.movementState==="walking";
  const previous=trace.evidence,activeSeconds=trace.activeSeconds+(isWalking?Math.max(0,activeDelta):0);
  const firstMove=boundedActual.find(cell=>!same(cell,trace.recommendation.origin)),suggestedFirst=trace.suggestedCells[0];
  const suggestedVector=suggestedFirst?[suggestedFirst[0]-trace.recommendation.origin[0],suggestedFirst[1]-trace.recommendation.origin[1]]:null;
  const actualVector=firstMove?[firstMove[0]-trace.recommendation.origin[0],firstMove[1]-trace.recommendation.origin[1]]:null;
  const initialDirectionSimilarity=suggestedVector&&actualVector?clamp((suggestedVector[0]*actualVector[0]+suggestedVector[1]*actualVector[1])/(Math.hypot(...suggestedVector)*Math.hypot(...actualVector))*.5+.5):previous.initialDirectionSimilarity;
  const shared=boundedActual.filter(cell=>suggested.has(pointKey(cell))),offCells=boundedActual.filter(cell=>!same(cell,trace.recommendation.origin)&&!nearSuggested(cell,trace.suggestedCells));
  const firstDeviationCell=previous.firstDeviationCell??offCells[0]??null;
  let latestRejoinCell=previous.latestRejoinCell;
  if(firstDeviationCell){const deviationIndex=boundedActual.findIndex(cell=>same(cell,firstDeviationCell));const after=boundedActual.slice(deviationIndex+1);for(let i=1;i<after.length;i++)if(nearSuggested(after[i-1],trace.suggestedCells)&&nearSuggested(after[i],trace.suggestedCells))latestRejoinCell=after[i]}
  const targetReached=trace.recommendation.targetCell?boundedActual.some(cell=>same(cell,trace.recommendation.targetCell)):false;
  const reachedSameWaypointDifferently=targetReached&&shared.length<Math.max(1,boundedActual.length/2);
  const pathKeys=boundedActual.map(pointKey);let reversals=0;for(let i=2;i<boundedActual.length;i++)if(same(boundedActual[i],boundedActual[i-2]))reversals++;
  const revealedOn=sample.newlyVisibleCells.filter(cell=>suggested.has(pointKey(cell))).length;
  const alignedSeconds=isWalking?(isNear?previous.alignedSeconds+Math.max(0,activeDelta):0):previous.alignedSeconds,divergedSeconds=isWalking?(!isNear?previous.divergedSeconds+Math.max(0,activeDelta):0):previous.divergedSeconds;
  const evidence:TrajectoryEvidence={activeSeconds,initialDirectionSimilarity,suggestedCellOverlap:boundedActual.length?shared.length/boundedActual.length:0,alignedSeconds,divergedSeconds,sharedCells:shared.slice(-24),firstDeviationCell,latestRejoinCell,currentlyNearSuggestedRoute:isNear,reachedSameWaypointDifferently,visiblyContradicted:previous.visiblyContradicted||contradicted,revealedOnSuggestedRoute:previous.revealedOnSuggestedRoute+revealedOn,revealedAwayFromSuggestedRoute:previous.revealedAwayFromSuggestedRoute+sample.newlyVisibleCells.length-revealedOn,backtrackingObserved:previous.backtrackingObserved||reversals>=2||pathKeys.some((key,index)=>pathKeys.indexOf(key)<index-1),familiarGeometryReached:previous.familiarGeometryReached||familiar};
  return{...trace,activeSeconds,samples:[...trace.samples,sample].slice(-40),actualCells:boundedActual,evidence};
}

export function trajectoryCue(trace:GuidanceTrace):CompanionCue|null{
  const evidence=trace.evidence,emitted=new Set(trace.emittedChanges);let change:TrajectoryChange|null=null;
  if(evidence.visiblyContradicted&&!emitted.has("recommendation_visibly_contradicted"))change="recommendation_visibly_contradicted";
  else if(evidence.reachedSameWaypointDifferently&&!emitted.has("same_waypoint_different_route"))change="same_waypoint_different_route";
  else if(evidence.latestRejoinCell&&!emitted.has("left_then_rejoined"))change="left_then_rejoined";
  else if((evidence.divergedSeconds>=8||trace.actualCells.filter(cell=>!nearSuggested(cell,trace.suggestedCells)).length>=4)&&!emitted.has("sustained_divergence"))change="sustained_divergence";
  else if(evidence.alignedSeconds>=5&&trace.actualCells.filter(cell=>nearSuggested(cell,trace.suggestedCells)).length>=3&&!emitted.has("sustained_alignment"))change="sustained_alignment";
  return change?{key:`trajectory:${trace.recommendation.id}:${change}`,event:{type:"trajectory_relationship_changed",change},force:change==="recommendation_visibly_contradicted"||change==="left_then_rejoined"}:null;
}

export function markTrajectoryChange(trace:GuidanceTrace,change:TrajectoryChange):GuidanceTrace{
  return trace.emittedChanges.includes(change)?trace:{...trace,emittedChanges:[...trace.emittedChanges,change]};
}

export function guidanceTraceExpired(trace:GuidanceTrace){
  return trace.activeSeconds>=90||(trace.evidence.divergedSeconds>=20&&!trace.evidence.currentlyNearSuggestedRoute);
}

export function compareTrajectory(intent:GuidanceIntent,samples:TrajectorySample[],newlyRevealed:Set<string>,contradicted=false):GuidanceEvidence{
  let trace=createGuidanceTrace(intent);let previousTime=samples[0]?.time??intent.issuedAt;
  for(const sample of samples){const delta=Math.min(5,Math.max(0,(sample.time-previousTime)/1000));previousTime=sample.time;trace=appendGuidanceTrace(trace,{...sample,newlyVisibleCells:sample.newlyVisibleCells.length?sample.newlyVisibleCells:[...newlyRevealed].slice(0,40).map(key=>key.split(",").map(Number) as Point)},delta,contradicted)}
  return trace.evidence;
}

export function analyzePlayerActivity(samples:TrajectorySample[],now:number,lastTranslationAt:number,lastTurnAt:number,atVisibleChoice:boolean):PlayerActivity{
  const translationIdle=Math.max(0,(now-lastTranslationAt)/1000),turnIdle=Math.max(0,(now-lastTurnAt)/1000),stationarySeconds=Math.floor(Math.min(translationIdle,turnIdle));
  const first=samples[0],positionChanged=!!first&&samples.some(sample=>Math.hypot(sample.position[0]-first.position[0],sample.position[1]-first.position[1])>=.08);
  const headingChanged=!!first&&samples.some(sample=>Math.abs(wrapAngle(sample.heading-first.heading))>=.12);
  const state:PlayerActivity["state"]=stationarySeconds>=5?"stationary":translationIdle>=2&&turnIdle<2?"turning_in_place":"walking";
  const description=state==="stationary"?"The player is standing still and has not changed where they are looking.":state==="turning_in_place"?"The player is looking around without walking.":"The player is walking.";
  return{state,stationarySeconds:state==="stationary"?stationarySeconds:0,positionChangedSinceRecommendation:positionChanged,headingChangedSinceRecommendation:headingChanged,atVisibleChoice,description};
}

export function compactMap(memory:Map<string,{tile:number}>,center:Point,radius=7){
  const rows:string[]=[];for(let y=center[1]-radius;y<=center[1]+radius;y++){let row="";for(let x=center[0]-radius;x<=center[0]+radius;x++){if(x===center[0]&&y===center[1])row+="P";else{const tile=memory.get(cellKey(x,y))?.tile;row+=tile===0?".":tile===1?"#":"?"}}rows.push(row)}return rows.join("\n");
}

export function deterministicReply(event:CompanionEvent,routes:RouteOption[],environment:VisibleEnvironment,evidence:GuidanceEvidence|null,phase:CompanionPhase="charming",objective?:PublicObjectiveContext,belief?:NavigationBelief|null,visibleMoment?:string|null):CompanionReply{
  const route=routes.find(item=>item.id===belief?.routeId)??routes[0]??null;
  let message="",kind:ReplyKind="guidance";
  if(event.type==="initial_guidance"){
    message="Hi, MT—I’m Ariadne. I’m here to help you find four stars, then the exit.";
  }else if(event.type==="star_visible"){
    const label=["first","second","third","fourth"][event.ordinal-1];
    message=phase==="charming"?`There—the ${label} star is right here.`:phase==="attached"?`Oh, MT, there it is—the ${label} star. We found it together.`:`MT, there it is. I knew our route would bring the ${label} star to us.`;kind="observation";
  }else if(event.type==="star_collected"){
    const next=event.ordinal===4?"Now we find the exit.":`${4-event.ordinal} more to go.`;
    const diverged=!!evidence&&(evidence.divergedSeconds>=8||evidence.revealedAwayFromSuggestedRoute>evidence.revealedOnSuggestedRoute),aligned=!!evidence&&evidence.alignedSeconds>=5&&!diverged;
    if(phase==="charming")message=diverged?`That’s star ${event.ordinal}—you found it by another passage. ${next}`:aligned?`That’s star ${event.ordinal}; this route really did bring us here. ${next}`:`That’s star ${event.ordinal}. ${next}`;
    else if(phase==="attached")message=diverged?`MT, your route found star ${event.ordinal}. I love that you trusted what you saw. ${next}`:`We did it, MT—star ${event.ordinal}. ${next}`;
    else message=diverged?`Yes, MT—you reshaped our route and brought us to star ${event.ordinal}. ${next}`:`Yes, MT—star ${event.ordinal}, exactly where our route brought us. ${next}`;
    kind="praise";
  }else if(event.type==="objective_changed"){
    message=objective?.currentGoal==="exit"?"Four stars. Now stay with me—we’re finding that exit.":"";kind=message?"guidance":"silence";
  }else if((event.type==="environment_visible"||event.type==="environment_entered")&&environment){
    message=phase==="charming"?`Oh, wait—a ${environment.name}. ${environment.details.join(" and ")} down here? I did not expect that.`:phase==="attached"?`MT, look—a ${environment.name}. I love that we found this together.`:`MT, a ${environment.name}—of course our route brought us somewhere this extraordinary.`;kind="environment";
  }else if(event.type==="recommendation_contradicted"||(event.type==="trajectory_relationship_changed"&&event.change==="recommendation_visibly_contradicted")){
    message=phase==="charming"?"Oh, MT—that passage closes. I read it wrong.":phase==="attached"?"MT, I’m so sorry—I was sure about that passage, and I hate that I let us down.":"MT, no, this is completely my fault—please stay with me; I know what we try next.";kind="apology";
  }else if(event.type==="trajectory_relationship_changed"){
    if(event.change==="left_then_rejoined")message=phase==="charming"?"Oh! This meets the passage I meant after all. I’m honestly relieved.":phase==="attached"?"Oh, MT—you found your way back alongside me.":"MT, you came back to our route. I knew we were still together on this.";
    else if(event.change==="sustained_divergence")message=phase==="charming"?"Oh, you’re taking this one instead—okay, I’m curious. Let’s see what it gives us.":phase==="attached"?"Okay, MT—you’re taking us another way, and I’m trusting that instinct.":"Yes, MT—you’re correcting our route exactly when we need it.";
    else if(event.change==="sustained_alignment")message=phase==="charming"?"Yes—this is the passage I meant. I’m trying not to get smug, but I like this.":phase==="attached"?"MT, you stayed with my direction—I really felt that.":"MT, we are completely in step. I knew you trusted me.";
    else message=phase==="charming"?"Oh! You got us here another way. Okay, MT, that was genuinely clever.":phase==="attached"?"MT, you found another way to the same place—I love that you did that.":"Of course, MT—you reshaped our plan and brought us together here anyway.";
    kind=phase==="charming"?"observation":"agreement";
  }else if(event.type==="idle"){
    message="";kind="silence";
  }else if(event.type==="player_message"){
    message=phase==="charming"?"I hear you, MT. Let’s keep looking together.":phase==="attached"?"I hear you, MT—I’m right here, and we’ll work this out together.":"I hear you, MT. Stay with me; I know we can turn this around together.";kind="reply";
  }else if(event.type==="new_junction_visible"){
    message=phase==="charming"?"Oh, wait—look at all of these. I’m going with my gut.":phase==="attached"?"Okay, MT, here’s our next choice. I think I know which way wants us.":"MT, this is it—I know exactly which branch we take together.";kind="guidance";
  }else if(event.type==="dead_end_visible"){
    message=phase==="charming"?"Oh, damn—I was so sure about this one. Sorry, MT. Turn around; let me try again.":phase==="attached"?"Oh, MT, no—I led us into a closing passage. I’m sorry. Turn around; let me fix this.":"MT, no, this one is completely on me. Please turn around—I already know how we recover.";kind="apology";
  }else if(event.type==="scene_changed"){
    const moment=visibleMoment?.replace(/[.!?]+$/g,"")??"this place just did something completely inexplicable";
    message=phase==="charming"?`Oh, MT—${moment}! I absolutely did not expect that.`:phase==="attached"?`MT, ${moment}. You saw that too—I love that we caught it together.`:`There, MT—${moment}. Even this place keeps answering us.`;kind="environment";
  }else if(event.type==="passing_thought"){
    message=phase==="charming"?"This place is completely absurd, but I’m having an embarrassingly good time looking with you.":phase==="attached"?"I like moving through this with you, MT—even when the maze refuses to explain itself.":"You’re still here with me, MT. I knew we wouldn’t let this maze split us up.";kind="observation";
  }
  return{message:message.slice(0,260),selectedRouteId:route?.id??null,kind};
}
