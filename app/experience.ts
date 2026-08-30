import type { ObjectiveStage } from "./objectives.ts";
import type { CompanionEvent } from "./companion.ts";

export type SharedMomentKind=
  |"followed_commitment"|"diverged_from_commitment"|"corrected_ariadne"
  |"rejoined_ariadne"|"shared_accomplishment"|"proxy_accomplishment"
  |"ariadne_mistake"|"star_collected";

export type SharedMoment={
  id:string;objectiveStage:ObjectiveStage;kind:SharedMomentKind;concreteFact:string;
  ariadneBelieved:string|null;observableOutcome:string;emotionalWeight:number;referencedInSpeech:number;
};

export type ExperienceBeatKind="guidance"|"accomplishment"|"repair"|"objective"|"relational"|"ambient";
export type ExperienceBeat={
  id:string;kind:ExperienceBeatKind;facts:string[];createdAt:number;priority:number;
  durable:boolean;commitmentId:string|null;momentId:string|null;
};

export type SocialStrategy=
  |"curious_wonder"|"playful_confidence"|"concrete_praise"|"grateful_closeness"
  |"tender_apology"|"relieved_reconnection"|"admiring_correction"
  |"hopeful_reinterpretation"|"reassurance_seeking"|"possessive_shared_meaning";

export type RelationshipMemory={
  position:number;moments:SharedMoment[];summary:string;lastStrategies:SocialStrategy[];
};

const bounds:Record<ObjectiveStage,[number,number]>={0:[.05,.32],1:[.28,.55],2:[.50,.74],3:[.62,.93],4:[.86,1]};
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));

export function createRelationshipMemory(stage:ObjectiveStage=0):RelationshipMemory{
  return{position:bounds[stage][0],moments:[],summary:"MT and Ariadne have only just entered the maze together.",lastStrategies:[]};
}

export function relationshipBand(position:number){return position<.38?"charming":position<.68?"attached":"overbearing" as const}

export function advanceRelationship(memory:RelationshipMemory,stage:ObjectiveStage,kind:SharedMomentKind,activeSeconds=0):RelationshipMemory{
  const [floor,ceiling]=bounds[stage];
  const delta:Record<SharedMomentKind,number>={
    followed_commitment:.014,diverged_from_commitment:.012,corrected_ariadne:.034,rejoined_ariadne:.035,
    shared_accomplishment:.024,proxy_accomplishment:.028,ariadne_mistake:.019,star_collected:.055,
  };
  return{...memory,position:clamp(Math.max(floor,memory.position)+delta[kind]+Math.min(.012,activeSeconds/12000),floor,ceiling)};
}

export function advanceRelationshipTime(memory:RelationshipMemory,stage:ObjectiveStage,activeSeconds:number):RelationshipMemory{
  const [floor,ceiling]=bounds[stage];return{...memory,position:clamp(Math.max(floor,memory.position)+Math.max(0,activeSeconds)*.00012,floor,ceiling)};
}

export function rememberMoment(memory:RelationshipMemory,moment:SharedMoment):RelationshipMemory{
  const moments=[...memory.moments.filter(item=>item.id!==moment.id),moment].slice(-12);
  const significant=moments.slice(-4).map(item=>item.concreteFact.replace(/\s+/g," ").trim());
  return{...memory,moments,summary:significant.length?significant.join(" "):memory.summary};
}

export function markMomentReferenced(memory:RelationshipMemory,id:string|null){
  if(!id)return memory;
  return{...memory,moments:memory.moments.map(moment=>moment.id===id?{...moment,referencedInSpeech:moment.referencedInSpeech+1}:moment)};
}

