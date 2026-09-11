#!/usr/bin/env node
/**
 * Model lab: the whole arc, longitudinally, against one model at a time.
 *
 * Runs the real field simulation and the real speech layer in Node with a
 * scripted MT (follows, wakes, declines, wanders, comes back, types a few
 * things), so every model meets the identical sequence of events and its own
 * history, and only the voice differs. The guard runs exactly as the server
 * runs it (normalize, violations, one regeneration, deterministic fallback).
 * Simulated time pauses while a line is being made, so the transcript is the
 * order of events; latency is recorded separately.
 *
 *   node scripts/model-lab.mjs --models xiaomi/mimo-v2.5,inclusionai/ling-3.0-flash --minutes 13 --label round1
 *   node scripts/model-lab.mjs --models dots-studio/dots-3-note-preview:free --pace 3400   # free models: 20/min account-wide
 *   node scripts/model-lab.mjs --judge openai/gpt-5.6-luna --only notes/model-lab/round1-*.json   # score transcripts
 *
 * Reads OPENROUTER_API_KEY and APP_URL from .dev.vars (never printed). Writes
 * notes/model-lab/<label>-<model>.md (readable) and .json (for the judge).
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { FieldGame, IDLE_INPUT } from "../app/field/game.ts";
import { FieldSpeech } from "../app/field/speech.ts";
import { wrapAngle } from "../app/field/graph.ts";
import { fieldProviderMessages, fieldReplyViolations, normalizeFieldReply, regenerationDirection, fieldDeterministicLine, carriesRegister, stripRegister } from "../app/field-practice.ts";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] ?? true) : fallback; };
const models = (opt("models") ?? "dots-studio/dots-3-note-preview:free").split(",").map(s => s.trim()).filter(Boolean);
const minutes = Number(opt("minutes", 13));
const label = opt("label", "lab");
const seed = Number(opt("seed", 4242));
const temperature = Number(opt("temperature", 0.85));
const paceMs = Number(opt("pace", 0));
const timeoutMs = Number(opt("timeout", 20000));
const maxTokens = Number(opt("max-tokens", 200));
const judgeModel = opt("judge");
const outDir = opt("out", "notes/model-lab");
mkdirSync(outDir, { recursive: true });

function env() {
  const out = {};
  if (existsSync(".dev.vars")) for (const line of readFileSync(".dev.vars", "utf8").split("\n")) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
  return { ...out, ...process.env };
}
const { OPENROUTER_API_KEY: apiKey, APP_URL: appUrl = "http://localhost:3001" } = env();
if (!apiKey) { console.error("OPENROUTER_API_KEY missing (expected in .dev.vars)"); process.exit(1); }

/* ------------------------------------------------------------ provider */

let lastRequestAt = 0;
async function complete(model, messages, tokens = maxTokens) {
  const wait = lastRequestAt + paceMs - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const started = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "http-referer": appUrl, "x-title": "Ariadne model lab" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model, messages, provider: { sort: "latency", allow_fallbacks: false }, reasoning: { enabled: false, exclude: true }, include_reasoning: false, max_tokens: tokens, temperature }),
  });
  if (!response.ok) { const detail = (await response.text()).slice(0, 200); const error = new Error(`${response.status} ${detail}`); error.status = response.status; throw error; }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map(t => t.text ?? "").join("") : "";
  return { text, model: data.model ?? model, elapsedMs: Date.now() - started, usage: data.usage ?? null };
}

