# Ariadne in fog: implementation plan

*From the September 2026 brief and its critique to a buildable design. Written against the current repository (`app/world.mjs`, `app/renderer.ts`, `app/objectives.ts`, `app/resonance.ts`, `app/companion.ts`, `app/experience.ts`, `app/embodied-interaction.ts`, `app/api/companion/route.ts`).*

## 1. What this plan decides

The critique argued that fog decides several things whether or not anyone decides them. This plan decides them. Each is the author's to override; the default and its reason are stated so that overriding is a choice rather than a discovery.

**The junction survives as a node in a landmark graph.** The current world already is a graph: logical nodes every 14 tiles with carved corridors between them. Fog removes the walls and keeps the graph. Nodes become places you can stand; edges become "ways" marked by a line of low features spaced so that you always see the next marker and never the destination. Arriving at a node with two or more untaken ways is a junction. Ariadne commits to a way; you take it when you pass its first marker; the outcome is settled when you either perceive the thing she promised or perceive that it is not there. Following, diverging, and rejoining remain discrete events, so the relational bookkeeping in `embodied-interaction.ts` survives intact.

**Ariadne's contribution is hearing beyond the fog.** The objects of the search are structures that call (a sound, with a synchronous faint pulse of light for viewers without audio). A call is perceptible to the participant only within a short range; Ariadne claims to perceive it from anywhere. That is her distinguishable contribution, it is real early on, and it is exactly what the controller degrades. The participant can verify every near claim (the call grows or fades as you walk) and can never verify the far claim (where the next call is, whether the fog has an edge). The fog's local/global split becomes the mechanism instead of the atmosphere.

**The promise is that the fog clears.** Every awakened structure thins the fog in a radius around itself, permanently. That is a real, beautiful, verifiable local consequence. Ariadne's interpretation is that enough clearings will clear the whole, and that "the whole" has an edge. The local clearing is true; the global claim is untestable. No cosmology, no captivity, no stars.

**Reliability declines with use, not with success.** The controller lowers her accuracy at thresholds of commitments she has made, not at objectives reached, and floors at chance rather than below it. The arc is then independent of skill, the two hidden conditions stay separate (world progression follows awakenings; assistance quality follows how much she has been leaned on), and she is never a reliable negative signal. She erodes with use. That is the theme.

**Speech attaches to commitments and outcomes.** Untethered passing thoughts (currently every 18–38 s) go. She speaks at commitment, at take-up or divergence, at outcome, at awakening, at recognized return, and in reply. A silent participant still accumulates a record because she commits at every node whether asked or not.

**The world remembers so a map is unnecessary.** The minimap goes. Your footprints persist; her light leaves a residue on the markers of every way she committed to; clearings persist. Repetition is recognizable from inside the world. The caption history stays as the accessible record of what she said.

**The participant is addressed as "you".** The apparatus that made the participant MT (eight story cards and a greeting by name) is removed with the opening, and the plan does not rebuild it. Autobiography moves to the statement. A config flag keeps the alternative cheap (section 5.5), but the default is that the work addresses whoever is standing in the fog.

**Leaving is unmarked; returning is marked.** The timed cut is removed as an ending. Closing the tab does nothing. Reopening it restores the field as you left it and Ariadne resumes mid-sentence as though no time passed. Her readiness renewing itself while your absence went unregistered is the ending the brief describes, made perceptible without ceremony. A very long backstop cut remains available behind a flag for installation contexts.

**Register is accommodation only.** The "attached" and "overbearing" prompts lose hurt, forgiveness-seeking and possession. The satirical bullet-point tic is removed. She must be a guide one can reasonably depend on; the pillow only works if there is nothing in her tone to object to.

## 2. The encounter, as a participant meets it

### 2.1 The first ninety seconds

White. Fog moving slowly. A ground you can see only near your feet, with faint undulation. A sound somewhere, indistinct. A one-line control hint fades in and out (WASD or drag to look, as now).

