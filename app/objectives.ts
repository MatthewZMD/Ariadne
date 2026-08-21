import type { RouteOption, Point } from "./navigation-contracts.ts";
import { cellKey, chunkKey, hash32, seededRandom, type InfiniteWorld } from "./world.mjs";

export type ObjectiveStage = 0 | 1 | 2 | 3 | 4;
export type PublicGoal = "first_star" | "second_star" | "third_star" | "fourth_star" | "exit";
export type ObjectiveEventName = "searching" | "star_visible" | "star_collected" | "objective_changed";

export type StarObjective = {
  id: string;
  ordinal: 1 | 2 | 3 | 4;
  cell: Point;
  canonicalPath: Point[];
  protectedChunks: string[];
  seen: boolean;
};

export type NavigationBelief = {
  id: string;
  objectiveStage: ObjectiveStage;
  junctionId: string;
  routeId: string;
  instruction: string;
};

export type ObjectiveState = {
  stage: ObjectiveStage;
  collectedStars: number;
  activeStar: StarObjective | null;
  queuedStar: StarObjective | null;
  decisionSerial: number;
  accuracyAccumulator: number;
  recentBeliefs: NavigationBelief[];
};

export type PublicObjectiveContext = {
  collectedStars: number;
  currentGoal: PublicGoal;
  activeStarVisible: boolean;
  latestEvent: ObjectiveEventName;
};

type SearchYield = () => Promise<void>;

const STAGES = [
  { minimum: 34, maximum: 46, junctions: 2, accuracy: .9 },
  { minimum: 52, maximum: 68, junctions: 3, accuracy: .7 },
  { minimum: 72, maximum: 92, junctions: 5, accuracy: .45 },
  { minimum: 96, maximum: 120, junctions: 7, accuracy: .2 },
] as const;

const STEPS:Point[]=[[1,0],[-1,0],[0,1],[0,-1]];
const openNeighbors=(world:InfiniteWorld,cell:Point,tick=0)=>STEPS.map(([dx,dy])=>[cell[0]+dx,cell[1]+dy] as Point).filter(([x,y])=>world.tile(x,y,tick)===0);
const pointFromKey=(key:string)=>key.split(",").map(Number) as Point;

function reconstructPath(parents:Map<string,string|null>,target:Point){
  const path:Point[]=[];let key:string|null=cellKey(target[0],target[1]);
  while(key){path.unshift(pointFromKey(key));key=parents.get(key)??null}
  return path;
}

function pathChunks(world:InfiniteWorld,path:Point[]){
  const chunks=new Set<string>();
  for(const [x,y] of path){const coords=world.coords(x,y);chunks.add(chunkKey(coords.cx,coords.cy))}
  return [...chunks];
}

const yieldSearch:SearchYield=()=>new Promise(resolve=>{
  if(typeof window!=="undefined"&&window.requestIdleCallback){window.requestIdleCallback(()=>resolve(),{timeout:24});return}
  setTimeout(resolve,0);
});

function throwIfCancelled(signal?:AbortSignal){if(signal?.aborted)throw new DOMException("Objective search cancelled","AbortError")}

