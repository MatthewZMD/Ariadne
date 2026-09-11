import assert from "node:assert/strict";
import test from "node:test";
import { CHUNK, FieldGraph } from "../app/field/graph.ts";
import { StructureField } from "../app/field/structures.ts";
import { RELIABILITY_BANDS, bandFor, beginCall, callAudibility, commitAt, createUndertaking, publicUndertaking, reliability, resolveCommitment, takeUp } from "../app/field/undertaking.ts";

const setup = seed => {
  const graph = new FieldGraph(seed); graph.ensureAround([CHUNK / 2, CHUNK / 2], 1);
  const structures = new StructureField(seed, graph.spawnNodeId);
  return { graph, structures };
};

test("reliability falls in bands with the commitments made and floors at chance", () => {
  assert.equal(bandFor(0), 0); assert.equal(bandFor(3), 0); assert.equal(bandFor(4), 1); assert.equal(bandFor(11), 2); assert.equal(bandFor(12), 3); assert.equal(bandFor(16), 4);
  assert.equal(reliability(0, 3), .92);
  assert.equal(reliability(5, 3), .75);
  assert.equal(reliability(9, 3), .55);
  assert.equal(reliability(13, 3), .40);
  assert.equal(reliability(20, 3), 1 / 3, "beyond the last band she is right as often as a coin among the open ways");
  assert.equal(reliability(20, 1), 1);
  assert.equal(RELIABILITY_BANDS.at(-1).accuracy, "chance");
});

test("beginCall chooses a dormant structure two or three places away and marks it relevant", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { graph, structures } = setup(seed);
    const state = beginCall(createUndertaking(seed), graph, structures, graph.spawnNodeId, seed, 0);
    assert.equal(state.stage, 1);
    assert.ok(state.objectiveStructureId && state.objectiveNodeId, `seed ${seed}: an objective is set`);
    const objective = structures.get(state.objectiveStructureId);
    assert.equal(objective.relevance, "objective_relevant");
    assert.equal(objective.completedAt, null);
    const hops = graph.hopCount(graph.spawnNodeId, state.objectiveNodeId);
    assert.ok(hops >= 1 && hops <= 7, `seed ${seed}: objective within reach (${hops} hops)`);
    const nearby = [...graph.hops(graph.spawnNodeId, 3).entries()].filter(([id, d]) => d >= 2 && d <= 3 && structures.atNode(id));
    if (nearby.length) assert.ok(hops >= 2 && hops <= 3, `seed ${seed}: with candidates two or three places away, one of them is chosen (${hops})`);
  }
});

test("beginCall is deterministic and the stage advances", () => {
  const a = setup(77), b = setup(77);
  const first = beginCall(createUndertaking(77), a.graph, a.structures, a.graph.spawnNodeId, 77, 0);
  const second = beginCall(createUndertaking(77), b.graph, b.structures, b.graph.spawnNodeId, 77, 0);
  assert.equal(first.objectiveStructureId, second.objectiveStructureId);
  const third = beginCall(first, a.graph, a.structures, first.objectiveNodeId, 77, 5);
  assert.equal(third.stage, 2);
  assert.notEqual(third.objectiveStructureId, first.objectiveStructureId, "the call passes on to another structure");
});

test("commitAt picks the shortest-path way while reliable and drifts toward chance with commitments", () => {
  const { graph, structures } = setup(9);
  let state = beginCall(createUndertaking(9), graph, structures, graph.spawnNodeId, 9, 0);
  const junctions = [...graph.nodes.values()].filter(node => node.ways.length >= 3 && node.id !== state.objectiveNodeId);
  assert.ok(junctions.length > 5, "enough junctions to sample");
  const correctness = [];
  for (let i = 0; i < 40; i++) {
    const node = junctions[i % junctions.length];
    const arrivedBy = node.ways[0];
    const choice = commitAt(state, graph, node.id, arrivedBy, 9, i);
    assert.ok(choice, "a commitment is made at a junction");
    const correct = graph.firstStepToward(node.id, state.objectiveNodeId);
    if (choice.wayId === arrivedBy) assert.equal(choice.wayId, correct, "she only commits back along the arrival way when that is the way toward the call");
    assert.ok(node.ways.includes(choice.wayId), "she commits to a way of this place");
    assert.equal(choice.commitment.correct, choice.wayId === correct);
    correctness.push(choice.commitment.correct);
    state = resolveCommitment(takeUp(choice.state, true, null), "quiet");
    assert.equal(state.active, null);
  }
  assert.equal(state.commitmentsMade, 40);
  const early = correctness.slice(0, 3).filter(Boolean).length, late = correctness.slice(20).filter(Boolean).length / 20;
  assert.ok(early >= 2, `early commitments are mostly right (${early}/3)`);
  assert.ok(late < .8, `late commitments are near chance (${late})`);
  assert.equal(state.history.length, 40);
  assert.deepEqual(publicUndertaking(state), { stage: 1, commitmentsMade: 40, commitmentsFollowed: 40, commitmentsDeclined: 0 });
});

test("commitAt handles a walker arriving at a terminus by committing back the only way", () => {
  const { graph, structures } = setup(4);
  const state = beginCall(createUndertaking(4), graph, structures, graph.spawnNodeId, 4, 0);
  const terminus = [...graph.nodes.values()].find(node => node.ways.length === 1 && node.id !== graph.spawnNodeId && node.id !== state.objectiveNodeId);
  const choice = commitAt(state, graph, terminus.id, terminus.ways[0], 4, 0);
  assert.equal(choice.wayId, terminus.ways[0]);
});

test("the correct way stays available even when it is the way the walker arrived by", () => {
  const { graph, structures } = setup(4);
  const state = beginCall(createUndertaking(4), graph, structures, graph.spawnNodeId, 4, 0);
  const node = [...graph.nodes.values()].find(n => n.ways.length >= 2 && graph.firstStepToward(n.id, state.objectiveNodeId));
  const correct = graph.firstStepToward(node.id, state.objectiveNodeId);
  const choice = commitAt({ ...state, accumulator: .99 }, graph, node.id, correct, 4, 0);
  assert.equal(choice.wayId, correct, "with the accumulator high she points back along the way that leads to the call");
});

test("take-up and outcomes are recorded on the active commitment and in history", () => {
  const { graph, structures } = setup(12);
  let state = beginCall(createUndertaking(12), graph, structures, graph.spawnNodeId, 12, 0);
  const node = [...graph.nodes.values()].find(n => n.ways.length >= 2 && n.id !== state.objectiveNodeId);
  const choice = commitAt(state, graph, node.id, null, 12, 100);
  state = takeUp(choice.state, false, node.ways.find(id => id !== choice.wayId));
  assert.equal(state.active.taken, "declined");
  assert.equal(takeUp(state, true, null).active.taken, "declined", "take-up is decided once");
  state = resolveCommitment(state, "fading");
  assert.equal(state.active, null);
  assert.equal(state.history[0].outcome, "fading");
  assert.equal(resolveCommitment(state, "confirmed"), state, "resolving without an active commitment is a no-op");
});

test("call audibility has a clear range, a faint band, and silence", () => {
  assert.equal(callAudibility(null), "none");
  assert.equal(callAudibility(10), "clear");
  assert.equal(callAudibility(24), "clear");
  assert.equal(callAudibility(45), "faint", "one way's length away the call is a faint thread the walker can place if they listen");
  assert.equal(callAudibility(55), "faint");
  assert.equal(callAudibility(70), "none", "two places away only Ariadne hears anything");
});
