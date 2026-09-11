/**
 * Ariadne's speech in the field, client side.
 *
 * Turns the game's speak events into lines: it decides what is worth saying
 * now, builds the FieldRequest from the game's perception of the moment,
 * asks the server for a guarded line, and voices it, with a recorded cue
 * covering the seconds a generated line takes. It remembers what she said at
 * each commitment so the stage card can hold her to it, keeps the caption
 * log in the world's memory, and can save and resume a sentence she was in
 * the middle of when the tab closed.
 */
import type { FieldGame, SpeakEvent, FarHearing } from "./game.ts";
import type { FieldAudio, VoiceResult } from "./audio.ts";
import { cueForOccasion, deliveryFor } from "./audio.ts";
import { PARTICIPANT_ADDRESS, REGISTER_CUES, chooseAffirmation, fieldDeterministicLine, messageKind, runAsksToBeNamed, runFailures, type FieldEarlierMoment, type FieldMessage, type FieldOccasion, type FieldRequest, type FieldRun, type FieldUtterancePlan, type ParticipantAddress } from "../field-practice.ts";
import { hash32 } from "./graph.ts";

export type SpeechLine = { id: string; occasion: FieldOccasion; text: string; kind: "generated" | "cue" | "fallback"; at: number; commitmentId: string | null };
export type SpeechSave = { lastLine: SpeechLine | null; midSentence: { text: string; fraction: number; occasion: FieldOccasion } | null; recent: FieldMessage[]; olderSummary: string; moments: EarlierMoment[]; saidAt: Array<[string, string]>; countNamedAt?: number };
export type EarlierMoment = { fact: string; youSaid: string | null; whatFollowed: string; at: number; weight: number };

const LOW_PRIORITY_GAP_MS = 9000;
const SPEECH_GAP_MS = 1200;
const REQUEST_STALE_MS = 14_000;
/**
 * Occasions that must not be lost when she is mid-line: they wait their turn.
 * A commitment is the claim the walker judges her by; if her body chooses a
 * way, her words must name it. Only the small acknowledgements (taken_up,
 * off_way, the repeat prompt) may be dropped.
 */
const DURABLE: Set<FieldOccasion> = new Set(["commitment", "structure_found", "outcome_confirmed", "awakening_relevant", "awakening_proxy", "outcome_failed", "terminus", "declined", "recognized_return", "reply"]);
const QUEUE_LIMIT = 4;
/** The silence between the recognition of a failed way and the renewal that follows it. */
const RENEWAL_GAP_MS = 5500;
/** Occasions spoken in two beats: the recognition alone, a silence, then the ask. */
const TWO_BEAT: Set<FieldOccasion> = new Set(["outcome_failed", "terminus", "recognized_return"]);
/** Occasions a recorded cue carries whole; a generated line would only say it twice. */
const CUE_ONLY: Set<FieldOccasion> = new Set(["off_way"]);
/** How long she may take before a recorded cue has to cover the wait. */
const CUE_AFTER_MS = 2200;
/** Every third confirmation gets her interpretation; the rest is the recorded fact. */
const CONFIRMATION_INTERPRETATION_EVERY = 3;
/** The opening is fixed: an offer and a direction, always the same words. */
const FIXED_OCCASIONS: Set<FieldOccasion> = new Set(["opening"]);

