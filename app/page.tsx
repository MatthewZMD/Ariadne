"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SIZE = 17;
const FOV = Math.PI / 3;
const RAYS = 360;
const MOVE_SPEED = 2.05;
const TURN_SPEED = 1.9;
const PLAYER_RADIUS = 0.18;
const DIRS = [
  { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 },
];

type Point = { x: number; y: number };
type Pose = { x: number; y: number; angle: number; bob: number };
type Game = {
  maze: number[][];
  memory: number[][];
  seen: Set<string>;
  player: Point;
  exit: Point;
  moves: number;
  shifts: number;
  message: string;
  escaped: boolean;
};

const key = (x: number, y: number) => `${x},${y}`;
const wrapAngle = (angle: number) => (angle + Math.PI * 2) % (Math.PI * 2);
const bearing = (angle: number) => ["E", "S", "W", "N"][Math.round(wrapAngle(angle) / (Math.PI / 2)) % 4];

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeMaze(random: () => number): number[][] {
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(1));
  const stack: Point[] = [{ x: 1, y: 1 }];
  grid[1][1] = 0;
  while (stack.length) {
    const current = stack[stack.length - 1];
    const options = [
      { x: 2, y: 0 }, { x: -2, y: 0 }, { x: 0, y: 2 }, { x: 0, y: -2 },
    ].filter(({ x, y }) => {
      const nx = current.x + x;
      const ny = current.y + y;
      return nx > 0 && ny > 0 && nx < SIZE - 1 && ny < SIZE - 1 && grid[ny][nx] === 1;
    });
    if (!options.length) { stack.pop(); continue; }
    const next = options[Math.floor(random() * options.length)];
    grid[current.y + next.y / 2][current.x + next.x / 2] = 0;
    grid[current.y + next.y][current.x + next.x] = 0;
    stack.push({ x: current.x + next.x, y: current.y + next.y });
  }
  return grid;
}

function canReach(maze: number[][], from: Point, to: Point) {
  const queue = [from];
  const visited = new Set([key(from.x, from.y)]);
  while (queue.length) {
    const p = queue.shift()!;
    if (p.x === to.x && p.y === to.y) return true;
    for (const d of DIRS) {
      const x = p.x + d.x;
      const y = p.y + d.y;
      if (maze[y]?.[x] === 0 && !visited.has(key(x, y))) {
        visited.add(key(x, y));
        queue.push({ x, y });
      }
    }
  }
  return false;
}

function visibleCells(maze: number[][], pose: Pick<Pose, "x" | "y" | "angle">) {
  const visible = new Set<string>([key(Math.floor(pose.x), Math.floor(pose.y))]);
  // A full line-of-sight shell is immutable. This includes the first wall hit
  // by every ray, so regeneration can only happen behind occluding geometry.
  const protectionRays = 360;
  for (let i = 0; i < protectionRays; i++) {
    const ray = (i / protectionRays) * Math.PI * 2;
    for (let dist = 0.04; dist < 12; dist += 0.055) {
      const x = Math.floor(pose.x + Math.cos(ray) * dist);
      const y = Math.floor(pose.y + Math.sin(ray) * dist);
      visible.add(key(x, y));
      if (maze[y]?.[x] !== 0) break;
    }
  }
  return visible;
}

function shiftUnseen(game: Game, protectedCells: Set<string>) {
  const maze = game.maze.map((row) => [...row]);
  let changes = 0;
  for (let attempt = 0; attempt < 90 && changes < 6; attempt++) {
    const x = 1 + Math.floor(Math.random() * (SIZE - 2));
    const y = 1 + Math.floor(Math.random() * (SIZE - 2));
    if (protectedCells.has(key(x, y)) || (x === game.exit.x && y === game.exit.y)) continue;
    const old = maze[y][x];
    maze[y][x] = old ? 0 : 1;
    if (canReach(maze, game.player, game.exit)) changes++;
    else maze[y][x] = old;
  }
  return changes ? maze : game.maze;
}

function initialGame(seed = 1337): Game {
  const maze = makeMaze(seededRandom(seed));
  const exit = { x: SIZE - 2, y: SIZE - 2 };
  maze[exit.y][exit.x] = 0;
  const pose = { x: 1.5, y: 1.5, angle: 0 };
  const seen = visibleCells(maze, pose);
  const memory = Array.from({ length: SIZE }, () => Array(SIZE).fill(-1));
  seen.forEach((cell) => {
    const [x, y] = cell.split(",").map(Number);
    if (maze[y]?.[x] !== undefined) memory[y][x] = maze[y][x];
  });
  return { maze, memory, seen, player: { x: 1, y: 1 }, exit, moves: 0, shifts: 0, message: "SIGNAL ACQUIRED // FIND THE GREEN DOOR", escaped: false };
}

