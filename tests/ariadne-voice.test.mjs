import assert from "node:assert/strict";
import test from "node:test";
import { ARIADNE_PLAYBACK_RATE, createAriadneVoice } from "../app/ariadne-voice.ts";

const eventually=async(predicate,timeout=500)=>{
  const started=Date.now();
  while(!predicate()){if(Date.now()-started>timeout)throw new Error("condition not reached");await new Promise(resolve=>setTimeout(resolve,2))}
};

test("a generated caption stays hidden until prepared voice is ready to start",async()=>{
  const originalFetch=globalThis.fetch,OriginalAudioContext=globalThis.AudioContext,sequence=[];
  let releaseSpeech,source;
  class FakeAudioContext{
    state="running";destination={};
    async resume(){}async close(){}
    async decodeAudioData(){return{duration:2}}
    createGain(){return{gain:{value:1},connect(){},disconnect(){}}}
    createStereoPanner(){return{pan:{value:0},connect(){},disconnect(){}}}
    createBufferSource(){source={playbackRate:{value:1},connect(){},disconnect(){},start(){sequence.push("audio")},stop(){this.onended?.()}};return source}
  }
  globalThis.AudioContext=FakeAudioContext;
  globalThis.fetch=async(_url,options)=>options?.body?new Promise(resolve=>{releaseSpeech=()=>resolve(new Response(new Uint8Array([1])))}):new Response(new Uint8Array([1]));
  const voice=createAriadneVoice();
  try{
    voice.unlock();
    const result=voice.speak({sessionId:"s",utteranceId:"reply",text:"I remember what you asked.",delivery:"quiet_companionship"},{onStart:()=>{sequence.push("text");sequence.push("start")}});
    assert.deepEqual(sequence,[]);assert.ok(releaseSpeech);
    releaseSpeech();await eventually(()=>sequence.includes("audio"));
    assert.deepEqual(sequence,["text","start","audio"]);
    source.onended();assert.equal(await result,"spoken");
  }finally{voice.destroy();globalThis.fetch=originalFetch;if(OriginalAudioContext===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=OriginalAudioContext}
});

test("the final line is synthesized whole and cut on the audio clock",async()=>{
  const originalFetch=globalThis.fetch,OriginalAudioContext=globalThis.AudioContext,sources=[],requests=[];
  class FakeSource{
    onended=null;buffer=null;playbackRate={value:1};scheduledStop=null;
    connect(){}disconnect(){}start(){}
    stop(at){if(at===undefined)this.onended?.();else this.scheduledStop=at}
  }
  class FakeAudioContext{
    state="running";currentTime=100;destination={};
    async resume(){}async close(){}
    async decodeAudioData(){return{duration:10}}
    createBufferSource(){const source=new FakeSource();sources.push(source);return source}
    createGain(){return{gain:{value:1},connect(){},disconnect(){}}}
    createStereoPanner(){return{pan:{value:0},connect(){},disconnect(){}}}
  }
  globalThis.AudioContext=FakeAudioContext;
  globalThis.fetch=async(url,options)=>{if(options?.body)requests.push(JSON.parse(options.body));return new Response(new Uint8Array([1]))};
  const voice=createAriadneVoice();
  try{
    voice.unlock();
    const text="Come with me, I want to try this next passage together.";
    const result=voice.speak({sessionId:"s",utteranceId:"last",text,delivery:"final_hope"},{cutAtFraction:.68});
    await eventually(()=>typeof sources[0]?.scheduledStop==="number");
    assert.equal(requests[0].text,text);
    assert.equal(sources[0].scheduledStop,100+10*.68/ARIADNE_PLAYBACK_RATE);
    assert.ok(sources[0].scheduledStop<100+10/ARIADNE_PLAYBACK_RATE);
    sources[0].onended();assert.equal(await result,"spoken");assert.equal(voice.isBusy(),false);
  }finally{
    voice.destroy();globalThis.fetch=originalFetch;
    if(OriginalAudioContext===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=OriginalAudioContext;
  }
});

test("a prerecorded cue plays immediately and the synchronized generated line waits without overlap",async()=>{
  const originalFetch=globalThis.fetch,OriginalAudioContext=globalThis.AudioContext,requests=[],sequence=[],sources=[],panners=[],gains=[],contexts=[];
  class FakeSource{
    onended=null;buffer=null;playbackRate={value:1};
    connect(){}disconnect(){}stop(){this.onended?.()}
    start(){sequence.push("audio-start")}
  }
  class FakeAudioContext{
    state="suspended";destination={};
    constructor(){contexts.push(this)}
    async resume(){this.state="running"}
    async suspend(){this.state="suspended"}
    async close(){this.state="closed"}
    async decodeAudioData(data){return{byteLength:data.byteLength}}
    createBufferSource(){const source=new FakeSource();sources.push(source);return source}
    createGain(){const gain={gain:{value:1},connect(){},disconnect(){}};gains.push(gain);return gain}
    createStereoPanner(){const panner={pan:{value:0},connect(){},disconnect(){}};panners.push(panner);return panner}
  }
  globalThis.AudioContext=FakeAudioContext;
  globalThis.fetch=async(url,options)=>{if(!options?.body)return new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"audio/mpeg"}});requests.push({url,body:JSON.parse(options.body)});return new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"audio/mpeg"}})};
  const voice=createAriadneVoice();
  try{
    voice.unlock();
    voice.setSpatial(-.7,1.2);
    const cue=voice.playCue("this_way",{onStart:()=>sequence.push("cue")});
    const first=voice.speak({sessionId:"session-a",utteranceId:"line-1",text:"This way, MT.",delivery:"confident_invitation"},{onStart:()=>sequence.push("caption")});
    assert.equal(await voice.speak({sessionId:"session-a",utteranceId:"line-2",text:"You came with me.",delivery:"delighted_praise"}),"busy");
    await eventually(()=>sources.length===1);
    assert.deepEqual(sequence,["cue","audio-start"]);voice.pause();assert.equal(contexts[0].state,"suspended");assert.equal(voice.isBusy(),true);voice.resume();assert.equal(contexts[0].state,"running");sources[0].onended?.();assert.equal(await cue,"spoken");
    await eventually(()=>sources.length===2);
    assert.deepEqual(sequence,["cue","audio-start","caption","audio-start"]);assert.equal(sources[1].playbackRate.value,ARIADNE_PLAYBACK_RATE);assert.equal(panners[1].pan.value,-.7);assert.ok(gains[1].gain.value<.9);assert.equal(requests[0].body.delivery,"confident_invitation");assert.equal(voice.isBusy(),true);assert.equal(requests.length,1);
    voice.setMasterVolume(0);assert.equal(gains[1].gain.value,0);voice.setMasterVolume(1);assert.ok(gains[1].gain.value>0);
    voice.interrupt();assert.equal(await first,"interrupted");assert.equal(voice.isBusy(),false);
  }finally{
    voice.destroy();globalThis.fetch=originalFetch;
    if(OriginalAudioContext===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=OriginalAudioContext;
  }
});

