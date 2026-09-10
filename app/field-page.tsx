"use client";

/**
 * The field, as a page: title, headphones, the fog, a pause. Owns the frame
 * loop and the input, wires the game to the renderer, the audio and the
 * speech layer, and saves the session so that closing the tab does nothing
 * and reopening it restores the field as it was.
 */
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { FieldGame, type FieldInput, type FieldSave } from "./field/game.ts";
import { createFieldAudio, type FieldAudio } from "./field/audio.ts";
import { FieldSpeech, type SpeechLine, type SpeechSave } from "./field/speech.ts";
import type { FieldRenderer } from "./field/render/renderer.ts";

type Experience = "title" | "headphones" | "playing" | "paused";
type Caption = { id: string; role: "ariadne" | "walker"; text: string; at: number };
type SavedSession = { version: 1; savedAt: number; game: FieldSave; speech: SpeechSave };

const SAVE_KEY = "ariadne:field:save";
const SESSION_KEY = "ariadne:field:session";
const VOLUME_KEY = "ariadne:field:volume";
const MOTION_KEY = "ariadne:field:still";
const SAVE_INTERVAL_MS = 5000;
const CAPTION_LIFE_MS = 9000;

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage unavailable */ } };
const randomId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const seedFrom = (id: string) => { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

function loadSave(): SavedSession | null {
  const raw = read(SAVE_KEY); if (!raw) return null;
  try { const parsed = JSON.parse(raw) as SavedSession; return parsed && parsed.version === 1 && parsed.game?.seed !== undefined ? parsed : null; } catch { return null; }
}

export default function FieldPage() {
  const [experience, setExperience] = useState<Experience>("title");
  const [hasSave, setHasSave] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [masterVolume, setMasterVolume] = useState(1);
  const [still, setStill] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gameRef = useRef<FieldGame | null>(null);
  const rendererRef = useRef<FieldRenderer | null>(null);
  const audioRef = useRef<FieldAudio | null>(null);
  const speechRef = useRef<FieldSpeech | null>(null);
  const experienceRef = useRef<Experience>("title");
  const heldRef = useRef(new Set<string>());
  const lookRef = useRef(0);
  const touchRef = useRef(new Map<number, { kind: "move" | "look"; startX: number; startY: number; lastX: number }>());
  const touchMoveRef = useRef<[number, number]>([0, 0]);
  const logOpenRef = useRef(false);
  const lastSaveRef = useRef(0);
  const sessionIdRef = useRef("");
  const stillRef = useRef(false);
  const systemStillRef = useRef(false);

  useEffect(() => { experienceRef.current = experience; }, [experience]);
  useEffect(() => { logOpenRef.current = logOpen; if (logOpen) inputRef.current?.focus(); }, [logOpen]);

  // Preferences and the saved session.
  useEffect(() => {
    const syncPreferences = () => {
      setHasSave(loadSave() !== null);
      const stored = read(VOLUME_KEY), volume = Number(stored); if (stored !== null && Number.isFinite(volume)) setMasterVolume(Math.max(0, Math.min(1, volume)));
      setStill(read(MOTION_KEY) === "1");
      let id = read(SESSION_KEY); if (!id) { id = randomId(); write(SESSION_KEY, id); } sessionIdRef.current = id;
    };
    syncPreferences();
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { systemStillRef.current = query.matches; if (gameRef.current) gameRef.current.reducedMotion = query.matches || stillRef.current; };
    sync(); query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => { stillRef.current = still; write(MOTION_KEY, still ? "1" : null); if (gameRef.current) gameRef.current.reducedMotion = still || systemStillRef.current; }, [still]);
  useEffect(() => { write(VOLUME_KEY, String(masterVolume)); audioRef.current?.setMasterVolume(masterVolume); }, [masterVolume]);

  const persist = useCallback(() => {
    const game = gameRef.current, speech = speechRef.current; if (!game || !speech) return;
    const saved: SavedSession = { version: 1, savedAt: Date.now(), game: game.save(), speech: speech.save() };
    write(SAVE_KEY, JSON.stringify(saved));
    lastSaveRef.current = performance.now();
  }, []);

  /** Build the game (fresh or restored), the audio and the speech layer. Called once, from the headphones screen, on a user gesture. */
  const begin = useCallback(async () => {
    if (gameRef.current) return;
    const saved = loadSave();
    const game = saved ? FieldGame.restore(saved.game) : new FieldGame(seedFrom(randomId()));
    game.reducedMotion = stillRef.current || systemStillRef.current;
    gameRef.current = game;
    const audio = createFieldAudio({ sessionId: sessionIdRef.current });
    audioRef.current = audio;
    audio.setMasterVolume(masterVolume);
    const speech = new FieldSpeech(game, audio, { sessionId: sessionIdRef.current, onThinking: setThinking, onLine: (line: SpeechLine) => setCaptions(list => [...list, { id: line.id, role: "ariadne" as const, text: line.text, at: performance.now() }].slice(-60)) });
    if (saved) { speech.restore(saved.speech); setCaptions(game.memory.captions.slice(-6).map(line => ({ id: line.id, role: line.role, text: line.text, at: -Infinity }))); }
    speechRef.current = speech;
    await audio.unlock();
    audio.warm(["teaching"]);
    const { FieldRenderer } = await import("./field/render/renderer.ts");
    const canvas = canvasRef.current; if (!canvas) return;
    const renderer = new FieldRenderer(canvas, game);
    rendererRef.current = renderer;
    const rect = canvas.getBoundingClientRect(); renderer.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
    // A playtest hook: ?debug exposes the running pieces to scripts (scripts/playtest.mjs) and to a curious console.
    if (location.search.includes("debug")) (window as unknown as { __ariadneField?: unknown }).__ariadneField = { game, speech, audio, renderer };
    setReady(true);
  }, [masterVolume]);

  // Frame loop.
  useEffect(() => {
    let frame = 0, previous = performance.now(), accumulator = 0, waterAt = 0, water: number | null = null;
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(.2, (time - previous) / 1000); previous = time;
      const game = gameRef.current, renderer = rendererRef.current, audio = audioRef.current, speech = speechRef.current;
      if (!game || !renderer) return;
      const playing = experienceRef.current === "playing" && !document.hidden;
      if (playing) {
        const held = logOpenRef.current ? new Set<string>() : heldRef.current;
        let forward = 0, strafe = 0, turn = 0;
        if (held.has("w") || held.has("arrowup")) forward += 1; if (held.has("s") || held.has("arrowdown")) forward -= 1;
        if (held.has("a") || held.has("arrowleft")) turn += 1; if (held.has("d") || held.has("arrowright")) turn -= 1;
        if (held.has("q")) strafe -= 1; if (held.has("e")) strafe += 1;
        if (touchMoveRef.current[1] !== 0) forward = touchMoveRef.current[1]; if (touchMoveRef.current[0] !== 0) strafe = touchMoveRef.current[0];
        const fieldInput: FieldInput = { forward, strafe, turn, lookDelta: lookRef.current };
        lookRef.current = 0;
        if (forward || strafe || turn || fieldInput.lookDelta) setHintVisible(false);
        // Fixed-step simulation so behaviour does not depend on frame rate.
        accumulator = Math.min(accumulator + dt, .25);
        const step = 1 / 60;
        while (accumulator >= step) { game.update(step, fieldInput); accumulator -= step; fieldInput.lookDelta = 0; }
        for (const event of game.drain()) { audio?.handle(event); renderer.handle(event); if (event.type === "speak") speech?.handle(event); }
        speech?.update();
        if (time - waterAt > 500) {
          waterAt = time; water = game.waterDistance();
          // Load a family's sounds as its structures come within reach; the whole library never downloads at once.
          const near = game.structures.all().filter(item => Math.hypot(item.position[0] - game.walker.position[0], item.position[1] - game.walker.position[1]) < 60).map(item => item.family);
          const calling = game.callingStructure?.family; if (calling) near.push(calling);
          if (near.length) audio?.warm([...new Set(near)]);
        }
        audio?.update({ walker: { position: [game.walker.position[0], game.walker.position[1]], yaw: game.walker.yaw }, ariadne: game.ariadne ? { position: [game.ariadne.position[0], game.ariadne.position[1]], height: game.ariadne.height } : null, call: { structureId: game.call.structureId, family: game.callingStructure?.family ?? (game.call.structureId ? game.structures.get(game.call.structureId)?.family ?? null : null), position: game.call.position, gain: game.call.gain }, offWayFactor: game.offWayFactor, waterDistance: water, clearings: game.structures.completed().map(item => ({ id: item.id, family: item.family, x: item.position[0], z: item.position[1] })) });
        if (time - lastSaveRef.current > SAVE_INTERVAL_MS) persist();
      }
      renderer.render({ time: game.time, pulse: audio?.pulse() ?? 0, voiceLevel: audio?.voice.level() ?? 0, reducedMotion: game.reducedMotion });
      if ((frame & 15) === 0) setNow(performance.now());
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [persist]);

  // Resize.
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { const rect = canvas.getBoundingClientRect(); rendererRef.current?.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height))); };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    return () => observer.disconnect();
  }, [ready]);

  // Save when the tab hides or closes. Nothing else happens: leaving is unmarked.
  useEffect(() => {
    const hide = () => { if (gameRef.current) persist(); if (document.hidden) audioRef.current?.pause(); else if (experienceRef.current === "playing") audioRef.current?.resume(); };
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", persist); window.addEventListener("beforeunload", persist);
    return () => { document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", persist); window.removeEventListener("beforeunload", persist); };
  }, [persist]);

  const pause = useCallback(() => { heldRef.current.clear(); touchMoveRef.current = [0, 0]; document.exitPointerLock?.(); audioRef.current?.pause(); setLogOpen(false); setExperience("paused"); persist(); }, [persist]);
  const resume = useCallback(() => { audioRef.current?.resume(); setExperience("playing"); requestAnimationFrame(() => canvasRef.current?.focus()); }, []);
  const startAgain = useCallback(() => { write(SAVE_KEY, null); location.reload(); }, []);

  // Keyboard.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase(), state = experienceRef.current;
      if (event.key === "Escape") {
        if (state === "playing") { event.preventDefault(); if (logOpenRef.current) { setLogOpen(false); inputRef.current?.blur(); canvasRef.current?.focus(); } else pause(); }
        else if (state === "paused") { event.preventDefault(); resume(); }
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (state !== "playing") return;
      if (event.key === "Enter") { event.preventDefault(); heldRef.current.clear(); setLogOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); return; }
      if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) { event.preventDefault(); if (!event.repeat) heldRef.current.add(key); }
    };
    const up = (event: KeyboardEvent) => heldRef.current.delete(event.key.toLowerCase());
    const blur = () => { heldRef.current.clear(); touchMoveRef.current = [0, 0]; };
    let dragging = false, lastX = 0;
    const mouse = (event: MouseEvent) => {
      if (experienceRef.current !== "playing" || logOpenRef.current) return;
      const locked = document.pointerLockElement === canvasRef.current;
      if (locked) lookRef.current -= event.movementX * .0022;
      else if (dragging) { lookRef.current -= (event.clientX - lastX) * .0042; lastX = event.clientX; }
    };
    const mouseDown = (event: MouseEvent) => { if (event.target === canvasRef.current && event.button === 0) { dragging = true; lastX = event.clientX; } };
    const mouseUp = () => { dragging = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    window.addEventListener("mousemove", mouse); window.addEventListener("mousedown", mouseDown); window.addEventListener("mouseup", mouseUp);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); window.removeEventListener("mousemove", mouse); window.removeEventListener("mousedown", mouseDown); window.removeEventListener("mouseup", mouseUp); };
  }, [pause, resume]);

  // Touch: the left half walks, the right half looks.
  const onTouchStart = useCallback((event: React.TouchEvent<HTMLCanvasElement>) => {
    if (experienceRef.current !== "playing") return;
    const rect = event.currentTarget.getBoundingClientRect();
    for (const touch of Array.from(event.changedTouches)) touchRef.current.set(touch.identifier, { kind: touch.clientX < rect.left + rect.width / 2 ? "move" : "look", startX: touch.clientX, startY: touch.clientY, lastX: touch.clientX });
  }, []);
  const onTouchMove = useCallback((event: React.TouchEvent<HTMLCanvasElement>) => {
    for (const touch of Array.from(event.changedTouches)) {
      const control = touchRef.current.get(touch.identifier); if (!control) continue;
      if (control.kind === "move") touchMoveRef.current = [Math.max(-1, Math.min(1, (touch.clientX - control.startX) / 70)), Math.max(-1, Math.min(1, (control.startY - touch.clientY) / 54))];
      else { lookRef.current -= (touch.clientX - control.lastX) * .0042; control.lastX = touch.clientX; }
    }
  }, []);
  const onTouchEnd = useCallback((event: React.TouchEvent<HTMLCanvasElement>) => {
    for (const touch of Array.from(event.changedTouches)) { const control = touchRef.current.get(touch.identifier); touchRef.current.delete(touch.identifier); if (control?.kind === "move") touchMoveRef.current = [0, 0]; }
  }, []);

  const enterHeadphones = useCallback(() => setExperience("headphones"), []);
  const enterField = useCallback(async () => {
    setExperience("playing");
    await begin();
    requestAnimationFrame(() => canvasRef.current?.focus());
  }, [begin]);

  const submit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim(); if (!text) { setLogOpen(false); canvasRef.current?.focus(); return; }
    speechRef.current?.say(text);
    setCaptions(list => [...list, { id: `w${Date.now()}`, role: "walker" as const, text, at: performance.now() }].slice(-60));
    setInput(""); setLogOpen(false); canvasRef.current?.focus();
  }, [input]);

  const visible = logOpen ? captions : captions.filter(line => now - line.at < CAPTION_LIFE_MS).slice(-3);

  return <main className="fog-shell">
    {experience === "title" && <div className="fog-screen"><div className="fog-title">
      <Image src="/fog/images/ariadne-title-card.png" alt="Ariadne, in fog" width={1920} height={1080} unoptimized priority />
      <div className="fog-title-actions">
        <button className="fog-button" onClick={enterHeadphones}>{hasSave ? "Go back in" : "Enter"}</button>
        {hasSave && <button className="fog-button quiet" onClick={startAgain}>start somewhere new</button>}
      </div>
    </div></div>}
    {experience === "headphones" && <div className="fog-screen"><div className="fog-panel">
      <span className="fog-headphones" aria-hidden="true"><i /><i /></span>
      <h1>Headphones</h1>
      <p>The call comes from a direction, and she speaks close to you. Give it sound, and a little time.</p>
      <div className="fog-controls"><span className="desktop">W S · walk &nbsp; A D · turn &nbsp; mouse · look &nbsp; Enter · speak to her &nbsp; Esc · pause</span><span className="touch">Left half · walk &nbsp; Right half · look</span></div>
      <button className="fog-button" onClick={() => void enterField()}>I&apos;m ready</button>
    </div></div>}
    {experience === "paused" && <div className="fog-screen translucent"><div className="fog-pause-panel">
      <h1>Paused</h1>
      <button className="fog-button" onClick={resume}>Continue</button>
      <label className="fog-volume"><span>Sound</span><strong>{Math.round(masterVolume * 100)}%</strong><input type="range" min={0} max={1} step={.02} value={masterVolume} onChange={event => setMasterVolume(Number(event.target.value))} /></label>
      <label className="fog-toggle"><span>Still fog</span><input type="checkbox" checked={still} onChange={event => setStill(event.target.checked)} /></label>
      <button className="fog-button quiet" onClick={startAgain}>start somewhere new</button>
      <p className="fog-note">Closing the tab changes nothing. It will be as you left it.</p>
    </div></div>}
    <div className="fog-landscape-guard" role="status"><strong>Turn your device</strong><small>The field is walked in landscape.</small></div>
    <section className="fog-canvas-wrap" aria-hidden={experience !== "playing" && experience !== "paused"}>
      <canvas ref={canvasRef} tabIndex={0} aria-label="A field of white fog, first person" onClick={event => { if (experienceRef.current === "playing" && !logOpenRef.current) { event.currentTarget.focus(); void event.currentTarget.requestPointerLock?.(); } }} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={() => { touchRef.current.clear(); touchMoveRef.current = [0, 0]; }} />
      <div className="fog-grain" /><div className="fog-vignette" />
      {experience === "playing" && !ready && <div className="fog-hint">Opening the field</div>}
      {experience === "playing" && ready && <div className={`fog-hint ${hintVisible ? "" : "hidden"}`}>W S · walk &nbsp; A D · turn &nbsp; mouse · look &nbsp; Enter · speak</div>}
      {experience === "playing" && thinking && <div className="fog-thinking" aria-hidden="true" />}
      {(experience === "playing" || experience === "paused") && visible.length > 0 && <div className={`fog-captions ${logOpen ? "log-open" : ""}`} role="log" aria-live="polite">{visible.map(line => <div key={line.id} className={`fog-line ${line.role}`}>{line.text}</div>)}</div>}
      {experience === "playing" && logOpen && <form className="fog-input" onSubmit={submit}><span>To her</span><input ref={inputRef} value={input} maxLength={500} onChange={event => setInput(event.target.value)} placeholder="Say something, or Esc" aria-label="Speak to Ariadne" /></form>}
    </section>
  </main>;
}
