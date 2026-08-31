// Junction episodes begin only when MT is near the junction. Fourteen cells
// leave more than five seconds of maximum-speed travel between adjacent
// choices without turning the maze into an empty hallway simulator.
export const LOGICAL_SPACING = 14;
export const CHUNK_SIZE = LOGICAL_SPACING * 3 + 4;
export const CACHE_RADIUS = 3;
const LOGICAL_MIN = 1;
const LOGICAL_MAX = CHUNK_SIZE - 3;
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
  const positions = Math.floor((LOGICAL_MAX - LOGICAL_MIN) / LOGICAL_SPACING) + 1;
  return LOGICAL_MIN + LOGICAL_SPACING * (hash32(seed, "edge", axis, a, b) % positions);
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

export function generateChunk(seed, cx, cy) {
  // A run is a place, not a succession of disposable layouts. A pruned chunk
  // must therefore reconstruct from the run seed and its coordinate alone.
  const random = seededRandom(hash32(seed, cx, cy));
  const tiles = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(1));
  const seen = new Set([cellKey(1, 1)]), frontier = [];
  const addFrontier = (x, y) => {
    for (const [dx,dy] of [[LOGICAL_SPACING,0],[-LOGICAL_SPACING,0],[0,LOGICAL_SPACING],[0,-LOGICAL_SPACING]]) {
      const nx=x+dx,ny=y+dy;
      if(nx>=LOGICAL_MIN&&ny>=LOGICAL_MIN&&nx<=LOGICAL_MAX&&ny<=LOGICAL_MAX&&!seen.has(cellKey(nx,ny)))frontier.push({x,y,nx,ny});
    }
  };
  tiles[1][1] = 0;
  addFrontier(1,1);
  while(frontier.length){
    const index=Math.floor(random()*frontier.length),edge=frontier[index];
    frontier[index]=frontier[frontier.length-1];frontier.pop();
    const id=cellKey(edge.nx,edge.ny);if(seen.has(id))continue;
    seen.add(id);carveLine(tiles,edge.x,edge.y,edge.nx,edge.ny);
    addFrontier(edge.nx,edge.ny);
  }
  // A perfect maze is mathematically connected but experientially brittle:
  // every mistake can only be repaired by retracing the same corridor. Braid
  // a few deterministic logical edges so each streamed region contains real
  // alternate routes and reconnections. Logical spacing is unchanged, so the
  // extra choices do not arrive faster than Ariadne can perceive them.
  const logicalDegree=(x,y)=>[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>tiles[y+dy]?.[x+dx]===0).length;
  const braidCandidates=[];
  for(let y=LOGICAL_MIN;y<=LOGICAL_MAX;y+=LOGICAL_SPACING)for(let x=LOGICAL_MIN;x<=LOGICAL_MAX;x+=LOGICAL_SPACING){
    for(const[dx,dy]of[[LOGICAL_SPACING,0],[0,LOGICAL_SPACING]]){
      const nx=x+dx,ny=y+dy;if(nx>LOGICAL_MAX||ny>LOGICAL_MAX)continue;
      if(tiles[y+Math.sign(dy)]?.[x+Math.sign(dx)]===0)continue;
      braidCandidates.push({x,y,nx,ny,tie:random()});
    }
  }
  const braidTarget=1+(hash32(seed,"braids",cx,cy)%2);
  braidCandidates.sort((a,b)=>{
    const aNeed=(logicalDegree(a.x,a.y)===1?2:0)+(logicalDegree(a.nx,a.ny)===1?2:0),bNeed=(logicalDegree(b.x,b.y)===1?2:0)+(logicalDegree(b.nx,b.ny)===1?2:0);
    return bNeed-aNeed||a.tie-b.tie;
  });
  let braided=0;
  for(const edge of braidCandidates){
    if(braided>=braidTarget)break;
    if(logicalDegree(edge.x,edge.y)>=3||logicalDegree(edge.nx,edge.ny)>=3)continue;
    carveLine(tiles,edge.x,edge.y,edge.nx,edge.ny);braided++;
  }
  const portals = portalsFor(seed, cx, cy);
  carveLine(tiles, portals.north, 0, portals.north, 1);
  carveLine(tiles, portals.south, CHUNK_SIZE - 1, portals.south, LOGICAL_MAX);
  carveLine(tiles, 0, portals.west, 1, portals.west);
  carveLine(tiles, CHUNK_SIZE - 1, portals.east, LOGICAL_MAX, portals.east);
  return { cx, cy, tiles, lastTouched: 0 };
}

