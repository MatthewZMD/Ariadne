/**
 * Sleeping structures in the field.
 *
 * Every structure stands at a place (node) and has a family, a set of
 * wakeable elements with their own gestures (approach, look, or be still and
 * listen), and two states: dormant and awake. Waking every element completes
 * the structure: the fog thins around it for good, its call resolves, and a
 * fragment leaves it for Ariadne. Whether a completed structure passes the
 * call on is decided by the undertaking (relevance), never here.
 *
 * Wake gestures are measured against the model’s 3D anchors.
 */
import { STRUCTURE_ANCHORS } from "./structure-anchors.ts";
import { distance, hash32, unit, wrapAngle, type FieldGraph, type FieldNode, type Vec2 } from "./graph.ts";

export type StructureFamily = "bells" | "pages" | "cairn" | "reeds" | "instrument" | "glass" | "teaching";
export type Gesture = "approach" | "look" | "listen";
export type Relevance = "objective_relevant" | "local_proxy";

export const FAMILIES: StructureFamily[] = ["bells", "pages", "cairn", "reeds", "instrument", "glass"];
export const FAMILY_COLOR: Record<StructureFamily, string> = { bells: "#dbc69b", pages: "#bcefff", cairn: "#ffd074", reeds: "#9eea76", instrument: "#ff8451", glass: "#8cf1dc", teaching: "#dbc69b" };
export const CLEARING_RADIUS = 10;
export const STRUCTURE_CHANCE = .4;
export const ATTENTION_RANGE = 12;

export type StructureElement = {
  id: string;
  index: number;
  gesture: Gesture;
  noteHz: number;
  /** World position [x, y, z]; y is height above the ground. */
  position: [number, number, number];
  active: boolean;
  activatedAt: number | null;
  attention: number;
  engaged: boolean;
  lastSoundedAt: number | null;
};

export type Structure = {
  id: string;
  nodeId: string;
  family: StructureFamily;
  position: Vec2;
  yaw: number;
  elements: StructureElement[];
  relevance: Relevance;
  completedAt: number | null;
  /** Set when the fragment has visibly joined Ariadne. */
  fragmentTakenAt: number | null;
  /** The "call" anchor and the fragment departure point, world space. */
  callPosition: [number, number, number];
  fragmentPosition: [number, number, number];
};

export type WakeChange =
  | { type: "element_woke"; structureId: string; elementId: string; noteHz: number; remaining: number }
  | { type: "element_sounded"; structureId: string; elementId: string; noteHz: number }
  | { type: "completed"; structureId: string; relevance: Relevance };

/**
 * Rotate a local offset about Y by `yaw`, exactly as Three.js applies
 * `object.rotation.y = yaw` to the rendered model: x' = x cos + z sin,
 * z' = −x sin + z cos. The game and the renderer must agree on this, or the
 * walker attends to a visible part while the game evaluates another place.
 */
export const rotateY = (local: [number, number, number], yaw: number): [number, number, number] => [local[0] * Math.cos(yaw) + local[2] * Math.sin(yaw), local[1], -local[0] * Math.sin(yaw) + local[2] * Math.cos(yaw)];
const rotate = rotateY;

export function modelIdFor(family: StructureFamily) { return `structure-${family}`; }

export function familyFor(seed: number, node: FieldNode): StructureFamily {
  return FAMILIES[hash32(seed, "family", node.id) % FAMILIES.length]!;
}

