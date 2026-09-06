export type GreetingDelay={hasMoved:boolean;elapsed:number};
export function advanceGreetingDelay(state:GreetingDelay,translated:number,deltaSeconds:number,active:boolean):GreetingDelay{
  if(!active)return state;
  const hasMoved=state.hasMoved||translated>.0005;
  return{hasMoved,elapsed:hasMoved?Math.min(2,state.elapsed+Math.max(0,Math.min(.1,deltaSeconds))):0};
}
export function greetingDue(state:GreetingDelay){return state.hasMoved&&state.elapsed>=2}
