# Direct dialogue evaluation

These are fictional sequential events sent to the real local companion endpoint. No browser input, live-world inspection, movement, or speech synthesis was used. Each reply becomes the next request's conversation history. Full request fixture and scenario runner are in scripts/dialogue-fixture.json and scripts/evaluate-dialogue.mjs.

Sequence: invitation → real first star → singing shells without star progress → reported failed route → return walk → skeptical enjoyment → another attempt. The runner validates requests and rejects fallback-only replies. It records model identity, timing, source (provider or directional rewrite), chosen utterance plan, and exact output. Silence plans are explicitly resampled for this spoken-event probe, so this is not an assessment of production silence frequency.

## Observations and retained revision

Baseline skeptical reply: “MT, if you want to stay here for the singing, then that's enough. I'll stay with you.” The direct-reply instruction explicitly requested acknowledging enjoyment as a sufficient reason to stay. Replaced that instruction with engagement in the particular pleasure, while retaining respect for MT's stated distrust. Also asks for a specific apology without a closing disclaimer.

Revision skeptical reply: “That’s fair, MT; the shells have earned your attention, while my directions have not. I’ll listen with you—and perhaps their rhythm will teach me better than guessing.” It still seeks connection, but connects that desire to the song and the failed advice.

Revision continuation: the first star came from the book; the shells might be its echo; the failed route does not erase that theory; “Could the singing be pointing us backward?” develops the same possibility on the return walk. This is more specific than an unrelated scenery caption. Whether the question itself is appealing needs further evaluation.

## Limits and next targets

Seven replies per run are not proof of attachment, consistency, or full-game progression. Different provider models and stochastic replies prevent a clean causal A/B conclusion. Keep both transcripts and model identities. The fixture is an authored event sequence rather than a recorded production request sequence. Short guidance remains thin; directional rewriting sometimes prepends “Go left.” Confident imaginative interpretation is permitted, but invented concrete observations remain defects. Check another scenario, varied reply samples, and the artist's live experience before claiming success.

The initial exploratory run stopped at a fixture length error and selected a silence plan for a spoken request; it is excluded from these two comparison transcripts. Corrected fixtures split visible details into bounded sentences and explicitly select spoken plans.

## Extended sequence and fresh-module evaluation

Extended the existing conversation through stars two, three, four, the challenged exit promise, another real light transformation, tiredness, and the final invitation. Reused the first seven replies rather than regenerating them. The initial local-server continuation produced inventory-like collection lines, a claim of carrying MT, and invented observations attributed to him.

Changed collection instructions to celebrate the particular route or effort in the supplied history. Restored a concise physical limit: Ariadne is light, cannot carry MT or hold his hand, and cannot invent something he noticed. The local-server retest remained similar, so added fresh-module execution to eliminate uncertainty about running edited source. This does not prove the local server was stale. Use Node's --env-file=.dev.vars option to supply the application's configuration normally; the runner never reads or prints credential values. It imports the production POST handler, uses the real provider ladder, and records a hash of the exact built messages.

Fresh-module second-star reply: “Two stars now—MT found the second through the book, not my machine. I was wrong; you were right.” This is specific to the authored independent route. Third-star reply still invented that MT saw a missed path. Fourth-star reply acknowledged patience through failed turns. The tiredness reply dropped the impossible offer to carry MT, but remained fairly generic. These are mixed results, not an accepted character performance.

Found a concrete final-event defect: a random specific_praise plan could replace the required confident direction. The server now overrides that event with a renewed invitation, without telling Ariadne about the coming interruption. A regression checks that the effective prompt contains the invitation and neither the praise cue nor interruption knowledge. Retested only the final response with the preceding thirteen replies retained. It now invites another step, but claims the flower light visibly threads every anchor, beyond the fixture's evidence of a chain along one wall. That remaining observation/theory conflation fails factual acceptance, even though the confident invitation better fits the ending.

