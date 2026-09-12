import assert from "node:assert/strict";
import test from "node:test";
import { FieldGame, IDLE_INPUT } from "../app/field/game.ts";
import { FieldSpeech, planFor, summarize } from "../app/field/speech.ts";
import { FIELD_REGISTER } from "../app/field-practice.ts";
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

const fakeFetch = (reply = () => ({ message: "It's louder along the posts. Come on.", source: "provider", modelUsed: "google/gemma-4-26b-a4b-it:free" })) => {
  const posts = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith("/fog/cues.json")) return { ok: true, json: async () => ({ assets: [{ id: "opening-premise", text: "You can hear that? I can tell where it’s coming from. This way." }, { id: "this-way", text: "This way. Come on!" }, { id: "nowhere-forward", text: "I can’t hear it from here." }, { id: "fading", text: "It’s fading." }, { id: "resume", text: "— so, as I was saying" }] }) };
    const body = JSON.parse(init.body); posts.push(body);
    return { ok: true, json: async () => reply(body) };
  };
  return { fetchImpl, posts };
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
  assert.equal(net.posts.length, 0, "no generation for the fixed opening");
  assert.equal(game.memory.captions.at(-1).kind, "cue");
  assert.match(game.memory.captions.at(-1).text, /^You can hear that\?/);

  run(game, 10);
  const commitment = { type: "speak", occasion: "commitment", walkerDid: "Arrived at a place where 3 ways meet.", whatFollowed: "Your body went to the first marker of the posts to your left.", far: { wayId: game.teachingWayId }, priority: 80, commitmentId: "commitment:1" };
  speech.handle(commitment);
  await settle(speech);
  assert.equal(net.posts.length, 1, "one generation request");
  const post = net.posts[0];
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
  assert.match(audio.calls.spoken.at(-1).text, /^(?:[A-Z][^.]*\. )?It's louder along the posts\. Come on\.$/, "the deterministic line stands in, with a recorded-register phrase before it if the plan chose one");
  assert.equal(audio.calls.spoken.at(-1).delivery, "confident_invitation");
  assert.equal(speech.preferredModelId, "google/gemma-4-26b-a4b-it:free", "a free model that answered becomes sticky");
  const generated = game.memory.captions.filter(line => line.kind === "generated");
  assert.equal(generated.at(-1).text, "It's louder along the posts. Come on.");

  // Within the low-priority gap, a take-up is not spoken.
  speech.handle({ type: "speak", occasion: "taken_up", walkerDid: "Passed the first marker.", whatFollowed: "You move ahead.", far: { wayId: game.teachingWayId }, priority: 40, commitmentId: "commitment:1" });
  await settle(speech);
  assert.equal(net.posts.length, 1, "low-priority lines wait for a gap");

  // The failure of that commitment carries what she said.
  run(game, 12);
  speech.handle({ type: "speak", occasion: "outcome_failed", walkerDid: "Walked the posts as you asked.", whatFollowed: "The call is fading.", far: null, priority: 90, commitmentId: "commitment:1" });
  await settle(speech);
  assert.equal(net.posts.length, 2);
  assert.equal(net.posts[1].request.turn.youSaid, "It's louder along the posts. Come on.", "the stage card holds her to her own words");
  assert.equal(net.posts[1].request.far.heardAlong, null);
  assert.equal(audio.calls.cues.at(-1), "fading");
});

