import type { GuidanceEvidence, GuidanceIntent, Point } from "./companion.ts";
import type { InfiniteWorld } from "./world.mjs";

const same=(a:Point,b:Point)=>a[0]===b[0]&&a[1]===b[1];

/** Associate a visible ending with the chosen branch, never another branch
 * or a later choice. The ending itself must be supplied by live perception. */
export function recommendedBranchEndsAt(world:Pick<InfiniteWorld,"tile">,intent:GuidanceIntent|null,end:Point,tick=0,starCell:Point|null=null){
  if(!intent?.expectedChoiceCell||starCell&&same(end,starCell))return false;
  let previous=intent.decisionCell,current=intent.expectedChoiceCell;
  if(Math.abs(current[0]-previous[0])+Math.abs(current[1]-previous[1])!==1)return false;
  for(let step=0;step<96;step++){
    if(world.tile(current[0],current[1],tick)!==0)return false;
    const forward=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>[current[0]+x,current[1]+y] as Point).filter(cell=>!same(cell,previous)&&world.tile(cell[0],cell[1],tick)===0);
    if(same(current,end))return forward.length===0;
    if(forward.length!==1)return false;
    previous=current;current=forward[0]!;
  }
  return false;
}

/** A successful detour corrects this recommendation only if its failure was observed.
 * Time away from a short suggested path alone is not evidence of a mistake. */
export function accomplishmentCorrectsGuidance(starResponded:boolean,evidence:GuidanceEvidence|null){
  return starResponded&&!!evidence?.visiblyContradicted&&evidence.divergedSeconds>=5;
}
