import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {chooseAutonomousBattleReaction} from '../../js/battle-reaction-decision-engine.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {SkillDatabase} from '../../js/skill-database.js';
import {isCanonicalDirectAttackSkill} from '../src/pvp-headless-engagement.mjs';

const cards=Array(20).fill('imperial_swordsman_card');
let prepared=createOpeningGame({decks:[cards,cards],serverSeed:507401});
for(const seat of [0,1])prepared=openingGameCore.reduce(prepared,{type:'KEEP_OPENING_HAND'},{seat}).state;

function makeCombat({attackerId='imperial_swordsman',defenderId='imperial_swordsman',
  skillId='slash',distance=1,defenderMana,guardianId=null,phantom=false,settle=false}={}){
  const game=structuredClone(prepared);
  return withCanonicalEngines(game,engine=>{
    const map=game.battlefield.map,skill=SkillDatabase.get(skillId);
    const actor=engine.unitRuntime.create({id:'attacker',team:'P',characterId:attackerId,
      x:1,y:1,map,cores:game.battlefield.cores});
    const target=engine.unitRuntime.create({id:'defender',team:'E',characterId:defenderId,
      x:2,y:1,map,cores:game.battlefield.cores});
    assert.ok(actor&&target&&skill);
    const stand=t=>t&&globalThis.TERRAINS[t.terrain]?.passable;
    let placed=false;
    for(const t of map.tiles){
      if(!stand(t))continue;
      for(const d of map.tiles){
        if(!stand(d)||Math.abs(t.x-d.x)+Math.abs(t.y-d.y)!==distance)continue;
        actor.x=t.x;actor.y=t.y;actor.z=TacticalEngine.elevation(t);
        target.x=d.x;target.y=d.y;target.z=TacticalEngine.elevation(d);
        if(TacticalEngine.canTarget(map,actor,target,skill,game.environmentState)){
          placed=true;break;
        }
      }
      if(placed)break;
    }
    assert.ok(placed,`official geometry must allow ${skillId} at ${distance}`);
    if(defenderMana!=null)target.mana=defenderMana;
    if(phantom)target.hallucination=true;
    game.units=[actor,target];
    if(guardianId){
      const guardian=engine.unitRuntime.create({id:'guardian',team:'E',characterId:guardianId,
        x:target.x,y:target.y,map,cores:game.battlefield.cores});
      const near=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>TacticalEngine.tile(map,target.x+x,target.y+y));
      const landing=near.find(tile=>stand(tile)&&!(tile.x===actor.x&&tile.y===actor.y));
      assert.ok(landing,'valid guard tile');
      guardian.x=landing.x;guardian.y=landing.y;guardian.z=TacticalEngine.elevation(landing);
      game.units.push(guardian);
      target.hp=1;
    }
    const before=structuredClone(game.units);
    const selection=chooseAutonomousBattleReaction({map,units:game.units,attacker:actor,
      defender:target,skill,environmentState:game.environmentState,
      resolution:engine.battleResolution,
      canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
      eligibleCounterSkill:isCanonicalDirectAttackSkill});
    assert.deepEqual(game.units,before,'choice is read-only; damage and costs belong to official resolution');
    const settlement=settle?engine.battleResolution.resolve({map,units:game.units,
      initiator:actor,target,skill,actions:[],reaction:selection.reaction,
      interception:selection.interception},{
      canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
      consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
      onDefeated:()=>{},onAction:()=>{},onPostEffect:()=>{}
    }):null;
    return {selection,actor,target,engine,game,skill,settlement};
  });
}

test('same-speed swordsman chooses a resource-legal original counter and returns actual skill object',()=>{
  const {selection,target,skill,engine,actor}=makeCombat();
  assert.equal(selection.kind,'COUNTER');
  assert.equal(selection.reaction.type,'COUNTER');
  assert.equal(selection.reaction.skill.id,'slash');
  assert.equal(engine.battleResolution.actionSpeed({actor:target,target:actor,skill:selection.reaction.skill}),
    engine.battleResolution.actionSpeed({actor,target,skill}));
});

