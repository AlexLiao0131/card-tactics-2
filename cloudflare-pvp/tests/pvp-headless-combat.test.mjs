import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/terrain-database.js';
import '../../js/skill-database.js';
import '../../js/equipment-database.js';
import '../../js/character-database.js';
import '../../js/companion-database.js';
import '../../js/card-database.js';
import '../../js/loadout-database.js';
import '../../js/effect-engine.js';
import '../../js/battle-engine.js';
import '../../js/tactical-engine.js';
import {createUnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import {createBattleResolution} from '../../js/battle-resolution.js';
import {createOfficialBattlefield} from '../src/pvp-battlefield.mjs';

const world=createOfficialBattlefield({serverSeed:87654321,mapSize:'SMALL'});
const skill=SkillDatabase.get('slash');
function seeded(seed) {
  let state=seed>>>0;
  return () => {state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}
function exchange(seed){
  const runtime=createUnitRuntimeEngine();
  const a=runtime.createFromCard({id:'u0',team:'P',x:3,y:3,map:world.map,cores:world.cores,
    card:CardDatabase.get('imperial_swordsman_card')});
  const b=runtime.createFromCard({id:'u1',team:'E',x:3,y:4,map:world.map,cores:world.cores,
    card:CardDatabase.get('imperial_swordsman_card')});
  const resolver=createBattleResolution({random:seeded(seed)});
  const result=resolver.resolve({map:world.map,units:[a,b],initiator:a,target:b,skill});
  return {events:result.results.map(event=>({
    hit:event.result?.hit,crit:event.result?.crit,damage:event.result?.damage,
    hitRoll:event.result?.hitRoll,critRoll:event.result?.critRoll,
    hpAfter:event.hpAfter
  })),hp:b.hp,alive:b.alive};
}
test('full canonical BattleResolution runs in Cloudflare-compatible context without DOM',()=>{
  assert.equal(typeof globalThis.window,'undefined');
  const result=exchange(12345);
  assert.ok(result.events.length>=1);
  assert.ok(result.events.every(e=>typeof e.damage==='number'));
  assert.ok(Number.isFinite(result.hp));
});
test('injected per-battle RNG reproduces canonical hit/crit/HP outcome',()=>{
  assert.deepEqual(exchange(12345),exchange(12345));
  assert.notDeepEqual(exchange(12345),exchange(23456));
});
test('no Math.random needed when resolve supplies match RNG',()=>{
  const original=Math.random;
  Math.random=()=>{throw Error('forbidden global Math.random in server combat');};
  try{assert.doesNotThrow(()=>exchange(12345));}finally{Math.random=original;}
});
