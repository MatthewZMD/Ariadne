import assert from "node:assert/strict";
import test from "node:test";
import { CHUNK, FieldGraph } from "../app/field/graph.ts";
import { STRUCTURE_ANCHORS } from "../app/field/structure-anchors.ts";
import { Euler, Vector3 } from "three";
import { ATTENTION_RANGE, CLEARING_RADIUS, FAMILIES, StructureField, createStructure, rotateY, wakeDuration } from "../app/field/structures.ts";
import { FieldGame } from "../app/field/game.ts";

const setup = seed => {
  const graph = new FieldGraph(seed); graph.ensureAround([CHUNK / 2, CHUNK / 2], 1);
  const structures = new StructureField(seed, graph.spawnNodeId);
  structures.ensureAround(graph, graph.node(graph.spawnNodeId).position, 1000);
  return { graph, structures };
};

const standingAt = (element, yawTo = null, speed = 0) => {
  // Stand in front of the element and face it: put the walker a little away along -Z of the element, facing +Z.
  const offset = yawTo ?? 0;
  const position = [element.position[0] - Math.sin(offset) * 1.2, element.position[2] - Math.cos(offset) * 1.2];
  return { position, yaw: Math.atan2(element.position[0] - position[0], element.position[2] - position[1]), speed };
};

test("every complete structure wakes in about ten seconds of uninterrupted interaction", () => {
  for (const family of [...FAMILIES, "teaching"]) {
    const { graph, structures } = setup(3);
    structures.byNode.clear();
    const structure = createStructure(3, graph.node(graph.spawnNodeId), family);
    structures.byNode.set(structure.nodeId, structure);
    let elapsed = 0;
    while (structure.completedAt === null && elapsed < 12) {
      const part = structure.elements.find(element => !element.active);
      const pose = standingAt(part);
      pose.pitch = Math.atan2(part.position[1] - 1.62, 1.2);
      elapsed += 1 / 60;
      structures.advance(pose, 1 / 60, elapsed * 1000);
    }
    assert.ok(structure.completedAt !== null, `${family} completes`);
    assert.ok(elapsed >= 9.9 && elapsed <= 10.2, `${family}: ${elapsed.toFixed(2)} seconds`);
  }
});

test("every family has baked anchors with elements, a call anchor and a fragment anchor", () => {
  for (const family of [...FAMILIES, "teaching"]) {
    const baked = STRUCTURE_ANCHORS[`structure-${family}`];
    assert.ok(baked, `${family} baked`);
    const elements = baked.anchors.filter(anchor => /^element_\d\d$/.test(anchor.name));
    assert.ok(elements.length >= 3, `${family} has at least three elements`);
    assert.ok(baked.anchors.some(anchor => anchor.name === "call_anchor"), `${family} has a call anchor`);
    assert.ok(baked.anchors.some(anchor => anchor.name === "fragment_anchor"), `${family} has a fragment anchor`);
    for (const element of elements) assert.ok(["approach", "look", "listen"].includes(element.gesture), `${family} ${element.name} has a gesture`);
  }
  const teaching = STRUCTURE_ANCHORS["structure-teaching"].anchors.filter(anchor => /^element_/.test(anchor.name)).map(anchor => anchor.gesture);
  assert.deepEqual(teaching, ["approach", "look", "listen"], "the teaching structure teaches the three gestures in order");
});

test("structures are placed deterministically from the seed and the teaching place always has one", () => {
  const a = setup(6), b = setup(6);
  assert.deepEqual(a.structures.all().map(item => item.id).sort(), b.structures.all().map(item => item.id).sort());
  const teaching = a.structures.atNode(a.graph.spawnNodeId);
  assert.equal(teaching.family, "teaching");
  const count = a.structures.all().length;
  assert.ok(count > 15 && count < 50, `roughly forty percent of eighty-one places hold a structure (${count})`);
  for (const structure of a.structures.all()) {
    const node = a.graph.node(structure.nodeId);
    assert.deepEqual(structure.position, node.position);
    for (const element of structure.elements) assert.ok(Math.hypot(element.position[0] - node.position[0], element.position[2] - node.position[1]) < 6, "elements stand at the place");
  }
});

