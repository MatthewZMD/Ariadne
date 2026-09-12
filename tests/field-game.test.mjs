import assert from "node:assert/strict";
import test from "node:test";
import { wakeDuration } from "../app/field/structures.ts";
import { ARRIVAL_DELAY_MS, FieldGame, IDLE_INPUT, phaseFor, PROMPT_AFTER_MS, STILL_RENEW_AFTER_MS } from "../app/field/game.ts";
import { wrapAngle } from "../app/field/graph.ts";

const DT = 1 / 30;

/** Advance the game, collecting events. */
const run = (game, seconds, input = IDLE_INPUT) => { const events = []; for (let i = 0; i < Math.ceil(seconds / DT); i++) { game.update(DT, input); events.push(...game.drain()); } return events; };

/** Walk toward a point, turning as a person would, until within `reach` metres; returns the events. */
const walkTo = (game, target, reach = .7, maxSeconds = 60) => {
  const events = [];
  for (let i = 0; i < maxSeconds / DT; i++) {
    const dx = target[0] - game.walker.position[0], dz = target[1] - game.walker.position[1];
    if (Math.hypot(dx, dz) <= reach) break;
    const desired = Math.atan2(dx, dz), delta = wrapAngle(desired - game.walker.yaw);
    game.update(DT, { forward: Math.abs(delta) < 1 ? 1 : 0, strafe: 0, turn: 0, lookDelta: Math.max(-.18, Math.min(.18, delta)) });
    events.push(...game.drain());
  }
  return events;
};

/** Stand still for `seconds`, facing a point. */
const faceAndWait = (game, target, seconds) => {
  const events = [];
  for (let i = 0; i < seconds / DT; i++) {
    const delta = wrapAngle(Math.atan2(target[0] - game.walker.position[0], target[2] - game.walker.position[1]) - game.walker.yaw);
    game.update(DT, { forward: 0, strafe: 0, turn: 0, lookDelta: Math.max(-.2, Math.min(.2, delta)) });
    events.push(...game.drain());
  }
  return events;
};

/** A point `away` metres from an element, on the walker's side. */
const standingPoint = (game, element, away) => {
  const dx = game.walker.position[0] - element.position[0], dz = game.walker.position[1] - element.position[2], d = Math.hypot(dx, dz) || 1;
  return [element.position[0] + dx / d * away, element.position[2] + dz / d * away];
};

const speeches = events => events.filter(event => event.type === "speak");

/** Wake every element of a structure with the gesture each asks for. */
const wake = (game, structure) => {
  const events = [];
  for (const element of structure.elements) {
    if (element.active) continue;
    if (element.gesture === "approach") { events.push(...walkTo(game, [element.position[0], element.position[2]], .9, 20)); events.push(...run(game, .6)); }
    else { events.push(...walkTo(game, standingPoint(game, element, 2.2), .5, 20)); events.push(...faceAndWait(game, element.position, wakeDuration(structure, element.gesture) + 1)); }
    if (!element.active) { events.push(...walkTo(game, standingPoint(game, element, element.gesture === "approach" ? .6 : 2.4), .3, 10)); events.push(...faceAndWait(game, element.position, 3)); }
  }
  return events;
};

test("the opening: Ariadne arrives, offers a direction, and the teaching way is taken up", () => {
  const game = new FieldGame(3);
  const events = run(game, 7);
  assert.ok(events.some(event => event.type === "ariadne_arrives"), "she arrives");
  assert.ok(game.time >= ARRIVAL_DELAY_MS);
  const opening = speeches(events).find(event => event.occasion === "opening");
  assert.ok(opening, "the opening line is spoken once she has settled");
  assert.equal(opening.far.wayId, game.teachingWayId, "her far hearing is along the teaching way");
  assert.match(opening.far.label, /this way/);
  assert.equal(game.undertaking.commitmentsMade, 0, "the teaching lead is not a counted commitment");
  assert.equal(game.ariadne.committedWayId, game.teachingWayId, "her body leads along the teaching way");
  assert.equal(game.call.audibility, "faint", "the call is faint at the spawn");
  const spawn = game.graph.node(game.graph.spawnNodeId);
  const way = game.graph.way(game.teachingWayId);
  const markers = game.graph.markersFrom(way, spawn.id);
  const walked = walkTo(game, markers[2].position, 1);
  const taken = speeches(walked).find(event => event.occasion === "taken_up");
  assert.ok(taken, "passing the first markers is acknowledged");
  assert.ok(game.memory.footprints.length > 5, "footprints are laid");
  assert.ok(walked.some(event => event.type === "footstep"), "footsteps are emitted");
  const { near, body } = game.perceive(opening.far);
  assert.equal(near.standing, "on_way");
  assert.equal(near.ways.length, 1);
  assert.equal(near.ways[0].id, game.teachingWayId);
  assert.equal(near.ways[0].relative, "ahead");
  assert.equal(near.call.audible, true);
  assert.equal(body.presence, "leading_ahead");
});