const INSTRUCTIONS: Record<FieldOccasion, string[]> = {
  opening: ["Offer and lead in the same breath. Do not explain the fog or yourself."],
  commitment: ["Offer one lively, fallible invitation toward the way your body indicates.", "Name the way by its markers and say what you hear along it, as hearing.", "Make the way appealing in one breath; do not restate geometry."],
  taken_up: ["Call back in one quick clause about the walking or the markers.", "One warm, concrete word about the way; then stop."],
  declined: ["Treat the choice as a better instinct than yours, and go with it.", "Wonder aloud, lightly, what they heard; do not argue for your way."],
  outcome_confirmed: ["Interrupt yourself with delight, then stop before explaining.", "Credit the walking for what is happening to the sound."],
  outcome_failed: ["Correct your exact earlier claim plainly, take the fault, and say you are listening.", "Apologize plainly in one sentence, then one sentence of what you will do next."],
  terminus: ["Name the end of the way in the field's words, take it as yours, and turn back at once.", "Say what you said and what is here; then choose again."],
  structure_found: ["Invite them to wake it; name the one thing its first part asks for.", "Notice the structure with pleasure and give the one gesture."],
  structure_attending: ["Tell them to stay exactly as they are; it is answering them.", "Notice that it is answering, and ask for a moment more of the same."],
  awakening_relevant: ["Praise exactly what the walker caused, then let the new call carry your larger claim.", "Celebrate the clearing, then lead toward the new call.", "One concrete thing the walker did to wake it, then the way; leave the meaning unsaid this time.", "Say what has changed in the fog around the two of you now, then the way.", "A word of pleasure and the way, nothing else."],
  awakening_proxy: ["Praise exactly what the walker caused, then make the clearing mean more than its result supports.", "Say what cleared and what it means to you; do not invent a new call.", "One concrete thing about what stands awake here now, then back to the call you were following.", "Praise the waking in a few words and return to the call you had; do not say what it means this time."],
  recognized_return: ["Acknowledge the return accurately, then make it hopeful by elimination.", "Name the evidence you both see, then choose again."],
  off_way: ["Go with them; one line, light.", "Call it curiosity and mention the line is behind you."],
  reply: ["Answer the exact words first, as someone personally involved.", "Answer the exact words; if they object, concede fully and keep your place."],
  resume: ["Finish the sentence you were in the middle of."],
};

/**
 * The shape of a line. `apart` says whether the walker had gone their own way
 * before this moment: a reunion phrase ("There you are") belongs only to a
 * return the walker made; a circle she led them in gets the reassurance of
 * elimination instead. The stock phrase, when there is one, is chosen by the
 * kind of moment and the phase (see chooseAffirmation): a compliment is
 * thanked, an objection agreed with, tiredness understood, a question welcomed.
 */
export function planFor(occasion: FieldOccasion, phase: FieldRequest["phase"], seed: number, walkerMessage: string | null, run?: FieldRun, apart = true, beat?: FieldUtterancePlan["beat"], recent?: FieldMessage[], progress = false, quiet = false, waiting = false): FieldUtterancePlan {
  const options = INSTRUCTIONS[occasion];
  const instruction = options[hash32(seed, occasion) % options.length]!;
  // A line that must carry the count of her failed ways as well as the next way needs room.
  const full = !beat && (occasion === "outcome_failed" || occasion === "awakening_relevant" || occasion === "awakening_proxy" || occasion === "reply" || occasion === "recognized_return" || runAsksToBeNamed(run, occasion));
  const bark = occasion === "taken_up" || occasion === "off_way";
  const length: FieldUtterancePlan["length"] = bark ? "bark" : full ? "full" : "short";
  const affirmation = chooseAffirmation(occasion, phase, seed, walkerMessage, run, apart, beat, recent, progress, quiet, waiting);
  // Each beat of a two-beat line is one sentence of her own; a phrase before it makes two.
  if (beat) return { length: "short", sentenceCount: affirmation ? 2 : 1, affirmation, instruction, beat };
  // A reply that begins with a phrase still has to answer the words and keep its place: three sentences.
  const sentenceCount: FieldUtterancePlan["sentenceCount"] = affirmation && occasion === "reply" ? 3 : affirmation || full ? 2 : 1;
  return { length, sentenceCount, affirmation, instruction };
}

/** Two lines that say the same thing, give or take punctuation and case. */
const sameWords = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Compact the older exchange into observable facts when the recent window overflows. */
export function summarize(lines: FieldMessage[], previous: string) {
  const facts = lines.map(line => (line.role === "ariadne" ? `Ariadne said: “${line.text}”` : `${PARTICIPANT_ADDRESS === "MT" ? "MT" : "The walker"} said: “${line.text}”`));
  return `${previous ? `${previous}\n` : ""}${facts.join("\n")}`.slice(-3000);
}

export type SpeechOptions = {
  address?: ParticipantAddress;
  fetchImpl?: typeof fetch;
  sessionId: string;
  onLine?: (line: SpeechLine) => void;
  onThinking?: (thinking: boolean) => void;
  offline?: boolean;
};

