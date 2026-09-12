/**
 * Ariadne's body in the field: a thread of light with a position, a height,
 * a mode, and a trail the renderer draws as a ribbon. She leads by going to
 * the first marker of the way she chose and moving marker to marker ahead of
 * the walker; she catches up when they take another way; she comes back low
 * to repair; she rises to celebrate. Fragments of awakened structures ride
 * along her thread. The body reports what the walker is doing relative to
 * her commitment, so the episode state machine in embodied-interaction.ts
 * keeps working unchanged.
 */
import { NODE_RADIUS, WAY_HALF_WIDTH, bezier, distance, forwardOf, rightOf, type FieldGraph, type FieldWay, type Vec2 } from "./graph.ts";
import type { StructureFamily } from "./structures.ts";

export type AriadneMode = "arriving" | "hovering_beside" | "leading" | "waiting_at_marker" | "catching_up" | "returning" | "repairing" | "examining" | "celebrating" | "speaking";
export type AriadnePresence = "leading_ahead" | "with_mt" | "rejoining" | "repairing";
export type AriadneEmotion = "curious" | "encouraging" | "delighted" | "apologetic" | "relieved" | "insistent";
export type TrailPoint = { x: number; y: number; z: number; t: number };

export type AriadneBody = {
  position: Vec2;
  height: number;
  velocity: [number, number, number];
  mode: AriadneMode;
  modeSince: number;
  emotion: AriadneEmotion;
  side: -1 | 1;
  committedWayId: string | null;
  committedFromNodeId: string | null;
  firstMarker: Vec2 | null;
  markerIndex: number;
  examineTarget: [number, number, number] | null;
  celebrateOrigin: Vec2 | null;
  trail: TrailPoint[];
  fragments: StructureFamily[];
  pendingFragment: { family: StructureFamily; from: [number, number, number]; startedAt: number } | null;
  speakingUntil: number;
  brightness: number;
  /** Observations for the episode machine. */
  mtFollowingHerLead: boolean;
  mtChoseAnotherRoute: boolean;
  mtReturningToHer: boolean;
  lastWalkerDistance: number;
  previousWalkerPosition: Vec2;
  wanderPhase: number;
};

