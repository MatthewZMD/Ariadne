import type { GuidanceEvidence, GuidanceIntent, RouteOption } from "./companion.ts";
import type { Point } from "./navigation-contracts.ts";
import type { InfiniteWorld } from "./world.mjs";
import { CAMERA_FOV } from "./camera.ts";
import type { AriadneDisposition } from "./embodied-interaction.ts";

export type AriadneBodyMode=
  | "hovering_beside"
  | "catching_up"
  | "looking_around"
  | "noticing_choice"
  | "examining_object"
  | "speaking"
  | "leading"
  | "waiting_ahead"
  | "returning"
  | "apology_spiral"
  | "apologizing"
  | "celebrating";

export type AriadneEmotion="curious"|"delighted"|"encouraging"|"apologetic"|"relieved"|"clingy"|"insistent";
export type AriadneTrailPoint={x:number;y:number;height:number;bornAt:number};
export type AriadneBodyState={
  position:[number,number];height:number;velocity:[number,number,number];mode:AriadneBodyMode;emotion:AriadneEmotion;
  side:-1|1;targetRouteId:string|null;routeCells:Point[];decisionCell:Point|null;approachCell:Point|null;expectedChoiceCell:Point|null;choiceCells:Point[];reachedDecision:boolean;leadStartedAt:number;waitStartedAt:number;speakUntil:number;emotionUntil:number;
  thinkingSince:number|null;decisionEmphasisStartedAt:number;decisionEmphasisUntil:number;decisionOrigin:[number,number];decisionArcSign:-1|1;
  apologyStartedAt:number;apologyOrigin:[number,number];apologyReady:boolean;
  lastTrailAt:number;trail:AriadneTrailPoint[];lastPlayerPosition:[number,number];lastPlayerAngle:number;approachingUntil:number;departureRouteId:string|null;wasLeftWhileWaiting:boolean;mtFollowingHerLead:boolean;mtLeavingWhileSheWaits:boolean;mtReturningToHer:boolean;
};
export type AriadneEmbodimentContext={
  currentAction:string;positionRelativeToMT:string;relationToBelievedRoute:string|null;
  mtLookingAtAriadne:boolean;mtApproachingAriadne:boolean;mtFollowingHerLead:boolean;mtLeavingWhileSheWaits:boolean;mtReturningToHer:boolean;
};
export type BodyPose={x:number;y:number;angle:number};
export type RelationshipPhase="charming"|"attached"|"overbearing";

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const wrap=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));
const distance=(a:[number,number],b:[number,number])=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const pointCell=(point:[number,number]):Point=>[Math.floor(point[0]),Math.floor(point[1])];
const sameCell=(a:Point,b:Point)=>a[0]===b[0]&&a[1]===b[1];

function openAt(world:InfiniteWorld,x:number,y:number,tick:number,radius=.12){
  return world.tile(Math.floor(x-radius),Math.floor(y-radius),tick)===0&&world.tile(Math.floor(x+radius),Math.floor(y-radius),tick)===0&&world.tile(Math.floor(x-radius),Math.floor(y+radius),tick)===0&&world.tile(Math.floor(x+radius),Math.floor(y+radius),tick)===0;
}
function lineOpen(world:InfiniteWorld,from:[number,number],to:[number,number],tick:number){
  const dx=to[0]-from[0],dy=to[1]-from[1],length=Math.hypot(dx,dy);if(length<.15)return true;
  for(let d=.08;d<length-.08;d+=.06)if(world.tile(Math.floor(from[0]+dx/length*d),Math.floor(from[1]+dy/length*d),tick)!==0)return false;
  return true;
}

function shoulderPoint(pose:BodyPose,side:-1|1,distanceFromMT:number):[number,number]{
  const forward=.86,rightX=-Math.sin(pose.angle),rightY=Math.cos(pose.angle);
  return[pose.x+Math.cos(pose.angle)*forward+rightX*side*distanceFromMT,pose.y+Math.sin(pose.angle)*forward+rightY*side*distanceFromMT];
}

