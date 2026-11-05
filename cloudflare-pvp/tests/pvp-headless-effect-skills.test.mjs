import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {resolveCanonicalPlayerCommand,tacticalDebugProjection,beginCanonicalPlayerCardPhase} from '../src/pvp-headless-tactical.mjs';
import {isCanonicalDirectEffectSkill} from '../src/pvp-headless-effect-skills.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';

const deck0=Array(20).fill('imperial_archer_card');
const deck1=Array(20).fill('imperial_swordsman_card');
function game(){
 let g=createOpeningGame({decks:[deck0,deck1],serverSeed:777});
 g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
 g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
 beginCanonicalPlayerCardPhase(g);
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 return g;
}
function spawn(g,{id,characterId,x,y,team='P'}){
 return withCanonicalEngines(g,e=>{
   const u=e.unitRuntime.create({id,team,characterId,x,y,map:g.battlefield.map,cores:g.battlefield.cores});
   assert.ok(u,'official UnitRuntimeEngine must resolve '+characterId);
   const {_runtimeMap,...stored}=u;
   stored.acted=false;stored.moved=false;stored.waited=false;
   g.units.push(stored);
   return stored;
 });
}
function pair(){
 const g=game();const p=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
 assert.ok(p.length>=2);
 const a=spawn(g,{id:'saint',characterId:'church_saint',x:p[0].x,y:p[0].y});
 const b=spawn(g,{id:'ally',characterId:'church_templar_hero',x:p[1].x,y:p[1].y});
 return {g,a,b};
}
const cast=(g,unitId,targetId,skillId)=>resolveCanonicalPlayerCommand(g,
 {type:'CAST_EFFECT_SKILL',unitId,targetId,skillId},0);

