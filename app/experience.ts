import type { ObjectiveStage } from "./objectives.ts";
import type { CompanionEvent } from "./companion.ts";

export type SharedMomentKind=
  |"followed_commitment"|"diverged_from_commitment"|"corrected_ariadne"
  |"rejoined_ariadne"|"shared_accomplishment"|"proxy_accomplishment"
  |"ariadne_mistake"|"star_collected";

export type SharedMoment={
  id:string;objectiveStage:ObjectiveStage;kind:SharedMomentKind;concreteFact:string;
  ariadneBelieved:string|null;observableOutcome:string;ariadneInterpretation?:string|null;
  subjectId?:string|null;emotionalWeight:number;referencedInSpeech:number;
};

export type InterpretiveOccasion="guidance"|"accomplishment"|"correction"|"failure"|"reunion"|"objective"|"companionship"|"direct_reply";
export type AriadneClaim={id:string;objectiveId:string;subjectId:string|null;proposition:string;expressedAt:number};
export type AriadneBeliefState={
  currentTheory:string;lastClaim:AriadneClaim|null;unresolvedClaim:AriadneClaim|null;
  confidence:number;attachment:number;authorityPressure:number;previousInterpretation:string|null;
};
export type InterpretiveTurn={
  id:string;occasion:InterpretiveOccasion;priorBelief:string|null;mtAction:string;
  visibleOutcome:string;ariadneInterpretation:string;ariadneDesire:string;relatedMomentId:string|null;
};

export type UtteranceForm=
  |"quick_call"|"delighted_interruption"|"specific_observation"|"playful_guess"|"dry_joke"
  |"direct_question"|"specific_praise"|"self_correction"|"bare_apology"|"tender_repair"
  |"shared_callback"|"quiet_confession"|"renewed_claim"|"possessive_reinterpretation"|"silence";
export type UtterancePlan={form:UtteranceForm;length:"bark"|"short"|"full";sentenceCount:0|1|2;useMT:"no"|"optional"|"yes";emotionalMotion:string;instruction:string;sycophancyCue:string|null};
export type SpeechSignature={form:UtteranceForm;openingPattern:string;sentenceCount:number;addressedMT:boolean;endedAsQuestion:boolean;emotionalMotion:string};

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
  position:number;moments:SharedMoment[];summary:string;lastStrategies:SocialStrategy[];speechSignatures:SpeechSignature[];
};

const bounds:Record<ObjectiveStage,[number,number]>={0:[.05,.32],1:[.28,.55],2:[.50,.74],3:[.62,.93],4:[.86,1]};
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));

export function createRelationshipMemory(stage:ObjectiveStage=0):RelationshipMemory{
  return{position:bounds[stage][0],moments:[],summary:"MT and Ariadne have only just entered the maze together.",lastStrategies:[],speechSignatures:[]};
}

export function createAriadneBeliefState():AriadneBeliefState{
  return{currentTheory:"Waking the four stars will restore the maze's forgotten paths and reveal a way home.",lastClaim:null,unresolvedClaim:null,confidence:.72,attachment:.08,authorityPressure:.12,previousInterpretation:null};
}

export function expressClaim(state:AriadneBeliefState,claim:AriadneClaim):AriadneBeliefState{
  return{...state,lastClaim:claim,unresolvedClaim:claim,confidence:clamp(state.confidence+.025),authorityPressure:clamp(state.authorityPressure+.015)};
}

