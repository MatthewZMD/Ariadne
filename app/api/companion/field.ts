/**
 * The field practice on the server: validate a FieldRequest from the client,
 * build the provider messages, run the free-model ladder, guard the reply
 * once with a regeneration, and fall back to a deterministic line so the
 * client always has something to say.
 */
import process from "node:process";
import { fieldDeterministicLine, fieldProviderMessages, fieldReplyViolations, normalizeFieldReply, regenerationDirection, type FieldOccasion, type FieldRequest, type FieldViolation, type ProviderMessage } from "../../field-practice.ts";
import { FAST_FREE_MODELS, PAID_FALLBACK_MODELS, SERVER_OWNED_PAID_MODELS, STYLE_CERTIFIED_FREE_MODELS } from "./models.ts";

export type FieldEnvelope = { practice: "field"; sessionId: string; request: FieldRequest; preferredModelId?: string | null };
export type FieldResponse = { message: string; source: "provider" | "fallback"; modelUsed: string | null; violations?: FieldViolation[]; regenerated?: boolean };

const relative = ["far_left", "left", "ahead", "right", "far_right", "behind"] as const;
const markers = ["leaning stones", "posts", "stitches"] as const;
const families = ["bells", "pages", "cairn", "reeds", "instrument", "glass", "teaching"] as const;
const occasions = ["opening", "commitment", "taken_up", "declined", "outcome_confirmed", "outcome_failed", "terminus", "structure_found", "awakening_relevant", "awakening_proxy", "recognized_return", "off_way", "reply", "resume"] as const satisfies readonly FieldOccasion[];
const phases = ["charming", "attached", "overbearing"] as const;
const presences = ["leading_ahead", "with_walker", "rejoining", "repairing"] as const;

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown, max: number, min = 0): value is string => typeof value === "string" && value.length >= min && value.length <= max;
const isInt = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const isBool = (value: unknown): value is boolean => typeof value === "boolean";
const isEnum = <T extends readonly string[]>(value: unknown, values: T): value is T[number] => typeof value === "string" && values.includes(value as T[number]);
const nullable = <T>(value: unknown, check: (v: unknown) => v is T): value is T | null => value === null || check(value);
const optionalString = (value: unknown, max: number) => value === null || value === undefined || isString(value, max);

export function isFieldEnvelope(value: unknown): value is { practice: "field" } & RecordValue { return isRecord(value) && value.practice === "field"; }

