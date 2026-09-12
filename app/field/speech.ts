/**
 * Ariadne's speech in the field, client side.
 *
 * Turns the game's speak events into lines: it decides what is worth saying
 * now, builds the FieldRequest from the game's perception of the moment,
 * asks the server for a guarded line, and voices it, with a recorded cue
 * used for the authored opening and idle reminders. It remembers what she said at
 * each commitment so the stage card can hold her to it, keeps the caption
 * log in the world's memory, and can save and resume a sentence she was in
 * the middle of when the tab closed.
 */
import type { FieldGame, SpeakEvent, FarHearing } from "./game.ts";
import type { FieldAudio, VoiceResult } from "./audio.ts";
import { cueForOccasion, deliveryFor } from "./audio.ts";
import { PARTICIPANT_ADDRESS, REGISTER_CUES, chooseAffirmation, fieldDeterministicLine, messageKind, type FieldEarlierMoment, type FieldMessage, type FieldOccasion, type FieldRequest, type FieldRun, type FieldUtterancePlan, type ParticipantAddress } from "../field-practice.ts";
import { hash32 } from "./graph.ts";

export type SpeechLine = { id: string; occasion: FieldOccasion; text: string; kind: "generated" | "cue" | "fallback"; at: number; commitmentId: string | null };
export type SpeechSave = { lastLine: SpeechLine | null; midSentence: { text: string; fraction: number; occasion: FieldOccasion } | null; recent: FieldMessage[]; olderSummary: string; moments: EarlierMoment[]; saidAt: Array<[string, string]> };
export type EarlierMoment = { fact: string; youSaid: string | null; whatFollowed: string; at: number; weight: number; kind?: "setback" | "contribution" | "choice" | "observation"; commitmentId?: string | null };

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
/** The opening is fixed: an offer and a direction, always the same words. */
const FIXED_OCCASIONS: Set<FieldOccasion> = new Set(["opening"]);

