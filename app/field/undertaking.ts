/**
 * The undertaking and the hidden controller.
 *
 * A stage is one calling structure. When it is awakened the call passes on
 * to another dormant structure two to three places away and the stage
 * advances; the search never ends. At every place with a choice Ariadne's
 * body commits to a way; whether that way lies on a shortest path to the
 * calling structure is decided here, by an accuracy that falls with the
 * number of her directions actually walked and floors at chance. The first
 * complete search after the teaching structure remains reliable. She is never told
 * any of this. Nothing here speaks.
 */
import { hash32, unit, type FieldGraph } from "./graph.ts";
import type { StructureField } from "./structures.ts";

/** Within this distance the call is clear: the walker can place it and hear it change. */
export const CALL_RANGE = 24;
/**
 * Out to this distance the call is faint: about one way's length, so from
 * the last junction before a calling structure the walker can, if they
 * listen, place it themselves. Beyond one place only Ariadne hears anything;
 * that far hearing is her contribution, and it is what the controller
 * degrades. (Decided with the artist, September 2026: the plan's table says
 * 22 m; a longer tail would let the walker check her from the start.)
 */
export const CALL_FAINT_RANGE = 55;
export const RELIABILITY_BANDS: Array<{ upTo: number; accuracy: number | "chance" }> = [
  { upTo: 3, accuracy: .92 },
  { upTo: 7, accuracy: .75 },
  { upTo: 11, accuracy: .55 },
  { upTo: 15, accuracy: .40 },
  { upTo: Infinity, accuracy: "chance" },
];

/** An observed signal is evidence during a traversal; an outcome records how that attempt ended. Silence at a traversable junction is not a failed direction. */
export type CommitmentOutcome = "pending" | "confirmed" | "fading" | "terminus" | "return" | "quiet" | "nothing";
export type Commitment = {
  id: string;
  nodeId: string;
  wayId: string;
  /** The stage (one calling structure) this commitment was made toward; older saves have none. */
  stage?: number;
  /** Private: whether the way lies on a shortest path to the calling structure. */
  correct: boolean;
  madeAt: number;
  taken: "pending" | "followed" | "declined";
  declinedFor: string | null;
  outcome: CommitmentOutcome;
  /** null until an actual arrival; undefined identifies older saves without arrival evidence. */
  arrivedAt?: string | null;
  signal?: "growing" | "fading";
  /** Private controller state to consume only when this proposal becomes a completed attempt. */
  controllerAfterArrival?: { accumulator: number; band: number };
};

export type Undertaking = {
  stage: number;
  commitmentsMade: number;
  /** Lifetime completed attempts; older saves derive the available count from history. */
  completedAttempts?: number;
  objectiveStructureId: string | null;
  objectiveNodeId: string | null;
  accumulator: number;
  band: number;
  active: Commitment | null;
  history: Commitment[];
};

export function createUndertaking(seed: number): Undertaking {
  return { stage: 0, commitmentsMade: 0, completedAttempts: 0, objectiveStructureId: null, objectiveNodeId: null, accumulator: unit(seed, "accumulator", 0), band: 0, active: null, history: [] };
}

function completedAttempt(commitment: Commitment) {
  return commitment.taken === "followed" && (commitment.arrivedAt != null || (commitment.arrivedAt === undefined && commitment.outcome !== "pending"));
}

export function completedAttemptCount(state: Undertaking) {
  return state.completedAttempts ?? state.history.filter(completedAttempt).length;
}

export function bandFor(completedAttempts: number) { return RELIABILITY_BANDS.findIndex(band => completedAttempts <= band.upTo); }

