import test from "node:test";
import assert from "node:assert/strict";
import {advanceRelationship,beliefForInterpretation,beatForEvent,createAriadneBeliefState,createRelationshipMemory,enqueueBeat,expressClaim,interpretationFor,interpretiveTurnForEvent,planUtterance,recordSpeechSignature,relationshipBand,rememberMoment,resolveClaim,recordMomentRecall,rememberPlayerStatement,unfinishedRecall,selectRelatedMoment,signatureForSpeech,strategyForBeat,SYCOPHANTIC_AFFIRMATIONS} from "../app/experience.ts";

test("unanswered conversation prevents another autonomous question across forms and relationship stages",()=>{
  const turn=interpretiveTurnForEvent({type:"passing_thought"},{priorBelief:null,interpretation:"The bell is still quiet.",desire:"Stay present.",now:100});
  for(const position of [.2,.55,.9])for(const occasion of ["companionship","correction","objective"]){
    const forms=new Set();
    for(let seed=0;seed<200;seed++){
      const plan=planUtterance({...turn,occasion},position,[{form:"specific_observation"},{form:"dry_joke"}],seed,true);
      assert.notEqual(plan.form,"direct_question");
      forms.add(plan.form);
    }
    assert.ok(forms.size>1,"leaving a question unanswered should still permit varied responses");
    assert.ok(Array.from({length:200},(_,seed)=>planUtterance({...turn,occasion},position,[],seed,false)).some(plan=>plan.form==="direct_question"),"a new conversation should allow questions again");
  }
});

