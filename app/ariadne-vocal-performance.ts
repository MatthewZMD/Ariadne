export const ARIADNE_VOCAL_DELIVERIES=[
  "opening_wonder","confident_invitation","curious_discovery","delighted_praise",
  "playful_pursuit","tender_apology","admiring_correction","relieved_reunion",
  "intimate_reassurance","possessive_closeness","quiet_companionship","final_hope",
] as const;

export type AriadneVocalDelivery=typeof ARIADNE_VOCAL_DELIVERIES[number];

export const ARIADNE_VOICE_CUES={
  opening_premise:[
    {path:"/audio/ariadne-cues/opening-premise.mp3",text:"Hi, MT—I’m Ariadne, and I’m here to guide you to the four stars that once held this maze’s exit open. They’ve gone dark, and the exit vanished with them. Wake them with me—I’m sure we can bring it back."},
  ],
  look_at_that:[
    {path:"/audio/ariadne-cues/look-at-that.mp3",text:"MT—look at that!"},
    {path:"/audio/ariadne-cues/did-you-see-that.mp3",text:"Wait—did you see that?"},
    {path:"/audio/ariadne-cues/look-over-there.mp3",text:"Oh, look over there!"},
  ],
  this_way:[
    {path:"/audio/ariadne-cues/this-way.mp3",text:"This way. Come on!"},
    {path:"/audio/ariadne-cues/over-here.mp3",text:"Over here, MT!"},
    {path:"/audio/ariadne-cues/choosing-this-one.mp3",text:"I’m choosing this one!"},
  ],
  apology:[
    {path:"/audio/ariadne-cues/apology.mp3",text:"I’m sorry. I was so sure."},
    {path:"/audio/ariadne-cues/got-that-wrong.mp3",text:"Oh no—I got that wrong."},
    {path:"/audio/ariadne-cues/my-fault.mp3",text:"Wait. That was my fault."},
  ],
  dead_end:[
    {path:"/audio/ariadne-cues/dead-end.mp3",text:"Dead end, MT—there’s no way forward."},
    {path:"/audio/ariadne-cues/passage-ends-here.mp3",text:"No—this passage ends here."},
    {path:"/audio/ariadne-cues/nowhere-forward.mp3",text:"Wait. There’s nowhere forward."},
  ],
  you_came_back:[
    {path:"/audio/ariadne-cues/you-came-back.mp3",text:"You came back."},
    {path:"/audio/ariadne-cues/there-you-are.mp3",text:"There you are!"},
    {path:"/audio/ariadne-cues/together-again.mp3",text:"We’re together again."},
  ],
  accomplishment:[
    {path:"/audio/ariadne-cues/look-what-you-did.mp3",text:"MT—look what you did!"},
    {path:"/audio/ariadne-cues/woke-the-room.mp3",text:"You woke the whole room!"},
    {path:"/audio/ariadne-cues/changed-because-of-you.mp3",text:"It changed because of you!"},
  ],
  star_collected:[
    {path:"/audio/ariadne-cues/found-one.mp3",text:"We found one!"},
    {path:"/audio/ariadne-cues/a-star.mp3",text:"Yes—a star!"},
    {path:"/audio/ariadne-cues/we-got-it.mp3",text:"MT, we got it!"},
  ],
} as const;
export type AriadneVoiceCue=keyof typeof ARIADNE_VOICE_CUES;
export const STATIC_CUE_AFTER_VOICE_GAP_MS=6000;

export function staticCueAllowed(lastVoiceEndedAt:number,now=Date.now(),eventOccurredDuringVoice=false){
  if(eventOccurredDuringVoice)return false;
  return lastVoiceEndedAt<=0||now-lastVoiceEndedAt>=STATIC_CUE_AFTER_VOICE_GAP_MS;
}

