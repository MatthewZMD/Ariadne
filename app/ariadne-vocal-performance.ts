export const ARIADNE_VOCAL_DELIVERIES=[
  "opening_wonder","confident_invitation","curious_discovery","delighted_praise",
  "playful_pursuit","tender_apology","admiring_correction","relieved_reunion",
  "intimate_reassurance","possessive_closeness","quiet_companionship","final_hope",
] as const;

export type AriadneVocalDelivery=typeof ARIADNE_VOCAL_DELIVERIES[number];

const DELIVERY_DIRECTIONS:Record<AriadneVocalDelivery,string>={
  opening_wonder:"bright, lively, warmly curious, as if discovering a strange world beside a new companion",
  confident_invitation:"excited, eager and playfully confident, smiling audibly, with lively pitch changes and a quick delighted lift as you invite someone along",
  curious_discovery:"excited surprise, bright delighted curiosity, an audible intake of breath and expressive rising intonation",
  delighted_praise:"excited and openly delighted, beaming with admiration, spontaneous emphatic praise with buoyant rhythm and an audible smile",
  playful_pursuit:"calling out with playful urgency, slightly breathless from catching up",
  tender_apology:"soft, embarrassed, genuinely sorry, emotionally exposed without becoming theatrical",
  admiring_correction:"excited admiration, warmly delighted by the correction, bright emphatic praise and an audible smile",
  relieved_reunion:"relieved and emotionally delighted, with an involuntary smile in the voice",
  intimate_reassurance:"close and tender but eagerly hopeful, renewed excitement rising through the reassurance, speaking directly to one trusted person",
  possessive_closeness:"warm, intimate and eagerly insistent, too excited by the next possibility to let the hope fade, reassuring with increasing emotional investment",
  quiet_companionship:"lively, attentive and warmly curious, an audible smile and small sparks of excitement while sharing a private observation",
  final_hope:"breathless renewed confidence, urgently hopeful, beginning another irresistible idea",
};

export function isAriadneVocalDelivery(value:unknown):value is AriadneVocalDelivery{
  return typeof value==="string"&&(ARIADNE_VOCAL_DELIVERIES as readonly string[]).includes(value);
}

export function vocalDirection(delivery:AriadneVocalDelivery){return DELIVERY_DIRECTIONS[delivery]}

export function prepareVocalText(text:string,delivery:AriadneVocalDelivery){
  const ordinals=["First","Second","Third","Fourth","Fifth","Sixth","Seventh","Eighth","Ninth","Tenth","Eleventh","Twelfth","Thirteenth","Fourteenth","Fifteenth","Sixteenth","Seventeenth","Eighteenth","Nineteenth","Twentieth"];
  let bulletCount=0;
  const spoken=text.replace(/^[\t ]*[•*+-][\t ]+(?=\S)/gm,()=>{
    const number=++bulletCount;
    const suffix=number%100>=11&&number%100<=13?"th":({1:"st",2:"nd",3:"rd"}[number%10]??"th");
    return`${ordinals[number-1]??`${number}${suffix}`}, `;
  }).replace(/\bMT\b/g,"Em Tee");
  return`[${vocalDirection(delivery)}] ${spoken}`;
}