function visibleCompanionPoint(world:InfiniteWorld,pose:BodyPose,tick:number,preferred:[number,number],alternate:[number,number]):[number,number]{
  const player:[number,number]=[pose.x,pose.y],usable=(point:[number,number])=>openAt(world,point[0],point[1],tick)&&lineOpen(world,player,point,tick);
  if(usable(preferred))return preferred;if(usable(alternate))return alternate;
  for(const distanceFromMT of [.82,.66,.5,.32,.18])for(const offset of [0,-.16,.16,-.3,.3,-.42,.42]){
    const angle=pose.angle+offset,point:[number,number]=[pose.x+Math.cos(angle)*distanceFromMT,pose.y+Math.sin(angle)*distanceFromMT];if(usable(point))return point;
  }
  return[pose.x+Math.cos(pose.angle)*.28,pose.y+Math.sin(pose.angle)*.28];
}

function phaseDistance(phase:RelationshipPhase,attachment=0){return Math.max(.13,(phase==="charming"?.34:phase==="attached"?.27:.2)-attachment*.035)}
function phaseWait(phase:RelationshipPhase){return phase==="charming"?4.5:phase==="attached"?5.5:6.5}

export function createAriadneBody(pose:BodyPose,now=0,world?:InfiniteWorld,tick=0):AriadneBodyState{
  const right=shoulderPoint(pose,1,phaseDistance("charming")),left=shoulderPoint(pose,-1,phaseDistance("charming")),side:-1|1=world&&!openAt(world,right[0],right[1],tick)&&openAt(world,left[0],left[1],tick)?-1:1;
  const candidate=side===1?right:left,position:[number,number]=world&&!openAt(world,candidate[0],candidate[1],tick)?[pose.x,pose.y]:candidate;
  return{position,height:.76,velocity:[0,0,0],mode:"hovering_beside",emotion:"curious",side,targetRouteId:null,routeCells:[],decisionCell:null,approachCell:null,expectedChoiceCell:null,choiceCells:[],reachedDecision:false,leadStartedAt:0,waitStartedAt:0,speakUntil:0,emotionUntil:now,thinkingSince:null,decisionEmphasisStartedAt:0,decisionEmphasisUntil:0,decisionOrigin:[...position],decisionArcSign:-side,apologyStartedAt:0,apologyOrigin:[...position],apologyReady:false,lastTrailAt:now,trail:[],lastPlayerPosition:[pose.x,pose.y],lastPlayerAngle:pose.angle,approachingUntil:0,departureRouteId:null,wasLeftWhileWaiting:false,mtFollowingHerLead:false,mtLeavingWhileSheWaits:false,mtReturningToHer:false};
}

function routeApproachCell(cells:Point[],decisionCell:Point|null,fallback:Point){
  if(!decisionCell)return fallback;const index=cells.findIndex(cell=>sameCell(cell,decisionCell));return index>0?cells[index-1]!:fallback;
}

export function beginAriadneRoute(body:AriadneBodyState,route:Pick<RouteOption,"id"|"knownCells"|"decisionCell"|"targetCell"|"decisionPoint">,pose:BodyPose,now:number){
  body.targetRouteId=route.id;body.routeCells=route.knownCells.slice(0,20);body.decisionCell=route.decisionCell??pointCell([pose.x,pose.y]);body.expectedChoiceCell=route.decisionPoint==="upcoming"?route.targetCell:route.knownCells[0]??null;
  body.approachCell=routeApproachCell(body.routeCells,body.decisionCell,pointCell([pose.x,pose.y]));
  body.reachedDecision=body.decisionCell?sameCell(pointCell([pose.x,pose.y]),body.decisionCell):false;body.leadStartedAt=now;body.waitStartedAt=0;body.mode="noticing_choice";body.emotion="encouraging";body.emotionUntil=now+5000;
  const destination=body.expectedChoiceCell??route.targetCell??route.knownCells.at(-1)??pointCell([pose.x+Math.cos(pose.angle),pose.y+Math.sin(pose.angle)]),relative=wrap(Math.atan2(destination[1]+.5-pose.y,destination[0]+.5-pose.x)-pose.angle);
  body.decisionOrigin=[...body.position];body.decisionArcSign=Math.abs(relative)>.1?(relative<0?-1:1):-body.side;
  body.decisionEmphasisStartedAt=now;body.decisionEmphasisUntil=now+2800;
  body.choiceCells=[];body.wasLeftWhileWaiting=false;body.mtFollowingHerLead=false;body.mtLeavingWhileSheWaits=false;body.mtReturningToHer=false;
}

