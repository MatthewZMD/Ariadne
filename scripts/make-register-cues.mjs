#!/usr/bin/env node
/**
 * Record the register: the short assistant phrases Ariadne says instantly on the walk ("Perfect.", "Take your time.",
 * "I apologize for the confusion."), synthesized once in her voice through the running app's speech route and written to
 * public/fog/cues, with cues.json updated. Run with the dev server up:
 *
 *   ARIADNE_LOCAL_PREVIEW=1 npm run dev &   then   node scripts/make-register-cues.mjs [--url http://localhost:3000] [--only reg-perfect,reg-great] [--force]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { REGISTER_CUES } from "../app/field-practice.ts";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] ?? true) : fallback; };
const url = opt("url", "http://localhost:3000");
const only = opt("only") ? new Set(String(opt("only")).split(",")) : null;
const force = args.includes("--force");

/** How each phrase is delivered; the phrase's register decides it. */
const DELIVERY = {
  "reg-perfect": "delighted_praise", "reg-great": "delighted_praise", "reg-exactly": "admiring_correction", "reg-thats-it": "delighted_praise", "reg-well-done": "delighted_praise", "reg-doing-great": "delighted_praise", "reg-great-work": "delighted_praise", "reg-wonderful": "delighted_praise",
  "reg-almost-there": "intimate_reassurance", "reg-take-your-time": "quiet_companionship", "reg-thank-you-patience": "intimate_reassurance", "reg-whenever-ready": "quiet_companionship",
  "reg-of-course": "admiring_correction", "reg-fair-enough": "admiring_correction", "reg-good-instinct": "admiring_correction", "reg-absolutely-right": "admiring_correction",
  "reg-good-to-know": "quiet_companionship", "reg-thats-on-me": "tender_apology", "reg-apologize-confusion": "tender_apology", "reg-lets-try-again": "confident_invitation", "reg-lets-try-this": "confident_invitation", "reg-alright": "quiet_companionship",
};

const manifestPath = "public/fog/cues.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let made = 0, kept = 0, failed = 0;
for (const [phrase, id] of Object.entries(REGISTER_CUES)) {
  if (only && !only.has(id)) continue;
  const file = `public/fog/cues/${id}.mp3`;
  if (existsSync(file) && !force) { kept++; continue; }
  const delivery = DELIVERY[id] ?? "quiet_companionship";
  const response = await fetch(`${url}/api/speech`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "register-cues", utteranceId: `${id}-${Date.now().toString(36)}`, text: phrase, delivery }), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) { failed++; console.error(`${id}: ${response.status} ${(await response.text()).slice(0, 120)}`); continue; }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength < 1000) { failed++; console.error(`${id}: too small (${audio.byteLength} bytes)`); continue; }
  writeFileSync(file, audio);
  const model = response.headers.get("x-ariadne-tts-model") ?? response.headers.get("x-tts-model") ?? "fish-audio/s2.1-pro-free:free";
  const asset = { id, text: phrase, url: `/fog/cues/${id}.mp3`, status: "generated", model, register: true };
  const index = manifest.assets.findIndex(item => item.id === id);
  if (index >= 0) manifest.assets[index] = asset; else manifest.assets.push(asset);
  made++; console.log(`${id}: ${audio.byteLength} bytes (${delivery}) “${phrase}”`);
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`made ${made}, kept ${kept}, failed ${failed}`);
process.exit(failed ? 1 : 0);
