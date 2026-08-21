import { CAMERA_FOV } from "./camera.ts";
import { visibleStarProjection, type StarObjective } from "./objectives.ts";
import { hash32, type InfiniteWorld } from "./world.mjs";
import { themeAt, type AmbientEntity, type ThemeAnchor, type ThemeId } from "./themes.ts";
import type { RouteDirection } from "./navigation-contracts.ts";

export type RelativeDirection="far_left"|"left"|"center"|"right"|"far_right";
export type SceneDistance="near"|"mid"|"far";
export type SceneSalience="ambient"|"noticeable"|"major";
export type ScenePose={x:number;y:number;angle:number};

export type VisibleOpening={direction:RouteDirection;description:string};
export type VisibleSceneObject={
  id:string;name:string;direction:RelativeDirection;distance:SceneDistance;action:string;firstSeen:boolean;
};
export type VisibleSpectacle={
  id:string;description:string;direction:RelativeDirection;salience:SceneSalience;firstSeen:boolean;visualKind:string;theme:ThemeId;progress:number;
  /** Renderer-only maze coordinate. Removed before companion context is assembled. */
  worldPosition:[number,number];
};
export type PerceivedScene={
  setting:{primaryEnvironment:ThemeId|null;blendedEnvironments:ThemeId[];visibleDetails:string[]};
  geometry:{facingDescription:string;visibleOpenings:VisibleOpening[];visibleEndAhead:boolean;visibleJunction:boolean};
  objects:VisibleSceneObject[];spectacles:VisibleSpectacle[];
  objective:{starVisible:boolean;starDirection:RelativeDirection|null;starDistance:SceneDistance|null};
  mtAttention:{lookingToward:string|null;approaching:string|null;movingAwayFrom:string|null;pausedNear:string|null};
};
export type VisualFrameState={
  time:number;movementSpeed:number;turnRate:number;collisionPulse:number;
  relationshipPhase:"charming"|"attached"|"overbearing";relationshipIntensity:number;
  collectedStars:number;activeStarVisible:boolean;visibleRouteCount:number;messagePulse:number;reducedMotion:boolean;
};
export type SceneMemory={
  seen:Set<string>;previousDistances:Map<string,number>;previousVisible:Map<string,string>;
  encounterStarts:Map<string,number>;spectaclePositions:Map<string,[number,number]>;
};
export type SceneBuildResult={scene:PerceivedScene;changes:string[];majorFirstSeen:string|null};

const ENVIRONMENT_COPY:Record<ThemeId,{name:string;details:string[]}>= {
  neutral:{name:"the shifting maze",details:["moving fossils","impossible runes","watching ornaments"]},
  beach:{name:"buried beach",details:["sand","salt-stained walls","shells","water-light"]},
  tornado:{name:"storm passage",details:["dark clouds","warning cloth","spinning gauges","wind-blown debris"]},
  ruins:{name:"overgrown ruins",details:["vines","stone faces","fungus","small creatures"]},
  frozen:{name:"frozen archive",details:["ice","shelves","loose pages","frosted windows"]},
  foundry:{name:"abandoned foundry",details:["pipes","vents","embers","furnace doors"]},
  cavern:{name:"glowing cavern",details:["crystals","mushrooms","spores","small lights"]},
};