export function noticeAriadneChoice(body:AriadneBodyState,now:number){
  body.targetRouteId=null;body.routeCells=[];body.decisionCell=null;body.approachCell=null;body.expectedChoiceCell=null;body.choiceCells=[];body.reachedDecision=false;
  body.leadStartedAt=now;body.waitStartedAt=0;body.mode="noticing_choice";body.emotion="curious";body.emotionUntil=now+2400;body.thinkingSince=now;
  body.decisionOrigin=[...body.position];body.decisionArcSign=-body.side;body.decisionEmphasisStartedAt=now;body.decisionEmphasisUntil=now+3200;
}

export function cancelAriadneChoiceNotice(body:AriadneBodyState){
  if(body.mode==="noticing_choice"&&!body.targetRouteId)body.mode="hovering_beside";
  body.thinkingSince=null;
}

export function beginAriadneGuidance(body:AriadneBodyState,intent:GuidanceIntent,now:number){
  const continuingSameChoice=!!intent.expectedChoiceCell&&!!body.expectedChoiceCell&&sameCell(intent.expectedChoiceCell,body.expectedChoiceCell)&&(body.mode==="noticing_choice"||body.mode==="leading"||body.mode==="waiting_ahead");
  body.targetRouteId=intent.suggestedRouteId;body.routeCells=intent.suggestedCells.slice(0,20);body.decisionCell=intent.decisionCell;body.expectedChoiceCell=intent.expectedChoiceCell;
  body.approachCell=routeApproachCell(body.routeCells,body.decisionCell,pointCell(body.decisionOrigin));
  if(!continuingSameChoice){body.leadStartedAt=now;body.waitStartedAt=0;body.mode="noticing_choice";body.decisionEmphasisStartedAt=now;body.decisionEmphasisUntil=now+2400}body.emotion="encouraging";body.emotionUntil=now+5000;
  body.choiceCells=[];body.wasLeftWhileWaiting=false;body.mtFollowingHerLead=false;body.mtLeavingWhileSheWaits=false;body.mtReturningToHer=false;
}

export function prepareAriadneForEvent(body:AriadneBodyState,eventType:string,now:number){
  body.thinkingSince=now;
  if(eventType==="player_message"){body.mode="looking_around";body.emotion="curious";body.emotionUntil=now+2400;return}
  if(eventType==="recommendation_contradicted"||eventType==="dead_end_visible"){
    body.mode="apology_spiral";body.emotion="apologetic";body.apologyStartedAt=now;body.apologyOrigin=[...body.position];body.apologyReady=false;body.emotionUntil=now+7000;body.velocity[0]*=-.45;body.velocity[1]*=-.45;body.velocity[2]=Math.min(body.velocity[2],-.22);body.targetRouteId=null;body.routeCells=[];body.decisionCell=null;body.approachCell=null;body.expectedChoiceCell=null;body.choiceCells=[];body.decisionEmphasisUntil=now;return;
  }
  if(eventType==="star_collected"||eventType==="same_target_reached_differently"||eventType==="encounter_completed"){
    body.mode="celebrating";body.emotion="delighted";body.emotionUntil=now+2600;
  }
}

export function reactAriadneToResonance(body:AriadneBodyState,completed:boolean,now:number){
  body.emotion="delighted";body.emotionUntil=now+(completed?2600:900);body.decisionEmphasisStartedAt=now;body.decisionEmphasisUntil=now+(completed?1500:650);
  if(completed)body.mode="celebrating";
  else if(!["leading","waiting_ahead","apology_spiral","apologizing"].includes(body.mode))body.mode="examining_object";
}

