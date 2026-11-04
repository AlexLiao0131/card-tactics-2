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
import '../../js/tactical-engine.js';
import {createUnitRuntimeEngine, UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import {createOfficialBattlefield} from '../src/pvp-battlefield.mjs';

const world=createOfficialBattlefield({serverSeed:123456, mapSize:'SMALL'});
const map=world.map, cores=world.cores;

function unitFor(runtime,id,cardId,x=3,y=3) {
  return runtime.createFromCard({id,team:'P',card:CardDatabase.get(cardId),x,y,map,cores});
}

test('canonical unit runtime instances keep liveUnit registry isolated across matches',()=>{
  const left=createUnitRuntimeEngine();
  const right=createUnitRuntimeEngine();
  const a=unitFor(left,'same-id','imperial_swordsman_card');
  const b=unitFor(right,'same-id','imperial_archer_card');
  assert.equal(left.getLiveUnit('same-id'),a);
  assert.equal(right.getLiveUnit('same-id'),b);
  assert.notStrictEqual(a,b);
  assert.notEqual(a.character.id,b.character.id);
  assert.equal(UnitRuntimeEngine.getLiveUnit('same-id'),null,
    'the browser singleton must remain untouched by PvP rooms');
  assert.deepEqual(left.knownUnits().map(u=>u.character.id),['imperial_swordsman']);
  assert.deepEqual(right.knownUnits().map(u=>u.character.id),['imperial_archer']);
});

test('canonical isolated unit resources and deployed-unit snapshot are cloneable',()=>{
  const runtime=createUnitRuntimeEngine();
  const unit=unitFor(runtime,'u','imperial_swordsman_card');
  assert.ok(unit.hp>0);
  assert.ok(unit.mana>=0);
  const {_runtimeMap,...persisted}=unit;
  const copy=structuredClone(persisted);
  assert.equal(copy.id,'u');
  assert.equal(copy.hp,unit.hp);
  assert.equal(copy.character.id,unit.character.id);
  assert.equal('_runtimeMap' in copy,false);
  const rawMana=unit.mana;
  runtime.restoreMana(unit,10);
  assert.ok(unit.mana >= rawMana);
  assert.equal(copy.mana,rawMana, 'persisted clone does not mutate through runtime');
});
