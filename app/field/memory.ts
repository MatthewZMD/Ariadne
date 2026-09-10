/**
 * Memory in the world, replacing the minimap.
 *
 * Footprints persist where the walker has been; Ariadne's light leaves a
 * residue on the markers of every way she committed to; places remember how
 * often they were stood on. None of it labels what the walker meant. The
 * caption log records her words only. Everything here serializes, so a
 * closed tab reopens onto the same ground.
 */
import { distance, rightOf, type Vec2 } from "./graph.ts";

export type Footprint = { x: number; z: number; yaw: number; side: -1 | 1; at: number; onStone: boolean };
export type Residue = { strength: number; fromNodeId: string; at: number };
export type Visit = { count: number; firstAt: number; lastAt: number };
export type CaptionLine = { id: string; role: "ariadne" | "walker"; text: string; time: number; kind: "generated" | "cue" | "walker" };

export const STEP_LENGTH = .74;
export const MAX_FOOTPRINTS = 3000;
export const MAX_CAPTIONS = 400;

export type MemorySnapshot = {
  footprints: Footprint[];
  residue: Array<[string, Residue]>;
  visits: Array<[string, Visit]>;
  captions: CaptionLine[];
  stepAccumulator: number;
  stepSide: -1 | 1;
};

export class WorldMemory {
  footprints: Footprint[] = [];
  readonly residue = new Map<string, Residue>();
  readonly visits = new Map<string, Visit>();
  captions: CaptionLine[] = [];
  private stepAccumulator = 0;
  private stepSide: -1 | 1 = 1;

  /** Lay a print every STEP_LENGTH of travel; returns the print when one was laid. */
  recordStep(position: Vec2, yaw: number, moved: number, onStone: boolean, now: number): Footprint | null {
    this.stepAccumulator += Math.max(0, moved);
    if (this.stepAccumulator < STEP_LENGTH) return null;
    this.stepAccumulator -= STEP_LENGTH;
    this.stepSide = this.stepSide === 1 ? -1 : 1;
    const right = rightOf(yaw);
    const print: Footprint = { x: position[0] + right[0] * .17 * this.stepSide, z: position[1] + right[1] * .17 * this.stepSide, yaw, side: this.stepSide, at: now, onStone };
    this.footprints.push(print);
    if (this.footprints.length > MAX_FOOTPRINTS) this.footprints = this.footprints.filter((_, index) => index % 2 === 1 || index > MAX_FOOTPRINTS / 2);
    return print;
  }

  footprintsNear(position: Vec2, radius: number) { return this.footprints.filter(print => Math.hypot(print.x - position[0], print.z - position[1]) <= radius); }

  /** Her light settles on the markers of a way she chose; a repeat choice brightens it. */
  markResidue(wayId: string, fromNodeId: string, now: number) {
    const existing = this.residue.get(wayId);
    this.residue.set(wayId, { strength: Math.min(3, (existing?.strength ?? 0) + 1), fromNodeId, at: now });
  }
  residueOn(wayId: string) { return this.residue.get(wayId) ?? null; }

  /** Record standing at a place; returns whether this is a return. */
  visit(nodeId: string, now: number) {
    const existing = this.visits.get(nodeId);
    const visit: Visit = existing ? { count: existing.count + 1, firstAt: existing.firstAt, lastAt: now } : { count: 1, firstAt: now, lastAt: now };
    this.visits.set(nodeId, visit);
    return { returning: !!existing, visit };
  }
  visitedBefore(nodeId: string) { return this.visits.has(nodeId); }

  caption(line: CaptionLine) { this.captions = [...this.captions, line].slice(-MAX_CAPTIONS); }
  ariadneLinesSince(role: "walker") { let count = 0; for (let i = this.captions.length - 1; i >= 0; i--) { if (this.captions[i]!.role === role) break; count++; } return count; }

  snapshot(): MemorySnapshot {
    return { footprints: this.footprints, residue: [...this.residue.entries()], visits: [...this.visits.entries()], captions: this.captions, stepAccumulator: this.stepAccumulator, stepSide: this.stepSide };
  }

  restore(snapshot: MemorySnapshot) {
    this.footprints = snapshot.footprints ?? []; this.residue.clear(); for (const [id, value] of snapshot.residue ?? []) this.residue.set(id, value);
    this.visits.clear(); for (const [id, value] of snapshot.visits ?? []) this.visits.set(id, value);
    this.captions = snapshot.captions ?? []; this.stepAccumulator = snapshot.stepAccumulator ?? 0; this.stepSide = snapshot.stepSide ?? 1;
  }
}

/** Distance to the nearest footprint older than a moment ago: evidence the walker has stood here before. */
export function ownFootprintsVisible(memory: WorldMemory, position: Vec2, now: number, radius = 6, olderThanMs = 20_000) {
  return memory.footprints.some(print => now - print.at > olderThanMs && distance([print.x, print.z], position) <= radius);
}
