import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection,experimentalTacticalCore} from '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {createCanonicalPerception} from '../src/pvp-perception-controller.mjs';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {SkillDatabase} from '../../js/skill-database.js';
import {createAuthoritySession,commitAuthorityCommand,projectAuthoritySession} from '../src/battle-authority.mjs';
import {PVP_COMMAND_PROTOCOL} from '../../shared/pvp-command-contract.mjs';
import {pvpAuthoritativeMatchCore} from '../src/pvp-authoritative-match-core.mjs';
const deck=Array(20).fill('imperial_swordsman_card');
function setup({casterSeat=0,seed=99348,targetCharacterId='imperial_swordsman',attackSkillId=null}={}){
  let game=createOpeningGame({decks:[deck,deck],serverSeed:seed});
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
  beginCanonicalPlayerCardPhase(game);
  resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
  if(casterSeat===1){
    resolveCanonicalPlayerCommand(game,{type:'END_TACTICAL_PHASE'},0);
    resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},1);
  }
  withCanonicalEngines(game,e=>{
    for(const [id,team,char] of [['seer',casterSeat===0?'P':'E','velsa'],['target',casterSeat===0?'E':'P',targetCharacterId]]){
      const unit=e.unitRuntime.create({id,team,characterId:char,x:1,y:1,map:game.battlefield.map,cores:game.battlefield.cores});
      assert.ok(unit,`unit ${char} created by real runtime`);
      delete unit._runtimeMap;
      unit.moved=false;unit.acted=false;unit.waited=false;
      game.units.push(unit);
    }
  });
  const actor=game.units.find(u=>u.id==='seer'),target=game.units.find(u=>u.id==='target');
  const skill=SkillDatabase.get('velsa_cognitive_corruption');
  assert.ok(skill,'original cognitive corruption skill');
  const map=game.battlefield.map;
  const canStand=t=>globalThis.TERRAINS[t.terrain]?.passable&&!map.objects.some(o=>o.blocksMovement&&o.x===t.x&&o.y===t.y);
  let found=false;
  for(const t of map.tiles.filter(canStand)){
    target.x=t.x;target.y=t.y;target.z=TacticalEngine.elevation(t);
    for(const a of map.tiles.filter(canStand)){
      if(a.x===t.x&&a.y===t.y)continue;
      actor.x=a.x;actor.y=a.y;actor.z=TacticalEngine.elevation(a);
      if(TacticalEngine.canTarget(map,actor,target,skill,game.environmentState)&&
        (!attackSkillId||TacticalEngine.canTarget(map,target,actor,SkillDatabase.get(attackSkillId),game.environmentState)))
        {found=true;break;}
    }
    if(found)break;
  }
  assert.ok(found,'original TacticalEngine found legal visible 2-4 range target');
  return {game,actor,target,skill};
}
function commit(s,seat,action,id){return commitAuthorityCommand({session:s,seat,core:experimentalTacticalCore,envelope:{protocol:PVP_COMMAND_PROTOCOL,commandId:id,baseRevision:s.revision,action}});}
test('real shared engines allow schedule->two-seat mirror turn->restore; protect real Core and fake unit projection across Durable Object clone',()=>{
  const {game,actor,target,skill}=setup();
  const session=createAuthoritySession({initialState:game,core:experimentalTacticalCore});
  const cast=commit(session,0,{type:'CAST_PERCEPTION',unitId:actor.id,targetId:target.id,skillId:skill.id},'perception_real_0001');
  assert.equal(cast.ack.acceptedRevision,1);
  let s=cast.nextSession;
  assert.ok(s.state.perceptionState.pending.E,'server queued mirror state for enemy');
  assert.doesNotThrow(()=>structuredClone(s));
  s=commit(s,0,{type:'END_TACTICAL_PHASE'},'perception_real_0002').nextSession;
  assert.equal(s.state.phase,'ENEMY_CARD_PHASE');
  assert.equal(s.state.perceptionState.session.active,true);
  const mirror=structuredClone(s);
  const real=mirror.state.perceptionState.session.real;
  const view0=tacticalDebugProjection(mirror.state,0),view1=tacticalDebugProjection(mirror.state,1);
  assert.equal(view0.units.some(u=>u.id?.startsWith('hallucination_')),false,'unaffected seat must not get fake');
  assert.ok(view1.units.some(u=>u.id?.startsWith('hallucination_')),'affected seat sees generated fake');
  assert.deepEqual(pvpAuthoritativeMatchCore.project(mirror.state,0).battlefield.cores,real.cores,'unaffected seat sees real core');
  assert.doesNotThrow(()=>structuredClone(mirror));
  s=commit(mirror,1,{type:'END_CARD_PHASE'},'perception_real_0003').nextSession;
  assert.throws(()=>commit(s,1,{type:'DECLARE_ATTACK',attackerId:'target',targetId:'seer',skillId:'imperial_sword_slash'},'perception_real_reject'),
    {code:'FULL_SKILL_ORCHESTRATION_REQUIRED'});
  assert.equal(s.state.perceptionState.session.active,true);
  s=commit(s,1,{type:'END_TACTICAL_PHASE'},'perception_real_0004').nextSession;
  assert.equal(s.state.perceptionState.session,null);
  assert.equal(s.state.round,2);
  assert.deepEqual(s.state.battlefield.cores,real.cores,'Core stays real after turn');
  assert.equal(s.state.units.some(u=>u.hallucination),false);
});

