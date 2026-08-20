import { hash32, type InfiniteWorld } from "./world.mjs";
import { THEMES, rememberedThemeAt, themeAt, type AmbientEntity, type ThemeAnchor, type ThemeMemory, type ThemeSample } from "./themes";
import { CAMERA_FOV } from "./camera";
import { visibleStarProjection, type StarObjective } from "./objectives";

export type Pose = { x:number; y:number; angle:number; bob:number };
type Ray = {distance:number;mapX:number;mapY:number;side:number;u:number};
const FOV=CAMERA_FOV, RAYS=360;
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
function rgb(hex:string){const value=parseInt(hex.slice(1),16);return[(value>>16)&255,(value>>8)&255,value&255]}
type HexSurface="floor"|"ceiling"|"floorDetail"|"skyDetail";
function themedHex(info:ThemeSample,surface:HexSurface){
  const used=info.layers.reduce((sum,layer)=>sum+layer.influence,0),base=rgb(THEMES.neutral[surface]).map(value=>value*(1-used));
  for(const layer of info.layers){const color=rgb(THEMES[layer.id][surface]);for(let i=0;i<3;i++)base[i]+=color[i]*layer.influence}
  return`rgb(${base.map(value=>Math.round(value)).join(",")})`;
}
function themedWall(info:ThemeSample){
  const used=info.layers.reduce((sum,layer)=>sum+layer.influence,0),base=THEMES.neutral.wall.map(value=>value*(1-used));
  for(const layer of info.layers)for(let i=0;i<3;i++)base[i]+=THEMES[layer.id].wall[i]*layer.influence;
  return base;
}

function renderPlanes(ctx:CanvasRenderingContext2D,anchors:ThemeAnchor[],appearance:ThemeMemory,protectedCells:Set<string>,pose:Pose,horizon:number,height:number,calm:boolean){
  const width=ctx.canvas.width,stepX=calm?12:8,stepY=calm?10:6;
  const leftX=Math.cos(pose.angle-FOV/2),leftY=Math.sin(pose.angle-FOV/2),rightX=Math.cos(pose.angle+FOV/2),rightY=Math.sin(pose.angle+FOV/2);
  ctx.imageSmoothingEnabled=false;
  for(let offset=3;horizon+offset<height;offset+=stepY){
    const distance=Math.min(48,height*.47/offset),fade=Math.min(.68,distance/62),floorY=Math.floor(horizon+offset),skyY=Math.floor(horizon-offset-stepY);
    for(let x=0;x<width;x+=stepX){
      const screen=x/width,worldX=pose.x+distance*mix(leftX,rightX,screen),worldY=pose.y+distance*mix(leftY,rightY,screen);
      const gx=Math.floor(worldX),gy=Math.floor(worldY),info=rememberedThemeAt(anchors,appearance,worldX,worldY,protectedCells.has(`${gx},${gy}`)),hash=hash32("plane",gx,gy);
      const fx=Math.abs(worldX-Math.round(worldX)),fy=Math.abs(worldY-Math.round(worldY));
      ctx.fillStyle=themedHex(info,"floor");ctx.fillRect(x,floorY,stepX+1,stepY+1);
      ctx.fillStyle=`rgba(4,6,5,${fade})`;ctx.fillRect(x,floorY,stepX+1,stepY+1);
      const seam=fx<.055+distance*.0015||fy<.055+distance*.0015;
      const floorMark=seam||(!calm&&(hash%19===0||(info.id==="beach"&&hash%11===0)||(info.id==="foundry"&&(gx+gy)%5===0&&fx<.14)||(info.id==="frozen"&&hash%13===0)));
      if(floorMark){ctx.globalAlpha=(calm?.12:seam?.28:.42)*(1-fade*.65);ctx.fillStyle=themedHex(info,"floorDetail");ctx.fillRect(x,floorY,stepX+1,stepY+1);ctx.globalAlpha=1}
      if(skyY<0)continue;
      ctx.fillStyle=themedHex(info,"ceiling");ctx.fillRect(x,skyY,stepX+1,stepY+1);
      const skyBand=info.id==="beach"?hash%9<2:info.id==="tornado"?hash%7<3:info.id==="ruins"?hash%6<2:info.id==="frozen"?hash%15===0:info.id==="foundry"?hash%10<2:info.id==="cavern"?hash%13===0:hash%29===0;
      if(skyBand){ctx.globalAlpha=(.12+info.influence*.38)*(1-fade*.45);ctx.fillStyle=themedHex(info,"skyDetail");ctx.fillRect(x,skyY,stepX+1,stepY+1);ctx.globalAlpha=1}
      ctx.fillStyle=`rgba(3,5,4,${fade*.48})`;ctx.fillRect(x,skyY,stepX+1,stepY+1);
    }
  }
}

