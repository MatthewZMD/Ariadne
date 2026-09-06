import { createResonanceState, ensureObjectiveJourney } from "../app/resonance.ts";
import { InfiniteWorld } from "../app/world.mjs";
import { createObjectiveState, collectStar, chooseNavigationBelief, chooseNavigationBeliefAsync } from "../app/objectives.ts";

// Measures the authored route substrate, not human completion time.
const seeds=[91,731,812,915,1201,2407,3109,4813];
const rows=[];
// Independent generated-world geometry audit, never a live player route.
function accessibleEncounterParts(world,encounter){
  const queue=[{cell:encounter.center,distance:0}],seen=new Set([encounter.center.join(",")]);
  for(let cursor=0;cursor<queue.length;cursor++){
    const {cell,distance}=queue[cursor];
    if(distance===16)continue;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const next=[cell[0]+dx,cell[1]+dy],key=next.join(",");
      if(seen.has(key)||world.tile(...next)!==0)continue;
      seen.add(key);queue.push({cell:next,distance:distance+1});
    }
  }
  return encounter.elements.filter(element=>seen.has(element.position.map(Math.floor).join(","))).length;
}
for(const seed of seeds){
  const world=new InfiniteWorld(seed),visited=new Set(["1,1"]);
  // Match newRun's heading, sealed entrance and initial visibility. Auditing
  // the bare generated maze omits the opening the player actually traverses.
  const directions=[[1,0],[0,1],[-1,0],[0,-1]];
  let best=0,depth=-1;
  directions.forEach(([dx,dy],index)=>{
    let distance=0;
    while(distance<12&&world.tile(1+dx*(distance+1),1+dy*(distance+1))===0)distance++;
    if(distance>depth){depth=distance;best=index;}
  });
  const gate=world.setEntranceCorridor(1,1,...directions[best]);
  const entranceSteps=Math.abs(gate.exit[0]-1)+Math.abs(gate.exit[1]-1);
  const visible=new Set(["1,1"]);
  for(let ray=0;ray<360;ray++){
    const angle=ray/360*Math.PI*2;
    for(let distance=.04;distance<12;distance+=.055){
      const x=Math.floor(1.5+Math.cos(angle)*distance),y=Math.floor(1.5+Math.sin(angle)*distance);
      visible.add(`${x},${y}`);if(world.tile(x,y)!==0)break;
    }
  }
  let state=createObjectiveState(world,[1,1],seed,visible,visited);
  const resonance=createResonanceState();
  const lengths=[],byStage=[];let comparisons=0,mismatches=0;
  for(let ordinal=1;ordinal<=4;ordinal++){
    const path=state.activeStar.canonicalPath;lengths.push(path.length-1);
    let stageComparisons=0,stageMismatches=0;
    for(let index=1;index<path.length-1&&stageComparisons<4;index++){
      const cell=path[index],before=path[index-1];
      const neighbors=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>[cell[0]+x,cell[1]+y]).filter(([x,y])=>world.tile(x,y)===0);
      if(neighbors.length<3)continue;
      const routes=neighbors.filter(p=>p[0]!==before[0]||p[1]!==before[1]).map((point,i)=>({id:`route-${i}`,direction:i?"left":"straight",knownCells:[point],targetCell:point,targetRegionId:null,instruction:"This way.",description:"Open passage",score:0}));
      const junction=`junction:${cell.join(",")}`;
      const exact=chooseNavigationBelief(state,routes,junction,world,seed,false);
      const live=await chooseNavigationBeliefAsync(state,routes,junction,world,seed,false);
      comparisons++;stageComparisons++;if(exact.belief.routeId!==live.belief.routeId){mismatches++;stageMismatches++;}
      state=exact.state;
    }
    const journey=ensureObjectiveJourney(resonance,world,{seed,objectiveId:state.activeStar.id,ordinal,path,tick:0,activeSeconds:0});
    const required=journey.requiredEncounterIds.map(id=>resonance.encounters.get(id));
    const requiredParts=required.reduce((sum,encounter)=>sum+encounter.elements.length,0);
    const accessibleRequiredParts=required.reduce((sum,encounter)=>sum+accessibleEncounterParts(world,encounter),0);
    byStage.push({ordinal,comparisons:stageComparisons,mismatches:stageMismatches,requiredParts,accessibleRequiredParts});
    state=collectStar(state,world,seed,visited);
  }
  rows.push({seed,byStage,entranceSteps,starSteps:lengths,totalSteps:lengths.reduce((a,b)=>a+b,0),oracleComparisons:comparisons,oracleMismatches:mismatches});
}
console.log(JSON.stringify({scope:"Production entrance and initial visibility included. Shortest authored paths; up to four junction comparisons per star with evolving decision state. Excludes detours, encounters, turning, reading, and conversation; not a player simulation. Required-part audit checks open-cell connectivity within 16 steps of each encounter center; excludes gesture completion, visibility, footprint collision, and later regeneration",rows},null,2));