export type WalkerPose = { position: Vec2; yaw: number; speed: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const TRAIL_SECONDS = 1.6;
const TRAIL_HZ = 40;

export function createAriadneBody(walker: WalkerPose, now: number, arriving = true): AriadneBody {
  const forward = forwardOf(walker.yaw);
  const start: Vec2 = arriving ? [walker.position[0] + forward[0] * 14 + 4, walker.position[1] + forward[1] * 14 - 3] : besidePoint(walker, 1);
  return { position: start, height: arriving ? 2.6 : 1.25, velocity: [0, 0, 0], mode: arriving ? "arriving" : "hovering_beside", modeSince: now, emotion: "curious", side: 1, committedWayId: null, committedFromNodeId: null, firstMarker: null, markerIndex: 0, examineTarget: null, celebrateOrigin: null, trail: [], fragments: [], pendingFragment: null, speakingUntil: 0, brightness: 1, mtFollowingHerLead: false, mtChoseAnotherRoute: false, mtReturningToHer: false, lastWalkerDistance: 0, previousWalkerPosition: [...walker.position], wanderPhase: 0 };
}

function besidePoint(walker: WalkerPose, side: -1 | 1, ahead = 1.5, aside = .95): Vec2 {
  const forward = forwardOf(walker.yaw), right = rightOf(walker.yaw);
  return [walker.position[0] + forward[0] * ahead + right[0] * aside * side, walker.position[1] + forward[1] * ahead + right[1] * aside * side];
}

function setMode(body: AriadneBody, mode: AriadneMode, now: number) { if (body.mode !== mode) { body.mode = mode; body.modeSince = now; } }

/** She goes to the first marker of the way she chose and waits there, looking back. */
export function leadAlong(body: AriadneBody, graph: FieldGraph, way: FieldWay, fromNodeId: string, now: number) {
  const markers = graph.markersFrom(way, fromNodeId);
  body.committedWayId = way.id; body.committedFromNodeId = fromNodeId; body.firstMarker = markers[0]?.position ?? null; body.markerIndex = 0;
  // A new direction may point back past the walker. Present its next marker when the first is already at their feet.
  if (body.firstMarker && distance(body.firstMarker, body.previousWalkerPosition) < 3.2) body.markerIndex = Math.min(1, markers.length - 1);
  body.mtFollowingHerLead = false; body.mtChoseAnotherRoute = false; body.mtReturningToHer = false;
  body.emotion = "encouraging"; setMode(body, "leading", now);
}

export function releaseLead(body: AriadneBody, now: number) {
  body.committedWayId = null; body.committedFromNodeId = null; body.firstMarker = null; body.markerIndex = 0;
  if (body.mode === "leading" || body.mode === "waiting_at_marker") setMode(body, "catching_up", now);
}

export function beginRepair(body: AriadneBody, now: number) { releaseLead(body, now); body.emotion = "apologetic"; setMode(body, "returning", now); }
export function beginCelebration(body: AriadneBody, walker: WalkerPose, now: number) { releaseLead(body, now); body.emotion = "delighted"; body.celebrateOrigin = [...walker.position]; setMode(body, "celebrating", now); }
export function beginExamining(body: AriadneBody, target: [number, number, number], now: number) { body.examineTarget = target; body.emotion = "curious"; if (body.mode !== "leading" && body.mode !== "waiting_at_marker") setMode(body, "examining", now); }
export function stopExamining(body: AriadneBody, now: number) { body.examineTarget = null; if (body.mode === "examining") setMode(body, "hovering_beside", now); }
export function hoverBeside(body: AriadneBody, now: number) { releaseLead(body, now); setMode(body, "hovering_beside", now); }
export function markSpeaking(body: AriadneBody, seconds: number, now: number) { body.speakingUntil = now + seconds * 1000; }
export function takeFragment(body: AriadneBody, family: StructureFamily, from: [number, number, number], now: number) { body.pendingFragment = { family, from, startedAt: now }; }

export function presenceOf(body: AriadneBody, walker: WalkerPose): AriadnePresence {
  const d = distance(body.position, walker.position);
  if (body.mode === "returning" || body.mode === "repairing") return "repairing";
  if (body.mode === "leading" || body.mode === "waiting_at_marker") return "leading_ahead";
  if (body.mode === "catching_up" || (body.mode === "arriving")) return d > 3.5 ? "rejoining" : "with_mt";
  return "with_mt";
}

/**
 * Where along the committed way the walker is: the index of the nearest
 * marker, or -1 when the walker is still on a place's floor or off the way.
 */
export function walkerMarkerIndex(graph: FieldGraph, way: FieldWay, fromNodeId: string, walker: Vec2) {
  const from = graph.node(fromNodeId), to = graph.node(graph.otherEnd(way, fromNodeId));
  if (!from || !to) return -1;
  if (distance(from.position, walker) <= NODE_RADIUS + .5 || distance(to.position, walker) <= NODE_RADIUS + .5) return -1;
  let nearest = Infinity;
  for (let i = 0; i <= 40; i++) nearest = Math.min(nearest, distance(bezier(from.position, way.control, to.position, i / 40), walker));
  if (nearest > WAY_HALF_WIDTH) return -1;
  const markers = graph.markersFrom(way, fromNodeId);
  let best = 0, bestDistance = Infinity;
  markers.forEach((marker, index) => { const d = distance(marker.position, walker); if (d < bestDistance) { best = index; bestDistance = d; } });
  return best;
}

/**
 * Advance the body. Motion is a damped spring toward a mode-dependent target,
 * with a little wander so she never sits perfectly still.
 */
export function updateAriadne(body: AriadneBody, graph: FieldGraph, walker: WalkerPose, dt: number, now: number, reducedMotion: boolean) {
  const step = clamp(dt, 0, .05);
  body.wanderPhase += step;
  const way = body.committedWayId ? graph.way(body.committedWayId) : null;
  let target: Vec2 = besidePoint(walker, body.side), targetHeight = 1.25, stiffness = 6, maxSpeed = 5;
  const walkerDistance = distance(body.position, walker.position);
  const walkingToward = (point: Vec2) => {
    const dx = point[0] - walker.position[0], dz = point[1] - walker.position[1];
    const movedToward = (walker.position[0] - body.previousWalkerPosition[0]) * dx + (walker.position[1] - body.previousWalkerPosition[1]) * dz;
    return movedToward > step * .2 * Math.hypot(dx, dz);
  };

  // Observations first: they depend on geometry, not on her mode.
  body.mtFollowingHerLead = false; body.mtChoseAnotherRoute = false;
  if (way && body.committedFromNodeId) {
    const index = walkerMarkerIndex(graph, way, body.committedFromNodeId, walker.position);
    if (index >= 0) body.mtFollowingHerLead = true;
    else {
      const from = graph.node(body.committedFromNodeId);
      if (from && distance(from.position, walker.position) > 6) {
        for (const otherId of from.ways) { if (otherId === way.id) continue; const other = graph.way(otherId); if (other && walkerMarkerIndex(graph, other, from.id, walker.position) >= 0) body.mtChoseAnotherRoute = true; }
      }
    }
  }
  body.mtReturningToHer = body.lastWalkerDistance - walkerDistance > step * .6 && walkerDistance > 3 && walkerDistance < 12;
  body.lastWalkerDistance = walkerDistance;

  switch (body.mode) {
    case "arriving": {
      target = besidePoint(walker, body.side, 1.8, 1.1); targetHeight = 1.3; stiffness = 3.2; maxSpeed = 7;
      if (walkerDistance < 2.4 && now - body.modeSince > 1800) setMode(body, "hovering_beside", now);
      break;
    }
    case "leading":
    case "waiting_at_marker": {
      if (!way || !body.committedFromNodeId || !body.firstMarker) { setMode(body, "hovering_beside", now); break; }
      const markers = graph.markersFrom(way, body.committedFromNodeId);
      const walkerIndex = walkerMarkerIndex(graph, way, body.committedFromNodeId, walker.position);
      // She makes room as the walker approaches; following her must not require walking through her.
      // The body's anticipation is separate from the game's first-marker take-up evidence.
      const from = graph.node(body.committedFromNodeId)!;
      const firstDistance = distance(from.position, body.firstMarker);
      const firstDirection: Vec2 = [(body.firstMarker[0] - from.position[0]) / firstDistance, (body.firstMarker[1] - from.position[1]) / firstDistance];
      const wx = walker.position[0] - from.position[0], wz = walker.position[1] - from.position[1];
      const alongFirst = wx * firstDirection[0] + wz * firstDirection[1];
      const distanceToFirst = distance(walker.position, body.firstMarker);
      const closestInvitation = from.ways.every(id => id === way.id || distance(walker.position, graph.markersFrom(graph.way(id)!, from.id)[0]!.position) > distanceToFirst + .5);
      if (walkerIndex >= 0 && body.markerIndex < markers.length) body.markerIndex = Math.min(markers.length - 1, walkerIndex + 2);
      else if (body.mtChoseAnotherRoute) { setMode(body, "catching_up", now); break; }
      else if (body.markerIndex === 0 && alongFirst > 0 && closestInvitation && distanceToFirst < 3.2 && walkingToward(body.firstMarker)) body.markerIndex = Math.min(1, markers.length - 1);
      const lastMarker = markers.at(-1)!;
      if (body.markerIndex === markers.length - 1 && distance(walker.position, lastMarker.position) < 3.2 && walkingToward(lastMarker.position)) body.markerIndex = markers.length;
      const marker = markers[body.markerIndex] ?? markers[0]!;
      // The final marker is outside the place. Continue into it so a follower can actually arrive.
      target = body.markerIndex === markers.length ? graph.node(graph.otherEnd(way, from.id))!.position : marker.position;
      targetHeight = 1.15 + (body.mode === "waiting_at_marker" ? .1 : 0); stiffness = 5; maxSpeed = 6.5;
      if (distance(body.position, target) < .6) setMode(body, "waiting_at_marker", now); else if (body.mode === "waiting_at_marker" && distance(body.position, target) > 1.4) setMode(body, "leading", now);
      // She does not run out of sight: cap her lead at fog range.
      if (distance(target, walker.position) > 11) { const toward = Math.atan2(target[0] - walker.position[0], target[1] - walker.position[1]); target = [walker.position[0] + Math.sin(toward) * 11, walker.position[1] + Math.cos(toward) * 11]; }
      break;
    }
    case "catching_up": {
      target = besidePoint(walker, body.side); stiffness = 7; maxSpeed = 8;
      if (walkerDistance < 2.2) setMode(body, "hovering_beside", now);
      break;
    }
    case "returning": {
      target = besidePoint(walker, body.side, .9, .7); targetHeight = .85; stiffness = 4.5; maxSpeed = 4.5;
      if (walkerDistance < 1.6) setMode(body, "repairing", now);
      break;
    }
    case "repairing": {
      target = besidePoint(walker, body.side, .9, .7); targetHeight = .9 + Math.sin(body.wanderPhase * 1.4) * .05; stiffness = 5;
      if (now - body.modeSince > 4500 && now > body.speakingUntil) setMode(body, "hovering_beside", now);
      break;
    }
    case "examining": {
      const t = body.examineTarget; if (!t) { setMode(body, "hovering_beside", now); break; }
      target = [t[0] + Math.sin(body.wanderPhase * .9) * .25, t[2] + Math.cos(body.wanderPhase * .9) * .25]; targetHeight = t[1] + .45; stiffness = 5;
      break;
    }
    case "celebrating": {
      const origin = body.celebrateOrigin ?? walker.position, elapsed = (now - body.modeSince) / 1000, angle = elapsed * 2.2;
      target = [origin[0] + Math.sin(angle) * 1.6, origin[1] + Math.cos(angle) * 1.6]; targetHeight = 1.7 + Math.sin(elapsed * 3) * .3; stiffness = 8; maxSpeed = 9;
      if (elapsed > 3.2) setMode(body, "hovering_beside", now);
      break;
    }
    default: {
      target = besidePoint(walker, body.side); targetHeight = 1.25; stiffness = 6;
      if (body.emotion === "apologetic" && now - body.modeSince > 6000) body.emotion = "encouraging";
    }
  }

  // Wander: a slow figure that keeps the thread alive without hiding intent.
  const wanderScale = reducedMotion ? .04 : body.mode === "waiting_at_marker" ? .22 : .12;
  target = [target[0] + Math.sin(body.wanderPhase * 1.7) * wanderScale, target[1] + Math.cos(body.wanderPhase * 1.3) * wanderScale];
  targetHeight += Math.sin(body.wanderPhase * 2.1) * (reducedMotion ? .02 : .06);

  // Damped spring.
  const damping = 2 * Math.sqrt(stiffness);
  const ax = (target[0] - body.position[0]) * stiffness - body.velocity[0] * damping;
  const az = (target[1] - body.position[1]) * stiffness - body.velocity[2] * damping;
  const ay = (targetHeight - body.height) * stiffness * 1.5 - body.velocity[1] * damping * 1.2;
  body.velocity = [body.velocity[0] + ax * step, body.velocity[1] + ay * step, body.velocity[2] + az * step];
  const speed = Math.hypot(body.velocity[0], body.velocity[2]);
  if (speed > maxSpeed) { body.velocity[0] *= maxSpeed / speed; body.velocity[2] *= maxSpeed / speed; }
  body.position = [body.position[0] + body.velocity[0] * step, body.position[1] + body.velocity[2] * step];
  body.previousWalkerPosition = [...walker.position];
  body.height = clamp(body.height + body.velocity[1] * step, .35, 3.2);

  // Brightness: dim while returning to repair, bright while celebrating or leading.
  const targetBrightness = body.mode === "returning" || body.mode === "repairing" ? .55 : body.mode === "celebrating" ? 1.35 : 1;
  body.brightness += (targetBrightness - body.brightness) * clamp(step * 3, 0, 1);

  // Trail for the ribbon.
  const last = body.trail[body.trail.length - 1];
  if (!last || now - last.t >= 1000 / TRAIL_HZ) body.trail.push({ x: body.position[0], y: body.height, z: body.position[1], t: now });
  const cutoff = now - TRAIL_SECONDS * 1000;
  while (body.trail.length > 2 && body.trail[0]!.t < cutoff) body.trail.shift();

  // Fragment travel completes after 1.6 s.
  if (body.pendingFragment && now - body.pendingFragment.startedAt > 1600) { body.fragments = [...body.fragments, body.pendingFragment.family].slice(-12); body.pendingFragment = null; }
}

export function describeBody(body: AriadneBody, walker: WalkerPose) {
  const presence = presenceOf(body, walker);
  const action = body.mode === "arriving" ? "You have just come out of the fog and are settling beside the walker."
    : body.mode === "leading" ? "You are moving marker to marker along the way you chose, a little ahead of the walker."
    : body.mode === "waiting_at_marker" ? "You are hovering at a marker of the way you chose, looking back at the walker."
    : body.mode === "catching_up" ? "You left the way you indicated and are catching up to the walker."
    : body.mode === "returning" ? "You are coming back to the walker's side, low and dim."
    : body.mode === "repairing" ? "You are low at the walker's side."
    : body.mode === "examining" ? "You are hovering close to a part of the structure."
    : body.mode === "celebrating" ? "You are circling the walker, bright with the fragment that just joined you."
    : "You are drifting at the walker's shoulder, slightly ahead.";
  return { presence, currentAction: action, relationToCommittedWay: body.committedWayId ? (presence === "leading_ahead" ? "You are on the way you chose, ahead of the walker." : "You have left the way you indicated to be with the walker.") : null, walkerFollowing: body.mtFollowingHerLead, walkerChoseAnotherWay: body.mtChoseAnotherRoute, walkerReturning: body.mtReturningToHer };
}

/** Position of a point along a way for placing markers of her residue, etc. */
export function pointAlongWay(graph: FieldGraph, way: FieldWay, t: number): Vec2 {
  const a = graph.node(way.a)!.position, b = graph.node(way.b)!.position;
  return bezier(a, way.control, b, t);
}
