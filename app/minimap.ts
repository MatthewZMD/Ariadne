import { CAMERA_FOV } from "./camera.ts";
import { cellKey, chunkKey, type InfiniteWorld } from "./world.mjs";
import type { Pose } from "./renderer";
import type { StarObjective } from "./objectives";

export const MINIMAP_SIGHT_DISTANCE = 10;
export const MINIMAP_BRANCH_SKIM_MAX_CELLS = 3;
const MAP_RADIUS = 10.5;

export type MinimapCell = {
  tile: number;
  chunkId: string;
  source: "glimpsed" | "seen" | "traversed";
  clarity: number;
};

export type MinimapMemory = Map<string, MinimapCell>;

export function createMinimapMemory(): MinimapMemory {
  return new Map();
}

export function recordTraversedCell(memory: MinimapMemory, world: InfiniteWorld, x: number, y: number, tick = 0) {
  const coords = world.coords(x, y);
  memory.set(cellKey(x, y), { tile: world.tile(x, y, tick), chunkId: chunkKey(coords.cx, coords.cy), source: "traversed", clarity: 1 });
}

export function observeMinimap(
  memory: MinimapMemory,
  world: InfiniteWorld,
  pose: Pick<Pose, "x" | "y">,
  tick: number,
  visibleCells: Array<[number, number]>,
  maxDistance = MINIMAP_SIGHT_DISTANCE,
  visibleJunctions: Array<{ cell: [number, number]; open: string[] }> = [],
) {
  const rememberSeen=(x:number,y:number)=>{
    if (Math.hypot(x + .5 - pose.x, y + .5 - pose.y) > maxDistance + .7) return;
    const key = cellKey(x, y), existing = memory.get(key), coords = world.coords(x, y);
    memory.set(key, {
      tile: world.tile(x, y, tick),
      chunkId: chunkKey(coords.cx, coords.cy),
      source: existing?.source === "traversed" ? "traversed" : "seen",
      clarity: 1,
    });
  };
  const rememberGlimpse=(x:number,y:number,clarity:number)=>{
    if(Math.hypot(x+.5-pose.x,y+.5-pose.y)>maxDistance+.7)return;
    const key=cellKey(x,y),existing=memory.get(key);
    if(existing?.source==="traversed"||existing?.source==="seen")return;
    const coords=world.coords(x,y);
    memory.set(key,{tile:world.tile(x,y,tick),chunkId:chunkKey(coords.cx,coords.cy),source:"glimpsed",clarity:Math.max(existing?.clarity??0,clarity)});
  };
  for (const [x, y] of visibleCells) rememberSeen(x,y);

  // Peripheral branch awareness is a tapered skim, not a binary route reveal.
  // A distant junction exposes only its entrance; as MT comes closer, another
  // faint cell or two becomes legible before the trace dissolves into fog.
  for(const junction of visibleJunctions){
    const [jx,jy]=junction.cell;
    const junctionDistance=Math.hypot(jx+.5-pose.x,jy+.5-pose.y);
    if(junctionDistance>maxDistance+.7)continue;
    rememberSeen(jx,jy);
    const proximity=1-Math.min(1,junctionDistance/Math.max(1,maxDistance));
    const skimCells=Math.max(1,Math.min(MINIMAP_BRANCH_SKIM_MAX_CELLS,1+Math.floor(proximity*MINIMAP_BRANCH_SKIM_MAX_CELLS)));
    for(const encoded of junction.open){
      const [nx,ny]=encoded.split(",").map(Number);
      if(!Number.isInteger(nx)||!Number.isInteger(ny))continue;
      const dx=nx-jx,dy=ny-jy;
      if(Math.abs(dx)+Math.abs(dy)!==1)continue;
      for(let step=1;step<=skimCells;step++){
        const x=jx+dx*step,y=jy+dy*step;
        if(world.tile(x,y,tick)!==0)break;
        const taper=1-step/(skimCells+1);
        rememberGlimpse(x,y,.16+taper*(.28+proximity*.22));
      }
    }
  }
}

export function forgetMinimapChunks(memory: MinimapMemory, removedChunkIds: Iterable<string>) {
  const removed = new Set(removedChunkIds);
  if (!removed.size) return;
  for (const [key, value] of memory) if (removed.has(value.chunkId)) memory.delete(key);
}