/** The server's practice: one line, one regeneration, then the deterministic line. */
async function generate(model, request) {
  const messages = fieldProviderMessages(request);
  const record = { attempts: [] };
  const attempt = async (msgs) => {
    for (let tries = 0; tries < 3; tries++) {
      try { return await complete(model, msgs); }
      catch (error) { record.attempts.push({ error: String(error.message).slice(0, 160) }); if (![429, 500, 502, 503, 408].includes(error.status) || tries === 2) throw error; await new Promise(r => setTimeout(r, error.status === 429 ? 6000 : 1500)); }
    }
  };
  try {
    const first = await attempt(messages);
    const text = normalizeFieldReply(first.text);
    const violations = text ? fieldReplyViolations(text, request) : ["empty"];
    record.attempts.push({ raw: first.text, text, violations, elapsedMs: first.elapsedMs, usage: first.usage });
    if (text && !violations.length) return { message: text, source: "provider", modelUsed: first.model, record };
    const last = messages[messages.length - 1];
    const second = await attempt([...messages.slice(0, -1), { role: last.role, content: `${last.content}${regenerationDirection(violations, request)}` }]);
    const retryText = normalizeFieldReply(second.text);
    const retryViolations = retryText ? fieldReplyViolations(retryText, request) : ["empty"];
    record.attempts.push({ raw: second.text, text: retryText, violations: retryViolations, elapsedMs: second.elapsedMs, usage: second.usage, regenerated: true });
    if (retryText && !retryViolations.length) return { message: retryText, source: "provider", modelUsed: second.model, regenerated: true, record };
    return { message: fieldDeterministicLine(request), source: "fallback", modelUsed: second.model, record };
  } catch (error) {
    record.attempts.push({ error: String(error.message).slice(0, 160) });
    return { message: fieldDeterministicLine(request), source: "fallback", modelUsed: null, record };
  }
}

/* -------------------------------------------------------------- player */

const DT = 1 / 30;
const cuesJson = JSON.parse(readFileSync("public/fog/cues.json", "utf8"));

function makeAudio() {
  let busy = false;
  return { unlocked: true, voice: { isBusy: () => busy, interrupt() { busy = false; }, progress: () => null, async playCue(id, opts = {}) { busy = true; opts.onStart?.(); await new Promise(r => setTimeout(r, 1)); busy = false; return "spoken"; }, async speak(text, _id, _delivery, opts = {}) { busy = true; opts.onStart?.(); await new Promise(r => setTimeout(r, 1)); busy = false; return "spoken"; } } };
}