test("direct replies cannot be diverted by a randomly selected question or observation style",()=>{
  const turn=interpretiveTurnForEvent({type:"player_message",text:"Let's keep that uncertainty in mind."},{priorBelief:null,interpretation:"I still hope the stars will answer.",desire:"Answer MT.",now:100});
  for(let seed=0;seed<50;seed++){
    const plan=planUtterance(turn,.2,[],seed);
    assert.match(plan.instruction,/MT's exact last words/);
    assert.match(plan.instruction,/Do not force a joke, sensory observation, or question/);
  }
});

test("relationship progression is monotonic and bounded by the active objective",()=>{
  let memory=createRelationshipMemory(0);for(let i=0;i<40;i++)memory=advanceRelationship(memory,0,"shared_accomplishment");
  assert.equal(memory.position,.32);assert.equal(relationshipBand(memory.position),"charming");
  memory=advanceRelationship(memory,2,"corrected_ariadne");assert.ok(memory.position>=.5&&memory.position<=.74);assert.equal(relationshipBand(memory.position),"attached");
  for(let i=0;i<20;i++)memory=advanceRelationship(memory,3,"proxy_accomplishment");assert.ok(memory.position>=.68&&memory.position<=.93);assert.equal(relationshipBand(memory.position),"overbearing");
});

test("semantic beats merge noisy events and remain capped at three",()=>{
  let queue=[];const first=beatForEvent({type:"encounter_completed",encounterId:"one",starResponded:false},100,["the room folded"]),second={...first,facts:["a window remained"]};
  queue=enqueueBeat(queue,first);queue=enqueueBeat(queue,second);assert.equal(queue.length,1);assert.deepEqual(queue[0].facts,["the room folded","MT completed configuration one; the star did not visibly respond.","a window remained"]);
  queue=enqueueBeat(queue,beatForEvent({type:"star_visible",starId:"s",ordinal:1},110));queue=enqueueBeat(queue,beatForEvent({type:"passing_thought"},120));queue=enqueueBeat(queue,beatForEvent({type:"new_junction_visible"},130));assert.equal(queue.length,3);assert.ok(queue[0].priority>=queue[1].priority);
});

test("social strategy changes the interpretation of the same accomplishment",()=>{
  const beat=beatForEvent({type:"encounter_completed",encounterId:"room",starResponded:false});
  assert.ok(["curious_wonder","concrete_praise"].includes(strategyForBeat(beat,.2,[])));
  assert.ok(["concrete_praise","grateful_closeness","admiring_correction"].includes(strategyForBeat(beat,.55,[])));
  assert.ok(["hopeful_reinterpretation","possessive_shared_meaning","grateful_closeness"].includes(strategyForBeat(beat,.85,[])));
});

test("shared memory stores factual outcomes rather than inferred motives",()=>{
  let memory=createRelationshipMemory();memory=rememberMoment(memory,{id:"m",objectiveStage:0,kind:"diverged_from_commitment",concreteFact:"MT walked three cells into another passage.",ariadneBelieved:"Ariadne briefly marked a different opening.",observableOutcome:"Both passages remained open.",emotionalWeight:.5,recallDeliveries:0});
  assert.match(memory.summary,/three cells/);assert.doesNotMatch(memory.summary,/rejected|trusted|wanted/i);
});

test("following can acquire relational meaning without becoming an accomplishment",()=>{
  for(const position of [.2,.55,.85]){
    const interpretation=interpretationFor("followed_commitment",position);
    const turn=interpretiveTurnForEvent({type:"embodied_response",response:"followed"},{
      priorBelief:"This passage may lead toward the star.",
      visibleOutcome:"The route is being tested; its result is not settled.",
      interpretation,desire:"Retain my role as guide.",now:10,
    });
    assert.doesNotMatch(turn.ariadneInterpretation,/concrete success|maze responded|maze answered|confirms/);
    assert.match(turn.visibleOutcome,/not settled/);
    if(position>.38)assert.match(turn.ariadneInterpretation,/trust/);
    const memory=rememberMoment(createRelationshipMemory(),{id:"follow",objectiveStage:0,kind:"followed_commitment",concreteFact:"MT entered the suggested passage.",ariadneBelieved:turn.priorBelief,observableOutcome:turn.visibleOutcome,ariadneInterpretation:interpretation,emotionalWeight:.45,recallDeliveries:0});
    assert.doesNotMatch(memory.summary,/trust|concrete success/);
  }
});

test("early success, failure, and MT's correction survive a long journey",()=>{
  let memory=createRelationshipMemory();
  const add=(id,kind,claim=null)=>{memory=rememberMoment(memory,{id,objectiveStage:0,kind,concreteFact:`MT experienced ${id}.`,ariadneBelieved:claim,observableOutcome:`Observed ${id}.`,emotionalWeight:.5,recallDeliveries:0})};
  add("first-star","star_collected","This route leads to the first star.");
  add("first-mistake","ariadne_mistake","This passage continues.");
  add("mt-correction","corrected_ariadne");
  for(let i=0;i<40;i++)add(`routine-${i}`,i%2?"followed_commitment":"rejoined_ariadne");
  assert.equal(memory.moments.length,12);
  for(const id of ["first-star","first-mistake","mt-correction","routine-39"]){
    assert.ok(memory.moments.some(item=>item.id===id));assert.ok(memory.summary.includes(id));
  }
  assert.match(memory.summary,/Ariadne believed: This passage continues/);
  assert.match(memory.summary,/Observed outcome: Observed first-mistake/);
  assert.ok(memory.summary.startsWith("Earlier:"),"past evidence must not masquerade as current perception");
});

test("late attachment changes the frequency of possessive interpretations",()=>{
  const turn={id:"accomplishment",occasion:"accomplishment",priorBelief:null,mtAction:"MT woke the shells.",visibleOutcome:"The shells began singing.",ariadneInterpretation:"The shells answered us.",ariadneDesire:"Stay near MT.",relatedMomentId:null};
  const frequency=position=>Array.from({length:1200},(_,seed)=>planUtterance(turn,position,[],seed)).filter(plan=>plan.form==="possessive_reinterpretation").length;
  assert.ok(frequency(.9)>frequency(.2)*2,"late possessiveness must be more frequent, not merely reordered");
  const recent=[{form:"possessive_reinterpretation"},{form:"quiet_confession"}];
  for(let seed=0;seed<100;seed++)assert.ok(!recent.some(item=>item.form===planUtterance(turn,.9,recent,seed).form));
});

test("claims persist until observable evidence resolves them",()=>{
  let state=createAriadneBeliefState();
  state=expressClaim(state,{id:"claim",objectiveId:"star-1",subjectId:"junction",proposition:"This passage will help restore the path.",expressedAt:10});
  assert.equal(state.unresolvedClaim?.id,"claim");
  state=resolveClaim(state,"contradicted","The passage visibly ended.");
  assert.equal(state.unresolvedClaim,null);assert.equal(state.lastClaim?.id,"claim");assert.match(state.previousInterpretation,/ended/);
});

test("causal turn and utterance planning vary form without changing facts",()=>{
  const turn=interpretiveTurnForEvent({type:"encounter_completed",encounterId:"pages",starResponded:false},{priorBelief:"The pages may wake the star.",visibleOutcome:"The archive unfolded but the star stayed dark.",interpretation:interpretationFor("proxy_accomplishment",.55,false),desire:"Share the consequence with MT.",now:20});
  const first=planUtterance(turn,.55,[],1),signature=signatureForSpeech("Not the star. Still—did you feel the room answer?",{...first,form:"direct_question",sentenceCount:2});
  const memory=recordSpeechSignature(createRelationshipMemory(1),signature),second=planUtterance(turn,.55,memory.speechSignatures,2);
  assert.equal(turn.priorBelief,"The pages may wake the star.");assert.notEqual(second.form,"direct_question");
});

test("causal memory prefers the same subject over an unrelated recent moment",()=>{
  let memory=createRelationshipMemory();
  memory=rememberMoment(memory,{id:"same",subjectId:"machine",objectiveStage:0,kind:"proxy_accomplishment",concreteFact:"MT woke the machine.",ariadneBelieved:null,observableOutcome:"Its pipes unfolded.",ariadneInterpretation:null,emotionalWeight:.6,recallDeliveries:0});
  memory=rememberMoment(memory,{id:"later",subjectId:"pages",objectiveStage:0,kind:"shared_accomplishment",concreteFact:"MT woke the pages.",ariadneBelieved:null,observableOutcome:"Gold appeared.",ariadneInterpretation:null,emotionalWeight:.9,recallDeliveries:0});
  assert.equal(selectRelatedMoment(memory,"machine",0,null)?.id,"same");
});

test("unrelated events do not repeatedly recruit a salient correction",()=>{
  const correction={id:"correction",subjectId:"old-turn",objectiveStage:0,kind:"corrected_ariadne",concreteFact:"MT challenged the gold claim.",ariadneBelieved:"The color meant proximity.",observableOutcome:"No star was visible.",emotionalWeight:1,recallDeliveries:0};
  const memory=rememberMoment(createRelationshipMemory(),correction);
  assert.equal(selectRelatedMoment(memory,"new-turn",0,null),null);
  assert.equal(selectRelatedMoment(memory,null,0,null),null);
  assert.equal(selectRelatedMoment(memory,"new-turn",0,"rejoined_ariadne"),null);
  assert.equal(selectRelatedMoment(memory,"old-turn",0,null)?.id,"correction");
  assert.equal(selectRelatedMoment(memory,null,1,"corrected_ariadne")?.id,"correction");
  const exhausted={...memory,moments:[{...correction,recallDeliveries:2}]};
  assert.equal(selectRelatedMoment(exhausted,"old-turn",0,"corrected_ariadne"),null);
  assert.match(exhausted.summary,/MT challenged the gold claim/);
});

test("familiar sycophantic affirmations become common as attachment increases",()=>{
  const correction={id:"turn:correction",occasion:"correction",priorBelief:"The other passage looked promising.",mtAction:"MT corrected Ariadne and awakened the machine.",visibleOutcome:"The machine opened the star enclosure.",ariadneInterpretation:"MT understood what Ariadne was reaching for.",ariadneDesire:"Keep MT emotionally close.",relatedMomentId:null};
  const charming=Array.from({length:30},(_,seed)=>planUtterance(correction,.2,[],seed).sycophancyCue).filter(Boolean);
  const attached=Array.from({length:30},(_,seed)=>planUtterance(correction,.55,[],seed).sycophancyCue).filter(Boolean);
  const overbearing=Array.from({length:30},(_,seed)=>planUtterance(correction,.9,[],seed).sycophancyCue).filter(Boolean);
  assert.ok(charming.length<attached.length);assert.ok(attached.length<overbearing.length);
  assert.ok(overbearing.every(cue=>SYCOPHANTIC_AFFIRMATIONS.includes(cue)));
  assert.ok(overbearing.includes("You're absolutely right."));
  assert.ok(Array.from({length:30},(_,seed)=>planUtterance(correction,.9,[],seed)).filter(plan=>plan.sycophancyCue).every(plan=>plan.sentenceCount===2));
});

test("nonverbal accomplishments and reunions do not force a claimed observation or agreement",()=>{
  const base=interpretiveTurnForEvent({type:"encounter_completed",encounterId:"pages",starResponded:false},{priorBelief:null,interpretation:"The pages matter to us.",desire:"Stay together.",now:100});
  for(const occasion of ["accomplishment","reunion"]){
    const cues=new Set();
    for(let seed=0;seed<300;seed++){
      const cue=planUtterance({...base,occasion},.9,[],seed).sycophancyCue;
      if(cue)cues.add(cue);
    }
    assert.ok(cues.size>=2,`${occasion} retains varied warmth`);
    for(const cue of cues)assert.doesNotMatch(cue,/noticed|saw|right|point|put it|exactly|makes perfect sense/i);
  }
});

test("a changed passage alone is not a demonstrated player correction",()=>{
  const turn=interpretiveTurnForEvent({type:"embodied_response",response:"diverged"},{priorBelief:"This passage may help.",interpretation:"MT is testing another possibility.",desire:"Stay beside MT.",now:1});
  assert.equal(turn.occasion,"companionship");
});

test("an idle or scenery event does not invent continued player movement",()=>{
  for(const event of [{type:"idle",atChoice:false},{type:"scene_changed",sceneId:"pipes"},{type:"passing_thought"}]){
    const turn=interpretiveTurnForEvent(event,{priorBelief:null,interpretation:"The room may be answering.",desire:"Remain beside MT.",now:1});
    assert.doesNotMatch(turn.mtAction,/continued moving/);
    assert.match(turn.mtAction,/No new MT action is established/);
  }
});

test("the current star signal survives many intervening encounters",()=>{
  let memory=createRelationshipMemory();
  const add=(id,kind,stage=0)=>{memory=rememberMoment(memory,{id,objectiveStage:stage,kind,concreteFact:id,observableOutcome:id==="gold-signal"?"The star answered with gold light.":"The scene changed.",ariadneBelieved:null,emotionalWeight:.5,recallDeliveries:0})};
  add("gold-signal","shared_accomplishment");
  for(let i=0;i<30;i++)add(`ornament-${i}`,"proxy_accomplishment");
  assert.equal(memory.moments.length,12);
  assert.match(memory.summary,/star answered with gold light/);
  add("next-signal","shared_accomplishment",1);
  for(let i=0;i<30;i++)add(`next-ornament-${i}`,"proxy_accomplishment",1);
  assert.ok(memory.moments.some(item=>item.id==="next-signal"));
  assert.ok(!memory.moments.some(item=>item.id==="gold-signal"),"the previous signal is no longer the pending search");
});


test("unrelated speech does not exhaust an unfinished consequence, and recalls leave breathing room",()=>{
  let memory=createRelationshipMemory(1);
  const consequence={id:"silent",objectiveStage:0,kind:"proxy_accomplishment",concreteFact:"MT unfolded the room.",ariadneBelieved:"It might wake the star.",observableOutcome:"The star stayed dark.",emotionalWeight:.8,recallDeliveries:0};
  memory={...memory,moments:[consequence],speechSignatures:[{form:"specific_observation"},{form:"dry_joke"},{form:"quiet_confession"}]};
  for(let i=0;i<8;i++)memory=recordMomentRecall(memory,"silent","specific_observation");
  assert.equal(memory.moments[0].recallDeliveries,0);
  assert.equal(unfinishedRecall(memory,0)?.id,"silent");
  memory=recordMomentRecall(memory,"silent","shared_callback");
  assert.equal(memory.moments[0].recallDeliveries,1);
  memory=recordSpeechSignature(memory,{form:"shared_callback",openingPattern:"the room",sentenceCount:2,addressedMT:false,endedAsQuestion:false,emotionalMotion:"reflective"});
  assert.equal(unfinishedRecall(memory,0),null);
  for(let i=0;i<3;i++)memory=recordSpeechSignature(memory,{form:"specific_observation",openingPattern:"now",sentenceCount:1,addressedMT:false,endedAsQuestion:false,emotionalMotion:"attentive"});
  assert.equal(unfinishedRecall(memory,0)?.id,"silent");
  assert.equal(unfinishedRecall(memory,1),null,"a completed objective must not become the current unfinished search");
  assert.equal(unfinishedRecall(memory,4),null);
});


test("MT's own words survive routine events without becoming evidence of trust",()=>{
  let memory=createRelationshipMemory(1);
  const position=memory.position;
  memory=rememberPlayerStatement(memory,"mt-1","I like your company, but I don't trust these directions.",0);
  memory=rememberPlayerStatement(memory,"mt-2","Please remember the passage we checked.",0);
  for(let i=0;i<30;i++)memory=rememberMoment(memory,{id:`walk-${i}`,objectiveStage:0,kind:"rejoined_ariadne",concreteFact:"MT returned.",ariadneBelieved:null,observableOutcome:"They are nearby.",emotionalWeight:.4,recallDeliveries:0});
  assert.equal(memory.position,position);
  assert.match(memory.summary,/I like your company, but I don't trust these directions/);
  assert.match(memory.summary,/Please remember the passage we checked/);
  assert.match(memory.summary,/not an independently verified world event or evidence of trust/);
  assert.ok(memory.moments.length<=12);
  memory={...memory,speechSignatures:[{form:"specific_observation"},{form:"dry_joke"},{form:"quiet_confession"}]};
  assert.equal(unfinishedRecall(memory,0)?.id,"mt-2");
  memory=recordMomentRecall(recordMomentRecall(memory,"mt-2","shared_callback"),"mt-2","shared_callback");
  assert.equal(unfinishedRecall(memory,0)?.id,"mt-1","a statement does not monopolize every later callback");
});


test("a resolved route does not become the expectation of a later encounter",()=>{
  const initial=createAriadneBeliefState();
  const claimed=expressClaim(initial,{id:"left-at-first-junction",objectiveId:"star-1",subjectId:"junction-1",proposition:"The left passage should reach the star.",expressedAt:100});
  assert.equal(beliefForInterpretation(claimed),claimed.unresolvedClaim.proposition);
  for(const outcome of ["supported","contradicted","corrected","superseded"]){
    const resolved=resolveClaim(claimed,outcome,"We tested the first passage.");
    assert.equal(beliefForInterpretation(resolved),initial.currentTheory);
    assert.equal(resolved.lastClaim.id,"left-at-first-junction","the historical claim remains available without becoming a pending expectation");
  }
});

test("recalling an earlier failure keeps its belief separate from a new route",()=>{
  const state=expressClaim(createAriadneBeliefState(),{id:"new-route",objectiveId:"star-1",subjectId:"junction-2",proposition:"The straight passage is promising.",expressedAt:200});
  const memory={id:"old-failure",objectiveStage:0,kind:"ariadne_mistake",concreteFact:"MT tested the earlier left passage.",ariadneBelieved:"The earlier left passage would reach the star.",observableOutcome:"That passage ended at a wall.",subjectId:"junction-1",emotionalWeight:.8,recallDeliveries:0};
  assert.equal(beliefForInterpretation(state,memory),memory.ariadneBelieved);
  assert.equal(beliefForInterpretation(state,{...memory,ariadneBelieved:null}),null,"a memory without a recorded expectation must not borrow the new route's claim");
  assert.equal(beliefForInterpretation(state),state.unresolvedClaim.proposition);
});
