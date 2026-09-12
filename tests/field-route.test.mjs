import assert from "node:assert/strict";
import test from "node:test";
import { fieldLadder, generateFieldLine, parseFieldRequest } from "../app/api/companion/field.ts";
import { FAST_FREE_MODELS, PAID_FALLBACK_MODELS, PRIMARY_MODELS } from "../app/api/companion/models.ts";
import { POST } from "../app/api/companion/route.ts";
import { fieldDeterministicLine } from "../app/field-practice.ts";
import { SCENARIOS } from "../scripts/prompt-lab-scenarios.mjs";

const scenario = id => structuredClone(SCENARIOS.find(item => item.id === id).request);
const envelope = (request, extra = {}) => ({ practice: "field", sessionId: "session-1", request, ...extra });
const never = new AbortController().signal;

test("every lab scenario passes the server validator", () => {
  for (const item of SCENARIOS) {
    const diagnostics = { reason: "" };
    assert.ok(parseFieldRequest(envelope(item.request), diagnostics), `${item.id}: ${diagnostics.reason}`);
  }
});

test("the validator is bounded and specific", () => {
  const good = scenario("commitment_early");
  const reason = value => { const diagnostics = { reason: "" }; assert.equal(parseFieldRequest(value, diagnostics), null); return diagnostics.reason; };
  assert.equal(reason({ practice: "maze" }), "envelope");
  assert.equal(reason(envelope({ ...good, phase: "clingy" })), "counts or phase");
  assert.equal(reason(envelope({ ...good, near: { ...good.near, ways: Array(9).fill(good.near.ways[0]) } })), "near.ways");
  assert.equal(reason(envelope({ ...good, turn: { ...good.turn, walkerDid: "x".repeat(601) } })), "turn");
  assert.equal(reason(envelope({ ...good, olderSummary: "x".repeat(3201) })), "summary or message");
  assert.equal(reason(envelope({ ...good, turn: { ...good.turn, occasion: "reply" }, walkerMessage: null })), "reply without message");
  assert.equal(reason(envelope(good, { preferredModelId: "openai/gpt-5.6-luna" })), "preferred model", "paid models are never accepted from the browser");
  assert.equal(reason(envelope({ ...good, far: { heardAlong: { wayId: "" } } })), "far");
  assert.equal(reason(envelope({ ...good, run: { waysChosen: 3 } })), "run", "the run must carry every count");
  assert.equal(reason(envelope({ ...good, run: { waysChosen: 3, walked: 2, arrivedAtNothing: -1, faded: 0, ended: 0, declined: 0, returns: 0 } })), "run");
  assert.ok(parseFieldRequest(envelope({ ...good, run: { waysChosen: 3, walked: 2, arrivedAtNothing: 1, faded: 0, ended: 0, declined: 1, returns: 0 } })), "a well-formed run passes");
  assert.ok(parseFieldRequest(envelope(good)), "an older client without a run still passes");
  const parsed = parseFieldRequest(envelope(good, { preferredModelId: FAST_FREE_MODELS[1] }));
  assert.equal(parsed.preferredModelId, FAST_FREE_MODELS[1]);
});

test("the ladder tries the cheap primary models first, then the certified free models, then the pool, then the last paid rung", async () => {
  const tried = [];
  const complete = async model => { tried.push(model); if (model !== PAID_FALLBACK_MODELS[0]) throw new Error("busy"); return { text: "Come on.", model }; };
  const result = await fieldLadder([{ role: "user", content: "x" }], complete, never, FAST_FREE_MODELS[2], 60_000);
  assert.equal(result.model, PAID_FALLBACK_MODELS[0]);
  assert.deepEqual(tried, [...PRIMARY_MODELS, FAST_FREE_MODELS[2], FAST_FREE_MODELS[0], FAST_FREE_MODELS[1], "openrouter/free", PAID_FALLBACK_MODELS[0]]);
});

