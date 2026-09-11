import assert from "node:assert/strict";
import test from "node:test";
import { ARIADNE_TTS_MODEL, ARIADNE_TTS_FALLBACK_MODEL, DEFAULT_ARIADNE_VOICE, POST as speechPOST, freeVoiceStatus, parseSpeechRequest, prepareAriadneSpeech, resetFreeVoiceTracking } from "../app/api/speech/route.ts";

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
      resetFreeVoiceTracking();
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



test("after the free voice fails, the paid voice speaks for a cooldown, and the free one is probed again when it ends",async()=>{
  const originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY,originalCooldown=process.env.ARIADNE_TTS_FREE_COOLDOWN_MS,originalTimeout=process.env.ARIADNE_TTS_FREE_TIMEOUT_MS;
  process.env.OPENROUTER_API_KEY="test-key";process.env.ARIADNE_TTS_FREE_COOLDOWN_MS="60";process.env.ARIADNE_TTS_FREE_TIMEOUT_MS="40";
  const audio=()=>new Response(new Uint8Array([73,68,51,3]),{headers:{"content-type":"audio/mpeg"}});
  const ask=()=>speechPOST(new Request("http://localhost/api/speech",{method:"POST",body:JSON.stringify({sessionId:"test",utteranceId:`line-${Math.random().toString(36).slice(2)}`,text:"Come closer, MT.",delivery:"quiet_companionship"})}));
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  try{
    resetFreeVoiceTracking();
    let calls=[];
    // The free voice is slow: its audio does not arrive within the bound. The paid voice answers, and the free one is set aside.
    // The mock honours the request's signal, as fetch does: the free voice's answer comes after the bound, so the bound aborts it.
    globalThis.fetch=(_url,options)=>{const body=JSON.parse(options.body);calls.push(body.model);if(body.model!==ARIADNE_TTS_MODEL)return Promise.resolve(audio());return new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(audio()),120);options.signal?.addEventListener("abort",()=>{clearTimeout(timer);reject(options.signal.reason??new DOMException("timed out","TimeoutError"))},{once:true})})};
    assert.equal((await ask()).status,200);
    assert.deepEqual(calls,[ARIADNE_TTS_MODEL,ARIADNE_TTS_FALLBACK_MODEL]);
    assert.equal(freeVoiceStatus().available,false);assert.equal(freeVoiceStatus().lastFailure,"timeout");assert.equal(freeVoiceStatus().failures,1);
    // The next lines go straight to the paid voice: no wait on the free one.
    calls=[];
    assert.equal((await ask()).status,200);
    assert.deepEqual(calls,[ARIADNE_TTS_FALLBACK_MODEL],"the free voice is not tried while it is set aside");
    // When the cooldown ends, the free voice is probed again; if it answers in time, it is back.
    await wait(80);
    assert.equal(freeVoiceStatus().available,true);
    calls=[];
    globalThis.fetch=async(_url,options)=>{calls.push(JSON.parse(options.body).model);return audio()};
    assert.equal((await ask()).status,200);
    assert.deepEqual(calls,[ARIADNE_TTS_MODEL],"the free voice answered in time and speaks again");
    assert.equal(freeVoiceStatus().failures,0);
    // A refusal sets it aside too, and repeated failures lengthen the cooldown.
    globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body.model);return body.model===ARIADNE_TTS_MODEL?new Response("busy",{status:429}):audio()};
    calls=[];assert.equal((await ask()).status,200);assert.deepEqual(calls,[ARIADNE_TTS_MODEL,ARIADNE_TTS_FALLBACK_MODEL]);
    const first=freeVoiceStatus().downForMs;
    await wait(80);
    calls=[];assert.equal((await ask()).status,200);assert.deepEqual(calls,[ARIADNE_TTS_MODEL,ARIADNE_TTS_FALLBACK_MODEL],"probed again after the cooldown, refused again");
    assert.ok(freeVoiceStatus().downForMs>first,"the second failure doubles the cooldown");
    assert.equal(freeVoiceStatus().failures,2);
  }finally{
    resetFreeVoiceTracking();
    globalThis.fetch=originalFetch;
    if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
    if(originalCooldown===undefined)delete process.env.ARIADNE_TTS_FREE_COOLDOWN_MS;else process.env.ARIADNE_TTS_FREE_COOLDOWN_MS=originalCooldown;
    if(originalTimeout===undefined)delete process.env.ARIADNE_TTS_FREE_TIMEOUT_MS;else process.env.ARIADNE_TTS_FREE_TIMEOUT_MS=originalTimeout;
  }
});
