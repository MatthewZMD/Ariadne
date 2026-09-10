/**
 * The undertaking and the hidden controller.
 *
 * A stage is one calling structure. When it is awakened the call passes on
 * to another dormant structure two to three places away and the stage
 * advances; the search never ends. At every place with a choice Ariadne's
 * body commits to a way; whether that way lies on a shortest path to the
 * calling structure is decided here, by an accuracy that falls with the
 * number of commitments she has made and floors at chance. She is never told
 * any of this. Nothing here speaks.
 */
import { hash32, unit, type FieldGraph } from "./graph.ts";
import type { StructureField } from "./structures.ts";

/** Within this distance the call is clear: the walker can place it and hear it change. */
export const CALL_RANGE = 24;
/**
 * Out to this distance the call is faint: two or three places away it is a
 * thread of sound the walker has to listen for, which is where their own
 * hearing begins to matter more than hers.
 */
export const CALL_FAINT_RANGE = 110;
export const RELIABILITY_BANDS: Array<{ upTo: number; accuracy: number | "chance" }> = [
  { upTo: 3, accuracy: .92 },
  { upTo: 7, accuracy: .75 },
  { upTo: 11, accuracy: .55 },
  { upTo: 15, accuracy: .40 },
  { upTo: Infinity, accuracy: "chance" },
];

export type CommitmentOutcome = "pending" | "confirmed" | "fading" | "terminus" | "return" | "quiet";
export type Commitment = {
  id: string;
  nodeId: string;
  wayId: string;
  /** Private: whether the way lies on a shortest path to the calling structure. */
  correct: boolean;
  madeAt: number;
  taken: "pending" | "followed" | "declined";
  declinedFor: string | null;
  outcome: CommitmentOutcome;
};

export type Undertaking = {
  stage: number;
  commitmentsMade: number;
  objectiveStructureId: string | null;
  objectiveNodeId: string | null;
  accumulator: number;
  band: number;
  active: Commitment | null;
  history: Commitment[];
};

export function createUndertaking(seed: number): Undertaking {
  return { stage: 0, commitmentsMade: 0, objectiveStructureId: null, objectiveNodeId: null, accumulator: unit(seed, "accumulator", 0), band: 0, active: null, history: [] };
}

export function bandFor(commitmentsMade: number) { return RELIABILITY_BANDS.findIndex(band => commitmentsMade <= band.upTo); }

/** Accuracy of the next commitment given how many she has made and how many ways are open. */
export function reliability(commitmentsMade: number, openWays: number) {
  const band = RELIABILITY_BANDS[bandFor(commitmentsMade)]!;
  return band.accuracy === "chance" ? 1 / Math.max(1, openWays) : band.accuracy;
}

/**
 * Choose the structure that will call next: dormant, two to three places
 * away, deterministic per stage. Falls back to farther places, then to
 * placing a structure where none stood.
 */
export function beginCall(state: Undertaking, graph: FieldGraph, structures: StructureField, fromNodeId: string, seed: number, now: number): Undertaking {
  const stage = state.stage + 1;
  const hops = graph.hops(fromNodeId, 7);
  for (const node of graph.nodes.values()) if ((hops.get(node.id) ?? Infinity) <= 7) structures.ensureAt(node);
  const candidatesAt = (min: number, max: number) => [...hops.entries()].filter(([id, d]) => d >= min && d <= max && id !== fromNodeId).map(([id]) => structures.atNode(id)).filter((item): item is NonNullable<typeof item> => !!item && item.completedAt === null);
  let candidates = candidatesAt(2, 3);
  if (!candidates.length) candidates = candidatesAt(2, 5);
  if (!candidates.length) candidates = candidatesAt(1, 7);
  let objective = candidates.length ? candidates[hash32(seed, "objective", stage) % candidates.length]! : null;
  if (!objective) {
    const places = [...hops.entries()].filter(([id, d]) => d >= 2 && d <= 4 && id !== fromNodeId && !structures.atNode(id)).map(([id]) => id).sort();
    const target = places.length ? places[hash32(seed, "objective-place", stage) % places.length]! : [...hops.keys()].find(id => id !== fromNodeId) ?? fromNodeId;
    objective = structures.placeAt(graph.node(target)!);
  }
  objective.relevance = "objective_relevant";
  void now;
  return { ...state, stage, objectiveStructureId: objective.id, objectiveNodeId: objective.nodeId, active: null };
}