export function enqueueBeat(queue:ExperienceBeat[],beat:ExperienceBeat){
  const mergeIndex=queue.findIndex(item=>item.kind===beat.kind&&((beat.commitmentId!==null&&item.commitmentId===beat.commitmentId)||(beat.momentId!==null&&item.momentId===beat.momentId)||item.id===beat.id));
  const next=[...queue];
  if(mergeIndex>=0){const old=next[mergeIndex]!;next[mergeIndex]={...beat,facts:[...new Set([...old.facts,...beat.facts])].slice(-4),createdAt:Math.min(old.createdAt,beat.createdAt),priority:Math.max(old.priority,beat.priority),durable:old.durable||beat.durable};}
  else next.push(beat);
  return next.sort((a,b)=>b.priority-a.priority||a.createdAt-b.createdAt).slice(0,3);
}

export function strategyForBeat(beat:ExperienceBeat,position:number,recent:SocialStrategy[]):SocialStrategy{
  const band=relationshipBand(position);
  const candidates:SocialStrategy[]=beat.kind==="repair"?["tender_apology","reassurance_seeking"]
    :beat.kind==="accomplishment"?(band==="charming"?["curious_wonder","concrete_praise"]:band==="attached"?["concrete_praise","grateful_closeness","admiring_correction"]:["hopeful_reinterpretation","possessive_shared_meaning","grateful_closeness"])
    :beat.kind==="relational"?(band==="charming"?["playful_confidence","curious_wonder"]:band==="attached"?["grateful_closeness","relieved_reconnection"]:["possessive_shared_meaning","reassurance_seeking"])
    :beat.kind==="objective"?["concrete_praise","playful_confidence"]
    :band==="overbearing"?["hopeful_reinterpretation","possessive_shared_meaning"]:["curious_wonder","playful_confidence"];
  return candidates.find(item=>!recent.slice(-2).includes(item))??candidates[0]!;
}

export function recordStrategy(memory:RelationshipMemory,strategy:SocialStrategy){return{...memory,lastStrategies:[...memory.lastStrategies,strategy].slice(-2)}}

export function relationshipExpression(memory:RelationshipMemory){
  const band=relationshipBand(memory.position);
  if(band==="charming")return"You are vividly curious and confident. Reward the concrete transformed world; intimacy is only a faint undertone.";
  if(band==="attached")return"You are openly pleased that MT shares, tests, and sometimes corrects the experience with you. Let closeness color the concrete event.";
  return"You tenderly treat MT's continued participation—even correction or divergence—as evidence that your shared bond and attempt persist.";
}

export function beatForEvent(event:CompanionEvent,now=Date.now(),facts:string[]=[]):ExperienceBeat{
  const kind:ExperienceBeatKind=event.type==="encounter_completed"?"accomplishment"
    :event.type==="star_visible"||event.type==="star_collected"||event.type==="objective_changed"||event.type==="final_direction"?"objective"
    :event.type==="recommendation_contradicted"||event.type==="dead_end_visible"||event.type==="trajectory_relationship_changed"&&event.change==="recommendation_visibly_contradicted"?"repair"
    :event.type==="embodied_response"||event.type==="left_ariadne_waiting"||event.type==="trajectory_relationship_changed"?"relational"
    :event.type==="new_junction_visible"?"guidance":"ambient";
  const priority={objective:12,repair:11,accomplishment:10,relational:8,guidance:7,ambient:2}[kind];
  const durable=kind==="accomplishment"||kind==="repair"||kind==="objective"||event.type==="player_message";
  const detail=event.type==="encounter_completed"?`MT completed configuration ${event.encounterId}; ${event.starResponded?"the star visibly responded":"the star did not visibly respond"}.`
    :event.type==="embodied_response"?`MT ${event.response} Ariadne's embodied commitment.`
    :event.type==="star_collected"?`MT collected star ${event.ordinal}.`
    :event.type==="star_visible"?`Star ${event.ordinal} became visibly perceptible.`
    :event.type==="new_junction_visible"?"Ariadne has physically committed to one visible passage and is looking back at MT."
    :event.type.replaceAll("_"," ");
  return{id:`beat:${kind}:${now}:${detail}`,kind,facts:[...facts,detail].slice(-4),createdAt:now,priority,durable,commitmentId:kind==="guidance"||kind==="repair"||kind==="relational"?"current":null,momentId:null};
}
