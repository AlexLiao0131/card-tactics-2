/** Future data-only cards/skills must inherit the *official* command contract.
 * Unknown gameplay effects fail closed rather than silently losing effects.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {CARDS,CardDatabase} from '../../js/card-database.js';
import {SKILLS,SkillDatabase} from '../../js/skill-database.js';
import {EffectEngine,createEffectEngine} from '../../js/effect-engine.js';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand} from '../src/pvp-headless-tactical.mjs';
import {isCanonicalSynchronousTargetCard} from '../src/pvp-headless-targeted-cards.mjs';
import {isCanonicalDirectEffectSkill} from '../src/pvp-headless-effect-skills.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import '../../js/card-phase-controller.js';

function fixture(){
  const deck=[...Array(20).fill('imperial_archer_card')];
  let game=createOpeningGame({decks:[deck,deck],serverSeed:987654321});
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
  beginCanonicalPlayerCardPhase(game);
  return game;
}
function spawn(game,{id,characterId,team='P',x,y}){
  return withCanonicalEngines(game,engine=>{
    const u=engine.unitRuntime.create({id,team,characterId,x,y,
      map:game.battlefield.map,cores:game.battlefield.cores});
    assert.ok(u);
    delete u._runtimeMap;
    game.units.push(u);
    return u;
  });
}
function register(id,value,registry,fn){
  assert.equal(registry[id],undefined);
  registry[id]={...value,id};
  try{return fn();}finally{delete registry[id];}
}

test('one canonical card owner classifies old and future data-only spell cards',()=>{
  assert.equal(globalThis.CardPhaseController.commandKind(CardDatabase.get('rain_card')),'INSTANT');
  assert.equal(globalThis.CardPhaseController.commandKind(CardDatabase.get('miracle_card')),'TARGETED');
  assert.equal(globalThis.CardPhaseController.commandKind(CardDatabase.get('livia_card')),null);
  assert.equal(globalThis.CardPhaseController.commandKind({type:'SPELL',effect:{type:'UNIMPLEMENTED_FUTURE_EFFECT'}}),null);
  for(const effect of ['WEATHER','STEAL_HAND','AREA_HEAL','AREA_DAMAGE','AREA_FIRE']){
    const future={type:'SPELL',effect:{type:effect}};
    assert.equal(globalThis.CardPhaseController.commandKind(future),
      ['WEATHER','STEAL_HAND'].includes(effect)?'INSTANT':'TARGETED');
  }
});

test('new weather card ID follows official server path without adding a PVP ID/type rule',()=>{
  const id='qa_future_weather_card';
  return register(id,{...CardDatabase.get('fog_card'),cost:1},CARDS,()=>{
    const g=fixture();g.cards[0].zones.hand.push(id);g.cards[0].crystals=10;
    const r=resolveCanonicalPlayerCommand(g,{type:'PLAY_INSTANT_CARD',cardId:id},0);
    assert.equal(r.accepted,true);
    assert.equal(r.crystalsBefore-r.crystalsAfter,1);
    assert.ok(g.cards[0].zones.discard.includes(id));
    assert.doesNotThrow(()=>structuredClone(g));
  });
});

test('new targeted heal card ID uses the official effect and crystals',()=>{
  const id='qa_future_target_heal';
  return register(id,{...CardDatabase.get('miracle_card'),cost:1},CARDS,()=>{
    assert.equal(isCanonicalSynchronousTargetCard(CardDatabase.get(id)),true);
    const g=fixture(),point=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
    const u=spawn(g,{id:'receiver',characterId:'church_templar_hero',x:point.x,y:point.y});
    u.hp-=35;const before=u.hp;
    g.cards[0].zones.hand.push(id);g.cards[0].crystals=10;
    const r=resolveCanonicalPlayerCommand(g,{type:'PLAY_TARGET_CARD',cardId:id,x:point.x,y:point.y},0);
    assert.equal(r.accepted,true);
    assert.ok(u.hp>before);
    assert.equal(g.cards[0].crystals,9);
    assert.ok(g.cards[0].zones.discard.includes(id));
  });
});

test('effect capability is owned by EffectEngine; cloned future healing skill needs no PVP registration',()=>{
  assert.equal(EffectEngine.isStandaloneDirectEffectType('HEAL'),true);
  assert.equal(createEffectEngine().isStandaloneDirectEffectType('HEAL'),true);
  assert.equal(EffectEngine.isStandaloneDirectEffectType('CHRONO_REWIND'),false);
  const id='qa_future_heal_skill';
  return register(id,{...SkillDatabase.get('templar_healing')},SKILLS,()=>{
    assert.equal(isCanonicalDirectEffectSkill(SkillDatabase.get(id)),true);
    const g=fixture(),area=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
    const caster=spawn(g,{id:'caster',characterId:'church_templar_hero',x:area[0].x,y:area[0].y});
    const ally=spawn(g,{id:'ally',characterId:'church_templar_hero',x:area[1].x,y:area[1].y});
    caster.character.skills.push(id);ally.hp-=50;
    resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
    const before=ally.hp;
    const r=resolveCanonicalPlayerCommand(g,{type:'CAST_EFFECT_SKILL',unitId:caster.id,targetId:ally.id,skillId:id},0);
    assert.equal(r.accepted,true);
    assert.ok(ally.hp>before);
    assert.ok(caster.acted);
  });
});

test('unknown card/skill effects are fail-closed and cannot alter authoritative state',()=>{
  const id='qa_future_unimplemented_card',sid='qa_future_unimplemented_skill';
  return register(id,{type:'SPELL',name:'未完成新系統',cost:1,effect:{type:'TIME_REWIND'}},CARDS,()=>
    register(sid,{category:'MAGIC',name:'未完成技能',target:'ALLY',targetType:'SINGLE',range:{min:0,max:2},effects:[{type:'TIME_REWIND'}],manaCost:1},SKILLS,()=>{
      const g=fixture();g.cards[0].zones.hand.push(id);g.cards[0].crystals=10;
      const before=structuredClone(g);
      assert.equal(globalThis.CardPhaseController.commandKind(CardDatabase.get(id)),null);
      assert.equal(isCanonicalDirectEffectSkill(SkillDatabase.get(sid)),false);
      assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'PLAY_INSTANT_CARD',cardId:id},0),
        {code:'FULL_CARD_ORCHESTRATION_REQUIRED'});
      assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'PLAY_TARGET_CARD',cardId:id,x:0,y:0},0),
        {code:'FULL_CARD_ORCHESTRATION_REQUIRED'});
      assert.deepEqual(g,before);
    }));
});
