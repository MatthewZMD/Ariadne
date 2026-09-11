/**
 * The companion's model ladder, used by the field route.
 *
 * A model being cheap and technically compatible is not enough for Ariadne.
 * These models have been played against, longitudinally, with the model lab
 * (scripts/model-lab.mjs: the whole arc, a scripted MT, the guard as the
 * server runs it) and read against the statement. The catalog may confirm
 * that one is currently available, but must never promote an arbitrary new
 * model into the character's voice.
 *
 * September 2026, four thirteen-minute sessions per model over two seeds:
 * deepseek-v4-flash answered in half a second (p90 under a second), was the
 * most alive and varied voice, and after the prompt learned to say only the
 * numbers it is given, stayed grounded; it costs $0.09/$0.17 per million.
 * mimo-v2.5 was the steadiest and most literal, warm and accountable, but
 * slower (median 2–3 s, p90 4–8 s, with the deterministic line standing in
 * about one time in ten), and more formulaic at lower temperature. ling-3.0-
 * flash read as a caption machine. The free dots-3 was slowest and the most
 * templated. Hence the order below.
 */
/** Cheap paid models, tried first: her voice at the pace the encounter needs. Never accepted from the browser. */
export const PRIMARY_MODELS = ["deepseek/deepseek-v4-flash", "xiaomi/mimo-v2.5"] as const;
export const FAST_FREE_MODELS = ["dots-studio/dots-3-note-preview:free", "google/gemma-4-26b-a4b-it:free", "google/gemma-4-31b-it:free"];
export const STYLE_CERTIFIED_FREE_MODELS = new Set<string>(FAST_FREE_MODELS);
/** The last rung, when everything cheaper has failed inside the deadline. */
export const PAID_FALLBACK_MODELS = ["openai/gpt-5.6-luna"] as const;
export const SERVER_OWNED_PAID_MODELS = new Set<string>([...PRIMARY_MODELS, ...PAID_FALLBACK_MODELS]);
/** Sampling temperature by model; deepseek invents less at .7 and loses nothing of its voice, mimo repeats itself more below .85. */
export const MODEL_TEMPERATURE: Record<string, number> = { "deepseek/deepseek-v4-flash": .7 };
export const DEFAULT_TEMPERATURE = .85;
