/**
 * The companion's model ladder, shared by the maze route and the field route.
 *
 * A model being free and technically compatible is not enough for Ariadne.
 * These models have also been exercised against the project's tone matrix
 * (and, for the field, the prompt lab in scripts/prompt-lab.mjs). The
 * catalog may confirm that one is currently available, but must never
 * promote an arbitrary new model into the character's voice.
 */
export const FAST_FREE_MODELS = ["dots-studio/dots-3-note-preview:free", "google/gemma-4-26b-a4b-it:free", "google/gemma-4-31b-it:free"];
export const STYLE_CERTIFIED_FREE_MODELS = new Set<string>(FAST_FREE_MODELS);
/** Deliberately not sticky and never accepted from the browser: every request starts with the free ladder again. */
export const PAID_FALLBACK_MODELS = ["xiaomi/mimo-v2.5", "openai/gpt-5.6-luna"] as const;
export const SERVER_OWNED_PAID_MODELS = new Set<string>(PAID_FALLBACK_MODELS);
