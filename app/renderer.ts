import { hash32, type InfiniteWorld } from "./world.mjs";
import { THEMES, themeAt, type AmbientEntity, type ThemeAnchor } from "./themes";

export type Pose = { x:number; y:number; angle:number; bob:number };
type Ray = {distance:number;mapX:number;mapY:number;side:number;u:number};
const FOV=Math.PI/3, RAYS=360;
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
function rgb(hex:string){const value=parseInt(hex.slice(1),16);return[(value>>16)&255,(value>>8)&255,value&255]}
function blendHex(a:string,b:string,t:number){const aa=rgb(a),bb=rgb(b);return`rgb(${aa.map((v,i)=>Math.round(mix(v,bb[i],t))).join(",")})`}

function cast(world:InfiniteWorld,pose:Pose,angle:number,tick:number):Ray{
  const rx=Math.cos(angle),ry=Math.sin(angle);let mx=Math.floor(pose.x),my=Math.floor(pose.y);
  const dx=Math.abs(1/(rx||.00001)),dy=Math.abs(1/(ry||.00001));
  const sx=rx<0?-1:1,sy=ry<0?-1:1;
  let tx=rx<0?(pose.x-mx)*dx:(mx+1-pose.x)*dx,ty=ry<0?(pose.y-my)*dy:(my+1-pose.y)*dy,side=0;
  for(let i=0;i<64;i++){if(tx<ty){tx+=dx;mx+=sx;side=0}else{ty+=dy;my+=sy;side=1}if(world.tile(mx,my,tick)!==0)break;}
  const distance=side===0?(mx-pose.x+(1-sx)/2)/rx:(my-pose.y+(1-sy)/2)/ry;
  const hit=side===0?pose.y+distance*ry:pose.x+distance*rx;
  return{distance:Math.max(distance,.01),mapX:mx,mapY:my,side,u:hit-Math.floor(hit)};
}

function sprite(ctx:CanvasRenderingContext2D,x:number,y:number,size:number,kind:string,color:string,time:number,phase:number){
  const unit=Math.max(1,Math.floor(size/7));ctx.save();ctx.translate(Math.round(x),Math.round(y));
  ctx.fillStyle="rgba(5,7,6,.36)";ctx.fillRect(-unit*3,unit*3,unit*6,unit);
  ctx.fillStyle=color;
  if(["crab","frog","moth","glowmoth"].includes(kind)){
    const flap=Math.sin(time*4+phase)>0?1:0;ctx.fillRect(-unit*2,-unit,unit*4,unit*3);
    ctx.fillRect(-unit*(3+flap),0,unit*2,unit);ctx.fillRect(unit*(1+flap),0,unit*2,unit);
    ctx.fillRect(-unit,unit*2,unit,unit);ctx.fillRect(unit,unit*2,unit,unit);
  }else if(["grass","vine","icicle","crystal","mushroom","pipe"].includes(kind)){
    ctx.fillRect(-unit, -unit*3, unit*2, unit*6);ctx.fillRect(-unit*2,-unit*2,unit,unit*3);ctx.fillRect(unit,-unit,unit,unit*3);
  }else if(["ember","spark","firefly","spore","mote","dust"].includes(kind)){
    const drift=Math.sin(time*2+phase)*unit*2;ctx.fillRect(drift-unit,-unit*2,unit*2,unit*2);
  }else{ctx.fillRect(-unit*3,-unit,unit*6,unit*2);ctx.fillRect(-unit, -unit*2,unit*2,unit*4)}
  ctx.restore();
}

export function entitiesNear(seed:number,world:InfiniteWorld,anchors:ThemeAnchor[],x:number,y:number):AmbientEntity[]{
  const out:AmbientEntity[]=[];
  for(let cy=Math.floor(y)-9;cy<=Math.floor(y)+9;cy++)for(let cx=Math.floor(x)-9;cx<=Math.floor(x)+9;cx++){
    if(world.tile(cx,cy)!==0)continue;const info=themeAt(anchors,cx,cy);if(info.id==="neutral")continue;
    const h=hash32(seed,"entity",cx,cy);if(h%17!==0||((h>>>8)%100)/100>info.influence)continue;const def=THEMES[info.id];const pool=h%3===0?def.life:def.props;
    out.push({x:cx+.5,y:cy+.5,kind:pool[h%pool.length],theme:info.id,phase:(h%628)/100,scale:.65+(h%50)/100});
  }return out;
}