test('opposite seat casts official mirror skill and next player receives only mirrored view while opponent sees real Core',()=>{
  const {game,actor,target,skill}=setup({casterSeat:1,seed:99348});
  let s=createAuthoritySession({initialState:game,core:experimentalTacticalCore});
  const cast=commit(s,1,{type:'CAST_PERCEPTION',unitId:actor.id,targetId:target.id,skillId:skill.id},'mirror_reverse_0001');
  s=cast.nextSession;
  assert.ok(s.state.perceptionState.pending.P);
  const originalCores=structuredClone(s.state.battlefield.cores);
  s=commit(s,1,{type:'END_TACTICAL_PHASE'},'mirror_reverse_0002').nextSession;
  assert.equal(s.state.phase,'PLAYER_CARD_PHASE');
  assert.equal(s.state.perceptionState.session?.team,'P');
  const affected=pvpAuthoritativeMatchCore.project(s.state,0);
  const unaffected=pvpAuthoritativeMatchCore.project(s.state,1);
  assert.deepEqual(unaffected.battlefield.cores,originalCores);
  assert.equal(unaffected.units.some(u=>u.hallucination||u.id?.startsWith('hallucination_')),false);
  assert.ok(affected.units.some(u=>u.id?.startsWith('hallucination_')));
  s=commit(structuredClone(s),0,{type:'END_CARD_PHASE'},'mirror_reverse_0003').nextSession;
  s=commit(s,0,{type:'END_TACTICAL_PHASE'},'mirror_reverse_0004').nextSession;
  assert.equal(s.state.perceptionState.session,null);
  assert.deepEqual(s.state.battlefield.cores,originalCores);
  assert.equal(s.state.phase,'ENEMY_CARD_PHASE');
});


for(const casterSeat of [0,1])test(`isolated perception attack uses official autonomous defender and commits only mirror combat in seat ${1-casterSeat}`,()=>{
  // The ranged unit's original weapon can legally hit the same 2-4 tile
  // contact used by the official cognitive-corruption ability; no test damage
  // or range override is needed.
  const {game,actor,target,skill}=setup({casterSeat,seed:44128,
    targetCharacterId:'imperial_archer',attackSkillId:'imperial_bow_shot'});
  let s=createAuthoritySession({initialState:game,core:experimentalTacticalCore});
  const attackSeat=1-casterSeat;
  const turnId=`mirror_auto_${casterSeat}`;
  s=commit(s,casterSeat,{type:'CAST_PERCEPTION',unitId:actor.id,targetId:target.id,skillId:skill.id},`${turnId}_cast`).nextSession;
  s=commit(s,casterSeat,{type:'END_TACTICAL_PHASE'},`${turnId}_end`).nextSession;
  assert.equal(s.state.perceptionState.session?.team,attackSeat===0?'P':'E');
  assert.equal(s.state.perceptionState.session?.active,true);
  s=commit(s,attackSeat,{type:'END_CARD_PHASE'},`${turnId}_card`).nextSession;
  const before=structuredClone(s),mirrored=s.state;
  const mirroredTarget=mirrored.units.find(u=>u.id==='seer');
  const mirroredAttacker=mirrored.units.find(u=>u.id==='target');
  assert.ok(mirroredAttacker?.mirrorOfUnitId,'attacker is a formal mirror, not a forged client unit');
  assert.ok(mirroredTarget?.mirrorOfUnitId,'defender is a mirror of the real caster');
  assert.ok(TacticalEngine.canTarget(mirrored.battlefield.map,mirroredAttacker,
    mirroredTarget,SkillDatabase.get('imperial_bow_shot'),mirrored.environmentState),
    'the canonical map geometry permits this attack');
  const atk={type:'DECLARE_ATTACK',attackerId:'target',targetId:'seer',skillId:'imperial_bow_shot'};
  assert.throws(()=>commit(s,attackSeat,{...atk,damage:600},`${turnId}_forged`),
    {code:'CLIENT_RESULT_FORBIDDEN'});
  assert.deepEqual(s,before,'rejected command does not alter the original authority session');
  const attack=commit(s,attackSeat,atk,`${turnId}_attack`);
  assert.equal(attack.ack.acceptedRevision,s.revision+1);
  const advanced=attack.nextSession;
  assert.equal(advanced.state.activeSeat,attackSeat,'no cross-world switch to an unaffected human');
  assert.equal(advanced.state.phase,attackSeat===0?'PLAYER_TACTICAL_PHASE':'ENEMY_TACTICAL_PHASE');
  assert.equal(advanced.state.pendingAttack,null,'no waiting human reaction is persisted');
  assert.equal(advanced.state.units.find(u=>u.id==='target').acted,true);
  assert.deepEqual(advanced.state.perceptionState.session.real.units.find(u=>u.id==='seer'),
    before.state.perceptionState.session.real.units.find(u=>u.id==='seer'),
    'real opponent HP, resources and death state stay unchanged');
  assert.deepEqual(advanced.state.perceptionState.session.real.cores,
    before.state.perceptionState.session.real.cores,'real cores stay unchanged');
  assert.equal(projectAuthoritySession(advanced,casterSeat,experimentalTacticalCore).view.units
    .some(u=>u.hallucination||u.id?.startsWith('hallucination_')),false,
    'unaffected human still sees no fake combatants');
  const duplicate=commitAuthorityCommand({session:advanced,seat:attackSeat,core:experimentalTacticalCore,
    envelope:{protocol:PVP_COMMAND_PROTOCOL,commandId:`${turnId}_attack`,baseRevision:s.revision,action:atk}});
  assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.nextSession.revision,advanced.revision,'duplicate does not roll damage twice');
  // The same room is valid after a Durable Object clone/restart.
  const resumed=structuredClone(advanced);
  const restored=commit(resumed,attackSeat,{type:'END_TACTICAL_PHASE'},`${turnId}_restore`).nextSession;
  assert.equal(restored.state.perceptionState.session,null);
  assert.deepEqual(restored.state.battlefield.cores,
    before.state.perceptionState.session.real.cores);
  assert.equal(restored.state.units.some(u=>u.hallucination),false);
});

