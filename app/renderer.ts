import { hash32, type InfiniteWorld } from "./world.mjs";
import { THEMES, rememberedThemeAt, themeAt, type AmbientEntity, type ThemeAnchor, type ThemeId, type ThemeMemory, type ThemeSample } from "./themes";
import { CAMERA_FOV } from "./camera";
import { visibleStarProjection, type StarObjective } from "./objectives";
import type { PerceivedScene, VisualFrameState } from "./scene";
import { atlasFrame } from "./sprite-atlas";
import type { AriadneBodyState, AriadneTrailPoint } from "./ariadne-body";

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
  const atlas=atlasFrame(kind,time,phase);if(atlas){const drawSize=Math.max(8,Math.round(size)),bounce=Math.round(Math.sin(time*3+phase)*unit*.45);ctx.drawImage(atlas.atlas,atlas.source.sx,atlas.source.sy,atlas.source.size,atlas.source.size,-drawSize/2,-drawSize/2+bounce,drawSize,drawSize);ctx.restore();return}
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
  const halo=ctx.createRadialGradient(0,0,unit,0,0,unit*8);halo.addColorStop(0,"rgba(255,241,155,.38)");halo.addColorStop(.4,"rgba(242,168,54,.18)");halo.addColorStop(1,"rgba(242,168,54,0)");ctx.fillStyle=halo;ctx.fillRect(-unit*8,-unit*8,unit*16,unit*16);
  for(let i=0;i<6;i++){const angle=time*(i%2?-.7:.9)+i*Math.PI/3,orbit=unit*(5+(i%2));ctx.fillStyle=i%2?"#fff2ad":"#e99b45";ctx.fillRect(Math.round(Math.cos(angle)*orbit),Math.round(Math.sin(angle)*orbit),unit,unit)}
  ctx.fillStyle="rgba(8,7,3,.45)";ctx.fillRect(-unit*3,unit*4,unit*6,unit);
  ctx.fillStyle="#f2cf69";ctx.fillRect(-unit,-unit*4,unit*2,unit*8);ctx.fillRect(-unit*4,-unit,unit*8,unit*2);
  ctx.fillRect(-unit*3,-unit*2,unit*2,unit*2);ctx.fillRect(unit,-unit*2,unit*2,unit*2);ctx.fillRect(-unit*2,unit,unit,unit*3);ctx.fillRect(unit,unit,unit,unit*3);
  ctx.fillStyle="#fff2ad";ctx.fillRect(-unit,-unit*3,unit,unit*3);ctx.restore();
}

