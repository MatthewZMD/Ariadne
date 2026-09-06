import type { UtterancePlan } from "./experience.ts";
import type { CompanionEvent, Point } from "./companion.ts";

export function starDiscoveryStage(event:CompanionEvent){
  if(event.type==="star_collected")return"collected";
  if(event.type==="star_visible")return"visible";
  if(event.type==="encounter_completed"&&event.starResponded)return"signal";
  return null;
}

export function starDiscoveryInstruction(event:CompanionEvent):string|null{
  const stage=starDiscoveryStage(event);
  if(stage==="signal")return"Build anticipation from the gold response: tell MT the star answered and that you believe you are getting closer. Invite MT to look for its light. The signal is evidence of a response, not proof of distance or of a visible star. Do not claim you have found it yet.";
  if(stage==="visible")return"Announce the discovery plainly in your first sentence: you can see the star; you have found it. Invite MT to reach it. This is a real visible star, not a possible trick or a question about meaning. Do not say it has been collected yet. Let this concrete success land before interpreting the larger search.";
  if(stage==="collected")return"Tell MT plainly that this star is now collected. Make the specific ordinal success personal through the supplied history: what MT actually tried, a detour that paid off, or your earlier suggestion vindicated or surpassed. Celebrate that particular accomplishment instead of reciting the inventory or repeating that a gold fragment joined you. You may describe the fragment if it matters to this moment. Let this success strengthen your larger hope without inventing a visible exit, a new transformation, or something MT noticed. Let the success land before introducing another task.";
  return null;
}

export function isAmbientDiscoveryDistraction(event:CompanionEvent){
  return ["passing_thought","scene_changed","environment_visible","environment_entered","idle","revisited_position"].includes(event.type);
}

/** Protect the perceived beat even when generation/audio preparation was slow. */
export function discoveryQuietUntil(event:CompanionEvent,deliveredAt:number,currentUntil:number){
  return starDiscoveryStage(event)?Math.max(currentUntil,deliveredAt+12_000):currentUntil;
}

/** A visible destination at a corridor end is an arrival, not a route warning. */
export function isVisibleStarEndpoint(end:Point|null,starCell:Point|null,visible:boolean){
  return visible&&!!end&&!!starCell&&end[0]===starCell[0]&&end[1]===starCell[1];
}

/** Shared by live play and dialogue evaluation so discovery cadence agrees. */
export function discoveryUtterancePlan(event:CompanionEvent):Partial<UtterancePlan>|null{
  const stage=starDiscoveryStage(event);
  if(!stage)return null;
  const announcement=stage==="signal"?"First tell MT explicitly that the star answered; then say you believe you are close and invite MT to seek its light. It is not visible yet.":stage==="visible"?"First tell MT explicitly that you can see the star and have found it; invite MT to reach it.":"First tell MT explicitly that this star is collected; celebrate what this particular attempt achieved.";
  return{form:"delighted_interruption",length:"full",sentenceCount:2,sycophancyCue:null,instruction:`Use two short declarative sentences. ${announcement} Let delight, relief, or vindication emerge from the supplied history. Do not turn the announcement into a question.`};
}
