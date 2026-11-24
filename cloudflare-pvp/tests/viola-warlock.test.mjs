import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/pvp-match-core.mjs';
import '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {createOfficialBattlefield} from '../src/pvp-battlefield.mjs';
import {createCardPhaseEngine} from '../../js/card-phase-engine.js';
import {createBattleAreaFieldEngine,createBattleAreaFieldState} from '../../js/battle-area-field-engine.js';
import {isCanonicalImmediateMapSkill} from '../src/pvp-headless-map-skills.mjs';
import {isCanonicalDirectEffectSkill} from '../src/pvp-headless-effect-skills.mjs';
import {isCanonicalDirectAttackSkill} from '../src/pvp-headless-engagement.mjs';
const skill=id=>SkillDatabase.get(id);
const fixture=fn=>{
 const world=createOfficialBattlefield({serverSeed:1234,mapSize:'SMALL'});
 const state={randomState:1,fieldState:createBattleAreaFieldState(),units:[]};
 return withCanonicalEngines(state,e=>{
  const spawn=(id,characterId,team,x,y)=>{const u=e.unitRuntime.create({id,characterId,team,x,y,map:world.map,cores:world.cores});state.units.push(u);return u};
  const v=spawn('viola','viola','P',3,3),f=spawn('enemy','imperial_heavy_guard','E',3,4);
  return fn({e,world,state,spawn,v,f});
 });
};
test('official data, 4V profile, three soul stones and Worker capability routes',()=>fixture(({v,e})=>{
 assert.equal(LoadoutDatabase.validate(),true);assert.equal(v.character.genetics.grade,'4V');
 assert.equal(v.resources.soulStone.value,0);assert.equal(v.resources.soulStone.max,3);
 for(const id of ['viola_firestorm','viola_soul_harvest','felguard_cleave'])assert.equal(isCanonicalImmediateMapSkill(skill(id)),true,id);
 for(const id of ['viola_weakness_curse','viola_blood_curse','viola_slow_curse'])assert.equal(isCanonicalDirectEffectSkill(skill(id)),true,id);
 for(const id of ['viola_soul_drain','viola_hellfire','felguard_armor_break'])assert.equal(isCanonicalDirectAttackSkill(skill(id)),true,id);
 e.unitRuntime.changeResource(v,'soulStone',5);assert.equal(v.resources.soulStone.value,3);
 assert.ok(e.unitRuntime.consumeSkill(v,skill('viola_hellfire')));assert.equal(v.resources.soulStone.value,2);
}));
test('blood curse independently clamps HP, refreshes without compounding, dispel does not heal',()=>fixture(({e,v,f})=>{
 const hp=f.hp,def=f.character.combat.def;
 const curse=skill('viola_blood_curse').effects[0];
 assert.ok(e.effect.apply({source:v,target:f,effect:curse}).applied);
 const capped=Math.round(hp*.75);assert.equal(f.character.combat.hp,capped);assert.equal(f.hp,capped);assert.equal(f.character.combat.def,def);
 e.effect.apply({source:v,target:f,effect:curse});assert.equal(f.character.combat.hp,capped);
 e.effect.apply({source:v,target:f,effect:{type:'DISPEL'}});assert.equal(f.character.combat.hp,hp);assert.equal(f.hp,capped);
}));
test('hellfire remains after water exchange and can be cleansed',()=>fixture(({e,v,f})=>{
 const burn=skill('viola_hellfire').statusEffects[0];e.effect.apply({source:v,target:f,effect:burn});
 const before=f.hp;assert.ok(f.effects.some(x=>x.id==='HELLFIRE_BURN'));
 e.effect.exchangeWaterBurn(f,9999);assert.ok(f.effects.some(x=>x.id==='HELLFIRE_BURN'));
 e.effect.tick(f,{units:[v,f]});assert.ok(f.hp<before);
 e.effect.apply({source:v,target:f,effect:{type:'DISPEL'}});assert.ok(!f.effects.some(x=>x.id==='HELLFIRE_BURN'));
}));
test('one deployment gives two generated copies and two distinct units bind to original summoner',()=>fixture(({v,e,spawn})=>{
 const c=createCardPhaseEngine(),state=c.create();state.active=true;state.crystals=20;state.zones.hand.push('viola_card');
 assert.ok(c.commit(state,CardDatabase.get('viola_card'),v));assert.equal(state.zones.hand.filter(id=>id==='felguard_card').length,2);
 const a=spawn('a','felguard','P',2,3),b=spawn('b','felguard','P',2,4);
 assert.ok(c.commit(state,CardDatabase.get('felguard_card'),a));assert.ok(c.commit(state,CardDatabase.get('felguard_card'),b));
 assert.equal(a.summonerId,v.id);assert.equal(b.summonerId,v.id);assert.equal(c.grantGeneratedCards(state,['felguard_card','felguard_card']).length,0);
 v.mana=0;a.hp=0;const opts={units:()=>[v,a,b],stageEvent(){},cardStateFor:()=>null,pushLog(){},allowRewards:()=>false};
 DeathLifecycleEngine.create(opts).finalize(a);assert.equal(v.mana,24);
 DeathLifecycleEngine.create(opts).finalize(a);assert.equal(v.mana,24);
 b.hp=0;DeathLifecycleEngine.create(opts).finalize(b);assert.equal(v.mana,48);
}));
test('firestorm deals 3 pulses only, no ally direct damage, persists across field-engine reconstruction',()=>fixture(({v,f,e,world,state,spawn})=>{
 const ally=spawn('ally','felguard','P',4,4);let round=1;
 const field=()=>createBattleAreaFieldEngine({state:state.fieldState,map:()=>world.map,units:()=>state.units,round:()=>round,effect:()=>e.effect,pushLog(){},handleDefeated(u){u.alive=false},random:()=>.5});
 const before=f.hp,allyHp=ally.hp;field().activatePersistentArea(v,{x:3,y:4},skill('viola_firestorm'));assert.ok(f.hp<before);let hp=f.hp;
 field().tickSanctuaries('P');assert.equal(f.hp,hp);round++;field().tickSanctuaries('E');assert.equal(f.hp,hp);field().tickSanctuaries('P');assert.ok(f.hp<hp);hp=f.hp;
 field().tickSanctuaries('P');assert.equal(f.hp,hp);round++;field().tickSanctuaries('P');assert.ok(f.hp<hp);hp=f.hp;round++;field().tickSanctuaries('P');assert.equal(f.hp,hp);assert.equal(ally.hp,allyHp);assert.equal(state.fieldState.persistentAreas.length,0);
}));
test('soul drain uses actual shared combat HP loss and generates a single stone',()=>fixture(({v,f,e,world,state})=>{
 v.hp-=75;const before=v.hp,foeHp=f.hp;
 // deterministic RNG and canonical engagement; no custom damage formula
 const resolver=globalThis.BattleResolution;
 const used={...skill('viola_soul_drain'),accuracy:100,forceHit:true};
 const res=resolver.resolve({map:world.map,units:state.units,initiator:v,target:f,skill:used,actions:[]});
 assert.ok(res.results.length>0);assert.ok(f.hp<foeHp);assert.equal(v.resources.soulStone.value,1);assert.ok(v.hp>before);
}));