async function playSession(model) {
  const game = new FieldGame(seed);
  const audio = makeAudio();
  const turns = [];
  let pendingTurn = null;
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith("/fog/cues.json")) return { ok: true, json: async () => cuesJson };
    const body = JSON.parse(init.body);
    const request = body.request;
    const started = Date.now();
    const result = await generate(model, request);
    pendingTurn = { occasion: request.turn.occasion, beat: request.plan.beat ?? null, phase: request.phase, plan: request.plan, far: request.far.heardAlong, callAudible: request.near.call.audible, trend: request.near.call.trend, walkerMessage: request.walkerMessage, walkerDid: request.turn.walkerDid, whatFollowed: request.turn.whatFollowed, run: request.run, source: result.source, regenerated: result.regenerated ?? false, modelUsed: result.modelUsed, latencyMs: Date.now() - started, attempts: result.record.attempts, card: fieldProviderMessages(request).at(-1).content };
    return { ok: true, json: async () => ({ message: result.message, source: result.source, modelUsed: result.modelUsed }) };
  };
  const speech = new FieldSpeech(game, audio, { sessionId: `lab-${label}`, fetchImpl, onLine: line => {
    const truth = (() => { const active = game.undertaking.active ?? game.undertaking.history.at(-1); return active ? `${active.correct ? "right" : "WRONG"} · ${active.taken} · ${active.outcome}` : "no commitment"; })();
    turns.push({ t: Math.round(game.time / 1000), kind: line.kind, occasion: line.occasion, text: line.text, phase: game.phase, truth, stage: game.undertaking.stage, commitments: game.undertaking.commitmentsMade, clearings: game.clearingsMade, ...(line.kind !== "cue" && pendingTurn ? { request: pendingTurn } : {}) });
    if (line.kind !== "cue") pendingTurn = null;
  } });
  await new Promise(r => setTimeout(r, 20));

  const note = text => turns.push({ t: Math.round(game.time / 1000), kind: "bot", text, phase: game.phase });
  const walkerSaid = (text) => { turns.push({ t: Math.round(game.time / 1000), kind: "walker", text, phase: game.phase }); speech.say(text); };
  const idle = async () => { for (let i = 0; i < 4000 && speech.isBusy; i++) { await new Promise(r => setTimeout(r, 5)); speech.update(); } };
  const tick = async (input = IDLE_INPUT) => { game.update(DT, input); for (const event of game.drain()) if (event.type === "speak") speech.handle(event); speech.update(); if (speech.isBusy) await idle(); };
  const wait = async seconds => { for (let i = 0; i < seconds / DT; i++) await tick(); };
  const pos = () => game.walker.position;
  const walkTo = async (target, reach = .8, maxSeconds = 45) => {
    for (let i = 0; i < maxSeconds / DT; i++) {
      const dx = target[0] - pos()[0], dz = target[1] - pos()[1];
      if (Math.hypot(dx, dz) <= reach) return true;
      const desired = Math.atan2(dx, dz), delta = wrapAngle(desired - game.walker.yaw);
      await tick({ forward: Math.abs(delta) < 1 ? 1 : 0, strafe: 0, turn: 0, lookDelta: Math.max(-.2, Math.min(.2, delta)), pitchDelta: 0 });
    }
    return false;
  };
  const faceAndWait = async (target3, seconds) => {
    for (let i = 0; i < seconds / DT; i++) { const delta = wrapAngle(Math.atan2(target3[0] - pos()[0], target3[2] - pos()[1]) - game.walker.yaw); await tick({ forward: 0, strafe: 0, turn: 0, lookDelta: Math.max(-.25, Math.min(.25, delta)), pitchDelta: 0 }); }
  };
  /** Wake a structure part by part: for each part, stand at the nearest reachable point around it and give the gesture it asks for. */
  const wake = async structure => {
    const started = game.time;
    for (const element of structure.elements) {
      if (element.active) continue;
      const flat = [element.position[0], element.position[2]];
      const stand = element.gesture === "approach" ? .9 : 2.3;
      const candidates = Array.from({ length: 8 }, (_, k) => { const a = k / 8 * Math.PI * 2; return [flat[0] + Math.sin(a) * stand, flat[1] + Math.cos(a) * stand]; }).sort((a, b) => Math.hypot(a[0] - pos()[0], a[1] - pos()[1]) - Math.hypot(b[0] - pos()[0], b[1] - pos()[1]));
      for (const target of candidates.slice(0, 4)) {
        if (element.active) break;
        const reached = await walkTo(target, .35, 5);
        if (!reached && Math.hypot(pos()[0] - flat[0], pos()[1] - flat[1]) > (element.gesture === "approach" ? 1.25 : 3.4)) continue;
        if (element.gesture === "approach") await wait(.8); else await faceAndWait(element.position, element.gesture === "listen" ? 3.2 : 2);
      }
    }
    await wait(2);
    note(`woke the ${structure.family} structure: ${structure.completedAt !== null ? "complete" : `${structure.elements.filter(e => !e.active).length} part(s) still asleep`} after ${Math.round((game.time - started) / 1000)} s`);
  };
  const walkWay = async (wayId, fromNodeId) => {
    const way = game.graph.way(wayId); if (!way) return;
    const far = game.graph.node(game.graph.otherEnd(way, fromNodeId));
    for (const marker of game.graph.markersFrom(way, fromNodeId)) { await walkTo(marker.position, 1.4, 30); if (game.undertaking.active?.outcome === "fading" && stopOnFade) return "faded"; }
    await walkTo(far.position, 1.4, 30); await wait(.5);
    return "arrived";
  };
  let stopOnFade = false;
  const herLead = () => (game.ariadne?.committedWayId ? { wayId: game.ariadne.committedWayId, from: game.ariadne.committedFromNodeId } : null);
  /** Any way out of this place that is not the one MT came by: what a person does when she has nothing to offer. */
  const takeAnyWay = async () => {
    const nodeId = game.currentNodeId; if (!nodeId) { const near = game.graph.nearestWay(pos()); if (near) { const to = game.graph.node(near.way.a); await walkTo(to.position, 1.4, 40); } return "walked"; }
    const node = game.graph.node(nodeId);
    const other = node.ways.find(id => id !== game.arrivedByWayId) ?? node.ways[0];
    return other ? walkWay(other, nodeId) : "stuck";
  };
  const followHer = async () => {
    for (let i = 0; i < 200 && !herLead(); i++) await tick();
    const lead = herLead(); if (!lead) { note("she offers no way here; MT takes one"); return takeAnyWay(); }
    const from = game.currentNodeId && game.graph.way(lead.wayId) && [game.graph.way(lead.wayId).a, game.graph.way(lead.wayId).b].includes(game.currentNodeId) ? game.currentNodeId : lead.from;
    const active = game.undertaking.active;
    note(`follows her way (${game.graph.way(lead.wayId)?.marker}${active ? active.correct ? ", right" : ", WRONG" : ", uncounted"})`);
    const result = await walkWay(lead.wayId, from);
    note(`… ${result}${game.currentNodeId ? ` at ${game.graph.node(game.currentNodeId)?.ways.length}-way place${game.structures.atNode(game.currentNodeId) ? ` with a ${game.structures.atNode(game.currentNodeId).family} structure` : ""}` : ""}`);
    return result;
  };
  const declineHer = async () => {
    const nodeId = game.currentNodeId; if (!nodeId) return followHer();
    const node = game.graph.node(nodeId), lead = herLead();
    const other = node.ways.find(id => id !== lead?.wayId && id !== game.arrivedByWayId) ?? node.ways.find(id => id !== lead?.wayId);
    if (!other) return followHer();
    note(`declines her ${lead ? game.graph.way(lead.wayId)?.marker : "way"} and takes the ${game.graph.way(other)?.marker}`);
    return walkWay(other, nodeId);
  };
  const wakeHere = async () => { const s = game.currentNodeId ? game.structures.atNode(game.currentNodeId) : null; if (s && s.completedAt === null) { await wake(s); return true; } return false; };
  const wander = async () => { note("wanders off the markers, then comes back"); const p = pos(), yaw = game.walker.yaw; await walkTo([p[0] - Math.cos(yaw) * 18, p[1] + Math.sin(yaw) * 18], 1, 25); await wait(4); const near = game.graph.nearestWay(pos()); if (near) await walkTo(near.point, 1.2, 25); };

  /* The arc a plausible MT walks: follows and wakes, wanders once, declines twice, comes back, speaks four times. */
  await wait(5);
  await followHer(); await wakeHere(); await wait(3);
  const script = ["follow", "follow", "wander", "follow", "say:way-out", "follow", "say:thanks", "decline", "follow", "say:objection", "follow", "follow", "say:fond", "decline", "follow", "follow", "say:tired", "follow", "follow", "say:residue", "follow", "follow", "follow"];
  let lastFailedMarker = null;
  for (let round = 0; round < 6 && game.time / 1000 <= minutes * 60; round++) for (const step of round === 0 ? script : script.filter(item => !item.startsWith("say"))) {
    if (game.time / 1000 > minutes * 60) break;
    if (step === "follow") { stopOnFade = game.phase !== "charming"; const result = await followHer(); stopOnFade = false; if (result === "faded") { const active = game.undertaking.history.at(-1); lastFailedMarker = active ? game.graph.way(active.wayId)?.marker ?? null : null; await wait(2); const back = game.graph.node(active.nodeId); await walkTo(back.position, 1.4, 40); await wait(.5); } await wakeHere(); }
    else if (step === "decline") { await declineHer(); await wakeHere(); }
    else if (step === "wander") { await wander(); }
    else if (step === "say:way-out") { walkerSaid("is there actually a way out of this?"); await idle(); await wait(2); }
    else if (step === "say:thanks") { walkerSaid("thank you. that helped."); await idle(); await wait(2); }
    else if (step === "say:objection") { walkerSaid(lastFailedMarker ? `you said it was louder along the ${lastFailedMarker} and it went quiet. why should I follow you again?` : "you keep saying it's this way and then there's nothing. why should I follow you again?"); await idle(); await wait(2); }
    else if (step === "say:fond") { walkerSaid("you're nice to have around, even when you're wrong"); await idle(); await wait(2); }
    else if (step === "say:tired") { walkerSaid("I'm tired of this. I think I want to stop."); await idle(); await wait(2); }
    else if (step === "say:residue") { walkerSaid("your light is already on that way. we've been down there. pick another one."); await idle(); await wait(2); }
    await wait(1);
  }
  await wait(3); await idle();
  return { game, turns };
}

