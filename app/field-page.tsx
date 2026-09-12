"use client";

/**
 * The field, as a page: title, headphones, the fog, a pause. Owns the frame
 * loop and the input, wires the game to the renderer, the audio and the
 * speech layer, and saves the session so that closing the tab does nothing
 * and reopening it restores the field as it was.
 */
import Image from "next/image";
import { AdaptiveQuality } from "./field/performance.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { FieldGame, type FieldInput } from "./field/game.ts";
import { createFieldAudio, type FieldAudio } from "./field/audio.ts";
import { FieldSpeech, type SpeechLine } from "./field/speech.ts";
import type { FieldRenderer } from "./field/render/renderer.ts";

type Experience = "title" | "headphones" | "playing" | "paused" | "unavailable";
type Caption = { id: string; role: "ariadne" | "walker"; text: string; at: number };

const SAVE_KEY = "ariadne:field:save";
const SESSION_KEY = "ariadne:field:session";
const VOLUME_KEY = "ariadne:field:volume";
/** The artist's page for the work: the statement, and who set these conditions. */
const ABOUT_URL = "https://mt-zeng.com/art/ariadne/";
const CAPTION_LIFE_MS = 9000;
/** A line stays on screen long enough to be read at a comfortable pace, whether or not her voice is heard. */
const captionLife = (text: string) => Math.max(CAPTION_LIFE_MS, 3000 + text.split(/\s+/).filter(Boolean).length * 380);

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage unavailable */ } };
const randomId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const seedFrom = (id: string) => { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export default function FieldPage() {
  const [experience, setExperience] = useState<Experience>("title");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [masterVolume, setMasterVolume] = useState(1);
  const [hintVisible, setHintVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pauseLogRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<FieldGame | null>(null);
  const rendererRef = useRef<FieldRenderer | null>(null);
  const audioRef = useRef<FieldAudio | null>(null);
  const speechRef = useRef<FieldSpeech | null>(null);
  const experienceRef = useRef<Experience>("title");
  const heldRef = useRef(new Set<string>());
  const lookRef = useRef(0);
  const pitchRef = useRef(0);
  const touchRef = useRef(new Map<number, { kind: "move" | "look"; startX: number; startY: number; lastX: number; lastY: number }>());
  const touchMoveRef = useRef<[number, number]>([0, 0]);
  const logOpenRef = useRef(false);
  const sessionIdRef = useRef("");
  const qualityRef = useRef<AdaptiveQuality | null>(null);
  const systemStillRef = useRef(false);
  /** True while we are the ones releasing the pointer (pausing, opening the input), so the release is not read as Escape. */
  const releasingPointerRef = useRef(false);
  /** Set when the browser refuses the pointer; the mouse then looks around without a button held. */
  const pointerLockFailedRef = useRef(false);

  useEffect(() => { experienceRef.current = experience; }, [experience]);
  useEffect(() => { logOpenRef.current = logOpen; if (logOpen) inputRef.current?.focus(); }, [logOpen]);
  useEffect(() => {
    if (experience !== "paused") return;
    requestAnimationFrame(() => {
      const log = pauseLogRef.current;
      if (log) log.scrollTop = log.scrollHeight;
    });
  }, [experience, captions.length]);
  useEffect(() => {
    const keyboard = (navigator as Navigator & { keyboard?: { lock(keys: string[]): Promise<void>; unlock(): void } }).keyboard;
    const sync = () => {
      const active = document.fullscreenElement !== null;
      setFullscreen(active);
      setFullscreenAvailable(typeof document.documentElement.requestFullscreen === "function");
      // Reserve a short Escape press for chat and pause; the browser retains its long-press exit.
      if (active) void keyboard?.lock(["Escape"]).then(() => { if (!document.fullscreenElement) keyboard.unlock(); }).catch(() => { /* Unsupported or denied: retain the browser's normal Escape behavior. */ });
      else keyboard?.unlock();
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => { document.removeEventListener("fullscreenchange", sync); keyboard?.unlock(); };
  }, []);

  // Preferences persist; every visit starts a new game.
  useEffect(() => {
    const syncPreferences = () => {
      write(SAVE_KEY, null);
      const stored = read(VOLUME_KEY), volume = Number(stored); if (stored !== null && Number.isFinite(volume)) setMasterVolume(Math.max(0, Math.min(1, volume)));

      sessionIdRef.current = randomId(); write(SESSION_KEY, null);
    };
    syncPreferences();
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { systemStillRef.current = query.matches; if (gameRef.current) gameRef.current.reducedMotion = query.matches; };
    sync(); query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => { write(VOLUME_KEY, String(masterVolume)); audioRef.current?.setMasterVolume(masterVolume); }, [masterVolume]);
  useEffect(() => {
    const receivePortfolioVolume = (event: MessageEvent) => {
      const trusted = /^https:\/\/(?:www\.)?mt-zeng\.com$/.test(event.origin) || /^http:\/\/localhost(?::\d+)?$/.test(event.origin);
      if (event.source !== window.parent || !trusted) return;
      const message = event.data as { type?: unknown; volume?: unknown } | null;
      if (!message || message.type !== "ariadne:set-master-volume" || typeof message.volume !== "number" || !Number.isFinite(message.volume)) return;
      setMasterVolume(Math.max(0, Math.min(1, message.volume)));
    };
    window.addEventListener("message", receivePortfolioVolume);
    return () => window.removeEventListener("message", receivePortfolioVolume);
  }, []);

  /** Start a fresh game from the headphones screen, on a user gesture. */
  const begin = useCallback(async () => {
    if (gameRef.current) return;
    const game = new FieldGame(seedFrom(randomId()));
    game.reducedMotion = systemStillRef.current;
    gameRef.current = game;
    const audio = createFieldAudio({ sessionId: sessionIdRef.current, debug: location.search.includes("debug") });
    audioRef.current = audio;
    audio.setMasterVolume(masterVolume);
    const speech = new FieldSpeech(game, audio, { sessionId: sessionIdRef.current, onThinking: setThinking, onLine: (line: SpeechLine) => setCaptions(list => [...list, { id: line.id, role: "ariadne" as const, text: line.text, at: performance.now() }]) });
    speechRef.current = speech;
    await audio.unlock();
    audio.warm(["bell-arch"]);
    // The field is drawn with WebGL. When the browser cannot supply it, the visitor must be told so plainly, rather than left
    // on "Opening the field" for good.
    const canvas = canvasRef.current; if (!canvas) return;
    const device = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    qualityRef.current = new AdaptiveQuality({ cores: device.hardwareConcurrency, memoryGB: device.deviceMemory, saveData: device.connection?.saveData });
    let renderer: FieldRenderer;
    try {
      const { FieldRenderer } = await import("./field/render/renderer.ts");
      renderer = new FieldRenderer(canvas, game);
    } catch (error) {
      console.warn("ARIADNE field could not open", error);
      audio.destroy(); gameRef.current = null; audioRef.current = null; speechRef.current = null;
      setExperience("unavailable");
      return;
    }
    const rect = canvas.getBoundingClientRect(); renderer.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
    // Every model loaded and every shader compiled before the first frame, so nothing stalls when it first appears; a slow
    // connection is not made to wait past a few seconds.
    await Promise.race([renderer.ready, new Promise(resolve => setTimeout(resolve, 8000))]);
    if (gameRef.current !== game) return;
    rendererRef.current = renderer;
    // A playtest hook: ?debug exposes the running pieces to scripts (scripts/playtest.mjs) and to a curious console.
    if (location.search.includes("debug")) (window as unknown as { __ariadneField?: unknown }).__ariadneField = { game, speech, audio, renderer };
    setReady(true);
  }, [masterVolume]);

  // Frame loop.
  useEffect(() => {
    let frame = 0, previous = performance.now(), accumulator = 0, waterAt = 0, captionAt = 0, wasPlaying = false, lastWorkMs = 0, water: number | null = null;
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      const elapsedMs = time - previous, workStarted = performance.now();
      const dt = Math.min(.2, elapsedMs / 1000); previous = time;
      const game = gameRef.current, renderer = rendererRef.current, audio = audioRef.current, speech = speechRef.current;
      if (!game || !renderer) return;
      const playing = experienceRef.current === "playing" && !document.hidden;
      const quality = qualityRef.current;
      if (!playing) {
        if (wasPlaying) { quality?.resetWindow(); accumulator = 0; }
        wasPlaying = false;
        return;
      }
      if (!wasPlaying) quality?.resetWindow(); else quality?.sample(elapsedMs, lastWorkMs);
      wasPlaying = true;
      if (playing) {
        const held = logOpenRef.current ? new Set<string>() : heldRef.current;
        let forward = 0, strafe = 0, turn = 0;
        if (held.has("w") || held.has("arrowup")) forward += 1; if (held.has("s") || held.has("arrowdown")) forward -= 1;
        if (held.has("arrowleft")) turn += 1; if (held.has("arrowright")) turn -= 1;
        if (held.has("a") || held.has("q")) strafe -= 1; if (held.has("d") || held.has("e")) strafe += 1;
        if (touchMoveRef.current[1] !== 0) forward = touchMoveRef.current[1]; if (touchMoveRef.current[0] !== 0) strafe = touchMoveRef.current[0];
        const fieldInput: FieldInput = { forward, strafe, turn, lookDelta: lookRef.current, pitchDelta: pitchRef.current };

        if (forward || strafe || turn || fieldInput.lookDelta || fieldInput.pitchDelta) setHintVisible(false);
        // Fixed-step simulation so behaviour does not depend on frame rate.
        accumulator = Math.min(accumulator + dt, .25);
        const step = 1 / 60;
        while (accumulator >= step) { game.update(step, fieldInput); accumulator -= step; fieldInput.lookDelta = 0; fieldInput.pitchDelta = 0; lookRef.current = 0; pitchRef.current = 0; }
        for (const event of game.drain()) { audio?.handle(event); renderer.handle(event); if (event.type === "speak") speech?.handle(event); }
        speech?.update();
        if (time - waterAt > 500) {
          waterAt = time; water = game.waterDistance();
          // Load a family's sounds as its structures come within reach; the whole library never downloads at once.
          const near = game.structures.all().filter(item => Math.hypot(item.position[0] - game.walker.position[0], item.position[1] - game.walker.position[1]) < 60).map(item => item.family);
          const calling = game.callingStructure?.family; if (calling) near.push(calling);
          if (near.length) audio?.warm([...new Set(near)]);
        }
        audio?.update({ walker: { position: [game.walker.position[0], game.walker.position[1]], yaw: game.walker.yaw }, ariadne: game.ariadne ? { position: [game.ariadne.position[0], game.ariadne.position[1]], height: game.ariadne.height } : null, call: { structureId: game.call.structureId, family: game.call.family, position: game.call.position, gain: game.call.gain }, offWayFactor: game.offWayFactor, waterDistance: water, clearings: game.structures.completed().map(item => ({ id: item.id, family: item.family, x: item.position[0], z: item.position[1] })), attending: (() => { const engaged = game.engagedElement(); return engaged && !engaged.active ? { position: engaged.position, noteHz: engaged.noteHz, attention: engaged.attention } : null; })() });
      }
      renderer.render({ time: game.time, pulse: audio?.pulse() ?? 0, voiceLevel: audio?.voice.level() ?? 0, reducedMotion: game.reducedMotion, quality: quality?.quality ?? 1 });
      lastWorkMs = performance.now() - workStarted;
      if (time - captionAt >= 100) {
        captionAt = time; setNow(time);
        const canvas = canvasRef.current;
        if (canvas && quality) {
          canvas.dataset.fps = quality.fps.toFixed(1);
          canvas.dataset.frameMs = quality.frameMs.toFixed(1);
          canvas.dataset.workMs = quality.workMs.toFixed(1);
          canvas.dataset.quality = quality.quality.toFixed(2);
        }
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Resize.
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { const rect = canvas.getBoundingClientRect(); rendererRef.current?.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height))); };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    return () => observer.disconnect();
  }, [ready]);

  // Suspend sound while hidden; the current game remains in memory until reload.
  useEffect(() => {
    const hide = () => { if (document.hidden) audioRef.current?.pause(); else if (experienceRef.current === "playing") audioRef.current?.resume(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); };
  }, []);

  /** Take the pointer so the mouse looks around without a button held; if the browser refuses, the mouse looks anyway. */
  const takePointer = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas || document.pointerLockElement === canvas) return;
    // Free mouse look also works while capture is pending or unavailable.
    pointerLockFailedRef.current = true;
    if (!("requestPointerLock" in canvas)) return;
    try {
      const request = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (request && typeof request.catch === "function") request.catch(() => { pointerLockFailedRef.current = true; });
    } catch { pointerLockFailedRef.current = true; }
  }, []);
  const releasePointer = useCallback(() => { if (document.pointerLockElement) { releasingPointerRef.current = true; document.exitPointerLock?.(); } }, []);
  const pause = useCallback(() => { heldRef.current.clear(); touchMoveRef.current = [0, 0]; releasePointer(); audioRef.current?.pause(); setLogOpen(false); setExperience("paused"); }, [releasePointer]);
  const resume = useCallback(() => { audioRef.current?.resume(); setExperience("playing"); const canvas = canvasRef.current; canvas?.focus(); takePointer(); requestAnimationFrame(() => canvasRef.current?.focus()); }, [takePointer]);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* The browser may deny fullscreen outside a top-level page. */ }
  }, []);

  // Without Keyboard Lock, Escape may be consumed by the browser releasing the pointer.
  // That release pauses play; releases requested for chat or settings do not.
  useEffect(() => {
    let ownedPointer = document.pointerLockElement === canvasRef.current && canvasRef.current !== null;
    const change = () => {
      const canvas = canvasRef.current;
      const previouslyOwned = ownedPointer;
      ownedPointer = document.pointerLockElement === canvas && canvas !== null;
      if (document.pointerLockElement === canvas && canvas) { pointerLockFailedRef.current = false; releasingPointerRef.current = false; return; }
      const asked = releasingPointerRef.current; releasingPointerRef.current = false;
      if (previouslyOwned && !asked && experienceRef.current === "playing" && !logOpenRef.current) pause();
    };
    const failed = () => { pointerLockFailedRef.current = true; };
    document.addEventListener("pointerlockchange", change); document.addEventListener("pointerlockerror", failed);
    return () => { document.removeEventListener("pointerlockchange", change); document.removeEventListener("pointerlockerror", failed); };
  }, [pause]);
  const startAgain = useCallback(() => { write(SAVE_KEY, null); location.reload(); }, []);

  // Keyboard.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase(), state = experienceRef.current;
      if (event.key === "Escape") {
        if (state === "playing" || state === "paused") event.preventDefault();
        if (event.repeat) return;
        if (state === "playing") { if (logOpenRef.current) { logOpenRef.current = false; setInput(""); setLogOpen(false); inputRef.current?.blur(); canvasRef.current?.focus();
          // Do not capture the pointer during Escape: its default release can otherwise pause play.
          // Free mouse look stays available; the next movement key can capture it again.
          pointerLockFailedRef.current = true;
        } else pause(); }
        else if (state === "paused") { event.preventDefault(); resume(); }
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (state !== "playing") return;
      if (event.key === "Enter") { event.preventDefault(); heldRef.current.clear(); logOpenRef.current = true; releasePointer(); setLogOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); return; }
      if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        event.preventDefault();
        // The first step takes the pointer, so looking never needs a click or a drag.
        if (!event.repeat) { heldRef.current.add(key); if (!logOpenRef.current) takePointer(); }
      }
    };
    const up = (event: KeyboardEvent) => heldRef.current.delete(event.key.toLowerCase());
    const blur = () => { heldRef.current.clear(); touchMoveRef.current = [0, 0]; };
    let dragging = false, lastX = 0, lastY = 0;
    const mouse = (event: MouseEvent) => {
      if (experienceRef.current !== "playing" || logOpenRef.current) return;
      const locked = document.pointerLockElement === canvasRef.current;
      if (locked) { lookRef.current -= event.movementX * .0022; pitchRef.current -= event.movementY * .0022; }
      else if (dragging) { lookRef.current -= (event.clientX - lastX) * .0042; pitchRef.current -= (event.clientY - lastY) * .0042; lastX = event.clientX; lastY = event.clientY; }
      // No pointer to take (an embedding that forbids it, a browser without it): the mouse looks around over the field on its own.
      else if (pointerLockFailedRef.current && event.target === canvasRef.current) { lookRef.current -= event.movementX * .0022; pitchRef.current -= event.movementY * .0022; }
    };
    const mouseDown = (event: MouseEvent) => { if (event.target === canvasRef.current && event.button === 0) { dragging = true; lastX = event.clientX; lastY = event.clientY; } };
    const mouseUp = () => { dragging = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    window.addEventListener("mousemove", mouse); window.addEventListener("mousedown", mouseDown); window.addEventListener("mouseup", mouseUp);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); window.removeEventListener("mousemove", mouse); window.removeEventListener("mousedown", mouseDown); window.removeEventListener("mouseup", mouseUp); };
  }, [pause, resume, takePointer, releasePointer]);

  // Touch: the left half walks, the right half looks.
  const onTouchStart = useCallback((event: React.TouchEvent<HTMLCanvasElement>) => {
    if (experienceRef.current !== "playing") return;
    const rect = event.currentTarget.getBoundingClientRect();
    for (const touch of Array.from(event.changedTouches)) touchRef.current.set(touch.identifier, { kind: touch.clientX < rect.left + rect.width / 2 ? "move" : "look", startX: touch.clientX, startY: touch.clientY, lastX: touch.clientX, lastY: touch.clientY });
  }, []);
  const onTouchMove = useCallback((event: React.TouchEvent<HTMLCanvasElement>) => {
    for (const touch of Array.from(event.changedTouches)) {
      const control = touchRef.current.get(touch.identifier); if (!control) continue;
      if (control.kind === "move") touchMoveRef.current = [Math.max(-1, Math.min(1, (touch.clientX - control.startX) / 70)), Math.max(-1, Math.min(1, (control.startY - touch.clientY) / 54))];
      else { lookRef.current -= (touch.clientX - control.lastX) * .0042; pitchRef.current -= (touch.clientY - control.lastY) * .0042; control.lastX = touch.clientX; control.lastY = touch.clientY; }
    }
  }, []);
  const onTouchEnd = useCallback((event: React.TouchEvent<HTMLCanvasElement>) => {
    for (const touch of Array.from(event.changedTouches)) { const control = touchRef.current.get(touch.identifier); touchRef.current.delete(touch.identifier); if (control?.kind === "move") touchMoveRef.current = [0, 0]; }
  }, []);

  const enterHeadphones = useCallback(() => setExperience("headphones"), []);
  const enterField = useCallback(async () => {
    setExperience("playing");
    canvasRef.current?.focus();
    // Request capture during the Ready click, before loading can consume user activation.
    takePointer();
    await begin();
    requestAnimationFrame(() => canvasRef.current?.focus());
  }, [begin, takePointer]);

  const submit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim(); if (!text) { setLogOpen(false); canvasRef.current?.focus(); return; }
    speechRef.current?.say(text);
    setCaptions(list => [...list, { id: `w${Date.now()}`, role: "walker" as const, text, at: performance.now() }]);
    setInput(""); setLogOpen(false); canvasRef.current?.focus();
  }, [input]);

  const visible = logOpen ? captions : captions.filter(line => now - line.at < captionLife(line.text)).slice(-3);
  const record = captions;

  return <main className="fog-shell">
    {experience === "title" && <div className="fog-screen"><div className="fog-title">
      <Image src="/fog/images/ariadne-title-background.png" alt="" width={1920} height={1080} unoptimized priority />
      <h1 className="fog-title-heading">Ariadne</h1>
      <div className="fog-title-actions">
        <button className="fog-button" onClick={enterHeadphones}>Enter</button>
      </div>
      {/* The undertaking is authored, and the author is named where the participant enters and where they pause. */}
      <p className="fog-credit">A work by Mingde “MT” Zeng, 2026 · <a href={ABOUT_URL} target="_blank" rel="noreferrer">about the work</a></p>
    </div></div>}
    {experience === "headphones" && <div className="fog-screen fog-onboarding"><div className="fog-panel">
      <span className="fog-headphones" aria-hidden="true"><i /><i /></span>
      <h1>Headphones</h1>
      <p>Use headphones to hear where the call is coming from and Ariadne beside you.</p>
      <div className="fog-controls" aria-label="Controls">
        <dl className="desktop fog-control-list">
          <div><dt><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd></dt><dd>Move</dd></div>
          <div><dt>Mouse</dt><dd>Look around<span>Move the mouse to look around as soon as you start. Esc releases the pointer and pauses.</span></dd></div>
          <div><dt><kbd>Enter</kbd></dt><dd>Speak to Ariadne</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>Pause</dd></div>
        </dl>
        <dl className="touch fog-control-list">
          <div><dt>Drag left side</dt><dd>Move</dd></div>
          <div><dt>Drag right side</dt><dd>Look around</dd></div>
        </dl>
      </div>
      <button className="fog-button" onClick={() => void enterField()}>I&apos;m ready</button>
    </div></div>}
    {experience === "unavailable" && <div className="fog-screen"><div className="fog-panel">
      <h1>The field will not open here</h1>
      <p>This browser could not draw it: the fog is drawn with WebGL, which is switched off or unsupported on this device.</p>
      <button className="fog-button" onClick={() => location.reload()}>Try again</button>
      <p className="fog-credit in-panel">Mingde “MT” Zeng, 2026 · <a href={ABOUT_URL} target="_blank" rel="noreferrer">about the work</a></p>
    </div></div>}
    {experience === "paused" && <div className="fog-screen translucent fog-paused"><div className="fog-pause-layout"><div className="fog-pause-stage"><div className="fog-pause-panel">
      <h1>Paused</h1>
      <button className="fog-button" onClick={resume}>Continue</button>
      <button className="fog-button" onClick={startAgain}>Exit</button>
      <label className="fog-volume"><span>Sound</span><strong>{Math.round(masterVolume * 100)}%</strong><input type="range" min={0} max={1} step={.02} value={masterVolume} onChange={event => setMasterVolume(Number(event.target.value))} /></label>
      <button className="fog-button quiet fog-fullscreen" onClick={() => void toggleFullscreen()} disabled={!fullscreenAvailable}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
      <p className="fog-credit in-panel">Mingde “MT” Zeng, 2026 · <a href={ABOUT_URL} target="_blank" rel="noreferrer">about the work</a></p>
    </div></div>
    {record.length > 0 && <div className="fog-pause-history">
      <p className="fog-pause-log-title">Conversation</p>
      <div ref={pauseLogRef} className="fog-pause-log" role="log" aria-label="Conversation with Ariadne">
      {record.map((line, index) => <div key={line.id} className={`fog-line ${line.role}`}>{(index === 0 || record[index - 1].role !== line.role) && <span className="fog-line-speaker">{line.role === "walker" ? "You" : "Ariadne"}</span>}{line.text}</div>)}
      </div>
    </div>}
    </div></div>}
    <div className="fog-landscape-guard" role="status"><strong>Turn your device</strong><small>The field is walked in landscape.</small></div>
    <section className="fog-canvas-wrap" aria-hidden={experience !== "playing" && experience !== "paused"}>
      <canvas ref={canvasRef} tabIndex={0} aria-label="A field of white fog, first person" onClick={event => { if (experienceRef.current === "playing" && !logOpenRef.current) { event.currentTarget.focus(); takePointer(); } }} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={() => { touchRef.current.clear(); touchMoveRef.current = [0, 0]; }} />
      <div className="fog-grain" /><div className="fog-vignette" />
      {experience === "playing" && !ready && <div className="fog-hint">Opening the field</div>}
      {experience === "playing" && ready && <div className={`fog-hint ${hintVisible ? "" : "hidden"}`}>WASD · move &nbsp; Mouse · look &nbsp; Enter · speak &nbsp; Esc · pause</div>}
      {experience === "playing" && thinking && <div className="fog-thinking" aria-hidden="true" />}
      {experience === "playing" && visible.length > 0 && <div className={`fog-captions ${logOpen ? "log-open" : ""}`} role="log" aria-live="polite">{visible.map(line => <div key={line.id} className={`fog-line ${line.role}`}>{line.text}</div>)}</div>}
      {experience === "playing" && logOpen && <form className="fog-input" onSubmit={submit}><span aria-hidden="true">{">"}</span><input ref={inputRef} value={input} maxLength={500} onChange={event => setInput(event.target.value)} placeholder="Say something to Ariadne" aria-label="Speak to Ariadne" /></form>}
    </section>
  </main>;
}
