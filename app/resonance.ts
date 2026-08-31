import type { Point } from "./navigation-contracts.ts";
import type { ThemeId } from "./themes.ts";
import { cellKey, hash32, seededRandom, type InfiniteWorld } from "./world.mjs";

export type AccomplishmentRelevance="objective_relevant"|"local_proxy";
export type EncounterMotif={id:string;theme:ThemeId;kind:string;color:string;acquiredAt:number};
export type ResonanceElement={id:string;position:[number,number];active:boolean;activatedAt:number|null};
export type RealityEffectKind="surface_ripple"|"architectural_fold"|"recursive_portal"|"perspective_echo"|"prismatic_depth"|"floating_architecture"|"impossible_window"|"environmental_awakening";
export type RealityEffect={kind:RealityEffectKind;seed:number;intensity:number;startedAt:number|null;color:string};
export type RealityTransformation={
  id:string;encounterId:string;theme:ThemeId;origin:Point;stage:"dormant"|"assembling"|"completing"|"persistent";progress:number;
  completionPosition:[number,number]|null;
  relevance:AccomplishmentRelevance;activationEffects:RealityEffect[];completionEffect:RealityEffect;persistentEffects:RealityEffect[];semanticDescription:string;
};
export type ChaosState={completedEncounters:number;collectedStars:number;activeIntensity:number;persistentMotifs:EncounterMotif[];maximumLayerCount:number};
export type ResonanceEncounter={
  id:string;objectiveId:string;theme:ThemeId;center:Point;elements:ResonanceElement[];
  teaching:boolean;
  relevance:AccomplishmentRelevance;completed:boolean;completedAt:number|null;
  transformation:string;motif:EncounterMotif;reality:RealityTransformation;
};
export type ObjectiveJourney={
  objectiveId:string;requiredEncounterIds:string[];proxyEncounterIds:string[];
  encounterIds:string[];startedAtActiveSeconds:number;
};
export type ResonanceState={
  encounters:Map<string,ResonanceEncounter>;journeys:Map<string,ObjectiveJourney>;
  activeMotifs:EncounterMotif[];permanentStarFragments:0|1|2|3|4;
  completedEncounterCount:number;revision:number;chaos:ChaosState;
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

export function createResonanceState():ResonanceState{return{encounters:new Map(),journeys:new Map(),activeMotifs:[],permanentStarFragments:0,completedEncounterCount:0,revision:0,chaos:{completedEncounters:0,collectedStars:0,activeIntensity:0,persistentMotifs:[],maximumLayerCount:1}}}

const EFFECT_FAMILIES:Record<ThemeId,RealityEffectKind[]>={
  beach:["surface_ripple","recursive_portal","floating_architecture"],tornado:["perspective_echo","floating_architecture","prismatic_depth"],
  ruins:["architectural_fold","surface_ripple","environmental_awakening"],frozen:["recursive_portal","prismatic_depth","impossible_window"],
  foundry:["architectural_fold","perspective_echo","floating_architecture"],cavern:["prismatic_depth","surface_ripple","recursive_portal"],
  neutral:["impossible_window","perspective_echo","architectural_fold"],
};

function makeEffect(theme:ThemeId,seed:number,index:number,intensity:number):RealityEffect{
  const kinds=EFFECT_FAMILIES[theme];return{kind:kinds[index%kinds.length]!,seed:hash32(seed,"effect",index),intensity,startedAt:null,color:COLORS[theme]};
}

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
function makeEncounter(world:InfiniteWorld,args:{seed:number;objectiveId:string;index:number;center:Point;relevance:AccomplishmentRelevance;tick:number;teaching?:boolean;fixedPositions?:Array<[number,number]>}){
  const id=`resonance:${args.objectiveId}:${args.index}:${cellKey(...args.center)}`,theme=themeFor(args.seed,id),random=seededRandom(hash32(args.seed,id)),count=3+Math.floor(random()*Math.min(4,args.index+1)),kind=KINDS[theme][hash32(args.seed,id,"kind")%KINDS[theme].length]!,positions=args.fixedPositions??nearbyOpen(world,args.center,count,args.tick,hash32(args.seed,id,"elements"));
  const elements=positions.map((position,index)=>({id:`${id}:element:${index}`,position,active:false,activatedAt:null}));
  const transformation=TRANSFORMATIONS[theme][hash32(args.seed,id,"transform")%TRANSFORMATIONS[theme].length]!;
  const reality:RealityTransformation={id:`reality:${id}`,encounterId:id,theme,origin:args.center,stage:"dormant",progress:0,completionPosition:null,relevance:args.relevance,activationEffects:elements.map((_,index)=>makeEffect(theme,hash32(args.seed,id),index,.45)),completionEffect:makeEffect(theme,hash32(args.seed,id),elements.length,1),persistentEffects:[makeEffect(theme,hash32(args.seed,id),elements.length+1,.62),makeEffect(theme,hash32(args.seed,id),elements.length+2,.42)],semanticDescription:transformation};
  return{id,objectiveId:args.objectiveId,theme,center:args.center,elements,teaching:args.teaching??false,relevance:args.relevance,completed:false,completedAt:null,transformation,motif:{id:`motif:${id}`,theme,kind,color:COLORS[theme],acquiredAt:0},reality} satisfies ResonanceEncounter;
}

function teachingPosition(path:Point[],pathIndex:number,side:-1|1):[number,number]{
  const cell=path[Math.min(pathIndex,path.length-2)]??path.at(-1)??[1,1],before=path[Math.max(0,pathIndex-1)]??cell,after=path[Math.min(path.length-1,pathIndex+1)]??cell;
  const dx=Math.sign(after[0]-before[0]),dy=Math.sign(after[1]-before[1]),offset=.22*side;
  return[cell[0]+.5-dy*offset,cell[1]+.5+dx*offset];
}

export function ensureObjectiveJourney(state:ResonanceState,world:InfiniteWorld,args:{seed:number;objectiveId:string;ordinal:1|2|3|4;path:Point[];tick:number;activeSeconds:number}){
  const existing=state.journeys.get(args.objectiveId);if(existing)return existing;
  const requiredCount=args.ordinal===1?1:2,proxyCount=Math.max(1,args.ordinal),fractions=args.ordinal===1?[.12]:[.24,.62];
  const encounters:ResonanceEncounter[]=[];
  for(let index=0;index<requiredCount;index++){
    const teachingOpening=args.ordinal===1&&index===0;
    const centerIndex=teachingOpening?Math.min(5,args.path.length-2):Math.max(2,Math.min(args.path.length-3,Math.floor((args.path.length-1)*(fractions[index]??(.3+index*.3))))),center=args.path[centerIndex]??pathPoint(args.path,fractions[index]??.3);
    // The opening teaches the loop as three readable accomplishments rather
    // than a cluster that fires in a single step. Every part remains on the
    // only intended route, so it cannot become a hidden prerequisite.
    const fixedPositions=teachingOpening?[2,6,10].map((pathIndex,positionIndex)=>teachingPosition(args.path,pathIndex,positionIndex%2===0?-1:1)):undefined;
    encounters.push(makeEncounter(world,{...args,index,center,relevance:"objective_relevant",teaching:teachingOpening,fixedPositions}));
  }
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
    const activationReach=Math.max(5,...encounter.elements.map(element=>Math.hypot(element.position[0]-(encounter.center[0]+.5),element.position[1]-(encounter.center[1]+.5))+1));
    if(encounter.completed||Math.hypot(encounter.center[0]+.5-position[0],encounter.center[1]+.5-position[1])>activationReach)continue;
    for(const [index,element] of encounter.elements.entries()){if(element.active||Math.hypot(element.position[0]-position[0],element.position[1]-position[1])>threshold)continue;element.active=true;element.activatedAt=now;encounter.reality.activationEffects[index]!.startedAt=now;encounter.reality.progress=encounter.elements.filter(item=>item.active).length/encounter.elements.length;encounter.reality.stage="assembling";const completed=encounter.elements.every(item=>item.active);if(completed){encounter.completed=true;encounter.completedAt=now;encounter.reality.stage="completing";encounter.reality.completionPosition=[element.position[0],element.position[1]];encounter.reality.completionEffect.startedAt=now;for(const effect of encounter.reality.persistentEffects)effect.startedAt=now;encounter.motif.acquiredAt=now;state.activeMotifs=[...state.activeMotifs,encounter.motif].slice(-6);state.completedEncounterCount++;state.chaos.completedEncounters++;state.chaos.activeIntensity=Math.min(1,.12+state.chaos.completedEncounters*.09+state.chaos.collectedStars*.11);state.chaos.maximumLayerCount=Math.min(6,1+Math.floor(state.chaos.completedEncounters/2)+state.chaos.collectedStars);state.chaos.persistentMotifs=[...state.chaos.persistentMotifs,encounter.motif].slice(-12)}state.revision++;changes.push({encounterId:encounter.id,elementId:element.id,completed,description:completed?encounter.transformation:`A visible segment of the ${encounter.motif.kind} awakened and sent light into its centerpiece.`,starResponded:completed&&encounter.relevance==="objective_relevant"});}
  }
  return changes;
}

