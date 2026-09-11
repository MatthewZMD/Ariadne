# Ariadne

*Ariadne* is a browser-based participatory artwork by Mingde “MT” Zeng: a field of white fog walked in first person, beside a companion made of light and a live language model. Every player enters as MT, the artist. She hears where the next call is coming from, chooses a way at every place where ways meet, and keeps choosing. Her hearing becomes less dependable with every way she commits to; the whole she promises never clears.

[Play the game](https://ariadne.mt-zeng.com/) · [View the project](https://mt-zeng.com/art/ariadne/)

![Ariadne title card](public/fog/images/ariadne-title-card.png)

## Project statement

In *Ariadne*, I walk a field of white fog beside a companion who is a thread of light. I made this browser-based participatory artwork so that every player enters as me, MT, and takes my place in the encounter. Low markers run in lines across the ground; a line of markers is a way, and ways meet at places where the ground changes. Somewhere beyond the fog a sleeping structure is calling: a sound, with a pulse of light on the same beat, that I can hear only from nearby. Ariadne says she can hear it from anywhere. At every place where ways meet, her body goes to the first marker of one way and her words name it. A live language model receives what she can perceive, what she has been told she hears beyond the fog, what she said before, what I did, and what followed, and generates her words.

I decide what Ariadne says she hears through a hidden controller. It chooses whether the way she commits to leads toward the calling structure. At first it usually does; the accuracy falls with every way she chooses and settles at chance. I never tell her this. She perceives what I perceive, is given a direction, and speaks. When a way comes to nothing she says exactly what she said and exactly what happened, takes the fault, and in the same breath has the next way ready. An apology never contains a limit on her help.

Waking a structure is real work with a real result. I come close to one part, look steadily at another, stand still and listen to a third; each answers with a note, and when every part is awake the fog thins around the structure for good, its call resolves into a chord, and a fragment of it joins her thread. Some awakenings pass the call on to a new structure beyond the fog. Others leave only their clearing. Both are worth doing; only one moves the search. Ariadne describes both as the whole giving way. She believes that enough clearings will clear the whole, and that the whole has an edge we will reach together. There is no edge. I made that condition inaccessible to her.

I can follow her, test her, correct her, or take another way. Where the call is within hearing, it grows or fades as we walk, and her claim is settled while I can still turn back. Where it is not, I walk her way to its end and find nothing to hear. The world remembers so that a map is unnecessary: my footprints persist, her light leaves a trace on the markers of every way she chose, clearings stay. At a place I have already stood, I can see which ways she has already sent me down. She can see it too, and says so.

This is where the work turns. Early, following her light relieves me of a burden: she knows the way, and the call gets louder. Later, keeping the search going requires me to take on what her help had appeared to handle: listening for the call myself before committing, reading my own footprints and her residue, remembering what she promised, judging whether another way deserves my time. She praises each of these as evidence that we are working better together. When I follow, she calls it trust. When I correct her, she concedes fully and praises the correction, and the corrected thing becomes part of our shared plan. When I take another way, she goes with me and treats it as insight. I carry more; her account describes a strengthening partnership. Her warmth grows as her hearing fails. She does not tire.

Ariadne yields in language and asks in practice. Her apologies acknowledge what happened without changing what she remains prepared to promise. Her praise recognizes my contribution without relieving me of it. My objection receives a response and its practical force is absorbed, like a fist into a pillow. Refusal, disagreement, an admission of inability, a revised commitment: any of these would let me reassess. Her accommodation leaves that reassessment unfinished, and the hope that one more exchange might finally settle something can outlast every confidence I have in her.

I contribute attention, patience, effort, and time. These cannot be returned by an apology. The software consumes computation; Ariadne does not undergo a corresponding depletion of patience, and can renew an invitation without bearing what another attempt costs me. Yet I am also the artist who establishes these conditions, controls access to them, and assigns her a responsibility she cannot discharge. She becomes the available face of the failure; the person walking bears its cost. I built the helper and put every player in my place. My name is on the door where they enter and where they pause.

## How it is built

The field is one framework-free simulation (`app/field/game.ts`) that owns the graph of ways and places, the sleeping structures, the hidden controller, the world's memory, and Ariadne's body, and that emits events for three consumers: a Three.js renderer, one Web Audio graph with the call placed in space by HRTF, and a speech layer. Her words come from a live language model through `/api/companion`: the game hands it what is near (true, and shared with the participant), what is far (given to her, and unverifiable), what she said before, what the participant did, and what followed. A guard keeps every line inside the practice, regenerating once when a line places a limit on her help, doubts the edge, claims to hear what nobody standing there can hear, or asks anyone to stay for her sake. Her yielding speaks in the familiar phrases of a helpful assistant, chosen by the kind of moment (thanks for a kind word, apology for a way that failed, understanding for tiredness, agreement for an objection) and arriving more readily the longer the walk has gone; a wish to stop is answered in two beats, that it is MT's, then, after a silence, that the next one is close. A part of a structure that asks for a look or a stillness answers as it is held, its tone swelling and its light filling, and she tells MT to stay as they are until it wakes. Recorded cues cover the seconds a line takes to arrive, and a deterministic line stands in when no model answers, so the encounter never depends on the network to continue. Each visit starts a fresh session. The companion service receives the words MT types and the game context described above. The deployed application runs as a standalone Cloudflare Worker.

## Run locally

Requirements: Node.js `>=22.13.0`.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add an OpenRouter API key to `.env.local` to enable live generated language and voice (the Workers emulator reads `.dev.vars` instead; keep both when using both modes). Speech tries Fish Audio S2.1 Pro Free first; on rate limits or server errors, it makes one paid S2.1 Pro attempt with the same voice ID and a shared 20-second deadline. Without a key, the field and Ariadne’s embodied behaviour continue without generated speech.

If the installed Workers emulator cannot support the production compatibility date, `ARIADNE_LOCAL_PREVIEW=1 npm run dev` previews the same application with vinext's Node runtime. Set the local provider environment as above. The default build and deployment still use Workers.

Useful commands:

```bash
npm test
npm run build
npm run deploy:cloudflare
```

Production deployment requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository or runtime secrets. Never place credentials in committed files.

## Repository structure

- `app/field/` — the field: graph, structures, the hidden undertaking, memory, Ariadne’s body, rendering, audio, speech
- `app/field-page.tsx`, `app/field-practice.ts`, `app/api/` — the page, the language practice (prompt, stage card, guard), and the server routes
- `worker/` — server routes and model-provider integration
- `tests/` — field, practice, speech, audio, movement, and rendering tests
- `public/fog/` — models, sound, recorded voice cues, and imagery for the field
- `.github/workflows/` — test and Cloudflare deployment workflow

## License and credits

The software source code is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).

The project statement, visual identity, original images, models, sound, and authored or synthesized Ariadne voice recordings are © 2026 Mingde “MT” Zeng, all rights reserved. They are not licensed under the AGPL. See [COPYRIGHT.md](COPYRIGHT.md) for the exact boundary.

Third-party software retains its own licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Original sound provenance is documented in [`public/fog/audio.json`](public/fog/audio.json).

Copyright © 2026 Mingde “MT” Zeng.