const ACTIONS:Record<string,{name:string;action:string}>= {
  crab:{name:"a tiny crab",action:"scuttling sideways across the floor"},ripple:{name:"a patch of water-light",action:"rippling over dry stone"},
  shell:{name:"a shell",action:"slowly turning in place"},grass:{name:"a tuft of impossible grass",action:"waving without any wind"},driftwood:{name:"a piece of driftwood",action:"rocking as if it were afloat"},
  tumbleweed:{name:"a tumbleweed",action:"rolling against the wind"},dust:{name:"a knot of dust",action:"circling in a tight loop"},warning:{name:"a warning placard",action:"flapping against solid stone"},fence:{name:"a loose fence panel",action:"rattling in the passage"},debris:{name:"a bright scrap of debris",action:"hovering before darting sideways"},
  firefly:{name:"a firefly",action:"drawing square loops in the air"},frog:{name:"a green frog",action:"hopping toward the nearest wall"},vine:{name:"a loose vine",action:"growing and curling back on itself"},statue:{name:"a small stone face",action:"blinking much too slowly"},fungus:{name:"a patch of fungus",action:"blooming and folding shut"},
  moth:{name:"a paper moth",action:"fluttering between the shelves"},page:{name:"a loose page",action:"turning itself in midair"},shelf:{name:"a crooked shelf",action:"opening and closing like a book"},icicle:{name:"a clear icicle",action:"glinting in several colors"},paper:{name:"a stack of pages",action:"shuffling itself"},
  ember:{name:"an ember",action:"floating upward and then falling"},spark:{name:"a spark",action:"skipping along the wall"},pipe:{name:"a copper pipe",action:"bending gently as if breathing"},vent:{name:"a floor vent",action:"puffing square clouds of steam"},slag:{name:"a bead of glowing slag",action:"rolling uphill"},
  glowmoth:{name:"a glowmoth",action:"orbiting a mushroom"},mote:{name:"a small light",action:"hovering as if it is watching"},crystal:{name:"a crystal",action:"splitting the light into impossible colors"},mushroom:{name:"a luminous mushroom",action:"opening and closing like an umbrella"},spore:{name:"a cloud of spores",action:"drifting in a perfect spiral"},
  rune:{name:"a gold rune",action:"rearranging its own pixels"},fossil:{name:"a fossil",action:"crawling one notch along the wall"},
};

