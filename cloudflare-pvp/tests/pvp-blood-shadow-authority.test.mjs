import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection,experimentalTacticalCore} from '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {SkillDatabase,SKILLS} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {createAuthoritySession,commitAuthorityCommand} from '../src/battle-authority.mjs';
import {PVP_COMMAND_PROTOCOL} from '../../shared/pvp-command-contract.mjs';

const deck=Array(20).fill('imperial_swordsman_card');
function setup(seed=87533,{seat=0,copyable=true}={}){
  let game=createOpeningGame({decks:[deck,deck],serverSeed:seed});
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
  beginCanonicalPlayerCardPhase(game);
  if(seat===0)resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
  else{
    resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
    resolveCanonicalPlayerCommand(game,{type:'END_TACTICAL_PHASE'},0);
    resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},1);
  }
  const map=game.battlefield.map;
  withCanonicalEngines(game,e=>{
    for(const [id,team,characterId] of [
      ['vampire',['P','E'][seat],'seraphina'],
      ['victim',['E','P'][seat],'imperial_swordsman']]){
      const unit=e.unitRuntime.create({id,team,characterId,x:1,y:1,map,cores:game.battlefield.cores});
      assert.ok(unit);delete unit._runtimeMap;
      unit.moved=false;unit.acted=false;unit.waited=false;
      if(id==='victim'&&!copyable)unit.character.skills=[];
      game.units.push(unit);
    }
  });
  const actor=game.units[0],victim=game.units[1],skill=SkillDatabase.get('seraphina_blood_drain');
  const controller=globalThis.TacticalActionController.create({actionState:()=>({map,units:game.units,
    environmentState:game.environmentState})});
  const landable=t=>globalThis.TERRAINS[t.terrain]?.passable&&
    !map.objects.some(o=>o.blocksMovement&&o.x===t.x&&o.y===t.y);
  let found=false;
  for(const targetTile of map.tiles){
    if(!landable(targetTile))continue;
    for(const [dx,dy,facing] of [[-1,0,'E'],[1,0,'W'],[0,-1,'S'],[0,1,'N']]){
      const back=TacticalEngine.tile(map,targetTile.x+dx,targetTile.y+dy);
      if(!back||!landable(back))continue;
      victim.x=targetTile.x;victim.y=targetTile.y;victim.facing=facing;
      for(const pos of map.tiles){
        if(!landable(pos)||pos.x===victim.x&&pos.y===victim.y||
          Math.abs(pos.x-back.x)+Math.abs(pos.y-back.y)>actor.character.combat.move)continue;
        actor.x=pos.x;actor.y=pos.y;
        if(controller.bloodShadowLanding(actor,victim)){
          actor.z=TacticalEngine.elevation(pos);victim.z=TacticalEngine.elevation(targetTile);
          found=true;break;
        }
      }
      if(found)break;
    }
    if(found)break;
  }
  assert.ok(found,'original controller finds a legal blood shadow rear landing');
  return {game,actor,victim};
}
function cast(game,seat=0){return resolveCanonicalPlayerCommand(game,{type:'CAST_BLOOD_SHADOW',unitId:'vampire',
  targetId:'victim',skillId:'seraphina_blood_drain'},seat);}
function complete(game,skillId,seat=0){return resolveCanonicalPlayerCommand(game,{type:'CHOOSE_BLOOD_MEMORY',
  unitId:'vampire',skillId},seat);}
function commit(session,seat,action,commandId){return commitAuthorityCommand({
  session,seat,core:experimentalTacticalCore,envelope:{protocol:PVP_COMMAND_PROTOCOL,commandId,
    baseRevision:session.revision,action}});}

test('original blood-shadow rear-cell transit and guaranteed HP drain are one server command',()=>{
  const {game,actor,victim}=setup();
  const before={x:actor.x,y:actor.y,mana:actor.mana,hp:actor.hp,victimHp:victim.hp};
  actor.hp-=60;
  const options=tacticalDebugProjection(game,0).units.find(u=>u.id===actor.id).bloodShadowOptions;
  assert.ok(options.some(o=>o.targetId===victim.id&&o.skillId==='seraphina_blood_drain'));
  const res=cast(game);
  assert.equal(res.accepted,true);
  assert.equal(victim.hp<before.victimHp,true);
  // Blood drain restores MP after paying the skill: it may refill to max.
  assert.ok(actor.mana>=0&&actor.mana<=actor.maxMana);
  assert.equal(res.manaAfter,actor.mana);
  assert.equal(actor.hp>before.hp-60,true);
  const back={N:{x:0,y:1},S:{x:0,y:-1},E:{x:-1,y:0},W:{x:1,y:0}}[victim.facing];
  assert.deepEqual({x:actor.x,y:actor.y},{x:victim.x+back.x,y:victim.y+back.y});
  assert.ok(game.pendingBloodMemoryChoice?.skillIds.length>0);
  assert.equal(actor.acted,false,'memory choice follows a committed attack');
  assert.doesNotThrow(()=>structuredClone(game));
});

