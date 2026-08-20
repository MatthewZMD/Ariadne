export type Point=[number,number];

export type RouteDirection="left"|"right"|"straight"|"back";

export type RouteOption={
  id:string;
  direction:RouteDirection;
  knownCells:Point[];
  targetCell:Point|null;
  targetRegionId:string|null;
  description:string;
  instruction:string;
  score:number;
  decisionPoint?:"current"|"upcoming";
  decisionCell?:Point;
};

export function mentionedDirections(message:string){
  const found=new Set<RouteDirection>();
  if(/\b(?:turn|go|take|veer|head)\s+(?:(?:to|on)\s+)?(?:your\s+|the\s+)?left\b|\b(?:opening|passage|branch|door|way)\s+(?:on\s+)?(?:your\s+|the\s+)?left\b|\bon your left\b|\bleft-hand\b/i.test(message))found.add("left");
  if(/\b(?:turn|go|take|veer|head)\s+(?:(?:to|on)\s+)?(?:your\s+|the\s+)?right\b|\b(?:opening|passage|branch|door|way)\s+(?:on\s+)?(?:your\s+|the\s+)?right\b|\bon your right\b|\bright-hand\b/i.test(message))found.add("right");
  if(/\b(turn around|go back|head back|behind you|backtrack)\b/i.test(message))found.add("back");
  if(/\b(ahead|straight|keep going|continue forward|head forward)\b/i.test(message))found.add("straight");
  return found;
}

export function messageConflictsWithDirection(message:string,direction:RouteDirection){
  const mentioned=mentionedDirections(message);
  return mentioned.size>0&&([...mentioned].some(item=>item!==direction)||!mentioned.has(direction));
}
