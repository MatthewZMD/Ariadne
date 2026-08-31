import type { PerceivedScene } from "./scene.ts";
import type { AtlasSpriteKind } from "./sprite-atlas.ts";
import type { AmbientEntity, ThemeId } from "./themes.ts";
import { ARIADNE_REFERENCE_GAIN } from "./ariadne-voice.ts";

type SoundFamily="wave"|"wind"|"insects"|"frog"|"paper"|"industrial"|"cave"|"glass"|"stone"|"grass"|"metal"|"steam";
type RetroTreatment={filter:BiquadFilterType;frequency:number;q:number;bits:number;mix:number;flutterCents:number};
type SoundProfile={path:string;gain:number;rate:[number,number];retro:RetroTreatment};
type Pose={x:number;y:number;angle:number};
type Candidate={id:string;kind:string;position:[number,number];gainScale:number};
type Emitter={source:AudioBufferSourceNode;filter:BiquadFilterNode;shaper:WaveShaperNode;gain:GainNode;panner:PannerNode;lfo:OscillatorNode;lfoGain:GainNode;family:SoundFamily;lastSeen:number};

export type InteractionSoundKind="wake"|"complete"|"star_response"|"star_collect"|"collision";
export const AMBIENT_BUS_RELATIVE_TO_ARIADNE_DB=-7.5;
export const INTERACTION_BUS_RELATIVE_TO_ARIADNE_DB=-6;
const dbGain=(decibels:number)=>10**(decibels/20);
const AMBIENT_MASTER_GAIN=ARIADNE_REFERENCE_GAIN*dbGain(AMBIENT_BUS_RELATIVE_TO_ARIADNE_DB);
const INTERACTION_MASTER_GAIN=ARIADNE_REFERENCE_GAIN*dbGain(INTERACTION_BUS_RELATIVE_TO_ARIADNE_DB);
const MAX_EMITTERS=10;

export const SOUND_PROFILES:Record<SoundFamily,SoundProfile>={
  wave:{path:"/audio/ambience/wave.mp3",gain:.5,rate:[.9,1.04],retro:{filter:"lowpass",frequency:4800,q:.35,bits:9,mix:.18,flutterCents:6}},
  wind:{path:"/audio/ambience/wind.mp3",gain:.18,rate:[.82,1.08],retro:{filter:"lowpass",frequency:3400,q:.3,bits:8,mix:.15,flutterCents:4}},
  insects:{path:"/audio/ambience/insects.mp3",gain:.8,rate:[.94,1.05],retro:{filter:"lowpass",frequency:6200,q:.45,bits:8,mix:.22,flutterCents:8}},
  frog:{path:"/audio/ambience/frog.mp3",gain:.55,rate:[.92,1.06],retro:{filter:"lowpass",frequency:4200,q:.55,bits:8,mix:.2,flutterCents:10}},
  paper:{path:"/audio/ambience/paper.mp3",gain:3,rate:[.72,1.08],retro:{filter:"bandpass",frequency:2600,q:.4,bits:7,mix:.25,flutterCents:9}},
  industrial:{path:"/audio/ambience/industrial.mp3",gain:.28,rate:[.82,1.02],retro:{filter:"lowpass",frequency:2600,q:.6,bits:7,mix:.23,flutterCents:5}},
  cave:{path:"/audio/ambience/cave-drips.mp3",gain:3,rate:[.9,1.04],retro:{filter:"lowpass",frequency:3900,q:.5,bits:9,mix:.18,flutterCents:8}},
  glass:{path:"/audio/ambience/glass-chime.mp3",gain:.5,rate:[.62,1.02],retro:{filter:"bandpass",frequency:4400,q:.7,bits:8,mix:.26,flutterCents:12}},
  stone:{path:"/audio/ambience/stone.mp3",gain:1.5,rate:[.5,.78],retro:{filter:"lowpass",frequency:2200,q:.5,bits:8,mix:.2,flutterCents:4}},
  grass:{path:"/audio/ambience/grass.mp3",gain:8,rate:[.82,1.08],retro:{filter:"lowpass",frequency:5200,q:.4,bits:9,mix:.2,flutterCents:7}},
  metal:{path:"/audio/ambience/metal-rattle.mp3",gain:.8,rate:[.7,.96],retro:{filter:"bandpass",frequency:2500,q:.65,bits:7,mix:.24,flutterCents:5}},
  steam:{path:"/audio/ambience/steam.mp3",gain:2,rate:[.72,.96],retro:{filter:"bandpass",frequency:1800,q:.35,bits:8,mix:.2,flutterCents:6}},
};

