import assert from "node:assert/strict";
import test from "node:test";
import { ARIADNE_PLAYBACK_RATE, createAriadneVoice } from "../app/ariadne-voice.ts";

const eventually=async(predicate,timeout=500)=>{
  const started=Date.now();
  while(!predicate()){if(Date.now()-started>timeout)throw new Error("condition not reached");await new Promise(resolve=>setTimeout(resolve,2))}
};

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
