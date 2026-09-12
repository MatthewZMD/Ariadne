import assert from "node:assert/strict";
import test from "node:test";
import { CALL_PULSE_EVENTS, createFieldAudio, cueForOccasion, deliveryFor, elementIndexOf, nextVariant, pulseEnvelope, upcomingPulses, voiceNormalizationGain } from "../app/field/audio.ts";
import { ARIADNE_VOCAL_DELIVERIES } from "../app/ariadne-vocal-performance.ts";
import { readFile } from "node:fs/promises";

test("the visible pulse follows the manifest's events on the loop clock", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/fog/audio.json", import.meta.url), "utf8"));
  const call = manifest.assets.find(asset => asset.id === "chimes-call");
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
  assert.equal(cueForOccasion("structure_found", { teaching: true, gesture: "listen" }), "bell-arch-listen");
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

test("quiet voice reaches the target loudness within the fourfold gain limit", () => {
  const quiet = Float32Array.from([.035, -.035]);
  const gain = voiceNormalizationGain([quiet]);
  assert.ok(Math.abs(gain * quiet[0] - .07) < .000001);
  assert.ok(Math.abs(gain - 2) < .000001);
  assert.equal(voiceNormalizationGain([Float32Array.from([.001, -.001])]), 4);
});

test("voice normalization caps the loudest peak across every channel", () => {
  const quiet = new Float32Array(1000).fill(.01), transient = new Float32Array(1000);
  transient[0] = -1;
  const gain = voiceNormalizationGain([quiet, transient]);
  assert.equal(gain, .85, "a quiet recording with a high peak is peak-limited");
  assert.ok(Math.abs(transient[0] * gain) <= .85);
});

test("voice normalization leaves empty, silent, and near-silent buffers unchanged", () => {
  for (const channels of [[], [new Float32Array(10)], [Float32Array.from([.000001, -.000001])]]) assert.equal(voiceNormalizationGain(channels), 1);
});

/** Only the voice graph is needed: buffer sources start and finish under the test's control. */
async function voiceHarness(t, speechResponse = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }), options = {}) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "AudioContext"), sources = [], gains = [];
  const parameter = () => ({ value: 0, setTargetAtTime() {} });
  const node = () => ({ disconnected: false, connections: [], connect(destination) { this.connections.push(destination); }, disconnect() { this.disconnected = true; this.connections = []; } });
  class AudioContext {
    currentTime = 0;
    state = "running";
    destination = node();
    createGain() { const gain = { ...node(), gain: parameter() }; gains.push(gain); return gain; }
    createDynamicsCompressor() { return { ...node(), ...Object.fromEntries(["threshold", "knee", "ratio", "attack", "release"].map(key => [key, parameter()])) }; }
    createStereoPanner() { return { ...node(), pan: parameter() }; }
    createAnalyser() { return { ...node(), getByteTimeDomainData(data) { data.fill(160); } }; }
    createBufferSource() {
      const source = { ...node(), playbackRate: parameter(), onended: null, started: false, stopped: false, start() { this.started = true; }, stop() { this.stopped = true; } };
      sources.push(source);
      return source;
    }
    async decodeAudioData() { return { duration: 2, numberOfChannels: 1, getChannelData: () => Float32Array.from([.035, -.035]) }; }
    async resume() {}
    async close() {}
  }
  globalThis.AudioContext = AudioContext;
  const audio = createFieldAudio({ sessionId: "voice-test", debug: options.debug, fetchImpl: async (url, init) => {
    if (url === "/fog/audio.json") return { ok: true, json: async () => ({ assets: [] }) };
    if (url === "/api/speech") return speechResponse(JSON.parse(init.body));
    if (url.startsWith("/fog/cues/")) return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
    return { ok: false };
  } });
  t.after(() => { audio.destroy(); if (original) Object.defineProperty(globalThis, "AudioContext", original); else delete globalThis.AudioContext; });
  await audio.unlock();
  return { audio, sources, gains };
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

