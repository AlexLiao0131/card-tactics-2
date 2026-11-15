import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

// Load the actual shipped browser controller. No parallel/stand-in AI engine.
const file=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../js/tactical-enemy-controller.js');
const source=fs.readFileSync(file,'utf8');

function harness({scenario='NORMAL',neutralActor=false,gemini=false,autonomousAttack=false}={}){
  let seq=0,finished=0,attackCount=0,decisionCount=0;
  const timers=new Map(),events=[],decisionResolvers=[];
  const enemy1={id:'e1',team:neutralActor?'N':'E',alive:true,acted:false,moved:false,waited:false,x:0,y:0,hp:5,character:{name:'Enemy 1',skills:[]}};
  const enemy2={id:'e2',team:'E',alive:true,acted:false,moved:false,waited:false,x:0,y:1,hp:5,character:{name:'Enemy 2',skills:[]}};
  const player={id:'p1',team:'P',alive:true,acted:false,moved:false,x:7,y:7,hp:5,character:{name:'Player',skills:[]}};
  const npc={id:'n1',team:'N',alive:autonomousAttack,acted:false,moved:false,x:2,y:2,hp:5,character:{name:'Neutral',skills:[]}};
  const world={map:{width:8,height:8,tiles:[]},units:[enemy1,enemy2,player,...(autonomousAttack?[npc]:[])],stage:{ruleset:'VERSUS'},round:4,phase:'P',matchResult:null,enemyCardState:null,environmentState:{}};
  const skills=[{id:'basic_attack',name:'Attack',target:'ENEMY',targetType:'SINGLE',weapon:'sword',range:{min:1,max:3}}];
  const tactical={
    tile:(_map,x,y)=>({x,y,terrain:'PLAIN',elevation:0}),
    pathTo:(_map,_units,actor,x,y)=>[{x,y}],
    reachable:(_map,_units,actor)=>new Map([['1,0',1]]),
    actorCanTrackTarget:()=>true,
    canTarget:(_map,actor,target)=>autonomousAttack&&actor.id==='e1'&&target.id==='n1'
  };
  const browser={EncounterEngine:{TEAM_NEUTRAL:'N'}};
  const sandbox={window:browser,globalThis:{CardTacticsDiagnostics:{isEnabled:()=>false}},performance:{now:()=>0},
    TacticalEngine:tactical,DeploymentEngine:{points:()=>[]},
    BattleResolution:{resolve:({initiator,target})=>{attackCount++;events.push('ATTACK:'+initiator.id);target.alive=false;target.hp=0;return{};}},
    setTimeout:fn=>{const id=++seq;timers.set(id,fn);return id;},
    clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(source,sandbox,{filename:'js/tactical-enemy-controller.js'});
  const ctx={
    TEAM:{ENEMY:'E',PLAYER:'P'},PHASE:{ENEMY:'E'},
    state:()=>world,map:()=>world.map,actionState:()=>({environmentState:world.environmentState}),
    geminiEnabled:()=>gemini,geminiDecide:()=>{decisionCount++;return new Promise(resolve=>decisionResolvers.push(resolve));},
    combatTargets:a=>autonomousAttack&&a.id==='e1'?[npc]:[],
    skillList:a=>autonomousAttack&&a.id==='e1'?skills:[],
    targetType:()=> 'SINGLE',canUseSkill:()=>true,canUnitCapture:()=>false,
    turnActors:team=>world.units.filter(a=>a.team===team&&a.alive),
    living:team=>world.units.filter(a=>a.team===team&&a.alive),
    resetActions:()=>{},setPhase:phase=>{world.phase=phase;},
    clearSelection:()=>{},clearEnemyReaction:()=>{},
    pushLog:()=>{},setEnemyView:view=>events.push(view.kind+':'+(view.unitId||'')),
    render:()=>{},emitState:()=>{},checkMatchEnd:()=>false,pendingEnemyAttack:()=>null,
    beginPlayerTurn:()=>{finished++;world.phase='P';events.push('FINISH');},
    coreForOwner:()=>null,
    traverseUnitPath:(actor,[dest])=>{
      events.push('MOVE:'+actor.id);actor.x=dest.x;actor.y=dest.y;
      if(actor===enemy1&&scenario==='ACTOR_DIES'){actor.hp=0;actor.alive=false;events.push('DEFEATED:'+actor.id);}
      if(actor===enemy1&&scenario==='OTHER_DIES'){player.hp=0;player.alive=false;events.push('DEFEATED:'+player.id);}
      return{completed:true};
    }
  };
  const controller=browser.TacticalEnemyController.create(ctx);
  async function advance(){
    const next=timers.entries().next();if(next.done)return false;
    const [id,fn]=next.value;timers.delete(id);fn();
    for(let i=0;i<8;i++)await Promise.resolve();
    return true;
  }
  async function drain(){
    for(let i=0;i<250;i++){
      if(!await advance())break;
    }
    return {finished,phase:world.phase,events:[...events],timers:timers.size,attackCount,decisionCount};
  }
  return {controller,advance,drain,enemy1,enemy2,player,npc,world,events,
    resolveDecision:(id='g0')=>{const fn=decisionResolvers.shift();assert.ok(fn,'no pending Gemini response');fn(id);},
    countTimers:()=>timers.size,pendingDecisions:()=>decisionResolvers.length,finished:()=>finished};
}

test('control: ordinary enemy movement still completes the turn',async()=>{
  const h=harness();h.controller.runPhase();const r=await h.drain();
  assert.equal(r.finished,1);assert.equal(r.phase,'P');
  assert.ok(r.events.includes('MOVE:e1'));assert.ok(r.events.includes('MOVE:e2'));
});

test('enemy killed by terrain while moving skips only that actor',async()=>{
  const h=harness({scenario:'ACTOR_DIES'});h.controller.runPhase();const r=await h.drain();
  assert.equal(h.enemy1.alive,false);assert.equal(r.finished,1);assert.equal(r.phase,'P');
  assert.ok(r.events.includes('MOVE:e2'),'the following enemy must still act');
  assert.equal(r.timers,0);
});

test('death of a different participant does not skip the active enemy',async()=>{
  const h=harness({scenario:'OTHER_DIES'});h.controller.runPhase();const r=await h.drain();
  assert.equal(h.player.alive,false);assert.equal(r.finished,1);assert.equal(r.phase,'P');
  assert.ok(r.events.includes('THINK:e2'));
});

test('enemy defeated while the THINK callback is pending cannot strand turn',async()=>{
  const h=harness();h.controller.runPhase();await h.advance();
  h.enemy1.alive=false;h.enemy1.hp=0;const r=await h.drain();
  assert.equal(r.finished,1);assert.ok(r.events.includes('MOVE:e2'));
});

test('neutral actor defeated by terrain also cannot strand enemy turn',async()=>{
  const h=harness({neutralActor:true,scenario:'ACTOR_DIES'});h.controller.runPhase();const r=await h.drain();
  assert.equal(r.finished,1);assert.equal(r.phase,'P');
  assert.ok(r.events.includes('DEFEATED:e1'));
});

test('an autonomous attack may defeat its target and the next enemy still acts',async()=>{
  const h=harness({autonomousAttack:true});h.controller.runPhase();const r=await h.drain();
  assert.equal(r.attackCount,1);assert.equal(h.npc.alive,false);assert.equal(r.finished,1);
  assert.ok(r.events.includes('MOVE:e2'));
});

test('autonomous attacker defeated while its attack is queued cannot strand turn',async()=>{
  const h=harness({autonomousAttack:true});h.controller.runPhase();
  await h.advance(); // first AI THINK
  await h.advance(); // choose attack, schedule presentation delay
  h.enemy1.alive=false;h.enemy1.hp=0;
  const r=await h.drain();
  assert.equal(r.attackCount,0);assert.equal(r.finished,1);
  assert.ok(r.events.includes('MOVE:e2'));
});

test('autonomous target defeated during attack delay gets skipped cleanly',async()=>{
  const h=harness({autonomousAttack:true});h.controller.runPhase();
  await h.advance();await h.advance();
  h.npc.alive=false;h.npc.hp=0;
  const r=await h.drain();
  assert.equal(r.attackCount,0);assert.equal(r.finished,1);
  assert.ok(r.events.includes('MOVE:e2'));
});

test('Gemini decision returning after actor death skips actor and continues',async()=>{
  const h=harness({gemini:true});h.controller.runPhase();
  await h.advance(); // first THINK
  await h.advance(); // promise awaits Gemini
  h.enemy1.alive=false;h.enemy1.hp=0;
  h.resolveDecision();await Promise.resolve();
  // e2 now also requests a Gemini decision; choose its official WAIT action.
  for(let i=0;i<10&&!h.pendingDecisions();i++){
    await h.advance();
  }
  assert.equal(h.pendingDecisions(),1,'second enemy should request its own decision');
  h.resolveDecision('g1');
  for(let i=0;i<10;i++)await Promise.resolve();
  const r=await h.drain();
  assert.equal(r.finished,1);assert.equal(r.phase,'P');
  assert.ok(r.events.includes('THINK:e2'));
});

test('reset invalidates pending callbacks rather than resuming a dead battle',async()=>{
  const h=harness();h.controller.runPhase();await h.advance();
  h.controller.reset();h.enemy1.alive=false;const r=await h.drain();
  assert.equal(r.finished,0);assert.equal(r.timers,0);
});

test('Gemini post-movement response after a death still advances to next actor',async()=>{
  const h=harness({gemini:true});h.controller.runPhase();
  await h.advance();await h.advance(); // initial e1 Gemini request
  h.resolveDecision('g0'); // select e1 movement
  for(let i=0;i<10;i++)await Promise.resolve();
  for(let i=0;i<10&&!h.pendingDecisions();i++)await h.advance();
  assert.equal(h.pendingDecisions(),1,'post-move Gemini decision should be pending');
  h.enemy1.alive=false;h.enemy1.hp=0;
  h.resolveDecision('g0'); // stale post-move decision
  for(let i=0;i<10;i++)await Promise.resolve();
  for(let i=0;i<10&&!h.pendingDecisions();i++)await h.advance();
  assert.equal(h.pendingDecisions(),1,'e2 should get its own Gemini decision');
  h.resolveDecision('g1'); // e2 waits
  for(let i=0;i<10;i++)await Promise.resolve();
  const r=await h.drain();
  assert.equal(r.finished,1);assert.equal(r.phase,'P');
  assert.ok(r.events.includes('THINK:e2'));
});

test('already-defeated unit in the turn queue is skipped without stalling',async()=>{
  const h=harness();h.controller.runPhase();
  h.enemy1.alive=false;h.enemy1.hp=0;
  const r=await h.drain();
  assert.equal(r.finished,1);assert.equal(r.phase,'P');
  assert.ok(r.events.includes('MOVE:e2'));
});
