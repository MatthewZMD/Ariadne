import assert from "node:assert/strict";
import test from "node:test";
import { ARIADNE_TTS_MODEL, ARIADNE_TTS_FALLBACK_MODEL, DEFAULT_ARIADNE_VOICE, POST as speechPOST, parseSpeechRequest, prepareAriadneSpeech } from "../app/api/speech/route.ts";

test("speech requests accept only bounded session-owned Ariadne utterances",()=>{
  assert.deepEqual(parseSpeechRequest({sessionId:"run-1",utteranceId:"line:1",text:"  This way, MT.  ",delivery:"confident_invitation"}),{sessionId:"run-1",utteranceId:"line:1",text:"This way, MT.",delivery:"confident_invitation"});
  assert.equal(parseSpeechRequest({sessionId:"run-1",utteranceId:"line:1",text:"This way.",delivery:"invented"}),null);
  assert.equal(parseSpeechRequest({sessionId:"run 1",utteranceId:"line:1",text:"This way."}),null);
  assert.equal(parseSpeechRequest({sessionId:"run-1",utteranceId:"line:1",text:"x".repeat(601)}),null);
});

test("speech pronunciation spells MT phonetically without altering ordinary words",()=>{
  assert.equal(prepareAriadneSpeech("This way, MT. I trust MT's instinct.","confident_invitation"),"[excited, eager and playfully confident, smiling audibly, with lively pitch changes and a quick delighted lift as you invite someone along] This way, Em Tee. I trust Em Tee's instinct.");
  assert.equal(prepareAriadneSpeech("MT and MT-like labels, not EMPTY.","quiet_companionship"),"[lively, attentive and warmly curious, an audible smile and small sparks of excitement while sharing a private observation] Em Tee and Em Tee-like labels, not EMPTY.");
});

test("speech reads bullet lists as ordinal transitions while preserving the displayed text",()=>{
  const text="Here is why, MT:\n• The shell woke.\n• The star is still dark.\n• I believe we can try again.\n• Stay with me.";
  const speech=prepareAriadneSpeech(text);
  assert.ok(speech.endsWith("Here is why, Em Tee:\nFirst, The shell woke.\nSecond, The star is still dark.\nThird, I believe we can try again.\nFourth, Stay with me."));
  assert.ok(text.includes("\n• The shell woke."));
  assert.ok(prepareAriadneSpeech("  - One.\n\n\t* Two.\n+ Three.").endsWith("First, One.\n\nSecond, Two.\nThird, Three."));
  assert.ok(prepareAriadneSpeech("• Again.").endsWith("First, Again."),"numbering restarts for each utterance");
  assert.ok(prepareAriadneSpeech("MT-like hope • still here.\n-3 stars?\n*quietly*").endsWith("Em Tee-like hope • still here.\n-3 stars?\n*quietly*"),"ordinary punctuation is not a list marker");
});

test("speech endpoint uses the fixed Fish Audio model and returns raw audio",async()=>{
  const originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY,originalVoice=process.env.OPENROUTER_TTS_VOICE,calls=[];
  process.env.OPENROUTER_API_KEY="test-key";delete process.env.OPENROUTER_TTS_VOICE;
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return new Response(new Uint8Array([73,68,51,3]),{status:200,headers:{"content-type":"audio/mpeg"}})};
  try{
    const response=await speechPOST(new Request("http://localhost/api/speech",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:"run-1",utteranceId:"line:1",text:"Come with me, MT.",delivery:"confident_invitation"})}));
    assert.equal(response.status,200);assert.equal(response.headers.get("content-type"),"audio/mpeg");assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[73,68,51,3]);
    assert.equal(calls[0].url,"https://openrouter.ai/api/v1/audio/speech");
    const providerBody=JSON.parse(String(calls[0].options.body));
    assert.deepEqual(providerBody,{model:ARIADNE_TTS_MODEL,input:"[excited, eager and playfully confident, smiling audibly, with lively pitch changes and a quick delighted lift as you invite someone along] Come with me, Em Tee.",voice:DEFAULT_ARIADNE_VOICE,response_format:"mp3"});
    assert.equal(providerBody.sessionId,undefined);assert.equal(providerBody.utteranceId,undefined);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
    if(originalVoice===undefined)delete process.env.OPENROUTER_TTS_VOICE;else process.env.OPENROUTER_TTS_VOICE=originalVoice;
  }
});

test("speech rate limits use one same-voice fallback without retrying authorization failures",async()=>{
  const originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY="test-key";
  try{
    for(const status of [429,503,401]){
      const calls=[];
      globalThis.fetch=async(_url,options)=>{calls.push(JSON.parse(options.body));return calls.length===1?new Response("unavailable",{status}):new Response(new Uint8Array([73,68,51,3]),{headers:{"content-type":"audio/mpeg"}})};
      const result=await speechPOST(new Request("http://localhost/api/speech",{method:"POST",body:JSON.stringify({sessionId:"test",utteranceId:"line",text:"Come closer, MT.",delivery:"quiet_companionship"})}));
      assert.equal(result.status,status===401?502:200);
      assert.equal(calls.length,status===401?1:2);
      assert.equal(calls[0].model,ARIADNE_TTS_MODEL);
      if(calls[1])assert.deepEqual(calls[1],{...calls[0],model:ARIADNE_TTS_FALLBACK_MODEL});
    }
  }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey}
});