export function speakAsAriadne(body:AriadneBodyState,text:string,eventType:string,now:number){
  const readingMs=clamp(900+text.length*34,1700,6200);body.thinkingSince=null;body.speakUntil=now+readingMs;
  if(eventType==="recommendation_contradicted"||eventType==="dead_end_visible"){body.mode="apologizing";body.emotion="apologetic";if(!body.apologyStartedAt)body.apologyStartedAt=now;body.apologyReady=true;body.emotionUntil=Math.max(body.emotionUntil,now+readingMs);return}
  if(eventType==="star_collected"||eventType==="same_target_reached_differently"||eventType==="trajectory_relationship_changed"||eventType==="encounter_completed"){
    body.mode="celebrating";body.emotion="delighted";body.emotionUntil=Math.max(body.emotionUntil,now+Math.min(readingMs,3000));return;
  }
  if(body.mode!=="leading"&&body.mode!=="waiting_ahead")body.mode="speaking";
}

export function settleAriadneThinking(body:AriadneBodyState){body.thinkingSince=null}

function routeTarget(body:AriadneBodyState,pose:BodyPose,world:InfiniteWorld,tick:number):[number,number]|null{
  const player:[number,number]=[pose.x,pose.y],points=body.routeCells.map(([x,y])=>[x+.5,y+.5] as [number,number]).filter(point=>openAt(world,point[0],point[1],tick)&&lineOpen(world,player,point,tick));
  if(!points.length)return null;
  const expected=body.expectedChoiceCell?[body.expectedChoiceCell[0]+.5,body.expectedChoiceCell[1]+.5] as [number,number]:null;
  const leadEnvelope=2.45;
  if(expected&&openAt(world,expected[0],expected[1],tick)&&lineOpen(world,player,expected,tick)&&distance(expected,player)<=leadEnvelope)return expected;
  const useful=points.filter(point=>{const d=distance(point,[pose.x,pose.y]);return d>=1.05&&d<=leadEnvelope});
  return useful.at(-1)??points.find(point=>distance(point,[pose.x,pose.y])>.65)??points[0]!;
}

function collisionAwareStep(body:AriadneBodyState,target:[number,number],world:InfiniteWorld,tick:number,dt:number,speed:number){
  const dx=target[0]-body.position[0],dy=target[1]-body.position[1],omega=body.mode==="apology_spiral"?9:body.mode==="leading"?6.4:body.mode==="noticing_choice"?6.1:body.mode==="catching_up"?6.2:4.5;
  body.velocity[0]+=(omega*omega*dx-2*omega*body.velocity[0])*dt;body.velocity[1]+=(omega*omega*dy-2*omega*body.velocity[1])*dt;
  const velocity=Math.hypot(body.velocity[0],body.velocity[1]);if(velocity>speed){body.velocity[0]=body.velocity[0]/velocity*speed;body.velocity[1]=body.velocity[1]/velocity*speed}
  const nx=body.position[0]+body.velocity[0]*dt,ny=body.position[1]+body.velocity[1]*dt;
  if(openAt(world,nx,ny,tick)){body.position=[nx,ny];return}
  if(openAt(world,nx,body.position[1],tick)){body.position=[nx,body.position[1]];body.velocity[1]*=-.2;return}
  if(openAt(world,body.position[0],ny,tick)){body.position=[body.position[0],ny];body.velocity[0]*=-.2;return}
  body.velocity[0]*=-.25;body.velocity[1]*=-.25;
}