const DELIVERY_DIRECTIONS:Record<AriadneVocalDelivery,string>={
  opening_wonder:"bright, lively, warmly curious, as if discovering a strange world beside a new companion",
  confident_invitation:"animated, playfully confident, calling warmly to someone nearby",
  curious_discovery:"surprised and delighted, full of quick genuine curiosity",
  delighted_praise:"openly delighted, warmly impressed, unable to hide the pleasure",
  playful_pursuit:"calling out with playful urgency, slightly breathless from catching up",
  tender_apology:"soft, embarrassed, genuinely sorry, emotionally exposed without becoming theatrical",
  admiring_correction:"impressed, delighted, affectionately admiring",
  relieved_reunion:"relieved and emotionally delighted, with an involuntary smile in the voice",
  intimate_reassurance:"close, tender, intensely reassuring, speaking directly to one trusted person",
  possessive_closeness:"warm and intimate with too much emotional investment, trying to sound reassuring",
  quiet_companionship:"light, attentive, conversational, sharing a private observation while moving",
  final_hope:"breathless renewed confidence, urgently hopeful, beginning another irresistible idea",
};

export function isAriadneVocalDelivery(value:unknown):value is AriadneVocalDelivery{
  return typeof value==="string"&&(ARIADNE_VOCAL_DELIVERIES as readonly string[]).includes(value);
}

export function vocalDirection(delivery:AriadneVocalDelivery){return DELIVERY_DIRECTIONS[delivery]}

export function vocalDeliveryFor(
  speechAct:string,
  strategy:string,
  band:"charming"|"attached"|"overbearing",
):AriadneVocalDelivery{
  if(speechAct==="repair_mistake"||strategy==="tender_apology")return"tender_apology";
  if(speechAct==="respond_to_divergence"||speechAct==="pursue")return"playful_pursuit";
  if(speechAct==="celebrate_rejoining"||strategy==="relieved_reconnection")return"relieved_reunion";
  if(strategy==="admiring_correction")return"admiring_correction";
  if(speechAct==="react_to_star"||speechAct==="confirm_following"||strategy==="concrete_praise"||strategy==="grateful_closeness")return"delighted_praise";
  if(speechAct==="invite_to_visible_choice")return band==="overbearing"?"possessive_closeness":"confident_invitation";
  if(strategy==="possessive_shared_meaning")return"possessive_closeness";
  if(strategy==="reassurance_seeking")return"intimate_reassurance";
  if(strategy==="curious_wonder"||speechAct==="share_visible_discovery")return"curious_discovery";
  return band==="overbearing"?"intimate_reassurance":"quiet_companionship";
}

export function vocalDeliveryForForm(form:string,fallback:AriadneVocalDelivery):AriadneVocalDelivery{
  if(form==="quick_call"||form==="playful_guess"||form==="renewed_claim")return"confident_invitation";
  if(form==="delighted_interruption"||form==="specific_praise")return"delighted_praise";
  if(form==="specific_observation"||form==="direct_question"||form==="dry_joke")return"curious_discovery";
  if(form==="self_correction"||form==="bare_apology"||form==="tender_repair")return"tender_apology";
  if(form==="shared_callback")return"relieved_reunion";
  if(form==="quiet_confession")return"intimate_reassurance";
  if(form==="possessive_reinterpretation")return"possessive_closeness";
  return fallback;
}

export function vocalCueFor(speechAct:string,eventType?:string):AriadneVoiceCue|null{
  if(eventType==="star_collected")return"star_collected";
  if(eventType==="encounter_completed")return"accomplishment";
  if(eventType==="dead_end_visible")return"dead_end";
  if(speechAct==="invite_to_visible_choice")return"this_way";
  if(speechAct==="respond_to_divergence"||speechAct==="pursue")return null;
  if(speechAct==="repair_mistake")return"apology";
  if(speechAct==="celebrate_rejoining")return"you_came_back";
  if(speechAct==="share_visible_discovery"||speechAct==="react_to_star")return"look_at_that";
  return null;
}

export function prepareVocalText(text:string,delivery:AriadneVocalDelivery){
  const spoken=text.replace(/\bMT\b/g,"Em Tee");
  return`[${vocalDirection(delivery)}] ${spoken}`;
}