test('direct effect capability uses official skill metadata, not a PvP skill-ID list',()=>{
 for(const name of ['saint_hero_heal','saint_hero_dispel','saint_hero_blessing','templar_healing','angel_heal','seraphina_regeneration'])
  assert.equal(isCanonicalDirectEffectSkill(SkillDatabase.get(name)),true,name);
 for(const name of ['seraphina_blood_drain','saint_sanctuary','cat_smoke_bomb','nether_slash','templar_verdict','elemental_enchant'])
  assert.equal(isCanonicalDirectEffectSkill(SkillDatabase.get(name)),false,name);
 assert.equal(isCanonicalDirectEffectSkill(SkillDatabase.get('ophi_forest_entangle')),true);
});
test('PVP effect projection only reveals own eligible skills; opponent gains no private options',()=>{
 const {g,a}=pair();const p0=tacticalDebugProjection(g,0),p1=tacticalDebugProjection(g,1);
 assert.ok(p0.units.find(u=>u.id===a.id).effectSkills.some(s=>s.id==='saint_hero_heal'));
 assert.equal(p1.units.find(u=>u.id===a.id)?.effectSkills,undefined);
 assert.equal(p0.units.find(u=>u.id==='ally')?.effectSkills.some(s=>s.id==='templar_healing'),true);
});
test('official Saint heal deducts canonical MP, restores ally HP, ends caster action and persists effects',()=>{
 const {g,a,b}=pair();b.hp-=70;const priorMP=a.mana;const priorHP=b.hp;
 assert.equal(TacticalEngine.canTarget(g.battlefield.map,a,b,SkillDatabase.get('saint_hero_heal'),g.environmentState),true);
 const result=cast(g,a.id,b.id,'saint_hero_heal');
 assert.equal(result.accepted,true);
 assert.ok(b.hp>priorHP,'official heal actually restores HP');
 assert.ok([24,12].includes(priorMP-a.mana),
   'official Saint STIGMATA refunds half of 24 MP on heal critical');
 assert.deepEqual([a.moved,a.acted,a.waited],[true,true,true]);
 assert.doesNotThrow(()=>structuredClone(g));
 assert.throws(()=>cast(g,a.id,b.id,'saint_hero_heal'),{code:'CASTER_NOT_AVAILABLE'});
});
test('official Saint blessing executes original passive grace trigger without hand-card changes',()=>{
 const {g,a,b}=pair();const hand=structuredClone(g.cards[0].zones.hand);
 const result=cast(g,a.id,b.id,'saint_hero_blessing');
 assert.equal(result.accepted,true);
 const ids=(b.effects||[]).map(e=>e.id);
 assert.ok(ids.includes('ROYAL_BLESSING'));
 assert.ok(ids.includes('GRACE'),'STIGMATA passive trigger must also apply');
 assert.deepEqual(g.cards[0].zones.hand,hand);
});
test('effect skills reject forged caster, enemy targets, special skills, bad schemas and insufficient resources',()=>{
 const {g,a,b}=pair();
 const foe=spawn(g,{id:'enemy',team:'E',characterId:'imperial_swordsman',x:g.battlefield.map.width-3,y:2});
 assert.throws(()=>cast(g,'nonexistent',b.id,'saint_hero_heal'),{code:'CASTER_NOT_AVAILABLE'});
 assert.throws(()=>cast(g,a.id,foe.id,'saint_hero_heal'),{code:'ILLEGAL_EFFECT_TARGET'});
 assert.throws(()=>cast(g,a.id,b.id,'saint_sanctuary'),{code:'FULL_SKILL_ORCHESTRATION_REQUIRED'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_EFFECT_SKILL',unitId:a.id,targetId:b.id,skillId:'saint_hero_heal',healAmount:999},0),{code:'INVALID_EFFECT_SKILL_COMMAND'});
 a.mana=0;
 assert.throws(()=>cast(g,a.id,b.id,'saint_hero_heal'),{code:'SKILL_RESOURCES_UNAVAILABLE'});
 assert.equal(b.hp,b.character.combat.hp);
});
test('same random state yields same official Saint critical heal/overheal shield and grace result',()=>{
 const {g,a,b}=pair();b.hp=b.character.combat.hp-20;
 const replay=structuredClone(g);
 const out=cast(g,a.id,b.id,'saint_hero_heal');
 const back=cast(replay,a.id,b.id,'saint_hero_heal');
 assert.deepEqual({out:out.targetHpAfter,mp:out.casterManaAfter,random:g.randomState,
   eff:g.units[1].effects},
   {out:back.targetHpAfter,mp:back.casterManaAfter,random:replay.randomState,
    eff:replay.units[1].effects});
});

test('direct magical attack is accepted as official combat, not misclassified as effect-only MAGIC',()=>{
 const {g,a}=pair();
 const skill=SkillDatabase.get('saint_judgement');
 assert.ok(skill.weapon&&skill.category==='MAGIC'&&skill.target==='ENEMY');
 const enemy=spawn(g,{id:'target',team:'E',characterId:'imperial_swordsman',x:10,y:7});
 const tile=g.battlefield.map.tiles.find(t=>
   globalThis.TERRAINS[t.terrain]?.passable&&
   !g.units.some(u=>u.id!==enemy.id&&u.x===t.x&&u.y===t.y)&&
   Math.abs(t.x-a.x)+Math.abs(t.y-a.y)>=1&&
   TacticalEngine.canTarget(g.battlefield.map,a,{...enemy,x:t.x,y:t.y},skill,g.environmentState));
 assert.ok(tile,'original tactical LOS produces a legal magic target');
 enemy.x=tile.x;enemy.y=tile.y;enemy.z=tile.elevation;
 assert.ok(tacticalDebugProjection(g,0).units.find(u=>u.id===a.id).attackSkills
   .some(s=>s.id==='saint_judgement'));
 const hpBefore=enemy.hp,manaBefore=a.mana;
 resolveCanonicalPlayerCommand(g,{type:'DECLARE_ATTACK',attackerId:a.id,targetId:enemy.id,skillId:'saint_judgement'},0);
 assert.equal(g.phase,'PVP_REACTION_PENDING');assert.equal(g.activeSeat,1);
 resolveCanonicalPlayerCommand(g,{type:'REACT_ATTACK',reaction:'ACCEPT'},1);
 assert.equal(g.phase,'PLAYER_TACTICAL_PHASE');
 assert.equal(g.activeSeat,0);
 assert.equal(a.acted,true);
 assert.ok(a.mana<manaBefore);
 assert.ok(enemy.hp<=hpBefore);
 assert.doesNotThrow(()=>structuredClone(g));
});

test('canonical status and space-rift hits are admitted; distinct cross-explosion stays gated',async()=>{
 const {isCanonicalDirectAttackSkill}=await import('../src/pvp-headless-engagement.mjs');
 for(const id of ['cassandra_fire_burst','cassandra_frost','seraphina_rending_claw','nether_slash'])
   assert.equal(isCanonicalDirectAttackSkill(SkillDatabase.get(id)),true,id);
 assert.equal(isCanonicalDirectAttackSkill(SkillDatabase.get('templar_verdict')),true);
 assert.equal(isCanonicalDirectAttackSkill(SkillDatabase.get('cassandra_magic_bolt')),true);
 assert.equal(isCanonicalDirectAttackSkill(SkillDatabase.get('saint_judgement')),true);
});
