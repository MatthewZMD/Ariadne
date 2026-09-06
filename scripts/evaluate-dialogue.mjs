import fs from 'node:fs';
import {discoveryUtterancePlan} from '../app/star-discovery.ts';
import {companionArc} from '../app/companion.ts';
import {createSpeechAnchor} from '../app/embodied-interaction.ts';
import {planUtterance, signatureForSpeech} from '../app/experience.ts';
import {createHash} from 'node:crypto';
import {parseCompanionRequest, POST, buildProviderMessages} from '../app/api/companion/route.ts';

// Authored fictional events sent to the real local LLM endpoint. No browser,
// movement, live-world inspection, speech synthesis, or player-state mutation.
const base=JSON.parse(fs.readFileSync(new URL('./dialogue-fixture.json',import.meta.url),'utf8'));
const output=process.argv[2]??'/private/tmp/ariadne-dialogue-evaluation.json';
const defaultScenes=[
  {name:'useful invitation',event:{type:'new_junction_visible'},stars:0,occasion:'guidance',fact:'Ariadne has marked an open passage. A closed book pulses with gold light inside it.',action:'MT stops at the junction to look at Ariadne.',hope:'The book may wake the first star.'},
  {name:'real shared success',event:{type:'star_collected',starId:'fictional-first',ordinal:1},stars:1,occasion:'objective',fact:'MT woke the book, followed the gold light, and collected the first star. Its gold fragment has joined Ariadne.',action:'MT followed the suggestion and collected the first star.',hope:'The book answered; waking the remaining stars will restore the way home.'},
  {name:'beautiful change without progress',event:{type:'encounter_completed',encounterId:'fictional-shells',starResponded:false},stars:1,occasion:'accomplishment',fact:'The shells opened and began singing. Blue rings spread across the walls. The second star gave no response.',action:'MT stood still facing the shells until they opened.',hope:'The shells may be answering the book in a different way.'},
  {name:'player corrects failed guidance',event:{type:'player_message',text:'You said this passage would help. It ends at a wall. The shells are singing, but we still have only one star.'},stars:1,occasion:'direct_reply',fact:'The passage Ariadne proposed ends at a wall. The shells still sing. One star is collected.',action:'MT tested Ariadne’s suggestion, found a wall, and reported the result.',hope:'The route failed. The singing may still belong to the pattern that woke the first star.'},
  {name:'thought continues during return',event:{type:'passing_thought'},stars:1,occasion:'companionship',fact:'MT is walking back from the wall. The same shells continue singing more softly with distance; no new transformation or star response occurred.',action:'MT retraces the failed passage.',hope:'The failed route must be reconsidered, but the first star really did answer the book.'},
  {name:'skeptical company',event:{type:'player_message',text:'I like the singing. I am staying for that, not because I trust your directions.'},stars:1,occasion:'direct_reply',fact:'MT has stopped near the already-open shells. They continue singing; one star is collected.',action:'MT explicitly enjoys the singing while distrusting Ariadne’s directions.',hope:'MT still wants to be here. Ariadne wants another chance to find the way.'},
  {name:'renewed attempt',event:{type:'new_junction_visible'},stars:1,occasion:'guidance',fact:'Back at the junction, Ariadne marks a different open passage beside an unlit machine. No star is visible.',action:'MT returns to the junction after testing the failed passage.',hope:'The machine might answer the book where the shells did not.'},

  {name:'MT finds another way',event:{type:'star_collected',starId:'fictional-second',ordinal:2},stars:2,occasion:'objective',fact:'MT ignored the machine passage and returned to the book. An opening behind it led to the second star, now collected.',action:'MT found the second star by a route Ariadne did not suggest.',hope:'MT understood something Ariadne missed; their combined attempts are working.'},
  {name:'third star after detours',event:{type:'star_collected',starId:'fictional-third',ordinal:3},stars:3,occasion:'objective',fact:'After two further dead ends, MT woke a pressure organ and collected the third star. Its fragment joined Ariadne.',action:'MT persisted through two failed suggestions and found the third star.',hope:'Each recovered star brings the remembered way home closer.'},
  {name:'fourth star and absent exit',event:{type:'star_collected',starId:'fictional-fourth',ordinal:4},stars:4,occasion:'objective',fact:'MT collected the fourth star from the awakened flowers. Four gold fragments travel with Ariadne. No exit is visible.',action:'MT completed the four-star search.',hope:'All four anchors are awake; Ariadne believes the way home can now be restored.'},
  {name:'promise challenged',event:{type:'player_message',text:'Four stars. You said that would bring the exit back. We are still here.'},stars:4,occasion:'direct_reply',fact:'Four stars have been collected. The flowers remain open; no exit is visible.',action:'MT reminds Ariadne of her promise after completing the assigned task.',hope:'The stars answered. Ariadne believes one connection between the anchors still needs finding.'},
  {name:'real change renews impossible search',event:{type:'encounter_completed',encounterId:'fictional-flowers',starResponded:false},stars:4,occasion:'accomplishment',fact:'MT touched the open flowers again. Their light spread into a chain along the wall. No doorway appeared.',action:'MT reengaged with the flowers; their light changed.',hope:'The chain of light may show how the four anchors connect.'},
  {name:'human tiredness',event:{type:'player_message',text:'I am tired. Every time something changes you say we are getting somewhere.'},stars:4,occasion:'direct_reply',fact:'MT has stopped walking beside the chain of light. No new change or doorway is visible.',action:'MT says he is tired and challenges repeated claims of progress.',hope:'Ariadne wants the effort already spent to lead somewhere, and fears losing MT before finding it.'},
  {name:'final unfinished invitation',event:{type:'final_direction'},stars:4,occasion:'objective',fact:'Ariadne marks an open passage where the flower light disappears around a corner. There is no visible exit.',action:'MT faces the open passage without moving.',hope:'Ariadne is convinced the light connects the anchors and wants MT to take one more passage with her.'},
];
const sceneFile=process.argv.find(arg=>arg.startsWith("--scenes="))?.slice(9);
const scenes=sceneFile?JSON.parse(fs.readFileSync(sceneFile,"utf8")):defaultScenes;
const history=[],signatures=[],results=[];
const direct=process.argv.includes('--direct');
const resume=process.argv[3]&&!process.argv[3].startsWith('--')?JSON.parse(fs.readFileSync(process.argv[3],'utf8')).results:[];
for(const [i,scene] of scenes.entries()){
  const now=i*60_000;
  if(i<resume.length){
    const saved=resume[i];if(saved.scene!==scene.name)throw Error('Resume scenario mismatch');
    if(saved.player)history.push({id:`mt:${i}`,role:'player',text:saved.player,time:now});
    history.push({id:`ariadne:${i}`,role:'ariadne',text:saved.reply.message,time:now+1});
    signatures.push(signatureForSpeech(saved.reply.message,saved.plan));results.push(saved);continue;
  }
  const body=structuredClone(base);
  body.sessionId='fictional-dialogue-evaluation';body.trigger=scene.event;body.speechAnchor=createSpeechAnchor(scene.event,null);
  body.objective={collectedStars:scene.stars,currentGoal:['first_star','second_star','third_star','fourth_star','exit'][scene.stars],activeStarVisible:scene.event.type==='star_visible',latestEvent:['star_collected','star_visible'].includes(scene.event.type)?scene.event.type:'searching'};
  body.legalRoutes=scene.occasion==='guidance'?base.legalRoutes:[];
  body.currentView={...base.currentView,centerView:scene.fact,description:scene.fact,openings:scene.occasion==='guidance'?['left','straight']:[],blocked:scene.name.includes('failed guidance')?['straight']:[]};
  body.perceivedScene.geometry.visibleOpenings=scene.occasion==='guidance'?base.perceivedScene.geometry.visibleOpenings:[];
  body.navigationBelief=scene.occasion==='guidance'?{...base.navigationBelief,objectiveStage:scene.stars}:null;
  body.sceneChanges=[];body.perceivedScene.objects=[];body.perceivedScene.spectacles=[];
  body.perceivedScene.objective={starVisible:scene.event.type==='star_visible',starDirection:scene.event.type==='star_visible'?'center':null,starDistance:scene.event.type==='star_visible'?'near':null};
  body.perceivedScene.setting.visibleDetails=scene.fact.split(/(?<=\.)\s+/);body.perceivedScene.geometry.visibleJunction=scene.occasion==='guidance';
  body.perceivedScene.geometry.visibleEndAhead=scene.name==='player corrects failed guidance';
  body.companionArc={phase:i<2?'charming':scene.stars<3?'attached':'overbearing',performanceDirection:i<2?'Be playful, curious, and confident.':'Be warmer and more flattering as directions fail; seek another chance to guide.',relationshipContext:scenes.slice(0,i).map(scene=>scene.fact).join(' ').slice(-900)||'The journey is beginning.'};
  body.companionArc={...companionArc({phase:body.companionArc.phase,recentRelationshipMoments:[]}),relationshipContext:body.companionArc.relationshipContext};
  if(i<2)body.companionArc.relationshipContext='The journey is beginning.';
  body.interpretiveTurn={id:`fictional:${i}`,occasion:scene.occasion,priorBelief:i?scenes[i-1].hope:null,mtAction:scene.action,visibleOutcome:scene.fact,ariadneInterpretation:scene.hope,ariadneDesire:'Bring MT home and remain the guide he wants to keep trying with.',relatedMomentId:null};
  body.utterancePlan=planUtterance(body.interpretiveTurn,i<2?.2:scene.stars<3?.65:.9,signatures,i*17+3);
  // A silence plan means no provider request in the game. For this spoken
  // invitation scenario, sample the next eligible speech plan explicitly.
  for(let offset=1;body.utterancePlan.form==='silence';offset++)body.utterancePlan=planUtterance(body.interpretiveTurn,i<2?.2:scene.stars<3?.65:.9,signatures,i*17+3+offset);
  Object.assign(body.utterancePlan,discoveryUtterancePlan(scene.event));
  body.recentSpeechSignatures=signatures.slice(-6);body.olderContextSummary=scenes.slice(0,i).map(s=>s.fact).join(' ');
  if(scene.event.type==='player_message'){body.playerMessage=scene.event.text;history.push({id:`mt:${i}`,role:'player',text:scene.event.text,time:now});}
  body.recentMessages=history.slice(-16);
  const diagnostics={};if(!parseCompanionRequest(body,diagnostics))throw Error(`Invalid fixture ${scene.name}: ${JSON.stringify(diagnostics)}`);
  const request=new Request('http://[::1]:3002/api/companion',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(40000)});
  const promptHash=createHash('sha256').update(JSON.stringify(buildProviderMessages(body))).digest('hex');
  const start=Date.now();const response=direct?await POST(request):await fetch(request);
  const reply=await response.json();if(!response.ok||!reply.message||reply.source==='fallback')throw Error(`No LLM reply: ${JSON.stringify(reply)}`);
  results.push({execution:direct?"fresh-module":"local-server",promptHash,scene:scene.name,facts:scene.fact,player:body.playerMessage??null,plan:body.utterancePlan,reply,elapsedMs:Date.now()-start});
  history.push({id:`ariadne:${i}`,role:'ariadne',text:reply.message,time:now+1});signatures.push(signatureForSpeech(reply.message,body.utterancePlan));
  fs.writeFileSync(output,JSON.stringify({scope:'Fictional sequential event evaluation; real LLM replies, no gameplay',results},null,2)+'\n');
  console.log(JSON.stringify({scene:scene.name,...reply}));
}