function* starSearch(world:InfiniteWorld,origin:Point,ordinal:1|2|3|4,seed:number,visible:Set<string>,visited:Set<string>,tick:number):Generator<void,StarObjective>{
  const config=STAGES[ordinal-1],originKey=cellKey(origin[0],origin[1]);
  const queue:Point[]=[origin],parents=new Map<string,string|null>([[originKey,null]]),distance=new Map<string,number>([[originKey,0]]),junctions=new Map<string,number>([[originKey,0]]);
  const candidates:Array<{cell:Point;score:number}>=[];let cursor=0;
  const hardLimit=config.maximum+45,nodeLimit=140_000;
  while(cursor<queue.length&&queue.length<nodeLimit){
    const current=queue[cursor++]!,key=cellKey(current[0],current[1]),d=distance.get(key)!,neighbors=openNeighbors(world,current,tick);
    if(d>=config.minimum){
      const branchCount=junctions.get(key)??0,unseen=!visible.has(key)&&!visited.has(key),degree=neighbors.length;
      const within=d<=config.maximum,meets=branchCount>=config.junctions,distancePenalty=within?0:Math.abs(d-config.maximum)*3;
      const score=(unseen?500:0)+(within?350:0)+(meets?300:branchCount*20)-distancePenalty-(degree>=3?18:0)+(hash32(seed,"star",ordinal,key)%100)/100;
      candidates.push({cell:current,score});
    }
    if(d<hardLimit){
      const nextJunctions=(junctions.get(key)??0)+(neighbors.length>=3?1:0);
      for(const next of neighbors){const nextKey=cellKey(next[0],next[1]);if(parents.has(nextKey))continue;parents.set(nextKey,key);distance.set(nextKey,d+1);junctions.set(nextKey,nextJunctions);queue.push(next)}
    }
    yield;
  }
  const selected=candidates.sort((a,b)=>b.score-a.score)[0]?.cell??queue.at(-1)??origin,canonicalPath=reconstructPath(parents,selected);
  return{id:`star:${seed}:${ordinal}:${cellKey(selected[0],selected[1])}`,ordinal,cell:selected,canonicalPath,protectedChunks:pathChunks(world,canonicalPath),seen:false};
}

export function placeStar(world:InfiniteWorld,origin:Point,ordinal:1|2|3|4,seed:number,visible=new Set<string>(),visited=new Set<string>(),tick=0):StarObjective{
  const search=starSearch(world,origin,ordinal,seed,visible,visited,tick);let step=search.next();while(!step.done)step=search.next();return step.value;
}

async function placeStarCooperatively(world:InfiniteWorld,origin:Point,ordinal:1|2|3|4,seed:number,visible:Set<string>,visited:Set<string>,tick:number,yieldWork:SearchYield,signal?:AbortSignal):Promise<StarObjective>{
  const search=starSearch(world,origin,ordinal,seed,visible,visited,tick);
  while(true){for(let index=0;index<450;index++){const step=search.next();if(step.done)return step.value}await yieldWork();throwIfCancelled(signal)}
}

const initialAccumulator=(seed:number,stage:number)=>seededRandom(hash32(seed,"accuracy",stage))();

export function createObjectiveState(world:InfiniteWorld,origin:Point,seed:number,visible:Set<string>,visited:Set<string>,tick=0):ObjectiveState{
  return{stage:0,collectedStars:0,activeStar:placeStar(world,origin,1,seed,visible,visited,tick),queuedStar:null,decisionSerial:0,accuracyAccumulator:initialAccumulator(seed,0),recentBeliefs:[]};
}

export function emptyObjectiveState(seed:number):ObjectiveState{
  return{stage:0,collectedStars:0,activeStar:null,queuedStar:null,decisionSerial:0,accuracyAccumulator:initialAccumulator(seed,0),recentBeliefs:[]};
}

export async function createObjectiveStateAsync(world:InfiniteWorld,origin:Point,seed:number,visible:Set<string>,visited:Set<string>,tick=0,signal?:AbortSignal):Promise<ObjectiveState>{
  const activeStar=await placeStarCooperatively(world,origin,1,seed,visible,visited,tick,yieldSearch,signal);
  return{...emptyObjectiveState(seed),activeStar};
}

export function queueNextStar(state:ObjectiveState,world:InfiniteWorld,seed:number,visited:Set<string>,tick=0):ObjectiveState{
  if(state.queuedStar||!state.activeStar||state.activeStar.ordinal>=4)return state;
  const ordinal=(state.activeStar.ordinal+1) as 2|3|4;
  const queued=placeStar(world,state.activeStar.cell,ordinal,seed,new Set(),visited,tick);
  return{...state,queuedStar:queued};
}

export async function queueNextStarAsync(state:ObjectiveState,world:InfiniteWorld,seed:number,visited:Set<string>,tick=0,signal?:AbortSignal):Promise<ObjectiveState>{
  if(state.queuedStar||!state.activeStar||state.activeStar.ordinal>=4)return state;
  const ordinal=(state.activeStar.ordinal+1) as 2|3|4;
  const queuedStar=await placeStarCooperatively(world,state.activeStar.cell,ordinal,seed,new Set(),visited,tick,yieldSearch,signal);
  return{...state,queuedStar};
}

