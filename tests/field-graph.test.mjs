import assert from "node:assert/strict";
import test from "node:test";
import { CHUNK, FieldGraph, NODE_RADIUS, bearingTo, forwardOf, relativeDirection, rightOf, wayIdFor } from "../app/field/graph.ts";

const componentSize = (graph, from) => graph.hops(from, 10_000).size;

test("a single chunk is connected, every place has a way, and the spawn place has exactly one", () => {
  for (const seed of [1, 7, 42, 1999, 31337]) {
    const graph = new FieldGraph(seed);
    graph.ensureChunk(0, 0);
    assert.equal(graph.nodes.size, 9, `seed ${seed}: nine places`);
    assert.equal(componentSize(graph, graph.spawnNodeId), 9, `seed ${seed}: all places reachable from the spawn`);
    assert.equal(graph.node(graph.spawnNodeId).ways.length, 1, `seed ${seed}: the spawn keeps its single teaching way`);
    for (const node of graph.nodes.values()) {
      assert.ok(node.ways.length >= 1, `seed ${seed}: ${node.id} has a way`);
      assert.ok(node.ways.length <= 4, `seed ${seed}: ${node.id} stays within four ways`);
    }
  }
});

test("neighbouring chunks join through exactly one portal way per border and stay connected", () => {
  for (const seed of [3, 11, 5000]) {
    const graph = new FieldGraph(seed);
    graph.ensureAround([CHUNK / 2, CHUNK / 2], 1);
    assert.equal(graph.nodes.size, 81, `seed ${seed}: nine chunks of nine places`);
    assert.equal(componentSize(graph, graph.spawnNodeId), 81, `seed ${seed}: every place is reachable`);
    const crossing = [...graph.ways.values()].filter(way => {
      const a = graph.node(way.a), b = graph.node(way.b);
      return graph.chunkOf(a.position).join() !== graph.chunkOf(b.position).join();
    });
    assert.equal(crossing.length, 12, `seed ${seed}: twelve interior borders, one portal each`);
    assert.equal(graph.node(graph.spawnNodeId).ways.length, 1, `seed ${seed}: portals never land on the spawn`);
  }
});

test("generation order does not change the graph", () => {
  const a = new FieldGraph(99), b = new FieldGraph(99);
  a.ensureChunk(0, 0); a.ensureChunk(1, 0); a.ensureChunk(0, 1); a.ensureChunk(1, 1);
  b.ensureChunk(1, 1); b.ensureChunk(0, 1); b.ensureChunk(1, 0); b.ensureChunk(0, 0);
  assert.deepEqual([...a.ways.keys()].sort(), [...b.ways.keys()].sort());
  for (const id of a.nodes.keys()) assert.deepEqual(a.node(id).position, b.node(id).position);
  const c = new FieldGraph(100); c.ensureChunk(0, 0);
  assert.notDeepEqual([...a.ways.keys()].filter(id => c.ways.has(id)).length, a.ways.size, "a different seed gives a different field");
});

test("ways carry markers five metres apart that keep off the floors at both ends", () => {
  const graph = new FieldGraph(8); graph.ensureChunk(0, 0);
  for (const way of graph.ways.values()) {
    assert.ok(way.markers.length >= 2, `${way.id} has markers`);
    const a = graph.node(way.a).position, b = graph.node(way.b).position;
    for (const marker of way.markers) {
      assert.ok(Math.hypot(marker.position[0] - a[0], marker.position[1] - a[1]) > NODE_RADIUS, `${way.id} marker off floor a`);
      assert.ok(Math.hypot(marker.position[0] - b[0], marker.position[1] - b[1]) > NODE_RADIUS, `${way.id} marker off floor b`);
    }
    for (let i = 1; i < way.markers.length; i++) {
      const gap = Math.hypot(way.markers[i].position[0] - way.markers[i - 1].position[0], way.markers[i].position[1] - way.markers[i - 1].position[1]);
      assert.ok(gap > 3.5 && gap < 6.5, `${way.id} gap ${gap.toFixed(2)} near five metres`);
    }
    const first = graph.markersFrom(way, way.a)[0], last = graph.markersFrom(way, way.b)[0];
    assert.ok(Math.hypot(first.position[0] - a[0], first.position[1] - a[1]) < Math.hypot(last.position[0] - a[0], last.position[1] - a[1]), "markersFrom orders markers away from the given end");
  }
});

