"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SIZE = 17;
const FOV = Math.PI / 3;
const RAYS = 240;
const DIRS = [
  { x: 1, y: 0, label: "E" },
  { x: 0, y: 1, label: "S" },
  { x: -1, y: 0, label: "W" },
  { x: 0, y: -1, label: "N" },
];

type Point = { x: number; y: number };
type Game = {
  maze: number[][];
  memory: number[][];
  seen: Set<string>;
  player: Point;
  exit: Point;
  dir: number;
  moves: number;
  shifts: number;
  message: string;
  escaped: boolean;
};

function key(x: number, y: number) {
  return `${x},${y}`;
}

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
    if (!options.length) {
      stack.pop();
      continue;
    }
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

function visibleCells(maze: number[][], player: Point, direction: number) {
  const visible = new Set<string>([key(player.x, player.y)]);
  const angle = direction * (Math.PI / 2);
  for (let i = 0; i < 100; i++) {
    const ray = angle - FOV / 2 + (i / 99) * FOV;
    for (let dist = 0.1; dist < 8; dist += 0.12) {
      const x = Math.floor(player.x + 0.5 + Math.cos(ray) * dist);
      const y = Math.floor(player.y + 0.5 + Math.sin(ray) * dist);
      visible.add(key(x, y));
      if (maze[y]?.[x] !== 0) break;
    }
  }
  return visible;
}