export const OBJECT_SOUND_FAMILY:Record<AtlasSpriteKind,SoundFamily>={
  crab:"grass",ripple:"wave",shell:"wave",grass:"grass",driftwood:"wave",
  tumbleweed:"grass",dust:"wind",warning:"metal",fence:"metal",debris:"wind",
  firefly:"insects",frog:"frog",vine:"grass",statue:"stone",fungus:"grass",
  moth:"paper",page:"paper",shelf:"stone",icicle:"glass",paper:"paper",
  ember:"industrial",spark:"glass",pipe:"industrial",vent:"steam",slag:"stone",
  glowmoth:"insects",mote:"glass",crystal:"glass",mushroom:"grass",spore:"cave",
  rune:"glass",fossil:"stone",
};

const THEME_BED:Record<ThemeId,SoundFamily>={neutral:"stone",beach:"wave",tornado:"wind",ruins:"insects",frozen:"paper",foundry:"industrial",cavern:"cave"};
const THEME_PITCH:Record<ThemeId,number>={neutral:.82,beach:.92,tornado:.72,ruins:1,frozen:1.2,foundry:.64,cavern:1.34};
export const RETRO_INTERACTION_PATTERNS:Record<InteractionSoundKind,{notes:number[];step:number;length:number;volume:number;wave:OscillatorType}>={
  wake:{notes:[392,523],step:.065,length:.15,volume:.07,wave:"square"},
  complete:{notes:[330,440,554,659],step:.1,length:.58,volume:.09,wave:"square"},
  star_response:{notes:[523,659,784,1047],step:.11,length:.72,volume:.105,wave:"triangle"},
  star_collect:{notes:[523,659,784,1047,1319],step:.09,length:.68,volume:.13,wave:"square"},
  collision:{notes:[110,73],step:.026,length:.09,volume:.055,wave:"sawtooth"},
};

export function soundFamilyFor(kind:string,theme:ThemeId="neutral"):SoundFamily{
  if(kind in OBJECT_SOUND_FAMILY)return OBJECT_SOUND_FAMILY[kind as AtlasSpriteKind];
  if(/frog/.test(kind))return"frog";
  if(/fish|water|bubble|shell|crab|sand/.test(kind))return"wave";
  if(/wind|cloud|debris|lightning|umbrella|warning/.test(kind))return"wind";
  if(/page|book|frost|snow|ice/.test(kind))return"paper";
  if(/pipe|furnace|gauge|ember/.test(kind))return"industrial";
  if(/steam/.test(kind))return"steam";
  if(/moth|firefly|spore|mushroom|leaf|vine/.test(kind))return"insects";
  if(/crystal|rainbow|light|rune/.test(kind))return"glass";
  if(/stone|face|fossil|door|mouth|eye/.test(kind))return"stone";
  return THEME_BED[theme];
}

const hash=(value:string)=>{let result=2166136261;for(const char of value){result^=char.charCodeAt(0);result=Math.imul(result,16777619)}return result>>>0};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const ramp=(param:AudioParam,value:number,context:AudioContext,duration=.45)=>{const now=context.currentTime;param.cancelScheduledValues(now);param.setValueAtTime(param.value,now);param.linearRampToValueAtTime(value,now+duration)};
const retroCurve=(bits:number,mixAmount:number)=>{const curve=new Float32Array(2048),steps=2**(bits-1),wet=clamp(mixAmount,0,1);for(let index=0;index<curve.length;index++){const dry=index/(curve.length-1)*2-1,crushed=Math.round(dry*steps)/steps;curve[index]=dry*(1-wet)+crushed*wet}return curve};

