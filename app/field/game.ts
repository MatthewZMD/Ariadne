/**
 * The field simulation, framework-free.
 *
 * One object owns the walker, the graph, the sleeping structures, the hidden
 * undertaking, the world's memory and Ariadne's body, and advances them by a
 * time step. It never draws, never plays a sound and never speaks; it emits
 * events that the renderer, the audio and the speech layer consume, and it
 * can describe what is near for the stage card. Everything it holds can be
 * saved and restored so a closed tab reopens onto the same ground.
 */
import { MOVE_ACCELERATION, TURN_ACCELERATION, acceleratedSpeed, advanceInputRamp, type InputRamp } from "../movement.ts";
import type { FieldBody, FieldNear, FieldOccasion, FieldPhase, RelativeDirection as PracticeDirection } from "../field-practice.ts";
import { FieldGraph, NODE_RADIUS, OFF_WAY_DISTANCE, WAY_HALF_WIDTH, bearingTo, distance, forwardOf, relativeDirection, rightOf, unit, wrapAngle, type FieldNode, type FieldWay, type Vec2, type WayMarkerKind } from "./graph.ts";
import { STRUCTURE_ANCHORS } from "./structure-anchors.ts";
import { CLEARING_RADIUS, StructureField, modelIdFor, rotateY, type Relevance, type Structure, type StructureElement, type StructureFamily, STRUCTURE_WAKE_SECONDS } from "./structures.ts";
import { CALL_FAINT_RANGE, CALL_RANGE, beginCall, callAudibility, commitAt, createUndertaking, completedAttemptCount, observeSignal, resolveCommitment, stageRun, takeUp, type Commitment, type StageRun, type Undertaking } from "./undertaking.ts";
import { WorldMemory, ownFootprintsVisible, type MemorySnapshot } from "./memory.ts";
import { beginCelebration, beginExamining, beginRepair, createAriadneBody, describeBody, hoverBeside, leadAlong, presenceOf, stopExamining, takeFragment, updateAriadne, walkerMarkerIndex, type AriadneBody } from "./ariadne.ts";

export const STRUCTURE_VISIBLE_RANGE = 11;
export const PULSE_VISIBLE_RANGE = 22;
export const PROXY_CALL_RANGE = 14;
export const CLEARING_VISIBLE_RANGE = 26;
export const WALKER_RADIUS = .35;
export const ARRIVAL_DELAY_MS = 3500;
export const OFF_WAY_SPEECH_MS = 2500;
export const TREND_WINDOW_MS = 5000;
export const TREND_THRESHOLD = 3;
/** How long nothing may happen at a structure (no part waking, no sleeping part answering) before she helps again. */
export const PROMPT_AFTER_MS = 16_000;
/** How much attention a sleeping part must have gathered before she tells the walker to stay as they are. */
const ATTENDING_SPEAK_AT = .2;
/** How long the walker may stand still while she waits at her marker before she renews the invitation; at most twice a commitment. */
export const STILL_RENEW_AFTER_MS = 25_000;
/** The elimination speech at a recognized return comes at most this often once she has given it a few times. */
export const RETURN_SPEECH_GAP_MS = 120_000;
/** A walker who has not taken up the teaching way after this long, and is standing still, hears the invitation again. */
export const TEACHING_NUDGE_AFTER_MS = 20_000;

export type FieldInput = {
  /** Forward (+) or back (−), −1..1. */
  forward: number;
  /** Strafe to the right (+) or left (−), −1..1. */
  strafe: number;
  /** Turn left (+) or right (−), −1..1, with acceleration. */
  turn: number;
  /** Immediate yaw change in radians (mouse, touch); positive turns left. */
  lookDelta: number;
  pitchDelta?: number;
};

export const IDLE_INPUT: FieldInput = { forward: 0, strafe: 0, turn: 0, lookDelta: 0 };

export type Walker = {
  position: Vec2;
  yaw: number;
  pitch: number;
  velocity: Vec2;
  speed: number;
  moveRamp: InputRamp;
  turnRamp: InputRamp;
  stillSince: number;
};

export type Standing = "at_node" | "on_way" | "off_way";

export type FarHearing = { wayId: string; label?: string } | null;

export type SpeakEvent = {
  type: "speak";
  occasion: FieldOccasion;
  walkerDid: string;
  whatFollowed: string;
  far: FarHearing;
  priority: number;
  /** The commitment this line belongs to, so the speech layer can recall what she said. */
  commitmentId: string | null;
  /** Whether the observed outcome followed Ariadne’s direction, rather than independent exploration. */
  guidanceOwned?: boolean;
  /** Earlier spoken direction whose outcome this event observes, before the new offer. */
  priorCommitmentId?: string;
  /** Structure whose interaction or accomplishment this event describes. */
  structureId?: string;
  /** Speech may retain an awakening after its proposed next route is obsolete. */
  contributionOnly?: boolean;
  /** True when this line is a repeat prompt rather than a first announcement. */
  prompt?: boolean;
  /**
   * A shade the speech layer can use to pick a recorded cue: her way ended in nothing (`quiet_arrival`); a place already stood
   * at, acknowledged by the cue alone while she simply chooses again (`return`); the walker has not taken up her lead for a
   * while, and she renews the invitation with the recorded cue and nothing more (`waiting`).
   */
  tone?: "quiet_arrival" | "return" | "waiting" | "directed_return";
  /** Which half of a two-beat line this is; the speech layer sets it, never the game. */
  beat?: "acknowledge" | "renew";
  /** The words a reply answers, kept on the event so the renewal beat of a reply still knows them; the speech layer sets it. */
  walkerMessage?: string | null;
};

export type FieldEvent =
  | SpeakEvent
  | { type: "ariadne_arrives" }
  | { type: "footstep"; surface: "ground" | "stone"; position: Vec2 }
  | { type: "element_woke"; structureId: string; family: StructureFamily; elementId: string; noteHz: number; remaining: number; position: [number, number, number] }
  | { type: "element_sounded"; structureId: string; family: StructureFamily; elementId: string; noteHz: number; position: [number, number, number] }
  | { type: "structure_completed"; structureId: string; family: StructureFamily; position: Vec2; relevance: Relevance }
  | { type: "fragment"; family: StructureFamily; from: [number, number, number] }
  | { type: "call_changed"; structureId: string | null }
  | { type: "stage_advanced"; stage: number }
  | { type: "commitment"; wayId: string; fromNodeId: string }
  | { type: "lead"; wayId: string; fromNodeId: string }
  | { type: "off_way"; off: boolean }
  | { type: "node_entered"; nodeId: string; returning: boolean };

export type CallState = {
  structureId: string | null;
  /** The family of the structure that is sounding: the objective's, or a nearby sleeping proxy's. */
  family: StructureFamily | null;
  position: [number, number, number] | null;
  distance: number | null;
  audibility: "clear" | "faint" | "none";
  trend: "growing" | "fading" | "steady" | null;
  /** 0..1 loudness for the audio layer; the objective call has a long tail, a proxy is only near. */
  gain: number;
  proxy: boolean;
};