test("world anchors sit exactly where the rendered model puts them: the game rotates as Three.js rotates", () => {
  // The renderer draws each structure with `root.rotation.y = structure.yaw`; every anchor the game evaluates
  // must land on the drawn part, so the arbiter here is Three.js itself.
  for (const seed of [3, 6, 12, 41]) {
    const { graph } = setup(seed);
    for (const family of ["teaching", "bells", "glass", "reeds"]) {
      const node = graph.node(graph.spawnNodeId);
      const structure = createStructure(seed, node, family);
      const baked = STRUCTURE_ANCHORS[`structure-${family}`];
      const euler = new Euler(0, structure.yaw, 0);
      for (const anchor of baked.anchors) {
        const expected = new Vector3(...anchor.position).applyEuler(euler).add(new Vector3(node.position[0], 0, node.position[1]));
        const actual = anchor.name === "call_anchor" ? structure.callPosition : anchor.name === "fragment_anchor" ? structure.fragmentPosition : structure.elements.find(element => element.id.endsWith(anchor.name))?.position;
        assert.ok(actual, `${family} ${anchor.name} exists`);
        assert.ok(Math.hypot(actual[0] - expected.x, actual[1] - expected.y, actual[2] - expected.z) < 1e-9, `seed ${seed} ${family} ${anchor.name} is where the model draws it (off by ${Math.hypot(actual[0] - expected.x, actual[2] - expected.z).toFixed(3)} m)`);
      }
    }
  }
  const [x, , z] = rotateY([1, 0, 0], Math.PI / 2);
  assert.ok(Math.abs(x) < 1e-12 && Math.abs(z + 1) < 1e-12, "a quarter turn takes local +X to world −Z, as Three.js does");
});

test("the collision core turns with the model too", () => {
  // A wide, thin structure (bells: 3.2 m by 0.7 m) rotated a quarter turn must block along world Z, not world X.
  const seed = 5;
  const game = new FieldGame(seed);
  const node = [...game.graph.nodes.values()].find(item => item.ways.length >= 2 && item.id !== game.teachingNodeId && !game.structures.atNode(item.id));
  const structure = game.structures.placeAt(node, "bells");
  structure.yaw = Math.PI / 2;
  const centre = structure.position;
  // Walk toward the centre along world +Z: the long axis now lies along Z, so the walker should stop at the thin side (hz .3) plus their radius.
  game.walker.position = [centre[0], centre[1] - 3];
  game.walker.yaw = 0;
  for (let i = 0; i < 240; i++) game.update(1 / 60, { forward: 1, strafe: 0, turn: 0, lookDelta: 0 });
  const dz = centre[1] - game.walker.position[1], dx = Math.abs(game.walker.position[0] - centre[0]);
  assert.ok(dx < .6, "the walker is still on the approach line");
  assert.ok(dz > .55 && dz < 1.1, `blocked by the long side, which now faces the walker (${dz.toFixed(2)} m from the centre)`);
});

test("approach wakes on contact; look and listen need sustained attention; completion clears the fog", () => {
  const { structures, graph } = setup(3);
  const structure = structures.atNode(graph.spawnNodeId);
  const [approach, look, listen] = structure.elements;
  const changes = [];
  const run = (walker, seconds, now0) => { let now = now0; for (let i = 0; i < seconds * 30; i++) { now += 1000 / 30; changes.push(...structures.advance(walker, 1 / 30, now)); } return now; };

  // Far away: nothing happens.
  let now = run({ position: [structure.position[0] + ATTENTION_RANGE + 5, structure.position[1]], yaw: 0, speed: 1 }, 1, 0);
  assert.equal(changes.length, 0);

  // Approach: standing within reach wakes the element quickly.
  now = run({ position: [approach.position[0], approach.position[2] - .8], yaw: 0, speed: 1.2 }, .5, now);
  assert.ok(changes.some(change => change.type === "element_woke" && change.elementId === approach.id), "approach woke");
  assert.equal(changes.find(change => change.type === "element_woke").remaining, 2);

  // Look: facing the element while moving does not wake it instantly; a held look does, after wakeDuration(structure, "look") seconds.
  const looker = standingAt(look, 0, 0);
  now = run({ ...looker, yaw: looker.yaw + 1.2, speed: 0 }, 1.2, now);
  assert.ok(!look.active, "looking elsewhere does not wake the look element");
  now = run(looker, wakeDuration(structure, "look") * .6, now);
  assert.ok(!look.active && look.attention > .4, "a look begun is answered but not yet complete");
  now = run(looker, wakeDuration(structure, "look") * .6, now);
  assert.ok(look.active, "looking at the element wakes it");

  // Listen: needs stillness.
  const listener = standingAt(listen, 0, 0);
  now = run({ ...listener, speed: .6 }, 2, now);
  assert.ok(!listen.active, "moving while facing the listen element does not wake it");
  now = run(listener, wakeDuration(structure, "listen") + .3, now);
  assert.ok(listen.active, "being still and attending wakes the listen element");
  const completed = changes.find(change => change.type === "completed");
  assert.ok(completed, "waking every element completes the structure");
  assert.equal(completed.structureId, structure.id);
  assert.equal(structure.completedAt !== null, true);
  assert.equal(structures.clearingAt(structure.position), 1);
  assert.ok(structures.clearingAt([structure.position[0] + CLEARING_RADIUS / 2, structure.position[1]]) > .4);
  assert.equal(structures.clearingAt([structure.position[0] + CLEARING_RADIUS + 1, structure.position[1]]), 0);
  assert.equal(structures.clearings().length, 1);

  // Replay: touching an awake approach element sounds it again after its delay.
  const before = changes.length;
  now = run({ position: [approach.position[0] + 3, approach.position[2]], yaw: 0, speed: 1 }, .5, now);
  run({ position: [approach.position[0], approach.position[2] - .8], yaw: 0, speed: 1 }, .3, now);
  assert.ok(changes.slice(before).some(change => change.type === "element_sounded" && change.elementId === approach.id), "an awake element sounds again when touched");
});

