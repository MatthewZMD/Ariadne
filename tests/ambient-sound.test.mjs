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

test("the walker's physical interactions trigger distinct spatial effects in the field",async()=>{
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../app/field/audio.ts",import.meta.url),"utf8"));
  for(const kind of ["footstep","element_woke","element_sounded","structure_completed"])assert.ok(source.includes(`case "${kind}"`),`missing ${kind} handling`);
  assert.match(source,/panningModel = "HRTF"/);assert.match(source,/event\.position\)/);assert.match(source,/-element-0\$\{index\}/);assert.match(source,/-completion`/);
});

test("interaction feedback uses short authored retro-game synth patterns",()=>{
  assert.deepEqual(Object.keys(RETRO_INTERACTION_PATTERNS).sort(),["collision","complete","material","star_collect","star_response","wake"]);
  assert.equal(RETRO_INTERACTION_PATTERNS.wake.wave,"square");assert.equal(RETRO_INTERACTION_PATTERNS.star_collect.notes.length,5);assert.equal(RETRO_INTERACTION_PATTERNS.collision.wave,"sawtooth");
  assert.ok(RETRO_INTERACTION_PATTERNS.complete.length>RETRO_INTERACTION_PATTERNS.wake.length*3);assert.ok(RETRO_INTERACTION_PATTERNS.star_response.length>RETRO_INTERACTION_PATTERNS.complete.length);
  for(const [kind,pattern] of Object.entries(RETRO_INTERACTION_PATTERNS)){assert.ok(pattern.length<=.75);assert.ok(pattern.volume<=.13);assert.ok(pattern.notes.length>=(kind==="material"?1:2))}
  assert.ok(RETRO_INTERACTION_PATTERNS.material.volume<RETRO_INTERACTION_PATTERNS.wake.volume,"playing awakened material should not sound like another reward fanfare");
});

test("pause suspends the field's one audio transport instead of discarding playback",async()=>{
  const [page,audio]=await Promise.all(["../app/field-page.tsx","../app/field/audio.ts"].map(path=>import("node:fs/promises").then(fs=>fs.readFile(new URL(path,import.meta.url),"utf8"))));
  assert.match(page,/audioRef\.current\?\.pause\(\)/);assert.match(page,/audioRef\.current\?\.resume\(\)/);
  assert.match(audio,/pause\(\) \{ paused = true; void context\?\.suspend\(\); \}/);assert.match(audio,/resume\(\) \{ paused = false; void context\?\.resume\(\); \}/);
});

test("the pause menu owns one master switch for voice and world audio, and never offers giving up",async()=>{
  const [page,audio]=await Promise.all(["../app/field-page.tsx","../app/field/audio.ts"].map(path=>import("node:fs/promises").then(fs=>fs.readFile(new URL(path,import.meta.url),"utf8"))));
  assert.match(page,/type="range"/);assert.match(page,/setMasterVolume\(Number\(event\.target\.value\)\)/);assert.match(page,/audioRef\.current\?\.setMasterVolume\(masterVolume\)/);
  assert.doesNotMatch(page,/GIVE UP|give up/i,"stopping is unmarked: there is no ending to trigger");
  assert.match(audio,/let masterVolume = 1/);assert.match(audio,/voiceBus\.connect\(master\)/);
});