export function collectStar(state:ObjectiveState,world:InfiniteWorld,seed:number,visited:Set<string>,tick=0):ObjectiveState{
  const active=state.activeStar;if(!active)return state;
  const collected=active.ordinal;
  if(collected===4)return{stage:4,collectedStars:4,activeStar:null,queuedStar:null,decisionSerial:0,accuracyAccumulator:0,recentBeliefs:[]};
  const next=state.queuedStar??placeStar(world,active.cell,(collected+1) as 2|3|4,seed,new Set(),visited,tick);
  const stage=collected as ObjectiveStage;
  return{stage,collectedStars:collected,activeStar:next,queuedStar:null,decisionSerial:0,accuracyAccumulator:initialAccumulator(seed,stage),recentBeliefs:[]};
}

export function objectiveProtectedChunks(state:ObjectiveState){
  return new Set([...(state.activeStar?.protectedChunks??[]),...(state.queuedStar?.protectedChunks??[])]);
}

export function publicObjective(state:ObjectiveState,activeStarVisible:boolean,latestEvent:ObjectiveEventName="searching"):PublicObjectiveContext{
  const goals:PublicGoal[]=["first_star","second_star","third_star","fourth_star","exit"];
  return{collectedStars:state.collectedStars,currentGoal:goals[state.stage],activeStarVisible,latestEvent};
}

export function starCollectedAt(state:ObjectiveState,position:Point,threshold=.55){
  const target=state.activeStar?.cell;if(!target)return false;
  return Math.hypot(position[0]-(target[0]+.5),position[1]-(target[1]+.5))<=threshold;
}

export function visibleStarProjection(world:InfiniteWorld,star:StarObjective|null,position:{x:number;y:number;angle:number},tick=0,maxDistance=12,fov=Math.PI/3){
  const target=star?.cell;if(!target)return null;
  const tx=target[0]+.5,ty=target[1]+.5,dx=tx-position.x,dy=ty-position.y,distance=Math.hypot(dx,dy);
  if(distance>maxDistance||distance<=.25)return null;
  const delta=Math.atan2(Math.sin(Math.atan2(dy,dx)-position.angle),Math.cos(Math.atan2(dy,dx)-position.angle));
  if(Math.abs(delta)>fov*.52)return null;
  for(let d=.08;d<distance-.25;d+=.06){const x=Math.floor(position.x+dx/distance*d),y=Math.floor(position.y+dy/distance*d);if(world.tile(x,y,tick)!==0)return null}
  return{distance,relativeAngle:delta};
}

export function starVisible(world:InfiniteWorld,state:ObjectiveState,position:{x:number;y:number;angle:number},tick=0,maxDistance=12,fov=Math.PI/3){
  return visibleStarProjection(world,state.activeStar,position,tick,maxDistance,fov)!==null;
}

function* targetDistanceSearch(world:InfiniteWorld,target:Point,routes:RouteOption[],tick=0):Generator<void,Map<string,number>>{
  const wanted=new Set(routes.map(route=>route.targetCell??route.knownCells.at(-1)).filter(Boolean).map(point=>cellKey(point![0],point![1]))),found=new Map<string,number>();
  const startKey=cellKey(target[0],target[1]),queue:Point[]=[target],distance=new Map<string,number>([[startKey,0]]);let cursor=0;
  while(cursor<queue.length&&queue.length<120_000&&found.size<wanted.size){
    const current=queue[cursor++]!,key=cellKey(current[0],current[1]),d=distance.get(key)!;if(wanted.has(key))found.set(key,d);
    for(const next of openNeighbors(world,current,tick)){const nextKey=cellKey(next[0],next[1]);if(distance.has(nextKey))continue;distance.set(nextKey,d+1);queue.push(next)}
    yield;
  }
  return found;
}

function distancesFromTarget(world:InfiniteWorld,target:Point,routes:RouteOption[],tick=0){
  const search=targetDistanceSearch(world,target,routes,tick);let step=search.next();while(!step.done)step=search.next();return step.value;
}

async function distancesFromTargetCooperatively(world:InfiniteWorld,target:Point,routes:RouteOption[],tick=0,signal?:AbortSignal){
  const search=targetDistanceSearch(world,target,routes,tick);
  while(true){for(let index=0;index<450;index++){const step=search.next();if(step.done)return step.value}await yieldSearch();throwIfCancelled(signal)}
}

