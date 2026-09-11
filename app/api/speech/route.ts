import { isAriadneVocalDelivery, prepareVocalText, type AriadneVocalDelivery } from "../../ariadne-vocal-performance.ts";

const OPENROUTER_SPEECH_URL="https://openrouter.ai/api/v1/audio/speech";
export const ARIADNE_TTS_MODEL="fish-audio/s2.1-pro-free:free";
export const ARIADNE_TTS_FALLBACK_MODEL="fish-audio/s2.1-pro";
export const DEFAULT_ARIADNE_VOICE="933563129e564b19a115bedd57b7406a";
const MAX_REQUEST_BYTES=2048;
const MAX_TEXT_LENGTH=600;
const MAX_AUDIO_BYTES=8*1024*1024;

type SpeechRequest={sessionId:string;utteranceId:string;text:string;delivery:AriadneVocalDelivery};

/**
 * The free voice is tried first, but a free voice that has just timed out or refused is not tried again on every line: after a
 * failure the paid voice (the same model and voice, S2.1 Pro) speaks for a cooldown, and only then is the free one probed again,
 * switching back the moment it answers in time. The cooldown doubles on repeated failures, up to ten minutes. Kept per isolate;
 * a fresh isolate simply tries the free voice first again.
 */
const FREE_COOLDOWN_MAX_MS=10*60_000;
const freeVoice={downUntil:0,failures:0,lastFailure:null as null|"timeout"|"rejected"};
export function freeVoiceStatus(now=Date.now()){return{available:now>=freeVoice.downUntil,downForMs:Math.max(0,freeVoice.downUntil-now),failures:freeVoice.failures,lastFailure:freeVoice.lastFailure}}
export function resetFreeVoiceTracking(){freeVoice.downUntil=0;freeVoice.failures=0;freeVoice.lastFailure=null}
function markFreeVoiceDown(reason:"timeout"|"rejected",now=Date.now()){
  const base=Math.max(0,Number(process.env.ARIADNE_TTS_FREE_COOLDOWN_MS??"90000")||0);
  freeVoice.failures+=1;freeVoice.lastFailure=reason;
  freeVoice.downUntil=now+Math.min(FREE_COOLDOWN_MAX_MS,base*2**Math.min(6,freeVoice.failures-1));
  console.warn("ARIADNE speech free voice set aside; the paid voice speaks",{reason,failures:freeVoice.failures,forMs:freeVoice.downUntil-now});
}
function markFreeVoiceUp(){if(freeVoice.failures||freeVoice.downUntil){console.warn("ARIADNE speech free voice answering again");}freeVoice.downUntil=0;freeVoice.failures=0;freeVoice.lastFailure=null}

const validId=(value:unknown)=>typeof value==="string"&&value.length>=1&&value.length<=128&&/^[A-Za-z0-9:_-]+$/.test(value);

export function parseSpeechRequest(value:unknown):SpeechRequest|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const body=value as Record<string,unknown>;
  if(!validId(body.sessionId)||!validId(body.utteranceId)||typeof body.text!=="string"||!isAriadneVocalDelivery(body.delivery))return null;
  const text=body.text.trim();
  return text&&text.length<=MAX_TEXT_LENGTH?{sessionId:body.sessionId as string,utteranceId:body.utteranceId as string,text,delivery:body.delivery}:null;
}

export function prepareAriadneSpeech(text:string,delivery:AriadneVocalDelivery="quiet_companionship"){return prepareVocalText(text,delivery)}

async function readBoundedJson(request:Request){
  const declared=Number(request.headers.get("content-length")??0);
  if(Number.isFinite(declared)&&declared>MAX_REQUEST_BYTES)return{tooLarge:true,value:null};
  const text=await request.text();
  if(new TextEncoder().encode(text).byteLength>MAX_REQUEST_BYTES)return{tooLarge:true,value:null};
  try{return{tooLarge:false,value:JSON.parse(text) as unknown}}catch{return{tooLarge:false,value:null}}
}