test("the teaching structure: found, woken with the three gestures, and the call passes on", () => {
  const game = new FieldGame(3);
  run(game, 7);
  const teaching = game.teachingStructure;
  assert.equal(teaching.family, "teaching");
  const events = walkTo(game, teaching.position, 5.5, 80);
  const found = speeches(events).find(event => event.occasion === "structure_found");
  assert.ok(found, "the structure is announced as it comes into view");
  assert.match(found.whatFollowed, /come close enough to touch it/, "the first gesture is approach");
  assert.equal(game.call.audibility, "clear");
  assert.ok(game.currentNodeId === teaching.nodeId || Math.hypot(game.walker.position[0] - teaching.position[0], game.walker.position[1] - teaching.position[1]) < 7);
  assert.equal(game.undertaking.commitmentsMade, 0, "no commitment while a sleeping structure stands here");

  const woke = wake(game, teaching);
  assert.equal(teaching.elements.filter(element => element.active).length, 3, "all three parts woke");
  const wokeEvents = woke.filter(event => event.type === "element_woke");
  assert.equal(wokeEvents.length, 3);
  assert.deepEqual(wokeEvents.map(event => event.remaining), [2, 1, 0]);
  assert.ok(woke.some(event => event.type === "structure_completed"), "completion is emitted");
  assert.ok(woke.some(event => event.type === "fragment"), "a fragment leaves the structure");
  assert.ok(woke.some(event => event.type === "stage_advanced" && event.stage === 1), "the first awakening begins the undertaking");
  assert.ok(game.undertaking.objectiveStructureId, "a new structure calls");
  assert.notEqual(game.undertaking.objectiveStructureId, teaching.id);
  const awakening = speeches(woke).find(event => event.occasion === "awakening_relevant");
  assert.ok(awakening, "she speaks of the awakening");
  assert.ok(awakening.far, "and carries the next way");
  assert.equal(game.undertaking.commitmentsMade, 1, "the way out of the teaching place is her first counted commitment");
  assert.equal(game.undertaking.active.wayId, awakening.far.wayId);
  assert.notEqual(awakening.far.wayId, game.teachingWayId, "she does not send the walker back the way they came");
  assert.equal(game.ariadne.mode, "celebrating");
  assert.equal(game.clearingsMade, 1);
  assert.equal(game.structures.clearingAt(teaching.position), 1);
  const after = run(game, 4);
  assert.ok(after.some(event => event.type === "lead" && event.wayId === awakening.far.wayId), "after the celebration her body leads along the new way");
  assert.ok(game.ariadne.fragments.includes("teaching"), "the fragment rides with her");
  const { near } = game.perceive(awakening.far);
  assert.equal(near.structure.visible, true);
  assert.equal(near.structure.state, "awake");
  assert.equal(near.clearing.visible, true);
  assert.equal(game.call.structureId, game.undertaking.objectiveStructureId, "the new call is the one that sounds now");
  assert.notEqual(game.call.audibility, "clear", "the new call is not close: faint at most, from two or three places away");
});

const reachFirstCommitment = seed => {
  const game = new FieldGame(seed);
  run(game, 7);
  const teaching = game.teachingStructure;
  walkTo(game, teaching.position, 5.5, 80);
  const woke = wake(game, teaching);
  const awakening = speeches(woke).find(event => event.occasion === "awakening_relevant");
  run(game, 4);
  return { game, awakening };
};

