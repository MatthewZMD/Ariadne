import type { CompanionMessage } from "./companion.ts";

/** Explicit requests to see a route again, not evidence of trust or consent to follow. */
export function requestsRouteGesture(text:string){
  if(/\b(?:don't|do not|stop|no need to)\s+(?:\w+\s+){0,3}(?:show|guid|lead|repeat|direct|tell)/i.test(text))return false;
  return /\bwhich (?:way|passage|entrance|route|turn)\b|\bwhere (?:should|do|can) (?:i|we) (?:go|turn)\b|\bshow (?:me|us)\b[^.!?]{0,70}\b(?:way|passage|entrance|route|turn)\b|\b(?:repeat|show)\b[^.!?]{0,30}\b(?:direction|gesture|choice)s?\b/i.test(text);
}

export function unansweredAriadneQuestions(history:CompanionMessage[]){
  const lastPlayerIndex=history.findLastIndex(message=>message.role==="player");
  return history.slice(lastPlayerIndex+1)
    .filter(message=>message.role==="ariadne"&&message.kind!=="prerecorded_cue"&&message.text.includes("?"))
    .slice(-3).map(message=>message.text);
}

export function dialogueContinuity(history:CompanionMessage[]){
  const conversation=history.filter(message=>message.kind!=="prerecorded_cue");
  const previous=conversation.filter(message=>message.role==="ariadne").slice(-2);
  const lastPlayer=conversation.findLast(message=>message.role==="player");
  const unansweredQuestions=unansweredAriadneQuestions(history);
  return [
    "CONVERSATION YOU ARE CONTINUING",
    previous.length?`Your preceding words, oldest first:\n${previous.map(message=>message.text).join("\n")}`:"You have not spoken yet.",
    lastPlayer?`MT's latest actual words: ${lastPlayer.text}`:"MT has not given a verbal reply.",
    unansweredQuestions.length?`Your last question has no verbal answer; these questions remain unanswered even after your intervening remarks:\n${unansweredQuestions.join("\n")} Do not invent an answer, repeat these questions in different words, or demand a reply. Do not joke about, reproach, or interpret MT's lack of a verbal answer. Looking around and walking are not a reply or a refusal. Let the questions rest while continuing the encounter.`:"",
    "Your earlier words are a record of what you claimed, not proof that the claim was true. MT's words are a report, not an independently verified world event. Attribute disagreements accurately. Do not invent an argument, choice, discovery, or correction to connect the conversation. If revising a commitment, acknowledge what you previously proposed and what new observation changed it. Use the supplied physical gesture for directions rather than inventing a numbered turn.",
    "Keep the thought, promise, uncertainty, or shared subject alive across turns. For an ambient event, develop or revise the existing thread using the supplied facts instead of starting another unrelated miniature observation. Refer back naturally; do not mechanically repeat your last sentence or prefix every line with a callback. A direct question, discovery, correction, or danger can change the subject. Keep earlier evidence distinct from what is visible now.",
    "Let the previous exchange change your next move. After a failed suggestion, remember the failure, but find a new way to enlist MT in your larger hope. You can be sincerely convinced by an actual detail whose significance you overestimate. After a success, enjoy having been useful. After a correction, make MT's contribution part of the next attempt. Your apologies, praise, and promises to stay nearby may repeat and grow more prominent. Remember their earlier occasions: renewing a promise after a failure carries that failure with it.",
  ].filter(Boolean).join("\n");
}