export type AmbientSoundscape={
  unlock:()=>void;
  pause:()=>void;
  resume:()=>void;
  setMasterVolume:(volume:number)=>void;
  update:(args:{playing:boolean;speaking:boolean;pose:Pose;entities:AmbientEntity[];scene:PerceivedScene|null;theme:ThemeId})=>void;
  playInteraction:(args:{kind:InteractionSoundKind;id:string;position:[number,number];pose:Pose;theme:ThemeId;progress?:number})=>void;
  reset:()=>void;
  destroy:()=>void;
};

export function createAmbientSoundscape():AmbientSoundscape{
  let context:AudioContext|null=null,destroyed=false,unlocked=false,paused=false,activeTheme:ThemeId="neutral",masterVolume=1;
  const buffers=new Map<SoundFamily,Promise<AudioBuffer|null>>(),emitters=new Map<string,Emitter>(),pending=new Set<string>();
  const interactionSources=new Set<AudioScheduledSourceNode>(),lastInteractionAt=new Map<InteractionSoundKind,number>();
  let master:GainNode|null=null,interactionBus:GainNode|null=null,limiter:DynamicsCompressorNode|null=null;

  const ensureContext=()=>{
    if(context)return context;
    context=new AudioContext();master=context.createGain();interactionBus=context.createGain();limiter=context.createDynamicsCompressor();master.gain.value=0;interactionBus.gain.value=0;
    limiter.threshold.value=-18;limiter.knee.value=12;limiter.ratio.value=4;limiter.attack.value=.01;limiter.release.value=.25;
    master.connect(limiter);interactionBus.connect(limiter);limiter.connect(context.destination);return context;
  };
  const load=(family:SoundFamily)=>{
    const existing=buffers.get(family);if(existing)return existing;
    const ctx=ensureContext(),promise=fetch(SOUND_PROFILES[family].path).then(response=>{if(!response.ok)throw new Error("ambient source unavailable");return response.arrayBuffer()}).then(encoded=>ctx.decodeAudioData(encoded.slice(0))).catch(()=>null);
    buffers.set(family,promise);return promise;
  };
  const stopEmitter=(id:string,duration=.7)=>{
    const emitter=emitters.get(id);if(!emitter||!context)return;emitters.delete(id);ramp(emitter.gain.gain,0,context,duration);const source=emitter.source;setTimeout(()=>{try{source.stop();emitter.lfo.stop()}catch(error){void error}source.disconnect();emitter.filter.disconnect();emitter.shaper.disconnect();emitter.gain.disconnect();emitter.panner.disconnect();emitter.lfo.disconnect();emitter.lfoGain.disconnect()},duration*1000+80);
  };
  const startEmitter=async(candidate:Candidate,family:SoundFamily)=>{
    if(!context||!master||pending.has(candidate.id)||emitters.has(candidate.id))return;
    pending.add(candidate.id);const ctx=context,buffer=await load(family);pending.delete(candidate.id);
    if(!buffer||destroyed||!unlocked||context!==ctx||emitters.has(candidate.id))return;
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),shaper=ctx.createWaveShaper(),gain=ctx.createGain(),panner=ctx.createPanner(),lfo=ctx.createOscillator(),lfoGain=ctx.createGain(),profile=SOUND_PROFILES[family],variation=(hash(candidate.id)%1000)/1000;
    source.buffer=buffer;source.loop=true;source.playbackRate.value=profile.rate[0]+(profile.rate[1]-profile.rate[0])*variation;
    filter.type=profile.retro.filter;filter.frequency.value=profile.retro.frequency;filter.Q.value=profile.retro.q;shaper.curve=retroCurve(profile.retro.bits,profile.retro.mix);shaper.oversample="none";
    lfo.type="sine";lfo.frequency.value=.055+variation*.12;lfoGain.gain.value=profile.retro.flutterCents;lfo.connect(lfoGain);lfoGain.connect(source.detune);
    gain.gain.value=0;panner.panningModel="HRTF";panner.distanceModel="inverse";panner.refDistance=2.5;panner.maxDistance=30;panner.rolloffFactor=.75;panner.coneInnerAngle=360;panner.coneOuterAngle=360;
    source.connect(filter);filter.connect(shaper);shaper.connect(gain);gain.connect(panner);panner.connect(master);lfo.start();source.start(0,variation*Math.max(.01,buffer.duration-.01));emitters.set(candidate.id,{source,filter,shaper,gain,panner,lfo,lfoGain,family,lastSeen:performance.now()});
  };
  const candidatesFor=(entities:AmbientEntity[],scene:PerceivedScene|null,pose:Pose,theme:ThemeId)=>{
    const byId=new Map(entities.map(entity=>[entity.id,entity])),out:Candidate[]=[];
    for(const object of scene?.objects??[]){const entity=byId.get(object.id);if(entity)out.push({id:entity.id,kind:entity.kind,position:[entity.x,entity.y],gainScale:1})}
    for(const spectacle of scene?.spectacles??[])if(spectacle.salience!=="ambient")out.push({id:spectacle.id,kind:spectacle.visualKind,position:spectacle.worldPosition,gainScale:spectacle.salience==="major"?1.15:.82});
    out.sort((a,b)=>Math.hypot(a.position[0]-pose.x,a.position[1]-pose.y)-Math.hypot(b.position[0]-pose.x,b.position[1]-pose.y));
    return[{id:`theme:${theme}`,kind:`theme:${theme}`,position:[pose.x+Math.cos(pose.angle)*2.4,pose.y+Math.sin(pose.angle)*2.4] as [number,number],gainScale:.62},...out.slice(0,MAX_EMITTERS-1)];
  };
  const playInteraction=(args:{kind:InteractionSoundKind;id:string;position:[number,number];pose:Pose;theme:ThemeId;progress?:number})=>{
    if(!context||!interactionBus||!unlocked||destroyed)return;const nowMs=performance.now(),cooldown=args.kind==="collision"?360:80,previous=lastInteractionAt.get(args.kind)??-Infinity;if(nowMs-previous<cooldown)return;lastInteractionAt.set(args.kind,nowMs);
    const ctx=context,pattern=RETRO_INTERACTION_PATTERNS[args.kind],progressPitch=args.kind==="wake"?2**((clamp(args.progress??.5,0,1)-.5)*8/12):1,pitch=(args.kind==="star_response"||args.kind==="star_collect"?1:THEME_PITCH[args.theme])*progressPitch,panner=ctx.createPanner(),dx=args.position[0]-args.pose.x,dy=args.position[1]-args.pose.y,distance=Math.hypot(dx,dy),relative=Math.atan2(dy,dx)-args.pose.angle;
    panner.panningModel="HRTF";panner.distanceModel="inverse";panner.refDistance=1.6;panner.maxDistance=24;panner.rolloffFactor=.85;panner.positionX.value=Math.sin(relative)*distance;panner.positionY.value=0;panner.positionZ.value=-Math.cos(relative)*distance;panner.connect(interactionBus);
    let remaining=pattern.notes.length;
    pattern.notes.forEach((note,index)=>{const oscillator=ctx.createOscillator(),gain=ctx.createGain(),start=ctx.currentTime+index*pattern.step,end=ctx.currentTime+pattern.length,frequency=note*pitch,variation=1+((hash(`${args.id}:${index}`)%9)-4)*.0025;
      oscillator.type=pattern.wave;oscillator.frequency.setValueAtTime(frequency*variation,start);if(args.kind==="collision")oscillator.frequency.exponentialRampToValueAtTime(Math.max(30,frequency*.52),end);else oscillator.frequency.exponentialRampToValueAtTime(frequency*variation*1.012,Math.min(end,start+.12));
      gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(pattern.volume,start+.008);gain.gain.setValueAtTime(pattern.volume,Math.max(start+.01,end-.045));gain.gain.exponentialRampToValueAtTime(.0001,end);
      oscillator.connect(gain);gain.connect(panner);interactionSources.add(oscillator);oscillator.onended=()=>{interactionSources.delete(oscillator);oscillator.disconnect();gain.disconnect();remaining--;if(remaining===0)panner.disconnect()};oscillator.start(start);oscillator.stop(end);
    });
  };
  const reset=()=>{for(const id of [...emitters.keys()])stopEmitter(id,.12);for(const source of interactionSources){try{source.stop()}catch(error){void error}}interactionSources.clear();lastInteractionAt.clear();pending.clear();activeTheme="neutral"};

  return{
    unlock(){if(destroyed)return;const ctx=ensureContext();unlocked=true;if(!paused)void ctx.resume()},
    pause(){paused=true;void context?.suspend()},
    resume(){paused=false;if(unlocked)void context?.resume()},
    setMasterVolume(volume){masterVolume=clamp(volume,0,1);if(context&&master&&interactionBus){ramp(master.gain,AMBIENT_MASTER_GAIN*masterVolume,context,.08);ramp(interactionBus.gain,INTERACTION_MASTER_GAIN*masterVolume,context,.08)}},
    update({playing,speaking,pose,entities,scene,theme}){
      if(!context||!master||!interactionBus||!unlocked||paused)return;const now=performance.now(),ctx=context,targetMaster=playing?AMBIENT_MASTER_GAIN*masterVolume*(speaking?.28:1):0,targetInteraction=playing?INTERACTION_MASTER_GAIN*masterVolume*(speaking?.5:1):0;ramp(master.gain,targetMaster,ctx,playing?.7:.22);ramp(interactionBus.gain,targetInteraction,ctx,playing?.18:.12);
      if(!playing){for(const id of [...emitters.keys()])stopEmitter(id,.35);return}
      if(theme!==activeTheme){for(const id of emitters.keys())if(id.startsWith("theme:"))stopEmitter(id,1.4);activeTheme=theme}
      const candidates=candidatesFor(entities,scene,pose,theme),desired=new Set(candidates.map(item=>item.id));
      for(const candidate of candidates){const family=candidate.id.startsWith("theme:")?THEME_BED[theme]:soundFamilyFor(candidate.kind,theme),profile=SOUND_PROFILES[family];let emitter=emitters.get(candidate.id);if(emitter&&emitter.family!==family){stopEmitter(candidate.id);emitter=undefined}if(!emitter){void startEmitter(candidate,family);continue}
        emitter.lastSeen=now;const dx=candidate.position[0]-pose.x,dy=candidate.position[1]-pose.y,distance=Math.hypot(dx,dy),relative=Math.atan2(dy,dx)-pose.angle,x=Math.sin(relative)*distance,z=-Math.cos(relative)*distance;
        emitter.panner.positionX.value=x;emitter.panner.positionY.value=0;emitter.panner.positionZ.value=z;const nearRestraint=clamp(distance/1.25,.22,1),target=profile.gain*candidate.gainScale*nearRestraint;ramp(emitter.gain.gain,target,ctx,.35);
      }
      for(const[id,emitter]of emitters)if(!desired.has(id)&&now-emitter.lastSeen>240)stopEmitter(id);
    },
    playInteraction,
    reset,
    destroy(){destroyed=true;unlocked=false;paused=false;reset();const closing=context;context=null;master=null;interactionBus=null;limiter=null;void closing?.close()},
  };
}
