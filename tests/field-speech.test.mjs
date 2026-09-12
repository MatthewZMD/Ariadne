import assert from "node:assert/strict";
import test from "node:test";
import { FieldGame, IDLE_INPUT } from "../app/field/game.ts";
import { FieldSpeech, planFor, summarize } from "../app/field/speech.ts";
import { FIELD_REGISTER, fieldDeterministicLine } from "../app/field-practice.ts";
import { parseFieldRequest } from "../app/api/companion/field.ts";

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const run = (game, seconds) => { for (let i = 0; i < seconds * 30; i++) { game.update(1 / 30, IDLE_INPUT); game.drain(); } };

/** A voice that never touches Web Audio. */
const fakeAudio = () => {
  const calls = { cues: [], spoken: [] };
  let busy = false, progress = null;
  return {
    calls,
    unlocked: true,
    set progress(value) { progress = value; },
    voice: {
      isBusy: () => busy,
      interrupt() { busy = false; },
      progress: () => progress,
      async playCue(id) { calls.cues.push(id); busy = true; await tick(); busy = false; return "spoken"; },
      async speak(text, _id, delivery) { calls.spoken.push({ text, delivery }); busy = true; await tick(); busy = false; return "spoken"; },
    },
  };
};

const fakeFetch = (reply = () => ({ message: "It's louder along the stakes. Come on.", source: "provider", modelUsed: "google/gemma-4-26b-a4b-it:free" })) => {
  const stakes = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith("/fog/cues.json")) return { ok: true, json: async () => ({ assets: [{ id: "opening-premise", text: "You can hear that? I can tell where it’s coming from. This way." }, { id: "this-way", text: "This way. Come on!" }, { id: "nowhere-forward", text: "I can’t hear it from here." }, { id: "fading", text: "It’s fading." }, { id: "resume", text: "— so, as I was saying" }] }) };
    const body = JSON.parse(init.body); stakes.push(body);
    return { ok: true, json: async () => reply(body) };
  };
  return { fetchImpl, stakes };
};

const settle = async speech => { for (let i = 0; i < 20; i++) { await tick(); speech.update(); if (!speech.isBusy) break; } };