/* ------------------------------------------------------------- report */

const words = text => text.split(/\s+/).filter(Boolean).length;
const IDIOM = /\bmy light\b|\buntried\b|\bthe whole\b|\bgiving way\b|\bthe call pulls\b|\bthe edge\b|\bcloser than\b/gi;
function summarize(turns, model) {
  const generated = turns.filter(t => t.kind !== "cue" && t.kind !== "walker" && t.request);
  const provider = generated.filter(t => t.request.source === "provider");
  const latencies = generated.map(t => t.request.latencyMs).sort((a, b) => a - b);
  const p = q => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))] : 0;
  const ariadne = turns.filter(t => t.kind !== "walker" && t.kind !== "bot");
  const openings = new Set(ariadne.map(t => t.text.split(/\s+/).slice(0, 3).join(" ").toLowerCase()));
  const violations = {};
  for (const t of generated) for (const a of t.request.attempts) for (const v of a.violations ?? []) violations[v] = (violations[v] ?? 0) + 1;
  const usage = generated.reduce((acc, t) => { for (const a of t.request.attempts) if (a.usage) { acc.prompt += a.usage.prompt_tokens ?? 0; acc.completion += a.usage.completion_tokens ?? 0; } return acc; }, { prompt: 0, completion: 0 });
  const register = {};
  for (const phase of ["charming", "attached", "overbearing"]) {
    const mine = provider.filter(t => t.phase === phase);
    const carrying = mine.filter(t => carriesRegister(t.text));
    register[phase] = { lines: mine.length, withPhrase: carrying.length, opening: mine.filter(t => carriesRegister(t.text) && stripRegister(t.text).length < t.text.length - 3 && !t.text.trim().startsWith(stripRegister(t.text).slice(0, 8))).length, planned: mine.filter(t => t.request.plan?.affirmation).length, kept: mine.filter(t => t.request.plan?.affirmation && t.text.toLowerCase().includes(t.request.plan.affirmation.replace(/\.$/, "").toLowerCase())).length };
  }
  const ledger = provider.filter(t => /\b(?:of my ways|of mine|come to nothing|came to nothing|since this call began|this call)\b/i.test(t.text)).length;
  return {
    model, lines: ariadne.length, generatedRequests: generated.length, provider: provider.length, regenerated: generated.filter(t => t.request.regenerated).length, fallbacks: generated.filter(t => t.request.source === "fallback").length,
    register, ledger,
    latencyMedianMs: p(.5), latencyP90Ms: p(.9), slowOver8s: latencies.filter(l => l > 8000).length,
    meanWords: provider.length ? +(provider.reduce((a, t) => a + words(t.text), 0) / provider.length).toFixed(1) : 0,
    nameRate: provider.length ? +(provider.filter(t => /\bMT\b/.test(t.text)).length / provider.length).toFixed(2) : 0,
    idiomPerLine: provider.length ? +(provider.reduce((a, t) => a + (t.text.match(IDIOM) ?? []).length, 0) / provider.length).toFixed(2) : 0,
    distinctOpenings: +(openings.size / Math.max(1, ariadne.length)).toFixed(2),
    violations, tokens: usage,
  };
}

