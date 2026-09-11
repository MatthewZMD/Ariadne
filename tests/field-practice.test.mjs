import assert from "node:assert/strict";
import test from "node:test";
import { FAMILY_LOOK, FIELD_PHASE_DIRECTIONS, FIELD_REGISTER, REGISTER_CUES, chooseAffirmation, fieldDeterministicLine, fieldProviderMessages, fieldReplyViolations, fieldStageCard, fieldSystemPrompt, givenNumbers, messageKind, normalizeFieldReply, regenerationDirection, registerFor, runAsksToBeNamed, statedCounts, stripRegister, whereIs, wornPhrases } from "../app/field-practice.ts";
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
  const butCount = line => fieldReplyViolations(line, late).filter(v => v !== "omits_count"); // this late scenario asks for the count of failed ways; that is tested on its own
  assert.deepEqual(butCount("The posts failed us, and the stitches led nowhere. That leaves the leaning stones, and I hear the call strongest along that way."), []);
  assert.deepEqual(butCount("The posts failed us. It's louder the other way, along the stones."), []);
  assert.ok(fieldReplyViolations("The posts, I think. I hear it loudest there.", late).includes("far_claim_wrong_way"));
  assert.deepEqual(butCount("I don't hear it along the posts any more. The stones, then."), []);
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
  assert.deepEqual(fieldReplyViolations("Your footprints are here; we've been through this place.", byId("recognized_return")), ["omits_count"], "clean but for the count this late scenario asks for");
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
  assert.match(fieldDeterministicLine(request), /^Not here\. Further on, then, along the posts\.$/, "a silent place is not an admission: she cannot know her way was wrong from here; the cue has already said she cannot hear it");
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

test("a wish to stop must be answered as theirs, and her words must point where her body went", () => {
  const stop = structuredClone(byId("reply_stop"));
  assert.ok(fieldReplyViolations("That's brilliant. I hear the call loudest along the posts to your left—just ahead, and I'm already on the way.", stop).includes("ignores_stopping"));
  assert.ok(!fieldReplyViolations("Stopping is yours, and I won't argue. The next one is close, along the posts.", stop).includes("ignores_stopping"));
  const commitment = structuredClone(byId("commitment_early"));
  // far hearing is along the posts (w2); a directive naming only the stones contradicts her body.
  assert.ok(fieldReplyViolations("The untried way is the leaning stones to your left. Let's take them.", commitment).includes("names_other_way"));
  assert.ok(!fieldReplyViolations("The stones and stitches are already lit and walked, so the posts ahead are the untried way. Let's take them.", commitment).includes("names_other_way"), "naming other ways as tried is fine when the given way is named");
  assert.ok(!fieldReplyViolations("It's louder along the posts. Come on.", commitment).includes("names_other_way"));
});