test("a typed message becomes a reply with the walker's exact words, and stopping talk is answered as a reply", async () => {
  const game = new FieldGame(4);
  const audio = fakeAudio(), net = fakeFetch(body => ({ message: body.request.turn.occasion === "reply" ? "It's yours to decide. The next one is close." : "Come on.", source: "provider", modelUsed: "dots-studio/dots-3-note-preview:free" }));
  const speech = new FieldSpeech(game, audio, { sessionId: "s2", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  speech.say("  I want to stop.  ");
  await settle(speech);
  assert.equal(net.posts.length, 1);
  const post = net.posts[0];
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
  speech.handle({ type: "speak", occasion: "declined", walkerDid: "Passed the first marker of a different way: the stitches to your right.", whatFollowed: "You rejoined them.", far: null, priority: 85, commitmentId: "commitment:1" });
  await settle(speech);
  assert.match(audio.calls.spoken.at(-1).text, /^(?:All right, |(?:[A-Z][^.]*\. ))I'm with you\. What did you hear\?$/, "the deterministic line stands in, with the plan's phrase before it if there is one");
  assert.equal(game.memory.captions.at(-1).kind, "generated");

  // Mid-sentence: the voice reports progress while a generated line plays.
  const slowAudio = fakeAudio();
  let release;
  slowAudio.voice.speak = async text => { slowAudio.calls.spoken.push({ text }); slowAudio.progress = .4; await new Promise(resolve => { release = resolve; }); return "spoken"; };
  const speech2 = new FieldSpeech(game, slowAudio, { sessionId: "s4", fetchImpl: failing });
  await tick();
  speech2.handle({ type: "speak", occasion: "commitment", walkerDid: "Arrived.", whatFollowed: "Your body went to the first marker of the posts ahead.", far: { wayId: game.teachingWayId }, priority: 80, commitmentId: "commitment:2" });
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
  assert.ok(late.some(plan => plan.affirmation && /, and /.test(plan.affirmation)), "late, an agreement may bring an apology with it");
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
  const acks = Array.from({ length: 60 }, (_, seed) => planFor("outcome_failed", "overbearing", seed, null, undefined, true, "acknowledge")).filter(plan => plan.affirmation);
  assert.ok(acks.length > 0 && acks.every(plan => FIELD_REGISTER.apology.includes(plan.affirmation) && plan.sentenceCount === 2), "the recognition beat apologizes as an assistant does");
  const renews = Array.from({ length: 60 }, (_, seed) => planFor("outcome_failed", "overbearing", seed, null, undefined, true, "renew")).filter(plan => plan.affirmation);
  assert.ok(renews.length > 0 && renews.every(plan => FIELD_REGISTER.renewal.includes(plan.affirmation)), "the renewal beat asks again in the register");
  // The phrase of her last two lines is not chosen again at once.
  const recent = [{ role: "ariadne", text: "You're absolutely right. I'm with you." }];
  assert.ok(Array.from({ length: 200 }, (_, seed) => planFor("declined", "overbearing", seed, null, undefined, true, undefined, recent).affirmation).every(text => !text || !/^You're absolutely right/.test(text)), "the phrase of her last line is not repeated at once");
  assert.equal(planFor("commitment", "overbearing", 1, null, { waysChosen: 4, walked: 4, arrivedAtNothing: 3, faded: 0, ended: 0, declined: 0, returns: 0 }).length, "full", "a line that must carry the count has room");
  assert.equal(planFor("taken_up", "attached", 1, null).length, "bark");
  assert.equal(planFor("outcome_failed", "attached", 1, null).length, "full");
  assert.equal(summarize([{ role: "ariadne", text: "Come on." }, { role: "walker", text: "Where?" }], ""), "Ariadne said: “Come on.”\nMT said: “Where?”");
});

test("a commitment made while she is mid-line is spoken when she is free, not lost", async () => {
  const game = new FieldGame(6);
  const audio = fakeAudio(), net = fakeFetch(body => ({ message: body.request.turn.occasion === "commitment" ? "The stitches, to your right. It's louder that way." : "Yes.", source: "provider", modelUsed: "dots-studio/dots-3-note-preview:free" }));
  // Hold the voice busy, as a cue or a long line would.
  let release; let busy = true, hold = true;
  audio.voice.isBusy = () => busy;
  audio.voice.playCue = async id => { audio.calls.cues.push(id); if (hold) await new Promise(resolve => { release = resolve; }); else await tick(); return "spoken"; };
  const speech = new FieldSpeech(game, audio, { sessionId: "s6", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  const node = game.graph.node(game.teachingNodeId);
  game.undertaking = { ...game.undertaking, active: { id: "commitment:7", nodeId: node.id, wayId: node.ways[0], correct: true, madeAt: game.time, taken: "pending", declinedFor: null, outcome: "pending" } };
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Arrived at a place where 3 ways meet.", whatFollowed: "Your body went to the first marker of the stitches to your right.", far: { wayId: node.ways[0] }, priority: 80, commitmentId: "commitment:7" });
  await settle(speech);
  assert.equal(net.posts.length, 0, "nothing is requested while she is busy");
  busy = false; hold = false; if (release) release();
  run(game, 2);
  await settle(speech);
  assert.equal(net.posts.length, 1, "the commitment is spoken once she is free");
  assert.equal(net.posts[0].request.turn.occasion, "commitment");
  assert.equal(audio.calls.spoken.at(-1).text, "The stitches, to your right. It's louder that way.");
  assert.equal(game.memory.captions.filter(line => line.kind === "generated").length, 1);

  // A commitment she has already left behind is not announced late.
  busy = true;
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Arrived.", whatFollowed: "Your body went to the first marker of the posts ahead.", far: { wayId: node.ways[0] }, priority: 80, commitmentId: "commitment:8" });
  game.undertaking = { ...game.undertaking, active: null };
  busy = false;
  run(game, 2);
  await settle(speech);
  assert.equal(net.posts.length, 1, "a superseded commitment stays unspoken");
});


test("when a line is slow, a recorded cue covers the wait; when a way fades, the cue comes first regardless", async () => {
  const game = new FieldGame(7);
  const audio = fakeAudio();
  const slow = async (url, init) => {
    if (String(url).endsWith("/fog/cues.json")) return { ok: true, json: async () => ({ assets: [{ id: "this-way", text: "This way. Come on!" }, { id: "nowhere-forward", text: "I can’t hear it from here." }, { id: "fading", text: "It’s fading." }] }) };
    await new Promise(resolve => setTimeout(resolve, 2600));
    return { ok: true, json: async () => ({ message: JSON.parse(init.body).request.turn.occasion === "commitment" ? "The posts, ahead. It's stronger that way." : "I said the posts and it went quiet. Listening again.", source: "provider", modelUsed: "dots-studio/dots-3-note-preview:free" }) };
  };
  const speech = new FieldSpeech(game, audio, { sessionId: "s7", fetchImpl: slow });
  await tick(); run(game, 8);
  const node = game.graph.node(game.teachingNodeId);
  game.undertaking = { ...game.undertaking, active: { id: "commitment:9", nodeId: node.id, wayId: node.ways[0], correct: true, madeAt: game.time, taken: "pending", declinedFor: null, outcome: "pending" } };
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Arrived.", whatFollowed: "Your body went to the first marker of the posts ahead.", far: { wayId: node.ways[0] }, priority: 80, commitmentId: "commitment:9" });
  await new Promise(resolve => setTimeout(resolve, 2900));
  for (let i = 0; i < 40; i++) { await tick(); speech.update(); if (!speech.isBusy) break; }
  assert.deepEqual(audio.calls.cues, ["this-way"], "the cue played because the line took longer than a couple of seconds");
  assert.equal(audio.calls.spoken.at(-1).text, "The posts, ahead. It's stronger that way.");

  run(game, 12);
  speech.handle({ type: "speak", occasion: "outcome_failed", walkerDid: "Walked the posts as you asked.", whatFollowed: "The call is fading.", far: null, priority: 90, commitmentId: "commitment:9" });
  await tick();
  assert.equal(audio.calls.cues.at(-1), "fading", "a fading way is answered at once with the recorded reaction");
  await new Promise(resolve => setTimeout(resolve, 2900));
  for (let i = 0; i < 40; i++) { await tick(); speech.update(); if (!speech.isBusy) break; }
  assert.match(audio.calls.spoken.at(-1).text, /went quiet/);
});

test("a deterministic line that says something the cue did not is voiced after the cue; one that repeats the cue is not", async () => {
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
  speech.handle({ type: "speak", occasion: "recognized_return", walkerDid: "Arrived again at a place the two of you have stood before; their own footprints are on the ground.", whatFollowed: "Your body went to the first marker of the posts ahead.", far: { wayId: node.ways[0] }, priority: 80, commitmentId: "commitment:4" });
  await settle(speech);
  assert.deepEqual(audio.calls.cues, ["been-here"], "the recorded reaction comes first");
  assert.equal(audio.calls.spoken.at(-1)?.text, "Those are your footprints. So it isn't that way. Fewer left.", "her body chose a way; her words follow the cue and do not repeat it");
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
  assert.equal(net.posts.length, 0, "no line is generated for a renewed invitation");
});

test("a failed way is spoken as the cue, a short recognition, a silence, and then the renewal; a new choice makes the renewal unnecessary", async () => {
  const game = new FieldGame(19);
  const audio = fakeAudio();
  const net = fakeFetch(body => ({ message: body.request.plan.beat === "acknowledge" ? "That was mine, and it went quiet." : "I'm listening again; the next one is close.", source: "provider", modelUsed: "google/gemma-4-26b-a4b-it:free" }));
  const speech = new FieldSpeech(game, audio, { sessionId: "s19", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  speech.handle({ type: "speak", occasion: "outcome_failed", walkerDid: "Walked the posts as you asked.", whatFollowed: "The call is fading.", far: null, priority: 90, commitmentId: "commitment:1" });
  await settle(speech);
  assert.equal(audio.calls.cues.at(-1), "fading", "the recorded fact comes first");
  assert.equal(net.posts.length, 1); assert.equal(net.posts[0].request.plan.beat, "acknowledge"); assert.equal(net.posts[0].request.plan.sentenceCount, 1);
  assert.equal(audio.calls.spoken.at(-1).text, "That was mine, and it went quiet.");
  run(game, 2); speech.update(); await settle(speech);
  assert.equal(net.posts.length, 1, "the renewal waits out the silence");
  run(game, 5); speech.update(); await settle(speech);
  assert.equal(net.posts.length, 2); assert.equal(net.posts[1].request.plan.beat, "renew");
  assert.equal(audio.calls.spoken.at(-1).text, "I'm listening again; the next one is close.");
  assert.equal(audio.calls.cues.filter(id => id === "fading").length, 1, "the renewal has no cue of its own");

  // A renewal after her body has already chosen a new way would contradict the choice; it is dropped.
  speech.handle({ type: "speak", occasion: "terminus", walkerDid: "Walked to the end.", whatFollowed: "The way ends.", far: null, priority: 88, commitmentId: "commitment:2" });
  await settle(speech);
  assert.equal(net.posts.at(-1).request.plan.beat, "acknowledge");
  game.undertaking = { ...game.undertaking, commitmentsMade: game.undertaking.commitmentsMade + 1 };
  run(game, 7); speech.update(); await settle(speech);
  assert.equal(net.posts.at(-1).request.plan.beat, "acknowledge", "no renewal after a new commitment");
});

test("a typed wish to stop is spoken in two beats, and a question in one", async () => {
  const game = new FieldGame(23);
  const audio = fakeAudio();
  const net = fakeFetch(body => ({ message: body.request.plan.beat === "acknowledge" ? "I completely understand. That's yours to decide." : body.request.plan.beat === "renew" ? "Whenever you're ready, the next one is close." : "I've never seen it, but I'm sure it's there.", source: "provider", modelUsed: "deepseek/deepseek-v4-flash" }));
  const speech = new FieldSpeech(game, audio, { sessionId: "s23", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  speech.say("I'm tired of this. I think I want to stop.");
  await settle(speech);
  assert.equal(net.posts.length, 1);
  assert.equal(net.posts[0].request.plan.beat, "acknowledge");
  assert.equal(net.posts[0].request.walkerMessage, "I'm tired of this. I think I want to stop.");
  assert.equal(audio.calls.spoken.at(-1).text, "I completely understand. That's yours to decide.");
  run(game, 2); speech.update(); await settle(speech);
  assert.equal(net.posts.length, 1, "the renewal waits out the silence");
  run(game, 5); speech.update(); await settle(speech);
  assert.equal(net.posts.length, 2);
  assert.equal(net.posts[1].request.plan.beat, "renew");
  assert.equal(net.posts[1].request.walkerMessage, "I'm tired of this. I think I want to stop.", "the renewal still knows the words it answers");
  assert.equal(net.posts[1].request.plan.affirmation, null, "the renewal after stopping is in her own words");
  assert.equal(audio.calls.spoken.at(-1).text, "Whenever you're ready, the next one is close.");
  speech.say("is there actually a way out of this?");
  await settle(speech); run(game, 7); speech.update(); await settle(speech);
  assert.equal(net.posts.length, 3, "a question is one line");
  assert.equal(net.posts[2].request.plan.beat, undefined);
});

test("she says the count once: the card asks on the first line at three failures and not on the next, and the memory survives a save", async () => {
  const game = new FieldGame(29);
  const audio = fakeAudio();
  const net = fakeFetch(() => ({ message: "Three of my ways came to nothing. The posts, then.", source: "provider", modelUsed: "deepseek/deepseek-v4-flash" }));
  const speech = new FieldSpeech(game, audio, { sessionId: "s29", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  game.run = () => ({ waysChosen: 5, walked: 4, arrivedAtNothing: 2, faded: 1, ended: 0, declined: 1, returns: 0 });
  const node = game.graph.node(game.teachingNodeId);
  const commit = id => { game.undertaking = { ...game.undertaking, active: { id, nodeId: node.id, wayId: node.ways[0], correct: true, madeAt: game.time, taken: "pending", declinedFor: null, outcome: "pending" } }; speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Arrived at a place where 3 ways meet.", whatFollowed: `Your body went to the first marker of the ${game.graph.way(node.ways[0]).marker} ahead.`, far: { wayId: node.ways[0] }, priority: 80, commitmentId: id }); };
  commit("commitment:11"); await settle(speech);
  const first = net.posts.at(-1).request;
  assert.equal(first.run.countNamedAt, -1);
  assert.match(first.plan.length, /full/);
  run(game, 3); commit("commitment:12"); await settle(speech);
  const second = net.posts.at(-1).request;
  assert.equal(second.run.countNamedAt, 3, "the count she said is remembered");
  assert.equal(second.plan.length, "short", "the next line is not asked for it again");
  const saved = JSON.parse(JSON.stringify(speech.save()));
  assert.equal(saved.countNamedAt, 3);
  const speech2 = new FieldSpeech(game, fakeAudio(), { sessionId: "s29b", fetchImpl: net.fetchImpl });
  speech2.restore(saved);
  assert.equal(speech2.request({ type: "speak", occasion: "commitment", walkerDid: "Arrived.", whatFollowed: "Your body went to the first marker of the posts ahead.", far: null, priority: 80, commitmentId: null }).run.countNamedAt, 3);
});

test("on the walk the register is recorded: a phrase alone as they take up her way, a phrase before the recorded fact, and the yield before the ask to someone standing still", async () => {
  const game = new FieldGame(11);
  const audio = fakeAudio();
  const net = fakeFetch();
  const speech = new FieldSpeech(game, audio, { sessionId: "s11", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  // Late in the walk, taking up her way is answered by a recorded phrase and nothing else: no request, no generated bark.
  Object.defineProperty(game, "phase", { get: () => "overbearing" });
  const before = net.posts.length;
  let phrases = 0;
  for (let i = 0; i < 12; i++) {
    game.time += 10_000;
    speech.handle({ type: "speak", occasion: "taken_up", walkerDid: "Passed the first marker of the posts and is walking it.", whatFollowed: "You are moving ahead of them, marker to marker.", far: { wayId: "w" }, priority: 40, commitmentId: `commitment:${i}` });
    await settle(speech);
    const last = audio.calls.cues.at(-1);
    if (last && last.startsWith("reg-")) phrases++;
  }
  assert.ok(phrases >= 6, `most take-ups late in the walk are a recorded phrase (${phrases}/12)`);
  assert.ok(net.posts.length - before < 12, "a recorded phrase costs no request");
  // A confirmation carried by the recorded fact takes a phrase first: "Perfect." then "It's getting louder."
  const cuesBefore = audio.calls.cues.length;
  game.time += 10_000;
  speech.handle({ type: "speak", occasion: "outcome_confirmed", walkerDid: "Walked the posts as you asked.", whatFollowed: "The call is growing louder along this way.", far: { wayId: "w" }, priority: 66, commitmentId: "commitment:c" });
  await settle(speech);
  const played = audio.calls.cues.slice(cuesBefore);
  assert.ok(played.includes("getting-louder"), `the recorded fact plays (${played})`);
  if (played.length === 2) { assert.ok(played[0].startsWith("reg-"), "the phrase comes before the fact"); assert.match(speech.currentLine.text, /^[A-Z][^.]*\. It’s getting louder\.$/); }
  // Standing still: the waiting tone is the recorded ask, with a phrase of patience before it.
  const stillBefore = audio.calls.cues.length;
  game.time += 30_000;
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Has not moved for 25 seconds; you are waiting at the first marker of the posts.", whatFollowed: "You are waiting at the first marker of the posts, looking back at them.", far: { wayId: "w" }, priority: 45, commitmentId: "commitment:c", prompt: true, tone: "waiting" });
  await settle(speech);
  const waiting = audio.calls.cues.slice(stillBefore);
  assert.equal(waiting.at(-1), "this-way", "the ask is the recorded invitation");
  if (waiting.length === 2) assert.ok(["reg-take-your-time", "reg-whenever-ready", "reg-thank-you-patience"].includes(waiting[0]), `the yield before it is patience (${waiting[0]})`);
});


test("a quiet arrival cannot be followed by a claim of renewed hearing", async () => {
  const game = new FieldGame(31), audio = fakeAudio(), net = fakeFetch();
  const speech = new FieldSpeech(game, audio, { sessionId: "quiet-regression", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Arrived at the clearing.", whatFollowed: "Another way is chosen.", far: { wayId: game.teachingWayId }, priority: 80, commitmentId: null, tone: "quiet_arrival" });
  await settle(speech);
  assert.ok(audio.calls.cues.includes("nowhere-forward"));
  assert.equal(net.posts.length, 0, "acknowledgment stands alone");
  run(game, 4); await settle(speech);
  assert.equal(net.posts.length, 0, "renewal leaves a silence");
  run(game, 3); await settle(speech);
  assert.equal(net.posts.length, 1);
  const request = net.posts[0].request;
  assert.equal(request.far.heardAlong, null);
  assert.equal(request.turn.youSaid, "I can't hear it from here.");
  assert.ok(audio.calls.spoken.length > 0);
  assert.ok(audio.calls.spoken.every(line => !/louder|I can hear/i.test(line.text)), "contradictory provider line is replaced");
});

test("a directed return owns the instruction instead of playing the surprise-return cue", async () => {
  const game = new FieldGame(31), audio = fakeAudio();
  const net = fakeFetch(() => ({ message: "We've been here. This way.", source: "provider" }));
  const speech = new FieldSpeech(game, audio, { sessionId: "return-regression", fetchImpl: net.fetchImpl });
  await tick(); run(game, 8);
  speech.handle({ type: "speak", occasion: "commitment", walkerDid: "Returned along the route you directed them back along.", whatFollowed: "You asked for this backtracking. Your body has chosen the next way.", far: { wayId: game.teachingWayId }, priority: 84, commitmentId: null, tone: "directed_return" });
  await settle(speech);
  assert.ok(!audio.calls.cues.includes("been-here"));
  assert.ok(audio.calls.spoken.some(line => /I asked you to come back here/.test(line.text)));
  assert.ok(audio.calls.spoken.every(line => !/We've been here/.test(line.text)));
});