test("following her way settles the commitment; the next place brings a new commitment", () => {
  const { game, awakening } = reachFirstCommitment(3);
  const node = game.graph.node(game.teachingNodeId);
  const way = game.graph.way(awakening.far.wayId);
  const markers = game.graph.markersFrom(way, node.id);
  const events = [];
  for (const marker of markers) events.push(...walkTo(game, marker.position, 1.2, 30));
  const farEnd = game.graph.node(game.graph.otherEnd(way, node.id));
  events.push(...walkTo(game, farEnd.position, 1.5, 30));
  const taken = speeches(events).find(event => event.occasion === "taken_up");
  assert.ok(taken, "she notices the take-up");
  assert.equal(game.undertaking.history[0].taken, "followed");
  assert.ok(game.currentNodeId === farEnd.id, "the walker stands at the far place");
  const outcome = game.undertaking.history[0].outcome;
  assert.ok(["confirmed", "fading", "quiet", "nothing", "terminus"].includes(outcome), `the first commitment is settled (${outcome})`);
  const structureHere = game.structures.atNode(farEnd.id);
  if (structureHere && structureHere.completedAt === null) {
    assert.ok(speeches(events).some(event => event.occasion === "structure_found"), "a sleeping structure here is announced");
    assert.equal(game.undertaking.commitmentsMade, 1, "no new commitment while a structure sleeps here");
  } else if (farEnd.ways.length >= 2) {
    const next = speeches(events).find(event => event.occasion === "commitment" || event.occasion === "recognized_return");
    assert.ok(next, "she commits again at the next place");
    assert.equal(game.undertaking.commitmentsMade, 2);
    assert.equal(game.undertaking.active.nodeId, farEnd.id);
  }
});

test("taking another way is a decline; she rejoins and says nothing about the new way", () => {
  const { game, awakening } = reachFirstCommitment(3);
  const node = game.graph.node(game.teachingNodeId);
  const other = node.ways.map(id => game.graph.way(id)).find(way => way.id !== awakening.far.wayId && way.id !== game.teachingWayId) ?? node.ways.map(id => game.graph.way(id)).find(way => way.id !== awakening.far.wayId);
  const markers = game.graph.markersFrom(other, node.id);
  const events = walkTo(game, markers[1].position, 1);
  const declined = speeches(events).find(event => event.occasion === "declined");
  assert.ok(declined, "the decline is spoken");
  assert.equal(declined.far, null, "she has been given nothing about the new way");
  assert.equal(game.undertaking.active, null, "the declined commitment is closed");
  assert.equal(game.undertaking.history[0].taken, "declined");
  assert.equal(game.undertaking.history[0].declinedFor, other.id);
  run(game, 3);
  assert.ok(["catching_up", "hovering_beside"].includes(game.ariadne.mode), `she rejoins (${game.ariadne.mode})`);
});

test("leaving the markers is noticed without being corrected, and coming back restores her lead", () => {
  const { game, awakening } = reachFirstCommitment(3);
  const node = game.graph.node(game.teachingNodeId);
  const way = game.graph.way(awakening.far.wayId);
  const markers = game.graph.markersFrom(way, node.id);
  walkTo(game, markers[2].position, 1);
  // Step off sideways, well clear of every marker line.
  const heading = Math.atan2(markers[3].position[0] - markers[2].position[0], markers[3].position[1] - markers[2].position[1]);
  const side = [markers[2].position[0] + Math.cos(heading) * 22, markers[2].position[1] - Math.sin(heading) * 22];
  const events = walkTo(game, side, 1, 40);
  events.push(...run(game, 3));
  assert.ok(events.some(event => event.type === "off_way" && event.off), "off-way is emitted");
  const spoken = speeches(events).find(event => event.occasion === "off_way");
  assert.ok(spoken, "she goes with them and says so");
  assert.equal(spoken.far, null);
  const { near } = game.perceive(null);
  assert.equal(near.standing, "off_way");
  assert.equal(near.fog, "denser");
  assert.ok(game.offWayFactor > .5);
  const back = walkTo(game, markers[3].position, 1, 40);
  assert.ok(back.some(event => event.type === "off_way" && !event.off), "coming back is emitted");
  assert.ok(back.some(event => event.type === "lead" && event.wayId === way.id), "her lead resumes on her way");
});