export function minimapOffset(dx: number, dy: number, angle: number, scale = 1) {
  const rotation = -angle - Math.PI / 2;
  return [
    (dx * Math.cos(rotation) - dy * Math.sin(rotation)) * scale,
    (dx * Math.sin(rotation) + dy * Math.cos(rotation)) * scale,
  ] as const;
}

export function minimapStarOffset(memory: MinimapMemory, pose: Pick<Pose, "x" | "y" | "angle">, star: StarObjective | null, scale = 1) {
  if (!star?.seen || !memory.has(cellKey(star.cell[0], star.cell[1]))) return null;
  const dx = star.cell[0] + .5 - pose.x, dy = star.cell[1] + .5 - pose.y;
  if (Math.hypot(dx, dy) > MAP_RADIUS) return null;
  return minimapOffset(dx, dy, pose.angle, scale);
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  for (let point = 0; point < 10; point++) {
    const angle = -Math.PI / 2 + point * Math.PI / 5, distance = point % 2 === 0 ? radius : radius * .42;
    const px = x + Math.cos(angle) * distance, py = y + Math.sin(angle) * distance;
    if (point === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

export function renderMinimap(ctx: CanvasRenderingContext2D, memory: MinimapMemory, pose: Pick<Pose, "x" | "y" | "angle">, activeStar: StarObjective | null = null) {
  const size = Math.round(Math.max(84, Math.min(116, ctx.canvas.width * .135)));
  const left = ctx.canvas.width - size - 12, top = 12, centerX = left + size / 2, centerY = top + size / 2;
  const scale = size / (MAP_RADIUS * 2 + 1);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(3, 7, 8, .82)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2 - 2, 0, Math.PI * 2);
  ctx.clip();

  // A fixed, finite cone makes the map's perceptual limit legible. Because the
  // map rotates around MT, the current view always points toward its top edge.
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.arc(centerX, centerY, MINIMAP_SIGHT_DISTANCE * scale, -Math.PI / 2 - CAMERA_FOV / 2, -Math.PI / 2 + CAMERA_FOV / 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(151, 229, 221, .045)";
  ctx.fill();

  for (const [key, cell] of memory) {
    const [x, y] = key.split(",").map(Number), dx = x + .5 - pose.x, dy = y + .5 - pose.y;
    if (Math.hypot(dx, dy) > MAP_RADIUS + 1.4) continue;
    const [screenX, screenY] = minimapOffset(dx, dy, pose.angle, scale);
    ctx.save();
    ctx.translate(centerX + screenX, centerY + screenY);
    ctx.rotate(-pose.angle - Math.PI / 2);
    if (cell.tile !== 0) ctx.fillStyle = "rgba(78, 94, 92, .72)";
    else if (cell.source === "traversed") ctx.fillStyle = "rgba(190, 238, 226, .9)";
    else if(cell.source==="seen")ctx.fillStyle = "rgba(93, 139, 132, .62)";
    else ctx.fillStyle = `rgba(93, 139, 132, ${Math.max(.12,Math.min(.48,cell.clarity))})`;
    const inset = cell.tile === 0 ? cell.source==="glimpsed"?1.05:.7 : .25;
    ctx.fillRect(-scale / 2 + inset, -scale / 2 + inset, Math.max(1, scale - inset * 2), Math.max(1, scale - inset * 2));
    ctx.restore();
  }

  const starOffset = minimapStarOffset(memory, pose, activeStar, scale);
  if (starOffset) {
    ctx.save();
    ctx.fillStyle = "#ffd95e";
    ctx.shadowColor = "rgba(255, 210, 73, .95)";
    ctx.shadowBlur = 7;
    drawStar(ctx, centerX + starOffset[0], centerY + starOffset[1], Math.max(3.5, scale * .78));
    ctx.restore();
  }

  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "rgba(194, 226, 218, .55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2 - .5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#f2cf69";
  ctx.shadowColor = "rgba(242, 207, 105, .85)";
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - 6);
  ctx.lineTo(centerX - 4, centerY + 5);
  ctx.lineTo(centerX + 4, centerY + 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