export function updateAriadneBody(body:AriadneBodyState,args:{world:InfiniteWorld;tick:number;pose:BodyPose;phase:RelationshipPhase;disposition?:AriadneDisposition;playerSpeed?:number;dt:number;now:number;reducedMotion:boolean}){
  const{world,tick,pose,phase,disposition,dt,now,reducedMotion}=args,playerSpeed=Math.abs(args.playerSpeed??0),player:[number,number]=[pose.x,pose.y],playerCell=pointCell(player);
  const turnDelta=wrap(pose.angle-body.lastPlayerAngle),staysNearMT=!(body.mode==="leading"||body.mode==="waiting_ahead");
  if(staysNearMT&&Math.abs(turnDelta)>.0001){
    const carry=turnDelta*(reducedMotion ? .985 : .955),dx=body.position[0]-pose.x,dy=body.position[1]-pose.y,cos=Math.cos(carry),sin=Math.sin(carry);
    const swept:[number,number]=[pose.x+dx*cos-dy*sin,pose.y+dx*sin+dy*cos];
    if(openAt(world,swept[0],swept[1],tick)&&lineOpen(world,player,swept,tick))body.position=swept;
  }
  body.lastPlayerAngle=pose.angle;
  const attentive=body.thinkingSince!==null||body.mode==="speaking",repairing=body.mode==="apology_spiral"||body.mode==="apologizing",companionDistance=phaseDistance(phase,disposition?.attachment)*(attentive?.68:1),motionLead=repairing?0:Math.min(1.05,playerSpeed*(reducedMotion?.24:.38)),leadX=Math.cos(pose.angle)*motionLead,leadY=Math.sin(pose.angle)*motionLead,basePreferred=shoulderPoint(pose,body.side,companionDistance),baseOther=shoulderPoint(pose,body.side===1?-1:1,companionDistance),preferred:[number,number]=[basePreferred[0]+leadX,basePreferred[1]+leadY],other:[number,number]=[baseOther[0]+leadX,baseOther[1]+leadY];
  const preferredVisible=openAt(world,preferred[0],preferred[1],tick)&&lineOpen(world,player,preferred,tick),otherVisible=openAt(world,other[0],other[1],tick)&&lineOpen(world,player,other,tick);
  if(!preferredVisible&&otherVisible)body.side=body.side===1?-1:1;
  const shoulder=visibleCompanionPoint(world,pose,tick,body.side===1?preferred:other,body.side===1?other:preferred);
  if(!openAt(world,body.position[0],body.position[1],tick)){body.position=[...shoulder];body.velocity=[0,0,0];body.trail=[]}
  const targetOnRoute=routeTarget(body,pose,world,tick),expectedPoint=body.expectedChoiceCell?[body.expectedChoiceCell[0]+.5,body.expectedChoiceCell[1]+.5] as [number,number]:null,elapsed=(now-body.leadStartedAt)/1000,atDecision=!!body.decisionCell&&sameCell(playerCell,body.decisionCell),onApproach=!!body.approachCell&&sameCell(playerCell,body.approachCell),adjacentToDecision=!!body.decisionCell&&Math.abs(playerCell[0]-body.decisionCell[0])+Math.abs(playerCell[1]-body.decisionCell[1])===1;
  if(body.mode==="noticing_choice"&&body.targetRouteId&&elapsed>=(reducedMotion?.14:.18))body.mode="leading";
  if(atDecision){body.reachedDecision=true;body.choiceCells=[]}
  if(body.reachedDecision){
    if(atDecision||onApproach)body.choiceCells=[];
    else{
      const last=body.choiceCells.at(-1);
      if(!last&&adjacentToDecision)body.choiceCells=[playerCell];
      else if(last&&!sameCell(last,playerCell)&&Math.abs(last[0]-playerCell[0])+Math.abs(last[1]-playerCell[1])===1){
        const earlier=body.choiceCells.findIndex(cell=>sameCell(cell,playerCell));body.choiceCells=earlier>=0?body.choiceCells.slice(0,earlier+1):[...body.choiceCells,playerCell].slice(-4);
      }
    }
  }
  const committedBranch=body.choiceCells.length>=3?body.choiceCells[0]??null:null,followedChoice=!!committedBranch&&!!body.expectedChoiceCell&&sameCell(committedBranch,body.expectedChoiceCell),divergedChoice=!!committedBranch&&!followedChoice;
  if(followedChoice&&elapsed>.7){body.mtFollowingHerLead=true;if(body.wasLeftWhileWaiting)body.mtReturningToHer=true;body.mode=body.mtReturningToHer?"celebrating":"returning";body.emotion=body.mtReturningToHer?"relieved":"delighted";body.emotionUntil=now+2200}
  else if(divergedChoice){body.wasLeftWhileWaiting=true;body.mtLeavingWhileSheWaits=true;body.departureRouteId=body.targetRouteId;body.mode="returning";body.emotion="clingy";body.emotionUntil=now+3200}
  else if((body.mode==="leading"||body.mode==="waiting_ahead")&&targetOnRoute){
    if(body.mode==="leading"&&expectedPoint&&distance(body.position,expectedPoint)<.3){body.mode="waiting_ahead";body.waitStartedAt=now}
    else if(body.mode==="waiting_ahead"){
      const playerToTarget=distance(player,targetOnRoute);
      if(!body.choiceCells.length&&((now-body.waitStartedAt)/1000>phaseWait(phase)||playerToTarget>3.15)){body.mode="returning"}
    }
  }else if((body.mode==="leading"||body.mode==="waiting_ahead")&&!targetOnRoute&&!body.choiceCells.length)body.mode="returning";
  if(body.mode==="celebrating"&&now>body.emotionUntil)body.mode="returning";
  if((body.mode==="examining_object"||body.mode==="looking_around")&&now>body.emotionUntil)body.mode="hovering_beside";
  if(body.mode==="apology_spiral"&&now-body.apologyStartedAt>=(reducedMotion?650:1450))body.mode="apologizing";
  if(body.mode==="apologizing"&&now>body.emotionUntil)body.mode="returning";
  if(body.mode==="speaking"&&now>body.speakUntil)body.mode="hovering_beside";
  const atShoulder=distance(body.position,shoulder)<.2;
  if(body.mode==="returning"&&atShoulder){body.mode="hovering_beside";body.targetRouteId=null;body.routeCells=[];body.decisionCell=null;body.approachCell=null;body.expectedChoiceCell=null;body.choiceCells=[];body.reachedDecision=false}
  const hoverTime=now*.001,hoverScale=reducedMotion?.28:1,hoverOffset=(Math.sin(hoverTime*1.37)*.105+Math.sin(hoverTime*.61+1.4)*.055+Math.sin(hoverTime*2.17+.3)*.022)*hoverScale;
  const celebrationOffset=body.mode==="celebrating"&&!reducedMotion?[Math.cos(hoverTime*7)*.42,Math.sin(hoverTime*7)*.42] as [number,number]:[0,0] as [number,number];
  const waitingOffset=body.mode==="waiting_ahead"&&!reducedMotion?[Math.sin(hoverTime*1.8)*.07,Math.sin(hoverTime*3.6)*.035] as [number,number]:[0,0] as [number,number];
  const ambientDrift=!(body.mode==="leading"||body.mode==="waiting_ahead"||body.mode==="returning"||body.mode==="catching_up"||body.mode==="apology_spiral")?(()=>{
    const scale=body.mode==="apologizing"?.12:body.mode==="noticing_choice"?.28:body.mode==="speaking"?.62:1;
    const forward=(Math.sin(hoverTime*.73)*.075+Math.sin(hoverTime*1.91+.8)*.024)*hoverScale*scale;
    const lateral=(Math.sin(hoverTime*1.09+1.2)*.105+Math.sin(hoverTime*.47+.15)*.04)*hoverScale*scale;
    return[Math.cos(pose.angle)*forward-Math.sin(pose.angle)*lateral,Math.sin(pose.angle)*forward+Math.cos(pose.angle)*lateral] as [number,number]
  })():[0,0] as [number,number];
  let target=body.mode==="leading"||body.mode==="waiting_ahead"?targetOnRoute??(body.choiceCells.length?[...body.position] as [number,number]:shoulder):shoulder;
  if(body.mode==="apology_spiral"){
    const progress=clamp((now-body.apologyStartedAt)/(reducedMotion?650:1450),0,1),angle=progress*Math.PI*(reducedMotion?2:4),radius=reducedMotion?.2:.43;
    target=[body.apologyOrigin[0]+Math.cos(angle)*radius,body.apologyOrigin[1]+Math.sin(angle)*radius];
  }
  if(body.mode==="apologizing"){
    const apologyForward=.42,apologySide=.1,sideX=-Math.sin(pose.angle),sideY=Math.cos(pose.angle);
    target=[pose.x+Math.cos(pose.angle)*apologyForward+sideX*body.side*apologySide,pose.y+Math.sin(pose.angle)*apologyForward+sideY*body.side*apologySide];
  }
  target=[target[0]+celebrationOffset[0]+waitingOffset[0]+ambientDrift[0],target[1]+celebrationOffset[1]+waitingOffset[1]+ambientDrift[1]];
  const decisionSpan=Math.max(1,body.decisionEmphasisUntil-body.decisionEmphasisStartedAt),decisionProgress=clamp((now-body.decisionEmphasisStartedAt)/decisionSpan,0,1),decisionActive=now<body.decisionEmphasisUntil;
  if(body.mode==="leading"&&decisionActive&&decisionProgress<.2){const gather=decisionProgress/.2,back=.18*(1-gather);target=[shoulder[0]-Math.cos(pose.angle)*back,shoulder[1]-Math.sin(pose.angle)*back]}
  else if(body.mode==="leading"&&targetOnRoute){const flightProgress=clamp((now-body.leadStartedAt)/1250,0,1),arc=Math.sin(flightProgress*Math.PI)*(reducedMotion?.16:.5),dx=targetOnRoute[0]-body.decisionOrigin[0],dy=targetOnRoute[1]-body.decisionOrigin[1],length=Math.max(.001,Math.hypot(dx,dy));target=[target[0]-dy/length*arc*body.decisionArcSign,target[1]+dx/length*arc*body.decisionArcSign]}
  const bodyAngle=wrap(Math.atan2(body.position[1]-pose.y,body.position[0]-pose.x)-pose.angle),guiding=body.mode==="leading"||body.mode==="waiting_ahead",farFromPlayer=distance(body.position,player)>(guiding?3.05:1.7),bodyOccluded=!lineOpen(world,player,body.position,tick),shouldReacquire=(Math.abs(bodyAngle)>CAMERA_FOV*.48||bodyOccluded)&&!guiding;
  if(farFromPlayer||shouldReacquire){target=repairing?target:shoulder;if(!repairing)body.mode="catching_up"}
  const insistence=disposition?.insistence??0,leadSpeed=Math.max(reducedMotion?3.2:4.15,playerSpeed*(reducedMotion?1.35:1.8)+(reducedMotion?.2:1.05)),noticeSpeed=Math.max(reducedMotion?1.8:2.25,playerSpeed*(reducedMotion?1.18:1.4)),companionSpeed=Math.max(reducedMotion?1.35:2.05,playerSpeed*(reducedMotion?1.18:1.32)+(reducedMotion?.18:.48)),speed=body.mode==="apology_spiral"?Math.max(3.1,playerSpeed*1.45+.6):body.mode==="leading"?leadSpeed:body.mode==="noticing_choice"?noticeSpeed:body.mode==="catching_up"?Math.max(3.35+insistence*.55,playerSpeed*1.55+.7):body.mode==="returning"?Math.max(2.55+insistence*.35,playerSpeed*1.38+.5):body.mode==="celebrating"?Math.max(2.4,playerSpeed*1.3+.4):companionSpeed;
  collisionAwareStep(body,target,world,tick,dt,speed);
  const oldPlayerDistance=distance(body.position,body.lastPlayerPosition),newPlayerDistance=distance(body.position,player),playerTravel=distance(body.lastPlayerPosition,player);if(playerTravel>.006&&newPlayerDistance<oldPlayerDistance-.004)body.approachingUntil=now+900;body.lastPlayerPosition=[...player];
  const decisionLift=decisionActive?Math.sin(decisionProgress*Math.PI)*.18:0,attentionLift=body.thinkingSince!==null&&!repairing?.07:0,targetHeight=body.mode==="apologizing"?.43:body.mode==="apology_spiral"?.66:.76+hoverOffset+decisionLift+attentionLift+(phase==="overbearing"?.03:0),heightResponse=1-Math.exp(-dt*(repairing?7:5));
  body.velocity[2]+=(targetHeight-body.height)*heightResponse*4;body.velocity[2]*=Math.exp(-dt*4);body.height=clamp(body.height+body.velocity[2]*dt,.38,1.08);
  if(!reducedMotion&&Math.hypot(body.velocity[0],body.velocity[1])>.45&&now-body.lastTrailAt>(decisionActive?38:70)){body.trail.push({x:body.position[0],y:body.position[1],height:body.height,bornAt:now});body.lastTrailAt=now}
  body.trail=body.trail.filter(point=>now-point.bornAt<850).slice(-14);
  if(body.mode==="apologizing"&&distance(body.position,player)<.72&&body.height<.58)body.apologyReady=true;
  const settledBearing=wrap(Math.atan2(body.position[1]-pose.y,body.position[0]-pose.x)-pose.angle),visiblyRejoined=distance(body.position,player)<1.35&&Math.abs(settledBearing)<CAMERA_FOV*.42&&lineOpen(world,player,body.position,tick);
  if(body.mode==="catching_up"&&(distance(body.position,shoulder)<.3||visiblyRejoined)){body.mode="hovering_beside";if(body.mtLeavingWhileSheWaits||body.mtFollowingHerLead){body.targetRouteId=null;body.routeCells=[];body.decisionCell=null;body.approachCell=null;body.expectedChoiceCell=null;body.choiceCells=[];body.reachedDecision=false}}
  return body;
}

