/**
 * The field's sound: the call, the structures, the fog, the walker's feet and
 * Ariadne's voice, on one AudioContext.
 *
 * The call is a mono loop placed in space with HRTF; its loudness is the
 * game's call gain, not the panner's distance model, so what the walker hears
 * matches what the stage card says is audible. The visible pulse is derived
 * from the loop's start time and the manifest's event schedule on the audio
 * clock, never from a separate timer. Everything loads lazily from
 * /fog/audio.json. Pure helpers are exported for tests; the rest needs a
 * browser.
 */
import type { FieldEvent } from "./game.ts";
import type { StructureFamily } from "./structures.ts";
import type { FieldOccasion, FieldPhase } from "../field-practice.ts";
import type { AriadneVocalDelivery } from "../ariadne-vocal-performance.ts";

export type AudioAsset = { id: string; url: string; category: string; family: string | null; duration: number; loop: boolean; events: Array<{ time: number; duration: number; strength: number }>; noteHz: number | null; recommendedGain: number };
type Manifest = { assets: AudioAsset[] };

export const CALL_LOOP_SECONDS = 16;
export const CALL_PULSE_EVENTS = [{ time: .5, duration: 1.3, strength: 1 }, { time: 4.5, duration: 1.3, strength: .65 }, { time: 8.5, duration: 1.3, strength: 1 }, { time: 12.5, duration: 1.3, strength: .65 }];
export const VOICE_PLAYBACK_RATE = 1.1;
export const VOICE_GAIN = .9;
export const DUCK_GAIN = .5;

/** Visible pulse intensity for a loop that started at `startedAt`, at `now` (same clock): a quick rise and a slower fall inside each event. */
export function pulseEnvelope(startedAt: number, now: number, events = CALL_PULSE_EVENTS, loopSeconds = CALL_LOOP_SECONDS) {
  if (now < startedAt) return 0;
  const phase = ((now - startedAt) % loopSeconds + loopSeconds) % loopSeconds;
  let best = 0;
  for (const event of events) {
    const t = phase - event.time;
    if (t < 0 || t > event.duration) continue;
    const attack = Math.min(1, t / .12), decay = 1 - t / event.duration;
    best = Math.max(best, event.strength * attack * decay * decay);
  }
  return best;
}

/** Upcoming pulse times (absolute, same clock) within the next `horizon` seconds. */
export function upcomingPulses(startedAt: number, now: number, horizon: number, events = CALL_PULSE_EVENTS, loopSeconds = CALL_LOOP_SECONDS) {
  const out: Array<{ at: number; strength: number }> = [];
  const loopIndex = Math.floor(Math.max(0, now - startedAt) / loopSeconds);
  for (let k = loopIndex; k <= loopIndex + Math.ceil(horizon / loopSeconds) + 1; k++) for (const event of events) { const at = startedAt + k * loopSeconds + event.time; if (at >= now && at <= now + horizon) out.push({ at, strength: event.strength }); }
  return out;
}

/** Which recorded cue, if any, stands in for an occasion when a generated line is not wanted or not available. */
export function cueForOccasion(occasion: FieldOccasion, detail: { gesture?: "approach" | "look" | "listen" | null; teaching?: boolean } = {}): string | null {
  switch (occasion) {
    case "opening": return "opening-premise";
    case "commitment": return "this-way";
    case "taken_up": return null;
    case "declined": return "come-with-you";
    case "outcome_confirmed": return "getting-louder";
    case "outcome_failed": return "fading";
    case "terminus": return "dead-end";
    case "structure_found": return detail.teaching ? (detail.gesture === "look" ? "teaching-look" : detail.gesture === "listen" ? "teaching-listen" : "teaching-approach") : "found-one";
    case "structure_attending": return null;
    case "awakening_relevant": return "clearing-promise";
    case "awakening_proxy": return "woke-the-room";
    case "recognized_return": return "been-here";
    case "off_way": return "come-with-you";
    case "resume": return "resume";
    case "reply": return null;
  }
}