/** A structure stands at a place when its roll passes; the teaching place always has the teaching structure. */
export function createStructure(seed: number, node: FieldNode, family: StructureFamily, now = 0): Structure {
  const baked = STRUCTURE_ANCHORS[modelIdFor(family)];
  if (!baked) throw new Error(`no baked anchors for ${family}`);
  const yaw = unit(seed, "structure-yaw", node.id) * Math.PI * 2;
  const world = (local: [number, number, number]): [number, number, number] => { const r = rotate(local, yaw); return [node.position[0] + r[0], r[1], node.position[1] + r[2]]; };
  const elements = baked.anchors.filter(anchor => /^element_\d\d$/.test(anchor.name)).map((anchor, index) => ({
    id: `${node.id}:${anchor.name}`, index, gesture: anchor.gesture ?? "approach", noteHz: anchor.noteHz ?? 220, position: world(anchor.position), active: false, activatedAt: null, attention: 0, engaged: false, lastSoundedAt: null,
  }));
  const call = baked.anchors.find(anchor => anchor.name === "call_anchor")?.position ?? [0, 1.2, 0];
  const fragment = baked.anchors.find(anchor => anchor.name === "fragment_anchor")?.position ?? [0, 2, 0];
  void now;
  return { id: `structure:${node.id}`, nodeId: node.id, family, position: node.position, yaw, elements, relevance: "local_proxy", completedAt: null, fragmentTakenAt: null, callPosition: world(call), fragmentPosition: world(fragment) };
}

export class StructureField {
  readonly seed: number;
  readonly byNode = new Map<string, Structure>();
  private readonly decided = new Set<string>();
  readonly teachingNodeId: string;
  /** The walker wakes on open ground: nothing stands at the spawn, so the teaching structure is the first thing they meet. */
  readonly spawnNodeId: string | null;

  constructor(seed: number, teachingNodeId: string, spawnNodeId: string | null = null) { this.seed = seed; this.teachingNodeId = teachingNodeId; this.spawnNodeId = spawnNodeId; }

  /** Decide, once and deterministically, whether a place has a structure; create it when it does. */
  ensureAt(node: FieldNode) {
    if (this.decided.has(node.id)) return this.byNode.get(node.id) ?? null;
    this.decided.add(node.id);
    if (node.id === this.teachingNodeId) { const structure = createStructure(this.seed, node, "teaching"); this.byNode.set(node.id, structure); return structure; }
    if (node.id === this.spawnNodeId || node.ways.length === 0 || node.roll >= STRUCTURE_CHANCE) return null;
    const structure = createStructure(this.seed, node, familyFor(this.seed, node));
    this.byNode.set(node.id, structure); return structure;
  }

  /** Force a structure at a place (the undertaking uses this when no candidate exists within reach). */
  placeAt(node: FieldNode, family = familyFor(this.seed, node)) {
    this.decided.add(node.id);
    const existing = this.byNode.get(node.id); if (existing) return existing;
    const structure = createStructure(this.seed, node, family); this.byNode.set(node.id, structure); return structure;
  }

  ensureAround(graph: FieldGraph, position: Vec2, radius = 160) {
    for (const node of graph.nodes.values()) if (distance(node.position, position) <= radius) this.ensureAt(node);
  }

  get(id: string) { for (const structure of this.byNode.values()) if (structure.id === id) return structure; return null; }
  atNode(nodeId: string) { return this.byNode.get(nodeId) ?? null; }
  all() { return [...this.byNode.values()]; }
  completed() { return this.all().filter(item => item.completedAt !== null); }
  dormantNear(position: Vec2, radius: number) { return this.all().filter(item => item.completedAt === null && distance(item.position, position) <= radius); }