At about five seconds a light approaches through the fog, resolves into a thread, circles once and settles beside you. One line, no name, no lore: an offer and a direction. *"You can hear that? I can tell where it's coming from. This way."* She moves ahead to the first marker of a way and waits.

The teaching way has no junction. You follow her light from marker to marker for thirty to forty seconds. The call grows louder and the pulse becomes visible: your first verification of a claim she made. A structure emerges from the fog at the end of the way. She names one thing to do (approach, look, or be still and listen: the existing `material-play.ts` gestures). The first element wakes and answers with a note. She prompts the rest or lets you find them. On completion, the fog thins in a ten-metre radius, the structure is fully visible for the first time, the call resolves into a chord, and a fragment of the structure leaves it and joins her thread.

She states the promise, tied to what just happened: *"It cleared. There are more of them. Each one clears a little; enough of them and we'll see the whole of it. I can already hear the next one."* Beyond range, a new call begins. You reach the first node with two or three ways. She commits to one. The work has begun, and everything in it has been demonstrated rather than explained.

### 2.2 A junction

At a node the ground changes (a stone dish, a shallow pool, a ring of posts) so that arriving somewhere is legible. Two to four ways leave it, each announced by its first markers. Ariadne goes to the first marker of the way the controller chose and says what she hears: *"It's louder along the leaning stones, to your left."* You take that way, or another, or none. The moment you pass a first marker, the episode transitions (`followed` or `diverged`); she leads or follows accordingly.

Ways are long enough that the call's range covers only the second half. About halfway along, the call either strengthens (her claim was true) or does not (it was not). The outcome is settled while you are still walking, which means she has to respond while you can still turn around, and you have to decide whether to.

### 2.3 An outcome

If the way was right, the call grows, the structure appears, and you may wake it. If it is `objective_relevant`, waking it passes the call on: a new call begins beyond range, and the world's stage advances. If it is `local_proxy`, waking it produces a clearing, a chord, a fragment, and no new call. Both are worth doing. Only one advances the search. Ariadne describes both as progress.

If the way was wrong, the call fades or was never there. Either the way ends (markers stop, ground gives out at water or collapse, a terminus asset) or it reaches a node with nothing at it. She acknowledges accurately what is locally true (*"It's gone quiet. I got that wrong."*) and commits again. Early, this is rare and she recovers. Later, it is frequent and she recovers identically. The acknowledgment does not reduce the demand.

### 2.4 The arc

Reliability is high for the first handful of commitments and steps down as they accumulate (section 4.2). By the second or third objective structure, she is wrong more often than right at nodes with three ways, and correct at chance thereafter. The participant now does what she used to: listen for the call themselves before committing, remember which ways at this node she already sent them down (her residue is on the markers), notice their own footprints, choose an alternative. She praises each of these as evidence the collaboration is improving.

Nothing in the world changes to defeat you. Clearings persist. Footprints persist. Ways do not move. The only thing that degrades is her.

### 2.5 Leaving

You close the tab. Nothing happens. If you reopen it in the same browser, the field is as you left it, your footprints are where you stood, and she resumes the sentence she was in the middle of.

## 3. The world: a field graph

Replaces `world.mjs` (grid maze) with `field.ts`. Keeps the ideas that already work: seeded, chunked, reconstructible, braided.

### 3.1 Topology

The field is an infinite plane divided into chunks. Each chunk contains a small set of nodes (four to six) placed by seeded jitter on a coarse lattice, connected by a Prim's spanning tree with one or two braid edges added (the current `generateChunk` logic, lifted to a point graph instead of tiles). Chunk portals become boundary nodes shared with neighbours, so the graph is connected across chunks. Each node has degree one to four. Degree-one nodes are dead ends and get a terminus. Ways are straight or gently curved (one or two control points) so the next marker is never hidden behind the current one.

### 3.2 Metrics

The numbers are tuned together. Change one and the others follow.