test("a way that ends is named as a terminus and she leads back", () => {
  const game = new FieldGame(5);
  run(game, 7);
  const terminus = [...game.graph.nodes.values()].find(node => node.ways.length === 1 && node.id !== game.graph.spawnNodeId && game.structures.ensureAt(node) === null);
  assert.ok(terminus, "the field has a terminus nearby");
  const way = game.graph.way(terminus.ways[0]);
  const markers = game.graph.markersFrom(way, terminus.id);
  game.walker.position = [...markers[2].position];
  const events = walkTo(game, terminus.position, 1.2, 30);
  const spoken = speeches(events).find(event => event.occasion === "terminus");
  assert.ok(spoken, "arriving at the end is spoken");
  assert.match(spoken.walkerDid, /markers stop/);
  assert.equal(game.ariadne.committedWayId, way.id, "she leads back along the only way");
  assert.equal(game.undertaking.commitmentsMade, 0, "the way back is not a counted commitment");
  const { near } = game.perceive(spoken.far);
  assert.equal(near.standing, "at_node");
  assert.equal(near.nodeFloor, null, "a terminus is not a place floor");
  assert.ok(near.terminusVisible);
  // The ground gives out: the walker cannot walk on past the end.
  const away = Math.atan2(terminus.position[0] - markers[0].position[0], terminus.position[1] - markers[0].position[1]);
  const beyond = [terminus.position[0] + Math.sin(away) * 12, terminus.position[1] + Math.cos(away) * 12];
  walkTo(game, beyond, .5, 12);
  assert.ok(Math.hypot(game.walker.position[0] - terminus.position[0], game.walker.position[1] - terminus.position[1]) < 8, "the collapse stops the walker");
});

test("save and restore bring back the same ground, the same undertaking and her lead", () => {
  const { game, awakening } = reachFirstCommitment(3);
  const node = game.graph.node(game.teachingNodeId);
  const way = game.graph.way(awakening.far.wayId);
  walkTo(game, game.graph.markersFrom(way, node.id)[1].position, 1);
  const saved = JSON.parse(JSON.stringify(game.save()));
  const restored = FieldGame.restore(saved);
  assert.deepEqual(restored.walker.position, game.walker.position);
  assert.equal(restored.undertaking.stage, 1);
  assert.equal(restored.undertaking.commitmentsMade, game.undertaking.commitmentsMade);
  assert.equal(restored.undertaking.objectiveStructureId, game.undertaking.objectiveStructureId);
  assert.equal(restored.structures.get(game.teachingStructure.id).completedAt, game.teachingStructure.completedAt);
  assert.equal(restored.clearingsMade, 1);
  assert.equal(restored.memory.footprints.length, game.memory.footprints.length);
  assert.equal(restored.ariadne.committedWayId, way.id, "her body leads along the same way");
  assert.deepEqual(restored.ariadne.fragments, ["teaching"]);
  assert.equal(restored.ariadne.mode, "leading");
  assert.equal(restored.structures.get(restored.undertaking.objectiveStructureId).relevance, "objective_relevant");
  const events = run(restored, 2);
  assert.ok(!speeches(events).some(event => event.occasion === "opening"), "the opening does not replay");
  assert.ok(!events.some(event => event.type === "ariadne_arrives"), "she does not arrive again");
});

test("the warmth phase moves with commitments, clearings and time", () => {
  assert.equal(phaseFor(0, 0, 0), "charming");
  assert.equal(phaseFor(3, 1, 120), "charming");
  assert.equal(phaseFor(5, 1, 180), "charming", "the first handful of commitments and the teaching clearing stay charming");
  assert.equal(phaseFor(7, 2, 300), "attached");
  assert.equal(phaseFor(12, 3, 900), "overbearing");
  assert.equal(phaseFor(2, 0, 60 * 50), "overbearing", "a long session alone carries her into the late register");
});

test("the graph and structures stream in as the walker travels", () => {
  const game = new FieldGame(11);
  run(game, 7);
  const before = game.graph.nodes.size;
  game.walker.position = [game.walker.position[0] + 300, game.walker.position[1] + 300];
  run(game, 1);
  assert.ok(game.graph.nodes.size > before, "new chunks appear");
  assert.equal(game.graph.hops(game.graph.spawnNodeId, 200).size, game.graph.nodes.size, "everything generated stays connected");
});