const SPECTACLES:Record<ThemeId,Array<{visualKind:string;description:string;direction:RelativeDirection}>>={
  neutral:[
    {visualKind:"rune-rain",description:"gold runes are falling upward along the walls",direction:"left"},
    {visualKind:"watching-eyes",description:"ornamental eyes keep blinking out of sequence",direction:"right"},
    {visualKind:"fossil-drift",description:"tiny fossils are crawling across the ceiling",direction:"center"},
    {visualKind:"door-confetti",description:"a sealed door has sneezed a cloud of colored tiles into the corridor",direction:"right"},
    {visualKind:"ceiling-mouth",description:"a huge pixel mouth has opened in the ceiling, yawned, and begun chewing the darkness",direction:"center"},
  ],
  beach:[
    {visualKind:"masonry-fish",description:"a school of bright fish is swimming through the masonry",direction:"center"},
    {visualKind:"water-caustics",description:"water-light is rolling over the dry corridor",direction:"left"},
    {visualKind:"sand-ribbon",description:"a ribbon of sand is winding itself through the air",direction:"right"},
    {visualKind:"bubble-rise",description:"square bubbles are rising from the floor",direction:"far_left"},
    {visualKind:"shell-fountain",description:"a fountain of shells has erupted, hung in the air, and started falling upward",direction:"center"},
    {visualKind:"crab-orchestra",description:"a line of tiny crabs has marched in and begun conducting the bubbles",direction:"right"},
  ],
  tornado:[
    {visualKind:"sideways-clouds",description:"dark clouds are racing sideways beneath the ceiling",direction:"center"},
    {visualKind:"debris-wheel",description:"bright debris is turning in a slow wheel",direction:"right"},
    {visualKind:"lightning-color",description:"silent lightning is changing the walls' colors",direction:"far_left"},
    {visualKind:"warning-flock",description:"warning placards are flapping like startled birds",direction:"left"},
    {visualKind:"umbrella-storm",description:"a flock of upside-down umbrellas has blown through the wall and opened at once",direction:"center"},
    {visualKind:"lightning-ladder",description:"silent lightning has assembled itself into a ladder and is climbing the ceiling",direction:"left"},
  ],
  ruins:[
    {visualKind:"blinking-faces",description:"the stone faces are blinking one after another",direction:"center"},
    {visualKind:"vine-writing",description:"vines are growing into letters and forgetting them",direction:"left"},
    {visualKind:"frog-parade",description:"tiny frogs are crossing the passage in a solemn line",direction:"right"},
    {visualKind:"firefly-grid",description:"fireflies are arranging themselves into a glowing grid",direction:"far_right"},
    {visualKind:"statue-turn",description:"every stone face has turned to watch a small frog cross the passage",direction:"center"},
    {visualKind:"leaf-whale",description:"a whale made of leaves has swum across the corridor and dissolved into vines",direction:"left"},
  ],
  frozen:[
    {visualKind:"page-current",description:"loose pages are flowing through the air like a current",direction:"center"},
    {visualKind:"frost-bloom",description:"frost flowers are blooming across the wall",direction:"left"},
    {visualKind:"book-breath",description:"the books are opening and closing as if breathing",direction:"right"},
    {visualKind:"prism-snow",description:"rainbow snow is falling in square flakes",direction:"far_right"},
    {visualKind:"page-bird",description:"hundreds of pages have folded into one enormous bird and flapped past MT",direction:"center"},
    {visualKind:"ice-curtain",description:"a curtain of colored icicles has descended, chimed silently, and lifted again",direction:"right"},
  ],
  foundry:[
    {visualKind:"living-pipes",description:"the pipes are bending together like curious necks",direction:"center"},
    {visualKind:"ember-rain",description:"embers are raining upward into the vents",direction:"left"},
    {visualKind:"steam-animals",description:"steam clouds keep becoming little animals and coming apart",direction:"right"},
    {visualKind:"gauge-dance",description:"every pressure gauge is pointing somewhere different",direction:"far_left"},
    {visualKind:"pipe-creature",description:"the pipes have uncoiled into a long copper creature that is peering down the passage",direction:"center"},
    {visualKind:"furnace-grin",description:"the furnace doors have opened into a giant glowing grin and spat out a shower of sparks",direction:"right"},
  ],
  cavern:[
    {visualKind:"breathing-light",description:"the cavern light is brightening and dimming like a breath",direction:"center"},
    {visualKind:"crystal-rainbow",description:"crystals are throwing blocky rainbows across the floor",direction:"left"},
    {visualKind:"mushroom-choir",description:"the mushrooms are opening in a wave",direction:"right"},
    {visualKind:"moth-orbit",description:"glowmoths are circling an empty point in the air",direction:"far_right"},
    {visualKind:"crystal-dance",description:"the crystals have pulled free of the walls and begun dancing in a slow circle",direction:"center"},
    {visualKind:"spore-whale",description:"a luminous animal made of spores has floated past and broken into a thousand lights",direction:"left"},
  ],
};

export function createSceneMemory():SceneMemory{return{seen:new Set(),previousDistances:new Map(),previousVisible:new Map(),encounterStarts:new Map(),spectaclePositions:new Map()}}
const wrap=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));
const directionFor=(delta:number):RelativeDirection=>delta<-.36?delta<-.78?"far_left":"left":delta>.36?delta>.78?"far_right":"right":"center";
const distanceFor=(distance:number):SceneDistance=>distance<2.8?"near":distance<7?"mid":"far";

function pointProjection(world:InfiniteWorld,x:number,y:number,pose:ScenePose,tick:number){
  const dx=x-pose.x,dy=y-pose.y,distance=Math.hypot(dx,dy),delta=wrap(Math.atan2(dy,dx)-pose.angle);
  if(distance<=.3||distance>12||Math.abs(delta)>CAMERA_FOV*.54)return null;
  for(let d=.08;d<distance-.25;d+=.06){const x=Math.floor(pose.x+dx/distance*d),y=Math.floor(pose.y+dy/distance*d);if(world.tile(x,y,tick)!==0)return null}
  return{distance,delta};
}
function visibleProjection(world:InfiniteWorld,entity:AmbientEntity,pose:ScenePose,tick:number){return pointProjection(world,entity.x,entity.y,pose,tick)}

