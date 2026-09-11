/**
 * The field: an infinite plane of places joined by ways.
 *
 * Every chunk holds a 3×3 lattice of places (nodes) joined by a seeded
 * spanning tree with one or two braids; adjacent chunks share one portal way
 * per border, so the whole graph is connected and deterministic from the seed.
 * Ways are gently curved and carry a line of markers 5 m apart. Degree-one
 * places without a structure are termini: the markers stop and the ground
 * gives out. Nothing here knows about calls, Ariadne, or the walker.
 */

export type Vec2 = [number, number];
export type WayMarkerKind = "leaning stones" | "posts" | "stitches";
export type NodeFloor = "stone dish" | "pool" | "ring of posts" | "terminus-collapse" | "terminus-water" | "open";

export const CELL = 45;
export const CHUNK_CELLS = 3;
export const CHUNK = CELL * CHUNK_CELLS;
export const NODE_JITTER = 10;
export const MARKER_SPACING = 5;
export const NODE_RADIUS = 4.2;
export const WAY_HALF_WIDTH = 4.5;
export const OFF_WAY_DISTANCE = 7;
/** The spawn place, in lattice cells. Its single way is the teaching way. */
export const SPAWN_CELL: Vec2 = [1, 1];

export type FieldNode = {
  id: string;
  cell: Vec2;
  position: Vec2;
  ways: string[];
  floor: NodeFloor;
  floorVariant: number;
  floorYaw: number;
  /** Deterministic in [0,1): structures.ts decides what stands here. */
  roll: number;
};

export type WayMarker = { position: Vec2; yaw: number; variant: number; t: number };

export type FieldWay = {
  id: string;
  a: string;
  b: string;
  control: Vec2;
  length: number;
  marker: WayMarkerKind;
  markers: WayMarker[];
};

export const nodeId = (cx: number, cz: number) => `${cx},${cz}`;
export const wayIdFor = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const chunkKeyOf = (kx: number, kz: number) => `${kx},${kz}`;