  /**
   * Advance attention for every element near the walker. Approach wakes on
   * contact; look and listen need sustained attention on one part at a time,
   * so moving attention among the parts makes a phrase rather than a chord.
   */
  advance(walker: { position: Vec2; yaw: number; pitch?: number; speed: number }, dt: number, now: number): WakeChange[] {
    const changes: WakeChange[] = [];
    const step = Math.max(0, Math.min(.1, dt));
    for (const structure of this.byNode.values()) {
      if (distance(structure.position, walker.position) > ATTENTION_RANGE) { for (const element of structure.elements) { element.attention = 0; element.engaged = false; } continue; }
      const candidates = structure.elements.map(element => {
        const dx = element.position[0] - walker.position[0], dz = element.position[2] - walker.position[1], flat = Math.hypot(dx, dz);
        const horizontal = wrapAngle(walker.yaw - Math.atan2(dx, dz));
        const elevation = Math.atan2(element.position[1] - 1.62, flat);
        const pitch = walker.pitch ?? 0;
        const bearing = Math.acos(Math.max(-1, Math.min(1, Math.sin(pitch) * Math.sin(elevation) + Math.cos(pitch) * Math.cos(elevation) * Math.cos(horizontal))));
        const inReach = element.gesture === "approach" ? flat <= 1.3 : flat <= 3.6 && bearing < .42;
        const still = element.gesture !== "listen" || walker.speed < .18;
        return { element, flat, bearing, eligible: inReach && still };
      });
      const focus = candidates.filter(item => item.eligible && item.element.gesture !== "approach").sort((a, b) => Number(a.element.active) - Number(b.element.active) || a.bearing - b.bearing || a.flat - b.flat)[0] ?? null;
      for (const item of candidates) {
        const element = item.element, engaged = item.eligible && (element.gesture === "approach" || focus === item);
        if (!engaged) { element.attention = Math.max(0, element.attention - step * .8); element.engaged = false; continue; }
        const newlyEngaged = !element.engaged; element.engaged = true;
        const duration = element.gesture === "listen" ? 1.5 : element.gesture === "look" ? .9 : .2;
        element.attention = Math.min(1, element.attention + step / duration);
        if (!element.active && element.attention >= 1) {
          element.active = true; element.activatedAt = now; element.lastSoundedAt = now;
          const remaining = structure.elements.filter(part => !part.active).length;
          changes.push({ type: "element_woke", structureId: structure.id, elementId: element.id, noteHz: element.noteHz, remaining });
          if (remaining === 0 && structure.completedAt === null) { structure.completedAt = now; changes.push({ type: "completed", structureId: structure.id, relevance: structure.relevance }); }
          continue;
        }
        const replayDelay = element.gesture === "listen" ? 1800 : element.gesture === "look" ? 700 : 300;
        if (element.active && now - (element.lastSoundedAt ?? 0) > replayDelay && (element.gesture === "approach" ? newlyEngaged : element.attention >= 1)) {
          element.lastSoundedAt = now; element.attention = 0;
          changes.push({ type: "element_sounded", structureId: structure.id, elementId: element.id, noteHz: element.noteHz });
        }
      }
    }
    return changes;
  }

  /** Clearings: completed structures thin the fog permanently around themselves. */
  clearings() { return this.completed().map(item => ({ position: item.position, radius: CLEARING_RADIUS, since: item.completedAt! })); }

  /** How far inside any clearing a position is, 0..1. */
  clearingAt(position: Vec2) {
    let best = 0;
    for (const item of this.completed()) { const d = distance(item.position, position); if (d < CLEARING_RADIUS) best = Math.max(best, 1 - d / CLEARING_RADIUS); }
    return best;
  }

  /** Persistence: element states and completion only; geometry regenerates from the seed. */
  serialize() {
    return this.all().map(item => ({ nodeId: item.nodeId, family: item.family, relevance: item.relevance, completedAt: item.completedAt, fragmentTakenAt: item.fragmentTakenAt, active: item.elements.map(element => element.active) }));
  }

  restore(graph: FieldGraph, saved: ReturnType<StructureField["serialize"]>) {
    for (const entry of saved) {
      const node = graph.node(entry.nodeId); if (!node) continue;
      const structure = this.placeAt(node, entry.family);
      structure.relevance = entry.relevance; structure.completedAt = entry.completedAt; structure.fragmentTakenAt = entry.fragmentTakenAt;
      entry.active.forEach((active, index) => { const element = structure.elements[index]; if (element) { element.active = active; element.activatedAt = active ? entry.completedAt ?? 0 : null; } });
    }
  }
}