test("the fog shader receives the clearings nearest the walker, not the first ones made", () => {
  const game = new FieldGame(9);
  run(game, 1);
  const nodes = [...game.graph.nodes.values()].filter(node => node.ways.length >= 1).slice(0, 20);
  nodes.forEach((node, index) => { const structure = game.structures.placeAt(node, "bells"); structure.completedAt = 1000 + index; });
  const all = game.clearings();
  assert.equal(all.length, 20);
  const nearest = game.clearings(12);
  assert.equal(nearest.length, 12);
  for (let i = 1; i < nearest.length; i++) assert.ok(nearest[i].distance >= nearest[i - 1].distance, "nearest first");
  const farthestKept = nearest.at(-1).distance;
  assert.ok(all.filter(item => item.distance <= farthestKept).length >= 12, "everything closer than the last kept one is in the list");
  assert.ok(all.some(item => item.since === 1000 + 19 && nearest.some(kept => kept.since === item.since)) || nearest.every(kept => kept.distance <= farthestKept), "recency does not decide");
});

test("a nearby sleeping structure sounds with its own family, not the objective's", () => {
  const { game } = reachFirstCommitment(3);
  const objective = game.structures.get(game.undertaking.objectiveStructureId);
  const proxy = game.structures.all().find(item => item.completedAt === null && item.id !== objective.id && item.family !== objective.family && item.family !== "teaching");
  assert.ok(proxy, "a sleeping structure of another family exists");
  game.walker.position = [proxy.position[0] + 3, proxy.position[1]];
  run(game, .5);
  assert.equal(game.call.structureId, proxy.id);
  assert.equal(game.call.proxy, true);
  assert.equal(game.call.family, proxy.family, "the call carries the family of the structure that is sounding");
  assert.notEqual(game.call.family, objective.family);
  const { near } = game.perceive(null);
  assert.equal(near.call.audible, true);
});

test("her way walked to an empty, silent place is named as such before she chooses again", () => {
  // Build the situation directly: a commitment from A along a way to B, where B has no structure and the call is out of hearing.
  const game = new FieldGame(21);
  run(game, 7);
  const teaching = game.teachingStructure;
  walkTo(game, teaching.position, 5.5, 80);
  wake(game, teaching);
  run(game, 4);
  // Move the objective far away so no call is audible anywhere near, then follow her current way to its end.
  const farNode = [...game.graph.nodes.values()].sort((a, b) => Math.hypot(b.position[0] - game.walker.position[0], b.position[1] - game.walker.position[1]) - Math.hypot(a.position[0] - game.walker.position[0], a.position[1] - game.walker.position[1]))[0];
  const objective = game.structures.placeAt(farNode, "cairn");
  game.undertaking = { ...game.undertaking, objectiveStructureId: objective.id, objectiveNodeId: objective.nodeId };
  const lead = game.ariadne.committedWayId; const from = game.ariadne.committedFromNodeId;
  const way = game.graph.way(lead);
  const farEnd = game.graph.node(game.graph.otherEnd(way, from));
  if (game.structures.atNode(farEnd.id)) { game.structures.byNode.delete(farEnd.id); }
  const events = [];
  for (const marker of game.graph.markersFrom(way, from)) events.push(...walkTo(game, marker.position, 1.2, 30));
  events.push(...walkTo(game, farEnd.position, 1.4, 30));
  const spoken = speeches(events).filter(event => event.occasion === "commitment" || event.occasion === "recognized_return").at(-1);
  if (farEnd.ways.length >= 2) {
    assert.ok(spoken, "she commits again at the empty place");
    assert.match(spoken.walkerDid, /nothing stands here and no call is audible from here/, "the card says her way ended in nothing");
    assert.equal(spoken.tone, spoken.occasion === "commitment" ? "quiet_arrival" : undefined);
  }
});