export function renderWorld(ctx:CanvasRenderingContext2D,world:InfiniteWorld,anchors:ThemeAnchor[],entities:AmbientEntity[],pose:Pose,moving:boolean,reducedMotion:boolean,tick:number){
  const{width,height}=ctx.canvas,time=performance.now()*.001;const here=themeAt(anchors,pose.x,pose.y);const def=THEMES[here.id],neutral=THEMES.neutral;
  const behavior=!reducedMotion?(here.id==="beach"?Math.sin(time*2)*2:here.id==="tornado"?Math.sin(time*5)*1.5:here.id==="frozen"?Math.sin(time)*.7:0):0;
  const bob=moving&&!reducedMotion?Math.sin(pose.bob)*3.2:0,horizon=height*.47+bob+behavior;
  const ceiling=ctx.createLinearGradient(0,0,0,horizon);ceiling.addColorStop(0,blendHex(neutral.ceiling,def.ceiling,here.influence));ceiling.addColorStop(1,"#282923");ctx.fillStyle=ceiling;ctx.fillRect(0,0,width,horizon);
  const floor=ctx.createLinearGradient(0,horizon,0,height);floor.addColorStop(0,blendHex(neutral.floor,def.floor,here.influence));floor.addColorStop(1,"#10120f");ctx.fillStyle=floor;ctx.fillRect(0,horizon,width,height-horizon);
  const depths=new Float32Array(RAYS);
  for(let i=0;i<RAYS;i++){
    const angle=pose.angle-FOV/2+i/RAYS*FOV,ray=cast(world,pose,angle,tick),corrected=ray.distance*Math.cos(angle-pose.angle);depths[i]=corrected;
    const wallH=Math.min(height*1.7,height/Math.max(corrected,.22)),top=horizon-wallH/2,x=i/RAYS*width,cw=width/RAYS+1;
    const theme=themeAt(anchors,ray.mapX,ray.mapY),wall=THEMES[theme.id],fog=Math.min(1,corrected/12),seed=hash32(ray.mapX,ray.mapY,ray.side);
    const hue=mix(neutral.wall[0],wall.wall[0],theme.influence),sat=Math.max(8,mix(neutral.wall[1],wall.wall[1],theme.influence)-fog*9),light=Math.max(16,mix(neutral.wall[2],wall.wall[2],theme.influence)-fog*24-ray.side*4+(seed%7-3));
    ctx.fillStyle=`hsl(${hue} ${sat}% ${light}%)`;ctx.fillRect(x,top,cw,wallH);
    const rows=theme.id==="frozen"?7:theme.id==="foundry"?4:5;
    for(let row=0;row<rows;row++){const u=(ray.u*2+(row%2)*.5)%1;if(u<.035||u>.965){ctx.fillStyle=`rgba(12,15,13,${.2+fog*.25})`;ctx.fillRect(x,top+wallH*row/rows,cw,wallH/rows)}}
    for(let row=1;row<rows;row++){ctx.fillStyle=`rgba(12,15,13,${.22+fog*.18})`;ctx.fillRect(x,top+wallH*row/rows,cw,Math.max(1,wallH*.007))}
    if(theme.id==="beach"&&Math.floor(ray.u*12+seed)%4===0){ctx.fillStyle=`rgba(235,211,147,${.22*(1-fog)})`;ctx.fillRect(x,top+wallH*.7,cw,wallH*.08)}
    if(theme.id==="tornado"){const stripe=(Math.floor(ray.u*14)+seed)%2;ctx.fillStyle=stripe?`rgba(218,174,65,${.22*(1-fog)})`:`rgba(21,24,24,${.25*(1-fog)})`;ctx.fillRect(x,top+wallH*.38,cw,wallH*.18)}
    if(theme.id==="ruins"){const moss=.12+(Math.sin(ray.u*22+seed)+1)*.12;ctx.fillStyle=`rgba(50,99,51,${.34*(1-fog)})`;ctx.fillRect(x,top,cw,wallH*moss)}
    if(theme.id==="frozen"){ctx.fillStyle=`rgba(188,235,244,${.16*(1-fog)})`;ctx.fillRect(x,top,cw,wallH);if(seed%9===0)ctx.fillRect(x,top,cw,wallH*.45)}
    if(theme.id==="foundry"&&seed%6===0){ctx.fillStyle=`rgba(229,93,37,${.2*(1-fog)})`;ctx.fillRect(x,top+wallH*.78,cw,wallH*.08)}
    if(theme.id==="cavern"){const wave=(Math.sin(ray.u*25+time+seed)+1)/2;ctx.fillStyle=`rgba(72,225,202,${(.07+wave*.1)*(1-fog)})`;ctx.fillRect(x,top,cw,wallH)}
    if(theme.id==="neutral"&&seed%5===0){const ring=Math.abs(Math.abs(ray.u-.5)-.22)<.025;if(ring){ctx.fillStyle=`rgba(205,180,133,${.2*(1-fog)})`;ctx.fillRect(x,top,cw,wallH)}}
  }
  const visible=entities.map(e=>{const dx=e.x-pose.x,dy=e.y-pose.y,dist=Math.hypot(dx,dy);let rel=Math.atan2(dy,dx)-pose.angle;while(rel>Math.PI)rel-=Math.PI*2;while(rel<-Math.PI)rel+=Math.PI*2;return{e,dist,rel}}).filter(v=>Math.abs(v.rel)<FOV*.58&&v.dist>.35&&v.dist<12).sort((a,b)=>b.dist-a.dist).slice(0,28);
  for(const v of visible){const sx=(.5+v.rel/FOV)*width,rayIndex=Math.max(0,Math.min(RAYS-1,Math.floor(sx/width*RAYS)));if(v.dist>depths[rayIndex]+.2)continue;const size=Math.min(120,height/v.dist*.33*v.e.scale),sy=horizon+height/(v.dist*3.8);sprite(ctx,sx,sy,size,v.e.kind,THEMES[v.e.theme].accent,time,v.e.phase)}
  if(!reducedMotion&&here.influence>0){ctx.save();ctx.globalAlpha=here.influence;ctx.fillStyle=def.fog;ctx.fillRect(0,0,width,height);ctx.restore()}
  const vignette=ctx.createRadialGradient(width/2,horizon,height*.12,width/2,horizon,width*.72);vignette.addColorStop(0,"rgba(0,0,0,0)");vignette.addColorStop(1,"rgba(3,4,3,.43)");ctx.fillStyle=vignette;ctx.fillRect(0,0,width,height);
  ctx.fillStyle="rgba(220,215,194,.45)";ctx.fillRect(width/2-7,horizon,14,1);ctx.fillRect(width/2,horizon-7,1,14);
  ctx.fillStyle="rgba(0,0,0,.05)";for(let y=0;y<height;y+=5)ctx.fillRect(0,y,width,1);
}