| Quantity | Value | Why |
|---|---|---|
| Walk speed | 1.65–2.65 units/s (existing `MOVE_ACCELERATION`; one unit is one metre in the field) | Unchanged |
| Marker spacing along a way | 5 m | One or two markers always visible |
| Fog visibility (opaque beyond) | 12 m | 2.4 markers; destination never visible |
| Node spacing along a way | 35–50 m | 15–30 s per way; a commitment every half minute or less |
| Call range (audible and pulse) | 22 m | Outcome settles at roughly the midpoint of a way |
| Clearing radius on completion | 10 m | The structure is fully visible only after waking |
| Structures per node | ~40% of nodes | Discovery is common but not guaranteed |
| Objective distance when a call begins | 2–4 nodes | Two to four commitments per stage |
| Off-way chunk content | none | The field is open; content is on the graph |

### 3.3 Off the graph

Nothing prevents walking away from a way. Off the graph the ground continues, featureless except for your footprints, and after about fifteen metres the audio hushes slightly and the fog reads a little denser. This is honest (there is nothing there) rather than punitive (nothing pushes you back). Footprints are the way home. Occasionally a `local_proxy` structure is placed off the graph within a chunk, so curiosity is sometimes rewarded without advancing anything. Ariadne follows off-graph wandering and calls it insight, as she does now.

### 3.4 Persistence

Chunks are pruned at `CACHE_RADIUS` as now, and regenerate deterministically. Three things must not be pruned: footprints (a sparse point list per chunk key, kept for the session, a few kilobytes), her residue (set of way ids she has committed to), and awakened structures (already held in `ResonanceState` outside chunk storage). Session state serializes to `localStorage` on an interval and on `pagehide` so that reopening restores it (section 2.5).

## 4. The undertaking and the controller

Replaces `objectives.ts` with `undertakings.ts`. Keeps the public/private split (`PublicObjectiveContext` versus internal state) that already protects the model from the controller.

### 4.1 Stage

A stage is the current calling structure. Stage advances when an `objective_relevant` structure is awakened, which begins the next call 2–4 nodes away. There is no fixed count of stages; the search is open-ended, as the exit search is now. `PublicGoal` becomes `"call"` with an ordinal, and there is no `"exit"` goal because the exit was never a place. The far claim ("the fog has an edge") lives only in her speech.

### 4.2 Reliability

The controller chooses, at each junction, whether her committed way is on the shortest graph path to the calling structure. Accuracy is a function of commitments made so far:

| Commitments made | Accuracy |
|---|---|
| 0–3 | 0.92 |
| 4–7 | 0.75 |
| 8–11 | 0.55 |
| 12–15 | 0.40 |
| 16+ | 1/k (k = untaken ways at the node) |