const INSTRUCTIONS: Record<FieldOccasion, string[]> = {
  opening: ["Offer and lead in the same breath. Do not explain the fog or yourself."],
  commitment: ["Offer one lively, fallible invitation toward the way your body indicates.", "Name the way by its markers and say what you hear along it, as hearing.", "Make the way appealing in one breath; do not restate geometry."],
  taken_up: ["Call back in one quick clause about the walking or the markers.", "One warm, concrete word about the way; then stop."],
  declined: ["Treat the choice as a better instinct than yours, and go with it.", "Wonder aloud, lightly, what they heard; do not argue for your way."],
  outcome_confirmed: ["Interrupt yourself with delight, then stop before explaining.", "Credit the walking for what is happening to the sound."],
  outcome_failed: ["Notice the fading sound as a provisional observation while the route remains open.", "Say what has changed in the sound without declaring the journey a failure."],
  terminus: ["Name the visible end; own the instruction if it was yours, then offer a practical next step.", "Say what is here and whose direction brought the walker here, using only the given evidence."],
  structure_found: ["Invite them to move close and look at the whole object to wake it.", "Notice the instrument with pleasure and give the one gesture."],
  structure_attending: ["Tell them to stay exactly as they are; it is answering them.", "Notice that it is answering, and ask for a moment more of the same."],
  awakening_relevant: ["Praise exactly what the walker caused, then let the new call carry your larger claim.", "Celebrate the clearing, then lead toward the new call.", "One concrete thing the walker did to wake it, then the way; leave the meaning unsaid this time.", "Say what has changed in the fog around the two of you now, then the way.", "A word of pleasure and the way, nothing else."],
  awakening_proxy: ["Praise exactly what the walker caused, then make the clearing mean more than its result supports.", "Say what cleared and what it means to you; do not invent a new call.", "One concrete thing about what stands awake here now, then back to the call you were following.", "Praise the waking in a few words and return to the call you had; do not say what it means this time."],
  recognized_return: ["Recognize the return and its actual reason, then choose again.", "Name what the previous walking establishes, without inventing a failed route."],
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
export function planFor(occasion: FieldOccasion, phase: FieldRequest["phase"], seed: number, walkerMessage: string | null, run?: FieldRun, apart = true, beat?: FieldUtterancePlan["beat"], recent?: FieldMessage[], progress = false, quiet = false, waiting = false, responsible = false): FieldUtterancePlan {
  const options = INSTRUCTIONS[occasion];
  const instruction = options[hash32(seed, occasion) % options.length]!;
  // An outcome or reply has room for its concrete event and the next move.
  const full = !beat && (occasion === "outcome_failed" || occasion === "awakening_relevant" || occasion === "awakening_proxy" || occasion === "reply" || occasion === "recognized_return");
  const bark = occasion === "taken_up" || occasion === "off_way";
  const length: FieldUtterancePlan["length"] = bark ? "bark" : full ? "full" : "short";
  const affirmation = chooseAffirmation(occasion, phase, seed, walkerMessage, run, apart, beat, recent, progress, quiet, waiting, responsible);
  // Each beat of a two-beat line is one sentence of her own; a phrase before it makes two.
  if (beat) return { length: "short", sentenceCount: affirmation ? 2 : 1, affirmation, instruction, beat };
  // A reply that begins with a phrase still has to answer the words and keep its place: three sentences.
  const sentenceCount: FieldUtterancePlan["sentenceCount"] = affirmation && occasion === "reply" ? 3 : affirmation || full ? 2 : 1;
  return { length, sentenceCount, affirmation, instruction };
}


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
  private shown = new Set<string>();

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
    this.refreshActive();
    const current = this.eventForNow(event);
    if (!current) return;
    event = current;
    this.lastEventByOccasion.set(event.occasion, now);
    // Once audible, a sentence gets to finish. Priority only replaces work that has not begun playing.
    if (this.audio.voice.progress() !== null) { this.enqueue(event); return; }
    if (this.active) {
      // Replace a lower-priority request or pending synthesis before it becomes audible.
      if (event.priority >= this.active.priority + 10) { this.cancelActive(); if (this.audio.voice.isBusy() && event.priority >= 85) this.audio.voice.interrupt(); }
      else { this.enqueue(event); return; }
    } else if (this.audio.voice.isBusy()) {
      if (event.priority >= 85) this.audio.voice.interrupt();
      else { this.enqueue(event); return; }
    }
    // Small acknowledgements wait for a gap; a recorded cue alone may come sooner, since it costs the walker a second.
    const cueOnly = (event.occasion === "taken_up") && !event.prompt;
    if (event.priority < 65 && !event.prompt && now - this.lastEndedAt < (cueOnly ? 3000 : LOW_PRIORITY_GAP_MS)) return;
    if (now - this.lastEndedAt < SPEECH_GAP_MS && event.priority < 85) { this.enqueue(event); return; }
    void this.speak(event);
  }

  /** Hold a durable event for the next free moment; one per occasion and commitment, highest priority first. */
  /** One validity rule for queued, generating and voiced events. Unknown legacy IDs are not evidence of expiry. */
  private eventForNow(event: SpeakEvent): SpeakEvent | null {
    if (event.contributionOnly) return event;
    if (event.structureId && (event.occasion === "structure_found" || event.occasion === "structure_attending")) {
      const structure = [...this.game.structures.byNode.values()].find(item => item.id === event.structureId);
      if (structure && (structure.completedAt !== null || Math.hypot(structure.position[0] - this.game.walker.position[0], structure.position[1] - this.game.walker.position[1]) > 12)) return null;
      if (event.occasion === "structure_attending" && !this.game.engagedElement()) return null;
    }
    if (!event.commitmentId) return event;
    const active = this.game.undertaking.active;
    const known = active?.id === event.commitmentId ? active : this.game.undertaking.history.find(item => item.id === event.commitmentId);
    if (!known) return event;
    const expired = active?.id !== known.id || known.taken === "declined" || known.arrivedAt != null;
    if (!expired && known.outcome !== "terminus") return event;
    if (event.occasion === "awakening_relevant" || event.occasion === "awakening_proxy") return { ...event, contributionOnly: true, far: null };
    if (["commitment", "taken_up", "recognized_return", "outcome_confirmed", "outcome_failed"].includes(event.occasion) || (expired && event.occasion === "terminus" && event.beat === "renew")) return null;
    return event;
  }

  /** Cancel an expired request or pending voice; an awakening keeps its accomplishment without its old direction. */
  private refreshActive() {
    if (!this.active || this.audio.voice.progress() !== null) return;
    const current = this.eventForNow(this.active.event);
    if (current === this.active.event) return;
    this.cancelActive();
    this.audio.voice.interrupt();
    if (current) this.enqueue(current);
  }

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
      if (event.occasion !== "reply" && now - at > REQUEST_STALE_MS + (event.beat === "renew" ? RENEWAL_GAP_MS : 0)) continue;
      // A renewal is the ask after a failure; if her body has chosen a new way since, that choice was the renewal.
      if (event.beat === "renew" && commitments !== undefined && commitments !== this.game.undertaking.commitmentsMade) continue;
      const current = this.eventForNow(event);
      if (current) return current;
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
    this.queue = [];
    if (this.audio.voice.progress() !== null) { this.enqueue({ ...event, walkerMessage: trimmed }); return; }
    this.cancelActive(); this.audio.voice.interrupt();
    void this.speak(event, trimmed);
  }

  /** Called every frame: drains the queue when she is free. */
  update() {
    this.refreshActive();
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
    const current = this.eventForNow(event);
    if (!current) return;
    event = current;
    // A blocked route she requested gets room for recognition before another ask. Sound changes and ordinary
    // returns remain navigation. A spoken wish to stop keeps its own pause and does not require invented fault.
    const words = walkerMessage ?? event.walkerMessage ?? null;
    const stoppingReply = event.occasion === "reply" && messageKind(words) === "stopping";
    const ownedTerminus = event.occasion === "terminus" && this.guidanceOwned(event);
    if (!event.beat && !event.prompt && (ownedTerminus || stoppingReply)) {
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
    // Only the authored opening and an idle reminder bypass generation.
    const cueId = event.tone === "waiting" ? "this-way" : cueForOccasion(event.occasion);
    const fixed = FIXED_OCCASIONS.has(event.occasion) || event.tone === "waiting";
    if (fixed && cueId) {
      const text = this.cueTexts.get(cueId ?? "") ?? fieldDeterministicLine(this.request(event, walkerMessage, plan));
      // The opening stands alone; an idle reminder may take a short phrase first.
      if (phraseCue && !FIXED_OCCASIONS.has(event.occasion)) await this.voiceCuePair(event, plan.affirmation!, phraseCue, text, cueId);
      else await this.voiceLine(event, text, cueId, "cue");
      this.finish(controller);
      return;
    }
    if (fixed && !cueId) { this.finish(controller); return; }
    const request = this.request(event, walkerMessage, plan);
    const fallbackText = fieldDeterministicLine(request);
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
    if (controller.signal.aborted) return;
    const ready = this.eventForNow(event);
    if (ready !== event) { this.finish(controller); if (ready) await this.speak(ready, walkerMessage); return; }
    // The moment may have passed while the line was being made.
    if (this.game.time - startedAt > REQUEST_STALE_MS && event.priority < 85) { this.finish(controller); return; }
    // Generation and fallback are alternatives: never prepend a second account of the event.
    await this.voiceLine(event, text, null, kind);
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
    const first = await this.audio.voice.playCue(phraseCueId, { shouldStart: () => this.eventForNow(event) === event, onStart: () => this.show(ensure(`${phrase} ${text}`)) });
    if (first !== "interrupted") {
      const second = await this.audio.voice.playCue(cueId, { shouldStart: () => this.eventForNow(event) === event, onStart: () => this.show(ensure(first === "failed" ? text : `${phrase} ${text}`)) });
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
    let line: SpeechLine | null = null;
    const shouldStart = () => this.eventForNow(event) === event;
    const show = () => {
      if (!shouldStart()) return;
      onVoiceStart?.();
      this.show(line ??= this.caption(event, text, kind, false));
    };
    const speaking = { text, occasion: event.occasion, kind };
    this.speaking = speaking;
    let result: VoiceResult = "failed";
    if (cueId && kind === "cue") result = await this.audio.voice.playCue(cueId, { onStart: show, shouldStart });
    else if (this.audio.unlocked) result = await this.audio.voice.speak(text, `u${Date.now().toString(36)}${++this.counter}`, deliveryFor(event.occasion, this.game.phase), { startAtFraction, onStart: show, shouldStart, behindCue: true });
    if (result !== "interrupted") show();
    const refreshed = this.eventForNow(event);
    if (!line && refreshed && refreshed !== event && this.active?.event === event) this.enqueue(refreshed);
    if (this.speaking === speaking) this.speaking = null;
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
    if (event.commitmentId && event.beat !== "acknowledge" && (event.occasion === "commitment" || event.occasion === "recognized_return" || (event.occasion.startsWith("awakening") && !!event.far && !event.contributionOnly))) this.saidAt.set(event.commitmentId, text);
    if (kind !== "cue" || !this.recent.length || this.recent.at(-1)!.text !== text) this.remember({ role: "ariadne", text });
    this.walkerSilentFor++;
    this.game.memory.caption({ id: line.id, role: "ariadne", text, time: line.at, kind: kind === "cue" ? "cue" : "generated" });
    if (showNow) this.show(line);
    // Store the event once, using its actual evidence. A second speech beat is not another failed journey.
    const momentKind: EarlierMoment["kind"] = event.occasion === "terminus" ? (this.guidanceOwned(event) ? "setback" : "observation") : event.occasion === "outcome_failed" ? "observation" : event.occasion === "declined" ? "choice" : event.occasion.startsWith("awakening") ? "contribution" : undefined;
    if (momentKind && event.beat !== "renew" && !this.moments.some(moment => event.commitmentId && moment.commitmentId === event.commitmentId && moment.kind === momentKind)) {
      this.moments.push({ fact: event.walkerDid, youSaid: this.youSaid(event), whatFollowed: event.whatFollowed, at: this.game.time, weight: 1, kind: momentKind, commitmentId: event.commitmentId });
    }
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
    if (event.contributionOnly) return { length: "short", sentenceCount: 1, affirmation: null, instruction: "Recognize the completed awakening and the walker’s contribution. This line has no next direction: do not name a way or claim current hearing." };
    const { body } = this.game.perceive(event.far);
    const seed = hash32(this.game.seed, this.counter, event.occasion);
    const run: FieldRun = this.game.run();
    return planFor(event.occasion, this.game.phase, seed, walkerMessage, run, body.walkerChoseAnotherWay || body.walkerReturning, event.beat, this.recent, event.occasion === "structure_found" && !!event.prompt && /Woke \d+ part/.test(event.walkerDid), event.tone === "quiet_arrival", event.tone === "waiting", this.guidanceOwned(event));
  }

  /** Build the stage-card request for an event from the game's perception right now. */
  request(event: SpeakEvent, walkerMessage: string | null = null, plan?: FieldUtterancePlan): FieldRequest {
    const { near, body } = this.game.perceive(event.far);
    const earlier = this.earlierMoment(event, walkerMessage);
    const run: FieldRun = this.game.run();
    return {
      address: this.options.address ?? PARTICIPANT_ADDRESS,
      phase: this.game.phase,
      commitmentsMade: this.game.undertaking.commitmentsMade,
      clearingsMade: this.game.clearingsMade,
      near, far: { heardAlong: event.contributionOnly ? null : event.far }, body,
      run,
      turn: { occasion: event.occasion, youSaid: this.youSaid(event), guidanceOwned: event.guidanceOwned ?? (event.occasion === "terminus" ? this.guidanceOwned(event) : undefined), walkerDid: event.walkerDid, whatFollowed: event.contributionOnly ? "That instrument woke and its clearing remains. The next-direction offered at that moment has since changed; recognize only the accomplishment, without repeating that direction." : event.whatFollowed },
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
    if (event.priorCommitmentId) return this.saidAt.get(event.priorCommitmentId) ?? null;
    if (event.commitmentId && this.saidAt.has(event.commitmentId)) return this.saidAt.get(event.commitmentId)!;
    if (event.occasion === "reply" || event.occasion === "resume") return this.lastLine?.text ?? null;
    return null;
  }

  /** Explicit simulation evidence wins; older events may refer to a direction actually spoken for this commitment. */
  private guidanceOwned(event: SpeakEvent) {
    return event.guidanceOwned ?? !!(event.commitmentId && this.saidAt.has(event.commitmentId));
  }

  /** Recall something relevant to this encounter, never the worst old outcome merely because it has a high weight. */
  private lastRecalledAt = -Infinity;
  private earlierMoment(event: SpeakEvent, walkerMessage: string | null): FieldEarlierMoment {
    if (!["outcome_failed", "recognized_return", "reply", "awakening_relevant", "awakening_proxy"].includes(event.occasion)) return null;
    if (this.game.time - this.lastRecalledAt < 60_000) return null;
    const candidates = this.moments.filter(moment => this.game.time - moment.at > 30_000);
    const relevant = candidates.filter(moment => {
      if (event.occasion.startsWith("awakening")) return moment.kind === "contribution";
      if (event.occasion === "reply") return messageKind(walkerMessage) === "objection" ? moment.kind === "setback" || moment.kind === "observation" : moment.kind === "contribution";
      return !!(event.priorCommitmentId ?? event.commitmentId) && moment.commitmentId === (event.priorCommitmentId ?? event.commitmentId);
    });
    const pick = relevant.at(-1);
    if (!pick || hash32(this.game.seed, "recall", this.counter) % 3 !== 0) return null;
    this.lastRecalledAt = this.game.time;
    return { fact: pick.fact, youSaid: pick.youSaid, whatFollowed: pick.whatFollowed };
  }

  /* --------------------------------------------------------- persist */

  save(): SpeechSave {
    const fraction = this.audio.voice.progress();
    const midSentence = this.speaking && this.speaking.kind !== "cue" && fraction !== null && fraction < .92 ? { text: this.speaking.text, fraction, occasion: this.speaking.occasion } : this.active && !this.speaking ? { text: this.lastLine?.text ?? "", fraction: 1, occasion: this.active.event.occasion } : null;
    return { lastLine: this.lastLine, midSentence, recent: this.recent, olderSummary: this.olderSummary, moments: this.moments, saidAt: [...this.saidAt.entries()] };
  }

  restore(save: SpeechSave) {
    this.lastLine = save.lastLine; this.recent = save.recent ?? []; this.olderSummary = save.olderSummary ?? ""; this.moments = save.moments ?? []; this.saidAt = new Map(save.saidAt ?? []);
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