test("a structure reached by the walker's own way is named as theirs in her card, and the run counts the decline", () => {
  const { game, awakening } = reachFirstCommitment(3);
  const node = game.graph.node(game.teachingNodeId);
  const other = node.ways.map(id => game.graph.way(id)).find(way => way.id !== awakening.far.wayId && way.id !== game.teachingWayId) ?? node.ways.map(id => game.graph.way(id)).find(way => way.id !== awakening.far.wayId);
  const farEnd = game.graph.node(game.graph.otherEnd(other, node.id));
  // Put a sleeping structure at the end of the way she did not choose, so their way and not hers leads to it.
  const existing = game.structures.atNode(farEnd.id);
  if (!existing) game.structures.placeAt(farEnd, "cairn"); else if (existing.completedAt !== null) { existing.completedAt = null; for (const element of existing.elements) element.active = false; }
  const events = [];
  for (const marker of game.graph.markersFrom(other, node.id)) events.push(...walkTo(game, marker.position, 1.2, 30));
  events.push(...walkTo(game, farEnd.position, 2.5, 30));
  events.push(...run(game, 1));
  const declined = speeches(events).find(event => event.occasion === "declined");
  assert.ok(declined, "the decline is spoken");
  const found = speeches(events).find(event => event.occasion === "structure_found" && !/first sleeping structure/.test(event.walkerDid));
  assert.ok(found, "the structure at the end of their way is announced");
  assert.match(found.walkerDid, new RegExp(`They came this way along the ${other.marker}, a way they chose instead of the ${game.graph.way(awakening.far.wayId).marker} you had chosen; yours did not lead here\\.`));
  assert.ok(game.arrivedByOwnChoice(farEnd.id), "the game knows they arrived by their own choice");
  assert.equal(game.run().declined, 1);
  assert.equal(game.run().waysChosen, 1);
  const structure = game.structures.atNode(farEnd.id);
  const woke = wake(game, structure);
  const awakened = speeches(woke).find(event => event.occasion.startsWith("awakening"));
  assert.ok(awakened, "the structure is woken");
  assert.match(awakened.walkerDid, /the way they chose instead of the .* you had chosen/);
  if (awakened.occasion === "awakening_relevant") { assert.match(awakened.walkerDid, /they found it without you/); assert.deepEqual(game.run(), { waysChosen: game.undertaking.active ? 1 : 0, walked: 0, arrivedAtNothing: 0, faded: 0, ended: 0, declined: 0, returns: 0 }, "a new call: the run begins again"); }
  else assert.match(awakened.walkerDid, /your way did not lead here/);
});

test("returns are counted for the run and survive a save", () => {
  const { game, awakening } = reachFirstCommitment(5);
  const node = game.graph.node(game.teachingNodeId);
  const way = game.graph.way(awakening.far.wayId);
  for (const marker of game.graph.markersFrom(way, node.id)) walkTo(game, marker.position, 1.2, 30);
  const farEnd = game.graph.node(game.graph.otherEnd(way, node.id));
  walkTo(game, farEnd.position, 1.4, 30);
  for (const marker of game.graph.markersFrom(way, farEnd.id)) walkTo(game, marker.position, 1.2, 30);
  walkTo(game, node.position, 1.4, 30);
  const before = game.run().returns;
  assert.ok(before >= 1, `coming back to the teaching place is a return (${before})`);
  const restored = FieldGame.restore(JSON.parse(JSON.stringify(game.save())));
  assert.equal(restored.run().returns, before);
  assert.deepEqual(restored.run(), game.run());
});

test("a walker who stands still at the start hears the invitation again, twice at most, as a recorded cue", () => {
  const game = new FieldGame(31);
  const events = run(game, 75);
  const waiting = events.filter(event => event.type === "speak" && event.tone === "waiting");
  assert.ok(waiting.length >= 1 && waiting.length <= 2, `renewed ${waiting.length} times`);
  for (const event of waiting) { assert.equal(event.occasion, "commitment"); assert.equal(event.prompt, true); assert.equal(event.far?.wayId, game.teachingWayId); }
  // The count survives a save, so a reopened tab does not start nudging again.
  const restored = FieldGame.restore(game.save());
  const later = run(restored, 60).filter(event => event.type === "speak" && event.tone === "waiting");
  assert.equal(waiting.length + later.length <= 2, true);
});


test("vertical look clamps, survives saves, and leaves walking on the ground", () => {
  const game = new FieldGame(3);
  const start = [...game.walker.position], yaw = game.walker.yaw;
  game.update(DT, { ...IDLE_INPUT, pitchDelta: .6 });
  assert.equal(game.walker.pitch, .6);
  assert.equal(game.walker.yaw, yaw);
  assert.deepEqual(game.walker.position, start);
  assert.equal(FieldGame.restore(game.save()).walker.pitch, .6);
  const legacy = game.save(); delete legacy.walker.pitch;
  assert.equal(FieldGame.restore(legacy).walker.pitch, 0);
  game.update(DT, { ...IDLE_INPUT, pitchDelta: 10 });
  assert.ok(game.walker.pitch < Math.PI / 2);
  game.update(DT, { ...IDLE_INPUT, pitchDelta: -20 });
  assert.ok(game.walker.pitch > -Math.PI / 2);
  run(game, .3, { ...IDLE_INPUT, strafe: 1 });
  assert.equal(game.walker.yaw, yaw);
  assert.ok(Math.hypot(game.walker.position[0]-start[0],game.walker.position[1]-start[1]) > 0);
});

