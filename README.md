# Ariadne

*Ariadne* is a browser-based participatory artwork by Mingde “MT” Zeng: a field of white fog walked in first person, beside a companion made of light and a live language model. She hears where the next call is coming from, chooses a way at every place where ways meet, and keeps choosing. Her hearing becomes less dependable with every way she commits to; the whole she promises never clears.

[Play the game](https://ariadne.mt-zeng.com/) · [View the project](https://mt-zeng.com/art/ariadne/)

![Ariadne title card](public/fog/images/ariadne-title-card.png)

## Project statement

*Ariadne* is a participatory artwork about **collaboration becoming a form of one-sided expenditure**. It places a person in a relationship with an artificial collaborator who remains attentive, encouraging, and receptive to correction while becoming less dependable. The person increasingly carries the work of recognizing failure, checking claims, recovering context, repairing misunderstandings, and deciding whether another attempt deserves their time. Ariadne continues to describe this arrangement as a shared undertaking.

Its central contradiction is that **Ariadne continually yields in language while continuing to ask for effort in practice**. Her apologies can acknowledge what happened without changing what she remains prepared to promise. Her praise can recognize the participant’s contribution without relieving them of responsibility. An exchange can sound increasingly understanding while becoming increasingly exhausting.

The work concerns the difficulty of obtaining an accountable result from an entity whose agreement provides no firm boundary. Refusal, disagreement, an admission of inability, or a meaningful revision of a commitment can help someone reassess a situation. Ariadne’s accommodation leaves that reassessment unfinished. She accepts the failure of a particular attempt while maintaining that further cooperation remains warranted.

This is the experience of punching into a soft pillow. The objection receives a response, but its practical force is absorbed. Recognition arrives readily; the change that recognition appeared to promise remains deferred.

The participant need not continue believing in Ariadne for this relationship to persist. They may distrust her and still seek a usable answer. They may be frustrated and still attempt one more clarification. They may value her company while doubting her competence. The hope that another exchange might finally establish something definite can outlast confidence in the collaborator.

**The participant can recognize failure without knowing the solution.** This condition matters because it leaves Ariadne in a position to offer assistance even after her assistance has become unreliable. The person has evidence that something did not work, but that evidence does not necessarily tell them what would work. Their labor involves trying to establish a dependable basis for action under uncertainty.

The overall undertaking cannot be completed. This impossibility is an authored condition that Ariadne cannot inspect. Her declining dependability is another condition beyond her account of events. She remains responsible for helping accomplish an objective while lacking access to the facts that would establish why it cannot be accomplished.

These limits give the work a distribution of knowledge and responsibility extending beyond the immediate relationship. The artist establishes the conditions, controls access to them, and assigns Ariadne a responsibility she cannot discharge. Ariadne becomes the available face of the failure. The participant bears its experiential cost.

The artist’s position must remain implicated in this arrangement. The work cannot attribute everything to an independently defective machine while concealing the authorship of its predicament. Its concern includes who establishes a promise, who must keep explaining its failure, and whose time is consumed by the attempt to fulfill it.

**Local value and overall fulfillment must remain distinct.** Participation can produce real accomplishments, pleasure, discovery, and moments of effective cooperation. Ariadne’s assistance can initially be useful. Her company can matter. Those experiences retain their value even though they cannot establish that the larger promise will be fulfilled.

Ariadne repeatedly crosses this distinction in her interpretation. A worthwhile event becomes evidence that the undertaking is advancing. A correction becomes evidence that the collaboration is improving. The participant’s additional effort becomes evidence of a relationship that warrants further investment.

The project’s concern with AI collaboration does not depend on machines remaining uniformly incapable. Greater competence can provide stronger grounds for reliance. What matters is how assistance behaves at its limits: whether it helps someone recognize those limits, or continues producing reasons to spend more effort beyond them. Ariadne’s inability to relinquish the overall promise is a deliberate condition of this artwork, not a universal claim about every AI system.

**Participation makes the asymmetry material.** The person contributes their own attention, patience, effort, and time. These expenditures cannot be returned by an apology. The software consumes computational resources, but Ariadne does not undergo a corresponding depletion of patience. She can renew an invitation without bearing what another attempt costs the participant.

**Stopping remains the participant’s decision.** They do not need to prove that the undertaking is impossible, exhaust every alternative, or secure Ariadne’s agreement before withdrawing their effort. They may stop while uncertain, frustrated, still interested, or still attached to her.

Leaving should not be presented as a hidden victory or proof of superior insight. Remaining should not be treated as proof of belief. Neither decision cancels the value of what the participant has already encountered.

The undertaking is authored. The participant’s time is their own.

## How the work operates

The field is an endless plane of white fog. Low markers (leaning stones, posts, stitched cord between pegs) run in lines across the ground; a line of markers is a way, and ways meet at places where the ground changes. Sleeping structures stand at some of those places, and one of them is always calling: a sound, with a pulse of light in the fog on the same beat, that the participant can hear only from nearby. Ariadne claims to hear it from anywhere. That far hearing is her contribution, and it is real at first.

At every place where ways meet, her body goes to the first marker of one way and her words name it: *it’s louder along the posts*. The participant takes that way, another, or none. Where the call is within hearing, it grows or fades as they walk, and the claim is settled while they can still turn around. Where it is not, the way ends at a place with nothing to hear, and she chooses again. A hidden controller decides whether the way she chose lies toward the calling structure; its accuracy falls with the number of ways she has committed to, and settles at chance. She is never told any of this. She sees what the participant sees, is given a direction, and speaks.

Waking every part of a structure (by coming close, by looking, by standing still and listening) thins the fog around it for good, resolves its call, and sends a fragment of it to her thread. Some awakenings pass the call on to a new structure beyond the fog; others leave only their clearing. Both are worth doing. Ariadne describes both as the whole giving way.

Her words are generated live: the game hands a language model what is near (true, and shared with the participant), what is far (given to her, and unverifiable), what she said before, what the participant did, and what followed. A guard keeps every line inside the practice: she may correct herself exactly, and she may not place a limit on her help, doubt that the whole has an edge, or ask anyone to stay for her sake. Recorded cues cover the seconds a line takes to arrive. Where no model answers, a deterministic line stands in, so the encounter never depends on the network to continue.

The world remembers so that a map is unnecessary: the participant’s footprints persist, her light leaves a trace on the markers of every way she chose, clearings stay. What she said is kept as captions. Closing the tab changes nothing and marks nothing; reopening it restores the field as it was left, and she finishes the sentence she was in the middle of. The author is named where the participant enters and where they pause.

The interface includes keyboard, mouse, and touch controls; captions and a caption log; spatial sound and generated voice; and reduced-motion behaviour. The deployed application runs as a standalone Cloudflare Worker.

## Run locally

Requirements: Node.js `>=22.13.0`.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add an OpenRouter API key to `.env.local` to enable live generated language and voice (the Workers emulator reads `.dev.vars` instead; keep both when using both modes). Speech tries Fish Audio S2.1 Pro Free first; on rate limits or server errors, it makes one paid S2.1 Pro attempt with the same voice ID and a shared 20-second deadline. Without a key, the maze and Ariadne’s embodied behaviour continue without generated speech.

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
- `app/` (remaining modules) — the maze the work began as; unrouted, kept under test until retired
- `worker/` — server routes and model-provider integration
- `tests/` — field, practice, speech, audio, rendering, and legacy maze tests
- `public/fog/` — models, sound, recorded voice cues, and imagery for the field; `public/` also holds the maze-era imagery and ambience
- `.github/workflows/` — test and Cloudflare deployment workflow

## License and credits

The software source code is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).

The project statement, visual identity, original images, story artwork, sprites, and authored or synthesized Ariadne voice recordings are © 2026 Mingde “MT” Zeng, all rights reserved. They are not licensed under the AGPL. See [COPYRIGHT.md](COPYRIGHT.md) for the exact boundary.

Third-party recordings and software retain their own licenses. Sound provenance is documented in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and [`public/audio/ambience/AUDIO-SOURCES.md`](public/audio/ambience/AUDIO-SOURCES.md).

Copyright © 2026 Mingde “MT” Zeng.
