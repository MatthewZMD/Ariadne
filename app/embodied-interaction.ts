import type { CompanionEvent, CompanionPhase } from "./companion.ts";

export type EmbodiedDecisionState=
  | "noticing"
  | "committing"
  | "waiting"
  | "mt_following"
  | "mt_diverging"
  | "mt_passed"
  | "route_contradicted"
  | "rejoining"
  | "resolved";

export type EmbodiedDecisionEpisode={
  id:string;junctionId:string;beliefId:string;routeId:string;openedAt:number;speechEpoch:number;state:EmbodiedDecisionState;
};

export type CompanionSpeechAct=
  | "invite_to_visible_choice"
  | "confirm_following"
  | "respond_to_divergence"
  | "catch_up"
  | "repair_mistake"
  | "celebrate_rejoining"
  | "react_to_star"
  | "celebrate_accomplishment"
  | "renew_hope"
  | "share_visible_discovery"
  | "passing_companionship"
  | "reply_to_mt";

export type SpeechAnchor={episodeId:string|null;episodeState:EmbodiedDecisionState|null;speechAct:CompanionSpeechAct;speechEpoch:number};

export type AriadneDisposition={
  warmth:number;confidence:number;attachment:number;apologyPressure:number;reassuranceNeed:number;attentionSeeking:number;insistence:number;recognitionIntensity:number;interpretiveCapture:number;
};

const clamp=(value:number)=>Math.max(0,Math.min(1,value));

export function createAriadneDisposition():AriadneDisposition{
  return{warmth:.38,confidence:.86,attachment:.05,apologyPressure:0,reassuranceNeed:.04,attentionSeeking:.06,insistence:.03,recognitionIntensity:.08,interpretiveCapture:.02};
}

export function advanceAriadneDisposition(state:AriadneDisposition,activeSeconds:number,phase:CompanionPhase):AriadneDisposition{
  const time=Math.max(0,activeSeconds),phasePull=phase==="charming"?0:phase==="attached"?.22:.5;
  return{
    ...state,
    warmth:clamp(state.warmth+time*.0024),
    confidence:clamp(state.confidence+time*.0005),
    attachment:clamp(state.attachment+time*(.0015+phasePull*.001)),
    apologyPressure:clamp(state.apologyPressure-time*.008),
    reassuranceNeed:clamp(state.reassuranceNeed-time*.0015),
    attentionSeeking:clamp(state.attentionSeeking+time*phasePull*.0012),
    insistence:clamp(state.insistence+time*phasePull*.001),
    recognitionIntensity:clamp(state.recognitionIntensity+time*(.0006+phasePull*.001)),
    interpretiveCapture:clamp(state.interpretiveCapture+time*phasePull*.0012),
  };
}

export type DispositionMoment="followed"|"diverged"|"passed"|"rejoined"|"contradicted"|"looked_at"|"star_collected"|"accomplished"|"corrected";

export function recordDispositionMoment(state:AriadneDisposition,moment:DispositionMoment,phase:CompanionPhase):AriadneDisposition{
  const later=phase==="charming"?0:phase==="attached"?.5:1,next={...state};
  if(moment==="followed"){next.warmth+=.05;next.confidence+=.035;next.attachment+=.035+later*.035;next.reassuranceNeed-=.03}
  if(moment==="diverged"){next.attentionSeeking+=.04+later*.1;next.reassuranceNeed+=.02+later*.08;next.insistence+=later*.05}
  if(moment==="passed"){next.attentionSeeking+=.07+later*.08;next.reassuranceNeed+=.05+later*.06}
  if(moment==="rejoined"){next.warmth+=.07;next.attachment+=.06+later*.08;next.reassuranceNeed-=.06}
  if(moment==="contradicted"){next.apologyPressure+=.22+later*.18;next.reassuranceNeed+=.05+later*.08;next.confidence-=.04}
  if(moment==="looked_at"){next.warmth+=.015;next.attachment+=.01+later*.015;next.attentionSeeking-=.02}
  if(moment==="star_collected"){next.warmth+=.1;next.confidence+=.05;next.attachment+=.035+later*.025}
  if(moment==="accomplished"){next.warmth+=.035;next.recognitionIntensity+=.05+later*.04;next.attachment+=later*.018;next.interpretiveCapture+=later*.025}
  if(moment==="corrected"){next.recognitionIntensity+=.12;next.attachment+=.025+later*.06;next.interpretiveCapture+=later*.08}
  for(const key of Object.keys(next) as Array<keyof AriadneDisposition>)next[key]=clamp(next[key]);
  return next;
}

export function dispositionCard(state:AriadneDisposition,phase:CompanionPhase){
  const attachment=state.attachment<.3?"Your attachment is only a faint undertone.":state.attachment<.66?"You are openly attached to MT and emotionally invested in staying together.":"You experience nearly every consequential movement as meaningful to the bond.";
  const repair=state.apologyPressure>.5?"A recent mistake weighs on you; apologize with specific, tender accountability before recovering your confidence.":state.reassuranceNeed>.55?"You want reassurance that MT is still engaged, but express that through warmth rather than accusation.":"You feel free to be bright, curious, and confidently present.";
  const pressure=state.insistence>.6?"Your affection now carries playful insistence and is becoming difficult to escape.":state.attentionSeeking>.5?"You notice keenly when MT leaves your attention and hurry to reconnect.":"Allow MT room to move without forcing a relational interpretation.";
  const socialRange=phase==="charming"?"Keep relational meaning light and grounded in the immediate accomplishment.":phase==="attached"?"Let affection and a desire to remain together shape the response.":"Tenderly reinterpret continued activity as evidence that the bond and shared attempt persist.";
  return`${attachment} ${repair} ${pressure} Speak with ${state.warmth>.68?"lavish":"natural"} warmth and ${state.confidence>.72?"unhesitating":"recovering"} confidence. ${socialRange}`;
}