export function hash32(...values: Array<string | number>) {
  let h = 2166136261 >>> 0;
  for (const value of values) {
    const text = String(value);
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

export const unit = (seed: number, ...values: Array<string | number>) => hash32(seed, ...values) / 4294967296;
export const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
/**
 * Heading convention: yaw 0 faces +Z, forward = (sin yaw, cos yaw), and a
 * larger yaw turns left. A bearing is positive when the target is to the
 * walker's right, so `relativeDirection` reads it directly.
 */
export const forwardOf = (yaw: number): Vec2 => [Math.sin(yaw), Math.cos(yaw)];
/** The walker's right-hand direction (forward × up in a right-handed, Y-up world). */
export const rightOf = (yaw: number): Vec2 => [-Math.cos(yaw), Math.sin(yaw)];
export const bearingTo = (from: Vec2, yaw: number, target: Vec2) => wrapAngle(yaw - Math.atan2(target[0] - from[0], target[1] - from[1]));

function cellCentre(cx: number, cz: number): Vec2 { return [cx * CELL + CELL / 2, cz * CELL + CELL / 2]; }

function nodePosition(seed: number, cx: number, cz: number): Vec2 {
  const [x, z] = cellCentre(cx, cz);
  const angle = unit(seed, "jitter-angle", cx, cz) * Math.PI * 2, radius = unit(seed, "jitter-radius", cx, cz) * NODE_JITTER;
  return [x + Math.cos(angle) * radius, z + Math.sin(angle) * radius];
}

/** Quadratic bezier point. */
export function bezier(a: Vec2, control: Vec2, b: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * control[0] + t * t * b[0], u * u * a[1] + 2 * u * t * control[1] + t * t * b[1]];
}

function buildWay(seed: number, a: FieldNode, b: FieldNode): FieldWay {
  const id = wayIdFor(a.id, b.id);
  const mid: Vec2 = [(a.position[0] + b.position[0]) / 2, (a.position[1] + b.position[1]) / 2];
  const dx = b.position[0] - a.position[0], dz = b.position[1] - a.position[1], length0 = Math.hypot(dx, dz);
  const side = unit(seed, "bend", id) < .5 ? -1 : 1, bend = (2 + unit(seed, "bend-size", id) * 6) * side;
  const control: Vec2 = [mid[0] + (-dz / length0) * bend, mid[1] + (dx / length0) * bend];
  // Approximate arc length by sampling; place markers by arc length, keeping
  // them off the floors at both ends so a place reads as a place.
  const samples = 64, points: Vec2[] = []; let length = 0;
  for (let i = 0; i <= samples; i++) { const p = bezier(a.position, control, b.position, i / samples); if (i > 0) length += distance(points[i - 1]!, p); points.push(p); }
  const kinds: WayMarkerKind[] = ["leaning stones", "posts", "stitches"];
  const marker = kinds[hash32(seed, "marker-kind", id) % kinds.length]!;
  const markers: WayMarker[] = [];
  const margin = NODE_RADIUS + 1.2, usable = length - margin * 2, count = Math.max(2, Math.floor(usable / MARKER_SPACING) + 1), step = usable / (count - 1);
  let acc = 0, segment = 0;
  for (let k = 0; k < count; k++) {
    const target = margin + k * step;
    while (segment < samples && acc + distance(points[segment]!, points[segment + 1]!) < target) { acc += distance(points[segment]!, points[segment + 1]!); segment++; }
    const from = points[Math.min(segment, samples)]!, to = points[Math.min(segment + 1, samples)]!, segLength = Math.max(1e-6, distance(from, to)), f = Math.max(0, Math.min(1, (target - acc) / segLength));
    const position: Vec2 = [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f];
    const yaw = Math.atan2(to[0] - from[0], to[1] - from[1]) + (unit(seed, "marker-yaw", id, k) - .5) * .6;
    markers.push({ position, yaw, variant: hash32(seed, "marker-variant", id, k), t: (segment + f) / samples });
  }
  return { id, a: a.id, b: b.id, control, length, marker, markers };
}

/** Prim's tree over a set of lattice cells with seeded weights; the spawn cell (if present) is attached last as a leaf. */
function spanningEdges(seed: number, cells: Vec2[], leaf: Vec2 | null) {
  const key = (c: Vec2) => nodeId(c[0], c[1]);
  const inner = leaf ? cells.filter(c => key(c) !== key(leaf)) : cells;
  const set = new Set(inner.map(key)), visited = new Set<string>(), edges: Array<[Vec2, Vec2]> = [];
  const neighbours = (c: Vec2): Vec2[] => ([[1, 0], [-1, 0], [0, 1], [0, -1]] as Vec2[]).map(([dx, dz]) => [c[0] + dx, c[1] + dz] as Vec2).filter(n => set.has(key(n)));
  const start = inner[0]!; visited.add(key(start));
  const frontier: Array<{ from: Vec2; to: Vec2; weight: number }> = [];
  const push = (c: Vec2) => { for (const n of neighbours(c)) if (!visited.has(key(n))) frontier.push({ from: c, to: n, weight: unit(seed, "prim", key(c), key(n)) }); };
  push(start);
  while (visited.size < inner.length && frontier.length) {
    frontier.sort((p, q) => p.weight - q.weight);
    const edge = frontier.shift()!;
    if (visited.has(key(edge.to))) continue;
    visited.add(key(edge.to)); edges.push([edge.from, edge.to]); push(edge.to);
  }
  if (leaf) {
    const options = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as Vec2[]).map(([dx, dz]) => [leaf[0] + dx, leaf[1] + dz] as Vec2).filter(n => set.has(key(n)));
    edges.push([leaf, options[hash32(seed, "leaf-way", key(leaf)) % options.length]!]);
  }
  return edges;
}

export class FieldGraph {
  readonly seed: number;
  readonly nodes = new Map<string, FieldNode>();
  readonly ways = new Map<string, FieldWay>();
  private readonly chunks = new Set<string>();
  /** Portal ways are built when both chunks exist; remember which are pending. */
  private readonly pendingPortals = new Map<string, [string, string]>();

  constructor(seed: number) { this.seed = seed; }

  get spawnNodeId() { return nodeId(SPAWN_CELL[0], SPAWN_CELL[1]); }

  chunkOf(position: Vec2): Vec2 { return [Math.floor(position[0] / CHUNK), Math.floor(position[1] / CHUNK)]; }