Focused provider/discovery tests: 53 passed. Remaining targets: grounded interpretation of the chain, less generic response to tiredness, expressive variation across models, and matching all production event-plan overrides in the evaluator (the fixture currently resamples speech plans and does not exactly reproduce the browser's discovery-plan override). Audio interruption and player attachment remain outside this textual evaluation.


## Artist correction: repeated reassurance is central

The artist explicitly corrected the evaluation: apologies, praise, and repeated reassurance must grow more prominent. Earlier comments treating repeated companionship assurances as intrinsically poor dialogue were misaligned. The relevant question is how remembered success, failed guidance, correction, and continued effort change the force of their return.

Removed prompt and continuity instructions suppressing repeated reassurance. Revised the overbearing performance card accordingly. Inspection then found that `companionArc.performanceDirection` was validated and transmitted by the browser but omitted from the assembled provider messages. It is now included in the private stage card; a provider-boundary regression verifies that it reaches the actual prompt. Thus the earlier stage-card-only change could not itself explain output differences.

Evidence: `dialogue-reassurance-sequence.json` records fourteen real replies to fictional sequential events, before the stage-card wiring correction. `dialogue-holdout-before-wiring.json` and `dialogue-holdout-wired.json` record an independent eight-event sequence before and after wiring, all using dots-studio/dots-3-note-preview:free. This is a qualitative comparison, not a statistical causal estimate. No game controls, live player state, or audio were exercised.

After wiring, a repeated failed route elicits an apology followed by a renewed shared attempt. Resistance elicits more expansive praise and a bid to accompany MT. A late violet-light transformation produces “I’m right here, and we’re going home together.” These are aligned with the requested escalation. A late response also prematurely identifies an unawakened crystal as the fourth anchor, before any star is visible. That claim remains an unresolved factual-overreach case; do not classify the full encounter as accepted.

The evaluator now accepts `--scenes=scripts/dialogue-holdout.json` and carries factual history from the selected scenario rather than a hardcoded book/shell relationship summary. It shares the live discovery utterance override. It still resamples silence plans into spoken events, so these transcripts do not demonstrate live speech frequency, audio pacing, or attachment in play.


## Discovery progression

`dialogue-discovery.json` records the current shared production discovery instruction through eight fictional events, including early and late signal, sighting, and collection. The first signal now explicitly says “The star answered.” Both sightings identify a visible star without claiming collection. Both collection replies confirm possession. The fourth collection recalls MT returning from Ariadne's failed route, praises the correction, and incorporates it into their shared success. Text generation took approximately 1.7–2.4 seconds in this sample; this excludes audio and is not a latency guarantee.

Assessment: the textual progression now supports practical orientation and increasingly insistent social interpretation. Recurring reassurance is accepted as central, including promises that exceed what the search establishes. The earlier premature crystal identification remains evidence of model variability; no claim of universal factual compliance or demonstrated player attachment is made. Current production build and automated suite pass. Sustained human play remains the stronger evidence for the combined pacing of movement, silence, voice, and repeated encouragement.


## Current acceptance assessment

The current revision is generally satisfactory against the artist's requested balance: useful early invitation and real star discovery; remembered failed suggestions; correction absorbed through apology and praise; increasingly repeated reassurance that sustains the impossible search. Evidence comprises the sequential real-provider transcripts above, the provider-boundary check proving stage instructions are included, and the progression/discovery/memory tests. This accepts the designed progression, not a claim that every player will feel attachment or every stochastic reply will be factually flawless.

Delivery inspection found that sentence form could reset a late intimate promise to the early confident voice. Renewed claims now preserve intimate or possessive delivery, and direct replies use their relational delivery instead of a randomly selected form's tone. The selected delivery reaches speech synthesis through prepareVocalText. Production build, all 229 tests, and git diff --check pass. Existing tests cover movement/capture fallback, opening delay, immediate direct-caption delivery, no speech overlap, and audio-clock interruption of the final line.

The browser inventory on this pass contained no open in-app play tab. No live session was started, moved, or reloaded. Combined subjective pacing remains open to the artist's next play; the implementation and direct dialogue evaluation are accepted without inventing that observation.
