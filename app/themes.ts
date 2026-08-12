export type ThemeId = "neutral" | "beach" | "tornado" | "ruins" | "frozen" | "foundry" | "cavern";
export type ThemeAnchor = { x: number; y: number; theme: ThemeId; bornAt: number };
export type AmbientEntity = { x: number; y: number; kind: string; theme: ThemeId; phase: number; scale: number };
export type ThemeDefinition = {
  wall: [number, number, number]; floor: string; ceiling: string; fog: string;
  accent: string; props: string[]; life: string[]; signal: string;
};

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  neutral: { wall:[42,14,43], floor:"#24251f", ceiling:"#111411", fog:"rgba(6,8,7,.42)", accent:"#aaa58d", props:["rune","fossil"], life:["mote"], signal:"THE AIR FORGETS YOUR SHAPE" },
  beach: { wall:[191,25,57], floor:"#62543a", ceiling:"#607b80", fog:"rgba(92,129,130,.18)", accent:"#e4c984", props:["shell","grass","driftwood"], life:["crab","ripple"], signal:"SALT GATHERS ON THE SIGNAL" },
  tornado: { wall:[214,10,40], floor:"#35342f", ceiling:"#20252b", fog:"rgba(82,83,78,.32)", accent:"#d2b55e", props:["warning","fence","debris"], life:["tumbleweed","dust"], signal:"PRESSURE FALLS BEHIND THE WALLS" },
  ruins: { wall:[91,26,39], floor:"#293322", ceiling:"#18231a", fog:"rgba(49,78,45,.22)", accent:"#8fc66d", props:["vine","statue","fungus"], life:["firefly","frog"], signal:"ROOTS REMEMBER ANOTHER FLOORPLAN" },
  frozen: { wall:[201,25,61], floor:"#39494e", ceiling:"#1d2c35", fog:"rgba(154,203,219,.22)", accent:"#c6eff4", props:["shelf","icicle","paper"], life:["moth","page"], signal:"PAPER TURNS IN A WINDLESS ROOM" },
  foundry: { wall:[10,34,35], floor:"#2c211c", ceiling:"#1a1110", fog:"rgba(92,38,21,.27)", accent:"#f0934e", props:["pipe","vent","slag"], life:["ember","spark"], signal:"HEAT MOVES THROUGH SEALED STONE" },
  cavern: { wall:[269,28,39], floor:"#202233", ceiling:"#111224", fog:"rgba(45,35,91,.24)", accent:"#75e1d1", props:["crystal","mushroom","spore"], life:["glowmoth","mote"], signal:"SOMETHING SMALL ANSWERS IN LIGHT" },
};

export function themeAt(anchors: ThemeAnchor[], x: number, y: number) {
  let best: ThemeAnchor | null = null, bestDistance = Infinity;
  for (const anchor of anchors) {
    const distance = Math.hypot(x - anchor.x, y - anchor.y);
    if (distance < 13 && distance < bestDistance) { best = anchor; bestDistance = distance; }
  }
  return { id: best?.theme ?? "neutral", influence: best ? Math.max(0, Math.min(1, (13 - bestDistance) / 5)) : 0 };
}