/** Vocal delivery for a generated line, from the occasion and her warmth. */
export function deliveryFor(occasion: FieldOccasion, phase: FieldPhase): AriadneVocalDelivery {
  const late = phase === "overbearing";
  switch (occasion) {
    case "opening": return "opening_wonder";
    case "commitment": return late ? "intimate_reassurance" : "confident_invitation";
    case "taken_up": return late ? "intimate_reassurance" : "delighted_praise";
    case "declined": return "admiring_correction";
    case "outcome_confirmed": return "delighted_praise";
    case "outcome_failed": return "tender_apology";
    case "terminus": return "tender_apology";
    case "structure_found": return "curious_discovery";
    case "structure_attending": return late ? "intimate_reassurance" : "quiet_companionship";
    case "awakening_relevant": return late ? "intimate_reassurance" : "delighted_praise";
    case "awakening_proxy": return "delighted_praise";
    case "recognized_return": return late ? "intimate_reassurance" : "curious_discovery";
    case "off_way": return late ? "quiet_companionship" : "playful_pursuit";
    case "reply": return late ? "intimate_reassurance" : "quiet_companionship";
    case "resume": return "quiet_companionship";
  }
}

/** Pick a footstep variant that is not the previous one. */
export function nextVariant(previous: number, count: number, roll = Math.random()) {
  if (count <= 1) return 1;
  const candidates = Array.from({ length: count }, (_, i) => i + 1).filter(v => v !== previous);
  return candidates[Math.min(candidates.length - 1, Math.floor(roll * candidates.length))]!;
}

export const elementIndexOf = (elementId: string) => { const match = /element_(\d+)$/.exec(elementId); return match ? Number(match[1]) : 1; };

export type AudioFrame = {
  walker: { position: [number, number]; yaw: number };
  ariadne: { position: [number, number]; height: number } | null;
  call: { structureId: string | null; family: StructureFamily | null; position: [number, number, number] | null; gain: number };
  offWayFactor: number;
  waterDistance: number | null;
  clearings: Array<{ id: string; family: StructureFamily; x: number; z: number }>;
  /** A sleeping part the walker is attending to as it asks: its note swells with their attention, so the wait is heard as an answer. */
  attending?: { position: [number, number, number]; noteHz: number; attention: number } | null;
};

export type VoiceResult = "spoken" | "interrupted" | "failed";
export type SpeakOptions = { startAtFraction?: number; onStart?: () => void; onProgress?: (fraction: number) => void };

export type FieldAudio = ReturnType<typeof createFieldAudio>;

