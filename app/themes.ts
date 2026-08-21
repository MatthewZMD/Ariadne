export type ThemeId = "neutral" | "beach" | "tornado" | "ruins" | "frozen" | "foundry" | "cavern";
export type ThemeAnchor = { x: number; y: number; theme: ThemeId; bornAt: number; triggered: boolean };
export type AmbientEntity = { id:string; x: number; y: number; kind: string; theme: ThemeId; phase: number; scale: number };
export type ThemeLayer = { id: ThemeId; influence: number };
export type ThemeSample = { id: ThemeId; influence: number; layers: ThemeLayer[] };
export type ThemeMemory = Map<string, ThemeSample>;
export type ThemeDefinition = {
  wall: [number, number, number]; floor: string; ceiling: string; fog: string;
  floorDetail: string; skyDetail: string; accent: string; props: string[]; life: string[]; wallSprites: string[]; signal: string;
};

export const THEME_RADIUS = 38;
export const THEME_FEATHER = 32;

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  neutral: { wall:[42,14,43], floor:"#24251f", ceiling:"#111411", floorDetail:"#49483d", skyDetail:"#30352f", fog:"rgba(6,8,7,.42)", accent:"#aaa58d", props:["rune","fossil"], life:["mote"], wallSprites:["eye-rune","spiral-fossil","sealed-door"], signal:"THE AIR FORGETS YOUR SHAPE" },
  beach: { wall:[191,25,57], floor:"#62543a", ceiling:"#607b80", floorDetail:"#b69b61", skyDetail:"#c8d9cf", fog:"rgba(92,129,130,.18)", accent:"#e4c984", props:["shell","grass","driftwood"], life:["crab","ripple"], wallSprites:["porthole","sun-tile","fish-mosaic","tide-mark"], signal:"SALT GATHERS ON THE SIGNAL" },
  tornado: { wall:[214,10,40], floor:"#35342f", ceiling:"#20252b", floorDetail:"#75683e", skyDetail:"#555b60", fog:"rgba(82,83,78,.32)", accent:"#d2b55e", props:["warning","fence","debris"], life:["tumbleweed","dust"], wallSprites:["warning-panel","wind-arrow","broken-window","storm-gauge"], signal:"PRESSURE FALLS BEHIND THE WALLS" },
  ruins: { wall:[91,26,39], floor:"#293322", ceiling:"#18231a", floorDetail:"#567044", skyDetail:"#45643c", fog:"rgba(49,78,45,.22)", accent:"#8fc66d", props:["vine","statue","fungus"], life:["firefly","frog"], wallSprites:["stone-face","vine-relief","sun-disc","root-window"], signal:"ROOTS REMEMBER ANOTHER FLOORPLAN" },
  frozen: { wall:[201,25,61], floor:"#39494e", ceiling:"#1d2c35", floorDetail:"#9ccbd3", skyDetail:"#b9e2e8", fog:"rgba(154,203,219,.22)", accent:"#c6eff4", props:["shelf","icicle","paper"], life:["moth","page"], wallSprites:["bookcase","frost-window","archive-number","ice-crack"], signal:"PAPER TURNS IN A WINDLESS ROOM" },
  foundry: { wall:[10,34,35], floor:"#2c211c", ceiling:"#1a1110", floorDetail:"#79432b", skyDetail:"#84351f", fog:"rgba(92,38,21,.27)", accent:"#f0934e", props:["pipe","vent","slag"], life:["ember","spark"], wallSprites:["pipe-bank","furnace-door","pressure-dial","hazard-grid"], signal:"HEAT MOVES THROUGH SEALED STONE" },
  cavern: { wall:[269,28,39], floor:"#202233", ceiling:"#111224", floorDetail:"#416d78", skyDetail:"#55b8ac", fog:"rgba(45,35,91,.24)", accent:"#75e1d1", props:["crystal","mushroom","spore"], life:["glowmoth","mote"], wallSprites:["crystal-vein","spore-glyph","cave-eye","mushroom-shelf"], signal:"SOMETHING SMALL ANSWERS IN LIGHT" },
};

export function themeLayersAt(anchors: ThemeAnchor[], x: number, y: number) {
  const layers=anchors.map(anchor=>{
    const distance=Math.hypot(x-anchor.x,y-anchor.y),raw=Math.max(0,Math.min(1,(THEME_RADIUS-distance)/THEME_FEATHER));
    return{id:anchor.theme,influence:raw*raw*(3-2*raw)};
  }).filter(layer=>layer.influence>0).sort((a,b)=>b.influence-a.influence);
  const total=layers.reduce((sum,layer)=>sum+layer.influence,0),scale=total>1?1/total:1;
  return layers.map(layer=>({...layer,influence:layer.influence*scale}));
}

export function themeAt(anchors: ThemeAnchor[], x: number, y: number) {
  const layers=themeLayersAt(anchors,x,y),best=layers[0];
  return { id: best?.id ?? "neutral" as ThemeId, influence: best?.influence ?? 0, layers };
}

export function rememberedThemeAt(anchors:ThemeAnchor[],memory:ThemeMemory,x:number,y:number,remember=true){
  const key=`${Math.floor(x)},${Math.floor(y)}`,stored=memory.get(key);if(stored)return stored;
  const sample=themeAt(anchors,x,y);if(remember)memory.set(key,sample);return sample;
}

export function retainThemeMemory(memory:ThemeMemory,protectedCells:Set<string>){
  for(const key of memory.keys())if(!protectedCells.has(key))memory.delete(key);
}
