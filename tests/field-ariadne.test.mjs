import assert from "node:assert/strict";
import test from "node:test";
import { FieldGame, IDLE_INPUT } from "../app/field/game.ts";
import { distance, wrapAngle } from "../app/field/graph.ts";

const DT = 1 / 30;
const wait = (game, seconds) => {
  for (let frame = 0; frame < seconds / DT; frame++) { game.update(DT, IDLE_INPUT); game.drain(); }
};

/** Follow the visible body while keeping personal space; never aim at an unseen marker. */
const followBody = game => {
  const body = game.ariadne;
  if (!body?.committedWayId) { game.update(DT, IDLE_INPUT); return game.drain(); }
  const gap = distance(body.position, game.walker.position);
  const heading = Math.atan2(body.position[0] - game.walker.position[0], body.position[1] - game.walker.position[1]);
  const delta = wrapAngle(heading - game.walker.yaw);
  game.update(DT, { ...IDLE_INPUT, forward: gap > 2.05 && Math.abs(delta) < 1 ? Math.min(1, (gap - 2) * 2) : 0, lookDelta: Math.max(-.18, Math.min(.18, delta)) });
  return game.drain();
};

test("following her body at two metres reaches the teaching place without walking through her", () => {
  for (const seed of [3, 10, 15, 21, 32, 36]) {
    const game = new FieldGame(seed);
    let takenUp = false, closest = Infinity;
    for (let frame = 0; frame < 70 / DT && game.currentNodeId !== game.teachingNodeId; frame++) {
      const events = followBody(game);
      takenUp ||= events.some(event => event.type === "speak" && event.occasion === "taken_up");
      if (game.ariadne?.committedWayId && game.time > 10_000) closest = Math.min(closest, distance(game.ariadne.position, game.walker.position));
    }
    assert.equal(game.currentNodeId, game.teachingNodeId, `seed ${seed}: she leads past both the first and last markers`);
    assert.ok(takenUp, `seed ${seed}: real passage supplies the take-up event`);
    assert.ok(closest > 1.5, `seed ${seed}: following never requires crossing her body (${closest}m)`);
    assert.ok(game.time < 40_000, `seed ${seed}: no indefinite wait at a marker`);
  }
});

test("she waits when the walker stands still and pauses again after the walker stops", () => {
  const game = new FieldGame(3);
  wait(game, 15);
  assert.equal(game.ariadne.markerIndex, 0, "waiting alone does not advance the invitation");
  for (let frame = 0; frame < 15 / DT && game.ariadne.markerIndex === 0; frame++) followBody(game);
  assert.ok(game.ariadne.markerIndex > 0, "approaching her first marker makes room to follow");
  wait(game, 1);
  const marker = game.ariadne.markerIndex;
  wait(game, 10);
  const settled = [...game.ariadne.position];
  wait(game, 5);
  assert.equal(game.ariadne.markerIndex, marker, "she does not keep advancing after the walker stops");
  assert.ok(distance(settled, game.ariadne.position) < .8, "only the waiting body's small wander remains");
  assert.ok(distance(game.walker.position, game.ariadne.position) < 11.5, "she stays within sight");
});