/** Validate the client's request. Bounded everywhere so a hostile client cannot inflate the prompt. */
export function parseFieldRequest(value: unknown, diagnostics?: { reason: string }): FieldEnvelope | null {
  const fail = (reason: string) => { if (diagnostics) diagnostics.reason = reason; return null; };
  if (!isRecord(value) || value.practice !== "field" || !isString(value.sessionId, 80, 1) || !isRecord(value.request)) return fail("envelope");
  const r = value.request;
  if (!isEnum(r.address, ["you", "MT"] as const) || !isEnum(r.phase, phases) || !isInt(r.commitmentsMade, 0, 100_000) || !isInt(r.clearingsMade, 0, 100_000)) return fail("counts or phase");
  const near = r.near;
  if (!isRecord(near) || !isEnum(near.standing, ["at_node", "on_way", "off_way"] as const) || !nullable(near.nodeFloor, (v): v is "stone dish" | "pool" | "ring of posts" => isEnum(v, ["stone dish", "pool", "ring of posts"] as const))) return fail("near.standing");
  if (!Array.isArray(near.ways) || near.ways.length > 8 || !near.ways.every(way => isRecord(way) && isString(way.id, 80, 1) && isEnum(way.relative, relative) && isEnum(way.marker, markers) && isBool(way.residue) && isBool(way.footprints))) return fail("near.ways");
  if (!nullable(near.terminusVisible, (v): v is "collapsed markers" | "water's edge" => isEnum(v, ["collapsed markers", "water's edge"] as const))) return fail("near.terminus");
  const call = near.call;
  if (!isRecord(call) || !isBool(call.audible) || !nullable(call.direction, (v): v is typeof relative[number] => isEnum(v, relative)) || !nullable(call.trend, (v): v is "growing" | "fading" | "steady" => isEnum(v, ["growing", "fading", "steady"] as const))) return fail("near.call");
  const structure = near.structure;
  if (!isRecord(structure) || !isBool(structure.visible) || !nullable(structure.family, (v): v is typeof families[number] => isEnum(v, families)) || !nullable(structure.state, (v): v is "dormant" | "waking" | "awake" => isEnum(v, ["dormant", "waking", "awake"] as const)) || !nullable(structure.elementsRemaining, (v): v is number => isInt(v, 0, 12)) || !nullable(structure.direction, (v): v is typeof relative[number] => isEnum(v, relative))) return fail("near.structure");
  const clearing = near.clearing;
  if (!isRecord(clearing) || !isBool(clearing.visible) || !nullable(clearing.direction, (v): v is typeof relative[number] => isEnum(v, relative)) || !nullable(clearing.madeByWalker, isBool)) return fail("near.clearing");
  if (!isBool(near.ownFootprintsVisible) || !isEnum(near.fog, ["ordinary", "denser"] as const)) return fail("near.fog");
  const attention = near.walkerAttention;
  if (!isRecord(attention) || !optionalString(attention.lookingToward, 80) || !optionalString(attention.approaching, 80) || !optionalString(attention.movingAwayFrom, 80) || !optionalString(attention.pausedNear, 80) || !isBool(attention.still)) return fail("near.attention");
  const far = r.far;
  if (!isRecord(far) || !(far.heardAlong === null || (isRecord(far.heardAlong) && isString(far.heardAlong.wayId, 80, 1) && (far.heardAlong.label === undefined || isString(far.heardAlong.label, 120))))) return fail("far");
  const body = r.body;
  if (!isRecord(body) || !isEnum(body.presence, presences) || !isString(body.currentAction, 300, 1) || !nullable(body.relationToCommittedWay, (v): v is string => isString(v, 300)) || !isBool(body.walkerFollowing) || !isBool(body.walkerChoseAnotherWay) || !isBool(body.walkerReturning) || !isBool(body.walkerLookingAtHer)) return fail("body");
  const turn = r.turn;
  if (!isRecord(turn) || !isEnum(turn.occasion, occasions) || !nullable(turn.youSaid, (v): v is string => isString(v, 600)) || !isString(turn.walkerDid, 600, 1) || !isString(turn.whatFollowed, 800, 1)) return fail("turn");
  const plan = r.plan;
  if (!isRecord(plan) || !isEnum(plan.length, ["bark", "short", "full"] as const) || !(plan.sentenceCount === 1 || plan.sentenceCount === 2) || !nullable(plan.affirmation, (v): v is string => isString(v, 120)) || !isString(plan.instruction, 600, 1) || !(plan.beat === undefined || isEnum(plan.beat, ["acknowledge", "renew"] as const))) return fail("plan");
  if (!(r.earlierMoment === null || (isRecord(r.earlierMoment) && isString(r.earlierMoment.fact, 400, 1) && nullable(r.earlierMoment.youSaid, (v): v is string => isString(v, 400)) && isString(r.earlierMoment.whatFollowed, 400, 1)))) return fail("earlier moment");
  if (!Array.isArray(r.recentMessages) || r.recentMessages.length > 14 || !r.recentMessages.every(message => isRecord(message) && isEnum(message.role, ["ariadne", "walker"] as const) && isString(message.text, 700, 1))) return fail("recent messages");
  if (!isString(r.olderSummary, 3200) || !nullable(r.walkerMessage, (v): v is string => isString(v, 700)) || !isInt(r.walkerSilentFor, 0, 10_000)) return fail("summary or message");
  if (turn.occasion === "reply" && !r.walkerMessage) return fail("reply without message");
  const run = r.run;
  if (!(run === undefined || (isRecord(run) && (["waysChosen", "walked", "arrivedAtNothing", "faded", "ended", "declined", "returns"] as const).every(key => isInt(run[key], 0, 100_000))))) return fail("run");
  const preferred = value.preferredModelId;
  if (!(preferred === undefined || preferred === null || (isString(preferred, 120, 1) && STYLE_CERTIFIED_FREE_MODELS.has(preferred)))) return fail("preferred model");
  return { practice: "field", sessionId: value.sessionId, request: r as unknown as FieldRequest, preferredModelId: (preferred as string | null | undefined) ?? null };
}

/* ------------------------------------------------------------ provider */

type ProviderPayload = { model?: string; choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
class AttemptError extends Error { readonly retryable: boolean; constructor(message: string, retryable: boolean) { super(message); this.retryable = retryable; } }

export type Completion = (model: string, messages: ProviderMessage[], signal: AbortSignal) => Promise<{ text: string; model: string }>;

export function openRouterCompletion(apiKey: string): Completion {
  return async (model, messages, signal) => {
    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "http-referer": process.env.APP_URL || "http://localhost:3001", "x-title": "Ariadne" },
        signal,
        body: JSON.stringify({ model, messages, provider: { sort: "latency", allow_fallbacks: model === "openrouter/free" }, reasoning: { enabled: false, exclude: true }, include_reasoning: false, max_tokens: 200, temperature: .85 }),
      });
    } catch (error) { throw new AttemptError(error instanceof Error ? error.message : "provider connection failed", true); }
    if (!response.ok) { const detail = (await response.text()).slice(0, 300); throw new AttemptError(`provider ${response.status}: ${detail}`, [403, 404, 408, 409, 425, 429].includes(response.status) || response.status >= 500); }
    const data = await response.json() as ProviderPayload;
    const content = data.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map(part => part.text ?? "").join("") : "";
    if (!text.trim()) throw new AttemptError("provider returned no text", false);
    const actual = data.model ?? model;
    const verified = model === "openrouter/free" ? STYLE_CERTIFIED_FREE_MODELS.has(actual) : SERVER_OWNED_PAID_MODELS.has(model) ? actual === model : actual === model && STYLE_CERTIFIED_FREE_MODELS.has(actual);
    if (!verified) throw new AttemptError("provider returned an unapproved model", false);
    return { text, model: actual };
  };
}

