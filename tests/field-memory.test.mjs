import assert from "node:assert/strict";
import test from "node:test";
import { CHUNK, FieldGraph } from "../app/field/graph.ts";
import { STEP_LENGTH, WorldMemory, ownFootprintsVisible } from "../app/field/memory.ts";
import { beginCelebration, beginRepair, createAriadneBody, leadAlong, presenceOf, releaseLead, updateAriadne, walkerMarkerIndex } from "../app/field/ariadne.ts";

test("footprints are laid every step, alternate sides, and persist through a snapshot", () => {
  const memory = new WorldMemory();
  let laid = 0;
  for (let i = 0; i < 100; i++) if (memory.recordStep([i * .1, 0], Math.PI / 2, .1, false, i * 100)) laid++;
  assert.equal(laid, Math.floor(10 / STEP_LENGTH), "one print per step length");
  const sides = memory.footprints.map(print => print.side);
  for (let i = 1; i < sides.length; i++) assert.notEqual(sides[i], sides[i - 1], "feet alternate");
  assert.ok(memory.footprints.every(print => Math.abs(print.z) > .1 && Math.abs(print.z) < .25), "prints sit a little to either side of the line of travel");
  assert.equal(memory.footprintsNear([5, 0], 1).length > 0, true);
  const snapshot = JSON.parse(JSON.stringify(memory.snapshot()));
  const restored = new WorldMemory(); restored.restore(snapshot);
  assert.equal(restored.footprints.length, memory.footprints.length);
  assert.equal(ownFootprintsVisible(restored, [5, 0], 100_000), true, "old prints count as evidence of having been here");
  assert.equal(ownFootprintsVisible(restored, [5, 0], 9_000), false, "fresh prints do not");
});

test("residue brightens with repeated commitments and visits know a return", () => {
  const memory = new WorldMemory();
  memory.markResidue("a|b", "a", 0); memory.markResidue("a|b", "b", 10); memory.markResidue("a|b", "a", 20); memory.markResidue("a|b", "a", 30);
  assert.equal(memory.residueOn("a|b").strength, 3, "residue saturates at three");
  assert.equal(memory.residueOn("x|y"), null);
  assert.deepEqual(memory.visit("n", 0), { returning: false, visit: { count: 1, firstAt: 0, lastAt: 0 } });
  assert.equal(memory.visit("n", 50).returning, true);
  assert.equal(memory.visitedBefore("n"), true);
  memory.caption({ id: "1", role: "ariadne", text: "hello", time: 0, kind: "generated" });
  memory.caption({ id: "2", role: "walker", text: "hi", time: 1, kind: "walker" });
  memory.caption({ id: "3", role: "ariadne", text: "this way", time: 2, kind: "cue" });
  assert.equal(memory.ariadneLinesSince("walker"), 1);
  const snapshot = memory.snapshot(); const restored = new WorldMemory(); restored.restore(JSON.parse(JSON.stringify(snapshot)));
  assert.equal(restored.residueOn("a|b").strength, 3); assert.equal(restored.visits.get("n").count, 2); assert.equal(restored.captions.length, 3);
});