test('memory choice is private, revalidates original candidate and persists only one grant',()=>{
  const {game,actor}=setup(8981),originalMana=actor.mana;
  cast(game);
  const view=tacticalDebugProjection(game,0);
  const opponent=tacticalDebugProjection(game,1);
  assert.equal(opponent.bloodMemoryChoice,null);
  assert.ok(view.bloodMemoryChoice.options.length>0);
  const skill=view.bloodMemoryChoice.options[0].id;
  assert.throws(()=>complete(game,'invented_skill'),{code:'ILLEGAL_BLOOD_MEMORY_SKILL'});
  assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'END_TACTICAL_PHASE'},0),
    {code:'BLOOD_MEMORY_CHOICE_REQUIRED'});
  assert.throws(()=>complete(game,skill,1),{code:'NOT_YOUR_TURN'});
  const restored=structuredClone(game);
  assert.equal(complete(restored,skill).accepted,true);
  const cloneActor=restored.units.find(u=>u.id==='vampire');
  assert.equal(cloneActor.grantedSkills.filter(g=>g.bloodMemory&&g.skillId===skill).length,1);
  assert.equal(cloneActor.acted,true);
  assert.equal(restored.pendingBloodMemoryChoice,null);
  assert.ok(cloneActor.mana<=originalMana);
  assert.throws(()=>complete(restored,skill),{code:'NO_BLOOD_MEMORY_CHOICE'});
});

test('skip memory finalizes action, and a target with no copyable skills has no pending choice',()=>{
  const one=setup(15210);cast(one.game);
  assert.equal(complete(one.game,null).accepted,true);
  assert.equal(one.actor.acted,true);
  assert.equal(one.game.pendingBloodMemoryChoice,null);
  const noChoice=setup(15210,{copyable:false});
  assert.equal(cast(noChoice.game).memoryChoicePending,false);
  assert.equal(noChoice.actor.acted,true);
  assert.equal(noChoice.game.pendingBloodMemoryChoice??null,null);
});

test('both player seats use the human memory choice path, never auto-copy enemy skill',()=>{
  const {game,actor}=setup(33918,{seat:1});
  const result=cast(game,1);
  assert.equal(result.accepted,true);
  assert.equal(game.pendingBloodMemoryChoice.unitId,actor.id);
  assert.ok(tacticalDebugProjection(game,1).bloodMemoryChoice?.options.length>0);
  assert.equal(tacticalDebugProjection(game,0).bloodMemoryChoice,null);
  assert.equal(complete(game,null,1).accepted,true);
});

test('forged landing, damage and skill choice are rejected without changing authority state',()=>{
  const {game}=setup(12204);const before=structuredClone(game);
  assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'CAST_BLOOD_SHADOW',unitId:'vampire',
    targetId:'victim',skillId:'seraphina_blood_drain',damage:99999},0),
    {code:'INVALID_BLOOD_SHADOW_COMMAND'});
  assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'CAST_BLOOD_SHADOW',unitId:'vampire',
    targetId:'victim',skillId:'seraphina_blood_drain',landing:{x:0,y:0}},0),
    {code:'INVALID_BLOOD_SHADOW_COMMAND'});
  assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'CAST_BLOOD_SHADOW',unitId:'vampire',
    targetId:'victim',skillId:'slash'},0),{code:'BLOOD_SHADOW_SKILL_UNAVAILABLE'});
  assert.deepEqual(game,before);
});

test('authority replay after reconnect neither teleports again nor drains twice',()=>{
  const {game}=setup(20247),initial=createAuthoritySession({initialState:game,core:experimentalTacticalCore});
  const action={type:'CAST_BLOOD_SHADOW',unitId:'vampire',targetId:'victim',skillId:'seraphina_blood_drain'};
  const id='qa_bloodshadow_00000001',first=commit(initial,0,action,id);
  assert.equal(first.nextSession.revision,initial.revision+1);
  const replay=commitAuthorityCommand({session:first.nextSession,seat:0,core:experimentalTacticalCore,
    envelope:{protocol:PVP_COMMAND_PROTOCOL,commandId:id,baseRevision:initial.revision,action}});
  assert.equal(replay.duplicate,true);
  assert.equal(replay.nextSession.revision,first.nextSession.revision);
  assert.deepEqual(replay.nextSession.state,first.nextSession.state);
  assert.throws(()=>commit(first.nextSession,0,action,'qa_bloodshadow_00000002'),
    {code:'BLOOD_MEMORY_CHOICE_REQUIRED'});
});