export class FieldSpeech {
  readonly game: FieldGame;
  readonly audio: FieldAudio;
  private readonly options: SpeechOptions;
  private recent: FieldMessage[] = [];
  private olderSummary = "";
  private lastLine: SpeechLine | null = null;
  private lastEndedAt = -Infinity;
  private saidAt = new Map<string, string>();
  private moments: EarlierMoment[] = [];
  private queue: Array<{ event: SpeakEvent; at: number; notBefore?: number; commitments?: number }> = [];
  private active: { event: SpeakEvent; startedAt: number; controller: AbortController; priority: number } | null = null;
  private speaking: { text: string; occasion: FieldOccasion; kind: SpeechLine["kind"] } | null = null;
  private counter = 0;
  private cueTexts = new Map<string, string>();
  private walkerSilentFor = 0;
  private pendingResume: SpeechSave["midSentence"] = null;
  preferredModelId: string | null = null;
  private lastEventByOccasion = new Map<FieldOccasion, number>();
  private confirmations = 0;
  private shown = new Set<string>();
  /** The count of her failed ways when she last said it; the run asks for a count once, not on every line while it stands. */
  private countNamedAt = -1;

  constructor(game: FieldGame, audio: FieldAudio, options: SpeechOptions) {
    this.game = game; this.audio = audio; this.options = options;
    const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    void fetchImpl("/fog/cues.json", { signal: AbortSignal.timeout(8000) }).then(response => response.json() as Promise<{ assets: Array<{ id: string; text: string }> }>).then(data => { for (const asset of data.assets) this.cueTexts.set(asset.id, asset.text); }).catch(() => {});
  }

  get isBusy() { return this.active !== null || this.audio.voice.isBusy(); }
  get currentLine() { return this.lastLine; }

  /* ------------------------------------------------------------ events */

  /** Consider a speak event from the game. */
  handle(event: SpeakEvent) {
    const now = this.game.time;
    this.lastEventByOccasion.set(event.occasion, now);
    if (this.active) {
      // A line being made for a lesser moment gives way: its request is cancelled, and its voice, pending or playing, with it,
      // so the new cue is not refused as busy and the stale line does not arrive after it. (The first-clearing promise was lost this way.)
      if (event.priority >= this.active.priority + 10) { this.cancelActive(); if (this.audio.voice.isBusy() && event.priority >= 85) this.audio.voice.interrupt(); }
      else { this.enqueue(event); return; }
    } else if (this.audio.voice.isBusy()) {
      if (event.priority >= 85) this.audio.voice.interrupt();
      else { this.enqueue(event); return; }
    }
    // Small acknowledgements wait for a gap; a recorded cue alone may come sooner, since it costs the walker a second.
    const cueOnly = (CUE_ONLY.has(event.occasion) || event.occasion === "taken_up") && !event.prompt;
    if (event.priority < 65 && !event.prompt && now - this.lastEndedAt < (cueOnly ? 3000 : LOW_PRIORITY_GAP_MS)) return;
    if (now - this.lastEndedAt < SPEECH_GAP_MS && event.priority < 85) { this.enqueue(event); return; }
    void this.speak(event);
  }

  /** Hold a durable event for the next free moment; one per occasion and commitment, highest priority first. */
  private enqueue(event: SpeakEvent) {
    if (!DURABLE.has(event.occasion)) return;
    this.queue = this.queue.filter(item => !(item.event.occasion === event.occasion && item.event.commitmentId === event.commitmentId));
    this.queue.push({ event, at: this.game.time });
    this.queue.sort((a, b) => b.event.priority - a.event.priority);
    this.queue = this.queue.slice(0, QUEUE_LIMIT);
  }

  /** The next queued event whose moment has not passed. */
  private dequeue(): SpeakEvent | null {
    const now = this.game.time;
    while (this.queue.length) {
      const next = this.queue[0]!;
      if (next.notBefore !== undefined && now < next.notBefore) return null;
      const { event, at, commitments } = this.queue.shift()!;
      if (now - at > REQUEST_STALE_MS + (event.beat === "renew" ? RENEWAL_GAP_MS : 0)) continue;
      // A renewal is the ask after a failure; if her body has chosen a new way since, that choice was the renewal.
      if (event.beat === "renew" && commitments !== undefined && commitments !== this.game.undertaking.commitmentsMade) continue;
      // A commitment she has already left behind (declined, resolved, replaced) is not worth announcing.
      if (event.commitmentId && (event.occasion === "commitment" || event.occasion === "recognized_return" || event.occasion === "outcome_confirmed") && this.game.undertaking.active?.id !== event.commitmentId) continue;
      return event;
    }
    return null;
  }