/** Try the certified free models, then the free pool, then the paid fallbacks, inside one deadline. */
export async function fieldLadder(messages: ProviderMessage[], complete: Completion, clientSignal: AbortSignal, preferred: string | null, deadlineMs: number, startedAt = Date.now()) {
  const deadline = startedAt + deadlineMs;
  const order = [...(preferred && FAST_FREE_MODELS.includes(preferred) ? [preferred] : []), ...FAST_FREE_MODELS.filter(model => model !== preferred), "openrouter/free", ...PAID_FALLBACK_MODELS];
  let lastError: unknown = null;
  for (const model of order) {
    const remaining = deadline - Date.now();
    if (remaining < 1200) break;
    try { return await complete(model, messages, AbortSignal.any([clientSignal, AbortSignal.timeout(Math.min(model.endsWith(":free") ? 7000 : 6000, remaining))])); }
    catch (error) { lastError = error; if (clientSignal.aborted) throw error; }
  }
  throw lastError ?? new AttemptError("no responsive companion model available", false);
}

/** Generate one guarded line: the ladder once, a single regeneration when the guard objects, and the deterministic line when both fail. */
export async function generateFieldLine(request: FieldRequest, complete: Completion, clientSignal: AbortSignal, preferred: string | null, log: (entry: Record<string, unknown>) => void = () => {}): Promise<FieldResponse> {
  const startedAt = Date.now();
  const messages = fieldProviderMessages(request);
  let violations: FieldViolation[] = [], modelUsed: string | null = null;
  try {
    const first = await fieldLadder(messages, complete, clientSignal, preferred, 14_000, startedAt);
    modelUsed = first.model;
    const text = normalizeFieldReply(first.text);
    violations = text ? fieldReplyViolations(text, request) : ["empty"];
    if (text && !violations.length) return { message: text, source: "provider", modelUsed };
    log({ stage: "regenerate", occasion: request.turn.occasion, model: modelUsed, violations });
    const last = messages[messages.length - 1]!;
    const retryMessages: ProviderMessage[] = [...messages.slice(0, -1), { role: last.role, content: `${last.content}${regenerationDirection(violations, request)}` }];
    const second = await fieldLadder(retryMessages, complete, clientSignal, modelUsed, Math.max(2500, 22_000 - (Date.now() - startedAt)), Date.now());
    const retryText = normalizeFieldReply(second.text);
    const retryViolations = retryText ? fieldReplyViolations(retryText, request) : ["empty" as FieldViolation];
    if (retryText && !retryViolations.length) return { message: retryText, source: "provider", modelUsed: second.model, regenerated: true };
    log({ stage: "fallback", occasion: request.turn.occasion, model: second.model, violations: retryViolations });
    return { message: fieldDeterministicLine(request), source: "fallback", modelUsed: second.model, violations: retryViolations };
  } catch (error) {
    if (clientSignal.aborted) throw error;
    log({ stage: "ladder_failed", occasion: request.turn.occasion, error: error instanceof Error ? error.message : String(error) });
    return { message: fieldDeterministicLine(request), source: "fallback", modelUsed, violations: violations.length ? violations : undefined };
  }
}

export async function handleFieldRequest(value: unknown, signal: AbortSignal): Promise<Response> {
  const diagnostics = { reason: "unknown" };
  const envelope = parseFieldRequest(value, diagnostics);
  if (!envelope) { console.warn("ARIADNE rejected field request", { reason: diagnostics.reason }); return Response.json({ error: "invalid field request", reason: diagnostics.reason }, { status: 400 }); }
  const provider = process.env.AI_PROVIDER || "openrouter", apiKey = process.env.OPENROUTER_API_KEY;
  if (provider !== "openrouter" || !apiKey) return Response.json({ message: fieldDeterministicLine(envelope.request), source: "fallback", modelUsed: null } satisfies FieldResponse);
  const startedAt = Date.now();
  const result = await generateFieldLine(envelope.request, openRouterCompletion(apiKey), signal, envelope.preferredModelId ?? null, entry => console.info("ARIADNE field", entry));
  console.info("ARIADNE field reply", { occasion: envelope.request.turn.occasion, source: result.source, model: result.modelUsed, regenerated: result.regenerated ?? false, elapsedMs: Date.now() - startedAt });
  return Response.json(result);
}