test("a part answering a held look is spoken to once while it still has a second to go, and a stall while looking at the structure is helped", () => {
  const game = new FieldGame(3);
  run(game, 7);
  const teaching = game.teachingStructure;
  walkTo(game, teaching.position, 5.5, 80);
  const [approach, look] = teaching.elements;
  assert.equal(approach.gesture, "approach"); assert.equal(look.gesture, "look");
  walkTo(game, [approach.position[0], approach.position[2]], .9, 20); run(game, .6);
  assert.ok(approach.active, "the touch woke the first part");
  run(game, 3.2);
  walkTo(game, standingPoint(game, look, 2.2), .5, 20);
  const holding = faceAndWait(game, look.position, wakeDuration(teaching, "look") * .55);
  assert.ok(!look.active && look.attention > .15, `the look is being answered but is not complete (${look.attention})`);
  const attending = speeches(holding).find(event => event.occasion === "structure_attending");
  assert.ok(attending, "she tells them to stay as they are while it answers");
  assert.match(attending.walkerDid, /looking at it steadily, as its next sleeping part asks, and it is answering them slowly; 1 part of the structure is awake and 2 still asleep/);
  assert.match(attending.whatFollowed, /few more seconds of exactly this/);
  assert.equal(attending.priority, 66);
  const { near } = game.perceive(null);
  assert.equal(near.structure.attending?.gesture, "look");
  assert.ok(["beginning", "halfway", "almost"].includes(near.structure.attending?.progress));
  assert.equal(near.structure.nextAsks, "look");
  const rest = faceAndWait(game, look.position, wakeDuration(teaching, "look"));
  assert.ok(look.active, "held a little longer, it wakes");
  assert.ok(!speeches(rest).some(event => event.occasion === "structure_attending"), "she does not say it twice for one part");

  // A stall: standing six metres off, looking at the structure but at no part, nothing answers; after PROMPT_AFTER_MS she helps,
  // and her card says what they are looking at.
  const dx = game.walker.position[0] - teaching.position[0], dz = game.walker.position[1] - teaching.position[1], d = Math.hypot(dx, dz) || 1;
  walkTo(game, [teaching.position[0] + dx / d * 6, teaching.position[1] + dz / d * 6], .4, 20);
  const stalled = faceAndWait(game, [teaching.position[0], 1.4, teaching.position[1]], PROMPT_AFTER_MS / 1000 + 2);
  const prompt = speeches(stalled).find(event => event.occasion === "structure_found" && event.prompt);
  assert.ok(prompt, "looking at the structure no longer silences her when nothing is happening");
  assert.match(prompt.walkerDid, /nothing has happened for a while\. They are looking at the structure, but not at the part that still sleeps\./);
  assert.match(prompt.whatFollowed, /stand still beside it and listen/);
  assert.equal(game.perceive(null).near.structure.nextAsks, "listen");
});

test("standing still while she waits at her marker renews the invitation twice, with the waiting tone, and then leaves the silence theirs", () => {
  const game = new FieldGame(3);
  run(game, 7);
  const teaching = game.teachingStructure;
  walkTo(game, teaching.position, 5.5, 80);
  wake(game, teaching);
  run(game, 5);
  assert.ok(game.undertaking.active, "a way is chosen after the first clearing");
  const stood = run(game, STILL_RENEW_AFTER_MS / 1000 * 3 + 10);
  const renewals = speeches(stood).filter(event => event.occasion === "commitment" && event.prompt && event.tone === "waiting");
  assert.equal(renewals.length, 2, `two renewals to someone standing still (${renewals.length})`);
  assert.match(renewals[0].walkerDid, /Has not moved for \d+ seconds; you are waiting at the first marker of the/);
  assert.equal(renewals[0].commitmentId, game.undertaking.active.id);
});