export function createFieldAudio(options: { sessionId: string; fetchImpl?: typeof fetch } ) {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let context: AudioContext | null = null;
  let master: GainNode | null = null, world: GainNode | null = null, environment: GainNode | null = null, voiceBus: GainNode | null = null, duck: GainNode | null = null;
  let manifest: Map<string, AudioAsset> | null = null;
  let manifestPromise: Promise<Map<string, AudioAsset>> | null = null;
  const buffers = new Map<string, Promise<AudioBuffer | null>>();
  let masterVolume = 1, paused = false, destroyed = false;

  type Loop = { source: AudioBufferSourceNode; gain: GainNode; panner: PannerNode | null; startedAt: number; id: string };
  let fogLoops: Loop[] = [];
  let hush: Loop | null = null, water: Loop | null = null;
  let call: Loop | null = null, callId: string | null = null, callPosition: [number, number, number] | null = null, callGain = 0;
  /** Visual pulse clock fallback when there is no audio yet. */
  let visualStart = performance.now() / 1000;
  const awakeLoops = new Map<string, Loop>();
  let footVariant = { ground: 0, stone: 0 };
  let pulseScheduledUntil = 0;

  const now = () => context?.currentTime ?? performance.now() / 1000;

  const loadManifest = () => {
    if (manifestPromise) return manifestPromise;
    manifestPromise = fetchImpl("/fog/audio.json", { signal: AbortSignal.timeout(10_000) }).then(response => response.json() as Promise<Manifest>).then(data => { manifest = new Map(data.assets.map(asset => [asset.id, asset])); return manifest; }).catch(() => { manifest = new Map(); return manifest; });
    return manifestPromise;
  };

  const load = (id: string): Promise<AudioBuffer | null> => {
    const existing = buffers.get(id); if (existing) return existing;
    const promise = (async () => {
      if (!context) return null;
      const assets = await loadManifest();
      const asset = assets.get(id); if (!asset) return null;
      try {
        const response = await fetchImpl(asset.url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) return null;
        const encoded = await response.arrayBuffer();
        return await context.decodeAudioData(encoded.slice(0));
      } catch { return null; }
    })();
    buffers.set(id, promise); return promise;
  };

  const gainOf = (id: string) => manifest?.get(id)?.recommendedGain ?? .3;

  const makePanner = () => {
    const panner = context!.createPanner();
    panner.panningModel = "HRTF"; panner.distanceModel = "linear"; panner.refDistance = 1; panner.maxDistance = 10_000; panner.rolloffFactor = 0;
    return panner;
  };
  const place = (panner: PannerNode, x: number, y: number, z: number) => {
    if ("positionX" in panner && panner.positionX) { panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z; }
    else panner.setPosition(x, y, z);
  };

  const startLoop = async (id: string, destination: AudioNode, gain: number, position: [number, number, number] | null, fadeIn = 1.5): Promise<Loop | null> => {
    const buffer = await load(id); if (!buffer || !context || destroyed) return null;
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = true; source.loopStart = 0; source.loopEnd = buffer.duration;
    const gainNode = context.createGain(); gainNode.gain.value = 0;
    let panner: PannerNode | null = null;
    if (position) { panner = makePanner(); place(panner, ...position); source.connect(gainNode); gainNode.connect(panner); panner.connect(destination); }
    else { source.connect(gainNode); gainNode.connect(destination); }
    const startedAt = context.currentTime + .02;
    source.start(startedAt);
    gainNode.gain.setValueAtTime(0, startedAt); gainNode.gain.linearRampToValueAtTime(gain, startedAt + fadeIn);
    return { source, gain: gainNode, panner, startedAt, id };
  };
  const stopLoop = (loop: Loop | null, fade = 1) => {
    if (!loop || !context) return;
    const t = context.currentTime;
    try { loop.gain.gain.cancelScheduledValues(t); loop.gain.gain.setValueAtTime(loop.gain.gain.value, t); loop.gain.gain.linearRampToValueAtTime(0, t + fade); loop.source.stop(t + fade + .05); } catch { /* already stopped */ }
    setTimeout(() => { try { loop.source.disconnect(); loop.gain.disconnect(); loop.panner?.disconnect(); } catch { /* gone */ } }, (fade + .2) * 1000);
  };
  const setLoopGain = (loop: Loop | null, gain: number, seconds = .25) => {
    if (!loop || !context) return;
    const t = context.currentTime;
    loop.gain.gain.cancelScheduledValues(t); loop.gain.gain.setTargetAtTime(Math.max(0, gain), t, seconds / 3);
  };

  /**
   * The answering tone: one sine an octave below the part's note, placed at the part, whose gain follows the walker's held
   * attention. It runs at silence between parts, so beginning to answer costs nothing but a gain ramp.
   */
  let answering: { oscillator: OscillatorNode; gain: GainNode; panner: PannerNode } | null = null;
  const answer = (attending: AudioFrame["attending"]) => {
    if (!context || !world) return;
    if (!answering) {
      const oscillator = context.createOscillator(); oscillator.type = "sine";
      const gain = context.createGain(); gain.gain.value = 0;
      const panner = makePanner();
      oscillator.connect(gain); gain.connect(panner); panner.connect(world); oscillator.start();
      answering = { oscillator, gain, panner };
    }
    const t = context.currentTime;
    if (attending) {
      answering.oscillator.frequency.setTargetAtTime(attending.noteHz / 2, t, .05);
      place(answering.panner, ...attending.position);
      answering.gain.gain.cancelScheduledValues(t); answering.gain.gain.setTargetAtTime(Math.min(1, attending.attention) ** 2 * .11, t, .08);
    } else { answering.gain.gain.cancelScheduledValues(t); answering.gain.gain.setTargetAtTime(0, t, .12); }
  };

  const playOneShot = async (id: string, destination: AudioNode, gain: number, position: [number, number, number] | null, at?: number) => {
    const buffer = await load(id); if (!buffer || !context || destroyed) return;
    const source = context.createBufferSource(); source.buffer = buffer;
    const gainNode = context.createGain(); gainNode.gain.value = gain;
    source.connect(gainNode);
    if (position) { const panner = makePanner(); place(panner, ...position); gainNode.connect(panner); panner.connect(destination); source.onended = () => { source.disconnect(); gainNode.disconnect(); panner.disconnect(); }; }
    else { gainNode.connect(destination); source.onended = () => { source.disconnect(); gainNode.disconnect(); }; }
    source.start(at !== undefined ? Math.max(context.currentTime, at) : undefined);
  };

  const applyMaster = () => { if (master && context) master.gain.setTargetAtTime(masterVolume, context.currentTime, .05); };

  /* --------------------------------------------------------------- voice */
  let voiceSource: AudioBufferSourceNode | null = null, voicePanner: StereoPannerNode | null = null, voiceAnalyser: AnalyserNode | null = null, voiceEpoch = 0, voiceBusy: "cue" | "speech" | null = null;
  let voiceStartedAt = 0, voiceDuration = 0, voiceOffset = 0, voiceText: string | null = null;
  const analyserData = new Uint8Array(256);
  const cueBuffers = new Map<string, Promise<AudioBuffer | null>>();
  const loadCue = (id: string) => {
    const existing = cueBuffers.get(id); if (existing) return existing;
    const promise = (async () => { if (!context) return null; try { const response = await fetchImpl(`/fog/cues/${id}.mp3`, { signal: AbortSignal.timeout(10_000) }); if (!response.ok) return null; return await context.decodeAudioData((await response.arrayBuffer()).slice(0)); } catch { return null; } })();
    cueBuffers.set(id, promise); return promise;
  };
  const clearVoice = () => {
    if (voiceSource) { try { voiceSource.onended = null; voiceSource.stop(); } catch { /* stopped */ } voiceSource.disconnect(); voiceSource = null; }
    voicePanner?.disconnect(); voicePanner = null; voiceAnalyser?.disconnect(); voiceAnalyser = null;
    voiceBusy = null; voiceText = null;
    if (duck && context) duck.gain.setTargetAtTime(1, context.currentTime, .3);
  };
  const playVoiceBuffer = (buffer: AudioBuffer, kind: "cue" | "speech", text: string, opts: SpeakOptions, epoch: number): Promise<VoiceResult> => new Promise(resolve => {
    if (!context || !voiceBus || !duck || destroyed || epoch !== voiceEpoch) { resolve("interrupted"); return; }
    const source = context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = VOICE_PLAYBACK_RATE;
    const panner = context.createStereoPanner(), analyser = context.createAnalyser(); analyser.fftSize = 256;
    source.connect(panner); panner.connect(analyser); analyser.connect(voiceBus);
    voiceSource = source; voicePanner = panner; voiceAnalyser = analyser; voiceBusy = kind; voiceText = text;
    const offset = Math.max(0, Math.min(buffer.duration - .2, buffer.duration * (opts.startAtFraction ?? 0)));
    voiceStartedAt = context.currentTime; voiceDuration = buffer.duration / VOICE_PLAYBACK_RATE; voiceOffset = offset / VOICE_PLAYBACK_RATE;
    duck.gain.setTargetAtTime(DUCK_GAIN, context.currentTime, .08);
    source.onended = () => { const finished = epoch === voiceEpoch; if (finished) clearVoice(); resolve(finished ? "spoken" : "interrupted"); };
    opts.onStart?.();
    source.start(0, offset);
  });

  const voice = {
    isBusy: () => voiceBusy !== null,
    /** Fraction of the current utterance already spoken, for resuming mid-sentence. */
    progress() { if (!context || !voiceBusy || voiceDuration <= 0) return null; return Math.max(0, Math.min(1, (voiceOffset + (context.currentTime - voiceStartedAt)) / voiceDuration)); },
    currentText: () => voiceText,
    /** 0..1 loudness of her voice right now, for the ribbon. */
    level() { if (!voiceAnalyser) return 0; voiceAnalyser.getByteTimeDomainData(analyserData); let sum = 0; for (let i = 0; i < analyserData.length; i++) { const v = (analyserData[i]! - 128) / 128; sum += v * v; } return Math.min(1, Math.sqrt(sum / analyserData.length) * 3.2); },
    interrupt() { voiceEpoch++; clearVoice(); },
    async playCue(id: string, opts: SpeakOptions = {}): Promise<VoiceResult> {
      if (!context || destroyed) return "failed";
      if (voiceBusy) return "interrupted";
      const epoch = ++voiceEpoch; voiceBusy = "cue";
      const buffer = await loadCue(id);
      if (!buffer) { if (epoch === voiceEpoch) voiceBusy = null; return "failed"; }
      if (epoch !== voiceEpoch) return "interrupted";
      return playVoiceBuffer(buffer, "cue", id, opts, epoch);
    },
    async speak(text: string, utteranceId: string, delivery: AriadneVocalDelivery, opts: SpeakOptions = {}): Promise<VoiceResult> {
      if (!context || destroyed || !text.trim()) return "failed";
      if (voiceBusy) voice.interrupt();
      const epoch = ++voiceEpoch; voiceBusy = "speech";
      try {
        const response = await fetchImpl("/api/speech", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25_000), body: JSON.stringify({ sessionId: options.sessionId, utteranceId, text: text.trim(), delivery }) });
        if (!response.ok) throw new Error(`speech ${response.status}`);
        const encoded = await response.arrayBuffer();
        if (epoch !== voiceEpoch || destroyed) return "interrupted";
        const buffer = await context.decodeAudioData(encoded.slice(0));
        if (epoch !== voiceEpoch || destroyed) return "interrupted";
        return await playVoiceBuffer(buffer, "speech", text, opts, epoch);
      } catch {
        if (epoch === voiceEpoch) voiceBusy = null;
        return epoch === voiceEpoch ? "failed" : "interrupted";
      }
    },
  };

  /* ---------------------------------------------------------------- api */
  const audio = {
    get unlocked() { return context !== null; },
    get context() { return context; },
    voice,
    /** Create the context on a user gesture and start the fog. */
    async unlock() {
      if (context || destroyed) return;
      context = new AudioContext();
      master = context.createGain(); master.gain.value = masterVolume;
      const limiter = context.createDynamicsCompressor(); limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .003; limiter.release.value = .25;
      master.connect(limiter); limiter.connect(context.destination);
      duck = context.createGain(); duck.connect(master);
      world = context.createGain(); world.connect(duck);
      environment = context.createGain(); environment.connect(duck);
      voiceBus = context.createGain(); voiceBus.gain.value = VOICE_GAIN; voiceBus.connect(master);
      visualStart = context.currentTime;
      await context.resume().catch(() => {});
      void loadManifest().then(async () => {
        if (!context || destroyed) return;
        const wind = await startLoop("fog-low-wind", environment!, gainOf("fog-low-wind"), null, 4);
        const grain = await startLoop("fog-grain-air", environment!, gainOf("fog-grain-air"), null, 6);
        fogLoops = [wind, grain].filter((loop): loop is Loop => !!loop);
        for (const surface of ["ground", "stone"]) for (let i = 1; i <= 6; i++) void load(`footstep-${surface}-0${i}`);
        void load("pulse");
      });
      void loadCue("opening-premise");
    },
    pause() { paused = true; void context?.suspend(); },
    resume() { paused = false; void context?.resume(); },
    setMasterVolume(volume: number) { masterVolume = Math.max(0, Math.min(1, volume)); applyMaster(); },
    get masterVolume() { return masterVolume; },

    /** Per-frame: listener pose, the call, the fog and the clearings. */
    update(frame: AudioFrame) {
      if (!context) { callPosition = frame.call.position; callGain = frame.call.gain; if (frame.call.structureId !== callId) { callId = frame.call.structureId; visualStart = performance.now() / 1000; } return; }
      const listener = context.listener;
      const fx = Math.sin(frame.walker.yaw), fz = Math.cos(frame.walker.yaw);
      if ("positionX" in listener && listener.positionX) {
        const t = context.currentTime;
        listener.positionX.setTargetAtTime(frame.walker.position[0], t, .02); listener.positionY.setTargetAtTime(1.62, t, .02); listener.positionZ.setTargetAtTime(frame.walker.position[1], t, .02);
        listener.forwardX.setTargetAtTime(fx, t, .02); listener.forwardY.setTargetAtTime(0, t, .02); listener.forwardZ.setTargetAtTime(fz, t, .02);
        listener.upX.value = 0; listener.upY.value = 1; listener.upZ.value = 0;
      } else { listener.setPosition(frame.walker.position[0], 1.62, frame.walker.position[1]); listener.setOrientation(fx, 0, fz, 0, 1, 0); }

      // The call: one spatial loop, crossfaded when the calling structure changes.
      if (frame.call.structureId !== callId) {
        callId = frame.call.structureId;
        stopLoop(call, .8); call = null;
        if (callId && frame.call.position && frame.call.family) {
          const startedFor = callId;
          void startLoop(`${frame.call.family}-call`, world!, 0, frame.call.position, .01).then(loop => { if (!loop) return; if (callId !== startedFor) { stopLoop(loop, .1); return; } call = loop; pulseScheduledUntil = 0; });
        }
      }
      callPosition = frame.call.position; callGain = frame.call.gain;
      if (call) { setLoopGain(call, frame.call.gain * gainOf(call.id), .4); if (call.panner && frame.call.position) place(call.panner, ...frame.call.position); this.schedulePulses(); }

      // A sleeping part answering a held look or stillness.
      answer(frame.attending ?? null);

      // Fog thins off the line into a hush; the fog layers drop a little with it.
      for (const loop of fogLoops) setLoopGain(loop, gainOf(loop.id) * (1 - .45 * frame.offWayFactor), 1);
      if (frame.offWayFactor > .02) { if (!hush) { void startLoop("off-graph-hush", environment!, 0, null, .5).then(loop => { hush = loop; }); } else setLoopGain(hush, gainOf("off-graph-hush") * frame.offWayFactor, 1); }
      else if (hush) { stopLoop(hush, 1.5); hush = null; }
      // Water at a terminus.
      const waterGain = frame.waterDistance === null ? 0 : Math.max(0, 1 - frame.waterDistance / 26);
      if (waterGain > .02) { if (!water) { void startLoop("terminus-water", environment!, 0, null, .5).then(loop => { water = loop; }); } else setLoopGain(water, gainOf("terminus-water") * waterGain, .8); }
      else if (water) { stopLoop(water, 1.5); water = null; }
      // Awake ambience for clearings near the walker.
      const near = new Set<string>();
      for (const clearing of frame.clearings) {
        const d = Math.hypot(clearing.x - frame.walker.position[0], clearing.z - frame.walker.position[1]);
        if (d > 34) continue;
        near.add(clearing.id);
        const existing = awakeLoops.get(clearing.id);
        const gain = gainOf(`${clearing.family}-awake`) * Math.max(0, 1 - d / 34);
        if (existing) { if (existing.id !== "pending") setLoopGain(existing, gain, 1); }
        else { awakeLoops.set(clearing.id, { source: null as unknown as AudioBufferSourceNode, gain: null as unknown as GainNode, panner: null, startedAt: 0, id: "pending" }); void startLoop(`${clearing.family}-awake`, world!, gain, [clearing.x, 1.2, clearing.z], 2).then(loop => { if (loop) awakeLoops.set(clearing.id, loop); else awakeLoops.delete(clearing.id); }); }
      }
      for (const [id, loop] of awakeLoops) if (!near.has(id) && loop.id !== "pending") { stopLoop(loop, 2); awakeLoops.delete(id); }
      // Her voice comes from where she is.
      if (voicePanner && frame.ariadne) {
        const dx = frame.ariadne.position[0] - frame.walker.position[0], dz = frame.ariadne.position[1] - frame.walker.position[1];
        const bearing = Math.atan2(dx, dz) - frame.walker.yaw;
        voicePanner.pan.setTargetAtTime(Math.max(-.7, Math.min(.7, -Math.sin(bearing) * .7)), context.currentTime, .1);
      }
    },

    /** Schedule the soft pulse accent for the next few seconds of the call loop. */
    schedulePulses() {
      if (!context || !call || !callPosition) return;
      const horizon = 2.5, t = context.currentTime;
      if (pulseScheduledUntil > t + horizon - .5) return;
      const from = Math.max(t, pulseScheduledUntil);
      for (const pulse of upcomingPulses(call.startedAt, from, t + horizon - from)) if (pulse.at > pulseScheduledUntil) void playOneShot("pulse", world!, gainOf("pulse") * pulse.strength * Math.min(1, callGain * 1.4), callPosition, pulse.at);
      pulseScheduledUntil = t + horizon;
    },

    /** The visible pulse right now, 0..1, on the audio clock (or a stand-in clock before audio is unlocked). */
    pulse() { const startedAt = call ? call.startedAt : visualStart; return callId ? pulseEnvelope(startedAt, now()) : 0; },

    /** World events from the game. */
    handle(event: FieldEvent) {
      if (!context || !world) return;
      switch (event.type) {
        case "footstep": {
          const surface = event.surface, variant = nextVariant(footVariant[surface], 6); footVariant = { ...footVariant, [surface]: variant };
          void playOneShot(`footstep-${surface}-0${variant}`, world, gainOf(`footstep-${surface}-0${variant}`) * (surface === "stone" ? 1 : .9), null);
          break;
        }
        case "element_woke":
        case "element_sounded": {
          const index = elementIndexOf(event.elementId);
          void playOneShot(`${event.family}-element-0${index}`, world, gainOf(`${event.family}-element-0${index}`) * (event.type === "element_woke" ? 1 : .8), event.position);
          break;
        }
        case "structure_completed": {
          void playOneShot(`${event.family}-completion`, world, gainOf(`${event.family}-completion`), [event.position[0], 1.4, event.position[1]]);
          break;
        }
        default: break;
      }
    },

    /** Preload what the first minutes need once the fog is running. */
    warm(families: StructureFamily[]) { for (const family of families) { void load(`${family}-call`); for (let i = 1; i <= 6; i++) void load(`${family}-element-0${i}`); void load(`${family}-completion`); void load(`${family}-awake`); } },

    get isPaused() { return paused; },
    destroy() { destroyed = true; voice.interrupt(); if (answering) { try { answering.oscillator.stop(); } catch { /* already stopped */ } answering = null; } stopLoop(call, .05); for (const loop of fogLoops) stopLoop(loop, .05); stopLoop(hush, .05); stopLoop(water, .05); for (const loop of awakeLoops.values()) if (loop.id !== "pending") stopLoop(loop, .05); void context?.close(); context = null; },
  };
  return audio;
}