test("pending synthesis does not inherit the previous sentence's playback progress", async t => {
  const waiting = deferred();
  const { audio, sources } = await voiceHarness(t, request => request.utteranceId === "pending" ? waiting.promise : { ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  const started = deferred();
  const first = audio.voice.speak("First sentence.", "first", "confident_invitation", { onStart: started.resolve });
  await started.promise;
  assert.notEqual(audio.voice.progress(), null);
  sources[0].onended(); await first;
  const pending = audio.voice.speak("Next sentence.", "pending", "confident_invitation");
  assert.equal(audio.voice.progress(), null, "synthesis has not become audible yet");
  audio.voice.interrupt();
  waiting.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  assert.equal(await pending, "interrupted");
});

test("stopping a voice settles its promise so the speech queue cannot remain waiting", async t => {
  const { audio } = await voiceHarness(t);
  const started = deferred();
  const spoken = audio.voice.speak("A sentence.", "stop-check", "quiet_companionship", { onStart: started.resolve });
  await started.promise;
  audio.voice.interrupt();
  assert.equal(await spoken, "interrupted");
  assert.equal(audio.voice.isBusy(), false);
});

for (const kind of ["cue", "speech"]) test(`a throwing ${kind} source releases playback without announcing a start`, async t => {
  const { audio, sources, gains } = await voiceHarness(t);
  const createSource = audio.context.createBufferSource.bind(audio.context);
  let failStart = true, starts = 0;
  audio.context.createBufferSource = () => {
    const source = createSource();
    source.start = () => { if (failStart) throw new Error("source start failed"); source.started = true; };
    return source;
  };
  const play = () => kind === "cue"
    ? audio.voice.playCue("opening-premise", { onStart: () => starts++ })
    : audio.voice.speak("A sentence.", "start-check", "quiet_companionship", { onStart: () => starts++ });
  const warnings = t.mock.method(console, "warn", () => {});
  assert.equal(await play(), "failed");
  assert.equal(starts, 0, "a rejected audio start never signals audible playback");
  assert.equal(audio.voice.isBusy(), false);
  assert.equal(audio.voice.progress(), null);
  assert.equal(audio.voice.currentText(), null);
  assert.equal(sources[0].onended, null);
  assert.equal(sources[0].stopped, true);
  assert.equal(gains.at(-1).disconnected, true, "a failed start releases its normalization node");
  assert.equal(warnings.mock.calls.length, 1);

  failStart = false;
  const recovered = play();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 1);
  assert.equal(sources[1].started, true);
  sources[1].onended();
  assert.equal(await recovered, "spoken", "the next line plays and settles normally");
  assert.equal(audio.voice.isBusy(), false);
});

test("both cue and speech normalize before panning and release their gain node", async t => {
  const { audio, sources } = await voiceHarness(t);
  for (const kind of ["cue", "speech"]) {
    const started = deferred();
    const spoken = kind === "cue"
      ? audio.voice.playCue("opening-premise", { onStart: started.resolve })
      : audio.voice.speak("A sentence.", "gain-check", "quiet_companionship", { onStart: started.resolve });
    await started.promise;
    const source = sources.at(-1), gain = source.connections[0];
    assert.ok(Math.abs(gain.gain.value - 2) < .000001);
    assert.ok(gain.connections[0].pan, "normalization feeds the panner");
    if (kind === "cue") source.onended(); else audio.voice.interrupt();
    assert.equal(await spoken, kind === "cue" ? "spoken" : "interrupted");
    assert.equal(gain.disconnected, true);
  }
});

test("voice diagnostics are opt-in, bounded to start/end, and contain no utterance content", async t => {
  const info = t.mock.method(console, "info", () => {});
  const { audio, sources } = await voiceHarness(t, undefined, { debug: true });
  const started = deferred();
  const spoken = audio.voice.speak("Private participant reply.", "private-id", "quiet_companionship", { onStart: started.resolve });
  await started.promise;
  for (let frame = 0; frame < 3; frame++) audio.voice.level();
  assert.equal(info.mock.calls.length, 1, "sampling every frame does not write per-frame logs");
  audio.context.currentTime = 2;
  sources[0].onended();
  await spoken;
  const entries = info.mock.calls.map(call => { assert.equal(call.arguments.length, 1); const entry = call.arguments[0]; return JSON.parse(entry.slice(entry.indexOf("{"))); });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].state, "running");
  assert.equal(entries[0].kind, "speech");
  assert.equal(entries[0].contextTimeSeconds, 0);
  assert.ok(entries[0].durationSeconds > 0);
  assert.ok(Math.abs(entries[0].normalizationGain - 2) < .000001);
  assert.equal(entries[1].contextTimeSeconds, 2);
  assert.equal(entries[1].result, "spoken");
  assert.equal(entries[1].peakRms, .25);
  assert.equal(entries[1].measurements, 3);
  assert.doesNotMatch(JSON.stringify(entries), /Private participant|private-id|voice-test/);
});

test("normal voice playback emits no diagnostic logs", async t => {
  const info = t.mock.method(console, "info", () => {});
  const { audio, sources } = await voiceHarness(t);
  const started = deferred();
  const spoken = audio.voice.playCue("opening-premise", { onStart: started.resolve });
  await started.promise;
  audio.voice.level();
  sources[0].onended();
  await spoken;
  assert.equal(info.mock.calls.length, 0);
});

test("structure samples and runtime pitches use the same varied score", async () => {
  const score = JSON.parse(await readFile(new URL("../public/fog/score.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../public/fog/audio.json", import.meta.url), "utf8"));
  const signatures = new Set();
  for (const [family, music] of Object.entries(score)) {
    signatures.add(music.notesHz.map(hz => Math.round(12 * Math.log2(hz / music.notesHz[0]))).join(","));
    for (const [index, hz] of music.notesHz.entries()) {
      assert.equal(manifest.assets.find(asset => asset.id === `${family}-element-0${index + 1}`).noteHz, hz);
    }
    const completion = manifest.assets.find(asset => asset.id === `${family}-completion`);
    assert.ok(completion.duration >= Math.max(...music.completionTimes) + 5.5, `${family} phrase has an uncut decay`);
  }
  assert.equal(signatures.size, Object.keys(score).length, "families differ in intervals, not only transposition");
});