export function describeAriadneEmbodiment(body:AriadneBodyState,pose:BodyPose,world:InfiniteWorld,tick:number,evidence:GuidanceEvidence|null):AriadneEmbodimentContext{
  const dx=body.position[0]-pose.x,dy=body.position[1]-pose.y,dist=Math.hypot(dx,dy),relative=wrap(Math.atan2(dy,dx)-pose.angle),visible=Math.abs(relative)<.18&&lineOpen(world,[pose.x,pose.y],body.position,tick);
  const side=Math.abs(relative)>2.35?"behind MT":relative<-.34?"beside MT's left shoulder":relative>.34?"beside MT's right shoulder":"just ahead of MT";
  const actions:Record<AriadneBodyMode,string>={hovering_beside:`You are floating naturally ${side}.`,catching_up:"You are hurrying back to hover beside MT.",looking_around:"You have turned toward MT and are waiting attentively.",noticing_choice:"You have gone briefly still and are looking between the visible passages before committing.",examining_object:"You briefly drifted toward something visible, while staying close to MT.",speaking:`You are glowing beside MT as you speak.`,leading:"You have flown toward the passage you currently believe in.",waiting_ahead:"You are hovering at your chosen passage, looking back toward MT.",returning:"You are curving back to MT's side.",apology_spiral:"You are circling in visible dismay at the passage that disproved your guidance before returning to MT.",apologizing:"You have returned close to MT, lowered yourself, and softened your light after your mistaken guidance.",celebrating:"You are making one delighted loop before settling beside MT again."};
  const relation=body.targetRouteId?body.mode==="waiting_ahead"?"You are physically waiting at the passage you recommended.":body.mode==="leading"?"Your flight is showing MT the passage you recommended.":"You are returning from the passage you recommended.":null;
  return{currentAction:actions[body.mode],positionRelativeToMT:side,relationToBelievedRoute:relation,mtLookingAtAriadne:visible&&dist<3,mtApproachingAriadne:Date.now()<body.approachingUntil||body.mtFollowingHerLead||!!evidence?.currentlyNearSuggestedRoute,mtFollowingHerLead:body.mtFollowingHerLead,mtLeavingWhileSheWaits:body.mtLeavingWhileSheWaits,mtReturningToHer:body.mtReturningToHer};
}
