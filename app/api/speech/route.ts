import { isAriadneVocalDelivery, prepareVocalText, type AriadneVocalDelivery } from "../../ariadne-vocal-performance.ts";

const OPENROUTER_SPEECH_URL="https://openrouter.ai/api/v1/audio/speech";
export const ARIADNE_TTS_MODEL="fish-audio/s2.1-pro-free:free";
export const DEFAULT_ARIADNE_VOICE="933563129e564b19a115bedd57b7406a";
const MAX_REQUEST_BYTES=2048;
const MAX_TEXT_LENGTH=600;
const MAX_AUDIO_BYTES=8*1024*1024;

type SpeechRequest={sessionId:string;utteranceId:string;text:string;delivery:AriadneVocalDelivery};

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
  let response:Response;
  try{
    response=await fetch(OPENROUTER_SPEECH_URL,{
      method:"POST",
      headers:{
        authorization:`Bearer ${apiKey}`,
        "content-type":"application/json",
        "http-referer":process.env.APP_URL||"http://localhost:3001",
        "x-title":"Ariadne",
      },
      signal:AbortSignal.timeout(20_000),
      body:JSON.stringify({model:ARIADNE_TTS_MODEL,input:prepareAriadneSpeech(body.text,body.delivery),voice,response_format:"mp3"}),
    });
  }catch{
    return Response.json({error:"speech_provider_unavailable"},{status:502});
  }
  if(!response.ok)return Response.json({error:"speech_provider_unavailable"},{status:502});

  const audio=await response.arrayBuffer();
  if(audio.byteLength===0||audio.byteLength>MAX_AUDIO_BYTES)return Response.json({error:"invalid_speech_audio"},{status:502});
  const contentType=response.headers.get("content-type")?.split(";")[0]||"audio/mpeg";
  if(!contentType.startsWith("audio/"))return Response.json({error:"invalid_speech_audio"},{status:502});
  return new Response(audio,{status:200,headers:{"content-type":contentType,"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
}