test("termini are places with one way and no structure floor; junctions get a floor", () => {
  const graph = new FieldGraph(21); graph.ensureAround([CHUNK / 2, CHUNK / 2], 1);
  for (const node of graph.nodes.values()) {
    if (node.id === graph.spawnNodeId) assert.equal(node.floor, "open", "the walker wakes on open ground");
    else if (node.ways.length === 1) assert.match(node.floor, /^terminus-/, `${node.id} is a terminus`);
    else assert.ok(["stone dish", "pool", "ring of posts"].includes(node.floor), `${node.id} has a place floor`);
  }
});

test("shortest first steps agree with hop counts", () => {
  const graph = new FieldGraph(5); graph.ensureAround([CHUNK / 2, CHUNK / 2], 1);
  const from = graph.spawnNodeId;
  const hops = graph.hops(from, 20);
  for (const [to, d] of hops) {
    if (to === from) { assert.equal(graph.firstStepToward(from, to), null); continue; }
    const step = graph.firstStepToward(from, to);
    assert.ok(graph.node(from).ways.includes(step), `first step ${step} leaves ${from}`);
    const next = graph.otherEnd(graph.way(step), from);
    assert.equal(graph.hopCount(next, to), d - 1, `stepping toward ${to} shortens the path`);
  }
});

test("nodeAt and nearestWay locate the walker", () => {
  const graph = new FieldGraph(13); graph.ensureChunk(0, 0);
  const spawn = graph.node(graph.spawnNodeId);
  assert.equal(graph.nodeAt(spawn.position)?.id, spawn.id);
  assert.equal(graph.nodeAt([spawn.position[0] + NODE_RADIUS + 1, spawn.position[1]]), null);
  const way = graph.way(spawn.ways[0]);
  const marker = graph.markersFrom(way, spawn.id)[1];
  const nearest = graph.nearestWay(marker.position);
  assert.equal(nearest.way.id, way.id);
  assert.ok(nearest.distance < .6, `marker sits on its way (${nearest.distance.toFixed(2)} m off)`);
});

test("bearings follow the heading convention: yaw 0 faces +Z and positive bearing is to the right", () => {
  assert.deepEqual(forwardOf(0).map(v => Math.round(v)), [0, 1]);
  assert.deepEqual(forwardOf(Math.PI / 2).map(v => Math.round(v)), [1, 0], "a larger yaw swings the heading toward +X, which is the walker's left");
  assert.deepEqual(rightOf(0).map(v => Math.round(v) + 0), [-1, 0], "facing +Z in a Y-up right-handed world, the right hand points to -X");
  const right = rightOf(0);
  const bearingRight = bearingTo([0, 0], 0, [right[0] * 3, right[1] * 3]);
  assert.ok(bearingRight > 0, "a target on the right-hand side has a positive bearing");
  assert.equal(relativeDirection(bearingRight), "far_right");
  assert.equal(relativeDirection(bearingTo([0, 0], 0, [3, 0])), "far_left");
  assert.equal(relativeDirection(bearingTo([0, 0], 0, [0, 5])), "ahead");
  assert.equal(relativeDirection(bearingTo([0, 0], 0, [3, 5])), "left");
  assert.equal(relativeDirection(bearingTo([0, 0], 0, [-3, 5])), "right");
  assert.equal(relativeDirection(bearingTo([0, 0], 0, [0, -5])), "behind");
  const graph = new FieldGraph(2); graph.ensureChunk(0, 0);
  const spawn = graph.node(graph.spawnNodeId), way = graph.way(spawn.ways[0]);
  const first = graph.markersFrom(way, spawn.id)[0];
  const facing = Math.atan2(first.position[0] - spawn.position[0], first.position[1] - spawn.position[1]);
  assert.equal(relativeDirection(graph.bearingOfWay(spawn, way, facing)), "ahead", "facing the first marker, the way is ahead");
  assert.equal(wayIdFor("b", "a"), "a|b");
});
