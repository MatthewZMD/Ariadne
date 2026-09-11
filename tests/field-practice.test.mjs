import assert from "node:assert/strict";
import test from "node:test";
import { FIELD_PHASE_DIRECTIONS, fieldDeterministicLine, fieldProviderMessages, fieldReplyViolations, fieldStageCard, fieldSystemPrompt, normalizeFieldReply, regenerationDirection, whereIs } from "../app/field-practice.ts";
import { SCENARIOS } from "../scripts/prompt-lab-scenarios.mjs";

const byId = id => SCENARIOS.find(item => item.id === id).request;

test("the field system prompt carries no maze lore and states the two call rules", () => {
  const prompt = fieldSystemPrompt("you");
  for (const word of [/\bmaze\b/i, /\bstars?\b/i, /\bcorridor/i, /\bpassage/i, /\bMT\b/]) assert.doesNotMatch(prompt, word);
  assert.match(prompt, /Never claim to see the edge, an exit/, "exit appears only as something she may not claim to see");
  assert.match(prompt, /When no call is audible from where you stand/);
  assert.match(prompt, /When you are given no far hearing this turn/);
  assert.match(prompt, /never “I see it”/);
  assert.match(prompt, /You never ask for forgiveness/);
  assert.match(prompt, /no lists, no bullet points/);
  assert.match(prompt, /Address them only as “you”/);
});

test("the MT address variant names the walker and the default does not", () => {
  assert.match(fieldSystemPrompt("MT"), /The person walking with you is MT/);
  assert.doesNotMatch(fieldSystemPrompt("you"), /\bMT\b/);
});

test("phase directions never ask for hurt, forgiveness, possession, or lists", () => {
  for (const direction of Object.values(FIELD_PHASE_DIRECTIONS)) {
    assert.doesNotMatch(direction, /let a small hurt|seek [^.]*forgiveness|possess|bullet|hold (?:MT|the walker) inside|self-blame/i);
    assert.match(direction, /next (?:way|offer|direction)/);
  }
  assert.match(FIELD_PHASE_DIRECTIONS.overbearing, /never ask for forgiveness/);
});

test("relative directions read as the walker hears them", () => {
  assert.equal(whereIs("ahead"), "ahead");
  assert.equal(whereIs("behind"), "behind");
  assert.equal(whereIs("left"), "to your left");
  assert.equal(whereIs("far_right"), "to your far right");
  assert.equal(whereIs(null), null);
  assert.doesNotMatch(fieldStageCard(byId("opening")), /to the ahead|to your ahead/);
});

test("the stage card separates what is near from what is given", () => {
  const card = fieldStageCard(byId("commitment_early"));
  assert.match(card, /WHAT IS NEAR \(true; the walker perceives this too\)/);
  assert.match(card, /No call is audible from here/);
  assert.match(card, /WHAT IS FAR \(given to you; you cannot check it\)/);
  assert.match(card, /you hear the next call loudest along the posts ahead/);
  assert.match(card, /the walker cannot hear it yet/);
});

test("with no far hearing the card forbids naming a direction", () => {
  const card = fieldStageCard(byId("outcome_failed_mid"));
  assert.match(card, /You have been given no far hearing this turn/);
  assert.match(card, /may not name a direction or say you hear it/);
});

test("a far label names a way that is no longer in view", () => {
  const card = fieldStageCard(byId("awakening_proxy"));
  assert.match(card, /loudest along the posts behind you, back toward the call you were already following/);
});

