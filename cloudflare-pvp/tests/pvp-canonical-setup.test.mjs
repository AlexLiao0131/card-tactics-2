import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeCanonicalWorld} from '../src/pvp-canonical-setup.mjs';

const deck=Array(20).fill('imperial_swordsman_card');
const config={seed:1234,mapSize:'SMALL',decks:[deck,deck]};

test('Official BattleSetupEngine initializes original hydrology, climate and map in no-window server',()=>{
  assert.equal(typeof globalThis.window,'undefined');
  const w=initializeCanonicalWorld(config);
  assert.equal(w.battlefield.meta.validation,'PASS');
  assert.equal(w.battlefield.map.tiles.length,140);
  assert.equal(w.battlefield.cores.length,2);
  assert.equal(w.battlefield.deploymentPoints.filter(p=>p.owner==='NEUTRAL').length,3);
  assert.equal(w.environmentState.timeOfDay,'DAY');
  assert.ok(w.environmentState.effects instanceof Map);
  assert.ok(w.battlefield.map.hydrologyInitialSourceSettle);
  assert.ok(w.stage.generatedEnvironment.climateSeed>0);
  assert.doesNotThrow(()=>structuredClone(w));
});
test('Full environment and map bootstrap are deterministic for same server seed',()=>{
  const original=Math.random;
  Math.random=()=>{throw Error('forbidden global RNG');};
  try{
    assert.deepEqual(initializeCanonicalWorld(config),initializeCanonicalWorld(config));
  }finally{Math.random=original;}
});
test('different seeds produce distinct canonical world',()=>{
  const a=initializeCanonicalWorld(config),b=initializeCanonicalWorld({...config,seed:1235});
  assert.notEqual(a.battlefield.meta.seed,b.battlefield.meta.seed);
  assert.notDeepEqual(a.stage.generatedEnvironment,b.stage.generatedEnvironment);
});
test('invalid deck/map size never initializes mutable world',()=>{
  assert.throws(()=>initializeCanonicalWorld({...config,mapSize:'GIANT'}),{code:'INVALID_MAP_SIZE'});
  assert.throws(()=>initializeCanonicalWorld({...config,decks:[]}),{code:'TWO_VALID_DECKS_REQUIRED'});
  assert.throws(()=>initializeCanonicalWorld({...config,decks:[['no_card'],deck]}));
});