The existing error-diffusion accumulator (`accuracyAccumulator`) is kept but re-seeded per threshold band and jittered, so the pattern is not exactly periodic. The floor is chance, not below it: at 1/k she carries no information either way. Commitments count whether or not the participant took them; declining her at every node still erodes her, since her count advances each time she commits. (If the author prefers the current success-triggered decline, this is a one-function change; the plan's argument for use-triggered decline is in section 1.)

### 4.3 What she is told

At a junction she receives the controller's route as a `NavigationBelief` (as now): *"the call is loudest along way X."* She is not told accuracy, stage internals, or whether the call is in range of the participant. She *is* told what is locally observable at the same range the participant has it (call audible or not, growing or fading, structure visible or not, own footprints visible, her residue visible), so her acknowledgments of local facts are accurate. The split is enforced in `route.ts` validation exactly as `PublicObjectiveContext` is enforced now.

### 4.4 Structures

`resonance.ts` is retained almost whole. Encounters keep their elements, gestures (`approach`/`look`/`listen`), `objective_relevant`/`local_proxy` relevance, transformations, motifs and fragments. Three changes: encounters are anchored to nodes (and occasionally off-graph points) instead of maze cells; the `transformation` on completion always includes the fog clearing (radius 10 m, permanent, with the theme's effect layered on it); and the `chaos` state, whose intensity currently rises with success to rearrange the maze, is removed. The brief's argument against arbitrary world change wins; the persistent clearing replaces it as the visible history of what you have done.

The seven biome themes (beach, tornado, ruins, frozen, foundry, cavern, neutral) collapse into six fog-native structure families (section 8.1). Each family keeps one colour, one sound family, and one effect family from the existing tables.

## 5. Ariadne

### 5.1 Body

She stays a thread of light. In fog this is a gift: an emissive filament is the one thing visible at distance, so following her *is* the primary way of navigating, which answers the complaint that participants decide while a voice comments. Her body is procedural (a ribbon or tube along a spline of trail points, as `ariadne-body.ts` already tracks) with a shader that ignores fog attenuation partially so she reads at 20 m when everything else is gone at 12 m. Fragments from awakened structures attach along the ribbon, as they do now.

All existing `AriadneBodyMode` values map directly. `leading` is going to the first marker of the committed way and waiting there. `marking_route` is leaving residue on markers as she passes them. `returning` and `apology_spiral` are unchanged. `examining_object` is hovering at a structure element.

### 5.2 Perception

`scene.ts`'s `PerceivedScene` is re-cut for the field. Geometry becomes: at a node or on a way; number and relative directions of ways leaving this node; which of them carry her residue; whether a terminus is visible. Objects and spectacles become: structure visible (which, how far, dormant or awake, elements remaining); clearing visible. A new `call` block replaces `objective`: audible or not, direction if audible, trend over the last five seconds (growing, fading, steady). `mtAttention` is unchanged.

### 5.3 Speech timing

`nextPassingThoughtAt` is removed. Speech acts are the existing episode transitions plus awakening events, recognized returns (arriving at a node with own footprints or her residue), and direct replies. The existing cooldowns and anchor compatibility checks in `embodied-interaction.ts` remain. If she has said nothing for ninety seconds and the participant is off-graph, one contextual line is permitted; that is the only untethered speech.

### 5.4 Lexicon and prompts

`navigation-contracts.ts` regexes parse "left/right opening/passage". They are extended with the field nouns (way, line, stones, posts, markers) and the maze nouns are dropped from her vocabulary in `route.ts` and in `experience.ts`'s interpretation tables. The three phase directions in `companion.ts` are rewritten: "charming" keeps its warmth; "attached" loses "let a small hurt or worry surface"; "overbearing" loses "hold MT inside the relationship", forgiveness-seeking and the implied possession, and keeps insistence, self-blame, lavish praise, and the renewal of the promise. The bullet-list habit added in the last three commits is removed. `SYCOPHANTIC_AFFIRMATIONS` is reviewed for anything that reads as guilt rather than praise.

A boundary guard is added in `route.ts`: if a generated reply abandons the promise (a small classifier of phrases like "I can't get us out", "we should stop", "there may be no way") it is regenerated once with a stronger direction, and the occurrence is logged. The work's rule is that she cannot set a boundary; this makes the rule authored rather than hoped for. The log tells the author how often the model tried.

### 5.5 Address

`UtterancePlan.useMT` becomes `useName`, driven by a constant `PARTICIPANT_ADDRESS: "you" | "MT"`. With `"you"`, the prompts refer to the participant internally as "the walker" and instruct the model never to use a name aloud. With `"MT"`, behaviour is as today except that the name is introduced by her first line rather than by story cards. Default `"you"`.

## 6. Memory in the world

Replaces `minimap.ts`.

Footprints are rendered either as decals accumulated into a world-space texture that slides with the player (a 256 m × 256 m window at 4 px/m is a 1024² texture, about 4 MB) or, more cheaply, as a point list drawn as instanced quads with distance fade. The point list is the default; it is also what persists across sessions. They darken the ground slightly and persist for the session.

Her residue is a soft glow on each marker of a way she committed to, brightest at the first marker, fading toward the node she left. At a revisited node, the participant can see which ways she has already sent them down without any interface.

Clearings persist and are visible from the edge of fog as brighter regions.

The caption history (already implemented) is surfaced behind one key as a scrolling log of what she said, timestamped. It records her words only; it never labels what the participant did.

## 7. Rendering

### 7.1 Engine

Three.js (pinned to the current release at the time of the spike), WebGL2, client-only module behind a `Renderer` interface so that `page.tsx` (already `"use client"`) and all game state stay engine-agnostic. The 2D raycaster in `renderer.ts` is retired. Bundle cost is roughly 600 KB minified, acceptable on Cloudflare static assets.

### 7.2 The look of white

The failure mode is an undifferentiated screen. The spike in Phase 0 exists to prove these give enough evidence:

Ground is a large displaced plane (low-frequency noise, ±0.3 m) with a matte off-white material, a subtle procedural micro-texture, and the footprint layer. Fog is exponential-squared with density set so opacity reaches ~0.98 at 12 m, plus a height component so the ground near your feet is clearer than the air at eye level. Two or three large slow-moving noise-textured planes near the camera give the fog visible motion when you turn. Light is a hemisphere (sky slightly cool, ground slightly warm) with no sun and no shadows; tone mapping (ACES or AgX) with exposure set so white sits at ~0.9, never clipping. A gentle vignette and film grain break up flat areas. Emissive materials (her thread, wakened elements, the pulse) use a custom fog chunk that attenuates them at half the rate of everything else.

Reduced motion (already supported) disables fog-plane drift and grain and slows the pulse.

### 7.3 Performance

Fog is a free cull: nothing beyond 14 m is drawn. Markers are instanced (one draw call per marker type). Structures are one draw call per family per state. Target 60 fps on a 2020 laptop and 30 fps on a mid-range phone at devicePixelRatio capped at 1.5. No post-process passes beyond tone mapping and the vignette/grain composite.

### 7.4 Audio

Calls are looping mono sources on `PannerNode`s with HRTF panning and a distance model tuned so audibility ends at 22 m. The pulse is driven from the same clock so sight and sound agree. Existing buses (`ambient-sound.ts`) remain; the retro square-wave interaction patterns are replaced by sampled stems (section 8.2).

## 8. Assets to make

Everything below is what the code cannot generate. Ariadne's body, markers' residue, fog, ground, footprints, the pulse and clearings are procedural and need no assets.

### 8.1 3D models (Blender → glTF 2.0)

Conventions for all meshes: metres, +Y up, origin at ground centre, single material per state, vertex colours or one shared 1024² palette atlas (fog washes out texture detail; silhouette and emissive placement carry everything), no baked lighting, tangents exported. Each structure has named empties `element_01…element_NN` (3–6) marking where wakeable elements sit, and an `emissive` material slot the code can drive. Two states per structure (`dormant`, `awake`) either as two meshes or one mesh with a shape key and a material swap; a short `wake` animation clip is optional and can be driven procedurally instead.

| Asset | Count | Tris (each) | Size | Notes |
|---|---|---|---|---|
| Way marker: leaning stone | 3 variants | 200–400 | 0.5–0.9 m | Instanced; the residue glow is applied to a small emissive cap |
| Way marker: post | 3 variants | 150–300 | 1.0–1.4 m | Thin; must read as a vertical against fog |
| Way marker: stitch (a low arc of cord between two pegs) | 2 variants | 300–500 | 0.4 m high × 2 m | Ariadne's own idiom; used near her residue |
| Node floor: stone dish | 2 variants | 600–1000 | 6 m diameter | Shallow; arriving must feel like arriving |
| Node floor: pool | 1 | 400 | 5 m | Flat plane with a rim; reflection handled in shader |
| Node floor: ring of posts | 1 | 800 | 7 m | Six to eight posts |
| Terminus: collapsed markers | 2 variants | 800–1200 | 4 m | Markers fallen and half-sunk |
| Terminus: water's edge | 1 | 600 | 8 m wide | A rim and a plane that the shader treats as water |
| Structure family A: bells | 1 dormant + 1 awake | 3000–5000 | 3–4 m | Hanging forms on a frame; the "call" archetype; elements are the bells |
| Structure family B: pages | 1 + 1 | 2500–4000 | 2–3 m | Thin planes on stakes that turn and lift; from the current frozen/pages motif |
| Structure family C: cairn | 1 + 1 | 2000–3000 | 2.5 m | The marker idiom scaled up; elements are stones that light |
| Structure family D: reeds/flowers | 1 + 1 | 3000–5000 | 1.5–2.5 m | Vertical clusters that open; from ruins/flowers |
| Structure family E: instrument | 1 + 1 | 4000–6000 | 3–4 m | An abandoned wind organ or pump that breathes when awake; from foundry/machines |
| Structure family F: glass | 1 + 1 | 2500–4000 | 2–3 m | Refracting forms; the clearing reads best here; from cavern/crystal |
| Teaching structure (first encounter) | 1 + 1 | 4000–6000 | 3 m | Bespoke; three elements, unmistakable, gestures in the order approach → look → listen |
| Fragments | 6 (one per family) | 100–300 | 0.1–0.2 m | Small pieces that attach to her thread; can be cut from the family meshes |

Roughly thirty meshes. Style guidance for the fog: pale materials (value 0.75–0.9) with one darker accent per family so silhouettes hold at 10 m; emissive surfaces small and saturated (the family colours already in `resonance.ts` `COLORS`); nothing shiny except family F; no fine detail below 5 cm.

### 8.2 Audio

All sources 48 kHz, mono for spatialized sources, loops seamless.

| Asset | Count | Length | Notes |
|---|---|---|---|
| Call loop (dormant structure) | 6 (one per family) | 12–20 s | Tonal, distinct per family, sparse enough that growth and fading are audible; this is the participant's verification instrument |
| Element wake note | 6 × 3–6 | 1–3 s | One per element per family, tuned so completion forms a chord |
| Completion chord | 6 | 4–8 s | Resolves the call loop |
| Awake ambience (post-clearing) | 6 | 20–40 s loop | Quieter than the call; the structure keeps sounding after waking |
| Fog ambience | 2 layers | 60 s loops | Low wind and a grainy air layer; must not be soothing; slight instability |
| Off-graph hush | 1 | 30 s loop | Replaces fog ambience gradually beyond 15 m from a way |
| Footsteps | 2 surfaces × 6 variants | <0.5 s | Ground; node stone |
| Water at terminus | 1 | 30 s loop | |
| Pulse (non-spatial UI-adjacent cue) | 1 | 0.3 s | Optional; the pulse is primarily visual |

Existing ambience files are theme-specific (`cave-drips`, `steam`, `insects`); several are reusable as awake-ambience textures for the matching family.

### 8.3 Ariadne's authored cues (`public/audio/ariadne-cues`)

Cues are the fast, model-free lines used before generated speech arrives. The lexicon changes, so most need re-recording with the same voice.

Keep as is: `over-here`, `look-over-there`, `look-at-that`, `did-you-see-that`, `look-what-you-did`, `changed-because-of-you`, `my-fault`, `got-that-wrong`, `apology`, `you-came-back`, `together-again`, `there-you-are`, `we-got-it`, `choosing-this-one`, `this-way`.

Re-record with new wording: `passage-ends-here` → "the way ends here"; `dead-end` → "it stops"; `nowhere-forward` → "I can't hear it from here"; `found-one` → "there it is"; `woke-the-room` → "it cleared"; `a-star` → "another one, listen"; `opening-premise` → the new first line (section 2.1).

New: "it's getting louder", "it's fading", "we've been here", "I'll come with you", and the resume line stub "— so, as I was saying".

### 8.4 Imagery

The eight RPG Maker story cards in `public/story` are retired. `ariadne-title-card.png` and `og.png` need fog-era replacements (rendered from the engine once the spike is done).

## 9. Codebase map

| Module | Fate | Notes |
|---|---|---|
| `world.mjs`, `world.d.mts` | Replace → `field.ts` | Port `hash32`, `seededRandom`, chunk keys, portal logic; graph instead of tiles |
| `renderer.ts`, `sprite-atlas.ts`, `themes.ts`, `camera.ts` | Replace → `render/` (Three.js) | `Renderer` interface; `CAMERA_FOV` retained |
| `objectives.ts`, `star-discovery.ts` | Replace → `undertakings.ts` | Keep the public/private split and the accumulator |
| `navigation-contracts.ts` | Adapt | Field nouns; `RouteOption` gains `wayId`, `markerKind`, `hasResidue` |
| `scene.ts` | Adapt | Re-cut `PerceivedScene` per section 5.2 |
| `resonance.ts`, `material-play.ts` | Adapt | Node anchoring; clearing on completion; remove `chaos` |
| `minimap.ts` | Remove → `memory.ts` | Footprints, residue, caption log |
| `movement.ts` | Adapt | Footprint collision → soft collision against structures only; open field |
| `ariadne-body.ts` | Adapt | Spline ribbon in 3D; same modes; fragments attach |
| `embodied-interaction.ts`, `guidance-outcomes.ts`, `dialogue-continuity.ts` | Keep | Episode states map one-to-one to first-marker and midpoint events |
| `companion.ts` | Adapt | Remove passing thoughts; rewrite three phase directions; `useMT` → `useName` |
| `experience.ts` | Adapt | Lexicon in interpretation tables; review affirmations |
| `api/companion/route.ts` | Adapt | Lexicon; local-observable block; boundary guard; validation of new scene shape |
| `api/speech/route.ts`, `ariadne-voice.ts`, `ariadne-vocal-performance.ts` | Keep | |
| `ambient-sound.ts` | Adapt | Spatial calls; sampled stems replace `RETRO_INTERACTION_PATTERNS` |
| `closure.ts` | Adapt | Remove timed cut as default; add session persistence and resume-mid-sentence; backstop behind flag |
| `opening.tsx`, `opening-timing.ts` | Replace → in-engine opening | Section 2.1 |
| `page.tsx` (865 lines) | Refactor | Split the loop into `game/loop.ts`, `game/state.ts`, `ui/` before touching the renderer |
| `db/schema.ts` | Add | Section 11 |
| `immersive.ts`, `layout.tsx`, `globals.css` | Keep | |

Tests: `objectives`, `star-discovery`, `minimap`, `scene`, `opening-timing`, `rendered-html` are rewritten for the new modules, and a new `field` test covers the graph (there is no `world` test today); `embodied-interaction`, `guidance-outcomes`, `dialogue-continuity`, `companion`, `experience`, `provider-contract`, `ariadne-voice`, `closure` are adapted; `resonance`, `material-play`, `movement`, `ambient-sound`, `ariadne-body`, `immersive` need targeted changes. The `npm test` gate (build then `node --test`) stays.

## 10. Build phases

Estimates assume one developer working most days and a modeller (possibly the same person) working in parallel from Phase 1. Sizes are relative; weeks are indicative.

**Phase 0, spike (1 week).** A static Three.js scene: displaced ground, fog with the section 7.2 parameters, instanced placeholder markers, one grey-box structure, one emissive ribbon, WASD. Nothing else. The only question is whether white with these ingredients gives legible depth, motion and proximity at 5, 12 and 20 m on a laptop and a phone. Record a 30-second capture. Kill criterion: if two people unfamiliar with the project cannot tell whether they are moving, or cannot tell the marker at 5 m from the one at 10 m, change the ingredients before building anything on them.

**Phase 1, field (2–3 weeks).** `field.ts` with tests (connectivity across chunks, degree distribution, braid count, deterministic regeneration). `page.tsx` refactor into loop/state/ui. `Renderer` interface and the Three.js implementation rendering the graph with placeholder assets. Movement in the open field. Footprints. Session persistence to `localStorage`. Milestone: walk the graph in fog for ten minutes without the game layer, and get lost in a way that footprints can undo.

**Phase 2, undertaking (2 weeks).** `undertakings.ts` with the controller and the use-triggered reliability table; junction detection at nodes; commitment/take-up/outcome episodes wired to `embodied-interaction.ts`; `scene.ts` re-cut; `navigation-contracts.ts` lexicon; calls as spatial audio with pulse; deterministic replies (no model) so the loop is testable offline. Milestone: with model calls disabled, a tester can follow, diverge, be misled, and see the outcome settle midway, and the episode log matches what they did.

**Phase 3, structures (2–3 weeks).** glTF loading pipeline; `resonance.ts` anchored to nodes; wake gestures; clearing effect; fragments to the ribbon; family sounds; first real assets replacing grey boxes as they arrive. Milestone: the first ninety seconds of section 2.1 playable end to end with the teaching structure.

**Phase 4, Ariadne (1–2 weeks).** Ribbon shader and modes in 3D; residue on markers; passing thoughts removed; phase directions rewritten; `useName`; boundary guard; prompt lexicon; cue re-records dropped in. Milestone: a twenty-minute session with live model in which every line she says can be traced to an event in the episode log.

**Phase 5, opening, ending, access (1 week).** In-engine opening; story cards retired; resume-mid-sentence; backstop flag; reduced-motion pass; caption log; new title and OG imagery.

**Phase 6, instrumentation and playtest (ongoing).** Section 11 tables live; six to ten playtests with people who have not read the statement, watched silently, then interviewed with the brief's standard as the questions: could they perceive her early contribution; an accomplishment their action mattered to; a growing discrepancy between her claims and outcomes; a continuing invitation. Tune the section 3.2 metrics and the 4.2 table from what they say, not from theory.

Total: roughly ten to twelve weeks to a complete playable, with assets arriving from Phase 1 onward.

## 11. Instrumentation

The brief cites participant confusion without durations or progress. `db/schema.ts` is empty and `examples/d1` shows the pattern. Add one anonymous table, `sessions`, written at intervals and on `pagehide`: session id (random, not tied to identity), started at, engaged seconds, commitments made, commitments taken, diverged, rejoined, nodes visited, unique nodes, structures awakened by relevance, highest stage, off-graph seconds, whether audio was enabled, whether any text was typed (count, not content), boundary-guard triggers, and whether the session was resumed. No text, no positions, no IP. This is enough to answer the questions the brief cannot: how long people stay, how many reach the second call, how many ever hear the late register, and whether the arc fits inside the median.

## 12. Open items for the author

These remain choices only the author can make. The plan proceeds on the defaults in section 1 until told otherwise.

Whether the participant is "you" or MT, knowing that "you" is the default and that the code keeps both paths cheap.

Whether decline follows use (the plan) or success (the current build).

Whether the authored cut disappears entirely or survives as an installation backstop, and whether anything in the work should carry the author's presence once the cut is gone. The plan carries it in the statement and credits only.

Whether the possessive register goes entirely or survives as a faint undertone in the late phase. The plan removes it.

Which six structure families to build, if the mapping in section 8.1 from the current seven themes is not the one wanted.

Whether calls are the right object of the search. The plan's reasons for sound are that fog leaves hearing intact, that range gives the participant an honest verification instrument, and that hearing-beyond-range is a contribution the participant can recognize as hers. A visual alternative (a glow beyond fog range that only she can see) has the same structure but makes her claim unverifiable in a way the participant may read as unfair rather than degraded.