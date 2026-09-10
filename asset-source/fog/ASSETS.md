# Ariadne in fog — asset delivery

This asset set implements section 8 of the supplied implementation plan. It is
kept under `public/fog/` for integration into the redesigned game. Existing game
media, dialogue code, story cards, and installation files have not been replaced.
The review scene is an asset viewer, not a claim that the game redesign is built.

## Inventory

| Group | Delivered files | Contract |
|---|---:|---|
| Way markers | 8 GLBs | 3 leaning stones, 3 posts, 2 stitches; each has `residue_anchor` and a driveable `marker-emissive` material |
| Node floors | 4 GLBs | 2 stone dishes, a pool, an eight-post ring |
| Termini | 3 GLBs | 2 collapsed-marker arrangements, water's edge |
| Structures | 7 GLBs | Bells, pages, cairn, reeds, instrument, glass, teaching; dormant and awake meshes in each file |
| Fragments | 6 GLBs | One per family, maximum dimension 0.18 m |
| Environmental/interaction audio | 69 WAVs | Mono PCM16, 48 kHz; 18 loops and 51 one-shots |
| Voice cues | 31 MP3s | 11 compatible recordings reused and 20 revised/new lines generated with the existing Ariadne voice. `cues.json` records text and provenance. |
| Title image | 1 PNG | `public/fog/images/ariadne-title-card.png`, 1920 × 1080 |
| Sharing image | 1 PNG | `public/fog/images/og.png`, 1200 × 630 |
| Review images | 35 PNGs + 2 contact sheets | Every model and both structure states rendered in Three.js |

The extra teaching call, three notes, completion chord and awake loop make the
first encounter self-contained. Four extra spoken cues cover the clearing
promise and the three teaching gestures. Four recordings listed as “keep” in
the plan contain “MT”; their revised versions omit the name to follow the
plan's default `you` address.

## Models

Use `public/fog/models.json` as the inventory. glTF 2.0 binary files have embedded
vertex colours and materials, no external textures or baked illumination. Units
are metres; exported axes are +Y up; asset roots are at ground centre. Blender's
Z-up coordinates are converted by the exporter. All exported primitives carry
UVs, normals, tangents and vertex colours.

Each structure has two mesh nodes, `dormant` and `awake`. glTF has no portable
default-visibility flag: **the loader must hide the awake node initially**. Both
are visible if imported without that step. `public/fog/asset-kit.mjs` implements
safe loading, state selection, per-instance material isolation, anchor lookup,
residue control, and instance disposal.

The material contract is one vertex-coloured surface primitive plus a separate
emissive primitive per structure state. This resolves the plan's simultaneous
request for a single surface material and a separately controllable emissive
slot. Rendering one state costs two draws before instancing; the glass material
may require an additional transmission pass. Dark accents are vertex colours,
not another material or draw call. No palette atlas is needed.

The seven structures have respectively 4, 5, 4, 5, 6, 4 and 3 anchors named
`element_01` onward. Anchor extras include `gesture`, `noteHz` and interaction
radius. `call_anchor` locates the spatial audio source; `fragment_anchor`
locates the departure point for a fragment. Anchors are local transforms: use
`getWorldPosition()` after placing an instance. They are not collision meshes.

The teaching structure's anchors are ordered approach → look → listen. Pages
lift and reeds open between states. Other structures change their small
emissive surfaces. The game supplies pulse, clearing, fragment travel and
optional wake motion; there are no baked animation clips.

Colours follow the current resonance palette: bells/teaching `#dbc69b`, pages
`#bcefff`, cairn `#ffd074`, reeds `#9eea76`, instrument `#ff8451`, glass `#8cf1dc`.
Silhouette and limited luminous area carry the family identity. The glass
forms use modest transmission; the remaining structures are matte.

The node pool and water terminus supply their surface geometry and vertex
colour. Reflection and water motion remain runtime shader work, as specified
in the plan. Ground contact and terrain placement should use the actual local
ground height; do not place the whole model at an arbitrary camera-relative Y.

## Audio

`public/fog/audio.json` contains file URLs, duration, loop bounds, event timing,
family, note frequencies, reference levels, and suggested starting gains.

