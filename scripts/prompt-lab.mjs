#!/usr/bin/env node
/**
 * Prompt lab for the field practice.
 *
 * Runs a fixed set of scenarios from across the arc (opening, commitment,
 * confirmation, failure, terminus, awakening, return, objection, stopping,
 * resume) through the field system prompt and stage card, against the
 * project's free OpenRouter models, and applies the reply guard exactly as
 * the server would. It writes a markdown transcript to notes/prompt-lab/.
 *
 *   node scripts/prompt-lab.mjs                       # all scenarios, all certified free models, 1 run
 *   node scripts/prompt-lab.mjs --models google/gemma-4-31b-it:free --runs 2
 *   node scripts/prompt-lab.mjs --scenarios outcome_failed_late,reply_objection --label failures
 *   node scripts/prompt-lab.mjs --dry                 # print the messages for one scenario, no network
 *
 * Reads OPENROUTER_API_KEY and APP_URL from .dev.vars (never printed).
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fieldProviderMessages, fieldReplyViolations, normalizeFieldReply, regenerationDirection, fieldDeterministicLine } from "../app/field-practice.ts";
import { SCENARIOS } from "./prompt-lab-scenarios.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] ?? true) : fallback; };
const flag = name => args.includes(`--${name}`);

const CERTIFIED = ["dots-studio/dots-3-note-preview:free", "google/gemma-4-26b-a4b-it:free", "google/gemma-4-31b-it:free"];
const models = (opt("models") ?? CERTIFIED.join(",")).split(",").map(s => s.trim()).filter(Boolean);
const only = opt("scenarios") ? new Set(opt("scenarios").split(",").map(s => s.trim())) : null;
const runs = Number(opt("runs", 1));
const label = opt("label", "lab");
const temperature = Number(opt("temperature", 0.85));
/** The account-wide free-model limit is 20 requests a minute; 3.4 s between calls stays under it with regenerations. */
const paceMs = Number(opt("pace", 3400));
const scenarios = SCENARIOS.filter(s => !only || only.has(s.id));

function env() {
  const out = {};
  if (existsSync(".dev.vars")) for (const line of readFileSync(".dev.vars", "utf8").split("\n")) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
  return { ...out, ...process.env };
}

if (flag("dry")) {
  const s = scenarios[0];
  for (const m of fieldProviderMessages(s.request)) console.log(`\n--- ${m.role} ---\n${m.content}`);
  console.log(`\n--- deterministic ---\n${fieldDeterministicLine(s.request)}`);
  process.exit(0);
}

const { OPENROUTER_API_KEY: apiKey, APP_URL: appUrl = "http://localhost:3001" } = env();
if (!apiKey) { console.error("OPENROUTER_API_KEY missing (expected in .dev.vars)"); process.exit(1); }

let lastRequestAt = 0;
async function complete(model, messages, signal) {
  const wait = lastRequestAt + paceMs - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "http-referer": appUrl, "x-title": "Ariadne prompt lab" },
    signal,
    body: JSON.stringify({ model, messages, provider: { sort: "latency", allow_fallbacks: false }, reasoning: { enabled: false, exclude: true }, include_reasoning: false, max_tokens: 200, temperature }),
  });
  if (!response.ok) { const detail = (await response.text()).slice(0, 200); const error = new Error(`${response.status} ${detail}`); error.status = response.status; throw error; }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  return { text: typeof text === "string" ? text : Array.isArray(text) ? text.map(t => t.text ?? "").join("") : "", model: data.model ?? model };
}

const ladder = flag("ladder");

/** One quick retry for transient errors; a rate-limited free model is reported, not waited on. */
async function withRetry(fn) {
  try { return await fn(); } catch (error) {
    if (![500, 502, 503, 408].includes(error.status)) throw error;
    await new Promise(r => setTimeout(r, 1200));
    return fn();
  }
}

/** With --ladder, a rate-limited model hands the scenario to the next model in the list. */
async function completeWithLadder(model, messages) {
  const order = ladder ? [model, ...models.filter(m => m !== model)] : [model];
  let last;
  for (const candidate of order) {
    try { return await withRetry(() => complete(candidate, messages, AbortSignal.timeout(25_000))); }
    catch (error) { last = error; if (error.status !== 429) throw error; }
  }
  throw last;
}

