"use client";

import { useCallback, useEffect } from "react";
import Image from "next/image";

export type ExperienceState = "title" | "story" | "playing" | "paused";

const STORY = [
  {
    art: "stars",
    lines: ["On the night the stars changed places, four of them fell from the sky."],
  },
  {
    art: "maze",
    lines: ["They vanished into the Great Maze, where corridors twist beneath forgotten worlds."],
  },
  {
    art: "gate",
    lines: ["Without the four stars, the path through the maze can never be revealed."],
  },
  {
    art: "adventurers",
    lines: ["Knights entered with swords.", "Wizards entered with spells.", "Cartographers entered with very large maps."],
  },
  {
    art: "maps",
    lines: ["The maze kept the swords, confused the spells, and made a complete mess of the maps."],
  },
  {
    art: "mt",
    lines: ["So the kingdom called for a different kind of hero.", "MT answered."],
  },
  {
    art: "meeting",
    lines: ["At the maze gate, a small light flickered to life.", "Her name was Ariadne. She would be MT's companion and guide."],
  },
  {
    art: "team",
    lines: ["Four stars. One legendary maze.", "One brand-new team, ready for adventure."],
  },
] as const;

function Logo() {
  return <Image className="title-card-image" src="/ariadne-title-card.png" alt="Ariadne" width={1672} height={941} unoptimized priority />;
}

export function TitleScreen({ onStart }: { onStart: () => void }) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if (event.key === "Enter") { event.preventDefault(); onStart(); } };
    addEventListener("keydown", handle);return () => removeEventListener("keydown", handle);
  }, [onStart]);
  return <section className="front-screen title-screen" aria-label="Ariadne title screen">
    <div className="front-panel title-panel">
      <Logo />
      <button className="pixel-button primary" type="button" onClick={onStart}>START</button>
      <p className="front-hint">ENTER</p>
    </div>
  </section>;
}

function StoryArt({ index }: { index: number }) {
  const scene=String(index+1).padStart(2,"0");
  return <div className="story-art" aria-hidden="true">
    <Image className="story-scene-image" src={`/story/scene-${scene}.png`} alt="" width={320} height={180} unoptimized priority={index<2}/>
    {index===0&&<div className="animated-story-stars"><i>★</i><i>★</i><i>★</i><i>★</i></div>}
  </div>;
}

export function StorySequence({ index, ready, onAdvance, onBack, onComplete }: {
  index: number;
  ready: boolean;
  onAdvance: () => void;
  onBack: () => void;
  onComplete: () => void;
}) {
  const finalScene = index === STORY.length - 1;
  const advance = useCallback(() => { if (finalScene) { if (ready) onComplete(); } else onAdvance(); },[finalScene,onAdvance,onComplete,ready]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onBack(); return; }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      advance();
    };
    addEventListener("keydown", handle);
    return () => removeEventListener("keydown", handle);
  }, [advance, onBack]);

  const screen = STORY[index];
  return <section className="front-screen story-screen" aria-label={`Opening story, scene ${index + 1} of ${STORY.length}`}>
    <button className="story-back text-button" type="button" onClick={event => { event.stopPropagation(); onBack(); }}>RETURN TO TITLE</button>
    <button className="story-stage" type="button" onClick={advance} key={index} aria-label={finalScene?"Enter the maze":"Continue opening story"}>
      <StoryArt index={index} />
      <div className="story-copy" aria-live="polite">
        {screen.lines.map((line, lineIndex) => <p key={line} className={screen.art === "mt" && lineIndex === 1 ? "hero-answer" : ""}>{line}</p>)}
      </div>
    </button>
    <p className="story-progress">{String(index + 1).padStart(2, "0")} / {String(STORY.length).padStart(2, "0")}</p>
    <p className="story-continue">{finalScene?(ready?"ENTER OR CLICK TO ENTER THE MAZE":"OPENING THE GATE..."):"ENTER OR CLICK TO CONTINUE"} <span>▼</span></p>
  </section>;
}

export function PauseMenu({ onResume, onEnd }: { onResume: () => void; onEnd: () => void }) {
  return <section className="pause-screen" role="dialog" aria-modal="true" aria-label="Game paused">
    <div className="pause-panel">
      <h1>PAUSED</h1>
      <button className="pixel-button primary" type="button" onClick={onResume}>RESUME</button>
      <button className="pixel-button danger" type="button" onClick={onEnd}>END GAME</button>
      <p className="front-hint">ESC TO RESUME</p>
    </div>
  </section>;
}
