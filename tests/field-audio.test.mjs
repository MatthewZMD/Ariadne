import assert from "node:assert/strict";
import test from "node:test";
import { CALL_PULSE_EVENTS, createFieldAudio, cueForOccasion, deliveryFor, elementIndexOf, nextVariant, pulseEnvelope, upcomingPulses } from "../app/field/audio.ts";
import { ARIADNE_VOCAL_DELIVERIES } from "../app/ariadne-vocal-performance.ts";
import { readFile } from "node:fs/promises";

test("the visible pulse follows the manifest's events on the loop clock", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/fog/audio.json", import.meta.url), "utf8"));
  const call = manifest.assets.find(asset => asset.id === "bells-call");
  assert.deepEqual(call.events.map(event => event.time), CALL_PULSE_EVENTS.map(event => event.time), "the built-in schedule matches the delivered loops");
  assert.equal(call.duration, 16);
  const start = 100;
  assert.equal(pulseEnvelope(start, start + .4), 0, "silent before the first event");
  assert.ok(pulseEnvelope(start, start + .62) > .8, "bright just after the first event");
  assert.ok(pulseEnvelope(start, start + 1.7) < .05, "gone by the end of the event");
  assert.ok(pulseEnvelope(start, start + 4.62) < .6 && pulseEnvelope(start, start + 4.62) > .45, "the second event is the softer one");
  assert.ok(pulseEnvelope(start, start + 16.62) > .8, "the schedule wraps with the loop");
  assert.equal(pulseEnvelope(start, start - 1), 0);
  const upcoming = upcomingPulses(start, start + 15, 4);
  assert.deepEqual(upcoming.map(pulse => +(pulse.at - start).toFixed(1)), [16.5], "the next pulse after 15 s is the first event of the next loop");
  assert.deepEqual(upcomingPulses(start, start, 9).map(pulse => +(pulse.at - start).toFixed(1)), [.5, 4.5, 8.5]);
});

test("every occasion maps to a delivery the speech route accepts, and cues exist for what they name", async () => {
  const cues = JSON.parse(await readFile(new URL("../public/fog/cues.json", import.meta.url), "utf8"));
  const ids = new Set(cues.assets.map(asset => asset.id));
  const occasions = ["opening", "commitment", "taken_up", "declined", "outcome_confirmed", "outcome_failed", "terminus", "structure_found", "structure_attending", "awakening_relevant", "awakening_proxy", "recognized_return", "off_way", "reply", "resume"];
  for (const occasion of occasions) {
    for (const phase of ["charming", "attached", "overbearing"]) assert.ok(ARIADNE_VOCAL_DELIVERIES.includes(deliveryFor(occasion, phase)), `${occasion}/${phase} delivery`);
    const cue = cueForOccasion(occasion);
    if (cue) assert.ok(ids.has(cue), `${occasion} cue ${cue} is a recorded cue`);
  }
  assert.equal(cueForOccasion("structure_found", { teaching: true, gesture: "listen" }), "teaching-listen");
  assert.equal(cueForOccasion("structure_found", { teaching: false, gesture: "listen" }), "found-one");
  assert.equal(cueForOccasion("taken_up"), null, "take-up has no canned line; it is generated or silent");
  assert.equal(cueForOccasion("reply"), null);
});

test("footstep variants never repeat back to back and element ids resolve to sample numbers", () => {
  for (let i = 0; i < 20; i++) assert.notEqual(nextVariant(3, 6, i / 20), 3);
  assert.equal(nextVariant(0, 6, 0), 1);
  assert.equal(nextVariant(1, 1), 1);
  assert.equal(elementIndexOf("4,2:element_03"), 3);
  assert.equal(elementIndexOf("nonsense"), 1);
});

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

/** Only the voice graph is needed: buffer sources start and finish under the test's control. */
async function voiceHarness(t, speechResponse = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "AudioContext"), sources = [];
  const parameter = () => ({ value: 0, setTargetAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  class AudioContext {
    currentTime = 0;
    destination = node();
    createGain() { return { ...node(), gain: parameter() }; }
    createDynamicsCompressor() { return { ...node(), ...Object.fromEntries(["threshold", "knee", "ratio", "attack", "release"].map(key => [key, parameter()])) }; }
    createStereoPanner() { return { ...node(), pan: parameter() }; }
    createAnalyser() { return node(); }
    createBufferSource() {
      const source = { ...node(), playbackRate: parameter(), onended: null, started: false, stopped: false, start() { this.started = true; }, stop() { this.stopped = true; } };
      sources.push(source);
      return source;
    }
    async decodeAudioData() { return { duration: 2 }; }
    async resume() {}
    async close() {}
  }
  globalThis.AudioContext = AudioContext;
  const audio = createFieldAudio({ sessionId: "voice-test", fetchImpl: async (url, init) => {
    if (url === "/fog/audio.json") return { ok: true, json: async () => ({ assets: [] }) };
    if (url === "/api/speech") return speechResponse(JSON.parse(init.body));
    return { ok: false };
  } });
  t.after(() => { audio.destroy(); if (original) Object.defineProperty(globalThis, "AudioContext", original); else delete globalThis.AudioContext; });
  await audio.unlock();
  return { audio, sources };
}

test("a refused playback start releases the voice for the next utterance", async t => {
  const { audio, sources } = await voiceHarness(t);
  const refused = await audio.voice.speak("The obsolete direction.", "old", "confident_invitation", { shouldStart: () => false });
  assert.equal(refused, "interrupted");
  assert.equal(sources.length, 0, "obsolete speech never starts an audio source");
  assert.equal(audio.voice.isBusy(), false, "refusal must not leave synthesis marked busy");
  const started = deferred();
  const next = audio.voice.speak("The current direction.", "current", "confident_invitation", { onStart: started.resolve });
  await started.promise;
  assert.equal(audio.voice.currentText(), "The current direction.");
  assert.equal(audio.voice.isBusy(), true);
  assert.equal(sources[0].started, true);
  sources[0].onended();
  assert.equal(await next, "spoken");
  assert.equal(audio.voice.isBusy(), false);
});

test("an interrupted synthesis response cannot clear the newer voice already playing", async t => {
  const oldResponse = deferred();
  const { audio, sources } = await voiceHarness(t, request => request.utteranceId === "old" ? oldResponse.promise : { ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  const old = audio.voice.speak("The old direction.", "old", "confident_invitation", { shouldStart: () => false });
  const started = deferred();
  const current = audio.voice.speak("The new direction.", "new", "confident_invitation", { onStart: started.resolve });
  await started.promise;
  oldResponse.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  assert.equal(await old, "interrupted");
  assert.equal(sources.length, 1, "only the newer line obtained a playback source");
  assert.equal(sources[0].stopped, false, "the old response must not stop newer playback");
  assert.equal(audio.voice.currentText(), "The new direction.");
  assert.equal(audio.voice.isBusy(), true);
  sources[0].onended();
  assert.equal(await current, "spoken");
  assert.equal(audio.voice.isBusy(), false);
});
