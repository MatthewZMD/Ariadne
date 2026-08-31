import assert from "node:assert/strict";
import test from "node:test";
import { AMBIENT_BUS_RELATIVE_TO_ARIADNE_DB, INTERACTION_BUS_RELATIVE_TO_ARIADNE_DB, OBJECT_SOUND_FAMILY, RETRO_INTERACTION_PATTERNS, SOUND_PROFILES, soundFamilyFor } from "../app/ambient-sound.ts";
import { ARIADNE_REFERENCE_GAIN, ARIADNE_REFERENCE_MEAN_DB } from "../app/ariadne-voice.ts";
import { SPRITE_KINDS } from "../app/sprite-atlas.ts";

test("every rendered ambient object has an authored sound family",()=>{
  assert.deepEqual(Object.keys(OBJECT_SOUND_FAMILY).sort(),[...SPRITE_KINDS].sort());
  for(const family of Object.values(OBJECT_SOUND_FAMILY))assert.ok(SOUND_PROFILES[family]);
});

test("noticeable spectacles resolve to coherent acoustic families",()=>{
  assert.equal(soundFamilyFor("frog-parade","ruins"),"frog");
  assert.equal(soundFamilyFor("page-bird","frozen"),"paper");
  assert.equal(soundFamilyFor("steam-animals","foundry"),"steam");
  assert.equal(soundFamilyFor("crystal-rainbow","cavern"),"glass");
  assert.equal(soundFamilyFor("warning-flock","tornado"),"wind");
  assert.equal(soundFamilyFor("masonry-fish","beach"),"wave");
});

test("sound profiles compensate source loudness while referencing local bundled media",()=>{
  for(const profile of Object.values(SOUND_PROFILES)){
    assert.match(profile.path,/^\/audio\/ambience\/[a-z-]+\.mp3$/);
    assert.ok(profile.gain>0&&profile.gain<=8);
    assert.ok(profile.rate[0]>0&&profile.rate[1]>=profile.rate[0]);
    assert.ok(["lowpass","bandpass"].includes(profile.retro.filter));assert.ok(profile.retro.bits>=7&&profile.retro.bits<=9);assert.ok(profile.retro.mix>=.15&&profile.retro.mix<=.26);assert.ok(profile.retro.flutterCents>=4&&profile.retro.flutterCents<=12);
  }
  assert.ok(SOUND_PROFILES.grass.gain>SOUND_PROFILES.wind.gain*20,"the quiet grass recording needs substantially more compensation than the already loud wind loop");
});

test("realistic ambience passes through a restrained retro hardware treatment",async()=>{
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../app/ambient-sound.ts",import.meta.url),"utf8"));
  assert.match(source,/createBiquadFilter/);assert.match(source,/createWaveShaper/);assert.match(source,/retroCurve/);assert.match(source,/lfoGain\.connect\(source\.detune\)/);assert.match(source,/oversample="none"/);
});

test("the mix is explicitly calibrated beneath Ariadne's measured voice reference",()=>{
  assert.equal(ARIADNE_REFERENCE_GAIN,.9);assert.equal(ARIADNE_REFERENCE_MEAN_DB,-22.9);
  assert.equal(AMBIENT_BUS_RELATIVE_TO_ARIADNE_DB,-7.5);assert.equal(INTERACTION_BUS_RELATIVE_TO_ARIADNE_DB,-6);
  assert.ok(INTERACTION_BUS_RELATIVE_TO_ARIADNE_DB>AMBIENT_BUS_RELATIVE_TO_ARIADNE_DB);
});

test("MT's physical interactions trigger distinct spatial effects",async()=>{
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../app/page.tsx",import.meta.url),"utf8"));
  for(const kind of ["wake","complete","star_response","star_collect","collision"])assert.ok(source.includes(`"${kind}"`),`missing ${kind} interaction`);
  assert.match(source,/playInteraction/);assert.match(source,/element\?\.position/);assert.match(source,/active\.cell/);assert.match(source,/elements\.filter\(item=>item\.active\)\.length/);
});

test("interaction feedback uses short authored retro-game synth patterns",()=>{
  assert.deepEqual(Object.keys(RETRO_INTERACTION_PATTERNS).sort(),["collision","complete","star_collect","star_response","wake"]);
  assert.equal(RETRO_INTERACTION_PATTERNS.wake.wave,"square");assert.equal(RETRO_INTERACTION_PATTERNS.star_collect.notes.length,5);assert.equal(RETRO_INTERACTION_PATTERNS.collision.wave,"sawtooth");
  assert.ok(RETRO_INTERACTION_PATTERNS.complete.length>RETRO_INTERACTION_PATTERNS.wake.length*3);assert.ok(RETRO_INTERACTION_PATTERNS.star_response.length>RETRO_INTERACTION_PATTERNS.complete.length);
  for(const pattern of Object.values(RETRO_INTERACTION_PATTERNS)){assert.ok(pattern.length<=.75);assert.ok(pattern.volume<=.13);assert.ok(pattern.notes.length>=2)}
});

test("pause suspends voice and soundscape transports instead of discarding playback",async()=>{
  const [page,soundscape,voice]=await Promise.all(["../app/page.tsx","../app/ambient-sound.ts","../app/ariadne-voice.ts"].map(path=>import("node:fs/promises").then(fs=>fs.readFile(new URL(path,import.meta.url),"utf8"))));
  assert.match(page,/ariadneVoiceRef\.current\?\.pause\(\)/);assert.match(page,/ambientSoundscapeRef\.current\?\.pause\(\)/);
  assert.match(soundscape,/context\?\.suspend\(\)/);assert.match(soundscape,/if\(!context\|\|!master\|\|!interactionBus\|\|!unlocked\|\|paused\)return/);
  assert.match(voice,/audioContext\?\.suspend\(\)/);assert.match(voice,/resumeWaiters/);
});