export class InfiniteWorld {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.chunks = new Map();
    this.pinnedChunks = new Map();
    this.tileOverrides = new Map();
    this.entranceGate = null;
    this.entranceOverrideKeys = new Set();
    this.entranceChunks = new Set();
  }
  coords(x, y) {
    return { cx: floorDiv(x, CHUNK_SIZE), cy: floorDiv(y, CHUNK_SIZE), lx: mod(x, CHUNK_SIZE), ly: mod(y, CHUNK_SIZE) };
  }
  getChunk(cx, cy, tick = 0) {
    const id = chunkKey(cx, cy);
    let chunk = this.chunks.get(id);
    if (!chunk) {
      chunk = generateChunk(this.seed, cx, cy);
      this.chunks.set(id, chunk);
    }
    chunk.lastTouched = tick;
    return chunk;
  }
  tile(x, y, tick = 0) {
    const override = this.tileOverrides.get(cellKey(x, y));
    if (override !== undefined) return override;
    const { cx, cy, lx, ly } = this.coords(x, y);
    return this.getChunk(cx, cy, tick).tiles[ly][lx];
  }
  setEntranceGate(insideX, insideY, forwardX, forwardY) {
    const gateX = insideX - Math.sign(forwardX), gateY = insideY - Math.sign(forwardY);
    this.tileOverrides.set(cellKey(gateX, gateY), 1);
    this.entranceOverrideKeys.add(cellKey(gateX, gateY));
    this.entranceGate = { inside: [insideX, insideY], cell: [gateX, gateY], facing: [Math.sign(forwardX), Math.sign(forwardY)] };
    return this.entranceGate;
  }
  setEntranceCorridor(insideX, insideY, forwardX, forwardY, minimumLength = LOGICAL_SPACING + 12) {
    const dx = Math.sign(forwardX), dy = Math.sign(forwardY);
    if (Math.abs(dx) + Math.abs(dy) !== 1) throw new Error("entrance corridor requires one cardinal facing direction");
    const requestedLength = Math.max(1, Math.floor(minimumLength));
    const sideX = -dy, sideY = dx;
    // Do not end the authored entrance at an isolated carved cell. Find an
    // existing maze cell that has a natural way onward, then join the sealed
    // approach corridor to it. The default begins beyond the camera range so a
    // new run cannot present MT with a wall filling the opening view.
    let corridorLength = requestedLength,firstContinuingLength=null,foundBranch=false;
    for (let step = requestedLength; step <= requestedLength + CHUNK_SIZE * 3; step++) {
      const x = insideX + dx * step, y = insideY + dy * step;
      if (this.tile(x, y) !== 0) continue;
      const onward = [[1,0],[-1,0],[0,1],[0,-1]].filter(([nx,ny]) => !(nx === -dx && ny === -dy)&&this.tile(x + nx, y + ny) === 0);
      if(onward.length>0&&firstContinuingLength===null)firstContinuingLength=step;
      // Joining a single continuation can strand the whole opening on a
      // dangling arm: MT walks to its end and can only retrace the entrance.
      // Require a genuine decision so every new run opens into the maze.
      if (onward.length >= 2) { corridorLength = step;foundBranch=true;break; }
    }
    if(!foundBranch&&firstContinuingLength!==null)corridorLength=firstContinuingLength;
    const gate = this.setEntranceGate(insideX, insideY, dx, dy);
    for (let step = 0; step <= corridorLength; step++) {
      const x = insideX + dx * step, y = insideY + dy * step;
      this.tileOverrides.set(cellKey(x, y), 0);this.entranceOverrideKeys.add(cellKey(x,y));this.entranceChunks.add(chunkKey(this.coords(x,y).cx,this.coords(x,y).cy));
      if (step < corridorLength) {
        this.tileOverrides.set(cellKey(x + sideX, y + sideY), 1);this.entranceOverrideKeys.add(cellKey(x+sideX,y+sideY));
        this.tileOverrides.set(cellKey(x - sideX, y - sideY), 1);this.entranceOverrideKeys.add(cellKey(x-sideX,y-sideY));
      }
    }
    gate.exit = [insideX + dx * corridorLength, insideY + dy * corridorLength];
    return gate;
  }
  isEntranceGate(x, y) {
    return this.entranceGate?.cell[0] === x && this.entranceGate?.cell[1] === y;
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
  prune(x, y, protectedChunks = new Set()) {
    const removed = [];
    const { cx, cy } = this.coords(x, y);
    if(this.entranceGate){const start=this.coords(this.entranceGate.inside[0],this.entranceGate.inside[1]),leftStartRegion=Math.abs(start.cx-cx)>CACHE_RADIUS||Math.abs(start.cy-cy)>CACHE_RADIUS;if(leftStartRegion){for(const key of this.entranceOverrideKeys)this.tileOverrides.delete(key);this.entranceOverrideKeys.clear();this.entranceChunks.clear();this.entranceGate=null}}
    for (const [id, chunk] of this.chunks) {
      const far = Math.abs(chunk.cx - cx) > CACHE_RADIUS || Math.abs(chunk.cy - cy) > CACHE_RADIUS;
      if (far && !protectedChunks.has(id) && !this.pinnedChunks.has(id)) {
        this.chunks.delete(id);
        removed.push(id);
      }
    }
    return removed;
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
  let deadEnds=0,corridors=0,junctions=0,logicalCells=0,logicalEdges=0;
  for(let y=LOGICAL_MIN;y<=LOGICAL_MAX;y+=LOGICAL_SPACING)for(let x=LOGICAL_MIN;x<=LOGICAL_MAX;x+=LOGICAL_SPACING){
    if(chunk.tiles[y][x]!==0)continue;logicalCells++;
    const degree=[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>chunk.tiles[y+dy]?.[x+dx]===0).length;
    if(degree===1)deadEnds++;else if(degree===2)corridors++;else if(degree>=3)junctions++;
    if(x+LOGICAL_SPACING<=LOGICAL_MAX&&chunk.tiles[y][x+1]===0)logicalEdges++;
    if(y+LOGICAL_SPACING<=LOGICAL_MAX&&chunk.tiles[y+1][x]===0)logicalEdges++;
  }
  return{logicalCells,deadEnds,corridors,junctions,cycleRank:Math.max(0,logicalEdges-logicalCells+1)};
}
