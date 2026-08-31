"use client";

import { useEffect } from "react";
import Image from "next/image";

export type ExperienceState = "title" | "story" | "playing" | "paused" | "ending";

const STORY = [
  {
    art: "remembered",
    lines: ["The maze once remembered every place it touched—and every way home."],
  },
  {
    art: "fracture",
    lines: ["Then its memory broke.", "Places remained, but the paths between them were forgotten."],
  },
  {
    art: "anchors",
    lines: ["Four stars had fixed its paths in place.", "When they fell, the way outward vanished with them."],
  },
  {
    art: "memories",
    lines: ["Fragments of the maze’s memory still sleep inside the things it carried with it."],
  },
  {
    art: "ariadne",
    lines: ["One thread of memory remained alive.", "Her name was Ariadne."],
  },
  {
    art: "belief",
    lines: ["She believed four awakened stars would let her stitch the maze’s paths together again."],
  },
  {
    art: "gate",
    lines: ["But a thread cannot cross a maze alone.", "MT entered the gate."],
  },
  {
    art: "premise",
    lines: ["Beyond the gate, the first sleeping memory waited to be awakened.", "Together, MT and the living thread entered the broken maze."],
  },
] as const;

export const OPENING_ARIADNE_LINE="Hi, MT—I’m Ariadne, and I’m here to guide you to the four stars that once held this maze’s exit open. They’ve gone dark, and the exit vanished with them. Wake them with me—I’m sure we can bring it back.";

function Logo() {
  return <Image className="title-card-image" src="/ariadne-title-card.png" alt="Ariadne" width={1672} height={941} unoptimized priority />;
}

export function TitleScreen({ onStart,ready }: { onStart: () => void;ready:boolean }) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if (event.key === "Enter") { event.preventDefault(); onStart(); } };
    addEventListener("keydown", handle);return () => removeEventListener("keydown", handle);
  }, [onStart]);
  return <section className="front-screen title-screen" aria-label="Ariadne title screen">
    <div className="front-panel title-panel">
      <Logo />
      <button className="pixel-button primary" type="button" onClick={onStart} disabled={!ready}>{ready?"START":"OPENING THE GATE..."}</button>
      <p className="front-hint">ENTER · BEGIN</p>
    </div>
  </section>;
}

function StoryArt({ index }: { index: number }) {
  const scene=String(index+1).padStart(2,"0");
  return <div className="story-art" aria-hidden="true">
    <Image className="story-scene-image" src={`/story/scene-${scene}.png`} alt="" width={320} height={180} unoptimized priority={index<2}/>
    {index===2&&<div className="animated-story-stars"><i>★</i><i>★</i><i>★</i><i>★</i></div>}
    {(index>=4)&&<div className={`story-fairy story-fairy-${index===4?"meeting":"team"}`}>
      <i className="story-fairy-wing wing-a"/><i className="story-fairy-wing wing-b"/><i className="story-fairy-wing wing-c"/><i className="story-fairy-wing wing-d"/>
      <i className="story-fairy-core"/><i className="story-fairy-mote mote-a"/><i className="story-fairy-mote mote-b"/><i className="story-fairy-mote mote-c"/>
    </div>}
  </div>;
}

export function StorySequence({ index, ready, onAdvance, onSkip, onComplete }: {
  index: number;
  ready: boolean;
  onAdvance: () => void;
  onSkip: () => void;
  onComplete: () => void;
}) {
  const finalScene = index === STORY.length - 1;
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.repeat) return;
      event.preventDefault();
      if(finalScene&&ready)onComplete();else if(!finalScene)onAdvance();
    };
    addEventListener("keydown", handle);
    return () => removeEventListener("keydown", handle);
  }, [finalScene, onAdvance, onComplete, ready]);
  useEffect(()=>{
    const delay=2000;
    const timer=window.setTimeout(()=>{if(finalScene){if(ready)onComplete()}else onAdvance()},delay);
    return()=>window.clearTimeout(timer);
  },[finalScene,index,onAdvance,onComplete,ready]);

  const screen = STORY[index];
  return <section className="front-screen story-screen" aria-label={`Opening story, scene ${index + 1} of ${STORY.length}`}>
    <button className="story-skip text-button" type="button" onClick={event => { event.stopPropagation(); if(finalScene&&ready)onComplete();else onSkip(); }}>{finalScene?"ENTER THE MAZE":"SKIP"}</button>
    <button className="story-stage" type="button" onClick={()=>{if(finalScene&&ready)onComplete();else if(!finalScene)onAdvance()}} key={index} aria-label={finalScene?"Enter the maze":"Continue opening animation"}>
      <StoryArt index={index} />
      <div className="story-copy" aria-live="polite">
        {screen.lines.map((line, lineIndex) => <p key={line} className={screen.art === "premise" && lineIndex === 1 ? "hero-answer" : ""}>{line}</p>)}
      </div>
    </button>
  </section>;
}

export function PauseMenu({ onResume, onGiveUp, masterVolume, onVolumeChange }: { onResume: () => void; onGiveUp: () => void; masterVolume: number; onVolumeChange: (volume: number) => void }) {
  return <section className="pause-screen" role="dialog" aria-modal="true" aria-label="Game paused">
    <div className="pause-panel">
      <h1>PAUSED</h1>
      <button className="pixel-button primary" type="button" onClick={onResume}>RESUME</button>
      <label className="pause-volume">
        <span>VOLUME</span><strong>{Math.round(masterVolume*100)}%</strong>
        <input type="range" min="0" max="100" step="5" value={Math.round(masterVolume*100)} onChange={event=>onVolumeChange(Number(event.currentTarget.value)/100)} aria-label="Master volume"/>
      </label>
      <button className="pixel-button danger" type="button" onClick={onGiveUp}>GIVE UP</button>
      <p className="front-hint">ESC TO RESUME</p>
    </div>
  </section>;
}

export function ClosureScreen({ revealed, onRestart, onLeave }: {
  revealed: boolean;
  onRestart: () => void;
  onLeave: () => void;
}) {
  return <section className={`closure-screen ${revealed ? "revealed" : ""}`} role="dialog" aria-modal="true" aria-label="Connection ended">
    {revealed && <div className="closure-panel">
      <h1>LINK LOST</h1>
      <button className="pixel-button primary" type="button" onClick={onRestart}>BEGIN AGAIN</button>
      <button className="pixel-button danger" type="button" onClick={onLeave}>LEAVE</button>
    </div>}
  </section>;
}
