export const CHUNK_SIZE = 16;
export const CACHE_RADIUS = 3;
export const THEME_IDS = ["beach", "tornado", "ruins", "frozen", "foundry", "cavern"];

export const floorDiv = (n, d) => Math.floor(n / d);
export const mod = (n, d) => ((n % d) + d) % d;
export const cellKey = (x, y) => `${x},${y}`;
export const chunkKey = (x, y) => `${x},${y}`;

export function hash32(...values) {
  let h = 2166136261 >>> 0;
  for (const value of values) {
    const text = String(value);
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function edgeOffset(seed, axis, a, b) {
  return 1 + 2 * (hash32(seed, "edge", axis, a, b) % 7);
}

export function portalsFor(seed, cx, cy) {
  return {
    north: edgeOffset(seed, "h", cx, cy - 1),
    south: edgeOffset(seed, "h", cx, cy),
    west: edgeOffset(seed, "v", cx - 1, cy),
    east: edgeOffset(seed, "v", cx, cy),
  };
}

function carveLine(tiles, ax, ay, bx, by) {
  let x = ax, y = ay;
  tiles[y][x] = 0;
  while (x !== bx) { x += Math.sign(bx - x); tiles[y][x] = 0; }
  while (y !== by) { y += Math.sign(by - y); tiles[y][x] = 0; }
}

export function generateChunk(seed, cx, cy, epoch = 0) {
  const random = seededRandom(hash32(seed, cx, cy, epoch));
  const tiles = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(1));
  const seen = new Set([cellKey(1, 1)]), frontier = [];
  const addFrontier = (x, y) => {
    for (const [dx,dy] of [[2,0],[-2,0],[0,2],[0,-2]]) {
      const nx=x+dx,ny=y+dy;
      if(nx>0&&ny>0&&nx<15&&ny<15&&!seen.has(cellKey(nx,ny)))frontier.push({x,y,nx,ny});
    }
  };
  tiles[1][1] = 0;
  addFrontier(1,1);
  while(frontier.length){
    const index=Math.floor(random()*frontier.length),edge=frontier[index];
    frontier[index]=frontier[frontier.length-1];frontier.pop();
    const id=cellKey(edge.nx,edge.ny);if(seen.has(id))continue;
    seen.add(id);tiles[(edge.y+edge.ny)/2][(edge.x+edge.nx)/2]=0;tiles[edge.ny][edge.nx]=0;
    addFrontier(edge.nx,edge.ny);
  }
  const portals = portalsFor(seed, cx, cy);
  carveLine(tiles, portals.north, 0, portals.north, 1);
  carveLine(tiles, portals.south, 15, portals.south, 13);
  carveLine(tiles, 0, portals.west, 1, portals.west);
  carveLine(tiles, 15, portals.east, 13, portals.east);
  return { cx, cy, epoch, tiles, lastTouched: 0 };
}

export class InfiniteWorld {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.chunks = new Map();
    this.epochs = new Map();
    this.pinnedChunks = new Map();
  }
  coords(x, y) {
    return { cx: floorDiv(x, CHUNK_SIZE), cy: floorDiv(y, CHUNK_SIZE), lx: mod(x, CHUNK_SIZE), ly: mod(y, CHUNK_SIZE) };
  }
  getChunk(cx, cy, tick = 0) {
    const id = chunkKey(cx, cy);
    let chunk = this.chunks.get(id);
    if (!chunk) {
      chunk = generateChunk(this.seed, cx, cy, this.epochs.get(id) ?? 0);
      this.chunks.set(id, chunk);
    }
    chunk.lastTouched = tick;
    return chunk;
  }
  tile(x, y, tick = 0) {
    const { cx, cy, lx, ly } = this.coords(x, y);
    return this.getChunk(cx, cy, tick).tiles[ly][lx];
  }
  ensureAround(x, y, tick = 0) {
    const { cx, cy } = this.coords(x, y);
    for (let oy = -CACHE_RADIUS; oy <= CACHE_RADIUS; oy++) {
      for (let ox = -CACHE_RADIUS; ox <= CACHE_RADIUS; ox++) this.getChunk(cx + ox, cy + oy, tick);
    }
  }
  pinChunk(id) {
    this.pinnedChunks.set(id, (this.pinnedChunks.get(id) ?? 0) + 1);
  }
  unpinChunk(id) {
    const count = this.pinnedChunks.get(id) ?? 0;
    if (count <= 1) this.pinnedChunks.delete(id);
    else this.pinnedChunks.set(id, count - 1);
  }
  prune(x, y, protectedChunks = new Set(), tick = 0) {
    const { cx, cy } = this.coords(x, y);
    for (const [id, chunk] of this.chunks) {
      const far = Math.abs(chunk.cx - cx) > CACHE_RADIUS || Math.abs(chunk.cy - cy) > CACHE_RADIUS;
      if (far && !protectedChunks.has(id) && !this.pinnedChunks.has(id)) {
        if (tick - chunk.lastTouched > 20) this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
        this.chunks.delete(id);
      }
    }
  }
}

export function createThemeScheduler(seed) {
  const random = seededRandom(hash32(seed, "themes"));
  let bag = [];
  const refill = () => {
    bag = [...THEME_IDS];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  };
  refill();
  return {
    nextAt: 25 + Math.floor(random() * 16),
    nextTheme() { if (!bag.length) refill(); return bag.pop(); },
    advance(from) { this.nextAt = from + 25 + Math.floor(random() * 16); },
  };
}

export function connectedTileCount(chunk) {
  const starts = [];
  for (let y = 0; y < CHUNK_SIZE; y++) for (let x = 0; x < CHUNK_SIZE; x++) if (chunk.tiles[y][x] === 0) starts.push({x,y});
  if (!starts.length) return 0;
  const seen = new Set([cellKey(starts[0].x, starts[0].y)]), queue = [starts[0]];
  while (queue.length) {
    const p = queue.shift();
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const x=p.x+dx,y=p.y+dy,id=cellKey(x,y);
      if (chunk.tiles[y]?.[x]===0&&!seen.has(id)){seen.add(id);queue.push({x,y});}
    }
  }
  return seen.size;
}

export function chunkTopology(chunk) {
  let deadEnds=0,corridors=0,junctions=0,logicalCells=0;
  for(let y=1;y<15;y+=2)for(let x=1;x<15;x+=2){
    if(chunk.tiles[y][x]!==0)continue;logicalCells++;
    const degree=[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>chunk.tiles[y+dy]?.[x+dx]===0).length;
    if(degree===1)deadEnds++;else if(degree===2)corridors++;else if(degree>=3)junctions++;
  }
  return{logicalCells,deadEnds,corridors,junctions};
}