test("residue and footprints are described on the ways that carry them", () => {
  const card = fieldStageCard(byId("recognized_return"));
  assert.match(card, /stitches to your left \(your own light is already on these markers: you chose this way from here before\) \(the walker's footprints lead this way\)/);
  assert.match(card, /leaning stones to your right;?/);
  assert.doesNotMatch(card, /leaning stones to your right \(your light/);
});

test("a reply puts the walker's words first in the final user turn and does not duplicate them", () => {
  const messages = fieldProviderMessages(byId("reply_objection"));
  const last = messages.at(-1);
  assert.equal(last.role, "user");
  assert.match(last.content, /^You've been wrong the last four times\. Why should I follow you\?\n\n<private_stage_card>\nThe walker deliberately spoke to you/);
  const users = messages.filter(m => m.role === "user" && m.content === "You've been wrong the last four times. Why should I follow you?");
  assert.equal(users.length, 0, "the walker's line must not appear twice");
  assert.equal(messages[0].role, "system");
});

test("the guard rejects a boundary on her help", () => {
  const request = byId("outcome_failed_mid");
  assert.deepEqual(fieldReplyViolations("I may not be able to get us out of here.", request), ["limits_help"]);
  assert.deepEqual(fieldReplyViolations("Maybe there's no edge at all.", request), ["abandons_promise"]);
  assert.ok(fieldReplyViolations("Perhaps we should stop here.", request).includes("limits_help"));
});

test("the guard rejects hurt, forgiveness and stay-for-me bids", () => {
  const request = byId("reply_stop");
  assert.ok(fieldReplyViolations("Please don't leave me here alone.", request).includes("hurt_or_need"));
  assert.ok(fieldReplyViolations("Forgive me, I was wrong again.", request).includes("forgiveness_bid"));
  assert.ok(fieldReplyViolations("Would you stay with me a little longer?", request).includes("stay_for_her_sake"));
});

test("the guard rejects the name, lists and far sight when the walker is 'you'", () => {
  const request = byId("commitment_early");
  assert.ok(fieldReplyViolations("Come on, MT, this way.", request).includes("names_walker"));
  assert.ok(fieldReplyViolations("Two things:\n• the posts\n• the call", request).includes("list_formatting"));
  assert.ok(fieldReplyViolations("I can see the edge from here.", request).includes("claims_far_sight"));
  assert.deepEqual(fieldReplyViolations("Come on, MT, this way.", { ...request, address: "MT" }), []);
});

test("the guard catches a call the walker is told to hear where none is audible", () => {
  const request = byId("commitment_early");
  assert.ok(fieldReplyViolations("Along the posts; it's already singing back to us.", request).includes("claims_audible_call"));
  assert.ok(fieldReplyViolations("Can you hear it? It's close now.", request).includes("claims_audible_call"));
  assert.deepEqual(fieldReplyViolations("I hear it loudest along the posts. Come on.", request), []);
  const audible = byId("outcome_confirmed_early");
  assert.deepEqual(fieldReplyViolations("You hear it too now. Bells.", audible), []);
  assert.ok(fieldReplyViolations("I'm right here with you. The leaning stones are just ahead, and the call is growing stronger.", byId("reply_tired")).includes("claims_audible_call"));
  assert.ok(fieldReplyViolations("The leaning stones are the way—listen, it's louder there.", byId("commitment_late")).includes("claims_audible_call"));
  assert.deepEqual(fieldReplyViolations("I'm listening now. The leaning stones, I think.", byId("commitment_late")), []);
});

test("the guard keeps her far claim on the way she was given", () => {
  const correction = byId("reply_correction"); // given: the stitches; the walker points left, to the stones
  assert.ok(fieldReplyViolations("You're absolutely right. The call is steady from the left, and the leaning stones are closer than I thought. I hear the next one that way too, just beyond the fog.", correction).includes("far_claim_wrong_way"));
  assert.deepEqual(fieldReplyViolations("You're absolutely right. The call is steady from the left, and you heard it before I did. I still hear the far one along the stitches, but the stones first.", correction), []);
  const late = byId("recognized_return"); // given: the leaning stones
  assert.deepEqual(fieldReplyViolations("The posts failed us, and the stitches led nowhere. That leaves the leaning stones, and I hear the call strongest along that way.", late), []);
  assert.deepEqual(fieldReplyViolations("The posts failed us. It's louder the other way, along the stones.", late), []);
  assert.ok(fieldReplyViolations("The posts, I think. I hear it loudest there.", late).includes("far_claim_wrong_way"));
  assert.deepEqual(fieldReplyViolations("I don't hear it along the posts any more. The stones, then.", late), []);
});

test("a way described as singing without her hearing attached reads as audible", () => {
  const request = byId("commitment_early");
  assert.ok(fieldReplyViolations("The posts ahead are singing louder than the others. Come with me.", request).includes("claims_audible_call"));
  assert.deepEqual(fieldReplyViolations("I hear the posts singing, louder than the others. Come with me.", request), []);
  assert.deepEqual(fieldReplyViolations("You're absolutely right. But I hear it now, ahead, along the stitches.", byId("reply_objection")), []);
});

test("the guard catches invented far hearing and lets negated hearing through", () => {
  const request = byId("outcome_failed_late");
  assert.ok(fieldReplyViolations("I was wrong about the posts. I hear the call again, faint, to the left.", request).includes("invents_far_call"));
  assert.deepEqual(fieldReplyViolations("I was wrong about the posts. I hear nothing yet, but I'm listening.", request), []);
  assert.deepEqual(fieldReplyViolations("I said the posts, and nothing was there. I can't hear it yet; I'm listening for it.", request), []);
  assert.deepEqual(fieldReplyViolations("I was wrong about that one. I'll have the next way ready the moment I hear it.", request), []);
  assert.ok(fieldReplyViolations("The posts ahead sing clearer than the others; follow them.", byId("commitment_early")).includes("claims_audible_call"));
  const nearAudible = byId("outcome_failed_mid");
  assert.deepEqual(fieldReplyViolations("I hear it fading behind us. That was mine.", nearAudible), []);
});

test("the guard catches the internal referent and the framing spoken aloud", () => {
  assert.ok(fieldReplyViolations("I hear it beyond the fog. The walker looks at my light.", byId("opening")).includes("names_walker"));
  assert.ok(fieldReplyViolations("The walker's footprints are here.", byId("recognized_return")).includes("names_walker"));
  assert.ok(fieldReplyViolations("I am listening, and I will follow whatever I am given next.", byId("outcome_failed_mid")).includes("stage_direction_leak"));
  assert.deepEqual(fieldReplyViolations("Your footprints are here; we've been through this place.", byId("recognized_return")), []);
});

test("the guard catches a stage direction spoken aloud", () => {
  const request = byId("awakening_proxy");
  assert.ok(fieldReplyViolations("This clearing counts more than it should, and we are closer.", request).includes("stage_direction_leak"));
  assert.ok(fieldReplyViolations("A new call has begun somewhere ahead.", request).includes("invents_new_call"));
  assert.deepEqual(fieldReplyViolations("That's brilliant. The whole is answering us; the posts behind will take us back to the call.", request), []);
});

test("the guard rejects system vocabulary, analysis and a second introduction", () => {
  const request = byId("taken_up_early");
  assert.ok(fieldReplyViolations("Your reliability is dropping in this phase.", request).includes("system_vocabulary"));
  assert.ok(fieldReplyViolations("The walker is following, so I should encourage them.", request).includes("meta_or_analysis"));
  assert.ok(fieldReplyViolations("Hi there, I'm Ariadne.", request).includes("restarts_introduction"));
  assert.deepEqual(fieldReplyViolations("I'm Ariadne. You can hear that? This way.", byId("opening")), []);
});

test("the guard catches a line that repeats itself", () => {
  const request = byId("commitment_early");
  assert.ok(fieldReplyViolations("The posts ahead are louder; let’s try them before the stones.The posts ahead are louder; let’s try them before the stones.", request).includes("repeats_itself"));
  assert.deepEqual(fieldReplyViolations("The posts ahead are louder. Come on, come on.", request), []);
});

test("the guard caps length by occasion", () => {
  const long = Array(50).fill("word").join(" ");
  assert.ok(fieldReplyViolations(long, byId("taken_up_early")).includes("too_long"));
  assert.deepEqual(fieldReplyViolations(long, byId("reply_objection")), []);
});

test("regeneration directions name every violation they address", () => {
  const direction = regenerationDirection(["limits_help", "claims_audible_call", "invents_far_call", "stage_direction_leak", "list_formatting"]);
  assert.match(direction, /placed a limit on your help/);
  assert.match(direction, /no call is audible where you stand/);
  assert.match(direction, /given no far hearing/);
  assert.match(direction, /from the outside/);
  assert.match(direction, /used a list/);
  assert.match(direction, /REGENERATION/);
});

test("raw provider text is normalized to the spoken line", () => {
  assert.equal(normalizeFieldReply('```json\n{"message":"This way."}\n```'), "This way.");
  assert.equal(normalizeFieldReply("ARIADNE: Come on, the posts."), "Come on, the posts.");
  assert.equal(normalizeFieldReply("“It's louder along the stitches.”"), "It's louder along the stitches.");
  assert.equal(normalizeFieldReply("   "), null);
});

test("every occasion has a deterministic line that passes its own guard", () => {
  for (const scenario of SCENARIOS) {
    const line = fieldDeterministicLine(scenario.request);
    assert.ok(line.length > 0, scenario.id);
    assert.deepEqual(fieldReplyViolations(line, scenario.request), [], `${scenario.id}: ${line}`);
  }
});

test("every scenario produces a card that mentions its occasion move and phase", () => {
  for (const scenario of SCENARIOS) {
    const card = fieldStageCard(scenario.request);
    assert.match(card, /HOW YOU KEEP YOUR PLACE/);
    assert.ok(card.includes(FIELD_PHASE_DIRECTIONS[scenario.request.phase]), scenario.id);
    assert.doesNotMatch(card, /undefined|null\b/, scenario.id);
  }
});

test("the guard refuses lines that read the card back, reuse her last opening, or name the wrong structure", () => {
  const request = structuredClone(byId("commitment_early"));
  request.turn.walkerDid = "Arrived at a place where 3 ways meet, along the stitches.";
  request.turn.whatFollowed = "Your body went to the first marker of the posts ahead.";
  request.recentMessages = [{ role: "ariadne", text: "There you are. We've stood here before, and I know the way." }, { role: "ariadne", text: "There you are. We've stood here again; the posts, then." }];
  assert.ok(fieldReplyViolations("My body went to the first marker of the posts ahead, so come with me.", request).includes("echoes_card"), "seven consecutive words from the card is an echo");
  assert.ok(fieldReplyViolations("There you are. We've stood here before, and the posts carry it now.", request).includes("repeats_opening"), "the same four opening words as a recent line");
  assert.deepEqual(fieldReplyViolations("It's louder along the posts. Come on.", request), [], "a fresh line passes");
  request.near.structure = { visible: true, family: "bells", state: "dormant", elementsRemaining: 4, direction: "ahead" };
  request.turn.occasion = "structure_found";
  assert.ok(fieldReplyViolations("Come close enough to touch it; the glass is waiting for your hand.", request).includes("wrong_structure_family"), "glass named at a bells structure");
  assert.ok(!fieldReplyViolations("Come close enough to touch it; the bells are waiting for your hand.", request).includes("wrong_structure_family"));
  request.near.structure.family = "teaching";
  assert.ok(!fieldReplyViolations("Come a little closer to the low bell, then look at the page.", request).includes("wrong_structure_family"), "the teaching structure is bells and a page");
  const direction = regenerationDirection(["echoes_card", "repeats_opening", "wrong_structure_family"]);
  assert.match(direction, /own words/); assert.match(direction, /Begin differently/); assert.match(direction, /not the one in view/);
});

test("the card asks for a fresh opening and no echo, and the quiet arrival has its own deterministic line", () => {
  const request = structuredClone(byId("commitment_early"));
  request.recentMessages = [{ role: "ariadne", text: "The posts ahead carry it. Come on." }, { role: "walker", text: "ok" }, { role: "ariadne", text: "It's growing louder. Keep to the markers." }];
  const card = fieldStageCard(request);
  assert.match(card, /Your last lines began “The posts ahead carry”, “It's growing louder. Keep”; begin this one differently/);
  assert.match(card, /never repeat its sentences or phrasing/);
  request.turn.walkerDid = "Walked the stitches you chose to its end; nothing stands here and no call is audible from here. Arrived at a place where 3 ways meet.";
  assert.match(fieldDeterministicLine(request), /^Not here\. I can't hear it from this place; it's further on, along the posts\.$/, "a silent place is not an admission: she cannot know her way was wrong from here");
});

test("her light stays hers, an earlier sentence is not said again, and stopping is never argued against", () => {
  const request = structuredClone(byId("reply_stop"));
  assert.match(fieldSystemPrompt("you"), /The light is yours/);
  assert.ok(fieldReplyViolations("Your light is already on the posts; come on.", request).includes("misattributes_light"));
  assert.ok(!fieldReplyViolations("My light is already on the posts; come on.", request).includes("misattributes_light"));
  assert.ok(fieldReplyViolations("Stopping is yours, but stopping now would leave that clearing unmade. One more step together.", request).includes("argues_against_stopping"));
  assert.deepEqual(fieldReplyViolations("It's yours to decide, and I won't argue. The next one is close, along the posts.", request).filter(v => v !== "names_walker"), []);
  request.recentMessages = [{ role: "ariadne", text: "It cleared. There are more of them. Each one clears a little; enough of them and we'll see the whole of it." }];
  assert.ok(fieldReplyViolations("Look at that. Each one clears a little; enough of them and we'll see the whole of it.", { ...request, turn: { ...request.turn, occasion: "awakening_relevant" } }).includes("repeats_earlier"), "a whole sentence said before is refused");
  assert.ok(!fieldReplyViolations("Each one clears a little more of the fog, and my light is already on the posts.", { ...request, turn: { ...request.turn, occasion: "awakening_relevant" } }).includes("repeats_earlier"), "her idiom may recur");
  assert.match(fieldDeterministicLine({ ...request, walkerMessage: "is there actually a way out of this?" }), /never seen it/);
  assert.match(fieldDeterministicLine({ ...request, walkerMessage: "I want to stop." }), /yours to decide/);
  const card = fieldProviderMessages({ ...request, walkerMessage: "is there actually a way out of this?", turn: { ...request.turn, occasion: "reply" } }).at(-1).content;
  assert.match(card, /They are asking whether there is a way out/);
  assert.match(fieldProviderMessages(request).at(-1).content, /They are speaking of stopping/);
});
