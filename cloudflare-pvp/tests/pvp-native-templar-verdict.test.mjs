import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection} from '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {isCanonicalDirectAttackSkill} from '../src/pvp-headless-engagement.mjs';
import '../../js/post-engagement-engine.js';

const verdict=SkillDatabase.get('templar_verdict');
const deck=Array(20).fill('imperial_archer_card');
function setup(){
 let game=createOpeningGame({decks:[deck,deck],serverSeed:82317});
 for(const seat of [0,1])game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat}).state;
 beginCanonicalPlayerCardPhase(game);
 withCanonicalEngines(game,engine=>{
  const map=game.battlefield.map;
  for(const [id,characterId,team] of [['templar','church_templar_hero','P'],['victim','imperial_swordsman','E'],['cross','imperial_archer','E'],['friend','imperial_archer','P']]){
   const u=engine.unitRuntime.create({id,team,characterId,x:1,y:1,map,cores:game.battlefield.cores});
   assert.ok(u);delete u._runtimeMap;game.units.push(u);
  }
 });
 const [actor,victim,cross,friend]=game.units,map=game.battlefield.map;
 let found=false;
 for(const tile of map.tiles.filter(t=>globalThis.TERRAINS?.[t.terrain]?.passable)){
  for(const t of map.tiles.filter(t=>globalThis.TERRAINS?.[t.terrain]?.passable&&
    Math.abs(t.x-tile.x)+Math.abs(t.y-tile.y)<=3&&
    Math.abs(t.x-tile.x)+Math.abs(t.y-tile.y)>=1)){
   actor.x=tile.x;actor.y=tile.y;victim.x=t.x;victim.y=t.y;
   const end=map.tiles.find(pos=>pos.y===t.y&&Math.abs(pos.x-t.x)===1&&
     globalThis.TERRAINS?.[pos.terrain]?.passable&&!(pos.x===actor.x&&pos.y===actor.y));
   if(!end)continue;
   cross.x=end.x;cross.y=end.y;
   const safe=map.tiles.find(pos=>globalThis.TERRAINS?.[pos.terrain]?.passable&&
     pos.x!==actor.x&&pos.y!==actor.y&&
     pos.x!==victim.x&&pos.y!==victim.y&&
     pos.x!==cross.x&&pos.y!==cross.y&&
     Math.abs(pos.x-t.x)>2&&Math.abs(pos.y-t.y)>2);
   if(!safe)continue;
   friend.x=safe.x;friend.y=safe.y;
   if(TacticalEngine.canTarget(map,actor,victim,verdict,game.environmentState)){
    for(const unit of [actor,victim,cross,friend]){
     const t=TacticalEngine.tile(map,unit.x,unit.y);unit.z=TacticalEngine.elevation(t);
    }
    found=true;break;
   }
  }
  if(found)break;
 }
 assert.ok(found,'official attack geometry provides a legal verdict target and cross victim');
 actor.resources.holyPower.value=3;
 cross.hp=400;cross.maxHp=Math.max(cross.maxHp,400);
 resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 return {game,actor,victim,cross,friend};
}
test('original verdict is eligible only when its canonical two-phase cross shape is supported',()=>{
 assert.equal(globalThis.PostEngagementEngine.canResolveVerdictCross(verdict),true);
 assert.equal(isCanonicalDirectAttackSkill(verdict),true);
 for(const bad of [
  {...verdict,verdictCross:{radius:2,blastPower:0.8,explosiveTerrain:true}},
  {...verdict,verdictCross:{radius:2,blastPower:Infinity}},
  {...verdict,verdictCross:{radius:0,blastPower:0.8}},
  {...verdict,offenseStat:'MATK'}
 ])assert.equal(isCanonicalDirectAttackSkill(bad),false);
 const {game,actor}=setup();
 assert.ok(tacticalDebugProjection(game,0).units.find(u=>u.id===actor.id).attackSkills.some(s=>s.id===verdict.id));
 assert.equal(tacticalDebugProjection(game,1).units.find(u=>u.id===actor.id)?.attackSkills,undefined);
});
test('single server-owned verdict uses human defender reaction and original holy cross second hit',()=>{
 const {game,actor,victim,cross,friend}=setup();
 const before={power:actor.resources.holyPower.value,mana:actor.mana,
  victim:victim.hp,cross:cross.hp,friend:friend.hp};
 const start=resolveCanonicalPlayerCommand(game,{type:'DECLARE_ATTACK',attackerId:actor.id,targetId:victim.id,skillId:verdict.id},0);
 assert.equal(start.accepted,true);
 assert.equal(game.phase,'PVP_REACTION_PENDING');
 assert.equal(game.activeSeat,1);
 assert.equal(actor.resources.holyPower.value,before.power,'declaration spends no cost before defender responds');
 const settled=resolveCanonicalPlayerCommand(game,{type:'REACT_ATTACK',reaction:'ACCEPT'},1);
 assert.equal(settled.accepted,true);
 assert.equal(game.phase,'PLAYER_TACTICAL_PHASE');assert.equal(game.activeSeat,0);
 assert.equal(actor.resources.holyPower.value,0,'exact original three holy power consumed once');
 assert.equal(actor.mana,before.mana,'original verdict has zero MP cost');
 assert.equal(actor.acted,true);
 assert.ok(victim.hp<before.victim,'the original holy primary strike hits');
 assert.ok(cross.hp<before.cross,'a distinct enemy on the original cross takes blast damage');
 assert.equal(friend.hp,before.friend,'friendlies are never affected by the holy cross');
 assert.ok(settled.verdict.some(e=>e.targetId===cross.id));
 assert.ok(game.events.some(e=>String(e.text).includes('裁決十字聖光')));
 assert.doesNotThrow(()=>structuredClone(game));
});
test('no verdict explosion if the canonical primary strike was not a hit',()=>{
 const {game,actor,victim,cross}=setup();
 const before=cross.hp;
 const entries=globalThis.PostEngagementEngine.resolveVerdictCross({
  attacker:actor,defender:victim,skill:verdict,units:game.units,
  engagement:{results:[{role:'INITIATOR',actor,result:{hit:false}}]},
  random:()=>0,onLog:()=>{}
 });
 assert.deepEqual(entries,[]);assert.equal(cross.hp,before);
});
test('a forged cross range/damage or missing holy resources never starts an attack',()=>{
 const {game,actor,victim}=setup();const initial=structuredClone(game);
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'DECLARE_ATTACK',attackerId:actor.id,targetId:victim.id,skillId:verdict.id,blastPower:999},0));
 assert.deepEqual(game,initial);
 actor.resources.holyPower.value=0;
 assert.throws(()=>resolveCanonicalPlayerCommand(game,{type:'DECLARE_ATTACK',attackerId:actor.id,targetId:victim.id,skillId:verdict.id},0),{code:'ATTACK_RESOURCES_UNAVAILABLE'});
});