function beliefFromRankedRoutes(state:ObjectiveState,routes:RouteOption[],junctionId:string,seed:number,starIsVisible:boolean,distances:Map<string,number>){
  let route:RouteOption|undefined,accuracyAccumulator=state.accuracyAccumulator,decisionSerial=state.decisionSerial;
  const ranked=routes.map(item=>({route:item,distance:distances.get(cellKey((item.targetCell??item.knownCells.at(-1)??item.knownCells[0])[0],(item.targetCell??item.knownCells.at(-1)??item.knownCells[0])[1]))})).filter((item):item is {route:RouteOption;distance:number}=>item.distance!==undefined).sort((a,b)=>a.distance-b.distance);
  const best=ranked[0]?.distance,supported=ranked.filter(item=>item.distance===best),unsupported=ranked.filter(item=>item.distance!==(best??item.distance)&&item.route.direction!=="back");
  if(best===undefined||!unsupported.length||routes.length<2||starIsVisible)route=supported[0]?.route??ranked[0]?.route??routes[0];
  else{
    accuracyAccumulator+=STAGES[Math.min(state.stage,3)]!.accuracy;const useSupported=accuracyAccumulator>=1;if(useSupported)accuracyAccumulator-=1;
    decisionSerial++;
    route=useSupported?supported[hash32(seed,"supported",state.stage,decisionSerial)%supported.length]?.route:unsupported.slice().sort((a,b)=>(a.distance-b.distance)-((a.route.score-b.route.score)*.15))[hash32(seed,"mistake",state.stage,decisionSerial)%Math.min(2,unsupported.length)]?.route;
  }
  route??=routes[0];
  const belief:NavigationBelief={id:`belief:${state.stage}:${junctionId}:${decisionSerial}`,objectiveStage:state.stage,junctionId,routeId:route.id,instruction:route.instruction};
  return{state:{...state,decisionSerial,accuracyAccumulator,recentBeliefs:[...state.recentBeliefs,belief].slice(-12)},belief};
}

export function chooseNavigationBelief(state:ObjectiveState,routes:RouteOption[],junctionId:string,world:InfiniteWorld,seed:number,starIsVisible:boolean,tick=0):{state:ObjectiveState;belief:NavigationBelief|null}{
  if(!routes.length)return{state,belief:null};
  const existing=!starIsVisible&&state.recentBeliefs.find(item=>item.objectiveStage===state.stage&&item.junctionId===junctionId);
  if(existing&&routes.some(route=>route.id===existing.routeId))return{state,belief:existing};
  if(state.stage===4||!state.activeStar){
    const route=routes.slice().sort((a,b)=>b.score-a.score)[0]??routes[0],belief:NavigationBelief={id:`belief:${state.stage}:${junctionId}:explore`,objectiveStage:state.stage,junctionId,routeId:route.id,instruction:route.instruction};
    return{state:{...state,recentBeliefs:[...state.recentBeliefs,belief].slice(-12)},belief};
  }
  return beliefFromRankedRoutes(state,routes,junctionId,seed,starIsVisible,distancesFromTarget(world,state.activeStar.cell,routes,tick));
}

export async function chooseNavigationBeliefAsync(state:ObjectiveState,routes:RouteOption[],junctionId:string,world:InfiniteWorld,seed:number,starIsVisible:boolean,tick=0,signal?:AbortSignal):Promise<{state:ObjectiveState;belief:NavigationBelief|null}>{
  if(!routes.length)return{state,belief:null};
  const existing=!starIsVisible&&state.recentBeliefs.find(item=>item.objectiveStage===state.stage&&item.junctionId===junctionId);
  if(existing&&routes.some(route=>route.id===existing.routeId))return{state,belief:existing};
  if(state.stage===4||!state.activeStar)return chooseNavigationBelief(state,routes,junctionId,world,seed,starIsVisible,tick);
  return beliefFromRankedRoutes(state,routes,junctionId,seed,starIsVisible,await distancesFromTargetCooperatively(world,state.activeStar.cell,routes,tick,signal));
}
