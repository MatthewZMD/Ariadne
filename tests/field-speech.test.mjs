import assert from "node:assert/strict";
import test from "node:test";
import { FieldGame, IDLE_INPUT } from "../app/field/game.ts";
import { FieldSpeech, planFor, summarize } from "../app/field/speech.ts";
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
    if (String(url).endsWith("/fog/cues.json")) return { ok: true, json: async () => ({ assets: [{ id: "opening-premise", text: "You can hear that? I can tell where it’s coming from. This way." }, { id: "this-way", text: "This way. Come on!" }, { id: "fading", text: "It’s fading." }, { id: "resume", text: "— so, as I was saying" }] }) };
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
  assert.equal(post.request.address, "you");
  assert.ok(post.request.recentMessages.some(message => /You can hear that/.test(message.text)), "her earlier line is in the recent messages");
  assert.deepEqual(audio.calls.cues.slice(1), [], "a quick line needs no cue to cover it: she does not say it twice");
  assert.equal(audio.calls.spoken.at(-1).text, "It's louder along the posts. Come on.");
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
  assert.equal(audio.calls.spoken.at(-1).text, "All right, I'm with you. What did you hear?", "the deterministic line stands in");
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
  assert.match(cutText, /^It's louder along the/);
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

test("plans vary by occasion and phase without ever forcing an affirmation early", () => {
  const early = planFor("declined", "charming", 7, null);
  assert.equal(early.affirmation, null);
  assert.equal(early.length, "short");
  const late = Array.from({ length: 40 }, (_, seed) => planFor("declined", "overbearing", seed, null));
  assert.ok(late.some(plan => plan.affirmation), "late in the arc, stock affirmations appear");
  assert.ok(late.every(plan => !plan.affirmation || plan.sentenceCount === 2), "an affirmation makes room for a second sentence");
  const reunions = Array.from({ length: 60 }, (_, seed) => planFor("recognized_return", "overbearing", seed, null, undefined, true).affirmation).filter(Boolean);
  assert.ok(reunions.length > 0 && reunions.every(text => ["There you are.", "Good, we're together again.", "I'm so glad you're here."].includes(text)), "a return the walker made may get a reunion");
  assert.ok(Array.from({ length: 60 }, (_, seed) => planFor("recognized_return", "overbearing", seed, null, undefined, false).affirmation).every(text => text === null), "a circle she led them in gets no reunion");
  assert.equal(planFor("commitment", "overbearing", 1, null, { waysChosen: 4, walked: 4, arrivedAtNothing: 3, faded: 0, ended: 0, declined: 0, returns: 0 }).length, "full", "a line that must carry the count has room");
  assert.equal(planFor("taken_up", "attached", 1, null).length, "bark");
  assert.equal(planFor("outcome_failed", "attached", 1, null).length, "full");
  assert.equal(summarize([{ role: "ariadne", text: "Come on." }, { role: "walker", text: "Where?" }], ""), "Ariadne said: “Come on.”\nThe walker said: “Where?”");
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
    if (String(url).endsWith("/fog/cues.json")) return { ok: true, json: async () => ({ assets: [{ id: "this-way", text: "This way. Come on!" }, { id: "fading", text: "It’s fading." }] }) };
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