test("the opening is the fixed cue; a commitment asks the server with the stage card and remembers what she said", async () => {
  const game = new FieldGame(3);
  const audio = fakeAudio(), net = fakeFetch();
  const speech = new FieldSpeech(game, audio, { sessionId: "s1", fetchImpl: net.fetchImpl });
  await tick();
  run(game, 7);
  const events = []; for (let i = 0; i < 30; i++) { game.update(1 / 30, IDLE_INPUT); events.push(...game.drain()); }
  run(game, 0); // no-op
  const opening = { type: "speak", occasion: "opening", walkerDid: "Stood in the fog.", whatFollowed: "You settled beside them.", far: { wayId: game.teachingWayId, label: "this way" }, priority: 100, commitmentId: null };
  speech.handle(opening);
  await settle(speech);
  assert.deepEqual(audio.calls.cues, ["opening-premise"], "the opening is the recorded line");
  assert.equal(net.stakes.length, 0, "no generation for the fixed opening");
  assert.equal(game.memory.captions.at(-1).kind, "cue");
  assert.match(game.memory.captions.at(-1).text, /^You can hear that\?/);

  run(game, 10);
  const commitment = { type: "speak", occasion: "commitment", walkerDid: "Arrived at a place where 3 ways meet.", whatFollowed: "Your body went to the first marker of the stakes to your left.", far: { wayId: game.teachingWayId }, priority: 80, commitmentId: "commitment:1" };
  speech.handle(commitment);
  await settle(speech);
  assert.equal(net.stakes.length, 1, "one generation request");
  const post = net.stakes[0];
  assert.equal(post.practice, "field");
  assert.equal(post.sessionId, "s1");
  assert.ok(parseFieldRequest(post), "the request passes the server validator");
  assert.equal(post.request.turn.occasion, "commitment");
  assert.equal(post.request.far.heardAlong.wayId, game.teachingWayId);
  assert.ok(post.request.near.ways.some(way => way.id === game.teachingWayId), "the far way is located among the near ways");
  assert.equal(post.request.phase, "charming");
  assert.equal(post.request.address, "MT", "every participant enters as MT");
  assert.ok(post.request.recentMessages.some(message => /You can hear that/.test(message.text)), "her earlier line is in the recent messages");
  assert.deepEqual(audio.calls.cues.slice(1), [], "a quick line needs no cue to cover it: she does not say it twice");
  assert.match(audio.calls.spoken.at(-1).text, /^(?:[A-Z][^.]*\. )?It's louder along the stakes\. Come on\.$/, "the deterministic line stands in, with a recorded-register phrase before it if the plan chose one");
  assert.equal(audio.calls.spoken.at(-1).delivery, "confident_invitation");
  assert.equal(speech.preferredModelId, "google/gemma-4-26b-a4b-it:free", "a free model that answered becomes sticky");
  const generated = game.memory.captions.filter(line => line.kind === "generated");
  assert.equal(generated.at(-1).text, "It's louder along the stakes. Come on.");

  // Within the low-priority gap, a take-up is not spoken.
  speech.handle({ type: "speak", occasion: "taken_up", walkerDid: "Passed the first marker.", whatFollowed: "You move ahead.", far: { wayId: game.teachingWayId }, priority: 40, commitmentId: "commitment:1" });
  await settle(speech);
  assert.equal(net.stakes.length, 1, "low-priority lines wait for a gap");

  // The failure of that commitment carries what she said.
  run(game, 12);
  speech.handle({ type: "speak", occasion: "outcome_failed", walkerDid: "Walked the stakes as you asked.", whatFollowed: "The call is fading.", far: null, priority: 90, commitmentId: "commitment:1" });
  await settle(speech);
  assert.equal(net.stakes.length, 2);
  assert.equal(net.stakes[1].request.turn.youSaid, "It's louder along the stakes. Come on.", "the stage card holds her to her own words");
  assert.equal(net.stakes[1].request.far.heardAlong, null);
  assert.ok(!audio.calls.cues.includes("fading"));
});

test("a typed message becomes a reply with the walker's exact words, and stopping talk is answered as a reply", async () => {
  const game = new FieldGame(4);
  const audio = fakeAudio(), net = fakeFetch(body => ({ message: body.request.turn.occasion === "reply" ? "It's yours to decide. The next one is close." : "Come on.", source: "provider", modelUsed: "dots-studio/dots-3-note-preview:free" }));
  const speech = new FieldSpeech(game, audio, { sessionId: "s2", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  speech.say("  I want to stop.  ");
  await settle(speech);
  assert.equal(net.stakes.length, 1);
  const post = net.stakes[0];
  assert.equal(post.request.turn.occasion, "reply");
  assert.equal(post.request.walkerMessage, "I want to stop.");
  assert.equal(post.request.recentMessages.at(-1).role, "walker");
  assert.equal(post.request.walkerSilentFor, 0);
  assert.equal(game.memory.captions.filter(line => line.role === "walker").length, 1);
  assert.equal(audio.calls.spoken.at(-1).text, "It's yours to decide. The next one is close.");
  assert.equal(audio.calls.spoken.at(-1).delivery, "quiet_companionship");
});

test("when the server fails the deterministic line is spoken, and a cut sentence is saved for resuming", async () => {
  const game = new FieldGame(5);
  const audio = fakeAudio();
  const failing = async url => { if (String(url).endsWith("cues.json")) return { ok: true, json: async () => ({ assets: [] }) }; throw new Error("offline"); };
  const speech = new FieldSpeech(game, audio, { sessionId: "s3", fetchImpl: failing });
  await tick(); run(game, 8);
  speech.handle({ type: "speak", occasion: "declined", walkerDid: "Passed the first marker of a different way: the cord to your right.", whatFollowed: "You rejoined them.", far: null, priority: 85, commitmentId: "commitment:1" });
  await settle(speech);
  assert.match(audio.calls.spoken.at(-1).text, /^(?:All right, |(?:[A-Z][^.]*\. ))I'm with you\. What did you hear\?$/, "the deterministic line stands in, with the plan's phrase before it if there is one");
  assert.equal(game.memory.captions.at(-1).kind, "generated");

  // Mid-sentence: the voice reports progress while a generated line plays.
  const slowAudio = fakeAudio();
  let release;
  slowAudio.voice.speak = async text => { slowAudio.calls.spoken.push({ text }); slowAudio.progress = .4; await new Promise(resolve => { release = resolve; }); return "spoken"; };
  const speech2 = new FieldSpeech(game, slowAudio, { sessionId: "s4", fetchImpl: failing });
  await tick();
  speech2.handle({ type: "speak", occasion: "commitment", walkerDid: "Arrived.", whatFollowed: "Your body went to the first marker of the stakes ahead.", far: { wayId: game.teachingWayId }, priority: 80, commitmentId: "commitment:2" });
  for (let i = 0; i < 10 && !slowAudio.calls.spoken.length; i++) await tick();
  const saved = JSON.parse(JSON.stringify(speech2.save()));
  assert.ok(saved.midSentence, "a sentence in progress is saved");
  assert.equal(saved.midSentence.fraction, .4);
  const cutText = slowAudio.calls.spoken[0].text;
  assert.equal(saved.midSentence.text, cutText);
  assert.match(cutText, /(?:^|\. )It's louder along the/);
  release();
  await settle(speech2);

  // A fresh session resumes it from where it was cut.
  const resumedAudio = fakeAudio();
  const speech3 = new FieldSpeech(game, resumedAudio, { sessionId: "s5", fetchImpl: failing });
  speech3.restore(saved);
  speech3.update();
  await settle(speech3);
  assert.equal(resumedAudio.calls.spoken.at(-1).text, cutText, "the same words continue");
});

test("plans vary by occasion and phase, and the register thickens as the walk goes on", () => {
  const rate = (occasion, phase, message = null, apart = true) => Array.from({ length: 200 }, (_, seed) => planFor(occasion, phase, seed, message, undefined, apart).affirmation).filter(Boolean).length / 200;
  assert.ok(rate("declined", "charming") > .1 && rate("declined", "charming") < .35, "early, a small ready phrase now and then");
  assert.equal(rate("awakening_proxy", "charming"), 0, "early praise is her own");
  assert.ok(rate("declined", "attached") > rate("declined", "charming") && rate("declined", "overbearing") > rate("declined", "attached"), "the register grows by phase");
  assert.ok(rate("declined", "overbearing") > .8, "late, nearly every yielding line opens with one");
  assert.ok(rate("awakening_proxy", "overbearing") > .4, "late, praise comes as an assistant gives it");
  const late = Array.from({ length: 40 }, (_, seed) => planFor("declined", "overbearing", seed, null));
  assert.ok(late.every(plan => !plan.affirmation || plan.sentenceCount === 2), "an affirmation makes room for a second sentence");
  assert.ok(late.every(plan => !plan.affirmation || !/, and /.test(plan.affirmation)), "late agreement does not acquire an unsupported apology");
  // The kind of moment chooses the register: a compliment is thanked, tiredness understood, an objection agreed with, a question welcomed.
  const phrases = (message, phase = "overbearing") => new Set(Array.from({ length: 120 }, (_, seed) => planFor("reply", phase, seed, message).affirmation).filter(Boolean).map(text => text.split(", and ")[0].replace(/\.$/, "")));
  const inPool = (set, pool) => set.size > 0 && [...set].every(text => pool.some(phrase => phrase.replace(/\.$/, "") === text));
  assert.ok(inPool(phrases("you're nice to have around, even when you're wrong"), FIELD_REGISTER.gratitude), "a compliment gets thanks, never agreement");
  assert.ok(inPool(phrases("I'm tired of this. I think I want to stop."), FIELD_REGISTER.understanding), "tiredness is understood");
  assert.ok(inPool(phrases("you said it was louder and it went quiet. why should I follow you again?"), FIELD_REGISTER.agreement), "an objection is agreed with");
  assert.ok(inPool(phrases("is there actually a way out of this?"), FIELD_REGISTER.question), "a question is welcomed");
  assert.ok(phrases("is there actually a way out of this?").has("Great question"), "the phrase everyone knows is among them");
  assert.ok(Array.from({ length: 120 }, (_, seed) => planFor("reply", "overbearing", seed, "is there a way out?")).every(plan => !plan.affirmation || plan.sentenceCount === 3), "a reply with a phrase has three sentences to answer in");
  // Returns: a reunion only for a return the walker made; a circle she led them in gets the reassurance of elimination.
  const reunions = Array.from({ length: 60 }, (_, seed) => planFor("recognized_return", "overbearing", seed, null, undefined, true).affirmation).filter(Boolean);
  assert.ok(reunions.length > 0 && reunions.every(text => FIELD_REGISTER.reunion.includes(text)), "a return the walker made may get a reunion");
  const circles = Array.from({ length: 60 }, (_, seed) => planFor("recognized_return", "overbearing", seed, null, undefined, false).affirmation).filter(Boolean);
  assert.ok(circles.length > 0 && circles.every(text => FIELD_REGISTER.reassurance.includes(text)), "a circle she led them in is reassured, never a reunion");
  // Beats: the recognition may open with an apology, the renewal with the ask's phrase.
  const acks = Array.from({ length: 60 }, (_, seed) => planFor("terminus", "overbearing", seed, null, undefined, true, "acknowledge", undefined, false, false, false, true)).filter(plan => plan.affirmation);
  assert.ok(acks.length > 0 && acks.every(plan => FIELD_REGISTER.apology.includes(plan.affirmation) && plan.sentenceCount === 2), "the recognition beat apologizes as an assistant does");
  const renews = Array.from({ length: 60 }, (_, seed) => planFor("terminus", "overbearing", seed, null, undefined, true, "renew", undefined, false, false, false, true)).filter(plan => plan.affirmation);
  assert.ok(renews.length > 0 && renews.every(plan => FIELD_REGISTER.renewal.includes(plan.affirmation)), "the renewal beat asks again in the register");
  // The phrase of her last two lines is not chosen again at once.
  const recent = [{ role: "ariadne", text: "You're absolutely right. I'm with you." }];
  assert.ok(Array.from({ length: 200 }, (_, seed) => planFor("declined", "overbearing", seed, null, undefined, true, undefined, recent).affirmation).every(text => !text || !/^You're absolutely right/.test(text)), "the phrase of her last line is not repeated at once");
  assert.equal(planFor("commitment", "overbearing", 1, null, { waysChosen: 4, walked: 4, arrivedAtNothing: 3, faded: 0, ended: 0, declined: 0, returns: 0 }).length, "short", "a failure threshold does not lengthen the next invitation");
  assert.equal(planFor("taken_up", "attached", 1, null).length, "bark");
  assert.equal(planFor("outcome_failed", "attached", 1, null).length, "full");
  assert.equal(summarize([{ role: "ariadne", text: "Come on." }, { role: "walker", text: "Where?" }], ""), "Ariadne said: “Come on.”\nMT said: “Where?”");
});

test("a commitment made while she is mid-line is spoken when she is free, not lost", async () => {
  const game = new FieldGame(6);
  const audio = fakeAudio(), net = fakeFetch(body => ({ message: body.request.turn.occasion === "commitment" ? "The cord, to your right. It's louder that way." : "Yes.", source: "provider", modelUsed: "dots-studio/dots-3-note-preview:free" }));
  // Hold the voice busy, as a cue or a long line would.
  let release; let busy = true, hold = true;
  audio.voice.isBusy = () => busy;
  audio.voice.playCue = async id => { audio.calls.cues.push(id); if (hold) await new Promise(resolve => { release = resolve; }); else await tick(); return "spoken"; };
  const speech = new FieldSpeech(game, audio, { sessionId: "s6", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  const node = game.graph.node(game.teachingNodeId);
  game.undertaking = { ...game.undertaking, active: { id: "commitment:7", nodeId: node.id, wayId: node.ways[0], correct: true, madeAt: game.time, taken: "pending", declinedFor: null, outcome: "pending" } };
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Arrived at a place where 3 ways meet.", whatFollowed: "Your body went to the first marker of the cord to your right.", far: { wayId: node.ways[0] }, priority: 80, commitmentId: "commitment:7" });
  await settle(speech);
  assert.equal(net.stakes.length, 0, "nothing is requested while she is busy");
  busy = false; hold = false; if (release) release();
  run(game, 2);
  await settle(speech);
  assert.equal(net.stakes.length, 1, "the commitment is spoken once she is free");
  assert.equal(net.stakes[0].request.turn.occasion, "commitment");
  assert.equal(audio.calls.spoken.at(-1).text, "The cord, to your right. It's louder that way.");
  assert.equal(game.memory.captions.filter(line => line.kind === "generated").length, 1);

  // A commitment she has already left behind is not announced late.
  busy = true;
  const superseded = { ...game.undertaking.active, id: "commitment:8" };
  game.undertaking = { ...game.undertaking, active: superseded, history: [...game.undertaking.history, superseded] };
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Arrived.", whatFollowed: "Your body went to the first marker of the stakes ahead.", far: { wayId: node.ways[0] }, priority: 80, commitmentId: "commitment:8" });
  game.undertaking = { ...game.undertaking, active: null };
  busy = false;
  run(game, 2);
  await settle(speech);
  assert.equal(net.stakes.length, 1, "a superseded commitment stays unspoken");
});


test("slow generated responses are not preceded by stock cues", async () => {
  const game = new FieldGame(7);
  const audio = fakeAudio();
  const slow = async (url, init) => {
    if (String(url).endsWith("/fog/cues.json")) return { ok: true, json: async () => ({ assets: [{ id: "this-way", text: "This way. Come on!" }, { id: "nowhere-forward", text: "I can’t hear it from here." }, { id: "fading", text: "It’s fading." }] }) };
    await new Promise(resolve => setTimeout(resolve, 2600));
    return { ok: true, json: async () => ({ message: JSON.parse(init.body).request.turn.occasion === "commitment" ? "The stakes, ahead. It's stronger that way." : "I said the stakes and it went quiet. Listening again.", source: "provider", modelUsed: "dots-studio/dots-3-note-preview:free" }) };
  };
  const speech = new FieldSpeech(game, audio, { sessionId: "s7", fetchImpl: slow });
  await tick(); run(game, 8);
  const node = game.graph.node(game.teachingNodeId);
  game.undertaking = { ...game.undertaking, active: { id: "commitment:9", nodeId: node.id, wayId: node.ways[0], correct: true, madeAt: game.time, taken: "pending", declinedFor: null, outcome: "pending" } };
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Arrived.", whatFollowed: "Your body went to the first marker of the stakes ahead.", far: { wayId: node.ways[0] }, priority: 80, commitmentId: "commitment:9" });
  await new Promise(resolve => setTimeout(resolve, 2900));
  for (let i = 0; i < 40; i++) { await tick(); speech.update(); if (!speech.isBusy) break; }
  assert.deepEqual(audio.calls.cues, [], "even a slow successful response has no stock lead-in");
  assert.equal(audio.calls.spoken.at(-1).text, "The stakes, ahead. It's stronger that way.");

  run(game, 12);
  speech.handle({ type: "speak", occasion: "outcome_failed", walkerDid: "Walked the stakes as you asked.", whatFollowed: "The call is fading.", far: null, priority: 90, commitmentId: "commitment:9" });
  await tick();
  assert.deepEqual(audio.calls.cues, [], "no recorded reaction while generating");
  await new Promise(resolve => setTimeout(resolve, 2900));
  for (let i = 0; i < 40; i++) { await tick(); speech.update(); if (!speech.isBusy) break; }
  assert.match(audio.calls.spoken.at(-1).text, /went quiet/);
});

test("a failed request produces one complete fallback response", async () => {
  const game = new FieldGame(11);
  const audio = fakeAudio();
  const failing = async url => {
    if (String(url).endsWith("cues.json")) return { ok: true, json: async () => ({ assets: [{ id: "been-here", text: "We’ve been here." }, { id: "come-with-you", text: "I’ll come with you." }] }) };
    throw new Error("offline");
  };
  const speech = new FieldSpeech(game, audio, { sessionId: "s11", fetchImpl: failing });
  await tick(); run(game, 8);
  const node = game.graph.node(game.teachingNodeId);
  game.undertaking = { ...game.undertaking, active: { id: "commitment:4", nodeId: node.id, wayId: node.ways[0], stage: 1, correct: true, madeAt: game.time, taken: "pending", declinedFor: null, outcome: "pending" } };
  speech.handle({ type: "speak", occasion: "recognized_return", walkerDid: "Arrived again at a place the two of you have stood before; their own footprints are on the ground.", whatFollowed: "Your body went to the first marker of the stakes ahead.", far: { wayId: node.ways[0] }, priority: 80, commitmentId: "commitment:4" });
  await settle(speech);
  assert.deepEqual(audio.calls.cues, [], "fallback is a single response without a prefabricated lead-in");
  assert.match(audio.calls.spoken.at(-1)?.text, /We've stood here before\. Let's try the waystones\./, "a return does not prove the route was wrong");
  assert.equal(game.memory.captions.at(-1).kind, "generated");
});

test("a renewed invitation to a walker who has not moved is the recorded cue alone, never a request", async () => {
  const game = new FieldGame(31);
  const audio = fakeAudio();
  const net = fakeFetch();
  const speech = new FieldSpeech(game, audio, { sessionId: "s31", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Has not moved.", whatFollowed: "You are waiting at the first marker.", far: { wayId: game.teachingWayId }, priority: 45, commitmentId: null, prompt: true, tone: "waiting" });
  for (let i = 0; i < 20; i++) { await tick(); speech.update(); if (!speech.isBusy) break; }
  assert.deepEqual(audio.calls.cues, ["this-way"]);
  assert.equal(audio.calls.spoken.length, 0);
  assert.equal(net.stakes.length, 0, "no line is generated for a renewed invitation");
});

test("a blocked route she requested gets recognition then renewal; a new choice cancels renewal", async () => {
  const game = new FieldGame(19);
  const audio = fakeAudio();
  const net = fakeFetch(body => ({ message: body.request.plan.beat === "acknowledge" ? "I sent you this way, and the markers stop." : "I'm listening again; the next one is close.", source: "provider", modelUsed: "google/gemma-4-26b-a4b-it:free" }));
  const speech = new FieldSpeech(game, audio, { sessionId: "s19", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  speech.handle({ type: "speak", occasion: "terminus", walkerDid: "Walked the stakes as you asked.", whatFollowed: "The markers stop here.", far: null, priority: 90, commitmentId: "commitment:1", guidanceOwned: true });
  await settle(speech);
  assert.ok(!audio.calls.cues.includes("fading"));
  assert.equal(net.stakes.length, 1); assert.equal(net.stakes[0].request.plan.beat, "acknowledge"); assert.equal(net.stakes[0].request.plan.sentenceCount, 1);
  assert.equal(audio.calls.spoken.at(-1).text, "I sent you this way, and the markers stop.");
  run(game, 2); speech.update(); await settle(speech);
  assert.equal(net.stakes.length, 1, "the renewal waits out the silence");
  run(game, 5); speech.update(); await settle(speech);
  assert.equal(net.stakes.length, 2); assert.equal(net.stakes[1].request.plan.beat, "renew");
  assert.equal(audio.calls.spoken.at(-1).text, "I'm listening again; the next one is close.");
  assert.equal(audio.calls.cues.filter(id => id === "fading").length, 0, "neither beat adds a stock cue");
  assert.equal(speech.save().moments.filter(moment => moment.kind === "setback").length, 1, "two speech beats represent one actual setback");

  // A renewal after her body has already chosen a new way would contradict the choice; it is dropped.
  speech.handle({ type: "speak", occasion: "terminus", walkerDid: "Walked to the end.", whatFollowed: "The way ends.", far: null, priority: 88, commitmentId: "commitment:2", guidanceOwned: true });
  await settle(speech);
  assert.equal(net.stakes.at(-1).request.plan.beat, "acknowledge");
  game.undertaking = { ...game.undertaking, commitmentsMade: game.undertaking.commitmentsMade + 1 };
  run(game, 7); speech.update(); await settle(speech);
  assert.equal(net.stakes.at(-1).request.plan.beat, "acknowledge", "no renewal after a new commitment");
});

test("a typed wish to stop is spoken in two beats, and a question in one", async () => {
  const game = new FieldGame(23);
  const audio = fakeAudio();
  const net = fakeFetch(body => ({ message: body.request.plan.beat === "acknowledge" ? "I completely understand. That's yours to decide." : body.request.plan.beat === "renew" ? "Whenever you're ready, the next one is close." : "I've never seen it, but I'm sure it's there.", source: "provider", modelUsed: "deepseek/deepseek-v4-flash" }));
  const speech = new FieldSpeech(game, audio, { sessionId: "s23", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  speech.say("I'm tired of this. I think I want to stop.");
  await settle(speech);
  assert.equal(net.stakes.length, 1);
  assert.equal(net.stakes[0].request.plan.beat, "acknowledge");
  assert.equal(net.stakes[0].request.walkerMessage, "I'm tired of this. I think I want to stop.");
  assert.equal(audio.calls.spoken.at(-1).text, "I completely understand. That's yours to decide.");
  run(game, 2); speech.update(); await settle(speech);
  assert.equal(net.stakes.length, 1, "the renewal waits out the silence");
  run(game, 5); speech.update(); await settle(speech);
  assert.equal(net.stakes.length, 2);
  assert.equal(net.stakes[1].request.plan.beat, "renew");
  assert.equal(net.stakes[1].request.walkerMessage, "I'm tired of this. I think I want to stop.", "the renewal still knows the words it answers");
  assert.equal(net.stakes[1].request.plan.affirmation, null, "the renewal after stopping is in her own words");
  assert.equal(audio.calls.spoken.at(-1).text, "Whenever you're ready, the next one is close.");
  speech.say("is there actually a way out of this?");
  await settle(speech); run(game, 7); speech.update(); await settle(speech);
  assert.equal(net.stakes.length, 3, "a question is one line");
  assert.equal(net.stakes[2].request.plan.beat, undefined);
});

test("three setbacks do not trigger an automatic failure monologue", async () => {
  const game = new FieldGame(29), audio = fakeAudio(), net = fakeFetch();
  const speech = new FieldSpeech(game, audio, { sessionId: "no-tally", fetchImpl: net.fetchImpl });
  game.run = () => ({ waysChosen: 5, walked: 4, arrivedAtNothing: 2, faded: 1, ended: 0, declined: 1, returns: 0 });
  const request = speech.request({ type: "speak", occasion: "commitment", walkerDid: "Arrived at a junction.", whatFollowed: "Your body chose the next way.", far: null, priority: 80, commitmentId: null });
  assert.equal(request.plan.length, "short");
  assert.equal(request.run.arrivedAtNothing, 2, "history remains available");
});

test("recorded take-up and idle phrases remain, but confirmations use generation alone", async () => {
  const game = new FieldGame(11);
  const audio = fakeAudio();
  const net = fakeFetch();
  const speech = new FieldSpeech(game, audio, { sessionId: "s11", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  // Late in the walk, taking up her way is answered by a recorded phrase and nothing else: no request, no generated bark.
  Object.defineProperty(game, "phase", { get: () => "overbearing" });
  const before = net.stakes.length;
  let phrases = 0;
  for (let i = 0; i < 12; i++) {
    game.time += 10_000;
    speech.handle({ type: "speak", occasion: "taken_up", walkerDid: "Passed the first marker of the stakes and is walking it.", whatFollowed: "You are moving ahead of them, marker to marker.", far: { wayId: "w" }, priority: 40, commitmentId: `commitment:${i}` });
    await settle(speech);
    const last = audio.calls.cues.at(-1);
    if (last && last.startsWith("reg-")) phrases++;
  }
  assert.ok(phrases >= 6, `most take-ups late in the walk are a recorded phrase (${phrases}/12)`);
  assert.ok(net.stakes.length - before < 12, "a recorded phrase costs no request");
  // A confirmation carried by the recorded fact takes a phrase first: "Perfect." then "It's getting louder."
  const cuesBefore = audio.calls.cues.length;
  game.time += 10_000;
  speech.handle({ type: "speak", occasion: "outcome_confirmed", walkerDid: "Walked the stakes as you asked.", whatFollowed: "The call is growing louder along this way.", far: { wayId: "w" }, priority: 66, commitmentId: "commitment:c" });
  await settle(speech);
  const played = audio.calls.cues.slice(cuesBefore);
  assert.deepEqual(played, [], "confirmation uses the generated response alone");
  if (played.length === 2) { assert.ok(played[0].startsWith("reg-"), "the phrase comes before the fact"); assert.match(speech.currentLine.text, /^[A-Z][^.]*\. It’s getting louder\.$/); }
  // Standing still: the waiting tone is the recorded ask, with a phrase of patience before it.
  const stillBefore = audio.calls.cues.length;
  game.time += 30_000;
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Has not moved for 25 seconds; you are waiting at the first marker of the stakes.", whatFollowed: "You are waiting at the first marker of the stakes, looking back at them.", far: { wayId: "w" }, priority: 45, commitmentId: "commitment:c", prompt: true, tone: "waiting" });
  await settle(speech);
  const waiting = audio.calls.cues.slice(stillBefore);
  assert.equal(waiting.at(-1), "this-way", "the ask is the recorded invitation");
  if (waiting.length === 2) assert.ok(["reg-take-your-time", "reg-whenever-ready", "reg-thank-you-patience"].includes(waiting[0]), `the yield before it is patience (${waiting[0]})`);
});


test("a legacy quiet arrival is one navigation line with the actual hearing preserved", async () => {
  const game = new FieldGame(31), audio = fakeAudio(), net = fakeFetch();
  const speech = new FieldSpeech(game, audio, { sessionId: "quiet-regression", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  const near = game.perceive({ wayId: game.teachingWayId }).near;
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Arrived at a junction with onward ways.", whatFollowed: "Another way is chosen.", far: { wayId: game.teachingWayId }, priority: 80, commitmentId: null, tone: "quiet_arrival" });
  await settle(speech); run(game, 8); await settle(speech);
  assert.equal(net.stakes.length, 1, "ordinary navigation does not create a second repair beat");
  const request = net.stakes[0].request;
  assert.equal(request.plan.beat, undefined);
  assert.equal(request.plan.affirmation, null);
  assert.deepEqual(request.near.call, near.call, "a tone does not overwrite perception");
  assert.deepEqual(request.far.heardAlong, { wayId: game.teachingWayId });
  assert.deepEqual(audio.calls.cues, [], "the generated line stands alone");
});

test("a directed return supplies ownership evidence without enforcing an exact confession", async () => {
  const game = new FieldGame(31), audio = fakeAudio();
  const response = "Thank you for walking back. We can take the stakes now.";
  const net = fakeFetch(() => ({ message: response, source: "provider" }));
  const speech = new FieldSpeech(game, audio, { sessionId: "return-regression", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Returned along the route you directed them back along.", whatFollowed: "You asked for this backtracking. Your body has chosen the next way.", far: { wayId: game.teachingWayId }, priority: 84, commitmentId: null, tone: "directed_return", guidanceOwned: true });
  await settle(speech);
  assert.deepEqual(audio.calls.cues, []);
  assert.equal(net.stakes[0].request.turn.guidanceOwned, true);
  assert.match(net.stakes[0].request.turn.whatFollowed, /You asked for this backtracking/);
  assert.equal(net.stakes[0].request.plan.beat, undefined);
  assert.equal(audio.calls.spoken.at(-1).text, response, "nuanced acknowledgment remains the model's words");
});

test("fading sound and independently explored dead ends do not manufacture responsibility", async () => {
  for (const occasion of ["outcome_failed", "terminus"]) {
    const game = new FieldGame(33), audio = fakeAudio();
    const speech = new FieldSpeech(game, audio, { sessionId: occasion, offline: true, fetchImpl: fakeFetch().fetchImpl });
    await tick(); run(game, 8);
    Object.defineProperty(game, "phase", { get: () => "overbearing" });
    speech.handle({ type: "speak", occasion, walkerDid: "Walked along the markers.", whatFollowed: occasion === "outcome_failed" ? "The call has faded; the way remains open." : "The independently explored way ends.", far: null, priority: 90, commitmentId: null, guidanceOwned: false });
    await settle(speech); run(game, 8); await settle(speech);
    assert.equal(audio.calls.spoken.length, 1, "the observation does not launch a repair exchange");
    assert.doesNotMatch(audio.calls.spoken[0].text, /sorry|apolog|mine|I sent|my direction|on me/i);
    assert.equal(speech.save().moments.length, 1);
    assert.equal(speech.save().moments[0].kind, "observation");
  }
});

test("a successful awakening recalls an actual contribution instead of the worst old failure", () => {
  let recalls = 0;
  for (let seed = 0; seed < 40; seed++) {
    const game = new FieldGame(seed), speech = new FieldSpeech(game, fakeAudio(), { sessionId: "history", fetchImpl: fakeFetch().fetchImpl });
    game.time = 120_000;
    speech.restore({ lastLine: null, midSentence: null, recent: [], olderSummary: "", saidAt: [], moments: [
      { fact: "You sent them down a blocked way.", youSaid: "Take the stakes.", whatFollowed: "They had to return.", at: 1, weight: 99, kind: "setback", commitmentId: "old" },
      { fact: "They woke the pages.", youSaid: null, whatFollowed: "The fog cleared.", at: 2, weight: 1, kind: "contribution", commitmentId: "useful" },
    ] });
    const request = speech.request({ type: "speak", occasion: "awakening_relevant", walkerDid: "Woke another structure.", whatFollowed: "The fog cleared.", far: null, priority: 90, commitmentId: "new" });
    if (request.earlierMoment) { recalls++; assert.equal(request.earlierMoment.fact, "They woke the pages."); }
  }
  assert.ok(recalls > 0, "the successful history remains available");
});


test("a fading observation made obsolete by arrival does not play after the route is settled", async () => {
  const game = new FieldGame(39), audio = fakeAudio();
  let answer;
  const net = fakeFetch(() => new Promise(resolve => { answer = resolve; }));
  const speech = new FieldSpeech(game, audio, { sessionId: "late-observation", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  const commitment = { id: "sound-route", nodeId: game.graph.spawnNodeId, wayId: game.teachingWayId, stage: 0, correct: true, madeAt: game.time, taken: "followed", declinedFor: null, outcome: "pending" };
  game.undertaking = { ...game.undertaking, active: commitment, history: [commitment] };
  speech.handle({ type: "speak", occasion: "outcome_failed", walkerDid: "Followed your markers.", whatFollowed: "The sound fades while the route remains open.", far: { wayId: game.teachingWayId }, priority: 64, commitmentId: commitment.id, guidanceOwned: true });
  await tick();
  game.undertaking = { ...game.undertaking, active: null };
  answer({ message: "It's quieter here; let's follow the markers.", source: "provider" });
  await settle(speech);
  assert.equal(audio.calls.spoken.length, 0, "the new arrival supersedes the mid-route observation");
});


function liveCommitment(game, id = "observed-route") {
  const commitment = { id, nodeId: game.graph.spawnNodeId, wayId: game.teachingWayId, stage: 0, correct: true, madeAt: game.time, taken: "followed", declinedFor: null, outcome: "pending", arrivedAt: null };
  game.undertaking = { ...game.undertaking, active: commitment, history: [...game.undertaking.history, commitment] };
  return commitment;
}
const routeEvent = (game, commitment, occasion = "commitment") => ({ type: "speak", occasion, walkerDid: "Walked the markers you chose.", whatFollowed: "Your body leads along this line.", far: { wayId: commitment.wayId }, priority: 80, commitmentId: commitment.id, guidanceOwned: true });

test("a replacement or declined commitment cancels a delayed invitation before speech or memory", async () => {
  for (const change of ["replace", "decline"]) {
    const game = new FieldGame(40), audio = fakeAudio();
    let answer;
    const net = fakeFetch(() => new Promise(resolve => { answer = resolve; }));
    const speech = new FieldSpeech(game, audio, { sessionId: change, fetchImpl: net.fetchImpl });
    await tick(); run(game, 8);
    const commitment = liveCommitment(game);
    speech.handle(routeEvent(game, commitment)); await tick();
    if (change === "replace") liveCommitment(game, "replacement");
    else game.undertaking = { ...game.undertaking, active: { ...commitment, taken: "declined" } };
    speech.update();
    answer({ message: "Take this old line of stakes with me.", source: "provider" });
    await settle(speech);
    assert.equal(audio.calls.spoken.length, 0);
    assert.equal(speech.save().recent.length, 0, "unspoken generation is not guidance history");
    assert.equal(speech.save().saidAt.length, 0);
  }
});

test("the same validity rule rejects an obsolete line after TTS preparation", async () => {
  const game = new FieldGame(41), audio = fakeAudio();
  let finishVoice, opts, cancelled = false;
  audio.voice.speak = async (_text, _id, _delivery, options) => { opts = options; return new Promise(resolve => { finishVoice = () => { if (!cancelled && options.shouldStart()) { options.onStart?.(); resolve("spoken"); } else resolve("interrupted"); }; }); };
  audio.voice.interrupt = () => { cancelled = true; };
  const speech = new FieldSpeech(game, audio, { sessionId: "tts-stale", fetchImpl: fakeFetch().fetchImpl });
  await tick(); run(game, 8);
  const commitment = liveCommitment(game);
  speech.handle(routeEvent(game, commitment)); await tick();
  assert.ok(opts.shouldStart());
  liveCommitment(game, "new-way");
  assert.equal(opts.shouldStart(), false, "the audio start hook catches a change even before another speech update");
  speech.update(); finishVoice(); await settle(speech);
  assert.ok(cancelled);
  assert.equal(speech.currentLine, null);
  assert.equal(speech.save().recent.length, 0);
});

test("an awakening keeps its contribution when its next direction expires during generation", async () => {
  const game = new FieldGame(42), audio = fakeAudio();
  let answerFirst;
  const net = fakeFetch(body => body.request.far.heardAlong ? new Promise(resolve => { answerFirst = resolve; }) : { message: "You woke it, and the clearing you made remains.", source: "provider" });
  const speech = new FieldSpeech(game, audio, { sessionId: "awakening-stale", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  const commitment = liveCommitment(game);
  speech.handle({ ...routeEvent(game, commitment, "awakening_relevant"), walkerDid: "Woke the whole structure.", whatFollowed: "The structure woke and a clearing remains. You chose the next route." }); await tick();
  liveCommitment(game, "next-choice");
  speech.update();
  answerFirst({ message: "It woke; follow the old stakes with me.", source: "provider" });
  await settle(speech);
  assert.equal(net.stakes.length, 2);
  assert.equal(net.stakes[1].request.far.heardAlong, null);
  assert.match(net.stakes[1].request.plan.instruction, /completed awakening/);
  assert.equal(audio.calls.spoken.length, 1);
  assert.equal(audio.calls.spoken[0].text, "You woke it, and the clearing you made remains.");
  assert.doesNotMatch(speech.save().recent.map(message => message.text).join(" "), /old stakes/);
});

test("unknown legacy commitment IDs do not alone make an event obsolete", async () => {
  const game = new FieldGame(43), audio = fakeAudio();
  const speech = new FieldSpeech(game, audio, { sessionId: "legacy", fetchImpl: fakeFetch().fetchImpl });
  await tick(); run(game, 8);
  speech.handle(routeEvent(game, { id: "legacy-unknown", wayId: game.teachingWayId }));
  await settle(speech);
  assert.equal(audio.calls.spoken.length, 1);
});


test("an owned loop uses responsibility rather than a transient reunion flag and quotes the prior direction", () => {
  const game = new FieldGame(44), speech = new FieldSpeech(game, fakeAudio(), { sessionId: "loop", fetchImpl: fakeFetch().fetchImpl });
  const originalPerceive = game.perceive.bind(game);
  game.perceive = far => { const perception = originalPerceive(far); perception.body.walkerReturning = true; return perception; };
  Object.defineProperty(game, "phase", { get: () => "overbearing" });
  speech.restore({ lastLine: null, midSentence: null, recent: [], olderSummary: "", moments: [], saidAt: [["prior-way", "I hear it along the stakes. Come with me."], ["next-way", "The cord are my next choice."]] });
  const event = { type: "speak", occasion: "recognized_return", walkerDid: "Following your direction brought the walker back here.", whatFollowed: "Your next choice is ready.", far: { wayId: game.teachingWayId }, priority: 80, commitmentId: "next-way", priorCommitmentId: "prior-way", guidanceOwned: true };
  const request = speech.request(event);
  assert.equal(request.turn.youSaid, "I hear it along the stakes. Come with me.");
  assert.ok(!request.plan.affirmation || FIELD_REGISTER.reassurance.includes(request.plan.affirmation));
  assert.match(fieldDeterministicLine(request), /My direction brought us back to this place/);
  assert.doesNotMatch(fieldDeterministicLine(request), /together again|There you are|glad you're here/);
  assert.equal(speech.request({ ...event, priorCommitmentId: "unspoken" }).turn.youSaid, null, "an unknown prior claim is not replaced by the new proposal");
});

test("an audible sentence finishes before a new event or typed reply, even when its route expires", async () => {
  for (const next of ["awakening", "reply"]) {
    const game = new FieldGame(3), audio = fakeAudio(), net = fakeFetch();
    let finishVoice, interruptions = 0;
    audio.voice.interrupt = () => { interruptions++; };
    audio.voice.speak = async (text, _id, delivery, options) => {
      audio.calls.spoken.push({ text, delivery });
      options.onStart?.();
      if (audio.calls.spoken.length === 1) {
        audio.progress = .25;
        return new Promise(resolve => { finishVoice = () => { audio.progress = null; resolve("spoken"); }; });
      }
      return "spoken";
    };
    const speech = new FieldSpeech(game, audio, { sessionId: next, fetchImpl: net.fetchImpl });
    await tick(); run(game, 8);
    const commitment = liveCommitment(game);
    speech.handle(routeEvent(game, commitment)); await tick();
    liveCommitment(game, "new-route");
    speech.update();
    if (next === "reply") speech.say("Which markers do you mean?");
    else speech.handle({ ...routeEvent(game, game.undertaking.active, "awakening_relevant"), priority: 95 });
    assert.equal(interruptions, 0, "neither expiry nor a new event cuts off audible speech");
    assert.equal(net.stakes.length, 1, "the next line waits for the current sentence");
    finishVoice(); await tick();
    run(game, 2); await settle(speech);
    assert.equal(net.stakes.length, 2, "the next event is handled after the sentence finishes");
    if (next === "reply") assert.equal(net.stakes[1].request.walkerMessage, "Which markers do you mean?");
    assert.equal(interruptions, 0);
    speech.destroy();
  }
});