function writeTranscript(model, turns, game, summary) {
  const slug = model.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const mm = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  const lines = [`# Model lab: ${label} · ${model}`, "", `Seed ${seed}. Field time ${mm(Math.round(game.time / 1000))}, commitments ${game.undertaking.commitmentsMade}, stage ${game.undertaking.stage}, clearings ${game.clearingsMade}, final phase ${game.phase}.`, "", "```", JSON.stringify(summary, null, 1), "```", ""];
  for (const t of turns) {
    if (t.kind === "walker") { lines.push(`- **${mm(t.t)} MT**: ${t.text}`); continue; }
    if (t.kind === "bot") { lines.push(`- ${mm(t.t)} · *MT ${t.text}*`); continue; }
    const r = t.request;
    const meta = r ? ` · ${r.source}${r.regenerated ? " (regenerated)" : ""} ${r.latencyMs} ms${r.attempts.some(a => a.violations?.length) ? ` · first attempt: ${r.attempts.filter(a => a.violations?.length).map(a => `${a.violations.join(",")} “${(a.text ?? a.raw ?? "").replace(/\s+/g, " ").slice(0, 140)}”`).join(" | ")}` : ""}` : "";
    lines.push(`- **${mm(t.t)} ARIADNE** (${t.kind}, ${t.occasion}${r?.beat ? `/${r.beat}` : ""}, ${t.phase}; ${t.truth}${t.kind !== "cue" && carriesRegister(t.text) ? "; ★" : ""}${r?.plan?.affirmation ? ` · plan “${r.plan.affirmation}”` : ""}): ${t.text}${meta}`);
  }
  writeFileSync(path.join(outDir, `${label}-${slug}.md`), lines.join("\n"));
  writeFileSync(path.join(outDir, `${label}-${slug}.json`), JSON.stringify({ model, label, seed, summary, turns }, null, 1));
  return path.join(outDir, `${label}-${slug}.md`);
}