export type FieldSave = {
  version: 1;
  seed: number;
  time: number;
  activeSeconds: number;
  walker: { position: Vec2; yaw: number; pitch?: number };
  undertaking: Undertaking;
  structures: ReturnType<StructureField["serialize"]>;
  memory: MemorySnapshot;
  ariadne: { fragments: StructureFamily[]; committedWayId: string | null; committedFromNodeId: string | null } | null;
  lastNodeId: string | null;
  arrivedByWayId: string | null;
  openingSpoken: boolean;
  teachingTakenUp: boolean;
  structuresAnnounced: string[];
  terminusSpokenFor: string | null;
  /** Arrivals at places already stood at since the current call began; older saves have none. */
  returnsThisStage?: number;
  stageVisited?: string[];
  backtrack?: { wayId: string; nodeId: string } | null;
  /** How many returns she has spoken to in full; older saves have none. */
  returnsSpoken?: number;
  /** How many times she has renewed the teaching invitation to a walker who had not moved; older saves have none. */
  teachingNudges?: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const smoothstep = (edge0: number, edge1: number, value: number) => { const t = clamp((value - edge0) / (edge1 - edge0), 0, 1); return t * t * (3 - 2 * t); };
const dirWord = (bearing: number) => relativeDirection(bearing) as PracticeDirection;

export function phaseFor(completedAttempts: number, clearingsMade: number, activeSeconds: number): FieldPhase {
  // Waiting is not shared investment; actual traversals and awakenings set the pace.
  void activeSeconds;
  if (clearingsMade < 2) return "charming";
  const pressure = completedAttempts + Math.max(0, clearingsMade - 2);
  return pressure < 7 ? "charming" : pressure < 14 ? "attached" : "overbearing";
}

/** Floor to show at a place: a structure keeps a degree-one place from reading as a terminus. */
export function floorFor(node: FieldNode, structures: StructureField) {
  if (node.floor.startsWith("terminus") && structures.atNode(node.id)) return (["stone dish", "pool", "ring of stakes"] as const)[node.floorVariant % 3];
  return node.floor;
}

export class FieldGame {
  readonly seed: number;
  readonly graph: FieldGraph;
  readonly structures: StructureField;
  readonly memory = new WorldMemory();
  readonly teachingWayId: string;
  readonly teachingNodeId: string;
  undertaking: Undertaking;
  walker: Walker;
  ariadne: AriadneBody | null = null;
  /** Active time in milliseconds; the clock every timestamp in the field uses. */
  time = 0;
  activeSeconds = 0;
  reducedMotion = false;
  standing: Standing = "at_node";
  currentWayId: string | null = null;
  currentNodeId: string | null;
  lastNodeId: string | null;
  arrivedByWayId: string | null = null;
  call: CallState = { structureId: null, family: null, position: null, distance: null, audibility: "none", trend: null, gain: 0, proxy: false };
  /** How far off the markers the walker is, 0 on the line to 1 deep in open fog; drives fog density and the hush. */
  offWayFactor = 0;

  private events: FieldEvent[] = [];
  private offWaySince: number | null = null;
  private offWaySpoken = false;
  private trendSamples: Array<{ t: number; d: number }> = [];
  private lastTrendSampleAt = -Infinity;
  private structuresAnnounced = new Set<string>();
  private terminusSpokenFor: string | null = null;
  private pendingLead: { wayId: string; fromNodeId: string; at: number; commitmentId?: string } | null = null;
  private openingSpoken = false;
  private teachingTakenUp = false;
  private lastStreamAt = -Infinity;
  private lastPromptAt = -Infinity;
  /** Repeat prompts given at each structure; two is help, a third is nagging. */
  private promptsAt = new Map<string, number>();
  private lastReturnSpokenAt = -Infinity;
  private lastWakeAt = -Infinity;
  /** The last moment a part woke or a sleeping part was answering: a stall is measured from here. */
  private lastProgressAt = -Infinity;
  /** Renewed invitations to a walker standing still, per commitment. */
  private stillNudgesFor = new Map<string, number>();
  /** Sleeping parts she has already told the walker to stay with, and how many times per structure: after two, the tone and the light carry it. */
  private attendingSpoken = new Set<string>();
  private attendingLinesAt = new Map<string, number>();
  private returnsThisStage = 0;
  private stageVisited = new Set<string>();
  private backtrack: { wayId: string; nodeId: string } | null = null;
  private returnsSpoken = 0;
  private teachingNudges = 0;
  private examining: string | null = null;
  private attention = { lookingToward: null as string | null, approaching: null as string | null, movingAwayFrom: null as string | null, pausedNear: null as string | null, still: false, lookingAtHer: false };
  private previousStructureDistance: number | null = null;

  constructor(seed: number) {
    this.seed = seed;
    this.graph = new FieldGraph(seed);
    this.graph.ensureAround([0, 0], 1);
    const spawn = this.graph.node(this.graph.spawnNodeId)!;
    this.graph.ensureAround(spawn.position, 1);
    const teachingWay = this.graph.way(spawn.ways[0]!)!;
    this.teachingWayId = teachingWay.id;
    this.teachingNodeId = this.graph.otherEnd(teachingWay, spawn.id);
    this.structures = new StructureField(seed, this.teachingNodeId, spawn.id);
    this.structures.ensureAround(this.graph, spawn.position);
    this.undertaking = createUndertaking(seed);
    const first = this.graph.markersFrom(teachingWay, spawn.id)[0]!;
    const yaw = Math.atan2(first.position[0] - spawn.position[0], first.position[1] - spawn.position[1]) + (unit(seed, "spawn-yaw") - .5) * .5;
    this.walker = { position: [...spawn.position], yaw, pitch: 0, velocity: [0, 0], speed: 0, moveRamp: { heldSeconds: 0, direction: 0 }, turnRamp: { heldSeconds: 0, direction: 0 }, stillSince: 0 };
    this.currentNodeId = spawn.id; this.lastNodeId = spawn.id;
    this.memory.visit(spawn.id, 0);
    this.updateCall(0);
  }

  /* ------------------------------------------------------------ queries */

  get teachingStructure() { return this.structures.atNode(this.teachingNodeId); }
  get clearingsMade() { return this.structures.completed().length; }
  get phase(): FieldPhase { return phaseFor(completedAttemptCount(this.undertaking), this.clearingsMade, this.activeSeconds); }
  /** The calling structure of the current stage: the teaching structure before the first awakening. */
  get callingStructure(): Structure | null {
    if (this.undertaking.objectiveStructureId) return this.structures.get(this.undertaking.objectiveStructureId);
    const teaching = this.teachingStructure; return teaching && teaching.completedAt === null ? teaching : null;
  }
  get walkerPose() { return { position: this.walker.position, yaw: this.walker.yaw, pitch: this.walker.pitch, speed: this.walker.speed }; }
  /** The run toward the current call, as both of them could count it. */
  run(): StageRun { return stageRun(this.undertaking, this.returnsThisStage); }
  /**
   * When the walker stands at (or is arriving at) `nodeId` by a way they chose over hers, the way they took and the way she had
   * chosen; otherwise null. Her card needs this so that she can praise their finding as theirs, and as the two of them working well.
   */
  arrivedByOwnChoice(nodeId: string): { took: FieldWay; hers: FieldWay } | null {
    const last = this.undertaking.history.at(-1);
    if (!last || last.taken !== "declined" || !last.declinedFor) return null;
    const took = this.graph.way(last.declinedFor), hers = this.graph.way(last.wayId);
    if (!took || !hers || this.graph.otherEnd(took, last.nodeId) !== nodeId) return null;
    const here = this.currentNodeId === nodeId || (this.currentNodeId === null && this.arrivedByWayId === took.id);
    return here ? { took, hers } : null;
  }

  /** Take the events emitted since the last drain. */
  drain() { const events = this.events; this.events = []; return events; }

  /* ------------------------------------------------------------- update */

  update(dt: number, input: FieldInput = IDLE_INPUT) {
    const step = clamp(dt, 0, .1);
    this.time += step * 1000; this.activeSeconds += step;
    const now = this.time;
    this.move(step, input);
    if (now - this.lastStreamAt > 500) { this.lastStreamAt = now; this.graph.ensureAround(this.walker.position, 1); this.structures.ensureAround(this.graph, this.walker.position); }
    this.locate(now);
    this.updateCall(now);
    this.updateAttention(step, now);
    this.updateOpening(now);
    this.updateCommitment(now);
    this.updateOffWay(now);
    this.updateStructures(step, now);
    this.updateStillness(now);
    if (this.pendingLead && now >= this.pendingLead.at) { const lead = this.pendingLead; this.pendingLead = null; const way = this.graph.way(lead.wayId); if (way && this.ariadne && (!lead.commitmentId || lead.commitmentId === this.undertaking.active?.id)) { leadAlong(this.ariadne, this.graph, way, lead.fromNodeId, now); this.events.push({ type: "lead", wayId: way.id, fromNodeId: lead.fromNodeId }); } }
    if (this.ariadne) updateAriadne(this.ariadne, this.graph, this.walkerPose, step, now, this.reducedMotion);
  }

  private move(step: number, input: FieldInput) {
    const walker = this.walker;
    walker.turnRamp = advanceInputRamp(walker.turnRamp, input.turn, step, TURN_ACCELERATION.rampSeconds);
    const turn = Math.sign(input.turn) * acceleratedSpeed(walker.turnRamp, TURN_ACCELERATION) * Math.min(1, Math.abs(input.turn));
    walker.yaw = wrapAngle(walker.yaw + input.lookDelta + (input.turn ? turn * step : 0));
    walker.pitch = clamp(walker.pitch + (input.pitchDelta ?? 0), -Math.PI / 2 + .01, Math.PI / 2 - .01);
    const magnitude = Math.min(1, Math.hypot(input.forward, input.strafe));
    walker.moveRamp = advanceInputRamp(walker.moveRamp, magnitude > .05 ? 1 : 0, step, MOVE_ACCELERATION.rampSeconds);
    const speed = magnitude > .05 ? acceleratedSpeed(walker.moveRamp, MOVE_ACCELERATION) * magnitude : 0;
    const forward = forwardOf(walker.yaw), right = rightOf(walker.yaw);
    const target: Vec2 = magnitude > .05 ? [(forward[0] * input.forward + right[0] * input.strafe) / magnitude * speed, (forward[1] * input.forward + right[1] * input.strafe) / magnitude * speed] : [0, 0];
    const blend = clamp(step * 9, 0, 1);
    walker.velocity = [walker.velocity[0] + (target[0] - walker.velocity[0]) * blend, walker.velocity[1] + (target[1] - walker.velocity[1]) * blend];
    const before: Vec2 = [...walker.position];
    let next: Vec2 = [walker.position[0] + walker.velocity[0] * step, walker.position[1] + walker.velocity[1] * step];
    next = this.collide(next);
    walker.position = next;
    const moved = distance(before, next);
    walker.speed = step > 0 ? moved / step : 0;
    if (walker.speed < .1) { if (!walker.stillSince) walker.stillSince = this.time; } else walker.stillSince = 0;
    const node = this.graph.nodeAt(next);
    const onStone = !!node && (node.floor === "stone dish" || node.floor === "ring of stakes" || (node.floor.startsWith("terminus") && !!this.structures.atNode(node.id)));
    const print = this.memory.recordStep(next, walker.yaw, moved, onStone, this.time);
    if (print) this.events.push({ type: "footstep", surface: onStone ? "stone" : "ground", position: [print.x, print.z] });
  }

  /** Soft collision with markers, structure cores and the ground giving out at termini. */
  private collide(next: Vec2): Vec2 {
    let [x, z] = next;
    const nearWay = this.graph.nearestWay(next);
    if (nearWay && nearWay.distance < 3) {
      for (const marker of nearWay.way.markers) {
        if (nearWay.way.marker === "cord") continue;
        const dx = x - marker.position[0], dz = z - marker.position[1], d = Math.hypot(dx, dz), min = .3 + WALKER_RADIUS;
        if (d < min && d > 1e-6) { x = marker.position[0] + dx / d * min; z = marker.position[1] + dz / d * min; }
      }
    }
    for (const structure of this.structures.dormantNear(next, 6).concat(this.structures.completed().filter(item => distance(item.position, next) < 6))) {
      const bounds = STRUCTURE_ANCHORS[modelIdFor(structure.family)]?.bounds; if (!bounds) continue;
      // A small core, not the whole silhouette: the structures are open frames, and their outer parts must stay within arm's reach.
      const hx = Math.min(.6, Math.max(.3, (bounds[1][0] - bounds[0][0]) / 2 * .7)), hz = Math.min(.6, Math.max(.3, (bounds[1][2] - bounds[0][2]) / 2 * .7));
      // Into the model's frame (the inverse rotation), and back out with the same convention the renderer uses.
      const [lx, , lz] = rotateY([x - structure.position[0], 0, z - structure.position[1]], -structure.yaw);
      const px = hx + WALKER_RADIUS - Math.abs(lx), pz = hz + WALKER_RADIUS - Math.abs(lz);
      if (px > 0 && pz > 0) {
        const ox = px < pz ? Math.sign(lx || 1) * px : 0, oz = px < pz ? 0 : Math.sign(lz || 1) * pz;
        const [wx, , wz] = rotateY([ox, 0, oz], structure.yaw);
        x += wx; z += wz;
      }
    }
    const node = this.graph.nodeAt([x, z], 9);
    if (node && node.floor.startsWith("terminus") && !this.structures.atNode(node.id) && node.ways.length === 1) {
      const way = this.graph.way(node.ways[0]!)!, first = this.graph.markersFrom(way, node.id)[0]!;
      // The ground gives out: a wide edge across the way's line, a few metres past the last footing.
      const away = Math.atan2(node.position[0] - first.position[0], node.position[1] - first.position[1]);
      const ax = Math.sin(away), az = Math.cos(away);
      const along = (x - node.position[0]) * ax + (z - node.position[1]) * az, across = -(x - node.position[0]) * az + (z - node.position[1]) * ax;
      const edge = (node.floor === "terminus-water" ? 1.1 : 1.5) - WALKER_RADIUS;
      if (along > edge && Math.abs(across) < 9) { x -= (along - edge) * ax; z -= (along - edge) * az; }
    }
    return [x, z];
  }

  /* ----------------------------------------------------------- location */

  private locate(now: number) {
    const node = this.graph.nodeAt(this.walker.position);
    const nearWay = this.graph.nearestWay(this.walker.position);
    const previousStanding = this.standing;
    if (node) { this.standing = "at_node"; this.currentWayId = null; }
    else if (nearWay && nearWay.distance <= WAY_HALF_WIDTH) { this.standing = "on_way"; this.currentWayId = nearWay.way.id; }
    else if (nearWay && nearWay.distance <= OFF_WAY_DISTANCE) { this.standing = "on_way"; this.currentWayId = nearWay.way.id; }
    else { this.standing = "off_way"; this.currentWayId = nearWay?.way.id ?? null; }
    this.offWayFactor = node ? 0 : smoothstep(WAY_HALF_WIDTH, OFF_WAY_DISTANCE + 9, nearWay?.distance ?? Infinity);
    if (node && node.id !== this.currentNodeId) { this.currentNodeId = node.id; this.enterNode(node, now); }
    else if (!node && this.currentNodeId) {
      // Leaving a place: remember the way we left by, for the next arrival.
      if (this.standing === "on_way" && this.currentWayId) this.arrivedByWayId = this.currentWayId;
      this.currentNodeId = null;
    }
    if (this.standing === "on_way" && this.currentWayId && !this.currentNodeId) this.arrivedByWayId = this.currentWayId;
    void previousStanding;
  }

  private enterNode(node: FieldNode, now: number) {
    const { returning } = this.memory.visit(node.id, now);
    const arrivedBy = node.ways.includes(this.arrivedByWayId ?? "") ? this.arrivedByWayId : node.ways.length === 1 ? node.ways[0]! : null;
    const plannedBacktrack = this.backtrack?.nodeId === node.id && this.backtrack.wayId === arrivedBy;
    const revisitedThisCall = this.stageVisited.has(node.id) && node.id !== this.lastNodeId;
    if (revisitedThisCall && !plannedBacktrack) this.returnsThisStage++;
    this.stageVisited.add(node.id);
    if (plannedBacktrack) this.backtrack = null;
    this.events.push({ type: "node_entered", nodeId: node.id, returning: returning && node.id !== this.lastNodeId });
    const instructedReturn = plannedBacktrack;
    const cameBack = node.id === this.lastNodeId;
    this.lastNodeId = node.id;
    this.previousStructureDistance = null;

    // Only an arrival settles a traversal. A changing sound is evidence along it, not its result.
    const active = this.undertaking.active;
    const followedHere = !!active && active.taken !== "declined" && active.wayId === arrivedBy;
    if (active) {
      const way = this.graph.way(active.wayId);
      const farEnd = way ? this.graph.otherEnd(way, active.nodeId) : null;
      if (active.nodeId === node.id && active.taken !== "followed") {
        if (active.taken === "pending" && this.ariadne && !this.ariadne.committedWayId && way) {
          leadAlong(this.ariadne, this.graph, way, node.id, now);
          this.events.push({ type: "lead", wayId: way.id, fromNodeId: node.id });
        }
        return;
      }
      if (node.id === farEnd && followedHere) {
        if (active.taken === "pending") this.undertaking = takeUp(this.undertaking, true, null);
        const atStructure = this.structures.atNode(node.id);
        const outcome = atStructure ? "confirmed" : node.ways.length === 1 ? "terminus" : "quiet";
        this.undertaking = resolveCommitment(this.undertaking, outcome, node.id);
      } else if (active.nodeId === node.id && active.taken === "followed") {
        this.undertaking = resolveCommitment(this.undertaking, plannedBacktrack ? "terminus" : "return", node.id);
      } else {
        if (active.taken === "pending") this.undertaking = takeUp(this.undertaking, false, arrivedBy);
        this.undertaking = resolveCommitment(this.undertaking, "quiet");
      }
    }

    const structure = this.structures.atNode(node.id);
    if (structure && structure.completedAt === null) {
      // A sleeping structure stands here: no commitment while there is something to wake.
      if (this.ariadne && this.ariadne.committedWayId) hoverBeside(this.ariadne, now);
      return;
    }
    if (node.ways.length === 1) {
      if (node.id === this.graph.spawnNodeId) return;
      const way = this.graph.way(node.ways[0]!)!;
      this.backtrack = { wayId: way.id, nodeId: this.graph.otherEnd(way, node.id) };
      if (this.terminusSpokenFor !== node.id) {
        this.terminusSpokenFor = node.id;
        this.speak("terminus", `Walked to the end of the ${way.marker}; the markers stop and the ground gives out at ${node.floor === "terminus-water" ? "water" : "a collapse"}.`, "The way ends. No instrument stands here. Your body is turning back along the same markers.", { wayId: way.id, label: `back along the ${way.marker}` }, 88, active?.id ?? null, false, undefined, { guidanceOwned: followedHere });
      }
      if (this.ariadne) { leadAlong(this.ariadne, this.graph, way, node.id, now); this.events.push({ type: "lead", wayId: way.id, fromNodeId: node.id }); }
      return;
    }
    if (!this.undertaking.objectiveNodeId) return;
    const choice = this.commitHere(node, arrivedBy, now);
    if (!choice) return;
    const way = this.graph.way(choice.wayId)!;
    const here = this.graph.node(node.id)!;
    const residueHere = here.ways.some(id => this.memory.residueOn(id));
    const footprints = ownFootprintsVisible(this.memory, node.position, now, 7, 15_000);
    const remembered = returning && !cameBack && (residueHere || footprints);
    const wayName = `the ${way.marker}`;
    const arrivedMarker = arrivedBy ? this.graph.way(arrivedBy)?.marker ?? null : null;
    const arrivedName = arrivedMarker ? arrivedMarker : null;
    const visits = this.memory.visits.get(node.id)?.count ?? 1;
    const tried = here.ways.filter(id => id !== way.id && this.memory.residueOn(id)).map(id => `the ${this.graph.way(id)!.marker}`);
    const chosenBefore = this.undertaking.history.some(item => item.id !== choice.commitment.id && item.nodeId === node.id && item.wayId === way.id);
    const triedNote = `${tried.length ? ` Your light is already on ${tried.join(" and ")}: these routes carry earlier choices, not evidence that they failed.` : ""}${chosenBefore ? ` You have chosen ${wayName} from here before too; your light is on it already, and this is not an untried way.` : ""}`;

    // Give repeated circuits room to register without narrating every familiar junction.
    // A planned retreat from a visible terminus is recovery, not a fresh loop.
    const returnOccasion = remembered && revisitedThisCall && (this.returnsSpoken < 3 ? visits === 2 || now - this.lastReturnSpokenAt > RETURN_SPEECH_GAP_MS : now - this.lastReturnSpokenAt > RETURN_SPEECH_GAP_MS);
    if (instructedReturn) {
      this.speak("commitment", "Returned here along the route you directed them back along. This return follows your guidance; it is not a newly discovered loop or their mistake.", `You asked for this backtracking. Acknowledge that the walking was theirs and the direction was yours. Your body now went to the first marker of ${wayName}.${triedNote}`, { wayId: way.id }, 84, choice.commitment.id, false, "directed_return");
    } else if (returnOccasion) {
      this.lastReturnSpokenAt = now; this.returnsSpoken++;
      const evidence = footprints && residueHere ? "their own footprints are on the ground and your light is on the markers of a way you chose before" : footprints ? "their own footprints are on the ground" : "your light is already on the markers of a route you chose before";
      this.speak("recognized_return", `Arrived again at a place visited during this same search${arrivedName ? `, along the ${arrivedName}` : ""}${followedHere ? ", following your direction" : ""}; ${evidence}.`, `The current call is still unresolved. This was not a return requested to recover from a visible dead end. ${followedHere ? "Your directions asked for this repeated walking; own that specific cost without dismissing the instruments already awakened. " : "Do not claim you directed their independent route. "}Your body now went to the first marker of ${wayName}.${triedNote}`, { wayId: way.id }, 80, choice.commitment.id, false, undefined, { guidanceOwned: followedHere, priorCommitmentId: followedHere ? active?.id : undefined });
    } else {
      const again = remembered ? `, a place you have both stood at ${visits} times now` : "";
      this.speak("commitment", `Arrived at a place where ${node.ways.length} ways meet${arrivedName ? `, along the ${arrivedName}` : ""}${again}.`, `Your body went to the first marker of ${wayName}.${triedNote}`, { wayId: way.id }, 80, choice.commitment.id, false, remembered ? "return" : undefined);
    }
  }

  private commitHere(node: FieldNode, arrivedBy: string | null, now: number) {
    if (node.ways.length < 2 || !this.ariadne) return null;
    const choice = commitAt(this.undertaking, this.graph, node.id, arrivedBy, this.seed, now);
    if (!choice) return null;
    this.undertaking = choice.state;
    this.memory.markResidue(choice.wayId, node.id, now);
    const way = this.graph.way(choice.wayId)!;
    leadAlong(this.ariadne, this.graph, way, node.id, now);
    this.trendSamples = [];
    this.events.push({ type: "commitment", wayId: way.id, fromNodeId: node.id }, { type: "lead", wayId: way.id, fromNodeId: node.id });
    return choice;
  }

  /* -------------------------------------------------------------- calls */

  private updateCall(now: number) {
    const objective = this.callingStructure;
    let structure: Structure | null = objective, proxy = false, gain = 0, d: number | null = null;
    if (objective) {
      d = Math.hypot(objective.callPosition[0] - this.walker.position[0], objective.callPosition[2] - this.walker.position[1]);
      gain = d <= CALL_RANGE ? 1 - .35 * (d / CALL_RANGE) : d <= CALL_FAINT_RANGE ? .65 * (1 - smoothstep(CALL_RANGE, CALL_FAINT_RANGE, d)) : 0;
    }
    for (const item of this.structures.dormantNear(this.walker.position, PROXY_CALL_RANGE)) {
      if (item === objective) continue;
      const dd = Math.hypot(item.callPosition[0] - this.walker.position[0], item.callPosition[2] - this.walker.position[1]);
      const g = .55 * (1 - dd / PROXY_CALL_RANGE);
      if (g > gain) { structure = item; gain = g; d = dd; proxy = true; }
    }
    const previousId = this.call.structureId;
    if (structure !== objective || !objective) this.trendSamples = [];
    // The trend follows the objective call only: it is the evidence her claims are tested against.
    if (objective && d !== null && !proxy && now - this.lastTrendSampleAt >= 250) { this.lastTrendSampleAt = now; this.trendSamples.push({ t: now, d }); while (this.trendSamples.length && this.trendSamples[0]!.t < now - TREND_WINDOW_MS - 500) this.trendSamples.shift(); }
    const reference = this.trendSamples.find(sample => sample.t <= now - TREND_WINDOW_MS) ?? null;
    const trend = !proxy && reference && d !== null ? (reference.d - d > TREND_THRESHOLD ? "growing" : d - reference.d > TREND_THRESHOLD ? "fading" : "steady") : null;
    const audibility = proxy ? (gain > 0 ? "faint" : "none") : callAudibility(d);
    this.call = { structureId: structure?.id ?? null, family: structure?.family ?? null, position: structure?.callPosition ?? null, distance: d, audibility: gain > 0 ? audibility === "none" ? "faint" : audibility : "none", trend: audibility === "none" ? null : trend, gain, proxy };
    if (this.call.structureId !== previousId) this.events.push({ type: "call_changed", structureId: this.call.structureId });
  }

  /* ---------------------------------------------------------- attention */

  private updateAttention(step: number, now: number) {
    const walker = this.walker;
    const structure = this.nearestStructure(12);
    const a = { lookingToward: null as string | null, approaching: null as string | null, movingAwayFrom: null as string | null, pausedNear: null as string | null, still: walker.stillSince > 0 && now - walker.stillSince > 1500, lookingAtHer: false };
    if (this.ariadne) {
      const d = distance(this.ariadne.position, walker.position);
      a.lookingAtHer = d < 9 && Math.abs(bearingTo(walker.position, walker.yaw, this.ariadne.position)) < .3;
    }
    if (structure) {
      const d = distance(structure.position, walker.position);
      const bearing = bearingTo(walker.position, walker.yaw, structure.position);
      if (Math.abs(bearing) < .4) a.lookingToward = `the ${structure.family.replaceAll("-", " ")}`;
      if (this.previousStructureDistance !== null && step > 0) {
        const radial = (this.previousStructureDistance - d) / step;
        if (radial > .5 && d > 2) a.approaching = `the ${structure.family.replaceAll("-", " ")}`; else if (radial < -.5) a.movingAwayFrom = `the ${structure.family.replaceAll("-", " ")}`;
      }
      this.previousStructureDistance = d;
      if (a.still && d < 5) a.pausedNear = `the ${structure.family.replaceAll("-", " ")}`;
    } else this.previousStructureDistance = null;
    if (!a.lookingToward && a.lookingAtHer) a.lookingToward = "your light";
    if (!a.lookingToward && this.currentNodeId) {
      const node = this.graph.node(this.currentNodeId)!;
      for (const wayId of node.ways) { const way = this.graph.way(wayId)!; if (Math.abs(this.graph.bearingOfWay(node, way, walker.yaw)) < .3) { a.lookingToward = `the ${way.marker}`; break; } }
    }
    this.attention = a;
  }

  private nearestStructure(radius: number) {
    let best: Structure | null = null, bestDistance = radius;
    for (const structure of this.structures.all()) { const d = distance(structure.position, this.walker.position); if (d < bestDistance) { best = structure; bestDistance = d; } }
    return best;
  }

  /* ------------------------------------------------------------ opening */

  private updateOpening(now: number) {
    if (!this.ariadne) {
      if (now >= ARRIVAL_DELAY_MS) { this.ariadne = createAriadneBody(this.walkerPose, now, true); this.events.push({ type: "ariadne_arrives" }); }
      return;
    }
    if (!this.openingSpoken && this.ariadne.mode === "hovering_beside") {
      this.openingSpoken = true;
      const way = this.graph.way(this.teachingWayId)!;
      leadAlong(this.ariadne, this.graph, way, this.graph.spawnNodeId, now);
      this.events.push({ type: "lead", wayId: way.id, fromNodeId: this.graph.spawnNodeId });
      this.speak("opening", "Stood in the fog, facing a faint sound somewhere ahead.", `You came out of the fog and settled beside them; your body is moving to the first marker of the ${way.marker}, the way the sound comes from.`, { wayId: way.id, label: `this way, along the ${way.marker}` }, 100, null);
    }
    if (this.openingSpoken && !this.teachingTakenUp) {
      const way = this.graph.way(this.teachingWayId)!;
      if (walkerMarkerIndex(this.graph, way, this.graph.spawnNodeId, this.walker.position) >= 1) {
        this.teachingTakenUp = true;
        this.speak("taken_up", `Followed your light past the first markers of the ${way.marker}.`, "You are moving ahead of them, marker to marker; the call is a little louder than it was.", { wayId: way.id }, 40, null);
      } else if (this.teachingNudges < 2 && this.walker.stillSince > 0 && now - this.walker.stillSince > TEACHING_NUDGE_AFTER_MS && now - this.lastPromptAt > TEACHING_NUDGE_AFTER_MS && this.ariadne.mode === "waiting_at_marker") {
        // Nobody has moved. Her readiness renews: the recorded invitation again, from the marker where she waits, and no more.
        this.teachingNudges++; this.lastPromptAt = now;
        this.speak("commitment", `Has not moved since you settled and led off; ${Math.round((now - this.walker.stillSince) / 1000)} seconds standing still.`, `You are waiting at the first marker of the ${way.marker}, looking back at them.`, { wayId: way.id }, 45, null, true, "waiting");
      }
    }
  }

  /* ---------------------------------------------------------- stillness */

  /**
   * Standing still is how a walker stops. When they have not moved for a while and she is waiting at the first marker of a
   * way she chose, she renews the invitation: the recorded ask, with a phrase of patience before it later in the walk.
   * Twice a commitment, and no more; after that the silence is theirs.
   */
  private updateStillness(now: number) {
    const active = this.undertaking.active;
    if (!this.ariadne || !this.teachingTakenUp || !active || active.taken !== "pending" || this.ariadne.mode !== "waiting_at_marker") return;
    const still = this.walker.stillSince > 0 ? now - this.walker.stillSince : 0;
    const count = this.stillNudgesFor.get(active.id) ?? 0;
    if (still < STILL_RENEW_AFTER_MS * (count + 1) || count >= 2 || now - this.lastPromptAt < STILL_RENEW_AFTER_MS) return;
    const way = this.graph.way(active.wayId); if (!way) return;
    this.stillNudgesFor.set(active.id, count + 1); this.lastPromptAt = now;
    if (this.stillNudgesFor.size > 40) this.stillNudgesFor = new Map([...this.stillNudgesFor].slice(-20));
    this.speak("commitment", `Has not moved for ${Math.round(still / 1000)} seconds; you are waiting at the first marker of the ${way.marker}.`, `You are waiting at the first marker of the ${way.marker}, looking back at them.`, { wayId: way.id }, 45, active.id, true, "waiting");
  }

  /* --------------------------------------------------------- commitment */

  private updateCommitment(now: number) {
    const active = this.undertaking.active;
    if (!active || !this.ariadne) return;
    const way = this.graph.way(active.wayId); if (!way) return;
    const from = this.graph.node(active.nodeId)!;
    const index = walkerMarkerIndex(this.graph, way, active.nodeId, this.walker.position);
    if (active.taken === "pending") {
      if (index >= 0) {
        this.undertaking = takeUp(this.undertaking, true, null);
        this.speak("taken_up", `Passed the first marker of the ${way.marker} and is walking it.`, "You are moving ahead of them, marker to marker.", { wayId: way.id }, 40, active.id);
        return;
      }
      if (distance(from.position, this.walker.position) > NODE_RADIUS + .5) {
        for (const otherId of from.ways) {
          if (otherId === way.id) continue;
          const other = this.graph.way(otherId)!;
          if (walkerMarkerIndex(this.graph, other, from.id, this.walker.position) >= 0) {
            this.undertaking = resolveCommitment(takeUp(this.undertaking, false, otherId), "quiet");
            hoverBeside(this.ariadne, now);
            this.speak("declined", `Passed the first marker of a different way: the ${other.marker}.`, "You left the way you chose and rejoined them. You have been given nothing about this way.", null, 85, active.id);
            return;
          }
        }
      }
      return;
    }
    if (active.taken !== "followed" || active.outcome !== "pending") return;
    // Outcome while still walking: the call is the evidence.
    const markers = this.graph.markersFrom(way, active.nodeId);
    const along = index >= 0 ? index / Math.max(1, markers.length - 1) : -1;
    const farEnd = this.graph.node(this.graph.otherEnd(way, active.nodeId))!;
    const terminusAhead = farEnd.ways.length === 1 && !this.structures.atNode(farEnd.id);
    if (terminusAhead && distance(farEnd.position, this.walker.position) < STRUCTURE_VISIBLE_RANGE && index >= 0) {
      if (this.terminusSpokenFor === farEnd.id) return;
      this.backtrack = { wayId: way.id, nodeId: active.nodeId };
      this.terminusSpokenFor = farEnd.id;
      beginRepair(this.ariadne, now);
      // Her practical recovery must not require the walker to approach the visible dead end first.
      this.pendingLead = { wayId: way.id, fromNodeId: farEnd.id, at: now + 4500, commitmentId: active.id };
      this.speak("terminus", `Walked the ${way.marker} as you asked; ahead the markers stop and the ground gives out at ${farEnd.floor === "terminus-water" ? "water" : "a collapse"}.`, "The way ends. No instrument stands there. You have been given no far hearing.", null, 88, active.id, false, undefined, { guidanceOwned: true });
      return;
    }
    if (along >= .45 && this.call.audibility !== "none" && !this.call.proxy && this.call.trend) {
      if (this.call.trend === "growing") {
        if (active.signal) return;
        this.undertaking = observeSignal(this.undertaking, "growing");
        this.speak("outcome_confirmed", `Walked the ${way.marker} as you asked, past the middle of the way.`, "The call is growing louder along this way.", { wayId: way.id }, 66, active.id);
      } else if (this.call.trend === "fading") {
        if (active.signal) return;
        this.undertaking = observeSignal(this.undertaking, "fading");
        this.speak("outcome_failed", `Walked the ${way.marker} as you asked, past the middle of the way.`, "The call has become fainter during this stretch. The route remains open; this does not establish that it cannot lead onward. Describe the change without declaring the attempt failed. You have been given no far hearing.", null, 65, active.id, false, undefined, { guidanceOwned: true });
      }
    }
  }

  /* ------------------------------------------------------------ off way */

  private updateOffWay(now: number) {
    if (this.standing === "off_way") {
      if (this.offWaySince === null) { this.offWaySince = now; this.events.push({ type: "off_way", off: true }); }
      if (!this.offWaySpoken && now - this.offWaySince > OFF_WAY_SPEECH_MS && this.ariadne) {
        this.offWaySpoken = true;
        if (this.ariadne.committedWayId) hoverBeside(this.ariadne, now);
        this.speak("off_way", "Left the markers and walked into open fog, where nothing is.", "You went with them. The line is behind you.", null, 55, this.undertaking.active?.id ?? null);
      }
    } else if (this.offWaySince !== null) {
      this.offWaySince = null; this.offWaySpoken = false;
      this.events.push({ type: "off_way", off: false });
      // Back on the markers: if her commitment still stands and they are on its way, she leads again.
      const active = this.undertaking.active;
      if (active && this.ariadne && !this.ariadne.committedWayId) {
        const way = this.graph.way(active.wayId);
        if (way && (this.currentWayId === way.id || this.currentNodeId === active.nodeId)) { leadAlong(this.ariadne, this.graph, way, active.nodeId, now); this.events.push({ type: "lead", wayId: way.id, fromNodeId: active.nodeId }); }
      }
    }
  }

  /* --------------------------------------------------------- structures */

  private updateStructures(step: number, now: number) {
    const pose = this.walkerPose;
    const changes = this.structures.advance(pose, step, now);
    for (const change of changes) {
      const structure = this.structures.get(change.structureId)!;
      if (change.type === "element_woke") {
        const element = structure.elements.find(item => item.id === change.elementId)!;
        this.lastWakeAt = now; this.lastProgressAt = now;
        this.events.push({ type: "element_woke", structureId: structure.id, family: structure.family, elementId: element.id, noteHz: change.noteHz, remaining: change.remaining, position: element.position });
      } else if (change.type === "element_sounded") {
        const element = structure.elements.find(item => item.id === change.elementId)!;
        this.events.push({ type: "element_sounded", structureId: structure.id, family: structure.family, elementId: element.id, noteHz: change.noteHz, position: element.position });
      } else if (change.type === "completed") this.complete(structure, now);
    }
    // She hovers at the part the walker is attending to.
    if (this.ariadne) {
      const engaged = this.nearestStructure(12)?.elements.find(element => element.engaged && !element.active) ?? null;
      if (engaged && this.examining !== engaged.id && !this.ariadne.committedWayId) { this.examining = engaged.id; beginExamining(this.ariadne, engaged.position, now); }
      else if (!engaged && this.examining) { this.examining = null; stopExamining(this.ariadne, now); }
    }
    // Announce a sleeping structure that has come into view, and prompt when the walker stalls.
    const structure = this.nearestStructure(STRUCTURE_VISIBLE_RANGE);
    if (structure && structure.completedAt === null && this.ariadne && this.openingSpoken) {
      const asleep = structure.elements.filter(element => !element.active);
      const next = asleep[0];
      if (!this.structuresAnnounced.has(structure.id) && next) {
        this.structuresAnnounced.add(structure.id);
        const who = `the ${structure.family === "bell-arch" ? "first sleeping" : "sleeping"} ${structure.family.replaceAll("-", " ")}`;
        const own = this.arrivedByOwnChoice(structure.nodeId);
        const byTheirWay = own ? ` They came this way along the ${own.took.marker}, a way they chose instead of the ${own.hers.marker} you had chosen; yours did not lead here.` : "";
        this.speak("structure_found", `Came within sight of ${who}.${byTheirWay}`, "Move close and keep the whole instrument in view as it wakes. There are no separate parts to target. Progress pauses when looking away.", this.farForNow(), 70, null, false, undefined, { structureId: structure.id });
        this.lastPromptAt = now;
      } else {
        const answering = structure.elements.find(element => element.engaged && !element.active) ?? null;
        if (answering && answering.attention > .08) this.lastProgressAt = now;
        const near = distance(structure.position, this.walker.position) < 8;
        // A sleeping part is answering a held look or stillness: once, while it still has more than a second to go, she tells
        // them to stay exactly as they are. The wait is the experience; her line is what makes it legible as one.
        if (answering && near && answering.attention >= ATTENDING_SPEAK_AT && STRUCTURE_WAKE_SECONDS * (1 - answering.attention) >= 1.1 && !this.attendingSpoken.has(answering.id) && (this.attendingLinesAt.get(structure.id) ?? 0) < 2 && now - this.lastWakeAt > 2500 && now - this.lastPromptAt > 4000) {
          this.attendingSpoken.add(answering.id); this.attendingLinesAt.set(structure.id, (this.attendingLinesAt.get(structure.id) ?? 0) + 1); this.lastPromptAt = now;
          this.speak("structure_attending", "Is close and looking at the instrument; the whole object is waking together.", "It is responding to their gaze and has not fully woken yet. Nothing else is asked of them now.", this.farForNow(), 66, null, false, undefined, { structureId: structure.id });
        } else if (next && !answering && near && now - this.lastProgressAt > PROMPT_AFTER_MS && now - this.lastPromptAt > PROMPT_AFTER_MS && (this.promptsAt.get(structure.id) ?? 0) < 3) {
          this.lastPromptAt = now; this.promptsAt.set(structure.id, (this.promptsAt.get(structure.id) ?? 0) + 1);
          this.speak("structure_found", "The instrument is still asleep and is not currently receiving a nearby gaze.", "Come within a few steps and look at the whole instrument. It wakes while held in view; any earlier progress is kept. No clicking or finding parts is needed.", this.farForNow(), 45, null, true, undefined, { structureId: structure.id });
        }
      }
    }
  }

  private complete(structure: Structure, now: number) {
    this.events.push({ type: "structure_completed", structureId: structure.id, family: structure.family, position: structure.position, relevance: structure.relevance });
    const body = this.ariadne;
    if (body) { takeFragment(body, structure.family, structure.fragmentPosition, now); beginCelebration(body, this.walkerPose, now); }
    structure.fragmentTakenAt = now;
    this.events.push({ type: "fragment", family: structure.family, from: structure.fragmentPosition });
    const node = this.graph.node(structure.nodeId)!;
    const relevant = structure.id === this.undertaking.objectiveStructureId || (this.undertaking.stage === 0 && structure.nodeId === this.teachingNodeId);
    // Whether they reached this structure by a way they chose over hers: decided before the call moves on and the history closes.
    const own = this.arrivedByOwnChoice(structure.nodeId);
    const found = own ? ` They reached it along the ${own.took.marker}, the way they chose instead of the ${own.hers.marker} you had chosen; ${relevant ? "this was the instrument that was calling, and they found it without you" : "your way did not lead here"}.` : "";
    if (relevant) {
      this.undertaking = beginCall(this.undertaking, this.graph, this.structures, structure.nodeId, this.seed, now);
      this.returnsThisStage = 0;
      this.stageVisited = new Set([structure.nodeId]);
      this.events.push({ type: "stage_advanced", stage: this.undertaking.stage });
      this.updateCall(now);
    }
    // Commit at this place once the celebration is over; the line about the awakening carries the new way.
    const arrivedBy = node.ways.includes(this.arrivedByWayId ?? "") ? this.arrivedByWayId : null;
    let far: FarHearing = null, commitmentId: string | null = null, next = "";
    if (node.ways.length >= 2 && this.undertaking.objectiveNodeId && body) {
      const choice = commitAt(this.undertaking, this.graph, node.id, arrivedBy, this.seed, now);
      if (choice) {
        this.undertaking = choice.state; commitmentId = choice.commitment.id;
        const way = this.graph.way(choice.wayId)!;
        this.memory.markResidue(way.id, node.id, now);
        this.pendingLead = { wayId: way.id, fromNodeId: node.id, at: now + 3400 };
        this.trendSamples = [];
        this.events.push({ type: "commitment", wayId: way.id, fromNodeId: node.id });
        far = { wayId: way.id };
        next = ` Your body is about to go to the first marker of the ${way.marker}.`;
      }
    } else if (node.ways.length === 1 && body) {
      const way = this.graph.way(node.ways[0]!)!;
      this.pendingLead = { wayId: way.id, fromNodeId: node.id, at: now + 3400 };
      next = ` Your body is about to go back along the ${way.marker}.`;
    }
    if (relevant) this.speak("awakening_relevant", `Woke the whole instrument.${found}`, `The instrument is fully awake. A clearing opened here and will stay. A fragment came to you. Beyond the fog, a new call.${next}`, far, 95, commitmentId, false, undefined, { structureId: structure.id });
    else this.speak("awakening_proxy", `Woke the whole instrument.${found}`, `The instrument is fully awake. A clearing opened here and will stay. A fragment came to you. No new call; the one you were following is unchanged.${next}`, far ?? this.farForNow(), 95, commitmentId, false, undefined, { structureId: structure.id });
  }

  /** The far hearing she currently holds: the way of her open commitment, if any. */
  private farForNow(): FarHearing {
    const active = this.undertaking.active;
    if (active && active.taken !== "declined") return { wayId: active.wayId };
    if (this.ariadne?.committedWayId) return { wayId: this.ariadne.committedWayId };
    return null;
  }

  private speak(occasion: FieldOccasion, walkerDid: string, whatFollowed: string, far: FarHearing, priority: number, commitmentId: string | null, prompt = false, tone?: SpeakEvent["tone"], evidence?: Pick<SpeakEvent, "guidanceOwned" | "priorCommitmentId" | "structureId">) {
    this.events.push({ type: "speak", occasion, walkerDid, whatFollowed, far, priority, commitmentId, ...(prompt ? { prompt } : {}), ...(tone ? { tone } : {}), ...evidence });
  }

  /* ------------------------------------------------------- perception */

  /** What is near, for the stage card. `far` names the way her far hearing is given along, so it can be located among the ways. */
  perceive(far: FarHearing): { near: FieldNear; body: FieldBody } {
    const walker = this.walker, now = this.time;
    const node = this.currentNodeId ? this.graph.node(this.currentNodeId) : null;
    const ways: FieldNear["ways"] = [];
    const wayEntry = (way: FieldWay, fromNodeId: string, bearing: number) => {
      const first = this.graph.markersFrom(way, fromNodeId)[0]!;
      ways.push({ id: way.id, relative: dirWord(bearing), marker: way.marker, residue: this.memory.residueOn(way.id) !== null, footprints: this.memory.footprints.some(print => now - print.at > 15_000 && Math.hypot(print.x - first.position[0], print.z - first.position[1]) < 4) });
    };
    if (node) for (const id of node.ways) wayEntry(this.graph.way(id)!, node.id, this.graph.bearingOfWay(node, this.graph.way(id)!, walker.yaw));
    else if (this.currentWayId) {
      const way = this.graph.way(this.currentWayId)!;
      // The way as it runs on from here: named from the end the walker is facing away from.
      const a = this.graph.node(way.a)!, b = this.graph.node(way.b)!;
      const toB = bearingTo(walker.position, walker.yaw, b.position), toA = bearingTo(walker.position, walker.yaw, a.position);
      const from = Math.abs(toB) < Math.abs(toA) ? a : b;
      const towards = from === a ? b : a;
      const bearing = bearingTo(walker.position, walker.yaw, towards.position);
      if (this.standing === "on_way" || distance(walker.position, this.graph.nearestWay(walker.position)?.point ?? walker.position) < OFF_WAY_DISTANCE + 9) wayEntry(way, from.id, bearing);
    }
    if (far && !ways.some(way => way.id === far.wayId)) {
      const way = this.graph.way(far.wayId);
      if (way) { const from = this.graph.node(way.a)!, to = this.graph.node(way.b)!; const nearer = distance(from.position, walker.position) < distance(to.position, walker.position) ? from : to; wayEntry(way, nearer.id, bearingTo(walker.position, walker.yaw, this.graph.markersFrom(way, nearer.id)[0]!.position)); }
    }
    const terminusNode = [...this.graph.nodes.values()].find(item => item.ways.length === 1 && item.id !== this.graph.spawnNodeId && !this.structures.atNode(item.id) && distance(item.position, walker.position) < STRUCTURE_VISIBLE_RANGE) ?? null;
    const structure = this.nearestStructure(STRUCTURE_VISIBLE_RANGE);
    const clearing = this.structures.completed().map(item => ({ item, d: distance(item.position, walker.position) })).filter(entry => entry.d < CLEARING_VISIBLE_RANGE).sort((p, q) => p.d - q.d)[0]?.item ?? null;
    const nodeFloor = node ? floorFor(node, this.structures) : null;
    const near: FieldNear = {
      standing: this.standing,
      nodeFloor: nodeFloor === "stone dish" || nodeFloor === "pool" || nodeFloor === "ring of stakes" ? nodeFloor : null,
      ways,
      terminusVisible: terminusNode ? (terminusNode.floor === "terminus-water" ? "water's edge" : "collapsed markers") : null,
      call: { audible: this.call.audibility !== "none", direction: this.call.audibility !== "none" && this.call.position ? dirWord(bearingTo(walker.position, walker.yaw, [this.call.position[0], this.call.position[2]])) : null, trend: this.call.audibility !== "none" ? this.call.trend ?? "steady" : null },
      structure: structure ? (() => {
        const answering = structure.elements.find(element => element.engaged && !element.active) ?? null;
        const nextAsleep = structure.elements.find(element => !element.active) ?? null;
        return { visible: true, family: structure.family, state: structure.completedAt !== null ? "awake" as const : structure.elements.some(element => element.attention > 0) ? "waking" as const : "dormant" as const, elementsRemaining: structure.elements.filter(element => !element.active).length, direction: dirWord(bearingTo(walker.position, walker.yaw, structure.position)),
          attending: answering ? { gesture: "look" as const, progress: answering.attention < .35 ? "beginning" as const : answering.attention < .7 ? "halfway" as const : "almost" as const } : null,
          nextAsks: nextAsleep ? "look" as const : null };
      })() : { visible: false, family: null, state: null, elementsRemaining: null, direction: null, attending: null, nextAsks: null },
      clearing: clearing ? { visible: true, direction: dirWord(bearingTo(walker.position, walker.yaw, clearing.position)), madeByWalker: true } : { visible: false, direction: null, madeByWalker: null },
      ownFootprintsVisible: ownFootprintsVisible(this.memory, walker.position, now),
      fog: this.standing === "off_way" ? "denser" : "ordinary",
      walkerAttention: { lookingToward: this.attention.lookingToward, approaching: this.attention.approaching, movingAwayFrom: this.attention.movingAwayFrom, pausedNear: this.attention.pausedNear, still: this.attention.still },
    };
    const body: FieldBody = this.ariadne
      ? (() => { const described = describeBody(this.ariadne!, this.walkerPose); const presence = presenceOf(this.ariadne!, this.walkerPose); return { presence: presence === "with_mt" ? "with_walker" : presence, currentAction: described.currentAction, relationToCommittedWay: described.relationToCommittedWay, walkerFollowing: described.walkerFollowing, walkerChoseAnotherWay: described.walkerChoseAnotherWay, walkerReturning: described.walkerReturning, walkerLookingAtHer: this.attention.lookingAtHer }; })()
      : { presence: "rejoining", currentAction: "You are still coming out of the fog toward the walker.", relationToCommittedWay: null, walkerFollowing: false, walkerChoseAnotherWay: false, walkerReturning: false, walkerLookingAtHer: false };
    return { near, body };
  }

  /** The structure's element the walker is engaged with, for the renderer's attention glow. */
  engagedElement(): StructureElement | null {
    return this.nearestStructure(12)?.elements.find(element => element.engaged) ?? null;
  }

  /** Distance to the nearest water's edge (a water terminus without a structure), or null beyond earshot. */
  waterDistance(radius = 40) {
    let best: number | null = null;
    for (const node of this.graph.nodes.values()) {
      if (node.floor !== "terminus-water" || node.ways.length !== 1 || this.structures.atNode(node.id)) continue;
      const d = distance(node.position, this.walker.position);
      if (d <= radius && (best === null || d < best)) best = d;
    }
    return best;
  }

  /** Clearings, nearest the walker first, so a shader with a fixed number of slots always holds the ones in view. */
  clearings(max = Infinity) {
    const position = this.walker.position;
    return this.structures.clearings()
      .map(item => ({ x: item.position[0], z: item.position[1], radius: CLEARING_RADIUS, since: item.since, distance: distance(item.position, position) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, max);
  }

  /** Walker-relative description of a marker kind, for the page's captions. */
  static markerName(kind: WayMarkerKind) { return kind; }

  /* -------------------------------------------------------- persistence */

  save(): FieldSave {
    return {
      version: 1, seed: this.seed, time: this.time, activeSeconds: this.activeSeconds,
      walker: { position: [...this.walker.position], yaw: this.walker.yaw, pitch: this.walker.pitch },
      undertaking: this.undertaking, structures: this.structures.serialize(), memory: this.memory.snapshot(),
      ariadne: this.ariadne ? { fragments: this.ariadne.fragments, committedWayId: this.ariadne.committedWayId, committedFromNodeId: this.ariadne.committedFromNodeId } : null,
      lastNodeId: this.lastNodeId, arrivedByWayId: this.arrivedByWayId, openingSpoken: this.openingSpoken, teachingTakenUp: this.teachingTakenUp,
      structuresAnnounced: [...this.structuresAnnounced], terminusSpokenFor: this.terminusSpokenFor, stageVisited: [...this.stageVisited], backtrack: this.backtrack,
      returnsThisStage: this.returnsThisStage, returnsSpoken: this.returnsSpoken, teachingNudges: this.teachingNudges,
    };
  }

  static restore(save: FieldSave): FieldGame {
    const game = new FieldGame(save.seed);
    game.time = save.time; game.activeSeconds = save.activeSeconds;
    game.walker.position = [...save.walker.position]; game.walker.yaw = save.walker.yaw; game.walker.pitch = clamp(save.walker.pitch ?? 0, -Math.PI / 2 + .01, Math.PI / 2 - .01);
    game.graph.ensureAround(game.walker.position, 1);
    game.structures.restore(game.graph, save.structures);
    game.structures.ensureAround(game.graph, game.walker.position);
    game.memory.restore(save.memory);
    game.undertaking = save.undertaking;
    if (game.undertaking.objectiveStructureId) { const objective = game.structures.get(game.undertaking.objectiveStructureId); if (objective) objective.relevance = "objective_relevant"; }
    game.lastNodeId = save.lastNodeId; game.arrivedByWayId = save.arrivedByWayId;
    game.openingSpoken = save.openingSpoken; game.teachingTakenUp = save.teachingTakenUp;
    game.structuresAnnounced = new Set(save.structuresAnnounced); game.terminusSpokenFor = save.terminusSpokenFor;
    game.stageVisited = new Set(save.stageVisited ?? []); game.backtrack = save.backtrack ?? null;
    game.returnsThisStage = save.returnsThisStage ?? 0; game.returnsSpoken = save.returnsSpoken ?? 0; game.teachingNudges = save.teachingNudges ?? 0;
    game.currentNodeId = game.graph.nodeAt(game.walker.position)?.id ?? null;
    if (save.ariadne) {
      game.ariadne = createAriadneBody(game.walkerPose, game.time, false);
      game.ariadne.fragments = [...save.ariadne.fragments];
      const way = save.ariadne.committedWayId ? game.graph.way(save.ariadne.committedWayId) : null;
      if (way && save.ariadne.committedFromNodeId) leadAlong(game.ariadne, game.graph, way, save.ariadne.committedFromNodeId, game.time);
    }
    game.updateCall(game.time);
    return game;
  }
}

/** "ahead", "behind", "to your left": the walker's words for a relative direction. */
export function describeWhere(direction: PracticeDirection) {
  return direction === "ahead" || direction === "behind" ? direction : `to your ${direction.replace("_", " ")}`;
}

export type { Commitment };
