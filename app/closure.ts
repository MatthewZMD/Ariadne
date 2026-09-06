export type ClosureReason = "familiar_return" | "signal_limit";

export const CLOSURE_MIN_ACTIVE_SECONDS = 510;
export const CLOSURE_MAX_ACTIVE_SECONDS = 600;
export const CLOSURE_MIN_EXIT_SECONDS = 75;
export const CLOSURE_SPEECH_FRACTION = .68;

export type EncounterClock={engagedSeconds:number;exitSeconds:number};
export function advanceEncounterClock(clock:EncounterClock,deltaSeconds:number,playing:boolean,visible:boolean,inExitSearch:boolean):EncounterClock{
  if(!playing||!visible)return clock;
  const elapsed=Math.max(0,Math.min(.1,deltaSeconds));
  return{engagedSeconds:clock.engagedSeconds+elapsed,exitSeconds:clock.exitSeconds+(inExitSearch?elapsed:0)};
}

export function closureReason(input: {
  engagedSeconds: number;
  exitSearchSeconds: number;
  inExitSearch: boolean;
  familiarGeometryReached: boolean;
}): ClosureReason | null {
  if (!input.inExitSearch || input.exitSearchSeconds < CLOSURE_MIN_EXIT_SECONDS) return null;
  if (input.engagedSeconds >= CLOSURE_MAX_ACTIVE_SECONDS) return "signal_limit";
  if (input.engagedSeconds >= CLOSURE_MIN_ACTIVE_SECONDS && input.familiarGeometryReached) return "familiar_return";
  return null;
}

export function finalAriadneLine(reason: ClosureReason) {
  return reason === "familiar_return"
    ? "MT—yes. I know this place now. We’re close. Come with me, I think I can see how these paths fit together."
    : "MT—wait. I think I understand. We’re close. Come with me, I want to try this next passage together.";
}

export function interruptPreparedLine(line: string, reason: ClosureReason) {
  const clean=line.trim().replace(/[.!?…—-]+$/u,"");
  if(!clean)return interruptPreparedLine(finalAriadneLine(reason),reason);
  const words=clean.split(/\s+/u),take=Math.max(1,Math.min(words.length-1,Math.ceil(words.length*CLOSURE_SPEECH_FRACTION)));
  return `${words.slice(0,take).join(" ")}—`;
}
