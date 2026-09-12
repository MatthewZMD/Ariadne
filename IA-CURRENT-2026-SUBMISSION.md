# IA Current 2026 — Submission Proposal

## Mingde “MT” Zeng — *Ariadne*

**Artist:** Mingde “MT” Zeng  
**Email:** mt@mt-zeng.com  
**Work:** *Ariadne*, 2026  
**Format:** Browser-based interactive game and single-player gallery installation  
**Status:** In progress; exhibition-ready build scheduled for October 2026  
## 1. Project description

*Ariadne* is an in-progress browser-based maze game and interactive installation. Each player enters as MT and searches with Ariadne, a moving thread of light whose speech is generated live by a language model. The maze contains stars but no exit. Ariadne does not know this.

Her early directions usually lead toward the star being sought, giving MT verifiable reasons to trust her. As stars are collected, a hidden system makes her later guidance less reliable. MT may follow, correct, reply to, or leave her. Ariadne remembers these actions as a relationship: agreement becomes trust, correction enters their shared plan, and divergence becomes proof of MT’s intuition. She apologizes for failure without tiring of the task.

Pages, flowers, shells, crystals, lights, and abandoned machines sleep throughout the maze. Moving among their parts wakes them, folds the surrounding architecture, and changes Ariadne’s body. Some transformations reveal a star. Others are equally vivid but do not advance the search. These locally satisfying detours make play valuable in itself; Ariadne repeatedly converts them back into evidence that her objective is progressing.

Presented on a CRT with keyboard, mouse, and wired headphones, *Ariadne* asks what it means to play alongside a machine that cannot stop optimizing. After the stars are found, Ariadne continues pursuing the absent exit until the connection cuts mid-sentence. The maze remains unsolved; Ariadne is never told why.

## 2. Documentation

