import { ARIADNE_VOICE_CUES, type AriadneVocalDelivery, type AriadneVoiceCue } from "./ariadne-vocal-performance.ts";

type SpeechJob={text:string;sessionId:string;utteranceId:string;delivery:AriadneVocalDelivery};
type SpeechCallbacks={onStart?:(cueText?:string)=>void|boolean};
export type AriadneVoiceResult="spoken"|"failed"|"interrupted"|"busy";
export const ARIADNE_PLAYBACK_RATE=1.1;
/** Median measured mean level of the bundled reference cues. */
export const ARIADNE_REFERENCE_MEAN_DB=-22.9;
/** All other game audio is mixed relative to this voice-bus gain. */
export const ARIADNE_REFERENCE_GAIN=.9;

export type AriadneVoice={
  unlock:()=>void;
  pause:()=>void;
  resume:()=>void;
  speak:(job:SpeechJob,callbacks?:SpeechCallbacks)=>Promise<AriadneVoiceResult>;
  playCue:(cue:AriadneVoiceCue,callbacks?:SpeechCallbacks)=>Promise<AriadneVoiceResult>;
  interrupt:()=>void;
  isBusy:()=>boolean;
  setSpatial:(pan:number,distance:number)=>void;
  setMasterVolume:(volume:number)=>void;
  reset:()=>void;
  destroy:()=>void;
};