function renderDistantSky(ctx:CanvasRenderingContext2D,anchors:ThemeAnchor[],pose:Pose,horizon:number,tick:number){
  const width=ctx.canvas.width;
  for(const anchor of anchors){
    if(anchor.bornAt<=tick)continue;
    const dx=anchor.x-pose.x,dy=anchor.y-pose.y,distance=Math.hypot(dx,dy);if(distance<7||distance>72)continue;
    let relative=Math.atan2(dy,dx)-pose.angle;while(relative>Math.PI)relative-=Math.PI*2;while(relative<-Math.PI)relative+=Math.PI*2;
    if(Math.abs(relative)>FOV*1.25)continue;
    const def=THEMES[anchor.theme],center=(.5+relative/FOV)*width,reach=width*Math.min(.68,.16+22/distance);
    const approach=Math.max(0,Math.min(1,(72-distance)/58)),previewFade=Math.min(1,(anchor.bornAt-tick)/10),alpha=(.1+approach*.34)*previewFade;
    const glow=ctx.createRadialGradient(center,horizon*.48,0,center,horizon*.48,reach);
    glow.addColorStop(0,def.ceiling);glow.addColorStop(.52,def.skyDetail);glow.addColorStop(1,"rgba(0,0,0,0)");
    ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=glow;ctx.fillRect(center-reach,0,reach*2,horizon);
    const unit=Math.max(3,Math.floor(reach/28)),left=Math.floor(center-reach*.72),span=Math.floor(reach*1.44);
    ctx.fillStyle=def.skyDetail;
    if(anchor.theme==="beach"){
      for(let i=0;i<5;i++){const x=left+(hash32(anchor.x,anchor.y,"cloud",i)%Math.max(1,span)),y=horizon*(.16+i*.1);ctx.fillRect(x,y,unit*(4+i%2),unit);ctx.fillRect(x+unit,y-unit,unit*2,unit)}
    }else if(anchor.theme==="tornado"){
      for(let i=0;i<6;i++){const y=horizon*(.12+i*.105),indent=Math.abs(2.5-i)*unit*2;ctx.fillRect(left+indent,y,Math.max(unit,span-indent*2),unit*(i%2+1))}
    }else if(anchor.theme==="ruins"){
      for(let i=0;i<9;i++){const x=left+i*span/8,drop=unit*(2+hash32(anchor.x,i)%7);ctx.fillRect(x,0,unit*3,drop);ctx.fillRect(x-unit,drop-unit,unit*5,unit*2)}
    }else if(anchor.theme==="frozen"){
      for(let i=0;i<8;i++){const x=left+i*span/7,y=horizon*(.12+(i%3)*.09);ctx.fillRect(x,y,unit,unit*(3+i%4));ctx.fillRect(x+unit,y+unit,unit,unit*2)}
    }else if(anchor.theme==="foundry"){
      for(let i=0;i<7;i++){const x=left+i*span/6,y=horizon*(.12+(i%2)*.12);ctx.fillRect(x,y,unit*4,unit*2);ctx.fillRect(x+unit,y-unit*2,unit*2,unit*2)}
    }else if(anchor.theme==="cavern"){
      for(let i=0;i<9;i++){const x=left+i*span/8,drop=unit*(2+hash32(anchor.y,i)%8);ctx.fillRect(x,0,unit*2,drop);if(i%2===0)ctx.fillRect(x-unit,drop,unit*4,unit)}
    }
    ctx.restore();
  }
}

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

function objectiveStar(ctx:CanvasRenderingContext2D,x:number,y:number,size:number,time:number){
  const unit=Math.max(2,Math.floor(size/9)),pulse=1+Math.sin(time*3)*.08;ctx.save();ctx.translate(Math.round(x),Math.round(y-Math.sin(time*2.2)*unit));ctx.scale(pulse,pulse);
  ctx.fillStyle="rgba(8,7,3,.45)";ctx.fillRect(-unit*3,unit*4,unit*6,unit);
  ctx.fillStyle="#f2cf69";ctx.fillRect(-unit,-unit*4,unit*2,unit*8);ctx.fillRect(-unit*4,-unit,unit*8,unit*2);
  ctx.fillRect(-unit*3,-unit*2,unit*2,unit*2);ctx.fillRect(unit,-unit*2,unit*2,unit*2);ctx.fillRect(-unit*2,unit,unit,unit*3);ctx.fillRect(unit,unit,unit,unit*3);
  ctx.fillStyle="#fff2ad";ctx.fillRect(-unit,-unit*3,unit,unit*3);ctx.restore();
}