const desiredAngle=(direction:RelativeDirection)=>direction==="far_left"?-.78:direction==="left"?-.42:direction==="right"?.42:direction==="far_right"?.78:0;
function spectaclePosition(args:{id:string;preferredDirection:RelativeDirection;visibleCells:Array<[number,number]>;world:InfiniteWorld;pose:ScenePose;tick:number;seed:number;memory:SceneMemory}){
  const stored=args.memory.spectaclePositions.get(args.id);
  if(stored){const projection=pointProjection(args.world,stored[0],stored[1],args.pose,args.tick);return projection?{position:stored,projection}:null}
  const preferred=desiredAngle(args.preferredDirection),candidates=args.visibleCells
    .filter(([x,y])=>args.world.tile(x,y,args.tick)===0)
    .map(([x,y])=>{const position:[number,number]=[x+.5,y+.5],projection=pointProjection(args.world,position[0],position[1],args.pose,args.tick);return projection?{position,projection}:null})
    .filter((candidate):candidate is {position:[number,number];projection:{distance:number;delta:number}}=>!!candidate&&candidate.projection.distance>1.3)
    .sort((a,b)=>Math.abs(a.projection.delta-preferred)-Math.abs(b.projection.delta-preferred)||b.projection.distance-a.projection.distance);
  if(!candidates.length)return null;
  const pool=candidates.slice(0,Math.min(6,candidates.length)),chosen=pool[hash32(args.seed,args.id)%pool.length]!;
  args.memory.spectaclePositions.set(args.id,chosen.position);
  if(args.memory.spectaclePositions.size>120){const oldest=args.memory.spectaclePositions.keys().next().value;if(oldest)args.memory.spectaclePositions.delete(oldest)}
  return chosen;
}

function facingDescription(angle:number){return["east","south","west","north"][Math.round(((angle%(Math.PI*2))+Math.PI*2)%(Math.PI*2)/(Math.PI/2))%4]!}
const openingDescription=(direction:RouteDirection)=>direction==="straight"?"ahead":direction==="back"?"behind":`on MT's ${direction}`;