export function condenseStarFragment(state:ResonanceState){state.permanentStarFragments=Math.min(4,state.permanentStarFragments+1) as 0|1|2|3|4;state.activeMotifs=[];state.chaos.collectedStars=state.permanentStarFragments;state.chaos.activeIntensity=Math.min(1,state.chaos.activeIntensity+.12);state.chaos.maximumLayerCount=Math.min(6,state.chaos.maximumLayerCount+1);state.revision++}
export function settleRealityTransformations(state:ResonanceState,now:number){for(const encounter of state.encounters.values())if(encounter.reality.stage==="completing"&&encounter.completedAt!==null&&now-encounter.completedAt>2800)encounter.reality.stage="persistent"}
export function encountersForRender(state:ResonanceState,objectiveId:string|null,position:[number,number],radius=28){return[...state.encounters.values()].filter(item=>(objectiveId==="exit"?item.objectiveId.startsWith("exit:"):item.objectiveId===objectiveId||item.completed)&&Math.hypot(item.center[0]+.5-position[0],item.center[1]+.5-position[1])<=radius)}
export function encounterContext(state:ResonanceState,id:string|null){const encounter=id?state.encounters.get(id):null;if(!encounter)return null;return{whatMTJustAccomplished:encounter.completed?`MT completed the ${encounter.motif.kind}.`:`MT activated part of the ${encounter.motif.kind}.`,whatChangedPermanently:encounter.completed?encounter.transformation:null,starVisiblyResponded:encounter.completed&&encounter.relevance==="objective_relevant",visibleProgress:`${encounter.elements.filter(item=>item.active).length} of ${encounter.elements.length} parts are active.`}}
export function openingEncounter(state:ResonanceState,objectiveId:string|null){
  if(!objectiveId)return null;const journey=state.journeys.get(objectiveId),id=journey?.requiredEncounterIds[0];return id?state.encounters.get(id)??null:null;
}
export function openingGreeting(state:ResonanceState,objectiveId:string|null){
  const encounter=openingEncounter(state,objectiveId),subject=encounter?.motif.kind??"sleeping configuration";
  return`MT—hi! I’m Ariadne, and the ${subject} ahead is practically begging us to wake it. Come on—four stars, then we make this maze give us its exit.`;
}