test('fast original attacker makes slower swordsman choose official sword parry without new block math',()=>{
  const {selection}=makeCombat({attackerId:'livia',skillId:'black_slash'});
  assert.equal(selection.kind,'DEFENSE');
  assert.equal(selection.reaction.type,'DEFENSE');
  assert.equal(selection.reaction.methodId,'sword_parry');
});

test('original archer at melee distance has no usable bow counter or defense and chooses official active evade',()=>{
  const {selection}=makeCombat({defenderId:'imperial_archer'});
  assert.equal(selection.kind,'EVADE');
  assert.equal(selection.reaction.type,'EVADE');
});

test('an empty mana pool cannot create a counter even though the unit owns a weapon',()=>{
  const {selection}=makeCombat({attackerId:'imperial_archer',defenderId:'velsa',
    skillId:'imperial_bow_shot',distance:2,defenderMana:0});
  assert.notEqual(selection.kind,'COUNTER');
  assert.ok(['DEFENSE','EVADE'].includes(selection.kind));
});

test('an injected hallucination with fake HP cannot counter, guard or spend its template mana',()=>{
  const {selection}=makeCombat({phantom:true});
  assert.equal(selection.kind,'HALLUCINATION_CONTACT');
  assert.equal(selection.reaction,null);
  assert.equal(selection.interception,null);
});

test('missing official dependencies reject rather than choose a fake client reaction',()=>{
  assert.throws(()=>chooseAutonomousBattleReaction({map:{}}),
    /CANONICAL_AUTONOMOUS_REACTION_DEPENDENCIES_REQUIRED/);
});

test('official adjacent guard-capable ally may intercept a vulnerable defender using real equipment profile',()=>{
  const {selection}=makeCombat({guardianId:'church_templar_hero'});
  assert.equal(selection.kind,'GUARD');
  assert.equal(selection.reaction,null);
  assert.equal(selection.interception.type,'GUARD_ALLY');
  assert.equal(selection.interception.guardian.id,'guardian');
  assert.equal(selection.interception.methodId,'church_guard_ally');
});


test('official BattleResolution performs an autonomous counter as a distinct resource-consuming action',()=>{
  const {selection,settlement}=makeCombat({settle:true});
  assert.equal(selection.kind,'COUNTER');
  assert.ok(settlement.results.some(e=>e.role==='INITIATOR'));
  assert.ok(settlement.results.some(e=>e.role==='COUNTER'&&e.actor.id==='defender'));
  assert.equal(settlement.queue.find(e=>e.role==='COUNTER').skill.id,'slash');
});

test('official BattleResolution applies the selected equipment defense rather than a shadow damage formula',()=>{
  const {selection,settlement}=makeCombat({attackerId:'livia',skillId:'black_slash',settle:true});
  assert.equal(selection.kind,'DEFENSE');
  const hit=settlement.results.find(e=>e.role==='INITIATOR');
  assert.equal(hit.resolved.defense?.method?.id,selection.reaction.methodId);
});

test('official BattleResolution uses its own evade RNG and GRAZE/MISS/HIT result',()=>{
  const {selection,settlement}=makeCombat({defenderId:'imperial_archer',settle:true});
  assert.equal(selection.kind,'EVADE');
  const hit=settlement.results.find(e=>e.role==='INITIATOR');
  assert.ok(['MISS','GRAZE','HIT'].includes(hit.result.evadeOutcome));
});

test('official BattleResolution redirects guard interception to adjacent living ally',()=>{
  const {selection,settlement}=makeCombat({guardianId:'church_templar_hero',settle:true});
  assert.equal(selection.kind,'GUARD');
  assert.equal(settlement.context.guardian?.id,'guardian');
  assert.equal(settlement.context.originalTarget.id,'defender');
  assert.equal(settlement.results[0].target.id,'guardian');
});