function castRay(maze: number[][], pose: Pose, angle: number) {
  const rayX = Math.cos(angle);
  const rayY = Math.sin(angle);
  let mapX = Math.floor(pose.x);
  let mapY = Math.floor(pose.y);
  const deltaX = Math.abs(1 / (rayX || 0.00001));
  const deltaY = Math.abs(1 / (rayY || 0.00001));
  const stepX = rayX < 0 ? -1 : 1;
  const stepY = rayY < 0 ? -1 : 1;
  let sideX = rayX < 0 ? (pose.x - mapX) * deltaX : (mapX + 1 - pose.x) * deltaX;
  let sideY = rayY < 0 ? (pose.y - mapY) * deltaY : (mapY + 1 - pose.y) * deltaY;
  let side = 0;
  for (let i = 0; i < 40; i++) {
    if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
    else { sideY += deltaY; mapY += stepY; side = 1; }
    if (maze[mapY]?.[mapX] !== 0) break;
  }
  const distance = side === 0
    ? (mapX - pose.x + (1 - stepX) / 2) / rayX
    : (mapY - pose.y + (1 - stepY) / 2) / rayY;
  const hit = side === 0 ? pose.y + distance * rayY : pose.x + distance * rayX;
  return { distance: Math.max(distance, 0.01), mapX, mapY, side, texture: hit - Math.floor(hit) };
}