function wallSprite(ctx:CanvasRenderingContext2D,x:number,top:number,width:number,height:number,u:number,kind:string,accent:string,alpha:number){
  const cellX=Math.floor(u*16),draw=(gx:number,gy:number,gw:number,gh:number,color=accent)=>{
    if(cellX>=gx&&cellX<gx+gw){ctx.fillStyle=color;ctx.globalAlpha=alpha;ctx.fillRect(x,top+height*gy/16,width,height*gh/16+1)}
  };
  ctx.save();ctx.imageSmoothingEnabled=false;
  if(kind==="porthole"||kind==="frost-window"||kind==="broken-window"||kind==="root-window"){
    for(let gy=2;gy<14;gy++){const edge=Math.abs(Math.hypot(cellX-7.5,gy-7.5)-5)<1.1;if(edge)draw(cellX,gy,1,1);else if(Math.hypot(cellX-7.5,gy-7.5)<4)draw(cellX,gy,1,1,"rgba(24,56,64,.75)")}
    draw(7,2,1,12,"rgba(15,24,25,.55)");draw(2,7,12,1,"rgba(15,24,25,.55)");
  }else if(kind.includes("pipe")||kind==="storm-gauge"||kind==="pressure-dial"){
    draw(3,1,2,14);draw(10,1,2,14);draw(4,3,7,2);draw(4,11,7,2);for(let gy=5;gy<11;gy++){const ring=Math.abs(Math.hypot(cellX-7.5,gy-7.5)-2.4)<.8;if(ring)draw(cellX,gy,1,1,"rgba(224,191,112,.9)")}
  }else if(kind==="bookcase"){
    draw(1,1,14,14,"rgba(43,57,67,.72)");for(let gy=3;gy<15;gy+=4)draw(1,gy,14,1,"rgba(197,226,230,.65)");if(cellX>1&&cellX<15&&cellX%2===0)draw(cellX,2+(cellX%3)*4,1,3,"rgba(159,187,197,.75)");
  }else if(kind.includes("crystal")||kind==="ice-crack"){
    const center=7+Math.round(Math.sin(cellX)*2);if(Math.abs(cellX-center)<2)draw(cellX,2+Math.abs(cellX-center)*2,1,12-Math.abs(cellX-center)*3);if(cellX===4||cellX===11)draw(cellX,7,1,6,"rgba(210,250,245,.72)");
  }else if(kind.includes("warning")||kind==="hazard-grid"||kind==="wind-arrow"){
    for(let gy=2;gy<14;gy++)if((cellX+gy)%5<2)draw(cellX,gy,1,1,gy%2?accent:"rgba(24,25,23,.9)");
  }else if(kind==="stone-face"||kind==="cave-eye"||kind==="eye-rune"){
    if(cellX>2&&cellX<13){draw(cellX,3+Math.abs(cellX-8)/2,1,1);draw(cellX,11-Math.abs(cellX-8)/2,1,1)}
    if(cellX===5||cellX===10)draw(cellX,6,1,3,"rgba(18,22,19,.8)");if(cellX>6&&cellX<9)draw(cellX,10,1,2);
  }else if(kind.includes("vine")||kind==="tide-mark"||kind==="spiral-fossil"||kind==="spore-glyph"){
    const gy=8+Math.round(Math.sin(cellX*.9)*3);draw(cellX,gy,1,2);if(cellX%4===0)draw(cellX,gy-2,2,2,"rgba(111,169,96,.72)");
  }else{
    draw(2,2,12,12,"rgba(25,29,26,.5)");if(cellX>3&&cellX<12&&(cellX%3===0))draw(cellX,4,1,8);draw(4,7,8,2);
  }
  ctx.globalAlpha=1;ctx.restore();
}

export function entitiesNear(seed:number,world:InfiniteWorld,anchors:ThemeAnchor[],appearance:ThemeMemory,x:number,y:number):AmbientEntity[]{
  const out:AmbientEntity[]=[];
  for(let cy=Math.floor(y)-9;cy<=Math.floor(y)+9;cy++)for(let cx=Math.floor(x)-9;cx<=Math.floor(x)+9;cx++){
    if(world.tile(cx,cy)!==0)continue;const info=appearance.get(`${cx},${cy}`)??themeAt(anchors,cx,cy);if(info.id==="neutral")continue;
    const h=hash32(seed,"entity",cx,cy);if(h%17!==0||((h>>>8)%100)/100>info.influence)continue;const def=THEMES[info.id];const pool=h%3===0?def.life:def.props;
    out.push({x:cx+.5,y:cy+.5,kind:pool[h%pool.length],theme:info.id,phase:(h%628)/100,scale:.65+(h%50)/100});
  }return out;
}