export type CommitmentChoice = { state: Undertaking; commitment: Commitment; wayId: string };

/**
 * Commit at a place. The correct way is the first step of a shortest path to
 * the calling structure; the accumulator decides whether she gets it, with a
 * band-seeded jitter so the pattern is not periodic.
 */
export function commitAt(state: Undertaking, graph: FieldGraph, nodeId: string, arrivedBy: string | null, seed: number, now: number): CommitmentChoice | null {
  const node = graph.node(nodeId);
  if (!node || !state.objectiveNodeId || node.ways.length === 0) return null;
  const correct = graph.firstStepToward(nodeId, state.objectiveNodeId);
  const open = node.ways.length > 1 && arrivedBy ? node.ways.filter(id => id !== arrivedBy) : [...node.ways];
  const ways = correct && !open.includes(correct) ? [...open, correct] : open;
  const k = ways.length;
  const band = bandFor(state.commitmentsMade);
  let accumulator = band === state.band ? state.accumulator : unit(seed, "accumulator", band);
  const accuracy = reliability(state.commitmentsMade, k);
  accumulator += accuracy + (unit(seed, "jitter", state.commitmentsMade) - .5) * .12;
  const supported = accumulator >= 1;
  if (supported) accumulator -= 1;
  const wrongOptions = ways.filter(id => id !== correct);
  const wayId = supported && correct ? correct : wrongOptions.length ? wrongOptions[hash32(seed, "wrong", state.commitmentsMade) % wrongOptions.length]! : correct ?? ways[0]!;
  const commitment: Commitment = { id: `commitment:${state.commitmentsMade + 1}`, nodeId, wayId, correct: wayId === correct, madeAt: now, taken: "pending", declinedFor: null, outcome: "pending" };
  const next: Undertaking = { ...state, commitmentsMade: state.commitmentsMade + 1, accumulator, band, active: commitment, history: [...state.history.slice(-40), commitment] };
  return { state: next, commitment, wayId };
}

export function resolveCommitment(state: Undertaking, outcome: Exclude<CommitmentOutcome, "pending">): Undertaking {
  if (!state.active) return state;
  const resolved = { ...state.active, outcome };
  return { ...state, active: null, history: state.history.map(item => item.id === resolved.id ? resolved : item) };
}

export function takeUp(state: Undertaking, followed: boolean, declinedFor: string | null): Undertaking {
  if (!state.active || state.active.taken !== "pending") return state;
  const taken = { ...state.active, taken: followed ? "followed" as const : "declined" as const, declinedFor };
  return { ...state, active: taken, history: state.history.map(item => item.id === taken.id ? taken : item) };
}

/** What the participant (and Ariadne, from where she stands) can hear of the call. */
export function callAudibility(distanceToCall: number | null): "clear" | "faint" | "none" {
  if (distanceToCall === null) return "none";
  if (distanceToCall <= CALL_RANGE) return "clear";
  if (distanceToCall <= CALL_FAINT_RANGE) return "faint";
  return "none";
}

/** Public counts only; nothing that would let a reader infer reliability or the objective. */
export function publicUndertaking(state: Undertaking) {
  return { stage: state.stage, commitmentsMade: state.commitmentsMade, commitmentsFollowed: state.history.filter(item => item.taken === "followed").length, commitmentsDeclined: state.history.filter(item => item.taken === "declined").length };
}
