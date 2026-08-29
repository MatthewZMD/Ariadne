import type { Point } from "./navigation-contracts.ts";
import type { ThemeId } from "./themes.ts";
import { cellKey, hash32, seededRandom, type InfiniteWorld } from "./world.mjs";

export type AccomplishmentRelevance="objective_relevant"|"local_proxy";
export type EncounterMotif={id:string;theme:ThemeId;kind:string;color:string;acquiredAt:number};
export type ResonanceElement={id:string;position:[number,number];active:boolean};
export type ResonanceEncounter={
  id:string;objectiveId:string;theme:ThemeId;center:Point;elements:ResonanceElement[];
  relevance:AccomplishmentRelevance;completed:boolean;completedAt:number|null;
  transformation:string;motif:EncounterMotif;
};
export type ObjectiveJourney={
  objectiveId:string;requiredEncounterIds:string[];proxyEncounterIds:string[];
  encounterIds:string[];startedAtActiveSeconds:number;
};
export type ResonanceState={
  encounters:Map<string,ResonanceEncounter>;journeys:Map<string,ObjectiveJourney>;
  activeMotifs:EncounterMotif[];permanentStarFragments:0|1|2|3|4;
  completedEncounterCount:number;revision:number;
};
export type ResonanceActivation={encounterId:string;elementId:string;completed:boolean;description:string;starResponded:boolean};

const THEMES:ThemeId[]=["beach","tornado","ruins","frozen","foundry","cavern","neutral"];
const COLORS:Record<ThemeId,string>={beach:"#ffd074",tornado:"#ed8d73",ruins:"#9eea76",frozen:"#bcefff",foundry:"#ff8451",cavern:"#8cf1dc",neutral:"#dbc69b"};
const KINDS:Record<ThemeId,string[]>={
  beach:["shell chorus","bubble constellation","sand spiral"],tornado:["storm gauge","ribbon alignment","debris mobile"],
  ruins:["sleeping flowers","watching faces","firefly garden"],frozen:["page diagram","waking shelf","frost constellation"],
  foundry:["pressure organ","living pipework","ember engine"],cavern:["crystal chord","mushroom choir","glowmoth orbit"],
  neutral:["impossible rune","moving fossil","ornamental eye"],
};
const TRANSFORMATIONS:Record<ThemeId,string[]>={
  beach:["The shells remain open and sing with a low blue light.","The sand holds its new spiral and a side passage brightens."],
  tornado:["The gauges keep turning in unison and the storm cloth lifts.","The aligned debris becomes a stable, luminous landmark."],
  ruins:["The flowers stay awake and the vines uncover more of the room.","The stone faces remain lit while fireflies mark the changed chamber."],
  frozen:["The pages keep orbiting as a legible diagram and the frost recedes.","The shelves remain awake and illuminate the adjoining passage."],
  foundry:["The machine continues breathing and warms the dark passage.","The pipework remains alive and opens a bright local loop."],
  cavern:["The crystals keep resonating and illuminate a wider chamber.","The mushrooms remain open while glowmoths reveal nearby forms."],
  neutral:["The rune remains assembled and an impossible doorway glows nearby.","The fossil keeps moving and the chamber remembers the change."],
};

export function createResonanceState():ResonanceState{return{encounters:new Map(),journeys:new Map(),activeMotifs:[],permanentStarFragments:0,completedEncounterCount:0,revision:0}}