test("generated speech does not play when its synchronized caption is rejected",async()=>{
  const originalFetch=globalThis.fetch,OriginalAudioContext=globalThis.AudioContext,starts=[];
  class FakeSource{
    onended=null;buffer=null;playbackRate={value:1};
    connect(){}disconnect(){}stop(){this.onended?.()}
    start(){starts.push("audio-start")}
  }
  class FakeAudioContext{
    state="suspended";destination={};
    async resume(){this.state="running"}
    async close(){this.state="closed"}
    async decodeAudioData(data){return{byteLength:data.byteLength}}
    createBufferSource(){return new FakeSource()}
    createGain(){return{gain:{value:1},connect(){},disconnect(){}}}
    createStereoPanner(){return{pan:{value:0},connect(){},disconnect(){}}}
  }
  globalThis.AudioContext=FakeAudioContext;
  globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"audio/mpeg"}});
  const voice=createAriadneVoice();
  try{
    voice.unlock();
    const result=await voice.speak({sessionId:"session-a",utteranceId:"stale-line",text:"An obsolete reply.",delivery:"quiet_companionship"},{onStart:()=>false});
    assert.equal(result,"interrupted");
    assert.deepEqual(starts,[]);
    assert.equal(voice.isBusy(),false);
  }finally{
    voice.destroy();globalThis.fetch=originalFetch;
    if(OriginalAudioContext===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=OriginalAudioContext;
  }
});


test("opening caption preparation does not wait for audio, and its preload precedes optional clips",async()=>{
  const originalFetch=globalThis.fetch,OriginalAudioContext=globalThis.AudioContext,requests=[],sequence=[];
  let releaseOpening,source;
  class FakeAudioContext{
    state="running";destination={};
    async resume(){}async close(){}async decodeAudioData(){return{duration:2}}
    createGain(){return{gain:{value:1},connect(){},disconnect(){}}}
    createStereoPanner(){return{pan:{value:0},connect(){},disconnect(){}}}
    createBufferSource(){source={playbackRate:{value:1},connect(){},disconnect(){},start(){sequence.push("audio")},stop(){this.onended?.()}};return source}
  }
  globalThis.AudioContext=FakeAudioContext;
  globalThis.fetch=url=>{requests.push(String(url));return new Promise(resolve=>{releaseOpening=()=>resolve(new Response(new Uint8Array([1])))})};
  const voice=createAriadneVoice();
  try{
    voice.unlock();voice.unlock();
    assert.equal(requests.length,1,"repeated unlocks must not flood the opening with optional downloads");
    const done=voice.playCue("opening_premise",{onPrepare:()=>sequence.push("caption"),onStart:()=>sequence.push("start")});
    assert.deepEqual(sequence,["caption"]);
    assert.equal(requests.length,1,"playback reuses the preloaded opening request");
    releaseOpening();await eventually(()=>sequence.includes("audio"));
    assert.deepEqual(sequence,["caption","start","audio"]);
    assert.ok(requests.length>1,"optional clips can preload once the opening is decoded");
    source.onended();assert.equal(await done,"spoken");
  }finally{voice.destroy();globalThis.fetch=originalFetch;if(OriginalAudioContext===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=OriginalAudioContext}
});


test("a rejected audio resume releases the cue queue and later speech",async()=>{
  const originalFetch=globalThis.fetch,OriginalAudioContext=globalThis.AudioContext;
  class SuspendedAudioContext{
    state="suspended";
    async resume(){throw new Error("audio unavailable")}
    async close(){}
    async decodeAudioData(){return{duration:1}}
  }
  globalThis.AudioContext=SuspendedAudioContext;
  globalThis.fetch=async()=>new Response(new Uint8Array([1]));
  const voice=createAriadneVoice();
  try{
    voice.unlock();
    assert.equal(await voice.playCue("apology"),"failed");
    assert.equal(voice.isBusy(),false);
    assert.equal(await voice.speak({text:"We can try again.",sessionId:"test",utteranceId:"reply",delivery:"intimate_reassurance"}),"failed");
    assert.equal(voice.isBusy(),false);
  }finally{
    voice.destroy();globalThis.fetch=originalFetch;
    if(OriginalAudioContext===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=OriginalAudioContext;
  }
});
