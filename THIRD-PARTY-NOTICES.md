# Third-party notices

*Ariadne* incorporates open-source software packages. These materials remain subject to their own terms and are not relicensed as original *Ariadne* artwork.

## Software dependencies

JavaScript package names, versions, source locations, and declared licenses are recorded in `package.json` and `package-lock.json`. Their license texts are distributed by their respective packages under `node_modules/` after installation.

The AGPL license applied to Ariadne’s original source code does not replace or restrict compatible rights granted by those dependency authors.

## Original sound and voice

Field sounds under `public/fog/audio/` are original deterministic synthesis, with provenance in [`public/fog/audio.json`](public/fog/audio.json) and source in `asset-source/fog/build_audio.py`. Voice recordings under `public/fog/cues/` were produced for *Ariadne*. These project assets are governed by [`COPYRIGHT.md`](COPYRIGHT.md), not the AGPL software license.

## Fonts and platform services

The game uses browser-provided font fallbacks and external model services at runtime. Service access does not transfer those providers’ models, voices, trademarks, or other materials into this repository. Use of a self-hosted or modified deployment remains subject to the applicable service terms chosen by its operator.