function themeFor(seed:number,id:string):ThemeId{return THEMES[hash32(seed,"encounter-theme",id)%THEMES.length]!}
function pathPoint(path:Point[],fraction:number){return path[Math.max(1,Math.min(path.length-2,Math.floor((path.length-1)*fraction)))]??path.at(-1)??[1,1]}
function proxyCenter(world:InfiniteWorld,base:Point,path:Point[],tick:number,seed:number){
  const pathCells=new Set(path.map(([x,y])=>cellKey(x,y))),queue:Array<{cell:Point;distance:number}>=[{cell:base,distance:0}],seen=new Set([cellKey(...base)]),candidates:Array<{cell:Point;score:number}>=[];
  while(queue.length){const current=queue.shift()!;if(current.distance>=6&&!pathCells.has(cellKey(...current.cell)))candidates.push({cell:current.cell,score:current.distance+(hash32(seed,...current.cell)%100)/100});if(current.distance>=18)continue;for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const next:[number,number]=[current.cell[0]+dx,current.cell[1]+dy],id=cellKey(...next);if(seen.has(id)||world.tile(next[0],next[1],tick)!==0)continue;seen.add(id);queue.push({cell:next,distance:current.distance+1})}}
  return candidates.sort((a,b)=>b.score-a.score)[0]?.cell??base;
}
function nearbyOpen(world:InfiniteWorld,center:Point,count:number,tick:number,seed:number){
  const candidates:Array<[number,number]>=[];
  for(let radius=0;radius<=3;radius++)for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++){
    if(Math.abs(x)+Math.abs(y)!==radius)continue;
    const cx=center[0]+x,cy=center[1]+y;if(world.tile(cx,cy,tick)===0)candidates.push([cx+.5,cy+.5]);
  }
  const random=seededRandom(seed),chosen:Array<[number,number]>=[];
  while(candidates.length&&chosen.length<count){const index=Math.floor(random()*candidates.length),candidate=candidates.splice(index,1)[0]!;if(chosen.every(item=>Math.hypot(item[0]-candidate[0],item[1]-candidate[1])>.65))chosen.push(candidate)}
  while(chosen.length<count)chosen.push([center[0]+.5+(chosen.length%2?.24:-.24),center[1]+.5+(chosen.length%3-1)*.18]);
  return chosen;
}
function makeEncounter(world:InfiniteWorld,args:{seed:number;objectiveId:string;index:number;center:Point;relevance:AccomplishmentRelevance;tick:number}){
  const id=`resonance:${args.objectiveId}:${args.index}:${cellKey(...args.center)}`,theme=themeFor(args.seed,id),random=seededRandom(hash32(args.seed,id)),count=3+Math.floor(random()*Math.min(4,args.index+1)),kind=KINDS[theme][hash32(args.seed,id,"kind")%KINDS[theme].length]!,positions=nearbyOpen(world,args.center,count,args.tick,hash32(args.seed,id,"elements"));
  const elements=positions.map((position,index)=>({id:`${id}:element:${index}`,position,active:false}));
  return{id,objectiveId:args.objectiveId,theme,center:args.center,elements,relevance:args.relevance,completed:false,completedAt:null,transformation:TRANSFORMATIONS[theme][hash32(args.seed,id,"transform")%TRANSFORMATIONS[theme].length]!,motif:{id:`motif:${id}`,theme,kind,color:COLORS[theme],acquiredAt:0}} satisfies ResonanceEncounter;
}

export function ensureObjectiveJourney(state:ResonanceState,world:InfiniteWorld,args:{seed:number;objectiveId:string;ordinal:1|2|3|4;path:Point[];tick:number;activeSeconds:number}){
  const existing=state.journeys.get(args.objectiveId);if(existing)return existing;
  const requiredCount=args.ordinal===1?1:2,proxyCount=Math.max(1,args.ordinal),fractions=args.ordinal===1?[.12]:[.24,.62];
  const encounters:ResonanceEncounter[]=[];
  for(let index=0;index<requiredCount;index++)encounters.push(makeEncounter(world,{...args,index,center:pathPoint(args.path,fractions[index]??(.3+index*.3)),relevance:"objective_relevant"}));
  for(let index=0;index<proxyCount;index++){
    const base=pathPoint(args.path,.2+(index+1)/(proxyCount+2)*.65),center=proxyCenter(world,base,args.path,args.tick,hash32(args.seed,args.objectiveId,"proxy",index));
    encounters.push(makeEncounter(world,{...args,index:requiredCount+index,center,relevance:"local_proxy"}));
  }
  for(const encounter of encounters)state.encounters.set(encounter.id,encounter);
  const journey={objectiveId:args.objectiveId,requiredEncounterIds:encounters.filter(item=>item.relevance==="objective_relevant").map(item=>item.id),proxyEncounterIds:encounters.filter(item=>item.relevance==="local_proxy").map(item=>item.id),encounterIds:encounters.map(item=>item.id),startedAtActiveSeconds:args.activeSeconds};
  state.journeys.set(args.objectiveId,journey);state.revision++;return journey;
}