  /** Generate every chunk within `radius` chunks of the position. */
  ensureAround(position: Vec2, radius = 1) {
    const [kx, kz] = this.chunkOf(position);
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) this.ensureChunk(kx + dx, kz + dz);
  }

  ensureChunk(kx: number, kz: number) {
    const key = chunkKeyOf(kx, kz);
    if (this.chunks.has(key)) return;
    this.chunks.add(key);
    const cells: Vec2[] = [];
    for (let j = 0; j < CHUNK_CELLS; j++) for (let i = 0; i < CHUNK_CELLS; i++) cells.push([kx * CHUNK_CELLS + i, kz * CHUNK_CELLS + j]);
    for (const [cx, cz] of cells) {
      const id = nodeId(cx, cz);
      this.nodes.set(id, { id, cell: [cx, cz], position: nodePosition(this.seed, cx, cz), ways: [], floor: "open", floorVariant: hash32(this.seed, "floor-variant", id), floorYaw: unit(this.seed, "floor-yaw", id) * Math.PI * 2, roll: unit(this.seed, "structure", id) });
    }
    const spawnHere = Math.floor(SPAWN_CELL[0] / CHUNK_CELLS) === kx && Math.floor(SPAWN_CELL[1] / CHUNK_CELLS) === kz;
    const edges = spanningEdges(this.seed, cells, spawnHere ? SPAWN_CELL : null);
    for (const [a, b] of edges) this.connect(nodeId(a[0], a[1]), nodeId(b[0], b[1]));
    // Braids: one or two extra lattice edges that never touch the spawn and never exceed degree four.
    const braidTarget = 1 + (hash32(this.seed, "braids", kx, kz) % 2);
    const candidates: Array<{ a: Vec2; b: Vec2; weight: number }> = [];
    for (const c of cells) for (const [dx, dz] of [[1, 0], [0, 1]] as Vec2[]) {
      const n: Vec2 = [c[0] + dx, c[1] + dz];
      if (!cells.some(k => k[0] === n[0] && k[1] === n[1])) continue;
      if (this.ways.has(wayIdFor(nodeId(c[0], c[1]), nodeId(n[0], n[1])))) continue;
      if (spawnHere && ((c[0] === SPAWN_CELL[0] && c[1] === SPAWN_CELL[1]) || (n[0] === SPAWN_CELL[0] && n[1] === SPAWN_CELL[1]))) continue;
      candidates.push({ a: c, b: n, weight: unit(this.seed, "braid", kx, kz, nodeId(c[0], c[1]), nodeId(n[0], n[1])) });
    }
    candidates.sort((p, q) => p.weight - q.weight);
    let braided = 0;
    for (const edge of candidates) {
      if (braided >= braidTarget) break;
      const a = this.nodes.get(nodeId(edge.a[0], edge.a[1]))!, b = this.nodes.get(nodeId(edge.b[0], edge.b[1]))!;
      if (a.ways.length >= 3 || b.ways.length >= 3) continue;
      this.connect(a.id, b.id); braided++;
    }
    // Portals to the four neighbouring chunks: one shared row/column per border, chosen by a hash both sides agree on.
    this.portal(kx, kz, kx + 1, kz); this.portal(kx - 1, kz, kx, kz);
    this.portal(kx, kz, kx, kz + 1); this.portal(kx, kz - 1, kx, kz);
    for (const cell of cells) this.assignFloor(nodeId(cell[0], cell[1]));
  }

  private portal(ax: number, az: number, bx: number, bz: number) {
    const horizontal = az === bz;
    const row = hash32(this.seed, horizontal ? "portal-v" : "portal-h", ax, az) % CHUNK_CELLS;
    const from: Vec2 = horizontal ? [ax * CHUNK_CELLS + CHUNK_CELLS - 1, az * CHUNK_CELLS + row] : [ax * CHUNK_CELLS + row, az * CHUNK_CELLS + CHUNK_CELLS - 1];
    const to: Vec2 = horizontal ? [bx * CHUNK_CELLS, bz * CHUNK_CELLS + row] : [bx * CHUNK_CELLS + row, bz * CHUNK_CELLS];
    // The spawn keeps exactly one way; a portal that would land on it moves one cell over on that side.
    const adjust = (c: Vec2): Vec2 => (c[0] === SPAWN_CELL[0] && c[1] === SPAWN_CELL[1]) ? (horizontal ? [c[0], c[1] === 0 ? 1 : c[1] - 1] : [c[0] === 0 ? 1 : c[0] - 1, c[1]]) : c;
    const a = nodeId(...adjust(from)), b = nodeId(...adjust(to));
    if (this.nodes.has(a) && this.nodes.has(b)) { this.connect(a, b); this.assignFloor(a); this.assignFloor(b); }
    else this.pendingPortals.set(wayIdFor(a, b), [a, b]);
  }

  private connect(a: string, b: string) {
    const id = wayIdFor(a, b);
    if (this.ways.has(id)) return;
    const na = this.nodes.get(a), nb = this.nodes.get(b);
    if (!na || !nb) { this.pendingPortals.set(id, [a, b]); return; }
    const way = buildWay(this.seed, na, nb);
    this.ways.set(id, way); na.ways.push(id); nb.ways.push(id); this.pendingPortals.delete(id);
  }

  private assignFloor(id: string) {
    const node = this.nodes.get(id)!;
    // The walker wakes on open ground: the spawn is a place with one way and nothing on it.
    if (id === this.spawnNodeId) { node.floor = "open"; return; }
    if (node.ways.length === 1) { node.floor = unit(this.seed, "terminus", id) < .45 ? "terminus-water" : "terminus-collapse"; return; }
    const floors: NodeFloor[] = ["stone dish", "pool", "ring of posts"];
    node.floor = floors[hash32(this.seed, "floor", id) % floors.length]!;
  }

  node(id: string) { return this.nodes.get(id) ?? null; }
  way(id: string) { return this.ways.get(id) ?? null; }
  otherEnd(way: FieldWay, from: string) { return way.a === from ? way.b : way.a; }

  /** Markers of a way ordered as walked from `from`. */
  markersFrom(way: FieldWay, from: string) { return way.a === from ? way.markers : [...way.markers].reverse(); }

  /** The place whose floor the position stands on, if any. */
  nodeAt(position: Vec2, radius = NODE_RADIUS) {
    const [cx, cz] = [Math.floor(position[0] / CELL), Math.floor(position[1] / CELL)];
    let best: FieldNode | null = null, bestDistance = radius;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const node = this.nodes.get(nodeId(cx + dx, cz + dz)); if (!node) continue;
      const d = distance(node.position, position); if (d < bestDistance) { best = node; bestDistance = d; }
    }
    return best;
  }

  /** Nearest point on the nearest way, sampled along the curve. */
  nearestWay(position: Vec2): { way: FieldWay; t: number; point: Vec2; distance: number } | null {
    const [cx, cz] = [Math.floor(position[0] / CELL), Math.floor(position[1] / CELL)];
    let best: { way: FieldWay; t: number; point: Vec2; distance: number } | null = null;
    const seen = new Set<string>();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const node = this.nodes.get(nodeId(cx + dx, cz + dz)); if (!node) continue;
      for (const wayId of node.ways) {
        if (seen.has(wayId)) continue; seen.add(wayId);
        const way = this.ways.get(wayId)!, a = this.nodes.get(way.a)!.position, b = this.nodes.get(way.b)!.position;
        for (let i = 0; i <= 40; i++) {
          const t = i / 40, point = bezier(a, way.control, b, t), d = distance(point, position);
          if (!best || d < best.distance) best = { way, t, point, distance: d };
        }
      }
    }
    return best;
  }

  /** Breadth-first hop distances from a node over generated ways, up to `maxHops`. */
  hops(from: string, maxHops = 8) {
    const dist = new Map<string, number>([[from, 0]]), queue = [from];
    while (queue.length) {
      const id = queue.shift()!, d = dist.get(id)!; if (d >= maxHops) continue;
      for (const wayId of this.nodes.get(id)?.ways ?? []) { const next = this.otherEnd(this.ways.get(wayId)!, id); if (!dist.has(next)) { dist.set(next, d + 1); queue.push(next); } }
    }
    return dist;
  }

  /** The first way on a shortest path from `from` to `to`, or null when unreachable within the generated graph. */
  firstStepToward(from: string, to: string): string | null {
    if (from === to) return null;
    const parent = new Map<string, string>(), queue = [from], seen = new Set([from]);
    while (queue.length) {
      const id = queue.shift()!;
      if (id === to) break;
      for (const wayId of this.nodes.get(id)?.ways ?? []) {
        const next = this.otherEnd(this.ways.get(wayId)!, id);
        if (!seen.has(next)) { seen.add(next); parent.set(next, id); queue.push(next); }
      }
    }
    if (!seen.has(to)) return null;
    let cursor = to;
    while (parent.get(cursor) !== from) cursor = parent.get(cursor)!;
    return wayIdFor(from, cursor);
  }

  /** Hop count along a shortest path, or null when unreachable within the generated graph. */
  hopCount(from: string, to: string) { return this.hops(from, 64).get(to) ?? null; }

  /** Relative bearing (positive to the walker's right) of a way's first marker from a walker at a node. */
  bearingOfWay(node: FieldNode, way: FieldWay, walkerYaw: number) {
    const first = this.markersFrom(way, node.id)[0]!;
    return bearingTo(node.position, walkerYaw, first.position);
  }
}

export type RelativeDirection = "far_left" | "left" | "ahead" | "right" | "far_right" | "behind";

/** Bearing (radians, positive to the right) into the walker's words. */
export function relativeDirection(bearing: number): RelativeDirection {
  const a = Math.abs(bearing);
  if (a < Math.PI / 8) return "ahead";
  if (a > Math.PI * 7 / 8) return "behind";
  const right = bearing > 0;
  if (a < Math.PI / 2) return right ? "right" : "left";
  return right ? "far_right" : "far_left";
}