export async function POST(request:Request){
  const parsed=await readBoundedJson(request);
  if(parsed.tooLarge)return Response.json({error:"request_too_large"},{status:413});
  const body=parseSpeechRequest(parsed.value);
  if(!body)return Response.json({error:"invalid_speech_request"},{status:400});

  const apiKey=process.env.OPENROUTER_API_KEY;
  if(!apiKey)return Response.json({error:"speech_unavailable"},{status:503});

  const voice=(process.env.OPENROUTER_TTS_VOICE||DEFAULT_ARIADNE_VOICE).trim()||DEFAULT_ARIADNE_VOICE;
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(20_000)]);
  // The free voice is tried first but not waited for indefinitely: past this many milliseconds the paid voice is tried, because a
  // line arriving eight seconds late is a line arriving after the moment. Tunable; 0 disables the bound.
  const freeTimeoutMs=Math.max(0,Number(process.env.ARIADNE_TTS_FREE_TIMEOUT_MS??"4500")||0);
  const input=prepareAriadneSpeech(body.text,body.delivery);
  let response:Response|null=null;
  let audio:ArrayBuffer|null=null;
  // Preserve the voice across a free-tier outage. Never retry authorization or
  // malformed-request errors, and never permit an unbounded paid retry loop.
  // While the free voice is set aside, the paid voice is used directly.
  const models=freeVoiceStatus().available?[ARIADNE_TTS_MODEL,ARIADNE_TTS_FALLBACK_MODEL]:[ARIADNE_TTS_FALLBACK_MODEL];
  for(const model of models){
    const bounded=model===ARIADNE_TTS_MODEL&&freeTimeoutMs>0;
    try{
      response=await fetch(OPENROUTER_SPEECH_URL,{
        method:"POST",
        headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json","http-referer":process.env.APP_URL||"http://localhost:3001","x-title":"Ariadne"},
        signal:bounded?AbortSignal.any([signal,AbortSignal.timeout(freeTimeoutMs)]):signal,
        body:JSON.stringify({model,input,voice,response_format:"mp3"}),
      });
    }catch(error){
      const timedOut=error instanceof Error&&error.name==="TimeoutError";
      if(bounded&&timedOut&&!signal.aborted){markFreeVoiceDown("timeout");response=null;continue;}
      console.warn("ARIADNE speech transport failed",{kind:error instanceof Error?error.name:"unknown"});
      return Response.json({error:"speech_provider_unavailable"},{status:502});
    }
    if(response.ok){
      // The slow part of the free voice is the audio itself, not the headers: the body read is bounded too, and a body that
      // has not arrived in time is abandoned for the paid voice.
      if(bounded){
        const started=Date.now();
        const body=await Promise.race([response.arrayBuffer().catch(()=>null),new Promise<null>(resolve=>setTimeout(()=>resolve(null),freeTimeoutMs))]);
        if(body===null){void started;markFreeVoiceDown("timeout");await response.body?.cancel().catch(()=>{});response=null;continue;}
        audio=body;
      }
      if(model===ARIADNE_TTS_MODEL)markFreeVoiceUp();
      break;
    }
    console.warn("ARIADNE speech provider rejected request",{model,status:response.status});
    const retryable=response.status===429||response.status>=500;
    await response.body?.cancel();
    if(model===ARIADNE_TTS_MODEL&&retryable)markFreeVoiceDown("rejected");
    if(!retryable)break;
  }
  if(!response?.ok)return Response.json({error:"speech_provider_unavailable"},{status:502});

  if(!audio)audio=await response.arrayBuffer();
  if(audio.byteLength===0||audio.byteLength>MAX_AUDIO_BYTES)return Response.json({error:"invalid_speech_audio"},{status:502});
  const contentType=response.headers.get("content-type")?.split(";")[0]||"audio/mpeg";
  if(!contentType.startsWith("audio/"))return Response.json({error:"invalid_speech_audio"},{status:502});
  return new Response(audio,{status:200,headers:{"content-type":contentType,"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
}