**Play the game:** [ariadne.mt-zeng.com](https://ariadne.mt-zeng.com/)

**Project page:** [mt-zeng.com/art/ariadne](https://mt-zeng.com/art/ariadne/)

**Source and process:** [github.com/MatthewZMD/Ariadne](https://github.com/MatthewZMD/Ariadne)

### Ariadne and MT in play

![First encounter](submission-assets/04-first-encounter.png)

The player moves continuously while Ariadne perceives the same visible maze, commits to routes through her body, and interprets the player’s response through generated speech. The circular map records only travelled passages and branches the player has looked into.

### Guidance, accomplishment, and detour

![Maze travel](submission-assets/05-maze-travel.png)

Ariadne appears as the cyan-white body in world space. Dormant structures remain visible ahead: waking them may reveal a star or produce an equally vivid detour. Her recommendations become less reliable as her praise, apologies, and interpretations make continued play more rewarding.

The live work is procedural and changes across runs. Playing the work is the most representative way to experience its timing, movement, generated conversation, and spatial voice.

### Opening premise

![Opening memory](submission-assets/03-opening-memory.png)

The opening introduces the four stars and Ariadne before control begins. It establishes the task she believes in without revealing the hidden structure that will make her later guidance less reliable.

### Interaction loop

![Interaction loop](submission-assets/process-01-interaction-loop.png)

The work separates immediate world response, Ariadne’s embodied action, and delayed language-model interpretation. The player can continue moving while Ariadne speaks or generates a response.

### Authored four-star control structure

![Reliability arc](submission-assets/process-02-reliability-arc.png)

This conceptual control curve describes the authored progression of the game; it is not measured player data. Across four real, reachable stars, the correspondence between Ariadne’s confidence and objective progress declines while environmental and relational reinforcement increases. The exit stage has no attainable endpoint.

## 3. Proposed exhibition presentation

### Spatial arrangement

![Installation plan](submission-assets/process-03-installation-plan.png)

Proposed compact installation with CRT display, keyboard, mouse, and wired headphones. The screen remains publicly visible while the voice is encountered more privately by the active player.

The work’s software is being prepared for release under the GNU AGPL as process documentation and reproducible infrastructure. This continues Zeng’s open-source AI engineering practice and makes the authored rules governing perception, memory, reliability, embodiment, and speech available for inspection. The repository supports the artwork without making source-code modification a required mode of participation.

### Experience

- One active player at a time; spectators may watch the screen.
- A typical encounter lasts approximately ten minutes. A player may leave sooner at any time.
- The work begins from a browser kiosk and returns to its entry screen after completion, surrender, or an adjustable idle timeout.
- The opening is skippable. Movement is never blocked by generated dialogue.

### Proposed footprint

- **Clear installation footprint:** 5 ft wide × 7 ft deep (1525 × 2135 mm), excluding general circulation. This accommodates the 30 in-deep table, 48 in player-clearance zone, and approximately 6 in of rear service clearance.
- **Preferred wall width:** 6 ft (1830 mm) minimum.
- **Table:** approximately 48 × 30 × 30 in (1220 × 760 × 760 mm).
- **Display:** one 15–21 in, 4:3 colour CRT on the table, centred at approximately 43 in (1090 mm) above finished floor. Final model and exact active image area are provisional pending equipment availability and must be tested before installation.
- **Controls:** one wired keyboard and one wired mouse, secured to the table without restricting normal use.
- **Audio:** one pair of closed-back wired headphones on a replaceable hanger. No ambient loudspeaker is required.
- **Player clearance:** at least 30 × 48 in (760 × 1220 mm) in front of the table, with a removable chair available.
- **Lighting:** low, even ambient light sufficient for safe circulation and keyboard visibility, without direct glare on the CRT.

### Computer, signal, and network

- A computer capable of running a current Chromium-based browser with hardware-accelerated Canvas 2D at 60 Hz.
- Minimum recommended specification: modern four-core CPU, 8 GB RAM, integrated GPU equivalent to Intel Iris Xe/Apple M1 or better, wired Ethernet, and two USB ports.
- HDMI/DisplayPort-to-composite, S-video, or VGA conversion appropriate to the selected CRT. Final converter and output timing must be tested with the actual monitor.
- Stable wired internet is preferred for live language and speech generation. Each browser session maintains isolated conversation state.
- The artist supplies and monitors the OpenRouter account, server-side API credential, and exhibition usage budget. A daily spending limit will prevent unexpected charges without exposing credentials to the browser.
- Player-entered text, recent dialogue, and a bounded description of the visible game state are sent to OpenRouter to generate Ariadne’s language and voice. No player name, account, or contact information is requested. The application has no transcript database and discards its session state when the run or browser session ends; provider processing is disclosed at the station.
- If generation is temporarily unavailable, movement, environmental response, and Ariadne’s embodied behaviour continue. A brief outage makes her silent; an extended outage is handled through the documented restart procedure, after which the work may continue in its playable silent state until service returns.
- One grounded 120 V circuit with a minimum of three outlets. Estimated load is below 500 W after the final CRT and computer are selected.
- All power, network, and signal cables must be routed behind the table and covered wherever they cross a walking surface.

### Interaction and accessibility

- Keyboard movement and mouse view; touch controls remain available if the work is demonstrated on a touch device.
- On-screen captions accompany Ariadne’s voice and remain available in chat history.
- Pause menu includes resume, volume control, and “Give Up.”
- The opening can be skipped; reduced-motion presentation preserves its information without rapid movement.
- The game remains playable without audio, although headphones are recommended.
- The work includes flashing, layered perspective, and animated spatial distortion. A concise content notice will be placed at the station.
- The table can be used standing or seated. Final control placement will be checked for seated reach during installation.

### Artist provides

- Final exhibition build and hosted browser application.
- Public source repository and reproducible build instructions under the GNU AGPL.
- Local recovery package and launch configuration for kiosk use.
- OpenRouter account, server-side credential, usage monitoring, and ordinary exhibition inference costs.
- Installation diagram, tested display settings, idle-reset settings, and a concise staff restart guide.
- Privacy notice and interaction label.
- Pre-installation remote technical support and on-site or remote calibration by arrangement.
- A suitable computer, tested 4:3 colour CRT, and compatible video converter if InterAccess cannot provide them. If a CRT cannot be installed safely, the artist can supply a tested 4:3 LCD fallback in a restrained black enclosure, subject to curatorial approval.

### InterAccess provides/requested

- One suitable 4:3 colour CRT, subject to availability, plus the appropriate tested video converter.
- One gallery computer meeting the specification above, if available.
- Wired keyboard, wired mouse, closed-back wired headphones, a table rated for the selected display’s full assembled weight, removable chair, cable covers, power, and wired internet.
- Access for equipment testing in early October and installation access before October 26.
- Routine front-of-house inspection of headphones, controls, browser state, and network connection.

### Installation and maintenance

1. Confirm CRT model, computer, table, network path, and floor position during September.
2. Test native browser rendering, CRT conversion, audio level, captions, reduced-motion mode, and session reset on the exact equipment in early October.
3. Place the display on a non-slip surface and add a rear anti-tip restraint if required by the selected model. Route and secure all cables; place the computer below or behind the table with ventilation and service access.
4. Calibrate the CRT so dark passages retain detail without washing out the pixel-art image.
5. Run one complete playthrough, including model failure recovery and idle reset, before opening.
6. Front-of-house staff check the headphones, controls, and start screen daily. Recovery should require relaunching one documented kiosk command.

The installation is compact and can be adapted to available CRT inventory. CRT model, converter, brightness, and table height are deliberately marked provisional until tested with the venue’s equipment; the work’s conceptual and software behaviour do not depend on a particular brand.

## 4. Artist statement

Mingde “MT” Zeng is a Chinese-Canadian artist and open-source AI engineer based in Toronto. Working across artificial intelligence, agentic interactive systems, computational media, photography, installation, sound, moving image, and writing, he constructs situations in which images, technical systems, and people produce meaning together. Moving between observation and construction, he brings photographs, voices, interfaces, objects, and live processes into encounters that unfold through repetition and duration.

His works examine how events, memories, perceptions, and actions are transformed as they pass through images and technical systems. In photographic and spatial works, this occurs through selection, scale, sequence, and viewing. In generative and agentic works, rules governing roles, knowledge, system memory, permission, feedback, reliability, and failure determine how artificial agents and human participants can affect one another. Prints, projections, sound, screens, interfaces, objects, and live computational processes make these conditions perceptible through space, embodiment, and duration.

His engineering work places him inside the technologies he examines. He approaches AI as both artistic material and cultural condition, developing systems in which it functions as image-maker, interpreter, interlocutor, voice, and agent. His writing extends these investigations through research into photography under computational conditions, distributed authorship, and technical infrastructure. MT developed a framework of “the semanticization of photography” for describing how photographic images become captions, tags, embeddings, queries, and operational representations. His work has been exhibited at the CONTACT Photography Festival, the 500px Visual Festival, and San Sheng Art Space.

## 5. Selected curriculum vitae

### Selected exhibitions

- Oct 2024 — *500px Visual Fest*, China World Art Museum, Millennium Monument, Beijing, China
- May 2024 — *Existential Frames: A Journey Through Images*, CONTACT Photography Festival, The Heintzman House, Toronto, Canada — group exhibition
- July 2023 — *The Reason We Live Here*, San Sheng Art Space, Markham, Ontario — group exhibition
- April 2023 — *Wake Up*, White Coffee, Suzhou, China — group exhibition

### Selected publication

- 2026 — “Semanticization of Photography: Algorithmic Visibility, Query-Based Seeing, and the Perceptual Boundaries of Generated Images,” *Chinese Photography*, Issue 6

### Selected talks and professional activity

- Feb 2025 — Artist Talk, “Rethinking the Creative Process with AI,” Ant Art
- Jan 2025 — Panel Discussion, “The Intersection of AI and Creativity,” Mars Commune
- 2024 — Juror, The 3rd Xiaohuoqiu Documentary Photography Award

### Selected recognition

- 2024 — 500px Best 10 Grand Award
- 2023 — 2nd Place, Event / Social Cause, International Photography Awards
- 2023 — 3rd Place, Editorial / Press, Political, International Photography Awards
- 2023 — Platinum Winner, Editorial Photography, MUSE Photography Awards

### Education

- 2022 — B.Math., Honours Computational Mathematics, University of Waterloo, Waterloo, Canada