export function renderWorld(ctx:CanvasRenderingContext2D,world:InfiniteWorld,anchors:ThemeAnchor[],entities:AmbientEntity[],appearance:ThemeMemory,protectedCells:Set<string>,pose:Pose,moving:boolean,reducedMotion:boolean,tick:number,activeStar:StarObjective|null=null){
  const{width,height}=ctx.canvas,time=reducedMotion?0:performance.now()*.001;const here=themeAt(anchors,pose.x,pose.y),neutral=THEMES.neutral;
  const behavior=!reducedMotion?(here.id==="beach"?Math.sin(time*2)*2:here.id==="tornado"?Math.sin(time*5)*1.5:here.id==="frozen"?Math.sin(time)*.7:0):0;
  const bob=moving&&!reducedMotion?Math.sin(pose.bob)*3.2:0,horizon=height*.47+bob+behavior;
  const ceiling=ctx.createLinearGradient(0,0,0,horizon);ceiling.addColorStop(0,neutral.ceiling);ceiling.addColorStop(1,"#282923");ctx.fillStyle=ceiling;ctx.fillRect(0,0,width,horizon);
  const floor=ctx.createLinearGradient(0,horizon,0,height);floor.addColorStop(0,neutral.floor);floor.addColorStop(1,"#10120f");ctx.fillStyle=floor;ctx.fillRect(0,horizon,width,height-horizon);
  renderPlanes(ctx,anchors,appearance,protectedCells,pose,horizon,height,reducedMotion);
  renderDistantSky(ctx,anchors,pose,horizon,tick);
  const depths=new Float32Array(RAYS);
  for(let i=0;i<RAYS;i++){
    const angle=pose.angle-FOV/2+i/RAYS*FOV,ray=cast(world,pose,angle,tick),corrected=ray.distance*Math.cos(angle-pose.angle);depths[i]=corrected;
    const wallH=Math.min(height*1.7,height/Math.max(corrected,.22)),top=horizon-wallH/2,x=i/RAYS*width,cw=width/RAYS+1;
    const theme=rememberedThemeAt(anchors,appearance,ray.mapX,ray.mapY,protectedCells.has(`${ray.mapX},${ray.mapY}`)),wall=THEMES[theme.id],palette=themedWall(theme),fog=Math.min(1,corrected/12),seed=hash32(ray.mapX,ray.mapY,ray.side);
    const hue=palette[0],sat=Math.max(8,palette[1]-fog*9),light=Math.max(16,palette[2]-fog*24-ray.side*4+(seed%7-3));
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
    const spriteChance=seed%5===0&&theme.influence>.08;
    if(spriteChance){const wallKind=wall.wallSprites[seed%wall.wallSprites.length];wallSprite(ctx,x,top,cw,wallH,ray.u,wallKind,wall.accent,(.18+theme.influence*.64)*(1-fog*.7))}
  }
  const visible=entities.map(e=>{const dx=e.x-pose.x,dy=e.y-pose.y,dist=Math.hypot(dx,dy);let rel=Math.atan2(dy,dx)-pose.angle;while(rel>Math.PI)rel-=Math.PI*2;while(rel<-Math.PI)rel+=Math.PI*2;return{e,dist,rel}}).filter(v=>Math.abs(v.rel)<FOV*.58&&v.dist>.35&&v.dist<12).sort((a,b)=>b.dist-a.dist).slice(0,28);
  for(const v of visible){const sx=(.5+v.rel/FOV)*width,rayIndex=Math.max(0,Math.min(RAYS-1,Math.floor(sx/width*RAYS)));if(v.dist>depths[rayIndex]+.2)continue;const size=Math.min(120,height/v.dist*.33*v.e.scale),sy=horizon+height/(v.dist*3.8);sprite(ctx,sx,sy,size,v.e.kind,THEMES[v.e.theme].accent,time,v.e.phase)}
  if(activeStar){const projection=visibleStarProjection(world,activeStar,pose,tick,12,FOV);
    if(projection){const {distance:dist,relativeAngle:rel}=projection,sx=(.5+rel/FOV)*width,size=Math.min(150,height/dist*.42),sy=horizon+height/(dist*3.8);objectiveStar(ctx,sx,sy,size,time)}
  }
  const vignette=ctx.createRadialGradient(width/2,horizon,height*.12,width/2,horizon,width*.72);vignette.addColorStop(0,"rgba(0,0,0,0)");vignette.addColorStop(1,"rgba(3,4,3,.43)");ctx.fillStyle=vignette;ctx.fillRect(0,0,width,height);
  ctx.fillStyle="rgba(220,215,194,.45)";ctx.fillRect(width/2-7,horizon,14,1);ctx.fillRect(width/2,horizon-7,1,14);
  ctx.fillStyle="rgba(0,0,0,.05)";for(let y=0;y<height;y+=5)ctx.fillRect(0,y,width,1);
}