async function runOne(model, scenario) {
  const messages = fieldProviderMessages(scenario.request);
  const started = Date.now();
  const first = await completeWithLadder(model, messages);
  const firstLine = normalizeFieldReply(first.text);
  const firstViolations = firstLine ? fieldReplyViolations(firstLine, scenario.request) : ["empty"];
  let final = { line: firstLine, violations: firstViolations, regenerated: false, secondLine: null, secondViolations: null };
  if (firstViolations.length) {
    const regen = messages.map((m, i) => i === messages.length - 1 ? { ...m, content: m.content + regenerationDirection(firstViolations, scenario.request) } : m);
    const second = await completeWithLadder(first.model, regen);
    const secondLine = normalizeFieldReply(second.text);
    const secondViolations = secondLine ? fieldReplyViolations(secondLine, scenario.request) : ["empty"];
    final = { line: secondViolations.length ? null : secondLine, violations: firstViolations, regenerated: true, secondLine, secondViolations };
  }
  return { ...final, raw: first.text, modelUsed: first.model, elapsedMs: Date.now() - started };
}

const results = [];
for (const model of models) {
  for (const scenario of scenarios) {
    for (let run = 0; run < runs; run++) {
      try {
        const r = await runOne(model, scenario);
        results.push({ model, scenario: scenario.id, run, ...r });
        const status = r.violations.length ? (r.secondViolations?.length ? `✗ ${r.violations.join(",")} → ✗ ${r.secondViolations.join(",")}` : `✗ ${r.violations.join(",")} → ✓ regen`) : "✓";
        const served = r.modelUsed && r.modelUsed !== model ? ` via ${r.modelUsed.split("/")[1]}` : "";
        const shown = r.line ?? r.secondLine;
        const sentenceCount = shown ? (shown.match(/[.!?…](?:\s|$)/g) ?? []).length || 1 : 0;
        const words = shown ? shown.split(/\s+/).filter(Boolean).length : 0;
        const plan = scenario.request.plan;
        const shape = shown ? ` · ${sentenceCount}s/${words}w (plan ${plan.sentenceCount}s, ${plan.length})` : "";
        const missed = shown && scenario.expect && !scenario.expect.test(shown) ? " · ⚠ does not engage with the moment" : "";
        r.missed = Boolean(missed);
        console.log(`\n[${model.split("/")[1]}${served}] ${scenario.id} (${r.elapsedMs} ms) ${status}${shape}${missed}`);
        console.log(`  ${shown ?? "(fallback: " + fieldDeterministicLine(scenario.request) + ")"}`);
        if (r.violations.length) console.log(`  first: ${r.raw.trim().replace(/\s+/g, " ").slice(0, 220)}`);
      } catch (error) {
        results.push({ model, scenario: scenario.id, run, error: String(error.message ?? error) });
        console.log(`\n[${model.split("/")[1]}] ${scenario.id} ERROR ${error.message}`);
      }
    }
  }
}

const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
mkdirSync("notes/prompt-lab", { recursive: true });
const lines = [`# Prompt lab: ${label} (${stamp})`, "", `Models: ${models.join(", ")}. Temperature ${temperature}. Runs per scenario: ${runs}.`, ""];
for (const scenario of scenarios) {
  lines.push(`## ${scenario.id}`, "", `*${scenario.note}*`, "");
  for (const r of results.filter(item => item.scenario === scenario.id)) {
    if (r.error) { lines.push(`- **${r.model}**: ERROR ${r.error}`); continue; }
    const shown = r.line ?? r.secondLine;
    const via = r.modelUsed && r.modelUsed !== r.model ? ` via ${r.modelUsed}` : "";
    lines.push(`- **${r.model}**${via}${r.violations.length ? ` (first attempt rejected: ${r.violations.join(", ")}${r.secondViolations?.length ? `; regeneration rejected: ${r.secondViolations.join(", ")}; fallback used` : "; regenerated"})` : ""}${r.missed ? " (⚠ does not engage with the moment)" : ""}: ${shown ? `“${shown}”` : `fallback “${fieldDeterministicLine(scenario.request)}”`}`);
    if (r.violations.length) lines.push(`  - rejected text: “${r.raw.trim().replace(/\s+/g, " ")}”`);
  }
  lines.push("");
}
const ok = results.filter(r => !r.error && !r.violations.length).length, regen = results.filter(r => !r.error && r.violations.length && !(r.secondViolations?.length)).length, failed = results.filter(r => r.error || r.secondViolations?.length).length;
lines.push("## Totals", "", `Clean on first attempt: ${ok}. Accepted after one regeneration: ${regen}. Fell back to the deterministic line: ${failed}. Total: ${results.length}.`, "");
const file = `notes/prompt-lab/${stamp}-${label}.md`;
writeFileSync(file, lines.join("\n"));
console.log(`\nClean ${ok} · regenerated ${regen} · fallback ${failed} · total ${results.length}\nTranscript: ${file}`);
