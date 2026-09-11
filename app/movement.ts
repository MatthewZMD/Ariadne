export type InputRamp={heldSeconds:number;direction:-1|0|1};

export const MOVE_ACCELERATION={minimum:1.65,maximum:2.65,rampSeconds:2.1} as const;
export const TURN_ACCELERATION={minimum:1.15,maximum:2.05,rampSeconds:1.45} as const;

const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const smoothstep=(value:number)=>{const t=clamp01(value);return t*t*(3-2*t)};

export function advanceInputRamp(previous:InputRamp,axis:number,deltaSeconds:number,capSeconds:number):InputRamp{
  const direction=axis<0?-1:axis>0?1:0;
  if(direction===0)return{heldSeconds:0,direction:0};
  const heldSeconds=previous.direction===direction?previous.heldSeconds+Math.max(0,deltaSeconds):Math.max(0,deltaSeconds);
  return{heldSeconds:Math.min(capSeconds,heldSeconds),direction};
}

export function acceleratedSpeed(ramp:InputRamp,curve:{minimum:number;maximum:number;rampSeconds:number}){
  return curve.minimum+(curve.maximum-curve.minimum)*smoothstep(ramp.heldSeconds/curve.rampSeconds);
}