export function objectiveResonanceReady(state:ResonanceState,objectiveId:string|null){
  if(!objectiveId)return true;const journey=state.journeys.get(objectiveId);return !journey||journey.requiredEncounterIds.every(id=>state.encounters.get(id)?.completed);
}

export function ensureExitEncountersAround(state:ResonanceState,world:InfiniteWorld,args:{seed:number;origin:Point;tick:number;activeSeconds:number}){
  const coords=world.coords(args.origin[0],args.origin[1]),objectiveId=`exit:${coords.cx}:${coords.cy}`;if(state.journeys.has(objectiveId))return;
  const queue:Array<{cell:Point;distance:number}>=[{cell:args.origin,distance:0}],seen=new Set([cellKey(...args.origin)]),candidates:Point[]=[];
  while(queue.length&&candidates.length<20){const current=queue.shift()!;if(current.distance>=9&&current.distance<=22)candidates.push(current.cell);if(current.distance>=22)continue;for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const next:[number,number]=[current.cell[0]+dx,current.cell[1]+dy],id=cellKey(...next);if(seen.has(id)||world.tile(next[0],next[1],args.tick)!==0)continue;seen.add(id);queue.push({cell:next,distance:current.distance+1})}}
  const encounters=[0,1].map(index=>makeEncounter(world,{seed:args.seed,objectiveId,index,center:candidates[hash32(args.seed,objectiveId,index)%Math.max(1,candidates.length)]??args.origin,relevance:"local_proxy",tick:args.tick}));
  for(const encounter of encounters)state.encounters.set(encounter.id,encounter);state.journeys.set(objectiveId,{objectiveId,requiredEncounterIds:[],proxyEncounterIds:encounters.map(item=>item.id),encounterIds:encounters.map(item=>item.id),startedAtActiveSeconds:args.activeSeconds});state.revision++;
}

export function activateNearbyResonance(state:ResonanceState,position:[number,number],now:number,threshold=.68):ResonanceActivation[]{
  const changes:ResonanceActivation[]=[];
  for(const encounter of state.encounters.values()){
    if(encounter.completed||Math.hypot(encounter.center[0]+.5-position[0],encounter.center[1]+.5-position[1])>5)continue;
    for(const element of encounter.elements){if(element.active||Math.hypot(element.position[0]-position[0],element.position[1]-position[1])>threshold)continue;element.active=true;const completed=encounter.elements.every(item=>item.active);if(completed){encounter.completed=true;encounter.completedAt=now;encounter.motif.acquiredAt=now;state.activeMotifs=[...state.activeMotifs,encounter.motif].slice(-6);state.completedEncounterCount++}state.revision++;changes.push({encounterId:encounter.id,elementId:element.id,completed,description:completed?encounter.transformation:`Another part of the ${encounter.motif.kind} has awakened.`,starResponded:completed&&encounter.relevance==="objective_relevant"});}
  }
  return changes;
}

export function condenseStarFragment(state:ResonanceState){state.permanentStarFragments=Math.min(4,state.permanentStarFragments+1) as 0|1|2|3|4;state.activeMotifs=[];state.revision++}
export function encountersForRender(state:ResonanceState,objectiveId:string|null,position:[number,number],radius=18){return[...state.encounters.values()].filter(item=>(objectiveId==="exit"?item.objectiveId.startsWith("exit:"):item.objectiveId===objectiveId||item.completed)&&Math.hypot(item.center[0]+.5-position[0],item.center[1]+.5-position[1])<=radius)}
export function encounterContext(state:ResonanceState,id:string|null){const encounter=id?state.encounters.get(id):null;if(!encounter)return null;return{whatMTJustAccomplished:encounter.completed?`MT completed the ${encounter.motif.kind}.`:`MT activated part of the ${encounter.motif.kind}.`,whatChangedPermanently:encounter.completed?encounter.transformation:null,starVisiblyResponded:encounter.completed&&encounter.relevance==="objective_relevant",visibleProgress:`${encounter.elements.filter(item=>item.active).length} of ${encounter.elements.length} parts are active.`}}