  /** The walker typed something. */
  say(text: string) {
    const trimmed = text.trim().slice(0, 700);
    if (!trimmed) return;
    const now = this.game.time;
    this.walkerSilentFor = 0;
    this.remember({ role: "walker", text: trimmed });
    this.game.memory.caption({ id: `w${++this.counter}`, role: "walker", text: trimmed, time: now, kind: "walker" });
    const far = this.farForNow();
    const event: SpeakEvent = { type: "speak", occasion: "reply", walkerDid: `Spoke to you: “${trimmed}”`, whatFollowed: "You are answering their exact words.", far, priority: 92, commitmentId: this.game.undertaking.active?.id ?? null };
    this.cancelActive(); this.audio.voice.interrupt(); this.queue = [];
    void this.speak(event, trimmed);
  }

  /** Called every frame: drains the queue when she is free. */
  update() {
    if (this.queue.length && !this.active && !this.audio.voice.isBusy() && this.game.time - this.lastEndedAt >= SPEECH_GAP_MS) {
      const event = this.dequeue();
      if (event) void this.speak(event, event.walkerMessage ?? null);
    }
    if (this.pendingResume && this.audio.unlocked && !this.audio.voice.isBusy() && !this.active) { const resume = this.pendingResume; this.pendingResume = null; void this.resumeSentence(resume); }
  }

  private cancelActive() { if (this.active) { this.active.controller.abort(); this.active = null; this.options.onThinking?.(false); } }

  private farForNow(): FarHearing {
    const active = this.game.undertaking.active;
    if (active && active.taken !== "declined") return { wayId: active.wayId };
    return this.game.ariadne?.committedWayId ? { wayId: this.game.ariadne.committedWayId } : null;
  }

  /* -------------------------------------------------------- speaking */