export function buildPerceivedScene(args:{
  seed:number;world:InfiniteWorld;anchors:ThemeAnchor[];entities:AmbientEntity[];pose:ScenePose;tick:number;
  routeDirections:RouteDirection[];visibleRoutes?:Array<{direction:RouteDirection;instruction:string}>;visibleJunction:boolean;visibleEndAhead:boolean;activeStar:StarObjective|null;
  visibleCells:Array<[number,number]>;
  phase:"charming"|"attached"|"overbearing";relationshipIntensity:number;collectedStars:number;
  movementState:"walking"|"turning"|"stationary";memory:SceneMemory;reducedMotion?:boolean;
  now?:number;
}):SceneBuildResult{
  const{world,pose,tick,memory}=args,local=themeAt(args.anchors,pose.x,pose.y),layers=local.layers.map(layer=>layer.id).filter(id=>id!=="neutral");
  const primary=local.id,copy=ENVIRONMENT_COPY[primary],changes:string[]=[];
  const visibleEntities=args.entities.map(entity=>({entity,projection:visibleProjection(world,entity,pose,tick)})).filter((item):item is {entity:AmbientEntity;projection:{distance:number;delta:number}}=>!!item.projection).sort((a,b)=>a.projection.distance-b.projection.distance).slice(0,24);
  const objects=visibleEntities.map(({entity,projection})=>{
    const source=ACTIONS[entity.kind]??{name:`a ${entity.kind}`,action:"moving strangely in the passage"},text=args.reducedMotion?{name:source.name,action:"resting motionless in the visible collage"}:source,firstSeen=!memory.seen.has(entity.id);
    if(firstSeen){memory.seen.add(entity.id);changes.push(`${text.name} has appeared ${openingDescription(directionFor(projection.delta)==="center"?"straight":projection.delta<0?"left":"right")}, ${text.action}`)}
    const prior=memory.previousDistances.get(entity.id);memory.previousDistances.set(entity.id,projection.distance);
    return{id:entity.id,name:text.name,direction:directionFor(projection.delta),distance:distanceFor(projection.distance),action:text.action,firstSeen,_priorDistance:prior};
  });
  const intensity=Math.max(0,Math.min(1,args.relationshipIntensity)),baseCount=1+Math.floor(intensity*2)+Math.min(1,args.collectedStars),available=SPECTACLES[primary],now=args.now??Date.now();
  const spectacles:VisibleSpectacle[]=[];
  const zoneX=Math.floor(pose.x/5),zoneY=Math.floor(pose.y/5),encounterIndex=hash32(args.seed,primary,zoneX,zoneY,"encounter")%available.length,encounter=available[encounterIndex]!,encounterId=`encounter:${primary}:${zoneX}:${zoneY}:${encounter.visualKind}`;
  const addSpectacle=(item:{visualKind:string;description:string;direction:RelativeDirection},id:string,theme:ThemeId,salience:SceneSalience,progress:number)=>{
    const spatial=spectaclePosition({id,preferredDirection:item.direction,visibleCells:args.visibleCells,world,pose,tick,seed:args.seed,memory});if(!spatial)return false;
    const firstSeen=!memory.seen.has(id);if(firstSeen){memory.seen.add(id);changes.push(item.description)}
    spectacles.push({...item,id,theme,direction:directionFor(spatial.projection.delta),firstSeen,salience,progress,worldPosition:spatial.position});return true;
  };
  const encounterSpatial=spectaclePosition({id:encounterId,preferredDirection:encounter.direction,visibleCells:args.visibleCells,world,pose,tick,seed:args.seed,memory});
  if(encounterSpatial&&!memory.encounterStarts.has(encounterId))memory.encounterStarts.set(encounterId,now);
  const encounterAge=memory.encounterStarts.has(encounterId)?now-memory.encounterStarts.get(encounterId)!:Infinity;
  if(encounterAge<12_000)addSpectacle(encounter,encounterId,primary,"major",encounterAge/12_000);
  for(let i=0;i<Math.min(baseCount,available.length-1);i++){
    const index=(encounterIndex+i+1)%available.length,item=available[index]!,id=`atmosphere:${primary}:${zoneX}:${zoneY}:${item.visualKind}`;
    addSpectacle(item,id,primary,i===0?"noticeable":"ambient",(now%10_000)/10_000);
  }
  if((args.phase!=="charming"||args.collectedStars>=2)&&args.anchors.length>1){
    const foreignThemes=[...new Set(args.anchors.filter(anchor=>anchor.triggered).map(anchor=>anchor.theme))].filter(theme=>theme!==primary),foreign=foreignThemes[hash32(args.seed,tick>>3,"foreign")%Math.max(1,foreignThemes.length)];
    if(foreign){const item=SPECTACLES[foreign][hash32(args.seed,foreign,primary)%SPECTACLES[foreign].length]!,id=`collage:${foreign}:${primary}:${zoneX}:${zoneY}:${item.visualKind}`,description=`Out of place here, ${item.description}`;
      addSpectacle({...item,description},id,foreign,"noticeable",(now%10_000)/10_000);
    }
  }
  const star=visibleStarProjection(world,args.activeStar,pose,tick,12,CAMERA_FOV),starDirection=star?directionFor(star.relativeAngle):null,starDistance=star?distanceFor(star.distance):null;
  if(star&& !memory.seen.has(`star:${args.activeStar?.id}`)){memory.seen.add(`star:${args.activeStar?.id}`);changes.push(`the ${starDistance} star has become visible ${starDirection?.replace("_"," ")}`)}
  const centered=objects.find(object=>object.direction==="center"),near=objects.find(object=>object.distance==="near");
  let approaching:string|null=null,movingAwayFrom:string|null=null;
  for(const object of objects){const prior=(object as typeof object&{_priorDistance?:number})._priorDistance;if(prior===undefined||args.movementState!=="walking")continue;const current=visibleEntities.find(item=>item.entity.id===object.id)?.projection.distance??prior;if(prior-current>.35){approaching=object.name;break}if(current-prior>.35)movingAwayFrom=object.name}
  const cleanObjects=objects.map(object=>({id:object.id,name:object.name,direction:object.direction,distance:object.distance,action:object.action,firstSeen:object.firstSeen})),currentVisible=new Map(cleanObjects.map(object=>[object.id,object.name]));
  for(const[id,name]of memory.previousVisible)if(!currentVisible.has(id))changes.push(`${name} has slipped out of MT's view`);memory.previousVisible=currentVisible;
  const visibleRouteDescriptions=args.visibleRoutes?.length?args.visibleRoutes.map(route=>({direction:route.direction,description:route.instruction})):[...new Set(args.routeDirections)].map(direction=>({direction,description:`an open passage ${openingDescription(direction)}`}));
  const scene:PerceivedScene={
    setting:{primaryEnvironment:primary,blendedEnvironments:[...new Set([primary,...layers])],visibleDetails:[copy.name,...copy.details.slice(0,3)]},
    geometry:{facingDescription:`MT is facing ${facingDescription(pose.angle)}`,visibleOpenings:visibleRouteDescriptions,visibleEndAhead:args.visibleEndAhead,visibleJunction:args.visibleJunction},
    objects:cleanObjects,spectacles,
    objective:{starVisible:!!star,starDirection,starDistance},
    mtAttention:{lookingToward:centered?.name??null,approaching,movingAwayFrom,pausedNear:args.movementState==="stationary"?near?.name??null:null},
  };
  const majorFirstSeen=spectacles.find(item=>item.firstSeen&&item.salience==="major")?.id??null;
  return{scene,changes:[...new Set(changes)].slice(-10),majorFirstSeen};
}