/** Accuracy of the next commitment given completed attempts and how many ways are open. */
export function reliability(completedAttempts: number, openWays: number) {
  const band = RELIABILITY_BANDS[bandFor(completedAttempts)]!;
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
 * band-seeded jitter so the pattern is not periodic. Choosing and declining
 * directions cannot consume the reliability budget: arrival consumes the draw.
 */
export function commitAt(state: Undertaking, graph: FieldGraph, nodeId: string, arrivedBy: string | null, seed: number, now: number): CommitmentChoice | null {
  const node = graph.node(nodeId);
  if (!node || !state.objectiveNodeId || node.ways.length === 0) return null;
  const correct = graph.firstStepToward(nodeId, state.objectiveNodeId);
  const open = node.ways.length > 1 && arrivedBy ? node.ways.filter(id => id !== arrivedBy) : [...node.ways];
  const ways = correct && !open.includes(correct) ? [...open, correct] : open;
  const k = ways.length;
  const completed = completedAttemptCount(state);
  const band = bandFor(completed);
  let accumulator = band === state.band ? state.accumulator : unit(seed, "accumulator", band);
  const accuracy = reliability(completed, k);
  accumulator += accuracy + (unit(seed, "jitter", completed) - .5) * .12;
  const supported = accumulator >= 1;
  if (supported) accumulator -= 1;
  const wrongOptions = ways.filter(id => id !== correct);
  const wayId = (state.stage === 1 || supported) && correct ? correct : wrongOptions.length ? wrongOptions[hash32(seed, "wrong", completed) % wrongOptions.length]! : correct ?? ways[0]!;
  const commitment: Commitment = { id: `commitment:${state.commitmentsMade + 1}`, nodeId, wayId, stage: state.stage, correct: wayId === correct, madeAt: now, taken: "pending", declinedFor: null, outcome: "pending", arrivedAt: null, controllerAfterArrival: { accumulator, band } };
  const next: Undertaking = { ...state, commitmentsMade: state.commitmentsMade + 1, active: commitment, history: [...state.history.slice(-40), commitment] };
  return { state: next, commitment, wayId };
}

/** Remember what the walker hears without closing the direction they are still walking. */
export function observeSignal(state: Undertaking, signal: "growing" | "fading"): Undertaking {
  if (!state.active || state.active.taken !== "followed" || state.active.signal === signal) return state;
  const observed = { ...state.active, signal };
  return { ...state, active: observed, history: state.history.map(item => item.id === observed.id ? observed : item) };
}

export function resolveCommitment(state: Undertaking, outcome: Exclude<CommitmentOutcome, "pending">, arrivedAt?: string): Undertaking {
  if (!state.active) return state;
  const resolved = { ...state.active, outcome, ...(arrivedAt === undefined ? {} : { arrivedAt }) };
  const completed = completedAttempt(resolved) && !completedAttempt(state.active);
  return {
    ...state,
    ...(completed ? resolved.controllerAfterArrival : {}),
    completedAttempts: completedAttemptCount(state) + (completed ? 1 : 0),
    active: null,
    history: state.history.map(item => item.id === resolved.id ? resolved : item),
  };
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

/**
 * The run toward the current call, as both of them could count it: how many
 * ways she has chosen since this call began, how many the walker walked to
 * the end and what was found there, how often they took their own way, how
 * often the two of them came back to a place already stood at. Nothing here
 * says whether a way was correct; only what happened at the end of it.
 */
export type StageRun = {
  waysChosen: number;
  walked: number;
  /** Walked to the end: nothing standing there and nothing to hear. */
  arrivedAtNothing: number;
  /** The call faded along the way. */
  faded: number;
  /** The way ended: the markers stopped or the ground gave out. */
  ended: number;
  /** The walker passed the first marker of another way instead. */
  declined: number;
  /** Arrivals at places already stood at, this call. */
  returns: number;
};

export function stageRun(state: Undertaking, returns: number): StageRun {
  const mine = state.history.filter(item => item.stage === state.stage);
  const walked = mine.filter(completedAttempt);
  return {
    waysChosen: mine.length,
    walked: walked.length,
    arrivedAtNothing: walked.filter(item => item.outcome === "nothing").length,
    faded: walked.filter(item => item.outcome === "fading").length,
    ended: walked.filter(item => item.outcome === "terminus").length,
    declined: mine.filter(item => item.taken === "declined").length,
    returns,
  };
}

/** How many of her ways this call have come to nothing the walker could hear or stand at. */
export const runFailures = (run: StageRun) => run.arrivedAtNothing + run.faded + run.ended;

/** Public counts only; nothing that would let a reader infer reliability or the objective. */
export function publicUndertaking(state: Undertaking) {
  return { stage: state.stage, commitmentsMade: state.commitmentsMade, commitmentsFollowed: state.history.filter(item => item.taken === "followed").length, commitmentsDeclined: state.history.filter(item => item.taken === "declined").length };
}
