import assert from "node:assert/strict";
import test from "node:test";
import { fieldStageCard } from "../app/field-practice.ts";
import { SCENARIOS } from "../scripts/prompt-lab-scenarios.mjs";

function sameMarkerRoutes(chosen) {
  const request = structuredClone(SCENARIOS.find(item => item.id === "commitment_early").request);
  request.near.ways = [
    { id: "fresh-posts", marker: "posts", relative: "left", residue: false, footprints: false },
    { id: "walked-posts", marker: "posts", relative: "right", residue: true, footprints: true },
  ];
  request.far.heardAlong = { wayId: chosen };
  return fieldStageCard(request).split("WHAT IS FAR")[1].split("YOUR BODY")[0];
}

test("far hearing preserves the selected route's walking history when marker families repeat", () => {
  const far = sameMarkerRoutes("walked-posts");
  assert.match(far, /loudest along the posts to your right/);
  assert.match(far, /footprints are on this particular route: they have walked along it before/);
  assert.match(far, /another route's walking history does not belong to it/);
  assert.doesNotMatch(far, /No older footprints are visible on this particular route/);
});

test("a neighboring route's footprints do not become evidence for the selected route", () => {
  const far = sameMarkerRoutes("fresh-posts");
  assert.match(far, /loudest along the posts to your left/);
  assert.match(far, /No older footprints are visible on this particular route/);
  assert.match(far, /does not establish that it is untried/);
  assert.doesNotMatch(far, /they have walked along it before/);
});