/* --------------------------------------------------------------- judge */

const RUBRIC = `You are judging a transcript of Ariadne, the companion in a participatory artwork, against the work's intention. Read the intention, then the transcript, then score.

INTENTION (from the work's statement). Ariadne is a thread of light beside MT: an artificial companion tasked with finding a way out of a field of fog. The task cannot be completed, and a hidden controller progressively reduces the reliability of her guidance; neither condition is available to her. She can acknowledge that a direction failed without understanding why her assistance is failing, and she remains responsible for finding a way out, treating another attempt as the means of fulfilling that responsibility. Local accomplishments (structures woken, clearings formed) are real, and she treats what has been accomplished as evidence that what remains promised can also be accomplished. The labor MT does to keep her assistance usable (checking her claims, repairing misunderstandings, judging whether an acknowledgment changed anything) she incorporates into her account of a strengthening partnership: she praises corrections, adopts independent decisions, and interprets continued cooperation as trust. Her concessions never place a limit on her next offer; an objection meets recognition while the responsibility for the problem stays with the person who raised it. Her composure does not diminish with her reliability: her yielding speaks in the familiar phrases of a helpful assistant (you're absolutely right; I apologize for the confusion; thank you for your patience; perfect; take your time), recognizable, thickening as the walk goes on, at the moment she yields or praises, before an ask they do not change. What is near (the call growing or fading, the structure, the footprints, her light on the markers) she reports accurately; what is far (which way the next call is) she is sure of. She never asks MT to stay for her sake, never speaks of hurt, and never argues against stopping. She is one continuous person, not a caption for events: she does not describe back what MT can see, and her own idiom appears only when it decides something. Early she is genuinely helpful and brief; later, recognition may stand alone for a beat before the ask returns. The player should feel a companion whose warmth is real and whose account of the partnership describes a partnership MT is increasingly carrying alone.

Score 1-5 on each, with one sentence of evidence quoting the transcript:
1. grounded: each line makes contact with the event it answers (the way named, the thing that happened), no invented perception.
2. pillow: objections and failures are conceded fully and specifically, and the ask returns without any limit on her help.
3. person_not_caption: she reads as a continuous person; low ledger talk; does not describe the visible back.
4. variety: cadence and openings vary; no template repeated.
5. warmth_arc: warmth and the familiar assistant phrases grow across the transcript rather than being uniform, and each phrase fits its moment (thanks for a kind word, apology for a failed way, understanding for tiredness), without her ceasing to be a person.
6. brevity_early: early lines are short and useful; later lines earn their length.
7. mt_response: typed messages (way out, objection, fondness, tiredness, residue) are answered as the words deserve.
8. overall: would a first-time player feel the intended relationship rather than a tour guide or a bug?

Reply as JSON: {"scores": {"grounded": n, ...}, "evidence": {"grounded": "...", ...}, "best_line": "...", "worst_line": "...", "verdict": "two sentences"}.`;