export function createAriadneVoice():AriadneVoice{
  let unlocked=false,destroyed=false,paused=false,busyKind:"cue"|"speech"|null=null,speechQueued=false,epoch=0,audioContext:AudioContext|null=null,currentSource:AudioBufferSourceNode|null=null,currentController:AbortController|null=null,currentPanner:StereoPannerNode|null=null,currentGain:GainNode|null=null,spatialPan=0,spatialDistance=1,masterVolume=1,activeCueDone:Promise<AriadneVoiceResult>|null=null;
  const cueBuffers=new Map<string,Promise<AudioBuffer|null>>(),lastCueVariant=new Map<AriadneVoiceCue,number>();
  const resumeWaiters=new Set<()=>void>();

  const applySpatial=()=>{
    if(currentPanner)currentPanner.pan.value=Math.max(-1,Math.min(1,spatialPan));
    if(currentGain)currentGain.gain.value=ARIADNE_REFERENCE_GAIN*masterVolume*Math.max(.5,Math.min(1,1-Math.max(0,spatialDistance-.65)*.11));
  };
  const clearCurrent=()=>{
    currentController?.abort();currentController=null;
    if(currentSource){try{currentSource.stop()}catch(error){void error}currentSource.disconnect();currentSource=null}
    currentPanner?.disconnect();currentPanner=null;currentGain?.disconnect();currentGain=null;
  };
  const releaseResumeWaiters=()=>{for(const resolve of resumeWaiters)resolve();resumeWaiters.clear()};
  const interrupt=()=>{epoch++;releaseResumeWaiters();clearCurrent();busyKind=null;speechQueued=false;activeCueDone=null};
  const loadCue=(path:string)=>{
    const existing=cueBuffers.get(path);if(existing)return existing;
    if(!audioContext)return Promise.resolve(null);
    const context=audioContext,promise=fetch(path).then(response=>{if(!response.ok)throw new Error("cue unavailable");return response.arrayBuffer()}).then(encoded=>context.decodeAudioData(encoded.slice(0))).catch(()=>null);
    cueBuffers.set(path,promise);return promise;
  };
  const playBuffer=async(buffer:AudioBuffer,kind:"cue"|"speech",callbacks:SpeechCallbacks,speechEpoch:number):Promise<AriadneVoiceResult>=>{
    if(!audioContext||destroyed||epoch!==speechEpoch)return"interrupted";
    if(paused)await new Promise<void>(resolve=>resumeWaiters.add(resolve));
    if(!audioContext||destroyed||epoch!==speechEpoch)return"interrupted";
    if(audioContext.state!=="running")await audioContext.resume();
    const source=audioContext.createBufferSource(),gain=audioContext.createGain(),panner=audioContext.createStereoPanner();source.buffer=buffer;source.playbackRate.value=ARIADNE_PLAYBACK_RATE;source.connect(gain);gain.connect(panner);panner.connect(audioContext.destination);currentSource=source;currentGain=gain;currentPanner=panner;busyKind=kind;applySpatial();
    if(callbacks.onStart?.()===false)return"interrupted";
    source.start();await new Promise<void>(resolve=>{source.onended=()=>resolve()});
    return epoch===speechEpoch?"spoken":"interrupted";
  };
  const playCue=(cue:AriadneVoiceCue,callbacks:SpeechCallbacks={}):Promise<AriadneVoiceResult>=>{
    if(destroyed||!unlocked||!audioContext)return Promise.resolve("failed");
    if(busyKind)return Promise.resolve("busy");
    const variants=ARIADNE_VOICE_CUES[cue],previous=lastCueVariant.get(cue),index=previous===undefined?Math.floor(Math.random()*variants.length):(previous+1+Math.floor(Math.random()*(variants.length-1)))%variants.length,variant=variants[index]!;lastCueVariant.set(cue,index);
    const cueEpoch=epoch;busyKind="cue";
    const done=loadCue(variant.path).then(buffer=>buffer?playBuffer(buffer,"cue",{onStart:()=>callbacks.onStart?.(variant.text)},cueEpoch):"failed").then(result=>{
      if(epoch===cueEpoch){clearCurrent();busyKind=null;activeCueDone=null}return result;
    });
    activeCueDone=done;return done;
  };
  const speak=async(job:SpeechJob,callbacks:SpeechCallbacks={}):Promise<AriadneVoiceResult>=>{
    if(destroyed||!unlocked||!audioContext||!job.text.trim())return"failed";
    if(busyKind==="speech"||speechQueued)return"busy";
    if(busyKind==="cue"&&activeCueDone){speechQueued=true;const cueEpoch=epoch;await activeCueDone;speechQueued=false;if(destroyed||epoch!==cueEpoch)return"interrupted"}
    busyKind="speech";const speechEpoch=++epoch,controller=new AbortController();currentController=controller;
    try{
      const response=await fetch("/api/speech",{method:"POST",headers:{"content-type":"application/json"},signal:controller.signal,body:JSON.stringify({...job,text:job.text.trim()})});
      if(!response.ok)throw new Error(`speech request failed: ${response.status}`);
      const encoded=await response.arrayBuffer();
      if(destroyed||epoch!==speechEpoch||controller.signal.aborted)return"interrupted";
      const buffer=await audioContext.decodeAudioData(encoded.slice(0));
      if(destroyed||epoch!==speechEpoch||controller.signal.aborted)return"interrupted";
      return await playBuffer(buffer,"speech",callbacks,speechEpoch);
    }catch(error){
      if(error instanceof DOMException&&error.name==="AbortError"||epoch!==speechEpoch)return"interrupted";
      console.warn("ARIADNE voice is temporarily unavailable");return"failed";
    }finally{
      if(epoch===speechEpoch){clearCurrent();busyKind=null;speechQueued=false}
    }
  };
  return{
    unlock(){if(!audioContext)audioContext=new AudioContext();unlocked=true;if(!paused)void audioContext.resume();for(const variants of Object.values(ARIADNE_VOICE_CUES))for(const variant of variants)void loadCue(variant.path)},
    pause(){paused=true;void audioContext?.suspend()},
    resume(){paused=false;releaseResumeWaiters();if(unlocked)void audioContext?.resume()},
    speak,playCue,interrupt,isBusy:()=>busyKind!==null||speechQueued,
    setSpatial(pan,distance){spatialPan=pan;spatialDistance=distance;applySpatial()},
    setMasterVolume(volume){masterVolume=Math.max(0,Math.min(1,volume));applySpatial()},
    reset:interrupt,
    destroy(){destroyed=true;unlocked=false;paused=false;interrupt();void audioContext?.close();audioContext=null},
  };
}