export function sceneForPrompt(scene:PerceivedScene){
  return{
    ...scene,
    objects:scene.objects.map(object=>({name:object.name,direction:object.direction,distance:object.distance,action:object.action,firstSeen:object.firstSeen})),
    spectacles:scene.spectacles.map(spectacle=>({description:spectacle.description,direction:spectacle.direction,salience:spectacle.salience,firstSeen:spectacle.firstSeen})),
  };
}
export type PromptPerceivedScene=ReturnType<typeof sceneForPrompt>;

export function describePerceivedScene(scene:PerceivedScene){
  const openings=scene.geometry.visibleOpenings.map(item=>item.description).join(", ")||"no open passage in the current view";
  const objects=scene.objects.slice(0,5).map(item=>`${item.name} is ${item.action} ${item.direction.replace("_"," ")}`).join("; ")||"no distinct moving object is visible";
  const spectacles=scene.spectacles.slice(0,5).map(item=>item.description).join("; ")||"no large spectacle is active";
  const attention=[scene.mtAttention.lookingToward&&`MT is looking toward ${scene.mtAttention.lookingToward}`,scene.mtAttention.approaching&&`MT is approaching ${scene.mtAttention.approaching}`,scene.mtAttention.movingAwayFrom&&`MT is moving away from ${scene.mtAttention.movingAwayFrom}`,scene.mtAttention.pausedNear&&`MT is paused near ${scene.mtAttention.pausedNear}`].filter(Boolean).join("; ")||"MT's attention is not fixed on a particular object";
  return{view:`${scene.geometry.facingDescription}. Visible ways: ${openings}. ${scene.geometry.visibleEndAhead?"The passage visibly ends ahead.":""}`,world:`Visible setting: ${scene.setting.visibleDetails.join(", ")}. Visible activity: ${objects}. Larger events: ${spectacles}.`,attention};
}