test('official autonomous mirror counter spends only simulated opponent mana, not unaffected real mana',()=>{
  const {game,actor,target,skill}=setup({casterSeat:0,seed:448801,
    targetCharacterId:'imperial_archer',attackSkillId:'imperial_bow_shot'});
  withCanonicalEngines(game,e=>{
    const saint=e.unitRuntime.create({id:'autonomous-defender',team:'P',characterId:'church_saint',
      x:1,y:1,map:game.battlefield.map,cores:game.battlefield.cores});
    assert.ok(saint,'original saint unit is available for an autonomous magic counter');
    delete saint._runtimeMap;
    saint.moved=false;saint.acted=false;saint.waited=false;
    game.units.push(saint);
  });
  let session=createAuthoritySession({initialState:game,core:experimentalTacticalCore});
  session=commit(session,0,{type:'CAST_PERCEPTION',unitId:actor.id,targetId:target.id,
    skillId:skill.id},'counter_mirror_cast').nextSession;
  session=commit(session,0,{type:'END_TACTICAL_PHASE'},'counter_mirror_end').nextSession;
  session=commit(session,1,{type:'END_CARD_PHASE'},'counter_mirror_card').nextSession;
  const affected=session.state.units.find(u=>u.id==='target');
  const defender=session.state.units.find(u=>u.id==='autonomous-defender');
  const map=session.state.battlefield.map,bow=SkillDatabase.get('imperial_bow_shot');
  const holy=SkillDatabase.get('saint_judgement');
  const stand=t=>t&&globalThis.TERRAINS[t.terrain]?.passable;
  let eligible=false;
  for(const t of map.tiles){
    if(!stand(t)||t.x===affected.x&&t.y===affected.y)continue;
    if(session.state.units.some(u=>u.id!=='autonomous-defender'&&u.alive&&u.x===t.x&&u.y===t.y))continue;
    defender.x=t.x;defender.y=t.y;defender.z=TacticalEngine.elevation(t);
    if(TacticalEngine.canTarget(map,affected,defender,bow,session.state.environmentState)&&
       TacticalEngine.canTarget(map,defender,affected,holy,session.state.environmentState)){
      eligible=true;break;
    }
  }
  assert.ok(eligible,'two official ranged skills must mutually target under real geometry');
  assert.ok(defender.mirrorOfUnitId,'counter defender is part of the mirror, not the real player');
  const realBefore=session.state.perceptionState.session.real.units
    .find(u=>u.id==='autonomous-defender').mana;
  const mirrorBefore=defender.mana;
  const hit=commit(session,1,{type:'DECLARE_ATTACK',attackerId:'target',
    targetId:'autonomous-defender',skillId:'imperial_bow_shot'},'counter_mirror_attack');
  assert.equal(hit.ack.acceptedRevision,session.revision+1);
  const next=hit.nextSession;
  assert.equal(next.state.pendingAttack,null,'no cross-world human reaction');
  assert.ok(next.state.units.find(u=>u.id==='autonomous-defender').mana<mirrorBefore,
    'official autonomous counter paid its real skill cost within the simulated world');
  assert.equal(next.state.perceptionState.session.real.units.find(u=>u.id==='autonomous-defender').mana,
    realBefore,'unaffected player must not pay a simulated opponent counter cost');
  const restored=commit(structuredClone(next),1,{type:'END_TACTICAL_PHASE'},
    'counter_mirror_finish').nextSession;
  assert.equal(restored.state.perceptionState.session,null);
  assert.equal(restored.state.units.find(u=>u.id==='autonomous-defender').mana,realBefore,
    'world restoration preserves original opponent mana');
});