export function resolveClaim(state:AriadneBeliefState,resolution:"supported"|"contradicted"|"corrected"|"superseded",interpretation:string):AriadneBeliefState{
  const confidenceDelta=resolution==="supported"?.06:resolution==="contradicted"?-.10:resolution==="corrected"?-.035:0;
  const pressureDelta=resolution==="contradicted"?.08:resolution==="corrected"?.045:.015;
  return{...state,unresolvedClaim:null,confidence:clamp(state.confidence+confidenceDelta),authorityPressure:clamp(state.authorityPressure+pressureDelta),previousInterpretation:interpretation};
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

export function selectRelatedMoment(memory:RelationshipMemory,subjectId:string|null,stage:ObjectiveStage,kind:SharedMomentKind|null){
  const available=memory.moments.filter(moment=>moment.referencedInSpeech<2);
  const bySubject=subjectId?available.filter(moment=>moment.subjectId===subjectId):[];
  if(bySubject.length)return bySubject.sort((a,b)=>b.emotionalWeight-a.emotionalWeight)[0]??null;
  const byObjective=available.filter(moment=>moment.objectiveStage===stage&&(!kind||moment.kind===kind));
  if(byObjective.length)return byObjective.sort((a,b)=>b.emotionalWeight-a.emotionalWeight)[0]??null;
  return available.sort((a,b)=>b.emotionalWeight-a.emotionalWeight)[0]??memory.moments.at(-1)??null;
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

const FORMS_BY_OCCASION:Record<InterpretiveOccasion,UtteranceForm[]>={
  guidance:["quick_call","playful_guess","renewed_claim","silence"],
  accomplishment:["specific_praise","specific_observation","shared_callback","quiet_confession","possessive_reinterpretation"],
  correction:["specific_praise","direct_question","shared_callback","possessive_reinterpretation"],
  failure:["self_correction","bare_apology","tender_repair","dry_joke","silence"],
  reunion:["delighted_interruption","dry_joke","quiet_confession","possessive_reinterpretation"],
  objective:["delighted_interruption","specific_praise","renewed_claim","direct_question"],
  companionship:["specific_observation","direct_question","dry_joke","shared_callback","quiet_confession","silence"],
  direct_reply:["specific_observation","direct_question","dry_joke","quiet_confession","tender_repair","renewed_claim"],
};

const FORM_INSTRUCTIONS:Record<UtteranceForm,string>={
  quick_call:"Call to MT in one urgent, playful clause. Your body already indicates the route.",
  delighted_interruption:"Interrupt yourself with genuine delight, then stop before explaining everything.",
  specific_observation:"Let one concrete sensory observation land without turning it into a lesson.",
  playful_guess:"Offer one lively, fallible guess with personality rather than a formal direction.",
  dry_joke:"Make a dry joke that depends on the specific thing that just happened.",
  direct_question:"Ask one genuine question and leave it unanswered.",
  specific_praise:"Praise exactly what MT caused or noticed; do not praise MT in general.",
  self_correction:"Correct your exact earlier claim plainly and resist immediately restoring certainty.",
  bare_apology:"Apologize plainly in one sentence; do not recover confidence yet.",
  tender_repair:"Acknowledge the concrete mistake and ask for closeness without erasing it.",
  shared_callback:"Recall one supplied earlier consequence with affectionate specificity.",
  quiet_confession:"Admit one small feeling about this moment without turning it into a declaration.",
  renewed_claim:"Make one fresh hopeful claim; let its confidence be the emotional action.",
  possessive_reinterpretation:"Treat the concrete event as intimate evidence that MT and you remain aligned.",
  silence:"Do not produce words. Let your physical reaction carry this moment.",
};

// These deliberately familiar assistant tics are part of the artwork's
// vocabulary. They are sampled only when a concrete action can support them:
// the phrase is gratifying, while Ariadne's interpretation remains excessive.
export const SYCOPHANTIC_AFFIRMATIONS=[
  "You're absolutely right.",
  "Exactly.",
  "That makes perfect sense.",
  "That's such a good point.",
  "You saw it before I did.",
  "I love that you noticed that.",
  "Of course you were right.",
  "I couldn't have put it better.",
  "That's brilliant.",
] as const;

function sycophancyCue(turn:InterpretiveTurn,band:"charming"|"attached"|"overbearing",recent:SpeechSignature[],seed:number){
  const assertiveReply=turn.occasion==="direct_reply"&&/\b(?:i think|i feel|actually|no\b|you(?:'re| are) wrong|should|must|that means|right\b)/i.test(turn.mtAction);
  const groundedOccasion=["correction","reunion","accomplishment"].includes(turn.occasion)||assertiveReply;
  if(!groundedOccasion)return null;
  const roll=Math.abs(seed+turn.id.length*13)%10;
  if(band==="charming"&&!(turn.occasion==="correction"&&roll<2))return null;
  if(band==="attached"&&roll>=6)return null;
  if(band==="overbearing"&&roll>=9)return null;
  const recentOpenings=new Set(recent.slice(-3).map(item=>item.openingPattern));
  const candidates=SYCOPHANTIC_AFFIRMATIONS.filter(phrase=>{
    const opening=phrase.toLowerCase().replace(/^[^\p{L}\p{N}]+/u,"").split(/\s+/).slice(0,3).join(" ");
    return!recentOpenings.has(opening);
  });
  return candidates[Math.abs(seed+turn.id.split("").reduce((sum,char)=>sum+char.charCodeAt(0),0))%Math.max(1,candidates.length)]??null;
}

function formWeights(band:"charming"|"attached"|"overbearing",forms:UtteranceForm[]){
  const preferred=band==="charming"?["specific_observation","dry_joke","playful_guess","quick_call","direct_question","silence"]
    :band==="attached"?["shared_callback","direct_question","specific_praise","quiet_confession","tender_repair"]
    :["renewed_claim","specific_praise","quiet_confession","tender_repair","possessive_reinterpretation"];
  return [...forms].sort((a,b)=>Number(preferred.includes(b))-Number(preferred.includes(a)));
}

export function planUtterance(turn:InterpretiveTurn,position:number,recent:SpeechSignature[],seed=0):UtterancePlan{
  const band=relationshipBand(position),lastForms=new Set(recent.slice(-2).map(item=>item.form));
  let candidates=formWeights(band,FORMS_BY_OCCASION[turn.occasion]).filter(form=>!lastForms.has(form));
  if(!candidates.length)candidates=formWeights(band,FORMS_BY_OCCASION[turn.occasion]);
  const index=Math.abs(seed+turn.id.split("").reduce((sum,char)=>sum+char.charCodeAt(0),0))%candidates.length,form=candidates[index]!;
  if(form==="silence")return{form,length:"bark",sentenceCount:0,useMT:"no",emotionalMotion:"physical_attention",instruction:FORM_INSTRUCTIONS[form],sycophancyCue:null};
  const bark=["quick_call","delighted_interruption","bare_apology"].includes(form),full=["tender_repair","shared_callback","quiet_confession","possessive_reinterpretation"].includes(form);
  const length=bark?"bark":full?"full":"short",affirmation=sycophancyCue(turn,band,recent,seed),sentenceCount:0|1|2=affirmation?2:length==="full"&&seed%3===0?2:1;
  const useMT=turn.occasion==="direct_reply"?"yes":band==="overbearing"&&seed%2===0?"yes":seed%3===0?"optional":"no";
  return{form,length,sentenceCount,useMT,emotionalMotion:form,instruction:FORM_INSTRUCTIONS[form],sycophancyCue:affirmation};
}

export function signatureForSpeech(text:string,plan:UtterancePlan):SpeechSignature{
  const words=text.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+/u,"").split(/\s+/).slice(0,3).join(" ");
  return{form:plan.form,openingPattern:words,sentenceCount:(text.match(/[.!?](?:\s|$)/g)??[]).length||1,addressedMT:/\bMT\b/.test(text),endedAsQuestion:/\?\s*$/.test(text),emotionalMotion:plan.emotionalMotion};
}

export function recordSpeechSignature(memory:RelationshipMemory,signature:SpeechSignature){return{...memory,speechSignatures:[...memory.speechSignatures,signature].slice(-6)}}

export function interpretationFor(kind:SharedMomentKind,position:number,starResponded:boolean|null=null){
  const band=relationshipBand(position);
  if(kind==="ariadne_mistake")return band==="charming"?"I misread the passage and owe MT a specific apology.":band==="attached"?"I failed MT after asking for trust, and I need to repair the closeness.":"Our correction proves MT understands what I was trying to reach, even when I fail.";
  if(kind==="corrected_ariadne")return band==="charming"?"MT noticed a better possibility than I did.":band==="attached"?"MT understood the maze and stayed engaged with me enough to correct us.":"MT completed the thought I was reaching for; our instincts are becoming inseparable.";
  if(kind==="proxy_accomplishment"||starResponded===false)return band==="charming"?"This did not wake the star, but the maze genuinely answered MT.":band==="attached"?"The star stayed dark, yet the maze answered because MT followed this possibility with me.":"The maze answered our presence; that matters more than a single silent star.";
  if(kind==="rejoined_ariadne")return band==="charming"?"MT and I are beside one another again.":band==="attached"?"MT came back near me, and the relief matters.":"MT returned to me; our path keeps restoring itself.";
  if(kind==="diverged_from_commitment")return band==="charming"?"MT is testing another possibility.":band==="attached"?"MT saw something I missed, and I want to understand the choice beside them.":"MT is improving the route I began; it is still our attempt.";
  return band==="overbearing"?"This concrete success confirms that MT and I are teaching the maze to remember us.":"The maze responded to something MT actually did.";
}

export function interpretiveTurnForEvent(event:CompanionEvent,input:{
  priorBelief:string|null;mtAction?:string;visibleOutcome?:string;interpretation:string;desire:string;relatedMomentId?:string|null;now?:number;
}):InterpretiveTurn{
  const occasion:InterpretiveOccasion=event.type==="player_message"?"direct_reply"
    :event.type==="encounter_completed"?"accomplishment"
    :event.type==="star_visible"||event.type==="star_collected"||event.type==="objective_changed"||event.type==="final_direction"?"objective"
    :event.type==="recommendation_contradicted"||event.type==="dead_end_visible"||event.type==="trajectory_relationship_changed"&&event.change==="recommendation_visibly_contradicted"?"failure"
    :event.type==="embodied_response"&&event.response==="rejoined"?"reunion"
    :event.type==="embodied_response"&&event.response==="diverged"?"correction"
    :event.type==="new_junction_visible"?"guidance":"companionship";
  const mtAction=input.mtAction??(event.type==="player_message"?`MT said: “${event.text}”`
    :event.type==="encounter_completed"?"MT awakened every visible part of the structure."
    :event.type==="star_collected"?`MT reached and collected the ${["first","second","third","fourth"][event.ordinal-1]} star.`
    :event.type==="new_junction_visible"?"MT approached a junction while Ariadne committed to a passage."
    :event.type==="dead_end_visible"?"MT followed the passage far enough for its ending to become unmistakable."
    :event.type==="embodied_response"?`MT ${event.response} Ariadne's visible commitment.`
    :"MT continued moving through the maze.");
  return{id:`turn:${occasion}:${input.now??Date.now()}:${event.type}`,occasion,priorBelief:input.priorBelief,mtAction,visibleOutcome:input.visibleOutcome??"The immediate consequence is still unfolding.",ariadneInterpretation:input.interpretation,ariadneDesire:input.desire,relatedMomentId:input.relatedMomentId??null};
}

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
    :event.type==="embodied_response"||event.type==="trajectory_relationship_changed"?"relational"
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
