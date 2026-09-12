import assert from "node:assert/strict";
import test from "node:test";
import { fieldStageCard } from "../app/field-practice.ts";
import { SCENARIOS } from "../scripts/prompt-lab-scenarios.mjs";

function sameMarkerRoutes(chosen) {
  const request = structuredClone(SCENARIOS.find(item => item.id === "commitment_early").request);
  request.near.ways = [
    { id: "fresh-stakes", marker: "stakes", relative: "left", residue: false, footprints: false },
    { id: "walked-stakes", marker: "stakes", relative: "right", residue: true, footprints: true },
  ];
  request.far.heardAlong = { wayId: chosen };
  return fieldStageCard(request).split("WHAT IS FAR")[1].split("YOUR BODY")[0];
}

test("far hearing preserves the selected route's walking history when marker families repeat", () => {
  const far = sameMarkerRoutes("walked-stakes");
  assert.match(far, /loudest along the stakes to your right/);
  assert.match(far, /footprints are on this particular route: they have walked along it before/);
  assert.match(far, /another route's walking history does not belong to it/);
  assert.doesNotMatch(far, /No older footprints are visible on this particular route/);
});

test("a neighboring route's footprints do not become evidence for the selected route", () => {
  const far = sameMarkerRoutes("fresh-stakes");
  assert.match(far, /loudest along the stakes to your left/);
  assert.match(far, /No older footprints are visible on this particular route/);
  assert.match(far, /does not establish that it is untried/);
  assert.doesNotMatch(far, /they have walked along it before/);
});