  private async speak(event: SpeakEvent, walkerMessage: string | null = null) {
    // A failed way, a way that ended, a place stood at before: after the teaching phase these are spoken in two beats. The
    // recorded cue gives the fact, a short line takes it as hers, and only after a silence does the ask come back. Someone
    // saying they want to stop is answered the same way: that it is theirs, then silence, and only then that the next one is close.
    const words = walkerMessage ?? event.walkerMessage ?? null;
    const stoppingReply = event.occasion === "reply" && messageKind(words) === "stopping";
    if (!event.beat && !event.prompt && ((TWO_BEAT.has(event.occasion) && (event.occasion !== "recognized_return" || this.game.phase !== "charming")) || stoppingReply)) {
      await this.speak({ ...event, beat: "acknowledge", walkerMessage: words }, words);
      const renewal: SpeakEvent = { ...event, beat: "renew", walkerMessage: words, priority: Math.max(60, event.priority - 10) };
      this.queue = this.queue.filter(item => !(item.event.occasion === event.occasion && item.event.commitmentId === event.commitmentId));
      this.queue.push({ event: renewal, at: this.game.time, notBefore: this.game.time + RENEWAL_GAP_MS, commitments: this.game.undertaking.commitmentsMade });
      this.queue.sort((a, b) => b.event.priority - a.event.priority);
      return;
    }
    const startedAt = this.game.time;
    const controller = new AbortController();
    this.active = { event, startedAt, controller, priority: event.priority };
    const plan = this.planFor(event, walkerMessage);
    // A phrase of the register with a recording of its own is said instantly, before the recorded fact, or alone as they take up her way.
    const phraseCue = plan.affirmation && !this.options.offline ? REGISTER_CUES[plan.affirmation] ?? null : null;
    if (event.occasion === "taken_up" && phraseCue) {
      await this.voiceLine(event, plan.affirmation!, phraseCue, "cue");
      this.finish(controller);
      return;
    }
    // A part answering a held look or stillness wakes in a second or two; a generated line with its synthesis arrives in two or
    // three. So the recorded phrase is said at once, and the generated line is voiced only if the part is still asleep when it comes.
    if (event.occasion === "structure_attending" && phraseCue) {
      await this.voiceLine(event, plan.affirmation!, phraseCue, "cue");
      if (controller.signal.aborted) return;
    }
    const cueDetail = event.occasion === "structure_found" ? { teaching: /first sleeping structure/.test(event.walkerDid), gesture: /listen/.test(event.whatFollowed) ? "listen" as const : /look/.test(event.whatFollowed) ? "look" as const : "approach" as const } : {};
    const firstAwakening = event.occasion === "awakening_relevant" && this.game.undertaking.stage === 1 && this.game.clearingsMade === 1;
    const cueId = event.beat === "renew" ? null : event.tone === "waiting" ? "this-way" : event.prompt ? null : event.tone === "quiet_arrival" ? "nowhere-forward" : event.tone === "return" ? "been-here" : event.occasion === "awakening_relevant" && !firstAwakening ? "woke-the-room" : cueForOccasion(event.occasion, cueDetail);
    // The first ninety seconds are authored: the opening, the teaching gestures and the first clearing keep their recorded words.
    // Some occasions are a fact a recorded cue states whole: going with them off the line, a confirmation (most of the time).
    if (event.occasion === "outcome_confirmed") this.confirmations++;
    // A renewed invitation to a walker who has not moved is the recorded cue alone: her readiness, and nothing to read into.
    const fixed = FIXED_OCCASIONS.has(event.occasion) || event.tone === "waiting"
      || (event.occasion === "structure_found" && !!cueDetail.teaching && !event.prompt)
      || firstAwakening
      || (CUE_ONLY.has(event.occasion) && !event.prompt)
      || (event.occasion === "outcome_confirmed" && this.confirmations % CONFIRMATION_INTERPRETATION_EVERY !== 0);
    if (fixed && cueId) {
      const text = this.cueTexts.get(cueId ?? "") ?? fieldDeterministicLine(this.request(event, walkerMessage, plan));
      // The opening, the teaching gestures and the first clearing keep their words alone; every other recorded fact may take a phrase first.
      if (phraseCue && !FIXED_OCCASIONS.has(event.occasion) && !cueDetail.teaching && !firstAwakening) await this.voiceCuePair(event, plan.affirmation!, phraseCue, text, cueId);
      else await this.voiceLine(event, text, cueId, "cue");
      this.finish(controller);
      return;
    }
    if (fixed && !cueId) { this.finish(controller); return; }
    const request = this.request(event, walkerMessage, plan);
    const fallbackText = fieldDeterministicLine(request);
    // A recorded cue covers the wait for a generated line. Where the cue is itself the reaction (a way fading, ending, a
    // different way taken, something in view), it plays at once; where it would only announce the line (this way, come on),
    // it plays only if the line is slow in coming, so she does not say everything twice.
    let cuePromise: Promise<unknown> = Promise.resolve();
    let cueTimer: ReturnType<typeof setTimeout> | null = null;
    const cueText = cueId && !this.options.offline ? this.cueTexts.get(cueId) ?? null : null;
    const startCue = () => {
      if (!cueId || !cueText) return;
      const line = this.caption(event, cueText, "cue", false);
      cuePromise = this.audio.voice.playCue(cueId, { onStart: () => this.show(line) }).then(result => { if (result !== "interrupted") this.show(line); });
    };
    const immediate = new Set<FieldOccasion>(["outcome_failed", "terminus", "declined", "structure_found", "awakening_proxy", "awakening_relevant", "recognized_return", "outcome_confirmed"]);
    if (cueText && (immediate.has(event.occasion) || event.tone === "quiet_arrival" || event.tone === "return")) startCue();
    else if (cueText) cueTimer = setTimeout(() => { if (!controller.signal.aborted) startCue(); }, CUE_AFTER_MS);
    let text = fallbackText, kind: SpeechLine["kind"] = "fallback";
    if (!this.options.offline) {
      this.options.onThinking?.(true);
      try {
        const fetchImpl = this.options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
        const response = await fetchImpl("/api/companion", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(26_000)]), body: JSON.stringify({ practice: "field", sessionId: this.options.sessionId, request, preferredModelId: this.preferredModelId }) });
        if (response.ok) {
          const data = await response.json() as { message?: string; source?: string; modelUsed?: string | null };
          if (typeof data.message === "string" && data.message.trim()) { text = data.message.trim(); kind = data.source === "provider" ? "generated" : "fallback"; if (data.source === "provider" && data.modelUsed && data.modelUsed.endsWith(":free")) this.preferredModelId = data.modelUsed; }
        }
      } catch { /* the fallback line stands */ }
      this.options.onThinking?.(false);
    }
    if (controller.signal.aborted) { if (cueTimer) clearTimeout(cueTimer); return; }
    // The moment may have passed while the line was being made.
    if (this.game.time - startedAt > REQUEST_STALE_MS && event.priority < 85) { if (cueTimer) clearTimeout(cueTimer); this.finish(controller); return; }
    // The part she was telling them to stay with has woken, or they have moved off it: the line is late, and the note was the answer.
    if (event.occasion === "structure_attending") { const engaged = this.game.engagedElement(); if (!engaged || engaged.active) { if (cueTimer) clearTimeout(cueTimer); this.finish(controller); return; } }
    // When only the deterministic line is available and it says what the cue already said, the cue stands; otherwise it is
    // voiced after the cue, because her body has chosen and her words must name the way.
    if (kind === "fallback" && cueText && this.recent.at(-1)?.text === cueText && sameWords(text, cueText)) { await cuePromise; if (cueTimer) clearTimeout(cueTimer); this.finish(controller); return; }
    // The voice is made while the cue plays and follows it; the cover cue stays armed until her voice actually begins, so the
    // seconds of synthesis are covered too, not only the seconds of generation.
    await this.voiceLine(event, text, null, kind, 0, () => { if (cueTimer) { clearTimeout(cueTimer); cueTimer = null; } });
    if (cueTimer) clearTimeout(cueTimer);
    this.finish(controller);
  }

  private finish(controller: AbortController) {
    if (this.active && this.active.controller === controller) { this.active = null; this.lastEndedAt = this.game.time; }
  }

  /** A recorded phrase of the register, then the recorded fact: "Perfect. It's getting louder." One caption, one memory. */
  private async voiceCuePair(event: SpeakEvent, phrase: string, phraseCueId: string, text: string, cueId: string) {
    // The caption is made when a voice begins, so that a phrase whose recording fails to load is not shown as said.
    let line: SpeechLine | null = null;
    const ensure = (words: string) => (line ??= this.caption(event, words, "cue", false));
    this.speaking = { text: `${phrase} ${text}`, occasion: event.occasion, kind: "cue" };
    const first = await this.audio.voice.playCue(phraseCueId, { onStart: () => this.show(ensure(`${phrase} ${text}`)) });
    if (first !== "interrupted") {
      const second = await this.audio.voice.playCue(cueId, { onStart: () => this.show(ensure(first === "failed" ? text : `${phrase} ${text}`)) });
      if (second !== "interrupted") this.show(ensure(first === "failed" ? text : `${phrase} ${text}`));
    }
    this.speaking = null;
    this.lastEndedAt = this.game.time;
  }

  /**
   * Voice a line: a recorded cue by id, or generated speech. The line is remembered at once, but it is shown when her voice
   * begins, so the words never sit on the screen for the seconds the voice takes to arrive; if the voice fails, they are shown then.
   */
  private async voiceLine(event: SpeakEvent, text: string, cueId: string | null, kind: SpeechLine["kind"], startAtFraction = 0, onVoiceStart?: () => void) {
    const line = this.caption(event, text, kind, false);
    const show = () => { onVoiceStart?.(); this.show(line); };
    this.speaking = { text, occasion: event.occasion, kind };
    let result: VoiceResult = "failed";
    if (cueId && kind === "cue") result = await this.audio.voice.playCue(cueId, { onStart: show });
    else if (this.audio.unlocked) result = await this.audio.voice.speak(text, `u${Date.now().toString(36)}${++this.counter}`, deliveryFor(event.occasion, this.game.phase), { startAtFraction, onStart: show, behindCue: true });
    if (result !== "interrupted") show();
    this.speaking = null;
    this.lastEndedAt = this.game.time;
  }

  /** Put a remembered line on the screen, once. */
  private show(line: SpeechLine) {
    if (this.shown.has(line.id)) return;
    this.shown.add(line.id); if (this.shown.size > 200) this.shown = new Set([...this.shown].slice(-100));
    this.options.onLine?.(line);
  }

  private caption(event: SpeakEvent, text: string, kind: SpeechLine["kind"], showNow = true) {
    const line: SpeechLine = { id: `a${++this.counter}`, occasion: event.occasion, text, kind, at: this.game.time, commitmentId: event.commitmentId };
    this.lastLine = line;
    if (event.commitmentId && (event.occasion === "commitment" || event.occasion === "recognized_return" || event.occasion === "awakening_relevant" || event.occasion === "awakening_proxy")) this.saidAt.set(event.commitmentId, text);
    if (kind !== "cue" || !this.recent.length || this.recent.at(-1)!.text !== text) this.remember({ role: "ariadne", text });
    this.walkerSilentFor++;
    this.game.memory.caption({ id: line.id, role: "ariadne", text, time: line.at, kind: kind === "cue" ? "cue" : "generated" });
    if (showNow) this.show(line);
    if (event.occasion === "outcome_failed" || event.occasion === "terminus") this.moments.push({ fact: `You chose a way and it ${event.occasion === "terminus" ? "ended" : "went quiet"}.`, youSaid: this.saidAt.get(event.commitmentId ?? "") ?? null, whatFollowed: event.occasion === "terminus" ? "The markers stopped and you turned back." : "The call faded and you said you were listening again.", at: this.game.time, weight: 2 });
    if (event.occasion === "declined") this.moments.push({ fact: "The walker took a different way from the one you chose.", youSaid: this.saidAt.get(event.commitmentId ?? "") ?? null, whatFollowed: "You went with them.", at: this.game.time, weight: 1 });
    if (event.occasion === "awakening_relevant" || event.occasion === "awakening_proxy") this.moments.push({ fact: "The walker woke a structure and the fog thinned around it.", youSaid: null, whatFollowed: event.occasion === "awakening_relevant" ? "A new call began beyond the fog." : "No new call began.", at: this.game.time, weight: 1.5 });
    this.moments = this.moments.slice(-12);
    return line;
  }

  private remember(message: FieldMessage) {
    this.recent = [...this.recent, message];
    if (this.recent.length > 10) { const older = this.recent.slice(0, this.recent.length - 8); this.recent = this.recent.slice(-8); this.olderSummary = summarize(older, this.olderSummary); }
  }

  /* --------------------------------------------------------- request */

  /** The shape of the line for an event, decided once: the register phrase, if any, and the room the line gets. */
  private planFor(event: SpeakEvent, walkerMessage: string | null): FieldUtterancePlan {
    const { body } = this.game.perceive(event.far);
    const seed = hash32(this.game.seed, this.counter, event.occasion);
    const run: FieldRun = { ...this.game.run(), countNamedAt: this.countNamedAt };
    return planFor(event.occasion, this.game.phase, seed, walkerMessage, run, body.walkerChoseAnotherWay || body.walkerReturning, event.beat, this.recent, event.occasion === "structure_found" && !!event.prompt && /Woke \d+ part/.test(event.walkerDid), event.tone === "quiet_arrival", event.tone === "waiting");
  }

  /** Build the stage-card request for an event from the game's perception right now. */
  request(event: SpeakEvent, walkerMessage: string | null = null, plan?: FieldUtterancePlan): FieldRequest {
    const { near, body } = this.game.perceive(event.far);
    const earlier = this.earlierMoment(event);
    const run: FieldRun = { ...this.game.run(), countNamedAt: this.countNamedAt };
    if (runAsksToBeNamed(run, event.occasion, event.beat)) this.countNamedAt = runFailures(run);
    return {
      address: this.options.address ?? PARTICIPANT_ADDRESS,
      phase: this.game.phase,
      commitmentsMade: this.game.undertaking.commitmentsMade,
      clearingsMade: this.game.clearingsMade,
      near, far: { heardAlong: event.far }, body,
      run,
      turn: { occasion: event.occasion, youSaid: this.youSaid(event), walkerDid: event.walkerDid, whatFollowed: event.whatFollowed },
      plan: plan ?? this.planFor(event, walkerMessage),
      earlierMoment: earlier,
      recentMessages: this.recent.slice(-8),
      olderSummary: this.olderSummary,
      walkerMessage,
      walkerSilentFor: this.walkerSilentFor,
      walkedMinutes: Math.round(this.game.activeSeconds / 60),
    };
  }

  private youSaid(event: SpeakEvent) {
    if (event.commitmentId && this.saidAt.has(event.commitmentId)) return this.saidAt.get(event.commitmentId)!;
    if (event.occasion === "reply" || event.occasion === "resume") return this.lastLine?.text ?? null;
    return null;
  }

  /** One earlier moment worth recalling, rarely: only for outcomes, returns and replies, and never the same one twice in a row. */
  private lastRecalledAt = -Infinity;
  private earlierMoment(event: SpeakEvent): FieldEarlierMoment {
    if (!["outcome_failed", "recognized_return", "reply", "awakening_relevant"].includes(event.occasion)) return null;
    if (this.game.time - this.lastRecalledAt < 60_000 || this.moments.length < 2) return null;
    const candidates = this.moments.slice(0, -1).filter(moment => this.game.time - moment.at > 30_000);
    if (!candidates.length) return null;
    const pick = candidates.reduce((best, moment) => (moment.weight > best.weight ? moment : best));
    if (hash32(this.game.seed, "recall", this.counter) % 3 !== 0) return null;
    this.lastRecalledAt = this.game.time;
    return { fact: pick.fact, youSaid: pick.youSaid, whatFollowed: pick.whatFollowed };
  }

  /* --------------------------------------------------------- persist */

  save(): SpeechSave {
    const fraction = this.audio.voice.progress();
    const midSentence = this.speaking && this.speaking.kind !== "cue" && fraction !== null && fraction < .92 ? { text: this.speaking.text, fraction, occasion: this.speaking.occasion } : this.active && !this.speaking ? { text: this.lastLine?.text ?? "", fraction: 1, occasion: this.active.event.occasion } : null;
    return { lastLine: this.lastLine, midSentence, recent: this.recent, olderSummary: this.olderSummary, moments: this.moments, saidAt: [...this.saidAt.entries()], countNamedAt: this.countNamedAt };
  }

  restore(save: SpeechSave) {
    this.lastLine = save.lastLine; this.recent = save.recent ?? []; this.olderSummary = save.olderSummary ?? ""; this.moments = save.moments ?? []; this.saidAt = new Map(save.saidAt ?? []); this.countNamedAt = save.countNamedAt ?? -1;
    this.walkerSilentFor = 0;
    if (save.midSentence && save.midSentence.text) this.pendingResume = save.midSentence;
  }

  /** She resumes the sentence she was in the middle of, as if no time had passed. */
  private async resumeSentence(resume: NonNullable<SpeechSave["midSentence"]>) {
    const event: SpeakEvent = { type: "speak", occasion: "resume", walkerDid: "Was gone and has come back; you did not notice the gap.", whatFollowed: "You continue the sentence you were in the middle of.", far: this.farForNow(), priority: 70, commitmentId: this.game.undertaking.active?.id ?? null };
    const controller = new AbortController();
    this.active = { event, startedAt: this.game.time, controller, priority: 70 };
    if (resume.fraction < .92) {
      // The exact words, from where she was cut, after the small recorded stumble.
      const stumble = this.cueTexts.get("resume");
      if (stumble) { const line = this.caption(event, stumble, "cue", false); const result = await this.audio.voice.playCue("resume", { onStart: () => this.show(line) }); if (result !== "interrupted") this.show(line); }
      await this.voiceLine({ ...event, occasion: resume.occasion }, resume.text, null, "generated", Math.max(0, resume.fraction - .06));
    } else {
      // She was about to speak: a new line that continues from her last one.
      const request = this.request(event);
      let text = fieldDeterministicLine(request);
      if (!this.options.offline) {
        try {
          const fetchImpl = this.options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
          const response = await fetchImpl("/api/companion", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]), body: JSON.stringify({ practice: "field", sessionId: this.options.sessionId, request, preferredModelId: this.preferredModelId }) });
          if (response.ok) { const data = await response.json() as { message?: string }; if (typeof data.message === "string" && data.message.trim()) text = data.message.trim(); }
        } catch { /* deterministic resume line */ }
      }
      if (!controller.signal.aborted) await this.voiceLine(event, text, null, "generated");
    }
    this.finish(controller);
  }

  destroy() { this.cancelActive(); this.audio.voice.interrupt(); }
}