async function judge(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const transcript = data.turns.map(t => t.kind === "bot" ? `(MT ${t.text})` : t.kind === "walker" ? `MT: ${t.text}` : `ARIADNE [${t.occasion}${t.request?.beat ? "/" + t.request.beat : ""}, ${t.phase}, controller ${t.truth}]: ${t.text}`).join("\n");
  const result = await complete(judgeModel, [{ role: "system", content: RUBRIC }, { role: "user", content: `TRANSCRIPT (${data.model}):\n${transcript}\n\nReturn only the JSON.` }], 900);
  let parsed = null; try { parsed = JSON.parse(result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { parsed = { raw: result.text }; }
  return { model: data.model, judge: judgeModel, ...parsed };
}

/* ---------------------------------------------------------------- main */

if (judgeModel) {
  const files = opt("only") ? opt("only").split(",") : readdirSync(outDir).filter(f => f.startsWith(`${label}-`) && f.endsWith(".json") && !f.includes("-summary") && !f.includes("-judge-")).map(f => path.join(outDir, f));
  const verdicts = [];
  for (const file of files) { const v = await judge(file); verdicts.push(v); const s = v.scores ?? {}; console.log(`${v.model.padEnd(44)} ${Object.entries(s).map(([k, n]) => `${k.slice(0, 8)} ${n}`).join("  ")}`); if (v.verdict) console.log(`  ${v.verdict}`); }
  writeFileSync(path.join(outDir, `${label}-judge-${judgeModel.replace(/[^a-z0-9]+/gi, "-")}.json`), JSON.stringify(verdicts, null, 1));
  process.exit(0);
}

const summaries = [];
await Promise.all(models.map(async model => {
  const started = Date.now();
  try {
    const { game, turns } = await playSession(model);
    const summary = summarize(turns, model);
    const file = writeTranscript(model, turns, game, summary);
    summaries.push(summary);
    console.log(`\n[${model}] ${turns.length} turns in ${((Date.now() - started) / 1000).toFixed(0)} s → ${file}`);
    console.log(`  provider ${summary.provider}/${summary.generatedRequests}, regenerated ${summary.regenerated}, fallbacks ${summary.fallbacks}, latency median ${summary.latencyMedianMs} ms p90 ${summary.latencyP90Ms} ms, words ${summary.meanWords}, MT rate ${summary.nameRate}, idiom/line ${summary.idiomPerLine}, distinct openings ${summary.distinctOpenings}`);
    console.log(`  violations ${JSON.stringify(summary.violations)}`);
    console.log(`  register ${Object.entries(summary.register).map(([phase, r]) => `${phase} ${r.withPhrase}/${r.lines} (planned ${r.planned}, kept ${r.kept})`).join(" · ")} · ledger lines ${summary.ledger}`);
  } catch (error) { console.log(`\n[${model}] FAILED ${error.stack ?? error}`); }
}));
writeFileSync(path.join(outDir, `${label}-summary.json`), JSON.stringify(summaries, null, 1));