function renderSpectacles(ctx:CanvasRenderingContext2D,scene:PerceivedScene,pose:Pose,depths:Float32Array,horizon:number,time:number,intensity:number,reducedMotion:boolean){
  const{width,height}=ctx.canvas,t=reducedMotion?0:time,density=Math.max(4,Math.round(7+intensity*11));ctx.save();ctx.imageSmoothingEnabled=false;
  for(const spectacle of scene.spectacles){
    const dx=spectacle.worldPosition[0]-pose.x,dy=spectacle.worldPosition[1]-pose.y,dist=Math.hypot(dx,dy);let rel=Math.atan2(dy,dx)-pose.angle;while(rel>Math.PI)rel-=Math.PI*2;while(rel<-Math.PI)rel+=Math.PI*2;
    if(dist<=.35||dist>12||Math.abs(rel)>FOV*.58)continue;
    const sx=(.5+rel/FOV)*width,rayIndex=Math.max(0,Math.min(RAYS-1,Math.floor(sx/width*RAYS))),corrected=dist*Math.cos(rel);if(corrected>depths[rayIndex]+.2)continue;
    const size=Math.min(height*.78,height/Math.max(.5,corrected)*(spectacle.salience==="major"?.8:.48)),sy=horizon+height/(dist*3.8)-size*.18;
    const seed=hash32(spectacle.id),accent=THEMES[spectacle.theme].accent,kind=spectacle.visualKind;
    const envelope=reducedMotion?1:spectacle.salience==="major"?Math.min(1,spectacle.progress*5,(1-spectacle.progress)*5):1,travel=!reducedMotion&&spectacle.salience==="major"?(spectacle.progress-.5)*54:0;
    ctx.globalAlpha=(spectacle.salience==="ambient"?.28:.48+intensity*.2)*envelope;
    ctx.save();ctx.translate(Math.round(sx),Math.round(sy));ctx.scale(size/100,size/100);
    if(kind==="masonry-fish"||kind==="frog-parade"||kind==="steam-animals"||kind==="moth-orbit"||kind==="crab-orchestra"||kind==="leaf-whale"||kind==="page-bird"||kind==="umbrella-storm"||kind==="spore-whale"){
      for(let i=0;i<density;i++){const phase=t*(kind==="moth-orbit"?1.5:.55)+i*1.7+seed%13,x=travel+Math.sin(phase)*(18+i/density*22),y=-20+(i%5)*9+Math.cos(phase*1.3)*5,unit=2+(i%3);ctx.fillStyle=i%4===0?"#ff6d9f":i%3===0?"#71e0dd":i%2?accent:"#f3d66e";ctx.fillRect(Math.round(x),Math.round(y),unit*3,unit);ctx.fillRect(Math.round(x+(i%2?unit*3:-unit)),Math.round(y-unit),unit,unit*3)}
    }else if(kind==="water-caustics"||kind==="crystal-rainbow"||kind==="breathing-light"||kind==="lightning-color"){
      const bands=kind==="crystal-rainbow"?["#ff5d73","#ffcb4d","#75e4b3","#73b8ff","#c783ff"]:[accent,"#f3d66e","#7ee4db"];
      for(let i=0;i<density;i++){const x=-43+((Math.sin(t*(.4+i*.02)+i)*18+i*13)%86),y=-38+(i%7)*11;ctx.fillStyle=bands[i%bands.length]!;ctx.fillRect(Math.round(x),Math.round(y),14+i%3*4,2+(i%3))}
    }else if(kind==="page-current"||kind==="debris-wheel"||kind==="sand-ribbon"||kind==="warning-flock"||kind==="shell-fountain"||kind==="ice-curtain"||kind==="crystal-dance"){
      for(let i=0;i<density;i++){const angle=t*.7+i/density*Math.PI*2,radius=18+(i%density)*2,x=travel+Math.cos(angle)*radius,y=-8+Math.sin(angle)*radius*.55;ctx.fillStyle=i%3===0?"#f3ead2":accent;ctx.fillRect(Math.round(x),Math.round(y),6+i%3*3,3)}
    }else if(kind==="vine-writing"||kind==="living-pipes"||kind==="frost-bloom"||kind==="book-breath"||kind==="pipe-creature"||kind==="lightning-ladder"){
      ctx.strokeStyle=accent;ctx.lineWidth=3;ctx.beginPath();for(let i=0;i<18;i++){const x=travel+(i-9)*5,y=-12+Math.sin(t+i*.7)*18+i%3*7;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y)}ctx.stroke();
      for(let i=0;i<8;i++){ctx.fillStyle=i%2?accent:"#f2d06f";ctx.fillRect(Math.round(travel+(i-4)*11),Math.round(-12+Math.sin(t+i)*20),5,5)}
    }else if(kind==="ceiling-mouth"||kind==="furnace-grin"||kind==="watching-eyes"||kind==="statue-turn"){
      const open=.25+Math.abs(Math.sin(t*1.5+seed))*.75;ctx.fillStyle="#ffcf57";ctx.fillRect(Math.round(-45+travel),-48,90,Math.round(8+open*25));ctx.fillStyle="#30102f";ctx.fillRect(Math.round(-35+travel),-41,70,Math.round(open*15));ctx.fillStyle="#fff1ad";ctx.fillRect(Math.round(-25+travel),-46,9,7);ctx.fillRect(Math.round(18+travel),-46,9,7);
    }else{
      const palette=["#ff5d73","#ffcb4d","#75e4b3","#73b8ff","#c783ff",accent];for(let i=0;i<density;i++){const x=travel+Math.sin(t*.6+i*2.4)*42,y=-42+((i*17+(kind.includes("rain")?-t*34:t*18))%84+84)%84;ctx.fillStyle=palette[(i+seed)%palette.length]!;ctx.fillRect(Math.round(x),Math.round(y),2+i%3,2+i%3)}
    }
    ctx.restore();
  }
  ctx.globalAlpha=1;ctx.restore();
}