function shiftUnseen(game: Game, protectedCells: Set<string>) {
  const maze = game.maze.map((row) => [...row]);
  let changes = 0;
  for (let attempt = 0; attempt < 90 && changes < 7; attempt++) {
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
  const seen = visibleCells(maze, { x: 1, y: 1 }, 0);
  const memory = Array.from({ length: SIZE }, () => Array(SIZE).fill(-1));
  seen.forEach((cell) => {
    const [x, y] = cell.split(",").map(Number);
    if (maze[y]?.[x] !== undefined) memory[y][x] = maze[y][x];
  });
  return { maze, memory, seen, player: { x: 1, y: 1 }, exit, dir: 0, moves: 0, shifts: 0, message: "SIGNAL ACQUIRED // FIND THE GREEN DOOR", escaped: false };
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game>(() => initialGame());

  const act = useCallback((action: "left" | "right" | "forward" | "back") => {
    setGame((old) => {
      if (old.escaped) return old;
      let dir = old.dir;
      let player = old.player;
      let message = old.message;
      let moved = false;
      if (action === "left") dir = (dir + 3) % 4;
      if (action === "right") dir = (dir + 1) % 4;
      if (action === "forward" || action === "back") {
        const d = DIRS[dir];
        const sign = action === "forward" ? 1 : -1;
        const target = { x: player.x + d.x * sign, y: player.y + d.y * sign };
        if (old.maze[target.y]?.[target.x] === 0) {
          player = target;
          moved = true;
          message = "FOOTSTEPS ECHO BEHIND YOU";
        } else message = "// SOLID SIGNAL //";
      }
      const moves = old.moves + (moved ? 1 : 0);
      let maze = old.maze;
      let shifts = old.shifts;
      const nowVisible = visibleCells(maze, player, dir);
      if (moved && moves % 3 === 0) {
        const shifted = shiftUnseen({ ...old, player, dir, moves }, nowVisible);
        if (shifted !== maze) {
          maze = shifted;
          shifts++;
          message = "GEOMETRY SHIFT DETECTED OUTSIDE VIEW";
        }
      }
      const seen = new Set(old.seen);
      const memory = old.memory.map((row) => [...row]);
      const refreshed = visibleCells(maze, player, dir);
      refreshed.forEach((cell) => {
        seen.add(cell);
        const [x, y] = cell.split(",").map(Number);
        if (maze[y]?.[x] !== undefined) memory[y][x] = maze[y][x];
      });
      const escaped = player.x === old.exit.x && player.y === old.exit.y;
      return { ...old, maze, memory, seen, player, dir, moves, shifts, escaped, message: escaped ? "EXIT HELD IN SIGHT // LOOP BROKEN" : message };
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = event.key.toLowerCase();
      if (["arrowleft", "a", "arrowright", "d", "arrowup", "w", "arrowdown", "s"].includes(action)) event.preventDefault();
      if (action === "arrowleft" || action === "a") act("left");
      if (action === "arrowright" || action === "d") act("right");
      if (action === "arrowup" || action === "w") act("forward");
      if (action === "arrowdown" || action === "s") act("back");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const horizon = height * 0.48;
    ctx.fillStyle = "#080807";
    ctx.fillRect(0, 0, width, horizon);
    const floor = ctx.createLinearGradient(0, horizon, 0, height);
    floor.addColorStop(0, "#1b1a12");
    floor.addColorStop(1, "#050504");
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, width, height - horizon);
    ctx.strokeStyle = "rgba(215, 180, 62, .08)";
    for (let y = horizon; y < height; y += 18) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    const base = game.dir * Math.PI / 2;
    for (let i = 0; i < RAYS; i++) {
      const rayAngle = base - FOV / 2 + (i / RAYS) * FOV;
      let dist = 0.02;
      let hitX = 0;
      let hitY = 0;
      while (dist < 20) {
        hitX = Math.floor(game.player.x + 0.5 + Math.cos(rayAngle) * dist);
        hitY = Math.floor(game.player.y + 0.5 + Math.sin(rayAngle) * dist);
        if (game.maze[hitY]?.[hitX] !== 0) break;
        dist += 0.025;
      }
      const corrected = dist * Math.cos(rayAngle - base);
      const wallH = Math.min(height * 1.55, height / Math.max(corrected, 0.2));
      const x = (i / RAYS) * width;
      const columnW = width / RAYS + 1;
      const edge = Math.abs((game.player.x + 0.5 + Math.cos(rayAngle) * dist) % 1 - 0.5);
      const shade = Math.max(18, 92 - corrected * 10 - edge * 18);
      ctx.fillStyle = `hsl(45 72% ${shade}%)`;
      ctx.fillRect(x, horizon - wallH / 2, columnW, wallH);
      ctx.fillStyle = `rgba(39, 24, 2, ${Math.min(.75, corrected / 12)})`;
      ctx.fillRect(x, horizon - wallH / 2, columnW, wallH);
      if (hitX === game.exit.x && hitY === game.exit.y) {
        ctx.fillStyle = "rgba(92, 255, 125, .78)";
        ctx.fillRect(x, horizon - wallH / 2, columnW, wallH);
      }
    }
    ctx.fillStyle = "rgba(255, 206, 55, .7)";
    ctx.fillRect(width / 2 - 8, horizon, 16, 1);
    ctx.fillRect(width / 2, horizon - 8, 1, 16);
    ctx.fillStyle = "rgba(0,0,0,.16)";
    for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 1);
  }, [game]);

  const reset = () => setGame(initialGame(Date.now()));

  return (
    <main className="shell">
      <header className="masthead">
        <div className="brand"><span>NULL</span> CORRIDOR</div>
        <div className="status"><i /> LIVE GEOMETRY</div>
      </header>

      <section className="game-grid" aria-label="First person maze game">
        <div className="viewport-wrap">
          <div className="viewport-label"><span>CAM_01 // {DIRS[game.dir].label}</span><span>FOV 060°</span></div>
          <canvas ref={canvasRef} width={960} height={560} aria-label="First-person view into the maze" />
          <div className="vignette" />
          {game.escaped && (
            <div className="escape-card">
              <p>LOOP INTERRUPTED</p>
              <h1>YOU HELD THE EXIT IN VIEW.</h1>
              <button onClick={reset}>ENTER AGAIN</button>
            </div>
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
            <div><dt>STEPS</dt><dd>{String(game.moves).padStart(3, "0")}</dd></div>
            <div><dt>SHIFTS</dt><dd>{String(game.shifts).padStart(3, "0")}</dd></div>
            <div><dt>BEARING</dt><dd>{DIRS[game.dir].label}</dd></div>
          </dl>
          <div className="signal"><span>SIGNAL</span><b>{game.message}</b></div>
        </aside>
      </section>

      <footer className="controls">
        <div className="control-copy"><span>CONTROL SCHEME</span><p>THE CORRIDOR REWRITES ITSELF WHERE YOU CANNOT SEE.</p></div>
        <div className="keys" aria-label="Maze controls">
          <button onClick={() => act("left")} aria-label="Turn left">A</button>
          <button onClick={() => act("forward")} aria-label="Move forward">W</button>
          <button onClick={() => act("right")} aria-label="Turn right">D</button>
          <button onClick={() => act("back")} aria-label="Move backward">S</button>
        </div>
        <button className="reset" onClick={reset}>NEW SIGNAL</button>
      </footer>
    </main>
  );
}