All 69 WAVs are original deterministic synthesis rendered offline. They use
modal resonances, shaped noise, breath textures and restrained harmonic layers;
they do not use the existing square-wave interaction patterns or third-party
recordings. `build_audio.py` is the complete source and provenance.

Each call is 16 seconds, with events at 0.5, 4.5, 8.5 and 12.5 seconds. Schedule
the visual pulse from the manifest's events on the **same AudioContext clock**
that starts the audio buffer. Do not synchronize with an independent timeout.
Call loops are mono for HRTF positioning. Their distance attenuation and the
22 m hearing cutoff belong to the audio graph, not to the sample.

Each element has a 2.8-second note. A six-second completion chord reveals the
family harmony. The 28-second awake ambience is mixed below the call. Fog has
two independent 60-second layers; off-graph hush and water have 30-second loops.
Footsteps have six variants per surface and durations of 0.32–0.41 seconds.

Loops use periodic noise and wrapped tails, without a silent gap at the seam.
Use `loopStart=0`, `loopEnd=duration`, and `loop=true` on decoded AudioBuffers.
Levels have at least 6 dB of sample headroom. Suggested gains are starting mix
values: final balancing against Ariadne's speech needs the game's audio buses.
Load samples lazily rather than decoding the entire 57 MiB WAV library
at startup. This delivery prioritizes exact, broadly decodable loop masters;
compressed deployment derivatives can be added without replacing the masters.

## Voice

`public/fog/cues.json` is the text/audio truth source. Existing compatible cues
retain their recordings. Revised cues use the project's current voice ID and
speech provider; the generator does not print or persist credentials. It skips
files already generated and uses the same bounded free-model/paid-model
fallback as the application. It must not substitute another voice silently.

All 31 recordings are available. The author approved sending the 20 new lines
to OpenRouter/Fish Audio, and those recordings use the existing Ariadne voice.
`cue-validation.json` records successful decoding and durations for every cue.
The complete text is in the manifest and in `build_cues.py`. Run `--prepare` to
prepare text and reuse old files without reading credentials or making requests.

The resume stub is an optional cue, not an implementation of resume-mid-sentence.
Actual sentence restoration requires the game to persist the current recording
and playback offset. Playing the stub on every return would change the plan.

## Review and rebuild

From the Ariadne project root:

```sh
npm ci --prefix asset-source/tools --ignore-scripts
python3 asset-source/fog/serve.py
```

Open `http://localhost:4178/fog/review.html`. Select models, toggle states and fog,
compare 5/12/20 m views, and audition every available sound and cue. The review
server binds only to loopback. “Export asset images” renders 35 model images and
the two title images directly from the current Three.js scene. The server's
write endpoint accepts PNGs from that local origin only, in the images folder.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python asset-source/fog/build_models.py
python3 asset-source/fog/build_audio.py
python3 asset-source/fog/build_cues.py --prepare
node asset-source/fog/validate.mjs
python3 asset-source/fog/audit_audio.py
python3 asset-source/fog/contact_sheets.py
```

Voice generation, after permission: `python3 asset-source/fog/build_cues.py`.
An optional Playwright render script, `capture.mjs`, accepts the path to an
installed Playwright module as its argument. The viewer's export control avoids
that dependency and captures the same actual assets.

Three.js and Khronos glTF Validator are pinned under `asset-source/tools/`.
The main game's dependency files are unchanged. Geometry source requires
Blender 4.3+; audio source uses NumPy and SciPy; contact sheets use Pillow.

## Verification and integration boundary

`gltf-validation.json` records official Khronos validation, required anchors,
tangents and upper triangle budgets. `audio-validation.json` records WAV format,
duration, headroom, uniqueness and loop-seam checks. `models.json` gives actual
bounds and triangle counts rather than nominal estimates.

The contact sheets and title images have been visually inspected. The browser
viewer loads the exported GLBs and exposes both states. These checks establish
asset integrity and visibility in the review environment; they do not establish
the performance or audience effect of the complete game, which is not built by
this asset task.

No new .blend file is saved. The deterministic model script is the editable
game-asset source, preserving the workspace's single-copy Blender rule and the
existing `Ariadne-Installation-50mm.blend` scene. The installation image and
fabrication specifications are not part of this game-asset change.