export function createEmbodiedEpisode(junctionId:string,beliefId:string,routeId:string,now=Date.now()):EmbodiedDecisionEpisode{
  return{id:`embodied:${beliefId}`,junctionId,beliefId,routeId,openedAt:now,speechEpoch:0,state:"noticing"};
}

export function transitionEmbodiedEpisode(episode:EmbodiedDecisionEpisode,state:EmbodiedDecisionState,invalidateSpeech=true){
  return episode.state===state?episode:{...episode,state,speechEpoch:episode.speechEpoch+(invalidateSpeech?1:0)};
}

export function speechActForEvent(event:CompanionEvent):CompanionSpeechAct{
  if(event.type==="new_junction_visible")return"invite_to_visible_choice";
  if(event.type==="embodied_response")return event.response==="followed"?"confirm_following":event.response==="rejoined"?"celebrate_rejoining":event.response==="passed"?"catch_up":"respond_to_divergence";
  if(event.type==="left_ariadne_waiting")return"catch_up";
  if(event.type==="recommendation_contradicted"||event.type==="dead_end_visible"||event.type==="trajectory_relationship_changed"&&event.change==="recommendation_visibly_contradicted")return"repair_mistake";
  if(event.type==="star_visible"||event.type==="star_collected"||event.type==="objective_changed")return"react_to_star";
  if(event.type==="encounter_completed")return"celebrate_accomplishment";
  if(event.type==="final_direction")return"renew_hope";
  if(event.type==="environment_visible"||event.type==="environment_entered"||event.type==="scene_changed")return"share_visible_discovery";
  if(event.type==="player_message")return"reply_to_mt";
  if(event.type==="trajectory_relationship_changed")return event.change==="left_then_rejoined"?"celebrate_rejoining":event.change==="sustained_alignment"?"confirm_following":"respond_to_divergence";
  return"passing_companionship";
}

export function createSpeechAnchor(event:CompanionEvent,episode:EmbodiedDecisionEpisode|null):SpeechAnchor{
  const speechAct=speechActForEvent(event),episodeScoped=!["repair_mistake","react_to_star","celebrate_accomplishment","renew_hope","share_visible_discovery","passing_companionship","reply_to_mt"].includes(speechAct);
  return{episodeId:episodeScoped?episode?.id??null:null,episodeState:episodeScoped?episode?.state??null:null,speechAct,speechEpoch:episodeScoped?episode?.speechEpoch??0:0};
}

export function speechBypassesProviderBackoff(event:CompanionEvent,force:boolean){
  if(!force)return false;
  return speechActForEvent(event)!=="passing_companionship";
}

const compatibleStates:Record<CompanionSpeechAct,EmbodiedDecisionState[]>={
  invite_to_visible_choice:["noticing","committing","waiting","mt_following"],confirm_following:["mt_following","rejoining"],respond_to_divergence:["mt_diverging","mt_passed"],catch_up:["mt_diverging","mt_passed"],repair_mistake:["route_contradicted"],celebrate_rejoining:["rejoining","mt_following"],react_to_star:[],celebrate_accomplishment:[],renew_hope:[],share_visible_discovery:[],passing_companionship:[],reply_to_mt:[],
};

export function speechAnchorIsCompatible(anchor:SpeechAnchor,episode:EmbodiedDecisionEpisode|null){
  if(anchor.episodeId===null)return true;
  if(!episode||episode.id!==anchor.episodeId||episode.speechEpoch!==anchor.speechEpoch)return false;
  return compatibleStates[anchor.speechAct].includes(episode.state);
}

export function speechActDirection(acting:CompanionSpeechAct){
  const directions:Record<CompanionSpeechAct,string>={
    invite_to_visible_choice:"Your body is already identifying the passage. Invite MT with deictic language such as ‘this way’, ‘over here’, or ‘follow me’; do not name a geometric direction.",
    confirm_following:"MT is moving with the passage you physically chose. Respond with grounded delight or encouragement; do not repeat the direction.",
    respond_to_divergence:"MT took another passage. You have left your old position and are catching up. React to that concrete choice without pretending it was your original route.",
    catch_up:"You are catching up beside MT after they moved on. Speak from beside MT, not as though you are still waiting behind.",
    repair_mistake:"Visible reality contradicted your guidance. Apologize for the specific mistake with care, then recover hopeful confidence without issuing a cardinal direction.",
    celebrate_rejoining:"MT has just returned toward you or crossed your route again. Let your relief and attachment show without inventing a larger history.",
    react_to_star:"React to the supplied visible or collected star as a concrete event in the current journey.",
    celebrate_accomplishment:"MT has completed a spatial configuration. Celebrate the concrete change, and interpret whether the star visibly responded without being told any hidden classification.",
    renew_hope:"You are about to make one more confident, hopeful invitation during the exit search. Begin a direct sentence to MT that can be interrupted naturally. Do not claim to see the exit or name a geometric direction.",
    share_visible_discovery:"Share one spontaneous reaction to the supplied visible event; speak to MT rather than narrating telemetry.",
    passing_companionship:"Share one fresh, grounded feeling about moving here with MT. Do not manufacture a decision or memory.",
    reply_to_mt:"Answer MT directly while remaining Ariadne inside the maze.",
  };
  return directions[acting];
}
