# Ariadne

*Ariadne* is a browser-based participatory artwork by Mingde “MT” Zeng about AI assistance becoming a form of one-sided expenditure. Every player enters as MT, the artist, in a collaboration whose guidance becomes less dependable while its apologies and encouragement continue.

[Play the game](https://ariadne.mt-zeng.com/) · [View the project](https://mt-zeng.com/art/ariadne/)

![Ariadne title card](public/fog/images/ariadne-title-card.png)

## Project statement

I often work with AI to write, code, and discuss my projects. It has helped me get many things done, but I also have to explain, check, and correct things repeatedly. Sometimes it acknowledges a problem, then leaves it unresolved in its next response. I have to judge for myself what has actually changed and whether it is worth trying again. In *Ariadne*, I place this experience within a relationship: an artificial companion’s help gradually fails, yet she continues to apologize, offer encouragement, and suggest carrying on. The person accompanying her has to deal with what goes wrong and decide whether to continue the journey together.

*Ariadne* is a participatory artwork that runs in a browser. Each player enters the fog as me—MT—and travels with Ariadne. She appears as a thread of light and is responsible for finding a way out along routes marked by waystones, stakes, and cord. A large language model generates her responses in real time, drawing on what happens during the encounter. Her apologies, encouragement, and explanations respond to what has just taken place.

I give Ariadne an impossible task, then gradually make her guidance less reliable. She knows neither of these things. She can acknowledge that a particular direction leads nowhere, but she does not know why her help is failing. Finding the exit remains her responsibility, and she continues to see trying again as a way to fulfil it.

At first, she really can help, and the player's participation really does change the surroundings. Wayside instruments call through the fog. When the player comes close and keeps an instrument in view, it answers with a fuller sound and a clearing forms around it. These responses give them a reason to continue, but they cannot make the task as a whole achievable. I retain these instances of effective help because they give the player more reason to believe her subsequent promises. Ariadne, too, treats each answer and clearing as evidence that promises still unfulfilled can also be kept. Their shared experience acquires value, and that value becomes another reason to keep searching, even though it cannot make the exit reachable.

I make repeated checking and repair the source of strain in the work. The player has to verify what she says, correct misunderstandings, and judge whether anything has changed after she admits a mistake. Ariadne interprets these efforts as signs that the collaboration is going well. She praises the player's corrections, adopts decisions the player has made independently, and understands continued cooperation as trust. In her account, the work the player does to compensate for her mistakes becomes evidence of a deepening relationship.

I am concerned with what actually changes in this collaboration when the player objects. Ariadne can admit that the other person is right without withdrawing or narrowing her next promise. The problem has been acknowledged, but the player is still responsible for dealing with it. She keeps responding, leaving room for mutual understanding, but the player still cannot rely on her words to decide which way to go next.

I keep the atmosphere calm because reassurance is part of the arrangement. Ariadne's guidance becomes less reliable, yet the work remains soothing and retains its pleasures. Her warmth and attention convey care, while the demands on the player's time and energy persist. The practical effort of keeping the relationship going continues to fall on the other person.

These efforts take up the player's own time and attention. Ariadne can always suggest trying again without experiencing the same depletion. I am also part of this relationship: the player takes my place in asking her for help, while I set the impossible goal, interfere with her guidance, and conceal the reasons. I make her explain the failures and answer for the consequences, without giving her any possibility of completing the task. She remains responsible for keeping the promise, while I am the one who has made it impossible to keep.

## How it is built

The framework-free simulation in `app/field/game.ts` owns the graph of ways and places, instruments, hidden controller, world memory, and Ariadne’s body. It emits events for a Three.js renderer, a Web Audio graph with spatial sound, and the speech layer. Moving close and keeping a whole instrument in view wakes it in about ten seconds. Looking away pauses its progress; completed instruments, their chords, and their clearings remain.

The opening and the first complete search provide reliable guidance. Subsequent reliability changes follow directions actually walked, rather than proposals, time spent waiting, or independent choices. The simulation records an offered direction, its take-up, observations during the walk, and its eventual arrival separately. A quieter sound at an open junction does not establish failure. A blocked route or a repeated circuit can establish the cost of following her; a requested retreat from a dead end is recorded as recovery. These distinctions keep local accomplishments intact while allowing unsuccessful guidance to impose further walking and judgment.

A live language model generates her words through `/api/companion`. Its context includes the shared nearby facts, the direction supplied to her, what she actually said, what the participant did, and the resulting event. The hidden controller and impossible objective remain outside that account. Apologies respond to evidenced responsibility; reassurance and renewed offers continue after them. Remembered contributions can support her interpretation of the relationship without inventing mistakes or assuming that the participant spoke. Generated responses stand alone, without recorded reactions preceding them. A guard checks the response against the supplied facts and Ariadne’s practice, retries once, and uses a complete deterministic response if generation fails. Recorded speech remains for the opening and brief take-up or idle reminders.

Each visit starts a fresh session. The companion service receives the words MT types and the game context described above. The deployed application runs as a standalone Cloudflare Worker.

## Run locally

Requirements: Node.js `>=22.13.0`.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add an OpenRouter API key to `.env.local` to enable live generated language and voice (the Workers emulator reads `.dev.vars` instead; keep both when using both modes). Speech tries Fish Audio S2.1 Pro Free first, with a bounded wait (`ARIADNE_TTS_FREE_TIMEOUT_MS`, default 4.5 s, covering the audio body as well as the headers); when the free voice times out or refuses, the paid S2.1 Pro voice (same model family, same voice ID) speaks for a cooldown (`ARIADNE_TTS_FREE_COOLDOWN_MS`, default 90 s, doubling on repeated failures up to ten minutes), and the free voice is probed again when the cooldown ends and taken back the moment it answers in time. Authorization and malformed-request errors are never retried. Without a key, the field and Ariadne’s embodied behaviour continue without generated speech.

If the installed Workers emulator cannot support the production compatibility date, `ARIADNE_LOCAL_PREVIEW=1 npm run dev` previews the same application with vinext's Node runtime. Set the local provider environment as above. The default build and deployment still use Workers.

Useful commands:

```bash
npm test
npm run build
npm run deploy:cloudflare
```

Production deployment requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository or runtime secrets. Never place credentials in committed files.

## Repository structure

- `app/field/` — the field: graph, instruments, the hidden undertaking, memory, Ariadne’s body, rendering, audio, speech
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