test("attention makes a phrase, not a chord: only one look or listen element is engaged at a time", () => {
  const { structures, graph } = setup(3);
  const structure = structures.atNode(graph.spawnNodeId);
  const [, look, listen] = structure.elements;
  // Stand between look and listen, facing look.
  const mid = [(look.position[0] + listen.position[0]) / 2, (look.position[2] + listen.position[2]) / 2];
  const walker = { position: [mid[0], mid[1] - 2], yaw: Math.atan2(look.position[0] - mid[0], look.position[2] - (mid[1] - 2)), speed: 0 };
  for (let i = 0; i < 10; i++) structures.advance(walker, 1 / 30, i * 33);
  assert.equal(structure.elements.filter(element => element.engaged && element.gesture !== "approach").length <= 1, true);
});

test("serialize and restore keep completion and element states", () => {
  const { graph, structures } = setup(15);
  const structure = structures.all().find(item => item.family !== "teaching");
  structure.elements[0].active = true; structure.completedAt = 1234; structure.relevance = "objective_relevant";
  const saved = JSON.parse(JSON.stringify(structures.serialize()));
  const fresh = new StructureField(15, graph.spawnNodeId);
  fresh.restore(graph, saved);
  const restored = fresh.get(structure.id);
  assert.equal(restored.completedAt, 1234);
  assert.equal(restored.relevance, "objective_relevant");
  assert.equal(restored.elements[0].active, true);
  assert.equal(restored.elements[1].active, false);
  assert.equal(fresh.all().length, structures.all().length, "every decided structure is back");
});


test("looking upward cannot wake a part below the camera", () => {
  const { structures, graph } = setup(3);
  const structure = structures.atNode(graph.spawnNodeId);
  const part = structure.elements.find(element => element.gesture === "look");
  for (const earlier of structure.elements.slice(0, structure.elements.indexOf(part))) earlier.active = true;
  const pose = standingAt(part);
  pose.pitch = Math.PI / 2 - .01;
  for (let i=0;i<80;i++) structures.advance(pose,.1,i*100);
  assert.equal(part.active,false);
  pose.pitch = Math.atan2(part.position[1]-1.62,1.2);
  for (let i=0;i<80;i++) structures.advance(pose,.1,3000+i*100);
  assert.equal(part.active,true);
});

test("while parts still sleep, a finished part falls quiet so the next invitation is unambiguous", () => {
  const { structures, graph } = setup(3);
  const structure = structures.atNode(graph.spawnNodeId);
  const [approach, look] = structure.elements;
  const changes = [];
  const run = (walker, seconds, now0) => { let now = now0; for (let i = 0; i < seconds * 30; i++) { now += 1000 / 30; changes.push(...structures.advance(walker, 1 / 30, now)); } return now; };
  let now = run({ position: [approach.position[0], approach.position[2] - .8], yaw: 0, speed: 1.2 }, .5, 0);
  const looker = standingAt(look, 0, 0);
  now = run(looker, wakeDuration(structure, "look") + .4, now);
  assert.ok(look.active);
  changes.length = 0;
  now = run(looker, 6, now);
  const sounded = changes.filter(change => change.type === "element_sounded" && change.elementId === look.id);
  assert.equal(sounded.length, 0, "a held gaze on a finished part does not loop its note while the structure is incomplete");
  now = run({ ...looker, yaw: looker.yaw + 1.2 }, 1, now);
  now = run(looker, 1, now);
  assert.equal(changes.filter(change => change.type === "element_sounded" && change.elementId === look.id).length, 0, "looking away and back leaves the finished part quiet");
});

test("a part anchored high is looked at by someone facing the pipe from close up, without finding its top", () => {
  const { structures, graph } = setup(3);
  const structure = structures.atNode(graph.spawnNodeId);
  const look = structure.elements.find(element => element.gesture === "look");
  for (const earlier of structure.elements.slice(0, structure.elements.indexOf(look))) earlier.active = true;
  // Two paces away, eyes level: the head is turned toward the part, the gaze is well below a high anchor.
  const raised = { ...look, position: [look.position[0], 3.0, look.position[2]] };
  const original = look.position; look.position = raised.position;
  const changes = [];
  const run = (walker, seconds, now0) => { let now = now0; for (let i = 0; i < seconds * 30; i++) { now += 1000 / 30; changes.push(...structures.advance(walker, 1 / 30, now)); } return now; };
  const dx = 0, dz = -2.2;
  const walker = { position: [look.position[0] + dx, look.position[2] + dz], yaw: Math.atan2(-dx, -dz), pitch: 0, speed: 0 };
  run(walker, wakeDuration(structure, "look") + .5, 0);
  assert.ok(look.active, "looking at the pipe wakes the part anchored at its top");
  look.position = original;
});