function renderScene(ctx: CanvasRenderingContext2D, game: Game, pose: Pose, moving: boolean) {
  const { width, height } = ctx.canvas;
  const bob = moving ? Math.sin(pose.bob) * 3.5 : 0;
  const horizon = height * 0.47 + bob;
  const ceiling = ctx.createLinearGradient(0, 0, 0, horizon);
  ceiling.addColorStop(0, "#101311");
  ceiling.addColorStop(1, "#252722");
  ctx.fillStyle = ceiling;
  ctx.fillRect(0, 0, width, horizon);
  const floor = ctx.createLinearGradient(0, horizon, 0, height);
  floor.addColorStop(0, "#343128");
  floor.addColorStop(1, "#12130f");
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, width, height - horizon);

  ctx.strokeStyle = "rgba(205, 195, 162, .055)";
  for (let i = 1; i < 9; i++) {
    const y = horizon + (height - horizon) * (i / 9) ** 0.48;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }

  for (let i = 0; i < RAYS; i++) {
    const rayAngle = pose.angle - FOV / 2 + (i / RAYS) * FOV;
    const ray = castRay(game.maze, pose, rayAngle);
    const corrected = ray.distance * Math.cos(rayAngle - pose.angle);
    const wallH = Math.min(height * 1.7, height / Math.max(corrected, 0.22));
    const top = horizon - wallH / 2;
    const x = (i / RAYS) * width;
    const columnW = width / RAYS + 1;
    const hash = ((ray.mapX * 37 + ray.mapY * 71) % 11) - 5;
    const fog = Math.min(1, corrected / 10.5);
    const light = Math.max(19, 47 - fog * 25 + hash * 0.45 - ray.side * 5);
    const saturation = Math.max(7, 18 - fog * 8);
    ctx.fillStyle = `hsl(41 ${saturation}% ${light}%)`;
    ctx.fillRect(x, top, columnW, wallH);

    const verticalMortar = ray.texture < 0.035 || ray.texture > 0.965;
    if (verticalMortar) {
      ctx.fillStyle = `rgba(18, 20, 17, ${0.26 + fog * 0.24})`;
      ctx.fillRect(x, top, columnW, wallH);
    }
    const blockRows = 5;
    for (let row = 1; row < blockRows; row++) {
      const seam = top + wallH * (row / blockRows);
      if (seam >= 0 && seam <= height) {
        ctx.fillStyle = `rgba(17, 18, 15, ${0.24 + fog * 0.18})`;
        ctx.fillRect(x, seam, columnW, Math.max(1, wallH * 0.008));
      }
    }
    const grain = (Math.sin(ray.texture * 74 + ray.mapX * 9 + ray.mapY * 5) + 1) * 0.5;
    ctx.fillStyle = `rgba(238, 224, 185, ${grain * 0.035 * (1 - fog)})`;
    ctx.fillRect(x, top, columnW, wallH);

    if (ray.mapX === game.exit.x && ray.mapY === game.exit.y) {
      ctx.fillStyle = `rgba(95, 190, 112, ${0.54 * (1 - fog * .55)})`;
      ctx.fillRect(x, top, columnW, wallH);
    }
  }

  const fog = ctx.createRadialGradient(width / 2, horizon, height * .12, width / 2, horizon, width * .7);
  fog.addColorStop(0, "rgba(0,0,0,0)");
  fog.addColorStop(1, "rgba(3,4,3,.42)");
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(220, 208, 170, .48)";
  ctx.fillRect(width / 2 - 7, horizon, 14, 1);
  ctx.fillRect(width / 2, horizon - 7, 1, 14);
  ctx.fillStyle = "rgba(0,0,0,.055)";
  for (let y = 0; y < height; y += 5) ctx.fillRect(0, y, width, 1);
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game>(() => initialGame());
  const gameRef = useRef(game);
  const poseRef = useRef<Pose>({ x: 1.5, y: 1.5, angle: 0, bob: 0 });
  const heldRef = useRef(new Set<string>());
  const lastCellRef = useRef("1,1");
  const touchXRef = useRef<number | null>(null);
  const [heading, setHeading] = useState("E");

  useEffect(() => { gameRef.current = game; }, [game]);

  const visitCell = useCallback((x: number, y: number) => {
    lastCellRef.current = key(x, y);
    setGame((old) => {
      if (old.escaped) return old;
      const pose = poseRef.current;
      const player = { x, y };
      const moves = old.moves + 1;
      let maze = old.maze;
      let shifts = old.shifts;
      let message = "FOOTSTEPS ECHO BEHIND YOU";
      const protectedCells = visibleCells(maze, pose);
      if (moves % 3 === 0) {
        const shifted = shiftUnseen({ ...old, player, moves }, protectedCells);
        if (shifted !== maze) { maze = shifted; shifts++; message = "GEOMETRY SHIFT DETECTED OUTSIDE VIEW"; }
      }
      const seen = new Set(old.seen);
      const memory = old.memory.map((row) => [...row]);
      visibleCells(maze, pose).forEach((cell) => {
        seen.add(cell);
        const [cx, cy] = cell.split(",").map(Number);
        if (maze[cy]?.[cx] !== undefined) memory[cy][cx] = maze[cy][cx];
      });
      const escaped = x === old.exit.x && y === old.exit.y;
      return { ...old, maze, memory, seen, player, moves, shifts, escaped, message: escaped ? "EXIT HELD IN SIGHT // LOOP BROKEN" : message };
    });
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const value = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(value)) {
        event.preventDefault();
        heldRef.current.add(value);
      }
    };
    const up = (event: KeyboardEvent) => heldRef.current.delete(event.key.toLowerCase());
    const blur = () => heldRef.current.clear();
    const mouse = (event: MouseEvent) => {
      if (document.pointerLockElement === canvasRef.current) poseRef.current.angle = wrapAngle(poseRef.current.angle + event.movementX * 0.0022);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("mousemove", mouse);
    return () => {
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur); window.removeEventListener("mousemove", mouse);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      const current = gameRef.current;
      const pose = poseRef.current;
      const held = heldRef.current;
      let turn = 0;
      if (held.has("a") || held.has("arrowleft")) turn -= 1;
      if (held.has("d") || held.has("arrowright")) turn += 1;
      pose.angle = wrapAngle(pose.angle + turn * TURN_SPEED * dt);
      let drive = 0;
      if (held.has("w") || held.has("arrowup")) drive += 1;
      if (held.has("s") || held.has("arrowdown")) drive -= 1;
      const moving = drive !== 0 && !current.escaped;
      if (moving) {
        const distance = drive * MOVE_SPEED * dt;
        const nx = pose.x + Math.cos(pose.angle) * distance;
        const ny = pose.y + Math.sin(pose.angle) * distance;
        const maze = current.maze;
        const clearX = maze[Math.floor(pose.y - PLAYER_RADIUS)]?.[Math.floor(nx - PLAYER_RADIUS)] === 0 && maze[Math.floor(pose.y + PLAYER_RADIUS)]?.[Math.floor(nx + PLAYER_RADIUS)] === 0;
        if (clearX) pose.x = nx;
        const clearY = maze[Math.floor(ny - PLAYER_RADIUS)]?.[Math.floor(pose.x - PLAYER_RADIUS)] === 0 && maze[Math.floor(ny + PLAYER_RADIUS)]?.[Math.floor(pose.x + PLAYER_RADIUS)] === 0;
        if (clearY) pose.y = ny;
        pose.bob += dt * 9;
        const cell = key(Math.floor(pose.x), Math.floor(pose.y));
        if (cell !== lastCellRef.current) visitCell(Math.floor(pose.x), Math.floor(pose.y));
      }
      const nextHeading = bearing(pose.angle);
      setHeading((old) => old === nextHeading ? old : nextHeading);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx && canvas) renderScene(ctx, current, pose, moving);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visitCell]);

  const hold = (control: string, active: boolean) => {
    if (active) heldRef.current.add(control);
    else heldRef.current.delete(control);
  };

  const reset = () => {
    heldRef.current.clear();
    poseRef.current = { x: 1.5, y: 1.5, angle: 0, bob: 0 };
    lastCellRef.current = "1,1";
    setHeading("E");
    setGame(initialGame(Date.now()));
  };

  return (
    <main className="shell">
      <header className="masthead">
        <div className="brand"><span>NULL</span> CORRIDOR</div>
        <div className="status"><i /> LIVE GEOMETRY</div>
      </header>

      <section className="game-grid" aria-label="First person maze game">
        <div className="viewport-wrap">
          <div className="viewport-label"><span>CAM_01 // {heading}</span><span>CLICK VIEW FOR MOUSE LOOK</span></div>
          <canvas
            ref={canvasRef}
            width={960}
            height={560}
            aria-label="First-person view into the maze. Click for mouse look."
            onClick={(event) => event.currentTarget.requestPointerLock?.()}
            onTouchStart={(event) => { touchXRef.current = event.touches[0]?.clientX ?? null; }}
            onTouchMove={(event) => {
              const x = event.touches[0]?.clientX;
              if (x !== undefined && touchXRef.current !== null) poseRef.current.angle = wrapAngle(poseRef.current.angle + (x - touchXRef.current) * 0.006);
              touchXRef.current = x ?? null;
            }}
            onTouchEnd={() => { touchXRef.current = null; }}
          />
          <div className="vignette" />
          {game.escaped && (
            <div className="escape-card"><p>LOOP INTERRUPTED</p><h1>YOU HELD THE EXIT IN VIEW.</h1><button onClick={reset}>ENTER AGAIN</button></div>
          )}
        </div>

        <aside className="console">
          <div className="console-head"><span>LOCAL MEMORY</span><span className="blink">REC</span></div>
          <div className="minimap" style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }} aria-label="Map of remembered maze geometry">
            {game.memory.flatMap((row, y) => row.map((cell, x) => {
              const isPlayer = game.player.x === x && game.player.y === y;
              const isExit = game.exit.x === x && game.exit.y === y && game.seen.has(key(x, y));
              return <span key={key(x, y)} className={`${cell === 1 ? "wall" : cell === 0 ? "path" : "unknown"} ${isPlayer ? "player" : ""} ${isExit ? "exit" : ""}`} />;
            }))}
          </div>
          <p className="map-note">WARNING: MEMORY IS NOT GEOMETRY</p>
          <dl className="telemetry">
            <div><dt>CELLS</dt><dd>{String(game.moves).padStart(3, "0")}</dd></div>
            <div><dt>SHIFTS</dt><dd>{String(game.shifts).padStart(3, "0")}</dd></div>
            <div><dt>BEARING</dt><dd>{heading}</dd></div>
          </dl>
          <div className="signal"><span>SIGNAL</span><b>{game.message}</b></div>
        </aside>
      </section>

      <footer className="controls">
        <div className="control-copy"><span>MOVE CONTINUOUSLY</span><p>HOLD W/S · TURN WITH A/D · CLICK VIEW FOR MOUSE LOOK</p></div>
        <div className="keys" aria-label="Maze controls">
          {[["a", "A", "Turn left"], ["w", "W", "Move forward"], ["d", "D", "Turn right"], ["s", "S", "Move backward"]].map(([control, label, aria]) => (
            <button key={control} onPointerDown={() => hold(control, true)} onPointerUp={() => hold(control, false)} onPointerLeave={() => hold(control, false)} aria-label={aria}>{label}</button>
          ))}
        </div>
        <button className="reset" onClick={reset}>NEW SIGNAL</button>
      </footer>
    </main>
  );
}