function projectAriadnePoint(point:{x:number;y:number;height:number},pose:Pose,depths:Float32Array,horizon:number,width:number,height:number){
  const dx=point.x-pose.x,dy=point.y-pose.y,dist=Math.hypot(dx,dy);let rel=Math.atan2(dy,dx)-pose.angle;while(rel>Math.PI)rel-=Math.PI*2;while(rel<-Math.PI)rel+=Math.PI*2;
  if(dist<.14||dist>12||Math.abs(rel)>FOV*.57)return null;
  const sx=(.5+rel/FOV)*width,rayIndex=Math.max(0,Math.min(RAYS-1,Math.floor(sx/width*RAYS))),corrected=dist*Math.cos(rel);if(corrected>depths[rayIndex]+.15)return null;
  const floorY=horizon+height/(dist*3.8),sy=floorY-height/Math.max(.45,corrected)*point.height*.34;
  return{sx,sy,dist,corrected};
}

function renderAriadneFairy(ctx:CanvasRenderingContext2D,time:number,body:AriadneBodyState,visual:VisualFrameState,pose:Pose,depths:Float32Array,horizon:number){
  const{width,height}=ctx.canvas,now=Date.now(),projection=projectAriadnePoint({x:body.position[0],y:body.position[1],height:body.height},pose,depths,horizon,width,height);if(!projection)return;
  const drawTrail=(point:AriadneTrailPoint)=>{const projected=projectAriadnePoint(point,pose,depths,horizon,width,height);if(!projected)return;const age=(now-point.bornAt)/850;if(age>=1)return;const unit=Math.max(1,Math.round(2.4/projected.corrected)),x=Math.round(projected.sx),y=Math.round(projected.sy),committing=body.mode==="leading"||body.mode==="waiting_ahead";ctx.globalAlpha=(1-age)*(committing?.82:.5);ctx.fillStyle=age>.45?"#e5b94f":"#63e4ff";ctx.fillRect(x,y,unit*(committing?3:2),unit);if(age<.55){ctx.fillStyle="#e55ecf";ctx.fillRect(x-unit,y+unit*2,unit*(committing?2:1),unit)}};
  ctx.save();ctx.imageSmoothingEnabled=false;for(const point of body.trail)drawTrail(point);
  const size=Math.max(12,Math.min(52,height/Math.max(.55,projection.corrected)*.072)),unit=Math.max(1,Math.round(size/12)),speaking=now<body.speakUntil,thinking=body.thinkingSince!==null,decisionActive=now<body.decisionEmphasisUntil,decisionSpan=Math.max(1,body.decisionEmphasisUntil-body.decisionEmphasisStartedAt),decisionProgress=Math.max(0,Math.min(1,(now-body.decisionEmphasisStartedAt)/decisionSpan)),pulse=speaking?.72+.28*Math.sin(time*11):thinking?.8+.2*Math.sin(time*4.2):1,emphasized=decisionActive||thinking||speaking;
  const emotionalScale=body.mode==="apologizing"?.82:body.mode==="celebrating"?1.18:1,phaseScale=visual.relationshipPhase==="overbearing"?1.08:1;
  ctx.translate(projection.sx,projection.sy);const attentionScale=decisionActive?1.28+Math.sin(decisionProgress*Math.PI)*.22:thinking?1.16+Math.sin(time*4.2)*.07:speaking?1.12+Math.sin(time*11)*.06:1;ctx.scale(emotionalScale*phaseScale*attentionScale,emotionalScale*phaseScale*attentionScale);
  const haloRadius=unit*(body.mode==="apologizing"?7:speaking?20:thinking?18:decisionActive?22:9),halo=ctx.createRadialGradient(0,0,0,0,0,haloRadius);halo.addColorStop(0,`rgba(247,255,255,${.92*pulse})`);halo.addColorStop(.18,`rgba(109,224,245,${(emphasized?.7:.48)*pulse})`);halo.addColorStop(.52,`rgba(111,96,231,${emphasized?.26:.18})`);halo.addColorStop(1,"rgba(79,164,224,0)");ctx.fillStyle=halo;ctx.fillRect(-haloRadius,-haloRadius,haloRadius*2,haloRadius*2);
  if(decisionActive){const gather=Math.sin(decisionProgress*Math.PI),radius=unit*(4.5+gather*5),alpha=.45+gather*.45;ctx.globalAlpha=alpha;for(let i=0;i<6;i++){const angle=i/6*Math.PI*2+time*.7,x=Math.round(Math.cos(angle)*radius),y=Math.round(Math.sin(angle)*radius*.65);ctx.fillStyle=i%2?"#f4ca5d":"#79efff";ctx.fillRect(x-unit/2,y-unit/2,unit,unit)}ctx.globalAlpha=1}
  const rotation=time*(visual.reducedMotion?.35:body.mode==="leading"||body.mode==="catching_up"?3.2:thinking?2.1:body.mode==="apologizing"?.45:1.35),ringAlpha=body.mode==="apologizing"?.44:.82;
  ctx.globalAlpha=ringAlpha;for(let i=0;i<10;i++){const angle=rotation+i/10*Math.PI*2,radius=unit*(speaking?6.4:5.6),x=Math.round(Math.cos(angle)*radius),y=Math.round(Math.sin(angle)*radius*.72);ctx.fillStyle=i%3===0?"#ee62d5":i%2?"#72eaff":"#bff8ff";ctx.fillRect(x-unit,y,unit*2,unit)}
  for(let i=0;i<4;i++){const angle=-rotation*.62+i*Math.PI/2,radius=unit*3.8;ctx.save();ctx.rotate(angle);ctx.fillStyle=i===3?"#e8bd58":"#69ddf4";ctx.fillRect(Math.round(radius),-unit,unit*3,unit*2);ctx.fillStyle="#e8fbff";ctx.fillRect(Math.round(radius+unit),-unit,unit,unit);ctx.restore()}
  ctx.globalAlpha=1;ctx.fillStyle="#69dff5";ctx.fillRect(-unit*2,-unit*2,unit*4,unit*4);ctx.fillStyle="#f7ffff";ctx.fillRect(-unit,-unit*3,unit*2,unit*6);ctx.fillRect(-unit*3,-unit,unit*6,unit*2);ctx.fillStyle="#ffffff";ctx.fillRect(-unit,-unit,unit*2,unit*2);ctx.fillStyle="#e75cd1";ctx.fillRect(unit,unit,unit,unit);ctx.fillStyle="#edc35e";ctx.fillRect(-unit*2,unit*2,unit,unit);
  const moteCount=visual.relationshipPhase==="charming"?2:visual.relationshipPhase==="attached"?3:5;for(let i=0;i<moteCount;i++){const angle=-rotation*.35+i*Math.PI*2/moteCount,radius=unit*(7+i%2*2);ctx.fillStyle=i===moteCount-1?"#e8bd58":i%2?"#e962d2":"#8cf0ff";ctx.fillRect(Math.round(Math.cos(angle)*radius),Math.round(Math.sin(angle)*radius*.58),unit,unit)}
  ctx.restore();
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

export function entitiesNear(seed:number,world:InfiniteWorld,anchors:ThemeAnchor[],appearance:ThemeMemory,x:number,y:number,collageIntensity=0):AmbientEntity[]{
  const out:AmbientEntity[]=[];
  const rememberedThemes:ThemeId[]=[...new Set(anchors.filter(anchor=>anchor.triggered).map(anchor=>anchor.theme))];
  for(let cy=Math.floor(y)-14;cy<=Math.floor(y)+14;cy++)for(let cx=Math.floor(x)-14;cx<=Math.floor(x)+14;cx++){
    if(world.tile(cx,cy)!==0)continue;const info=appearance.get(`${cx},${cy}`)??themeAt(anchors,cx,cy);if(info.id==="neutral")continue;
    const h=hash32(seed,"entity",cx,cy);if(h%17!==0||((h>>>8)%100)/100>info.influence)continue;let entityTheme=info.id;
    if(rememberedThemes.length>1&&((h>>>14)%100)/100<collageIntensity*.38)entityTheme=rememberedThemes[(h>>>20)%rememberedThemes.length]!;
    const def=THEMES[entityTheme],pool=h%3===0?def.life:def.props;
    const kind=pool[h%pool.length];out.push({id:`entity:${cx}:${cy}:${kind}`,x:cx+.5,y:cy+.5,kind,theme:entityTheme,phase:(h%628)/100,scale:.65+(h%50)/100});
  }return out;
}

export function renderWorld(ctx:CanvasRenderingContext2D,world:InfiniteWorld,anchors:ThemeAnchor[],entities:AmbientEntity[],appearance:ThemeMemory,protectedCells:Set<string>,pose:Pose,moving:boolean,reducedMotion:boolean,tick:number,activeStar:StarObjective|null=null,scene:PerceivedScene|null=null,visual:VisualFrameState|null=null,ariadne:AriadneBodyState|null=null){
  const{width,height}=ctx.canvas,time=performance.now()*.001;const here=themeAt(anchors,pose.x,pose.y),neutral=THEMES.neutral;
  const behavior=!reducedMotion?(here.id==="beach"?Math.sin(time*2)*2:here.id==="tornado"?Math.sin(time*5)*1.5:here.id==="frozen"?Math.sin(time)*.7:0):0;
  const bob=moving&&!reducedMotion?Math.sin(pose.bob)*3.2:0,lean=!reducedMotion?(visual?.turnRate??0)*height*.008:0,collision=!reducedMotion?(visual?.collisionPulse??0)*Math.sin(time*22)*3:0,horizon=height*.47+bob+behavior+lean+collision;
  const ceiling=ctx.createLinearGradient(0,0,0,horizon);ceiling.addColorStop(0,neutral.ceiling);ceiling.addColorStop(1,"#282923");ctx.fillStyle=ceiling;ctx.fillRect(0,0,width,horizon);
  const floor=ctx.createLinearGradient(0,horizon,0,height);floor.addColorStop(0,neutral.floor);floor.addColorStop(1,"#10120f");ctx.fillStyle=floor;ctx.fillRect(0,horizon,width,height-horizon);
  renderPlanes(ctx,anchors,appearance,protectedCells,pose,horizon,height,reducedMotion);
  renderDistantSky(ctx,anchors,pose,horizon,tick);
  const depths=new Float32Array(RAYS);
  for(let i=0;i<RAYS;i++){
    const angle=pose.angle-FOV/2+i/RAYS*FOV,ray=cast(world,pose,angle,tick),corrected=ray.distance*Math.cos(angle-pose.angle);depths[i]=corrected;
    const wallH=Math.min(height*1.7,height/Math.max(corrected,.22)),top=horizon-wallH/2,x=i/RAYS*width,cw=width/RAYS+1;
    const theme=rememberedThemeAt(anchors,appearance,ray.mapX,ray.mapY,protectedCells.has(`${ray.mapX},${ray.mapY}`)),wall=THEMES[theme.id],palette=themedWall(theme),fog=Math.min(1,corrected/12),seed=hash32(ray.mapX,ray.mapY,ray.side),entranceGate=world.isEntranceGate(ray.mapX,ray.mapY);
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
    if(entranceGate){
      const visibility=1-fog*.72,gateBand=Math.floor(ray.u*24),center=Math.abs(ray.u-.5);
      ctx.fillStyle=`rgba(5,12,20,${.9*visibility})`;ctx.fillRect(x,top,cw,wallH);
      if(gateBand%4===0){ctx.fillStyle=`rgba(88,218,245,${.72*visibility})`;ctx.fillRect(x,top,cw,wallH)}
      else if(gateBand%4===1){ctx.fillStyle=`rgba(181,132,51,${.42*visibility})`;ctx.fillRect(x,top,cw,wallH)}
      for(const brace of [.16,.5,.84]){ctx.fillStyle=`rgba(202,167,82,${.72*visibility})`;ctx.fillRect(x,top+wallH*brace,cw,Math.max(2,wallH*.025))}
      if(center<.11){const pulse=reducedMotion?.72:.62+Math.sin(time*2.1)*.1;ctx.fillStyle=`rgba(126,238,255,${pulse*visibility})`;ctx.fillRect(x,top+wallH*.35,cw,wallH*.3)}
      if(center<.028){ctx.fillStyle=`rgba(250,244,207,${.9*visibility})`;ctx.fillRect(x,top+wallH*.42,cw,wallH*.16)}
    }
  }
  if(scene)renderSpectacles(ctx,scene,pose,depths,horizon,time,visual?.relationshipIntensity??0,reducedMotion);
  const perceivedIds=scene?new Set(scene.objects.map(object=>object.id)):null;
  const visible=entities.map(e=>{const dx=e.x-pose.x,dy=e.y-pose.y,dist=Math.hypot(dx,dy);let rel=Math.atan2(dy,dx)-pose.angle;while(rel>Math.PI)rel-=Math.PI*2;while(rel<-Math.PI)rel+=Math.PI*2;return{e,dist,rel}}).filter(v=>(!perceivedIds||perceivedIds.has(v.e.id))&&Math.abs(v.rel)<FOV*.58&&v.dist>.35&&v.dist<12).sort((a,b)=>b.dist-a.dist).slice(0,28);
  for(const v of visible){const sx=(.5+v.rel/FOV)*width,rayIndex=Math.max(0,Math.min(RAYS-1,Math.floor(sx/width*RAYS)));if(v.dist>depths[rayIndex]+.2)continue;const size=Math.min(120,height/v.dist*.33*v.e.scale),sy=horizon+height/(v.dist*3.8);sprite(ctx,sx,sy,size,v.e.kind,THEMES[v.e.theme].accent,time,v.e.phase)}
  if(activeStar){const projection=visibleStarProjection(world,activeStar,pose,tick,12,FOV);
    if(projection){const {distance:dist,relativeAngle:rel}=projection,sx=(.5+rel/FOV)*width,size=Math.min(150,height/dist*.42),sy=horizon+height/(dist*3.8);objectiveStar(ctx,sx,sy,size,time)}
  }
  if(visual&&ariadne)renderAriadneFairy(ctx,time,ariadne,visual,pose,depths,horizon);
  const vignette=ctx.createRadialGradient(width/2,horizon,height*.12,width/2,horizon,width*.72);vignette.addColorStop(0,"rgba(0,0,0,0)");vignette.addColorStop(1,"rgba(3,4,3,.43)");ctx.fillStyle=vignette;ctx.fillRect(0,0,width,height);
  ctx.fillStyle="rgba(220,215,194,.45)";ctx.fillRect(width/2-7,horizon,14,1);ctx.fillRect(width/2,horizon-7,1,14);
  ctx.fillStyle="rgba(0,0,0,.05)";for(let y=0;y<height;y+=5)ctx.fillRect(0,y,width,1);
}
