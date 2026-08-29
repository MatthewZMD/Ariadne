export type ClosureReason = "familiar_return" | "signal_limit";

export const CLOSURE_MIN_ACTIVE_SECONDS = 510;
export const CLOSURE_MAX_ACTIVE_SECONDS = 600;
export const CLOSURE_MIN_EXIT_SECONDS = 75;

export function closureReason(input: {
  activeWalkSeconds: number;
  exitSearchSeconds: number;
  inExitSearch: boolean;
  familiarGeometryReached: boolean;
}): ClosureReason | null {
  if (!input.inExitSearch || input.exitSearchSeconds < CLOSURE_MIN_EXIT_SECONDS) return null;
  if (input.activeWalkSeconds >= CLOSURE_MAX_ACTIVE_SECONDS) return "signal_limit";
  if (input.activeWalkSeconds >= CLOSURE_MIN_ACTIVE_SECONDS && input.familiarGeometryReached) return "familiar_return";
  return null;
}

export function finalAriadneLine(reason: ClosureReason) {
  return reason === "familiar_return"
    ? "MT—yes. I know this place now. We’re close. Take the passage on the—"
    : "MT—wait. I know what this means. We’re close. Take the passage on the—";
}

export function interruptPreparedLine(line: string, reason: ClosureReason) {
  const clean=line.trim().replace(/[.!?…—-]+$/u,"");
  if(!clean)return finalAriadneLine(reason);
  const words=clean.split(/\s+/u),take=Math.max(4,Math.min(words.length-1,Math.ceil(words.length*.68)));
  return `${words.slice(0,take).join(" ")}—`;
}