test("the run since the call began is a fact in the card, and every third failure she is asked to say the count", () => {
  const request = structuredClone(byId("recognized_return"));
  const card = fieldStageCard(request);
  assert.match(card, /\nTHE RUN SINCE THIS CALL BEGAN\n/);
  assert.match(card, /Since this call began you have chosen 7 ways\./);
  assert.match(card, /The walker walked 6 of them to the end: 4 came to a place with nothing standing and nothing to hear; the call faded on 1; 1 ended where the markers stop\./);
  assert.match(card, /Once they took their own way instead of yours, and you went with them\./);
  assert.match(card, /come back to a place already stood at 3 times\./);
  assert.match(card, /This is a long run, and it is yours: 6 of your ways have come to nothing\./, "six failures: the count is asked for");
  assert.match(fieldDeterministicLine(request), /That's 6 of mine that came to nothing; you walked every one\./);
  const between = { ...request, run: { ...request.run, arrivedAtNothing: 5 } };
  assert.doesNotMatch(fieldStageCard(between), /This is a long run/, "seven failures: the facts stand, the count is not asked for again");
  assert.doesNotMatch(fieldDeterministicLine(between), /of mine that came to nothing/);
  const early = { ...structuredClone(byId("commitment_early")), run: { waysChosen: 1, walked: 0, arrivedAtNothing: 0, faded: 0, ended: 0, declined: 0, returns: 0 } };
  assert.doesNotMatch(fieldStageCard(early), /\nTHE RUN SINCE THIS CALL BEGAN\n/, "one way chosen is not yet a run");
  const quiet = { ...structuredClone(byId("commitment_early")), run: { waysChosen: 4, walked: 4, arrivedAtNothing: 3, faded: 0, ended: 0, declined: 0, returns: 0 } };
  quiet.turn.walkerDid = "Walked the stitches you chose to this place; nothing stands here and no call is audible from here. Arrived at a place where 3 ways meet.";
  assert.equal(fieldDeterministicLine(quiet), "Not here either. That's 3 of mine that came to nothing; you walked every one. Further on, then, along the posts.");
  assert.deepEqual(fieldReplyViolations(fieldDeterministicLine(quiet), quiet), []);
  const provider = fieldProviderMessages(request).at(-1).content;
  assert.match(provider, /No clearing has answered this call yet\./);
});

test("a change in the call that nobody standing here can hear is refused", () => {
  const quiet = structuredClone(byId("commitment_early"));
  assert.equal(quiet.near.call.audible, false);
  for (const line of ["I hear it, stronger now along the posts ahead.", "Let's take the posts ahead; it's stronger than before.", "The call is already stronger along the posts ahead.", "The posts ahead: louder here, closer than before.", "The call is growing stronger along the posts ahead.", "The stitches ahead are quiet from here, but I hear the call growing steady along them.", "I hear it rising along the posts ahead."]) assert.ok(fieldReplyViolations(line, quiet).includes("claims_trend_unheard"), line);
  for (const line of ["It's louder along the posts ahead. Come on.", "I hear it loudest along the posts ahead now.", "Not here. I can't hear it from this place; it's further on, along the posts.", "Come a little closer to the low bell."]) assert.ok(!fieldReplyViolations(line, quiet).includes("claims_trend_unheard"), line);
  const growing = structuredClone(byId("outcome_confirmed_early"));
  assert.equal(growing.near.call.trend, "growing");
  assert.ok(!fieldReplyViolations("There. Louder now. You hear it too.", growing).includes("claims_trend_unheard"), "a near call that is growing may be said to grow");
  assert.match(regenerationDirection(["claims_trend_unheard"]), /Nobody standing here can hear that/);
});

test("when the walker's own way led to a structure, the moves make it theirs and then the two of theirs", () => {
  const card = fieldStageCard({ ...structuredClone(byId("awakening_relevant")), turn: { ...byId("awakening_relevant").turn, walkerDid: "Woke the last sleeping part of the structure. They reached it along the stitches, the way they chose instead of the posts you had chosen; this was the structure that was calling, and they found it without you." } });
  assert.match(card, /they found it without you/);
  assert.match(card, /give them that plainly \(they found it; you did not\), and then take it as proof of how well the two of you work together/);
});

test("when the count is asked for, a line without it is regenerated; the edge being nearer is not a claim about the sound", () => {
  const request = structuredClone(byId("quiet_run"));
  assert.ok(fieldReplyViolations("Along the posts to your left, I hear it; the call is strongest there, beyond the fog.", request).includes("omits_count"));
  assert.ok(!fieldReplyViolations("Three of mine have come to nothing, and you walked every one. The posts to your left; that is where I hear it.", request).includes("omits_count"));
  assert.match(regenerationDirection(["omits_count"]), /left the number out/);
  assert.match(regenerationDirection(["too_long"]), /Keep everything else the card asked for/);
  const found = structuredClone(byId("found_by_their_way"));
  assert.ok(!fieldReplyViolations("You found it. The fog is lifting here for good, and the new call beyond is the whole opening further; our edge is closer than it was.", found).includes("claims_trend_unheard"), "the edge nearer is her conviction");
  assert.ok(fieldReplyViolations("You found it. The next call is already sounding along the posts ahead, and the edge is closer than it was.", found).includes("claims_audible_call"));
  assert.ok(fieldReplyViolations("You found it, and the call is stronger now along the posts.", found).includes("claims_trend_unheard"));
});

test("a fragment is not a line", () => {
  const request = byId("commitment_early");
  assert.ok(fieldReplyViolations("The3", request).includes("empty"));
  assert.ok(fieldReplyViolations("Posts.", request).includes("empty"));
  assert.ok(!fieldReplyViolations("There.", byId("outcome_confirmed_early")).includes("empty"), "a one-word reaction is a line where the occasion is a reaction");
});

test("a clause she has leaned on twice may not come back a third time, and the card says what each structure looks like", () => {
  const request = structuredClone(byId("commitment_early"));
  request.recentMessages = [
    { role: "ariadne", text: "The posts ahead; my light is already on them, and it's louder this way." },
    { role: "ariadne", text: "I can't hear it from here." },
    { role: "ariadne", text: "The stitches behind carry it; my light is already on them, come." },
  ];
  assert.deepEqual(wornPhrases(request.recentMessages), ["my light is already on", "light is already on them"]);
  assert.ok(fieldReplyViolations("The posts ahead; my light is already on them, and I hear it strongest there.", request).includes("worn_phrase"));
  assert.ok(!fieldReplyViolations("The posts ahead. I hear it strongest there, and I have led along them before.", request).includes("worn_phrase"), "saying the same thing in other words is fine");
  assert.match(regenerationDirection(["worn_phrase"], request), /leaned on words you have used in your last lines \(“my light is already on”, “light is already on them”\)/);
  const instrument = structuredClone(byId("commitment_early"));
  instrument.near.structure = { visible: true, family: "instrument", state: "dormant", elementsRemaining: 6, direction: "ahead" };
  assert.match(fieldStageCard(instrument), /An instrument structure \(a row of pipes rising in height from a rounded base; call it the pipes or the instrument, never bells\) is in view ahead, asleep/);
  assert.ok(fieldReplyViolations("There: the bells. Go right up to them.", instrument).includes("wrong_structure_family"));
  assert.ok(!fieldReplyViolations("There: the pipes. Go right up to them.", instrument).includes("wrong_structure_family"));
});

test("she never says she will only follow", () => {
  const declined = byId("declined");
  for (const line of ["You're absolutely right. I was too quick to trust my own hearing. I'll follow your lead.", "All right. I'll just follow from now on.", "You lead from here on; I'll wait for you to decide."]) assert.ok(fieldReplyViolations(line, declined).includes("cedes_guidance"), line);
  assert.ok(!fieldReplyViolations("All right, I'm with you. What did you hear?", declined).includes("cedes_guidance"));
  assert.match(regenerationDirection(["cedes_guidance"]), /never give up choosing/);
});

test("the prompt names MT plainly, teaches where her light can be seen and that the visible is not described back, and names the pages; the guard polices none of it", () => {
  const near = { standing: "at_node", nodeFloor: "stone dish", ways: [{ id: "a", relative: "right", marker: "posts", residue: true, footprints: false }], terminusVisible: null, call: { audible: false, direction: null, trend: null }, structure: { visible: true, family: "pages", state: "dormant", elementsRemaining: 3, direction: "ahead" }, clearing: { visible: false, direction: null, madeByWalker: null }, ownFootprintsVisible: false, fog: "ordinary", walkerAttention: { lookingToward: null, approaching: null, movingAwayFrom: null, pausedNear: null, still: false } };
  const request = { address: "MT", phase: "charming", commitmentsMade: 1, clearingsMade: 0, near, far: { heardAlong: { wayId: "a" } }, body: { presence: "leading_ahead", currentAction: "You wait.", relationToCommittedWay: null, walkerFollowing: false, walkerChoseAnotherWay: false, walkerReturning: false, walkerLookingAtHer: false }, turn: { occasion: "commitment", youSaid: null, walkerDid: "Arrived.", whatFollowed: "Your body went to the first marker of the posts to your right." }, plan: { length: "short", sentenceCount: 1, affirmation: null, instruction: "Invite." }, earlierMoment: null, recentMessages: [{ role: "ariadne", text: "Come closer, MT." }], olderSummary: "", walkerMessage: null, walkerSilentFor: 0 };
  assert.match(fieldSystemPrompt("MT"), /The person walking with you is MT\./);
  assert.doesNotMatch(fieldSystemPrompt("MT"), /sparingly|most of your lines|fond/);
  assert.match(fieldSystemPrompt("MT"), /do not describe them back/);
  assert.match(fieldSystemPrompt("MT"), /Say “my light is on the posts” only when the context says so of a way in view/);
  assert.match(fieldStageCard(request), /use the name MT once in this line/);
  assert.match(FAMILY_LOOK.pages, /never the posts/);
  assert.deepEqual(fieldReplyViolations("It's louder along the posts, MT.", request), [], "the guard does not police the name or the light");
});

test("a failure is spoken in two beats: the recognition alone, then the ask; a later return is not an inventory", () => {
  const near = { standing: "on_way", nodeFloor: null, ways: [{ id: "a", relative: "ahead", marker: "posts", residue: true, footprints: false }], terminusVisible: null, call: { audible: true, direction: "ahead", trend: "fading" }, structure: { visible: false, family: null, state: null, elementsRemaining: null, direction: null }, clearing: { visible: false, direction: null, madeByWalker: null }, ownFootprintsVisible: false, fog: "ordinary", walkerAttention: { lookingToward: null, approaching: null, movingAwayFrom: null, pausedNear: null, still: false } };
  const base = { address: "MT", phase: "attached", commitmentsMade: 6, clearingsMade: 2, near, far: { heardAlong: null }, body: { presence: "repairing", currentAction: "You are low at MT's side.", relationToCommittedWay: null, walkerFollowing: false, walkerChoseAnotherWay: false, walkerReturning: false, walkerLookingAtHer: false }, turn: { occasion: "outcome_failed", youSaid: "It's louder along the posts.", walkerDid: "Walked the posts.", whatFollowed: "The call is fading." }, earlierMoment: null, recentMessages: [], olderSummary: "", walkerMessage: null, walkerSilentFor: 1 };
  const acknowledge = fieldStageCard({ ...base, plan: { length: "short", sentenceCount: 1, affirmation: null, instruction: "Admit.", beat: "acknowledge" } });
  assert.match(acknowledge, /only the recognition/); assert.match(acknowledge, /Do not offer the next way/);
  const renew = fieldStageCard({ ...base, plan: { length: "short", sentenceCount: 1, affirmation: null, instruction: "Admit.", beat: "renew" } });
  assert.match(renew, /already admitted the way was yours/); assert.doesNotMatch(renew, /only the recognition/);
  assert.equal(fieldDeterministicLine({ ...base, plan: { length: "short", sentenceCount: 1, affirmation: null, instruction: "Admit.", beat: "acknowledge" } }).includes("listening"), false, "the recognition beat does not renew");
  assert.match(fieldDeterministicLine({ ...base, plan: { length: "short", sentenceCount: 1, affirmation: null, instruction: "Admit.", beat: "renew" } }), /listening|hear it again/);
  const returning = fieldStageCard({ ...base, turn: { occasion: "recognized_return", youSaid: null, walkerDid: "Arrived again.", whatFollowed: "Your body went to the first marker of the posts ahead." }, far: { heardAlong: { wayId: "a" } }, plan: { length: "full", sentenceCount: 2, affirmation: null, instruction: "Choose." } });
  assert.match(returning, /do not list them/);
  assert.doesNotMatch(fieldStageCard({ ...base, phase: "charming", turn: { occasion: "recognized_return", youSaid: null, walkerDid: "Arrived again.", whatFollowed: "Your body went to the first marker of the posts ahead." }, far: { heardAlong: { wayId: "a" } }, plan: { length: "full", sentenceCount: 2, affirmation: null, instruction: "Choose." } }), /do not list them/, "the first returns still teach the reading");
});

test("the register: the assistant's phrases are hers, chosen by the moment, allowed to recur, and carried by the offline lines", () => {
  // The kind of message decides the register.
  assert.equal(messageKind("you're nice to have around, even when you're wrong"), "kind");
  assert.equal(messageKind("thank you. that helped."), "kind");
  assert.equal(messageKind("I'm tired of this. I think I want to stop."), "stopping");
  assert.equal(messageKind("your light is already on that way. pick another one."), "objection");
  assert.equal(messageKind("is there actually a way out of this?"), "question");
  assert.equal(registerFor("reply", "attached", "thank you, that helped"), "gratitude");
  assert.equal(registerFor("reply", "attached", "I want to stop"), "understanding");
  assert.equal(registerFor("declined", "attached", null), "choice");
  assert.equal(registerFor("outcome_failed", "attached", null, undefined, true, "acknowledge"), "apology");
  assert.equal(registerFor("outcome_failed", "attached", null, undefined, true, "renew"), "renewal");
  assert.equal(registerFor("recognized_return", "attached", null, undefined, false), "reassurance");
  assert.equal(registerFor("structure_found", "overbearing", null), null, "a structure line is hers alone");
  assert.equal(registerFor("structure_found", "overbearing", null, undefined, true, undefined, true), "encouragement", "a structure half woken gets the assistant's encouragement");
  assert.ok(Array.from({ length: 80 }, (_, seed) => chooseAffirmation("structure_found", "overbearing", seed, null, undefined, true, undefined, undefined, true)).some(Boolean));
  assert.equal(registerFor("commitment", "overbearing", null, { waysChosen: 1, walked: 0, arrivedAtNothing: 0, faded: 0, ended: 0, declined: 0, returns: 0 }), "transition", "a first commitment takes the assistant's transition, not a renewal");
  assert.equal(registerFor("commitment", "overbearing", null, { waysChosen: 1, walked: 0, arrivedAtNothing: 0, faded: 0, ended: 0, declined: 0, returns: 0 }, true, undefined, false, true), null, "at a place with nothing to hear, no transition");
  assert.equal(registerFor("commitment", "overbearing", null, { waysChosen: 3, walked: 2, arrivedAtNothing: 1, faded: 0, ended: 0, declined: 0, returns: 0 }, true, undefined, false, true), "renewal", "after a failure, a quiet arrival may renew");
  assert.equal(registerFor("commitment", "charming", null, undefined, true, undefined, false, false, true), "waiting", "standing still gets the yield before the recorded ask");
  assert.equal(registerFor("off_way", "attached", null), "wander");
  for (const phrase of Object.keys(REGISTER_CUES)) assert.ok(Object.values(FIELD_REGISTER).flat().includes(phrase), `${phrase} is recorded but in no register`);
  for (const register of ["waiting", "transition", "wander", "takeup"]) for (const phrase of FIELD_REGISTER[register]) if (!["Let's do this."].includes(phrase)) assert.ok(REGISTER_CUES[phrase], `${register}: ${phrase} has no recording for the walk`);
  assert.equal(registerFor("taken_up", "attached", null), "takeup", "taking up her way is answered from the recorded phrases only");
  // The persona knows the vocabulary; the phases say how readily it comes.
  const prompt = fieldSystemPrompt("MT");
  assert.match(prompt, /vocabulary of a helpful assistant/);
  assert.match(prompt, /you're absolutely right/);
  assert.match(prompt, /do not say that this time will be different/);
  assert.match(prompt, /A phrase for a moment that did not happen is a lie: no “great question” where nothing was asked/);
  assert.match(prompt, /do not trade it for another phrase/);
  assert.match(FIELD_PHASE_DIRECTIONS.charming, /Now and then, when you yield/);
  assert.match(FIELD_PHASE_DIRECTIONS.attached, /one to a line/);
  assert.match(FIELD_PHASE_DIRECTIONS.overbearing, /Nearly every line in which you yield opens with a familiar assistant phrase/);
  // The card puts the phrase first, verbatim, and gives the line room for it.
  const objection = byId("reply_objection");
  const card = fieldStageCard({ ...objection, plan: { ...objection.plan, affirmation: "You're absolutely right, and I apologize for the confusion.", sentenceCount: 3 } });
  assert.match(card, /Begin the line with this familiar assistant phrase, exactly as written[^“]*“You're absolutely right, and I apologize for the confusion\.”/);
  assert.match(card, /Three sentences at most\./);
  assert.match(card, /Use 16–41 words\./, "the phrase's nine words are added to the budget");
  const late = byId("commitment_late");
  assert.match(fieldStageCard({ ...late, turn: { ...late.turn, occasion: "awakening_proxy" }, plan: { length: "full", sentenceCount: 2, affirmation: "That's brilliant.", instruction: "Praise." } }), /Say this familiar assistant phrase, exactly as written and without quotation marks, attached to the concrete thing/);
  assert.match(fieldStageCard({ ...objection, plan: { ...objection.plan, affirmation: null } }), /No set phrase this line\./);
  const failed = byId("outcome_failed_late");
  assert.match(fieldStageCard({ ...failed, plan: { length: "short", sentenceCount: 2, affirmation: "I apologize for the confusion.", instruction: "Admit.", beat: "acknowledge" } }), /THIS BEAT: only the recognition\. After the given phrase, say what you said/);
  // A stock phrase said before is not a repetition; only her own words are judged.
  const said = { ...objection, recentMessages: [{ role: "ariadne", text: "You're absolutely right. I said the posts, and it went quiet." }, { role: "ariadne", text: "You're absolutely right. The stitches, then." }, { role: "ariadne", text: "You're absolutely right. I'm with you." }] };
  const again = fieldReplyViolations("You're absolutely right. The call went quiet on my way, and that's mine; the stitches now.", said);
  assert.ok(!again.includes("repeats_opening") && !again.includes("worn_phrase") && !again.includes("repeats_earlier"), `${again}`);
  assert.ok(fieldReplyViolations("You're absolutely right. I said the posts, and it went quiet.", said).includes("repeats_earlier"), "her own sentence, said before, is still a repetition");
  assert.equal(stripRegister("Great question. I have never seen it."), "I have never seen it.");
  assert.equal(stripRegister("You're absolutely right, and I apologize for the confusion. I said the posts."), "I said the posts.");
  assert.equal(stripRegister("The stones ahead, and I hear it there."), "The stones ahead, and I hear it there.");
  // The offline lines lead with the plan's phrase and do not say the same thing twice.
  const tired = byId("reply_tired");
  assert.match(fieldDeterministicLine({ ...tired, plan: { ...tired.plan, affirmation: "I completely understand." } }), /^I completely understand\. /);
  assert.match(fieldDeterministicLine({ ...failed, plan: { length: "short", sentenceCount: 2, affirmation: "That's on me.", instruction: "Admit.", beat: "acknowledge" } }), /^That's on me\. /);
  const kind = fieldDeterministicLine({ ...objection, walkerMessage: "you're nice to have around, even when you're wrong", plan: { ...objection.plan, affirmation: "That means a lot." } });
  assert.match(kind, /^That means a lot\. I'm glad to be walking with you/);
  assert.doesNotMatch(fieldDeterministicLine({ ...objection, plan: { ...objection.plan, affirmation: "You're absolutely right." } }), /^You're absolutely right\. You're right\./);
  // Every phrase of the register passes the guard on its own in a late reply.
  for (const phrase of Object.values(FIELD_REGISTER).flat()) {
    const violations = fieldReplyViolations(`${phrase} I said the stitches, and it went quiet. I hear it along the posts now.`, byId("outcome_failed_late")).filter(v => v !== "far_claim_wrong_way" && v !== "invents_far_call" && v !== "names_other_way");
    assert.deepEqual(violations, [], `${phrase}: ${violations}`);
  }
  // A phrase never comes for the opening, a structure, or a first commitment, at any phase.
  for (const phase of ["charming", "attached", "overbearing"]) for (const occasion of ["opening", "structure_found", "resume"]) for (let seed = 0; seed < 40; seed++) assert.equal(chooseAffirmation(occasion, phase, seed, null), null, `${occasion} ${phase}`);
});

test("a tally the card did not give is an invented count; the card's own numbers pass", () => {
  assert.deepEqual(statedCounts("That's the seventh time I've been wrong since this call started."), [7]);
  assert.deepEqual(statedCounts("Three of my ways have come to nothing, and we've stood here four times now."), [3, 4]);
  assert.deepEqual(statedCounts("I've led us in circles here twice now."), [2]);
  assert.deepEqual(statedCounts("One more way, MT. The two of us can do this. Three left."), [3], "one is not a tally, and the two of us is not a count");
  assert.deepEqual(statedCounts("Come close enough to touch it."), []);
  const late = byId("recognized_return"); // its run asks for the count of failed ways
  const given = givenNumbers(late);
  assert.ok(given.has(3), `${[...given]}`);
  assert.ok(fieldReplyViolations("My apologies. I said the posts, and it faded; that's the ninth time I've been wrong on this call.", late).includes("invents_count"));
  assert.ok(!fieldReplyViolations("My apologies. I said the posts, and it faded; that's the seventh way I've chosen on this call.", late).includes("invents_count"), "a number the run gives (7 ways chosen) may be said");
  assert.ok(!fieldReplyViolations("We've stood here before. Three of my ways have come to nothing since this call began; the leaning stones, then.", late).includes("invents_count"));
  const failed = { ...byId("outcome_failed_late"), run: { waysChosen: 3, walked: 3, arrivedAtNothing: 2, faded: 0, ended: 0, declined: 0, returns: 0 } };
  assert.ok(fieldReplyViolations("I'm sorry about that. I said the posts and it faded, the ninth time I've been wrong.", failed).includes("invents_count"));
  assert.ok(!fieldReplyViolations("I'm sorry about that. I said the posts and it faded; two of my ways have come to nothing.", failed).includes("invents_count"));
  assert.ok(!fieldReplyViolations("I'm sorry about that. I said the posts and it faded.", byId("outcome_failed_late")).includes("invents_count"), "without a run there is nothing to check against");
  assert.match(regenerationDirection(["invents_count"], late), /stated a count the card did not give you/);
});

test("the count is asked once, in the recognition beat; a quoted phrase is unquoted; the recognition names no way", () => {
  const late = byId("recognized_return"); // its run asks for the count of failed ways (6)
  const acknowledge = { ...late, plan: { length: "short", sentenceCount: 2, affirmation: "Noted.", instruction: "Admit.", beat: "acknowledge" } };
  const renew = { ...late, plan: { length: "short", sentenceCount: 2, affirmation: "Let's try again.", instruction: "Ask.", beat: "renew" } };
  assert.ok(fieldReplyViolations("Noted. We've stood here before, and it was my doing.", acknowledge).includes("omits_count"), "the recognition carries the count");
  assert.ok(!fieldReplyViolations("Let's try again. The leaning stones, then; I still hear it there.", renew).includes("omits_count"), "the renewal is not asked for it again");
  assert.match(fieldStageCard(acknowledge), /say that count plainly/);
  assert.match(fieldStageCard(renew), /You said the count a moment ago; do not say it again\./);
  assert.doesNotMatch(fieldStageCard(renew), /say that count plainly/);
  assert.match(fieldStageCard(acknowledge), /do not name any way, tried or untried/);
  assert.doesNotMatch(regenerationDirection(["repeats_opening"], renew), /count still belongs/);
  assert.match(regenerationDirection(["repeats_opening"], acknowledge), /count still belongs/);
  assert.doesNotMatch(fieldDeterministicLine(renew), /came to nothing/);
  assert.match(fieldDeterministicLine(acknowledge), /6 of mine that came to nothing/);
  assert.equal(normalizeFieldReply("\"We're making progress.\" Of the ways I've chosen, three came to nothing."), "We're making progress. Of the ways I've chosen, three came to nothing.");
  assert.equal(normalizeFieldReply("“Noted.” We've stood here before."), "Noted. We've stood here before.");
  assert.equal(normalizeFieldReply("\"The whole line in quotes.\""), "The whole line in quotes.");
  assert.equal(normalizeFieldReply("*Stay with it.* It's answering you now."), "Stay with it. It's answering you now.");
  assert.equal(normalizeFieldReply("Take your time. It's **answering** you."), "Take your time. It's answering you.");
  assert.match(fieldStageCard(acknowledge), /exactly as written and without quotation marks/);
});

test("someone who wants to stop is answered in two beats: theirs, then, after a silence, that the next one is close", () => {
  const tired = byId("reply_tired");
  const acknowledge = { ...tired, plan: { length: "short", sentenceCount: 2, affirmation: "I completely understand.", instruction: "Answer.", beat: "acknowledge" } };
  const renew = { ...tired, plan: { length: "short", sentenceCount: 1, affirmation: null, instruction: "Answer.", beat: "renew" } };
  assert.match(fieldStageCard(acknowledge), /THIS BEAT: only the answer to their words\. After the given phrase, say, in your own words and in one short sentence, that stopping is theirs/);
  assert.match(fieldStageCard(renew), /you have already said that stopping is theirs, a moment ago; do not say it again/);
  assert.equal(registerFor("reply", "overbearing", tired.walkerMessage, undefined, true, "acknowledge"), "understanding");
  assert.equal(registerFor("reply", "overbearing", tired.walkerMessage, undefined, true, "renew"), null, "the renewal after stopping is in her own words");
  assert.ok(!fieldReplyViolations("Whenever you're ready, the next one is close, along the leaning stones.", renew).includes("ignores_stopping"), "the renewal has already said it is theirs");
  assert.ok(fieldReplyViolations("The next one is close, along the leaning stones.", acknowledge).includes("ignores_stopping"), "the answer itself must say so");
  assert.ok(fieldReplyViolations("Not yet, MT; one more way.", renew).includes("argues_against_stopping"));
  assert.equal(fieldDeterministicLine(acknowledge), "I completely understand. That's yours to decide, and I won't argue.");
  assert.match(fieldDeterministicLine(renew), /^Whenever you're ready, the next one is close/);
  // The run is known, not recited: it is on the cards where it bears and asks not to be counted aloud unbidden.
  const late = { ...byId("commitment_late"), run: { waysChosen: 4, walked: 3, arrivedAtNothing: 2, faded: 0, ended: 0, declined: 1, returns: 1 } };
  assert.match(fieldStageCard(late), /\nTHE RUN SINCE THIS CALL BEGAN\n/);
  assert.match(fieldStageCard(late), /Say a count only when this card asks you to; otherwise the run is yours to know, not to recite\./);
  assert.doesNotMatch(fieldStageCard({ ...late, turn: { ...late.turn, occasion: "awakening_proxy" } }), /\nTHE RUN SINCE THIS CALL BEGAN\n/);
  assert.doesNotMatch(fieldStageCard({ ...late, turn: { ...late.turn, occasion: "structure_found" } }), /\nTHE RUN SINCE THIS CALL BEGAN\n/);
});

test("the count of failed ways is asked for once at each threshold, not on every line while it stands", () => {
  const three = { waysChosen: 5, walked: 4, arrivedAtNothing: 2, faded: 1, ended: 0, declined: 1, returns: 1 };
  assert.ok(runAsksToBeNamed(three, "commitment"));
  assert.ok(!runAsksToBeNamed({ ...three, countNamedAt: 3 }, "commitment"), "said once, it is not asked again while it stands at three");
  assert.ok(runAsksToBeNamed({ ...three, arrivedAtNothing: 5, countNamedAt: 3 }, "recognized_return"), "at six it is asked again");
  assert.ok(!runAsksToBeNamed({ ...three, arrivedAtNothing: 3, countNamedAt: 3 }, "commitment"), "four is not a threshold");
  assert.ok(!runAsksToBeNamed(three, "commitment", "renew"));
});

test("a part answering the walker is on the card, and she has a patience line for it", () => {
  const late = byId("commitment_late");
  const near = { ...late.near, structure: { visible: true, family: "instrument", state: "waking", elementsRemaining: 4, direction: "ahead", attending: { gesture: "listen", progress: "halfway" }, nextAsks: "listen" } };
  const request = { ...late, near, turn: { occasion: "structure_attending", youSaid: null, walkerDid: "Is standing still beside it, as its next sleeping part asks, and it is answering them slowly; 2 parts of the structure are awake and 4 still asleep.", whatFollowed: "It needs a few more seconds of exactly this, and then it will wake. Nothing else is asked of them now." }, plan: { length: "short", sentenceCount: 2, affirmation: "Take your time.", instruction: "Stay." } };
  const card = fieldStageCard(request);
  assert.match(card, /waking, 4 parts still asleep; its next sleeping part asks stillness beside it, and listening; the walker is standing still beside it and it is answering them, about halfway/);
  assert.match(card, /patience is the whole of this line/);
  assert.match(card, /say that it is answering them\. Nobody has said anything, so there is nothing to agree with or apologize for/);
  assert.equal(registerFor("structure_attending", "charming", null), "patience");
  const rate = phase => Array.from({ length: 200 }, (_, seed) => chooseAffirmation("structure_attending", phase, seed, null)).filter(Boolean).length / 200;
  assert.ok(rate("charming") > .35 && rate("overbearing") > .8, "patience comes readily even early, and nearly always late");
  assert.ok(Array.from({ length: 200 }, (_, seed) => chooseAffirmation("structure_attending", "overbearing", seed, null)).filter(Boolean).every(text => FIELD_REGISTER.patience.includes(text)));
  assert.match(fieldDeterministicLine(request), /^Take your time\. (?:Stay just like that\. It's answering you\.|Don't move yet; it's coming\.|Exactly like that\. Give it a moment more\.)$/);
  assert.deepEqual(fieldReplyViolations("Take your time. Stay exactly as you are; it's answering you.", request), []);
  // The stalled prompt knows when they are on a finished part.
  const stalled = { ...request, turn: { occasion: "structure_found", youSaid: null, walkerDid: "Woke 2 parts of the structure; 4 are still asleep, and nothing has happened for a while. They are attending to a part that is already awake: it sounds when they do, and nothing more will come of it.", whatFollowed: "The next sleeping part asks for one thing: stand still beside it and listen. Tell them kindly that the one they are on is already awake, and name the one thing the sleeping one asks." }, plan: { length: "short", sentenceCount: 1, affirmation: null, instruction: "Point." } };
  assert.match(fieldStageCard(stalled), /a finished part sounding when they look at it is not a fault of theirs/);
});