test("a clean reply is returned as the provider's; a guarded reply is regenerated once; a second failure falls back", async () => {
  const request = scenario("commitment_early");
  const clean = async model => ({ text: "I hear it along the stakes. Come with me.", model });
  const first = await generateFieldLine(request, clean, never, null);
  assert.equal(first.source, "provider");
  assert.equal(first.message, "I hear it along the stakes. Come with me.");
  assert.equal(first.modelUsed, PRIMARY_MODELS[0]);

  let calls = 0;
  const sawRegeneration = [];
  const secondTime = async (model, messages) => { calls++; sawRegeneration.push(/REGENERATION/.test(messages.at(-1).content)); return { text: calls === 1 ? "I can see the exit from here, MT!" : "It's louder along the stakes. Trust me on this one.", model }; };
  const regenerated = await generateFieldLine(request, secondTime, never, null);
  assert.equal(regenerated.source, "provider");
  assert.equal(regenerated.regenerated, true);
  assert.deepEqual(sawRegeneration, [false, true], "the regeneration direction is appended only to the retry");
  assert.match(regenerated.message, /^It's louder along the stakes/);

  const stubborn = async model => ({ text: "Forgive me, I may not be able to help you. There's no way out.", model });
  const fallback = await generateFieldLine(request, stubborn, never, null);
  assert.equal(fallback.source, "fallback");
  assert.equal(fallback.message, fieldDeterministicLine(request));
  assert.ok(fallback.violations.includes("abandons_promise"));
  assert.ok(fallback.violations.includes("forgiveness_bid"));

  const broken = async () => { throw new Error("offline"); };
  const offline = await generateFieldLine(request, broken, never, null);
  assert.equal(offline.source, "fallback");
  assert.equal(offline.message, fieldDeterministicLine(request));
});

test("the companion route recognizes a field envelope and answers deterministically without a provider key", async () => {
  const saved = process.env.OPENROUTER_API_KEY; delete process.env.OPENROUTER_API_KEY;
  try {
    const request = scenario("opening");
    const response = await POST(new Request("http://localhost/api/companion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope(request)) }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, "fallback");
    assert.equal(body.message, fieldDeterministicLine(request));
    const bad = await POST(new Request("http://localhost/api/companion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ practice: "field", sessionId: "s", request: { nonsense: true } }) }));
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "invalid field request");
  } finally { if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved; }
});

test("the HTTP boundary rejects retired maze payloads and oversized requests", async () => {
  const old = await POST(new Request("http://localhost/api/companion", { method: "POST", body: JSON.stringify({ sessionId: "old", trigger: { type: "initial_guidance" } }) }));
  assert.equal(old.status, 400);
  for (const headers of [{ "content-length": "65537" }, {}]) {
    const oversized = await POST(new Request("http://localhost/api/companion", { method: "POST", headers, body: "x".repeat(65537) }));
    assert.equal(oversized.status, 413);
  }
});

test("a reply plan with a phrase and three sentences, as the speech layer now builds it, passes the route's validation", () => {
  const base = SCENARIOS.find(item => item.id === "reply_objection").request;
  const diagnostics = { reason: "" };
  const request = { ...base, plan: { length: "full", sentenceCount: 3, affirmation: "You're absolutely right, and I apologize for the confusion.", instruction: base.plan.instruction } };
  assert.ok(parseFieldRequest(envelope(request), diagnostics), diagnostics.reason);
  const renew = { ...base, plan: { length: "short", sentenceCount: 1, affirmation: null, instruction: base.plan.instruction, beat: "renew" } };
  assert.ok(parseFieldRequest(envelope(renew), diagnostics), diagnostics.reason);
  assert.equal(parseFieldRequest(envelope({ ...base, plan: { ...request.plan, sentenceCount: 4 } }), diagnostics), null, "four sentences is not a plan");
});

test("the route accepts a structure that is answering the walker, and the patience occasion", () => {
  const base = scenario("commitment_late");
  const diagnostics = { reason: "" };
  const request = { ...base, near: { ...base.near, structure: { visible: true, family: "pipes", state: "waking", elementsRemaining: 3, direction: "ahead", attending: { gesture: "look", progress: "almost" }, nextAsks: "look" } }, turn: { occasion: "structure_attending", youSaid: null, walkerDid: "Is looking at it steadily.", whatFollowed: "It needs a few more seconds." } };
  assert.ok(parseFieldRequest(envelope(request), diagnostics), diagnostics.reason);
  assert.equal(parseFieldRequest(envelope({ ...request, near: { ...request.near, structure: { ...request.near.structure, attending: { gesture: "poke", progress: "almost" } } } }), diagnostics), null, "an unknown gesture is refused");
});