test("Ariadne arrives, settles beside the walker, leads to the first marker and observes the walker's take-up", () => {
  const graph = new FieldGraph(3); graph.ensureAround([CHUNK / 2, CHUNK / 2], 1);
  const spawn = graph.node(graph.spawnNodeId), way = graph.way(spawn.ways[0]);
  const markers = graph.markersFrom(way, spawn.id);
  const facing = Math.atan2(markers[0].position[0] - spawn.position[0], markers[0].position[1] - spawn.position[1]);
  const walker = { position: [...spawn.position], yaw: facing, speed: 0 };
  const body = createAriadneBody(walker, 0, true);
  assert.equal(body.mode, "arriving");
  assert.ok(Math.hypot(body.position[0] - walker.position[0], body.position[1] - walker.position[1]) > 10, "she starts out in the fog");
  let now = 0;
  for (let i = 0; i < 60 * 5; i++) { now += 1000 / 60; updateAriadne(body, graph, walker, 1 / 60, now, false); }
  assert.equal(body.mode, "hovering_beside");
  assert.ok(Math.hypot(body.position[0] - walker.position[0], body.position[1] - walker.position[1]) < 2.6, "she settles within reach");
  assert.equal(presenceOf(body, walker), "with_mt");
  assert.ok(body.trail.length > 30 && body.trail.length <= 100, `the trail holds about 2.4 s at 40 Hz (${body.trail.length})`);

  leadAlong(body, graph, way, spawn.id, now);
  assert.equal(body.mode, "leading");
  assert.deepEqual(body.firstMarker, markers[0].position);
  for (let i = 0; i < 60 * 4; i++) { now += 1000 / 60; updateAriadne(body, graph, walker, 1 / 60, now, false); }
  assert.equal(body.mode, "waiting_at_marker");
  assert.ok(Math.hypot(body.position[0] - markers[0].position[0], body.position[1] - markers[0].position[1]) < 1, "she waits at the first marker");
  assert.equal(presenceOf(body, walker), "leading_ahead");
  assert.equal(body.mtFollowingHerLead, false);

  // The walker follows: she moves ahead marker to marker.
  walker.position = [...markers[1].position]; walker.speed = 1.4;
  for (let i = 0; i < 60 * 3; i++) { now += 1000 / 60; updateAriadne(body, graph, walker, 1 / 60, now, false); }
  assert.equal(body.mtFollowingHerLead, true);
  assert.equal(walkerMarkerIndex(graph, way, spawn.id, walker.position), 1);
  assert.ok(body.markerIndex >= 2, "she moves two markers ahead");
  assert.ok(Math.hypot(body.position[0] - walker.position[0], body.position[1] - walker.position[1]) <= 11.5, "she never runs beyond the fog");

  // Repair brings her back low and dim; celebration lifts her.
  beginRepair(body, now);
  for (let i = 0; i < 60 * 3; i++) { now += 1000 / 60; updateAriadne(body, graph, walker, 1 / 60, now, false); }
  assert.ok(body.mode === "repairing" || body.mode === "returning");
  assert.ok(body.height < 1.1, `low while repairing (${body.height.toFixed(2)})`);
  assert.ok(body.brightness < .75, "dim while repairing");
  beginCelebration(body, walker, now);
  for (let i = 0; i < 60 * 1.5; i++) { now += 1000 / 60; updateAriadne(body, graph, walker, 1 / 60, now, false); }
  assert.equal(body.mode, "celebrating");
  assert.ok(body.brightness > 1.1, "bright while celebrating");
  releaseLead(body, now);
  assert.equal(body.committedWayId, null);
});

test("Ariadne notices when the walker takes another way from the same place", () => {
  const graph = new FieldGraph(3); graph.ensureAround([CHUNK / 2, CHUNK / 2], 1);
  const node = [...graph.nodes.values()].find(n => n.ways.length >= 3);
  const [chosen, other] = node.ways.map(id => graph.way(id));
  const walker = { position: [...node.position], yaw: 0, speed: 0 };
  const body = createAriadneBody(walker, 0, false);
  let now = 0;
  leadAlong(body, graph, chosen, node.id, now);
  for (let i = 0; i < 120; i++) { now += 1000 / 60; updateAriadne(body, graph, walker, 1 / 60, now, false); }
  const otherMarkers = graph.markersFrom(other, node.id);
  walker.position = [...otherMarkers[1].position]; walker.speed = 1.4;
  for (let i = 0; i < 120; i++) { now += 1000 / 60; updateAriadne(body, graph, walker, 1 / 60, now, false); }
  assert.equal(body.mtChoseAnotherRoute, true);
  assert.ok(body.mode === "catching_up" || body.mode === "hovering_beside", `she leaves her way to rejoin (${body.mode})`);
});