test('official rear-cell trap kills the infiltrator BEFORE draining or storing memory',()=>{
  const {game,actor,victim}=setup(1323);
  const landing=globalThis.TacticalActionController.create({actionState:()=>({map:game.battlefield.map,
    units:game.units,environmentState:game.environmentState})}).bloodShadowLanding(actor,victim);
  assert.ok(landing);
  assert.ok(globalThis.EnvironmentEngine.createTrap(game.environmentState,landing.x,landing.y,
    {sourceTeam:victim.team,damage:actor.hp+100,name:'測試毒陷阱'}));
  const previousHp=victim.hp;
  const result=cast(game);
  assert.equal(result.accepted,true);
  assert.equal(actor.alive,false);
  assert.equal(victim.hp,previousHp,'fatal trap prevents the attack');
  assert.equal(game.pendingBloodMemoryChoice??null,null);
  assert.ok(game.events.some(e=>String(e.text).includes('測試毒陷阱')));
});


test('future blood-shadow skill ID inherits official transit and drain without a PvP ID registry',()=>{
 const template=SkillDatabase.get('seraphina_blood_drain'),id='qa_bloodshadow_future';
 assert.equal(SKILLS[id],undefined);
 SKILLS[id]={...template,id,name:'進階血刃'};
 try{
   const {game,actor,victim}=setup(73412);
   actor.grantedSkills.push({skillId:id,remaining:null});
   const view=tacticalDebugProjection(game,0);
   assert.ok(view.units.find(u=>u.id===actor.id).bloodShadowOptions.some(o=>o.skillId===id));
   const result=resolveCanonicalPlayerCommand(game,{type:'CAST_BLOOD_SHADOW',unitId:'vampire',
     targetId:'victim',skillId:id},0);
   assert.equal(result.accepted,true);
   assert.equal(result.targetHpAfter<result.targetHpBefore,true);
 }finally{delete SKILLS[id]}
});

test('same room seed and same original blood-shadow commands produce identical battle and random state',()=>{
 const left=setup(14532),right=setup(14532);
 const a=cast(left.game),b=cast(right.game);
 assert.deepEqual({from:a.from,to:a.to,hp:a.targetHpAfter,mana:a.manaAfter,
   random:left.game.randomState,copy:left.game.pendingBloodMemoryChoice},
  {from:b.from,to:b.to,hp:b.targetHpAfter,mana:b.manaAfter,
   random:right.game.randomState,copy:right.game.pendingBloodMemoryChoice});
});

test('movement already consumed does not permit a second move, but retains canonical shadow strike eligibility',()=>{
 const {game,actor}=setup(14533);
 actor.moved=true;
 assert.ok(tacticalDebugProjection(game,0).units.find(u=>u.id==='vampire').bloodShadowOptions.length);
 assert.equal(cast(game).accepted,true);
});

test('copied skill uses original 5V unlock and blood-cost conversion, not a PvP resource formula',()=>{
 const {game}=setup(19822);cast(game);
 const chosen=game.pendingBloodMemoryChoice.skillIds[0];
 complete(game,chosen);
 withCanonicalEngines(game,engine=>{
  const unit=game.units.find(u=>u.id==='vampire');
  const skill=SkillDatabase.get(chosen);
  engine.unitRuntime.changeBlood(unit,-100);
  assert.equal(engine.unitRuntime.canUseSkill(unit,skill),false,'memory cannot cast before awakening');
  engine.unitRuntime.changeBlood(unit,100);
  assert.equal(unit._bloodAwakened,true);
  // The live UnitRuntimeEngine constructs the mimic weapon if needed and
  // charges its real blood conversion, never the copied skill's MP.
  const expected=engine.unitRuntime.bloodMemoryCost(skill);
  const mana=unit.mana,blood=unit.resources.blood.value;
  assert.equal(engine.unitRuntime.canUseSkill(unit,skill),expected<=blood);
  if(expected<=blood){
    const spent=engine.unitRuntime.consumeSkill(unit,skill);
    assert.equal(spent.cost,0);
    assert.equal(unit.mana,mana);
    assert.equal(unit.resources.blood.value,blood-expected);
  }
 });
});
