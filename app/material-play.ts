import type { ResonanceEncounter } from "./resonance.ts";
import type { InfiniteWorld } from "./world.mjs";

export type MaterialGesture="approach"|"look"|"listen";
export type MaterialPlayInput={world:Pick<InfiniteWorld,"tile">;pose:{x:number;y:number;angle:number};speed:number;deltaSeconds:number;now:number;tick:number};
export type MaterialEcho={encounterId:string;elementId:string;position:[number,number];pitch:number};

export function materialGesture(encounter:Pick<ResonanceEncounter,"theme"|"teaching">):MaterialGesture{
  if(encounter.teaching)return"approach";
  if(encounter.theme==="frozen"||encounter.theme==="neutral")return"look";
  if(encounter.theme==="beach"||encounter.theme==="cavern")return"listen";
  return"approach";
}

export function materialHint(encounter:Pick<ResonanceEncounter,"theme"|"teaching">){
  const gesture=materialGesture(encounter);
  return gesture==="listen"?"BE STILL · LISTEN":gesture==="look"?"LET YOUR EYES REST HERE":"MOVE AMONG THE FRAGMENTS";
}

function visible(input:MaterialPlayInput,position:[number,number]){
  const dx=position[0]-input.pose.x,dy=position[1]-input.pose.y,distance=Math.hypot(dx,dy);
  for(let d=.12;d<distance;d+=.12)if(input.world.tile(Math.floor(input.pose.x+dx*d/distance),Math.floor(input.pose.y+dy*d/distance),input.tick)!==0)return false;
  return true;
}

/** Attention changes the object continuously; awakening is only one result.
 * Already-awake parts can be sounded again without awarding more progress. */
export function advanceMaterialPlay(encounters:Iterable<ResonanceEncounter>,input:MaterialPlayInput){
  const awaken=new Set<string>(),echoes:MaterialEcho[]=[];
  const dt=Math.max(0,Math.min(.1,input.deltaSeconds));
  for(const encounter of encounters){
    if(Math.hypot(encounter.center[0]+.5-input.pose.x,encounter.center[1]+.5-input.pose.y)>12){
      for(const element of encounter.elements){element.attention=0;element.materialEngaged=false}
      continue;
    }
    const gesture=materialGesture(encounter);
    const candidates=encounter.elements.map((element,index)=>{
      const dx=element.position[0]-input.pose.x,dy=element.position[1]-input.pose.y,distance=Math.hypot(dx,dy);
      const angle=Math.abs(Math.atan2(Math.sin(Math.atan2(dy,dx)-input.pose.angle),Math.cos(Math.atan2(dy,dx)-input.pose.angle)));
      const inReach=gesture==="approach"?distance<=.68:distance<=3.2&&angle<.38;
      return{element,index,distance,angle,eligible:inReach&&visible(input,element.position)&&(gesture!=="listen"||input.speed<.18)};
    });
    // Looking/listening selects one part at a time, so moving attention among
    // the fragments makes a phrase instead of triggering a whole chord at once.
    const focus=candidates.filter(item=>item.eligible).sort((a,b)=>Number(a.element.active)-Number(b.element.active)||a.angle-b.angle||a.distance-b.distance)[0];
    for(const item of candidates){
      const element=item.element,engaged=item.eligible&&(gesture==="approach"||focus===item);
      if(!engaged){element.attention=Math.max(0,(element.attention??0)-dt*.8);element.materialEngaged=false;continue}
      const newlyEngaged=!element.materialEngaged;element.materialEngaged=true;
      const duration=gesture==="listen"?1.4:gesture==="look"?.8:.15;
      element.attention=Math.min(1,(element.attention??0)+dt/duration);
      if(!element.active&&(gesture==="approach"||element.attention>=1)){
        awaken.add(element.id);element.lastResonatedAt=input.now;continue;
      }
      const replayDelay=gesture==="listen"?1800:gesture==="look"?650:250;
      if(element.active&&input.now-(element.lastResonatedAt??element.activatedAt??0)>replayDelay&&(gesture==="approach"?newlyEngaged:element.attention>=1)){
        element.lastResonatedAt=input.now;element.attention=0;
        echoes.push({encounterId:encounter.id,elementId:element.id,position:element.position,pitch:item.index/Math.max(1,encounter.elements.length-1)});
      }
    }
  }
  return{awaken,echoes};
}
