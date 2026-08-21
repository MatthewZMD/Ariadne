export const CHUNK_SIZE: number;
export const CACHE_RADIUS: number;
export const THEME_IDS: string[];
export const floorDiv: (n:number,d:number)=>number;
export const mod: (n:number,d:number)=>number;
export const cellKey: (x:number,y:number)=>string;
export const chunkKey: (x:number,y:number)=>string;
export function hash32(...values: unknown[]): number;
export function seededRandom(seed:number):()=>number;
export function portalsFor(seed:number,cx:number,cy:number):{north:number;south:number;west:number;east:number};
export type WorldChunk={cx:number;cy:number;epoch:number;tiles:number[][];lastTouched:number};
export function generateChunk(seed:number,cx:number,cy:number,epoch?:number):WorldChunk;
export class InfiniteWorld {
  seed:number; chunks:Map<string,WorldChunk>; epochs:Map<string,number>; pinnedChunks:Map<string,number>;
  constructor(seed:number);
  coords(x:number,y:number):{cx:number;cy:number;lx:number;ly:number};
  getChunk(cx:number,cy:number,tick?:number):WorldChunk;
  tile(x:number,y:number,tick?:number):number;
  ensureAround(x:number,y:number,tick?:number):void;
  pinChunk(id:string):void;
  unpinChunk(id:string):void;
  prune(x:number,y:number,protectedChunks?:Set<string>,tick?:number):void;
}
export type ThemeScheduler={nextAt:number;nextTheme:()=>string;advance:(from:number)=>void};
export function createThemeScheduler(seed:number):ThemeScheduler;
export function connectedTileCount(chunk:WorldChunk):number;
export function chunkTopology(chunk:WorldChunk):{logicalCells:number;deadEnds:number;corridors:number;junctions:number};
