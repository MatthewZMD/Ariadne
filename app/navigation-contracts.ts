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
  openingOrdinal?:number;
  sameSideOpeningCount?:number;
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

const ordinalWords=["","first","second","third","fourth","fifth","sixth","seventh","eighth","ninth","tenth","eleventh","twelfth"];

export function openingOrdinalWord(ordinal:number){
  return ordinalWords[ordinal]??`${ordinal}th`;
}

function mentionedOpeningOrdinals(message:string){
  const found=new Set<number>();
  ordinalWords.slice(1).forEach((word,index)=>{
    if(new RegExp(`\\b${word}\\s+(?:opening|passage|branch|door|way)\\b`,"i").test(message))found.add(index+1);
  });
  for(const match of message.matchAll(/\b(\d+)(?:st|nd|rd|th)\s+(?:opening|passage|branch|door|way)\b/gi))found.add(Number(match[1]));
  return found;
}

export function messageIdentifiesRoute(message:string,route:RouteOption){
  if(!mentionedDirections(message).has(route.direction))return false;
  if(!route.openingOrdinal)return true;
  return mentionedOpeningOrdinals(message).has(route.openingOrdinal);
}

export function messageConflictsWithRoute(message:string,route:RouteOption){
  if(messageConflictsWithDirection(message,route.direction))return true;
  if(!route.openingOrdinal)return false;
  const ordinals=mentionedOpeningOrdinals(message);
  return ordinals.size>0&&!ordinals.has(route.openingOrdinal);
}
