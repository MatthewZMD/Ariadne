import assert from "node:assert/strict";
import test from "node:test";
import { FieldGame, IDLE_INPUT } from "../app/field/game.ts";
import { NODE_RADIUS, distance, wrapAngle } from "../app/field/graph.ts";
import { completedAttemptCount } from "../app/field/undertaking.ts";

const DT = 1 / 30;

/** A silent participant follows the visible light, and approaches/gazes at structures when found. */
function play(seed, routeLimit) {
  const game = new FieldGame(seed), events = [], traversals = [];
  const frame = (input = IDLE_INPUT) => {
    game.update(DT, input);
    for (const event of game.drain()) {
      if (event.type === "speak" || event.type === "node_entered") events.push({ ...event, at: game.time, position: [...game.walker.position], active: game.undertaking.active ? { ...game.undertaking.active } : null });
    }
  };
  const wait = seconds => { for (let i = 0; i < seconds / DT; i++) frame(); };
  const toward = (point, space = 0) => {
    const gap = distance(game.walker.position, point);
    const heading = Math.atan2(point[0] - game.walker.position[0], point[1] - game.walker.position[1]);
    const delta = wrapAngle(heading - game.walker.yaw);
    frame({ ...IDLE_INPUT, forward: gap > space + .05 && Math.abs(delta) < 1 ? Math.min(1, (gap - space) * 2) : 0, lookDelta: Math.max(-.18, Math.min(.18, delta)) });
  };
  const wake = structure => {
    const gap = distance(game.walker.position, structure.position) || 1;
    const point = structure.position.map((v, axis) => v + (game.walker.position[axis] - v) / gap * 2.8);
    for (let i = 0; i < 20 / DT && distance(game.walker.position, point) > .3; i++) toward(point);
    assert.ok(distance(game.walker.position, point) <= .3, `seed ${seed}: approach the ${structure.family}`);
    for (let i = 0; i < 12 / DT; i++) {
      const delta = wrapAngle(Math.atan2(structure.position[0] - game.walker.position[0], structure.position[1] - game.walker.position[1]) - game.walker.yaw);
      frame({ ...IDLE_INPUT, lookDelta: Math.max(-.18, Math.min(.18, delta)) });
    }
    assert.notEqual(structure.completedAt, null, `seed ${seed}: gaze wakes the ${structure.family}`);
    wait(4);
  };
  const follow = (wayId, from) => {
    const target = game.graph.otherEnd(game.graph.way(wayId), from);
    const original = game.undertaking.active?.id ?? null;
    for (let i = 0; i < 70 / DT; i++) {
      const settled = original && game.undertaking.history.find(item => item.id === original);
      if (game.currentNodeId === target || (game.currentNodeId === from && settled?.outcome === "terminus")) {
        traversals.push({ original, from, target, arrived: game.currentNodeId, outcome: settled?.outcome, at: game.time, run: game.run() });
        return;
      }
      const body = game.ariadne;
      if (body?.committedWayId) toward(body.position, 2);
      else frame();
    }
    assert.fail(`seed ${seed}: following the light stalled between ${from} and ${target}; body=${game.ariadne?.mode}, marker=${game.ariadne?.markerIndex}`);
  };
  wait(7);
  follow(game.teachingWayId, game.graph.spawnNodeId);
  wake(game.teachingStructure);
  for (let route = 0; route < routeLimit; route++) {
    const node = game.currentNodeId;
    assert.ok(node, `seed ${seed}: the previous lead reached a place`);
    const structure = game.structures.atNode(node);
    if (structure && structure.completedAt === null) wake(structure);
    const way = game.undertaking.active?.wayId ?? game.ariadne?.committedWayId;
    const from = game.undertaking.active?.nodeId ?? game.ariadne?.committedFromNodeId;
    assert.ok(way, `seed ${seed}: guidance resumes after a structure or a return`);
    assert.equal(from, node, `seed ${seed}: the new invitation begins where the walker stands`);
    follow(way, from);
    wait(.5);
  }
  return { game, events, traversals };
}

test("a complete silent walk earns early awakenings and later owns repeated circuits", () => {
  const { game, events, traversals } = play(3, 18);
  const awakenings = events.filter(event => event.type === "speak" && event.occasion === "awakening_relevant");
  assert.ok(awakenings.length >= 3, "the reliable beginning produces multiple calling structures");
  assert.ok(awakenings[1].at < 150_000, "the first complete search supplies a concrete achievement early");
  assert.ok(!events.some(event => event.at < awakenings[1].at && (event.occasion === "terminus" || event.occasion === "recognized_return")), "initial useful guidance is not classified as wasted walking");
  const loops = events.filter(event => event.occasion === "recognized_return" && event.guidanceOwned);
  assert.ok(loops.length >= 2, "subsequent directed circuits are recognized even though their junctions remain traversable");
  for (const loop of loops) {
    assert.ok(loop.priorCommitmentId, "the return remembers the direction the walker actually followed");
    assert.notEqual(loop.priorCommitmentId, loop.commitmentId, "the old direction and next proposal are distinct");
  }
  assert.ok(!events.some(event => event.tone === "quiet_arrival"), "a quiet junction alone does not establish failure");
  assert.equal(completedAttemptCount(game.undertaking), traversals.length - 1, "only traversed post-teaching directions set the pace");
});

test("the guide recovers from a visible terminus before the participant enters it", () => {
  const { events, traversals } = play(15, 13);
  const blocked = events.find(event => event.occasion === "terminus" && event.guidanceOwned);
  assert.ok(blocked?.active, "later degraded guidance reaches a real visible terminus");
  const retreat = traversals.find(item => item.original === blocked.active.id && item.arrived === item.from);
  assert.ok(retreat, "following her body alone carries the participant back after repair");
  assert.equal(retreat.outcome, "terminus");
  assert.equal(retreat.run.ended, 1, "the blocked attempt is counted once");
  assert.equal(retreat.run.returns, 0, "requested recovery is not a second failed loop");
  assert.ok(!events.some(event => event.type === "node_entered" && event.nodeId === retreat.target && event.at <= retreat.at), "recovery does not require walking to the visible edge");
  const backtrack = events.find(event => event.tone === "directed_return" && event.at >= blocked.at && event.at <= retreat.at);
  assert.ok(backtrack, "the arrival is acknowledged as the requested retreat");
  assert.ok(traversals.some(item => item.at > retreat.at && item.arrived === item.target), "a subsequent direction remains usable");
  assert.ok(distance(blocked.position, events.find(event => event.type === "node_entered" && event.nodeId === retreat.from)?.position ?? blocked.position) > NODE_RADIUS, "the blocked route involved actual walking away from the junction");
});
